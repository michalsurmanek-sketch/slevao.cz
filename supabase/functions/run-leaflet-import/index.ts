import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const AUTO_PUBLISH_MIN_CONFIDENCE = 0.92;
const AUTO_PUBLISH_MIN_PRODUCTS = 8;

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function callFunction(name: string, body: Record<string, unknown> = {}) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      'content-type': 'application/json',
      ...(CRON_SECRET ? { 'x-cron-secret': CRON_SECRET } : {}),
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let payload: unknown;
  try { payload = JSON.parse(text); }
  catch { payload = { message: text }; }
  return { function: name, ok: response.ok, status: response.status, payload };
}

async function publishImport(importId: string) {
  return await callFunction('publish-imports', { import_id: importId });
}

async function publishReviewedAutoImports() {
  const { data: sources, error: sourceError } = await adminClient
    .from('leaflet_sources')
    .select('id')
    .eq('auto_publish', true)
    .eq('is_active', true);

  if (sourceError) throw sourceError;
  const sourceIds = (sources || []).map((source) => source.id);
  if (!sourceIds.length) return [];

  const { data: jobs, error: jobError } = await adminClient
    .from('leaflet_imports')
    .select('id,source_id,updated_at,confidence,detected_valid_from,detected_valid_to,product_count,stores(slug)')
    .eq('status', 'review')
    .in('source_id', sourceIds)
    .gte('confidence', 0.88)
    .not('detected_valid_from', 'is', null)
    .not('detected_valid_to', 'is', null)
    .gte('product_count', AUTO_PUBLISH_MIN_PRODUCTS)
    .order('updated_at', { ascending: true })
    .limit(50);

  if (jobError) throw jobError;

  const results = [];
  for (const job of jobs || []) {
    const threshold = job.stores?.slug === 'billa' ? 0.88 : AUTO_PUBLISH_MIN_CONFIDENCE;
    if (Number(job.confidence || 0) >= threshold) results.push(await publishImport(job.id));
  }
  return results;
}

async function recoverUnhealthySources() {
  const { data: sources, error } = await adminClient
    .from('leaflet_sources')
    .select('id,name,last_checked_at,last_error,check_interval_minutes')
    .eq('is_active', true)
    .limit(500);

  if (error) throw error;

  const now = Date.now();
  const recovered: Array<{ id: string; name: string; reason: string }> = [];

  for (const source of sources || []) {
    const intervalMinutes = Math.max(60, Number(source.check_interval_minutes || 360));
    const checkedAt = source.last_checked_at ? Date.parse(source.last_checked_at) : 0;
    const overdueMs = Math.max(intervalMinutes * 3, 720) * 60_000;
    const isStale = !checkedAt || now - checkedAt > overdueMs;
    const hasError = Boolean(String(source.last_error || '').trim());

    if (!isStale && !hasError) continue;

    const { error: updateError } = await adminClient
      .from('leaflet_sources')
      .update({ last_checked_at: null, last_error: null })
      .eq('id', source.id);

    if (updateError) throw updateError;
    recovered.push({
      id: source.id,
      name: String(source.name || 'Zdroj'),
      reason: hasError ? 'předchozí chyba' : 'zastaralá kontrola',
    });
  }

  return recovered;
}

async function prepareForcedRetry(requestedSourceId = '') {
  let sourceQuery = adminClient
    .from('leaflet_sources')
    .select('id,name')
    .eq('is_active', true);
  if (requestedSourceId) sourceQuery = sourceQuery.eq('id', requestedSourceId);

  const { data: sources, error: sourceError } = await sourceQuery.limit(500);
  if (sourceError) throw sourceError;

  const sourceIds = (sources || []).map((source) => String(source.id));
  if (!sourceIds.length) return { sources_reset: 0, failed_imports_unlocked: 0 };

  const { error: resetError } = await adminClient
    .from('leaflet_sources')
    .update({ last_checked_at: null, last_error: null })
    .in('id', sourceIds);
  if (resetError) throw resetError;

  const { data: failedJobs, error: failedError } = await adminClient
    .from('leaflet_imports')
    .select('id,source_hash')
    .in('source_id', sourceIds)
    .eq('status', 'failed')
    .order('updated_at', { ascending: false })
    .limit(200);
  if (failedError) throw failedError;

  let unlocked = 0;
  for (const job of failedJobs || []) {
    const originalHash = String(job.source_hash || 'failed-import');
    const { error: archiveError } = await adminClient
      .from('leaflet_imports')
      .update({ source_hash: `${originalHash}:manual-retry:${job.id}:${Date.now()}` })
      .eq('id', job.id);
    if (archiveError) throw archiveError;
    unlocked++;
  }

  return { sources_reset: sourceIds.length, failed_imports_unlocked: unlocked };
}

