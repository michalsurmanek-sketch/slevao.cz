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
type Candidate = { name: string; url: string };

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
    .replace(/\b(akce|clubcard|tesco|baleni|vybrane druhy|dle nabidky|filet|chlazene|cerstve|cena za|ks)\b/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|ks|%)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function queryVariants(title: string): string[] {
  const cleaned = normalize(title);
  const words = cleaned.split(' ').filter(Boolean);
  return [...new Set([
    title.trim(),
    cleaned,
    words.slice(0, 6).join(' '),
    words.slice(0, 4).join(' '),
    words.slice(0, 3).join(' '),
    words.length > 2 ? `${words[0]} ${words.at(-1)}` : '',
  ].filter((value) => value.length >= 3))];
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
  const coverage = intersection / left.size;
  const reverseCoverage = intersection / right.size;
  const union = new Set([...left, ...right]).size;
  const jaccard = union ? intersection / union : 0;
  return coverage * 0.5 + reverseCoverage * 0.25 + jaccard * 0.25;
}

function decodeText(value: string): string {
  return value
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\\u0026/g, '&')
    .replace(/\\u003c/g, '<')
    .replace(/\\u003e/g, '>')
    .replace(/\\\//g, '/');
}

function validImageUrl(value: unknown): string | null {
  const url = decodeText(String(value || '').trim());
  if (!/^https:\/\//i.test(url)) return null;
  if (/banner|logo|icon|placeholder|sprite|badge/i.test(url)) return null;
  if (url.includes('digitalcontent.api.tesco.com')) return url;
  if (/\.(?:jpe?g|png|webp)(?:\?|$)/i.test(url)) return url;
  return null;
}

function collectCandidates(value: unknown, out: Candidate[], inheritedName = '', depth = 0): void {
  if (depth > 14 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectCandidates(item, out, inheritedName, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;

  const object = value as Record<string, unknown>;
  const name = String(
    object.name || object.title || object.productName || object.product_name ||
    object.description || object.shortDescription || inheritedName || '',
  ).trim();

  const imageValues: unknown[] = [
    object.image, object.imageUrl, object.image_url, object.defaultImageUrl,
    object.thumbnail, object.media, object.images,
  ];
  for (const imageValue of imageValues) {
    if (typeof imageValue === 'string') {
      const url = validImageUrl(imageValue);
      if (url) out.push({ name, url });
    } else if (Array.isArray(imageValue)) {
      for (const entry of imageValue) {
        if (typeof entry === 'string') {
          const url = validImageUrl(entry);
          if (url) out.push({ name, url });
        } else if (entry && typeof entry === 'object') {
          const item = entry as Record<string, unknown>;
          const url = validImageUrl(item.url || item.src || item.imageUrl || item.defaultImageUrl);
          if (url) out.push({ name, url });
        }
      }
    } else if (imageValue && typeof imageValue === 'object') {
      const item = imageValue as Record<string, unknown>;
      const url = validImageUrl(item.url || item.src || item.imageUrl || item.defaultImageUrl);
      if (url) out.push({ name, url });
    }
  }

  for (const child of Object.values(object)) collectCandidates(child, out, name, depth + 1);
}

function extractJsonCandidates(html: string): Candidate[] {
  const candidates: Candidate[] = [];
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptRegex)) {
    const raw = decodeText(match[1] || '').trim();
    if (!raw || (!raw.startsWith('{') && !raw.startsWith('['))) continue;
    try { collectCandidates(JSON.parse(raw), candidates); } catch { /* not JSON */ }
  }

  const assignmentPatterns = [
    /__NEXT_DATA__\s*=\s*({[\s\S]*?})\s*;?\s*<\/script>/i,
    /window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?})\s*;/i,
    /window\.__PRELOADED_STATE__\s*=\s*({[\s\S]*?})\s*;/i,
  ];
  for (const pattern of assignmentPatterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    try { collectCandidates(JSON.parse(decodeText(match[1])), candidates); } catch { /* ignore */ }
  }
  return candidates;
}

