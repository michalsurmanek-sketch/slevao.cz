import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const SOURCE = 'https://www.ikea.com/cz/cs/cat/lower-price/';
const ADAPTER = 'ikea-official-lower-price-v2';
const MIN_PRODUCTS = 15;
const MAX_PRODUCTS = 24;
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
  return value.replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function addDays(iso: string, days: number) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function parseCzechDate(text: string) {
  const months: Record<string, number> = { ledna:1, února:2, brezna:3, března:3, dubna:4, května:5, kvetna:5, června:6, cervna:6, července:7, cervence:7, srpna:8, září:9, zari:9, října:10, rijna:10, listopadu:11, prosince:12 };
  const match = text.match(/Cena platná od\s+(\d{1,2})\.\s*([A-Za-zÁ-ž]+)\s+(\d{4})/i);
  if (!match) return null;
  const month = months[match[2].toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}`;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function parseProducts(html: string, today: string) {
  const sectionStart = html.indexOf('id="product-list"');
  if (sectionStart < 0) throw new Error('IKEA seznam produktů nebyl nalezen.');
  const section = html.slice(sectionStart);
  const blocks = section.split(/<div class="plp-mastercard[^"]*"[^>]*data-ref-id=/i).slice(1);
  const rows: any[] = [];
  for (const block of blocks) {
    const decodedBlock = decode(block);
    if (!/Nová\s*nižší\s*cena/i.test(decodedBlock)) continue;
    if (/Online se prodává v sadách po|IKEA Family|při koupi|kupón|kupon/i.test(decodedBlock)) continue;
    const sku = block.match(/data-product-number="([sS]?\d{8})"/i)?.[1]?.toLowerCase();
    const currentRaw = block.match(/data-price="([0-9.]+)"/i)?.[1];
    const href = block.match(/href="(https:\/\/www\.ikea\.com\/cz\/cs\/p\/[^"]+)"/i)?.[1]?.replace(/&amp;/g, '&');
    const image = block.match(/<img class="plp-image plp-product__image"[^>]*src="([^"]+)"/i)?.[1]?.replace(/&amp;/g, '&');
    const name = decode(block.match(/class="notranslate plp-price-module__product-name">([\s\S]*?)<\/span>/i)?.[1] || '');
    const description = decode(block.match(/class="plp-text plp-typography-label-m plp-typography-regular plp-price-module__description">([\s\S]*?)<\/span>/i)?.[1] || '');
    const oldSection = block.match(/Původní cena[\s\S]{0,1200}?plp-price__integer">([0-9\s]+)/i)?.[1];
    const validFrom = parseCzechDate(decodedBlock);
    const price = Number(currentRaw);
    const oldPrice = oldSection ? Number(oldSection.replace(/\s/g, '')) : null;
    const title = decode(`${name} ${description}`);
    if (!sku || !href || !image || !validFrom || title.length < 5 || !Number.isFinite(price) || price < 10 || price > 100000 || oldPrice == null || oldPrice <= price) continue;
    rows.push({
      external_id: `ikea:${sku}`,
      title, normalized_title: normalize(title), price, old_price: oldPrice, quantity_text: null,
      valid_from: validFrom, valid_to: addDays(today, 1), source_url: href, source_page: 1,
      product_id: null, image_url: image, confidence: 0.99,
      metadata: { adapter: ADAPTER, parser_version: ADAPTER, ikea_product_number: sku, evidence: { official_label: 'Nová nižší cena', current_price: price, previous_price: oldPrice, effective_from: validFrom } },
    });
  }
  const unique = [...new Map(rows.map((row) => [row.external_id, row])).values()];
  if (unique.length < MIN_PRODUCTS || unique.length > MAX_PRODUCTS) throw new Error(`IKEA parser našel ${unique.length} bezpečných produktů; očekáváno ${MIN_PRODUCTS}–${MAX_PRODUCTS}.`);
  return unique;
}

async function markFailure(message: string) {
  const checkedAt = new Date().toISOString();
  const today = checkedAt.slice(0, 10);
  const { data: store } = await db.from('stores').select('id').eq('slug', 'ikea').maybeSingle();
  if (!store?.id) return;
  const { count } = await db.from('offers').select('id', { head: true, count: 'exact' })
    .eq('store_id', store.id).eq('status', 'published').eq('is_verified', true)
    .lte('valid_from', today).gte('valid_to', today);
  const currentCount = Number(count || 0);
  const healthStatus = currentCount > 0 ? 'degraded' : 'error';
  const healthReason = currentCount > 0
    ? `IKEA sync selhal; zachováno ${currentCount} aktuálních ověřených nabídek. ${message}`
    : `IKEA sync selhal bez aktuálních ověřených nabídek. ${message}`;
  await db.from('store_product_sync_state').update({
    last_run_at: checkedAt,
    last_error: message,
    last_parser_error: message,
    is_running: false,
    run_started_at: null,
    parser_version: ADAPTER,
    adapter_name: ADAPTER,
    adapter_version: ADAPTER,
    health_status: healthStatus,
    health_reason: healthReason,
    updated_at: checkedAt,
  }).eq('store_id', store.id);
  await db.from('leaflet_sources').update({ last_checked_at: checkedAt, last_error: message }).eq('store_id', store.id).eq('is_active', true);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  try {
    const body = await request.json().catch(() => ({}));
    const response = await fetch(SOURCE, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html', 'accept-language': 'cs-CZ,cs;q=0.9' }, redirect: 'follow' });
    if (!response.ok) throw new Error(`IKEA HTTP ${response.status}`);
    const html = await response.text();
    const today = new Date().toISOString().slice(0, 10);
    const rows = parseProducts(html, today);
    const signature = await sha256(rows.map((row) => `${row.external_id}|${row.title}|${row.price}|${row.old_price}|${row.valid_to}`).join('\n'));

    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'ikea').single();
    if (storeError || !store) throw storeError || new Error('IKEA nebyla nalezena.');
    const { data: existingSource } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).limit(1).maybeSingle();
    if (existingSource) {
      await db.from('leaflet_sources').update({ source_url: SOURCE, source_type: 'html', is_active: true, auto_publish: false, last_checked_at: new Date().toISOString(), last_error: null, adapter_key: ADAPTER, extraction_strategy: 'structured_html' }).eq('id', existingSource.id);
    } else {
      const { error } = await db.from('leaflet_sources').insert({ store_id: store.id, name: 'IKEA Nová nižší cena', source_url: SOURCE, source_type: 'html', is_active: true, auto_publish: false, adapter_key: ADAPTER, extraction_strategy: 'structured_html' });
      if (error) throw error;
    }

    if (body.dry_run === true) return json({ ok: true, dry_run: true, adapter: ADAPTER, publishable: rows.length, signature, candidates: rows });
    const { data: result, error: publishError } = await db.rpc('publish_structured_store_offers', {
      p_store_slug: 'ikea', p_adapter: ADAPTER, p_signature: signature, p_rows: rows,
      p_min_products: MIN_PRODUCTS, p_max_products: MAX_PRODUCTS, p_source_document_url: SOURCE, p_parser_version: ADAPTER,
    });
    if (publishError) throw publishError;
    return json({ ok: true, store: store.name, adapter: ADAPTER, published: rows.length, signature, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try { await markFailure(message); } catch (_) {}
    return json({ error: message, code: 'IKEA_PRODUCTS_SYNC_FAILED', adapter: ADAPTER }, 500);
  }
});
