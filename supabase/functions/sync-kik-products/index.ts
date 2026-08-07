import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};
const FETCH_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/json,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

async function allowed(request: Request) {
  const raw = request.headers.get('authorization') || '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE) return true;
  if (CRON && request.headers.get('x-cron-secret') === CRON) return true;
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  return !error && !!data.user && ['admin','editor'].includes(String(data.user.app_metadata?.role || '').toLowerCase());
}

async function fetchText(url: string, timeout = 25_000) {
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

function dataFromHtml(html: string) {
  const marker = 'var data =';
  const start = html.indexOf(marker);
  const jsonStart = html.indexOf('{', start + marker.length);
  const end = html.indexOf('Reader.Bootstrap.init', jsonStart);
  if (start < 0 || jsonStart < 0 || end < 0) throw new Error('Publitas data mají neočekávaný formát.');
  const block = html.slice(jsonStart, end);
  const semi = block.lastIndexOf(';');
  return JSON.parse((semi >= 0 ? block.slice(0, semi) : block).trim());
}

function isPriceLike(line: string) {
  const text = line.replace(/\u00a0/g, ' ').trim();
  return /(?:\b\d{1,4}(?:[,.]\d{1,2})?\s*Kč\b|\b\d{1,4}[,.]-\b|\bKč\s*\d{1,4}(?:[,.]\d{1,2})?\b)/iu.test(text);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    if (body.dry_run !== true) return json({ error: 'KiK produktová publikace zatím není povolena; použij dry_run.' }, 409);

    const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug','kik').single();
    if (storeError || !store) throw storeError || new Error('KiK obchod nebyl nalezen.');

    const { data: document, error: documentError } = await db.from('leaflet_imports')
      .select('id,source_hash,detected_valid_from,detected_valid_to,metadata')
      .eq('store_id', store.id)
      .eq('status','published')
      .contains('metadata', { adapter: 'kik-publitas-v1' })
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    if (documentError || !document) throw documentError || new Error('Aktuální KiK Publitas dokument nebyl nalezen.');

    const viewer = String(document.metadata?.viewer_url || '').replace(/\/+$/u, '');
    if (!/^https:\/\/letaki\.kik\.cz\//iu.test(viewer)) throw new Error('KiK dokument nemá povolenou viewer adresu.');

    const html = await fetchText(`${viewer}/`);
    const data = dataFromHtml(html);
    const cacheToken = String(data.cacheToken || '');
    if (!cacheToken) throw new Error('KiK Publitas nevrátil cacheToken.');

    const spreads = JSON.parse(await fetchText(`${viewer}/spreads.json?version=${encodeURIComponent(cacheToken)}`));
    if (!Array.isArray(spreads) || !spreads.length) throw new Error('KiK Publitas nevrátil stránky.');

    const samples: unknown[] = [];
    let pages = 0;
    let textLines = 0;
    let priceLines = 0;
    for (const spread of spreads) {
      for (const page of Array.isArray(spread?.pages) ? spread.pages : []) {
        pages++;
        const pageNo = Number(page?.number || pages);
        const lines = String(page?.text || '').split(/\r?\n/u).map((x: string) => x.replace(/\u00a0/g,' ').trim()).filter(Boolean);
        textLines += lines.length;
        for (let i=0; i<lines.length; i++) {
          if (!isPriceLike(lines[i])) continue;
          priceLines++;
          if (samples.length < 120) {
            samples.push({
              page: pageNo,
              price_line: lines[i],
              before: lines.slice(Math.max(0, i - 6), i),
              after: lines.slice(i + 1, Math.min(lines.length, i + 4)),
            });
          }
        }
      }
    }

    return json({
      ok: true,
      dry_run: true,
      store: 'KiK',
      document_id: document.id,
      publication_id: document.metadata?.publication_id || null,
      pages,
      text_lines: textLines,
      price_lines: priceLines,
      cache_token_present: true,
      samples,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: message, code: 'KIK_PRODUCT_DRY_RUN_FAILED' }, 500);
  }
});
