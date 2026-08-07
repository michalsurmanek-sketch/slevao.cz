import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const LIST_URL = 'https://www.tetadrogerie.cz/prodejny';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function allowed(request: Request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (token && token === SERVICE) return true;
  return !!CRON && request.headers.get('x-cron-secret') === CRON;
}
async function fetchText(url: string, timeout = 35_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
        'cache-control': 'no-cache',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function nuxtData(html: string) {
  const raw = html.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!raw) throw new Error('Teta stránka neobsahuje __NUXT_DATA__.');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length < 5000) throw new Error('Teta __NUXT_DATA__ má neočekávaný formát.');
  return parsed as any[];
}

function resolveNuxt(data: any[], value: any, depth = 0, dereferenced = false): any {
  if (depth > 20) return null;
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (dereferenced) return value;
    if (value < 0) {
      if (value === -1) return undefined;
      if (value === -2) return null;
      if (value === -3) return Number.NaN;
      if (value === -4) return Number.POSITIVE_INFINITY;
      if (value === -5) return Number.NEGATIVE_INFINITY;
      if (value === -6) return -0;
      return null;
    }
    if (value < data.length) return resolveNuxt(data, data[value], depth + 1, true);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 2 && ['ShallowReactive', 'Reactive', 'Ref', 'Readonly', 'ShallowReadonly'].includes(String(value[0]))) {
      return resolveNuxt(data, value[1], depth + 1, false);
    }
    return value.map((item) => resolveNuxt(data, item, depth + 1, false));
  }
  if (value && typeof value === 'object') {
    const output: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) output[key] = resolveNuxt(data, item, depth + 1, false);
    return output;
  }
  return value;
}

function clean(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function extractPhone(contacts: any) {
  if (!Array.isArray(contacts)) return null;
  for (const contact of contacts) {
    const phone = clean(contact?.phone);
    if (phone) return phone;
  }
  return null;
}
function extractEmail(contacts: any) {
  if (!Array.isArray(contacts)) return null;
  for (const contact of contacts) {
    const email = clean(contact?.email);
    if (email) return email;
  }
  return null;
}

function parseStores(html: string) {
  const data = nuxtData(html);
  const rows = new Map<string, any>();

  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (!('externalId' in item) || !('longitude' in item) || !('latitude' in item) || !('street' in item) || !('city' in item)) continue;
    const row = resolveNuxt(data, item);
    const externalId = clean(row?.externalId);
    const latitude = Number(row?.latitude);
    const longitude = Number(row?.longitude);
    const city = clean(row?.city);
    const street = clean(row?.street);
    const zip = clean(row?.zip);
    const region = clean(row?.region);
    if (!/^\d+$/.test(externalId) || !city || !street) continue;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (latitude < 48.45 || latitude > 51.2 || longitude < 12 || longitude > 19.1) continue;

    rows.set(externalId, {
      external_id: `teta:${externalId}`,
      name: `Teta drogerie ${city} – ${street}`,
      street,
      city,
      postal_code: zip || null,
      region: region || null,
      latitude,
      longitude,
      is_active: row?.open !== false,
      opening_hours: {
        source: 'tetadrogerie.cz',
        external_id: externalId,
        internal_id: row?.id ?? null,
        detail_url: `https://www.tetadrogerie.cz/prodejny/${encodeURIComponent(externalId)}`,
        company_name: clean(row?.companyName) || null,
        phone: extractPhone(row?.contacts),
        email: extractEmail(row?.contacts),
        suitable_for_click_and_collect: row?.suitableForCaC ?? null,
        suitable_for_pickup: row?.suitableForPickup ?? null,
        official_opening_hours: row?.openingHours ?? null,
      },
    });
  }
  return [...rows.values()];
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(request)) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const html = await fetchText(LIST_URL);
    const rows = parseStores(html);
    if (rows.length < 500 || rows.length > 550) {
      return json({
        error: `Oficiální Teta Nuxt payload vrátil ${rows.length} validních GPS prodejen; zápis byl zastaven.`,
        code: 'TETA_LIST_UNEXPECTED',
        dry_run: dryRun,
      }, 409);
    }
    const uniqueIds = new Set(rows.map((row) => row.external_id));
    if (uniqueIds.size !== rows.length) {
      return json({ error: 'Teta parser našel duplicitní external_id; zápis byl zastaven.', code: 'TETA_DUPLICATE_IDS', dry_run: dryRun }, 409);
    }

    let written = 0;
    if (!dryRun) {
      const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'teta').eq('is_active', true).maybeSingle();
      if (storeError) throw storeError;
      if (!store) throw new Error('Aktivní obchod teta nebyl nalezen v tabulce stores.');
      for (let from = 0; from < rows.length; from += 250) {
        const payload = rows.slice(from, from + 250).map((row) => ({ ...row, store_id: store.id }));
        const { error } = await db.from('branches').upsert(payload, { onConflict: 'store_id,external_id' });
        if (error) throw error;
        written += payload.length;
      }
    }

    return json({
      ok: true,
      dry_run: dryRun,
      source: 'teta_official',
      source_bytes: html.length,
      total: rows.length,
      written,
      active: rows.filter((row) => row.is_active).length,
      missing_postal_code: rows.filter((row) => !row.postal_code).length,
      missing_region: rows.filter((row) => !row.region).length,
      samples: rows.slice(0, 8),
    });
  } catch (error) {
    return json({ error: errorText(error), code: 'TETA_BRANCH_SYNC_FAILED' }, 500);
  }
});
