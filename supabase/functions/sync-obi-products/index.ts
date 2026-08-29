import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'content-type': 'application/json; charset=utf-8',
};
const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};
const PARSER = 'obi-pdf-spatial-v1';
type Token = { text: string; x: number; y: number; width: number; height: number };
type Page = { page: number; tokens: Token[] };

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: CORS }); }

async function allowed(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE_ROLE_KEY) return true;
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}

function decodeHtml(value: string) {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return String(value || '')
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replace(/&([a-z]+);/gi, (all, name) => named[name.toLowerCase()] ?? all)
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function metaContent(html: string, key: string) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const property = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (property?.toLowerCase() !== key.toLowerCase()) continue;
    const content = tag.match(/content\s*=\s*["']([^"']+)["']/i)?.[1];
    if (content) return decodeHtml(content);
  }
  return '';
}

function productTitle(html: string) {
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '';
  return (decodeHtml(heading) || metaContent(html, 'og:title')).replace(/\s*[|–-]\s*OBI\s*$/i, '').trim();
}

function clean(value: unknown) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function parseSku(text: string) { return text.match(/^OBI č\.\s*(\d{7})(?:\s|$)/i)?.[1] || null; }
function parsePrice(text: string) {
  const match = text.match(/^(\d{1,3}(?:[ .]\d{3})*),-$/);
  if (!match) return null;
  const value = Number(match[1].replace(/[ .]/g, ''));
  return Number.isFinite(value) && value >= 20 && value <= 100000 ? value : null;
}
function badContext(text: string) { return /(bez aplikace heyOBI|heyOBI|paletov[aá] cena|při koupi|od \d|za \d+ ks|pronájem|Kč\/(?:kg|m|m2|m²|l)|\bAKCE\b.*\bden)/i.test(text); }
function badTitle(text: string) {
  return text.length < 6 || text.length > 100 || !/[A-Za-zÁ-ž]/u.test(text) || /[*]|OBI č\.|cena|nabídka|sleva|aplikace|palet/i.test(text)
    || /^(?:bez|pro|při|od|včetně|barva|rozměr|balení|výhodné)/i.test(text);
}
function extract(pages: Page[], validFrom: string, validTo: string, sourceUrl: string) {
  const candidates: any[] = [];
  const rejected: any[] = [];
  for (const page of pages) {
    const tokens = (page.tokens || []).map((token) => ({ ...token, text: clean(token.text) }));
    for (const skuToken of tokens) {
      const sku = parseSku(skuToken.text);
      if (!sku || /\baj\./i.test(skuToken.text)) continue;
      const local = tokens.filter((t) => Math.abs(t.x - skuToken.x) <= 105 && Math.abs(t.y - skuToken.y) <= 150);
      const context = local.map((t) => t.text).join(' ');
      if (badContext(context)) { rejected.push({ page: page.page, sku, reason: 'conditional_context' }); continue; }
      const prices = local.filter((t) => parsePrice(t.text) !== null && Number(t.height) >= 14)
        .sort((a, b) => Math.abs(a.x - skuToken.x) + Math.abs(a.y - skuToken.y) - Math.abs(b.x - skuToken.x) - Math.abs(b.y - skuToken.y));
      if (prices.length !== 1) { rejected.push({ page: page.page, sku, reason: prices.length ? 'ambiguous_price' : 'missing_price' }); continue; }
      const priceToken = prices[0];
      const price = parsePrice(priceToken.text)!;
      const titleTokens = local.filter((t) => Number(t.height) >= 9.5 && Number(t.height) <= 15 && !badTitle(t.text)
        && t.y > skuToken.y && t.y <= skuToken.y + 90 && Math.abs(t.x - skuToken.x) <= 35).sort((a, b) => b.y - a.y);
      if (!titleTokens.length) { rejected.push({ page: page.page, sku, reason: 'missing_title' }); continue; }
      const anchor = titleTokens[0];
      const title = clean(tokens.filter((t) => Number(t.height) >= 9.5 && Number(t.height) <= 15 && Math.abs(t.x - anchor.x) <= 7 && Math.abs(t.y - anchor.y) <= 20 && !badTitle(t.text)).sort((a, b) => b.y - a.y).map((t) => t.text).join(' '));
      if (badTitle(title)) continue;
      candidates.push({ external_id: `obi:${sku}:${validFrom}:${validTo}`, title, normalized_title: normalize(title), price, old_price: null,
        valid_from: validFrom, valid_to: validTo, source_url: sourceUrl, source_page: Number(page.page),
        metadata: { adapter: PARSER, parser_version: PARSER, obi_sku: sku } });
    }
  }
  const unique = new Map<string, any>();
  for (const row of candidates) if (!unique.has(row.external_id)) unique.set(row.external_id, row);
  return { rows: [...unique.values()].sort((a, b) => a.source_page - b.source_page), rejected };
}

async function fetchProduct(sku: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`https://www.obi.cz/p/${sku}`, { headers: BROWSER_HEADERS, redirect: 'follow', signal: controller.signal });
    const html = await response.text();
    if (!response.ok) throw new Error(`OBI HTTP ${response.status}`);
    if (!new RegExp(`Číslo\\s+výrobku(?:&nbsp;|\\s)*${sku}`, 'i').test(html)) throw new Error('Produktová stránka nepotvrdila číslo výrobku.');
    const title = productTitle(html);
    const imageUrl = metaContent(html, 'og:image');
    if (title.length < 5 || /^OBI\s+č\./i.test(title)) throw new Error('OBI nevrátilo platný název.');
    if (!/^https:\/\//i.test(imageUrl)) throw new Error('OBI nevrátilo produktovou fotografii.');
    return { sku, title, imageUrl, url: response.url };
  } finally { clearTimeout(timer); }
}

