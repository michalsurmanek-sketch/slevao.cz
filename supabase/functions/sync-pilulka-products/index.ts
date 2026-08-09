import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const SOURCE = 'https://www.pilulka.cz/kratka-expirace/nejlepsi';
const ADAPTER = 'pilulka-official-short-expiry-html-v1';
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
function decodeHtml(value: string) {
  return value.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10)))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"');
}
function clean(value: string) { return decodeHtml(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function money(value: string) {
  const parsed = Number(clean(value).replace(/Kč/gi, '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
function addDays(iso: string, days: number) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
async function sha256(value: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
function quantity(title: string) { return title.match(/\b\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|ks|tobolek|tablet|sáčků)\b/iu)?.[0]?.replace(/\s+/g, ' ') || null; }

function parsePage(html: string, today: string, page: number) {
  const blocks = html.split(/<div class="product-card__container" data-product-id="/).slice(1);
  const rows: any[] = [];
  for (const block of blocks) {
    const id = block.match(/^(\d+)"/)?.[1] || '';
    if (!block.includes('>Krátká expirace</div>')) continue;
    if (/Pilulka PRO|Cena s k[oó]dem|Dárek zdarma|při koupi|kupte \d|\d\+\d/iu.test(block)) continue;
    const href = decodeHtml(block.match(/product-card__img-container__link" href="([^"]+)"/)?.[1] || '');
    const image = decodeHtml(block.match(/<img srcset="([^" ]+)/)?.[1] || '');
    const currentText = block.match(/data-cy="current-price"[^>]*>([^<]+)<\/b>/)?.[1] || '';
    const oldText = block.match(/product-card-price__old[^>]*>([^<]+)<\/s>/)?.[1] || '';
    const discountText = block.match(/product-card-price__discount"[^>]*>\s*(-\d{1,2})\s*%/)?.[1] || '';
    const title = clean(block.match(/product-card__title__name"[^>]*>([^<]+)<\/span>/)?.[1] || '');
    const price = money(currentText);
    const oldPrice = money(oldText);
    const discount = Math.abs(Number(discountText));
    if (!/^\d+$/.test(id) || title.length < 4 || title.length > 180) continue;
    if (!href.startsWith('/') || !image.startsWith('https://pilulkacz.vshcdn.net/')) continue;
    if (price == null || oldPrice == null || price < 1 || price > 10000 || oldPrice <= price || oldPrice > 20000) continue;
    const calculated = Math.round((1 - price / oldPrice) * 100);
    if (!Number.isInteger(discount) || Math.abs(calculated - discount) > 1) continue;
    rows.push({
      external_id: `pilulka:short-expiry:${id}`, title, normalized_title: normalize(title), price, old_price: oldPrice,
      quantity_text: quantity(title), valid_from: today, valid_to: addDays(today, 1),
      source_url: `https://www.pilulka.cz${href}`, source_page: page, product_id: null, image_url: image, confidence: 0.99,
      metadata: { adapter: ADAPTER, parser_version: ADAPTER, pilulka_product_id: id, evidence: { official_short_expiry_tag: true, displayed_price: price, displayed_old_price: oldPrice, displayed_discount_percent: discount, calculated_discount_percent: calculated, conditional_promotions_rejected: true } },
    });
  }
  return rows;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  try {
    const body = await request.json().catch(() => ({}));
    const today = new Date().toISOString().slice(0, 10);
    const pages = await Promise.all(Array.from({ length: 5 }, async (_, index) => {
      const page = index + 1;
      const response = await fetch(`${SOURCE}?page=${page}`, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html', 'accept-language': 'cs-CZ,cs;q=0.9' }, redirect: 'follow' });
      if (!response.ok) throw new Error(`Pilulka strana ${page} HTTP ${response.status}`);
      return parsePage(await response.text(), today, page);
    }));
    const rows = [...new Map(pages.flat().map((row) => [row.external_id, row])).values()];
    if (rows.length < 30 || rows.length > 80) throw new Error(`Pilulka parser našel ${rows.length} bezpečných produktů; očekáváno 30–80.`);
    const signature = await sha256(rows.map((row) => `${row.external_id}|${row.price}|${row.old_price}|${row.valid_to}`).join('\n'));
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'pilulka').single();
    if (storeError || !store) throw storeError || new Error('Pilulka nebyla nalezena.');
    const { data: source } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).eq('source_url', SOURCE).maybeSingle();
    if (source) await db.from('leaflet_sources').update({ source_type: 'html', is_active: true, auto_publish: false, last_checked_at: new Date().toISOString(), last_error: null, adapter_key: ADAPTER, extraction_strategy: 'structured_html' }).eq('id', source.id);
    else {
      const { error } = await db.from('leaflet_sources').insert({ store_id: store.id, name: 'Pilulka krátká expirace', source_url: SOURCE, source_type: 'html', is_active: true, auto_publish: false, adapter_key: ADAPTER, extraction_strategy: 'structured_html' });
      if (error) throw error;
    }
    if (body.dry_run === true) return json({ ok: true, dry_run: true, pages: 5, publishable: rows.length, signature, candidates: rows });
    const { data: result, error } = await db.rpc('publish_structured_store_offers', { p_store_slug: 'pilulka', p_adapter: ADAPTER, p_signature: signature, p_rows: rows, p_min_products: 30, p_max_products: 80, p_source_document_url: SOURCE, p_parser_version: ADAPTER });
    if (error) throw error;
    return json({ ok: true, store: store.name, published: rows.length, signature, result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error), code: 'PILULKA_PRODUCTS_SYNC_FAILED' }, 500);
  }
});
