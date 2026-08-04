import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini';
const PAGE_BUCKET = 'product-images';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, x-client-info, content-type, x-cron-secret',
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type ImportItem = {
  id: string;
  import_id: string;
  product_id: string | null;
  title: string;
  brand: string | null;
  quantity_text: string | null;
  price: number | string | null;
  image_url: string | null;
  source_page: number | null;
  status: string;
  raw_data: Record<string, unknown> | null;
};

type CropBox = {
  item_id: string;
  has_product_image: boolean;
  x_pct: number | null;
  y_pct: number | null;
  width_pct: number | null;
  height_pct: number | null;
  confidence: number;
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
  else task.catch((error) => console.error('Background crop task failed:', error));
}

async function authorize(request: Request): Promise<void> {
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return;
  const authorization = request.headers.get('authorization') || '';
  if (authorization === `Bearer ${SERVICE_ROLE_KEY}`) return;
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('Unauthorized');
  const { data, error } = await db.auth.getUser(token);
  const role = String(data.user?.app_metadata?.role || '').toLowerCase();
  if (error || !data.user || !['admin', 'editor'].includes(role)) throw new Error('Unauthorized');
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
  for (const output of payload?.output || []) {
    for (const part of output?.content || []) {
      if (typeof part?.text === 'string' && part.text.trim()) return part.text;
    }
  }
  return '';
}

function safeSegment(value: unknown, fallback: string): string {
  const clean = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return clean || fallback;
}

