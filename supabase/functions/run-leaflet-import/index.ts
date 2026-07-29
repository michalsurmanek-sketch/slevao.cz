import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function publishImport(importId: string) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/publish-imports`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      'x-cron-secret': CRON_SECRET,
    },
    body: JSON.stringify({ import_id: importId }),
  });

  const text = await response.text();
  let payload: unknown;
  try { payload = JSON.parse(text); }
  catch { payload = { message: text }; }

  return { import_id: importId, ok: response.ok, status: response.status, payload };
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
    .select('id,source_id,updated_at')
    .eq('status', 'review')
    .in('source_id', sourceIds)
    .order('updated_at', { ascending: true })
    .limit(50);

  if (jobError) throw jobError;

  const results = [];
  for (const job of jobs || []) {
    results.push(await publishImport(job.id));
  }
  return results;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });
  }

  const authorization = request.headers.get('authorization') || '';
  const accessToken = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!accessToken) {
    return Response.json({ error: 'Chybí přihlášení.' }, { status: 401, headers: corsHeaders });
  }

  const { data: userData, error: userError } = await adminClient.auth.getUser(accessToken);
  const user = userData.user;
  const role = String(user?.app_metadata?.role || user?.user_metadata?.role || '').toLowerCase();

  if (userError || !user) {
    console.error('run-leaflet-import auth error', userError?.message || 'user not found');
    return Response.json({ error: 'Přihlášení je neplatné nebo vypršelo.' }, { status: 401, headers: corsHeaders });
  }

  if (!['admin', 'editor'].includes(role)) {
    return Response.json({
      error: 'Nemáš oprávnění spustit automatický import.',
      detected_role: role || null,
    }, { status: 403, headers: corsHeaders });
  }

  let publishedBefore: unknown[] = [];
  let publishedAfter: unknown[] = [];
  let publishError: string | null = null;

  try {
    publishedBefore = await publishReviewedAutoImports();
  } catch (error) {
    publishError = error instanceof Error ? error.message : String(error);
    console.error('Publishing existing reviewed imports failed', publishError);
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/discover-leaflets`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'content-type': 'application/json',
      'x-cron-secret': CRON_SECRET,
    },
    body: '{}',
  });

  const text = await response.text();
  let payload: unknown;
  try { payload = JSON.parse(text); }
  catch { payload = { message: text }; }

  // Krátký druhý průchod zachytí rychle dokončené importy vytvořené touto kontrolou.
  await sleep(8000);
  try {
    publishedAfter = await publishReviewedAutoImports();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    publishError = publishError ? `${publishError}; ${message}` : message;
    console.error('Publishing new reviewed imports failed', message);
  }

  return Response.json({
    discovery: payload,
    reviewed_auto_publish_before: publishedBefore,
    reviewed_auto_publish_after: publishedAfter,
    publish_error: publishError,
  }, {
    status: response.status,
    headers: corsHeaders,
  });
});
