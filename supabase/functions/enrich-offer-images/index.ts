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
    .replace(/\b(akce|baleni|vybrane druhy|dle nabidky|chlazene|cerstve|clubcard)\b/g, ' ')
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
  return coverage * 0.7 + jaccard * 0.3;
}

function validUrl(value: unknown): string | null {
  const url = String(value || '').trim();
  if (!/^https:\/\//i.test(url)) return null;
  if (!/\.(?:jpe?g|png|webp)(?:\?|$)/i.test(url)) return null;
  return url;
}

async function existingImage(title: string) {
  const probe = [...tokenSet(title)][0];
  if (!probe) return null;
  const [products, offers] = await Promise.all([
    db.from('products').select('name,image_url').not('image_url', 'is', null).ilike('name', `%${probe}%`).limit(80),
    db.from('offers').select('title,image_url').not('image_url', 'is', null).ilike('title', `%${probe}%`).limit(120),
  ]);
  const candidates = [
    ...((products.data || []).map((x: any) => ({ title: x.name, url: x.image_url, source: 'catalog' }))),
    ...((offers.data || []).map((x: any) => ({ title: x.title, url: x.image_url, source: 'offers' }))),
  ];
  let best: any = null;
  for (const candidate of candidates) {
    const score = similarity(title, candidate.title);
    const url = validUrl(candidate.url);
    if (!url || score < 0.78) continue;
    if (!best || score > best.score) best = { url, score, source: candidate.source };
  }
  return best;
}

async function serpImage(title: string, storeName: string) {
  if (!SERPAPI_KEY) return null;
  const q = `${title} ${storeName} produkt`;
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
  let best: any = null;
  for (const item of payload?.images_results || []) {
    const url = validUrl(item.original) || validUrl(item.thumbnail);
    const candidateTitle = `${item.title || ''} ${item.source || ''}`;
    const score = similarity(title, candidateTitle);
    if (!url || score < 0.55) continue;
    if (!best || score > best.score) best = { url, score, source: 'serpapi' };
  }
  return best;
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

  let enriched = 0, notFound = 0, failed = 0;
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
      const { error: offerError } = await db.from('offers').update({ image_url: match.url }).eq('id', offer.id);
      if (offerError) throw offerError;
      if (offer.product_id) {
        const { error: productError } = await db.from('products').update({ image_url: match.url }).eq('id', offer.product_id);
        if (productError) throw productError;
      }
      enriched++;
      bySource[match.source] = (bySource[match.source] || 0) + 1;
      results.push({ offer_id: offer.id, title: offer.title, status: 'enriched', source: match.source, score: match.score });
    } catch (e) {
      failed++;
      results.push({ offer_id: offer.id, title: offer.title, status: 'failed', error: e instanceof Error ? e.message : String(e) });
    }
  }

  return { checked: offers?.length || 0, enriched, not_found: notFound, failed, by_source: bySource, serpapi_configured: Boolean(SERPAPI_KEY), results };
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
