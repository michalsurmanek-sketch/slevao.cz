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
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36';
const KAUFLAND_LIST = 'https://prodejny.kaufland.cz/aktualne/servis/seznam-prodejen.html';
const PENNY_LOCATOR = 'https://www.penny.cz/prodejny';
const ALBERT_GRAPHQL = 'https://www.albert.cz/api/v1/';
const ALBERT_STORE_QUERY = 'query GetStoreSearch($lang:String!,$query:String,$latitude:Float,$longitude:Float,$radius:Float,$pageSize:Int,$currentPage:Int,$sort:String,$collectionFlow:Boolean,$options:String){storeSearchJSON(lang:$lang,query:$query,latitude:$latitude,longitude:$longitude,radius:$radius,pageSize:$pageSize,currentPage:$currentPage,sort:$sort,collectionFlow:$collectionFlow,options:$options)}';

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

function decodeHtml(value: string) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&ndash;|&#8211;/gi, '–')
    .replace(/&mdash;|&#8212;/gi, '—')
    .replace(/&aacute;/gi, 'á').replace(/&Aacute;/g, 'Á')
    .replace(/&eacute;/gi, 'é').replace(/&Eacute;/g, 'É')
    .replace(/&iacute;/gi, 'í').replace(/&Iacute;/g, 'Í')
    .replace(/&oacute;/gi, 'ó').replace(/&Oacute;/g, 'Ó')
    .replace(/&uacute;/gi, 'ú').replace(/&Uacute;/g, 'Ú')
    .replace(/&yacute;/gi, 'ý').replace(/&Yacute;/g, 'Ý');
}

