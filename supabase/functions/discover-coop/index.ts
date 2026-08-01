import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const PROCESSOR_URL = Deno.env.get('LEAFLET_PROCESSOR_URL') || `${SUPABASE_URL}/functions/v1/process-leaflet`;
const COOP_LISTING_URL = 'https://www.coopclub.cz/letaky/';

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

function absoluteUrl(base: string, href: string): string | null {
  try { return new URL(href.replace(/&amp;/g, '&'), base).toString(); } catch { return null; }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchText(url: string): Promise<{ text: string; url: string }> {
  const response = await fetch(url, { headers: { ...HEADERS, referer: new URL(url).origin + '/' }, redirect: 'follow' });
  if (!response.ok) throw new Error(`COOP HTTP ${response.status} pro ${url}`);
  return { text: await response.text(), url: response.url };
}

function activeDetailPages(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const pattern = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const href = absoluteUrl(baseUrl, match[1]);
    const text = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!href) continue;
    if (!/coopclub\.cz\/letaky\//i.test(href)) continue;
    if (/seznam prodejen|archiv/i.test(text)) continue;
    links.add(href);
  }
  return [...links].slice(0, 12);
}

function pdfFromDetail(html: string, baseUrl: string): string | null {
  const candidates: string[] = [];
  const patterns = [
    /<a[^>]+href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi,
    /https?:\/\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
      const url = absoluteUrl(baseUrl, match[1] || match[0]);
      if (url) candidates.push(url);
    }
  }
  const blockedDocument = /casopis|radce|ciperka|soukrom|osobn[ií][-_ ]?(?:udaj|data)|gdpr|ochran[ay][-_ ]?(?:udaj|soukrom)|podmink|prohlasen/i;
  return [...new Set(candidates)].find((url) => {
    try { return !blockedDocument.test(decodeURIComponent(url)); }
    catch { return !blockedDocument.test(url); }
  }) || null;
}

function regionFromTitle(title: string): { scope: string; regionCode: string | null; location: string | null } {
  const lower = title.toLocaleLowerCase('cs');
  if (/jihočesk|jč\b/.test(lower)) return { scope: 'regional', regionCode: 'CZ-JC', location: 'Jihočeský region' };
  if (/středočesk|sč\b/.test(lower)) return { scope: 'regional', regionCode: 'CZ-ST', location: 'Středočeský region' };
  if (/východočesk|vč\b/.test(lower)) return { scope: 'regional', regionCode: 'CZ-VC', location: 'Východočeský region' };
  if (/západočesk|zč\b/.test(lower)) return { scope: 'regional', regionCode: 'CZ-PL', location: 'Západočeský region' };
  return { scope: 'national', regionCode: null, location: null };
}

function titleFromDetail(html: string): string {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || 'COOP leták';
  return h1.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

async function queueProcessor(importId: string) {
  const response = await fetch(PROCESSOR_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'x-cron-secret': CRON_SECRET,
    },
    body: JSON.stringify({ import_id: importId }),
  });
  if (!response.ok) throw new Error(`Processor HTTP ${response.status}`);
}

async function run() {
  const checkedAt = new Date().toISOString();
  const { data: source, error: sourceError } = await db.from('leaflet_sources')
    .select('id,store_id,name,auto_publish,stores!inner(slug,name)')
    .eq('stores.slug', 'coop')
    .maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) throw new Error('Zdroj COOP není v leaflet_sources.');

  try {
    const listing = await fetchText(COOP_LISTING_URL);
    const detailPages = activeDetailPages(listing.text, listing.url);
    if (!detailPages.length) throw new Error('COOP přehled neobsahuje žádné aktuální letáky.');

    let queued = 0;
    const discovered: Array<Record<string, unknown>> = [];

    for (const detailUrl of detailPages) {
      const detail = await fetchText(detailUrl);
      const title = titleFromDetail(detail.text);
      const pdfUrl = pdfFromDetail(detail.text, detail.url);
      if (!pdfUrl) {
        discovered.push({ title, detail_url: detail.url, skipped: 'PDF nenalezeno' });
        continue;
      }

      const geography = regionFromTitle(title);
      const sourceHash = await sha256(`${source.id}|${pdfUrl}|coop-v1`);
      const { data: existing, error: existingError } = await db.from('leaflet_imports')
        .select('id,status')
        .eq('source_hash', sourceHash)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) {
        discovered.push({ title, pdf_url: pdfUrl, status: existing.status, duplicate: true });
        continue;
      }

      const { data: created, error: createError } = await db.from('leaflet_imports').insert({
        source_id: source.id,
        store_id: source.store_id,
        source_document_url: pdfUrl,
        source_hash: sourceHash,
        status: 'queued',
        coverage_scope: geography.scope,
        region_code: geography.regionCode,
        store_location_name: geography.location,
        metadata: {
          adapter: 'store:coopclub-v1',
          leaflet_title: title,
          detail_url: detail.url,
          discovered_at: checkedAt,
          auto_publish_requested: source.auto_publish === true,
        },
      }).select('id').single();
      if (createError) throw createError;

      await queueProcessor(created.id);
      queued++;
      discovered.push({ title, pdf_url: pdfUrl, queued: true, region: geography.location });
    }

    await db.from('leaflet_sources').update({
      source_url: COOP_LISTING_URL,
      source_type: 'html',
      is_active: true,
      last_checked_at: checkedAt,
      last_success_at: checkedAt,
      last_error: null,
    }).eq('id', source.id);

    return { ok: true, adapter: 'store:coopclub-v1', found: discovered.length, queued, discovered };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from('leaflet_sources').update({ last_checked_at: checkedAt, last_error: message.slice(0, 2000) }).eq('id', source.id);
    throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok');
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'content-type': 'application/json' } });
  }
  if (!CRON_SECRET) {
    console.error('discover-coop: CRON_SECRET is not configured');
    return new Response(JSON.stringify({ error: 'Automatizace není nakonfigurovaná.' }), { status: 503, headers: { 'content-type': 'application/json' } });
  }
  if (request.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Neplatné oprávnění.' }), { status: 401, headers: { 'content-type': 'application/json' } });
  }
  try {
    return new Response(JSON.stringify(await run()), { headers: { 'content-type': 'application/json; charset=utf-8' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
});
