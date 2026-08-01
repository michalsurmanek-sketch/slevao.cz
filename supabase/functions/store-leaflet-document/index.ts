import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'authorization, range, content-type, apikey',
  'access-control-expose-headers': 'accept-ranges, content-length, content-range, content-type',
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function responseJson(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!['GET', 'HEAD'].includes(request.method)) return responseJson({ error: 'Method not allowed' }, 405);

  const importId = new URL(request.url).searchParams.get('import_id') || '';
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(importId)) return responseJson({ error: 'Neplatný identifikátor letáku.' }, 400);

  const { data: job, error } = await db.from('leaflet_imports')
    .select('id,source_document_url,status,detected_valid_to,metadata,stores(slug)')
    .eq('id', importId)
    .maybeSingle();
  const store = Array.isArray(job?.stores) ? job?.stores[0] : job?.stores;
  const allowedStatuses = new Set(['published', 'review', 'publishing']);
  if (error || !job || store?.slug !== 'tesco' || !allowedStatuses.has(String(job.status))) {
    return responseJson({ error: 'Leták nebyl nalezen.' }, 404);
  }
  if (job.detected_valid_to && job.detected_valid_to < new Date().toISOString().slice(0, 10)) {
    return responseJson({ error: 'Platnost letáku skončila.' }, 410);
  }

  const bucket = typeof job.metadata?.storage_bucket === 'string' ? job.metadata.storage_bucket : '';
  const path = typeof job.metadata?.storage_path === 'string' ? job.metadata.storage_path : '';
  if (bucket && path) {
    const { data, error: signedError } = await db.storage.from(bucket).createSignedUrl(path, 15 * 60);
    if (!signedError && data?.signedUrl) return Response.redirect(data.signedUrl, 302);
  }

  try {
    const upstream = await fetch(job.source_document_url, {
      method: request.method,
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
        accept: 'application/pdf,image/webp,image/png,image/jpeg,*/*;q=0.8',
        'accept-language': 'cs-CZ,cs;q=0.9',
        referer: 'https://www.itesco.cz/',
        origin: 'https://www.itesco.cz',
        ...(request.headers.get('range') ? { range: request.headers.get('range')! } : {}),
      },
      redirect: 'follow',
    });
    if (!upstream.ok && upstream.status !== 206) return responseJson({ error: `Zdroj letáku vrátil HTTP ${upstream.status}.` }, 502);

    const headers = new Headers(CORS_HEADERS);
    for (const name of ['accept-ranges', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set('cache-control', 'public, max-age=900, s-maxage=900');
    headers.set('content-disposition', 'inline; filename="tesco-letak"');
    headers.set('x-content-type-options', 'nosniff');
    return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers });
  } catch (fetchError) {
    return responseJson({ error: fetchError instanceof Error ? fetchError.message : 'Leták se nepodařilo načíst.' }, 502);
  }
});
