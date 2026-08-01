import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PROCESSOR_URL = Deno.env.get('LEAFLET_PROCESSOR_URL') || `${SUPABASE_URL}/functions/v1/process-leaflet`;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Tyto obchody mají vlastní synchronizátory spuštěné z run-leaflet-import.
// Generický průzkum by u nich vytvářel duplicitní nebo nesouvisející importy.
const SPECIALIZED_SOURCE_SLUGS = new Set(['coop', 'hruska']);

const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/pdf,application/json,image/webp,image/png,image/jpeg,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
  'cache-control': 'no-cache',
};

const LEAFLET_HINTS = [
  'letak', 'leták', 'leaflet', 'catalog', 'katalog', 'akcni', 'akční',
  'offers', 'nabidk', 'prospekt', 'brochure', 'flipbook', 'weekly', 'page', 'strana',
];

const REJECT_HINTS = [
  'favicon', 'apple-touch-icon', 'logo', 'sprite', 'placeholder', 'avatar', 'tracking',
  'pixel', 'analytics', 'icon-', '/icon/', '/icons/', 'manifest', 'social', 'facebook',
  'instagram', 'youtube', 'linkedin', 'twitter', 'banner', 'hero', 'teaser', 'thumbnail',
  'thumb', 'preview', 'promo', 'mobile', 'phone', 'smartphone', 'ruka-', 'hand-',
  'app-store', 'google-play', 'header', 'footer', 'navigation', 'nav-', 'background',
  'bg-', 'cover-small', 'cookie', 'consent', 'newsletter', 'privacy', 'gdpr',
  'ochrana-osobnich', 'ochrane-osobnich', 'udrzitel', 'sustainability', 'vyrocni-zprava',
  'annual-report', 'obchodni-podminky', 'terms-and-conditions', 'press-release',
];

const STORE_RULES: Record<string, { allowHosts: string[]; boosts: string[] }> = {
  kaufland: { allowHosts: ['kaufland.cz', 'kaufland.com'], boosts: ['letak', 'prospekt', 'page'] },
  albert: { allowHosts: ['albert.cz', 'letaky.albert.cz'], boosts: ['letak', 'cover_page', 'page'] },
  tesco: { allowHosts: ['itesco.cz', 'tesco.com'], boosts: ['letak', 'catalog', 'leaflet'] },
  billa: { allowHosts: ['billa.cz', 'shopfully.cloud'], boosts: ['letak', 'prospekt', 'page'] },
  lidl: { allowHosts: ['lidl.cz', 'lidl.com', 'leaflets.schwarz'], boosts: ['letak', 'prospekt', 'page'] },
  globus: { allowHosts: ['globus.cz'], boosts: ['letak', 'prospekt', 'page'] },
  penny: { allowHosts: ['penny.cz', 'penny.eu'], boosts: ['letak', 'prospekt', 'page'] },
  makro: { allowHosts: ['makro.cz', 'metro-group.com'], boosts: ['katalog', 'letak', 'catalog'] },
};

const STORE_SOURCE_FALLBACKS: Record<string, string[]> = {
  lidl: [
    'https://www.lidl.cz/c/akcni-letak/s10008644',
    'https://www.lidl.cz/c/akcni-letak/s10008880',
  ],
  makro: [
    'https://letaky.makro.cz/ultra-fresh-nabidka',
    'https://www.makro.cz/aktualni-nabidka',
  ],
  globus: [
    'https://www.globus.cz/globus/letaky/aktualni',
    'https://www.globus.cz/olomouc/letaky/aktualni',
  ],
  tesco: [
    'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy',
    'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy/tesco-hypermarket-uherske-hradiste',
  ],
};

function absoluteUrl(base: string, href: string): string | null {
  try { return new URL(href, base).toString(); } catch { return null; }
}

