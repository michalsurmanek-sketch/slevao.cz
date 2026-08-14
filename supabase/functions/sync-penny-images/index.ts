import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { parse } from 'https://esm.sh/devalue@5.3.2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const SOURCE = 'https://www.penny.cz/akcni-polozky';
const CDN = /^https:\/\/images\.cdn\.europe-west1\.gcp\.commercetools\.com\//i;
const H = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,content-type,x-cron-secret',
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: H });
const allowed = (request: Request) => request.headers.get('authorization') === `Bearer ${SERVICE}` || Boolean(CRON && request.headers.get('x-cron-secret') === CRON);

function pragueToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function imageUrl(value: unknown): string | null {
  if (typeof value === 'string' && CDN.test(value) && /\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = imageUrl(item);
      if (result) return result;
    }
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      const result = imageUrl(item);
      if (result) return result;
    }
  }
  return null;
}

function collect(root: unknown) {
  const found = new Map<string, { slug: string; name: string | null; image_url: string }>();
  const seen = new WeakSet<object>();
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object' || seen.has(value as object)) return;
    seen.add(value as object);
    if (!Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const slug = typeof record.slug === 'string' ? record.slug : '';
      if (/^.+-\d{6,}$/.test(slug) && record.images) {
        const image = imageUrl(record.images);
        if (image) found.set(slug, { slug, name: typeof record.name === 'string' ? record.name : null, image_url: image });
      }
    }
    for (const item of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) walk(item);
  };
  walk(root);
  return found;
}

const identity = (value: unknown) => value;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: H });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(request)) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const today = pragueToday();
    const response = await fetch(SOURCE, {
      headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html', 'accept-language': 'cs-CZ,cs;q=0.9' },
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`PENNY HTTP ${response.status}`);
    const html = await response.text();
    const raw = html.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1]?.trim();
    if (!raw) throw new Error('PENNY __NUXT_DATA__ not found');

    const hydration = parse(raw, { ShallowReactive: identity, Reactive: identity, Ref: identity, EmptyRef: identity });
    const images = collect(hydration);
    if (images.size < 20 || images.size > 300) throw new Error(`PENNY hydration image count ${images.size} outside 20-300`);

    const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'penny').single();
    if (storeError || !store) throw storeError || new Error('PENNY store missing');

    const { data: offers, error: offerError } = await db.from('offers')
      .select('id,product_id,title,metadata,image_url')
      .eq('store_id', store.id)
      .eq('status', 'published')
      .eq('is_verified', true)
      .lte('valid_from', today)
      .gte('valid_to', today);
    if (offerError) throw offerError;

    const matched = (offers || []).map((offer: any) => {
      const slug = String(offer.metadata?.penny_product_slug || '');
      const hit = images.get(slug);
      return hit && offer.product_id ? { offer, slug, image_url: hit.image_url, name: hit.name } : null;
    }).filter(Boolean) as any[];

    if ((offers || []).length < 20) throw new Error(`PENNY active verified offers ${(offers || []).length} below 20`);
    if (matched.length < 20 || matched.length !== (offers || []).length) throw new Error(`PENNY exact image overlap ${matched.length}/${(offers || []).length}; refusing partial publish`);

    const productIds = [...new Set(matched.map((match) => String(match.offer.product_id)))];
    const { data: products, error: productError } = await db.from('products').select('id,metadata').in('id', productIds);
    if (productError) throw productError;
    const productMetadata = new Map((products || []).map((product: any) => [String(product.id), product.metadata || {}]));
    if (productMetadata.size !== productIds.length) throw new Error(`PENNY product metadata ${productMetadata.size}/${productIds.length}`);

    if (body.dry_run === true) {
      return json({
        ok: true,
        dry_run: true,
        hydration_images: images.size,
        active_offers: (offers || []).length,
        matched: matched.length,
        rows: matched.map((match) => ({ slug: match.slug, title: match.offer.title, image_url: match.image_url })),
      });
    }

    const now = new Date().toISOString();
    let updatedProducts = 0;
    let updatedOffers = 0;
    for (const match of matched) {
      const productId = String(match.offer.product_id);
      const productMeta = productMetadata.get(productId) || {};
      const { error: updateProductError } = await db.from('products').update({
        image_url: match.image_url,
        image_verified: true,
        image_source: 'penny_official_hydration',
        image_quality: 100,
        metadata: {
          ...productMeta,
          penny_product_slug: match.slug,
          official_image_url: match.image_url,
          official_image_source: 'penny_hydration_commercetools',
          official_image_verified_at: now,
        },
        updated_at: now,
      }).eq('id', productId);
      if (updateProductError) throw updateProductError;
      updatedProducts++;

      const { error: updateOfferError } = await db.from('offers').update({
        image_url: match.image_url,
        metadata: {
          ...(match.offer.metadata || {}),
          official_image_url: match.image_url,
          official_image_source: 'penny_hydration_commercetools',
          official_image_verified_at: now,
        },
        updated_at: now,
      }).eq('id', match.offer.id);
      if (updateOfferError) throw updateOfferError;
      updatedOffers++;
    }

    return json({ ok: true, hydration_images: images.size, matched: matched.length, updated_products: updatedProducts, updated_offers: updatedOffers });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error), code: 'PENNY_IMAGE_SYNC_FAILED' }, 500);
  }
});
