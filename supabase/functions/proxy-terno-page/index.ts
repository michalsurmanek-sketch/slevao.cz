const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const ALLOWED_HOST = 'www.terno.cz';
const PATH_RE = /^\/wp-content\/uploads\/real3d-flipbook\/flipbook_\d+\/([1-9]|[1-9]\d)\.(?:jpg|jpeg|png|webp)$/i;

function allowed(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const apiKey = req.headers.get('apikey') || '';
  return auth === `Bearer ${SERVICE_ROLE_KEY}`
    || apiKey === SERVICE_ROLE_KEY
    || Boolean(CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET);
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function validateUrl(raw: unknown) {
  const value = String(raw || '');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Neplatná URL stránky.');
  }
  if (url.protocol !== 'https:' || url.hostname !== ALLOWED_HOST || !PATH_RE.test(url.pathname)) {
    throw new Error('Proxy podporuje pouze oficiální Terno flipbook obrázky.');
  }
  url.search = '';
  url.hash = '';
  return url;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(req)) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const url = validateUrl(body.image_url);
    const upstream = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
        accept: 'image/jpeg,image/png,image/webp,*/*',
        referer: 'https://www.terno.cz/prodejny/zlin/',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(45_000),
    });
    if (!upstream.ok || !upstream.body) {
      return json({ error: `Terno image HTTP ${upstream.status}` }, 502);
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return json({ error: 'Upstream nevrátil obrázek.' }, 502);
    }

    return new Response(upstream.body, {
      status: 200,
      headers: {
        'content-type': contentType,
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