async function runAutomaticImageMaintenance() {
  const stores = ['kaufland', 'tesco', 'albert', 'billa', 'penny', 'makro', 'lidl', 'globus'];
  const tasks = stores.map((storeSlug) => callFunction('discover-product-images', {
    store_slug: storeSlug,
    limit: 50,
  }));
  const settled = await Promise.allSettled(tasks);
  const names = stores.map((storeSlug) => `${storeSlug}-candidates`);
  return settled.map((result, index) => result.status === 'fulfilled'
    ? result.value
    : { function: names[index], ok: false, error: String(result.reason) });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  const authorization = request.headers.get('authorization') || '';
  const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const suppliedCronSecret = request.headers.get('x-cron-secret') || '';
  const isTrustedCron = Boolean(CRON_SECRET && suppliedCronSecret === CRON_SECRET);
  const isServiceRole = accessToken === SERVICE_ROLE_KEY;
  const body = await request.json().catch(() => ({}));

  if (!accessToken && !isTrustedCron) {
    return Response.json({ error: 'Chybí přihlášení.' }, { status: 401, headers: corsHeaders });
  }

  if (!isTrustedCron && !isServiceRole) {
    const { data: userData, error: userError } = await adminClient.auth.getUser(accessToken);
    const user = userData.user;
    const role = String(user?.app_metadata?.role || '').toLowerCase();
    if (userError || !user) {
      return Response.json({ error: 'Přihlášení je neplatné nebo vypršelo.' }, { status: 401, headers: corsHeaders });
    }
    if (!['admin', 'editor'].includes(role)) {
      return Response.json({ error: 'Nemáš oprávnění spustit automatický import.' }, { status: 403, headers: corsHeaders });
    }
  }

  const requestedSourceId = String(body?.source_id || '').trim();
  const forceRetry = Boolean(body?.force) || (!isTrustedCron && !isServiceRole);

  let forcedRetry: unknown = null;
  let publishedBefore: unknown[] = [];
  let publishedAfter: unknown[] = [];
  let imageMaintenance: unknown[] = [];
  let recoveredSources: unknown[] = [];
  let coopSource: unknown = null;
  let hruskaSource: unknown = null;
  const warnings: string[] = [];

  if (forceRetry) {
    try { forcedRetry = await prepareForcedRetry(requestedSourceId); }
    catch (error) { warnings.push(`Vynucený nový pokus: ${error instanceof Error ? error.message : String(error)}`); }
  }

  try { coopSource = await callFunction('sync-coop-source', {}); }
  catch (error) { warnings.push(`COOP zdroj: ${error instanceof Error ? error.message : String(error)}`); }

  try { hruskaSource = await callFunction('sync-hruska-source', {}); }
  catch (error) { warnings.push(`Hruška zdroj: ${error instanceof Error ? error.message : String(error)}`); }

  try { recoveredSources = await recoverUnhealthySources(); }
  catch (error) { warnings.push(`Obnova zdrojů: ${error instanceof Error ? error.message : String(error)}`); }

  try { publishedBefore = await publishReviewedAutoImports(); }
  catch (error) { warnings.push(`Publikace před kontrolou: ${error instanceof Error ? error.message : String(error)}`); }

  const discovery = await callFunction('discover-leaflets', requestedSourceId ? { source_id: requestedSourceId } : {});

  await sleep(9000);

  try { publishedAfter = await publishReviewedAutoImports(); }
  catch (error) { warnings.push(`Publikace po kontrole: ${error instanceof Error ? error.message : String(error)}`); }

  try { imageMaintenance = await runAutomaticImageMaintenance(); }
  catch (error) { warnings.push(`Automatické fotografie: ${error instanceof Error ? error.message : String(error)}`); }

  return Response.json({
    ok: discovery.ok,
    forced_retry: forcedRetry,
    coop_source: coopSource,
    hruska_source: hruskaSource,
    discovery: discovery.payload,
    recovered_sources: recoveredSources,
    reviewed_auto_publish_before: publishedBefore,
    reviewed_auto_publish_after: publishedAfter,
    automatic_image_maintenance: imageMaintenance,
    auto_publish_min_confidence: AUTO_PUBLISH_MIN_CONFIDENCE,
    auto_publish_min_products: AUTO_PUBLISH_MIN_PRODUCTS,
    warnings,
  }, { status: discovery.status, headers: corsHeaders });
});
