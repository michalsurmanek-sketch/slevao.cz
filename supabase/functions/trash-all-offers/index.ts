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
    const { data, error } = await db.rpc('start_offer_bulk_reset', {
      p_requested_by: admin.id,
    });
    if (error) throw error;
    if (!data?.ok) throw new Error('Hromadné přesunutí nabídek do koše nebylo potvrzeno databází.');

    console.log('Recoverable bulk offer reset created by admin', {
      adminId: admin.id,
      batchId: data.reset_batch_id,
      moved: Number(data.moved_to_trash || 0),
    });

    return json({
      ok: true,
      moved_to_trash: Number(data.moved_to_trash || 0),
      reset_batch_id: data.reset_batch_id,
      recoverable: true,
      recovery_instruction: 'Spusť kompletní kontrolu zdrojů. Obnoví se pouze nabídky obchodů, které kontrolou úspěšně projdou.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('trash-all-offers failed:', message);
    return json({ ok: false, error: message }, 500);
  }
});
