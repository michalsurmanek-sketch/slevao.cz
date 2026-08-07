import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};

const OVERPASS_ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

const CHAIN_PATTERNS: Array<[string, RegExp]> = [
  ['kaufland', /\bkaufland\b/i],
  ['lidl', /\blidl\b/i],
  ['albert', /\balbert\b/i],
  ['billa', /\bbilla\b/i],
  ['penny', /\bpenny(?:\s+market)?\b/i],
  ['tesco', /\btesco\b/i],
  ['globus', /\bglobus\b/i],
  ['makro', /\bmakro\b/i],
  ['norma', /\bnorma\b/i],
  ['hruska', /\bhruska\b/i],
  ['terno', /\bterno\b/i],
  ['enapo', /\benapo\b/i],
  ['flop', /\bflop\b/i],
  ['jip', /\bjip\b/i],
  ['zabka', /\bzabka\b/i],
  ['coop', /\bcoop\b/i],
];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    return [row.message, row.details, row.hint, row.code].filter(Boolean).map(String).join(' | ') || JSON.stringify(error);
  }
  return String(error);
}

async function allowed(request: Request) {
  const raw = request.headers.get('authorization') || '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE) return true;
  if (CRON && request.headers.get('x-cron-secret') === CRON) return true;
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  return !error && !!data.user && ['admin', 'editor'].includes(String(data.user.app_metadata?.role || '').toLowerCase());
}

function fold(value: unknown) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function buildQuery() {
  const groupA = 'Albert|BILLA|Kaufland|Lidl|Penny|Tesco|Globus|COOP';
  const groupB = 'Hruška|Hruska|MAKRO|Makro|Norma|Terno|Enapo|Flop|JIP|Žabka|Zabka';
  return `[out:json][timeout:35][bbox:48.45,12.0,51.2,19.1];
(
  nwr["shop"~"^(supermarket|convenience)$"]["brand"~"${groupA}",i];
  nwr["shop"~"^(supermarket|convenience)$"]["name"~"${groupA}",i];
  nwr["shop"~"^(supermarket|convenience)$"]["operator"~"${groupA}",i];
  nwr["shop"~"^(supermarket|convenience)$"]["brand"~"${groupB}",i];
  nwr["shop"~"^(supermarket|convenience)$"]["name"~"${groupB}",i];
  nwr["shop"~"^(supermarket|convenience)$"]["operator"~"${groupB}",i];
);
out center tags;`;
}

async function fetchOverpass() {
  let lastError: unknown = null;
  const query = buildQuery();
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40_000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          accept: 'application/json',
          'user-agent': 'Slevao.cz branch synchronizer/1.0 (https://slevao.cz)',
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${new URL(endpoint).hostname} HTTP ${response.status}: ${text.slice(0, 240)}`);
      const data = JSON.parse(text);
      if (!Array.isArray(data?.elements)) throw new Error('Overpass nevrátil očekávané pole elements.');
      return { endpoint, elements: data.elements as any[] };
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('Nepodařilo se načíst Overpass data.');
}

function matchSlug(tags: Record<string, unknown>) {
  const haystack = fold([tags.brand, tags.name, tags.operator].filter(Boolean).join(' '));
  for (const [slug, pattern] of CHAIN_PATTERNS) {
    if (pattern.test(haystack)) return slug;
  }
  return null;
}

function coordinates(element: any) {
  const latitude = Number(element?.lat ?? element?.center?.lat);
  const longitude = Number(element?.lon ?? element?.center?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < 48.45 || latitude > 51.2 || longitude < 12 || longitude > 19.1) return null;
  return { latitude, longitude };
}

function streetAddress(tags: Record<string, unknown>) {
  const street = String(tags['addr:street'] || tags['addr:place'] || '').trim();
  const house = String(tags['addr:housenumber'] || '').trim();
  return [street, house].filter(Boolean).join(' ').trim() || null;
}

function toCandidate(element: any) {
  const tags = (element?.tags && typeof element.tags === 'object' ? element.tags : {}) as Record<string, unknown>;
  const slug = matchSlug(tags);
  const point = coordinates(element);
  if (!slug || !point || !element?.type || !element?.id) return null;
  const sourceName = String(tags.name || tags.brand || tags.operator || slug).replace(/\s+/g, ' ').trim();
  return {
    slug,
    external_id: `osm:${element.type}:${element.id}`,
    name: sourceName || null,
    street: streetAddress(tags),
    city: String(tags['addr:city'] || tags['addr:place'] || tags['addr:suburb'] || '').trim() || null,
    postal_code: String(tags['addr:postcode'] || '').trim() || null,
    region: String(tags['addr:state'] || '').trim() || null,
    latitude: point.latitude,
    longitude: point.longitude,
    opening_hours: {
      source: 'OpenStreetMap',
      raw: String(tags.opening_hours || '').trim() || null,
    },
    is_active: true,
  };
}

async function upsertRows(rows: any[]) {
  let written = 0;
  for (let from = 0; from < rows.length; from += 400) {
    const batch = rows.slice(from, from + 400);
    const { error } = await db.from('branches').upsert(batch, { onConflict: 'store_id,external_id' });
    if (error) throw error;
    written += batch.length;
  }
  return written;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const loaded = await fetchOverpass();
    const candidates = loaded.elements.map(toCandidate).filter(Boolean) as any[];

    const unique = new Map<string, any>();
    for (const row of candidates) unique.set(`${row.slug}|${row.external_id}`, row);
    const deduped = [...unique.values()];
    const chainCounts = deduped.reduce((map: Record<string, number>, row) => {
      map[row.slug] = (map[row.slug] || 0) + 1;
      return map;
    }, {});

    if (deduped.length < 30 || Object.keys(chainCounts).length < 4) {
      throw new Error(`Synchronizace vrátila jen ${deduped.length} poboček / ${Object.keys(chainCounts).length} řetězce; zápis byl z bezpečnostních důvodů zastaven.`);
    }

    const slugs = [...new Set(deduped.map((row) => row.slug))];
    const { data: stores, error: storeError } = await db.from('stores').select('id,slug,name').in('slug', slugs).eq('is_active', true);
    if (storeError) throw storeError;
    const storeMap = new Map((stores || []).map((store) => [store.slug, store]));
    const rows = deduped
      .filter((row) => storeMap.has(row.slug))
      .map((row) => ({ ...row, store_id: storeMap.get(row.slug)!.id }));

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        source: loaded.endpoint,
        source_elements: loaded.elements.length,
        matched_branches: rows.length,
        matched_chains: [...new Set(rows.map((row) => row.slug))].sort(),
        counts: rows.reduce((map: Record<string, number>, row) => {
          map[row.slug] = (map[row.slug] || 0) + 1;
          return map;
        }, {}),
        samples: rows.slice(0, 25).map(({ store_id: _storeId, ...row }) => row),
      });
    }

    const written = await upsertRows(rows);
    return json({
      ok: true,
      source: loaded.endpoint,
      source_elements: loaded.elements.length,
      written,
      chains: [...new Set(rows.map((row) => row.slug))].sort(),
      note: 'Synchronizace pouze přidává/aktualizuje nalezené OSM pobočky; chybějící záznamy automaticky nemaže.',
    });
  } catch (error) {
    console.error('sync-store-branches failed', error);
    return json({ error: errorText(error), code: 'STORE_BRANCH_SYNC_FAILED' }, 500);
  }
});
