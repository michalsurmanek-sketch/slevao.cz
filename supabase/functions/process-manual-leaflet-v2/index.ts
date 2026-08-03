import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, x-client-info, content-type',
};

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

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Neznámá chyba.');
}

function runInBackground(task: Promise<unknown>) {
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(task);
  else task.catch((error) => console.error('Background task failed:', error));
}

async function markFailed(importId: string, error: unknown) {
  const message = errorMessage(error);
  console.error('Manual leaflet import failed', importId, message);
  await db.from('leaflet_imports').update({
    status: 'failed',
    error_message: message.slice(0, 2000),
    finished_at: new Date().toISOString(),
  }).eq('id', importId);
}

async function authorize(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  if (authorization === `Bearer ${SERVICE_ROLE_KEY}`) return;
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('Unauthorized');
  const { data, error } = await db.auth.getUser(token);
  const role = String(data.user?.app_metadata?.role || '').toLowerCase();
  if (error || !data.user || !['admin', 'editor'].includes(role)) throw new Error('Unauthorized');
}

function detectType(contentType: string, bytes: Uint8Array) {
  const mime = contentType.toLowerCase().split(';')[0].trim();
  if (mime === 'application/pdf' || (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
    return { extension: 'pdf', mime: 'application/pdf' };
  }
  if (mime === 'image/png' || (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) {
    return { extension: 'png', mime: 'image/png' };
  }
  if (mime === 'image/webp' || (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)) {
    return { extension: 'webp', mime: 'image/webp' };
  }
  if (mime === 'image/gif' || (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)) {
    return { extension: 'gif', mime: 'image/gif' };
  }
  if (mime === 'image/jpeg' || (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
    return { extension: 'jpg', mime: 'image/jpeg' };
  }
  throw new Error(`Uložený soubor není platný PDF ani obrázek. Content-Type: ${contentType || 'neuveden'}`);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
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

async function uploadPdf(bytes: Uint8Array, importId: string): Promise<string> {
  const form = new FormData();
  form.append('purpose', 'user_data');
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), `letak-${importId}.pdf`);
  const response = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) {
    throw new Error(`Nahrání PDF do AI selhalo: ${payload?.error?.message || `HTTP ${response.status}`}`);
  }
  return String(payload.id);
}

async function extractWithAi(
  storeName: string,
  detected: { extension: string; mime: string },
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

  const documentInput = detected.extension === 'pdf'
    ? { type: 'input_file', file_id: await uploadPdf(bytes, importId) }
    : {
        type: 'input_image',
        image_url: `data:${detected.mime};base64,${bytesToBase64(bytes)}`,
        detail: 'high',
      };

  const response = await fetch('https://api.openai.com/v1/responses', {
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
          text: `Pečlivě přečti tuto stránku českého akčního letáku obchodu ${storeName || 'neuvedený obchod'}. Projdi celý obrázek včetně malého textu a všech produktových boxů. Vrať každou skutečnou nabídku, u které je vidět název produktu a prodejní cena. Cenu rozpoznej i tehdy, když je bez symbolu Kč, rozdělena na velkou a malou část nebo uvedena jako cena s kartou či kuponem. Price musí být výsledná prodejní cena jako číslo v Kč. Old_price vyplň jen při výslovně uvedené vyšší původní ceně. Confidence vyplň číslem 0 až 1; při čitelné ceně použij nejméně 0.75. Nevynechávej nabídku jen proto, že neznáš značku, množství, kategorii nebo platnost. Tyto neznámé údaje vrať jako null. Nevytvářej produkty z nadpisů, log, věrnostních bodů ani obecných reklamních textů. Pokud stránka opravdu neobsahuje žádný produkt s cenou, vrať prázdné items.`,
        }, documentInput],
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'slevao_manual_leaflet_v3',
          strict: true,
          schema,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`AI zpracování selhalo: ${payload?.error?.message || `HTTP ${response.status}`}`);
  const text = responseText(payload);
  if (!text) throw new Error('AI nevrátila strukturovaný výsledek.');
  try {
    return JSON.parse(text) as ExtractionResult;
  } catch {
    throw new Error('AI vrátila neplatný JSON.');
  }
}

async function categoryMap() {
  const { data, error } = await db.from('categories').select('id,name');
  if (error) throw error;
  return new Map((data || []).map((row: any) => [String(row.name).toLocaleLowerCase('cs'), row.id]));
}