function normalizedUrl(url: string): string {
  try {
    const parsed = new URL(url.replace(/&amp;/g, '&'));
    parsed.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid'].forEach((key) => parsed.searchParams.delete(key));
    if (/\.(?:jpg|jpeg|png|webp|avif)$/i.test(parsed.pathname)) {
      ['w', 'width', 'h', 'height', 'q', 'quality', 'dpr', 'fm', 'fit', 'crop'].forEach((key) => parsed.searchParams.delete(key));
    }
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return url.replace(/&amp;/g, '&');
  }
}

function candidateScore(url: string, storeSlug = ''): number {
  const lower = decodeURIComponent(url).toLocaleLowerCase('cs');
  if (REJECT_HINTS.some((hint) => lower.includes(hint))) return -100;

  let score = 0;
  if (/\.pdf(?:\?|$)/i.test(lower)) score += 100;
  const isImage = /\.(jpg|jpeg|png|webp|avif)(?:\?|$)/i.test(lower);
  if (!isImage && !/\.pdf(?:\?|$)/i.test(lower)) return -100;
  if (
    storeSlug === 'tesco' &&
    isImage &&
    !/(?:page|strana|spread|doublepage|cover_page)[-_]?\d{1,4}/i.test(lower) &&
    !/[?&](?:w|width|h|height)=([1-9]\d{3,})/i.test(lower)
  ) return -100;

  if (LEAFLET_HINTS.some((hint) => lower.includes(hint))) score += 30;
  if (/(?:page|strana|spread|doublepage|cover_page)[-_]?\d{0,4}/i.test(lower)) score += 45;
  if (/\b(?:a4|a3|210x297|2480x3508|web_leaflet)\b/i.test(lower)) score += 20;
  if (/[?&](?:w|width)=([1-9]\d{3,})/i.test(lower)) score += 10;
  if (/[?&](?:h|height)=([1-9]\d{3,})/i.test(lower)) score += 10;

  const rule = STORE_RULES[storeSlug];
  if (rule) {
    try {
      const host = new URL(url).hostname;
      if (rule.allowHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) score += 20;
      if (rule.boosts.some((hint) => lower.includes(hint))) score += 20;
    } catch { /* ignore */ }
  }
  return score;
}

function filterStoreDocuments(documents: string[], storeSlug = ''): string[] {
  if (storeSlug === 'makro') {
    const pageImages = documents.filter((url) => {
      try {
        const pathname = new URL(url).pathname;
        return /\/pages\/[^/]+-at1600\.(?:jpg|jpeg|png)$/i.test(pathname);
      } catch {
        return /\/pages\/[^/]+-at1600\.(?:jpg|jpeg|png)(?:\?|$)/i.test(url);
      }
    });
    if (pageImages.length) return pageImages.slice(0, 1);

    const pdfs = documents.filter((url) => {
      try { return /\.pdf$/i.test(new URL(url).pathname); }
      catch { return /\.pdf(?:\?|$)/i.test(url); }
    });
    return pdfs.slice(0, 1);
  }

  if (storeSlug !== 'tesco') return documents;

  const pdfs = documents.filter((url) => {
    try { return /\.pdf$/i.test(new URL(url).pathname); }
    catch { return /\.pdf(?:\?|$)/i.test(url); }
  });
  if (!pdfs.length) return documents.filter((url) => !/\.avif(?:\?|$)/i.test(url));

  const dated = pdfs.map((url) => {
    const match = decodeURIComponent(url).match(/(?:^|[_/-])(\d{4})_P(\d{1,2})(?:[_./-]|$)/i);
    return { url, issue: match ? Number(match[1]) * 100 + Number(match[2]) : null };
  });
  const newestIssue = Math.max(...dated.flatMap((item) => item.issue === null ? [] : [item.issue]));

  return Number.isFinite(newestIssue)
    ? dated.filter((item) => item.issue === newestIssue).map((item) => item.url)
    : pdfs;
}

