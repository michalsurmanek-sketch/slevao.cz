import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const SOURCE = 'https://www.planeo.cz/vyprodej-akce';
const ADAPTER = 'planeo-official-clearance-v1';
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
function decode(value: string) {
  return value.replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function iso(year: number, month: number, day: number) { return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; }
function parseDates(text: string) {
  const match = text.match(/Akce platí od\s+(\d{1,2})\.\s*(\d{1,2})\.\s*do\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/i);
  if (!match) throw new Error('Platnost výprodeje nebyla nalezena.');
  return { from: iso(Number(match[5]), Number(match[2]), Number(match[1])), to: iso(Number(match[5]), Number(match[4]), Number(match[3])) };
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function parseProducts(html: string, dates: { from: string; to: string }) {
  const start = html.indexOf('id="product-filter-top"');
  if (start < 0) throw new Error('Sekce produktů nebyla nalezena.');
  const section = html.slice(start);
  const blocks = section.split(/<div\s+[^>]*class="c-product c-product--(?:top|catalogue)"/i).slice(1);
  const rows: any[] = [];
  for (const block of blocks) {
    const sku = block.match(/data-gtm-product-id="(\d+)"/i)?.[1];
    const titleRaw = block.match(/data-gtm-product-name='([^']+)'/i)?.[1];
    const href = block.match(/<a href="([^"]+)" class="c-product--top__items-wrapper"/i)?.[1]
      || block.match(/<a href="([^"]+)">\s*<div data-testid="catalogue\.item\.image"/i)?.[1];
    const image = block.match(/<img src="([^"]+)"[^>]*alt="[^"]*"/i)?.[1]?.replace(/&amp;/g, '&');
    const current = block.match(/data-testid="(?:category\.bestsellers|catalogue)\.item\.price"\s+data-test-value="(\d+)"/i)?.[1];
    const oldRaw = block.match(/class="c-price-tag__price-strip">([\s\S]*?)<\/span>/i)?.[1];
    const sale = /class="c-price-tag__title">\s*VÝPRODEJ\s*</i.test(block);
    if (!sku || !titleRaw || !href || !current || !sale) continue;
    const title = decode(titleRaw);
    const price = Number(current);
    const oldPrice = oldRaw ? Number(decode(oldRaw).replace(/[^0-9]/g, '')) : null;
    if (title.length < 5 || price < 100 || price > 100000 || (oldPrice != null && oldPrice <= price)) continue;
    rows.push({
      external_id: `planeo:${sku}:${dates.from}:${dates.to}`,
      title,
      normalized_title: normalize(title),
      price,
      old_price: oldPrice,
      quantity_text: null,
      valid_from: dates.from,
      valid_to: dates.to,
      source_url: new URL(href, SOURCE).toString(),
      source_page: 1,
      product_id: null,
      image_url: image || null,
      confidence: 0.99,
      metadata: { adapter: ADAPTER, parser_version: ADAPTER, planeo_product_id: sku, evidence: { official_badge: 'VÝPRODEJ', current_price: price, old_price: oldPrice } },
    });
  }
  const unique = [...new Map(rows.map((row) => [row.external_id, row])).values()];
  if (unique.length !== 25) throw new Error(`PLANEO parser našel ${unique.length} bezpečných produktů; očekáváno přesně 25.`);
  return unique;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  try {
    const body = await request.json().catch(() => ({}));
    const response = await fetch(SOURCE, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html', 'accept-language': 'cs-CZ,cs;q=0.9' }, redirect: 'follow' });
    if (!response.ok) throw new Error(`PLANEO HTTP ${response.status}`);
    const html = await response.text();
    const dates = parseDates(decode(html));
    const today = new Date().toISOString().slice(0, 10);
    if (today < dates.from || today > dates.to) throw new Error(`PLANEO akce není aktuální: ${dates.from} až ${dates.to}.`);
    const rows = parseProducts(html, dates);
    const signature = await sha256(rows.map((row) => `${row.external_id}|${row.title}|${row.price}|${row.old_price}`).join('\n'));

    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'planeo').single();
    if (storeError || !store) throw storeError || new Error('PLANEO nebylo nalezeno.');
    const { data: existingSource } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).limit(1).maybeSingle();
    if (existingSource) {
      await db.from('leaflet_sources').update({ source_url: SOURCE, source_type: 'html', is_active: true, auto_publish: false, last_checked_at: new Date().toISOString(), last_error: null, adapter_key: ADAPTER, extraction_strategy: 'structured_html' }).eq('id', existingSource.id);
    } else {
      const { error } = await db.from('leaflet_sources').insert({ store_id: store.id, name: 'PLANEO oficiální výprodej', source_url: SOURCE, source_type: 'html', is_active: true, auto_publish: false, adapter_key: ADAPTER, extraction_strategy: 'structured_html' });
      if (error) throw error;
    }

    if (body.dry_run === true) return json({ ok: true, dry_run: true, dates, publishable: rows.length, signature, candidates: rows });
    const { data: result, error: publishError } = await db.rpc('publish_structured_store_offers', {
      p_store_slug: 'planeo', p_adapter: ADAPTER, p_signature: signature, p_rows: rows,
      p_min_products: 25, p_max_products: 25, p_source_document_url: SOURCE, p_parser_version: ADAPTER,
    });
    if (publishError) throw publishError;
    return json({ ok: true, store: store.name, published: rows.length, signature, result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error), code: 'PLANEO_PRODUCTS_SYNC_FAILED' }, 500);
  }
});
