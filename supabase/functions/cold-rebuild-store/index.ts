import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};

const COLD_REBUILD_ADAPTERS: Record<string, string> = {
  pepco: 'sync-pepco-source',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

async function authorize(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  if (authorization === `Bearer ${SERVICE_ROLE_KEY}`) return true;
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return true;
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return false;
  return String(data.user.app_metadata?.role || '').toLowerCase() === 'admin';
}

async function invoke(functionName: string, body: Record<string, unknown> = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data: any = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* handled below */ }
    if (!response.ok) throw new Error(`${functionName} HTTP ${response.status}: ${text.slice(0, 600)}`);
    if (data?.error) throw new Error(String(data.error));
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function newestImport(storeSlug: string, startedAt: string) {
  const { data: store, error: storeError } = await db.from('stores')
    .select('id').eq('slug', storeSlug).single();
  if (storeError || !store) throw storeError || new Error(`Obchod ${storeSlug} nebyl nalezen.`);

  const { data, error } = await db.from('leaflet_imports')
    .select('id,status,product_count,created_at,detected_valid_from,detected_valid_to')
    .eq('store_id', store.id)
    .gte('created_at', startedAt)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Po načtení zdroje nevznikl nový import.');
  return data;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await authorize(request))) return json({ error: 'Unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const storeSlug = String(body.store_slug || '').trim().toLowerCase();
  if (body.confirmation !== 'STUDENY REBUILD') {
    return json({ error: 'Chybí potvrzení STUDENY REBUILD.' }, 400);
  }
  const adapter = COLD_REBUILD_ADAPTERS[storeSlug];
  if (!adapter) {
    return json({
      error: `Obchod ${storeSlug || 'bez názvu'} zatím nemá ověřený studený rebuild produktů.`,
      code: 'COLD_REBUILD_NOT_VERIFIED',
    }, 409);
  }

  let runId = '';
  try {
    const { data: started, error: startError } = await db.rpc('begin_leaflet_cold_rebuild', {
      p_store_slug: storeSlug,
    });
    if (startError || !started?.run_id) throw startError || new Error('Studený rebuild se nepodařilo připravit.');
    runId = String(started.run_id);

    const { data: run, error: runError } = await db.from('leaflet_cold_rebuild_runs')
      .select('started_at,before_offer_count,before_import_count,before_item_count')
      .eq('id', runId).single();
    if (runError || !run) throw runError || new Error('Záznam studeného rebuildu nebyl nalezen.');

    const adapterResult = await invoke(adapter, { cold_rebuild_run_id: runId });
    const importIdFromAdapter = String(adapterResult?.import_id || '').trim();
    const imported = importIdFromAdapter
      ? (await db.from('leaflet_imports')
          .select('id,status,product_count,created_at,detected_valid_from,detected_valid_to')
          .eq('id', importIdFromAdapter).single()).data
      : await newestImport(storeSlug, run.started_at);

    if (!imported?.id) throw new Error('Adaptér nevytvořil nový import.');
    const { count: itemCount, error: countError } = await db.from('leaflet_import_items')
      .select('id', { count: 'exact', head: true })
      .eq('import_id', imported.id)
      .in('status', ['review','approved','published']);
    if (countError) throw countError;
    if (!itemCount) throw new Error('Nový import neobsahuje žádné znovu nalezené produkty.');

    const { error: publishingError } = await db.from('leaflet_imports')
      .update({ status: 'publishing', error_message: null })
      .eq('id', imported.id);
    if (publishingError) throw publishingError;

    const published = await invoke('publish-imports', { import_id: imported.id });
    const publishResult = published?.results?.[0] || {};
    if (publishResult.error) throw new Error(String(publishResult.error));
    if (!(Number(publishResult.published || 0) > 0 || Number(publishResult.duplicates || 0) > 0)) {
      throw new Error('Publikace nevytvořila žádnou nabídku.');
    }

    const { data: completed, error: completeError } = await db.rpc('complete_leaflet_cold_rebuild', {
      p_run_id: runId,
    });
    if (completeError) throw completeError;

    return json({
      ok: true,
      cold_start: true,
      restored_from_trash: false,
      run_id: runId,
      store_slug: storeSlug,
      adapter,
      adapter_result: adapterResult,
      publish_result: publishResult,
      comparison: completed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    let rollback: unknown = null;
    if (runId) {
      const result = await db.rpc('rollback_leaflet_cold_rebuild', {
        p_run_id: runId,
        p_error: message,
      });
      rollback = result.data || { error: result.error?.message || 'Rollback selhal.' };
    }
    return json({
      error: message,
      code: 'COLD_REBUILD_FAILED',
      run_id: runId || null,
      rollback,
    }, 500);
  }
});
