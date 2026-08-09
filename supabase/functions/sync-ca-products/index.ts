import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const SOURCE = 'https://www.c-and-a.com/eu/cz/shop/slevy';
const ADAPTER = 'ca-official-sale-v1';
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
function money(value: string | undefined) {
  if (!value) return null;
  const parsed = Number(value.replace(/[\s.\u00a0]/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function parseProducts(html: string, today: string) {
  const blocks = html.split(/<li[^>]+data-qa="ProductTile"[^>]*>/i).slice(1);
  const rows: any[] = [];
  for (const block of blocks) {
    const visible = decode(block);
    if (!/Původní cena/i.test(visible)) continue;
    if (/C&A for you|člensk[aá]|s kódem|kup[oó]n|při koupi|od \d+ ks/i.test(visible)) continue;
    const href = block.match(/href="(\/eu\/cz\/shop\/[^"]+)"/i)?.[1];
    const sku = href?.match(/-(\d{7})\/\d+(?:\?|$)/)?.[1];
    const title = decode(block.match(/aria-label="Přidat na seznam přání:\s*([^"]+)"/i)?.[1] || '');
    const image = block.match(/<img[^>]+src="(https:\/\/www\.c-and-a\.com\/img\/product\/[^"]+)"/i)?.[1]?.replace(/&amp;/g, '&');
    const currentRaw = block.match(/data-qa="ProductPrice">\s*([0-9\s.\u00a0]+(?:,[0-9]{1,2})?)\s*Kč/i)?.[1];
    const oldRaw = block.match(/Původní cena[\s\S]{0,300}?([0-9][0-9\s.\u00a0]*(?:,[0-9]{1,2})?)\s*Kč/i)?.[1];
    const discountRaw = block.match(/text-tcasale-700[^>]*>\s*(-\d{1,2})%/i)?.[1];
    const price = money(currentRaw);
    const oldPrice = money(oldRaw);
    const shownDiscount = discountRaw ? Math.abs(Number(discountRaw)) : null;
    const calculatedDiscount = price != null && oldPrice != null ? Math.round((oldPrice - price) / oldPrice * 100) : null;
    if (!href || !sku || !image || title.length < 3 || price == null || oldPrice == null || price < 10 || price > 100000 || oldPrice <= price || shownDiscount == null || calculatedDiscount == null || Math.abs(shownDiscount - calculatedDiscount) > 1) continue;
    rows.push({
      external_id: `ca:${sku}`, title, normalized_title: normalize(title), price, old_price: oldPrice, quantity_text: null,
      valid_from: today, valid_to: addDays(today, 1), source_url: `https://www.c-and-a.com${href}`, source_page: 1,
      product_id: null, image_url: image, confidence: 0.99,
      metadata: { adapter: ADAPTER, parser_version: ADAPTER, ca_product_number: sku, evidence: { official_label: 'Původní cena', current_price: price, previous_price: oldPrice, displayed_discount_percent: shownDiscount, calculated_discount_percent: calculatedDiscount } },
    });
  }
  const unique = [...new Map(rows.map((row) => [row.external_id, row])).values()];
  if (unique.length < 20 || unique.length > 80) throw new Error(`C&A parser našel ${unique.length} bezpečných produktů; očekáváno 20–80.`);
  return unique;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  try {
    const body = await request.json().catch(() => ({}));
    const response = await fetch(SOURCE, { headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html', 'accept-language': 'cs-CZ,cs;q=0.9' }, redirect: 'follow' });
    if (!response.ok) throw new Error(`C&A HTTP ${response.status}`);
    const html = await response.text();
    const today = new Date().toISOString().slice(0, 10);
    const rows = parseProducts(html, today);
    const signature = await sha256(rows.map((row) => `${row.external_id}|${row.title}|${row.price}|${row.old_price}|${row.valid_to}`).join('\n'));

    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'ca').single();
    if (storeError || !store) throw storeError || new Error('C&A nebyla nalezena.');
    const { data: existingSource } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).limit(1).maybeSingle();
    if (existingSource) {
      await db.from('leaflet_sources').update({ source_url: SOURCE, source_type: 'html', is_active: true, auto_publish: false, last_checked_at: new Date().toISOString(), last_error: null, adapter_key: ADAPTER, extraction_strategy: 'structured_html' }).eq('id', existingSource.id);
    } else {
      const { error } = await db.from('leaflet_sources').insert({ store_id: store.id, name: 'C&A Slevy', source_url: SOURCE, source_type: 'html', is_active: true, auto_publish: false, adapter_key: ADAPTER, extraction_strategy: 'structured_html' });
      if (error) throw error;
    }

    if (body.dry_run === true) return json({ ok: true, dry_run: true, publishable: rows.length, signature, candidates: rows });
    const { data: result, error: publishError } = await db.rpc('publish_structured_store_offers', {
      p_store_slug: 'ca', p_adapter: ADAPTER, p_signature: signature, p_rows: rows,
      p_min_products: 20, p_max_products: 80, p_source_document_url: SOURCE, p_parser_version: ADAPTER,
    });
    if (publishError) throw publishError;
    return json({ ok: true, store: store.name, published: rows.length, signature, result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error), code: 'CA_PRODUCTS_SYNC_FAILED' }, 500);
  }
});
