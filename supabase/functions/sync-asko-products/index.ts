import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const SOURCE = 'https://www.asko-nabytek.cz/vyprodej';
const ADAPTER = 'asko-official-clearance-html-v2';
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
function addDays(iso: string, days: number) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
    aacute: 'á', Aacute: 'Á', ccaron: 'č', Ccaron: 'Č', dcaron: 'ď', Dcaron: 'Ď',
    eacute: 'é', Eacute: 'É', ecaron: 'ě', Ecaron: 'Ě', iacute: 'í', Iacute: 'Í',
    ncaron: 'ň', Ncaron: 'Ň', oacute: 'ó', Oacute: 'Ó', rcaron: 'ř', Rcaron: 'Ř',
    scaron: 'š', Scaron: 'Š', tcaron: 'ť', Tcaron: 'Ť', uacute: 'ú', Uacute: 'Ú',
    uring: 'ů', Uring: 'Ů', yacute: 'ý', Yacute: 'Ý', zcaron: 'ž', Zcaron: 'Ž',
  };
  return value.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name] ?? entity);
}
function money(value: string) {
  const parsed = Number(value.replace(/\./g, '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
function askoMoney(value: string) {
  const parsed = Number(decodeHtml(value).replace(/\s/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function parseProducts(html: string, today: string, page: number) {
  const blocks = html.split('<div class="product">').slice(1);
  const rows: any[] = [];
  for (const block of blocks) {
    const id = block.match(/class="button small trans-black add-to-cart"[\s\S]*?data-id="([0-9]+)"/)?.[1] || '';
    const title = decodeHtml(block.match(/data-name="([^"]+)"/)?.[1] || '').replace(/\s+/g, ' ').trim();
    const relativeImage = decodeHtml(block.match(/<img[\s\S]*?src="(\/images\/asko_nabytek_cz\/product_box_cat\/[^"]+)"/)?.[1] || '');
    const relativeHref = decodeHtml(block.match(/<a href="([^"]+)" class="image product-image-wrapper/)?.[1] || '');
    const cartPrice = Number(block.match(/data-unit-price="([0-9.]+)"/)?.[1] || '');
    const displayedText = block.match(/class="price">[\s\S]*?<strong>([0-9.&;a-z\s]+)Kč<\/strong>/i)?.[1] || '';
    const oldText = block.match(/class="old-price">\s*([0-9.&;a-z\s]+)Kč/i)?.[1] || '';
    const price = askoMoney(displayedText);
    const oldPrice = askoMoney(oldText);
    if (!/^[0-9]{2,}$/.test(id) || title.length < 4 || title.length > 180) continue;
    if (!relativeHref.startsWith('/') || !relativeImage.startsWith('/images/asko_nabytek_cz/')) continue;
    if (!block.includes('<li class="badge yellow">Výprodej</li>')) continue;
    if (price == null || oldPrice == null || cartPrice !== price || price < 10 || price > 100000 || oldPrice <= price || oldPrice > 200000) continue;
    const href = `https://www.asko-nabytek.cz${relativeHref}`;
    const image = `https://www.asko-nabytek.cz${relativeImage}`;
    rows.push({
      external_id: `asko:${id}`, title, normalized_title: normalize(title), price, old_price: oldPrice, quantity_text: null,
      valid_from: today, valid_to: addDays(today, 1), source_url: href, source_page: page, product_id: null, image_url: image, confidence: 0.99,
      metadata: { adapter: ADAPTER, parser_version: ADAPTER, asko_product_id: id, source_page: page, evidence: { official_clearance_badge: true, displayed_price: price, cart_unit_price: cartPrice, price_before_clearance: oldPrice } },
    });
  }
  return rows;
}

async function fetchPage(page: number) {
  const url = page === 1 ? SOURCE : `${SOURCE}?page=${page}`;
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html', 'accept-language': 'cs-CZ,cs;q=0.9' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`ASKO strana ${page} HTTP ${response.status}`);
  return response.text();
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  try {
    const body = await request.json().catch(() => ({}));
    const today = new Date().toISOString().slice(0, 10);
    const firstHtml = await fetchPage(1);
    const pageNumbers = [...firstHtml.matchAll(/\/vyprodej\?page=(\d+)/g)].map((match) => Number(match[1])).filter(Number.isFinite);
    const lastPage = Math.max(1, ...pageNumbers);
    if (lastPage < 2 || lastPage > 150) throw new Error(`ASKO má neočekávaný počet stran: ${lastPage}.`);
    const collected = parseProducts(firstHtml, today, 1);
    for (let start = 2; start <= lastPage; start += 10) {
      const pages = Array.from({ length: Math.min(10, lastPage - start + 1) }, (_, index) => start + index);
      const htmlPages = await Promise.all(pages.map(fetchPage));
      htmlPages.forEach((html, index) => collected.push(...parseProducts(html, today, pages[index])));
    }
    const rows = [...new Map(collected.map((row) => [row.external_id, row])).values()];
    if (rows.length < 100 || rows.length > 1600) throw new Error(`ASKO parser našel ${rows.length} bezpečných produktů; očekáváno 100–1600.`);
    const signature = await sha256(rows.map((row) => `${row.external_id}|${row.title}|${row.price}|${row.old_price}|${row.valid_to}`).join('\n'));
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'asko').single();
    if (storeError || !store) throw storeError || new Error('ASKO nebyl nalezen.');
    const { data: existingSource } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).limit(1).maybeSingle();
    if (existingSource) {
      await db.from('leaflet_sources').update({ source_url: SOURCE, source_type: 'html', is_active: true, auto_publish: false, last_checked_at: new Date().toISOString(), last_error: null, adapter_key: ADAPTER, extraction_strategy: 'structured_html' }).eq('id', existingSource.id);
    } else {
      const { error } = await db.from('leaflet_sources').insert({ store_id: store.id, name: 'ASKO Výprodej', source_url: SOURCE, source_type: 'html', is_active: true, auto_publish: false, adapter_key: ADAPTER, extraction_strategy: 'structured_html' });
      if (error) throw error;
    }
    if (body.dry_run === true) return json({ ok: true, dry_run: true, pages: lastPage, publishable: rows.length, signature, candidates: rows });
    const { data: result, error: publishError } = await db.rpc('publish_structured_store_offers', { p_store_slug: 'asko', p_adapter: ADAPTER, p_signature: signature, p_rows: rows, p_min_products: 100, p_max_products: 1600, p_source_document_url: SOURCE, p_parser_version: ADAPTER });
    if (publishError) throw publishError;
    return json({ ok: true, store: store.name, published: rows.length, signature, result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error), code: 'ASKO_PRODUCTS_SYNC_FAILED' }, 500);
  }
});
