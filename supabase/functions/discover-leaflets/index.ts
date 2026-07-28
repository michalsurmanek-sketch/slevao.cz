import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PROCESSOR_URL = Deno.env.get('LEAFLET_PROCESSOR_URL') || `${SUPABASE_URL}/functions/v1/process-leaflet`;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function absoluteUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function extractPdfCandidates(html: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  const patterns = [
    /href=["']([^"']+\.pdf(?:\?[^"']*)?)["']/gi,
    /(?:pdfUrl|pdf_url|downloadUrl|download_url)["']?\s*[:=]\s*["']([^"']+)["']/gi,
    /https?:\/\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
      const candidate = match[1] || match[0];
      const url = absoluteUrl(baseUrl, candidate.replace(/\\u0026/g, '&').replace(/\\\//g, '/'));
      if (url) urls.add(url);
    }
  }
  return [...urls];
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function discoverSource(source: any) {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(source.source_url, {
      headers: {
        'user-agent': 'SlevaoBot/1.0 (+https://slevao.cz)',
        accept: 'text/html,application/pdf,application/json;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get('content-type') || '';
    let documents: string[] = [];

    if (source.source_type === 'pdf' || contentType.includes('application/pdf') || response.url.toLowerCase().includes('.pdf')) {
      documents = [response.url];
    } else if (source.source_type === 'json' || contentType.includes('application/json')) {
      const payload = await response.json();
      const text = JSON.stringify(payload);
      documents = extractPdfCandidates(text, response.url);
    } else {
      const html = await response.text();
      documents = extractPdfCandidates(html, response.url);
    }

    if (!documents.length) throw new Error('Na stránce nebyl nalezen žádný PDF leták.');

    let created = 0;
    for (const documentUrl of documents.slice(0, 10)) {
      const sourceHash = await sha256(`${source.id}|${documentUrl}`);
      const { data, error } = await db
        .from('leaflet_imports')
        .upsert({
          source_id: source.id,
          store_id: source.store_id,
          source_document_url: documentUrl,
          source_hash: sourceHash,
          status: 'queued',
          metadata: { discovered_at: checkedAt, source_name: source.name },
        }, { onConflict: 'source_hash', ignoreDuplicates: true })
        .select('id,status')
        .maybeSingle();

      if (error) throw error;
      if (data?.id) {
        created++;
        fetch(PROCESSOR_URL, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${SERVICE_ROLE_KEY}`,
            'x-cron-secret': CRON_SECRET,
          },
          body: JSON.stringify({ import_id: data.id }),
        }).catch(() => undefined);
      }
    }

    await db.from('leaflet_sources').update({
      last_checked_at: checkedAt,
      last_success_at: checkedAt,
      last_error: null,
    }).eq('id', source.id);

    return { source: source.name, found: documents.length, queued: created };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from('leaflet_sources').update({ last_checked_at: checkedAt, last_error: message }).eq('id', source.id);
    return { source: source.name, error: message };
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok');
  if (CRON_SECRET && request.headers.get('x-cron-secret') !== CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const dueBefore = new Date(Date.now() - 5 * 60_000).toISOString();
  const { data: sources, error } = await db
    .from('leaflet_sources')
    .select('*')
    .eq('is_active', true)
    .or(`last_checked_at.is.null,last_checked_at.lt.${dueBefore}`)
    .limit(50);

  if (error) return Response.json({ error: error.message }, { status: 500 });
  const results = [];
  for (const source of sources || []) results.push(await discoverSource(source));

  return Response.json({ ok: true, checked: results.length, results });
});