import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const API_ROOT = 'https://store-data-service.services.dmtech.com/api/v2/stores';
const COUNTRY = 'CZ';
const PAGE_SIZE = 100;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};

type DmStore = {
  id?: string;
  storeId?: string;
  storeNumber?: string;
  storeUrlPath?: string;
  countryCode?: string;
  phone?: string;
  openingDate?: string;
  closingDate?: string;
  address?: {
    name?: string;
    street?: string;
    streetName?: string;
    streetNumber?: string;
    streetAdditional?: string;
    zip?: string;
    city?: string;
    district?: string;
    regionName?: string;
  };
  location?: { lat?: number; lon?: number };
  openingHours?: unknown[];
  extraClosingDates?: unknown[];
  availableFeatures?: unknown[];
  globalLocationNumber?: string;
  updateTimeStamp?: string;
  expressPickupAllowed?: boolean;
  noPackageDeliveryAllowed?: boolean;
  currenciesAccepted?: string;
};

type PageResponse = {
  page?: number;
  size?: number;
  totalPages?: number;
  totalElements?: number;
  stores?: DmStore[];
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

function clean(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

async function fetchJson<T>(url: string, timeout = 25_000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': UA,
        accept: 'application/json',
        'cache-control': 'no-cache',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}: ${text.slice(0, 250)}`);
    return JSON.parse(text) as T;
  } finally {
    clearTimeout(timer);
  }
}

function dateOnly(value: string | undefined) {
  if (!value) return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] || null;
}

function isStoreActive(store: DmStore, today: string) {
  const opens = dateOnly(store.openingDate);
  const closes = dateOnly(store.closingDate);
  if (opens && today < opens) return false;
  if (closes && today >= closes) return false;
  return true;
}

function toBranch(store: DmStore, today: string) {
  const storeId = clean(store.storeId).toUpperCase();
  const storeNumber = clean(store.storeNumber);
  const street = clean(store.address?.street);
  const city = clean(store.address?.city);
  const postalCode = clean(store.address?.zip);
  const region = clean(store.address?.regionName);
  const latitude = Number(store.location?.lat);
  const longitude = Number(store.location?.lon);

  if (!/^[A-Z][0-9A-Z]{3}$/i.test(storeId)) return null;
  if (store.countryCode !== COUNTRY) return null;
  if (!street || !city) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < 48.45 || latitude > 51.2 || longitude < 12 || longitude > 19.1) return null;

  const detailPath = clean(store.storeUrlPath);
  return {
    external_id: `dm:${storeId}`,
    name: `dm drogerie ${city} – ${street}`,
    street,
    city,
    postal_code: postalCode || null,
    region: region || null,
    latitude,
    longitude,
    is_active: isStoreActive(store, today),
    opening_hours: {
      source: 'store-data-service.services.dmtech.com',
      store_id: storeId,
      store_number: storeNumber || null,
      dm_internal_id: clean(store.id) || null,
      detail_url: detailPath ? `https://www.dm.cz/store${detailPath}` : null,
      phone: clean(store.phone) || null,
      opening_date: dateOnly(store.openingDate),
      closing_date: dateOnly(store.closingDate),
      weekly: Array.isArray(store.openingHours) ? store.openingHours : [],
      extra_closing_dates: Array.isArray(store.extraClosingDates) ? store.extraClosingDates : [],
      available_features: Array.isArray(store.availableFeatures) ? store.availableFeatures : [],
      global_location_number: clean(store.globalLocationNumber) || null,
      source_updated_at: clean(store.updateTimeStamp) || null,
      express_pickup_allowed: store.expressPickupAllowed ?? null,
      package_delivery_blocked: store.noPackageDeliveryAllowed ?? null,
      currencies_accepted: clean(store.currenciesAccepted) || null,
    },
  };
}

async function loadAllStores() {
  const first = await fetchJson<PageResponse>(`${API_ROOT}/list/${COUNTRY}/0/${PAGE_SIZE}`);
  const totalPages = Number(first.totalPages);
  const totalElements = Number(first.totalElements);
  if (!Number.isInteger(totalPages) || totalPages < 1 || totalPages > 10) throw new Error(`Neočekávaný počet dm stránek: ${first.totalPages}`);
  if (!Number.isInteger(totalElements) || totalElements < 250 || totalElements > 300) throw new Error(`Neočekávaný počet dm prodejen: ${first.totalElements}`);

  const pages: PageResponse[] = [first];
  if (totalPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) => index + 1).map((page) =>
        fetchJson<PageResponse>(`${API_ROOT}/list/${COUNTRY}/${page}/${PAGE_SIZE}`),
      ),
    );
    pages.push(...rest);
  }

  const stores = pages.flatMap((page) => Array.isArray(page.stores) ? page.stores : []);
  return { stores, totalPages, totalElements };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(request)) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const today = new Date().toISOString().slice(0, 10);
    const { stores, totalPages, totalElements } = await loadAllStores();
    const rows = stores.map((store) => toBranch(store, today)).filter(Boolean) as Array<ReturnType<typeof toBranch> & object>;
    const uniqueIds = new Set(rows.map((row: any) => row.external_id));

    if (stores.length !== totalElements) {
      return json({ error: `dm API deklaruje ${totalElements} prodejen, ale načteno bylo ${stores.length}; zápis byl zastaven.`, code: 'DM_PAGE_INCOMPLETE', dry_run: dryRun }, 409);
    }
    if (rows.length !== totalElements || uniqueIds.size !== rows.length) {
      return json({ error: `dm parser zpracoval ${rows.length}/${totalElements} poboček nebo našel duplicitní storeId; zápis byl zastaven.`, code: 'DM_PARSE_INCOMPLETE', dry_run: dryRun }, 409);
    }

    let written = 0;
    if (!dryRun) {
      const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'dm').eq('is_active', true).maybeSingle();
      if (storeError) throw storeError;
      if (!store) throw new Error('Aktivní obchod dm nebyl nalezen v tabulce stores.');

      for (let from = 0; from < rows.length; from += 200) {
        const payload = rows.slice(from, from + 200).map((row: any) => ({ ...row, store_id: store.id }));
        const { error } = await db.from('branches').upsert(payload, { onConflict: 'store_id,external_id' });
        if (error) throw error;
        written += payload.length;
      }
    }

    return json({
      ok: true,
      dry_run: dryRun,
      source: 'dm_official_api',
      api_root: API_ROOT,
      total_pages: totalPages,
      total: totalElements,
      parsed: rows.length,
      written,
      active: rows.filter((row: any) => row.is_active).length,
      inactive: rows.filter((row: any) => !row.is_active).length,
      missing_postal_code: rows.filter((row: any) => !row.postal_code).length,
      missing_region: rows.filter((row: any) => !row.region).length,
      samples: rows.slice(0, 6),
    });
  } catch (error) {
    return json({ error: errorText(error), code: 'DM_BRANCH_SYNC_FAILED' }, 500);
  }
});
