import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const SOURCE = 'https://www.pilulka.cz/kratka-expirace/nejlepsi';
const ADAPTER = 'pilulka-official-short-expiry-category-v3';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const HEADERS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret', 'content-type': 'application/json; charset=utf-8' };
const FETCH_HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; SlevaoBot/1.0; +https://slevao.cz)', accept: 'text/html,application/xhtml+xml', 'accept-language': 'cs-CZ,cs;q=0.9' };

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: HEADERS }); }
async function allowed(request: Request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE || (CRON && request.headers.get('x-cron-secret') === CRON)) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}
function decodeHtml(value: string) {
  return value.replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10)))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
}
function clean(value: string) { return decodeHtml(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function money(value: string) {
  const parsed = Number(clean(value).replace(/Kč/gi, '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}
function addDays(iso: string, days: number) { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
async function sha256(value: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
function quantity(title: string) { return title.match(/\b\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|ks|tobolek|tablet|sáčků)\b/iu)?.[0]?.replace(/\s+/g, ' ') || null; }
function identityTitle(cardTitle: string, href: string) {
  const title = clean(cardTitle);
  if (!/^\d/u.test(title)) return title;
  const slug = decodeURIComponent(href.split(/[?#]/, 1)[0].split('/').filter(Boolean).at(-1) || '');
  const parts = slug.split('-').filter(Boolean);
  const firstNumeric = parts.findIndex((part) => /\d/.test(part));
  if (firstNumeric < 1) return title;
  const prefixParts = parts.slice(0, firstNumeric).filter((part) => /^[a-z]{2,15}$/i.test(part));
  if (prefixParts.length !== firstNumeric || prefixParts.join('').length < 3) return title;
  const prefix = prefixParts.map((part) => part.length <= 3 ? part.toLocaleUpperCase('cs') : part).join(' ');
  return `${prefix} ${title}`;
}

function parsePage(html: string, today: string, page: number) {
  const blocks = html.split(/<div class="product-card__container" data-product-id="/).slice(1);
  const rows: any[] = [];
  for (const block of blocks) {
    const id = block.match(/^(\d+)"/)?.[1] || '';
    if (!block.includes('>Krátká expirace</div>')) continue;
    if (/Pilulka PRO|Cena s k[oó]dem|Dárek zdarma|při koupi|kupte \d|\d\+\d/iu.test(block)) continue;
    const href = decodeHtml(block.match(/product-card__img-container__link" href="([^"]+)"/)?.[1] || '');
    const image = decodeHtml(block.match(/<img srcset="([^" ]+)/)?.[1] || '');
    const currentText = block.match(/data-cy="current-price"[^>]*>([^<]+)<\/b>/)?.[1] || '';
    const oldText = block.match(/product-card-price__old[^>]*>([^<]+)<\/s>/)?.[1] || '';
    const discountText = block.match(/product-card-price__discount"[^>]*>\s*(-\d{1,2})\s*%/)?.[1] || '';
    const cardTitle = block.match(/product-card__title__name"[^>]*>([^<]+)<\/span>/)?.[1] || '';
    const title = identityTitle(cardTitle, href);
    const price = money(currentText);
    const oldPrice = money(oldText);
    const discount = Math.abs(Number(discountText));
    if (!/^\d+$/.test(id) || title.length < 4 || title.length > 180) continue;
    if (!href.startsWith('/') || !image.startsWith('https://pilulkacz.vshcdn.net/')) continue;
    if (price == null || oldPrice == null || price < 1 || price > 10000 || oldPrice <= price || oldPrice > 20000) continue;
    const calculated = Math.round((1 - price / oldPrice) * 100);
    if (!Number.isInteger(discount) || Math.abs(calculated - discount) > 1) continue;
    rows.push({
      external_id: `pilulka:short-expiry:${id}`, title, normalized_title: normalize(title), price, old_price: oldPrice,
      quantity_text: quantity(title), valid_from: today, valid_to: addDays(today, 1),
      source_url: `https://www.pilulka.cz${href}`, source_page: page, product_id: null, image_url: image, confidence: 0.99,
      metadata: { adapter: ADAPTER, parser_version: ADAPTER, pilulka_product_id: id, evidence: { official_short_expiry_tag: true, displayed_price: price, displayed_old_price: oldPrice, displayed_discount_percent: discount, calculated_discount_percent: calculated, conditional_promotions_rejected: true, title_completed_from_official_url: clean(cardTitle) !== title } },
    });
  }
  return rows;
}

function findBreadcrumbList(value: unknown): any | null {
  if (Array.isArray(value)) {
    for (const item of value) { const found = findBreadcrumbList(item); if (found) return found; }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const object = value as Record<string, unknown>;
  const type = object['@type'];
  const types = Array.isArray(type) ? type.map(String) : [String(type || '')];
  if (types.some((item) => item.toLowerCase() === 'breadcrumblist') && Array.isArray(object.itemListElement)) return object;
  for (const child of Object.values(object)) { const found = findBreadcrumbList(child); if (found) return found; }
  return null;
}
function jsonLdBreadcrumb(html: string): string[] {
  const scriptRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptRe)) {
    const raw = match[1].trim().replace(/^<!--|-->$/g, '').trim();
    for (const candidate of [raw, decodeHtml(raw)]) {
      try {
        const breadcrumb = findBreadcrumbList(JSON.parse(candidate));
        if (!breadcrumb) continue;
        const items = [...breadcrumb.itemListElement].sort((a: any, b: any) => Number(a?.position || 0) - Number(b?.position || 0));
        const names = items.map((item: any) => clean(String(item?.name || item?.item?.name || ''))).filter(Boolean);
        if (names.length) return names;
      } catch { /* try next representation */ }
    }
  }
  return [];
}
function visibleBreadcrumb(html: string): string[] {
  const match = html.match(/<(nav|ol|div)[^>]*(?:class|id)=["'][^"']*breadcrumb[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i);
  if (!match) return [];
  const block = match[2];
  const names: string[] = [];
  const itemRe = /<(?:a|li|span)[^>]*>([\s\S]*?)<\/(?:a|li|span)>/gi;
  for (const item of block.matchAll(itemRe)) {
    const value = clean(item[1]);
    if (value && !names.some((existing) => normalize(existing) === normalize(value))) names.push(value);
  }
  return names;
}
function categoryFromBreadcrumb(names: string[], title: string) {
  const result = names.map(clean).filter(Boolean);
  while (result.length && /^(domu|pilulka|pilulka cz|pilulka\.cz)$/i.test(normalize(result[0]))) result.shift();
  if (result.length && normalize(result.at(-1) || '') === normalize(title)) result.pop();
  while (result.length && /^(domu|pilulka|pilulka cz)$/i.test(normalize(result[0]))) result.shift();
  if (!result.length) return null;
  return { root: result[0], path: result.join(' > '), items: result };
}
async function fetchHtml(url: string) {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      if (html.length < 5000) throw new Error(`short HTML ${html.length}`);
      return html;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
async function enrichSourceCategories(rows: any[]) {
  let cursor = 0;
  const failures: Array<{ external_id: string; source_url: string; error: string }> = [];
  const workers = Array.from({ length: Math.min(6, rows.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= rows.length) return;
      const row = rows[index];
      try {
        const html = await fetchHtml(row.source_url);
        const jsonLd = jsonLdBreadcrumb(html);
        const visible = jsonLd.length ? [] : visibleBreadcrumb(html);
        const source = jsonLd.length ? 'jsonld-breadcrumb' : 'html-breadcrumb';
        const category = categoryFromBreadcrumb(jsonLd.length ? jsonLd : visible, row.title);
        if (!category) throw new Error('official breadcrumb category not found');
        row.metadata = {
          ...row.metadata,
          source_category_root: category.root,
          source_category_path: category.path,
          source_category_items: category.items,
          source_category_source: source,
        };
      } catch (error) {
        failures.push({ external_id: row.external_id, source_url: row.source_url, error: error instanceof Error ? error.message : String(error) });
      }
    }
  });
  await Promise.all(workers);
  if (failures.length) throw new Error(`Pilulka: kategorie chybí u ${failures.length}/${rows.length} produktů: ${failures.slice(0, 5).map((x) => `${x.external_id} ${x.error}`).join('; ')}`);
  return rows;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  try {
    const body = await request.json().catch(() => ({}));
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const pages: any[][] = [];
    for (let page = 1; page <= 5; page++) {
      const response = await fetch(`${SOURCE}?page=${page}`, { headers: FETCH_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Pilulka strana ${page} HTTP ${response.status}`);
      pages.push(parsePage(await response.text(), today, page));
    }
    let rows = [...new Map(pages.flat().map((row) => [row.external_id, row])).values()];
    if (rows.length < 30 || rows.length > 120) throw new Error(`Pilulka parser našel ${rows.length} bezpečných produktů; absolutní bezpečný rozsah je 30–120.`);

    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'pilulka').single();
    if (storeError || !store) throw new Error(storeError?.message || 'Pilulka nebyla nalezena.');
    const { count: previousCount, error: previousError } = await db.from('offers').select('id', { count: 'exact', head: true })
      .eq('store_id', store.id).eq('status', 'published').lte('valid_from', today).gte('valid_to', today);
    if (previousError) throw new Error(previousError.message);
    const previous = Number(previousCount || 0);
    const adaptiveMax = previous >= 30 ? Math.min(120, Math.max(90, Math.ceil(previous * 1.35))) : 120;
    if (rows.length > adaptiveMax) throw new Error(`Pilulka parser našel ${rows.length} bezpečných produktů; proti poslední aktuální sadě ${previous} je adaptivní maximum ${adaptiveMax}.`);

    rows = await enrichSourceCategories(rows);
    const signature = await sha256(rows.map((row) => `${row.external_id}|${row.price}|${row.old_price}|${row.valid_to}|${row.metadata.source_category_path}`).join('\n'));
    const { data: source } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).eq('source_url', SOURCE).maybeSingle();
    if (source) await db.from('leaflet_sources').update({ source_type: 'html', is_active: true, auto_publish: false, last_checked_at: new Date().toISOString(), last_error: null, adapter_key: ADAPTER, extraction_strategy: 'structured_html' }).eq('id', source.id);
    else {
      const { error } = await db.from('leaflet_sources').insert({ store_id: store.id, name: 'Pilulka krátká expirace', source_url: SOURCE, source_type: 'html', is_active: true, auto_publish: false, adapter_key: ADAPTER, extraction_strategy: 'structured_html' });
      if (error) throw new Error(error.message);
    }
    if (body.dry_run === true) return json({ ok: true, dry_run: true, pages: 5, previous_count: previous, adaptive_max: adaptiveMax, publishable: rows.length, signature, categories_complete: true, candidates: rows });
    const { data: result, error } = await db.rpc('publish_structured_store_offers_with_source_category', { p_store_slug: 'pilulka', p_adapter: ADAPTER, p_signature: signature, p_rows: rows, p_min_products: 30, p_max_products: 120, p_source_document_url: SOURCE, p_parser_version: ADAPTER });
    if (error) throw new Error(error.message);
    return json({ ok: true, store: store.name, previous_count: previous, adaptive_max: adaptiveMax, published: rows.length, signature, categories_complete: true, result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error), code: 'PILULKA_PRODUCTS_SYNC_FAILED' }, 500);
  }
});
