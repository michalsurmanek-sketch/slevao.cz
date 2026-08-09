import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const LANDING = 'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret', 'content-type': 'application/json; charset=utf-8' };
const HEADERS = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36', accept: 'text/html,application/xhtml+xml,image/avif,image/webp,image/jpeg,*/*;q=0.8', 'accept-language': 'cs-CZ,cs;q=0.9' };

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: CORS }); }
function clean(value: unknown) { return String(value || '').replace(/\\u002F/gi, '/').replace(/\\\//g, '/').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(); }
async function allowed(request: Request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE || (CRON && request.headers.get('x-cron-secret') === CRON)) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function iso(day: string, month: string, year: string) { return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`; }
function validity(html: string) {
  const text = clean(html.replace(/<[^>]+>/g, ' '));
  const match = text.match(/Tesco Hypermarket\s+(\d{1,2})\.(\d{1,2})\.\s*-\s*(\d{1,2})\.(\d{1,2})\.(20\d{2})/i);
  if (!match) throw new Error('Tesco nevrátilo platnost hypermarketového letáku.');
  return { validFrom: iso(match[1], match[2], match[5]), validTo: iso(match[3], match[4], match[5]) };
}
function hypermarketCover(html: string) {
  const urls = [...html.matchAll(/https?(?:%3A|:)\S{0,700}?_CZ_HM-CHM\.1\.jpeg/gi)].map((m) => clean(decodeURIComponent(m[0].replace(/["'<>\\]+$/g, ''))));
  const direct = urls.find((url) => /^https:\/\/digitalcontent\.api\.tesco\.com\//i.test(url));
  if (direct) return direct;
  const attr = [...html.matchAll(/(?:href|src|data-src|data-url)=["']([^"']+)["']/gi)]
    .map((m) => clean(m[1]))
    .map((url) => { try { const parsed = new URL(url, LANDING); return decodeURIComponent(parsed.searchParams.get('url') || url); } catch { return ''; } })
    .find((url) => /_CZ_HM-CHM\.1\.jpeg$/i.test(url));
  if (!attr) throw new Error('Tesco nevrátilo titulní stranu hypermarketového letáku.');
  return attr;
}
function proxyUrl(imageUrl: string) {
  return `https://www.itesco.cz/customer-leaflets-fe-assets/_next/image?url=${encodeURIComponent(imageUrl)}&w=1600&q=100`;
}
async function pageUrls(cover: string) {
  const pages: string[] = [];
  let misses = 0;
  for (let page = 1; page <= 80 && misses < 3; page++) {
    const image = cover.replace(/\.1\.jpeg$/i, `.${page}.jpeg`);
    const url = proxyUrl(image);
    try {
      const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(12_000) });
      const type = String(response.headers.get('content-type') || '').toLowerCase();
      const length = Number(response.headers.get('content-length') || 0);
      await response.body?.cancel();
      if (response.ok && type.startsWith('image/') && (length === 0 || length > 10_000)) { pages.push(url); misses = 0; }
      else misses++;
    } catch { misses++; }
  }
  if (pages.length < 8) throw new Error(`Tesco proxy zpřístupnila jen ${pages.length} stran.`);
  return pages;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  const checkedAt = new Date().toISOString();
  try {
    const body = await request.json().catch(() => ({}));
    const response = await fetch(`${LANDING}?_slevao=${Date.now()}`, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
    const html = await response.text();
    if (!response.ok) throw new Error(`Tesco landing HTTP ${response.status}`);
    const dates = validity(html);
    const cover = hypermarketCover(html);
    const pages = await pageUrls(cover);
    const signature = await sha256(`${cover}|${dates.validFrom}|${dates.validTo}|${pages.length}`);
    if (body.dry_run === true) return json({ ok: true, dry_run: true, cover, page_count: pages.length, page_image_urls: pages, ...dates, signature });
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'tesco').single();
    if (storeError || !store) throw storeError || new Error('Tesco nebylo nalezeno.');
    const { data: source, error: sourceError } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).eq('is_active', true).limit(1).single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj Tesco nebyl nalezen.');
    const sourceHash = await sha256(`${source.id}|${signature}|tesco-proxy-pages-v1`);
    const metadata = { adapter: 'tesco-proxy-pages-v1', title: `Tesco Hypermarket ${dates.validFrom} – ${dates.validTo}`, viewer_url: LANDING, cover_image_url: pages[0], page_image_urls: pages, page_count: pages.length, ocr_required: true, ocr_source: 'official_tesco_next_image_proxy', last_seen_at: checkedAt };
    const { data: existing } = await db.from('leaflet_imports').select('id').eq('source_hash', sourceHash).maybeSingle();
    let importId = existing?.id || '';
    const values = { source_id: source.id, store_id: store.id, source_document_url: LANDING, source_hash: sourceHash, status: 'published', product_count: 0, confidence: 0.99, coverage_scope: 'national', detected_valid_from: dates.validFrom, detected_valid_to: dates.validTo, finished_at: checkedAt, error_message: null, metadata, updated_at: checkedAt };
    if (existing) {
      const { error } = await db.from('leaflet_imports').update(values).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { data: inserted, error } = await db.from('leaflet_imports').insert(values).select('id').single();
      if (error || !inserted) throw error || new Error('Tesco import se nepodařilo uložit.');
      importId = inserted.id;
    }
    await db.from('leaflet_sources').update({ last_checked_at: checkedAt, last_success_at: checkedAt, last_error: null, last_strategy_used: 'official_tesco_next_image_proxy', last_strategy_success_at: checkedAt }).eq('id', source.id);
    return json({ ok: true, import_id: importId, page_count: pages.length, ...dates, signature });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message, code: 'TESCO_SOURCE_SYNC_FAILED' }, 500);
  }
});
