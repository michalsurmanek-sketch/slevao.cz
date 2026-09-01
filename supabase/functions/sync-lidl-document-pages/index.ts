import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const OVERVIEW_URL = 'https://endpoints.leaflets.schwarz/v4/overview?client_locale=lidl%2Fcs-CZ';
const SOURCE_KIND = 'lidl-official-flyer-json-v1';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'content-type': 'application/json; charset=utf-8',
};
const FETCH_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'application/json,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

type FlyerCandidate = {
  id: string;
  pdfUrl: string;
  flyerJson: string;
  validFrom: string;
  validTo: string;
  title: string;
};

type PagePayload = {
  page_number: number;
  page_id: string | null;
  image_url: string;
  zoom_url: string | null;
  thumbnail_url: string | null;
  image_width: number | null;
  image_height: number | null;
  alt_text: string | null;
  keywords: string | null;
  metadata: Record<string, unknown>;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

async function allowed(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE_ROLE_KEY) return true;
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}

function businessDatePrague(offsetDays = 0) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const base = formatter.format(new Date());
  const date = new Date(`${base}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function requireHttpsHost(value: unknown, host: string, label: string) {
  const text = String(value || '').trim();
  let url: URL;
  try { url = new URL(text); } catch { throw new Error(`Lidl pages: ${label} is not a URL.`); }
  if (url.protocol !== 'https:' || url.hostname !== host) {
    throw new Error(`Lidl pages: ${label} has unexpected host.`);
  }
  return url.toString();
}

function optionalHttpsHost(value: unknown, host: string, label: string) {
  const text = String(value || '').trim();
  if (!text) return null;
  try { return requireHttpsHost(text, host, label); }
  catch { return null; }
}

async function fetchJson(url: string, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow', signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.url || url} HTTP ${response.status}`);
    try { return JSON.parse(text); }
    catch { throw new Error(`Lidl pages: invalid JSON from ${response.url || url}.`); }
  } finally {
    clearTimeout(timer);
  }
}

