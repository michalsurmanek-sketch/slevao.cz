import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const U = Deno.env.get('SUPABASE_URL')!;
const K = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const C = Deno.env.get('CRON_SECRET') || '';
const db = createClient(U, K, { auth: { persistSession: false, autoRefreshToken: false } });
const PARSER = 'jip-html-consensus-v1';
const SOURCE_ADAPTER = 'jip-flip-pdf-v1';
const HTML_FN = `${U}/functions/v1/sync-jip-basic-html-products`;
const PUBLISH_FN = `${U}/functions/v1/publish-imports`;
const H = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' };
const J = (x: unknown, s = 200) => new Response(JSON.stringify(x), { status: s, headers: H });

function allowed(req: Request) {
  return req.headers.get('authorization') === `Bearer ${K}` || Boolean(C && req.headers.get('x-cron-secret') === C);
}
function norm(v: unknown) {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs').replace(/\s+/g, ' ').trim();
}
function todayPrague() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const x = Object.fromEntries(p.map((v) => [v.type, v.value]));
  return `${x.year}-${x.month}-${x.day}`;
}
function key(c: any) {
  return `${norm(c?.title)}|${Number(c?.price || 0).toFixed(2)}|${norm(c?.quantity_text)}`;
}
function numberAt(c: any, name: string) {
  const v = Number(c?.raw_data?.[name]);
  return Number.isFinite(v) ? v : 999;
}
function safeCandidate(c: any) {
  const title = String(c?.title || '').trim();
  const n = norm(title);
  const q = String(c?.quantity_text || '').trim();
  const raw = c?.raw_data || {};
  if (!title || title.length < 6 || title.length > 90 || !(Number(c?.price) > 0) || !q) return false;
  if (Number(c?.confidence || 0) < 0.995) return false;
  if (raw.deterministic !== true || raw.html_column !== true || raw.vat_verified !== true || raw.identity_verified !== true || raw.unit_price_conflict !== false) return false;
  if (numberAt(c, 'vat_delta') > 0.01) return false;
  if (numberAt(c, 'title_quantity_distance') > 2.5) return false;
  if (numberAt(c, 'title_price_distance') > 5.5) return false;
  if (numberAt(c, 'quantity_price_distance') > 6) return false;
  if (/[x×]/i.test(q)) return false;
  if (/\bcca\b|\bglazur|\d+\s*\/\s*\d+/i.test(n)) return false;
  if (/(nabidka|neplati|bez dph|zdarma|kupon|pri koupi|cena od|do vyprodani)/i.test(n)) return false;
  const oneWord = !/\s/.test(title);
  if (oneWord && /\b(?:ml|l)\b/i.test(q) && /^(pomeranc|citron|limetka|broskev|mango|jahoda|malina|rybiz|boruvka)$/i.test(n)) return false;
  if ((title.match(/[+&]/g) || []).length >= 2) return false;
  return true;
}
async function callHtml(importId: string) {
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(HTML_FN, {
        method: 'POST',
        headers: { authorization: `Bearer ${K}`, apikey: K, 'content-type': 'application/json' },
        body: JSON.stringify({ import_id: importId }),
      });
      const t = await r.text();
      let x: any = {};
      try { x = JSON.parse(t); } catch {}
      if (r.ok && x.ok) return x;
      last = `HTTP ${r.status}: ${t.slice(0, 500)}`;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(`JIP HTML parser ${importId} selhal po 2 pokusech: ${last}`);
}
async function publish(importId: string) {
  const r = await fetch(PUBLISH_FN, {
    method: 'POST',
    headers: { authorization: `Bearer ${K}`, apikey: K, 'content-type': 'application/json' },
    body: JSON.stringify({ import_id: importId }),
  });
  const t = await r.text();
  let x: any = {};
  try { x = JSON.parse(t); } catch {}
  if (!r.ok || !x.ok) throw new Error(`publish-imports HTTP ${r.status}: ${t.slice(0, 700)}`);
  return x;
}
async function setWaiting(storeId: string, reason: string) {
  await db.from('store_product_sync_state').upsert({
    store_id: storeId,
    last_run_at: new Date().toISOString(),
    last_offer_count: 0,
    last_published_count: 0,
    adapter_name: 'sync-jip-html-consensus-products',
    adapter_version: 'v2',
    parser_version: PARSER,
    source_type: 'official-basic-html',
    source_category: 'current-leaflet-fallback',
    last_error: null,
    last_parser_error: null,
    health_status: 'waiting_source',
    health_reason: reason,
    is_running: false,
    run_started_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'store_id' });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: H });
  if (req.method !== 'POST') return J({ error: 'method' }, 405);
  if (!allowed(req)) return J({ error: 'auth' }, 401);

  const d = todayPrague();
  let storeId = '';
  try {
    const body = await req.json().catch(() => ({}));
    const dry = body.dry_run === true;
    const { data: store, error: se } = await db.from('stores').select('id,name').eq('slug', 'jip').maybeSingle();
    if (se) throw se;
    if (!store) throw new Error('JIP store not found');
    storeId = store.id;

    const { data: imports, error: ie } = await db.from('leaflet_imports')
      .select('*')
      .eq('store_id', store.id)
      .eq('metadata->>adapter', SOURCE_ADAPTER)
      .lte('detected_valid_from', d)
      .gte('detected_valid_to', d)
      .order('created_at', { ascending: false })
      .limit(30);
    if (ie) throw ie;
    const rows = imports || [];

    const primary = rows.find((x: any) =>
      Number(x?.metadata?.page_count) === 12
      && Array.isArray(x?.metadata?.page_image_urls)
      && x.metadata.page_image_urls.length === 12
      && /\/MO-\d{1,2}-\d{1,2}-\d{4}\/$/i.test(String(x.source_document_url || ''))
    );
    if (primary) {
      return J({ ok: true, published: false, skipped: true, primary_available: true, business_date: d, source_import_id: primary.id, reason: 'Current 12-page JIP Maloobchod source is available; primary pack pipeline owns publication.' });
    }

    const ucc = rows.find((x: any) => Number(x?.metadata?.page_count) === 24 && /\/CC-UCC-/i.test(String(x.source_document_url || '')));
    const ucd = rows.find((x: any) => Number(x?.metadata?.page_count) === 24 && /\/CC-UCD-/i.test(String(x.source_document_url || '')));
    if (!ucc || !ucd) {
      const reason = 'JIP fallback čeká na dva současné 24stránkové oficiální letáky CC-UCC + CC-UCD; 12stránkový MO zdroj dnes není aktivní.';
      await setWaiting(store.id, reason);
      return J({ ok: true, published: false, waiting_source: true, business_date: d, reason });
    }

    const settled = await Promise.allSettled([callHtml(ucc.id), callHtml(ucd.id)]);
    if (settled[0].status !== 'fulfilled') throw settled[0].reason;
    if (settled[1].status !== 'fulfilled') throw settled[1].reason;
    const a: any = settled[0].value;
    const b: any = settled[1].value;
    const ca = Array.isArray(a.candidates) ? a.candidates : [];
    const cb = Array.isArray(b.candidates) ? b.candidates : [];
    const bm = new Map(cb.map((c: any) => [key(c), c]));
    const consensus: any[] = [];
    for (const c of ca) {
      const peer: any = bm.get(key(c));
      if (!peer) continue;
      if (Number(c.source_page) !== Number(peer.source_page)) continue;
      if (!safeCandidate(c) || !safeCandidate(peer)) continue;
      consensus.push({ ...c, raw_data: { ...(c.raw_data || {}), parser: PARSER, consensus_verified: true, consensus_peer_import_id: ucd.id, consensus_source_count: 2 } });
    }
    const seen = new Set<string>();
    const safe = consensus.filter((c) => { const k = key(c); if (seen.has(k)) return false; seen.add(k); return true; });
    if (safe.length < 8 || safe.length > 25) {
      throw new Error(`JIP consensus safety guard: expected 8-25 safe candidates, got ${safe.length} (HTML ${ca.length}/${cb.length}).`);
    }

    if (dry) return J({ ok: true, dry_run: true, business_date: d, source_import_ids: [ucc.id, ucd.id], source_candidate_counts: [ca.length, cb.length], consensus_count: safe.length, candidates: safe });

    const hash = `jip-html-consensus-v1-${ucc.id}-${ucd.id}`;
    const { data: existing, error: ee } = await db.from('leaflet_imports').select('id,status').eq('source_hash', hash).maybeSingle();
    if (ee) throw ee;
    if (existing?.status === 'published') {
      const { count: total } = await db.from('offers').select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('status', 'published').gte('valid_to', d);
      return J({ ok: true, reused: true, import_id: existing.id, consensus_count: safe.length, total_published: total || 0 });
    }

    let id = existing?.id || '';
    if (!id) {
      const { data: created, error: ce } = await db.from('leaflet_imports').insert({
        source_id: ucc.source_id,
        store_id: store.id,
        source_document_url: ucc.source_document_url,
        source_hash: hash,
        status: 'queued',
        coverage_scope: 'national',
        detected_valid_from: [ucc.detected_valid_from, ucd.detected_valid_from].sort().at(-1),
        detected_valid_to: [ucc.detected_valid_to, ucd.detected_valid_to].sort()[0],
        confidence: 0.995,
        metadata: {
          parser: PARSER,
          deterministic: true,
          verified_pipeline: true,
          adapter: PARSER,
          source_import_ids: [ucc.id, ucd.id],
          source_urls: [ucc.source_document_url, ucd.source_document_url],
          source_contract: '24-page-cross-leaflet-consensus-fallback',
          source_candidate_counts: [ca.length, cb.length],
          consensus_count: safe.length,
          coverage_label: 'Společné nabídky ve dvou současných oficiálních letácích JIP/Svět potravin',
          fallback_only_when_mo_absent: true,
        },
      }).select('id').single();
      if (ce) throw ce;
      id = created.id;
    } else {
      await db.from('leaflet_import_items').delete().eq('import_id', id).neq('status', 'published');
    }

    const { error: ins } = await db.from('leaflet_import_items').insert(safe.map((c: any) => ({
      import_id: id,
      title: String(c.title).trim(),
      price: Number(c.price),
      quantity_text: String(c.quantity_text).trim(),
      source_page: Number(c.source_page),
      confidence: 0.995,
      status: 'approved',
      raw_data: c.raw_data,
    })));
    if (ins) throw ins;
    const { error: up } = await db.from('leaflet_imports').update({ status: 'review', product_count: safe.length, confidence: 0.995, error_message: null, finished_at: new Date().toISOString() }).eq('id', id);
    if (up) throw up;

    const pub = await publish(id);
    const result = Array.isArray(pub.results) ? pub.results[0] : null;
    if (result?.error) throw new Error(result.error);
    const accepted = Number(result?.published || 0) + Number(result?.duplicates || 0);
    const failed = Number(result?.failed || 0);
    if (accepted < safe.length || failed > 0) throw new Error(`JIP consensus publisher accepted ${accepted}/${safe.length}, failed ${failed}.`);

    const { count: total, error: tc } = await db.from('offers').select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('status', 'published').gte('valid_to', d);
    if (tc) throw tc;
    const totalPublished = total || 0;
    await db.from('store_product_sync_state').upsert({
      store_id: store.id,
      last_run_at: new Date().toISOString(),
      last_success_at: new Date().toISOString(),
      last_offer_count: totalPublished,
      expected_offer_count: safe.length,
      last_published_count: totalPublished,
      last_valid_from: [ucc.detected_valid_from, ucd.detected_valid_from].sort().at(-1),
      last_valid_to: [ucc.detected_valid_to, ucd.detected_valid_to].sort()[0],
      parser_version: PARSER,
      adapter_name: 'sync-jip-html-consensus-products',
      adapter_version: 'v2',
      source_type: 'official-basic-html',
      source_category: 'current-leaflet-fallback',
      last_error: null,
      last_parser_error: null,
      health_status: totalPublished >= 8 ? 'ok' : 'degraded',
      health_reason: `JIP fallback: ${safe.length} dvojitě ověřených HTML/VAT nabídek, veřejně ${totalPublished}.`,
      is_running: false,
      run_started_at: null,
      updated_at: new Date().toISOString(),
      last_import_id: id,
    }, { onConflict: 'store_id' });

    return J({ ok: true, published: true, import_id: id, source_import_ids: [ucc.id, ucd.id], source_candidate_counts: [ca.length, cb.length], consensus_count: safe.length, accepted, total_published: totalPublished, publish: pub });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (storeId) {
      await db.from('store_product_sync_state').upsert({
        store_id: storeId,
        last_run_at: new Date().toISOString(),
        adapter_name: 'sync-jip-html-consensus-products',
        adapter_version: 'v2',
        parser_version: PARSER,
        source_type: 'official-basic-html',
        source_category: 'current-leaflet-fallback',
        last_error: message.slice(0, 1000),
        last_parser_error: message.slice(0, 1000),
        health_status: 'error',
        health_reason: `JIP fallback selhal: ${message.slice(0, 500)}`,
        is_running: false,
        run_started_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'store_id' });
    }
    return J({ ok: false, error: message }, 500);
  }
});
