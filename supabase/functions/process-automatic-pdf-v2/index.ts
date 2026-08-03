import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1?target=deno';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const BUCKET = 'leaflets';
const PAGE_PROCESSOR = 'process-manual-leaflet-v2';
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PAGES = 160;
const SIGNED_URL_SECONDS = 6 * 60 * 60;
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, x-client-info, content-type, x-cron-secret',
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Neznámá chyba.');
}

function runInBackground(task: Promise<unknown>) {
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(task);
  else task.catch((error) => console.error('Background task failed:', error));
}

async function authorize(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  if (authorization === `Bearer ${SERVICE_ROLE_KEY}`) return;
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return;
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('Unauthorized');
  const { data, error } = await db.auth.getUser(token);
  const role = String(data.user?.app_metadata?.role || '').toLowerCase();
  if (error || !data.user || !['admin', 'editor'].includes(role)) throw new Error('Unauthorized');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sourceFilename(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) || 'letak.pdf');
  } catch {
    return 'letak.pdf';
  }
}

function safeBaseName(filename: string): string {
  return filename.replace(/\.pdf$/i, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'letak';
}

function dateRangeFromFilename(filename: string): { from: string | null; to: string | null } {
  const match = filename.match(/([0-3]\d)[-_.]([01]\d)[-_.](20\d{2})[-_.]([0-3]\d)[-_.]([01]\d)[-_.](20\d{2})/);
  if (!match) return { from: null, to: null };
  const from = `${match[3]}-${match[2]}-${match[1]}`;
  const to = `${match[6]}-${match[5]}-${match[4]}`;
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
  return valid ? { from, to } : { from: null, to: null };
}

async function ensureBucket() {
  const result = await db.storage.getBucket(BUCKET);
  if (result.data) return;
  if (result.error && !/not found|does not exist/i.test(result.error.message)) throw result.error;
  const created = await db.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 50 * 1024 * 1024,
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  });
  if (created.error && !/already exists/i.test(created.error.message)) throw created.error;
}

async function signedUrl(path: string): Promise<string> {
  const result = await db.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (result.error || !result.data?.signedUrl) throw result.error || new Error('Nepodařilo se vytvořit dočasný odkaz na stránku.');
  return result.data.signedUrl;
}

async function invokePageProcessor(importId: string) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${PAGE_PROCESSOR}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ import_id: importId }),
  });
  if (!response.ok) {
    throw new Error(`Procesor stránky HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 500)}`);
  }
}

