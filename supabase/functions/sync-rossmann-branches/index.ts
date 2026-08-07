import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const LIST_URL = 'https://www.rossmann.cz/obsah/prodejny';
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

function parseAddress(raw: string) {
  const value = cleanText(raw);
  const match = value.match(/^(.*),\s*(\d{5})\s+(.+)$/u);
  if (!match) return { street: value || null, postal_code: null, city: null };
  return {
    street: match[1].trim() || null,
    postal_code: `${match[2].slice(0, 3)} ${match[2].slice(3)}`,
    city: match[3].trim() || null,
  };
}

function parseHours(block: string) {
  const rows: Array<{ day: string; hours: string }> = [];
  for (const match of block.matchAll(/<div[^>]*class="page-store--opening-day"[^>]*>[\s\S]*?<strong>([^<]+)<\/strong>([\s\S]*?)<\/div>/gi)) {
    const day = cleanText(match[1]).replace(/:$/, '');
    const hours = cleanText(match[2]);
    if (day) rows.push({ day, hours });
  }
  return rows;
}

function parseStores(html: string) {
  const rows = new Map<string, any>();
  const regex = /<a\s+href="\/obsah\/prodejny\/([^"/?#]+)"\s+class="[^"]*page-store--store-item[^"]*"\s+data-latitude="(-?[0-9]+(?:\.[0-9]+)?)"\s+data-longitude="(-?[0-9]+(?:\.[0-9]+)?)"([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(regex)) {
    const slug = cleanText(match[1]).toLowerCase();
    const latitude = Number(match[2]);
    const longitude = Number(match[3]);
    const block = match[4];
    const title = cleanText(block.match(/class="page-store--store-title"[^>]*>([\s\S]*?)<\/div>/i)?.[1] || slug);
    const rawAddress = cleanText(block.match(/class="page-store--store-address-value"[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '');
    const address = parseAddress(rawAddress);
    const weekly = parseHours(block);
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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(request)) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const html = await fetchText(LIST_URL);
    const rows = parseStores(html);
    if (rows.length < 215 || rows.length > 240) {
      return json({
        error: `Oficiální Rossmann locator vrátil ${rows.length} kompletních GPS prodejen; zápis byl zastaven.`,
        code: 'ROSSMANN_LIST_UNEXPECTED',
        dry_run: dryRun,
      }, 409);
    }
    const uniqueIds = new Set(rows.map((row) => row.external_id));
    if (uniqueIds.size !== rows.length) {
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

    return json({
      ok: true,
      dry_run: dryRun,
      source: 'rossmann_official',
      source_bytes: html.length,
      total: rows.length,
      written,
      missing_postal_code: rows.filter((row) => !row.postal_code).length,
      samples: rows.slice(0, 8),
    });
  } catch (error) {
    return json({ error: errorText(error), code: 'ROSSMANN_BRANCH_SYNC_FAILED' }, 500);
  }
});
