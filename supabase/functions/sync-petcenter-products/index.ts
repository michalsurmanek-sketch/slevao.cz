import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const SOURCE = 'https://www.petcenter.cz/vyprodej/';
const ADAPTER = 'petcenter-official-clearance-html-v2';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const HEADERS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret', 'content-type': 'application/json; charset=utf-8' };
const FETCH_HEADERS = { 'user-agent': 'Mozilla/5.0', accept: 'text/html', 'accept-language': 'cs-CZ,cs;q=0.9' };

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: HEADERS }); }
async function allowed(request: Request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE || (CRON && request.headers.get('x-cron-secret') === CRON)) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}
function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function todayPrague() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function addDays(iso: string, days: number) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
    aacute: 'á', Aacute: 'Á', ccaron: 'č', Ccaron: 'Č', dcaron: 'ď', Dcaron: 'Ď',
    eacute: 'é', Eacute: 'É', ecaron: 'ě', Ecaron: 'Ě', iacute: 'í', Iacute: 'Í',
    ncaron: 'ň', Ncaron: 'Ň', oacute: 'ó', Oacute: 'Ó', rcaron: 'ř', Rcaron: 'Ř',
    scaron: 'š', Scaron: 'Š', tcaron: 'ť', Tcaron: 'Ť', uacute: 'ú', Uacute: 'Ú',
    uring: 'ů', Uring: 'Ů', yacute: 'ý', Yacute: 'Ý', zcaron: 'ž', Zcaron: 'Ž',
  };
  return value.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name] ?? entity);
}
function money(value: string) {
  const parsed = Number(value.replace(/\./g, '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function pageCountFromHtml(html: string) {
  const match = decodeHtml(html).match(/Nacházíte se na straně\s+\d+\s+z\s+(\d+)\./i);
  const count = match ? Number(match[1]) : 1;
  if (!Number.isInteger(count) || count < 1 || count > 40) throw new Error(`PetCenter neplatný počet stran: ${String(match?.[1] || '')}`);
  return count;
}
async function fetchPage(page: number) {
  const pageUrl = page === 1 ? SOURCE : `${SOURCE}strana-${page}/`;
  const response = await fetch(pageUrl, { headers: FETCH_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  const html = await response.text();
  if (!response.ok) throw new Error(`PetCenter strana ${page} HTTP ${response.status}`);
  if (!html.includes('data-testid="productCards"') && !html.includes('data-micro="product"')) throw new Error(`PetCenter strana ${page} neobsahuje produktový výpis.`);
  return { page, pageUrl, finalUrl: response.url, html };
}
function parseProducts(html: string, today: string, page: number) {
  const blocks = html.split('<div class="p" data-micro="product"').slice(1);
  const rows: any[] = [];
  const candidateIds = new Set<string>();
  for (const block of blocks) {
    const id = block.match(/data-micro-product-id="([0-9]+)"/)?.[1] || '';
    const structuralCandidate = block.includes('flag-vyprodej')
      && block.includes('data-micro-availability="https://schema.org/InStock"')
      && block.includes('class="price-standard"')
      && /name="amount"[\s\S]{0,500}value="1"/.test(block)
      && /data-micro-price="[0-9.]+"/.test(block);
    if (structuralCandidate && /^[0-9]{2,}$/.test(id)) candidateIds.add(id);
    if (!structuralCandidate) continue;

    const rawTitle = block.match(/data-testid="productCardName">([\s\S]*?)<\/span>/)?.[1] || '';
    const title = decodeHtml(rawTitle.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const image = decodeHtml(block.match(/data-micro-image="(https:\/\/cdn\.myshoptet\.com\/[^"]+)"/)?.[1] || '').replace(/\s+/g, '');
    const relativeHref = decodeHtml(block.match(/<a\s+href="([^"]+)"\s+class="image"/)?.[1] || '');
    const priceText = block.match(/data-micro-price="([0-9.]+)"/)?.[1] || '';
    const oldText = block.match(/class="price-standard">[\s\S]*?<strong>\s*([0-9.\s,]+)\s*Kč\s*<\/strong>/)?.[1] || '';
    const price = Number(priceText);
    const oldPrice = money(oldText);
    if (!/^[0-9]{2,}$/.test(id) || title.length < 4 || title.length > 180) continue;
    if (!relativeHref.startsWith('/') || !image.startsWith('https://cdn.myshoptet.com/')) continue;
    if (!Number.isFinite(price) || oldPrice == null || price < 1 || price > 30000 || oldPrice <= price || oldPrice > 50000) continue;
    const href = `https://www.petcenter.cz${relativeHref}`;
    rows.push({
      external_id: `petcenter:${id}`, title, normalized_title: normalize(title), price, old_price: oldPrice, quantity_text: null,
      valid_from: today, valid_to: addDays(today, 1), source_url: href, source_page: page, product_id: null, image_url: image, confidence: 0.99,
      metadata: { adapter: ADAPTER, parser_version: ADAPTER, petcenter_product_id: id, evidence: { official_clearance_flag: true, current_price: price, regular_price: oldPrice, in_stock: true, minimum_quantity: 1, structural_candidate: true } },
    });
  }
  return { rows, candidateIds, productBlocks: blocks.length };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  let storeId: string | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    const today = todayPrague();
    const first = await fetchPage(1);
    const totalPages = pageCountFromHtml(first.html);
    const rest = totalPages > 1 ? await Promise.all(Array.from({ length: totalPages - 1 }, (_, i) => fetchPage(i + 2))) : [];
    const pages = [first, ...rest].sort((a, b) => a.page - b.page);

    const parsed = pages.map((entry) => ({ ...entry, parsed: parseProducts(entry.html, today, entry.page) }));
    const candidateIds = new Set<string>();
    let productBlocks = 0;
    const rawRows: any[] = [];
    for (const entry of parsed) {
      productBlocks += entry.parsed.productBlocks;
      for (const id of entry.parsed.candidateIds) candidateIds.add(id);
      rawRows.push(...entry.parsed.rows);
    }
    const rows = [...new Map(rawRows.map((row) => [row.external_id, row])).values()];
    const rowIds = new Set(rows.map((row) => String(row.external_id).replace(/^petcenter:/, '')));
    if (productBlocks < 1) throw new Error('PetCenter nevrátil žádné produktové karty.');
    if (candidateIds.size < 1) throw new Error(`PetCenter aktuálně nemá žádný skladový výprodejový produkt s ověřitelnou původní cenou; zkontrolováno ${productBlocks} karet na ${totalPages} stranách.`);
    if (rows.length !== candidateIds.size || [...candidateIds].some((id) => !rowIds.has(id))) {
      throw new Error(`PetCenter parser pokryl ${rows.length}/${candidateIds.size} strukturálně ověřitelných slevových produktů.`);
    }
    if (rows.length > 500) throw new Error(`PetCenter parser našel podezřele mnoho ověřitelných slev: ${rows.length}.`);

    const signature = await sha256(rows.map((row) => `${row.external_id}|${row.title}|${row.price}|${row.old_price}|${row.valid_to}`).sort().join('\n'));
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'petcenter').single();
    if (storeError || !store) throw storeError || new Error('PetCenter nebyl nalezen.');
    storeId = String(store.id);
    const { data: existingSource } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).limit(1).maybeSingle();
    const now = new Date().toISOString();
    if (existingSource) {
      await db.from('leaflet_sources').update({ source_url: SOURCE, source_type: 'html', is_active: true, auto_publish: false, last_checked_at: now, last_success_at: now, last_error: null, adapter_key: ADAPTER, extraction_strategy: 'structured_html', last_strategy_used: ADAPTER, last_strategy_success_at: now }).eq('id', existingSource.id);
    } else {
      const { error } = await db.from('leaflet_sources').insert({ store_id: store.id, name: 'PetCenter Výprodej', source_url: SOURCE, source_type: 'html', is_active: true, auto_publish: false, adapter_key: ADAPTER, extraction_strategy: 'structured_html', last_checked_at: now, last_success_at: now, last_strategy_used: ADAPTER, last_strategy_success_at: now });
      if (error) throw error;
    }
    const diagnostics = { pages: totalPages, product_blocks: productBlocks, verified_discount_candidates: candidateIds.size, coverage: `${rows.length}/${candidateIds.size}` };
    if (body.dry_run === true) return json({ ok: true, dry_run: true, publishable: rows.length, signature, diagnostics, candidates: rows });
    const { data: result, error: publishError } = await db.rpc('publish_structured_store_offers', { p_store_slug: 'petcenter', p_adapter: ADAPTER, p_signature: signature, p_rows: rows, p_min_products: 1, p_max_products: 500, p_source_document_url: SOURCE, p_parser_version: ADAPTER });
    if (publishError) throw publishError;
    return json({ ok: true, store: store.name, published: rows.length, signature, diagnostics, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const now = new Date().toISOString();
    try {
      if (!storeId) {
        const { data: store } = await db.from('stores').select('id').eq('slug', 'petcenter').maybeSingle();
        storeId = store?.id ? String(store.id) : null;
      }
      if (storeId) {
        await db.from('store_product_sync_state').upsert({
          store_id: storeId,
          last_run_at: now,
          is_running: false,
          run_started_at: null,
          last_error: message.slice(0, 2000),
          last_parser_error: message.slice(0, 2000),
          health_status: 'error',
          health_reason: 'PetCenter produktový sync selhal; poslední ověřené nabídky zůstaly zachované.',
          updated_at: now,
        }, { onConflict: 'store_id' });
      }
    } catch {
      // Do not mask the original parser/source failure.
    }
    return json({ error: message, code: 'PETCENTER_PRODUCTS_SYNC_FAILED' }, 500);
  }
});