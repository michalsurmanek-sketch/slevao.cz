import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS, 'content-type': 'application/json; charset=utf-8' },
  });
}

async function requireAdmin(request: Request) {
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return null;
  const role = String(data.user.app_metadata?.role || '').toLowerCase();
  return role === 'admin' ? data.user : null;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  const admin = await requireAdmin(request);
  if (!admin) return json({ ok: false, error: 'Unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  if (body.confirmation !== 'SMAZAT VŠECHNY NABÍDKY') {
    return json({ ok: false, error: 'Chybí správné potvrzení.' }, 400);
  }

  try {
    const { count, error: countError } = await db
      .from('offers')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'trash');
    if (countError) throw countError;

    const { error: updateError } = await db
      .from('offers')
      .update({ status: 'trash' })
      .neq('status', 'trash');
    if (updateError) throw updateError;

    console.log('All offers moved to trash by admin', admin.id, count || 0);
    return json({ ok: true, moved_to_trash: count || 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('trash-all-offers failed:', message);
    return json({ ok: false, error: message }, 500);
  }
});