function extractDocumentCandidates(text: string, baseUrl: string, storeSlug = ''): string[] {
  const urls = new Map<string, number>();
  const patterns = [
    /(?:href|src|data-src|data-url|data-image|content)=["']([^"']+\.(?:pdf|jpg|jpeg|png|webp|avif)(?:\?[^"']*)?)["']/gi,
    /srcset=["']([^"']+)["']/gi,
    /(?:pdfUrl|pdf_url|downloadUrl|download_url|documentUrl|document_url|leafletUrl|leaflet_url|catalogUrl|catalog_url|imageUrl|image_url|pages|pageImage|page_image)["']?\s*[:=]\s*["']([^"']+)["']/gi,
    /https?:\/\/[^\s"'<>\\]+\.(?:pdf|jpg|jpeg|png|webp|avif)(?:\?[^\s"'<>\\]*)?/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const raw = match[1] || match[0];
      const variants = raw.includes(',') ? raw.split(',').map((part) => part.trim().split(/\s+/)[0]) : [raw];
      for (const variant of variants) {
        const absolute = absoluteUrl(baseUrl, variant.replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&'));
        if (!absolute) continue;
        const url = normalizedUrl(absolute);
        const score = candidateScore(url, storeSlug);
        if (score >= 60) urls.set(url, Math.max(score, urls.get(url) || 0));
      }
    }
  }

  return [...urls.entries()].sort((a, b) => b[1] - a[1]).map(([url]) => url);
}

function extractLinkedResources(html: string, baseUrl: string): string[] {
  const resources = new Set<string>();
  const pattern = /<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const absolute = absoluteUrl(baseUrl, match[1]);
    if (!absolute) continue;
    try {
      const url = new URL(absolute);
      const base = new URL(baseUrl);
      if (url.hostname === base.hostname && /\.(?:js|json)(?:\?|$)/i.test(url.pathname + url.search)) resources.add(url.toString());
    } catch { /* ignore */ }
  }
  return [...resources].slice(0, 10);
}

async function fetchWithRetry(url: string, accept = BROWSER_HEADERS.accept): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { ...BROWSER_HEADERS, accept, referer: new URL(url).origin + '/' },
        redirect: 'follow',
      });
      if (response.ok) return response;
      lastError = new Error(`HTTP ${response.status}`);
      if (![403, 429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 700));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Stažení selhalo'));
}

async function discoverFromHtml(html: string, pageUrl: string, storeSlug: string): Promise<string[]> {
  const found = new Set(extractDocumentCandidates(html, pageUrl, storeSlug));
  if (found.size >= 4) return [...found];

  for (const resourceUrl of extractLinkedResources(html, pageUrl)) {
    try {
      const response = await fetchWithRetry(resourceUrl, 'application/javascript,application/json,text/plain,*/*;q=0.7');
      const text = await response.text();
      for (const candidate of extractDocumentCandidates(text, response.url, storeSlug)) found.add(candidate);
      if (found.size >= 12) break;
    } catch (error) {
      console.warn('Linked resource skipped', resourceUrl, error instanceof Error ? error.message : String(error));
    }
  }
  return [...found];
}


function parseNuxtPayload(html: string): any {
  const match = html.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('Stránka Globusu neobsahuje strukturovaná data.');
  const payload = JSON.parse(match[1]);
  const cache = new Map<number, any>();
  const resolve = (index: any): any => {
    if (typeof index !== 'number') return index;
    if (index < 0) return index === -1 ? undefined : index === -2 ? Number.NaN : index === -3 ? Infinity : index === -4 ? -Infinity : index === -5 ? -0 : null;
    if (cache.has(index)) return cache.get(index);
    const value = payload[index];
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      if (typeof value[0] === 'string' && ['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef'].includes(value[0])) return resolve(value[1]);
      if (value[0] === 'Date') return resolve(value[1]);
      const result: any[] = [];
      cache.set(index, result);
      for (const item of value) result.push(resolve(item));
      return result;
    }
    const result: Record<string, any> = {};
    cache.set(index, result);
    for (const [key, item] of Object.entries(value)) result[key] = resolve(item);
    return result;
  };
  return resolve(0);
}

