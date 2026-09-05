import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

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

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
async function allowed(request: Request) {
  const raw = request.headers.get('authorization') || '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE) return true;
  if (CRON && request.headers.get('x-cron-secret') === CRON) return true;
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  return !error && !!data.user && ['admin', 'editor'].includes(String(data.user.app_metadata?.role || '').toLowerCase());
}
async function fetchText(url: string, timeout = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow', signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return text;
  } finally { clearTimeout(timer); }
}
function dataFromHtml(html: string) {
  const marker = 'var data =';
  const start = html.indexOf(marker);
  const jsonStart = html.indexOf('{', start + marker.length);
  const end = html.indexOf('Reader.Bootstrap.init', jsonStart);
  if (start < 0 || jsonStart < 0 || end < 0) throw new Error('Publitas data mají neočekávaný formát.');
  const block = html.slice(jsonStart, end);
  const semi = block.lastIndexOf(';');
  return JSON.parse((semi >= 0 ? block.slice(0, semi) : block).trim());
}
function inspectApi(api: any) {
  let hotspotArrays = 0, hotspotCount = 0, productHotspots = 0, productPhotos = 0;
  const hotspotTypes: Record<string, number> = {};
  for (const spread of Array.isArray(api?.spreads) ? api.spreads : []) {
    if (!Array.isArray(spread?.hotspots)) continue;
    hotspotArrays++;
    hotspotCount += spread.hotspots.length;
    for (const hotspot of spread.hotspots) {
      const type = String(hotspot?.type || 'unknown');
      hotspotTypes[type] = (hotspotTypes[type] || 0) + 1;
      if (/product/i.test(type)) productHotspots++;
      if (hotspot?.photoUrl) productPhotos++;
      if (Array.isArray(hotspot?.photos)) productPhotos += hotspot.photos.length;
      if (Array.isArray(hotspot?.products)) {
        productHotspots += hotspot.products.length;
        for (const product of hotspot.products) {
          if (product?.photoUrl) productPhotos++;
          if (Array.isArray(product?.photos)) productPhotos += product.photos.length;
        }
      }
    }
  }
  return { hotspot_arrays: hotspotArrays, hotspot_count: hotspotCount, hotspot_types: hotspotTypes, product_hotspots: productHotspots, product_photos: productPhotos };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  try {
    const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'kik').single();
    if (storeError || !store) throw storeError || new Error('KiK store missing');
    const { data: document, error: documentError } = await db.from('leaflet_imports')
      .select('id,metadata').eq('store_id', store.id).eq('status', 'published')
      .contains('metadata', { adapter: 'kik-publitas-v2' }).order('updated_at', { ascending: false }).limit(1).single();
    if (documentError || !document) throw documentError || new Error('KiK Publitas document missing');

    const viewer = String(document.metadata?.viewer_url || '').replace(/\/+$/, '');
    if (!/^https:\/\/letaki\.kik\.cz\/kik-[a-z0-9_-]+$/i.test(viewer)) throw new Error('Unsafe KiK viewer URL');
    const html = await fetchText(`${viewer}/`);
    const readerData = dataFromHtml(html);
    const groupSlug = String(readerData.groupSlug || '');
    const publicationSlug = String(readerData.slug || '');
    if (!/^[a-z0-9_-]+$/i.test(groupSlug) || !/^[a-z0-9_-]+$/i.test(publicationSlug)) throw new Error('Invalid Publitas identity');
    const apiUrl = `https://api.publitas.com/v1/groups/${encodeURIComponent(groupSlug)}/publications/${encodeURIComponent(publicationSlug)}.json`;
    const api = JSON.parse(await fetchText(apiUrl));
    const inspection = inspectApi(api);

    return json({
      ok: true,
      mode: 'read_only_inspection',
      store: 'KiK',
      publication_id: String(readerData.id || ''),
      expected_publication_id: String(document.metadata?.publication_id || ''),
      group_slug: groupSlug,
      publication_slug: publicationSlug,
      spreads: Array.isArray(api?.spreads) ? api.spreads.length : 0,
      ...inspection,
      safe_image_source_available: inspection.product_hotspots > 0 && inspection.product_photos > 0,
      applied: 0,
      queued_for_review: 0,
    });
  } catch (error) {
    return json({ ok: false, error: errorText(error), code: 'KIK_IMAGE_INSPECT_FAILED' }, 500);
  }
});
