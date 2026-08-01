import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-cron-secret',
  'access-control-allow-methods': 'POST, OPTIONS',
};

type Product = {
  id: string;
  name: string;
  normalized_name: string | null;
  brand: string | null;
  ean: string | null;
  quantity_text: string | null;
  image_url: string | null;
  image_quality: number | null;
  image_verified: boolean | null;
};

type Offer = {
  id: string;
  product_id: string | null;
  store_id: string;
  title: string;
  image_url: string | null;
  published_at: string | null;
  products: Product | null;
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
    .replace(/\b(akce|clubcard|cena pro vsechny|vybrane druhy|dle nabidky|chlazene|balene|volny prodej|pultovy prodej)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractQuantity(value: unknown): string {
  const text = normalize(value);
  const matches = [...text.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(kg|g|mg|l|ml|cl|ks)\b/g)];
  if (!matches.length) return '';
  return matches.map((m) => `${String(m[1]).replace(',', '.')}${m[2]}`).join(' ');
}

function tokens(value: unknown): Set<string> {
  return new Set(normalize(value).split(' ').filter((token) => token.length >= 2));
}

function titleSimilarity(leftValue: unknown, rightValue: unknown): number {
  const left = tokens(leftValue);
  const right = tokens(rightValue);
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  const union = new Set([...left, ...right]).size;
  const coverage = intersection / Math.min(left.size, right.size);
  const jaccard = intersection / union;
  return coverage * 0.72 + jaccard * 0.28;
}

function scoreCandidate(offerTitle: string, product: Product, alias?: string): number {
  const candidateName = alias || product.name;
  let score = titleSimilarity(offerTitle, candidateName);
  const offerQuantity = extractQuantity(offerTitle);
  const productQuantity = extractQuantity(product.quantity_text || product.name);
  if (offerQuantity && productQuantity) {
    score += offerQuantity === productQuantity ? 0.12 : -0.2;
  }
  const brand = normalize(product.brand);
  if (brand) {
    score += normalize(offerTitle).includes(brand) ? 0.08 : -0.04;
  }
  return Math.max(0, Math.min(score, 1));
}

function isApprovedImage(product: Product | null): boolean {
  return Boolean(
    product?.image_url &&
    product.image_verified &&
    Number(product.image_quality || 0) >= 70 &&
    !String(product.image_url).includes('/leaflet-crops/')
  );
}

async function authorize(request: Request): Promise<boolean> {
  const authHeader = request.headers.get('authorization') || '';
  const cronHeader = request.headers.get('x-cron-secret') || '';
  if (authHeader === `Bearer ${SERVICE_ROLE_KEY}`) return true;
  if (CRON_SECRET && cronHeader === CRON_SECRET) return true;
  if (!authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.slice(7).trim();
  const { data } = await db.auth.getUser(token);
  const role = String(data.user?.app_metadata?.role || '').toLowerCase();
  return ['admin', 'editor'].includes(role);
}

async function loadProducts(): Promise<Product[]> {
  const { data, error } = await db.from('products')
    .select('id,name,normalized_name,brand,ean,quantity_text,image_url,image_quality,image_verified')
    .limit(10000);
  if (error) throw error;
  return (data || []) as Product[];
}

async function loadAliases(): Promise<Array<{ product_id: string; alias: string; normalized_alias: string }>> {
  const { data, error } = await db.from('product_aliases')
    .select('product_id,alias,normalized_alias')
    .limit(20000);
  if (error) throw error;
  return data || [];
}

async function loadOffers(limit: number, offerId?: string): Promise<Offer[]> {
  let query = db.from('offers')
    .select('id,product_id,store_id,title,image_url,published_at,products(id,name,normalized_name,brand,ean,quantity_text,image_url,image_quality,image_verified)')
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit);
  if (offerId) query = query.eq('id', offerId).limit(1);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as unknown as Offer[];
}

async function upsertAlias(productId: string, offer: Offer, confidence: number) {
  const normalizedAlias = normalize(offer.title);
  if (!normalizedAlias) return;
  const { error } = await db.from('product_aliases').upsert({
    product_id: productId,
    alias: offer.title,
    normalized_alias: normalizedAlias,
    source_store_id: offer.store_id,
    confidence,
  }, { onConflict: 'product_id,normalized_alias', ignoreDuplicates: false });
  if (error) throw error;
}

async function updateCurrentProductMetadata(offer: Offer) {
  if (!offer.product_id || !offer.products) return;
  const quantity = extractQuantity(offer.title) || null;
  const update: Record<string, unknown> = {
    normalized_name: normalize(offer.products.name || offer.title),
  };
  if (!offer.products.quantity_text && quantity) update.quantity_text = quantity;
  if (String(offer.products.image_url || '').includes('/leaflet-crops/')) {
    update.image_url = null;
    update.image_source = null;
    update.image_quality = 0;
    update.image_verified = false;
  }
  const { error } = await db.from('products').update(update).eq('id', offer.product_id);
  if (error) throw error;
  await upsertAlias(offer.product_id, offer, 1);
}

async function mergeOffer(offer: Offer, master: Product, score: number) {
  const approvedImage = isApprovedImage(master) ? master.image_url : null;
  const offerUpdate: Record<string, unknown> = { product_id: master.id };
  if (approvedImage) offerUpdate.image_url = approvedImage;
  else if (String(offer.image_url || '').includes('/leaflet-crops/')) offerUpdate.image_url = null;

  const { error: offerError } = await db.from('offers').update(offerUpdate).eq('id', offer.id);
  if (offerError) throw offerError;

  const { error: itemError } = await db.from('leaflet_import_items')
    .update({ product_id: master.id, ...(approvedImage ? { image_url: approvedImage } : {}) })
    .eq('product_id', offer.product_id)
    .eq('title', offer.title);
  if (itemError) throw itemError;

  await upsertAlias(master.id, offer, score);

  if (offer.product_id && offer.product_id !== master.id) {
    const [{ count: offerCount }, { count: itemCount }] = await Promise.all([
      db.from('offers').select('id', { count: 'exact', head: true }).eq('product_id', offer.product_id),
      db.from('leaflet_import_items').select('id', { count: 'exact', head: true }).eq('product_id', offer.product_id),
    ]);
    if ((offerCount || 0) === 0 && (itemCount || 0) === 0) {
      await db.from('products').delete().eq('id', offer.product_id);
    }
  }
}

async function processCatalog(limit: number, offerId?: string) {
  const [products, aliases, offers] = await Promise.all([
    loadProducts(),
    loadAliases(),
    loadOffers(limit, offerId),
  ]);

  const productById = new Map(products.map((product) => [product.id, product]));
  const exact = new Map<string, Set<string>>();
  for (const product of products) {
    const key = normalize(product.normalized_name || product.name);
    if (key) {
      if (!exact.has(key)) exact.set(key, new Set());
      exact.get(key)!.add(product.id);
    }
  }
  for (const alias of aliases) {
    const key = normalize(alias.normalized_alias || alias.alias);
    if (key) {
      if (!exact.has(key)) exact.set(key, new Set());
      exact.get(key)!.add(alias.product_id);
    }
  }

  let matched = 0;
  let retained = 0;
  let ambiguous = 0;
  let failed = 0;
  const results: unknown[] = [];

  for (const offer of offers) {
    try {
      const normalizedTitle = normalize(offer.title);
      const exactIds = [...(exact.get(normalizedTitle) || [])];
      let best: { product: Product; score: number } | null = null;

      for (const productId of exactIds) {
        const product = productById.get(productId);
        if (!product) continue;
        const score = scoreCandidate(offer.title, product);
        if (!best || score > best.score || (score === best.score && isApprovedImage(product))) best = { product, score };
      }

      if (!best) {
        const offerTokens = [...tokens(offer.title)];
        const probe = offerTokens.find((token) => token.length >= 4);
        const candidates = products.filter((product) => {
          if (!probe) return false;
          return normalize(product.name).includes(probe) || normalize(product.brand).includes(probe);
        }).slice(0, 250);
        for (const product of candidates) {
          const score = scoreCandidate(offer.title, product);
          if (!best || score > best.score || (score === best.score && isApprovedImage(product))) best = { product, score };
        }
      }

      if (best && best.score >= 0.9) {
        if (best.product.id !== offer.product_id) {
          await mergeOffer(offer, best.product, best.score);
          matched++;
          results.push({ offer_id: offer.id, title: offer.title, status: 'matched', product_id: best.product.id, score: Number(best.score.toFixed(3)) });
        } else {
          await updateCurrentProductMetadata(offer);
          if (isApprovedImage(best.product) && offer.image_url !== best.product.image_url) {
            await db.from('offers').update({ image_url: best.product.image_url }).eq('id', offer.id);
          }
          retained++;
          results.push({ offer_id: offer.id, title: offer.title, status: 'retained', score: Number(best.score.toFixed(3)) });
        }
      } else {
        await updateCurrentProductMetadata(offer);
        ambiguous++;
        results.push({ offer_id: offer.id, title: offer.title, status: 'needs_review', best_score: Number((best?.score || 0).toFixed(3)) });
      }
    } catch (error) {
      failed++;
      results.push({ offer_id: offer.id, title: offer.title, status: 'failed', error: error instanceof Error ? error.message : String(error) });
    }
  }

  return { checked: offers.length, matched, retained, needs_review: ambiguous, failed, results };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (!(await authorize(request))) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body.limit) || 300, 1000));
    const result = await processCatalog(limit, body.offer_id ? String(body.offer_id) : undefined);
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('match-product-catalog failed:', message);
    return jsonResponse({ error: message }, 500);
  }
});
