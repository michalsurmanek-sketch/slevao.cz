import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  });
}

async function requireAdmin(request: Request) {
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const role = String(data.user.app_metadata?.role || '').toLowerCase();
  return role === 'admin' ? data.user : null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = await requireAdmin(request);
  if (!admin) return json({ error: 'Unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  if (body.confirmation !== 'SMAZAT VŠE') {
    return json({ error: 'Chybí potvrzení SMAZAT VŠE.' }, 400);
  }

  try {
    const counts = await Promise.all([
      db.from('products').select('id', { count: 'exact', head: true }).not('image_url', 'is', null),
      db.from('offers').select('id', { count: 'exact', head: true }).not('image_url', 'is', null),
      db.from('leaflet_import_items').select('id', { count: 'exact', head: true }).not('image_url', 'is', null),
      db.from('product_image_candidates').select('id', { count: 'exact', head: true }),
      db.from('product_image_library').select('id', { count: 'exact', head: true }),
    ]);
    for (const result of counts) if (result.error) throw result.error;

    const candidatesDelete = await db.from('product_image_candidates').delete().not('id', 'is', null);
    if (candidatesDelete.error) throw candidatesDelete.error;
    const libraryDelete = await db.from('product_image_library').delete().not('id', 'is', null);
    if (libraryDelete.error) throw libraryDelete.error;

    const now = new Date().toISOString();
    const productsUpdate = await db.from('products').update({
      image_url: null,
      image_source: null,
      image_quality: 0,
      image_verified: false,
      image_checked_at: now,
    }).not('id', 'is', null);
    if (productsUpdate.error) throw productsUpdate.error;

    const offersUpdate = await db.from('offers').update({ image_url: null }).not('id', 'is', null);
    if (offersUpdate.error) throw offersUpdate.error;
    const itemsUpdate = await db.from('leaflet_import_items').update({ image_url: null }).not('id', 'is', null);
    if (itemsUpdate.error) throw itemsUpdate.error;

    console.log('All product images deleted by admin', admin.id);
    return json({
      ok: true,
      products_cleared: counts[0].count || 0,
      offers_cleared: counts[1].count || 0,
      items_cleared: counts[2].count || 0,
      candidates_deleted: counts[3].count || 0,
      library_deleted: counts[4].count || 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('delete-all-product-images failed:', message);
    return json({ error: message }, 500);
  }
});
