import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'access-control-allow-methods': 'POST, OPTIONS',
};

type ImageMatch = { url: string; source: string; score: number; matched_name?: string };

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  });
}

function normalize(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs')
    .replace(/\b(akce|clubcard|tesco|baleni|vybrane druhy|dle nabidky|filet|chlazene|cerstve)\b/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|ks|%)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: unknown): Set<string> {
  return new Set(normalize(value).split(' ').filter((token) => token.length >= 3));
}

function similarity(a: unknown, b: unknown): number {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  const union = new Set([...left, ...right]).size;
  const jaccard = union ? intersection / union : 0;
  const coverage = intersection / Math.min(left.size, right.size);
  return (jaccard * 0.35) + (coverage * 0.65);
}

function validImageUrl(value: unknown): string | null {
  const url = String(value || '').trim().replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  if (!/^https:\/\//i.test(url)) return null;
  if (!/\.(?:jpe?g|png|webp)(?:\?|$)/i.test(url) && !url.includes('digitalcontent.api.tesco.com')) return null;
  if (/banner|logo|icon|placeholder|sprite/i.test(url)) return null;
  return url;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u0026/g, '&')
    .replace(/\\u003c/g, '<')
    .replace(/\\u003e/g, '>')
    .replace(/\\\//g, '/');
}

function extractTextAround(html: string, index: number, radius = 1100): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(html.length, index + radius);
  return decodeHtml(html.slice(start, end))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[{}\[\]":,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchTescoSearchHtml(query: string): Promise<string | null> {
  const urls = [
    `https://nakup.itesco.cz/groceries/cs-CZ/search?query=${encodeURIComponent(query)}`,
    `https://nakup.itesco.cz/groceries/cs-CZ/search?query=${encodeURIComponent(normalize(query))}`,
  ];

  for (const url of [...new Set(urls)]) {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/json',
        'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
        referer: 'https://nakup.itesco.cz/',
      },
      signal: AbortSignal.timeout(18_000),
    }).catch(() => null);
    if (response?.ok) {
      const text = await response.text();
      if (text.length > 500) return decodeHtml(text);
    }
  }
  return null;
}

