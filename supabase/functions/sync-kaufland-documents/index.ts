import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://prodejny.kaufland.cz/letak.html';
const ADAPTER = 'kaufland-pdf-v2';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

type Flyer = {
  subcategory: string;
  title: string;
  pdfUrl: string;
  viewerUrl: string | null;
  coverUrl: string | null;
  validFrom: string;
  validTo: string;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}
function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    const parts = [value.message, value.details, value.hint, value.code].filter(Boolean).map(String);
    if (parts.length) return parts.join(' | ');
    try { return JSON.stringify(error); } catch { return String(error); }
  }
  return String(error);
}
function decodeHtml(value: string) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}
function attr(tag: string, name: string) {
  return decodeHtml(tag.match(new RegExp(`${name}=["']([^"']*)["']`, 'i'))?.[1] || '');
}
function isoDate(day: string, month: string, year: string) {
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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
function validity(tag: string, pdfUrl: string) {
  const detail = attr(tag, 'data-aa-detail');
  const detailMatch = detail.match(/(\d{1,2})\.(\d{1,2})\.(20\d{2})\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.(20\d{2})/);
  if (detailMatch) {
    return {
      from: isoDate(detailMatch[1], detailMatch[2], detailMatch[3]),
      to: isoDate(detailMatch[4], detailMatch[5], detailMatch[6]),
    };
  }
  const filename = decodeURIComponent(new URL(pdfUrl).pathname.split('/').pop() || '');
  const fileMatch = filename.match(/-(\d{1,2})-(\d{1,2})-(20\d{2})-(\d{1,2})-(\d{1,2})-(20\d{2})-/);
  if (fileMatch) {
    return {
      from: isoDate(fileMatch[1], fileMatch[2], fileMatch[3]),
      to: isoDate(fileMatch[4], fileMatch[5], fileMatch[6]),
    };
  }
  throw new Error('Kaufland nevrátil platnost PDF letáku.');
}
function safePdf(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'assets.leaflets.schwarz' || !/\.pdf$/i.test(url.pathname)) {
    throw new Error('Kaufland vrátil nepovolenou PDF adresu.');
  }
  return url.toString();
}
function safeViewer(value: string) {
  if (!value) return null;
  const url = new URL(value, SOURCE_URL);
  return url.protocol === 'https:' && url.hostname === 'leaflets.kaufland.com' ? url.toString() : null;
}
function safeCover(value: string) {
  if (!value) return null;
  const url = new URL(value, SOURCE_URL);
  return url.protocol === 'https:' && url.hostname === 'imgproxy.leaflets.schwarz' ? url.toString() : null;
}
function titleFor(subcategory: string, alt: string) {
  const key = subcategory.toLowerCase();
  if (key === 'kdz') return 'Akční leták Kaufland – potraviny';
  if (key === 'hyper1') return 'Kaufland – spotřební zboží';
  if (key === 'wrapper1') return 'Kaufland – měsíční speciál';
  return alt || 'Kaufland – aktuální leták';
}
async function fetchHtml() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch(SOURCE_URL, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    const html = await response.text();
    if (!response.ok) throw new Error(`Kaufland letáky HTTP ${response.status}`);
    if (html.length < 50_000) throw new Error(`Kaufland vrátil podezřele krátkou stránku letáků (${html.length} znaků).`);
    return html;
  } finally {
    clearTimeout(timer);
  }
}
async function probePdf(url: string) {
  const response = await fetch(url, {
    headers: { ...HEADERS, accept: 'application/pdf,*/*;q=0.8', range: 'bytes=0-7' },
    redirect: 'follow',
  });
  if (!response.ok && response.status !== 206) throw new Error(`Kaufland PDF HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    throw new Error('Kaufland místo PDF vrátil jiný obsah.');
  }
}
async function loadFlyers(): Promise<Flyer[]> {
  const html = await fetchHtml();
  const flyers: Flyer[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/<div[^>]+class=["'][^"']*\bm-flyer-tile\b[^"']*["'][^>]*>/gi)) {
    const tag = match[0];
    const rawPdf = attr(tag, 'data-download-url');
    if (!rawPdf) continue;
    const pdfUrl = safePdf(rawPdf);
    if (seen.has(pdfUrl)) continue;
    const block = html.slice(match.index || 0, Math.min(html.length, (match.index || 0) + 18_000));
    const anchor = block.match(/<a[^>]+class=["'][^"']*m-flyer-tile__link[^"']*["'][^>]*>/i)?.[0] || '';
    const image = block.match(/<img[^>]+>/i)?.[0] || '';
    const subcategory = attr(tag, 'data-subcategory');
    const dates = validity(tag, pdfUrl);
    flyers.push({
      subcategory,
      title: titleFor(subcategory, attr(image, 'alt')),
      pdfUrl,
      viewerUrl: safeViewer(attr(anchor, 'href')),
      coverUrl: safeCover(attr(image, 'data-src') || attr(image, 'src')),
      validFrom: dates.from,
      validTo: dates.to,
    });
    seen.add(pdfUrl);
  }
  const today = new Date().toISOString().slice(0, 10);
  const current = flyers.filter((flyer) => flyer.validTo >= today);
  if (!current.length) throw new Error('Kaufland nevrátil žádný aktuální PDF leták.');
  for (const flyer of current) await probePdf(flyer.pdfUrl);
  return current;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  const checkedAt = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  try {
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'kaufland').single();
    if (storeError || !store) throw storeError || new Error('Kaufland nebyl nalezen.');
    const { data: source, error: sourceError } = await db.from('leaflet_sources')
      .select('id').eq('store_id', store.id).eq('source_url', SOURCE_URL).eq('is_active', true).single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj Kaufland nebyl nalezen.');

    const flyers = await loadFlyers();
    const activeHashes = new Set<string>();
    const imports: Array<Record<string, unknown>> = [];
    for (const flyer of flyers) {
      const sourceHash = await sha256(`${source.id}|${flyer.pdfUrl}|${ADAPTER}`);
      activeHashes.add(sourceHash);
      const metadata = {
        adapter: ADAPTER,
        title: flyer.title,
        subcategory: flyer.subcategory,
        viewer_url: flyer.viewerUrl,
        cover_image_url: flyer.coverUrl,
        source_page: SOURCE_URL,
        last_seen_at: checkedAt,
      };
      const { data: existing, error: lookupError } = await db.from('leaflet_imports')
        .select('id').eq('source_hash', sourceHash).maybeSingle();
      if (lookupError) throw lookupError;
      let importId = existing?.id || '';
      if (existing) {
        const { error } = await db.from('leaflet_imports').update({
          source_document_url: flyer.pdfUrl,
          status: 'published',
          product_count: 0,
          confidence: 0.99,
          coverage_scope: 'national',
          detected_valid_from: flyer.validFrom,
          detected_valid_to: flyer.validTo,
          error_message: null,
          finished_at: checkedAt,
          metadata,
          updated_at: checkedAt,
        }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { data: created, error } = await db.from('leaflet_imports').insert({
          source_id: source.id,
          store_id: store.id,
          source_document_url: flyer.pdfUrl,
          source_hash: sourceHash,
          status: 'published',
          product_count: 0,
          confidence: 0.99,
          coverage_scope: 'national',
          detected_valid_from: flyer.validFrom,
          detected_valid_to: flyer.validTo,
          finished_at: checkedAt,
          metadata,
        }).select('id').single();
        if (error || !created) throw error || new Error(`Leták ${flyer.title} se nepodařilo uložit.`);
        importId = created.id;
      }
      imports.push({ id: importId, title: flyer.title, valid_from: flyer.validFrom, valid_to: flyer.validTo });
    }

    const { data: oldImports, error: oldError } = await db.from('leaflet_imports')
      .select('id,source_hash,metadata')
      .eq('source_id', source.id)
      .in('status', ['published', 'review', 'processing'])
      .or('metadata->>adapter.eq.kaufland-pdf-v1,metadata->>adapter.eq.kaufland-pdf-v2');
    if (oldError) throw oldError;
    const expired: string[] = [];
    for (const oldImport of oldImports || []) {
      if (activeHashes.has(String(oldImport.source_hash || ''))) continue;
      const { error } = await db.from('leaflet_imports').update({
        status: 'ignored',
        detected_valid_to: yesterday,
        metadata: { ...(oldImport.metadata || {}), expired_by_source_at: checkedAt },
        updated_at: checkedAt,
      }).eq('id', oldImport.id);
      if (error) throw error;
      expired.push(oldImport.id);
    }

    return json({ ok: true, store: store.name, documents: imports.length, imports, expired });
  } catch (error) {
    return json({ error: formatError(error) }, 500);
  }
});
