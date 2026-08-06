import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}
function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    const parts = [value.message, value.details, value.hint, value.code].filter(Boolean).map(String);
    if (parts.length) return parts.join(' | ');
    try { return JSON.stringify(error); } catch { return String(error); }
  }
  return String(error);
}
async function allowed(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE_ROLE_KEY) return true;
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}
async function invoke(name: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
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
    let result: any = {};
    try { result = text ? JSON.parse(text) : {}; } catch { /* handled below */ }
    if (!response.ok) throw new Error(`${name} HTTP ${response.status}: ${text.slice(0, 800)}`);
    if (result?.error) throw new Error(`${name}: ${String(result.error)}`);
    if (result?.ok !== true) throw new Error(`${name} nepotvrdil úspěšný běh.`);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  try {
    const products = await invoke('sync-kaufland-source');
    const documents = await invoke('sync-kaufland-documents');

    const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'kaufland').single();
    if (storeError || !store) throw storeError || new Error('Kaufland nebyl nalezen.');
    const today = new Date().toISOString().slice(0, 10);

    const { count: offerCount, error: offerError } = await db.from('offers')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', store.id)
      .eq('status', 'published')
      .gte('valid_to', today)
      .not('external_id', 'is', null);
    if (offerError) throw offerError;

    const { count: documentCount, error: documentError } = await db.from('leaflet_imports')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', store.id)
      .eq('status', 'published')
      .gte('detected_valid_to', today)
      .eq('metadata->>adapter', 'kaufland-pdf-v2');
    if (documentError) throw documentError;

    if (Number(offerCount || 0) < 50) {
      throw new Error(`Kaufland má po běhu jen ${offerCount || 0} platných produktových nabídek.`);
    }
    if (Number(documentCount || 0) < 1) {
      throw new Error('Kaufland nemá po běhu žádný aktuální PDF leták.');
    }

    return json({
      ok: true,
      self_published: true,
      import_id: products.import_id,
      products,
      documents,
      verified_offer_count: Number(offerCount || 0),
      verified_document_count: Number(documentCount || 0),
    });
  } catch (error) {
    return json({ error: formatError(error) }, 500);
  }
});
