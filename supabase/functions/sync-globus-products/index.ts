import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const HOUSE_NUMBER = 4008;
const BRANCH_NAME = 'Olomouc';
const SOURCE_PAGE_URL = 'https://www.globus.cz/olomouc/hypermarket/akcni-nabidka';
const API_URL = `https://www.globus.cz/api/v1/gsoa/actionOffers/houses/${HOUSE_NUMBER}/actionProductsCatalog`;
const PAGE_SIZE = 100;
const MIN_PRODUCTS = 300;
const MAX_PRODUCTS = 1000;
const MAX_PAGES = 10;
const MAX_REPORTED_GAP = 100;
const MAX_VALIDITY_DAYS = 180;
const INVALID_VALIDITY_SENTINEL_YEAR = 2100;
const API_PAGE_TIMEOUT_MS = 12_000;
const ADAPTER = 'globus-action-products-api-v1';
const PARSER_VERSION = 'globus-action-products-api-v2';
const MAX_TITLE_LENGTH = 160;

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}
function errorText(error: unknown) {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return `timeout po ${API_PAGE_TIMEOUT_MS} ms`;
    return error.message;
  }
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    return [value.message, value.details, value.hint, value.code]
      .filter(Boolean)
      .map(String)
      .join(' | ') || JSON.stringify(value);
  }
  return String(error);
}
function allowed(req: Request) {
  return req.headers.get('authorization') === `Bearer ${SERVICE_ROLE_KEY}`
    || Boolean(CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET);
}
function decodeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}
function clean(value: unknown) {
  return decodeHtml(value)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function titleText(product: any) {
  const rawName = String(product?.name ?? '');
  const fullName = clean(rawName);
  if (fullName && fullName.length <= MAX_TITLE_LENGTH) return fullName;

  const billName = clean(product?.billName);
  if (billName.length >= 3 && billName.length <= MAX_TITLE_LENGTH) return billName;

  const firstParagraph = clean(rawName.split(/(?:<br\s*\/?>\s*){2,}|\r?\n\s*\r?\n/i)[0]);
  if (firstParagraph.length >= 3 && firstParagraph.length <= MAX_TITLE_LENGTH) return firstParagraph;

  const shortened = fullName.slice(0, MAX_TITLE_LENGTH + 1);
  const boundary = shortened.lastIndexOf(' ');
  return (boundary >= 40 ? shortened.slice(0, boundary) : shortened.slice(0, MAX_TITLE_LENGTH)).trim();
}
function normalize(value: unknown) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
function money(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n <= 100000 ? Math.round(n * 100) / 100 : null;
}
function sourceDate(value: unknown): string | null {
  const m = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})T/);
  return m?.[1] || null;
}
function safeValidityWindow(validFrom: string | null, validTo: string | null): boolean {
  if (!validFrom || !validTo || validFrom > validTo) return false;
  const endYear = Number(validTo.slice(0, 4));
  if (!Number.isFinite(endYear) || endYear >= INVALID_VALIDITY_SENTINEL_YEAR) return false;
  const startMs = Date.parse(`${validFrom}T00:00:00Z`);
  const endMs = Date.parse(`${validTo}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return false;
  return Math.floor((endMs - startMs) / 86400000) <= MAX_VALIDITY_DAYS;
}
function firstEan(value: unknown): string | null {
  const values = Array.isArray(value) ? value : [value];
  for (const raw of values) {
    const digits = String(raw ?? '').replace(/\D/g, '');
    if (digits.length >= 8 && digits.length <= 14) return digits;
  }
  return null;
}
function safeImage(...values: unknown[]): string | null {
  for (const value of values) {
    const url = clean(value);
    if (/^https:\/\//i.test(url)) return url;
  }
  return null;
}
function quantityText(product: any): string | null {
  const amount = Number(product?.unitAmount);
  const rawUnit = clean(product?.unitId).toLowerCase();
  const unitMap: Record<string, string> = { g: 'g', kg: 'kg', ml: 'ml', l: 'l', ks: 'ks' };
  const unit = unitMap[rawUnit];
  if (Number.isFinite(amount) && amount > 0 && unit) {
    const formatted = Number.isInteger(amount) ? String(amount) : String(amount).replace('.', ',');
    return `${formatted} ${unit}`;
  }
  return clean(product?.name).match(/\b\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|ks)\b/i)?.[0] || null;
}
async function sha(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchPage(page: number) {
  const url = `${API_URL}?page=${page}&pageSize=${PAGE_SIZE}&listedProductOnly=true`;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_PAGE_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
          accept: 'application/json',
          'accept-language': 'cs-CZ,cs;q=0.9',
          referer: SOURCE_PAGE_URL,
        },
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Globus API page ${page} HTTP ${response.status}`);
      const payload = await response.json();
      const products = Array.isArray(payload?.products) ? payload.products : [];
      const totalCount = Number(payload?.totalCount);
      const more = payload?.paginationShowMore === true;
      if (!Number.isFinite(totalCount) || totalCount < 1) throw new Error(`Globus API page ${page} nemá platný totalCount.`);
      if (more && products.length === 0) throw new Error(`Globus API page ${page} tvrdí další stránku, ale nevrátila produkty.`);
      return { products, totalCount, more };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Globus API page ${page} selhala po 2 pokusech: ${errorText(lastError)}`);
}

async function fetchAllProducts() {
  const all: any[] = [];
  const seen = new Set<string>();
  let reportedTotal: number | null = null;
  let complete = false;
  let pagesFetched = 0;
  let duplicateVanr = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchPage(page);
    pagesFetched = page + 1;
    if (reportedTotal === null) reportedTotal = result.totalCount;
    if (reportedTotal !== result.totalCount) throw new Error(`Globus totalCount se během stránkování změnil z ${reportedTotal} na ${result.totalCount}.`);
    for (const product of result.products) {
      const vanr = clean(product?.vanr);
      if (!vanr) continue;
      if (seen.has(vanr)) {
        duplicateVanr++;
        continue;
      }
      seen.add(vanr);
      all.push(product);
    }
    if (!result.more) {
      complete = true;
      break;
    }
  }

  if (!complete) throw new Error(`Globus pagination nedoběhla do konce do ${MAX_PAGES} stran.`);
  if (all.length < MIN_PRODUCTS) throw new Error(`Globus API vrátilo jen ${all.length} unikátních produktů; minimum je ${MIN_PRODUCTS}.`);
  if (all.length > MAX_PRODUCTS) throw new Error(`Globus API vrátilo podezřele mnoho produktů: ${all.length}.`);
  if (duplicateVanr > 0) throw new Error(`Globus API obsahuje ${duplicateVanr} duplicitních VANR napříč stránkami.`);
  const gap = Math.max(0, Number(reportedTotal || 0) - all.length);
  if (gap > MAX_REPORTED_GAP) throw new Error(`Globus API reportuje ${reportedTotal}, ale stránkovat lze jen ${all.length}; rozdíl ${gap} je nad limitem ${MAX_REPORTED_GAP}.`);
  return { products: all, reportedTotal: Number(reportedTotal || all.length), pagesFetched, gap };
}

function normalizeProduct(product: any) {
  const house = product?.productInHouse || {};
  const title = titleText(product);
  const normalizedTitle = normalize(title);
  const vanr = clean(product?.vanr);
  const price = money(house?.actualPrice);
  const original = money(house?.originalPrice);
  const oldPrice = original && price && original > price ? original : null;
  const validFrom = sourceDate(house?.priceValidFrom);
  const validTo = sourceDate(house?.priceValidTo);
  const bonus = house?.bonusProgramPrice || null;
  const bonusPrice = money(bonus?.actualPrice);
  const image = safeImage(product?.imgThumbnail, product?.imgDetail, product?.imgIcon);
  const ean = firstEan(product?.ean);
  const brand = clean(product?.commonBrand?.name) || null;
  const quantity = quantityText(product);

  if (!title || !normalizedTitle || !vanr || !price || !safeValidityWindow(validFrom, validTo)) return null;

  return {
    external_id: `${HOUSE_NUMBER}:${vanr}`,
    title,
    normalized_title: normalizedTitle,
    brand,
    quantity_text: quantity,
    price,
    old_price: oldPrice,
    image_url: image,
    source_url: SOURCE_PAGE_URL,
    valid_from: validFrom,
    valid_to: validTo,
    confidence: 0.995,
    metadata: {
      parser: PARSER_VERSION,
      structured_source: true,
      ai_used: false,
      branch: BRANCH_NAME,
      house_number: HOUSE_NUMBER,
      vanr,
      ean,
      availability: clean(house?.availability) || null,
      stock_amount: Number.isFinite(Number(house?.stockAmount)) ? Number(house.stockAmount) : null,
      unit_amount: Number.isFinite(Number(product?.unitAmount)) ? Number(product.unitAmount) : null,
      unit_id: clean(product?.unitId) || null,
      comparison_price: money(house?.comparisonPrice),
      comparison_unit: clean(house?.comparisonSaleUnitSizeText) || null,
      member_program: bonusPrice && price && bonusPrice < price ? 'Můj Globus' : null,
      member_price: bonusPrice && price && bonusPrice < price ? bonusPrice : null,
      member_price_valid_from: sourceDate(bonus?.priceValidFrom),
      member_price_valid_to: sourceDate(bonus?.priceValidTo),
      discount_percentage: Number.isFinite(Number(house?.discountPercentage)) ? Number(house.discountPercentage) : null,
      price_tag_id: clean(house?.priceTagId) || null,
      price_type: clean(house?.priceType) || null,
    },
  };
}

async function markHealth(status: 'degraded', reason: string, error: string) {
  try {
    const { data: store } = await db.from('stores').select('id').eq('slug', 'globus').maybeSingle();
    if (!store) return;
    await db.from('store_product_sync_state').update({
      adapter_name: ADAPTER,
      adapter_version: PARSER_VERSION,
      parser_version: PARSER_VERSION,
      source_type: 'official-structured-api',
      source_category: 'branch-action-offer',
      health_status: status,
      health_reason: reason,
      minimum_offer_count: MIN_PRODUCTS,
      last_run_at: new Date().toISOString(),
      last_error: error,
      last_parser_error: error,
      updated_at: new Date().toISOString(),
    }).eq('store_id', store.id);
  } catch {
    // Failure telemetry must never replace the original sync error.
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(req)) return json({ error: 'Unauthorized' }, 401);

  let requestedDryRun = true;
  try {
    const body = await req.json().catch(() => ({}));
    requestedDryRun = body.dry_run !== false;
    const fetched = await fetchAllProducts();
    const invalidValidityCount = fetched.products.filter((product) => {
      const house = product?.productInHouse || {};
      return !safeValidityWindow(sourceDate(house?.priceValidFrom), sourceDate(house?.priceValidTo));
    }).length;
    const rows = fetched.products.map(normalizeProduct).filter(Boolean) as any[];
    if (rows.length < MIN_PRODUCTS) throw new Error(`Po validaci zůstalo jen ${rows.length} Globus produktů.`);

    const validityPairs = new Map<string, number>();
    let publicDiscounts = 0;
    let memberPrices = 0;
    let missingImages = 0;
    let sanitizedTitles = 0;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const source = fetched.products[index];
      const key = `${row.valid_from}|${row.valid_to}`;
      validityPairs.set(key, (validityPairs.get(key) || 0) + 1);
      if (row.old_price && row.old_price > row.price) publicDiscounts++;
      if (row.metadata?.member_price && row.metadata.member_price < row.price) memberPrices++;
      if (!row.image_url) missingImages++;
      if (clean(source?.name) !== row.title) sanitizedTitles++;
    }

    const signature = await sha([
      PARSER_VERSION,
      HOUSE_NUMBER,
      fetched.reportedTotal,
      rows.length,
      ...rows.map((row) => `${row.external_id}:${row.price}:${row.old_price || ''}:${row.valid_from}:${row.valid_to}:${row.metadata?.member_price || ''}`),
    ].join('|'));

    const summary = {
      ok: true,
      adapter: ADAPTER,
      parser_version: PARSER_VERSION,
      branch: BRANCH_NAME,
      house_number: HOUSE_NUMBER,
      source_url: SOURCE_PAGE_URL,
      api_url: API_URL,
      reported_total_count: fetched.reportedTotal,
      accessible_product_count: fetched.products.length,
      validated_product_count: rows.length,
      invalid_validity_count: invalidValidityCount,
      max_validity_days: MAX_VALIDITY_DAYS,
      reported_gap: fetched.gap,
      pages_fetched: fetched.pagesFetched,
      validity_pair_count: validityPairs.size,
      public_discount_count: publicDiscounts,
      member_price_count: memberPrices,
      missing_image_count: missingImages,
      sanitized_title_count: sanitizedTitles,
      signature,
    };

    if (requestedDryRun) {
      return json({
        ...summary,
        dry_run: true,
        validity_pairs: [...validityPairs.entries()].map(([pair, count]) => {
          const [valid_from, valid_to] = pair.split('|');
          return { valid_from, valid_to, count };
        }).sort((a, b) => b.count - a.count),
        samples: rows.slice(0, 30),
      });
    }

    const { data, error } = await db.rpc('publish_globus_olomouc_offers', {
      p_signature: signature,
      p_rows: rows,
      p_source_document_url: SOURCE_PAGE_URL,
      p_parser_version: PARSER_VERSION,
      p_reported_total_count: fetched.reportedTotal,
      p_accessible_product_count: rows.length,
    });
    if (error) throw error;
    return json({ ...summary, dry_run: false, publish: data });
  } catch (error) {
    const message = errorText(error);
    if (!requestedDryRun) await markHealth('degraded', `Globus Olomouc synchronizace selhala: ${message}`, message);
    return json({ error: message, adapter: ADAPTER }, 500);
  }
});