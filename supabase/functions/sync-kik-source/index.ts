import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://www.kik.cz/tvuj-online-letak';
const GROUP_SLUG = 'kik-textilien-und-non-food-gmbh-cz';
const API_LIST_URL = `https://api.publitas.com/v1/groups/${GROUP_SLUG}/publications.json`;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'content-type': 'application/json; charset=utf-8',
};
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'application/json,text/html,application/pdf,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

type PublicationListItem = {
  id: number;
  slug: string;
  title?: string | null;
  browserTitle?: string | null;
  onlineAt?: string | null;
  url: string;
};

type PublicationDetail = {
  id?: number;
  slug?: string;
  title?: string;
  groupSlug?: string;
  config?: {
    publicationId?: number;
    publicationTitle?: string;
    publicationOriginalTitle?: string;
    downloadPdfUrl?: string | null;
    canonicalUrl?: string | null;
    language?: string;
    currency?: string;
  };
  spreads?: Array<{ pages?: string[] }>;
};

type CurrentPublication = {
  id: number;
  slug: string;
  onlineAt: string;
  title: string;
  viewerUrl: string;
  pdfUrl: string;
  coverUrl: string;
  pageCount: number;
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

async function fetchText(url: string, accept = HEADERS.accept, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { ...HEADERS, accept },
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

function safePublicationDetailUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'api.publitas.com') {
    throw new Error('KiK vrátil nepovolenou adresu detailu publikace.');
  }
  const expectedPrefix = `/v1/groups/${GROUP_SLUG}/publications/`;
  if (!url.pathname.startsWith(expectedPrefix)) {
    throw new Error('KiK vrátil detail publikace z neočekávané skupiny.');
  }
  return url.toString();
}

function safePdfUrl(value: string) {
  const url = new URL(value, 'https://view.publitas.com');
  if (url.protocol !== 'https:' || url.hostname !== 'view.publitas.com') {
    throw new Error('KiK vrátil nepovolenou adresu PDF.');
  }
  if (!/^\/\d+\/\d+\/pdfs\/[a-f0-9-]+\.pdf$/i.test(url.pathname)) {
    throw new Error('KiK vrátil neočekávaný formát PDF adresy.');
  }
  return url.toString();
}

function safeViewerUrl(value: string | null | undefined, publicationSlug: string) {
  const fallback = `https://view.publitas.com/${GROUP_SLUG}/${encodeURIComponent(publicationSlug)}/`;
  const candidate = String(value || fallback).trim();
  const url = new URL(candidate, 'https://view.publitas.com');
  if (url.protocol !== 'https:' || url.hostname !== 'view.publitas.com') {
    return fallback;
  }
  const expectedPrefix = `/${GROUP_SLUG}/${publicationSlug}`;
  if (!decodeURIComponent(url.pathname).startsWith(expectedPrefix)) {
    return fallback;
  }
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '') + '/';
}

function pageImageUrl(value: string) {
  const url = new URL(`${value}-at1600.jpg`, 'https://view.publitas.com');
  if (url.hostname !== 'view.publitas.com' || !/^\/\d+\/\d+\/pages\/[a-f0-9-]+-at1600\.jpg$/i.test(url.pathname)) {
    throw new Error('KiK vrátil nepovolený titulní obrázek.');
  }
  return url.toString();
}

function isoDate(value?: string | null) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

