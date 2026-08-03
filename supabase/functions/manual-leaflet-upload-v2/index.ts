import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BUCKET = 'leaflets';
const MAX_BYTES = 8 * 1024 * 1024;
const SIGNED_URL_SECONDS = 4 * 60 * 60;
const PROCESS_START_TIMEOUT_MS = 20_000;
const IN_PROGRESS_STATUSES = new Set(['queued', 'downloading', 'processing', 'publishing']);
const COMPLETED_STATUSES = new Set(['review', 'published']);
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, x-client-info, content-type',
};
const JSON_HEADERS = { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' };
const BUCKET_OPTIONS = {
  public: false,
  fileSizeLimit: 120 * 1024 * 1024,
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'Neznámá chyba.');
}

function validUuid(value: unknown, label: string): string {
  const id = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error(`${label} není platné UUID.`);
  }
  return id;
}

function safeFilename(value: string): string {
  const withoutExtension = String(value || 'letak').replace(/\.[^.]+$/, '');
  const cleaned = withoutExtension
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 90);
  return cleaned || 'letak';
}

function detectType(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return { mime: 'application/pdf', extension: 'pdf' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (bytes.length >= 12
    && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
    && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') {
    return { mime: 'image/webp', extension: 'webp' };
  }
  if (bytes.length >= 6) {
    const magic = new TextDecoder().decode(bytes.slice(0, 6));
    if (magic === 'GIF87a' || magic === 'GIF89a') return { mime: 'image/gif', extension: 'gif' };
  }
  return null;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function ensureBucket(db: ReturnType<typeof createClient>): Promise<void> {
  const current = await db.storage.getBucket(BUCKET);
  if (current.error && !/not found|does not exist/i.test(current.error.message)) throw current.error;

  if (!current.data) {
    const created = await db.storage.createBucket(BUCKET, BUCKET_OPTIONS);
    if (created.error && !/already exists/i.test(created.error.message)) throw created.error;
    return;
  }

  const updated = await db.storage.updateBucket(BUCKET, BUCKET_OPTIONS);
  if (updated.error) throw updated.error;
}

async function authenticatedUser(request: Request, db: ReturnType<typeof createClient>) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('Přihlášení vypršelo.');
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new Error('Přihlášení vypršelo.');
  const role = String(data.user.app_metadata?.role || '').toLowerCase();
  if (!['admin', 'editor'].includes(role)) throw new Error('Nedostatečné oprávnění.');
  return { user: data.user, role };
}

async function processorRequest(importId: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/process-leaflet`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ import_id: importId }),
  });
  const text = await response.text().catch(() => '');
  let payload: Record<string, unknown> = {};
  if (text) {
    try { payload = JSON.parse(text); }
    catch { payload = { raw: text.slice(0, 500) }; }
  }
  if (!response.ok || payload.error) {
    throw new Error(`Procesor letáku se nepodařilo spustit: ${String(payload.error || `HTTP ${response.status}`)}`);
  }
  if (payload.accepted !== true && payload.skipped !== true && payload.ok !== true) {
    throw new Error('Procesor nevrátil potvrzení o přijetí importu.');
  }
  return payload;
}

async function confirmProcessorStarted(db: ReturnType<typeof createClient>, importId: string): Promise<string> {
  const deadline = Date.now() + PROCESS_START_TIMEOUT_MS;
  let lastStatus = 'queued';

  while (Date.now() < deadline) {
    const result = await db.from('leaflet_imports')
      .select('status,error_message,updated_at')
      .eq('id', importId)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error('Import po spuštění zmizel z databáze.');

    lastStatus = String(result.data.status || '');
    if (lastStatus === 'failed') {
      throw new Error(String(result.data.error_message || 'Procesor import okamžitě ukončil chybou.'));
    }
    if (lastStatus !== 'queued') return lastStatus;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  throw new Error(`Procesor nepotvrdil spuštění do ${Math.round(PROCESS_START_TIMEOUT_MS / 1000)} sekund; import zůstal ve stavu queued.`);
}

async function startAndConfirmProcessor(db: ReturnType<typeof createClient>, importId: string): Promise<string> {
  await processorRequest(importId);
  return await confirmProcessorStarted(db, importId);
}

async function processorHealth(): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/process-leaflet`, {
    method: 'OPTIONS',
    headers: { apikey: SERVICE_ROLE_KEY },
  });
  if (!response.ok) throw new Error(`Procesor letáků není dostupný: HTTP ${response.status}.`);
}