function globusProductsFromHtml(html: string): { products: any[]; totalCount: number } {
  const root = parseNuxtPayload(html);
  const data = root?.data || {};
  const listing = Object.entries(data).find(([key]) => key.startsWith('actionOfferProductListing-'))?.[1] as any;
  if (!listing || !Array.isArray(listing.products)) throw new Error('Globus nevrátil produkty aktuálního letáku.');
  return { products: listing.products, totalCount: Number(listing.totalCount || listing.products.length) };
}

function globusCampaign(items: any[]): { validFrom: string; validTo: string; signature: string } {
  const today = new Date().toISOString().slice(0, 10);
  const active = items.map((item: any) => ({
    from: String(item?.productInHouse?.priceValidFrom || '').slice(0, 10),
    to: String(item?.productInHouse?.priceValidTo || '').slice(0, 10),
  })).filter((range: any) => /^\d{4}-\d{2}-\d{2}$/.test(range.from) && /^\d{4}-\d{2}-\d{2}$/.test(range.to) && range.from <= today && range.to >= today);
  if (!active.length) throw new Error('Globus nevrátil žádnou právě platnou akční nabídku.');
  const validTo = active.map((range: any) => range.to).sort()[0];
  const starts = active.filter((range: any) => range.to === validTo).map((range: any) => range.from);
  const validFrom = [...new Set(starts)].sort((a, b) => starts.filter((v) => v === b).length - starts.filter((v) => v === a).length)[0];
  return { validFrom, validTo, signature: validFrom + '|' + validTo };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isDue(source: any, now = Date.now()): boolean {
  if (!source.last_checked_at) return true;
  const interval = Math.max(15, Number(source.check_interval_minutes || 360));
  return new Date(source.last_checked_at).getTime() + interval * 60_000 <= now;
}

async function queueProcessor(importId: string) {
  const response = await fetch(PROCESSOR_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'x-cron-secret': CRON_SECRET },
    body: JSON.stringify({ import_id: importId }),
  });
  if (!response.ok) throw new Error(`Processor HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 500)}`);
}

