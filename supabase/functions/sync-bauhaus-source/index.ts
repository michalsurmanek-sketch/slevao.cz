import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://www.bauhaus.cz/katalogy';
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

type CurrentCatalog = {
  viewerUrl: string;
  title: string;
  validFrom: string;
  validTo: string;
  pageCount: number;
  coverUrl: string | null;
  pdfUrl: string;
  paperGuid: string | null;
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
    .replace(/&#382;|&zcaron;/gi, 'ž')
    .replace(/&#237;|&iacute;/gi, 'í')
    .replace(/&#345;|&rcaron;/gi, 'ř')
    .replace(/&#269;|&ccaron;/gi, 'č')
    .replace(/&#283;|&ecaron;/gi, 'ě')
    .replace(/&#225;|&aacute;/gi, 'á')
    .replace(/&#233;|&eacute;/gi, 'é')
    .replace(/&#253;|&yacute;/gi, 'ý')
    .replace(/&#367;|&uring;/gi, 'ů')
    .replace(/&#250;|&uacute;/gi, 'ú')
    .replace(/&#243;|&oacute;/gi, 'ó')
    .replace(/&#328;|&ncaron;/gi, 'ň')
    .replace(/&#353;|&scaron;/gi, 'š')
    .replace(/&#357;|&tcaron;/gi, 'ť')
    .replace(/&#271;|&dcaron;/gi, 'ď')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      headers: { ...BROWSER_HEADERS, ...(init.headers || {}) },
      redirect: init.redirect || 'follow',
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

function isoDate(day: string, month: string, year: string) {
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function parseValidity(value: string) {
  const decoded = decodeHtml(value);
  const match = decoded.match(/Platnost katalogu:\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})\s*(?:až|[-–])\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})/i)
    || decoded.match(/plat[íi]\s+od\s+(\d{1,2})\.\s*(\d{1,2})\.\s*do\s+(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})/i);
  if (!match) throw new Error('BAUHAUS nevrátil platnost aktuálního katalogu.');
  if (match.length === 7) {
    return {
      from: isoDate(match[1], match[2], match[3]),
      to: isoDate(match[4], match[5], match[6]),
    };
  }
  return {
    from: isoDate(match[1], match[2], match[5]),
    to: isoDate(match[3], match[4], match[5]),
  };
}

function currentCatalogBlock(html: string) {
  const marker = html.toLocaleLowerCase('cs').indexOf('aktu&aacute;ln&iacute; katalog');
  const fallback = html.toLocaleLowerCase('cs').indexOf('aktuální katalog');
  const index = marker >= 0 ? marker : fallback;
  if (index < 0) throw new Error('BAUHAUS stránka neobsahuje sekci aktuálního katalogu.');
  return html.slice(index, Math.min(html.length, index + 80_000));
}

function firstCatalogUrl(block: string) {
  const match = block.match(/href=["'](https:\/\/katalogy\.bauhaus\.cz\/katalog-[^"'?#]+\/?)["']/i);
  if (!match) throw new Error('BAUHAUS nevrátil adresu aktuálního katalogu.');
  const url = new URL(decodeHtml(match[1]));
  if (url.protocol !== 'https:' || url.hostname !== 'katalogy.bauhaus.cz') {
    throw new Error('BAUHAUS vrátil nepovolenou adresu katalogu.');
  }
  return url.toString();
}

function listingCover(block: string) {
  const linkIndex = block.search(/href=["']https:\/\/katalogy\.bauhaus\.cz\/katalog-/i);
  const sample = linkIndex >= 0 ? block.slice(linkIndex, linkIndex + 14_000) : block;
  const image = sample.match(/<img[^>]+src=["'](https:\/\/media\.bauhaus\.cz\/[^"']+)["']/i)?.[1]
    || sample.match(/srcset=["'](https:\/\/media\.bauhaus\.cz\/[^"'\s]+)["']/i)?.[1]
    || null;
  return image ? decodeHtml(image) : null;
}

function meta(html: string, property: string) {
  return decodeHtml(
    html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1]
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'))?.[1]
      || '',
  );
}

function pageCount(html: string) {
  const pages = html.match(/"pages"\s*:\s*\[([^\]]+)\]/i)?.[1] || '';
  const count = (pages.match(/\d+/g) || []).length;
  const ogCount = Number(meta(html, 'og:image').match(/"PageCount"\s*:\s*(\d+)/i)?.[1] || 0);
  const result = count || ogCount;
  if (!result) throw new Error('BAUHAUS nevrátil počet stran katalogu.');
  return result;
}

function paperGuid(html: string) {
  return html.match(/iPaper\/Papers\/([0-9a-f-]{36})\//i)?.[1]
    || meta(html, 'og:image').match(/"PaperGuid"\s*:\s*"([0-9a-f-]{36})"/i)?.[1]
    || null;
}

async function resolvePdf(viewerUrl: string) {
  const endpoint = new URL('GetPDF.ashx', viewerUrl).toString();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      ...BROWSER_HEADERS,
      accept: 'application/pdf,*/*;q=0.8',
      referer: viewerUrl,
      origin: 'https://katalogy.bauhaus.cz',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ pageNumbers: '' }).toString(),
    redirect: 'manual',
  });
  if (![301, 302, 303, 307, 308].includes(response.status)) {
    throw new Error(`BAUHAUS PDF endpoint vrátil HTTP ${response.status}.`);
  }
  const location = response.headers.get('location') || '';
  const url = new URL(location, endpoint);
  if (url.protocol !== 'https:' || url.hostname !== 'cdn.ipaper.io' || !/\/iPaper\/Papers\/[0-9a-f-]{36}\/Download\.pdf$/i.test(url.pathname)) {
    throw new Error('BAUHAUS PDF endpoint vrátil nepovolený dokument.');
  }

  const probe = await fetch(url, {
    headers: { ...BROWSER_HEADERS, accept: 'application/pdf,*/*;q=0.8', range: 'bytes=0-7', referer: viewerUrl },
    redirect: 'follow',
  });
  if (!probe.ok && probe.status !== 206) throw new Error(`BAUHAUS PDF vrátil HTTP ${probe.status}.`);
  const bytes = new Uint8Array(await probe.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    throw new Error('BAUHAUS místo PDF vrátil jiný typ dokumentu.');
  }
  return url.toString();
}

async function loadCurrentCatalog(): Promise<CurrentCatalog> {
  const listing = await fetchText(SOURCE_URL);
  const block = currentCatalogBlock(listing.text);
  const viewerUrl = firstCatalogUrl(block);
  const validity = parseValidity(block);
  const listingImage = listingCover(block);

  const viewer = await fetchText(viewerUrl);
  const title = meta(viewer.text, 'og:title')
    || decodeHtml(viewer.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')
    || 'Aktuální katalog BAUHAUS';
  const coverUrl = meta(viewer.text, 'og:image') || listingImage;
  const pdfUrl = await resolvePdf(viewerUrl);

  return {
    viewerUrl,
    title: title.replace(/\s*\|\s*BAUHAUS\s*$/i, '').trim() || 'Aktuální katalog BAUHAUS',
    validFrom: validity.from,
    validTo: validity.to,
    pageCount: pageCount(viewer.text),
    coverUrl: coverUrl || null,
    pdfUrl,
    paperGuid: paperGuid(viewer.text),
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
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'bauhaus').single();
    if (storeError || !store) throw storeError || new Error('Obchod BAUHAUS nebyl nalezen.');

    const { data: source, error: sourceError } = await db.from('leaflet_sources')
      .select('id')
      .eq('store_id', store.id)
      .eq('source_url', SOURCE_URL)
      .eq('is_active', true)
      .single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj BAUHAUS nebyl nalezen.');

    const catalog = await loadCurrentCatalog();
    if (catalog.validTo < today) throw new Error('BAUHAUS označuje hlavní katalog jako ukončený.');

    const sourceHash = await sha256(`${source.id}|${catalog.viewerUrl}|bauhaus-ipaper-v1`);
    const metadata = {
      adapter: 'bauhaus-ipaper-v1',
      title: `${catalog.title} – ${catalog.pageCount} stran`,
      viewer_url: catalog.viewerUrl,
      cover_image_url: catalog.coverUrl,
      page_count: catalog.pageCount,
      paper_guid: catalog.paperGuid,
      source_page: SOURCE_URL,
      signed_pdf_refreshed_at: checkedAt,
      last_seen_at: checkedAt,
    };

    const { data: existing, error: existingError } = await db.from('leaflet_imports')
      .select('id,status')
      .eq('source_hash', sourceHash)
      .maybeSingle();
    if (existingError) throw existingError;

    let created: { id: string; title: string; url: string } | null = null;
    let refreshed: { id: string; title: string; url: string } | null = null;
    if (existing) {
      const { error } = await db.from('leaflet_imports').update({
        source_document_url: catalog.pdfUrl,
        detected_valid_from: catalog.validFrom,
        detected_valid_to: catalog.validTo,
        coverage_scope: 'national',
        confidence: 0.99,
        metadata,
        updated_at: checkedAt,
      }).eq('id', existing.id);
      if (error) throw error;
      refreshed = { id: existing.id, title: metadata.title, url: catalog.pdfUrl };
    } else {
      const { data: imported, error: importError } = await db.from('leaflet_imports').insert({
        source_id: source.id,
        store_id: store.id,
        source_document_url: catalog.pdfUrl,
        source_hash: sourceHash,
        status: 'review',
        product_count: 0,
        confidence: 0.99,
        coverage_scope: 'national',
        detected_valid_from: catalog.validFrom,
        detected_valid_to: catalog.validTo,
        finished_at: checkedAt,
        metadata,
      }).select('id').single();
      if (importError || !imported) throw importError || new Error('BAUHAUS katalog se nepodařilo uložit.');
      created = { id: imported.id, title: metadata.title, url: catalog.pdfUrl };
    }

    const { data: oldImports, error: oldError } = await db.from('leaflet_imports')
      .select('id,source_hash,metadata')
      .eq('source_id', source.id)
      .in('status', ['published', 'review', 'publishing'])
      .or(`detected_valid_to.is.null,detected_valid_to.gte.${today}`);
    if (oldError) throw oldError;
    const expired: string[] = [];
    for (const oldImport of oldImports || []) {
      if (oldImport.source_hash === sourceHash) continue;
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
      last_strategy_used: 'official_ipaper_pdf',
      last_strategy_success_at: checkedAt,
    }).eq('id', source.id);

    return json({
      ok: true,
      store: store.name,
      catalog: {
        title: metadata.title,
        viewer_url: catalog.viewerUrl,
        valid_from: catalog.validFrom,
        valid_to: catalog.validTo,
        page_count: catalog.pageCount,
        cover_url: catalog.coverUrl,
        paper_guid: catalog.paperGuid,
      },
      created,
      refreshed,
      expired,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { data: store } = await db.from('stores').select('id').eq('slug', 'bauhaus').maybeSingle();
    if (store?.id) {
      await db.from('leaflet_sources').update({
        last_checked_at: checkedAt,
        last_error: message.slice(0, 1000),
      }).eq('store_id', store.id).eq('is_active', true);
    }
    return json({ error: message }, 500);
  }
});
