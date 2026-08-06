import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://prodejny.kaufland.cz/letak.html';
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
    .replace(/&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(tag: string, name: string) {
  return decodeHtml(
    tag.match(new RegExp(`${name}=["']([^"']*)["']`, 'i'))?.[1] || '',
  );
}

async function fetchHtml(url: string, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    const html = await response.text();
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return html;
  } finally {
    clearTimeout(timer);
  }
}

function isoDate(day: string, month: string, year: string) {
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
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

  const start = attr(tag, 'data-offer-start-date');
  if (/^20\d{2}-\d{2}-\d{2}$/.test(start)) {
    return { from: start, to: start };
  }
  throw new Error('Kaufland nevrátil platnost jednoho z letáků.');
}

function safePdfUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'assets.leaflets.schwarz') {
    throw new Error('Kaufland vrátil nepovolenou PDF adresu.');
  }
  if (!/^\/leaflets\/pdfs\/[a-f0-9-]+\/[^/]+\.pdf$/i.test(url.pathname)) {
    throw new Error('Kaufland vrátil neočekávaný formát PDF adresy.');
  }
  return url.toString();
}

function safeViewerUrl(value: string) {
  if (!value) return null;
  const url = new URL(value, SOURCE_URL);
  if (url.protocol !== 'https:' || url.hostname !== 'leaflets.kaufland.com') return null;
  return url.toString();
}

function safeCoverUrl(value: string) {
  if (!value) return null;
  const url = new URL(value, SOURCE_URL);
  if (url.protocol !== 'https:' || url.hostname !== 'imgproxy.leaflets.schwarz') return null;
  return url.toString();
}

function flyerTitle(subcategory: string, imageAlt: string) {
  const normalized = subcategory.toLowerCase();
  if (normalized === 'kdz') return 'Akční leták Kaufland – potraviny';
  if (normalized === 'hyper1') return 'Kaufland – spotřební zboží';
  if (normalized === 'wrapper1') return 'Kaufland – měsíční speciál';
  return imageAlt || `Kaufland – ${subcategory || 'aktuální leták'}`;
}

async function probePdf(url: string) {
  const response = await fetch(url, {
    headers: { ...HEADERS, accept: 'application/pdf,*/*;q=0.8', range: 'bytes=0-7' },
    redirect: 'follow',
  });
  if (!response.ok && response.status !== 206) throw new Error(`Kaufland PDF vrátil HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    throw new Error('Kaufland místo PDF vrátil jiný dokument.');
  }
}

async function loadCurrentFlyers(): Promise<Flyer[]> {
  const html = await fetchHtml(SOURCE_URL);
  const flyers: Flyer[] = [];
  const seen = new Set<string>();
  const pattern = /<div[^>]+class=["'][^"']*\bm-flyer-tile\b[^"']*["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    const tag = match[0];
    const rawPdf = attr(tag, 'data-download-url');
    if (!rawPdf) continue;
    const pdfUrl = safePdfUrl(rawPdf);
    if (seen.has(pdfUrl)) continue;

    const block = html.slice(match.index, Math.min(html.length, match.index + 18_000));
    const anchorTag = block.match(/<a[^>]+class=["'][^"']*m-flyer-tile__link[^"']*["'][^>]*>/i)?.[0] || '';
    const imageTag = block.match(/<img[^>]+>/i)?.[0] || '';
    const subcategory = attr(tag, 'data-subcategory');
    const dates = validity(tag, pdfUrl);

    flyers.push({
      subcategory,
      title: flyerTitle(subcategory, attr(imageTag, 'alt')),
      pdfUrl,
      viewerUrl: safeViewerUrl(attr(anchorTag, 'href')),
      coverUrl: safeCoverUrl(attr(imageTag, 'data-src') || attr(imageTag, 'src')),
      validFrom: dates.from,
      validTo: dates.to,
    });
    seen.add(pdfUrl);
  }

  const today = new Date().toISOString().slice(0, 10);
  const active = flyers.filter((flyer) => flyer.validTo >= today);
  if (!active.length) throw new Error('Kaufland nevrátil žádný aktuálně platný PDF leták.');
  for (const flyer of active) await probePdf(flyer.pdfUrl);
  return active;
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
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'kaufland').single();
    if (storeError || !store) throw storeError || new Error('Obchod Kaufland nebyl nalezen.');

    const { data: source, error: sourceError } = await db.from('leaflet_sources')
      .select('id')
      .eq('store_id', store.id)
      .eq('source_url', SOURCE_URL)
      .eq('is_active', true)
      .single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj Kaufland nebyl nalezen.');

    const flyers = await loadCurrentFlyers();
    const activeHashes = new Set<string>();
    const imports: Array<{ id: string; title: string; valid_from: string; valid_to: string }> = [];

    for (const flyer of flyers) {
      const sourceHash = await sha256(`${source.id}|${flyer.pdfUrl}|kaufland-pdf-v1`);
      activeHashes.add(sourceHash);
      const metadata = {
        adapter: 'kaufland-pdf-v1',
        title: flyer.title,
        subcategory: flyer.subcategory,
        viewer_url: flyer.viewerUrl,
        cover_image_url: flyer.coverUrl,
        source_page: SOURCE_URL,
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
          source_document_url: flyer.pdfUrl,
          status: 'published',
          product_count: 0,
          confidence: 0.99,
          coverage_scope: 'national',
          detected_valid_from: flyer.validFrom,
          detected_valid_to: flyer.validTo,
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
        if (importError || !imported) throw importError || new Error(`Leták ${flyer.title} se nepodařilo uložit.`);
        importId = imported.id;
      }
      imports.push({ id: importId, title: flyer.title, valid_from: flyer.validFrom, valid_to: flyer.validTo });
    }

    const { data: oldImports, error: oldError } = await db.from('leaflet_imports')
      .select('id,source_hash,metadata')
      .eq('source_id', source.id)
      .in('status', ['published', 'review', 'publishing'])
      .or(`detected_valid_to.is.null,detected_valid_to.gte.${today}`);
    if (oldError) throw oldError;

    const expired: string[] = [];
    for (const oldImport of oldImports || []) {
      if (activeHashes.has(String(oldImport.source_hash || ''))) continue;
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
      last_strategy_used: 'official_structured_pdfs',
      last_strategy_success_at: checkedAt,
    }).eq('id', source.id);

    return json({ ok: true, store: store.name, flyers, imports, expired });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { data: store } = await db.from('stores').select('id').eq('slug', 'kaufland').maybeSingle();
    if (store?.id) {
      await db.from('leaflet_sources').update({
        last_checked_at: checkedAt,
        last_error: message.slice(0, 1000),
      }).eq('store_id', store.id).eq('is_active', true);
    }
    return json({ error: message }, 500);
  }
});
