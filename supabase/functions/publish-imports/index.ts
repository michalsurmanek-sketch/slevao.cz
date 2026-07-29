import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function normalizeTitle(value: string): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs').replace(/[^a-z0-9]+/g, ' ').trim();
}

async function findExistingProduct(item: any): Promise<string | null> {
  const title = String(item.title || '').trim();
  if (!title) return null;
  const { data, error } = await db.from('products').select('id,name').ilike('name', title).limit(10);
  if (error) throw error;
  const normalized = normalizeTitle(title);
  return (data || []).find((row: any) => normalizeTitle(row.name) === normalized)?.id || null;
}

async function offerAlreadyExists(job: any, item: any, validFrom: string, validTo: string): Promise<boolean> {
  let query = db.from('offers').select('id,title,price')
    .eq('store_id', job.store_id)
    .eq('valid_from', validFrom)
    .eq('valid_to', validTo)
    .eq('price', item.price)
    .eq('coverage_scope', job.coverage_scope || 'national');
  if (job.region_code) query = query.eq('region_code', job.region_code); else query = query.is('region_code', null);
  if (job.city_name) query = query.eq('city_name', job.city_name); else query = query.is('city_name', null);
  if (job.store_location_name) query = query.eq('store_location_name', job.store_location_name); else query = query.is('store_location_name', null);
  const { data, error } = await query.limit(50);
  if (error) throw error;
  const normalized = normalizeTitle(item.title);
  return (data || []).some((row: any) => normalizeTitle(row.title) === normalized);
}

async function publishImport(job: any) {
  const { data: items, error } = await db.from('leaflet_import_items').select('*').eq('import_id', job.id).in('status', ['approved', 'review']);
  if (error) throw error;
  if (!items?.length) throw new Error('Import nemá žádné produkty k publikaci.');

  const validFrom = job.detected_valid_from || new Date().toISOString().slice(0, 10);
  const validTo = job.detected_valid_to || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  let published = 0, skippedDuplicates = 0, failed = 0;

  for (const item of items) {
    try {
      if (await offerAlreadyExists(job, item, validFrom, validTo)) {
        await db.from('leaflet_import_items').update({ status: 'ignored', raw_data: { ...(item.raw_data || {}), ignored_reason: 'duplicate_offer' } }).eq('id', item.id);
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
  const authorized = request.headers.get('authorization') === `Bearer ${SERVICE_ROLE_KEY}` || (!CRON_SECRET || request.headers.get('x-cron-secret') === CRON_SECRET);
  if (!authorized) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {};
  let query = db.from('leaflet_imports').select('*').eq('status', 'publishing').limit(10);
  if (body.import_id) query = db.from('leaflet_imports').select('*').eq('id', body.import_id).limit(1);
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
