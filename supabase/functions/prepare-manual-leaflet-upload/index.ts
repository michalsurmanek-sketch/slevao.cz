import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BUCKET = Deno.env.get('MANUAL_LEAFLET_BUCKET') || 'manual-leaflets';
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

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

function text(value: unknown, max = 1000): string {
  return String(value || '').trim().slice(0, max);
}

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

async function ensureBucket() {
  const current = await db.storage.getBucket(BUCKET);
  if (!current.error && current.data) return;

  const created = await db.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_FILE_SIZE,
    allowedMimeTypes: ALLOWED_MIME_TYPES,
  });

  if (created.error && !/already exists|duplicate/i.test(created.error.message || '')) {
    throw created.error;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    await requireStaff(request);
    const body = await request.json().catch(() => ({}));
    const storeId = text(body.store_id, 50);
    const storagePath = text(body.storage_path, 1000).replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
    const contentType = text(body.content_type, 100) || 'application/octet-stream';
    const fileSize = Number(body.file_size || 0);

    if (!validUuid(storeId)) throw new Error('Vyber platný obchod.');
    if (!storagePath || !storagePath.startsWith(`${storeId}/`)) {
      throw new Error('Soubor není uložený ve správné složce obchodu.');
    }
    if (!Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_SIZE) {
      throw new Error('Soubor musí mít velikost od 1 B do 50 MB.');
    }
    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
      throw new Error('Tento typ souboru není podporovaný.');
    }

    const { data: store, error: storeError } = await db.from('stores')
      .select('id,is_active')
      .eq('id', storeId)
      .single();
    if (storeError || !store?.is_active) throw new Error('Vybraný obchod neexistuje nebo je skrytý.');

    await ensureBucket();

    const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(storagePath, {
      upsert: false,
    });
    if (error || !data?.token) throw error || new Error('Nepodařilo se připravit bezpečné nahrání souboru.');

    return json({
      ok: true,
      bucket: BUCKET,
      path: data.path || storagePath,
      token: data.token,
      expires_in_seconds: 7200,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('prepare-manual-leaflet-upload failed:', message);
    const status = /oprávnění|Přihlášení/i.test(message) ? 401 : 400;
    return json({ error: message }, status);
  }
});