function validDateRange(from: string, to: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return false;
  if (from > to || to < new Date().toISOString().slice(0, 10)) return false;
  return Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`) <= 62 * 86_400_000;
}

async function finishWithoutOffers(job: any, result: ExtractionResult, rawItems: ExtractedItem[]) {
  await db.from('leaflet_imports').update({
    status: 'review',
    product_count: 0,
    confidence: null,
    detected_valid_from: result.valid_from || null,
    detected_valid_to: result.valid_to || null,
    page_count: result.page_count || 1,
    error_message: null,
    finished_at: new Date().toISOString(),
    metadata: {
      ...(job.metadata || {}),
      processor: 'process-manual-leaflet-v3',
      ai_raw_item_count: rawItems.length,
      ai_valid_price_count: 0,
      no_offers_detected: true,
      processing_note: rawItems.length
        ? 'AI rozpoznala položky, ale žádná neměla použitelný název a cenu.'
        : 'Na této stránce nebyla rozpoznána žádná produktová nabídka s cenou.',
      ai_sample_items: rawItems.slice(0, 8).map((item) => ({
        title: item.title || null,
        price: item.price ?? null,
        confidence: item.confidence ?? null,
      })),
    },
  }).eq('id', job.id);
}

async function processImport(importId: string) {
  try {
    const { data: job, error } = await db.from('leaflet_imports')
      .select('*,stores(name,slug)')
      .eq('id', importId)
      .single();
    if (error || !job) throw error || new Error('Import nebyl nalezen.');
    if (['published', 'ignored'].includes(String(job.status))) return;
    if (!/^https:\/\//i.test(String(job.source_document_url || ''))) throw new Error('Import nemá bezpečný HTTPS odkaz na soubor.');

    await db.from('leaflet_imports').update({
      status: 'downloading',
      started_at: new Date().toISOString(),
      error_message: null,
    }).eq('id', importId);

    const sourceResponse = await fetch(job.source_document_url, { redirect: 'follow' });
    if (!sourceResponse.ok) throw new Error(`Stažení uloženého letáku selhalo: HTTP ${sourceResponse.status}`);
    const bytes = new Uint8Array(await sourceResponse.arrayBuffer());
    if (!bytes.length) throw new Error('Uložený leták je prázdný.');
    if (bytes.length > 20 * 1024 * 1024) throw new Error('Ruční procesor podporuje soubor nejvýše 20 MB.');
    const detected = detectType(sourceResponse.headers.get('content-type') || '', bytes);

    await db.from('leaflet_imports').update({
      status: 'processing',
      metadata: {
        ...(job.metadata || {}),
        processor: 'process-manual-leaflet-v3',
        image_transport: detected.extension === 'pdf' ? 'openai-file' : 'server-bytes-data-url',
        detected_mime: detected.mime,
        bytes: bytes.length,
        processing_started_at: new Date().toISOString(),
      },
    }).eq('id', importId);

    const result = await extractWithAi(
      String(job.stores?.name || ''),
      detected,
      bytes,
      importId,
    );

    const rawItems = Array.isArray(result.items) ? result.items : [];
    const categories = await categoryMap();
    const validItems = rawItems.filter((item) => {
      const price = Number(item.price);
      return Boolean(item.title?.trim()) && Number.isFinite(price) && price > 0 && price <= 1_000_000;
    });

    const rows = validItems.map((item) => {
      const confidence = item.confidence == null || !Number.isFinite(Number(item.confidence))
        ? 0.75
        : Math.max(0, Math.min(1, Number(item.confidence)));
      return {
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
        source_page: item.source_page || 1,
        confidence,
        status: 'review',
        raw_data: item,
      };
    });

    if (!rows.length) {
      await finishWithoutOffers(job, result, rawItems);
      return;
    }

    await db.from('leaflet_import_items').delete().eq('import_id', importId).neq('status', 'published');
    const inserted = await db.from('leaflet_import_items').insert(rows);
    if (inserted.error) throw inserted.error;

    const averageConfidence = rows.reduce((sum, row) => sum + Number(row.confidence || 0), 0) / rows.length;
    const validFrom = String(result.valid_from || '');
    const validTo = String(result.valid_to || '');
    const autoPublish = Boolean(job.metadata?.auto_publish)
      && rows.length >= 8
      && averageConfidence >= 0.92
      && validDateRange(validFrom, validTo);

    await db.from('leaflet_imports').update({
      status: autoPublish ? 'publishing' : 'review',
      product_count: rows.length,
      confidence: averageConfidence || null,
      detected_valid_from: validFrom || null,
      detected_valid_to: validTo || null,
      page_count: result.page_count || 1,
      error_message: null,
      finished_at: new Date().toISOString(),
      metadata: {
        ...(job.metadata || {}),
        processor: 'process-manual-leaflet-v3',
        image_transport: detected.extension === 'pdf' ? 'openai-file' : 'server-bytes-data-url',
        ai_raw_item_count: rawItems.length,
        ai_valid_price_count: rows.length,
        ai_sample_items: rows.slice(0, 8).map((item) => ({
          title: item.title,
          price: item.price,
          confidence: item.confidence,
        })),
      },
    }).eq('id', importId);

    if (autoPublish) {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/publish-imports`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          apikey: SERVICE_ROLE_KEY,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ import_id: importId }),
      });
      if (!response.ok) throw new Error(`Publikace selhala: HTTP ${response.status}`);
    }
  } catch (error) {
    await markFailed(importId, error);
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: 'Na serveru chybí Supabase secrets.' }, 500);
  try {
    await authorize(request);
  } catch {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (request.method !== 'POST') return json({ error: 'Metoda není podporována.' }, 405);
  const body = await request.json().catch(() => ({}));
  const importId = String(body.import_id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(importId)) return json({ error: 'Missing import_id' }, 400);

  const { data: job, error } = await db.from('leaflet_imports').select('id,status').eq('id', importId).maybeSingle();
  if (error || !job) return json({ error: error?.message || 'Import nebyl nalezen.' }, 404);
  if (['published', 'ignored'].includes(String(job.status))) return json({ ok: true, skipped: true, status: job.status });

  await db.from('leaflet_imports').update({ status: 'queued', error_message: null, finished_at: null }).eq('id', importId);
  runInBackground(processImport(importId));
  return json({ ok: true, accepted: true, import_id: importId }, 202);
});
