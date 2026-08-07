import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const NORMA_LOCATOR_URL = 'https://www.norma-online.de/cz/filialfinder/';
const ROSSMANN_LIST_URL = 'https://www.rossmann.cz/obsah/prodejny';
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
function cleanText(value: string) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#8211;|&ndash;/gi, '–')
    .replace(/&#8212;|&mdash;/gi, '—')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
async function fetchText(url: string, timeout = 30_000) {
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

function snippets(html: string, needle: string, max = 3) {
  const lower = html.toLowerCase();
  const search = needle.toLowerCase();
  const out: string[] = [];
  let pos = 0;
  while (out.length < max) {
    const found = lower.indexOf(search, pos);
    if (found < 0) break;
    out.push(html.slice(Math.max(0, found - 450), Math.min(html.length, found + 1000)).replace(/\s+/g, ' '));
    pos = found + search.length;
  }
  return out;
}
function cookieHeader(setCookie: string | null) {
  if (!setCookie) return '';
  return setCookie.split(/,(?=[^;,]+=)/).map((part) => part.trim().split(';')[0]).filter(Boolean).join('; ');
}
function mergeCookie(current: string, next: string) {
  const values = new Map<string, string>();
  for (const source of [current, next]) {
    for (const part of source.split(';').map((value) => value.trim()).filter(Boolean)) {
      const eq = part.indexOf('=');
      if (eq > 0) values.set(part.slice(0, eq), part.slice(eq + 1));
    }
  }
  return [...values].map(([key, value]) => `${key}=${value}`).join('; ');
}

async function diagnoseNorma(input: any) {
  if (input.dry_run !== true || input.mode !== 'diagnose') {
    return json({ error: 'NORMA diagnostic requires dry_run=true and mode=diagnose.' }, 409);
  }
  const params = new URLSearchParams();
  params.set('filialfinder[suche][land]', 'Tschechien');
  params.set('filialfinder[suche][radius]', String(input.radius || '10000'));
  params.set('filialfinder[suche][plz]', String(input.postal_code || ''));
  params.set('filialfinder[suche][stadt]', String(input.city || 'Praha'));
  params.set('filialfinder[suche][strasse]', String(input.street || ''));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const baseHeaders: Record<string, string> = {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
      'cache-control': 'no-cache',
    };
    const init = await fetch(NORMA_LOCATOR_URL, { method: 'GET', headers: baseHeaders, redirect: 'manual', signal: controller.signal });
    let cookie = cookieHeader(init.headers.get('set-cookie'));
    const chain: Array<{ step: string; status: number; url: string; location: string | null; cookie_set: boolean }> = [{ step: 'init-get', status: init.status, url: init.url, location: init.headers.get('location'), cookie_set: !!cookie }];
    await init.text();

    const first = await fetch(NORMA_LOCATOR_URL, {
      method: 'POST',
      headers: { ...baseHeaders, 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
      body: params.toString(),
      redirect: 'manual',
      signal: controller.signal,
    });
    const postCookie = cookieHeader(first.headers.get('set-cookie'));
    if (postCookie) cookie = mergeCookie(cookie, postCookie);
    chain.push({ step: 'search-post', status: first.status, url: first.url, location: first.headers.get('location'), cookie_set: !!postCookie });

    let current = first;
    let html = '';
    for (let hop = 0; hop < 5; hop += 1) {
      const location = current.headers.get('location');
      if (!location || ![301, 302, 303, 307, 308].includes(current.status)) {
        html = await current.text();
        break;
      }
      const target = new URL(location, current.url || NORMA_LOCATOR_URL).toString();
      current = await fetch(target, { method: 'GET', headers: { ...baseHeaders, ...(cookie ? { cookie } : {}) }, redirect: 'manual', signal: controller.signal });
      const nextCookie = cookieHeader(current.headers.get('set-cookie'));
      if (nextCookie) cookie = mergeCookie(cookie, nextCookie);
      chain.push({ step: `redirect-${hop + 1}`, status: current.status, url: current.url, location: current.headers.get('location'), cookie_set: !!nextCookie });
    }
    if (!html) html = await current.text();

    const lower = html.toLowerCase();
    const markerNames = ['latitude', 'longitude', 'data-lat', 'data-lng', 'maps.google', 'maps.app', 'openstreetmap', 'leaflet', 'filiale', 'entfernung', 'öffnungszeiten', 'google.com/maps'];
    const markers = Object.fromEntries(markerNames.map((name) => [name, lower.split(name.toLowerCase()).length - 1]));
    const coordinateMatches = [...html.matchAll(/(?:48|49|50|51)[.,][0-9]{3,}[^0-9-]{0,80}(?:12|13|14|15|16|17|18|19)[.,][0-9]{3,}/g)].slice(0, 50).map((match) => match[0]);
    return json({
      ok: current.ok,
      dry_run: true,
      mode: 'diagnose',
      status: current.status,
      final_url: current.url,
      bytes: html.length,
      redirect_chain: chain,
      markers,
      coordinate_matches: coordinateMatches,
      samples: {
        latitude: snippets(html, 'latitude'),
        longitude: snippets(html, 'longitude'),
        maps: snippets(html, 'maps'),
        result: snippets(html, 'entfernung'),
        hours: snippets(html, 'Öffnungszeiten'),
        praha: snippets(html, 'Praha'),
      },
    }, current.ok ? 200 : 502);
  } finally {
    clearTimeout(timer);
  }
}

function formatPostal(raw: string) {
  const digits = raw.replace(/\s+/g, '');
  return /^\d{5}$/.test(digits) ? `${digits.slice(0, 3)} ${digits.slice(3)}` : null;
}
function parseRossmannAddress(raw: string) {
  const value = cleanText(raw);
  const trailing = value.match(/^(.*),\s*(\d{5})\s+(.+)$/u);
  if (trailing) return { street: trailing[1].trim() || null, postal_code: formatPostal(trailing[2]), city: trailing[3].trim() || null };
  const leading = value.match(/^(\d{5})\s+([^,]+),\s*(.+)$/u);
  if (leading) return { street: leading[3].trim() || null, postal_code: formatPostal(leading[1]), city: leading[2].trim() || null };
  return { street: value || null, postal_code: null, city: null };
}
function parseRossmannHours(block: string) {
  const rows: Array<{ day: string; hours: string }> = [];
  for (const match of block.matchAll(/<div[^>]*class="page-store--opening-day"[^>]*>[\s\S]*?<strong>([^<]+)<\/strong>([\s\S]*?)<\/div>/gi)) {
    const day = cleanText(match[1]).replace(/:$/, '');
    const hours = cleanText(match[2]);
    if (day) rows.push({ day, hours });
  }
  return rows;
}
function parseRossmannStores(html: string) {
  const rows = new Map<string, any>();
  const regex = /<a\s+href="\/obsah\/prodejny\/([^"/?#]+)"\s+class="[^"]*page-store--store-item[^"]*"\s+data-latitude="(-?[0-9]+(?:\.[0-9]+)?)"\s+data-longitude="(-?[0-9]+(?:\.[0-9]+)?)"([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(regex)) {
    const slug = cleanText(match[1]).toLowerCase();
    const latitude = Number(match[2]);
    const longitude = Number(match[3]);
    const block = match[4];
    const title = cleanText(block.match(/class="page-store--store-title"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || slug);
    const analyticsAddress = cleanText(block.match(/data-ga-address="([^"]+)"/i)?.[1] || '');
    const visibleAddress = cleanText(block.match(/class="page-store--store-address-value"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    const address = parseRossmannAddress(analyticsAddress || visibleAddress);
    const weekly = parseRossmannHours(block);
    if (!slug || !address.city || !address.street) continue;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (latitude < 48.45 || latitude > 51.2 || longitude < 12 || longitude > 19.1) continue;
    if (weekly.length !== 7) continue;
    rows.set(slug, {
      external_id: `rossmann:${slug}`,
      name: `ROSSMANN ${title}`,
      street: address.street,
      city: address.city,
      postal_code: address.postal_code,
      region: null,
      latitude,
      longitude,
      is_active: true,
      opening_hours: {
        source: 'rossmann.cz',
        canonical_slug: slug,
        detail_url: `https://www.rossmann.cz/obsah/prodejny/${encodeURIComponent(slug)}`,
        weekly,
      },
    });
  }
  return [...rows.values()];
}
async function syncRossmann(input: any) {
  const dryRun = input.dry_run === true;
  const html = await fetchText(ROSSMANN_LIST_URL);
  const rows = parseRossmannStores(html);
  if (rows.length < 215 || rows.length > 240) {
    return json({ error: `Oficiální Rossmann locator vrátil ${rows.length} kompletních GPS prodejen; zápis byl zastaven.`, code: 'ROSSMANN_LIST_UNEXPECTED', dry_run: dryRun }, 409);
  }
  if (new Set(rows.map((row) => row.external_id)).size !== rows.length) {
    return json({ error: 'Rossmann parser našel duplicitní canonical slug.', code: 'ROSSMANN_DUPLICATE_IDS', dry_run: dryRun }, 409);
  }

  let written = 0;
  if (!dryRun) {
    const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'rossmann').eq('is_active', true).maybeSingle();
    if (storeError) throw storeError;
    if (!store) throw new Error('Aktivní obchod rossmann nebyl nalezen v tabulce stores.');
    const payload = rows.map((row) => ({ ...row, store_id: store.id }));
    const { error } = await db.from('branches').upsert(payload, { onConflict: 'store_id,external_id' });
    if (error) throw error;
    written = payload.length;
  }
  return json({ ok: true, dry_run: dryRun, source: 'rossmann_official', source_bytes: html.length, total: rows.length, written, missing_postal_code: rows.filter((row) => !row.postal_code).length, samples: rows.slice(0, 8) });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(request)) return json({ error: 'Unauthorized' }, 401);

  try {
    const input = await request.json().catch(() => ({}));
    if (input.source === 'rossmann_official') return await syncRossmann(input);
    return await diagnoseNorma(input);
  } catch (error) {
    return json({ error: errorText(error), code: 'EXTRA_BRANCH_SYNC_FAILED' }, 500);
  }
});
