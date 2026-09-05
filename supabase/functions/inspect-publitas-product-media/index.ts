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
const ALLOWED_VIEWER_HOSTS = new Set(['letaky.albert.cz', 'letaki.kik.cz']);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
async function allowed(request: Request) {
  const raw = request.headers.get('authorization') || '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE) return true;
  if (CRON && request.headers.get('x-cron-secret') === CRON) return true;
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  const role = String(data.user?.app_metadata?.role || '').toLowerCase();
  return !error && !!data.user && ['admin','editor'].includes(role);
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
function readerData(html: string) {
  const marker = 'var data =';
  const start = html.indexOf(marker);
  const jsonStart = html.indexOf('{', start + marker.length);
  const end = html.indexOf('Reader.Bootstrap.init', jsonStart);
  if (start < 0 || jsonStart < 0 || end < 0) throw new Error('Publitas reader data have unexpected format.');
  const block = html.slice(jsonStart, end);
  const semi = block.lastIndexOf(';');
  return JSON.parse((semi >= 0 ? block.slice(0, semi) : block).trim());
}
function safeViewer(value: unknown) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || !ALLOWED_VIEWER_HOSTS.has(url.hostname)) throw new Error(`Viewer host ${url.hostname || 'unknown'} is not allowed.`);
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/+$/, '');
}
function mediaFromApi(api: any) {
  let hotspotArrays = 0;
  let hotspotCount = 0;
  let productHotspots = 0;
  let productRows = 0;
  let photoRefs = 0;
  const hotspotTypes: Record<string, number> = {};
  const samples: any[] = [];
  let spreadIndex = -1;
  for (const spread of Array.isArray(api?.spreads) ? api.spreads : []) {
    spreadIndex++;
    if (!Array.isArray(spread?.hotspots)) continue;
    hotspotArrays++;
    hotspotCount += spread.hotspots.length;
    for (const hotspot of spread.hotspots) {
      const type = String(hotspot?.type || 'unknown');
      hotspotTypes[type] = (hotspotTypes[type] || 0) + 1;
      const products = Array.isArray(hotspot?.products) ? hotspot.products : [];
      const productLike = /product/i.test(type) || products.length > 0 || hotspot?.photoUrl || Array.isArray(hotspot?.photos);
      if (!productLike) continue;
      productHotspots++;
      productRows += products.length;
      const photos: string[] = [];
      if (typeof hotspot?.photoUrl === 'string') photos.push(hotspot.photoUrl);
      for (const p of Array.isArray(hotspot?.photos) ? hotspot.photos : []) {
        const value = typeof p === 'string' ? p : p?.photoUrl || p?.url || p?.imageUrl;
        if (typeof value === 'string') photos.push(value);
      }
      for (const product of products) {
        if (typeof product?.photoUrl === 'string') photos.push(product.photoUrl);
        for (const p of Array.isArray(product?.photos) ? product.photos : []) {
          const value = typeof p === 'string' ? p : p?.photoUrl || p?.url || p?.imageUrl;
          if (typeof value === 'string') photos.push(value);
        }
      }
      photoRefs += photos.length;
      if (samples.length < 30) samples.push({
        spread_index: spreadIndex,
        type,
        id: hotspot?.id ?? null,
        title: hotspot?.title ?? hotspot?.name ?? null,
        webshop_identifier: hotspot?.webshopIdentifier ?? hotspot?.sku ?? null,
        webshop_url: hotspot?.webshopUrl ?? hotspot?.url ?? null,
        product_count: products.length,
        photo_urls: [...new Set(photos)].slice(0, 5),
        products: products.slice(0, 5).map((product: any) => ({
          id: product?.id ?? null,
          title: product?.title ?? product?.name ?? null,
          webshop_identifier: product?.webshopIdentifier ?? product?.sku ?? null,
          webshop_url: product?.webshopUrl ?? product?.url ?? null,
          photo_url: product?.photoUrl ?? null,
        })),
      });
    }
  }
  return {
    spreads: Array.isArray(api?.spreads) ? api.spreads.length : 0,
    hotspot_arrays: hotspotArrays,
    hotspot_count: hotspotCount,
    hotspot_types: hotspotTypes,
    product_hotspots: productHotspots,
    product_rows: productRows,
    photo_refs: photoRefs,
    safe_product_media_available: productHotspots > 0 && photoRefs > 0,
    samples,
  };
}
async function inspect(viewerInput: unknown) {
  const viewer = safeViewer(viewerInput);
  const html = await fetchText(`${viewer}/`);
  const data = readerData(html);
  const groupSlug = String(data.groupSlug || '');
  const publicationSlug = String(data.slug || '');
  if (!/^[a-z0-9_-]+$/i.test(groupSlug) || !/^[a-z0-9_-]+$/i.test(publicationSlug)) throw new Error('Publitas identity is invalid.');
  const apiUrl = `https://api.publitas.com/v1/groups/${encodeURIComponent(groupSlug)}/publications/${encodeURIComponent(publicationSlug)}.json`;
  const api = JSON.parse(await fetchText(apiUrl));
  return {
    viewer,
    group_slug: groupSlug,
    publication_slug: publicationSlug,
    publication_id: String(data.id || ''),
    ...mediaFromApi(api),
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  try {
    const body = await request.json().catch(() => ({}));
    const raw = Array.isArray(body.viewer_urls) ? body.viewer_urls : body.viewer_url ? [body.viewer_url] : [];
    const viewers = [...new Set(raw.map((value: unknown) => String(value || '').trim()).filter(Boolean))].slice(0, 10);
    if (!viewers.length) return json({ ok:false, error:'Missing viewer_url(s)' }, 400);
    const results = [];
    for (const viewer of viewers) {
      try { results.push({ ok:true, ...(await inspect(viewer)) }); }
      catch (error) { results.push({ ok:false, viewer:String(viewer), error:errorText(error) }); }
    }
    return json({
      ok: results.every((row) => row.ok),
      mode: 'read_only',
      checked: results.length,
      safe_product_media_publications: results.filter((row:any) => row.ok && row.safe_product_media_available).length,
      applied: 0,
      queued_for_review: 0,
      results,
    });
  } catch (error) {
    return json({ ok:false, error:errorText(error), code:'PUBLITAS_MEDIA_INSPECT_FAILED' }, 500);
  }
});
