import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const U = Deno.env.get('SUPABASE_URL')!;
const K = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const C = Deno.env.get('CRON_SECRET') || '';
const db = createClient(U, K, { auth: { persistSession: false, autoRefreshToken: false } });
const LANDING = 'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy';
const ADAPTER = 'tesco-apollo-page-images-v1';
const EXPECTED_PAGES = 32;
const H = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*',
  'accept-language': 'cs-CZ,cs;q=0.9',
};
const J = (x: any, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { 'content-type': 'application/json; charset=utf-8' } });
const clean = (v: any) => String(v ?? '').replace(/\s+/g, ' ').trim();
const ref = (v: any) => clean(v?.__ref);

function ok(r: Request) {
  return r.headers.get('authorization') === `Bearer ${K}` || Boolean(C && r.headers.get('x-cron-secret') === C);
}
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function dateOnly(v: any) {
  return String(v ?? '').match(/^(\d{4}-\d{2}-\d{2})T/)?.[1] || null;
}
function nextData(h: string) {
  const a = h.indexOf('<script id="__NEXT_DATA__"');
  const b = h.indexOf('>', a);
  const c = h.indexOf('</script>', b + 1);
  if (a < 0 || b < 0 || c < 0) throw new Error('NEXT_DATA');
  return JSON.parse(h.slice(b + 1, c));
}
function officialPdf(url: unknown) {
  try {
    const u = new URL(clean(url));
    return u.protocol === 'https:' && u.hostname === 'digitalcontent.api.tesco.com' && u.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}
function canonicalPages(value: unknown) {
  if (!Array.isArray(value) || value.length !== EXPECTED_PAGES || new Set(value).size !== EXPECTED_PAGES) return null;
  const pages = value.map(clean);
  for (let i = 0; i < pages.length; i++) {
    try {
      const u = new URL(pages[i]);
      if (u.protocol !== 'https:' || u.hostname !== 'digitalcontent.api.tesco.com' || !u.pathname.toLowerCase().endsWith(`.${i + 1}.jpeg`)) return null;
    } catch {
      return null;
    }
  }
  return pages;
}
async function text(url: string) {
  const r = await fetch(url, { headers: H, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return t;
}
async function currentViewer() {
  const d = today();
  let landingError: unknown = null;
  for (const url of [`${LANDING}?_slevao=${Date.now()}`, LANDING]) {
    try {
      const h = await text(url);
      const rows = [...h.matchAll(/href=["']([^"']*\/hypermarkety\/tesco-letak-(\d{4}-\d{2}-\d{2})\/1)["']/gi)]
        .map((m) => ({ start: m[2], url: new URL(m[1].replace(/&amp;/g, '&'), LANDING).toString() }))
        .filter((x) => x.start <= d)
        .sort((a, b) => b.start.localeCompare(a.start));
      if (rows.length) return rows[0].url;
      landingError = new Error(`No Tesco HM viewer <= ${d}`);
    } catch (e) {
      landingError = e;
    }
  }
  throw landingError instanceof Error ? landingError : new Error(`No Tesco HM viewer <= ${d}`);
}
async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return J({ error: 'method' }, 405);
  if (!ok(req)) return J({ error: 'auth' }, 401);

  try {
    const d = today();
    const { data: store, error: se } = await db.from('stores').select('id').eq('slug', 'tesco').maybeSingle();
    if (se) throw se;
    if (!store) throw new Error('Tesco store missing');

    // Reuse the verified current canonical source before touching Tesco's website.
    // This keeps OCR reruns independent of transient WAF/landing-page failures.
    const { data: current, error: ce } = await db.from('leaflet_imports')
      .select('id,status,source_document_url,detected_valid_from,detected_valid_to,metadata')
      .eq('store_id', store.id)
      .eq('metadata->>adapter', ADAPTER)
      .lte('detected_valid_from', d)
      .gte('detected_valid_to', d)
      .order('detected_valid_from', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10);
    if (ce) throw ce;
    for (const row of current || []) {
      const metadata = row?.metadata || {};
      const pageUrls = canonicalPages(metadata.page_image_urls);
      if (row.status !== 'review' || Number(metadata.page_count) !== EXPECTED_PAGES || !pageUrls || !officialPdf(row.source_document_url)) continue;
      return J({
        ok: true,
        adapter: ADAPTER,
        import_id: row.id,
        reused: true,
        reuse_mode: 'current-db-canonical',
        viewer_url: clean(metadata.viewer_url),
        pdf_url: clean(row.source_document_url),
        valid_from: row.detected_valid_from,
        valid_to: row.detected_valid_to,
        page_count: EXPECTED_PAGES,
        page_image_urls: pageUrls,
      });
    }

    const viewer = await currentViewer();
    const html = await text(viewer);
    const state = nextData(html)?.props?.pageProps?.__APOLLO_STATE__ || {};
    const leaflets = Object.values(state)
      .filter((v: any) => v?.__typename === 'Leaflet' && v?.type === 'HM' && Array.isArray(v?.pages))
      .sort((a: any, b: any) => String(b.validFrom || '').localeCompare(String(a.validFrom || ''))) as any[];
    const leaflet = leaflets[0];
    if (!leaflet) throw new Error('No HM leaflet in Apollo state');
    const validFrom = dateOnly(leaflet.validFrom);
    const validTo = dateOnly(leaflet.validTo);
    const pdf = clean(leaflet.leafletUrl);
    if (!validFrom || !validTo || validFrom > validTo) throw new Error('Invalid validity');
    if (!officialPdf(pdf)) throw new Error('Invalid Tesco PDF host');

    const pages = (leaflet.pages || [])
      .map(ref)
      .map((r: string) => state[r])
      .filter((p: any) => p?.__typename === 'LeafletMetadataPage')
      .map((p: any) => ({ page: Number(p.page), url: clean(p.pagePNG) }))
      .sort((a: any, b: any) => a.page - b.page);
    if (pages.length !== EXPECTED_PAGES) throw new Error(`Expected ${EXPECTED_PAGES} Tesco HM pages, got ${pages.length}`);
    if (new Set(pages.map((p: any) => p.page)).size !== EXPECTED_PAGES || pages.some((p: any, i: number) => p.page !== i + 1)) {
      throw new Error('Tesco page sequence is not contiguous');
    }
    const pageUrls = canonicalPages(pages.map((p: any) => p.url));
    if (!pageUrls) throw new Error('Invalid Tesco page image set');

    const hash = await sha([ADAPTER, leaflet.id, validFrom, validTo, pdf, ...pageUrls].join('|'));
    const { data: source, error: sre } = await db.from('leaflet_sources')
      .select('id').eq('store_id', store.id).eq('is_active', true)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (sre) throw sre;
    if (!source) throw new Error('Tesco source missing');

    const sourceHash = `tesco-ocr-source-${hash}`;
    const { data: existing, error: ee } = await db.from('leaflet_imports').select('id,status,metadata').eq('source_hash', sourceHash).maybeSingle();
    if (ee) throw ee;
    const metadata = {
      adapter: ADAPTER,
      verified_pipeline: true,
      structured_source: false,
      ocr_required: true,
      ocr_complete: false,
      ocr_engine: null,
      ocr_pages_expected: EXPECTED_PAGES,
      ocr_pages_completed: 0,
      page_count: EXPECTED_PAGES,
      page_image_urls: pageUrls,
      viewer_url: viewer,
      leaflet_id: Number(leaflet.id),
      pdf_url: pdf,
      source_contract: 'tesco-hm-apollo-page-images-v1',
    };

    let id = existing?.id || null;
    if (!id) {
      const { data: created, error: createError } = await db.from('leaflet_imports').insert({
        source_id: source.id,
        store_id: store.id,
        source_document_url: pdf,
        source_hash: sourceHash,
        status: 'review',
        product_count: 0,
        confidence: 1,
        detected_valid_from: validFrom,
        detected_valid_to: validTo,
        coverage_scope: 'national',
        metadata,
      }).select('id').single();
      if (createError) throw createError;
      id = created.id;
    } else {
      const old = existing?.metadata || {};
      const keepComplete = old?.ocr_complete === true && old?.ocr_engine && Number(old?.ocr_pages_completed) === EXPECTED_PAGES;
      const nextMeta = keepComplete
        ? { ...metadata, ocr_complete: true, ocr_engine: old.ocr_engine, ocr_pages_completed: old.ocr_pages_completed, ocr_completed_at: old.ocr_completed_at }
        : { ...metadata };
      const { error: updateError } = await db.from('leaflet_imports').update({
        status: 'review', product_count: 0, confidence: 1, detected_valid_from: validFrom, detected_valid_to: validTo, error_message: null, metadata: nextMeta,
      }).eq('id', id);
      if (updateError) throw updateError;
    }

    return J({
      ok: true,
      adapter: ADAPTER,
      import_id: id,
      reused: Boolean(existing),
      reuse_mode: existing ? 'source-hash' : 'created',
      viewer_url: viewer,
      pdf_url: pdf,
      valid_from: validFrom,
      valid_to: validTo,
      page_count: EXPECTED_PAGES,
      page_image_urls: pageUrls,
    });
  } catch (e) {
    return J({ ok: false, adapter: ADAPTER, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