async function discoverSource(source: any) {
  const checkedAt = new Date().toISOString();
  const storeSlug = String(source.stores?.slug || '');
  try {
    const staleCutoff = new Date(Date.now() - 35 * 60_000).toISOString();
    const { data: staleJobs, error: staleError } = await db.from('leaflet_imports')
      .select('id,source_hash')
      .eq('source_id', source.id)
      .in('status', ['queued', 'downloading', 'processing'])
      .lt('updated_at', staleCutoff);
    if (staleError) throw staleError;

    for (const staleJob of staleJobs || []) {
      const { error: cleanupError } = await db.from('leaflet_imports').update({
        source_hash: `${staleJob.source_hash}:stale:${staleJob.id}:${Date.now()}`,
        status: 'failed',
        error_message: 'Automatické zpracování překročilo časový limit a bylo bezpečně ukončeno.',
        finished_at: new Date().toISOString(),
      }).eq('id', staleJob.id);
      if (cleanupError) throw cleanupError;
    }
    let response: Response | null = null;
    if (storeSlug === 'lidl') {
      response = await fetchWithRetry(
        'https://endpoints.leaflets.schwarz/v4/overview?client_locale=lidl%2Fcs-CZ',
        'application/json,*/*;q=0.8',
      );
    } else {
      const sourceUrls = [...new Set([
        source.source_url,
        ...(STORE_SOURCE_FALLBACKS[storeSlug] || []),
      ])];
      let lastSourceError: unknown;
      for (const sourceUrl of sourceUrls) {
        try {
          response = await fetchWithRetry(sourceUrl);
          break;
        } catch (error) {
          lastSourceError = error;
          console.warn('Source URL skipped', sourceUrl, error instanceof Error ? error.message : String(error));
        }
      }
      if (!response) throw lastSourceError instanceof Error ? lastSourceError : new Error('Všechny oficiální adresy zdroje selhaly.');
    }
    const contentType = response.headers.get('content-type') || '';
    const etag = response.headers.get('etag') || '';
    const lastModified = response.headers.get('last-modified') || '';
    let documents: string[] = [];
    let adapterMetadata: Record<string, unknown> = {};
    let globusCampaignSignature = '';
    let adapter = storeSlug && STORE_RULES[storeSlug] ? `store:${storeSlug}` : 'generic';

    if (storeSlug === 'lidl') {
      const overview = await response.json();
      const today = new Date().toISOString().slice(0, 10);
      const flyers = (overview.categories || []).flatMap((category: any) =>
        (category.subcategories || []).flatMap((subcategory: any) =>
          String(subcategory.name || '').toLocaleLowerCase('cs').includes('akční letáky')
            ? (subcategory.flyers || [])
            : []
        )
      ).filter((flyer: any) =>
        flyer.isActive !== false
        && typeof flyer.pdfUrl === 'string'
        && flyer.pdfUrl.startsWith('https://')
        && String(flyer.offerStartDate || flyer.startDate || '') <= today
        && String(flyer.offerEndDate || flyer.endDate || '') >= today
      ).sort((a: any, b: any) =>
        String(b.offerStartDate || b.startDate || '').localeCompare(String(a.offerStartDate || a.startDate || ''))
      );
      if (!flyers.length) throw new Error('Oficiální Lidl API nevrátilo právě platný akční leták.');
      documents = [normalizedUrl(flyers[0].pdfUrl)];
      adapter = 'store:lidl-api';
    } else if (source.source_type === 'pdf' || contentType.includes('application/pdf') || /\.pdf(?:\?|$)/i.test(response.url)) {
      documents = [normalizedUrl(response.url)];
    } else if (contentType.startsWith('image/') || /\.(jpg|jpeg|png|webp|avif)(?:\?|$)/i.test(response.url)) {
      documents = candidateScore(response.url, storeSlug) >= 30 ? [normalizedUrl(response.url)] : [];
    } else if (source.source_type === 'json' || contentType.includes('application/json')) {
      documents = extractDocumentCandidates(JSON.stringify(await response.json()), response.url, storeSlug);
    } else {
      const html = await response.text();
      if (storeSlug === 'globus') {
        const listingUrl = 'https://www.globus.cz/olomouc/letaky/aktualni';
        const listingResponse = response.url === listingUrl
          ? response
          : await fetchWithRetry(listingUrl, 'text/html,application/xhtml+xml,*/*;q=0.8');
        const listingHtml = listingResponse === response ? html : await listingResponse.text();
        const listing = globusProductsFromHtml(listingHtml);
        const campaign = globusCampaign(listing.products);
        documents = [listingUrl];
        adapter = 'store:globus-html';
        globusCampaignSignature = campaign.signature;
        adapterMetadata = {
          campaign_valid_from: campaign.validFrom,
          campaign_valid_to: campaign.validTo,
          listing_total_items: listing.totalCount,
          highlighted_products: listing.products.length,
        };
      } else {
        documents = await discoverFromHtml(html, response.url, storeSlug);
      }
    }

    documents = filterStoreDocuments([...new Set(documents)], storeSlug)
      .sort((a, b) => candidateScore(b, storeSlug) - candidateScore(a, storeSlug))
      .slice(0, storeSlug === 'tesco' ? 3 : 8);

    if (!documents.length) throw new Error(`Adaptér ${adapter} nenašel PDF ani dostatečně velké stránky letáku.`);

    let created = 0;
    for (const documentUrl of documents) {
      const sourceHash = await sha256(['lidl', 'globus'].includes(storeSlug)
        ? `${source.id}|${documentUrl}|${globusCampaignSignature || 'legacy'}|globus-html-v2`
        : storeSlug === 'makro'
          ? `${source.id}|${documentUrl}|makro-v3`
          : storeSlug === 'kaufland'
            ? `${source.id}|${documentUrl}|${etag}|${lastModified}|kaufland-images-v1`
            : storeSlug === 'billa'
              ? `${source.id}|${documentUrl}|${etag}|${lastModified}|billa-images-v2`
              : `${source.id}|${documentUrl}|${etag}|${lastModified}`);
      const { data: existing, error: existingError } = await db.from('leaflet_imports')
        .select('id,status,updated_at')
        .eq('source_hash', sourceHash)
        .maybeSingle();
      if (existingError) throw existingError;

      if (existing) {
        const ageMs = Date.now() - new Date(existing.updated_at || 0).getTime();
        const staleProcessing = ['queued', 'downloading', 'processing'].includes(String(existing.status || ''))
          && ageMs >= 35 * 60_000;
        const retryableFailure = existing.status === 'failed' && ageMs >= 60 * 60_000;
        if (!staleProcessing && !retryableFailure) continue;

        const { error: archiveError } = await db.from('leaflet_imports').update({
          source_hash: `${sourceHash}:archived:${existing.id}:${Date.now()}`,
          ...(staleProcessing ? {
            status: 'failed',
            error_message: 'Automatické zpracování překročilo časový limit a bude bezpečně zopakováno.',
            finished_at: new Date().toISOString(),
          } : {}),
        }).eq('id', existing.id);
        if (archiveError) throw archiveError;
      }

      const { data, error } = await db.from('leaflet_imports').upsert({
        source_id: source.id,
        store_id: source.store_id,
        source_document_url: documentUrl,
        source_hash: sourceHash,
        status: 'queued',
        coverage_scope: source.coverage_scope || 'national',
        region_code: source.region_code || null,
        city_name: source.city_name || null,
        store_location_name: source.store_location_name || null,
        metadata: {
          discovered_at: checkedAt,
          source_name: source.name,
          source_etag: etag || null,
          source_last_modified: lastModified || null,
          candidate_filter: 'leaflet-v4-adapters',
          adapter,
          ...adapterMetadata,
          candidate_score: candidateScore(documentUrl, storeSlug),
        },
      }, { onConflict: 'source_hash', ignoreDuplicates: true }).select('id,status').maybeSingle();

      if (error) throw error;
      if (data?.id) {
        created++;
        await queueProcessor(data.id);
      }
    }

    await db.from('leaflet_sources').update({ last_checked_at: checkedAt, last_success_at: checkedAt, last_error: null }).eq('id', source.id);
    return { source: source.name, adapter, found: documents.length, queued: created };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from('leaflet_sources').update({ last_checked_at: checkedAt, last_error: message.slice(0, 2000) }).eq('id', source.id);
    return { source: source.name, adapter: storeSlug ? `store:${storeSlug}` : 'generic', error: message };
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok');
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  // Fail closed. A missing secret is a deployment error, never a reason to make
  // the discovery endpoint public.
  if (!CRON_SECRET) {
    console.error('discover-leaflets: CRON_SECRET is not configured');
    return Response.json({ error: 'Automation is not configured' }, { status: 503 });
  }

  const authorization = request.headers.get('authorization') || '';
  const allowedByService = authorization === `Bearer ${SERVICE_ROLE_KEY}`;
  const allowedByCron = request.headers.get('x-cron-secret') === CRON_SECRET;
  if (!allowedByService && !allowedByCron) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: sources, error } = await db.from('leaflet_sources').select('*,stores(slug)').eq('is_active', true).limit(100);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const dueSources = (sources || []).filter((source: any) =>
    !SPECIALIZED_SOURCE_SLUGS.has(String(source.stores?.slug || '')) && isDue(source)
  );
  const results = [];
  for (const source of dueSources) results.push(await discoverSource(source));
  return Response.json({ ok: true, active: sources?.length || 0, checked: results.length, results });
});
