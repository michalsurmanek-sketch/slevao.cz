const CRON = Deno.env.get('CRON_SECRET') || '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36';
const LIDL_PREFIX = 'https://www.lidl.cz/s/cs-CZ/vyhledavac-prodejen/';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function allowed(request: Request) {
  const raw = request.headers.get('authorization') || '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (token && token === SERVICE) return true;
  return !!CRON && request.headers.get('x-cron-secret') === CRON;
}

function contexts(html: string) {
  const markers = [
    'latitude', 'longitude', 'data-lat', 'data-lng', 'coordinates',
    'geolocation', 'geoPoint', 'storeId', 'storeCode', 'storeNumber',
    'openingHours', 'postalCode', 'addressLocality', 'streetAddress',
    'application/ld+json', '__NEXT_DATA__', '__NUXT__', 'googleMaps',
  ];
  const lower = html.toLowerCase();
  const rows: Array<{ marker: string; count: number; samples: string[] }> = [];
  for (const marker of markers) {
    const needle = marker.toLowerCase();
    const samples: string[] = [];
    let count = 0;
    let from = 0;
    while (true) {
      const pos = lower.indexOf(needle, from);
      if (pos < 0) break;
      count += 1;
      if (samples.length < 4) samples.push(html.slice(Math.max(0, pos - 300), Math.min(html.length, pos + 700)).replace(/\s+/g, ' '));
      from = pos + needle.length;
    }
    if (count) rows.push({ marker, count, samples });
  }
  return rows;
}

function likelyCoordinates(html: string) {
  const values: Array<{ latitude: number; longitude: number; context: string }> = [];
  const seen = new Set<string>();
  const re = /(4[89]|50|51)(?:\.\d{3,})[^0-9-]{0,30}(1[2-9])(?:\.\d{3,})/g;
  for (const match of html.matchAll(re)) {
    const latitude = Number(match[1] + match[0].slice(String(match[1]).length).match(/^\.\d+/)?.[0]);
    const tail = match[0].slice(match[0].lastIndexOf(String(match[2])));
    const longitude = Number(String(match[2]) + (tail.match(/^\d+(\.\d+)/)?.[1] || ''));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const key = `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pos = match.index || 0;
    values.push({ latitude, longitude, context: html.slice(Math.max(0, pos - 180), Math.min(html.length, pos + 380)).replace(/\s+/g, ' ') });
    if (values.length >= 20) break;
  }
  return values;
}

function scriptUrls(html: string, base: string) {
  const urls = new Set<string>();
  for (const match of html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)) {
    try { urls.add(new URL(match[1], base).toString()); } catch { /* ignore */ }
  }
  return [...urls].slice(0, 80);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(request)) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    if (body.dry_run !== true || body.mode !== 'diagnose') return json({ error: 'Diagnostic function requires dry_run=true and mode=diagnose.' }, 409);
    const rawUrl = String(body.url || '');
    if (!rawUrl.startsWith(LIDL_PREFIX)) return json({ error: 'Only official Lidl Czech store-locator URLs are allowed.' }, 400);
    const url = new URL(rawUrl);
    if (url.hostname !== 'www.lidl.cz' || url.protocol !== 'https:') return json({ error: 'Invalid Lidl host.' }, 400);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(url.toString(), {
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
          'cache-control': 'no-cache',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      const html = await response.text();
      if (!response.ok) return json({ error: `Lidl HTTP ${response.status}`, final_url: response.url }, 502);
      return json({
        ok: true,
        dry_run: true,
        mode: 'diagnose',
        requested_url: url.toString(),
        final_url: response.url,
        status: response.status,
        bytes: html.length,
        title: html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || null,
        markers: contexts(html),
        coordinate_candidates: likelyCoordinates(html),
        script_urls: scriptUrls(html, response.url),
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error), code: 'LIDL_DIAGNOSTIC_FAILED' }, 500);
  }
});
