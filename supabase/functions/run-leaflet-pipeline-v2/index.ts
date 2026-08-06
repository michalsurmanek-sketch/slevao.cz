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

const ACTIVE_IMPORT_STATUSES = ['published', 'review', 'processing', 'queued', 'downloading', 'publishing'];
const SPECIALIZED_CONCURRENCY = 4;

const SPECIALIZED: Record<string, string> = {
  action: 'sync-action-source',
  albert: 'sync-albert-source',
  bauhaus: 'sync-bauhaus-source',
  benu: 'sync-benu-source',
  coop: 'sync-coop-source',
  dm: 'sync-dm-source',
  'dr-max': 'sync-dr-max-source',
  hruska: 'sync-hruska-source',
  jip: 'sync-jip-source',
  jysk: 'sync-jysk-source',
  kaufland: 'sync-kaufland-source',
  kik: 'sync-kik-source',
  obi: 'sync-obi-source',
  pepco: 'sync-pepco-source',
  rossmann: 'sync-rossmann-source',
  terno: 'sync-terno-source',
  tesco: 'sync-tesco-current',
  teta: 'sync-teta-source',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

type AuthorizationResult =
  | { ok: true; actor: string }
  | { ok: false; status: number; error: string };

type PipelineResult = {
  store?: string;
  stores?: string[];
  adapter: string;
  ok: boolean;
  current_imports?: number;
  result?: unknown;
  error?: string;
};

async function authorize(request: Request): Promise<AuthorizationResult> {
  const authorization = request.headers.get('authorization') || '';
  const cronHeader = request.headers.get('x-cron-secret') || '';

  if (authorization === `Bearer ${SERVICE_ROLE_KEY}`) {
    return { ok: true, actor: 'service-role' };
  }
  if (Boolean(CRON_SECRET) && cronHeader === CRON_SECRET) {
    return { ok: true, actor: 'cron' };
  }

  const accessToken = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return { ok: false, status: 401, error: 'Unauthorized' };

  const { data, error } = await db.auth.getUser(accessToken);
  if (error || !data.user) {
    return { ok: false, status: 401, error: 'Přihlášení vypršelo. Přihlaste se znovu.' };
  }

  const role = String(data.user.app_metadata?.role || '').trim().toLowerCase();
  if (!['admin', 'editor'].includes(role)) {
    return { ok: false, status: 403, error: 'Účet nemá oprávnění spouštět automatizaci.' };
  }

  return { ok: true, actor: `${role}:${data.user.id}` };
}

async function invoke(name: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
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
      throw new Error(`${name} nevrátil platný JSON výsledek.`);
    }
  } finally {
    clearTimeout(timer);
  }
}

function assertAdapterResult(name: string, result: any) {
  if (!result || typeof result !== 'object') {
    throw new Error(`${name} nevrátil ověřitelný výsledek.`);
  }
  if (result.ok === false) {
    throw new Error(String(result.error || `${name} oznámil neúspěšný běh.`));
  }
  if (result.error) {
    throw new Error(String(result.error));
  }
}

async function currentImportCount(sourceId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const { count, error } = await db.from('leaflet_imports')
    .select('id', { count: 'exact', head: true })
    .eq('source_id', sourceId)
    .in('status', ACTIVE_IMPORT_STATUSES)
    .or(`detected_valid_to.is.null,detected_valid_to.gte.${today}`);
  if (error) throw new Error(`Kontrola výsledku importu selhala: ${error.message}`);
  return Number(count || 0);
}

async function markSourceSuccess(sourceId: string, strategy: string) {
  const now = new Date().toISOString();
  const { error } = await db.from('leaflet_sources').update({
    last_error: null,
    last_checked_at: now,
    last_success_at: now,
    last_strategy_used: strategy,
    last_strategy_success_at: now,
  }).eq('id', sourceId);
  if (error) throw new Error(`Stav zdroje se nepodařilo uložit: ${error.message}`);
}

async function markSourceFailure(sourceId: string, message: string) {
  await db.from('leaflet_sources').update({
    last_error: message.slice(0, 1000),
    last_checked_at: new Date().toISOString(),
  }).eq('id', sourceId);
}

async function verifySource(source: any) {
  const count = await currentImportCount(String(source.source_id || ''));
  if (count < 1) {
    throw new Error(`Zdroj ${source.store_slug || source.source_id} po kontrole nemá žádný aktuální import.`);
  }
  return count;
}

