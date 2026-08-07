import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};
const FETCH_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/json,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: CORS }); }
async function allowed(request: Request) {
  const raw = request.headers.get('authorization') || '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE) return true;
  if (CRON && request.headers.get('x-cron-secret') === CRON) return true;
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  return !error && !!data.user && ['admin','editor'].includes(String(data.user.app_metadata?.role || '').toLowerCase());
}
async function fetchText(url: string, timeout = 25_000) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow', signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return text;
  } finally { clearTimeout(timer); }
}
async function fetchOptionalJson(url: string) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow', signal: controller.signal });
    if (!response.ok) return null;
    return await response.json().catch(() => null);
  } finally { clearTimeout(timer); }
}
function dataFromHtml(html: string) {
  const marker = 'var data =', start = html.indexOf(marker), jsonStart = html.indexOf('{', start + marker.length), end = html.indexOf('Reader.Bootstrap.init', jsonStart);
  if (start < 0 || jsonStart < 0 || end < 0) throw new Error('Publitas data mají neočekávaný formát.');
  const block = html.slice(jsonStart, end), semi = block.lastIndexOf(';');
  return JSON.parse((semi >= 0 ? block.slice(0, semi) : block).trim());
}

type ProductRef = { id: string; title: string; price: number; raw: Record<string, unknown> };
function walkProducts(value: unknown, output: Map<string, ProductRef>) {
  if (value == null) return;
  if (Array.isArray(value)) { for (const item of value) walkProducts(item, output); return; }
  if (typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;
  const id = String(obj.id ?? obj.productId ?? obj.product_id ?? '').trim();
  const title = String(obj.title ?? obj.name ?? '').replace(/\s+/g, ' ').trim();
  const rawPrice = obj.price ?? obj.salePrice ?? obj.sale_price;
  const price = typeof rawPrice === 'number' ? rawPrice : Number(String(rawPrice ?? '').replace(',','.'));
  if (/^\d{3,12}$/u.test(id) && title.length >= 2 && Number.isFinite(price) && price > 0 && price < 100000) {
    if (!output.has(id)) output.set(id, { id, title, price, raw: obj });
  }
  for (const child of Object.values(obj)) walkProducts(child, output);
}
function compactDetail(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>, out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (/^(?:id|title|name|price|salePrice|sale_price|currency|description|image|imageUrl|image_url|images|url|productUrl|product_url|sku|ean|articleNumber|article_number)$/i.test(key)) out[key] = val;
  }
  return out;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  try {
    const body = await request.json().catch(() => ({}));
    if (body.dry_run !== true) return json({ error: 'KiK produktová publikace zatím není povolena; použij dry_run.' }, 409);
    const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug','kik').single();
    if (storeError || !store) throw storeError || new Error('KiK obchod nebyl nalezen.');
    const { data: document, error: documentError } = await db.from('leaflet_imports')
      .select('id,source_hash,detected_valid_from,detected_valid_to,metadata').eq('store_id', store.id).eq('status','published')
      .contains('metadata', { adapter: 'kik-publitas-v1' }).order('created_at', { ascending: false }).limit(1).single();
    if (documentError || !document) throw documentError || new Error('Aktuální KiK Publitas dokument nebyl nalezen.');
    const viewer = String(document.metadata?.viewer_url || '').replace(/\/+$/u, '');
    if (!/^https:\/\/letaki\.kik\.cz\//iu.test(viewer)) throw new Error('KiK dokument nemá povolenou viewer adresu.');
    const html = await fetchText(`${viewer}/`), data = dataFromHtml(html), cacheToken = String(data.cacheToken || '');
    if (!cacheToken) throw new Error('KiK Publitas nevrátil cacheToken.');
    const spreads = JSON.parse(await fetchText(`${viewer}/spreads.json?version=${encodeURIComponent(cacheToken)}`));
    if (!Array.isArray(spreads) || !spreads.length) throw new Error('KiK Publitas nevrátil stránky.');

    const products = new Map<string, ProductRef>();
    let hotspotFiles = 0, pages = 0;
    for (const spread of spreads) {
      const spreadPages = Array.isArray(spread?.pages) ? spread.pages : [];
      pages += spreadPages.length;
      const nums = spreadPages.map((p: any) => Number(p?.number || 0)).filter((n: number) => n > 0);
      if (!nums.length) continue;
      const label = nums.join('-');
      const hotspotData = await fetchOptionalJson(`${viewer}/page/${label}/hotspots_data.json?version=${encodeURIComponent(cacheToken)}`);
      if (!hotspotData) continue;
      hotspotFiles++;
      walkProducts(hotspotData, products);
    }

    const refs = [...products.values()].sort((a,b) => a.title.localeCompare(b.title,'cs'));
    const detailSamples: unknown[] = [];
    for (const product of refs.slice(0, 12)) {
      const detail = await fetchOptionalJson(`${viewer}/product/${encodeURIComponent(product.id)}.json?version=${encodeURIComponent(cacheToken)}`);
      detailSamples.push({ ref: { id: product.id, title: product.title, price: product.price }, detail: compactDetail(detail) });
    }
    return json({
      ok: true, dry_run: true, store: 'KiK', document_id: document.id,
      publication_id: document.metadata?.publication_id || null, pages, hotspot_files: hotspotFiles,
      structured_products: refs.length,
      product_samples: refs.slice(0, 100).map(p => ({ id:p.id,title:p.title,price:p.price })),
      detail_samples: detailSamples,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message, code: 'KIK_PRODUCT_DRY_RUN_FAILED' }, 500);
  }
});
