import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const ADAPTER = 'action-official-html-v1';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret', 'content-type': 'application/json; charset=utf-8' };

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: CORS }); }
async function allowed(request: Request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE || (CRON && request.headers.get('x-cron-secret') === CRON)) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}
function clean(value: unknown) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function productNumber(url: string) { return url.match(/\/p\/(\d{5,12})\//)?.[1] || null; }
function parsePrice(raw: string) {
  const match = raw.match(/(?:^|\s)(\d{1,5})\s+(\d{2})\s*Týdenní akce\s*$/i);
  if (!match) return null;
  const value = Number(`${match[1]}.${match[2]}`);
  return Number.isFinite(value) && value >= 2 && value <= 10000 ? value : null;
}
function titleAndQuantity(raw: string) {
  let body = raw.replace(/\s+\d{1,5}\s+\d{2}\s*Týdenní akce\s*$/i, '').trim();
  body = body.replace(/\s+\d{1,6}(?:[,.]\d{1,2})?\s*Kč\s*\/\s*(?:ks|kg|l|m|m2|m²)\s*$/i, '').trim();
  const quantity = body.match(/\b(?:\d+[×x]\s*)?\d+(?:[,.]\d+)?\s*(?:ml|cl|l|g|kg|ks|kusů|párů|balení)\b/i)?.[0] || null;
  const spec = body.search(/(?:\s+\d+(?:[,.]\d+)?\s*(?:ml|cl|l|g|kg)\b|\s+\d+\s*[×x]\s*\d+|\s+Velikosti\b|\s+Různé\b|\s+Ø\s*\d+)/i);
  const title = clean(spec > 3 ? body.slice(0, spec) : body);
  return { title, quantity };
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  try {
    const body = await request.json().catch(() => ({}));
    const today = new Date().toISOString().slice(0, 10);
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'action').single();
    if (storeError || !store) throw storeError || new Error('Action nebyl nalezen.');
    const { data: imported, error: importError } = await db.from('leaflet_imports')
      .select('id,detected_valid_from,detected_valid_to,source_document_url')
      .eq('store_id', store.id).lte('detected_valid_from', today).gte('detected_valid_to', today)
      .eq('metadata->>adapter', 'action-html-v2').order('created_at', { ascending: false }).limit(1).single();
    if (importError || !imported) throw importError || new Error('Aktuální Action import nebyl nalezen.');
    const { data: items, error: itemError } = await db.from('leaflet_import_items').select('raw_data').eq('import_id', imported.id);
    if (itemError) throw itemError;
    const rows: any[] = [];
    for (const item of items || []) {
      const raw = clean(item.raw_data?.raw_text);
      const sourceUrl = clean(item.raw_data?.source_url);
      const sku = productNumber(sourceUrl);
      const price = parsePrice(raw);
      const parsed = titleAndQuantity(raw);
      if (!sku || !price || parsed.title.length < 4 || parsed.title.length > 100) continue;
      if (!sourceUrl.startsWith('https://www.action.com/cs-cz/p/') || /clubcard|věrnost|při koupi|kupón|od \d/i.test(raw)) continue;
      rows.push({
        external_id: `action:${sku}:${imported.detected_valid_from}:${imported.detected_valid_to}`,
        title: parsed.title, normalized_title: normalize(parsed.title), price, old_price: null, quantity_text: parsed.quantity,
        valid_from: imported.detected_valid_from, valid_to: imported.detected_valid_to, source_url: sourceUrl, source_page: 1,
        product_id: null, image_url: null, confidence: 0.99,
        metadata: { adapter: ADAPTER, parser_version: ADAPTER, action_product_number: sku, evidence: { raw_text: raw } },
      });
    }
    const unique = [...new Map(rows.map((row) => [row.external_id, row])).values()].sort((a, b) => a.title.localeCompare(b.title, 'cs'));
    if (unique.length < 20 || unique.length > 40) throw new Error(`Action má ${unique.length} bezpečných produktů; očekáváno 20–40.`);
    const signature = await sha256(unique.map((row) => `${row.external_id}|${row.title}|${row.price}|${row.quantity_text || ''}`).join('\n'));
    if (body.dry_run === true) return json({ ok: true, dry_run: true, import_id: imported.id, publishable: unique.length, signature, candidates: unique });
    const { data: result, error: publishError } = await db.rpc('publish_structured_store_offers', {
      p_store_slug: 'action', p_adapter: ADAPTER, p_signature: signature, p_rows: unique, p_min_products: 20, p_max_products: 40,
      p_source_document_url: imported.source_document_url, p_parser_version: ADAPTER,
    });
    if (publishError) throw publishError;
    return json({ ok: true, store: store.name, published: unique.length, signature, result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error), code: 'ACTION_PRODUCTS_SYNC_FAILED' }, 500);
  }
});
