import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://maximum.drmax.cz/letak';
const UPSTREAM_URL = `${SUPABASE_URL}/functions/v1/sync-dr-max-source`;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'content-type': 'application/json; charset=utf-8',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

async function allowed(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE_ROLE_KEY) return true;
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}

function isWaitingSource(message: string) {
  return /Dr\. Max označuje aktuální leták jako ukončený|Dr\. Max nevrátil aktuální vydání letáku/i.test(message);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  const checkedAt = new Date().toISOString();
  try {
    const upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
        'content-type': 'application/json',
      },
      body: '{}',
    });
    const text = await upstream.text();
    let payload: any = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    const message = String(payload?.error || payload?.message || '');

    if (upstream.status === 500 && isWaitingSource(message)) {
      const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'dr-max').single();
      if (storeError || !store) throw storeError || new Error('Obchod Dr. Max nebyl nalezen.');

      const { error: sourceError } = await db.from('leaflet_sources').update({
        last_checked_at: checkedAt,
        last_success_at: checkedAt,
        last_error: null,
        last_strategy_used: 'official_triobo_waiting_source',
        last_strategy_success_at: checkedAt,
      }).eq('store_id', store.id).eq('source_url', SOURCE_URL).eq('is_active', true);
      if (sourceError) throw sourceError;

      const { error: stateError } = await db.from('store_product_sync_state').update({
        last_run_at: checkedAt,
        last_success_at: checkedAt,
        last_offer_count: 0,
        last_published_count: 0,
        last_error: null,
        last_parser_error: null,
        is_running: false,
        run_started_at: null,
        health_status: 'waiting_source',
        health_reason: 'Dr. Max: oficiální zdroj je dostupný, ale nové aktuální vydání zatím nebylo zveřejněno.',
        adapter_name: 'drmax-triobo-document-v1',
        adapter_version: 'v1',
        updated_at: checkedAt,
      }).eq('store_id', store.id);
      if (stateError) throw stateError;

      return json({ ok: true, waiting_source: true, store: store.name, upstream_status: upstream.status, upstream_message: message });
    }

    return new Response(text, { status: upstream.status, headers: HEADERS });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