async function resolveProduct(sku: string, title: string, imageUrl: string) {
  const { data: existing, error: findError } = await db.from('products').select('id,metadata').contains('metadata', { obi_article_number: sku }).maybeSingle();
  if (findError) throw findError;
  const metadata = { ...(existing?.metadata || {}), source_store_slug: 'obi', obi_article_number: sku, official_product_url: `https://www.obi.cz/p/${sku}`, structured_source: 'obi-product-page-v1' };
  if (existing?.id) {
    const { error } = await db.from('products').update({ name: title, image_url: imageUrl, image_source: 'official_obi_product_page', image_quality: 95, image_verified: true, is_verified: true, metadata }).eq('id', existing.id);
    if (error) throw error;
    return existing.id;
  }
  const { data: created, error } = await db.from('products').insert({ name: title, image_url: imageUrl, image_source: 'official_obi_product_page', image_quality: 95, image_verified: true, is_verified: true, metadata }).select('id').single();
  if (error || !created) throw error || new Error('Produkt se nepodařilo uložit.');
  return created.id;
}

async function upsertOffer(storeId: string, importRow: any, item: any, product: any, productId: string) {
  const { data: existing, error: findError } = await db.from('offers').select('id').eq('store_id', storeId).eq('product_id', productId).eq('valid_from', importRow.detected_valid_from).eq('valid_to', importRow.detected_valid_to).maybeSingle();
  if (findError) throw findError;
  const payload = {
    product_id: productId, store_id: storeId, title: product.title, price: Number(item.price), old_price: item.old_price ? Number(item.old_price) : null,
    image_url: product.imageUrl, valid_from: importRow.detected_valid_from, valid_to: importRow.detected_valid_to, status: 'published', is_verified: true,
    published_at: new Date().toISOString(), coverage_scope: importRow.coverage_scope || 'national',
    metadata: { import_id: importRow.id, obi_article_number: product.sku, official_product_url: product.url, structured_source: 'obi-product-page-v1', leaflet_page: item.source_page || null, leaflet_document_url: importRow.source_document_url },
  };
  if (existing?.id) {
    const { error } = await db.from('offers').update(payload).eq('id', existing.id);
    if (error) throw error;
    return existing.id;
  }
  const { data: created, error } = await db.from('offers').insert(payload).select('id').single();
  if (error || !created) throw error || new Error('Nabídku se nepodařilo uložit.');
  return created.id;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  try {
    const today = new Date().toISOString().slice(0, 10);
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'obi').single();
    if (storeError || !store) throw storeError || new Error('OBI nebylo nalezeno.');
    const { data: importRow, error: importError } = await db.from('leaflet_imports').select('*').eq('store_id', store.id).eq('metadata->>adapter', 'obi-bonial-v1').gte('detected_valid_to', today).order('detected_valid_from', { ascending: false }).order('created_at', { ascending: false }).limit(1).single();
    if (importError || !importRow) throw importError || new Error('Aktuální OBI leták nebyl nalezen.');
    const { data: extracted, error: textError } = await db.from('leaflet_extracted_text').select('parser,pages').eq('import_id', importRow.id).single();
    if (textError || !extracted || extracted.parser !== 'pdf-text-v3') throw textError || new Error('Chybí textová vrstva OBI letáku.');
    const parsed = extract(extracted.pages as Page[], String(importRow.detected_valid_from), String(importRow.detected_valid_to), String(importRow.metadata?.viewer_url || importRow.source_document_url));
    const candidates = new Map<string, any>(parsed.rows.map((item: any) => [item.metadata.obi_sku, item]));
    if (!candidates.size) throw new Error('V OBI letáku nebyly nalezeny jednoznačné výrobky s cenou.');

    const entries = [...candidates.entries()];
    const products: any[] = [];
    const failures: any[] = [];
    for (let offset = 0; offset < entries.length; offset += 5) {
      const batch = entries.slice(offset, offset + 5);
      const settled = await Promise.allSettled(batch.map(([sku]) => fetchProduct(sku)));
      settled.forEach((result, index) => {
        const sku = batch[index][0];
        if (result.status === 'fulfilled') products.push(result.value);
        else failures.push({ sku, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
      });
    }

    if (!products.length) throw new Error('Nepodařilo se ověřit žádný OBI produkt.');

    // Replace the previous OBI result only after official pages were successfully verified.
    const { error: deleteError } = await db.from('offers').delete().eq('store_id', store.id).eq('metadata->>import_id', importRow.id);
    if (deleteError) throw deleteError;

    let published = 0;
    const publishedSkus: string[] = [];
    for (const product of products) {
      try {
        const item = candidates.get(product.sku);
        const productId = await resolveProduct(product.sku, product.title, product.imageUrl);
        await upsertOffer(store.id, importRow, item, product, productId);
        published++; publishedSkus.push(product.sku);
      } catch (error) { failures.push({ sku: product.sku, error: error instanceof Error ? error.message : String(error) }); }
    }
    if (!published) throw new Error('Nepodařilo se ověřit a zveřejnit žádný OBI produkt.');

    await db.from('leaflet_imports').update({
      status: 'published', product_count: published, error_message: failures.length ? `${failures.length} OBI produktů se nepodařilo ověřit.` : null, finished_at: new Date().toISOString(),
      metadata: { ...(importRow.metadata || {}), structured_product_adapter: 'obi-spatial-official-v1', structured_product_count: published, structured_product_failures: failures.length, structured_product_rejected: parsed.rejected.length, structured_product_synced_at: new Date().toISOString() },
    }).eq('id', importRow.id);

    return json({ ok: true, import_id: importRow.id, candidates: candidates.size, rejected: parsed.rejected.length, published, failed: failures.length, published_skus: publishedSkus, failures });
  } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, 500); }
});