function statusAgeMs(updatedAt: unknown): number {
  const value = Date.parse(String(updatedAt || ''));
  return Number.isFinite(value) ? Math.max(0, Date.now() - value) : Number.POSITIVE_INFINITY;
}

function staleLimitMs(status: string): number {
  if (status === 'queued') return 45_000;
  if (status === 'downloading') return 5 * 60_000;
  if (status === 'processing') return 20 * 60_000;
  if (status === 'publishing') return 10 * 60_000;
  return 0;
}

function isFreshInProgress(row: any): boolean {
  const status = String(row?.status || '');
  return IN_PROGRESS_STATUSES.has(status) && statusAgeMs(row?.updated_at) < staleLimitMs(status);
}

async function findExisting(db: ReturnType<typeof createClient>, storeId: string, sourceHash: string, hash: string) {
  const direct = await db.from('leaflet_imports')
    .select('id,status,metadata,source_hash,updated_at')
    .eq('source_hash', sourceHash)
    .maybeSingle();
  if (direct.error) throw direct.error;
  if (direct.data) return direct.data;

  const legacy = await db.from('leaflet_imports')
    .select('id,status,metadata,source_hash,updated_at')
    .eq('store_id', storeId)
    .contains('metadata', { manual_upload: true, sha256: hash })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (legacy.error) throw legacy.error;
  return legacy.data || null;
}

async function signedUrl(db: ReturnType<typeof createClient>, path: string): Promise<string> {
  const result = await db.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (result.error || !result.data?.signedUrl) {
    throw result.error || new Error('Nepodařilo se vytvořit dočasný odkaz na soubor.');
  }
  return result.data.signedUrl;
}