async function splitAndQueue(parentId: string) {
  try {
    const result = await db.from('leaflet_imports')
      .select('*,leaflet_sources(auto_publish,name),stores(name,slug)')
      .eq('id', parentId)
      .single();
    if (result.error || !result.data) throw result.error || new Error('Automatický import nebyl nalezen.');
    const job: any = result.data;
    const routedByDatabase = Boolean(job.metadata?.automatic_processor_required);
    if (String(job.status) === 'published' || (String(job.status) === 'ignored' && !routedByDatabase)) return;
    if (!/^https:\/\//i.test(String(job.source_document_url || ''))) throw new Error('Zdroj nemá platnou HTTPS adresu PDF.');

    await db.from('leaflet_imports').update({
      status: 'downloading',
      started_at: new Date().toISOString(),
      error_message: null,
    }).eq('id', parentId);

    const response = await fetch(job.source_document_url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
        accept: 'application/pdf,*/*;q=0.8',
        'accept-language': 'cs-CZ,cs;q=0.9',
        referer: new URL(job.source_document_url).origin + '/',
      },
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`Stažení oficiálního PDF selhalo: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) throw new Error('Oficiální PDF je prázdné.');
    if (bytes.length > MAX_PDF_BYTES) throw new Error(`Oficiální PDF má více než ${MAX_PDF_BYTES / 1024 / 1024} MB.`);
    if (!(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)) {
      throw new Error('Oficiální adresa nevrátila platný PDF soubor.');
    }

    await db.from('leaflet_imports').update({ status: 'processing' }).eq('id', parentId);
    await ensureBucket();
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const pageCount = pdf.getPageCount();
    if (!pageCount || pageCount > MAX_PAGES) throw new Error(`PDF má nepodporovaný počet stran: ${pageCount}.`);

    const filename = sourceFilename(response.url || job.source_document_url);
    const baseName = safeBaseName(filename);
    const batchHash = await sha256(`${job.source_id || ''}|${response.url || job.source_document_url}|automatic-pdf-v2`);
    const dateRange = dateRangeFromFilename(filename);
    const validFrom = dateRange.from || job.detected_valid_from || null;
    const validTo = dateRange.to || job.detected_valid_to || null;
    const childIds: string[] = [];
    let reused = 0;

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
      const pageNumber = pageIndex + 1;
      const childHash = `automatic-pdf-v2:${batchHash}:${pageNumber}`;
      const existing = await db.from('leaflet_imports')
        .select('id,status')
        .eq('source_hash', childHash)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data && ['queued', 'downloading', 'processing', 'review', 'publishing', 'published'].includes(String(existing.data.status))) {
        childIds.push(existing.data.id);
        reused++;
        continue;
      }

      const pagePdf = await PDFDocument.create();
      const [page] = await pagePdf.copyPages(pdf, [pageIndex]);
      pagePdf.addPage(page);
      const pageBytes = await pagePdf.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 50 });
      const padded = String(pageNumber).padStart(String(pageCount).length, '0');
      const path = `automatic/${job.store_id}/${batchHash.slice(0, 24)}/page-${padded}-of-${pageCount}.pdf`;
      const upload = await db.storage.from(BUCKET).upload(path, pageBytes, {
        contentType: 'application/pdf',
        cacheControl: '3600',
        upsert: true,
      });
      if (upload.error) throw upload.error;
      const url = await signedUrl(path);
      const pageFilename = `${baseName}__page-${padded}-of-${pageCount}__batch-${batchHash.slice(0, 36)}.pdf`;
      const payload = {
        source_id: job.source_id,
        store_id: job.store_id,
        source_document_url: url,
        source_hash: childHash,
        status: 'queued',
        detected_valid_from: validFrom,
        detected_valid_to: validTo,
        page_count: 1,
        coverage_scope: job.coverage_scope || 'national',
        region_code: job.region_code || null,
        city_name: job.city_name || null,
        store_location_name: job.store_location_name || null,
        error_message: null,
        metadata: {
          automatic_pdf_split: true,
          automatic_source: true,
          source_parent_import_id: parentId,
          source_original_url: response.url || job.source_document_url,
          source_name: job.leaflet_sources?.name || null,
          source_auto_publish: Boolean(job.leaflet_sources?.auto_publish),
          auto_publish: false,
          page_batch_id: batchHash,
          page_number: pageNumber,
          page_total: pageCount,
          batch_valid_from: validFrom,
          batch_valid_to: validTo,
          original_filename: pageFilename,
          file_size: pageBytes.length,
          content_type: 'application/pdf',
          storage_bucket: BUCKET,
          storage_path: path,
          upload_transport: 'automatic-pdf-split-v2',
          created_from_official_source: true,
        },
      };

      let childId = existing.data?.id || '';
      if (childId) {
        const updated = await db.from('leaflet_imports').update(payload).eq('id', childId).select('id').single();
        if (updated.error) throw updated.error;
      } else {
        const inserted = await db.from('leaflet_imports').insert(payload).select('id').single();
        if (inserted.error || !inserted.data?.id) throw inserted.error || new Error('Nepodařilo se založit stránku letáku.');
        childId = inserted.data.id;
      }
      childIds.push(childId);
      await invokePageProcessor(childId);
    }

    await db.from('leaflet_imports').update({
      status: 'ignored',
      error_message: null,
      page_count: pageCount,
      finished_at: new Date().toISOString(),
      metadata: {
        ...(job.metadata || {}),
        automatic_processor_required: false,
        automatic_pdf_split: true,
        split_processor: 'process-automatic-pdf-v2',
        page_batch_id: batchHash,
        page_total: pageCount,
        child_import_ids: childIds,
        reused_pages: reused,
        source_filename: filename,
        source_bytes: bytes.length,
        batch_valid_from: validFrom,
        batch_valid_to: validTo,
      },
    }).eq('id', parentId);
  } catch (error) {
    const message = errorMessage(error);
    console.error('Automatic PDF processing failed', parentId, message);
    await db.from('leaflet_imports').update({
      status: 'failed',
      error_message: message.slice(0, 2000),
      finished_at: new Date().toISOString(),
    }).eq('id', parentId);
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ error: 'Na serveru chybí Supabase secrets.' }, 500);
  try {
    await authorize(request);
  } catch {
    return json({ error: 'Unauthorized' }, 401);
  }
  if (request.method !== 'POST') return json({ error: 'Metoda není podporována.' }, 405);
  const body = await request.json().catch(() => ({}));
  const importId = String(body.import_id || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(importId)) return json({ error: 'Missing import_id' }, 400);
  runInBackground(splitAndQueue(importId));
  return json({ ok: true, accepted: true, import_id: importId, processor: 'process-automatic-pdf-v2' }, 202);
});
