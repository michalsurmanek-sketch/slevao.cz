import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://jysk.cz/campaign';
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
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

type Publication = {
  sourceUrl: string;
  finalUrl: string;
  internalTitle: string;
  coverUrl: string | null;
  pageCount: number | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    const parts = [value.message, value.details, value.hint, value.code].filter(Boolean).map(String);
    if (parts.length) return parts.join(' | ');
    try { return JSON.stringify(error); } catch { /* fall through */ }
  }
  return String(error);
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

async function fetchText(url: string, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return { text: await response.text(), finalUrl: response.url };
  } finally {
    clearTimeout(timer);
  }
}

function htmlEntity(value: string) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;|&#160;/gi, ' ');
}

function pageCountFromCover(coverUrl: string | null) {
  if (!coverUrl) return null;
  try {
    const token = new URL(coverUrl).searchParams.get('v');
    if (!token) return null;
    const normalized = token.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(token.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(normalized));
    const count = Number(decoded.PageCount ?? decoded.pageCount ?? 0);
    return Number.isInteger(count) && count > 0 && count < 500 ? count : null;
  } catch {
    return null;
  }
}

function publicationUrls(html: string) {
  const values = new Set<string>();
  for (const match of html.matchAll(/https:\/\/ipaper\.ipapercms\.dk\/jysk\/cz\/CampaignPaper\/[a-z0-9_]+(?:\?[^"'<>\s]*)?/gi)) {
    values.add(htmlEntity(match[0]).replace(/\?page=\d+.*$/i, ''));
  }
  return [...values];
}

async function publicationInfo(sourceUrl: string): Promise<Publication> {
  const page = await fetchText(sourceUrl);
  const internalTitle = htmlEntity(page.text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1]
    || page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    || 'JYSK');
  const coverUrl = htmlEntity(page.text.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || '') || null;
  return {
    sourceUrl,
    finalUrl: page.finalUrl,
    internalTitle: internalTitle.trim(),
    coverUrl,
    pageCount: pageCountFromCover(coverUrl),
  };
}

function publicTitle(publication: Publication, index: number) {
  const pages = publication.pageCount ? ` – ${publication.pageCount} stran` : '';
  const sale = /summer sale/i.test(publication.internalTitle) ? 'Letní výprodej' : 'Aktuální leták';
  return index === 0 ? `${sale} JYSK${pages}` : `Další platný leták JYSK${pages}`;
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
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'jysk').single();
    if (storeError || !store) throw storeError || new Error('Obchod JYSK nebyl nalezen.');

    const { data: source, error: sourceError } = await db.from('leaflet_sources')
      .select('id')
      .eq('store_id', store.id)
      .eq('source_url', SOURCE_URL)
      .eq('is_active', true)
      .single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj JYSK nebyl nalezen.');

    const listing = await fetchText(SOURCE_URL);
    const urls = publicationUrls(listing.text);
    if (!urls.length) throw new Error('JYSK nevrátil žádný aktuální iPaper leták.');
    const publications = await Promise.all(urls.slice(0, 6).map(publicationInfo));

    const created: Array<{ id: string; title: string; url: string }> = [];
    const refreshed: Array<{ id: string; title: string; url: string }> = [];
    const activeUrls = new Set(publications.map((publication) => publication.finalUrl));

    for (const [index, publication] of publications.entries()) {
      const title = publicTitle(publication, index);
      const sourceHash = await sha256(`${source.id}|${publication.finalUrl}|jysk-ipaper-v1`);
      const metadata = {
        adapter: 'jysk-ipaper-v1',
        title,
        internal_title: publication.internalTitle,
        cover_image_url: publication.coverUrl,
        page_count: publication.pageCount,
        source_page: SOURCE_URL,
        last_seen_at: checkedAt,
      };

      const { data: existing, error: existingError } = await db.from('leaflet_imports')
        .select('id,status,detected_valid_from')
        .eq('source_hash', sourceHash)
        .maybeSingle();
      if (existingError) throw existingError;

      if (existing) {
        const { error } = await db.from('leaflet_imports').update({
          source_document_url: publication.finalUrl,
          detected_valid_from: existing.detected_valid_from || today,
          detected_valid_to: null,
          coverage_scope: 'national',
          metadata,
          updated_at: checkedAt,
        }).eq('id', existing.id);
        if (error) throw error;
        refreshed.push({ id: existing.id, title, url: publication.finalUrl });
        continue;
      }

      const { data: imported, error: importError } = await db.from('leaflet_imports').insert({
        source_id: source.id,
        store_id: store.id,
        source_document_url: publication.finalUrl,
        source_hash: sourceHash,
        status: 'review',
        product_count: 0,
        confidence: 0.99,
        coverage_scope: 'national',
        detected_valid_from: today,
        detected_valid_to: null,
        finished_at: checkedAt,
        metadata,
      }).select('id').single();
      if (importError || !imported) throw importError || new Error(`Publikaci ${title} se nepodařilo uložit.`);
      created.push({ id: imported.id, title, url: publication.finalUrl });
    }

    const { data: oldImports, error: oldError } = await db.from('leaflet_imports')
      .select('id,source_document_url,metadata')
      .eq('source_id', source.id)
      .in('status', ['published', 'review', 'publishing'])
      .or('detected_valid_to.is.null,detected_valid_to.gte.' + today);
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
      last_strategy_used: 'official_flipbook',
      last_strategy_success_at: checkedAt,
    }).eq('id', source.id);

    return json({
      ok: true,
      store: store.name,
      publications: publications.map((publication, index) => ({
        title: publicTitle(publication, index),
        url: publication.finalUrl,
        cover_url: publication.coverUrl,
        page_count: publication.pageCount,
      })),
      created,
      refreshed,
      expired,
    });
  } catch (error) {
    const message = errorMessage(error);
    const { data: store } = await db.from('stores').select('id').eq('slug', 'jysk').maybeSingle();
    if (store?.id) {
      await db.from('leaflet_sources').update({
        last_checked_at: checkedAt,
        last_error: message.slice(0, 1000),
      }).eq('store_id', store.id).eq('is_active', true);
    }
    return json({ error: message }, 500);
  }
});
