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

function runInBackground(task: Promise<unknown>) {
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(task);
  else task.catch((error) => console.error('Background task failed:', error));
}

async function markFailed(importId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Import failed', importId, message);
  await db.from('leaflet_imports').update({
    status: 'failed',
    error_message: message.slice(0, 2000),
    finished_at: new Date().toISOString(),
  }).eq('id', importId);
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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function detectDocumentType(contentType: string, bytes: Uint8Array) {
  const normalized = contentType.toLowerCase().split(';')[0].trim();
  if (normalized === 'application/pdf' || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return { extension: 'pdf', mime: 'application/pdf' };
  }
  if (normalized === 'image/png' || (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) {
    return { extension: 'png', mime: 'image/png' };
  }
  if (normalized === 'image/webp' || (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)) {
    return { extension: 'webp', mime: 'image/webp' };
  }
  if (normalized === 'image/gif' || (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)) {
    return { extension: 'gif', mime: 'image/gif' };
  }
  if (normalized === 'image/jpeg' || (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
    return { extension: 'jpg', mime: 'image/jpeg' };
  }
  throw new Error(`Stažená adresa nevrátila platný PDF ani obrázek. Content-Type: ${contentType || 'neuveden'}`);
}

async function uploadPdfToOpenAI(bytes: Uint8Array, filename: string): Promise<string> {
  const form = new FormData();
  form.append('purpose', 'user_data');
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), filename);
  const response = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) {
    throw new Error(`Nahrání PDF do OpenAI selhalo: ${payload?.error?.message || `HTTP ${response.status}`}`);
  }
  return String(payload.id);
}

async function extractWithOpenAI(
  storeName: string,
  extension: string,
  mime: string,
  bytes: Uint8Array,
  importId: string,
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

  let documentInput: Record<string, unknown>;
  if (extension === 'pdf') {
    const fileId = await uploadPdfToOpenAI(bytes, `letak-${importId}.pdf`);
    documentInput = { type: 'input_file', file_id: fileId };
  } else {
    const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
    documentInput = { type: 'input_image', image_url: dataUrl, detail: 'high' };
  }

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
        content: [{
          type: 'input_text',
          text: `Zpracuj český akční leták obchodu ${storeName || 'neuvedený obchod'}. Vrať všechny skutečné produktové nabídky. Ceny uváděj jako čísla v Kč bez měnového symbolu. Starou cenu vyplň jen pokud je v letáku výslovně uvedena. Množství zachovej například jako 500 g, 1 l nebo 10 ks. Kategorie používej stručné české názvy jako Potraviny, Nápoje, Drogerie, Domácnost, Elektronika, Oblečení, Zahrada, Chovatelské potřeby. Neodhaduj chybějící údaje. Nevytvářej produkty z nadpisů, kupónů, věrnostních bodů ani obecných reklamních textů. Confidence sniž při nejasné ceně nebo názvu.${storeName.toLocaleLowerCase('cs').includes('makro') ? ' U MAKRO vždy použij jako price konečnou cenu s DPH. Menší cenu bez DPH a větší cenu s DPH nikdy nevykládej jako akční a původní cenu; old_price v takovém případě musí být null.' : ''}`,
        }, documentInput],
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
  if (!aiResponse.ok) throw new Error(`OpenAI zpracování selhalo: ${payload?.error?.message || `HTTP ${aiResponse.status}`}`);
  const text = responseText(payload);
  if (!text) throw new Error('OpenAI nevrátila strukturovaný výsledek.');
  try { return JSON.parse(text) as ExtractionResult; }
  catch { throw new Error('OpenAI vrátila neplatný JSON.'); }
}