function detectImage(bytes: Uint8Array, suggestedMime: unknown) {
  const mime = String(suggestedMime || '').toLowerCase().split(';')[0].trim();
  if (mime === 'image/webp' || (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP')) {
    return { mime: 'image/webp', extension: 'webp' };
  }
  if (mime === 'image/png' || (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (mime === 'image/jpeg' || (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  throw new Error('Výřezy podporují pouze stránku ve formátu WebP, PNG nebo JPG.');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizedBox(box: CropBox) {
  if (!box.has_product_image) return null;
  const rawX = Number(box.x_pct);
  const rawY = Number(box.y_pct);
  const rawW = Number(box.width_pct);
  const rawH = Number(box.height_pct);
  const confidence = clamp(Number(box.confidence || 0), 0, 1);
  if (![rawX, rawY, rawW, rawH].every(Number.isFinite)) return null;
  if (rawW < 3 || rawH < 3 || rawW > 95 || rawH > 95 || confidence < 0.62) return null;

  const padding = 2.2;
  const x = clamp(rawX - padding, 0, 97);
  const y = clamp(rawY - padding, 0, 97);
  const width = clamp(rawW + padding * 2, 3, 100 - x);
  const height = clamp(rawH + padding * 2, 3, 100 - y);
  return {
    x: Number(x.toFixed(3)),
    y: Number(y.toFixed(3)),
    width: Number(width.toFixed(3)),
    height: Number(height.toFixed(3)),
    confidence,
  };
}

function cropUrl(pageUrl: string, box: ReturnType<typeof normalizedBox>): string | null {
  if (!box) return null;
  const params = new URLSearchParams();
  params.set('url', pageUrl);
  params.set('cx', `${box.x}%`);
  params.set('cy', `${box.y}%`);
  params.set('cw', `${box.width}%`);
  params.set('ch', `${box.height}%`);
  params.set('precrop', '1');
  params.set('w', '720');
  params.set('h', '720');
  params.set('fit', 'contain');
  params.set('output', 'webp');
  params.set('q', '86');
  return `https://wsrv.nl/?${params.toString()}`;
}

async function loadPage(job: any): Promise<{ bytes: Uint8Array; mime: string; extension: string }> {
  const bucket = String(job.metadata?.storage_bucket || '');
  const path = String(job.metadata?.storage_path || '');
  let bytes: Uint8Array;
  let mime = String(job.metadata?.content_type || '');

  if (bucket && path) {
    const downloaded = await db.storage.from(bucket).download(path);
    if (downloaded.error || !downloaded.data) throw downloaded.error || new Error('Uloženou stránku letáku nelze stáhnout.');
    bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    mime = downloaded.data.type || mime;
  } else {
    const response = await fetch(String(job.source_document_url || ''), { redirect: 'follow' });
    if (!response.ok) throw new Error(`Stažení stránky letáku selhalo: HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer());
    mime = response.headers.get('content-type') || mime;
  }

  if (!bytes.length) throw new Error('Stránka letáku je prázdná.');
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Stránka letáku je větší než 8 MB.');
  const detected = detectImage(bytes, mime);
  return { bytes, ...detected };
}

async function ensurePublicPage(job: any, page: { bytes: Uint8Array; mime: string; extension: string }): Promise<string> {
  const store = safeSegment(job.stores?.slug || job.store_id, 'store');
  const batch = safeSegment(job.metadata?.page_batch_id || job.id, job.id);
  const pageNumber = Math.max(1, Number(job.metadata?.page_number || job.page_count || 1));
  const hash = safeSegment(String(job.metadata?.sha256 || job.source_hash || job.id).slice(0, 20), 'page');
  const path = `leaflet-pages/${store}/${batch}/page-${String(pageNumber).padStart(3, '0')}-${hash}.${page.extension}`;
  const upload = await db.storage.from(PAGE_BUCKET).upload(path, page.bytes, {
    contentType: page.mime,
    cacheControl: '31536000',
    upsert: true,
  });
  if (upload.error) throw upload.error;
  const publicResult = db.storage.from(PAGE_BUCKET).getPublicUrl(path);
  const url = publicResult.data?.publicUrl;
  if (!url) throw new Error('Nepodařilo se vytvořit veřejnou adresu stránky letáku.');
  return url;
}

async function locateBoxes(page: { bytes: Uint8Array; mime: string }, items: ImportItem[], storeName: string): Promise<CropBox[]> {
  if (!OPENAI_API_KEY) throw new Error('V Supabase chybí OPENAI_API_KEY.');
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['boxes'],
    properties: {
      boxes: {
        type: 'array',
        maxItems: 120,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['item_id', 'has_product_image', 'x_pct', 'y_pct', 'width_pct', 'height_pct', 'confidence'],
          properties: {
            item_id: { type: 'string' },
            has_product_image: { type: 'boolean' },
            x_pct: { type: ['number', 'null'], minimum: 0, maximum: 100 },
            y_pct: { type: ['number', 'null'], minimum: 0, maximum: 100 },
            width_pct: { type: ['number', 'null'], minimum: 0, maximum: 100 },
            height_pct: { type: ['number', 'null'], minimum: 0, maximum: 100 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
    },
  };

  const itemList = items.map((item) => ({
    item_id: item.id,
    title: item.title,
    brand: item.brand,
    quantity: item.quantity_text,
    price: Number(item.price || 0),
  }));

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
          text: `Na přiložené stránce akčního letáku obchodu ${storeName || 'neuvedený obchod'} najdi obrazovou fotografii každé položky z JSON seznamu. Pro každé item_id vrať právě jeden záznam. Souřadnice x_pct a y_pct jsou levý horní roh a width_pct a height_pct jsou rozměry v procentech celé stránky od 0 do 100. Ohranič pouze samotný výrobek, obal nebo fotografii čerstvé potraviny. Nezahrnuj cenu, slevový štítek, název, popis, logo obchodu ani okolní produkt. Pokud je v jedné nabídce několik příchutí nebo obalů téhož výrobku, může obdélník zahrnout jejich společnou produktovou skupinu. Pokud samostatnou fotografii nelze bezpečně přiřadit, nastav has_product_image=false a souřadnice null. Nevymýšlej polohu podle pořadí seznamu. Položky: ${JSON.stringify(itemList)}`,
        }, {
          type: 'input_image',
          image_url: `data:${page.mime};base64,${bytesToBase64(page.bytes)}`,
          detail: 'high',
        }],
      }],
      text: {
        format: {
          type: 'json_schema',
          name: 'slevao_leaflet_product_boxes',
          strict: true,
          schema,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`AI určení výřezů selhalo: ${payload?.error?.message || `HTTP ${response.status}`}`);
  const text = responseText(payload);
  if (!text) throw new Error('AI nevrátila souřadnice výřezů.');
  const parsed = JSON.parse(text);
  return Array.isArray(parsed?.boxes) ? parsed.boxes : [];
}

async function productVerificationMap(items: ImportItem[]): Promise<Map<string, boolean>> {
  const ids = [...new Set(items.map((item) => item.product_id).filter(Boolean) as string[])];
  if (!ids.length) return new Map();
  const { data, error } = await db.from('products').select('id,image_verified,image_quality,image_url').in('id', ids);
  if (error) throw error;
  return new Map((data || []).map((product: any) => [
    String(product.id),
    Boolean(product.image_verified && Number(product.image_quality || 0) >= 70 && /^https:\/\//i.test(String(product.image_url || ''))),
  ]));
}

async function attachPublishedCrop(job: any, item: ImportItem, imageUrl: string, pageUrl: string, box: any): Promise<void> {
  if (!item.product_id) return;
  const metadata = {
    provider: 'leaflet_ai_crop',
    import_id: job.id,
    import_item_id: item.id,
    page_number: Number(job.metadata?.page_number || item.source_page || 1),
    page_batch_id: job.metadata?.page_batch_id || null,
    public_page_url: pageUrl,
    crop_box_percent: box,
    review_tier: 'usable_manual',
  };

  const candidate = await db.from('product_image_candidates').upsert({
    product_id: item.product_id,
    image_url: imageUrl,
    source_url: pageUrl,
    source_domain: new URL(SUPABASE_URL).hostname,
    source_type: 'official_catalog',
    quality_score: Math.round(72 + Number(box.confidence || 0) * 20),
    match_score: Number(box.confidence || 0),
    has_clean_background: false,
    has_text_overlay: false,
    has_price_overlay: false,
    status: 'pending',
    metadata,
  }, { onConflict: 'product_id,image_url', ignoreDuplicates: true });
  if (candidate.error) console.warn('Kandidát výřezu se nepodařil uložit:', candidate.error.message);

  let offerQuery = db.from('offers').update({ image_url: imageUrl })
    .eq('product_id', item.product_id)
    .eq('store_id', job.store_id)
    .eq('valid_from', job.detected_valid_from)
    .eq('valid_to', job.detected_valid_to);
  if (job.coverage_scope) offerQuery = offerQuery.eq('coverage_scope', job.coverage_scope);
  const updated = await offerQuery;
  if (updated.error) console.warn('Výřez se nepodařilo propsat do nabídky:', updated.error.message);
}

async function processImport(importId: string): Promise<void> {
  const { data: job, error: jobError } = await db.from('leaflet_imports')
    .select('*,stores(name,slug)')
    .eq('id', importId)
    .single();
  if (jobError || !job) throw jobError || new Error('Import nebyl nalezen.');
  if (!['review', 'published'].includes(String(job.status || ''))) return;

  const { data: loadedItems, error: itemsError } = await db.from('leaflet_import_items')
    .select('id,import_id,product_id,title,brand,quantity_text,price,image_url,source_page,status,raw_data')
    .eq('import_id', importId)
    .not('status', 'in', '(ignored,rejected)')
    .order('created_at');
  if (itemsError) throw itemsError;
  const items = (loadedItems || []) as ImportItem[];
  if (!items.length) return;

  const page = await loadPage(job);
  const pageUrl = await ensurePublicPage(job, page);
  const existingBoxes = new Map<string, CropBox>();
  for (const item of items) {
    const saved = (item.raw_data as any)?.leaflet_crop?.box;
    if (saved && item.image_url) {
      existingBoxes.set(item.id, {
        item_id: item.id,
        has_product_image: true,
        x_pct: saved.x,
        y_pct: saved.y,
        width_pct: saved.width,
        height_pct: saved.height,
        confidence: Number((item.raw_data as any)?.leaflet_crop?.confidence || 0.8),
      });
    }
  }

  const missing = items.filter((item) => !existingBoxes.has(item.id));
  const located = missing.length ? await locateBoxes(page, missing, String(job.stores?.name || '')) : [];
  const allBoxes = new Map<string, CropBox>(existingBoxes);
  for (const box of located) allBoxes.set(String(box.item_id), box);

  const verifiedProducts = await productVerificationMap(items);
  let created = 0;
  let skipped = 0;
  let attached = 0;

  for (const item of items) {
    const rawBox = allBoxes.get(item.id);
    const box = rawBox ? normalizedBox(rawBox) : null;
    const imageUrl = cropUrl(pageUrl, box);
    if (!box || !imageUrl) {
      skipped++;
      continue;
    }

    const rawData = {
      ...(item.raw_data || {}),
      image_url: imageUrl,
      leaflet_crop: {
        provider: 'leaflet_ai_crop',
        page_url: pageUrl,
        page_number: Number(job.metadata?.page_number || item.source_page || 1),
        box,
        confidence: box.confidence,
        generated_at: new Date().toISOString(),
      },
    };
    const updatedItem = await db.from('leaflet_import_items').update({ image_url: imageUrl, raw_data: rawData }).eq('id', item.id);
    if (updatedItem.error) throw updatedItem.error;
    created++;

    if (job.status === 'published' && item.product_id && !verifiedProducts.get(item.product_id)) {
      await attachPublishedCrop(job, item, imageUrl, pageUrl, box);
      attached++;
    }
  }

  await db.from('leaflet_imports').update({
    metadata: {
      ...(job.metadata || {}),
      crop_processor: 'generate-leaflet-product-crops-v1',
      crop_status: 'completed',
      public_page_url: pageUrl,
      crop_created_count: created,
      crop_attached_count: attached,
      crop_skipped_count: skipped,
      crop_finished_at: new Date().toISOString(),
    },
  }).eq('id', importId);
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

  runInBackground(processImport(importId).catch(async (error) => {
    console.error('Leaflet crop processing failed:', importId, errorMessage(error));
    const { data: job } = await db.from('leaflet_imports').select('metadata').eq('id', importId).maybeSingle();
    await db.from('leaflet_imports').update({
      metadata: {
        ...(job?.metadata || {}),
        crop_processor: 'generate-leaflet-product-crops-v1',
        crop_status: 'failed',
        crop_error: errorMessage(error).slice(0, 1000),
        crop_finished_at: new Date().toISOString(),
      },
    }).eq('id', importId);
  }));

  return json({ ok: true, accepted: true, import_id: importId }, 202);
});
