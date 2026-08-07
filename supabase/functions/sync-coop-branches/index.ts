import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const LIST_URL = 'https://www.coopclub.cz/prodejny/';
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

function decodeUnicode(value: string) {
  return value
    .replace(/\\u([0-9a-f]{4})/gi, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePayload(html: string) {
  let value = html;
  for (let index = 0; index < 4; index += 1) {
    value = value
      .replace(/\\\\\//g, '/')
      .replace(/\\\//g, '/')
      .replace(/\\\\"/g, '"')
      .replace(/\\"/g, '"');
  }
  return decodeUnicode(value);
}

function parseDescription(raw: string) {
  const value = decodeUnicode(raw);
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return {
      city: parts[0] || null,
      street: parts.slice(1, -1).join(', ') || null,
      postal_code: parts[parts.length - 1] || null,
    };
  }
  if (parts.length === 2) return { city: parts[0] || null, street: parts[1] || null, postal_code: null };
  return { city: parts[0] || null, street: null, postal_code: null };
}

function parseMarkers(html: string) {
  const normalized = normalizePayload(html);
  const markerPos = normalized.indexOf('"markers":[');
  if (markerPos < 0) throw new Error('COOP stránka neobsahuje očekávané mapové markers.');
  const source = normalized.slice(markerPos);
  const regex = /"title":"<a href="(https:\/\/www[.]coopclub[.]cz\/prodejny\/([^"/]+)\/?)">([^<]*)<\/a>","description":"([^"]*)","lat":"(-?[0-9]+(?:\.[0-9]+)?)","lng":"(-?[0-9]+(?:\.[0-9]+)?)"/g;
  const rows = new Map<string, any>();
  for (const match of source.matchAll(regex)) {
    const detailUrl = match[1].endsWith('/') ? match[1] : `${match[1]}/`;
    const slug = match[2].trim();
    const name = decodeUnicode(match[3]);
    const description = parseDescription(match[4]);
    const latitude = Number(match[5]);
    const longitude = Number(match[6]);
    if (!slug || !name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (latitude < 48.45 || latitude > 51.2 || longitude < 12 || longitude > 19.1) continue;
    rows.set(slug, {
      external_id: `coop:${slug}`,
      name,
      street: description.street,
      city: description.city,
      postal_code: description.postal_code,
      region: null,
      latitude,
      longitude,
      is_active: true,
      opening_hours: {
        source: 'coopclub.cz',
        detail_url: detailUrl,
        canonical_slug: slug,
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
    const rows = parseMarkers(html);
    if (rows.length < 300) return json({
      error: `Oficiální COOP mapa vrátila jen ${rows.length} validních GPS prodejen; zápis byl zastaven.`,
      code: 'COOP_LIST_TOO_SMALL',
      dry_run: dryRun,
    }, 409);

    let written = 0;
    if (!dryRun) {
      const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'coop').eq('is_active', true).maybeSingle();
      if (storeError) throw storeError;
      if (!store) throw new Error('Aktivní obchod coop nebyl nalezen v tabulce stores.');
      for (let from = 0; from < rows.length; from += 250) {
        const payload = rows.slice(from, from + 250).map((row) => ({ ...row, store_id: store.id }));
        const { error } = await db.from('branches').upsert(payload, { onConflict: 'store_id,external_id' });
        if (error) throw error;
        written += payload.length;
      }
    }

    return json({
      ok: true,
      dry_run: dryRun,
      source: 'coop_official',
      source_bytes: html.length,
      total: rows.length,
      written,
      missing_city: rows.filter((row) => !row.city).length,
      missing_postal_code: rows.filter((row) => !row.postal_code).length,
      samples: rows.slice(0, 8),
    });
  } catch (error) {
    return json({ error: errorText(error), code: 'COOP_BRANCH_SYNC_FAILED' }, 500);
  }
});
