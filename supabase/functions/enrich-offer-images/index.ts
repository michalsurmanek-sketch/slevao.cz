import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SERPAPI_KEY = Deno.env.get('SERPAPI_KEY') || '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-cron-secret',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const OFFICIAL_DOMAINS = [
  'alza.cz', 'itesco.cz', 'tesco.com', 'rohlik.cz', 'kosik.cz', 'benu.cz',
  'pilulka.cz', 'datart.cz', 'sportisimo.cz', 'superzoo.cz', 'petcenter.cz',
  'rossmann.cz', 'dm.cz', 'kaufland.cz', 'lidl.cz', 'globus.cz', 'albert.cz',
  'penny.cz', 'coop.cz', 'terno.cz', 'action.com', 'mountfield.cz', 'bauhaus.cz',
];

const REJECTED_URL_PARTS = [
  '/letak', '/letaky', '/leaflet', '/catalog', '/katalog', '/page-', '/pages/',
  'prospekt', 'akcniletak', '.pdf', 'screenshot', 'preview-page',
];

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  });
}

function normalize(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs')
    .replace(/\b(akce|baleni|vybrane druhy|dle nabidky|chlazene|cerstve|clubcard|sleva|super cena)\b/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|ks|%)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenSet(value: unknown): Set<string> {
  return new Set(normalize(value).split(' ').filter((x) => x.length >= 3));
}

function similarity(a: unknown, b: unknown): number {
  const left = tokenSet(a);
  const right = tokenSet(b);
  if (!left.size || !right.size) return 0;
  let hit = 0;
  for (const token of left) if (right.has(token)) hit++;
  const coverage = hit / Math.min(left.size, right.size);
  const union = new Set([...left, ...right]).size;
  const jaccard = union ? hit / union : 0;
  return coverage * 0.72 + jaccard * 0.28;
}

function hostname(value: unknown): string {
  try { return new URL(String(value || '')).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

function isOfficialDomain(value: unknown): boolean {
  const host = hostname(value);
  return OFFICIAL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function validProductImageUrl(value: unknown): string | null {
  const url = String(value || '').trim();
  if (!/^https:\/\//i.test(url)) return null;
  const lower = url.toLowerCase();
  if (REJECTED_URL_PARTS.some((part) => lower.includes(part))) return null;
  if (!/\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(url)) return null;
  return url;
}

type Match = {
  url: string;
  score: number;
  source: 'verified_catalog' | 'catalog' | 'offers' | 'official_web' | 'web_search';
  sourceUrl?: string;
};

async function existingImage(title: string): Promise<Match | null> {
  const probe = [...tokenSet(title)][0];
  if (!probe) return null;

  const [products, offers] = await Promise.all([
    db.from('products')
      .select('name,image_url,image_verified,image_quality')
      .not('image_url', 'is', null)
      .ilike('name', `%${probe}%`)
      .limit(100),
    db.from('offers')
      .select('title,image_url,products(image_verified,image_quality)')
      .not('image_url', 'is', null)
      .ilike('title', `%${probe}%`)
      .limit(120),
  ]);

  const candidates = [
    ...((products.data || []).map((x: any) => ({
      title: x.name,
      url: x.image_url,
      verified: Boolean(x.image_verified),
      quality: Number(x.image_quality || 0),
      source: x.image_verified ? 'verified_catalog' : 'catalog',
    }))),
    ...((offers.data || []).map((x: any) => ({
      title: x.title,
      url: x.image_url,
      verified: Boolean(x.products?.image_verified),
      quality: Number(x.products?.image_quality || 0),
      source: 'offers',
    }))),
  ];

  let best: Match | null = null;
  for (const candidate of candidates) {
    const score = similarity(title, candidate.title);
    const url = validProductImageUrl(candidate.url);
    const minimum = candidate.verified && candidate.quality >= 70 ? 0.72 : 0.84;
    if (!url || score < minimum) continue;
    const adjusted = Math.min(1, score + (candidate.verified ? 0.08 : 0));
    if (!best || adjusted > best.score) {
      best = { url, score: adjusted, source: candidate.source as Match['source'] };
    }
  }
  return best;
}

async function serpImage(title: string, storeName: string): Promise<Match | null> {
  if (!SERPAPI_KEY) return null;
  const q = `"${title}" ${storeName} produkt -leták -letak -katalog`;
  const endpoint = new URL('https://serpapi.com/search.json');
  endpoint.searchParams.set('engine', 'google_images');
  endpoint.searchParams.set('q', q);
  endpoint.searchParams.set('hl', 'cs');
  endpoint.searchParams.set('gl', 'cz');
  endpoint.searchParams.set('safe', 'active');
  endpoint.searchParams.set('api_key', SERPAPI_KEY);

  const response = await fetch(endpoint, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!response?.ok) return null;
  const payload = await response.json().catch(() => ({}));
  let best: Match | null = null;

  for (const item of payload?.images_results || []) {
    const original = validProductImageUrl(item.original);
    const thumbnail = validProductImageUrl(item.thumbnail);
    const url = original || thumbnail;
    const sourceUrl = String(item.link || item.source || '');
    const candidateTitle = `${item.title || ''} ${item.source || ''}`;
    let score = similarity(title, candidateTitle);
    if (!url || score < 0.58) continue;

    const official = isOfficialDomain(sourceUrl) || isOfficialDomain(url);
    if (official) score = Math.min(1, score + 0.12);
    const source: Match['source'] = official ? 'official_web' : 'web_search';
    if (!best || score > best.score || (score === best.score && source === 'official_web')) {
      best = { url, score, source, sourceUrl: sourceUrl || url };
    }
  }
  return best;
}

async function applyTrustedImage(offer: any, match: Match) {
  if (!offer.product_id) throw new Error('Nabídka není propojena s hlavním produktem.');
  const now = new Date().toISOString();
  const quality = match.source === 'verified_catalog'
    ? 92
    : match.source === 'official_web'
      ? Math.round(78 + Math.min(match.score, 1) * 14)
      : Math.round(72 + Math.min(match.score, 1) * 12);

  const { error: productError } = await db.from('products').update({
    image_url: match.url,
    image_verified: true,
    image_quality: quality,
    image_source_url: match.sourceUrl || match.url,
    image_updated_at: now,
  }).eq('id', offer.product_id);
  if (productError) throw productError;

  const { error: offerError } = await db.from('offers')
    .update({ image_url: match.url })
    .eq('product_id', offer.product_id)
    .or('image_url.is.null,image_url.eq.');
  if (offerError) throw offerError;

  const { error: itemError } = await db.from('leaflet_import_items')
    .update({ image_url: match.url })
    .eq('product_id', offer.product_id)
    .or('image_url.is.null,image_url.eq.');
  if (itemError) throw itemError;

  await db.from('product_image_candidates').upsert({
    product_id: offer.product_id,
    image_url: match.url,
    source_url: match.sourceUrl || match.url,
    source_domain: hostname(match.sourceUrl || match.url) || null,
    source_type: match.source === 'official_web' ? 'official_catalog' : 'product_database',
    quality_score: quality,
    match_score: Number(Math.min(match.score, 1).toFixed(4)),
    has_text_overlay: false,
    has_price_overlay: false,
    status: 'approved',
    reviewed_at: now,
    metadata: { provider: match.source, offer_id: offer.id, offer_title: offer.title, automatic: true },
  }, { onConflict: 'product_id,image_url', ignoreDuplicates: false });
}

async function queueCandidate(offer: any, match: Match) {
  if (!offer.product_id) throw new Error('Nabídka není propojena s hlavním produktem.');
  const quality = Math.round(52 + Math.min(match.score, 1) * 24);
  const { error } = await db.from('product_image_candidates').upsert({
    product_id: offer.product_id,
    image_url: match.url,
    source_url: match.sourceUrl || match.url,
    source_domain: hostname(match.sourceUrl || match.url) || null,
    source_type: 'web_search',
    quality_score: quality,
    match_score: Number(Math.min(match.score, 1).toFixed(4)),
    has_text_overlay: false,
    has_price_overlay: false,
    status: 'pending',
    metadata: { provider: match.source, offer_id: offer.id, offer_title: offer.title, automatic: false },
  }, { onConflict: 'product_id,image_url', ignoreDuplicates: false });
  if (error) throw error;
}

async function enrich(storeId?: string, limit = 100) {
  let query = db.from('offers')
    .select('id,product_id,title,store_id,stores(name,slug)')
    .eq('status', 'published')
    .or('image_url.is.null,image_url.eq.')
    .order('published_at', { ascending: false })
    .limit(Math.max(1, Math.min(Number(limit) || 100, 200)));
  if (storeId) query = query.eq('store_id', storeId);
  const { data: offers, error } = await query;
  if (error) throw error;

  let applied = 0, queued = 0, notFound = 0, failed = 0;
  const bySource: Record<string, number> = {};
  const results: any[] = [];

  for (const offer of offers || []) {
    try {
      const storeName = String((offer as any).stores?.name || (offer as any).stores?.slug || '');
      const match = await existingImage(String(offer.title || ''))
        || await serpImage(String(offer.title || ''), storeName);

      if (!match) {
        notFound++;
        results.push({ offer_id: offer.id, title: offer.title, status: 'not_found' });
        continue;
      }

      const trusted = ['verified_catalog', 'catalog', 'official_web'].includes(match.source)
        && match.score >= (match.source === 'official_web' ? 0.72 : 0.84);

      if (trusted) {
        await applyTrustedImage(offer, match);
        applied++;
        results.push({ offer_id: offer.id, title: offer.title, status: 'applied', source: match.source, score: match.score });
      } else {
        await queueCandidate(offer, match);
        queued++;
        results.push({ offer_id: offer.id, title: offer.title, status: 'queued_for_review', source: match.source, score: match.score });
      }
      bySource[match.source] = (bySource[match.source] || 0) + 1;
    } catch (e) {
      failed++;
      results.push({ offer_id: offer.id, title: offer.title, status: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    checked: offers?.length || 0,
    applied,
    queued_for_review: queued,
    not_found: notFound,
    failed,
    by_source: bySource,
    serpapi_configured: Boolean(SERPAPI_KEY),
    results,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const auth = request.headers.get('authorization') || '';
  const cron = request.headers.get('x-cron-secret') || '';
  const service = auth === `Bearer ${SERVICE_ROLE_KEY}`;
  const trustedCron = Boolean(CRON_SECRET && cron === CRON_SECRET);
  let userAllowed = false;
  if (!service && !trustedCron && auth.startsWith('Bearer ')) {
    const { data } = await db.auth.getUser(auth.slice(7).trim());
    const role = String(data.user?.app_metadata?.role || '').toLowerCase();
    userAllowed = ['admin', 'editor'].includes(role);
  }
  if (!service && !trustedCron && !userAllowed) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    return json({ ok: true, ...(await enrich(body.store_id, body.limit)) });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
