import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36';
const LIST_URL = 'https://www.globus.cz/o-nas/sidlo-spolecnosti';
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
async function fetchText(url: string, timeout = 25_000) {
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
    return { text, url: response.url };
  } finally { clearTimeout(timer); }
}

function branchLinks(html: string) {
  const start = html.indexOf('Hypermarket Globus Brno');
  if (start < 0) return [];
  const fresh = html.indexOf('Malé prodejny Globus Fresh', start);
  const section = html.slice(start, fresh > start ? fresh : start + 60_000);
  const urls = new Set<string>();
  for (const match of section.matchAll(/href=["'](https:\/\/www[.]globus[.]cz\/[a-z0-9-]+)["']/gi)) {
    try {
      const url = new URL(match[1]);
      if (url.protocol === 'https:' && url.hostname === 'www.globus.cz' && /^\/[a-z0-9-]+$/.test(url.pathname)) urls.add(url.toString());
    } catch { /* ignore */ }
  }
  return [...urls].sort();
}

function nuxtData(html: string) {
  const raw = html.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!raw) throw new Error('Globus detail neobsahuje __NUXT_DATA__.');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length < 100) throw new Error('Globus __NUXT_DATA__ má neočekávaný formát.');
  return parsed as any[];
}

function resolveNuxt(data: any[], value: any, depth = 0, dereferenced = false): any {
  if (depth > 16) return null;
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (dereferenced) return value;
    if (value < 0) return null;
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

function firstMapUrl(value: any): string | null {
  const stack = [value];
  const seen = new Set<any>();
  while (stack.length) {
    const current = stack.pop();
    if (current == null || seen.has(current)) continue;
    if (typeof current === 'string') {
      if (/^https:\/\/(?:maps[.]app[.]goo[.]gl|(?:www[.])?google[.].*maps)/i.test(current)) return current;
      continue;
    }
    if (typeof current !== 'object') continue;
    seen.add(current);
    if (Array.isArray(current)) stack.push(...current);
    else stack.push(...Object.values(current));
  }
  return null;
}

function parseBranch(html: string, detailUrl: string) {
  const data = nuxtData(html);
  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (!('gsoaId' in item) || !('latitude' in item) || !('longitude' in item) || !('street' in item) || !('zipCode' in item)) continue;
    const row = resolveNuxt(data, item);
    const gsoaId = String(row?.gsoaId || '').trim();
    const latitude = Number(row?.latitude);
    const longitude = Number(row?.longitude);
    const street = String(row?.street || '').trim();
    const city = String(row?.city || row?.name || '').trim();
    const zipCode = String(row?.zipCode || '').trim();
    const displayName = String(row?.name || city || '').trim();
    if (!gsoaId || !city || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (latitude < 48.45 || latitude > 51.2 || longitude < 12 || longitude > 19.1) continue;
    return {
      external_id: `globus:${gsoaId}`,
      name: displayName ? `Globus ${displayName}` : `Globus ${city}`,
      street: street || null,
      city,
      postal_code: zipCode || null,
      region: null,
      latitude,
      longitude,
      is_active: true,
      opening_hours: {
        source: 'globus.cz',
        gsoa_id: gsoaId,
        detail_url: detailUrl,
        address: row?.address || null,
        phone: row?.phone || null,
        email: row?.email || null,
        map_url: firstMapUrl(row?.mapUrl),
        opening: row?.openingHours || null,
        holiday_opening: row?.holidayOpeningHours || null,
      },
    };
  }
  return null;
}

async function fetchBranch(url: string) {
  try {
    const page = await fetchText(url);
    const row = parseBranch(page.text, page.url);
    return row ? { row, error: null, url } : { row: null, error: 'Detail neobsahuje validní Globus gsoaId + GPS objekt.', url };
  } catch (error) {
    return { row: null, error: errorText(error), url };
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(request)) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const listing = await fetchText(LIST_URL);
    const links = branchLinks(listing.text);
    if (links.length !== 16) return json({ error: `Oficiální Globus seznam obsahuje ${links.length} hypermarketů místo očekávaných 16; zápis byl zastaven.`, code: 'GLOBUS_LIST_UNEXPECTED', dry_run: dryRun }, 409);

    const results: Array<Awaited<ReturnType<typeof fetchBranch>>> = [];
    for (let from = 0; from < links.length; from += 4) results.push(...await Promise.all(links.slice(from, from + 4).map(fetchBranch)));
    const rows = results.filter((result) => result.row).map((result) => result.row);
    const failures = results.filter((result) => !result.row).map((result) => ({ url: result.url, error: result.error }));
    if (rows.length < 15) return json({ error: `Globus parser zpracoval jen ${rows.length}/16 poboček; zápis byl zastaven.`, code: 'GLOBUS_PARSE_INCOMPLETE', dry_run: dryRun, failures }, 409);

    let written = 0;
    if (!dryRun) {
      const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'globus').eq('is_active', true).maybeSingle();
      if (storeError) throw storeError;
      if (!store) throw new Error('Aktivní obchod globus nebyl nalezen v tabulce stores.');
      const payload = rows.map((row) => ({ ...row, store_id: store.id }));
      const { error } = await db.from('branches').upsert(payload, { onConflict: 'store_id,external_id' });
      if (error) throw error;
      written = payload.length;
    }

    return json({ ok: true, dry_run: dryRun, source: 'globus_official', total: links.length, parsed: rows.length, written, failures, samples: rows.slice(0, 6) });
  } catch (error) {
    return json({ error: errorText(error), code: 'GLOBUS_BRANCH_SYNC_FAILED' }, 500);
  }
});