async function probePdf(url: string) {
  const response = await fetch(url, {
    headers: { ...HEADERS, accept: 'application/pdf,*/*;q=0.8', range: 'bytes=0-7' },
    redirect: 'follow',
  });
  if (!response.ok && response.status !== 206) throw new Error(`KiK PDF vrátil HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    throw new Error('KiK místo PDF vrátil jiný typ dokumentu.');
  }
}

async function loadCurrentPublication(): Promise<CurrentPublication> {
  const listResponse = await fetchText(API_LIST_URL, 'application/json,*/*;q=0.8');
  const list = JSON.parse(listResponse.text) as PublicationListItem[];
  if (!Array.isArray(list) || !list.length) throw new Error('KiK Publitas účet nevrátil žádný aktuální leták.');

  const current = [...list]
    .filter((item) => Number.isInteger(Number(item.id)) && item.slug && item.url)
    .sort((a, b) => new Date(b.onlineAt || 0).getTime() - new Date(a.onlineAt || 0).getTime())[0];
  if (!current) throw new Error('KiK nevrátil použitelnou aktuální publikaci.');

  const detailUrl = safePublicationDetailUrl(current.url);
  const detailResponse = await fetchText(detailUrl, 'application/json,*/*;q=0.8');
  const detail = JSON.parse(detailResponse.text) as PublicationDetail;
  const pages = (detail.spreads || []).flatMap((spread) => Array.isArray(spread.pages) ? spread.pages : []);
  if (!pages.length || pages.length > 500) throw new Error('KiK nevrátil platný počet stran letáku.');

  const pdfPath = String(detail.config?.downloadPdfUrl || '');
  if (!pdfPath) throw new Error('KiK u aktuální publikace nenabízí úplné PDF.');
  const pdfUrl = safePdfUrl(pdfPath);
  await probePdf(pdfUrl);

  const viewerUrl = safeViewerUrl(detail.config?.canonicalUrl, current.slug);
  const publicationTitle = String(
    current.browserTitle || detail.config?.publicationTitle || current.title || 'Aktuální leták KiK',
  ).replace(/\s+/g, ' ').trim();

  return {
    id: Number(current.id),
    slug: current.slug,
    onlineAt: current.onlineAt || new Date().toISOString(),
    title: `Aktuální leták KiK – ${pages.length} strany`,
    viewerUrl,
    pdfUrl,
    coverUrl: pageImageUrl(pages[0]),
    pageCount: pages.length,
  };
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  const checkedAt = new Date().toISOString();
  const today = checkedAt.slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  try {
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'kik').single();
    if (storeError || !store) throw storeError || new Error('Obchod KiK nebyl nalezen.');

    const { data: source, error: sourceError } = await db.from('leaflet_sources')
      .select('id')
      .eq('store_id', store.id)
      .eq('source_url', SOURCE_URL)
      .eq('is_active', true)
      .single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj KiK nebyl nalezen.');

    const publication = await loadCurrentPublication();
    const sourceHash = await sha256(`${source.id}|${publication.id}|kik-publitas-v1`);
    const metadata = {
      adapter: 'kik-publitas-v1',
      title: publication.title,
      publication_id: publication.id,
      publication_slug: publication.slug,
      page_count: publication.pageCount,
      viewer_url: publication.viewerUrl,
      cover_image_url: publication.coverUrl,
      source_page: SOURCE_URL,
      publitas_group: GROUP_SLUG,
      online_at: publication.onlineAt,
      last_seen_at: checkedAt,
    };

    const { data: existing, error: existingError } = await db.from('leaflet_imports')
      .select('id')
      .eq('source_hash', sourceHash)
      .maybeSingle();
    if (existingError) throw existingError;

    let importId = '';
    if (existing) {
      importId = existing.id;
      const { error } = await db.from('leaflet_imports').update({
        source_document_url: publication.pdfUrl,
        status: 'published',
        product_count: 0,
        confidence: 0.99,
        coverage_scope: 'national',
        detected_valid_from: isoDate(publication.onlineAt),
        detected_valid_to: null,
        finished_at: checkedAt,
        error_message: null,
        metadata,
        updated_at: checkedAt,
      }).eq('id', existing.id);
      if (error) throw error;
    } else {
      const { data: imported, error: importError } = await db.from('leaflet_imports').insert({
        source_id: source.id,
        store_id: store.id,
        source_document_url: publication.pdfUrl,
        source_hash: sourceHash,
        status: 'published',
        product_count: 0,
        confidence: 0.99,
        coverage_scope: 'national',
        detected_valid_from: isoDate(publication.onlineAt),
        detected_valid_to: null,
        finished_at: checkedAt,
        metadata,
      }).select('id').single();
      if (importError || !imported) throw importError || new Error('Leták KiK se nepodařilo uložit.');
      importId = imported.id;
    }

    const { data: oldImports, error: oldError } = await db.from('leaflet_imports')
      .select('id,source_hash,metadata')
      .eq('source_id', source.id)
      .contains('metadata', { adapter: 'kik-publitas-v1' })
      .neq('source_hash', sourceHash)
      .in('status', ['published', 'review', 'publishing'])
      .or(`detected_valid_to.is.null,detected_valid_to.gte.${today}`);
    if (oldError) throw oldError;

    const expired: string[] = [];
    for (const oldImport of oldImports || []) {
      const { error } = await db.from('leaflet_imports').update({
        detected_valid_to: yesterday,
        metadata: { ...(oldImport.metadata || {}), expired_by_source_at: checkedAt },
        updated_at: checkedAt,
      }).eq('id', oldImport.id);
      if (error) throw error;
      expired.push(oldImport.id);
    }

    await db.from('leaflet_sources').update({
      last_checked_at: checkedAt,
      last_success_at: checkedAt,
      last_error: null,
      last_strategy_used: 'official_publitas_pdf',
      last_strategy_success_at: checkedAt,
    }).eq('id', source.id);

    return json({
      ok: true,
      store: store.name,
      import_id: importId,
      title: publication.title,
      publication_id: publication.id,
      publication_slug: publication.slug,
      viewer_url: publication.viewerUrl,
      pdf_url: publication.pdfUrl,
      cover_url: publication.coverUrl,
      page_count: publication.pageCount,
      online_at: publication.onlineAt,
      expired,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { data: store } = await db.from('stores').select('id').eq('slug', 'kik').maybeSingle();
    if (store?.id) {
      await db.from('leaflet_sources').update({
        last_checked_at: checkedAt,
        last_error: message.slice(0, 1000),
      }).eq('store_id', store.id).eq('is_active', true);
    }
    return json({ error: message }, 500);
  }
});