async function retryImport(db: ReturnType<typeof createClient>, importId: string) {
  const result = await db.from('leaflet_imports')
    .select('id,status,metadata')
    .eq('id', importId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error('Import nebyl nalezen.');

  const metadata = result.data.metadata || {};
  const bucket = String(metadata.storage_bucket || '');
  const path = String(metadata.storage_path || '');
  if (bucket !== BUCKET || !path) throw new Error('Tento starý import nemá uložený soubor. Nahraj ho znovu z počítače.');

  const sourceUrl = await signedUrl(db, path);
  const updated = await db.from('leaflet_imports').update({
    source_document_url: sourceUrl,
    status: 'queued',
    error_message: null,
    started_at: null,
    finished_at: null,
    metadata: { ...metadata, retried_at: new Date().toISOString() },
  }).eq('id', importId).select('id').single();
  if (updated.error) throw updated.error;

  try {
    const status = await startAndConfirmProcessor(db, importId);
    return { ok: true, import_id: importId, accepted: true, status };
  } catch (error) {
    await db.from('leaflet_imports').update({
      status: 'failed',
      error_message: errorMessage(error).slice(0, 2000),
      finished_at: new Date().toISOString(),
    }).eq('id', importId);
    throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: 'Na serveru chybí Supabase secrets.' }, 500);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (request.method === 'GET' && new URL(request.url).searchParams.get('health') === '1') {
    try {
      await ensureBucket(db);
      await processorHealth();
      return json({ ok: true, upload: 'ready', processor: 'ready', bucket: BUCKET });
    } catch (error) {
      return json({ ok: false, error: errorMessage(error) }, 503);
    }
  }

  if (request.method !== 'POST') return json({ ok: false, error: 'Metoda není podporována.' }, 405);

  let uploadedPath = '';
  try {
    const { user } = await authenticatedUser(request, db);
    const contentType = request.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({}));
      if (body?.action !== 'retry') throw new Error('Neplatná akce.');
      const importId = validUuid(body.import_id, 'Import');
      return json(await retryImport(db, importId), 202);
    }

    if (!contentType.includes('multipart/form-data')) throw new Error('Očekává se soubor ve formuláři.');
    const form = await request.formData();
    if (String(form.get('action') || 'upload') !== 'upload') throw new Error('Neplatná akce.');
    const storeId = validUuid(form.get('store_id'), 'Obchod');
    const autoPublish = String(form.get('auto_publish') || 'false') === 'true';
    const candidate = form.get('file');
    if (!(candidate instanceof File)) throw new Error('Vyber soubor letáku.');
    if (!candidate.size) throw new Error('Soubor je prázdný.');
    if (candidate.size > MAX_BYTES) throw new Error('Jeden soubor může mít nejvýše 8 MB.');

    const bytes = new Uint8Array(await candidate.arrayBuffer());
    const detected = detectType(bytes);
    if (!detected) throw new Error('Soubor není platný PDF, JPG, PNG, WebP nebo GIF.');
    const suppliedHash = String(form.get('sha256') || '').trim().toLowerCase();
    const computedHash = await sha256(bytes);
    if (suppliedHash && suppliedHash !== computedHash) throw new Error('Kontrolní otisk souboru nesouhlasí. Nahraj soubor znovu.');
    const hash = computedHash;
    const sourceHash = `manual-upload-v2:${storeId}:${hash}`;

    const storeResult = await db.from('stores').select('id,name,slug,is_active').eq('id', storeId).maybeSingle();
    if (storeResult.error) throw storeResult.error;
    if (!storeResult.data || storeResult.data.is_active === false) throw new Error('Vybraný obchod nebyl nalezen nebo není aktivní.');

    const existing = await findExisting(db, storeId, sourceHash, hash);
    const existingStatus = String(existing?.status || '');
    if (existing && (COMPLETED_STATUSES.has(existingStatus) || isFreshInProgress(existing))) {
      return json({
        ok: true,
        duplicate: true,
        import_id: existing.id,
        status: existingStatus,
        message: existingStatus === 'published'
          ? 'Stejný leták už byl zpracován a publikován.'
          : existingStatus === 'review'
            ? 'Stejný leták už je připravený ke kontrole.'
            : 'Stejný leták se právě zpracovává.',
      });
    }

    await ensureBucket(db);
    const now = new Date();
    uploadedPath = `manual/${storeId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}-${safeFilename(candidate.name)}.${detected.extension}`;
    const upload = await db.storage.from(BUCKET).upload(uploadedPath, bytes, {
      contentType: detected.mime,
      cacheControl: '3600',
      upsert: false,
    });
    if (upload.error) throw upload.error;

    const sourceUrl = await signedUrl(db, uploadedPath);
    const previousBucket = String(existing?.metadata?.storage_bucket || '');
    const previousPath = String(existing?.metadata?.storage_path || '');
    const metadata = {
      ...(existing?.metadata || {}),
      manual_upload: true,
      upload_transport: 'edge-multipart-storage-v2',
      original_filename: candidate.name,
      content_type: detected.mime,
      file_size: candidate.size,
      sha256: hash,
      auto_publish: autoPublish,
      storage_bucket: BUCKET,
      storage_path: uploadedPath,
      uploaded_by: user.id,
      uploaded_by_email: user.email || null,
      uploaded_at: now.toISOString(),
    };

    let importId = '';
    if (existing) {
      const updated = await db.from('leaflet_imports').update({
        source_id: null,
        store_id: storeId,
        source_document_url: sourceUrl,
        source_hash: sourceHash,
        status: 'queued',
        error_message: null,
        started_at: null,
        finished_at: null,
        metadata,
      }).eq('id', existing.id).select('id').single();
      if (updated.error) throw updated.error;
      importId = updated.data.id;
    } else {
      const created = await db.from('leaflet_imports').insert({
        source_id: null,
        store_id: storeId,
        source_document_url: sourceUrl,
        source_hash: sourceHash,
        status: 'queued',
        metadata,
      }).select('id').single();
      if (created.error || !created.data?.id) throw created.error || new Error('Import se nepodařilo založit.');
      importId = created.data.id;
    }

    try {
      const status = await startAndConfirmProcessor(db, importId);
      if (previousBucket === BUCKET && previousPath && previousPath !== uploadedPath) {
        await db.storage.from(BUCKET).remove([previousPath]).catch(() => {});
      }
      uploadedPath = '';
      return json({
        ok: true,
        accepted: true,
        duplicate: false,
        import_id: importId,
        status,
        store: storeResult.data,
      }, 202);
    } catch (processorError) {
      await db.from('leaflet_imports').update({
        status: 'failed',
        error_message: errorMessage(processorError).slice(0, 2000),
        finished_at: new Date().toISOString(),
      }).eq('id', importId);
      throw processorError;
    }
  } catch (error) {
    if (uploadedPath) await db.storage.from(BUCKET).remove([uploadedPath]).catch(() => {});
    console.error('manual-leaflet-upload-v2 failed:', errorMessage(error));
    return json({ ok: false, error: errorMessage(error) }, 400);
  }
});
