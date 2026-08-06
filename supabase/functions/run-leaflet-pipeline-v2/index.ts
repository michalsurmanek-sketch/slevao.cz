import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};

const SPECIALIZED: Record<string, string> = {
  action: 'sync-action-source',
  benu: 'sync-benu-source',
  coop: 'sync-coop-source',
  dm: 'sync-dm-source',
  hruska: 'sync-hruska-source',
  pepco: 'sync-pepco-source',
  rossmann: 'sync-rossmann-source',
  terno: 'sync-terno-source',
  tesco: 'sync-tesco-current',
  teta: 'sync-teta-source',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function isAuthorized(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const cronHeader = request.headers.get('x-cron-secret') || '';
  return authorization === `Bearer ${SERVICE_ROLE_KEY}`
    || (Boolean(CRON_SECRET) && cronHeader === CRON_SECRET);
}

async function invoke(name: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 40_000);
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
        'content-type': 'application/json',
      },
      body: '{}',
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${name} HTTP ${response.status}: ${text.slice(0, 500)}`);
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return { text };
    }
  } finally {
    clearTimeout(timer);
  }
}

async function runSpecialized(source: any) {
  const slug = String(source.store_slug || '');
  const functionName = SPECIALIZED[slug];
  if (!functionName) throw new Error(`Pro obchod ${slug} není specializovaný adaptér.`);

  try {
    const result = await invoke(functionName);
    const now = new Date().toISOString();
    await db.from('leaflet_sources').update({
      last_error: null,
      last_checked_at: now,
      last_success_at: now,
      last_strategy_used: 'specialized',
      last_strategy_success_at: now,
    }).eq('id', source.source_id);
    return { store: slug, adapter: functionName, ok: true, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from('leaflet_sources').update({
      last_error: message.slice(0, 1000),
      last_checked_at: new Date().toISOString(),
    }).eq('id', source.source_id);
    return { store: slug, adapter: functionName, ok: false, error: message };
  }
}

async function runGeneric(stores: string[]) {
  try {
    const result = await invoke('discover-leaflets');
    return { stores, adapter: 'discover-leaflets', ok: true, result };
  } catch (error) {
    return {
      stores,
      adapter: 'discover-leaflets',
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!CRON_SECRET) return json({ error: 'Automation is not configured' }, 503);
  if (!isAuthorized(request)) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const requestedSlug = String(body.store_slug || '').trim().toLowerCase();

    let query = db.from('leaflet_source_pipeline_status').select('*').eq('is_active', true);
    if (requestedSlug) query = query.eq('store_slug', requestedSlug);

    const { data, error } = await query.order('store_slug');
    if (error) return json({ error: error.message }, 500);

    const sources = data || [];
    if (!sources.length) {
      return json({ ok: true, queued: false, sources: 0, message: 'Nebyly nalezeny aktivní zdroje.' });
    }

    const specializedSources = sources.filter((source: any) => SPECIALIZED[String(source.store_slug || '')]);
    const genericSources = sources.filter((source: any) => !SPECIALIZED[String(source.store_slug || '')]);
    const jobs: Promise<unknown>[] = specializedSources.map(runSpecialized);

    // Generický průzkum sám načítá všechny aktivní a splatné zdroje. Spouštět ho
    // jednou pro každý obchod vytvářelo souběžné duplicitní importy a zbytečnou zátěž.
    if (genericSources.length) {
      jobs.push(runGeneric(genericSources.map((source: any) => String(source.store_slug || ''))));
    }

    if (requestedSlug) {
      const results = await Promise.allSettled(jobs);
      return json({
        ok: true,
        queued: false,
        sources: sources.length,
        results: results.map((result) => result.status === 'fulfilled'
          ? result.value
          : { ok: false, error: String(result.reason) }),
      });
    }

    const work = Promise.allSettled(jobs).catch((jobError) => {
      console.error('Background pipeline error', jobError);
    });
    const runtime = (globalThis as any).EdgeRuntime;
    if (runtime && typeof runtime.waitUntil === 'function') runtime.waitUntil(work);
    else void work;

    return json({
      ok: true,
      queued: true,
      sources: sources.length,
      stores: sources.map((source: any) => source.store_slug),
      specialized_runs: specializedSources.length,
      generic_runs: genericSources.length ? 1 : 0,
      message: 'Kontroly byly spuštěny odděleně na serveru.',
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : String(error),
      code: 'PIPELINE_REQUEST_FAILED',
    }, 500);
  }
});
