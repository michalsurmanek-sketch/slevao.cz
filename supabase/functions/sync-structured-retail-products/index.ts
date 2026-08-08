import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8'
};
const FETCH_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/json,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}
function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    return [value.message, value.details, value.hint, value.code].filter(Boolean).map(String).join(' | ') || JSON.stringify(error);
  }
  return String(error);
}
async function authorized(request: Request) {
  const raw = request.headers.get('authorization') || '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE_ROLE_KEY) return true;
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return true;
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  return !error && !!data.user && ['admin', 'editor'].includes(String(data.user.app_metadata?.role || '').toLowerCase());
}
async function fetchText(url: string, timeout = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow', signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}
function pragueDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
function isoDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function normalize(value: string) {
  return String(value || '').toLocaleLowerCase('cs').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function clean(value: string) {
  return String(value || '').replace(/\s+/g, ' ').replace(/^[•●▪▼]\s*/u, '').trim();
}
function dataFromPublitasHtml(html: string) {
  const marker = 'var data =';
  const start = html.indexOf(marker);
  const jsonStart = html.indexOf('{', start + marker.length);
  const end = html.indexOf('Reader.Bootstrap.init', jsonStart);
  if (start < 0 || jsonStart < 0 || end < 0) throw new Error('Publitas data mají neočekávaný formát.');
  const block = html.slice(jsonStart, end);
  const semi = block.lastIndexOf(';');
  return JSON.parse((semi >= 0 ? block.slice(0, semi) : block).trim());
}

type Publication = { viewer: string; valid_from: string; valid_to: string; location_type: string; label: string };
function extractBillaPublications(html: string): Publication[] {
  const raw = [...html.matchAll(/https:\/\/view\.publitas\.com\/billa-cz\/[a-z0-9\-]+(?:\/page\/\d+)?/giu)].map((match) => match[0]);
  const unique = [...new Set(raw.map((url) => url.replace(/\/page\/\d+\/?$/iu, '').replace(/\/+$/u, '')))];
  const today = pragueDate();
  const rows: Publication[] = [];
  for (const viewer of unique) {
    const slug = viewer.split('/').filter(Boolean).at(-1) || '';
    const match = slug.match(/^(velky|maly)-letak-(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{1,2})-(20\d{2})$/iu);
    if (!match) continue;
    const [, size, fromDay, fromMonth, toDay, toMonth, year] = match;
    const validFrom = isoDate(Number(year), Number(fromMonth), Number(fromDay));
    const validTo = isoDate(Number(year), Number(toMonth), Number(toDay));
    if (!(validFrom <= today && validTo >= today)) continue;
    const big = size.toLowerCase() === 'velky';
    rows.push({ viewer, valid_from: validFrom, valid_to: validTo, location_type: big ? 'LARGE' : 'SMALL', label: big ? 'Velký leták' : 'Malý leták' });
  }
  return rows;
}

const PRICE = /^(?:AKCE\s*)?(\d{1,4}(?:[,.]\d{1,2})?|\d{1,4},-)\s*(?:Kč|,-)(?:\s|$)/iu;
const BAD = /(?:BILLA|KLUB|SLEVA|UŠETŘÍTE|AKCE|PLATÍ|CENA ZA|KUPTE|ZÍSKEJTE|APLIKACE|VÍCE INFORMACÍ|WWW\.|OD STŘEDY|DO ÚTERÝ|VYBRANÉ DRUHY|ILUSTRAČNÍ FOTO)/iu;
const QTY = /^(?:\d+[×x]?\s*)?\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|ks|bal\.?|rolí|dávek|%)(?:\s|$)/iu;
function goodTitle(line: string) {
  if (!line || line.length < 3 || line.length > 90) return false;
  if (BAD.test(line) || QTY.test(line) || /^[-–+%\d\s,.]+$/u.test(line) || /Kč|,-/iu.test(line)) return false;
  const letters = line.replace(/[^A-Za-zÁ-ž]/gu, '');
  if (letters.length < 3) return false;
  return true;
}
function parsePublitasPage(text: string, page: number, publication: Publication) {
  const lines = String(text || '').split(/\r?\n/u).map((line) => clean(line)).filter(Boolean);
  const rows: any[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(PRICE);
    if (!match) continue;
    const price = Number(match[1].replace(',-', '').replace(',', '.'));
    if (!Number.isFinite(price) || price < 2 || price > 9999) continue;
    let title = '';
    let titleIndex = -1;
    for (let offset = 1; offset <= 12 && i - offset >= 0; offset++) {
      const candidate = clean(lines[i - offset]);
      if (goodTitle(candidate)) { title = candidate; titleIndex = i - offset; break; }
    }
    if (!title || titleIndex < 0) continue;
    const normalized = normalize(title);
    if (normalized.length < 3) continue;
    rows.push({
      title,
      normalized_title: normalized,
      price,
      valid_from: publication.valid_from,
      valid_to: publication.valid_to,
      source_url: `${publication.viewer}/page/${page}`,
      source_page: page,
      location_type: publication.location_type,
      location_label: publication.label,
      confidence: 0.92
    });
  }
  return rows;
}
async function buildBillaRows() {
  const landing = await fetchText('https://www.billa.cz/letaky-billa');
  const publications = extractBillaPublications(landing);
  if (!publications.length) throw new Error('BILLA: nebyl nalezen aktuální týdenní Publitas leták.');
  const candidates: any[] = [];
  for (const publication of publications) {
    const html = await fetchText(`${publication.viewer}/`);
    const data = dataFromPublitasHtml(html);
    const token = String(data.cacheToken || '');
    if (!token) throw new Error(`BILLA Publitas ${publication.viewer} nevrátil cache token.`);
    const spreads = JSON.parse(await fetchText(`${publication.viewer}/spreads.json?version=${encodeURIComponent(token)}`));
    if (!Array.isArray(spreads) || !spreads.length) throw new Error(`BILLA Publitas ${publication.viewer} nevrátil stránky.`);
    for (const spread of spreads) {
      for (const page of Array.isArray(spread?.pages) ? spread.pages : []) {
        candidates.push(...parsePublitasPage(String(page?.text || ''), Number(page?.number || 0), publication));
      }
    }
  }
  const best = new Map<string, any>();
  for (const row of candidates) {
    const key = `${row.location_type}|${row.normalized_title}|${row.valid_from}|${row.valid_to}`;
    const previous = best.get(key);
    if (!previous || row.price < previous.price) best.set(key, row);
  }
  return { publications, raw_candidates: candidates.length, rows: [...best.values()].sort((a, b) => a.title.localeCompare(b.title, 'cs') || a.price - b.price) };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await authorized(request))) return json({ error: 'Unauthorized' }, 401);
  const body = await request.json().catch(() => ({}));
  const store = String(body.store || 'billa').toLowerCase();
  if (store !== 'billa') return json({ error: `Unsupported store: ${store}` }, 400);
  try {
    const built = await buildBillaRows();
    return json({
      ok: true,
      dry_run: true,
      store: 'billa',
      publications: built.publications,
      raw_candidates: built.raw_candidates,
      publishable: built.rows.length,
      samples: built.rows.slice(0, 80)
    });
  } catch (error) {
    return json({ error: errorText(error), code: 'STRUCTURED_RETAIL_SYNC_FAILED' }, 500);
  }
});
