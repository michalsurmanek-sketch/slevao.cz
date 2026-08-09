import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const SOURCE = 'https://izabka.cz/';
const ADAPTER = 'zabka-official-homepage-html-v1';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'content-type': 'application/json; charset=utf-8',
};

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: HEADERS }); }
async function allowed(request: Request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE || (CRON && request.headers.get('x-cron-secret') === CRON)) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}
function decodeHtml(value: string) {
  return value.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) =>
    String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10)))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"');
}
function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function addDays(iso: string, days: number) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function quantity(title: string) {
  return title.match(/\b\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|ks)\b/iu)?.[0]?.replace(/\s+/g, ' ') || null;
}
async function parseProducts(html: string, today: string) {
  const section = html.match(/<section class="section-container section-container--white section-container--sale-items">([\s\S]*?)<\/section>/)?.[1] || '';
  if (!section.includes('<h2>Žabka nabídka</h2>')) throw new Error('Oficiální sekce Žabka nabídka nebyla nalezena.');
  const blocks = section.split(/<div class="sale-item(?:\\s[^"]*)?">/).slice(1);
  const rows: any[] = [];
  for (const block of blocks) {
    const image = decodeHtml(block.match(/<div class="sale-item-image"><img[^>]+src="([^"]+)"/)?.[1] || '');
    const title = decodeHtml(block.match(/<\/div>\s*<span>([^<]+)<\/span>/)?.[1] || '').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
    const crowns = Number(block.match(/sale-item__tag--main-price"[^>]*>(\d{1,4})<\/span>/)?.[1] || '');
    const cents = Number(block.match(/sale-item__tag--main-subprice">(\d{2})<\/span>/)?.[1] || '');
    if (title.length < 4 || title.length > 160 || !Number.isInteger(crowns) || !Number.isInteger(cents)) continue;
    if (!image.startsWith('https://izabka.cz/wp-content/uploads/')) continue;
    if (/\b(?:klub|aplikac|kup[oó]n|při koupi|od \d+ ks|jen pro členy)\b/iu.test(title + ' ' + block)) continue;
    const price = crowns + cents / 100;
    if (price < 1 || price > 5000) continue;
    const identity = await sha256(`${normalize(title)}|${image}`);
    rows.push({
      external_id: `zabka:homepage:${identity.slice(0, 40)}`,
      title,
      normalized_title: normalize(title),
      price,
      old_price: null,
      quantity_text: quantity(title),
      valid_from: today,
      valid_to: addDays(today, 1),
      source_url: SOURCE,
      source_page: 1,
      product_id: null,
      image_url: image,
      confidence: 0.99,
      metadata: {
        adapter: ADAPTER,
        parser_version: ADAPTER,
        evidence: { official_live_offer_section: true, displayed_price: price, conditional_price_rejected: true },
      },
    });
  }
  const unique = [...new Map(rows.map((row) => [row.external_id, row])).values()];
  if (unique.length < 3 || unique.length > 12) throw new Error(`Žabka parser našel ${unique.length} bezpečných produktů; očekáváno 3–12.`);
  return unique;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  try {
    const body = await request.json().catch(() => ({}));
    const response = await fetch(SOURCE, {
      headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html', 'accept-language': 'cs-CZ,cs;q=0.9' },
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`Žabka HTTP ${response.status}`);
    const today = new Date().toISOString().slice(0, 10);
    const rows = await parseProducts(await response.text(), today);
    const signature = await sha256(rows.map((row) => `${row.external_id}|${row.price}|${row.valid_to}`).join('\n'));
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'zabka').single();
    if (storeError || !store) throw storeError || new Error('Žabka nebyla nalezena.');
    const { data: source } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).eq('source_url', SOURCE).maybeSingle();
    if (source) {
      await db.from('leaflet_sources').update({ source_type: 'html', is_active: true, auto_publish: false, last_checked_at: new Date().toISOString(), last_error: null, adapter_key: ADAPTER, extraction_strategy: 'structured_html' }).eq('id', source.id);
    } else {
      const { error } = await db.from('leaflet_sources').insert({ store_id: store.id, name: 'Žabka nabídka', source_url: SOURCE, source_type: 'html', is_active: true, auto_publish: false, adapter_key: ADAPTER, extraction_strategy: 'structured_html' });
      if (error) throw error;
    }
    if (body.dry_run === true) return json({ ok: true, dry_run: true, publishable: rows.length, signature, candidates: rows });
    const { data: result, error } = await db.rpc('publish_structured_store_offers', {
      p_store_slug: 'zabka', p_adapter: ADAPTER, p_signature: signature, p_rows: rows,
      p_min_products: 3, p_max_products: 12, p_source_document_url: SOURCE, p_parser_version: ADAPTER,
    });
    if (error) throw error;
    return json({ ok: true, store: store.name, published: rows.length, signature, result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error), code: 'ZABKA_PRODUCTS_SYNC_FAILED' }, 500);
  }
});
