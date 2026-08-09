import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const SOURCE = 'https://nakup.itesco.cz/shop/cs-CZ/promotions/all';
const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret', 'content-type': 'application/json; charset=utf-8' };
const HEADERS = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36', accept: 'text/html,application/xhtml+xml,application/json,*/*;q=0.8', 'accept-language': 'cs-CZ,cs;q=0.9' };

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: CORS }); }
async function allowed(request: Request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE || (CRON && request.headers.get('x-cron-secret') === CRON)) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}
function scalar(value: unknown) { return ['string', 'number', 'boolean'].includes(typeof value) ? value : undefined; }
function inspect(root: unknown) {
  const samples: any[] = [];
  let objects = 0;
  let arrays = 0;
  const seen = new Set<object>();
  const walk = (value: unknown, path: string, depth: number) => {
    if (depth > 18 || samples.length >= 80 || !value || typeof value !== 'object') return;
    if (seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) {
      arrays++;
      value.slice(0, 500).forEach((item, index) => walk(item, `${path}[${index}]`, depth + 1));
      return;
    }
    objects++;
    const row = value as Record<string, unknown>;
    const keys = Object.keys(row);
    const keyText = keys.join('|').toLowerCase();
    if (/(product|offer|promotion|price|title|name)/.test(keyText) && keys.length <= 80) {
      const preview: Record<string, unknown> = {};
      for (const key of keys) {
        const simple = scalar(row[key]);
        if (simple !== undefined && String(simple).length <= 300) preview[key] = simple;
      }
      if (Object.keys(preview).length >= 2) samples.push({ path, keys, preview });
    }
    for (const [key, item] of Object.entries(row)) walk(item, path ? `${path}.${key}` : key, depth + 1);
  };
  walk(root, '', 0);
  return { objects, arrays, samples };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  try {
    const response = await fetch(`${SOURCE}?_slevao=${Date.now()}`, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    const html = await response.text();
    if (!response.ok) throw new Error(`Tesco Online HTTP ${response.status}`);
    const scripts = [...html.matchAll(/<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    const reports: any[] = [];
    for (let i = 0; i < scripts.length; i++) {
      try {
        const parsed = JSON.parse(scripts[i][1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
        reports.push({ script: i, ...inspect(parsed) });
      } catch { reports.push({ script: i, parse_error: true, chars: scripts[i][1].length }); }
    }
    return json({ ok: true, dry_run: true, final_url: response.url, html_chars: html.length, json_scripts: scripts.length, reports });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error), code: 'TESCO_STRUCTURED_SYNC_FAILED' }, 500);
  }
});
