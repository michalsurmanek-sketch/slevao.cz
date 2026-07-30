from pathlib import Path

path = Path('supabase/functions/publish-imports/index.ts')
text = path.read_text(encoding='utf-8')

old = """Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok');
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  const authHeader = request.headers.get('authorization') || '';
  const cronHeader = request.headers.get('x-cron-secret') || '';
  const authorizedByServiceRole = authHeader === `Bearer ${SERVICE_ROLE_KEY}`;
  const authorizedByCron = Boolean(CRON_SECRET && cronHeader === CRON_SECRET);
  let authorizedByUser = false;
  if (!authorizedByServiceRole && !authorizedByCron && authHeader.startsWith('Bearer ')) {
    const accessToken = authHeader.slice(7).trim();
    const { data: userData } = await db.auth.getUser(accessToken);
    const role = String(userData.user?.app_metadata?.role || userData.user?.user_metadata?.role || '').toLowerCase();
    authorizedByUser = ['admin', 'editor'].includes(role);
  }
  if (!authorizedByServiceRole && !authorizedByCron && !authorizedByUser) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  let query = db.from('leaflet_imports').select('*').eq('status', 'publishing').limit(10);
  if (body.import_id) query = db.from('leaflet_imports').select('*').eq('id', String(body.import_id)).limit(1);
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
"""

new = """const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = request.headers.get('authorization') || '';
    const cronHeader = request.headers.get('x-cron-secret') || '';
    const authorizedByServiceRole = authHeader === `Bearer ${SERVICE_ROLE_KEY}`;
    const authorizedByCron = Boolean(CRON_SECRET && cronHeader === CRON_SECRET);
    let authorizedByUser = false;
    if (!authorizedByServiceRole && !authorizedByCron && authHeader.startsWith('Bearer ')) {
      const accessToken = authHeader.slice(7).trim();
      const { data: userData } = await db.auth.getUser(accessToken);
      const role = String(userData.user?.app_metadata?.role || userData.user?.user_metadata?.role || '').toLowerCase();
      authorizedByUser = ['admin', 'editor'].includes(role);
    }
    if (!authorizedByServiceRole && !authorizedByCron && !authorizedByUser) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const body = await request.json().catch(() => ({}));
    let query = db.from('leaflet_imports').select('*').eq('status', 'publishing').limit(10);
    if (body.import_id) query = db.from('leaflet_imports').select('*').eq('id', String(body.import_id)).limit(1);
    const { data: jobs, error } = await query;
    if (error) return jsonResponse({ error: error.message }, 500);

    const results = [];
    for (const job of jobs || []) {
      try { results.push(await publishImport(job)); }
      catch (jobError) {
        const message = jobError instanceof Error ? jobError.message : String(jobError);
        await db.from('leaflet_imports').update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() }).eq('id', job.id);
        results.push({ import_id: job.id, error: message });
      }
    }
    return jsonResponse({ ok: true, processed: results.length, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, 500);
  }
});
"""

if old not in text:
    raise SystemExit('Expected publish-imports handler not found')

path.write_text(text.replace(old, new, 1), encoding='utf-8')
