import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://www.obi.cz/nabidky/aktualni-letak';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'content-type': 'application/json; charset=utf-8',
};
const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

type Brochure = {
  id: string;
  title: string;
  validFrom?: string | null;
  validUntil?: string | null;
  publishedFrom?: string | null;
  publishedUntil?: string | null;
  pageCount?: number | null;
  brochureImage?: { url?: string | null } | null;
  previewUrls?: Record<string, string> | null;
};

type BrochureDetail = Brochure & {
  pdfUrl?: string | null;
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

async function fetchText(url: string, headers: Record<string, string> = BROWSER_HEADERS, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, redirect: 'follow', signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return { text, finalUrl: response.url };
  } finally {
    clearTimeout(timer);
  }
}

function decodeBase64Json(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return JSON.parse(atob(normalized));
}

function czechDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const item = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${item('year')}-${item('month')}-${item('day')}`;
}

function cleanTitle(value: string) {
  const title = String(value || 'Aktuální leták OBI').replace(/\s+/g, ' ').trim();
  return title.toLocaleLowerCase('cs') === title ? title : title.toLocaleLowerCase('cs').replace(/(^|[.!?]\s+)(\p{L})/gu, (_, prefix, letter) => `${prefix}${letter.toLocaleUpperCase('cs')}`);
}

function coverUrl(brochure: BrochureDetail) {
  return brochure.brochureImage?.url
    || brochure.previewUrls?.largePreview
    || brochure.previewUrls?.['768x1024']
    || null;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadOfficialBrochures() {
  const page = await fetchText(SOURCE_URL);
  const authKey = page.text.match(/discBonialWidgetId([a-f0-9]{16,64})/i)?.[1]
    || page.text.match(/"authKey"\s*:\s*"([a-f0-9]{16,64})"/i)?.[1]
    || '';
  if (!authKey) throw new Error('OBI stránka nevrátila klíč oficiálního letákového widgetu.');

  const paramsResponse = await fetchText(
    `https://bonialconnect.com/params/connect/v1/keys/${authKey}/encoded.json?_=${Date.now()}`,
    { ...BROWSER_HEADERS, accept: 'application/json', referer: SOURCE_URL },
  );
  const envelope = JSON.parse(paramsResponse.text);
  const params = typeof envelope.data === 'string' ? decodeBase64Json(envelope.data) : envelope.data;
  if (!params?.keyActive) throw new Error('Oficiální OBI letákový widget není aktivní.');

  const publisherId = /^[A-Z]{2}-/i.test(String(params.publisherId || ''))
    ? String(params.publisherId)
    : `${String(params.market || 'de').toUpperCase()}-${String(params.publisherId || '')}`;
  const apiBase = `${String(params.apiHost || '').replace(/\/$/, '')}/${String(params.market || 'de')}`;
  if (!/^https:\/\/www\.bonialserviceswidget\.de\/de$/i.test(apiBase)) {
    throw new Error('OBI widget vrátil neočekávaný API zdroj.');
  }
  const apiHeaders = {
    ...BROWSER_HEADERS,
    accept: 'application/json',
    referer: SOURCE_URL,
    'Bonial-Api-Consumer': 'Bonial-Connect-Widget',
    'X-Auth-Key': authKey,
  };

  const storesResponse = await fetchText(
    `${apiBase}/stores/default/byPublisher?publisherId=${encodeURIComponent(publisherId)}`,
    apiHeaders,
  );
  const stores = JSON.parse(storesResponse.text);
  const store = Array.isArray(stores) ? stores[0] : stores;
  if (!store?.id || !/^DE-[A-Z0-9-]+$/i.test(String(store.id))) {
    throw new Error('OBI widget nevrátil výchozí českou prodejnu.');
  }

  const brochuresResponse = await fetchText(
    `${apiBase}/stores/${encodeURIComponent(store.id)}/brochures?publisherId=${encodeURIComponent(publisherId)}&limit=100`,
    apiHeaders,
  );
  const brochureEnvelope = JSON.parse(brochuresResponse.text);
  const brochures: Brochure[] = Array.isArray(brochureEnvelope) ? brochureEnvelope : brochureEnvelope.brochures || [];
  if (!brochures.length) throw new Error('OBI widget nevrátil žádný aktuální leták.');

  const today = new Date().toISOString().slice(0, 10);
  const details: BrochureDetail[] = [];
  for (const brochure of brochures.slice(0, 12)) {
    if (!/^[0-9a-f-]{36}$/i.test(String(brochure.id || ''))) continue;
    const detailResponse = await fetchText(
      `${apiBase}/v5/brochureDetails/${encodeURIComponent(brochure.id)}?publisherId=${encodeURIComponent(publisherId)}`,
      apiHeaders,
    );
    const detail = JSON.parse(detailResponse.text) as BrochureDetail;
    const pdfUrl = String(detail.pdfUrl || '');
    if (!/^https:\/\/aws-ops-bonial-biz-production-published-content-pdf\.s3-eu-west-1\.amazonaws\.com\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/i.test(pdfUrl)) continue;
    const validTo = czechDate(detail.validUntil || brochure.validUntil);
    if (validTo && validTo < today) continue;
    details.push({ ...brochure, ...detail, pdfUrl });
  }
  if (!details.length) throw new Error('OBI nevrátil žádný platný úplný PDF leták.');

  return {
    authKey,
    publisherId,
    store: { id: String(store.id), name: String(store.name || ''), city: String(store.city || '') },
    brochures: details,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  const checkedAt = new Date().toISOString();
  const today = checkedAt.slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  try {
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'obi').single();
    if (storeError || !store) throw storeError || new Error('Obchod OBI nebyl nalezen.');

    const { data: source, error: sourceError } = await db.from('leaflet_sources')
      .select('id')
      .eq('store_id', store.id)
      .eq('source_url', SOURCE_URL)
      .eq('is_active', true)
      .single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj OBI nebyl nalezen.');

    const official = await loadOfficialBrochures();
    const created: Array<{ id: string; title: string; url: string }> = [];
    const refreshed: Array<{ id: string; title: string; url: string }> = [];
    const activeUrls = new Set<string>();

    for (const brochure of official.brochures) {
      const pdfUrl = String(brochure.pdfUrl);
      activeUrls.add(pdfUrl);
      const title = cleanTitle(brochure.title);
      const validFrom = czechDate(brochure.validFrom || brochure.publishedFrom) || today;
      const validTo = czechDate(brochure.validUntil || brochure.publishedUntil);
      const sourceHash = await sha256(`${source.id}|${pdfUrl}|obi-bonial-v1`);
      const metadata = {
        adapter: 'obi-bonial-v1',
        title,
        brochure_id: brochure.id,
        cover_image_url: coverUrl(brochure),
        page_count: Number(brochure.pageCount || 0) || null,
        source_page: SOURCE_URL,
        official_viewer_url: `${SOURCE_URL}?brochureId=${encodeURIComponent(brochure.id)}`,
        bonial_publisher_id: official.publisherId,
        bonial_store_id: official.store.id,
        bonial_store_name: official.store.name,
        last_seen_at: checkedAt,
      };

      const { data: existing, error: existingError } = await db.from('leaflet_imports')
        .select('id,status')
        .eq('source_hash', sourceHash)
        .maybeSingle();
      if (existingError) throw existingError;

      if (existing) {
        const { error } = await db.from('leaflet_imports').update({
          source_document_url: pdfUrl,
          detected_valid_from: validFrom,
          detected_valid_to: validTo,
          coverage_scope: 'national',
          metadata,
          updated_at: checkedAt,
        }).eq('id', existing.id);
        if (error) throw error;
        refreshed.push({ id: existing.id, title, url: pdfUrl });
      } else {
        const { data: imported, error: importError } = await db.from('leaflet_imports').insert({
          source_id: source.id,
          store_id: store.id,
          source_document_url: pdfUrl,
          source_hash: sourceHash,
          status: 'review',
          product_count: 0,
          confidence: 0.99,
          coverage_scope: 'national',
          detected_valid_from: validFrom,
          detected_valid_to: validTo,
          finished_at: checkedAt,
          metadata,
        }).select('id').single();
        if (importError || !imported) throw importError || new Error(`Leták ${title} se nepodařilo uložit.`);
        created.push({ id: imported.id, title, url: pdfUrl });
      }
    }

    const { data: oldImports, error: oldError } = await db.from('leaflet_imports')
      .select('id,source_document_url,metadata')
      .eq('source_id', source.id)
      .in('status', ['published', 'review', 'publishing'])
      .or(`detected_valid_to.is.null,detected_valid_to.gte.${today}`);
    if (oldError) throw oldError;
    const expired: string[] = [];
    for (const oldImport of oldImports || []) {
      if (activeUrls.has(String(oldImport.source_document_url || ''))) continue;
      const { error } = await db.from('leaflet_imports').update({
        detected_valid_to: yesterday,
        metadata: { ...(oldImport.metadata || {}), expired_by_source_at: checkedAt },
      }).eq('id', oldImport.id);
      if (error) throw error;
      expired.push(oldImport.id);
    }

    await db.from('leaflet_sources').update({
      last_checked_at: checkedAt,
      last_success_at: checkedAt,
      last_error: null,
      last_strategy_used: 'official_bonial_pdf',
      last_strategy_success_at: checkedAt,
    }).eq('id', source.id);

    return json({
      ok: true,
      store: store.name,
      official_store: official.store,
      brochures: official.brochures.map((brochure) => ({
        id: brochure.id,
        title: cleanTitle(brochure.title),
        valid_from: czechDate(brochure.validFrom || brochure.publishedFrom),
        valid_to: czechDate(brochure.validUntil || brochure.publishedUntil),
        page_count: brochure.pageCount,
        pdf_url: brochure.pdfUrl,
        cover_url: coverUrl(brochure),
      })),
      created,
      refreshed,
      expired,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { data: store } = await db.from('stores').select('id').eq('slug', 'obi').maybeSingle();
    if (store?.id) {
      await db.from('leaflet_sources').update({
        last_checked_at: checkedAt,
        last_error: message.slice(0, 1000),
      }).eq('store_id', store.id).eq('is_active', true);
    }
    return json({ error: message }, 500);
  }
});
