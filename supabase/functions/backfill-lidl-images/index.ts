import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function normalize(value: unknown): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(lidl|akce|sleva|baleni|ks|kg|g|ml|l)\b/g, ' ')
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
  return containment * 0.7 + jaccard * 0.3;
}

function usableImage(url: unknown): boolean {
  const value = String(url || '').trim();
  return /^https?:\/\//i.test(value) && !/favicon|logo|placeholder|no-image/i.test(value);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

  const authorization = request.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  if (!token) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });

  const { data: userData } = await db.auth.getUser(token);
  const role = String(userData.user?.app_metadata?.role || userData.user?.user_metadata?.role || '').toLowerCase();
  if (!['admin', 'editor'].includes(role)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'lidl').single();
    if (storeError || !store) throw storeError || new Error('Obchod Lidl nebyl nalezen.');

    const [{ data: offers, error: offersError }, { data: products, error: productsError }] = await Promise.all([
      db.from('offers')
        .select('id,product_id,title,image_url')
        .eq('store_id', store.id)
        .eq('status', 'published')
        .gte('valid_to', today)
        .limit(1000),
      db.from('products')
        .select('id,name,image_url')
        .not('image_url', 'is', null)
        .limit(5000),
    ]);
    if (offersError) throw offersError;
    if (productsError) throw productsError;

    const catalog = (products || []).filter((item: any) => usableImage(item.image_url));
    const missing = (offers || []).filter((offer: any) => !usableImage(offer.image_url));
    let updated = 0;
    let unmatched = 0;

    for (const offer of missing) {
      let best: any = null;
      let bestScore = 0;
      let secondScore = 0;

      for (const candidate of catalog) {
        const score = similarity(offer.title, candidate.name);
        if (score > bestScore) {
          secondScore = bestScore;
          bestScore = score;
          best = candidate;
        } else if (score > secondScore) secondScore = score;
      }

      if (!best || bestScore < 0.82 || bestScore - secondScore < 0.08) {
        unmatched++;
        continue;
      }

      const { error: offerError } = await db.from('offers').update({ image_url: best.image_url }).eq('id', offer.id);
      if (offerError) throw offerError;

      if (offer.product_id) {
        const { error: productError } = await db.from('products').update({ image_url: best.image_url }).eq('id', offer.product_id);
        if (productError) throw productError;
      }

      updated++;
    }

    return Response.json({ ok: true, missing: missing.length, updated, unmatched }, { headers: CORS_HEADERS });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500, headers: CORS_HEADERS },
    );
  }
});
