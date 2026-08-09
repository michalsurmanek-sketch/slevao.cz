import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://maximum.drmax.cz/letak';
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

type Issue = {
  issueUrl: string;
  issueSlug: string;
  title: string;
  validFrom: string;
  validTo: string;
  pageCount: number;
  coverUrl: string | null;
  pageImageUrls: string[];
  issueMetaSummary: unknown;
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

function decodeHtml(value: string) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchHtml(url: string, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    const html = await response.text();
    if (!response.ok) throw new Error(`${response.url || url} HTTP ${response.status}`);
    return { html, finalUrl: response.url };
  } finally {
    clearTimeout(timer);
  }
}

function meta(html: string, property: string) {
  return decodeHtml(
    html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1]
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'))?.[1]
      || '',
  );
}

function currentIssueSlug(html: string) {
  const candidates = [...html.matchAll(/href=["']\/?(\d{2}-\d{2}-20\d{2})(?:\/|["'])/gi)]
    .map((match) => match[1]);
  const unique = [...new Set(candidates)];
  if (!unique.length) throw new Error('Dr. Max nevrátil aktuální vydání letáku.');
  unique.sort((a, b) => {
    const [aFrom, aTo, aYear] = a.split('-').map(Number);
    const [bFrom, bTo, bYear] = b.split('-').map(Number);
    return (bYear * 10000 + bTo * 100 + bFrom) - (aYear * 10000 + aTo * 100 + aFrom);
  });
  return unique[0];
}

function dateFromIssueSlug(slug: string) {
  const match = slug.match(/^(\d{2})-(\d{2})-(20\d{2})$/);
  if (!match) throw new Error('Dr. Max vrátil neznámý formát platnosti letáku.');
  const fromMonth = Number(match[1]);
  const toMonth = Number(match[2]);
  const year = Number(match[3]);
  if (fromMonth < 1 || fromMonth > 12 || toMonth < 1 || toMonth > 12 || toMonth < fromMonth) {
    throw new Error('Dr. Max vrátil neplatné měsíce vydání.');
  }
  const validFrom = `${year}-${String(fromMonth).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, toMonth, 0)).getUTCDate();
  const validTo = `${year}-${String(toMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  return { validFrom, validTo };
}

function pageCount(html: string, issueSlug: string) {
  const escaped = issueSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const numbers = [...html.matchAll(new RegExp(`href=["']\\/?${escaped}/strana-(\\d+)["']`, 'gi'))]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isInteger(value) && value > 0 && value < 500);
  const count = numbers.length ? Math.max(...numbers) : 0;
  if (!count) throw new Error('Dr. Max nevrátil počet stran aktuálního letáku.');
  return count;
}

async function loadIssueMetaSummary(html: string, issueSlug: string) {
  const issueIds = [...html.matchAll(/<li\b[^>]*>/gi)]
    .map((match) => match[0])
    .filter((tag) => new RegExp(`\\burl=["']${issueSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i').test(tag))
    .map((tag) => Number(tag.match(/\\bid=["']?(\\d+)["']?/i)?.[1] || 0))
    .filter((id) => Number.isInteger(id) && id > 1000);
  const issueId = issueIds.sort((a, b) => b - a)[0];
  if (!issueId) throw new Error('Dr. Max nevrátil ID vydání pro zdrojová metadata.');
  const url = `https://triobodistribution.blob.core.windows.net/iss${issueId}f/issueMeta.json`;
  const response = await fetch(url, { headers: { ...HEADERS, accept: 'application/json,*/*' } });
  if (!response.ok) throw new Error(`Triobo issueMeta ${url} HTTP ${response.status}`);
  const metadata = await response.json();
  const sources = metadata?.freeSources || metadata?.sources || null;
  return {
    issue_id: Number(issueId),
    container_url: url,
    top_level_keys: Object.keys(metadata || {}),
    source_kind: Array.isArray(sources) ? 'array' : typeof sources,
    source_count: Array.isArray(sources) ? sources.length : sources && typeof sources === 'object' ? Object.keys(sources).length : 0,
    source_sample: Array.isArray(sources)
      ? sources.slice(0, 3)
      : sources && typeof sources === 'object'
        ? Object.fromEntries(Object.entries(sources).slice(0, 3))
        : null,
  };
}

async function loadCurrentIssue(): Promise<Issue> {
  const listing = await fetchHtml(SOURCE_URL);
  const issueSlug = currentIssueSlug(listing.html);
  const issueUrl = `${SOURCE_URL.replace(/\/$/, '')}/${issueSlug}`;
  const issue = await fetchHtml(issueUrl);
  const validity = dateFromIssueSlug(issueSlug);
  const issueMetaSummary = await loadIssueMetaSummary(listing.html, issueSlug);
  const coverUrl = meta(issue.html, 'og:image') || null;
  const pages = pageCount(issue.html, issueSlug);
  const pageImageUrls = await Promise.all(Array.from({ length: pages }, async (_, index) => {
    const pageUrl = `${issueUrl}/strana-${index + 1}`;
    const page = await fetchHtml(pageUrl);
    const image = meta(page.html, 'og:image');
    const parsed = new URL(image);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'triobodistribution.blob.core.windows.net' || !/^\/public\/ogPreview\d+\.jpg$/i.test(parsed.pathname)) {
      throw new Error(`Dr. Max strana ${index + 1} nevrátila povolený oficiální obrázek.`);
    }
    return parsed.toString();
  }));
  const rawTitle = meta(issue.html, 'og:title')
    || decodeHtml(issue.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const title = rawTitle.replace(/\s*\|\s*Leták Dr\.Max\s*$/i, '').trim() || issueSlug;
  return {
    issueUrl: issue.finalUrl,
    issueSlug,
    title: `Leták Dr. Max ${title} – ${pages} stran`,
    validFrom: validity.validFrom,
    validTo: validity.validTo,
    pageCount: pages,
    coverUrl,
    pageImageUrls,
    issueMetaSummary,
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
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'dr-max').single();
    if (storeError || !store) throw storeError || new Error('Obchod Dr. Max nebyl nalezen.');

    const { data: source, error: sourceError } = await db.from('leaflet_sources')
      .select('id')
      .eq('store_id', store.id)
      .eq('source_url', SOURCE_URL)
      .eq('is_active', true)
      .single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj Dr. Max nebyl nalezen.');

    const issue = await loadCurrentIssue();
    if (issue.validTo < today) throw new Error('Dr. Max označuje aktuální leták jako ukončený.');

    const sourceHash = await sha256(`${source.id}|${issue.issueUrl}|drmax-triobo-v1`);
    const metadata = {
      adapter: 'drmax-triobo-v1',
      title: issue.title,
      issue_slug: issue.issueSlug,
      page_count: issue.pageCount,
      viewer_url: issue.issueUrl,
      cover_image_url: issue.coverUrl,
      page_image_urls: issue.pageImageUrls,
      issue_meta_summary: issue.issueMetaSummary,
      ocr_required: true,
      ocr_source: 'official_triobo_page_previews',
      source_page: SOURCE_URL,
      last_seen_at: checkedAt,
    };

    const { data: existing, error: existingError } = await db.from('leaflet_imports')
      .select('id,status')
      .eq('source_hash', sourceHash)
      .maybeSingle();
    if (existingError) throw existingError;

    let importId = '';
    if (existing) {
      importId = existing.id;
      const { error } = await db.from('leaflet_imports').update({
        source_document_url: issue.issueUrl,
        status: 'published',
        product_count: 0,
        confidence: 0.99,
        coverage_scope: 'national',
        detected_valid_from: issue.validFrom,
        detected_valid_to: issue.validTo,
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
        source_document_url: issue.issueUrl,
        source_hash: sourceHash,
        status: 'published',
        product_count: 0,
        confidence: 0.99,
        coverage_scope: 'national',
        detected_valid_from: issue.validFrom,
        detected_valid_to: issue.validTo,
        finished_at: checkedAt,
        metadata,
      }).select('id').single();
      if (importError || !imported) throw importError || new Error('Leták Dr. Max se nepodařilo uložit.');
      importId = imported.id;
    }

    const { data: oldImports, error: oldError } = await db.from('leaflet_imports')
      .select('id,source_hash,metadata')
      .eq('source_id', source.id)
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
      last_strategy_used: 'official_triobo_viewer',
      last_strategy_success_at: checkedAt,
    }).eq('id', source.id);

    return json({
      ok: true,
      store: store.name,
      import_id: importId,
      title: issue.title,
      viewer_url: issue.issueUrl,
      cover_url: issue.coverUrl,
      page_count: issue.pageCount,
      page_image_urls: issue.pageImageUrls,
      issue_meta_summary: issue.issueMetaSummary,
      valid_from: issue.validFrom,
      valid_to: issue.validTo,
      expired,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { data: store } = await db.from('stores').select('id').eq('slug', 'dr-max').maybeSingle();
    if (store?.id) {
      await db.from('leaflet_sources').update({
        last_checked_at: checkedAt,
        last_error: message.slice(0, 1000),
      }).eq('store_id', store.id).eq('is_active', true);
    }
    return json({ error: message }, 500);
  }
});
