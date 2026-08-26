import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const U = Deno.env.get('SUPABASE_URL')!;
const K = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const C = Deno.env.get('CRON_SECRET') || '';
const db = createClient(U, K, { auth: { persistSession: false, autoRefreshToken: false } });
const SOURCE_ADAPTER = 'jip-flip-pdf-v1';
const SOURCE_PAGE_COUNT = 12;
const OCR_ENGINE = 'tesseract-cli-ces-jip-v2';
const PARSER_ENDPOINT = 'debug-jip-main-price-v5';
const PARSER = 'jip-main-price-v7-direct-decimal';
const DERIVED_ADAPTER = 'jip-ocr-main-price-v7';
const H = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' };
const J = (x: any, s = 200) => new Response(JSON.stringify(x), { status: s, headers: H });
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

function ok(r: Request) {
  return r.headers.get('authorization') === `Bearer ${K}` || Boolean(C && r.headers.get('x-cron-secret') === C);
}
function today() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const v = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return `${v.year}-${v.month}-${v.day}`;
}
function isPackSource(x: any) {
  const images = x?.metadata?.page_image_urls;
  return x?.status === 'published'
    && Number(x?.metadata?.page_count) === SOURCE_PAGE_COUNT
    && Array.isArray(images) && images.length === SOURCE_PAGE_COUNT
    && /\/MO-\d{1,2}-\d{1,2}-\d{4}\/$/i.test(String(x?.source_document_url || ''));
}
function ambiguousBrandOnly(c: any) {
  const title = clean(c?.title);
  const lines = Array.isArray(c?.raw?.title_lines) ? c.raw.title_lines.map(clean).filter(Boolean) : [];
  // Fail closed on a single two-or-more-word Title Case label such as a producer name.
  // Simple all-uppercase produce labels (e.g. CUKETA) remain allowed.
  return lines.length === 1 && /^[A-ZÁ-Ž][a-zá-ž]+(?:\s+[A-ZÁ-Ž][a-zá-ž]+)+[.!]?$/u.test(title);
}
function safeCandidate(c: any) {
  const title = clean(c?.title);
  const quantity = clean(c?.quantity);
  const price = Number(c?.price);
  const rawPrice = clean(c?.raw?.price_line);
  if (c?.price_mode !== 'direct-decimal') return false;
  if (!/^.*\d{1,4}[,.]\d{2}.*$/.test(rawPrice)) return false;
  if (!title || title.length < 5 || !quantity || !Number.isFinite(price) || price < 2 || price > 5000) return false;
  if (Number(c?.conf?.price || 0) < 60 || Number(c?.conf?.title || 0) < 80 || Number(c?.conf?.qty || 0) < 65) return false;
  if (/(nabidka|neplati|dph|zdarma|kup |kupon|aplikac|sleva)/i.test(title)) return false;
  if (ambiguousBrandOnly(c)) return false;
  return true;
}
async function parse(importId: string) {
  const r = await fetch(`${U}/functions/v1/${PARSER_ENDPOINT}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${K}`, apikey: K, 'content-type': 'application/json' },
    body: JSON.stringify({ import_id: importId, engine: OCR_ENGINE }),
    signal: AbortSignal.timeout(120000),
  });
  const t = await r.text();
  let x: any = {};
  try { x = JSON.parse(t); } catch {}
  if (!r.ok || !x.ok || x.engine !== OCR_ENGINE || x.adapter !== 'jip-main-price-v5-direct-only-debug') {
    throw new Error(`JIP direct-price parser HTTP ${r.status}: ${t.slice(0, 700)}`);
  }
  return x;
}
async function publish(importId: string) {
  const r = await fetch(`${U}/functions/v1/publish-imports`, {
    method: 'POST',
    headers: { authorization: `Bearer ${K}`, apikey: K, 'content-type': 'application/json' },
    body: JSON.stringify({ import_id: importId }),
    signal: AbortSignal.timeout(120000),
  });
  const t = await r.text();
  let x: any = {};
  try { x = JSON.parse(t); } catch {}
  if (!r.ok || !x.ok) throw new Error(`publish-imports HTTP ${r.status}: ${t.slice(0, 700)}`);
  return x;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: H });
  if (req.method !== 'POST') return J({ error: 'method' }, 405);
  if (!ok(req)) return J({ error: 'auth' }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const d = today();
    const { data: store, error: se } = await db.from('stores').select('id,name').eq('slug', 'jip').maybeSingle();
    if (se) throw se;
    if (!store) throw new Error('JIP store not found');

    const { data: imports, error: ie } = await db.from('leaflet_imports')
      .select('*').eq('store_id', store.id).eq('metadata->>adapter', SOURCE_ADAPTER)
      .lte('detected_valid_from', d).gte('detected_valid_to', d)
      .order('detected_valid_from', { ascending: false }).order('created_at', { ascending: false }).limit(20);
    if (ie) throw ie;
    const source = (imports || []).find(isPackSource);
    if (!source) return J({ ok:true, published:false, waiting_source:true, business_date:d, reason:'No current published 12-page JIP Maloobchod source' });

    const { data: ocrPages, error: oe } = await db.from('leaflet_ocr_pages').select('page_number')
      .eq('import_id', source.id).eq('engine', OCR_ENGINE).order('page_number');
    if (oe) throw oe;
    const uniquePages = new Set((ocrPages || []).map((x:any) => Number(x.page_number)));
    if ((ocrPages || []).length !== 12 || uniquePages.size !== 12) {
      return J({ ok:true, published:false, waiting_ocr:true, source_import_id:source.id, engine:OCR_ENGINE, pages:(ocrPages||[]).length, unique_pages:uniquePages.size });
    }

    const parsed = await parse(source.id);
    const all = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    const candidates = all.filter(safeCandidate);
    const rejected = all.filter((c:any) => !safeCandidate(c)).map((c:any) => ({ title:c.title, price:c.price, quantity:c.quantity, reason:ambiguousBrandOnly(c)?'ambiguous_brand_only':'safety_filter' }));
    if (candidates.length < 5 || candidates.length > 20) throw new Error(`Safety guard: expected 5-20 direct-price candidates, got ${candidates.length}`);

    const summary = { ok:true, dry_run:dryRun, adapter:DERIVED_ADAPTER, parser:PARSER, engine:OCR_ENGINE, source_import_id:source.id,
      source_document_url:source.source_document_url, valid_from:source.detected_valid_from, valid_to:source.detected_valid_to,
      parsed_count:all.length, safe_count:candidates.length, rejected, partial_coverage:true,
      candidates:candidates.map((c:any)=>({ title:c.title, price:c.price, quantity:c.quantity, page:c.page, conf:c.conf, price_mode:c.price_mode })) };
    if (dryRun) return J(summary);

    const hash = `jip-main-price-v7-${source.id}`;
    const { data: existing, error: ee } = await db.from('leaflet_imports').select('id,status,metadata').eq('source_hash', hash).maybeSingle();
    if (ee) throw ee;
    if (existing?.status === 'published') return J({ ...summary, dry_run:false, reused:true, import_id:existing.id });

    let id = existing?.id || null;
    if (!id) {
      const { data: created, error: ce } = await db.from('leaflet_imports').insert({
        source_id:source.source_id, store_id:store.id, source_document_url:source.source_document_url, source_hash:hash,
        status:'queued', coverage_scope:source.coverage_scope || 'national', region_code:source.region_code || null,
        city_name:source.city_name || null, store_location_name:source.store_location_name || null,
        detected_valid_from:source.detected_valid_from, detected_valid_to:source.detected_valid_to, confidence:0.98,
        metadata:{ parser:PARSER, deterministic:true, verified_pipeline:true, partial_coverage:true, source_import_id:source.id,
          adapter:DERIVED_ADAPTER, ocr_engine:OCR_ENGINE, source_contract:'maloobchod-12-page-direct-main-price-v7' }
      }).select('id').single();
      if (ce) throw ce;
      id = created.id;
    } else {
      await db.from('leaflet_import_items').delete().eq('import_id', id);
      const { error: ue } = await db.from('leaflet_imports').update({ status:'queued', product_count:0, confidence:0.98,
        detected_valid_from:source.detected_valid_from, detected_valid_to:source.detected_valid_to, error_message:null,
        metadata:{ ...(existing.metadata || {}), parser:PARSER, deterministic:true, verified_pipeline:true, partial_coverage:true,
          source_import_id:source.id, adapter:DERIVED_ADAPTER, ocr_engine:OCR_ENGINE, source_contract:'maloobchod-12-page-direct-main-price-v7' }
      }).eq('id', id);
      if (ue) throw ue;
    }

    const rows = candidates.map((c:any) => ({ import_id:id, title:clean(c.title), price:Number(c.price), quantity_text:clean(c.quantity),
      source_page:Number(c.page), confidence:0.98, status:'approved', raw_data:{ parser:PARSER, deterministic:true, verified_main_price:true,
        price_mode:'direct-decimal', ocr_engine:OCR_ENGINE, ocr_confidence:c.conf, evidence:c.raw } }));
    const { error: ins } = await db.from('leaflet_import_items').insert(rows);
    if (ins) throw ins;
    const { error: up } = await db.from('leaflet_imports').update({ status:'review', product_count:rows.length, confidence:0.98,
      error_message:null, finished_at:new Date().toISOString() }).eq('id', id);
    if (up) throw up;

    const pub = await publish(id);
    const result = Array.isArray(pub.results) ? pub.results[0] : null;
    if (result?.error) throw new Error(result.error);
    const accepted = Number(result?.published || 0) + Number(result?.duplicates || 0);
    if (accepted < 5) throw new Error(`Safety guard: publisher accepted only ${accepted}/${rows.length}`);

    const { count: total, error: tc } = await db.from('offers').select('id', { count:'exact', head:true })
      .eq('store_id', store.id).eq('status','published').lte('valid_from',d).gte('valid_to',d);
    if (tc) throw tc;
    const totalPublished = total || 0;
    await db.from('store_product_sync_state').upsert({ store_id:store.id, last_run_at:new Date().toISOString(), last_success_at:new Date().toISOString(),
      last_offer_count:totalPublished, expected_offer_count:rows.length, last_published_count:totalPublished,
      last_valid_from:source.detected_valid_from, last_valid_to:source.detected_valid_to, parser_version:PARSER,
      adapter_name:'sync-jip-pack-products', adapter_version:'v7', source_type:'official-ocr', source_category:'current-leaflet',
      last_error:null, last_parser_error:null, health_status:'degraded',
      health_reason:`JIP: ${totalPublished} bezpečně publikovaných direct-price nabídek; záměrně částečné pokrytí bez OCR odhadů cen.`,
      is_running:false, run_started_at:null, updated_at:new Date().toISOString(), last_import_id:id }, { onConflict:'store_id' });

    return J({ ...summary, dry_run:false, published:true, import_id:id, accepted, total_published:totalPublished, publish:pub });
  } catch (e) {
    return J({ ok:false, adapter:DERIVED_ADAPTER, error:e instanceof Error?e.message:String(e) }, 500);
  }
});
