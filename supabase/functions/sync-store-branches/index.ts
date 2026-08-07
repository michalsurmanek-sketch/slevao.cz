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

const CHAINS = [
  { slug: 'kaufland', search: 'Kaufland', match: /\bkaufland\b/i, min: 5 },
  { slug: 'lidl', search: 'Lidl', match: /\blidl\b/i, min: 5 },
  { slug: 'albert', search: 'Albert', match: /\balbert\b/i, min: 5 },
  { slug: 'billa', search: 'BILLA', match: /\bbilla\b/i, min: 5 },
  { slug: 'penny', search: 'Penny|PENNY', match: /\bpenny(?:\s+market)?\b/i, min: 5 },
  { slug: 'tesco', search: 'Tesco', match: /\btesco\b/i, min: 5 },
  { slug: 'globus', search: 'Globus', match: /\bglobus\b/i, min: 2 },
  { slug: 'makro', search: 'MAKRO|Makro', match: /\bmakro\b/i, min: 2 },
  { slug: 'norma', search: 'Norma|NORMA', match: /\bnorma\b/i, min: 2 },
  { slug: 'hruska', search: 'Hruška|Hruska', match: /\bhruska\b/i, min: 2 },
  { slug: 'terno', search: 'Terno', match: /\bterno\b/i, min: 2 },
  { slug: 'enapo', search: 'Enapo', match: /\benapo\b/i, min: 2 },
  { slug: 'flop', search: 'Flop|FLOP', match: /\bflop\b/i, min: 2 },
  { slug: 'jip', search: 'JIP', match: /\bjip\b/i, min: 2 },
  { slug: 'zabka', search: 'Žabka|Zabka', match: /\bzabka\b/i, min: 2 },
  { slug: 'coop', search: 'COOP', match: /\bcoop\b/i, min: 2 },
] as const;

const DEFAULT_CHAIN_SLUGS = ['kaufland', 'lidl', 'albert', 'billa', 'penny', 'tesco', 'globus', 'makro'];

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

function buildChainQuery(search: string) {
  return `[out:json][timeout:18][bbox:48.45,12.0,51.2,19.1];
(
  nwr["shop"~"^(supermarket|convenience|wholesale)$"]["brand"~"^(${search})$",i];
  nwr["shop"~"^(supermarket|convenience|wholesale)$"]["name"~"${search}",i];
  nwr["shop"~"^(supermarket|convenience|wholesale)$"]["operator"~"${search}",i];
);
out center tags;`;
}

async function fetchChain(chain: (typeof CHAINS)[number]) {
  let lastError: unknown = null;
  const query = buildChainQuery(chain.search);
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 22_000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
          accept: 'application/json',
          'user-agent': 'Slevao.cz branch synchronizer/1.1 (https://slevao.cz)',
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`${new URL(endpoint).hostname} HTTP ${response.status}: ${text.slice(0, 180)}`);
      const data = JSON.parse(text);
      if (!Array.isArray(data?.elements)) throw new Error('Overpass nevrátil očekávané pole elements.');
      return { chain, endpoint, elements: data.elements as any[] };
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${chain.slug}: ${errorText(lastError || 'zdroj není dostupný')}`);
}

async function fetchChains(chains: (typeof CHAINS)[number][]) {
  const successes: Array<{ chain: (typeof CHAINS)[number]; endpoint: string; elements: any[] }> = [];
  const failures: Array<{ slug: string; error: string }> = [];
  for (let from = 0; from < chains.length; from += 3) {
    const batch = chains.slice(from, from + 3);
    const settled = await Promise.allSettled(batch.map(fetchChain));
    settled.forEach((result, index) => {
      const chain = batch[index];
      if (result.status === 'fulfilled') successes.push(result.value);
      else failures.push({ slug: chain.slug, error: errorText(result.reason) });
    });
  }
  return { successes, failures };
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

function toCandidate(element: any, chain: (typeof CHAINS)[number]) {
  const tags = (element?.tags && typeof element.tags === 'object' ? element.tags : {}) as Record<string, unknown>;
  const haystack = fold([tags.brand, tags.name, tags.operator].filter(Boolean).join(' '));
  if (!chain.match.test(haystack)) return null;
  const point = coordinates(element);
  if (!point || !element?.type || !element?.id) return null;
  const sourceName = String(tags.name || tags.brand || tags.operator || chain.slug).replace(/\s+/g, ' ').trim();
  return {
    slug: chain.slug,
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
  for (let from = 0; from < rows.length; from += 300) {
    const batch = rows.slice(from, from + 300);
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
    const requested = Array.isArray(body.chains) ? body.chains.map(String) : DEFAULT_CHAIN_SLUGS;
    const selected = CHAINS.filter((chain) => requested.includes(chain.slug));
    if (!selected.length) return json({ error: 'Nebyl vybrán podporovaný řetězec.' }, 400);

    const loaded = await fetchChains(selected);
    const candidates: any[] = [];
    const diagnostics: Record<string, unknown> = {};
    for (const result of loaded.successes) {
      const rows = result.elements.map((element) => toCandidate(element, result.chain)).filter(Boolean) as any[];
      const unique = new Map<string, any>();
      rows.forEach((row) => unique.set(row.external_id, row));
      const deduped = [...unique.values()];
      diagnostics[result.chain.slug] = { source: result.endpoint, source_elements: result.elements.length, matched: deduped.length, minimum: result.chain.min };
      if (deduped.length >= result.chain.min) candidates.push(...deduped);
      else loaded.failures.push({ slug: result.chain.slug, error: `jen ${deduped.length} poboček, minimum ${result.chain.min}` });
    }

    const acceptedSlugs = [...new Set(candidates.map((row) => row.slug))];
    if (candidates.length < 20 || acceptedSlugs.length < 3) {
      return json({
        error: `Bezpečnostní kontrola zastavila zápis: ${candidates.length} poboček / ${acceptedSlugs.length} řetězce.`,
        code: 'STORE_BRANCH_SYNC_TOO_SMALL',
        dry_run: dryRun,
        diagnostics,
        failures: loaded.failures,
      }, 409);
    }

    const { data: stores, error: storeError } = await db.from('stores').select('id,slug,name').in('slug', acceptedSlugs).eq('is_active', true);
    if (storeError) throw storeError;
    const storeMap = new Map((stores || []).map((store) => [store.slug, store]));
    const rows = candidates
      .filter((row) => storeMap.has(row.slug))
      .map((row) => ({ ...row, store_id: storeMap.get(row.slug)!.id }));

    const response = {
      ok: true,
      dry_run: dryRun,
      matched_branches: rows.length,
      matched_chains: [...new Set(rows.map((row) => row.slug))].sort(),
      counts: rows.reduce((map: Record<string, number>, row) => {
        map[row.slug] = (map[row.slug] || 0) + 1;
        return map;
      }, {}),
      diagnostics,
      failures: loaded.failures,
    };

    if (dryRun) return json({ ...response, samples: rows.slice(0, 20).map(({ store_id: _storeId, ...row }) => row) });

    const written = await upsertRows(rows);
    return json({ ...response, written, note: 'Pouze upsert nalezených OSM poboček; žádné existující pobočky se automaticky nemažou.' });
  } catch (error) {
    console.error('sync-store-branches failed', error);
    return json({ error: errorText(error), code: 'STORE_BRANCH_SYNC_FAILED' }, 500);
  }
});