async function findTescoOfficialImage(title: string): Promise<ImageMatch | null> {
  const variants = [...new Set([
    title,
    normalize(title),
    normalize(title).split(' ').slice(0, 5).join(' '),
    normalize(title).split(' ').slice(0, 3).join(' '),
  ].filter(Boolean))];

  let best: ImageMatch | null = null;
  for (const variant of variants) {
    const html = await fetchTescoSearchHtml(variant);
    if (!html) continue;

    const imageRegex = /https:\/\/digitalcontent\.api\.tesco\.com\/[^"'<>\s\\]+/g;
    for (const match of html.matchAll(imageRegex)) {
      const rawUrl = match[0];
      const url = validImageUrl(rawUrl);
      if (!url || match.index == null || !/\/media\/ghs\//.test(url)) continue;

      const nearbyText = extractTextAround(html, match.index);
      const score = similarity(title, nearbyText);
      if (score < 0.52) continue;
      if (!best || score > best.score) {
        best = { url, source: 'tesco-official', score, matched_name: nearbyText.slice(0, 180) };
      }
    }

    if (best?.score && best.score >= 0.82) break;
  }
  return best;
}

async function findExistingCatalogImage(title: string): Promise<ImageMatch | null> {
  const words = [...tokens(title)];
  if (!words.length) return null;
  const probe = words[0];
  const [productsResult, offersResult] = await Promise.all([
    db.from('products').select('name,image_url').not('image_url', 'is', null).ilike('name', `%${probe}%`).limit(100),
    db.from('offers').select('title,image_url').not('image_url', 'is', null).ilike('title', `%${probe}%`).limit(150),
  ]);

  const candidates = [
    ...((productsResult.data || []).map((row: any) => ({ name: row.name, url: row.image_url, source: 'products' }))),
    ...((offersResult.data || []).map((row: any) => ({ name: row.title, url: row.image_url, source: 'offers' }))),
  ];

  let best: ImageMatch | null = null;
  for (const candidate of candidates) {
    const url = validImageUrl(candidate.url);
    const score = similarity(title, candidate.name);
    if (!url || score < 0.76) continue;
    if (!best || score > best.score) best = { url, source: candidate.source, score, matched_name: candidate.name };
  }
  return best;
}

async function queryOpenFoodFacts(title: string, query: string): Promise<ImageMatch | null> {
  const endpoint = new URL('https://world.openfoodfacts.org/cgi/search.pl');
  endpoint.searchParams.set('search_terms', query);
  endpoint.searchParams.set('search_simple', '1');
  endpoint.searchParams.set('action', 'process');
  endpoint.searchParams.set('json', '1');
  endpoint.searchParams.set('page_size', '25');
  endpoint.searchParams.set('fields', 'product_name,product_name_cs,generic_name,brands,image_front_url,image_front_small_url,image_url');

  const response = await fetch(endpoint, {
    headers: { 'user-agent': 'Slevao.cz/1.2 (product image enrichment)', accept: 'application/json' },
    signal: AbortSignal.timeout(14_000),
  }).catch(() => null);
  if (!response?.ok) return null;

  const payload = await response.json().catch(() => ({}));
  let best: ImageMatch | null = null;
  for (const product of payload?.products || []) {
    const candidateName = [product.product_name_cs, product.product_name, product.generic_name, product.brands]
      .filter(Boolean).join(' ');
    const score = similarity(title, candidateName);
    const url = validImageUrl(product.image_front_url)
      || validImageUrl(product.image_url)
      || validImageUrl(product.image_front_small_url);
    if (!url || score < 0.56) continue;
    if (!best || score > best.score) best = { url, source: 'openfoodfacts', score, matched_name: candidateName };
  }
  return best;
}

async function findImage(title: string): Promise<ImageMatch | null> {
  // Oficiální katalog konkrétního obchodu musí mít vždy nejvyšší prioritu.
  const official = await findTescoOfficialImage(title);
  if (official) return official;

  const catalog = await findExistingCatalogImage(title);
  if (catalog) return catalog;

  const variants = [...new Set([
    normalize(title),
    normalize(title).split(' ').slice(0, 5).join(' '),
    normalize(title).split(' ').slice(0, 3).join(' '),
  ].filter(Boolean))];

  let best: ImageMatch | null = null;
  for (const variant of variants) {
    const match = await queryOpenFoodFacts(title, variant);
    if (match && (!best || match.score > best.score)) best = match;
    if (best?.score && best.score >= 0.86) break;
  }
  return best;
}

async function backfillTescoImages(limit = 80) {
  const { data: stores, error: storesError } = await db.from('stores')
    .select('id').or('slug.ilike.%tesco%,name.ilike.%tesco%');
  if (storesError) throw storesError;
  const storeIds = (stores || []).map((row: any) => row.id).filter(Boolean);
  if (!storeIds.length) throw new Error('Tesco nebylo nalezeno v tabulce stores.');

  const { data: offers, error: offersError } = await db.from('offers')
    .select('id,product_id,title,image_url,published_at')
    .in('store_id', storeIds)
    .eq('status', 'published')
    .or('image_url.is.null,image_url.eq.')
    .order('published_at', { ascending: false })
    .limit(Math.max(1, Math.min(Number(limit) || 80, 150)));
  if (offersError) throw offersError;

  let enriched = 0, notFound = 0, failed = 0;
  const bySource: Record<string, number> = {};
  const results: any[] = [];

  for (const offer of offers || []) {
    try {
      const match = await findImage(String(offer.title || ''));
      if (!match) {
        notFound++;
        results.push({ offer_id: offer.id, title: offer.title, status: 'not_found' });
        continue;
      }

      const { error: offerUpdateError } = await db.from('offers').update({ image_url: match.url }).eq('id', offer.id);
      if (offerUpdateError) throw offerUpdateError;
      if (offer.product_id) {
        const { error: productUpdateError } = await db.from('products').update({ image_url: match.url }).eq('id', offer.product_id);
        if (productUpdateError) throw productUpdateError;
      }

      enriched++;
      bySource[match.source] = (bySource[match.source] || 0) + 1;
      results.push({
        offer_id: offer.id,
        title: offer.title,
        status: 'enriched',
        score: Number(match.score.toFixed(3)),
        source: match.source,
        matched_name: match.matched_name,
      });
      await new Promise((resolve) => setTimeout(resolve, 120));
    } catch (error) {
      failed++;
      results.push({ offer_id: offer.id, title: offer.title, status: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { checked: offers?.length || 0, enriched, not_found: notFound, failed, by_source: bySource, results };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  try {
    if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
    const authHeader = request.headers.get('authorization') || '';
    const cronHeader = request.headers.get('x-cron-secret') || '';
    const authorizedByServiceRole = authHeader === `Bearer ${SERVICE_ROLE_KEY}`;
    const authorizedByCron = Boolean(CRON_SECRET && cronHeader === CRON_SECRET);
    let authorizedByUser = false;

    if (!authorizedByServiceRole && !authorizedByCron && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const { data } = await db.auth.getUser(token);
      const role = String(data.user?.app_metadata?.role || data.user?.user_metadata?.role || '').toLowerCase();
      authorizedByUser = ['admin', 'editor'].includes(role);
    }
    if (!authorizedByServiceRole && !authorizedByCron && !authorizedByUser) return jsonResponse({ error: 'Unauthorized' }, 401);

    const body = await request.json().catch(() => ({}));
    const result = await backfillTescoImages(body.limit);
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('backfill-tesco-images failed:', message);
    return jsonResponse({ error: message }, 500);
  }
});
