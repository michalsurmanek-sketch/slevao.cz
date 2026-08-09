import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const SOURCE = 'https://www.sinsay.com/cz/cz/vyprodej/zena';
const ADAPTER = 'sinsay-official-clearance-v1';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const HEADERS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret', 'content-type': 'application/json; charset=utf-8' };

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: HEADERS }); }
async function allowed(request: Request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE || (CRON && request.headers.get('x-cron-secret') === CRON)) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}
function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function money(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
function addDays(iso: string, days: number) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function extractProducts(html: string) {
  const startMarker = 'products: [';
  const endMarker = ',\n                    productsApiUrl:';
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error('Sinsay strukturovaný seznam produktů nebyl nalezen.');
  return JSON.parse(html.slice(start + 'products: '.length, end));
}
function parseProducts(html: string, today: string) {
  const products = extractProducts(html);
  if (!Array.isArray(products)) throw new Error('Sinsay seznam produktů nemá očekávaný formát.');
  const rows: any[] = [];
  for (const product of products) {
    const id = String(product.id || '');
    const sku = String(product.sku || '');
    const title = String(product.extendedName || product.name || '').replace(/\s+/g, ' ').trim();
    const price = money(product.final_price);
    const oldPrice = money(product.price);
    const image = String(product.firstPhoto?.sizes?.medium || '');
    const href = String(product.url || '');
    const merchant = product.merchant || {};
    if (!id || !/^[A-Z0-9-]{5,}$/i.test(sku) || title.length < 3 || !href.startsWith('https://www.sinsay.com/cz/cz/') || !image.startsWith('https://static.sinsay.com/')) continue;
    if (/^LADIES[`'’]?\s+T-SHIRT$/i.test(title)) continue;
    if (product.has_discount !== true || product.finalPriceType !== 'clearance' || Number(product.minQty) !== 1 || merchant.name !== 'Sinsay' || merchant.isExternal !== false) continue;
    if (price == null || oldPrice == null || price < 10 || price > 10000 || oldPrice <= price) continue;
    rows.push({
      external_id: `sinsay:${sku}`, title, normalized_title: normalize(title), price, old_price: oldPrice, quantity_text: null,
      valid_from: today, valid_to: addDays(today, 1), source_url: href, source_page: 1, product_id: null, image_url: image, confidence: 0.99,
      metadata: { adapter: ADAPTER, parser_version: ADAPTER, sinsay_product_id: id, sinsay_sku: sku, evidence: { official_price_type: 'clearance', current_price: price, regular_price: oldPrice, minimum_quantity: 1, merchant: 'Sinsay' } },
    });
  }
  const unique = [...new Map(rows.map((row) => [row.external_id, row])).values()];
  if (unique.length < 80 || unique.length > 120) throw new Error(`Sinsay parser našel ${unique.length} bezpečných produktů; očekáváno 80–120.`);
  return unique;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  try {
    const body = await request.json().catch(() => ({}));
    const response = await fetch(SOURCE, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html', 'accept-language': 'cs-CZ,cs;q=0.9' }, redirect: 'follow' });
    if (!response.ok) throw new Error(`Sinsay HTTP ${response.status}`);
    const html = await response.text();
    const today = new Date().toISOString().slice(0, 10);
    const rows = parseProducts(html, today);
    const signature = await sha256(rows.map((row) => `${row.external_id}|${row.title}|${row.price}|${row.old_price}|${row.valid_to}`).join('\n'));
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'sinsay').single();
    if (storeError || !store) throw storeError || new Error('Sinsay nebyl nalezen.');
    const { data: existingSource } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).limit(1).maybeSingle();
    if (existingSource) {
      await db.from('leaflet_sources').update({ source_url: SOURCE, source_type: 'html', is_active: true, auto_publish: false, last_checked_at: new Date().toISOString(), last_error: null, adapter_key: ADAPTER, extraction_strategy: 'structured_html' }).eq('id', existingSource.id);
    } else {
      const { error } = await db.from('leaflet_sources').insert({ store_id: store.id, name: 'Sinsay Výprodej', source_url: SOURCE, source_type: 'html', is_active: true, auto_publish: false, adapter_key: ADAPTER, extraction_strategy: 'structured_html' });
      if (error) throw error;
    }
    if (body.dry_run === true) return json({ ok: true, dry_run: true, publishable: rows.length, signature, candidates: rows });
    const { data: result, error: publishError } = await db.rpc('publish_structured_store_offers', { p_store_slug: 'sinsay', p_adapter: ADAPTER, p_signature: signature, p_rows: rows, p_min_products: 80, p_max_products: 120, p_source_document_url: SOURCE, p_parser_version: ADAPTER });
    if (publishError) throw publishError;
    return json({ ok: true, store: store.name, published: rows.length, signature, result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error), code: 'SINSAY_PRODUCTS_SYNC_FAILED' }, 500);
  }
});
