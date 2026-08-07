import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const LIST_URL = 'https://www.jip-potraviny.cz/prodejny/';
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

type BranchLink = { url: string; branch_type: string };

function branchLinks(html: string): BranchLink[] {
  const found = new Map<string, BranchLink>();
  const regex = /js-map-branch-item"\s+data-type="([^"]+)"[\s\S]{0,6500}?<a\s+href="(https:\/\/www[.]jip-potraviny[.]cz\/[^"#?]+\/)"\s+class="i-map-branch__img-link/gi;
  for (const match of html.matchAll(regex)) {
    try {
      const url = new URL(match[2]);
      if (url.protocol !== 'https:' || url.hostname !== 'www.jip-potraviny.cz') continue;
      if (url.pathname === '/prodejny/' || url.pathname === '/') continue;
      const canonical = url.toString();
      found.set(canonical, { url: canonical, branch_type: cleanText(match[1]) });
    } catch {
      // Ignore malformed URLs from source HTML.
    }
  }
  return [...found.values()];
}

function parseAddress(raw: string) {
  const value = cleanText(raw);
  const match = value.match(/^(.*),\s*(\d{3}\s?\d{2})\s*,\s*(.+)$/u);
  if (!match) return { street: value || null, postal_code: null, city: null };
  return {
    street: match[1].trim() || null,
    postal_code: match[2].replace(/\s+/g, ' ').trim(),
    city: match[3].trim() || null,
  };
}

function parseWeekly(html: string) {
  const allowedDays = new Set(['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle']);
  const rows: Array<{ day: string; hours: string }> = [];
  const regex = /<tr>\s*<th>([^<]+)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
  for (const match of html.matchAll(regex)) {
    const day = cleanText(match[1]).replace(/:$/, '');
    if (!allowedDays.has(day)) continue;
    rows.push({ day, hours: cleanText(match[2]) });
    if (rows.length === 7) break;
  }
  return rows;
}

async function parseBranch(link: BranchLink) {
  try {
    const page = await fetchText(link.url);
    const html = page.text;
    const postId = Number(html.match(/\bpostid-(\d+)\b/i)?.[1]);
    const name = cleanText(
      html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      || '',
    ).replace(/\s*-\s*JIP Potraviny\s*$/i, '');
    const gps = html.match(/GPS:\s*<\/span>[\s\S]{0,180}?<span>\s*(-?[0-9]+(?:\.[0-9]+)?)\s*,\s*(-?[0-9]+(?:\.[0-9]+)?)/i);
    const latitude = Number(gps?.[1]);
    const longitude = Number(gps?.[2]);
    const addressRaw = cleanText(
      html.match(/<a[^>]+href="https:\/\/www[.]google[.]com\/maps[^"]*"[^>]*>([\s\S]*?)<\/a>/i)?.[1]
      || '',
    );
    const address = parseAddress(addressRaw);
    const phone = cleanText(html.match(/href="tel:([^"]+)"/i)?.[1] || '');
    const email = cleanText(html.match(/href="mailto:([^"]+)"/i)?.[1] || '');
    const weekly = parseWeekly(html);

    if (!Number.isInteger(postId) || postId <= 0) return { row: null, error: 'Detail neobsahuje stabilní WordPress postid.', url: link.url };
    if (!name) return { row: null, error: 'Detail neobsahuje název pobočky.', url: link.url };
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { row: null, error: 'Detail neobsahuje oficiální GPS.', url: link.url };
    if (latitude < 48.45 || latitude > 51.2 || longitude < 12 || longitude > 19.1) return { row: null, error: 'Oficiální GPS leží mimo očekávaný rozsah ČR.', url: link.url };
    if (!address.city) return { row: null, error: 'Oficiální adresa neobsahuje rozpoznatelné město.', url: link.url };
    if (weekly.length !== 7) return { row: null, error: `Detail obsahuje jen ${weekly.length}/7 dnů otevírací doby.`, url: link.url };

    return {
      row: {
        external_id: `jip:${postId}`,
        name,
        street: address.street,
        city: address.city,
        postal_code: address.postal_code,
        region: null,
        latitude,
        longitude,
        is_active: true,
        opening_hours: {
          source: 'jip-potraviny.cz',
          wordpress_post_id: postId,
          detail_url: page.url,
          branch_type: link.branch_type,
          phone: phone || null,
          email: email || null,
          weekly,
        },
      },
      error: null,
      url: link.url,
    };
  } catch (error) {
    return { row: null, error: errorText(error), url: link.url };
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(request)) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const listing = await fetchText(LIST_URL, 30_000);
    const links = branchLinks(listing.text);
    if (links.length < 45 || links.length > 80) {
      return json({
        error: `Oficiální JIP přehled obsahuje neočekávaných ${links.length} detailních poboček; zápis byl zastaven.`,
        code: 'JIP_LIST_UNEXPECTED',
        dry_run: dryRun,
      }, 409);
    }

    const results: Array<Awaited<ReturnType<typeof parseBranch>>> = [];
    for (let from = 0; from < links.length; from += 4) {
      results.push(...await Promise.all(links.slice(from, from + 4).map(parseBranch)));
    }
    const rows = results.filter((result) => result.row).map((result) => result.row!);
    const failures = results.filter((result) => !result.row).map((result) => ({ url: result.url, error: result.error }));
    const uniqueIds = new Set(rows.map((row) => row.external_id));
    if (rows.length < 45 || uniqueIds.size !== rows.length) {
      return json({
        error: `JIP parser zpracoval jen ${rows.length}/${links.length} poboček nebo našel duplicitní ID; zápis byl zastaven.`,
        code: 'JIP_PARSE_INCOMPLETE',
        dry_run: dryRun,
        failures,
      }, 409);
    }

    let written = 0;
    if (!dryRun) {
      const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'jip').eq('is_active', true).maybeSingle();
      if (storeError) throw storeError;
      if (!store) throw new Error('Aktivní obchod jip nebyl nalezen v tabulce stores.');
      const payload = rows.map((row) => ({ ...row, store_id: store.id }));
      const { error } = await db.from('branches').upsert(payload, { onConflict: 'store_id,external_id' });
      if (error) throw error;
      written = payload.length;
    }

    const typeCounts = rows.reduce<Record<string, number>>((acc, row) => {
      const type = String(row.opening_hours.branch_type || 'unknown');
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});

    return json({
      ok: true,
      dry_run: dryRun,
      source: 'jip_official',
      total: links.length,
      parsed: rows.length,
      written,
      failures,
      type_counts: typeCounts,
      samples: rows.slice(0, 6),
    });
  } catch (error) {
    return json({ error: errorText(error), code: 'JIP_BRANCH_SYNC_FAILED' }, 500);
  }
});