async function processImport(importId: string) {
  try {
    const { data: job, error: jobError } = await db.from('leaflet_imports')
      .select('*,leaflet_sources(auto_publish,name),stores(slug)').eq('id', importId).single();
    if (jobError || !job) throw jobError || new Error('Import nebyl nalezen.');
    if (['published', 'ignored'].includes(job.status)) return;

    await db.from('leaflet_imports').update({ status: 'downloading', started_at: new Date().toISOString(), error_message: null }).eq('id', importId);
    const sourceResponse = await fetch(job.source_document_url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        accept: 'application/pdf,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.8',
        'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
        referer: job.source_document_url.includes('tesco.com') ? 'https://www.itesco.cz/' : new URL(job.source_document_url).origin + '/',
      },
      redirect: 'follow',
    });
    if (!sourceResponse.ok) throw new Error(`Stažení letáku selhalo: HTTP ${sourceResponse.status}`);

    const bytes = new Uint8Array(await sourceResponse.arrayBuffer());
    if (!bytes.length) throw new Error('Stažený leták je prázdný.');
    if (bytes.length > 50 * 1024 * 1024) throw new Error('Leták je větší než 50 MB.');

    const detected = detectDocumentType(sourceResponse.headers.get('content-type') || '', bytes);
    await ensureBucket();
    const storagePath = `${job.store_id || 'unknown'}/${importId}/source.${detected.extension}`;
    const { error: uploadError } = await db.storage.from(STORAGE_BUCKET).upload(storagePath, bytes, {
      contentType: detected.mime,
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
        detected_mime: detected.mime,
        ai_model: OPENAI_MODEL,
        processing_started_at: new Date().toISOString(),
      },
    }).eq('id', importId);

    const result = await extractWithOpenAI(job.leaflet_sources?.name || '', detected.extension, detected.mime, bytes, importId);
    const items = Array.isArray(result.items) ? result.items : [];
    if (!items.length) throw new Error('AI v letáku nerozpoznala žádné produkty.');
    const isMakro = job.stores?.slug === 'makro';
    let detectedValidFrom = result.valid_from || '';
    let detectedValidTo = result.valid_to || '';
    const hasValidIsoRange = /^\d{4}-\d{2}-\d{2}$/.test(detectedValidFrom)
      && /^\d{4}-\d{2}-\d{2}$/.test(detectedValidTo)
      && detectedValidFrom <= detectedValidTo;
    if (isMakro && !hasValidIsoRange) {
      const start = new Date();
      const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 6);
      detectedValidFrom = start.toISOString().slice(0, 10);
      detectedValidTo = end.toISOString().slice(0, 10);
    }

    await db.from('leaflet_import_items').delete().eq('import_id', importId).neq('status', 'published');
    const categories = await categoryMap();
    const rows = items.filter((item) => item.title?.trim() && Number(item.price) > 0 && Number(item.price) <= 1_000_000 && Number(item.confidence ?? 0) >= 0.75).map((item) => {
      let price = Number(item.price);
      let oldPrice = item.old_price && Number(item.old_price) > price ? Number(item.old_price) : null;
      if (isMakro && oldPrice) {
        price = oldPrice;
        oldPrice = null;
      }
      return {
        import_id: importId,
        category_id: item.category_name ? categories.get(item.category_name.toLocaleLowerCase('cs')) || null : null,
        title: item.title.trim(),
        brand: item.brand || null,
        quantity_text: item.quantity_text || null,
        price,
        old_price: oldPrice,
        unit_price: item.unit_price ? Number(item.unit_price) : null,
        unit_label: item.unit_label || null,
        image_url: item.image_url || null,
        source_page: item.source_page || null,
        confidence: item.confidence ?? null,
        status: 'review',
        raw_data: { ...item, makro_vat_price_normalized: isMakro && Boolean(item.old_price) },
      };
    });

    if (!rows.length) throw new Error('AI nevrátila žádné nabídky s platnou cenou.');
    const { error: insertError } = await db.from('leaflet_import_items').insert(rows);
    if (insertError) throw insertError;

    const averageConfidence = rows.reduce((sum, row) => sum + Number(row.confidence || 0), 0) / rows.length;
    const today = new Date().toISOString().slice(0, 10);
    const validFrom = detectedValidFrom;
    const validTo = detectedValidTo;
    const validDates = /^\d{4}-\d{2}-\d{2}$/.test(validFrom)
      && /^\d{4}-\d{2}-\d{2}$/.test(validTo)
      && validFrom <= validTo
      && validTo >= today
      && (Date.parse(validTo + 'T12:00:00Z') - Date.parse(validFrom + 'T12:00:00Z')) <= 62 * 86_400_000;
    const minimumAutoPublishConfidence = job.stores?.slug === 'tesco' ? 0.88 : 0.92;
    const autoPublish = Boolean(job.leaflet_sources?.auto_publish)
      && rows.length >= 8
      && averageConfidence >= minimumAutoPublishConfidence
      && validDates;
    await db.from('leaflet_imports').update({
      status: autoPublish ? 'publishing' : 'review',
      product_count: rows.length,
      confidence: averageConfidence || null,
      detected_valid_from: detectedValidFrom || null,
      detected_valid_to: detectedValidTo || null,
      page_count: result.page_count || null,
      error_message: null,
      finished_at: new Date().toISOString(),
    }).eq('id', importId);

    if (autoPublish) {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/publish-imports`, {
        method: 'POST',
        headers: { authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ import_id: importId }),
      });
      if (!response.ok) throw new Error(`Publikace HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 500)}`);
    }
  } catch (error) {
    await markFailed(importId, error);
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok');
  const authorization = request.headers.get('authorization') || '';
  const allowed = authorization === `Bearer ${SERVICE_ROLE_KEY}` || Boolean(CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET);
  if (!allowed) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const importId = String(body.import_id || '');
  if (!importId) return Response.json({ error: 'Missing import_id' }, { status: 400 });

  const { data: job, error } = await db.from('leaflet_imports').select('id,status').eq('id', importId).single();
  if (error || !job) return Response.json({ error: 'Import nebyl nalezen.' }, { status: 404 });
  if (['published', 'ignored'].includes(job.status)) return Response.json({ ok: true, skipped: true, status: job.status });

  await db.from('leaflet_imports').update({ status: 'queued', error_message: null, finished_at: null }).eq('id', importId);
  runInBackground(processImport(importId));
  return Response.json({ ok: true, accepted: true, import_id: importId }, { status: 202 });
});
