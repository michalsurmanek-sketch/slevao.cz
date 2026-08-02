import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
};
const JSON_HEADERS = { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DeleteRequest = {
  action?: 'preview' | 'delete';
  store_id?: string;
  confirmation?: string;
};

type ArchivedDocument = {
  bucket: string;
  path: string;
};

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function archivedDocuments(rows: Array<{ metadata?: Record<string, unknown> | null }>): ArchivedDocument[] {
  const unique = new Map<string, ArchivedDocument>();
  for (const row of rows) {
    const bucket = typeof row.metadata?.storage_bucket === 'string' ? row.metadata.storage_bucket.trim() : '';
    const path = typeof row.metadata?.storage_path === 'string' ? row.metadata.storage_path.trim() : '';
    if (!bucket || !path) continue;
    unique.set(`${bucket}\n${path}`, { bucket, path });
  }
  return [...unique.values()];
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ ok: false, error: 'Metoda není podporována.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, error: 'Chybí konfigurace Supabase.' }, 500);

    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ ok: false, error: 'Přihlášení vypršelo. Přihlas se znovu.' }, 401);

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userError } = await db.auth.getUser(token);
    if (userError || !userData.user) return json({ ok: false, error: 'Přihlášení se nepodařilo ověřit.' }, 401);
    if (userData.user.app_metadata?.role !== 'admin') {
      return json({ ok: false, error: 'Trvale mazat obchody může pouze administrátor.' }, 403);
    }

    let payload: DeleteRequest;
    try {
      payload = await request.json();
    } catch {
      return json({ ok: false, error: 'Požadavek nemá platná data.' }, 400);
    }

    const action = payload.action === 'delete' ? 'delete' : 'preview';
    const storeId = String(payload.store_id || '').trim();
    if (!UUID_PATTERN.test(storeId)) return json({ ok: false, error: 'Neplatný identifikátor obchodu.' }, 400);

    const { data: store, error: storeError } = await db.from('stores')
      .select('id,name,slug,is_active')
      .eq('id', storeId)
      .maybeSingle();
    if (storeError) return json({ ok: false, error: storeError.message }, 400);
    if (!store) return json({ ok: false, error: 'Obchod už neexistuje.' }, 404);

    const [offersResult, sourcesResult, importsResult] = await Promise.all([
      db.from('offers').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
      db.from('leaflet_sources').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
      db.from('leaflet_imports').select('id,metadata', { count: 'exact' }).eq('store_id', storeId),
    ]);
    const countError = offersResult.error || sourcesResult.error || importsResult.error;
    if (countError) return json({ ok: false, error: countError.message }, 400);

    const imports = importsResult.data || [];
    const documents = archivedDocuments(imports);
    const summary = {
      offers: offersResult.count || 0,
      leaflet_sources: sourcesResult.count || 0,
      leaflet_imports: importsResult.count || 0,
      archived_documents: documents.length,
    };

    if (action === 'preview') {
      return json({ ok: true, action, store, summary });
    }

    const confirmation = String(payload.confirmation || '').trim();
    if (!store.slug || confirmation !== store.slug) {
      return json({ ok: false, error: `Pro potvrzení napiš přesně slug „${store.slug || store.name}“.` }, 400);
    }

    // Mazání samotného obchodu proběhne v databázi atomicky. Navázané nabídky
    // a zdroje mají databázová pravidla ON DELETE; pokud by některá vazba
    // smazání blokovala, databáze celou operaci odmítne a nic částečně nesmaže.
    const { data: deletedStore, error: deleteError } = await db.from('stores')
      .delete()
      .eq('id', storeId)
      .select('id,name,slug')
      .maybeSingle();
    if (deleteError) {
      return json({
        ok: false,
        error: `Obchod se nepodařilo smazat. Nejdřív zkontroluj jeho navázaná data. ${deleteError.message}`,
      }, 409);
    }
    if (!deletedStore) return json({ ok: false, error: 'Obchod už neexistuje nebo nebyl smazán.' }, 404);

    const warnings: string[] = [];

    // leaflet_imports používají ON DELETE SET NULL, proto po úspěšném smazání
    // obchodu odstraníme předem zjištěné importy podle jejich ID. Jejich položky
    // se smažou kaskádově přes leaflet_import_items.import_id.
    const importIds = imports.map((item) => String(item.id || '')).filter(Boolean);
    for (let index = 0; index < importIds.length; index += 200) {
      const { error } = await db.from('leaflet_imports').delete().in('id', importIds.slice(index, index + 200));
      if (error) warnings.push(`Archiv importů: ${error.message}`);
    }

    const documentsByBucket = new Map<string, string[]>();
    for (const document of documents) {
      const paths = documentsByBucket.get(document.bucket) || [];
      paths.push(document.path);
      documentsByBucket.set(document.bucket, paths);
    }
    for (const [bucket, paths] of documentsByBucket) {
      for (let index = 0; index < paths.length; index += 100) {
        const { error } = await db.storage.from(bucket).remove(paths.slice(index, index + 100));
        if (error) warnings.push(`Úložiště ${bucket}: ${error.message}`);
      }
    }

    return json({
      ok: true,
      action,
      store: deletedStore,
      deleted: summary,
      warnings,
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'Smazání obchodu selhalo.' }, 500);
  }
});
