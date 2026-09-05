import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function normalize(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(lidl|penny|market|akce|sleva|baleni|ks|kg|g|ml|l)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(value: unknown): string[] {
  return normalize(value).split(' ').filter((word) => word.length > 2);
}

function similarity(a: unknown, b: unknown): number {
  const aw = words(a);
  const bw = words(b);
  if (!aw.length || !bw.length) return 0;
  const intersection = aw.filter((word) => bw.includes(word)).length;
  const union = new Set([...aw, ...bw]).size;
  const containment = intersection / Math.min(aw.length, bw.length);
  const jaccard = intersection / union;
  return containment * 0.72 + jaccard * 0.28;
}

function usableImage(url: unknown): boolean {
  const value = String(url || '').trim();
  return /^https:\/\//i.test(value) && !/favicon|logo|placeholder|no-image|default-image|\.svg(?:\?|$)/i.test(value);
}

async function authorize(request: Request): Promise<boolean> {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (authorization === `Bearer ${SERVICE_ROLE_KEY}`) return true;
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}

async function queueCandidate(offer: any, candidate: any, score: number) {
  if (!offer.product_id) return false;
  const { error } = await db.from('product_image_candidates').upsert({
    product_id: offer.product_id,
    image_url: candidate.image_url,
    source_url: candidate.image_url,
    source_domain: null,
    source_type: 'product_database',
    quality_score: Math.max(70, Math.min(88, Math.round(70 + score * 18))),
    match_score: Number(Math.min(score, 1).toFixed(4)),
    status: 'pending',
    metadata: {
      provider: 'verified-catalog-fuzzy-review-v7',
      source_product_id: candidate.id,
      source_product_name: candidate.name,
      source_image_verified: true,
      source_image_quality: candidate.image_quality,
      offer_id: offer.id,
      offer_title: offer.title,
      automatic: false,
      review_required: true,
    },
  }, { onConflict: 'product_id,image_url', ignoreDuplicates: true });
  if (error) throw error;
  return true;
}

async function maintainStore(slug: string) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', slug).single();
  if (storeError || !store) throw storeError || new Error(`Obchod ${slug} nebyl nalezen.`);

  const [{ data: offers, error: offersError }, { data: products, error: productsError }] = await Promise.all([
    db.from('offers')
      .select('id,product_id,title,image_url,products(image_url)')
      .eq('store_id', store.id)
      .eq('status', 'published')
      .eq('is_verified', true)
      .lte('valid_from', today)
      .gte('valid_to', today)
      .limit(1500),
    db.from('products')
      .select('id,name,image_url,image_verified,image_quality')
      .eq('image_verified', true)
      .gte('image_quality', 70)
      .not('image_url', 'is', null)
      .limit(7500),
  ]);
  if (offersError) throw offersError;
  if (productsError) throw productsError;

  const catalog = (products || []).filter((item: any) => usableImage(item.image_url));
  const missing = (offers || []).filter((offer: any) => !usableImage(offer.image_url) && !usableImage(offer.products?.image_url));
  let queued = 0;
  let unmatched = 0;

  for (const offer of missing) {
    let best: any = null;
    let bestScore = 0;
    let secondScore = 0;

    for (const candidate of catalog) {
      if (String(candidate.id) === String(offer.product_id || '')) continue;
      const score = similarity(offer.title, candidate.name);
      if (score > bestScore) {
        secondScore = bestScore;
        bestScore = score;
        best = candidate;
      } else if (score > secondScore) secondScore = score;
    }

    const queryWords = words(offer.title);
    const candidateWords = words(best?.name || '');
    const exactContainment = queryWords.length >= 2 && candidateWords.length >= 2 &&
      (queryWords.every((word) => candidateWords.includes(word)) || candidateWords.every((word) => queryWords.includes(word)));
    const clearMargin = bestScore - secondScore >= 0.12;

    if (!best || bestScore < 0.88 || !exactContainment || !clearMargin) {
      unmatched++;
      continue;
    }

    if (await queueCandidate(offer, best, bestScore)) queued++;
  }

  return { slug, store: store.name, missing: missing.length, queued_for_review: queued, unmatched };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS_HEADERS });
  if (!(await authorize(request))) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });

  try {
    const body = await request.json().catch(() => ({}));
    const requested = String(body.store || 'lidl').toLowerCase();
    const slugs = requested === 'all' ? ['lidl', 'penny'] : [requested];
    const results = [];
    for (const slug of slugs) {
      if (!['lidl', 'penny'].includes(slug)) continue;
      results.push(await maintainStore(slug));
    }
    return Response.json({
      ok: true,
      mode: 'review_only',
      applied: 0,
      results,
      queued_for_review: results.reduce((sum, item) => sum + item.queued_for_review, 0),
      missing: results.reduce((sum, item) => sum + item.missing, 0),
      unmatched: results.reduce((sum, item) => sum + item.unmatched, 0),
    }, { headers: CORS_HEADERS });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: CORS_HEADERS });
  }
});
