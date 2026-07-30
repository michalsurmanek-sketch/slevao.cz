import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://www.coopclub.cz/letaky/';
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function isAllowed(request: Request): Promise<boolean> {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE_ROLE_KEY) return true;
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  const role = String(data.user?.app_metadata?.role || data.user?.user_metadata?.role || '').toLowerCase();
  return ['admin', 'editor'].includes(role);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!(await isAllowed(request))) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });

  try {
    const { data: store, error: storeError } = await db
      .from('stores')
      .select('id,name,slug')
      .eq('slug', 'coop')
      .maybeSingle();

    if (storeError) throw storeError;
    if (!store) {
      return Response.json({
        ok: false,
        skipped: true,
        reason: 'V tabulce stores zatím chybí obchod se slugem coop.',
      }, { headers: CORS_HEADERS });
    }

    const { data: existing, error: sourceError } = await db
      .from('leaflet_sources')
      .select('id,source_url,is_active,auto_publish')
      .eq('store_id', store.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (sourceError) throw sourceError;

    if (existing) {
      const { error } = await db.from('leaflet_sources').update({
        name: 'COOP – aktuální letáky',
        source_url: SOURCE_URL,
        source_type: 'html',
        is_active: true,
        auto_publish: true,
        check_interval_minutes: 360,
        last_error: null,
      }).eq('id', existing.id);
      if (error) throw error;
      return Response.json({ ok: true, created: false, source_id: existing.id, store: store.name }, { headers: CORS_HEADERS });
    }

    const { data: created, error: insertError } = await db.from('leaflet_sources').insert({
      store_id: store.id,
      name: 'COOP – aktuální letáky',
      source_url: SOURCE_URL,
      source_type: 'html',
      coverage_scope: 'national',
      check_interval_minutes: 360,
      auto_publish: true,
      is_active: true,
    }).select('id').single();

    if (insertError) throw insertError;
    return Response.json({ ok: true, created: true, source_id: created.id, store: store.name }, { headers: CORS_HEADERS });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500, headers: CORS_HEADERS });
  }
});
