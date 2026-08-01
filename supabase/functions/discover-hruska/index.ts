import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const PROCESSOR_URL = Deno.env.get('LEAFLET_PROCESSOR_URL') || `${SUPABASE_URL}/functions/v1/process-leaflet`;
const HRUSKA_URL = 'https://mojehruska.cz/';

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

async function fetchHtml(url: string): Promise<{ html: string; url: string; etag: string; lastModified: string }> {
  const response = await fetch(url, {
    headers: { ...HEADERS, referer: new URL(url).origin + '/' },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`Hruška HTTP ${response.status}`);
  return {
    html: await response.text(),
    url: response.url,
    etag: response.headers.get('etag') || '',
    lastModified: response.headers.get('last-modified') || '',
  };
}

function findCurrentPdf(html: string, baseUrl: string): string | null {
  const candidates: string[] = [];
  const patterns = [
    /<a[^>]+href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>[\s\S]*?(?:Otevřít v PDF|leták|letak)[\s\S]*?<\/a>/gi,
    /(?:href|data-href|data-url)=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi,
    /https?:\/\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
      const url = absoluteUrl(baseUrl, match[1] || match[0]);
      if (url && /mojehruska\.cz/i.test(url)) candidates.push(url);
    }
  }
  const unique = [...new Set(candidates)];
  return unique.find((url) => /wp-content\/uploads\/\d{4}\/\d{2}\//i.test(url)) || unique[0] || null;
}

function validityFromPage(html: string): { validFrom: string | null; validTo: string | null; label: string | null } {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const match = text.match(/Aktuální leták\s*(\d{1,2})\.(\d{1,2})\.\s*[–-]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/i);
  if (!match) return { validFrom: null, validTo: null, label: null };
  const [, d1, m1, d2, m2, year] = match;
  const fromYear = Number(m1) > Number(m2) ? Number(year) - 1 : Number(year);
  const pad = (v: string | number) => String(v).padStart(2, '0');
  return {
    validFrom: `${fromYear}-${pad(m1)}-${pad(d1)}`,
    validTo: `${year}-${pad(m2)}-${pad(d2)}`,
    label: `${d1}.${m1}.–${d2}.${m2}.${year}`,
  };
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
    .eq('stores.slug', 'hruska')
    .maybeSingle();
  if (sourceError) throw sourceError;
  if (!source) throw new Error('Zdroj Hruška není v leaflet_sources.');

  try {
    const page = await fetchHtml(HRUSKA_URL);
    const pdfUrl = findCurrentPdf(page.html, page.url);
    if (!pdfUrl) throw new Error('Hruška stránka neobsahuje aktuální PDF leták.');

    const validity = validityFromPage(page.html);
    const sourceHash = await sha256(`${source.id}|${pdfUrl}|${page.etag}|${page.lastModified}|hruska-v1`);
    const { data: existing, error: existingError } = await db.from('leaflet_imports')
      .select('id,status')
      .eq('source_hash', sourceHash)
      .maybeSingle();
    if (existingError) throw existingError;

    if (!existing) {
      const { data: created, error: createError } = await db.from('leaflet_imports').insert({
        source_id: source.id,
        store_id: source.store_id,
        source_document_url: pdfUrl,
        source_hash: sourceHash,
        status: 'queued',
        detected_valid_from: validity.validFrom,
        detected_valid_to: validity.validTo,
        coverage_scope: 'national',
        metadata: {
          adapter: 'store:hruska-v1',
          source_page: page.url,
          validity_label: validity.label,
          source_etag: page.etag || null,
          source_last_modified: page.lastModified || null,
          discovered_at: checkedAt,
          auto_publish_requested: source.auto_publish === true,
        },
      }).select('id').single();
      if (createError) throw createError;
      await queueProcessor(created.id);
    }

    await db.from('leaflet_sources').update({
      source_url: HRUSKA_URL,
      source_type: 'html',
      is_active: true,
      last_checked_at: checkedAt,
      last_success_at: checkedAt,
      last_error: null,
    }).eq('id', source.id);

    return {
      ok: true,
      adapter: 'store:hruska-v1',
      pdf_url: pdfUrl,
      validity,
      queued: existing ? 0 : 1,
      duplicate: Boolean(existing),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from('leaflet_sources').update({
      last_checked_at: checkedAt,
      last_error: message.slice(0, 2000),
    }).eq('id', source.id);
    throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok');
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'content-type': 'application/json' } });
  }
  if (!CRON_SECRET) {
    console.error('discover-hruska: CRON_SECRET is not configured');
    return new Response(JSON.stringify({ error: 'Automatizace není nakonfigurovaná.' }), { status: 503, headers: { 'content-type': 'application/json' } });
  }
  if (request.headers.get('x-cron-secret') !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: 'Neplatné oprávnění.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }
  try {
    return new Response(JSON.stringify(await run()), {
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
});
