import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const SITEMAP_URL = 'https://www.itesco.cz/prodejny/sitemap.xml';
const STORE_PREFIX = 'https://www.itesco.cz/prodejny/';
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

async function fetchText(url: string, timeout = 25_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/xml,text/xml,*/*;q=0.8',
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

function storeLinks(xml: string) {
  const urls = new Set<string>();
  for (const match of xml.matchAll(/<loc>(https:\/\/www[.]itesco[.]cz\/prodejny\/[^<]+)<\/loc>/gi)) {
    try {
      const url = new URL(match[1]);
      if (url.protocol !== 'https:' || url.hostname !== 'www.itesco.cz') continue;
      const segments = decodeURIComponent(url.pathname).split('/').filter(Boolean);
      if (segments[0] !== 'prodejny' || segments.length < 3) continue;
      url.hash = '';
      url.search = '';
      urls.add(url.toString());
    } catch {
      // Ignore malformed source URLs.
    }
  }
  return [...urls].sort();
}

function parseYextProps(html: string) {
  const raw = html.match(/<script[^>]+class="js-yext-props"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseWeekly(html: string) {
  const allowedDays = new Set(['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle']);
  const rows: Array<{ day: string; hours: string }> = [];
  const regex = /<tr[^>]*class="[^"]*c-hours-details-row[^"]*"[^>]*>[\s\S]*?<td[^>]*class="[^"]*c-hours-details-row-day[^"]*"[^>]*>([\s\S]*?)<\/td>[\s\S]*?<td[^>]*class="[^"]*c-hours-details-row-intervals[^"]*"[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;
  for (const match of html.matchAll(regex)) {
    const day = cleanText(match[1]);
    if (!allowedDays.has(day)) continue;
    rows.push({ day, hours: cleanText(match[2]) });
    if (rows.length === 7) break;
  }
  return rows;
}

async function parseStore(url: string) {
  try {
    const page = await fetchText(url);
    const html = page.text;
    const props = parseYextProps(html);
    const yextId = Number(props?.ids);
    const name = cleanText(html.match(/<span[^>]*class="Core-title[^>]*>([\s\S]*?)<\/span>/i)?.[1] || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
    const latitude = Number(html.match(/itemprop="latitude"\s+content="(-?[0-9]+(?:\.[0-9]+)?)"/i)?.[1] || html.match(/<meta\s+name="geo[.]position"\s+content="(-?[0-9]+(?:\.[0-9]+)?);/i)?.[1]);
    const longitude = Number(html.match(/itemprop="longitude"\s+content="(-?[0-9]+(?:\.[0-9]+)?)"/i)?.[1] || html.match(/<meta\s+name="geo[.]position"\s+content="-?[0-9]+(?:\.[0-9]+)?;(-?[0-9]+(?:\.[0-9]+)?)"/i)?.[1]);
    const street = cleanText(html.match(/<span[^>]*class="Address-field Address-line1"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    const city = cleanText(html.match(/<span[^>]*class="Address-field Address-city"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    const postalCode = cleanText(html.match(/<span[^>]*class="Address-field Address-postalCode"[^>]*[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    const regionRaw = cleanText(html.match(/<meta\s+name="geo[.]region"\s+content="([^"]+)"/i)?.[1] || '');
    const region = regionRaw.replace(/^Česko-/i, '').trim() || null;
    const googleCid = html.match(/https:\/\/maps[.]google[.]com\/maps[?]cid=([0-9]+)/i)?.[1] || null;
    const weekly = parseWeekly(html);
    const format = name.match(/^Tesco\s+(Hypermarket|Supermarket|Expres)\b/i)?.[1] || null;

    if (!Number.isInteger(yextId) || yextId <= 0) return { row: null, error: 'Detail neobsahuje stabilní Yext ids.', url };
    if (!name) return { row: null, error: 'Detail neobsahuje název pobočky.', url };
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { row: null, error: 'Detail neobsahuje oficiální schema.org GPS.', url };
    if (latitude < 48.45 || latitude > 51.2 || longitude < 12 || longitude > 19.1) return { row: null, error: 'Oficiální GPS leží mimo očekávaný rozsah ČR.', url };
    if (!city || !street) return { row: null, error: 'Detail neobsahuje úplnou oficiální adresu.', url };
    if (weekly.length !== 7) return { row: null, error: `Detail obsahuje jen ${weekly.length}/7 dnů otevírací doby.`, url };

    return {
      row: {
        external_id: `tesco:${yextId}`,
        name,
        street,
        city,
        postal_code: postalCode || null,
        region,
        latitude,
        longitude,
        is_active: true,
        opening_hours: {
          source: 'itesco.cz',
          yext_id: yextId,
          detail_url: page.url,
          format,
          google_cid: googleCid,
          weekly,
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
    const offset = Math.max(0, Math.floor(Number(body.offset) || 0));
    const limit = Math.min(25, Math.max(1, Math.floor(Number(body.limit) || 25)));

    const sitemap = await fetchText(SITEMAP_URL, 30_000);
    const links = storeLinks(sitemap.text);
    if (links.length < 175 || links.length > 210) {
      return json({
        error: `Oficiální Tesco sitemapa obsahuje neočekávaných ${links.length} detailních poboček; zápis byl zastaven.`,
        code: 'TESCO_LIST_UNEXPECTED',
        dry_run: dryRun,
      }, 409);
    }

    const selected = links.slice(offset, offset + limit);
    if (selected.length === 0) {
      return json({ ok: true, dry_run: dryRun, source: 'tesco_official', total: links.length, offset, requested: 0, parsed: 0, written: 0, next_offset: offset, done: true, failures: [] });
    }

    const results: Array<Awaited<ReturnType<typeof parseStore>>> = [];
    for (let from = 0; from < selected.length; from += 5) {
      results.push(...await Promise.all(selected.slice(from, from + 5).map(parseStore)));
    }
    const rows = results.filter((result) => result.row).map((result) => result.row!);
    const failures = results.filter((result) => !result.row).map((result) => ({ url: result.url, error: result.error }));
    const minimum = Math.max(1, Math.ceil(selected.length * 0.8));
    const uniqueIds = new Set(rows.map((row) => row.external_id));
    if (rows.length < minimum || uniqueIds.size !== rows.length) {
      return json({
        error: `Tesco parser zpracoval jen ${rows.length}/${selected.length} poboček nebo našel duplicitní ID; zápis byl zastaven.`,
        code: 'TESCO_PARSE_INCOMPLETE',
        dry_run: dryRun,
        total: links.length,
        offset,
        failures,
      }, 409);
    }

    let written = 0;
    if (!dryRun) {
      const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'tesco').eq('is_active', true).maybeSingle();
      if (storeError) throw storeError;
      if (!store) throw new Error('Aktivní obchod tesco nebyl nalezen v tabulce stores.');
      const payload = rows.map((row) => ({ ...row, store_id: store.id }));
      const { error } = await db.from('branches').upsert(payload, { onConflict: 'store_id,external_id' });
      if (error) throw error;
      written = payload.length;
    }

    const formatCounts = rows.reduce<Record<string, number>>((acc, row) => {
      const format = String(row.opening_hours.format || 'unknown');
      acc[format] = (acc[format] || 0) + 1;
      return acc;
    }, {});
    const nextOffset = Math.min(links.length, offset + selected.length);

    return json({
      ok: true,
      dry_run: dryRun,
      source: 'tesco_official',
      total: links.length,
      offset,
      requested: selected.length,
      parsed: rows.length,
      written,
      next_offset: nextOffset,
      done: nextOffset >= links.length,
      failures,
      format_counts: formatCounts,
      samples: rows.slice(0, 5),
    });
  } catch (error) {
    return json({ error: errorText(error), code: 'TESCO_BRANCH_SYNC_FAILED' }, 500);
  }
});
