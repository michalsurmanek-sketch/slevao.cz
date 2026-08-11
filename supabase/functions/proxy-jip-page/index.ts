const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'cache-control': 'public, max-age=1800',
};

function allowedSource(raw: string) {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'www.jip-potraviny.cz') return null;
    if (!/^\/wp-content\/uploads\/file\/[A-Za-z0-9._%-]+\/files\/(?:mobile|thumb)\/\d+\.jpg$/i.test(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS });

  const requestUrl = new URL(request.url);
  const source = allowedSource(requestUrl.searchParams.get('url') || '');
  if (!source) return Response.json({ error: 'Invalid JIP page URL' }, { status: 400, headers: CORS });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(source, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
        accept: 'image/jpeg,image/*;q=0.9,*/*;q=0.5',
        'accept-language': 'cs-CZ,cs;q=0.9',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      return Response.json({ error: `JIP upstream HTTP ${response.status}` }, { status: 502, headers: CORS });
    }
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return Response.json({ error: 'JIP upstream did not return an image' }, { status: 502, headers: CORS });
    }
    return new Response(response.body, {
      status: 200,
      headers: {
        ...CORS,
        'content-type': contentType,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502, headers: CORS });
  } finally {
    clearTimeout(timer);
  }
});
