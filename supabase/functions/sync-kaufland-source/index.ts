import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const OFFER_URL = 'https://prodejny.kaufland.cz/nabidka/prehled.html?kloffer-week=current';
const SOURCE_URL = 'https://prodejny.kaufland.cz/letak.html';
const ADAPTER = 'kaufland-products-v4-ssr';
const PARSER_REV = 'kaufland-title-v9';
const IMAGE_OVERRIDES: Record<string, string> = {
  // Kaufland currently maps this Zlatopramen 11 can offer to a Krušovice PET image.
  '02312871': 'https://cdn.globusonline.cz/content/images/product/zlatopramen-11-pivo-lezak-svetly-plech-0-5-l_1250.jpg',
  '02312090': 'https://static-new.kosik.cz/k3wCdnContainerk3w-static-ne-cz-prod/images/thumbs/ln/600x600x1_lnow9maersia.png'
};
const MISASSIGNED_KAUFLAND_IMAGE = '8594009923191_CZ_P';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};
function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: CORS }); }
function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    const parts = [value.message, value.details, value.hint, value.code].filter(Boolean).map(String);
    if (parts.length) return parts.join(' | ');
    try { return JSON.stringify(error); } catch { return String(error); }
  }
  return String(error);
}
function decodeHtml(value: string) {
  return String(value || '').replace(/&amp;/gi, '&').replace(/&quot;|&#34;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;|&#160;/gi, ' ').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/\s+/g, ' ').trim();
}
function parseMoney(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}
function safeImage(value: unknown) {
  const raw = String(value || '').trim(); if (!raw) return null;
  try { const url = new URL(raw); return url.protocol === 'https:' && ['kaufland.media.schwarz', 'media.kaufland.com'].includes(url.hostname) ? url.toString() : null; } catch { return null; }
}
function normalize(value: string) {
  return decodeHtml(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const GENERIC_DETAIL = /^(?:různé druhy|mix druhů|více druhů|dle výběru|různé barvy|v různých barvách|různá provedení|i\.? jakost)$/i;
function cleanProductPart(value: string) {
  return decodeHtml(value)
    .replace(/^K-Mistři od fochu\s+/i, '')
    .replace(/\s*,?\s*(?:pultový|samoobslužný)\s+prodej\s*$/i, '')
    .replace(/(?:^|[\s,;/|-]+)(?:různé druhy|mix druhů|více druhů|dle výběru|různé barvy|v různých barvách|různá provedení)(?=$|[\s,;/|-]+)/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[,;/|\-–]+|[,;/|\-–]+$/g, '')
    .trim();
}
function meaningful(value: string) {
  const clean = cleanProductPart(value);
  return clean.length >= 2 && !GENERIC_DETAIL.test(clean);
}
function mergeProductParts(left: string, right: string) {
  const a = cleanProductPart(left);
  const b = cleanProductPart(right);
  if (!a) return b;
  if (!b) return a;
  const na = normalize(a);
  const nb = normalize(b);
  if (!na) return b;
  if (!nb) return a;
  if (na === nb) return a.length >= b.length ? a : b;
  if (na.includes(nb)) return a;
  if (nb.includes(na)) return b;
  return `${a} ${b}`.replace(/\s+/g, ' ').trim();
}
function normalizedOfferPricing(description: string, rawPrice: number, rawOldPrice: number | null) {
  const match = description.match(/při\s+koupi\s+(\d+)\s+kus(?:ů|u)?[\s\S]*?za\s+1\s+kus\s+(\d+(?:[.,]\d+)?)\s*kč/i);
  if (!match) return { price: rawPrice, oldPrice: rawOldPrice, multibuyCount: null };
  const count = Number(match[1]);
  const itemPrice = Number(match[2].replace(',', '.'));
  if (!(count > 1) || !(itemPrice > 0) || Math.abs(rawPrice - itemPrice * count) > 1) {
    return { price: rawPrice, oldPrice: rawOldPrice, multibuyCount: null };
  }
  return {
    price: itemPrice,
    oldPrice: rawOldPrice && rawOldPrice > itemPrice ? Number((rawOldPrice / count).toFixed(2)) : rawOldPrice,
    multibuyCount: count
  };
}

function productTitle(description: string, detailTitle: string, title: string, subtitle: string, unit: string) {
  const main = meaningful(title) ? cleanProductPart(title) : '';
  const sub = meaningful(subtitle) ? cleanProductPart(subtitle) : '';
  const detail = meaningful(detailTitle) ? cleanProductPart(detailTitle) : '';
  const desc = meaningful(description) ? cleanProductPart(description) : '';

  let value = mergeProductParts(main, sub);
  if (!value) value = mergeProductParts(main, detail);
  if (!value) value = mergeProductParts(detail, desc);
  if (value && detail && normalize(value).length < 8) value = mergeProductParts(value, detail);
  if (!value) value = main || detail || sub || desc;
  if (!value) return '';

  if (unit) value = value.replace(new RegExp(`\s+${escapeRegExp(unit)}$`, 'i'), '').trim();
  return value;
}
function sameIdentity(left: string, right: string) {
  const a = normalize(left); const b = normalize(right); return a === b || (a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a)));
}
function pragueDate(offsetDays = 0) {
  const target = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(target);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`;
}
async function sha256(value: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
async function allowed(request: Request) {
  const authorization = request.headers.get('authorization') || ''; const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE_ROLE_KEY) return true; if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return true; if (!token) return false;
  const { data } = await db.auth.getUser(token); return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}
async function fetchOfferHtml() {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 45_000);
  try { const response = await fetch(OFFER_URL, { headers: HEADERS, redirect: 'follow', signal: controller.signal }); const html = await response.text();
    if (!response.ok) throw new Error(`Kaufland nabídka HTTP ${response.status}`); if (html.length < 100_000) throw new Error(`Kaufland vrátil podezřele krátkou stránku (${html.length} znaků).`); return { response, html }; }
  finally { clearTimeout(timer); }
}
function findTemplate(value: any): any | null { if (!value || typeof value !== 'object') return null; if (value.component === 'OfferTemplate' && value.props?.offerData) return value; for (const child of Object.values(value)) { const found = findTemplate(child); if (found) return found; } return null; }
function parseProducts(html: string) {
  let template: any | null = null;
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1]; if (!body.includes('OfferTemplate') || !body.includes('offerData')) continue;
    const marker = body.match(/window\.SSR\[[^\]]+\]\s*=/); if (!marker || marker.index === undefined) continue;
    const raw = body.slice(marker.index + marker[0].length).trim().replace(/;\s*$/, '');
    try { template = findTemplate(JSON.parse(raw)); if (template) break; } catch {}
  }
  if (!template) throw new Error('Kaufland změnil SSR strukturu: OfferTemplate nebyl nalezen.');
  const result: any[] = []; const seen = new Set<string>(); const klIdentities = new Map<string, string>();
  for (const cycle of Array.isArray(template.props?.offerData?.cycles) ? template.props.offerData.cycles : []) {
    for (const category of Array.isArray(cycle?.categories) ? cycle.categories : []) {
      for (const item of Array.isArray(category?.offers) ? category.offers : []) {
        const offerId = String(item?.offerId || '').trim(); const dateFrom = String(item?.dateFrom || category?.dateFrom || '').trim(); const dateTo = String(item?.dateTo || category?.dateTo || '').trim(); const price = parseMoney(item?.price);
        if (!offerId || seen.has(offerId) || !/^20\d{2}-\d{2}-\d{2}$/.test(dateFrom) || !/^20\d{2}-\d{2}-\d{2}$/.test(dateTo) || !(Number(price) > 0)) continue;
        const title = decodeHtml(String(item?.title || '').trim()); const subtitle = decodeHtml(String(item?.subtitle || '').trim());
        const detailTitle = decodeHtml(String(item?.detailTitle || '').replace(/\\n/g, ' ')); const detailDescription = decodeHtml(String(item?.detailDescription || '').replace(/\\n/g, ' ')); const unit = decodeHtml(String(item?.unit || '').trim());
        const identityTitle = productTitle(detailDescription, detailTitle, title, subtitle, unit); const klNr = String(item?.klNr || '').trim() || null; if (!identityTitle) continue;
        if (klNr) { const previous = klIdentities.get(klNr); if (previous && !sameIdentity(previous, identityTitle)) throw new Error(`Kaufland klNr ${klNr} má dvě rozdílné identity: "${previous}" a "${identityTitle}".`); klIdentities.set(klNr, identityTitle); }
        const pricing = normalizedOfferPricing(detailDescription, Number(price), parseMoney(item?.formattedOldPrice));
        result.push({ offerId, dateFrom, dateTo, title, subtitle, detailTitle, productTitle: identityTitle, detailDescription, price: pricing.price, oldPrice: pricing.oldPrice, multibuyCount: pricing.multibuyCount, discount: Number.isFinite(Number(item?.discount)) ? Number(item.discount) : null, unit, basePrice: decodeHtml(String(item?.formattedBasePrice || item?.basePrice || '').trim()), imageUrl: IMAGE_OVERRIDES[klNr || ''] || (() => {
          const candidate = safeImage(item?.detailImages?.[0] || item?.listImage);
          return candidate?.includes(MISASSIGNED_KAUFLAND_IMAGE) && !normalize(identityTitle).includes('krusovice') ? null : candidate;
        })(), klNr, label: String(item?.label || '').trim() || null, categoryName: String(category?.name || '').trim(), categoryDisplayName: decodeHtml(String(category?.displayName || '').trim()) }); seen.add(offerId);
      }
    }
  }
  const today = pragueDate(); const current = result.filter((product) => product.dateTo >= today);
  if (current.length < 50) throw new Error(`Kaufland vrátil pouze ${current.length} platných produktů; stará data zůstala zachována.`);
  const meaningfulCount = current.filter((row) => row.klNr && row.productTitle && !GENERIC_DETAIL.test(row.productTitle)).length;
  if (meaningfulCount < Math.floor(current.length * 0.9)) throw new Error(`Kaufland má jen ${meaningfulCount}/${current.length} produktů s klNr a skutečným názvem.`); return current;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS }); if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405); if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  const checkedAt = new Date().toISOString(); const startedAt = Date.now(); let stage = 'start'; let storeId = ''; let auditId = '';
  try {
    stage = 'load_store'; const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'kaufland').single(); if (storeError || !store) throw storeError || new Error('Kaufland nebyl nalezen.'); storeId = store.id;
    stage = 'load_source'; const { data: source, error: sourceError } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).eq('source_url', SOURCE_URL).eq('is_active', true).single(); if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj Kaufland nebyl nalezen.');
    stage = 'lock'; await db.rpc('release_stale_product_sync_locks'); const { data: state, error: stateError } = await db.from('store_product_sync_state').select('is_running,last_offer_count,last_source_signature,last_import_id,last_valid_from,last_valid_to').eq('store_id', store.id).maybeSingle(); if (stateError) throw stateError; if (state?.is_running) throw new Error('Synchronizace Kaufland už právě běží.');
    const { error: lockError } = await db.from('store_product_sync_state').upsert({ store_id: store.id, is_running: true, run_started_at: checkedAt, last_run_at: checkedAt, parser_version: PARSER_REV, adapter_name: 'sync-kaufland-source', adapter_version: ADAPTER, last_error: null, last_parser_error: null }, { onConflict: 'store_id' }); if (lockError) throw lockError;
    stage = 'audit'; const { data: audit, error: auditError } = await db.from('kaufland_product_sync_audit').insert({ source_url: OFFER_URL, status: 'running' }).select('id').single(); if (auditError || !audit) throw auditError || new Error('Audit Kaufland nešel založit.'); auditId = audit.id;
    stage = 'fetch_products'; const { response, html } = await fetchOfferHtml(); stage = 'parse_products'; const products = parseProducts(html);
    const signature = await sha256(products.map((product) => `${ADAPTER}|${PARSER_REV}|${product.offerId}|${product.klNr || ''}|${product.productTitle}|${product.unit || ''}|${product.dateFrom}|${product.dateTo}|${product.price}|${product.oldPrice || ''}`).sort().join('\n'));
    const validFrom = products.map((product) => product.dateFrom).sort()[0]; const validTo = products.map((product) => product.dateTo).sort().at(-1)!;
    stage = 'check_existing'; const today = pragueDate(); const { count: currentOfferCount, error: countError } = await db.from('offers').select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('status', 'published').gte('valid_to', today).not('external_id', 'is', null); if (countError) throw countError;
    const liveCount = Number(currentOfferCount || 0);
    const previousCount = Number(state?.last_offer_count || 0);
    const sourceMinimum = Math.max(50, Math.floor(products.length * 0.9));
    const unchanged = state?.last_source_signature === signature && Boolean(state?.last_import_id) && liveCount >= sourceMinimum;
    await db.from('kaufland_product_sync_audit').update({
      http_status: response.status,
      html_length: html.length,
      product_candidates: products.length,
      parsed_products: products.length,
      metadata: {
        parser_version: PARSER_REV,
        adapter: ADAPTER,
        source_signature: signature,
        live_offer_count: liveCount,
        historical_offer_count: previousCount,
        validity: { from: validFrom, to: validTo },
        diagnostic_stage: 'check_existing'
      }
    }).eq('id', auditId);
    if (unchanged) {
      const published = liveCount;
      await db.from('kaufland_product_sync_audit').update({ status: 'completed', http_status: response.status, html_length: html.length, product_candidates: products.length, parsed_products: products.length, published_offers: published, metadata: { parser_version: PARSER_REV, adapter: ADAPTER, source_signature: signature, import_id: state.last_import_id, no_changes: true, live_offer_count: liveCount, historical_offer_count: previousCount, validity: { from: validFrom, to: validTo } } }).eq('id', auditId);
      await db.from('store_product_sync_state').upsert({ store_id: store.id, is_running: false, run_started_at: null, last_run_at: checkedAt, last_success_at: checkedAt, last_source_signature: signature, last_offer_count: published, expected_offer_count: products.length, last_published_count: published, last_valid_from: validFrom, last_valid_to: validTo, parser_version: PARSER_REV, adapter_name: 'sync-kaufland-source', adapter_version: ADAPTER, last_audit_id: auditId, last_http_status: response.status, last_html_length: html.length, last_duration_ms: Date.now() - startedAt, last_error: null, last_parser_error: null, health_status: 'ok', health_reason: `Oficiální nabídka se nezměnila; ověřeno ${published} produktů přes ${PARSER_REV}.` }, { onConflict: 'store_id' });
      await db.from('leaflet_sources').update({ last_checked_at: checkedAt, last_success_at: checkedAt, last_error: null, last_strategy_used: 'official_ssr_products_unchanged', last_strategy_success_at: checkedAt }).eq('id', source.id);
      return json({ ok: true, self_published: true, no_changes: true, store: store.name, parser_revision: PARSER_REV, import_id: state.last_import_id, parsed_products: products.length, published_products: published, valid_from: validFrom, valid_to: validTo });
    }
    if (liveCount >= 50 && products.length < Math.floor(liveCount * 0.6)) throw new Error(`Kaufland vrátil ${products.length} produktů oproti ${liveCount} aktuálně platným produktům; výměna byla zastavena.`);
    stage = 'prepare_import'; const sourceHash = await sha256(`${source.id}|${signature}|${ADAPTER}|${PARSER_REV}`); const metadata = { adapter: ADAPTER, parser_revision: PARSER_REV, title: 'Kaufland – aktuální produktová nabídka', document_type: 'product_data', hide_from_leaflet_feed: true, source_page: OFFER_URL, source_signature: signature, parsed_count: products.length, last_seen_at: checkedAt };
    const { data: existingImport, error: importLookupError } = await db.from('leaflet_imports').select('id').eq('source_hash', sourceHash).maybeSingle(); if (importLookupError) throw importLookupError; let importId = existingImport?.id || '';
    if (existingImport) { const { error } = await db.from('leaflet_imports').update({ status: 'processing', product_count: products.length, detected_valid_from: validFrom, detected_valid_to: validTo, error_message: null, metadata, updated_at: checkedAt }).eq('id', existingImport.id); if (error) throw error; }
    else { const { data: created, error } = await db.from('leaflet_imports').insert({ source_id: source.id, store_id: store.id, source_document_url: OFFER_URL, source_hash: sourceHash, status: 'processing', product_count: products.length, confidence: 0.99, coverage_scope: 'national', detected_valid_from: validFrom, detected_valid_to: validTo, started_at: checkedAt, metadata }).select('id').single(); if (error || !created) throw error || new Error('Produktový import Kaufland nešel založit.'); importId = created.id; }
    stage = 'atomic_publish'; const { data: applied, error: applyError } = await db.rpc('apply_kaufland_official_offers', { p_store_id: store.id, p_import_id: importId, p_signature: signature, p_offers: products }); if (applyError) throw applyError; const published = Number(applied?.published || 0);
    stage = 'finish'; await db.from('kaufland_product_sync_audit').update({ status: 'completed', http_status: response.status, html_length: html.length, product_candidates: products.length, parsed_products: products.length, published_offers: published, metadata: { parser_version: PARSER_REV, adapter: ADAPTER, source_signature: signature, import_id: importId, result: applied, live_offer_count: liveCount, historical_offer_count: previousCount, validity: { from: validFrom, to: validTo } } }).eq('id', auditId);
    await db.from('store_product_sync_state').upsert({ store_id: store.id, is_running: false, run_started_at: null, last_run_at: checkedAt, last_success_at: checkedAt, last_source_signature: signature, source_fingerprint: signature, product_set_hash: signature, last_offer_count: published, expected_offer_count: products.length, last_published_count: published, last_valid_from: validFrom, last_valid_to: validTo, parser_version: PARSER_REV, adapter_name: 'sync-kaufland-source', adapter_version: ADAPTER, source_type: 'official-ssr-json', source_category: 'current-week', last_import_id: importId, last_audit_id: auditId, last_http_status: response.status, last_html_length: html.length, last_duration_ms: Date.now() - startedAt, last_error: null, last_parser_error: null, health_status: 'ok', health_reason: `Automaticky publikováno ${published}/${products.length} produktů přes ${PARSER_REV}.` }, { onConflict: 'store_id' });
    await db.from('leaflet_sources').update({ last_checked_at: checkedAt, last_success_at: checkedAt, last_error: null, last_strategy_used: 'official_ssr_products', last_strategy_success_at: checkedAt }).eq('id', source.id);
    return json({ ok: true, self_published: true, no_changes: false, store: store.name, adapter: ADAPTER, parser_revision: PARSER_REV, import_id: importId, parsed_products: products.length, published_products: published, expired_old_offers: Number(applied?.expired || 0), valid_from: validFrom, valid_to: validTo });
  } catch (error) {
    const message = `${stage}: ${formatError(error)}`; console.error('sync-kaufland-source failed', { stage, error: formatError(error) });
    if (auditId) await db.from('kaufland_product_sync_audit').update({ status: 'failed', error_message: message }).eq('id', auditId);
    if (storeId) await db.from('store_product_sync_state').upsert({ store_id: storeId, is_running: false, run_started_at: null, last_run_at: checkedAt, last_error: message, last_parser_error: message, health_status: 'error', health_reason: message, last_duration_ms: Date.now() - startedAt }, { onConflict: 'store_id' });
    return json({ error: message }, 500);
  }
});