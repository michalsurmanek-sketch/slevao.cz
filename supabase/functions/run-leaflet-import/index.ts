import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders });

  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) {
    return Response.json({ error: 'Chybí přihlášení.' }, { status: 401, headers: corsHeaders });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const role = userData.user?.app_metadata?.role;
  if (userError || !userData.user || !['admin', 'editor'].includes(role)) {
    return Response.json({ error: 'Nemáš oprávnění spustit automatický import.' }, { status: 403, headers: corsHeaders });
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
  try { payload = JSON.parse(text); } catch { payload = { message: text }; }

  return Response.json(payload, {
    status: response.status,
    headers: corsHeaders,
  });
});
