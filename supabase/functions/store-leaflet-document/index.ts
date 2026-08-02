import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'authorization, range, content-type, apikey',
  'access-control-expose-headers': 'accept-ranges, content-disposition, content-length, content-range, content-type',
};

const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.6',
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function responseJson(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function normalizedEscapes(value: string): string {
  return String(value || '')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&');
}

function isGlobusPdfUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.hostname === 'gapi.globus.cz'
      && url.pathname === '/OnlineAsset/3/asset'
      && /^[0-9a-f-]{36}$/i.test(url.searchParams.get('assetID') || '')
      && !url.searchParams.has('type');
  } catch {
    return false;
  }
}

function globusPdfFromHtml(html: string): string | null {
  const source = normalizedEscapes(html);
  const candidates = source.match(/https:\/\/gapi\.globus\.cz\/OnlineAsset\/3\/asset\?assetID=[0-9a-f-]{36}(?:&[^\s"'<>]*)?/gi) || [];
  for (const candidate of candidates) {
    const cleaned = candidate.replace(/[),.;]+$/, '');
    if (isGlobusPdfUrl(cleaned)) return new URL(cleaned).toString();
  }
  return null;
}

function officialPublicDocument(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    const tescoDocument = url.hostname === 'digitalcontent.api.tesco.com'
      && url.pathname.startsWith('/v2/media/dotcom-cz/')
      && /\.(?:pdf|webp|png|jpe?g)$/i.test(url.pathname);
    const pennyDocument = url.hostname === 'files.rewe.co.at'
      && /^\/PennyIntLeaflet\/CZ\/[^/]+\/files\/assets\/common\/downloads\/[^/]+\.pdf$/i.test(url.pathname);
    const globusDocument = isGlobusPdfUrl(url.toString());
    return tescoDocument || pennyDocument || globusDocument ? url.toString() : null;
  } catch {
    return null;
  }
}

function storedContentType(path: string, reportedType: string): string {
  if (reportedType && reportedType !== 'application/octet-stream') return reportedType;
  if (/\.pdf$/i.test(path)) return 'application/pdf';
  if (/\.webp$/i.test(path)) return 'image/webp';
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (/\.html?$/i.test(path)) return 'text/html; charset=utf-8';
  return 'application/octet-stream';
}

function inlineFilename(path: string): string {
  const extension = path.match(/\.(pdf|webp|png|jpe?g)$/i)?.[0].toLowerCase() || '';
  return `letak${extension}`;
}

function hasPdfMagic(bytes: Uint8Array): boolean {
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

function hasImageMagic(bytes: Uint8Array): boolean {
  return (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    || (bytes[0] === 0xff && bytes[1] === 0xd8)
    || (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46);
}

async function blobMagic(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(0, 8).arrayBuffer());
}

async function resolveGlobusPdf(sourcePageUrl: string): Promise<{ pdfUrl: string; referer: string }> {
  if (isGlobusPdfUrl(sourcePageUrl)) {
    return { pdfUrl: sourcePageUrl, referer: 'https://www.globus.cz/' };
  }

  let pageUrl: URL;
  try {
    pageUrl = new URL(sourcePageUrl);
  } catch {
    throw new Error('Globus má neplatnou adresu zdroje.');
  }
  if (pageUrl.protocol !== 'https:' || !(pageUrl.hostname === 'globus.cz' || pageUrl.hostname.endsWith('.globus.cz'))) {
    throw new Error('Globus má nepovolený zdroj letáku.');
  }

  const pageResponse = await fetch(pageUrl, {
    headers: {
      ...BROWSER_HEADERS,
      accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
    },
    redirect: 'follow',
  });
  if (!pageResponse.ok) throw new Error(`Stránka Globusu vrátila HTTP ${pageResponse.status}.`);
  const pdfUrl = globusPdfFromHtml(await pageResponse.text());
  if (!pdfUrl) throw new Error('Globus na aktuální stránce nevrátil odkaz „Stáhnout v PDF“.');
  return { pdfUrl, referer: pageResponse.url };
}

function upstreamContext(sourceUrl: string, fallbackReferer = ''): { referer: string; origin?: string } {
  if (sourceUrl.includes('files.rewe.co.at')) return { referer: 'https://www.penny.cz/', origin: 'https://www.penny.cz' };
  if (sourceUrl.includes('digitalcontent.api.tesco.com')) return { referer: 'https://www.itesco.cz/', origin: 'https://www.itesco.cz' };
  if (isGlobusPdfUrl(sourceUrl)) return { referer: fallbackReferer || 'https://www.globus.cz/' };
  return { referer: fallbackReferer || sourceUrl };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!['GET', 'HEAD'].includes(request.method)) return responseJson({ error: 'Method not allowed' }, 405);

  const requestUrl = new URL(request.url);
  const importId = requestUrl.searchParams.get('import_id') || '';
  const officialSourceUrl = officialPublicDocument(requestUrl.searchParams.get('source_url') || '');
  let job: any = null;
  let storeSlug = '';
  let sourceDocumentUrl = officialSourceUrl || '';
  let sourceReferer = '';

  if (!officialSourceUrl) {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(importId)) return responseJson({ error: 'Neplatný identifikátor letáku.' }, 400);
    const { data, error } = await db.from('leaflet_imports')
      .select('id,source_document_url,status,detected_valid_to,metadata,stores(slug,is_active)')
      .eq('id', importId)
      .maybeSingle();
    job = data;
    const store = Array.isArray(job?.stores) ? job?.stores[0] : job?.stores;
    storeSlug = String(store?.slug || '');
    const allowedStatuses = new Set(['published', 'review', 'publishing']);
    if (error || !job || store?.is_active === false || !allowedStatuses.has(String(job.status))) {
      return responseJson({ error: 'Leták nebyl nalezen.' }, 404);
    }
    if (job.detected_valid_to && job.detected_valid_to < new Date().toISOString().slice(0, 10)) {
      return responseJson({ error: 'Platnost letáku skončila.' }, 410);
    }
    sourceDocumentUrl = String(job.source_document_url || '');
  } else if (isGlobusPdfUrl(officialSourceUrl)) {
    storeSlug = 'globus';
  }

  const bucket = typeof job?.metadata?.storage_bucket === 'string' ? job.metadata.storage_bucket : '';
  const path = typeof job?.metadata?.storage_path === 'string' ? job.metadata.storage_path : '';
  if (bucket && path) {
    const { data: storedDocument, error: downloadError } = await db.storage.from(bucket).download(path);
    if (!downloadError && storedDocument) {
      const magic = await blobMagic(storedDocument);
      const validStoredGlobusDocument = storeSlug !== 'globus' || hasPdfMagic(magic) || hasImageMagic(magic);
      if (validStoredGlobusDocument) {
        const headers = new Headers(CORS_HEADERS);
        const type = storeSlug === 'globus' && hasPdfMagic(magic)
          ? 'application/pdf'
          : storedContentType(path, storedDocument.type);
        headers.set('content-type', type);
        headers.set('content-length', String(storedDocument.size));
        headers.set('cache-control', 'private, no-store');
        headers.set('content-disposition', `inline; filename="${storeSlug === 'globus' ? 'globus-letak.pdf' : inlineFilename(path)}"`);
        headers.set('x-content-type-options', 'nosniff');
        return new Response(request.method === 'HEAD' ? null : storedDocument.stream(), {
          status: 200,
          headers,
        });
      }
      // Starší Globus importy obsahují HTML uložené pod PDF typem. Takový soubor
      // ignorujeme a níže vyřešíme skutečný PDF odkaz z oficiální stránky.
    }
  }

  try {
    if (storeSlug === 'globus') {
      const resolved = await resolveGlobusPdf(sourceDocumentUrl);
      sourceDocumentUrl = resolved.pdfUrl;
      sourceReferer = resolved.referer;
    }

    const context = upstreamContext(sourceDocumentUrl, sourceReferer);
    const upstream = await fetch(sourceDocumentUrl, {
      method: request.method,
      headers: {
        ...BROWSER_HEADERS,
        accept: isGlobusPdfUrl(sourceDocumentUrl)
          ? 'application/pdf,*/*;q=0.8'
          : 'application/pdf,image/webp,image/png,image/jpeg,*/*;q=0.8',
        referer: context.referer,
        ...(context.origin ? { origin: context.origin } : {}),
        ...(request.headers.get('range') ? { range: request.headers.get('range')! } : {}),
      },
      redirect: 'follow',
    });
    if (!upstream.ok && upstream.status !== 206) return responseJson({ error: `Zdroj letáku vrátil HTTP ${upstream.status}.` }, 502);

    let responseBody = upstream.body;
    if (request.method === 'GET' && isGlobusPdfUrl(sourceDocumentUrl)) {
      if (!upstream.body) return responseJson({ error: 'Globus vrátil prázdný PDF soubor.' }, 502);
      const [inspectionBody, outputBody] = upstream.body.tee();
      const reader = inspectionBody.getReader();
      const first = await reader.read();
      await reader.cancel();
      if (!first.value || !hasPdfMagic(first.value)) {
        await outputBody.cancel();
        return responseJson({ error: 'Globus místo PDF vrátil jiný typ dokumentu.' }, 502);
      }
      responseBody = outputBody;
    }

    const headers = new Headers(CORS_HEADERS);
    for (const name of ['accept-ranges', 'content-length', 'content-range', 'etag', 'last-modified']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    const contentType = isGlobusPdfUrl(sourceDocumentUrl)
      ? 'application/pdf'
      : upstream.headers.get('content-type') || 'application/octet-stream';
    headers.set('content-type', contentType);
    headers.set('cache-control', 'public, max-age=900, s-maxage=900');
    headers.set('content-disposition', `inline; filename="${isGlobusPdfUrl(sourceDocumentUrl) ? 'globus-letak.pdf' : 'letak'}"`);
    headers.set('x-content-type-options', 'nosniff');
    return new Response(request.method === 'HEAD' ? null : responseBody, { status: upstream.status, headers });
  } catch (fetchError) {
    return responseJson({ error: fetchError instanceof Error ? fetchError.message : 'Leták se nepodařilo načíst.' }, 502);
  }
});