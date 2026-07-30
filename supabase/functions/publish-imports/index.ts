import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function normalizeTitle(value: string): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs').replace(/[^a-z0-9]+/g, ' ').trim();
}

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

async function findExistingProduct(item: any): Promise<string | null> {
  const title = String(item.title || '').trim();
  if (!title) return null;
  const { data, error } = await db.from('products').select('id,name').ilike('name', title).limit(10);
  if (error) throw error;
  const normalized = normalizeTitle(title);
  return (data || []).find((row: any) => normalizeTitle(row.name) === normalized)?.id || null;
}

async function findExistingOffer(job: any, item: any, validFrom: string, validTo: string): Promise<any | null> {
  let query = db.from('offers').select('id,product_id,title,price')
    .eq('store_id', job.store_id)
    .eq('valid_from', validFrom)
    .eq('valid_to', validTo)
    .eq('coverage_scope', job.coverage_scope || 'national');
  if (job.region_code) query = query.eq('region_code', job.region_code); else query = query.is('region_code', null);
  if (job.city_name) query = query.eq('city_name', job.city_name); else query = query.is('city_name', null);
  if (job.store_location_name) query = query.eq('store_location_name', job.store_location_name); else query = query.is('store_location_name', null);
  const { data, error } = await query.limit(100);
  if (error) throw error;
  const normalized = normalizeTitle(item.title);
  return (data || []).find((row: any) => normalizeTitle(row.title) === normalized) || null;
}

async function publishImport(job: any) {
  if (!['review', 'publishing'].includes(String(job.status || ''))) {
    throw new Error(`Import ve stavu ${job.status || 'neznámý'} nelze publikovat.`);
  }

  const { data: items, error } = await db.from('leaflet_import_items').select('*').eq('import_id', job.id).in('status', ['approved', 'review']);
  if (error) throw error;
  if (!items?.length) throw new Error('Import nemá žádné produkty k publikaci.');

  if (!isIsoDate(job.detected_valid_from) || !isIsoDate(job.detected_valid_to)) {
    throw new Error('Import nemá spolehlivě rozpoznanou platnost letáku.');
  }

  const validFrom = job.detected_valid_from;
  const validTo = job.detected_valid_to;
  if (validFrom > validTo) throw new Error('Začátek platnosti je později než konec platnosti.');
  const today = new Date().toISOString().slice(0, 10);
  if (validTo < today) throw new Error('Leták už není platný.');

  let published = 0, skippedDuplicates = 0, failed = 0;

  for (const item of items) {
    try {
      if (!item.title?.trim() || !(Number(item.price) > 0)) throw new Error('Položka nemá platný název nebo cenu.');

      const existingOffer = await findExistingOffer(job, item, validFrom, validTo);
      if (existingOffer && String(job.metadata?.adapter || '') === 'store:makro') {
        const { error: updateOfferError } = await db.from('offers').update({
          price: item.price,
          old_price: item.old_price,
          image_url: item.image_url,
          is_verified: Number(item.confidence || 0) >= 0.9,
          published_at: new Date().toISOString(),
        }).eq('id', existingOffer.id);
        if (updateOfferError) throw updateOfferError;
        await db.from('leaflet_import_items').update({ status: 'published', product_id: existingOffer.product_id }).eq('id', item.id);
        published++;
        continue;
      }
      if (existingOffer && Number(existingOffer.price) === Number(item.price)) {
        let imageBackfilled = false;
        if (item.image_url) {
          const { error: imageOfferError } = await db.from('offers').update({ image_url: item.image_url }).eq('id', existingOffer.id);
          if (imageOfferError) throw imageOfferError;
          if (existingOffer.product_id) {
            const { error: imageProductError } = await db.from('products').update({ image_url: item.image_url }).eq('id', existingOffer.product_id);
            if (imageProductError) throw imageProductError;
          }
          imageBackfilled = true;
        }
        await db.from('leaflet_import_items').update({
          status: 'ignored',
          raw_data: { ...(item.raw_data || {}), ignored_reason: 'duplicate_offer', image_backfilled: imageBackfilled },
        }).eq('id', item.id);
        skippedDuplicates++;
        continue;
      }

      let productId = item.product_id || await findExistingProduct(item);
      if (!productId) {
        const { data: product, error: productError } = await db.from('products').insert({
          name: item.title,
          category_id: item.category_id,
          image_url: item.image_url,
          is_verified: Number(item.confidence || 0) >= 0.9,
        }).select('id').single();
        if (productError) throw productError;
        productId = product.id;
      }

      const { error: offerError } = await db.from('offers').insert({
        product_id: productId,
        store_id: job.store_id,
        title: item.title,
        price: item.price,
        old_price: item.old_price,
        image_url: item.image_url,
        valid_from: validFrom,
        valid_to: validTo,
        status: 'published',
        is_verified: Number(item.confidence || 0) >= 0.9,
        published_at: new Date().toISOString(),
        coverage_scope: job.coverage_scope || 'national',
        region_code: job.region_code || null,
        city_name: job.city_name || null,
        store_location_name: job.store_location_name || null,
      });
      if (offerError) throw offerError;

      await db.from('leaflet_import_items').update({ status: 'published', product_id: productId }).eq('id', item.id);
      published++;
    } catch (itemError) {
      failed++;
      await db.from('leaflet_import_items').update({
        status: 'failed',
        raw_data: { ...(item.raw_data || {}), publish_error: itemError instanceof Error ? itemError.message : String(itemError) },
      }).eq('id', item.id);
    }
  }

  const completed = published > 0 || skippedDuplicates > 0;
  await db.from('leaflet_imports').update({
    status: completed ? 'published' : 'failed',
    product_count: published,
    error_message: completed ? (failed ? `${failed} položek se nepodařilo publikovat. ${skippedDuplicates} duplicit bylo přeskočeno.` : null) : 'Nepodařilo se publikovat žádný produkt.',
    metadata: { ...(job.metadata || {}), published_count: published, duplicate_count: skippedDuplicates, failed_count: failed },
    finished_at: new Date().toISOString(),
  }).eq('id', job.id);

  return { import_id: job.id, published, duplicates: skippedDuplicates, failed };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok');
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  const authHeader = request.headers.get('authorization') || '';
  const cronHeader = request.headers.get('x-cron-secret') || '';
  const authorizedByServiceRole = authHeader === `Bearer ${SERVICE_ROLE_KEY}`;
  const authorizedByCron = Boolean(CRON_SECRET && cronHeader === CRON_SECRET);
  let authorizedByUser = false;
  if (!authorizedByServiceRole && !authorizedByCron && authHeader.startsWith('Bearer ')) {
    const accessToken = authHeader.slice(7).trim();
    const { data: userData } = await db.auth.getUser(accessToken);
    const role = String(userData.user?.app_metadata?.role || userData.user?.user_metadata?.role || '').toLowerCase();
    authorizedByUser = ['admin', 'editor'].includes(role);
  }
  if (!authorizedByServiceRole && !authorizedByCron && !authorizedByUser) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  let query = db.from('leaflet_imports').select('*').eq('status', 'publishing').limit(10);
  if (body.import_id) query = db.from('leaflet_imports').select('*').eq('id', String(body.import_id)).limit(1);
  const { data: jobs, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results = [];
  for (const job of jobs || []) {
    try { results.push(await publishImport(job)); }
    catch (jobError) {
      const message = jobError instanceof Error ? jobError.message : String(jobError);
      await db.from('leaflet_imports').update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() }).eq('id', job.id);
      results.push({ import_id: job.id, error: message });
    }
  }
  return Response.json({ ok: true, processed: results.length, results });
});