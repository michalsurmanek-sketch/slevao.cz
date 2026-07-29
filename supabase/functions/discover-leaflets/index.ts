import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const PROCESSOR_URL = Deno.env.get('LEAFLET_PROCESSOR_URL') || `${SUPABASE_URL}/functions/v1/process-leaflet`;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function absoluteUrl(base: string, href: string): string | null {
  try { return new URL(href, base).toString(); } catch { return null; }
}

const LEAFLET_HINTS = [
  'letak', 'leták', 'leaflet', 'catalog', 'katalog', 'akcni', 'akční',
  'offers', 'nabidk', 'prospekt', 'brochure', 'flipbook', 'weekly',
];

const REJECT_HINTS = [
  'favicon', 'apple-touch-icon', 'logo', 'sprite', 'placeholder', 'avatar',
  'tracking', 'pixel', 'analytics', 'icon-', '/icon/', '/icons/', 'manifest',
  'social', 'facebook', 'instagram', 'youtube', 'linkedin', 'twitter',
];

function normalizedUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

function isLeafletCandidate(url: string): boolean {
  const lower = decodeURIComponent(url).toLocaleLowerCase('cs');
  if (REJECT_HINTS.some((hint) => lower.includes(hint))) return false;
  if (/\.(pdf)(?:\?|$)/i.test(lower)) return true;

  const isImage = /\.(jpg|jpeg|png|webp)(?:\?|$)/i.test(lower);
  if (!isImage) return false;

  // Obrázky jsou přijaty jen tehdy, pokud URL výslovně vypadá jako stránka letáku.
  // Tím se vyloučí favicony, loga a běžná grafika webu.
  return LEAFLET_HINTS.some((hint) => lower.includes(hint));
}

function extractDocumentCandidates(text: string, baseUrl: string): string[] {
  const urls = new Set<string>();
  const patterns = [
    /href=["']([^"']+\.(?:pdf|jpg|jpeg|png|webp)(?:\?[^"']*)?)["']/gi,
    /(?:pdfUrl|pdf_url|downloadUrl|download_url|documentUrl|document_url|leafletUrl|leaflet_url|catalogUrl|catalog_url|imageUrl|image_url)["']?\s*[:=]\s*["']([^"']+)["']/gi,
    /https?:\/\/[^\s"'<>]+\.(?:pdf|jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const candidate = match[1] || match[0];
      const absolute = absoluteUrl(baseUrl, candidate.replace(/\\u0026/g, '&').replace(/\\\//g, '/'));
      if (!absolute) continue;
      const url = normalizedUrl(absolute);
      if (isLeafletCandidate(url)) urls.add(url);
    }
  }
  return [...urls];
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isDue(source: any, now = Date.now()): boolean {
  if (!source.last_checked_at) return true;
  const interval = Math.max(15, Number(source.check_interval_minutes || 360));
  return new Date(source.last_checked_at).getTime() + interval * 60_000 <= now;
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
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Processor HTTP ${response.status}: ${detail.slice(0, 500)}`);
  }
}

async function discoverSource(source: any) {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(source.source_url, {
      headers: {
        'user-agent': 'SlevaoBot/1.0 (+https://slevao.cz)',
        accept: 'text/html,application/pdf,application/json,image/*;q=0.9,*/*;q=0.8',
      },
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const contentType = response.headers.get('content-type') || '';
    const etag = response.headers.get('etag') || '';
    const lastModified = response.headers.get('last-modified') || '';
    let documents: string[] = [];

    if (source.source_type === 'pdf' || contentType.includes('application/pdf') || /\.pdf(?:\?|$)/i.test(response.url)) {
      documents = [normalizedUrl(response.url)];
    } else if (contentType.startsWith('image/') || /\.(jpg|jpeg|png|webp)(?:\?|$)/i.test(response.url)) {
      documents = isLeafletCandidate(response.url) ? [normalizedUrl(response.url)] : [];
    } else if (source.source_type === 'json' || contentType.includes('application/json')) {
      documents = extractDocumentCandidates(JSON.stringify(await response.json()), response.url);
    } else {
      documents = extractDocumentCandidates(await response.text(), response.url);
    }

    documents = [...new Set(documents)].slice(0, 12);
    if (!documents.length) {
      throw new Error('Na stránce nebyl nalezen důvěryhodný PDF nebo obrázkový leták. Ikony, loga a běžná grafika byly ignorovány.');
    }

    let created = 0;
    for (const documentUrl of documents) {
      const sourceHash = await sha256(`${source.id}|${documentUrl}|${etag}|${lastModified}`);
      const { data, error } = await db.from('leaflet_imports').upsert({
        source_id: source.id,
        store_id: source.store_id,
        source_document_url: documentUrl,
        source_hash: sourceHash,
        status: 'queued',
        coverage_scope: source.coverage_scope || 'national',
        region_code: source.region_code || null,
        city_name: source.city_name || null,
        store_location_name: source.store_location_name || null,
        metadata: {
          discovered_at: checkedAt,
          source_name: source.name,
          source_etag: etag || null,
          source_last_modified: lastModified || null,
          candidate_filter: 'leaflet-v2',
        },
      }, { onConflict: 'source_hash', ignoreDuplicates: true }).select('id,status').maybeSingle();

      if (error) throw error;
      if (data?.id) {
        created++;
        await queueProcessor(data.id);
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
    await db.from('leaflet_sources').update({
      last_checked_at: checkedAt,
      last_error: message.slice(0, 2000),
    }).eq('id', source.id);
    return { source: source.name, error: message };
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok');
  if (CRON_SECRET && request.headers.get('x-cron-secret') !== CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: sources, error } = await db.from('leaflet_sources').select('*').eq('is_active', true).limit(100);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const dueSources = (sources || []).filter((source: any) => isDue(source));
  const results = [];
  for (const source of dueSources) results.push(await discoverSource(source));
  return Response.json({ ok: true, active: sources?.length || 0, checked: results.length, results });
});