const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CRON = Deno.env.get('CRON_SECRET') || '';
const LOCATOR_URL = 'https://www.norma-online.de/cz/filialfinder/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function allowed(request: Request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (token && token === SERVICE) return true;
  return !!CRON && request.headers.get('x-cron-secret') === CRON;
}

function snippets(html: string, needle: string, max = 3) {
  const lower = html.toLowerCase();
  const search = needle.toLowerCase();
  const out: string[] = [];
  let pos = 0;
  while (out.length < max) {
    const found = lower.indexOf(search, pos);
    if (found < 0) break;
    out.push(html.slice(Math.max(0, found - 450), Math.min(html.length, found + 1000)).replace(/\s+/g, ' '));
    pos = found + search.length;
  }
  return out;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(request)) return json({ error: 'Unauthorized' }, 401);

  try {
    const input = await request.json().catch(() => ({}));
    if (input.dry_run !== true || input.mode !== 'diagnose') {
      return json({ error: 'NORMA diagnostic requires dry_run=true and mode=diagnose.' }, 409);
    }

    const params = new URLSearchParams();
    params.set('filialfinder[suche][land]', 'Tschechien');
    params.set('filialfinder[suche][radius]', String(input.radius || '500000'));
    params.set('filialfinder[suche][plz]', String(input.postal_code || ''));
    params.set('filialfinder[suche][stadt]', String(input.city || 'Praha'));
    params.set('filialfinder[suche][strasse]', String(input.street || ''));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(LOCATOR_URL, {
        method: 'POST',
        headers: {
          'user-agent': UA,
          accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
          'content-type': 'application/x-www-form-urlencoded',
          'cache-control': 'no-cache',
        },
        body: params.toString(),
        redirect: 'follow',
        signal: controller.signal,
      });
      const html = await response.text();
      const lower = html.toLowerCase();
      const markerNames = ['latitude', 'longitude', 'data-lat', 'data-lng', 'maps.google', 'maps.app', 'openstreetmap', 'leaflet', 'filiale', 'entfernung'];
      const markers = Object.fromEntries(markerNames.map((name) => [name, lower.split(name.toLowerCase()).length - 1]));
      const coordinateMatches = [...html.matchAll(/(?:48|49|50|51)[.,][0-9]{3,}[^0-9-]{0,80}(?:12|13|14|15|16|17|18|19)[.,][0-9]{3,}/g)].slice(0, 20).map((m) => m[0]);
      return json({
        ok: response.ok,
        dry_run: true,
        mode: 'diagnose',
        status: response.status,
        final_url: response.url,
        bytes: html.length,
        markers,
        coordinate_matches: coordinateMatches,
        samples: {
          latitude: snippets(html, 'latitude'),
          longitude: snippets(html, 'longitude'),
          maps: snippets(html, 'maps'),
          result: snippets(html, 'entfernung'),
          praha: snippets(html, 'Praha'),
        },
      }, response.ok ? 200 : 502);
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error), code: 'NORMA_DIAGNOSTIC_FAILED' }, 500);
  }
});
