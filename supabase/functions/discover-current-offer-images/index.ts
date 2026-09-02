import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const DISCOVERY_URL = `${SUPABASE_URL}/functions/v1/discover-product-images`;
const DEFAULT_COOLDOWN_DAYS = 7;
const PROVIDER_COOLDOWN_HOURS = 24;
const MAX_BATCH = 8;
const CONCURRENCY = 4;
const PENDING_QUERY_CHUNK = 50;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret', 'content-type': 'application/json; charset=utf-8' };

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: CORS }); }
function authorized(request: Request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return token === SERVICE_ROLE_KEY || Boolean(CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET);
}
function pragueToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    const parts = [row.message, row.details, row.hint, row.code].filter(Boolean).map(String);
    if (parts.length) return parts.join(' | ');
    try { return JSON.stringify(error); } catch { return String(error); }
  }
  return String(error);
}
async function discover(productId: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 105_000);
  try {
    const response = await fetch(DISCOVERY_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${SERVICE_ROLE_KEY}`, apikey: SERVICE_ROLE_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ product_id: productId }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: any = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text.slice(0, 1000) }; }
    return { product_id: productId, status_code: response.status, ok: response.ok && payload?.ok !== false, payload };
  } catch (error) {
    return { product_id: productId, status_code: 0, ok: false, error: errorText(error) };
  } finally { clearTimeout(timer); }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  if (!authorized(request)) return json({ ok: false, error: 'Unauthorized' }, 401);
  let stage = 'start';
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const force = body.force === true;
    const forceProviderCheck = body.force_provider_check === true;
    const requested = Number(body.limit || 0);

    stage = 'settings';
    const { data: settings, error: settingsError } = await db.from('product_image_automation_settings').select('enabled,batch_size').eq('id', true).maybeSingle();
    if (settingsError) throw settingsError;
    const enabled = settings?.enabled === true;
    const configuredBatch = Number(settings?.batch_size || 4);
    const limit = Math.max(1, Math.min(Number.isFinite(requested) && requested > 0 ? requested : configuredBatch, MAX_BATCH));
    if (!enabled && !force) return json({ ok: true, blocked: true, reason: 'image_automation_disabled', selected: 0, enabled, batch_size: limit });

    stage = 'provider_cooldown';
    if (!forceProviderCheck) {
      const cooldownSince = new Date(Date.now() - PROVIDER_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
      const { data: billingFailure, error: billingError } = await db.from('product_image_generation_runs')
        .select('finished_at,message')
        .eq('status', 'failed')
        .ilike('message', '%OpenAI API nemá dostupný kredit%')
        .gte('finished_at', cooldownSince)
        .order('finished_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (billingError) throw billingError;
      if (billingFailure?.finished_at) {
        const retryAfter = new Date(new Date(billingFailure.finished_at).getTime() + PROVIDER_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
        return json({ ok: true, blocked: true, reason: 'openai_billing_cooldown', enabled, forced: force, selected: 0, retry_after: retryAfter });
      }
    }

    const today = pragueToday();
    const cutoff = new Date(Date.now() - DEFAULT_COOLDOWN_DAYS * 86_400_000).toISOString();
    stage = 'current_offers';
    const { data: offers, error: offersError } = await db.from('offers')
      .select('product_id,published_at,products!offers_product_id_fkey(id,name,image_url,image_checked_at)')
      .eq('status', 'published').eq('is_verified', true).lte('valid_from', today).gte('valid_to', today)
      .is('image_url', null).not('product_id', 'is', null).limit(2000);
    if (offersError) throw offersError;

    stage = 'filter_products';
    const productMap = new Map<string, { id: string; name: string; image_checked_at: string | null; published_at: string | null }>();
    for (const row of offers || []) {
      const product = Array.isArray(row.products) ? row.products[0] : row.products;
      if (!product?.id || product.image_url) continue;
      const checkedAt = product.image_checked_at ? String(product.image_checked_at) : null;
      if (checkedAt && checkedAt > cutoff) continue;
      const current = productMap.get(String(product.id));
      const publishedAt = row.published_at ? String(row.published_at) : null;
      if (!current || String(publishedAt || '') > String(current.published_at || '')) productMap.set(String(product.id), { id: String(product.id), name: String(product.name || ''), image_checked_at: checkedAt, published_at: publishedAt });
    }

    const productIds = [...productMap.keys()];
    let pendingIds = new Set<string>();
    stage = 'pending_candidates';
    for (let index = 0; index < productIds.length; index += PENDING_QUERY_CHUNK) {
      const ids = productIds.slice(index, index + PENDING_QUERY_CHUNK);
      if (!ids.length) continue;
      const { data: candidates, error } = await db.from('product_image_candidates').select('product_id').in('product_id', ids).eq('status', 'pending');
      if (error) throw error;
      pendingIds = new Set([...pendingIds, ...(candidates || []).map((row: any) => String(row.product_id))]);
    }

    const selected = [...productMap.values()].filter((product) => !pendingIds.has(product.id)).sort((a, b) => {
      const ac = a.image_checked_at || ''; const bc = b.image_checked_at || '';
      if (ac !== bc) return ac.localeCompare(bc);
      return String(b.published_at || '').localeCompare(String(a.published_at || ''));
    }).slice(0, limit);

    if (dryRun) return json({ ok: true, dry_run: true, enabled, forced: force, today, cooldown_days: DEFAULT_COOLDOWN_DAYS, eligible: productMap.size, pending_excluded: pendingIds.size, selected: selected.map(({ id, name, image_checked_at }) => ({ product_id: id, name, image_checked_at })) });

    stage = 'discovery';
    const results: any[] = [];
    for (let index = 0; index < selected.length; index += CONCURRENCY) results.push(...await Promise.all(selected.slice(index, index + CONCURRENCY).map((product) => discover(product.id))));
    return json({ ok: results.every((row) => row.ok), enabled, forced: force, today, cooldown_days: DEFAULT_COOLDOWN_DAYS, eligible: productMap.size, pending_excluded: pendingIds.size, selected: selected.length, successful: results.filter((row) => row.ok).length, failed: results.filter((row) => !row.ok).length, candidates_created: results.reduce((sum, row) => sum + Number(row.payload?.created || 0), 0), visually_rejected: results.reduce((sum, row) => sum + Number(row.payload?.visually_rejected || 0), 0), without_match: results.reduce((sum, row) => sum + Number(row.payload?.without_match || 0), 0), results }, results.every((row) => row.ok) ? 200 : 207);
  } catch (error) {
    return json({ ok: false, stage, error: errorText(error) }, 500);
  }
});