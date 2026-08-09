import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://www.jip-potraviny.cz/akcni-letaky/';
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

type JipLeaflet = {
  viewerUrl: string;
  title: string;
  coverUrl: string;
  validFrom: string;
  validTo: string;
  pageCount: number;
  pageImagePath: string;
  locations: string[];
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

async function fetchText(url: string, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${response.url || url} HTTP ${response.status}`);
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

function safeViewerUrl(value: string) {
  const url = new URL(decodeHtml(value), SOURCE_URL);
  if (url.protocol !== 'https:' || url.hostname !== 'www.jip-potraviny.cz') {
    throw new Error('JIP vrátil nepovolenou adresu prohlížeče.');
  }
  if (!/^\/wp-content\/uploads\/file\/[A-Za-z0-9_-]+\/?$/i.test(url.pathname)) {
    throw new Error('JIP vrátil neočekávanou cestu prohlížeče.');
  }
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/?$/, '/');
}

function safeCoverUrl(value: string) {
  const url = new URL(decodeHtml(value), SOURCE_URL);
  if (url.protocol !== 'https:' || url.hostname !== 'www.jip-potraviny.cz') {
    throw new Error('JIP vrátil nepovolený titulní obrázek.');
  }
  if (!/^\/wp-content\/uploads\/20\d{2}\/\d{2}\/[^/]+\.(?:jpg|jpeg|png|webp)$/i.test(url.pathname)) {
    throw new Error('JIP vrátil neočekávaný titulní obrázek.');
  }
  return url.toString();
}

function isoDate(day: string, month: string, year: string) {
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function parseValidity(text: string) {
  const match = decodeHtml(text).match(/Platnost:\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})\s*[-–]\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})/i);
  if (!match) throw new Error('JIP u jednoho letáku nevrátil platnost.');
  return {
    from: isoDate(match[1], match[2], match[3]),
    to: isoDate(match[4], match[5], match[6]),
  };
}

function cardTitle(block: string) {
  return decodeHtml(
    block.match(/class=["'][^"']*i-leaflet__heading-link[^"']*["'][^>]*>([^<]+)</i)?.[1]
      || block.match(/title=["']([^"']+)["']/i)?.[1]
      || '',
  );
}

function cardLocations(block: string, title: string) {
  const locationBlock = block.match(/class=["'][^"']*i-leaflet__locations[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
  const values = [...locationBlock.matchAll(/>([^<>]+)</g)]
    .map((match) => decodeHtml(match[1]))
    .filter((value) => value && value !== title && value.length < 80);
  return [...new Set(values)];
}

async function viewerAssets(viewerUrl: string) {
  const configUrl = new URL('mobile/javascript/config.js', viewerUrl).toString();
  const { text } = await fetchText(configUrl);
  const counts = [...text.matchAll(/bookConfig\.totalPageCount\s*=\s*(\d+)/gi)].map(match => Number(match[1]));
  const pageCount = counts.filter(value => Number.isInteger(value) && value > 0 && value < 500).at(-1) || 0;
  const paths = [...text.matchAll(/bookConfig\.largePath\s*=\s*["']([^"']+)["']/gi)].map(match => match[1]);
  const pageImagePath = paths.at(-1) || '';
  if (!pageCount || !/^files\/(?:mobile|large)\/$/i.test(pageImagePath)) {
    throw new Error('JIP flipbook nevrátil úplnou konfiguraci stránek.');
  }
  const probe = new URL(`${pageImagePath}1.jpg`, viewerUrl).toString();
  const response = await fetch(probe, { method: 'HEAD', headers: HEADERS, redirect: 'follow' });
  if (!response.ok || !(response.headers.get('content-type') || '').toLowerCase().startsWith('image/')) {
    throw new Error('JIP vysoké rozlišení stránek není dostupné.');
  }
  return { pageCount, pageImagePath };
}

async function loadCurrentLeaflets(): Promise<JipLeaflet[]> {
  const { text: html } = await fetchText(SOURCE_URL);
  const leaflets: JipLeaflet[] = [];
  const seen = new Set<string>();
  const pattern = /<article[^>]+class=["'][^"']*\bi-leaflet\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html))) {
    const block = match[0];
    const rawHref = block.match(/href=["']([^"']*\/wp-content\/uploads\/file\/[^"']+)["']/i)?.[1] || '';
    if (!rawHref) continue;
    const viewerUrl = safeViewerUrl(rawHref);
    if (seen.has(viewerUrl)) continue;

    const title = cardTitle(block);
    if (!title) continue;
    const rawCover = block.match(/data-src=["']([^"']+)["']/i)?.[1]
      || block.match(/src=["']([^"']+\.(?:jpg|jpeg|png|webp))["']/i)?.[1]
      || '';
    const coverUrl = safeCoverUrl(rawCover);
    const validity = parseValidity(block.replace(/<[^>]+>/g, ' '));
    const viewer = await fetchText(viewerUrl);
    if (!/Flip PDF/i.test(viewer.text) || !/files\/basic-html\/index\.html/i.test(viewer.text)) {
      throw new Error(`JIP publikace ${title} není platný Flip PDF prohlížeč.`);
    }

    const assets = await viewerAssets(viewerUrl);
    leaflets.push({
      viewerUrl,
      title,
      coverUrl,
      validFrom: validity.from,
      validTo: validity.to,
      pageCount: assets.pageCount,
      pageImagePath: assets.pageImagePath,
      locations: cardLocations(block, title),
    });
    seen.add(viewerUrl);
  }

  const today = new Date().toISOString().slice(0, 10);
  const active = leaflets.filter((leaflet) => leaflet.validTo >= today);
  if (!active.length) throw new Error('JIP nevrátil žádný aktuálně platný leták.');
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
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'jip').single();
    if (storeError || !store) throw storeError || new Error('Obchod JIP nebyl nalezen.');

    const { data: source, error: sourceError } = await db.from('leaflet_sources')
      .select('id')
      .eq('store_id', store.id)
      .eq('source_url', SOURCE_URL)
      .eq('is_active', true)
      .single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj JIP nebyl nalezen.');

    const leaflets = await loadCurrentLeaflets();
    const activeHashes = new Set<string>();
    const imports: Array<{ id: string; title: string; pages: number; valid_from: string; valid_to: string }> = [];

    for (const leaflet of leaflets) {
      const sourceHash = await sha256(`${source.id}|${leaflet.viewerUrl}|jip-flip-pdf-v1`);
      activeHashes.add(sourceHash);
      const pageImageUrls = Array.from({ length: leaflet.pageCount }, (_, index) => new URL(`${leaflet.pageImagePath}${index + 1}.jpg`, leaflet.viewerUrl).toString());
      const metadata = {
        adapter: 'jip-flip-pdf-v1',
        title: `${leaflet.title} – ${leaflet.pageCount} stran`,
        viewer_url: leaflet.viewerUrl,
        cover_image_url: leaflet.coverUrl,
        page_count: leaflet.pageCount,
        page_image_urls: pageImageUrls,
        page_image_width: 1080,
        page_image_height: 1440,
        ocr_required: true,
        ocr_source: 'official_flip_pdf_large_pages',
        locations: leaflet.locations,
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
          source_document_url: leaflet.viewerUrl,
          status: 'published',
          product_count: 0,
          confidence: 0.99,
          coverage_scope: 'national',
          detected_valid_from: leaflet.validFrom,
          detected_valid_to: leaflet.validTo,
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
          source_document_url: leaflet.viewerUrl,
          source_hash: sourceHash,
          status: 'published',
          product_count: 0,
          confidence: 0.99,
          coverage_scope: 'national',
          detected_valid_from: leaflet.validFrom,
          detected_valid_to: leaflet.validTo,
          finished_at: checkedAt,
          metadata,
        }).select('id').single();
        if (importError || !imported) throw importError || new Error(`Leták ${leaflet.title} se nepodařilo uložit.`);
        importId = imported.id;
      }
      imports.push({
        id: importId,
        title: leaflet.title,
        pages: leaflet.pageCount,
        valid_from: leaflet.validFrom,
        valid_to: leaflet.validTo,
      });
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
      last_strategy_used: 'official_flip_pdf_viewers',
      last_strategy_success_at: checkedAt,
    }).eq('id', source.id);

    return json({ ok: true, store: store.name, leaflets, imports, expired });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { data: store } = await db.from('stores').select('id').eq('slug', 'jip').maybeSingle();
    if (store?.id) {
      await db.from('leaflet_sources').update({
        last_checked_at: checkedAt,
        last_error: message.slice(0, 1000),
      }).eq('store_id', store.id).eq('is_active', true);
    }
    return json({ error: message }, 500);
  }
});
