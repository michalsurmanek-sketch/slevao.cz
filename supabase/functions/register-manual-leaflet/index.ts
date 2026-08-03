import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = Deno.env.get('MANUAL_LEAFLET_BUCKET') || 'manual-leaflets';
const PROCESSOR_URL = Deno.env.get('LEAFLET_PROCESSOR_URL') || `${SUPABASE_URL}/functions/v1/process-leaflet`;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' },
  });
}

function safeString(value: unknown, max = 500): string {
  return String(value || '').trim().slice(0, max);
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validHash(value: string): boolean {
  return /^[0-9a-f]{64}$/i.test(value);
}

function splitStoragePath(path: string) {
  const normalized = path.replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
  const slash = normalized.lastIndexOf('/');
  return {
    normalized,
    prefix: slash >= 0 ? normalized.slice(0, slash) : '',
    filename: slash >= 0 ? normalized.slice(slash + 1) : normalized,
  };
}

async function requireStaff(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('Přihlášení chybí nebo vypršelo.');

  const { data, error } = await db.auth.getUser(token);
  const role = String(data.user?.app_metadata?.role || '').toLowerCase();
  if (error || !data.user || !['admin', 'editor'].includes(role)) {
    throw new Error('Účet nemá oprávnění nahrávat letáky.');
  }
  return data.user;
}

async function verifyObject(storeId: string, storagePath: string) {
  const { normalized, prefix, filename } = splitStoragePath(storagePath);
  if (!normalized.startsWith(`${storeId}/`) || !filename) {
    throw new Error('Soubor není uložený ve správné složce obchodu.');
  }

  const { data, error } = await db.storage.from(BUCKET).list(prefix, {
    limit: 100,
    search: filename,
  });
  if (error) throw error;
  const object = (data || []).find((item) => item.name === filename);
  if (!object) throw new Error('Nahraný soubor nebyl v úložišti nalezen.');
  return { normalized, object };
}

async function signedUrl(path: string): Promise<string> {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 7 * 24 * 60 * 60);
  if (error || !data?.signedUrl) throw error || new Error('Nepodařilo se vytvořit bezpečný odkaz na soubor.');
  return data.signedUrl;
}

async function ensureManualSource(store: { id: string; name: string }) {
  const sourceUrl = `manual-upload://${store.id}`;
  const sourceName = `${store.name} – ruční nahrávání`;
  const { data: existing, error: selectError } = await db.from('leaflet_sources')
    .select('id,name')
    .eq('source_url', sourceUrl)
    .maybeSingle();
  if (selectError) throw selectError;

  if (existing) {
    if (existing.name !== sourceName) {
      const { error: updateError } = await db.from('leaflet_sources').update({
        name: sourceName,
        store_id: store.id,
        is_active: false,
        auto_publish: false,
      }).eq('id', existing.id);
      if (updateError) throw updateError;
    }
    return existing.id;
  }

  const { data: created, error: createError } = await db.from('leaflet_sources').insert({
    store_id: store.id,
    name: sourceName,
    source_url: sourceUrl,
    source_type: 'pdf',
    is_active: false,
    auto_publish: false,
    check_interval_minutes: 525600,
  }).select('id').single();
  if (createError || !created) throw createError || new Error('Ruční zdroj letáků se nepodařilo vytvořit.');
  return created.id;
}

async function queueProcessor(importId: string) {
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
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Zpracování letáku se nepodařilo spustit: HTTP ${response.status}${text ? ` – ${text.slice(0, 300)}` : ''}`);
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  let importId = '';
  try {
    const user = await requireStaff(request);
    const body = await request.json().catch(() => ({}));
    const storeId = safeString(body.store_id, 50);
    const storagePath = safeString(body.storage_path, 1000);
    const originalFilename = safeString(body.original_filename, 300) || 'letak';
    const contentType = safeString(body.content_type, 100) || 'application/octet-stream';
    const fileSize = Number(body.file_size || 0);
    const sha256 = safeString(body.sha256, 64).toLowerCase();
    const autoPublish = Boolean(body.auto_publish);

    if (!validUuid(storeId)) throw new Error('Vyber platný obchod.');
    if (!storagePath) throw new Error('Chybí cesta nahraného souboru.');
    if (!validHash(sha256)) throw new Error('Soubor nemá platný kontrolní otisk.');
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > 50 * 1024 * 1024) {
      throw new Error('Soubor musí mít velikost od 1 B do 50 MB.');
    }

    const { data: store, error: storeError } = await db.from('stores')
      .select('id,name,slug,is_active')
      .eq('id', storeId)
      .single();
    if (storeError || !store || !store.is_active) throw new Error('Vybraný obchod neexistuje nebo je skrytý.');

    const verified = await verifyObject(storeId, storagePath);
    const documentUrl = await signedUrl(verified.normalized);
    const sourceHash = `manual:${storeId}:${sha256}`;
    const sourceId = await ensureManualSource(store);

    const { data: existing, error: existingError } = await db.from('leaflet_imports')
      .select('id,status,metadata')
      .eq('source_hash', sourceHash)
      .maybeSingle();
    if (existingError) throw existingError;

    const metadata = {
      ...(existing?.metadata || {}),
      manual_upload: true,
      storage_bucket: BUCKET,
      storage_path: verified.normalized,
      original_filename: originalFilename,
      content_type: contentType,
      file_size: fileSize,
      sha256,
      auto_publish: autoPublish,
      uploaded_by: user.id,
      uploaded_by_email: user.email || null,
      uploaded_at: new Date().toISOString(),
    };

    if (existing) {
      importId = existing.id;
      if (['published', 'review', 'processing', 'downloading', 'publishing', 'queued'].includes(existing.status)) {
        const oldPath = String(existing.metadata?.storage_path || '');
        if (verified.normalized !== oldPath) {
          const { error: removeError } = await db.storage.from(BUCKET).remove([verified.normalized]);
          if (removeError) console.warn('Duplicitní soubor se nepodařilo uklidit:', removeError.message);
        }
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

      const { error: retryError } = await db.from('leaflet_imports').update({
        source_id: sourceId,
        source_document_url: documentUrl,
        status: 'queued',
        error_message: null,
        started_at: null,
        finished_at: null,
        metadata,
      }).eq('id', existing.id);
      if (retryError) throw retryError;
    } else {
      const { data: created, error: createError } = await db.from('leaflet_imports').insert({
        source_id: sourceId,
        store_id: storeId,
        source_document_url: documentUrl,
        source_hash: sourceHash,
        status: 'queued',
        metadata,
      }).select('id').single();
      if (createError || !created) throw createError || new Error('Import se nepodařilo založit.');
      importId = created.id;
    }

    try {
      await queueProcessor(importId);
    } catch (processorError) {
      await db.from('leaflet_imports').update({
        status: 'failed',
        error_message: processorError instanceof Error ? processorError.message.slice(0, 2000) : String(processorError).slice(0, 2000),
        finished_at: new Date().toISOString(),
      }).eq('id', importId);
      throw processorError;
    }

    return json({
      ok: true,
      accepted: true,
      import_id: importId,
      store: store.name,
      status: 'queued',
      auto_publish: autoPublish,
    }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('register-manual-leaflet failed', importId, message);
    const status = /oprávnění|Přihlášení/i.test(message) ? 401 : 400;
    return json({ error: message, import_id: importId || null }, status);
  }
});
