import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const BUCKET = 'leaflets';
const MAX_BYTES = 8 * 1024 * 1024;
const ACTIVE_STATUSES = new Set(['queued', 'downloading', 'processing', 'review', 'publishing', 'published']);
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, x-client-info, content-type',
};
const JSON_HEADERS = { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' };

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
  const cleaned = String(value || 'letak')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 100);
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
  const { data, error } = await db.storage.getBucket(BUCKET);
  if (error && !/not found|does not exist/i.test(error.message)) throw error;
  if (data) return;
  const created = await db.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: 120 * 1024 * 1024,
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  });
  if (created.error && !/already exists/i.test(created.error.message)) throw created.error;
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

async function startProcessor(importId: string): Promise<void> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/process-leaflet`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ import_id: importId }),
  });
  if (!response.ok) {
    const payload = await response.text().catch(() => '');
    throw new Error(`Procesor letáku se nepodařilo spustit: HTTP ${response.status}${payload ? ` – ${payload.slice(0, 500)}` : ''}`);
  }
}

async function findExisting(db: ReturnType<typeof createClient>, storeId: string, sourceHash: string, hash: string) {
  const direct = await db.from('leaflet_imports')
    .select('id,status,metadata,source_hash')
    .eq('source_hash', sourceHash)
    .maybeSingle();
  if (direct.error) throw direct.error;
  if (direct.data) return direct.data;

  const legacy = await db.from('leaflet_imports')
    .select('id,status,metadata,source_hash')
    .eq('store_id', storeId)
    .contains('metadata', { manual_upload: true, sha256: hash })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (legacy.error) throw legacy.error;
  return legacy.data || null;
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

  const signed = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error('Nepodařilo se vytvořit dočasný odkaz na soubor.');

  const updated = await db.from('leaflet_imports').update({
    source_document_url: signed.data.signedUrl,
    status: 'queued',
    error_message: null,
    started_at: null,
    finished_at: null,
    metadata: { ...metadata, retried_at: new Date().toISOString() },
  }).eq('id', importId).select('id').single();
  if (updated.error) throw updated.error;
  await startProcessor(importId);
  return { ok: true, import_id: importId, accepted: true };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ ok: false, error: 'Metoda není podporována.' }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: 'Na serveru chybí Supabase secrets.' }, 500);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

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
    const action = String(form.get('action') || 'upload');
    if (action !== 'upload') throw new Error('Neplatná akce.');
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
    const hash = /^[0-9a-f]{64}$/.test(suppliedHash) ? suppliedHash : await sha256(bytes);
    const sourceHash = `manual-upload-v2:${storeId}:${hash}`;

    const storeResult = await db.from('stores').select('id,name,slug,is_active').eq('id', storeId).maybeSingle();
    if (storeResult.error) throw storeResult.error;
    if (!storeResult.data || storeResult.data.is_active === false) throw new Error('Vybraný obchod nebyl nalezen nebo není aktivní.');

    const existing = await findExisting(db, storeId, sourceHash, hash);
    if (existing && ACTIVE_STATUSES.has(String(existing.status))) {
      return json({
        ok: true,
        duplicate: true,
        import_id: existing.id,
        status: existing.status,
        message: existing.status === 'published'
          ? 'Stejný leták už byl zpracován a publikován.'
          : 'Stejný leták už je v systému.',
      });
    }

    await ensureBucket(db);
    const now = new Date();
    const path = `manual/${storeId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}-${safeFilename(candidate.name)}.${detected.extension}`;
    const upload = await db.storage.from(BUCKET).upload(path, bytes, {
      contentType: detected.mime,
      cacheControl: '3600',
      upsert: false,
    });
    if (upload.error) throw upload.error;

    const signed = await db.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (signed.error || !signed.data?.signedUrl) {
      await db.storage.from(BUCKET).remove([path]).catch(() => {});
      throw signed.error || new Error('Nepodařilo se vytvořit dočasný odkaz na soubor.');
    }

    const metadata = {
      ...(existing?.metadata || {}),
      manual_upload: true,
      upload_transport: 'edge-multipart-storage',
      original_filename: candidate.name,
      content_type: detected.mime,
      file_size: candidate.size,
      sha256: hash,
      auto_publish: autoPublish,
      storage_bucket: BUCKET,
      storage_path: path,
      uploaded_by: user.id,
      uploaded_by_email: user.email || null,
      uploaded_at: now.toISOString(),
    };

    let importId = '';
    if (existing) {
      const updated = await db.from('leaflet_imports').update({
        source_id: null,
        store_id: storeId,
        source_document_url: signed.data.signedUrl,
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
        source_document_url: signed.data.signedUrl,
        source_hash: sourceHash,
        status: 'queued',
        metadata,
      }).select('id').single();
      if (created.error || !created.data?.id) throw created.error || new Error('Import se nepodařilo založit.');
      importId = created.data.id;
    }

    try {
      await startProcessor(importId);
    } catch (processorError) {
      await db.from('leaflet_imports').update({
        status: 'failed',
        error_message: errorMessage(processorError).slice(0, 2000),
        finished_at: new Date().toISOString(),
      }).eq('id', importId);
      throw processorError;
    }

    return json({
      ok: true,
      accepted: true,
      duplicate: false,
      import_id: importId,
      status: 'queued',
      store: storeResult.data,
    }, 202);
  } catch (error) {
    console.error('manual-leaflet-upload-v2 failed:', errorMessage(error));
    return json({ ok: false, error: errorMessage(error) }, 400);
  }
});
