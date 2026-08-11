import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const db = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

async function isAuthorized(req: Request) {
  const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (auth && auth === SERVICE_ROLE) return true;
  return Boolean(CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET);
}

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

async function removeInChunks(bucket: string, paths: string[]) {
  const unique = [...new Set(paths.filter(Boolean))];
  const removed: string[] = [];
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const { error } = await db.storage.from(bucket).remove(chunk);
    if (error) throw new Error(`Storage remove ${bucket}: ${error.message}`);
    removed.push(...chunk);
  }
  return removed;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: HEADERS });
  if (req.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  if (!(await isAuthorized(req))) return response({ error: 'Unauthorized' }, 401);

  const started = Date.now();
  const body = await req.json().catch(() => ({}));
  const expiredLimit = numberInRange(body.expired_limit, 300, 1, 1000);
  const orphanLimit = numberInRange(body.orphan_limit, 150, 0, 1000);
  const graceDays = numberInRange(body.grace_days, 1, 0, 30);
  const orphanAgeDays = numberInRange(body.orphan_age_days, 7, 2, 90);
  const dryRun = body.dry_run === true;

  try {
    const { data: expired, error: expiredError } = await db.rpc(
      'get_expired_leaflet_storage_cleanup_candidates',
      { p_limit: expiredLimit, p_grace_days: graceDays },
    );
    if (expiredError) throw expiredError;

    const expiredRows = Array.isArray(expired) ? expired : [];
    const expiredBytes = expiredRows.reduce((sum, row) => sum + Number(row.bytes || 0), 0);

    let orphanRows: any[] = [];
    if (orphanLimit > 0) {
      const { data: orphans, error: orphanError } = await db.rpc(
        'get_orphan_leaflet_storage_cleanup_candidates',
        { p_limit: orphanLimit, p_min_age_days: orphanAgeDays },
      );
      if (orphanError) throw orphanError;
      orphanRows = Array.isArray(orphans) ? orphans : [];
    }
    const orphanBytes = orphanRows.reduce((sum, row) => sum + Number(row.bytes || 0), 0);

    if (dryRun) {
      return response({
        ok: true,
        dry_run: true,
        expired_candidates: expiredRows.length,
        expired_bytes: expiredBytes,
        orphan_candidates: orphanRows.length,
        orphan_bytes: orphanBytes,
        estimated_reclaim_bytes: expiredBytes + orphanBytes,
        grace_days: graceDays,
        orphan_age_days: orphanAgeDays,
      });
    }

    const expiredByBucket = new Map<string, any[]>();
    for (const row of expiredRows) {
      const bucket = String(row.bucket || 'leaflets');
      if (!expiredByBucket.has(bucket)) expiredByBucket.set(bucket, []);
      expiredByBucket.get(bucket)!.push(row);
    }

    const finalized: any[] = [];
    for (const [bucket, rows] of expiredByBucket.entries()) {
      await removeInChunks(bucket, rows.map((row) => String(row.path || '')));
      finalized.push(...rows.map((row) => ({
        import_id: row.import_id,
        bucket,
        path: row.path,
        bytes: Number(row.bytes || 0),
      })));
    }

    let finalizeResult: any = null;
    if (finalized.length) {
      const { data, error } = await db.rpc('finalize_leaflet_storage_cleanup', { p_items: finalized });
      if (error) throw error;
      finalizeResult = data;
    }

    const orphanByBucket = new Map<string, any[]>();
    for (const row of orphanRows) {
      const bucket = String(row.bucket || 'leaflets');
      if (!orphanByBucket.has(bucket)) orphanByBucket.set(bucket, []);
      orphanByBucket.get(bucket)!.push(row);
    }

    const removedOrphans: any[] = [];
    for (const [bucket, rows] of orphanByBucket.entries()) {
      await removeInChunks(bucket, rows.map((row) => String(row.path || '')));
      removedOrphans.push(...rows.map((row) => ({
        bucket,
        path: row.path,
        bytes: Number(row.bytes || 0),
      })));
    }

    if (removedOrphans.length) {
      const { error } = await db.rpc('log_orphan_leaflet_storage_cleanup', { p_items: removedOrphans });
      if (error) throw error;
    }

    return response({
      ok: true,
      expired_deleted: finalized.length,
      expired_bytes: expiredBytes,
      orphan_deleted: removedOrphans.length,
      orphan_bytes: orphanBytes,
      reclaimed_bytes: expiredBytes + orphanBytes,
      finalize: finalizeResult,
      duration_ms: Date.now() - started,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return response({ ok: false, error: message, duration_ms: Date.now() - started }, 500);
  }
});
