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
    .replace(/\b(akce|clubcard|tesco|baleni|vybrane druhy|dle nabidky)\b/g, ' ')
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
  return (jaccard * 0.45) + (coverage * 0.55);
}

function validImageUrl(value: unknown): string | null {
  const url = String(value || '').trim();
  if (!/^https:\/\//i.test(url)) return null;
  return url;
}

async function findImage(title: string): Promise<{ url: string; source: string; score: number } | null> {
  const query = normalize(title);
  if (!query) return null;

  const endpoint = new URL('https://world.openfoodfacts.org/cgi/search.pl');
  endpoint.searchParams.set('search_terms', query);
  endpoint.searchParams.set('search_simple', '1');
  endpoint.searchParams.set('action', 'process');
  endpoint.searchParams.set('json', '1');
  endpoint.searchParams.set('page_size', '12');
  endpoint.searchParams.set('fields', 'product_name,product_name_cs,generic_name,brands,image_front_url,image_front_small_url,image_url');

  const response = await fetch(endpoint, {
    headers: {
      'user-agent': 'Slevao.cz/1.0 (product image enrichment)',
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;

  const payload = await response.json().catch(() => ({}));
  let best: { url: string; source: string; score: number } | null = null;

  for (const product of payload?.products || []) {
    const candidateName = [product.product_name_cs, product.product_name, product.generic_name, product.brands]
      .filter(Boolean)
      .join(' ');
    const score = similarity(title, candidateName);
    const url = validImageUrl(product.image_front_url)
      || validImageUrl(product.image_url)
      || validImageUrl(product.image_front_small_url);
    if (!url || score < 0.58) continue;
    if (!best || score > best.score) best = { url, source: 'openfoodfacts', score };
  }

  return best;
}

async function backfillTescoImages(limit = 80) {
  const { data: stores, error: storesError } = await db.from('stores')
    .select('id')
    .or('slug.ilike.%tesco%,name.ilike.%tesco%');
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

  let enriched = 0;
  let notFound = 0;
  let failed = 0;
  const results: any[] = [];

  for (const offer of offers || []) {
    try {
      const match = await findImage(String(offer.title || ''));
      if (!match) {
        notFound++;
        results.push({ offer_id: offer.id, title: offer.title, status: 'not_found' });
        continue;
      }

      const { error: offerUpdateError } = await db.from('offers')
        .update({ image_url: match.url })
        .eq('id', offer.id);
      if (offerUpdateError) throw offerUpdateError;

      if (offer.product_id) {
        const { error: productUpdateError } = await db.from('products')
          .update({ image_url: match.url })
          .eq('id', offer.product_id);
        if (productUpdateError) throw productUpdateError;
      }

      enriched++;
      results.push({ offer_id: offer.id, title: offer.title, status: 'enriched', score: match.score, source: match.source });
      await new Promise((resolve) => setTimeout(resolve, 120));
    } catch (error) {
      failed++;
      results.push({
        offer_id: offer.id,
        title: offer.title,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { checked: offers?.length || 0, enriched, not_found: notFound, failed, results };
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

    if (!authorizedByServiceRole && !authorizedByCron && !authorizedByUser) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const body = await request.json().catch(() => ({}));
    const result = await backfillTescoImages(body.limit);
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('backfill-tesco-images failed:', message);
    return jsonResponse({ error: message }, 500);
  }
});
