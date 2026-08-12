import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://www.coopclub.cz/letaky/';
const PROCESSOR_URL = Deno.env.get('LEAFLET_PROCESSOR_URL') || `${SUPABASE_URL}/functions/v1/process-leaflet`;
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function isAllowed(request: Request): Promise<boolean> {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE_ROLE_KEY) return true;
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  const role = String(data.user?.app_metadata?.role || '').toLowerCase();
  return ['admin', 'editor'].includes(role);
}

function abs(base: string, href: string): string | null {
  try { return new URL(href.replace(/&amp;/g, '&'), base).toString(); } catch { return null; }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseCzechDate(value: string): string | null {
  const m = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function dateRange(value: string): { from: string; to: string } | null {
  const full = [...value.matchAll(/\d{1,2}\.\d{1,2}\.\d{4}/g)]
    .map((match) => parseCzechDate(match[0])).filter(Boolean) as string[];
  if (full.length >= 2) return { from: full[0], to: full[1] };

  const short = value.match(/(?:od\s*)?(\d{1,2})\.(\d{1,2})\.(?:\s*(\d{4}))?\s*(?:do|[-–])\s*(\d{1,2})\.(\d{1,2})\.(?:\s*(\d{4}))?/i);
  if (!short) return null;
  const currentYear = new Date().getUTCFullYear();
  const fromYear = Number(short[3] || currentYear);
  const toYear = Number(short[6] || (Number(short[5]) < Number(short[2]) ? fromYear + 1 : fromYear));
  const from = parseCzechDate(`${short[1]}.${short[2]}.${fromYear}`);
  const to = parseCzechDate(`${short[4]}.${short[5]}.${toYear}`);
  return from && to ? { from, to } : null;
}

function activeDetailPages(html: string, baseUrl: string): Array<{ url: string; from: string; to: string; score: number }> {
  const today = todayIso();
  const out: Array<{ url: string; from: string; to: string; score: number }> = [];
  const linkRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const anchorText = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    // COOP currently prints the year in sibling markup, while the anchor itself
    // contains only “od 12.8. do 25.8.”. Prefer the anchor range and then inspect
    // a small surrounding card fragment for the full dates.
    const context = html.slice(Math.max(0, m.index - 250), Math.min(html.length, linkRe.lastIndex + 650))
      .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const range = dateRange(anchorText) || dateRange(context);
    if (!range || !(range.from <= today && range.to >= today)) continue;
    const url = abs(baseUrl, m[1]);
    if (!url || !/\/letaky\//i.test(url)) continue;
    const lower = anchorText.toLocaleLowerCase('cs');
    let score = 0;
    if (/csc\s*\d+/.test(lower)) score += 50;
    if (/sč\s*\d+|sc\s*\d+/.test(lower)) score += 40;
    if (/vč\s*\d+|vc\s*\d+/.test(lower)) score += 30;
    if (/jč\s*\d+|jc\s*\d+/.test(lower)) score += 25;
    if (/zč\s*\d+|zc\s*\d+/.test(lower)) score += 20;
    if (/delikates|seznam prodejen|hity|rádce|casopis|časopis/.test(lower)) score -= 80;
    out.push({ url, from: range.from, to: range.to, score });
  }
  return out.sort((a, b) => b.score - a.score || b.from.localeCompare(a.from));
}

function pdfFromDetail(html: string, baseUrl: string): string {
  const candidates: string[] = [];
  for (const m of html.matchAll(/href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi)) {
    const url = abs(baseUrl, m[1]);
    if (url) candidates.push(url);
  }
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/gi)) candidates.push(m[0]);
  const blockedDocument = /clanek|article|pravidla|seznam-prodejen|soukrom|osobn[ií][-_ ]?(?:udaj|data)|gdpr|ochran[ay][-_ ]?(?:udaj|soukrom)|podmink|prohlasen/i;
  const filtered = [...new Set(candidates)].filter((url) => {
    try { return !blockedDocument.test(decodeURIComponent(url)); }
    catch { return !blockedDocument.test(url); }
  });
  if (!filtered.length) throw new Error('Aktuální stránka COOP neobsahuje PDF letáku.');
  return filtered[0];
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function queue(importId: string): Promise<void> {
  const response = await fetch(PROCESSOR_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      'content-type': 'application/json',
      ...(CRON_SECRET ? { 'x-cron-secret': CRON_SECRET } : {}),
    },
    body: JSON.stringify({ import_id: importId }),
  });
  if (!response.ok) throw new Error(`process-leaflet HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 300)}`);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!(await isAllowed(request))) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });

  const checkedAt = new Date().toISOString();
  try {
    const { data: store, error: storeError } = await db.from('stores').select('id,name,slug').eq('slug', 'coop').maybeSingle();
    if (storeError) throw storeError;
    if (!store) return Response.json({ ok: false, skipped: true, reason: 'V tabulce stores chybí obchod coop.' }, { headers: CORS_HEADERS });

    const { data: existing, error: sourceError } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).order('created_at', { ascending: true }).limit(1).maybeSingle();
    if (sourceError) throw sourceError;

    const payload = {
      name: 'COOP – aktuální regionální leták',
      source_url: SOURCE_URL,
      source_type: 'html',
      is_active: true,
      auto_publish: true,
      check_interval_minutes: 360,
      coverage_scope: 'national',
      last_error: null,
    };

    let sourceId: string;
    if (existing) {
      const { error } = await db.from('leaflet_sources').update(payload).eq('id', existing.id);
      if (error) throw error;
      sourceId = existing.id;
    } else {
      const { data: created, error } = await db.from('leaflet_sources').insert({ store_id: store.id, ...payload }).select('id').single();
      if (error) throw error;
      sourceId = created.id;
    }

    const overviewResponse = await fetch(SOURCE_URL, { headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'cs-CZ,cs;q=0.9' }, redirect: 'follow' });
    if (!overviewResponse.ok) throw new Error(`COOP přehled vrátil HTTP ${overviewResponse.status}.`);
    const overviewHtml = await overviewResponse.text();
    const pages = activeDetailPages(overviewHtml, overviewResponse.url || SOURCE_URL);
    if (!pages.length) throw new Error('COOP přehled neobsahuje právě platný produktový leták.');

    const selected = pages[0];
    const detailResponse = await fetch(selected.url, { headers: { 'user-agent': 'Mozilla/5.0', referer: SOURCE_URL }, redirect: 'follow' });
    if (!detailResponse.ok) throw new Error(`COOP detail vrátil HTTP ${detailResponse.status}.`);
    const detailHtml = await detailResponse.text();
    const pdfUrl = pdfFromDetail(detailHtml, detailResponse.url || selected.url);
    const sourceHash = await sha256(`${sourceId}|${pdfUrl}|${selected.from}|${selected.to}|coop-region-v2`);

    const { data: old, error: oldError } = await db.from('leaflet_imports').select('id,status,updated_at').eq('source_hash', sourceHash).maybeSingle();
    if (oldError) throw oldError;
    let importId = old?.id || null;
    let created = false;

    if (!old) {
      const { data: row, error } = await db.from('leaflet_imports').insert({
        source_id: sourceId,
        store_id: store.id,
        source_document_url: pdfUrl,
        source_hash: sourceHash,
        status: 'queued',
        coverage_scope: 'national',
        detected_valid_from: selected.from,
        detected_valid_to: selected.to,
        metadata: { adapter: 'store:coop-current-pdf-v2', detail_url: selected.url, discovered_at: checkedAt },
      }).select('id').single();
      if (error) throw error;
      importId = row.id;
      created = true;
      await queue(importId);
    }

    await db.from('leaflet_sources').update({ last_checked_at: checkedAt, last_success_at: checkedAt, last_error: null }).eq('id', sourceId);
    return Response.json({ ok: true, source_id: sourceId, import_id: importId, import_created: created, detail_url: selected.url, pdf_url: pdfUrl, valid_from: selected.from, valid_to: selected.to, adapter: 'store:coop-current-pdf-v2' }, { headers: CORS_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      const { data: store } = await db.from('stores').select('id').eq('slug', 'coop').maybeSingle();
      if (store?.id) await db.from('leaflet_sources').update({ last_checked_at: checkedAt, last_error: message }).eq('store_id', store.id);
    } catch { /* keep original error */ }
    return Response.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
});
