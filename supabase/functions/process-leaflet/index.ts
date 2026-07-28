import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini';
const STORAGE_BUCKET = Deno.env.get('LEAFLET_BUCKET') || 'leaflets';

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type ExtractedItem = {
  title: string;
  brand: string | null;
  quantity_text: string | null;
  price: number | null;
  old_price: number | null;
  unit_price: number | null;
  unit_label: string | null;
  image_url: string | null;
  source_page: number | null;
  confidence: number | null;
  category_name: string | null;
};

type ExtractionResult = {
  valid_from: string | null;
  valid_to: string | null;
  page_count: number | null;
  items: ExtractedItem[];
};

async function fail(importId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await db.from('leaflet_imports').update({
    status: 'failed',
    error_message: message.slice(0, 2000),
    finished_at: new Date().toISOString(),
  }).eq('id', importId);
  return Response.json({ error: message }, { status: 500 });
}

async function ensureBucket() {
  const { data } = await db.storage.getBucket(STORAGE_BUCKET);
  if (!data) {
    const { error } = await db.storage.createBucket(STORAGE_BUCKET, {
      public: false,
      fileSizeLimit: 50 * 1024 * 1024,
    });
    if (error) throw error;
  }
}

async function categoryMap() {
  const { data, error } = await db.from('categories').select('id,name');
  if (error) throw error;
  return new Map((data || []).map((row: any) => [String(row.name).toLocaleLowerCase('cs'), row.id]));
}

function responseText(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  for (const item of payload?.output || []) {
    for (const part of item?.content || []) {
      if (typeof part?.text === 'string' && part.text.trim()) return part.text;
    }
  }
  return '';
}

function runInBackground(task: Promise<unknown>) {
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(task);
  else task.catch(() => undefined);
}

async function uploadPdfToOpenAI(documentUrl: string, filename: string): Promise<string> {
  const response = await fetch(documentUrl);
  if (!response.ok) throw new Error(`Stažení PDF pro OpenAI selhalo: HTTP ${response.status}`);

  const blob = await response.blob();
  const form = new FormData();
  form.append('purpose', 'user_data');
  form.append('file', blob, filename);

  const uploadResponse = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const payload = await uploadResponse.json().catch(() => ({}));
  if (!uploadResponse.ok || !payload?.id) {
    const detail = payload?.error?.message || `HTTP ${uploadResponse.status}`;
    throw new Error(`Nahrání PDF do OpenAI selhalo: ${detail}`);
  }
  return String(payload.id);
}

async function deleteOpenAIFile(fileId: string) {
  await fetch(`https://api.openai.com/v1/files/${fileId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${OPENAI_API_KEY}` },
  }).catch(() => undefined);
}