async function runSpecialized(source: any): Promise<PipelineResult> {
  const slug = String(source.store_slug || '');
  const functionName = SPECIALIZED[slug];
  if (!functionName) throw new Error(`Pro obchod ${slug} není specializovaný adaptér.`);

  try {
    const result = await invoke(functionName);
    assertAdapterResult(functionName, result);
    const currentImports = await verifySource(source);
    await markSourceSuccess(String(source.source_id), 'specialized-verified');
    return { store: slug, adapter: functionName, ok: true, current_imports: currentImports, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markSourceFailure(String(source.source_id), message);
    return { store: slug, adapter: functionName, ok: false, error: message };
  }
}

async function runSpecializedInBatches(sources: any[]) {
  const results: PipelineResult[] = [];
  for (let index = 0; index < sources.length; index += SPECIALIZED_CONCURRENCY) {
    const batch = sources.slice(index, index + SPECIALIZED_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map(runSpecialized));
    for (const item of settled) {
      results.push(item.status === 'fulfilled'
        ? item.value
        : { adapter: 'unknown', ok: false, error: String(item.reason) });
    }
  }
  return results;
}

async function runGeneric(sources: any[]): Promise<PipelineResult> {
  const slugs = sources.map((source: any) => String(source.store_slug || ''));
  try {
    const result = await invoke('discover-leaflets');
    assertAdapterResult('discover-leaflets', result);

    const failed: Array<{ source: any; error: string }> = [];
    let currentImports = 0;
    for (const source of sources) {
      try {
        const count = await verifySource(source);
        currentImports += count;
        await markSourceSuccess(String(source.source_id), 'generic-verified');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ source, error: message });
        await markSourceFailure(String(source.source_id), message);
      }
    }

    if (failed.length) {
      return {
        stores: slugs,
        adapter: 'discover-leaflets',
        ok: false,
        current_imports: currentImports,
        result,
        error: failed.map((item) => item.error).join(' | '),
      };
    }

    return { stores: slugs, adapter: 'discover-leaflets', ok: true, current_imports: currentImports, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const source of sources) await markSourceFailure(String(source.source_id), message);
    return { stores: slugs, adapter: 'discover-leaflets', ok: false, error: message };
  }
}

async function runJobs(specializedSources: any[], genericSources: any[]) {
  const results: PipelineResult[] = await runSpecializedInBatches(specializedSources);
  if (genericSources.length) results.push(await runGeneric(genericSources));
  return results;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorization = await authorize(request);
  if (!authorization.ok) return json({ error: authorization.error }, authorization.status);

  try {
    const body = await request.json().catch(() => ({}));
    const requestedSlug = String(body.store_slug || '').trim().toLowerCase();

    let query = db.from('leaflet_source_pipeline_status').select('*').eq('is_active', true);
    if (requestedSlug) query = query.eq('store_slug', requestedSlug);

    const { data, error } = await query.order('store_slug');
    if (error) return json({ error: error.message }, 500);

    const sources = data || [];
    if (!sources.length) {
      return json({
        ok: true,
        queued: false,
        sources: 0,
        triggered_by: authorization.actor,
        message: 'Nebyly nalezeny aktivní zdroje.',
      });
    }

    const specializedSources = sources.filter((source: any) => SPECIALIZED[String(source.store_slug || '')]);
    const genericSources = sources.filter((source: any) => !SPECIALIZED[String(source.store_slug || '')]);

    if (requestedSlug) {
      const results = await runJobs(specializedSources, genericSources);
      const success = results.every((result) => result.ok);
      return json({
        ok: success,
        queued: false,
        sources: sources.length,
        triggered_by: authorization.actor,
        results,
      }, success ? 200 : 502);
    }

    const work = runJobs(specializedSources, genericSources).then((results) => {
      const failed = results.filter((result) => !result.ok);
      if (failed.length) console.error('Pipeline source failures', failed);
    }).catch((jobError) => {
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
      concurrency: SPECIALIZED_CONCURRENCY,
      triggered_by: authorization.actor,
      message: 'Kontroly byly spuštěny a každý zdroj bude ověřen podle skutečně vytvořeného importu.',
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : String(error),
      code: 'PIPELINE_REQUEST_FAILED',
    }, 500);
  }
});
