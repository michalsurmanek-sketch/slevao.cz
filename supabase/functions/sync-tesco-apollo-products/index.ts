import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const LANDING = 'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy';
const PARSER_URL = `${SUPABASE_URL}/functions/v1/probe-tesco-layout-v14`;
const ADAPTER = 'tesco-apollo-pdf-v16-semantic-public';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = (v: unknown) => clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
const ref = (v: any) => clean(v?.__ref);
const allowed = (req: Request) => req.headers.get('authorization') === `Bearer ${SERVICE}` || Boolean(CRON && req.headers.get('x-cron-secret') === CRON);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const dateOnly = (v: unknown) => String(v ?? '').match(/^(\d{4}-\d{2}-\d{2})T/)?.[1] || null;
const todayPrague = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function nextData(html: string) {
  const a = html.indexOf('<script id="__NEXT_DATA__"');
  const b = html.indexOf('>', a);
  const c = html.indexOf('</script>', b + 1);
  if (a < 0 || b < 0 || c < 0) throw new Error('Tesco viewer neobsahuje čitelné __NEXT_DATA__.');
  return JSON.parse(html.slice(b + 1, c));
}

async function fetchText(url: string) {
  const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Tesco HTML HTTP ${response.status}`);
  return { text, url: response.url };
}

async function currentViewerUrl() {
  const landing = await fetchText(`${LANDING}?_slevao=${Date.now()}`);
  const today = todayPrague();
  const candidates = [...landing.text.matchAll(/href=["']([^"']*\/hypermarkety\/tesco-letak-(\d{4}-\d{2}-\d{2})\/1)["']/gi)]
    .map((match) => ({ start: match[2], url: new URL(match[1].replace(/&amp;/g, '&'), LANDING).toString() }))
    .filter((item) => item.start <= today)
    .sort((a, b) => b.start.localeCompare(a.start));
  if (!candidates.length) throw new Error(`Tesco landing neobsahuje HM viewer platný nejpozději ${today}.`);
  return candidates[0].url;
}

async function leafletFromViewer(viewer: string) {
  const html = await fetchText(viewer);
  const pageProps = nextData(html.text)?.props?.pageProps || {};
  const state = pageProps.__APOLLO_STATE__ || {};
  const leaflets = Object.values(state)
    .filter((v: any) => v?.__typename === 'Leaflet' && v?.type === 'HM' && Array.isArray(v?.pages))
    .sort((a: any, b: any) => String(b.validFrom || '').localeCompare(String(a.validFrom || ''))) as any[];
  const leaflet = leaflets[0];
  if (!leaflet) throw new Error('Tesco Apollo state neobsahuje aktuální HM leták.');
  const validFrom = dateOnly(leaflet.validFrom);
  const validTo = dateOnly(leaflet.validTo);
  const pdfUrl = clean(leaflet.leafletUrl);
  const pageCount = (leaflet.pages || []).map(ref).filter(Boolean).length;
  if (!validFrom || !validTo || validFrom > validTo) throw new Error('Tesco leták nemá platnou dobu akce.');
  if (!/^https:\/\/digitalcontent\.api\.tesco\.com\//i.test(pdfUrl)) throw new Error('Tesco Apollo nevrátilo oficiální PDF URL.');
  if (pageCount < 20 || pageCount > 39) throw new Error(`Tesco leták má ${pageCount} stran; v16 bezpečně podporuje 20–39.`);
  return { viewer, leafletId: Number(leaflet.id), updatedAt: clean(leaflet.updatedAt), validFrom, validTo, pdfUrl, pageCount, fingerprint: [leaflet.id, leaflet.updatedAt || '', validFrom, validTo, pdfUrl, pageCount].join('|') };
}

async function currentLeaflet() { return await leafletFromViewer(await currentViewerUrl()); }

async function sha(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function tescoStoreId() {
  const { data, error } = await db.from('stores').select('id').eq('slug', 'tesco').single();
  if (error || !data?.id) throw error || new Error('Tesco store nebyl nalezen.');
  return String(data.id);
}

async function reusableSnapshot(storeId: string, leaflet: Awaited<ReturnType<typeof currentLeaflet>>) {
  const { data: state, error: stateError } = await db.from('store_product_sync_state')
    .select('store_id,last_source_signature,last_offer_count,metadata,last_valid_from,last_valid_to,is_running,parser_version,last_import_id,last_published_count,health_status')
    .eq('store_id', storeId)
    .maybeSingle();
  if (stateError) throw stateError;
  if (!state) return null;

  const metadata = state.metadata && typeof state.metadata === 'object' && !Array.isArray(state.metadata) ? state.metadata : {};
  const expectedCount = Number(state.last_published_count ?? state.last_offer_count ?? 0);
  if (metadata.tesco_leaflet_fingerprint !== leaflet.fingerprint) return null;
  if (state.parser_version !== ADAPTER || state.health_status !== 'ok' || state.is_running === true) return null;
  if (clean(state.last_valid_from) !== leaflet.validFrom || clean(state.last_valid_to) !== leaflet.validTo) return null;
  if (!Number.isFinite(expectedCount) || expectedCount < 20 || expectedCount > 50) return null;
  if (!state.last_import_id || !state.last_source_signature) return null;

  const { data: lastImport, error: importError } = await db.from('leaflet_imports')
    .select('id,status,source_document_url,detected_valid_from,detected_valid_to,metadata')
    .eq('id', state.last_import_id)
    .maybeSingle();
  if (importError) throw importError;
  if (!lastImport || lastImport.status !== 'published' || clean(lastImport.source_document_url) !== leaflet.pdfUrl) return null;
  if (clean(lastImport.detected_valid_from) !== leaflet.validFrom || clean(lastImport.detected_valid_to) !== leaflet.validTo) return null;
  const importMetadata = lastImport.metadata && typeof lastImport.metadata === 'object' && !Array.isArray(lastImport.metadata) ? lastImport.metadata : {};
  if (importMetadata.adapter !== ADAPTER || importMetadata.parser_version !== ADAPTER || clean(importMetadata.source_signature) !== clean(state.last_source_signature)) return null;

  const { count: itemCount, error: itemError } = await db.from('leaflet_import_items')
    .select('id', { head: true, count: 'exact' })
    .eq('import_id', lastImport.id);
  if (itemError) throw itemError;
  if (Number(itemCount) !== expectedCount) return null;

  const { count: offerCount, error: offerError } = await db.from('offers')
    .select('id', { head: true, count: 'exact' })
    .eq('store_id', storeId)
    .eq('status', 'published')
    .eq('is_verified', true)
    .eq('valid_from', leaflet.validFrom)
    .eq('valid_to', leaflet.validTo)
    .contains('metadata', { parser: ADAPTER });
  if (offerError) throw offerError;
  if (Number(offerCount) !== expectedCount) return null;

  return { state, metadata, expectedCount, itemCount: Number(itemCount), offerCount: Number(offerCount) };
}

async function touchReusableSnapshot(storeId: string, metadata: Record<string, unknown>, leaflet: Awaited<ReturnType<typeof currentLeaflet>>, count: number) {
  const checkedAt = new Date().toISOString();
  const nextMetadata = {
    ...metadata,
    tesco_leaflet_fingerprint: leaflet.fingerprint,
    tesco_leaflet_id: leaflet.leafletId,
    tesco_pdf_url: leaflet.pdfUrl,
    tesco_viewer_url: leaflet.viewer,
    tesco_page_count: leaflet.pageCount,
    tesco_valid_from: leaflet.validFrom,
    tesco_valid_to: leaflet.validTo,
    tesco_checked_at: checkedAt,
    tesco_fast_path_at: checkedAt,
  };
  const { error } = await db.from('store_product_sync_state').update({
    last_run_at: checkedAt,
    last_success_at: checkedAt,
    last_error: null,
    health_status: 'ok',
    health_reason: `Tesco HM leták ${leaflet.validFrom}–${leaflet.validTo} se nezměnil; zachováno ${count} ověřených nabídek.`,
    metadata: nextMetadata,
  }).eq('store_id', storeId);
  if (error) throw error;
}

async function persistLeafletFingerprint(storeId: string, leaflet: Awaited<ReturnType<typeof currentLeaflet>>) {
  const { data: state, error: readError } = await db.from('store_product_sync_state').select('metadata').eq('store_id', storeId).maybeSingle();
  if (readError) throw readError;
  const metadata = state?.metadata && typeof state.metadata === 'object' && !Array.isArray(state.metadata) ? state.metadata : {};
  const checkedAt = new Date().toISOString();
  const { error } = await db.from('store_product_sync_state').update({
    metadata: {
      ...metadata,
      tesco_leaflet_fingerprint: leaflet.fingerprint,
      tesco_leaflet_id: leaflet.leafletId,
      tesco_pdf_url: leaflet.pdfUrl,
      tesco_viewer_url: leaflet.viewer,
      tesco_page_count: leaflet.pageCount,
      tesco_valid_from: leaflet.validFrom,
      tesco_valid_to: leaflet.validTo,
      tesco_checked_at: checkedAt,
      tesco_full_parse_at: checkedAt,
    },
  }).eq('store_id', storeId);
  if (error) throw error;
}

async function runParser(leaflet: Awaited<ReturnType<typeof currentLeaflet>>) {
  const response = await fetch(PARSER_URL, {
    method: 'POST', headers: { authorization: `Bearer ${SERVICE}`, 'content-type': 'application/json' },
    body: JSON.stringify({ start_page: 1, probe_pages: leaflet.pageCount, viewer_url: leaflet.viewer, expected_pdf_url: leaflet.pdfUrl }), signal: AbortSignal.timeout(120000),
  });
  const text = await response.text(); let payload: any = null; try { payload = JSON.parse(text); } catch {}
  if (!response.ok || !payload?.ok || payload?.adapter !== 'tesco-layout-v14-semantic-math') throw new Error(`Tesco v14 parser HTTP ${response.status}: ${text.slice(0, 800)}`);
  if (payload.viewer_url !== leaflet.viewer || payload.pdf_url !== leaflet.pdfUrl) throw new Error('Tesco v14 parser nepotvrdil stejný viewer/PDF snapshot.');
  if (!Array.isArray(payload.rows) || !Array.isArray(payload.pages)) throw new Error('Tesco v14 parser vrátil neúplný payload.');
  if (payload.pages.length !== leaflet.pageCount) throw new Error(`Tesco v14 parser zpracoval ${payload.pages.length}/${leaflet.pageCount} stran.`);
  return payload;
}

function safeEvidence(row: any) { const semantic = Array.isArray(row?.semantic_words) ? row.semantic_words.length : 0; const layout = Number(row?.layout_score ?? 9999); const spatial = Number(row?.spatial ?? 9999); return spatial <= 150 && ((semantic >= 2 && layout <= 190) || (semantic === 1 && layout <= 175)); }
function repairSplitQuantity(value: unknown) { return clean(value).replace(/\b(\d{1,4})\s+(\d)\s*(kg|g|l|ml|ks)\b/gi, '$1$2$3'); }
function usableQuantity(value: unknown) { const repaired = repairSplitQuantity(value); const match = repaired.match(/\b(\d+(?:[,.]\d+)?)\s*(kg|g|l|ml|ks)\b/i); if (!match) return null; const amount = Number(match[1].replace(',', '.')); return Number.isFinite(amount) && amount > 0 ? match[0] : null; }
function quantityText(row: any) { const fromMath = usableQuantity(row?.math?.quantity?.source); if (fromMath) return fromMath; const productName = repairSplitQuantity(row?.product_name); const matches = [...productName.matchAll(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|ks)\b/gi)].map((match) => usableQuantity(match[0])).filter(Boolean) as string[]; return matches.length ? matches[matches.length - 1] : null; }
function confidence(row: any) { const semantic = Array.isArray(row?.semantic_words) ? row.semantic_words.length : 0; const mathUnique = row?.math?.unique === true; if (mathUnique && semantic >= 2) return 0.995; if (semantic >= 2) return 0.99; if (mathUnique && semantic === 1) return 0.985; return 0.97; }

async function structuredRows(parserRows: any[], leaflet: Awaited<ReturnType<typeof currentLeaflet>>) {
  const map = new Map<string, any>();
  for (const row of parserRows) {
    if (!safeEvidence(row)) continue;
    const title = clean(row?.title); const productName = clean(row?.product_name); const price = Number(row?.price);
    if (!title || !productName || !Number.isFinite(price) || price <= 0 || price > 100000) continue;
    const stableHash = (await sha(norm(productName))).slice(0, 40); const externalId = `tesco-apollo:${stableHash}`;
    const oldRaw = row?.old_price == null ? null : Number(row.old_price); const oldPrice = oldRaw && Number.isFinite(oldRaw) && oldRaw > price ? oldRaw : null; const semantic = Array.isArray(row?.semantic_words) ? row.semantic_words : [];
    const output = { external_id: externalId, title, normalized_title: norm(title), brand: null, quantity_text: quantityText(row), price, old_price: oldPrice,
      image_url: /^https:\/\//i.test(clean(row?.image)) ? clean(row.image) : null, source_url: leaflet.viewer, valid_from: leaflet.validFrom, valid_to: leaflet.validTo,
      source_page: Number(row?.page) || null, confidence: confidence(row), metadata: { parser: ADAPTER, structured_source: true, ai_used: false, price_kind: 'public', tesco_leaflet_id: leaflet.leafletId,
        tesco_leaflet_product_id: Number(row?.main_id) || null, tesco_position_id: Number(row?.position_id) || null, tesco_product_name: productName, variant_count: Number(row?.variant_count) || 1,
        evidence: { semantic_words: semantic, layout_score: Number(row?.layout_score ?? 0), spatial_distance: Number(row?.spatial ?? 0), math_unique: row?.math?.unique === true, math: row?.math || null } } };
    const previous = map.get(externalId); if (previous && Math.abs(Number(previous.price) - price) > 0.01) throw new Error(`Tesco stabilní identita ${productName} má dvě různé ceny ${previous.price}/${price}.`);
    if (!previous || output.confidence > previous.confidence || (!previous.image_url && output.image_url)) map.set(externalId, output);
  }
  return [...map.values()].sort((a, b) => a.external_id.localeCompare(b.external_id));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: JSON_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(req)) return json({ error: 'Unauthorized' }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;
    const before = await currentLeaflet();
    const today = todayPrague();
    if (today < before.validFrom || today > before.validTo) throw new Error(`Tesco HM leták ${before.validFrom}–${before.validTo} dnes neplatí.`);

    const storeId = await tescoStoreId();
    const reusable = await reusableSnapshot(storeId, before);
    if (reusable) {
      const after = await leafletFromViewer(before.viewer);
      if (before.fingerprint !== after.fingerprint) throw new Error('Tesco leták se během fast-path kontroly změnil; nic nebylo publikováno.');
      if (!dryRun) await touchReusableSnapshot(storeId, reusable.metadata, before, reusable.expectedCount);
      return json({
        ok: true,
        dry_run: dryRun,
        adapter: ADAPTER,
        snapshot_pinned: true,
        no_change: true,
        parser_skipped: true,
        leaflet_id: before.leafletId,
        viewer_url: before.viewer,
        pdf_url: before.pdfUrl,
        valid_from: before.validFrom,
        valid_to: before.validTo,
        page_count: before.pageCount,
        safe_row_count: reusable.expectedCount,
        import_item_count: reusable.itemCount,
        published_offer_count: reusable.offerCount,
        signature: clean(reusable.state.last_source_signature),
      });
    }

    const parsed = await runParser(before);
    const after = await leafletFromViewer(before.viewer);
    if (before.fingerprint !== after.fingerprint) throw new Error('Tesco leták se během běhu změnil; snapshot nebyl publikován.');
    const rows = await structuredRows(parsed.rows, before);
    if (rows.length < 20 || rows.length > 50) throw new Error(`Tesco v16 bezpečný snapshot má ${rows.length} produktů; povolený rozsah je 20–50.`);
    const rowSignature = rows.map((r) => `${r.external_id}:${r.price}:${r.old_price ?? ''}`).join('|');
    const signature = await sha(`${ADAPTER}|${before.fingerprint}|${rowSignature}`);
    const summary = {
      ok: true,
      dry_run: dryRun,
      adapter: ADAPTER,
      snapshot_pinned: true,
      no_change: false,
      parser_skipped: false,
      leaflet_id: before.leafletId,
      viewer_url: before.viewer,
      pdf_url: before.pdfUrl,
      valid_from: before.validFrom,
      valid_to: before.validTo,
      page_count: before.pageCount,
      parser_row_count: Number(parsed.row_count) || parsed.rows.length,
      safe_row_count: rows.length,
      signature,
      sample: rows.slice(0, 50).map((r) => ({ title: r.title, price: r.price, old_price: r.old_price, source_page: r.source_page, quantity_text: r.quantity_text, confidence: r.confidence, evidence: r.metadata.evidence })),
    };
    if (dryRun) return json(summary);

    const { data, error } = await db.rpc('publish_structured_store_offers', {
      p_store_slug: 'tesco',
      p_adapter: ADAPTER,
      p_signature: signature,
      p_rows: rows,
      p_min_products: 20,
      p_max_products: 50,
      p_source_document_url: before.pdfUrl,
      p_parser_version: ADAPTER,
    });
    if (error) throw error;
    await persistLeafletFingerprint(storeId, before);
    return json({ ...summary, dry_run: false, publish: data, fingerprint_seeded: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();
    try {
      const { data: store } = await db.from('stores').select('id').eq('slug', 'tesco').maybeSingle();
      if (store?.id) {
        await db.from('store_product_sync_state').upsert({
          store_id: store.id,
          last_run_at: now,
          is_running: false,
          run_started_at: null,
          last_error: message.slice(0, 2000),
          last_parser_error: message.slice(0, 2000),
          health_status: 'error',
          health_reason: 'Tesco produktový sync selhal; poslední ověřené nabídky zůstaly zachované.',
          updated_at: now,
        }, { onConflict: 'store_id' });
      }
    } catch {
      // Health reporting must never mask the original sync failure.
    }
    return json({ ok: false, adapter: ADAPTER, error: message }, 500);
  }
});