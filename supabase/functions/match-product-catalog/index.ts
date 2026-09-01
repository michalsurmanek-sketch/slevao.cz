import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const MAX_RUN_MS = 85_000;
const AUTO_MATCH_THRESHOLD = 0.92;
const EXACT_LOOKUP_CHUNK = 20;
const EXACT_LOOKUP_PAGE_SIZE = 500;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-cron-secret',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const PRODUCT_SELECT = 'id,name,normalized_name,brand,ean,quantity_text,image_url,image_quality,image_verified';
const ALIAS_SELECT = 'product_id,alias,normalized_alias,brand,quantity_text,source_store_id,confidence';

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

type Alias = {
  product_id: string;
  alias: string;
  normalized_alias: string;
  brand: string | null;
  quantity_text: string | null;
  source_store_id: string | null;
  confidence: number | null;
};

type Evaluation = {
  product: Product;
  score: number;
  autoSafe: boolean;
  sourceText: string;
  quantityState: 'same' | 'mismatch' | 'missing' | 'none';
  brandMatch: boolean;
  reasons: string[];
};

type LoadOfferOptions = {
  offerId?: string;
  storeId?: string;
  recheckMissingImages?: boolean;
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

function tokenArray(value: unknown): string[] {
  return [...new Set(normalize(value).split(' ').filter((token) => token.length >= 2))];
}

function isSpecificTitle(value: unknown): boolean {
  const text = normalize(value);
  if (!text || text.length < 3 || /^\d+$/.test(text)) return false;
  const blocked = new Set([
    'cena', 'akce', 'sleva', 'vybrane druhy', 'dle nabidky', 's klubem',
    'club', 'original', 'mini', 'selection', 'cool',
  ]);
  if (blocked.has(text)) return false;
  return tokenArray(text).some((token) => /[a-z]/.test(token) && token.length >= 3);
}

function extractQuantity(value: unknown): string {
  const text = normalize(value);
  const multipacks = [...text.matchAll(/\b(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*(kg|g|mg|l|ml|cl|ks)\b/g)]
    .map((match) => `${match[1]}x${String(match[2]).replace(',', '.')}${match[3]}`);
  const singles = [...text.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(kg|g|mg|l|ml|cl|ks)\b/g)]
    .map((match) => `${String(match[1]).replace(',', '.')}${match[2]}`)
    .filter((value) => !multipacks.some((multi) => multi.endsWith(`x${value}`)));
  return [...new Set([...multipacks, ...singles])].join(' ');
}

function titleSimilarity(leftValue: unknown, rightValue: unknown): number {
  const left = new Set(tokenArray(leftValue));
  const right = new Set(tokenArray(rightValue));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  const union = new Set([...left, ...right]).size;
  const coverage = intersection / Math.min(left.size, right.size);
  const jaccard = intersection / union;
  return coverage * 0.72 + jaccard * 0.28;
}

function quantityState(offerTitle: string, candidateQuantity: string | null, candidateName: string): Evaluation['quantityState'] {
  const offerQuantity = extractQuantity(offerTitle);
  const productQuantities = [
    extractQuantity(candidateQuantity),
    extractQuantity(candidateName),
  ].filter((value): value is string => Boolean(value));

  if (offerQuantity && productQuantities.length) {
    return productQuantities.includes(offerQuantity) ? 'same' : 'mismatch';
  }
  if (offerQuantity || productQuantities.length) return 'missing';
  return 'none';
}

function aliasIsUsable(alias: Alias): boolean {
  if (Number(alias.confidence || 0) < 0.9 || !isSpecificTitle(alias.alias)) return false;
  const tokens = tokenArray(alias.alias);
  return Boolean(alias.quantity_text || alias.brand || tokens.length >= 2);
}

function evaluateText(offerTitle: string, product: Product, sourceText: string, sourceBrand: string | null, sourceQuantity: string | null): Omit<Evaluation, 'product'> {
  const similarity = titleSimilarity(offerTitle, sourceText);
  const qState = quantityState(offerTitle, sourceQuantity || product.quantity_text, sourceText || product.name);
  const brand = normalize(sourceBrand || product.brand);
  const brandMatch = Boolean(brand && normalize(offerTitle).includes(brand));
  const exact = normalize(offerTitle) === normalize(sourceText);
  const exactMultiToken = exact && tokenArray(sourceText).length >= 2;
  const brandCompatible = !brand || brandMatch || exactMultiToken;
  const specific = isSpecificTitle(offerTitle) && isSpecificTitle(sourceText);

  let score = similarity;
  if (qState === 'same') score += 0.15;
  else if (qState === 'mismatch') score -= 0.4;
  else if (qState === 'missing') score -= 0.22;
  if (brand) score += brandMatch ? 0.1 : exactMultiToken ? 0 : -0.1;
  score = Math.max(0, Math.min(score, 1));

  let evidence = 0;
  if (similarity >= 0.94) evidence++;
  if (qState === 'same') evidence++;
  if (brandMatch) evidence++;
  if (exactMultiToken) evidence++;

  const reasons: string[] = [];
  if (!specific) reasons.push('generic_title');
  if (qState === 'mismatch') reasons.push('quantity_mismatch');
  if (qState === 'missing') reasons.push('quantity_missing_on_one_side');
  if (brand && !brandMatch && !exactMultiToken) reasons.push('brand_missing');
  if (evidence < 2) reasons.push('insufficient_independent_signals');

  const autoSafe = specific
    && qState !== 'mismatch'
    && qState !== 'missing'
    && brandCompatible
    && evidence >= 2
    && score >= AUTO_MATCH_THRESHOLD;

  return { score, autoSafe, sourceText, quantityState: qState, brandMatch, reasons };
}

function evaluateCandidate(offerTitle: string, product: Product, aliases: Alias[]): Evaluation {
  const candidates: Array<{ text: string; brand: string | null; quantity: string | null }> = [
    { text: product.name, brand: product.brand, quantity: product.quantity_text },
    ...aliases.filter(aliasIsUsable).map((alias) => ({ text: alias.alias, brand: alias.brand || product.brand, quantity: alias.quantity_text || product.quantity_text })),
  ];

  let best: Omit<Evaluation, 'product'> | null = null;
  for (const candidate of candidates) {
    const evaluation = evaluateText(offerTitle, product, candidate.text, candidate.brand, candidate.quantity);
    if (!best || evaluation.score > best.score || (evaluation.score === best.score && evaluation.autoSafe && !best.autoSafe)) best = evaluation;
  }

  return { product, ...(best || evaluateText(offerTitle, product, product.name, product.brand, product.quantity_text)) };
}

function isApprovedImage(product: Product | null): boolean {
  return Boolean(product?.image_url && product.image_verified && Number(product.image_quality || 0) >= 70);
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function authorize(request: Request): Promise<boolean> {
  const authHeader = request.headers.get('authorization') || '';
  const cronHeader = request.headers.get('x-cron-secret') || '';
  if (authHeader === `Bearer ${SERVICE_ROLE_KEY}`) return true;
  if (CRON_SECRET && cronHeader === CRON_SECRET) return true;
  if (!authHeader.startsWith('Bearer ')) return false;
  const { data } = await db.auth.getUser(authHeader.slice(7).trim());
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}

async function resolveStoreId(storeSlug: string): Promise<string> {
  const { data, error } = await db.from('stores')
    .select('id')
    .eq('slug', storeSlug)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error(`Obchod ${storeSlug} nebyl nalezen.`);
  return String(data.id);
}

async function loadProducts(): Promise<Product[]> {
  const { data, error } = await db.from('products')
    .select(PRODUCT_SELECT)
    .limit(10_000);
  if (error) throw error;
  return (data || []) as Product[];
}

async function loadAliases(): Promise<Alias[]> {
  const { data, error } = await db.from('product_aliases')
    .select(ALIAS_SELECT)
    .gte('confidence', 0.9)
    .limit(20_000);
  if (error) throw error;
  return (data || []) as Alias[];
}

async function loadOffers(limit: number, options: LoadOfferOptions = {}): Promise<Offer[]> {
  const today = new Date().toISOString().slice(0, 10);
  let query = db.from('offers')
    .select(`id,product_id,store_id,title,image_url,published_at,products(${PRODUCT_SELECT})`)
    .eq('status', 'published')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit);

  if (options.offerId) {
    query = query.eq('id', options.offerId).limit(1);
  } else if (options.recheckMissingImages) {
    if (!options.storeId) throw new Error('recheck_missing_images vyžaduje store_slug.');
    query = query
      .eq('store_id', options.storeId)
      .is('image_url', null)
      .lte('valid_from', today)
      .gte('valid_to', today);
  } else {
    query = query.is('catalog_checked_at', null);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as unknown as Offer[];
}

async function loadExactCandidateData(offers: Offer[]): Promise<{ products: Product[]; aliases: Alias[] }> {
  const normalizedTitles = [...new Set(offers.map((offer) => normalize(offer.title)).filter(Boolean))];
  const productById = new Map<string, Product>();
  const aliasByKey = new Map<string, Alias>();

  for (const offer of offers) {
    if (offer.products) productById.set(offer.products.id, offer.products);
  }

  for (const titleChunk of chunks(normalizedTitles, EXACT_LOOKUP_CHUNK)) {
    for (let from = 0; ; from += EXACT_LOOKUP_PAGE_SIZE) {
      const { data, error } = await db.from('products')
        .select(PRODUCT_SELECT)
        .in('normalized_name', titleChunk)
        .order('id', { ascending: true })
        .range(from, from + EXACT_LOOKUP_PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data || []) as Product[];
      for (const product of rows) productById.set(product.id, product);
      if (rows.length < EXACT_LOOKUP_PAGE_SIZE) break;
    }

    for (let from = 0; ; from += EXACT_LOOKUP_PAGE_SIZE) {
      const { data, error } = await db.from('product_aliases')
        .select(ALIAS_SELECT)
        .in('normalized_alias', titleChunk)
        .gte('confidence', 0.9)
        .order('normalized_alias', { ascending: true })
        .order('product_id', { ascending: true })
        .range(from, from + EXACT_LOOKUP_PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data || []) as Alias[];
      for (const alias of rows) aliasByKey.set(`${alias.product_id}:${alias.normalized_alias}`, alias);
      if (rows.length < EXACT_LOOKUP_PAGE_SIZE) break;
    }
  }

  const missingProductIds = [...new Set([...aliasByKey.values()].map((alias) => alias.product_id))]
    .filter((productId) => !productById.has(productId));

  for (const idChunk of chunks(missingProductIds, 100)) {
    const { data, error } = await db.from('products')
      .select(PRODUCT_SELECT)
      .in('id', idChunk);
    if (error) throw error;
    for (const product of (data || []) as Product[]) productById.set(product.id, product);
  }

  return { products: [...productById.values()], aliases: [...aliasByKey.values()] };
}

async function upsertAlias(productId: string, offer: Offer, product: Product, confidence: number) {
  const normalizedAlias = normalize(offer.title);
  if (!normalizedAlias || !isSpecificTitle(offer.title) || confidence < AUTO_MATCH_THRESHOLD) return;
  const quantity = extractQuantity(offer.title) || product.quantity_text || null;
  const { error } = await db.from('product_aliases').upsert({
    product_id: productId,
    alias: offer.title,
    normalized_alias: normalizedAlias,
    brand: product.brand || null,
    quantity_text: quantity,
    source_store_id: offer.store_id,
    confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(5)),
  }, { onConflict: 'product_id,normalized_alias', ignoreDuplicates: false });
  if (error) throw error;
}

async function markOffer(offerId: string, status: 'matched' | 'retained' | 'needs_review' | 'failed', score: number | null, extra: Record<string, unknown> = {}) {
  const { error } = await db.from('offers').update({
    ...extra,
    catalog_checked_at: new Date().toISOString(),
    catalog_match_status: status,
    catalog_match_score: score == null ? null : Number(Math.max(0, Math.min(1, score)).toFixed(5)),
  }).eq('id', offerId);
  if (error) throw error;
}

async function updateTrustedCurrentProductMetadata(offer: Offer, product: Product, confidence: number) {
  if (!offer.product_id) return;
  const quantity = extractQuantity(offer.title) || null;
  const update: Record<string, unknown> = { normalized_name: normalize(product.name || offer.title) };
  if (!product.quantity_text && quantity) update.quantity_text = quantity;
  const { error } = await db.from('products').update(update).eq('id', offer.product_id);
  if (error) throw error;
  await upsertAlias(offer.product_id, offer, product, confidence);
}

async function mergeOffer(offer: Offer, master: Product, score: number) {
  const approvedImage = isApprovedImage(master) ? master.image_url : null;
  await markOffer(offer.id, 'matched', score, {
    product_id: master.id,
    ...(approvedImage ? { image_url: approvedImage } : {}),
  });

  const { error: itemError } = await db.from('leaflet_import_items')
    .update({ product_id: master.id, ...(approvedImage ? { image_url: approvedImage } : {}) })
    .eq('product_id', offer.product_id)
    .eq('title', offer.title);
  if (itemError) throw itemError;
  await upsertAlias(master.id, offer, master, score);

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

function addToIndex(index: Map<string, Set<string>>, key: string, productId: string) {
  if (!key) return;
  const values = index.get(key) || new Set<string>();
  values.add(productId);
  index.set(key, values);
}

function buildIndexes(products: Product[], aliases: Alias[]) {
  const exact = new Map<string, Set<string>>();
  const tokenIndex = new Map<string, Set<string>>();
  const aliasesByProduct = new Map<string, Alias[]>();

  for (const product of products) {
    const key = normalize(product.normalized_name || product.name);
    addToIndex(exact, key, product.id);
    for (const token of tokenArray(`${product.name} ${product.brand || ''}`).filter((value) => value.length >= 4)) addToIndex(tokenIndex, token, product.id);
  }

  for (const alias of aliases.filter(aliasIsUsable)) {
    const key = normalize(alias.normalized_alias || alias.alias);
    addToIndex(exact, key, alias.product_id);
    for (const token of tokenArray(`${alias.alias} ${alias.brand || ''}`).filter((value) => value.length >= 4)) addToIndex(tokenIndex, token, alias.product_id);
    const rows = aliasesByProduct.get(alias.product_id) || [];
    rows.push(alias);
    aliasesByProduct.set(alias.product_id, rows);
  }

  return { exact, tokenIndex, aliasesByProduct };
}

function candidateIdsFor(title: string, exact: Map<string, Set<string>>, tokenIndex: Map<string, Set<string>>): string[] {
  const normalizedTitle = normalize(title);
  const exactIds = [...(exact.get(normalizedTitle) || [])];
  if (exactIds.length) return exactIds;

  const tokens = tokenArray(title).filter((token) => token.length >= 4);
  const ranked = tokens
    .map((token) => ({ token, size: tokenIndex.get(token)?.size || 0 }))
    .filter((entry) => entry.size > 0)
    .sort((a, b) => a.size - b.size)
    .slice(0, 4);
  const ids = new Set<string>();
  for (const entry of ranked) {
    for (const id of tokenIndex.get(entry.token) || []) {
      ids.add(id);
      if (ids.size >= 300) return [...ids];
    }
  }
  return [...ids];
}

async function processCatalog(limit: number, options: LoadOfferOptions = {}) {
  const startedAt = Date.now();
  const [baselineProducts, baselineAliases, offers] = await Promise.all([loadProducts(), loadAliases(), loadOffers(limit, options)]);
  const exactCandidates = await loadExactCandidateData(offers);

  const productById = new Map<string, Product>();
  for (const product of [...baselineProducts, ...exactCandidates.products]) productById.set(product.id, product);

  const aliasByKey = new Map<string, Alias>();
  for (const alias of [...baselineAliases, ...exactCandidates.aliases]) {
    aliasByKey.set(`${alias.product_id}:${normalize(alias.normalized_alias || alias.alias)}`, alias);
  }

  const { exact, tokenIndex, aliasesByProduct } = buildIndexes([...productById.values()], [...aliasByKey.values()]);

  let checked = 0;
  let matched = 0;
  let retained = 0;
  let needsReview = 0;
  let failed = 0;
  let stoppedByTimeLimit = false;
  const results: unknown[] = [];

  for (const offer of offers) {
    if (Date.now() - startedAt >= MAX_RUN_MS) {
      stoppedByTimeLimit = true;
      break;
    }
    checked++;
    try {
      let best: Evaluation | null = null;
      const candidateIds = new Set(candidateIdsFor(offer.title, exact, tokenIndex));
      if (offer.product_id && productById.has(offer.product_id)) candidateIds.add(offer.product_id);

      for (const productId of candidateIds) {
        const product = productById.get(productId);
        if (!product) continue;
        if (options.recheckMissingImages && !isApprovedImage(product)) continue;
        const evaluation = evaluateCandidate(offer.title, product, aliasesByProduct.get(productId) || []);
        if (!best || evaluation.score > best.score || (evaluation.score === best.score && evaluation.autoSafe && !best.autoSafe)) best = evaluation;
      }

      if (best && best.autoSafe && best.score >= AUTO_MATCH_THRESHOLD) {
        if (best.product.id !== offer.product_id) {
          await mergeOffer(offer, best.product, best.score);
          matched++;
          results.push({ offer_id: offer.id, status: 'matched', product_id: best.product.id, score: Number(best.score.toFixed(3)), source: best.sourceText, quantity_state: best.quantityState });
        } else {
          await updateTrustedCurrentProductMetadata(offer, best.product, best.score);
          await markOffer(offer.id, 'retained', best.score, isApprovedImage(best.product) && offer.image_url !== best.product.image_url
            ? { image_url: best.product.image_url }
            : {});
          retained++;
          results.push({ offer_id: offer.id, status: 'retained', score: Number(best.score.toFixed(3)), source: best.sourceText, quantity_state: best.quantityState });
        }
      } else {
        await markOffer(offer.id, 'needs_review', best?.score || 0);
        needsReview++;
        results.push({
          offer_id: offer.id,
          status: 'needs_review',
          best_score: Number((best?.score || 0).toFixed(3)),
          reasons: best?.reasons || ['no_candidate'],
          quantity_state: best?.quantityState || null,
        });
      }
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`catalog match failed for offer ${offer.id}: ${message}`);
      try { await markOffer(offer.id, 'failed', null); } catch {}
      results.push({ offer_id: offer.id, status: 'failed', error: message });
    }
  }

  return {
    mode: options.recheckMissingImages ? 'recheck_missing_images' : options.offerId ? 'offer_id' : 'unchecked',
    requested: offers.length,
    checked,
    matched,
    retained,
    needs_review: needsReview,
    failed,
    stopped_by_time_limit: stoppedByTimeLimit,
    duration_ms: Date.now() - startedAt,
    remaining_in_batch: Math.max(0, offers.length - checked),
    results,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  if (!(await authorize(request))) return jsonResponse({ error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body.limit) || 40, 80));
    const offerId = body.offer_id ? String(body.offer_id).trim() : undefined;
    const storeSlug = typeof body.store_slug === 'string' ? body.store_slug.trim().toLowerCase() : '';
    const recheckMissingImages = body.recheck_missing_images === true;

    if (offerId && recheckMissingImages) {
      return jsonResponse({ error: 'offer_id nelze kombinovat s recheck_missing_images.' }, 400);
    }
    if (recheckMissingImages && !storeSlug) {
      return jsonResponse({ error: 'recheck_missing_images vyžaduje store_slug.' }, 400);
    }

    const storeId = recheckMissingImages ? await resolveStoreId(storeSlug) : undefined;
    return jsonResponse({
      ok: true,
      store_slug: storeSlug || null,
      recheck_missing_images: recheckMissingImages,
      ...(await processCatalog(limit, { offerId, storeId, recheckMissingImages })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('match-product-catalog failed:', message);
    return jsonResponse({ error: message }, 500);
  }
});
