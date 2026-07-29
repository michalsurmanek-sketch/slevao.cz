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

async function publishReviewedAutoImports() {
  const { data: jobs, error } = await adminClient
    .from('leaflet_imports')
    .select('id,leaflet_sources!inner(auto_publish)')
    .eq('status', 'review')
    .eq('leaflet_sources.auto_publish', true)
    .order('updated_at', { ascending: true })
    .limit(20);

  if (error) throw error;

  const results = [];
  for (const job of jobs || []) {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/publish-imports`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        'content-type': 'application/json',
        'x-cron-secret': CRON_SECRET,
      },
      body: JSON.stringify({ import_id: job.id }),
    });

    const text = await response.text();
    let payload: unknown;
    try { payload = JSON.parse(text); }
    catch { payload = { message: text }; }

    results.push({ import_id: job.id, ok: response.ok, status: response.status, payload });
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
    console.error('run-leaflet-import forbidden', { user_id: user.id, role: role || null });
    return Response.json({
      error: 'Nemáš oprávnění spustit automatický import.',
      detected_role: role || null,
    }, { status: 403, headers: corsHeaders });
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
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { message: text };
  }

  let publishedReviews: unknown[] = [];
  let publishError: string | null = null;
  try {
    publishedReviews = await publishReviewedAutoImports();
  } catch (error) {
    publishError = error instanceof Error ? error.message : String(error);
    console.error('Publishing reviewed imports failed', publishError);
  }

  return Response.json({
    discovery: payload,
    reviewed_auto_publish: publishedReviews,
    publish_error: publishError,
  }, {
    status: response.status,
    headers: corsHeaders,
  });
});