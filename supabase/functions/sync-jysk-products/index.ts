import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36';
const PAGE_URL = 'https://jysk.cz/akce';
const PRODUCT_JSON_URL = 'https://jysk.cz/products/json/main_cz/';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

async function allowed(request: Request) {
  const raw = request.headers.get('authorization') || '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE) return true;
  if (CRON && request.headers.get('x-cron-secret') === CRON) return true;
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  return !error && !!data.user && ['admin', 'editor'].includes(String(data.user.app_metadata?.role || '').toLowerCase());
}

function cookiesFrom(response: Response) {
  const raw = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') || ''];
  return raw.filter(Boolean).map((value) => value.split(';', 1)[0]).filter(Boolean).join('; ');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    if (body.dry_run !== true) return json({ error: 'JYSK produktová publikace zatím není povolena; použij dry_run.' }, 409);

    const landing = await fetch(PAGE_URL, {
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
        'cache-control': 'no-cache',
      },
      redirect: 'follow',
    });
    const landingText = await landing.text();
    if (!landing.ok) throw new Error(`JYSK vstupní stránka HTTP ${landing.status}`);
    const cookie = cookiesFrom(landing);

    const productResponse = await fetch(PRODUCT_JSON_URL, {
      headers: {
        'user-agent': UA,
        accept: 'application/json,text/plain,*/*',
        'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
        referer: PAGE_URL,
        origin: 'https://jysk.cz',
        'x-requested-with': 'XMLHttpRequest',
        ...(cookie ? { cookie } : {}),
      },
      redirect: 'follow',
    });
    const text = await productResponse.text();
    let parsed: any = null;
    try { parsed = JSON.parse(text); } catch { /* diagnostic response below */ }

    const rootType = Array.isArray(parsed) ? 'array' : parsed && typeof parsed === 'object' ? 'object' : typeof parsed;
    const rootKeys = parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 80) : [];
    const rootLength = Array.isArray(parsed) ? parsed.length : null;
    const first = Array.isArray(parsed) ? parsed[0] : null;

    return json({
      ok: productResponse.ok,
      dry_run: true,
      landing_status: landing.status,
      landing_bytes: landingText.length,
      cookie_names: cookie.split('; ').filter(Boolean).map((x) => x.split('=', 1)[0]),
      product_status: productResponse.status,
      content_type: productResponse.headers.get('content-type'),
      bytes: text.length,
      root_type: rootType,
      root_keys: rootKeys,
      root_length: rootLength,
      first_item_keys: first && typeof first === 'object' ? Object.keys(first).slice(0, 80) : [],
      first_item: first,
      prefix: parsed ? null : text.slice(0, 1000),
    }, productResponse.ok ? 200 : 502);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error), code: 'JYSK_PRODUCT_DRY_RUN_FAILED' }, 500);
  }
});
