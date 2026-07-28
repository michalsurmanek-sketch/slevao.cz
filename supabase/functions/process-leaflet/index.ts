import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const AI_EXTRACTOR_URL = Deno.env.get('AI_EXTRACTOR_URL') || '';
const AI_EXTRACTOR_KEY = Deno.env.get('AI_EXTRACTOR_KEY') || '';
const STORAGE_BUCKET = Deno.env.get('LEAFLET_BUCKET') || 'leaflets';

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type ExtractedItem = {
  title: string;
  brand?: string | null;
  quantity_text?: string | null;
  price?: number | null;
  old_price?: number | null;
  unit_price?: number | null;
  unit_label?: string | null;
  image_url?: string | null;
  source_page?: number | null;
  confidence?: number | null;
  category_name?: string | null;
  raw_data?: Record<string, unknown>;
};

async function fail(importId: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await db.from('leaflet_imports').update({
    status: 'failed',
    error_message: message,
    finished_at: new Date().toISOString(),
  }).eq('id', importId);
  return Response.json({ error: message }, { status: 500 });
}

async function ensureBucket() {
  const { data } = await db.storage.getBucket(STORAGE_BUCKET);
  if (!data) await db.storage.createBucket(STORAGE_BUCKET, { public: false, fileSizeLimit: 50 * 1024 * 1024 });
}

async function categoryMap() {
  const { data } = await db.from('categories').select('id,name');
  return new Map((data || []).map((row: any) => [String(row.name).toLocaleLowerCase('cs'), row.id]));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok');
  const authorization = request.headers.get('authorization') || '';
  const allowed = authorization === `Bearer ${SERVICE_ROLE_KEY}` || (!CRON_SECRET || request.headers.get('x-cron-secret') === CRON_SECRET);
  if (!allowed) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  let importId = '';
  try {
    const body = await request.json();
    importId = String(body.import_id || '');
    if (!importId) return Response.json({ error: 'Missing import_id' }, { status: 400 });

    const { data: job, error: jobError } = await db
      .from('leaflet_imports')
      .select('*,leaflet_sources(auto_publish,name)')
      .eq('id', importId)
      .single();
    if (jobError || !job) throw jobError || new Error('Import nebyl nalezen.');
    if (['processing', 'published', 'ignored'].includes(job.status)) return Response.json({ ok: true, skipped: true, status: job.status });

    await db.from('leaflet_imports').update({
      status: 'downloading',
      started_at: new Date().toISOString(),
      error_message: null,
    }).eq('id', importId);

    const sourceResponse = await fetch(job.source_document_url, {
      headers: { 'user-agent': 'SlevaoBot/1.0 (+https://slevao.cz)' },
      redirect: 'follow',
    });
    if (!sourceResponse.ok) throw new Error(`Stažení letáku selhalo: HTTP ${sourceResponse.status}`);

    const bytes = new Uint8Array(await sourceResponse.arrayBuffer());
    if (!bytes.length) throw new Error('Stažený leták je prázdný.');
    if (bytes.length > 50 * 1024 * 1024) throw new Error('Leták je větší než 50 MB.');

    await ensureBucket();
    const contentType = sourceResponse.headers.get('content-type') || 'application/pdf';
    const extension = contentType.includes('pdf') ? 'pdf' : contentType.includes('png') ? 'png' : 'jpg';
    const storagePath = `${job.store_id || 'unknown'}/${importId}/source.${extension}`;
    const { error: uploadError } = await db.storage.from(STORAGE_BUCKET).upload(storagePath, bytes, {
      contentType,
      upsert: true,
    });
    if (uploadError) throw uploadError;

    await db.from('leaflet_imports').update({
      status: 'processing',
      metadata: { ...(job.metadata || {}), storage_bucket: STORAGE_BUCKET, storage_path: storagePath, bytes: bytes.length },
    }).eq('id', importId);

    if (!AI_EXTRACTOR_URL) {
      await db.from('leaflet_imports').update({
        status: 'review',
        error_message: 'Leták byl automaticky stažen. Pro rozpoznání produktů je nutné nastavit AI_EXTRACTOR_URL.',
        finished_at: new Date().toISOString(),
      }).eq('id', importId);
      return Response.json({ ok: true, downloaded: true, extraction_configured: false });
    }

    const signed = await db.storage.from(STORAGE_BUCKET).createSignedUrl(storagePath, 60 * 30);
    if (signed.error || !signed.data?.signedUrl) throw signed.error || new Error('Nepodařilo se vytvořit odkaz pro AI zpracování.');

    const aiResponse = await fetch(AI_EXTRACTOR_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(AI_EXTRACTOR_KEY ? { authorization: `Bearer ${AI_EXTRACTOR_KEY}` } : {}),
      },
      body: JSON.stringify({
        document_url: signed.data.signedUrl,
        language: 'cs',
        currency: 'CZK',
        output_schema: 'slevao_leaflet_v1',
      }),
    });
    if (!aiResponse.ok) throw new Error(`AI zpracování selhalo: HTTP ${aiResponse.status}`);
    const result = await aiResponse.json();
    const items: ExtractedItem[] = Array.isArray(result.items) ? result.items : [];
    if (!items.length) throw new Error('AI v letáku nerozpoznala žádné produkty.');

    const categories = await categoryMap();
    const rows = items
      .filter((item) => item.title && Number(item.price) > 0)
      .map((item) => ({
        import_id: importId,
        category_id: item.category_name ? categories.get(item.category_name.toLocaleLowerCase('cs')) || null : null,
        title: item.title.trim(),
        brand: item.brand || null,
        quantity_text: item.quantity_text || null,
        price: Number(item.price),
        old_price: item.old_price ? Number(item.old_price) : null,
        unit_price: item.unit_price ? Number(item.unit_price) : null,
        unit_label: item.unit_label || null,
        image_url: item.image_url || null,
        source_page: item.source_page || null,
        confidence: item.confidence || null,
        status: 'review',
        raw_data: item.raw_data || item,
      }));

    const { error: insertError } = await db.from('leaflet_import_items').insert(rows);
    if (insertError) throw insertError;

    const averageConfidence = rows.reduce((sum, row) => sum + Number(row.confidence || 0), 0) / rows.length;
    const autoPublish = Boolean(job.leaflet_sources?.auto_publish) && averageConfidence >= 0.92;
    await db.from('leaflet_imports').update({
      status: autoPublish ? 'publishing' : 'review',
      product_count: rows.length,
      confidence: averageConfidence || null,
      detected_valid_from: result.valid_from || null,
      detected_valid_to: result.valid_to || null,
      page_count: result.page_count || null,
      finished_at: new Date().toISOString(),
    }).eq('id', importId);

    return Response.json({ ok: true, import_id: importId, products: rows.length, auto_publish: autoPublish });
  } catch (error) {
    return importId ? await fail(importId, error) : Response.json({ error: String(error) }, { status: 500 });
  }
});