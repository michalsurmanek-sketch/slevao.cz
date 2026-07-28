import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function publishImport(job: any) {
  const { data: items, error } = await db
    .from('leaflet_import_items')
    .select('*')
    .eq('import_id', job.id)
    .in('status', ['approved', 'review']);
  if (error) throw error;
  if (!items?.length) throw new Error('Import nemá žádné produkty k publikaci.');

  const validFrom = job.detected_valid_from || new Date().toISOString().slice(0, 10);
  const validTo = job.detected_valid_to || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  let published = 0;

  for (const item of items) {
    try {
      let productId = item.product_id;
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
      });
      if (offerError) throw offerError;

      await db.from('leaflet_import_items').update({ status: 'published', product_id: productId }).eq('id', item.id);
      published++;
    } catch (itemError) {
      await db.from('leaflet_import_items').update({
        status: 'failed',
        raw_data: { ...(item.raw_data || {}), publish_error: itemError instanceof Error ? itemError.message : String(itemError) },
      }).eq('id', item.id);
    }
  }

  await db.from('leaflet_imports').update({
    status: published ? 'published' : 'failed',
    product_count: published,
    error_message: published ? null : 'Nepodařilo se publikovat žádný produkt.',
    finished_at: new Date().toISOString(),
  }).eq('id', job.id);

  return { import_id: job.id, published };
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
    try {
      results.push(await publishImport(job));
    } catch (jobError) {
      const message = jobError instanceof Error ? jobError.message : String(jobError);
      await db.from('leaflet_imports').update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() }).eq('id', job.id);
      results.push({ import_id: job.id, error: message });
    }
  }

  return Response.json({ ok: true, processed: results.length, results });
});