async function extractWithOpenAI(
  documentUrl: string,
  storeName: string,
  extension: string,
): Promise<ExtractionResult> {
  if (!OPENAI_API_KEY) throw new Error('V Supabase chybí secret OPENAI_API_KEY.');

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['valid_from', 'valid_to', 'page_count', 'items'],
    properties: {
      valid_from: { type: ['string', 'null'] },
      valid_to: { type: ['string', 'null'] },
      page_count: { type: ['integer', 'null'] },
      items: {
        type: 'array',
        maxItems: 300,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['title', 'brand', 'quantity_text', 'price', 'old_price', 'unit_price', 'unit_label', 'image_url', 'source_page', 'confidence', 'category_name'],
          properties: {
            title: { type: 'string' },
            brand: { type: ['string', 'null'] },
            quantity_text: { type: ['string', 'null'] },
            price: { type: ['number', 'null'] },
            old_price: { type: ['number', 'null'] },
            unit_price: { type: ['number', 'null'] },
            unit_label: { type: ['string', 'null'] },
            image_url: { type: ['string', 'null'] },
            source_page: { type: ['integer', 'null'] },
            confidence: { type: ['number', 'null'], minimum: 0, maximum: 1 },
            category_name: { type: ['string', 'null'] },
          },
        },
      },
    },
  };

  let uploadedFileId = '';
  try {
    const documentInput = extension === 'pdf'
      ? {
          type: 'input_file',
          file_id: uploadedFileId = await uploadPdfToOpenAI(
            documentUrl,
            `letak-${crypto.randomUUID()}.pdf`,
          ),
        }
      : { type: 'input_image', image_url: documentUrl, detail: 'high' };

    const aiResponse = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        store: false,
        input: [{
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: `Zpracuj český akční leták obchodu ${storeName || 'neuvedený obchod'}. Vrať všechny skutečné produktové nabídky. Ceny uváděj jako čísla v Kč bez měnového symbolu. Starou cenu vyplň jen pokud je v letáku výslovně uvedena. Množství zachovej například jako 500 g, 1 l nebo 10 ks. Kategorie používej stručné české názvy jako Potraviny, Nápoje, Drogerie, Domácnost, Elektronika, Oblečení, Zahrada, Chovatelské potřeby. Neodhaduj chybějící údaje. Nevytvářej produkty z nadpisů, kupónů, věrnostních bodů ani obecných reklamních textů. Confidence sniž při nejasné ceně nebo názvu.`,
            },
            documentInput,
          ],
        }],
        text: {
          format: {
            type: 'json_schema',
            name: 'slevao_leaflet_v1',
            strict: true,
            schema,
          },
        },
      }),
    });

    const payload = await aiResponse.json().catch(() => ({}));
    if (!aiResponse.ok) {
      const detail = payload?.error?.message || `HTTP ${aiResponse.status}`;
      throw new Error(`OpenAI zpracování selhalo: ${detail}`);
    }

    const text = responseText(payload);
    if (!text) throw new Error('OpenAI nevrátila strukturovaný výsledek.');
    try {
      return JSON.parse(text) as ExtractionResult;
    } catch {
      throw new Error('OpenAI vrátila neplatný JSON.');
    }
  } finally {
    if (uploadedFileId) await deleteOpenAIFile(uploadedFileId);
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok');
  const authorization = request.headers.get('authorization') || '';
  const allowed = authorization === `Bearer ${SERVICE_ROLE_KEY}` || Boolean(CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET);
  if (!allowed) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let importId = '';
  try {
    const body = await request.json();
    importId = String(body.import_id || '');
    if (!importId) return Response.json({ error: 'Missing import_id' }, { status: 400 });

    const { data: job, error: jobError } = await db
      .from('leaflet_imports')
      .select('*,leaflet_sources(auto_publish,name)')
      .eq('id', importId)
      .single();
    if (jobError || !job) throw jobError || new Error('Import nebyl nalezen.');
    if (['published', 'ignored'].includes(job.status)) {
      return Response.json({ ok: true, skipped: true, status: job.status });
    }

    await db.from('leaflet_imports').update({
      status: 'downloading',
      started_at: new Date().toISOString(),
      error_message: null,
    }).eq('id', importId);

    const sourceResponse = await fetch(job.source_document_url, {
      headers: { 'user-agent': 'SlevaoBot/1.0 (+https://slevao.cz)' },
      redirect: 'follow',
    });
    if (!sourceResponse.ok) throw new Error(`Stažení letáku selhalo: HTTP ${sourceResponse.status}`);

    const bytes = new Uint8Array(await sourceResponse.arrayBuffer());
    if (!bytes.length) throw new Error('Stažený leták je prázdný.');
    if (bytes.length > 50 * 1024 * 1024) throw new Error('Leták je větší než 50 MB.');

    await ensureBucket();
    const contentType = sourceResponse.headers.get('content-type') || 'application/pdf';
    const extension = contentType.includes('pdf') ? 'pdf' : contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const storagePath = `${job.store_id || 'unknown'}/${importId}/source.${extension}`;
    const { error: uploadError } = await db.storage.from(STORAGE_BUCKET).upload(storagePath, bytes, {
      contentType,
      upsert: true,
    });
    if (uploadError) throw uploadError;

    await db.from('leaflet_imports').update({
      status: 'processing',
      metadata: {
        ...(job.metadata || {}),
        storage_bucket: STORAGE_BUCKET,
        storage_path: storagePath,
        bytes: bytes.length,
        ai_model: OPENAI_MODEL,
      },
    }).eq('id', importId);

    const signed = await db.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, 60 * 60);
    if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error('Nepodařilo se vytvořit odkaz pro AI zpracování.');

    const result = await extractWithOpenAI(
      signed.data.signedUrl,
      job.leaflet_sources?.name || '',
      extension,
    );
    const items = Array.isArray(result.items) ? result.items : [];
    if (!items.length) throw new Error('AI v letáku nerozpoznala žádné produkty.');

    await db.from('leaflet_import_items').delete().eq('import_id', importId).neq('status', 'published');
    const categories = await categoryMap();
    const rows = items
      .filter((item) => item.title?.trim() && Number(item.price) > 0)
      .map((item) => ({
        import_id: importId,
        category_id: item.category_name ? categories.get(item.category_name.toLocaleLowerCase('cs')) || null : null,
        title: item.title.trim(),
        brand: item.brand || null,
        quantity_text: item.quantity_text || null,
        price: Number(item.price),
        old_price: item.old_price && Number(item.old_price) > Number(item.price) ? Number(item.old_price) : null,
        unit_price: item.unit_price ? Number(item.unit_price) : null,
        unit_label: item.unit_label || null,
        image_url: item.image_url || null,
        source_page: item.source_page || null,
        confidence: item.confidence ?? null,
        status: 'review',
        raw_data: item,
      }));

    if (!rows.length) throw new Error('AI nevrátila žádné nabídky s platnou cenou.');
    const { error: insertError } = await db.from('leaflet_import_items').insert(rows);
    if (insertError) throw insertError;

    const averageConfidence = rows.reduce((sum, row) => sum + Number(row.confidence || 0), 0) / rows.length;
    const autoPublish = Boolean(job.leaflet_sources?.auto_publish) && averageConfidence >= 0.92;
    await db.from('leaflet_imports').update({
      status: autoPublish ? 'publishing' : 'review',
      product_count: rows.length,
      confidence: averageConfidence || null,
      detected_valid_from: result.valid_from || null,
      detected_valid_to: result.valid_to || null,
      page_count: result.page_count || null,
      error_message: null,
      finished_at: new Date().toISOString(),
    }).eq('id', importId);

    if (autoPublish) {
      runInBackground(fetch(`${SUPABASE_URL}/functions/v1/publish-imports`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ import_id: importId }),
      }).then(async (response) => {
        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(`Publikace HTTP ${response.status}: ${detail.slice(0, 500)}`);
        }
      }));
    }

    return Response.json({
      ok: true,
      import_id: importId,
      products: rows.length,
      confidence: averageConfidence,
      auto_publish: autoPublish,
      model: OPENAI_MODEL,
    });
  } catch (error) {
    return importId ? await fail(importId, error) : Response.json({ error: String(error) }, { status: 500 });
  }
});