function extractHtmlCandidates(html: string): Candidate[] {
  const decoded = decodeText(html);
  const candidates: Candidate[] = [];
  const regex = /https:\/\/digitalcontent\.api\.tesco\.com\/[^"'<>\s\\]+/g;
  for (const match of decoded.matchAll(regex)) {
    if (match.index == null) continue;
    const url = validImageUrl(match[0]);
    if (!url || !/\/media\/ghs\//.test(url)) continue;
    const start = Math.max(0, match.index - 1500);
    const end = Math.min(decoded.length, match.index + 1500);
    const name = decoded.slice(start, end)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[{}\[\]":,]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    candidates.push({ name, url });
  }
  return candidates;
}

async function fetchTescoSearch(query: string): Promise<string | null> {
  const url = `https://nakup.itesco.cz/groceries/cs-CZ/search?query=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,application/json',
      'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
      referer: 'https://nakup.itesco.cz/',
    },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const text = await response.text();
  return text.length > 500 ? text : null;
}

async function findTescoOfficialImage(title: string): Promise<ImageMatch | null> {
  let best: ImageMatch | null = null;
  for (const variant of queryVariants(title)) {
    const html = await fetchTescoSearch(variant);
    if (!html) continue;
    const candidates = [...extractJsonCandidates(html), ...extractHtmlCandidates(html)];
    const unique = new Map<string, Candidate>();
    for (const candidate of candidates) if (!unique.has(candidate.url)) unique.set(candidate.url, candidate);

    for (const candidate of unique.values()) {
      const score = similarity(title, candidate.name || variant);
      if (score < 0.48) continue;
      if (!best || score > best.score) {
        best = { url: candidate.url, source: 'tesco-official', score, matched_name: candidate.name.slice(0, 180) };
      }
    }
    if (best?.score && best.score >= 0.78) break;
  }
  return best;
}

async function findExistingCatalogImage(title: string): Promise<ImageMatch | null> {
  const probe = [...tokens(title)][0];
  if (!probe) return null;
  const [products, offers] = await Promise.all([
    db.from('products').select('name,image_url').not('image_url', 'is', null).ilike('name', `%${probe}%`).limit(120),
    db.from('offers').select('title,image_url').not('image_url', 'is', null).ilike('title', `%${probe}%`).limit(180),
  ]);
  let best: ImageMatch | null = null;
  for (const row of [...(products.data || []).map((x: any) => ({ name: x.name, url: x.image_url })), ...(offers.data || []).map((x: any) => ({ name: x.title, url: x.image_url }))]) {
    const url = validImageUrl(row.url);
    const score = similarity(title, row.name);
    if (!url || score < 0.74) continue;
    if (!best || score > best.score) best = { url, source: 'catalog', score, matched_name: row.name };
  }
  return best;
}

async function findImage(title: string): Promise<ImageMatch | null> {
  return await findTescoOfficialImage(title) || await findExistingCatalogImage(title);
}

async function backfillTescoImages(limit = 80) {
  const { data: stores, error: storesError } = await db.from('stores')
    .select('id').or('slug.ilike.%tesco%,name.ilike.%tesco%');
  if (storesError) throw storesError;
  const storeIds = (stores || []).map((row: any) => row.id).filter(Boolean);
  if (!storeIds.length) throw new Error('Tesco nebylo nalezeno v tabulce stores.');

  const { data: offers, error: offersError } = await db.from('offers')
    .select('id,product_id,title,published_at')
    .in('store_id', storeIds)
    .eq('status', 'published')
    .or('image_url.is.null,image_url.eq.')
    .order('published_at', { ascending: false })
    .limit(Math.max(1, Math.min(Number(limit) || 80, 150)));
  if (offersError) throw offersError;

  let enriched = 0, notFound = 0, failed = 0;
  const bySource: Record<string, number> = {};
  const results: unknown[] = [];

  for (const offer of offers || []) {
    try {
      const match = await findImage(String(offer.title || ''));
      if (!match) {
        notFound++;
        results.push({ offer_id: offer.id, title: offer.title, status: 'not_found' });
        continue;
      }
      const { error: offerError } = await db.from('offers').update({ image_url: match.url }).eq('id', offer.id);
      if (offerError) throw offerError;
      if (offer.product_id) {
        const { error: productError } = await db.from('products').update({ image_url: match.url }).eq('id', offer.product_id);
        if (productError) throw productError;
      }
      enriched++;
      bySource[match.source] = (bySource[match.source] || 0) + 1;
      results.push({ offer_id: offer.id, title: offer.title, status: 'enriched', source: match.source, score: Number(match.score.toFixed(3)), matched_name: match.matched_name });
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      failed++;
      results.push({ offer_id: offer.id, title: offer.title, status: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { checked: offers?.length || 0, enriched, not_found: notFound, failed, by_source: bySource, results };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  const auth = request.headers.get('authorization') || '';
  const cron = request.headers.get('x-cron-secret') || '';
  const service = auth === `Bearer ${SERVICE_ROLE_KEY}`;
  const trustedCron = Boolean(CRON_SECRET && cron === CRON_SECRET);
  let userAllowed = false;
  if (!service && !trustedCron && auth.startsWith('Bearer ')) {
    const { data } = await db.auth.getUser(auth.slice(7).trim());
    const role = String(data.user?.app_metadata?.role || data.user?.user_metadata?.role || '').toLowerCase();
    userAllowed = ['admin', 'editor'].includes(role);
  }
  if (!service && !trustedCron && !userAllowed) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    return jsonResponse({ ok: true, ...(await backfillTescoImages(body.limit)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('backfill-tesco-images failed:', message);
    return jsonResponse({ error: message }, 500);
  }
});