function currentFlyers(overview: any): FlyerCandidate[] {
  const today = businessDatePrague();
  const horizon = businessDatePrague(4);
  const candidates = (overview?.categories || []).flatMap((category: any) =>
    (category?.subcategories || []).flatMap((subcategory: any) =>
      String(subcategory?.name || '').toLocaleLowerCase('cs').includes('akční letáky')
        ? (subcategory?.flyers || [])
        : []
    )
  ).map((flyer: any): FlyerCandidate | null => {
    const validFrom = String(flyer?.offerStartDate || flyer?.startDate || '').slice(0, 10);
    const validTo = String(flyer?.offerEndDate || flyer?.endDate || '').slice(0, 10);
    if (flyer?.isActive === false || !/^\d{4}-\d{2}-\d{2}$/.test(validFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(validTo)) return null;
    if (validTo < today || validFrom > horizon) return null;

    const pdfUrl = optionalHttpsHost(flyer?.pdfUrl, 'assets.leaflets.schwarz', 'pdfUrl');
    const flyerJson = optionalHttpsHost(flyer?.flyerJson, 'endpoints.leaflets.schwarz', 'flyerJson');
    if (!pdfUrl || !flyerJson || !/\/Akcni-letak-OD-/i.test(new URL(pdfUrl).pathname)) return null;

    return {
      id: String(flyer?.id || ''),
      pdfUrl,
      flyerJson,
      validFrom,
      validTo,
      title: String(flyer?.title || flyer?.name || '').trim(),
    };
  }).filter((value: FlyerCandidate | null): value is FlyerCandidate => value !== null);

  const unique = new Map<string, FlyerCandidate>();
  for (const item of candidates) if (!unique.has(item.pdfUrl)) unique.set(item.pdfUrl, item);
  return [...unique.values()].sort((a, b) => {
    const aCurrent = a.validFrom <= today && a.validTo >= today ? 0 : 1;
    const bCurrent = b.validFrom <= today && b.validTo >= today ? 0 : 1;
    return aCurrent - bCurrent || a.validFrom.localeCompare(b.validFrom) || a.pdfUrl.localeCompare(b.pdfUrl);
  }).slice(0, 2);
}

function positiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizePages(payload: any, candidate: FlyerCandidate): PagePayload[] {
  const flyer = payload?.flyer;
  if (!flyer || !Array.isArray(flyer.pages)) throw new Error('Lidl pages: flyer JSON has no pages array.');
  if (String(flyer.pdfUrl || '')) {
    const payloadPdf = requireHttpsHost(flyer.pdfUrl, 'assets.leaflets.schwarz', 'flyer JSON pdfUrl');
    if (new URL(payloadPdf).pathname !== new URL(candidate.pdfUrl).pathname) {
      throw new Error('Lidl pages: flyer JSON PDF identity does not match overview.');
    }
  }

  const pages: any[] = flyer.pages;
  if (pages.length < 1 || pages.length > 200) throw new Error(`Lidl pages: invalid page count ${pages.length}.`);

  const normalized: PagePayload[] = pages.map((page: any): PagePayload => {
    const pageNumber = positiveInteger(page?.number);
    if (!pageNumber || pageNumber > 200) throw new Error('Lidl pages: invalid page number.');
    const imageUrl = requireHttpsHost(page?.image, 'imgproxy.leaflets.schwarz', `page ${pageNumber} image`);
    const zoomUrl = page?.zoom ? requireHttpsHost(page.zoom, 'imgproxy.leaflets.schwarz', `page ${pageNumber} zoom`) : null;
    const thumbnailUrl = page?.thumbnail ? requireHttpsHost(page.thumbnail, 'imgproxy.leaflets.schwarz', `page ${pageNumber} thumbnail`) : null;
    return {
      page_number: pageNumber,
      page_id: String(page?.id || '').trim() || null,
      image_url: imageUrl,
      zoom_url: zoomUrl,
      thumbnail_url: thumbnailUrl,
      image_width: positiveInteger(page?.width),
      image_height: positiveInteger(page?.height),
      alt_text: String(page?.altText || '').trim() || null,
      keywords: String(page?.keyWords || '').trim() || null,
      metadata: {
        page_type: String(page?.pageType || page?.type || '').trim() || null,
        official_flyer_id: candidate.id || null,
        official_flyer_json_url: candidate.flyerJson,
      },
    };
  }).sort((a: PagePayload, b: PagePayload) => a.page_number - b.page_number);

  const numbers = normalized.map((page: PagePayload) => page.page_number);
  if (new Set(numbers).size !== normalized.length || numbers[0] !== 1 || numbers[numbers.length - 1] !== normalized.length) {
    throw new Error('Lidl pages: page numbers are not unique contiguous 1..N.');
  }
  return normalized;
}

async function syncCandidate(storeId: string, candidate: FlyerCandidate) {
  const payload = await fetchJson(candidate.flyerJson);
  const pages = normalizePages(payload, candidate);

  const { data: replaced, error: replaceError } = await db.rpc('replace_leaflet_document_pages_internal', {
    p_store_id: storeId,
    p_source_document_url: candidate.pdfUrl,
    p_source_kind: SOURCE_KIND,
    p_pages: pages,
  });
  if (replaceError) throw replaceError;
  if (Number(replaced) !== pages.length) throw new Error('Lidl pages: atomic replace returned unexpected count.');

  const { data: imports, error: importError } = await db.from('leaflet_imports')
    .select('id,metadata,page_count')
    .eq('store_id', storeId)
    .eq('source_document_url', candidate.pdfUrl);
  if (importError) throw importError;

  const syncedAt = new Date().toISOString();
  const updatedImports: string[] = [];
  for (const item of imports || []) {
    const { error } = await db.from('leaflet_imports').update({
      page_count: pages.length,
      metadata: {
        ...(item.metadata || {}),
        page_count_source: SOURCE_KIND,
        page_identity_available: true,
        page_identity_source: SOURCE_KIND,
        page_identity_synced_at: syncedAt,
        official_flyer_id: candidate.id || null,
        official_flyer_json_url: candidate.flyerJson,
      },
      updated_at: syncedAt,
    }).eq('id', item.id);
    if (error) throw error;
    updatedImports.push(item.id);
  }

  return {
    flyer_id: candidate.id,
    title: candidate.title,
    pdf_url: candidate.pdfUrl,
    flyer_json_url: candidate.flyerJson,
    valid_from: candidate.validFrom,
    valid_to: candidate.validTo,
    pages: pages.length,
    imports_updated: updatedImports,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  try {
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'lidl').single();
    if (storeError || !store) throw storeError || new Error('Lidl store not found.');

    const overview = await fetchJson(OVERVIEW_URL);
    const candidates = currentFlyers(overview);
    if (!candidates.length) throw new Error('Lidl pages: official overview has no current or near-future main leaflet.');

    const results = [];
    for (const candidate of candidates) results.push(await syncCandidate(store.id, candidate));

    return json({
      ok: true,
      store: store.name,
      source_kind: SOURCE_KIND,
      business_date: businessDatePrague(),
      documents: results.length,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message }, 500);
  }
});
