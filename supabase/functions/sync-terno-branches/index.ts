import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36';
const LIST_URL = 'https://www.terno.cz/supermarkety/';
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
  if (error instanceof Error) return error.message;
  return String(error);
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
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url: string, timeout = 20_000) {
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
  } finally {
    clearTimeout(timer);
  }
}

function detailLinks(html: string) {
  const values = new Set<string>();
  for (const match of html.matchAll(/https:\/\/www[.]terno[.]cz\/prodejny\/[^"'<>\s]+\//gi)) {
    try {
      const url = new URL(match[0]);
      if (url.hostname === 'www.terno.cz' && /^\/prodejny\/[^/]+\/$/.test(url.pathname)) values.add(url.toString());
    } catch { /* ignore */ }
  }
  return [...values].sort();
}

function coordinatesFromUrl(value: string) {
  const exact = value.match(/!3d(-?[0-9]+(?:\.[0-9]+)?)!4d(-?[0-9]+(?:\.[0-9]+)?)/i);
  const viewport = value.match(/@(-?[0-9]+(?:\.[0-9]+)?),(-?[0-9]+(?:\.[0-9]+)?)/i);
  const latitude = Number(exact?.[1] ?? viewport?.[1]);
  const longitude = Number(exact?.[2] ?? viewport?.[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < 48.45 || latitude > 51.2 || longitude < 12 || longitude > 19.1) return null;
  return { latitude, longitude };
}

async function resolveMapCoordinates(shortUrl: string) {
  let current = shortUrl;
  for (let hop = 0; hop < 6; hop += 1) {
    const ready = coordinatesFromUrl(current);
    if (ready) return { ...ready, resolved_url: current };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(current, {
        method: 'GET',
        headers: { 'user-agent': UA, accept: 'text/html,*/*;q=0.8' },
        redirect: 'manual',
        signal: controller.signal,
      });
      const location = response.headers.get('location');
      if (location) {
        current = new URL(location, current).toString();
        continue;
      }
      const found = coordinatesFromUrl(response.url || current);
      return found ? { ...found, resolved_url: response.url || current } : null;
    } finally {
      clearTimeout(timer);
    }
  }
  const final = coordinatesFromUrl(current);
  return final ? { ...final, resolved_url: current } : null;
}

function parseAddress(raw: string) {
  const value = cleanText(raw);
  const match = value.match(/^(.*?),\s*(\d{3}\s?\d{2})\s+(.+)$/u);
  if (!match) return { street: value || null, postal_code: null, city: null };
  return {
    street: match[1].trim() || null,
    postal_code: match[2].replace(/\s+/g, ' ').trim(),
    city: match[3].trim() || null,
  };
}

function openingHours(html: string) {
  const rows: Array<{ day: string; hours: string }> = [];
  for (const match of html.matchAll(/<tr>\s*<td>\s*<strong>([^<]+)<\/strong>:\s*<\/td>\s*<td>([^<]+)<\/td>\s*<\/tr>/gi)) {
    rows.push({ day: cleanText(match[1]), hours: cleanText(match[2]) });
  }
  return rows.slice(0, 7);
}

async function parseStore(url: string) {
  try {
    const page = await fetchText(url);
    const html = page.text;
    const postId = Number(html.match(/"post_id"\s*:\s*(\d+)/i)?.[1]);
    const name = cleanText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    const mapMatch = html.match(/<a[^>]+href=["'](https:\/\/maps[.]app[.]goo[.]gl\/[^"']+)["'][^>]*>([^<]+)<\/a>/i);
    if (!Number.isInteger(postId) || postId <= 0) return { row: null, error: 'Detail neobsahuje stabilní WordPress post_id.', url };
    if (!mapMatch) return { row: null, error: 'Detail neobsahuje oficiální Google Maps adresní odkaz.', url };
    const coordinates = await resolveMapCoordinates(mapMatch[1]);
    if (!coordinates) return { row: null, error: 'Oficiální mapový odkaz nevrátil validní GPS v ČR.', url };
    const address = parseAddress(mapMatch[2]);
    if (!address.city) return { row: null, error: 'Oficiální adresa neobsahuje rozpoznatelné město.', url };
    const phone = cleanText(html.match(/Tel\.:?\s*<[^>]*>([^<]+)</i)?.[1] || html.match(/Tel\.:?\s*([^<\n]+)/i)?.[1] || '');

    return {
      row: {
        external_id: `terno:${postId}`,
        name: name || `Terno ${address.city}`,
        street: address.street,
        city: address.city,
        postal_code: address.postal_code,
        region: null,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        is_active: true,
        opening_hours: {
          source: 'terno.cz',
          wordpress_post_id: postId,
          detail_url: url,
          map_url: mapMatch[1],
          phone: phone || null,
          weekly: openingHours(html),
        },
      },
      error: null,
      url,
    };
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
    const listing = await fetchText(LIST_URL, 25_000);
    const links = detailLinks(listing.text);
    if (links.length < 14) return json({ error: `Oficiální Terno seznam obsahuje jen ${links.length} detailů; synchronizace byla zastavena.`, code: 'TERNO_LIST_TOO_SMALL', dry_run: dryRun }, 409);

    const results: Array<Awaited<ReturnType<typeof parseStore>>> = [];
    for (let from = 0; from < links.length; from += 4) results.push(...await Promise.all(links.slice(from, from + 4).map(parseStore)));
    const rows = results.filter((result) => result.row).map((result) => result.row);
    const failures = results.filter((result) => !result.row).map((result) => ({ url: result.url, error: result.error }));
    if (rows.length < 13) return json({ error: `Terno parser zpracoval jen ${rows.length}/${links.length} poboček; zápis byl zastaven.`, code: 'TERNO_PARSE_INCOMPLETE', dry_run: dryRun, failures }, 409);

    let written = 0;
    if (!dryRun) {
      const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'terno').eq('is_active', true).maybeSingle();
      if (storeError) throw storeError;
      if (!store) throw new Error('Aktivní obchod terno nebyl nalezen v tabulce stores.');
      const payload = rows.map((row) => ({ ...row, store_id: store.id }));
      const { error } = await db.from('branches').upsert(payload, { onConflict: 'store_id,external_id' });
      if (error) throw error;
      written = payload.length;
    }

    return json({ ok: true, dry_run: dryRun, source: 'terno_official', total: links.length, parsed: rows.length, written, failures, samples: rows.slice(0, 5) });
  } catch (error) {
    return json({ error: errorText(error), code: 'TERNO_BRANCH_SYNC_FAILED' }, 500);
  }
});