function cleanText(value: string) {
  return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

async function fetchText(url: string, timeout = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
        'cache-control': 'no-cache',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return { text, url: response.url, status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

async function storeIdForSlug(slug: string) {
  const { data, error } = await db.from('stores').select('id,name,slug').eq('slug', slug).eq('is_active', true).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`Aktivní obchod ${slug} nebyl nalezen v tabulce stores.`);
  return data.id as string;
}

async function upsertBranches(rows: any[]) {
  let written = 0;
  for (let from = 0; from < rows.length; from += 250) {
    const { error } = await db.from('branches').upsert(rows.slice(from, from + 250), { onConflict: 'store_id,external_id' });
    if (error) throw error;
    written += Math.min(250, rows.length - from);
  }
  return written;
}

// ---------- Kaufland: official Czech store list + official detail pages ----------

function markerContexts(html: string) {
  const markers = ['latitude', 'longitude', 'data-lat', 'data-lng', 'coordinates', 'geo', 'maps', 'storeLocation'];
  const contexts: Array<{ marker: string; context: string }> = [];
  const lower = html.toLowerCase();
  for (const marker of markers) {
    let from = 0;
    while (contexts.length < 50) {
      const index = lower.indexOf(marker.toLowerCase(), from);
      if (index < 0) break;
      contexts.push({ marker, context: html.slice(Math.max(0, index - 260), Math.min(html.length, index + 580)).replace(/\s+/g, ' ') });
      from = index + marker.length;
    }
    if (contexts.length >= 50) break;
  }
  return contexts;
}

async function diagnoseKauflandDetail(rawUrl: unknown) {
  const url = new URL(String(rawUrl || ''));
  if (url.protocol !== 'https:' || url.hostname !== 'prodejny.kaufland.cz') throw new Error('Diagnostika dovoluje pouze oficiální doménu prodejny.kaufland.cz.');
  const page = await fetchText(url.toString());
  return {
    ok: true,
    dry_run: true,
    mode: 'kaufland_detail_diagnostic',
    url: page.url,
    status: page.status,
    bytes: page.text.length,
    title: cleanText(page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''),
    marker_contexts: markerContexts(page.text),
  };
}

function kauflandLinks(html: string) {
  const links = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']*\/aktualne\/servis\/prodejna\/[^"'#?]+\.html)["']/gi)) {
    try {
      const url = new URL(decodeHtml(match[1]), KAUFLAND_LIST);
      if (url.hostname === 'prodejny.kaufland.cz' && !url.pathname.includes('%7BfriendlyUrl%7D') && !url.pathname.includes('{friendlyUrl}')) links.add(url.toString());
    } catch { /* ignore malformed links */ }
  }
  return [...links].sort();
}

function itempropText(html: string, prop: string) {
  const inside = html.match(new RegExp(`<[^>]+itemprop=["']${prop}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'))?.[1];
  if (inside) return cleanText(inside);
  const contentAfter = html.match(new RegExp(`<[^>]+itemprop=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1];
  if (contentAfter) return cleanText(contentAfter);
  const contentBefore = html.match(new RegExp(`<[^>]+content=["']([^"']+)["'][^>]+itemprop=["']${prop}["']`, 'i'))?.[1];
  return contentBefore ? cleanText(contentBefore) : '';
}

function parseKauflandDetail(html: string, detailUrl: string) {
  const storeCode = html.match(/data-force-store-change=["'](CZ\d+)["']/i)?.[1] || '';
  const latitude = Number(html.match(/data-lat=["']([0-9.\-]+)["']/i)?.[1]);
  const longitude = Number(html.match(/data-lng=["']([0-9.\-]+)["']/i)?.[1]);
  if (!storeCode || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < 48.45 || latitude > 51.2 || longitude < 12 || longitude > 19.1) return null;

  const title = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  let locationName = title.replace(/^Kaufland\s+/i, '').replace(/\s+[–—-]\s+.*$/, '').trim();
  if (!locationName) locationName = itempropText(html, 'name').replace(/^Kaufland\s+/i, '').trim();
  const street = itempropText(html, 'streetAddress') || null;
  const postalCode = itempropText(html, 'postalCode') || null;
  let city = itempropText(html, 'addressLocality') || null;
  if (!city && locationName) city = locationName.replace(/\s+-\s+.*$/, '').trim();
  const opens = [...html.matchAll(/itemprop=["']opens["'][^>]+content=["']([^"']+)["']/gi)].map((m) => m[1]);
  const closes = [...html.matchAll(/itemprop=["']closes["'][^>]+content=["']([^"']+)["']/gi)].map((m) => m[1]);

  return {
    external_id: `kaufland:${storeCode}`,
    name: `Kaufland ${locationName}`.trim(),
    street,
    city,
    postal_code: postalCode,
    region: null,
    latitude,
    longitude,
    is_active: true,
    opening_hours: {
      source: 'kaufland.cz',
      store_code: storeCode,
      detail_url: detailUrl,
      opens: [...new Set(opens)],
      closes: [...new Set(closes)],
    },
  };
}

async function fetchKauflandDetail(url: string) {
  try {
    const page = await fetchText(url);
    return { url: page.url, row: parseKauflandDetail(page.text, page.url), error: null };
  } catch (error) {
    return { url, row: null, error: errorText(error) };
  }
}

async function syncKauflandOfficial(body: any) {
  const dryRun = body.dry_run === true;
  const offset = Math.max(0, Math.floor(Number(body.offset || 0)));
  const limit = Math.max(1, Math.min(20, Math.floor(Number(body.limit || 12))));
  const listPage = await fetchText(KAUFLAND_LIST);
  const links = kauflandLinks(listPage.text);
  if (links.length < 100) return json({ error: `Oficiální seznam Kauflandu obsahuje jen ${links.length} detailů; synchronizace byla zastavena.`, code: 'KAUFLAND_LIST_TOO_SMALL', dry_run: dryRun }, 409);

  const selected = links.slice(offset, offset + limit);
  if (!selected.length) return json({ ok: true, dry_run: dryRun, source: 'kaufland_official', total: links.length, offset, parsed: 0, done: true });

  const results: Array<{ url: string; row: any; error: string | null }> = [];
  for (let from = 0; from < selected.length; from += 5) results.push(...await Promise.all(selected.slice(from, from + 5).map(fetchKauflandDetail)));
  const rows = results.filter((result) => result.row).map((result) => result.row);
  const failures = results.filter((result) => !result.row).map((result) => ({ url: result.url, error: result.error || 'detail neobsahuje očekávané GPS/ID' }));
  if (rows.length < Math.ceil(selected.length * .8)) return json({ error: `Kaufland parser zpracoval jen ${rows.length}/${selected.length} detailů; zápis byl zastaven.`, code: 'KAUFLAND_BATCH_INCOMPLETE', dry_run: dryRun, total: links.length, offset, failures }, 409);

  const storeId = await storeIdForSlug('kaufland');
  const payload = rows.map((row) => ({ ...row, store_id: storeId }));
  const written = dryRun ? 0 : await upsertBranches(payload);
  return json({
    ok: true,
    dry_run: dryRun,
    source: 'kaufland_official',
    total: links.length,
    offset,
    requested: selected.length,
    parsed: rows.length,
    written,
    next_offset: offset + selected.length,
    done: offset + selected.length >= links.length,
    failures,
    samples: payload.slice(0, 5).map(({ store_id: _storeId, ...row }) => row),
  });
}

// ---------- PENNY: official Nuxt SSR storefinder payload ----------

function pennyNuxtData(html: string) {
  const raw = html.match(/<script[^>]+id=["']__NUXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!raw) throw new Error('PENNY stránka neobsahuje očekávaný __NUXT_DATA__ payload.');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length < 1000) throw new Error('PENNY __NUXT_DATA__ má neočekávaný formát.');
  return parsed as any[];
}

function resolveNuxt(data: any[], value: any, depth = 0): any {
  if (depth > 12) return null;
  if (typeof value === 'number' && Number.isInteger(value)) {
    if (value < 0) return null;
    if (value < data.length) return resolveNuxt(data, data[value], depth + 1);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 2 && ['ShallowReactive', 'Reactive', 'Ref', 'Readonly', 'ShallowReadonly'].includes(String(value[0]))) return resolveNuxt(data, value[1], depth + 1);
    return value.map((item) => resolveNuxt(data, item, depth + 1));
  }
  if (value && typeof value === 'object') {
    const output: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) output[key] = resolveNuxt(data, item, depth + 1);
    return output;
  }
  return value;
}

function parsePennyStores(data: any[]) {
  const rows = new Map<string, any>();
  for (const item of data) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    if (!('storeId' in item) || !('city' in item) || !('position' in item) || !('street' in item) || !('zip' in item)) continue;

    const storeId = String(resolveNuxt(data, item.storeId) || '').trim();
    const city = String(resolveNuxt(data, item.city) || '').trim();
    const street = String(resolveNuxt(data, item.street) || '').trim();
    const postalCode = String(resolveNuxt(data, item.zip) || '').trim();
    const province = String(resolveNuxt(data, item.province) || '').trim();
    const position = resolveNuxt(data, item.position) || {};
    const latitude = Number(position.lat);
    const longitude = Number(position.lng);
    if (!storeId || !city || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < 48.45 || latitude > 51.2 || longitude < 12 || longitude > 19.1) continue;

    const openingTimeString = resolveNuxt(data, item.openingTimeString);
    const openingTimes = resolveNuxt(data, item.openingTimes);
    const underRenovation = Boolean(resolveNuxt(data, item.underRenovation));
    const features = resolveNuxt(data, item.features);
    rows.set(storeId, {
      external_id: `penny:${storeId}`,
      name: `PENNY ${city}`,
      street: street || null,
      city,
      postal_code: postalCode || null,
      region: province || null,
      latitude,
      longitude,
      is_active: !underRenovation,
      opening_hours: {
        source: 'penny.cz',
        store_id: storeId,
        locator_url: PENNY_LOCATOR,
        summary: typeof openingTimeString === 'string' ? openingTimeString : null,
        weekly: Array.isArray(openingTimes) ? openingTimes : [],
        features: Array.isArray(features) ? features : [],
        under_renovation: underRenovation,
      },
    });
  }
  return [...rows.values()];
}

async function syncPennyOfficial(body: any) {
  const dryRun = body.dry_run === true;
  const page = await fetchText(PENNY_LOCATOR, 25_000);
  const data = pennyNuxtData(page.text);
  const rows = parsePennyStores(data);
  if (rows.length < 400) return json({ error: `Oficiální PENNY locator vrátil jen ${rows.length} validních prodejen; zápis byl zastaven.`, code: 'PENNY_LIST_TOO_SMALL', dry_run: dryRun }, 409);

  const storeId = await storeIdForSlug('penny');
  const payload = rows.map((row) => ({ ...row, store_id: storeId }));
  const written = dryRun ? 0 : await upsertBranches(payload);
  return json({
    ok: true,
    dry_run: dryRun,
    source: 'penny_official',
    source_bytes: page.text.length,
    total: rows.length,
    active: rows.filter((row) => row.is_active).length,
    temporarily_inactive: rows.filter((row) => !row.is_active).length,
    written,
    samples: payload.slice(0, 8).map(({ store_id: _storeId, ...row }) => row),
  });
}

// ---------- Albert: official public GraphQL store search used by albert.cz ----------

async function fetchAlbertStoreSearch() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(ALBERT_GRAPHQL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
        'user-agent': UA,
      },
      body: JSON.stringify({
        operationName: 'GetStoreSearch',
        query: ALBERT_STORE_QUERY,
        variables: { lang: 'cs', query: '', pageSize: 9999, currentPage: 0 },
      }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Albert GraphQL HTTP ${response.status}`);
    if (payload?.errors?.length) throw new Error(`Albert GraphQL: ${payload.errors.map((error: any) => error?.message).filter(Boolean).join('; ')}`);
    const result = payload?.data?.storeSearchJSON;
    if (!result || !Array.isArray(result.items)) throw new Error('Albert GraphQL nevrátil očekávaný storeSearchJSON.items.');
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function parseAlbertStores(result: any) {
  const rows = new Map<string, any>();
  for (const item of result.items || []) {
    const warehouseCode = String(item?.warehouseCode ?? item?.id ?? '').trim();
    const address = item?.address || {};
    const point = item?.geoPoint || {};
    const latitude = Number(point.latitude);
    const longitude = Number(point.longitude);
    const city = String(address.town || '').trim();
    if (!warehouseCode || !city || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < 48.45 || latitude > 51.2 || longitude < 12 || longitude > 19.1) continue;

    const services = Array.isArray(item.services)
      ? item.services.map((service: any) => ({ id: service?.id ?? null, label: service?.label || null, description: service?.description || null })).filter((service: any) => service.label || service.id)
      : [];
    const detailUrl = item.url ? new URL(String(item.url), 'https://www.albert.cz').toString() : null;
    rows.set(warehouseCode, {
      external_id: `albert:${warehouseCode}`,
      name: String(item.name || `Albert ${city}`).trim(),
      street: String(address.line1 || '').trim() || null,
      city,
      postal_code: String(address.postalCode || '').trim() || null,
      region: null,
      latitude,
      longitude,
      is_active: true,
      opening_hours: {
        source: 'albert.cz',
        warehouse_code: warehouseCode,
        type: item.type || null,
        detail_url: detailUrl,
        grocery: Array.isArray(item?.openingHours?.groceryOpeningList) ? item.openingHours.groceryOpeningList : [],
        shopping_sunday: item?.openingHours?.shoppingSunday?.description || null,
        extra_info: item?.openingHours?.extraInfo?.description || null,
        services,
      },
    });
  }
  return [...rows.values()];
}

async function syncAlbertOfficial(body: any) {
  const dryRun = body.dry_run === true;
  const result = await fetchAlbertStoreSearch();
  const rows = parseAlbertStores(result);
  const declaredTotal = Number(result.totalItems || rows.length);
  if (declaredTotal < 330 || rows.length < 330) return json({
    error: `Oficiální Albert GraphQL vrátil jen ${rows.length} validních GPS prodejen z ${declaredTotal}; zápis byl zastaven.`,
    code: 'ALBERT_LIST_TOO_SMALL',
    dry_run: dryRun,
  }, 409);

  const storeId = await storeIdForSlug('albert');
  const payload = rows.map((row) => ({ ...row, store_id: storeId }));
  const written = dryRun ? 0 : await upsertBranches(payload);
  return json({
    ok: true,
    dry_run: dryRun,
    source: 'albert_official',
    total: declaredTotal,
    parsed: rows.length,
    written,
    samples: payload.slice(0, 8).map(({ store_id: _storeId, ...row }) => row),
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    if (body.discover === 'kaufland_detail') {
      if (body.dry_run !== true) return json({ error: 'Diagnostika je povolená pouze v dry_run režimu.' }, 409);
      return json(await diagnoseKauflandDetail(body.url));
    }
    if (body.source === 'penny_official') return await syncPennyOfficial(body);
    if (body.source === 'albert_official') return await syncAlbertOfficial(body);
    return await syncKauflandOfficial(body);
  } catch (error) {
    console.error('sync-store-branches failed', error);
    return json({ error: errorText(error), code: 'STORE_BRANCH_SYNC_FAILED' }, 500);
  }
});
