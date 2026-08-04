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

type ProductResolution = {
  productId: string;
  imageUrl: string | null;
  matchType: string;
  matchScore: number;
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  });
}

function normalizeTitle(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

function isTescoJob(job: any): boolean {
  const slug = String(job.stores?.slug || '').toLowerCase();
  const adapter = String(job.metadata?.adapter || '').toLowerCase();
  const sourceUrl = String(job.source_url || job.metadata?.source_url || '').toLowerCase();
  return slug.includes('tesco') || adapter.includes('tesco') || sourceUrl.includes('tesco');
}

function cleanText(value: unknown): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function extractEan(item: any): string | null {
  const raw = item?.raw_data || {};
  const values = [
    item?.ean,
    item?.gtin,
    item?.barcode,
    raw?.ean,
    raw?.gtin,
    raw?.barcode,
    raw?.product_ean,
    raw?.product?.ean,
    raw?.product?.gtin,
  ];
  for (const value of values) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 14) return digits;
  }
  return null;
}

function safeIncomingImage(value: unknown): string | null {
  const image = String(value ?? '').trim();
  if (!/^https:\/\//i.test(image)) return null;
  if (/placeholder|no[-_ ]?image|favicon|(?:^|[\/_-])logo(?:[\/_.-]|$)|\/leaflet-crops\//i.test(image)) return null;
  return image;
}

async function loadProduct(productId: string): Promise<any | null> {
  const { data, error } = await db.from('products')
    .select('id,name,brand,quantity_text,ean,category_id,image_url,image_source,image_quality,image_verified')
    .eq('id', productId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function verifiedImageFromProduct(product: any): string | null {
  if (!product?.image_verified || Number(product?.image_quality || 0) < 70) return null;
  const image = safeIncomingImage(product?.image_url);
  return image;
}

async function resolveProduct(job: any, item: any): Promise<ProductResolution | null> {
  if (item.product_id) {
    const product = await loadProduct(String(item.product_id));
    if (product) {
      return {
        productId: product.id,
        imageUrl: verifiedImageFromProduct(product),
        matchType: 'linked_product',
        matchScore: 1,
      };
    }
  }

  const { data, error } = await db.rpc('resolve_product_for_import', {
    p_title: String(item.title || ''),
    p_brand: cleanText(item.brand),
    p_quantity: cleanText(item.quantity_text),
    p_ean: extractEan(item),
    p_store_id: job.store_id || null,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.matched_product_id) return null;

  return {
    productId: String(row.matched_product_id),
    imageUrl: safeIncomingImage(row.matched_image_url),
    matchType: String(row.match_type || 'database_match'),
    matchScore: Number(row.match_score || 0),
  };
}

async function enrichExistingProduct(productId: string, item: any): Promise<void> {
  const product = await loadProduct(productId);
  if (!product) return;

  const payload: Record<string, unknown> = {};
  const brand = cleanText(item.brand);
  const quantity = cleanText(item.quantity_text);
  const ean = extractEan(item);

  if (!product.brand && brand) payload.brand = brand;
  if (!product.quantity_text && quantity) payload.quantity_text = quantity;
  if (!product.ean && ean) payload.ean = ean;
  if (!product.category_id && item.category_id) payload.category_id = item.category_id;

  if (Object.keys(payload).length) {
    const { error } = await db.from('products').update(payload).eq('id', productId);
    if (error && !/duplicate key|unique constraint/i.test(error.message)) throw error;
  }
}

async function createProduct(item: any): Promise<ProductResolution> {
  const payload = {
    name: String(item.title || '').trim(),
    category_id: item.category_id || null,
    brand: cleanText(item.brand),
    quantity_text: cleanText(item.quantity_text),
    ean: extractEan(item),
    image_url: null,
    image_verified: false,
    image_quality: 0,
    is_verified: Number(item.confidence || 0) >= 0.9,
    metadata: {
      created_from_leaflet_import: true,
      source_confidence: Number(item.confidence || 0) || null,
    },
  };

  const { data: product, error } = await db.from('products').insert(payload).select('id').single();
  if (error) {
    if (/duplicate key|unique constraint/i.test(error.message)) {
      const fallback = await db.rpc('resolve_product_for_import', {
        p_title: payload.name,
        p_brand: payload.brand,
        p_quantity: payload.quantity_text,
        p_ean: payload.ean,
        p_store_id: null,
      });
      if (!fallback.error) {
        const row = Array.isArray(fallback.data) ? fallback.data[0] : fallback.data;
        if (row?.matched_product_id) {
          return {
            productId: String(row.matched_product_id),
            imageUrl: safeIncomingImage(row.matched_image_url),
            matchType: String(row.match_type || 'unique_conflict_match'),
            matchScore: Number(row.match_score || 1),
          };
        }
      }
    }
    throw error;
  }

  return {
    productId: product.id,
    imageUrl: null,
    matchType: 'new_product',
    matchScore: 1,
  };
}

async function resolveOrCreateProduct(job: any, item: any): Promise<ProductResolution> {
  const resolved = await resolveProduct(job, item);
  if (resolved) {
    await enrichExistingProduct(resolved.productId, item);
    return resolved;
  }
  return await createProduct(item);
}

async function markLibraryImageUsed(productId: string, imageUrl: string | null): Promise<void> {
  if (!imageUrl) return;
  const { error } = await db.rpc('mark_product_image_used', { p_product_id: productId });
  if (error) console.warn('Počítadlo použití fotografie se nepodařilo zvýšit:', error.message);
}

async function findExistingOffer(job: any, item: any, validFrom: string, validTo: string): Promise<any | null> {
  let query = db.from('offers')
    .select('id,product_id,title,price,old_price,image_url,metadata')
    .eq('store_id', job.store_id)
    .eq('valid_from', validFrom)
    .eq('valid_to', validTo)
    .eq('coverage_scope', job.coverage_scope || 'national');
  if (job.region_code) query = query.eq('region_code', job.region_code); else query = query.is('region_code', null);
  if (job.city_name) query = query.eq('city_name', job.city_name); else query = query.is('city_name', null);
  if (job.store_location_name) query = query.eq('store_location_name', job.store_location_name); else query = query.is('store_location_name', null);
  const { data, error } = await query.limit(200);
  if (error) throw error;
  const normalized = normalizeTitle(item.title);
  return (data || []).find((row: any) => normalizeTitle(row.title) === normalized) || null;
}

async function deleteAllOldTescoOffers(): Promise<{ deleted: number; storeIds: string[] }> {
  const { data: stores, error: storesError } = await db.from('stores')
    .select('id,slug,name')
    .or('slug.ilike.%tesco%,name.ilike.%tesco%');
  if (storesError) throw storesError;

  const storeIds = [...new Set((stores || []).map((store: any) => String(store.id || '')).filter(Boolean))];
  if (!storeIds.length) throw new Error('Obchod Tesco nebyl v databázi nalezen.');

  const { data: deletedRows, error: deleteError } = await db.from('offers')
    .delete()
    .in('store_id', storeIds)
    .select('id');
  if (deleteError) throw deleteError;

  const { count, error: remainingError } = await db.from('offers')
    .select('id', { count: 'exact', head: true })
    .in('store_id', storeIds);
  if (remainingError) throw remainingError;
  if ((count || 0) !== 0) throw new Error(`Po vyčištění zůstalo ${count} starých Tesco nabídek.`);

  return { deleted: deletedRows?.length || 0, storeIds };
}

function deduplicateItems(items: any[]): { unique: any[]; duplicateIds: string[] } {
  const seen = new Set<string>();
  const unique: any[] = [];
  const duplicateIds: string[] = [];

  for (const item of items) {
    const key = `${normalizeTitle(item.title)}|${Number(item.price || 0).toFixed(2)}|${Number(item.old_price || 0).toFixed(2)}`;
    if (!normalizeTitle(item.title) || seen.has(key)) {
      if (item.id) duplicateIds.push(item.id);
      continue;
    }
    seen.add(key);
    unique.push(item);
  }
  return { unique, duplicateIds };
}

async function publishImport(job: any) {
  if (!['review', 'publishing'].includes(String(job.status || ''))) {
    throw new Error(`Import ve stavu ${job.status || 'neznámý'} nelze publikovat.`);
  }

  const { data: loadedItems, error } = await db.from('leaflet_import_items')
    .select('*')
    .eq('import_id', job.id)
    .in('status', ['approved', 'review']);
  if (error) throw error;
  if (!loadedItems?.length) throw new Error('Import nemá žádné produkty k publikaci.');

  if (!isIsoDate(job.detected_valid_from) || !isIsoDate(job.detected_valid_to)) {
    throw new Error('Import nemá spolehlivě rozpoznanou platnost letáku.');
  }

  const validFrom = job.detected_valid_from;
  const validTo = job.detected_valid_to;
  if (validFrom > validTo) throw new Error('Začátek platnosti je později než konec platnosti.');
  const today = new Date().toISOString().slice(0, 10);
  if (validTo < today) throw new Error('Leták už není platný.');

  const tesco = isTescoJob(job);
  let deletedOldOffers = 0;
  let tescoStoreIds: string[] = [];

  if (tesco) {
    const cleanup = await deleteAllOldTescoOffers();
    deletedOldOffers = cleanup.deleted;
    tescoStoreIds = cleanup.storeIds;
  }

  const deduplicated = deduplicateItems(loadedItems);
  const items = deduplicated.unique;
  if (deduplicated.duplicateIds.length) {
    await db.from('leaflet_import_items').update({
      status: 'ignored',
      raw_data: { ignored_reason: 'duplicate_inside_import' },
    }).in('id', deduplicated.duplicateIds);
  }

  let published = 0;
  let skippedDuplicates = deduplicated.duplicateIds.length;
  let failed = 0;
  let reusedLibraryImages = 0;
  const matchTypes: Record<string, number> = {};

  for (const item of items) {
    try {
      if (!item.title?.trim() || !(Number(item.price) > 0)) {
        throw new Error('Položka nemá platný název nebo cenu.');
      }

      const existingOffer = tesco ? null : await findExistingOffer(job, item, validFrom, validTo);
      const resolution = await resolveOrCreateProduct(job, {
        ...item,
        product_id: existingOffer?.product_id || item.product_id || null,
      });
      matchTypes[resolution.matchType] = (matchTypes[resolution.matchType] || 0) + 1;

      const incomingImage = safeIncomingImage(item.image_url);
      const finalImage = resolution.imageUrl || incomingImage || existingOffer?.image_url || null;
      const usedLibraryImage = Boolean(resolution.imageUrl && finalImage === resolution.imageUrl);
      const matchMetadata = {
        product_match_type: resolution.matchType,
        product_match_score: resolution.matchScore,
        reused_verified_product_image: usedLibraryImage,
        incoming_ean: extractEan(item),
      };

      if (existingOffer) {
        const samePrice = Number(existingOffer.price) === Number(item.price);
        const { error: updateOfferError } = await db.from('offers').update({
          product_id: resolution.productId,
          price: item.price,
          old_price: item.old_price ?? existingOffer.old_price ?? null,
          image_url: finalImage,
          is_verified: Number(item.confidence || 0) >= 0.9,
          metadata: { ...(existingOffer.metadata || {}), ...matchMetadata },
          published_at: new Date().toISOString(),
        }).eq('id', existingOffer.id);
        if (updateOfferError) throw updateOfferError;

        await db.from('leaflet_import_items').update({
          status: samePrice ? 'ignored' : 'published',
          product_id: resolution.productId,
          image_url: finalImage,
          raw_data: {
            ...(item.raw_data || {}),
            ...matchMetadata,
            existing_offer_id: existingOffer.id,
            ...(samePrice
              ? { ignored_reason: 'duplicate_offer' }
              : { publish_action: 'updated_existing_offer' }),
          },
        }).eq('id', item.id);

        if (usedLibraryImage) {
          reusedLibraryImages++;
          await markLibraryImageUsed(resolution.productId, resolution.imageUrl);
        }
        if (samePrice) skippedDuplicates++; else published++;
        continue;
      }

      const { error: offerError } = await db.from('offers').insert({
        product_id: resolution.productId,
        store_id: job.store_id,
        title: item.title,
        price: item.price,
        old_price: item.old_price,
        image_url: finalImage,
        valid_from: validFrom,
        valid_to: validTo,
        status: 'published',
        is_verified: Number(item.confidence || 0) >= 0.9,
        published_at: new Date().toISOString(),
        coverage_scope: job.coverage_scope || 'national',
        region_code: job.region_code || null,
        city_name: job.city_name || null,
        store_location_name: job.store_location_name || null,
        metadata: matchMetadata,
      });
      if (offerError) throw offerError;

      await db.from('leaflet_import_items').update({
        status: 'published',
        product_id: resolution.productId,
        image_url: finalImage,
        raw_data: {
          ...(item.raw_data || {}),
          ...matchMetadata,
          publish_action: 'created_offer',
        },
      }).eq('id', item.id);

      if (usedLibraryImage) {
        reusedLibraryImages++;
        await markLibraryImageUsed(resolution.productId, resolution.imageUrl);
      }
      published++;
    } catch (itemError) {
      failed++;
      await db.from('leaflet_import_items').update({
        status: 'failed',
        raw_data: {
          ...(item.raw_data || {}),
          publish_error: itemError instanceof Error ? itemError.message : String(itemError),
        },
      }).eq('id', item.id);
    }
  }

  if (tesco) {
    const { count, error: finalCountError } = await db.from('offers')
      .select('id', { count: 'exact', head: true })
      .in('store_id', tescoStoreIds)
      .eq('status', 'published');
    if (finalCountError) throw finalCountError;
    if ((count || 0) !== published) {
      throw new Error(`Kontrola Tesco selhala: publikováno ${published}, ale v databázi je ${count || 0} nabídek.`);
    }
  }

  const completed = published > 0 || skippedDuplicates > 0;
  await db.from('leaflet_imports').update({
    status: completed ? 'published' : 'failed',
    product_count: published,
    error_message: completed
      ? (failed
        ? `${failed} položek se nepodařilo publikovat. ${skippedDuplicates} duplicit bylo přeskočeno.`
        : null)
      : 'Nepodařilo se publikovat žádný produkt.',
    metadata: {
      ...(job.metadata || {}),
      published_count: published,
      duplicate_count: skippedDuplicates,
      failed_count: failed,
      deleted_old_offers: deletedOldOffers,
      tesco_full_replacement: tesco,
      reused_product_library_images: reusedLibraryImages,
      product_match_types: matchTypes,
      product_image_library_version: 1,
    },
    finished_at: new Date().toISOString(),
  }).eq('id', job.id);

  return {
    import_id: job.id,
    published,
    duplicates: skippedDuplicates,
    failed,
    reused_library_images: reusedLibraryImages,
    match_types: matchTypes,
    deleted_old_offers: deletedOldOffers,
    tesco_full_replacement: tesco,
  };
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
      const accessToken = authHeader.slice(7).trim();
      const { data: userData } = await db.auth.getUser(accessToken);
      const role = String(userData.user?.app_metadata?.role || '').toLowerCase();
      authorizedByUser = ['admin', 'editor'].includes(role);
    }

    if (!authorizedByServiceRole && !authorizedByCron && !authorizedByUser) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const body = await request.json().catch(() => ({}));
    let query = db.from('leaflet_imports')
      .select('*,stores(slug,name)')
      .eq('status', 'publishing')
      .limit(10);
    if (body.import_id) {
      query = db.from('leaflet_imports')
        .select('*,stores(slug,name)')
        .eq('id', String(body.import_id))
        .limit(1);
    }
    const { data: jobs, error } = await query;
    if (error) return jsonResponse({ error: error.message }, 500);

    const results = [];
    for (const job of jobs || []) {
      try {
        results.push(await publishImport(job));
      } catch (jobError) {
        const message = jobError instanceof Error ? jobError.message : String(jobError);
        await db.from('leaflet_imports').update({
          status: 'failed',
          error_message: message,
          finished_at: new Date().toISOString(),
        }).eq('id', job.id);
        results.push({ import_id: job.id, error: message });
      }
    }

    return jsonResponse({ ok: true, processed: results.length, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('publish-imports failed:', message);
    return jsonResponse({ error: message }, 500);
  }
});
