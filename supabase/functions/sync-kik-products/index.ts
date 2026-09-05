import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};
const FETCH_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/json,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};
const SOURCE_ADAPTER = 'kik-publitas-v2';
const ADAPTER = 'kik-publitas-article-anchor-v4';
const PARSER = 'kik-publitas-article-anchor-v4';
const KIK_API = 'https://api-shop.prod.kik.de/api/v1/products';
const MIN_SAFE = 30;
const MAX_SAFE = 120;
const ARTICLE = /^\d{6,8}$/u;
const PRICE = /^\d{2,4}$/u;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: CORS });
function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    return [e.message, e.details, e.hint, e.code].filter(Boolean).map(String).join(' | ') || JSON.stringify(error);
  }
  return String(error);
}
function clean(line: string) { return line.replace(/\s+/g, ' ').replace(/[,:;]+$/u, '').trim(); }
function norm(value: unknown) {
  return String(value || '').toLocaleLowerCase('cs').replace(/[^a-z0-9áčďéěíňóřšťúůýž]+/giu, ' ').trim().replace(/\s+/g, ' ');
}
function isoFromCz(value: string) {
  const m = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/u);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
function validFromFromText(text: string) {
  for (const line of String(text || '').split(/\r?\n/u).map(clean).filter(Boolean)) {
    if (!/PLATNOST OD/iu.test(line)) continue;
    const value = isoFromCz(line);
    if (value) return value;
  }
  return null;
}
function pragueDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function allowed(request: Request) {
  const raw = request.headers.get('authorization') || '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE) return true;
  if (CRON && request.headers.get('x-cron-secret') === CRON) return true;
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  return !error && !!data.user && ['admin', 'editor'].includes(String(data.user.app_metadata?.role || '').toLowerCase());
}
async function fetchText(url: string, timeout = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow', signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return text;
  } finally { clearTimeout(timer); }
}
function dataFromHtml(html: string) {
  const marker = 'var data =';
  const start = html.indexOf(marker);
  const jsonStart = html.indexOf('{', start + marker.length);
  const end = html.indexOf('Reader.Bootstrap.init', jsonStart);
  if (start < 0 || jsonStart < 0 || end < 0) throw new Error('Publitas data mají neočekávaný formát.');
  const block = html.slice(jsonStart, end);
  const semi = block.lastIndexOf(';');
  return JSON.parse((semi >= 0 ? block.slice(0, semi) : block).trim());
}
function usableImage(value: unknown) {
  const url = String(value || '').trim();
  return /^https:\/\/media\.kik\.de\//i.test(url) ? url : null;
}

type ApiProduct = {
  article_id: string;
  ok: boolean;
  name?: string;
  slug?: string | null;
  prices?: number[];
  primary_image?: string | null;
  status_code?: number | null;
  origin_exact?: boolean;
  error?: string;
};
async function fetchProduct(articleId: string): Promise<ApiProduct> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${KIK_API}/${encodeURIComponent(articleId)}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', accept: 'application/json', origin: 'https://www.kik.cz', referer: 'https://www.kik.cz/',
        'user-agent': FETCH_HEADERS['user-agent'], 'x-trace-id': `slevao-kik-products-${articleId}-${Date.now()}`,
      },
      body: JSON.stringify({ attributeFilterNames: [], customerGroup: '' }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) return { article_id: articleId, ok: false, error: `HTTP ${response.status}` };
    const payload = JSON.parse(text);
    const variants = Array.isArray(payload?.variants) ? payload.variants : [];
    const prices = [...new Set(variants.map((v: any) => Number(v?.price?.final)).filter((n: number) => Number.isFinite(n)))].sort((a, b) => a - b);
    const originExact = String(payload?.key || '') === articleId && variants.some((v: any) => String(v?.attributes?.origin_product_no || '') === articleId);
    const images = [...new Set(variants.flatMap((v: any) => Array.isArray(v?.images) ? v.images.map((x: any) => usableImage(x?.url)).filter(Boolean) : []))] as string[];
    return {
      article_id: articleId,
      ok: true,
      name: String(payload?.name || '').trim(),
      slug: payload?.slug ? String(payload.slug) : null,
      prices,
      primary_image: images[0] || null,
      status_code: Number.isFinite(Number(payload?.statusCode)) ? Number(payload.statusCode) : null,
      origin_exact: originExact,
    };
  } catch (error) {
    return { article_id: articleId, ok: false, error: errorText(error) };
  } finally { clearTimeout(timer); }
}

type PageInfo = { page: number; valid_from: string; articles: { article_id: string; line: number }[]; prices: { price: number; line: number }[] };
async function buildRows(document: any, viewer: string, spreads: any[], today: string) {
  const publicationId = String(document.metadata?.publication_id || '');
  const pages: PageInfo[] = [];
  const futureValidFromDates: string[] = [];
  let pageCount = 0;
  for (const spread of spreads) {
    for (const page of Array.isArray(spread?.pages) ? spread.pages : []) {
      pageCount++;
      const pageNumber = Number(page?.number || pageCount);
      const text = String(page?.text || '');
      const validFrom = validFromFromText(text);
      if (validFrom && validFrom > today) {
        futureValidFromDates.push(validFrom);
        continue;
      }
      if (!validFrom) continue;
      const lines = text.split(/\r?\n/u).map(clean).filter(Boolean);
      const articles = lines.map((value, i) => ({ value, i })).filter((x) => ARTICLE.test(x.value)).map((x) => ({ article_id: x.value, line: x.i + 1 }));
      const prices = lines.map((value, i) => ({ value, i })).filter((x) => PRICE.test(x.value)).map((x) => ({ price: Number(x.value), line: x.i + 1 }))
        .filter((x) => Number.isFinite(x.price) && x.price >= 15 && x.price <= 5000 && x.price !== pageNumber);
      pages.push({ page: pageNumber, valid_from: validFrom, articles, prices });
    }
  }

  const articleIds = [...new Set(pages.flatMap((p) => p.articles.map((a) => a.article_id)))].sort();
  const api = new Map<string, ApiProduct>();
  for (let i = 0; i < articleIds.length; i += 5) {
    const batch = await Promise.all(articleIds.slice(i, i + 5).map(fetchProduct));
    for (const item of batch) api.set(item.article_id, item);
  }

  const candidates: any[] = [];
  let apiErrors = 0;
  let noPriceMatch = 0;
  for (const page of pages) {
    for (const token of page.articles) {
      const hit = api.get(token.article_id);
      if (!hit?.ok || !hit.origin_exact || !hit.name || !hit.primary_image) { apiErrors++; continue; }
      const matches = (hit.prices || []).flatMap((price) => page.prices.filter((p) => Math.abs(p.price - price) < 0.01).map((p) => ({ price, distance: Math.abs(p.line - token.line), price_line: p.line })));
      const distinctPrices = [...new Set(matches.map((m) => m.price))];
      if (distinctPrices.length !== 1) { noPriceMatch++; continue; }
      const nearest = matches.sort((a, b) => a.distance - b.distance)[0];
      candidates.push({
        article_id: token.article_id,
        title: hit.name,
        normalized_title: norm(hit.name),
        price: distinctPrices[0],
        valid_from: page.valid_from,
        valid_to: today,
        source_page: page.page,
        article_line: token.line,
        nearest_price_distance: nearest?.distance ?? null,
        matching_price_occurrences: matches.length,
        api_status_code: hit.status_code ?? null,
        api_slug: hit.slug || null,
        image_url: hit.primary_image,
      });
    }
  }

  const counts = new Map<string, number>();
  for (const row of candidates) counts.set(row.article_id, (counts.get(row.article_id) || 0) + 1);
  const duplicateArticleIds = [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id).sort();
  const rows = candidates.filter((row) => (counts.get(row.article_id) || 0) === 1)
    .sort((a, b) => a.title.localeCompare(b.title, 'cs') || a.article_id.localeCompare(b.article_id));

  for (const row of rows) {
    row.external_id = `kik:article:${row.article_id}`;
    row.source_url = `${viewer}/page/${row.source_page}`;
    row.quantity_text = null;
    row.old_price = null;
    row.product_id = null;
    row.confidence = 0.995;
    row.metadata = {
      adapter: ADAPTER,
      parser_version: PARSER,
      publication_id: publicationId,
      article_id: row.article_id,
      article_identity_source: 'kik_official_product_api_v1',
      article_page_price_verified: true,
      matched_page_price: row.price,
      nearest_price_distance: row.nearest_price_distance,
      matching_price_occurrences: row.matching_price_occurrences,
      api_status_code: row.api_status_code,
      api_slug: row.api_slug,
      official_image_source: 'media.kik.de',
      validity_policy: 'daily_verified_snapshot_until_replaced',
      source_validity_text: 'Platnost od uvedeného data; nabídka platí do vyprodání zásob',
    };
    delete row.article_line;
    delete row.nearest_price_distance;
    delete row.matching_price_occurrences;
    delete row.api_status_code;
    delete row.api_slug;
  }

  const payloadFingerprint = await sha256(JSON.stringify(rows.map((row) => [row.article_id, row.price, row.source_page, row.title, row.image_url])));
  const nextValidFrom = [...new Set(futureValidFromDates)].sort()[0] || null;
  return { rows, raw: candidates.length, pages: pageCount, nextValidFrom, apiErrors, noPriceMatch, duplicateArticleIds, articleIds: articleIds.length, payloadFingerprint };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  let storeId: string | null = null;
  let sourceId: string | null = null;
  let dryRun = false;
  try {
    const body = await request.json().catch(() => ({}));
    dryRun = body.dry_run === true;
    const force = body.force === true;
    const today = pragueDate();
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'kik').single();
    if (storeError || !store) throw storeError || new Error('KiK obchod nebyl nalezen.');
    storeId = store.id;
    const { data: source, error: sourceError } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).eq('source_url', 'https://www.kik.cz/tvuj-online-letak').eq('is_active', true).single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj KiK nebyl nalezen.');
    sourceId = source.id;
    const { data: document, error: documentError } = await db.from('leaflet_imports').select('id,source_hash,metadata').eq('store_id', store.id).eq('status', 'published').contains('metadata', { adapter: SOURCE_ADAPTER }).order('updated_at', { ascending: false }).limit(1).single();
    if (documentError || !document) throw documentError || new Error('Aktuální KiK Publitas dokument nebyl nalezen.');
    const viewer = String(document.metadata?.viewer_url || '').replace(/\/+$/u, '');
    if (!/^https:\/\/letaki\.kik\.cz\/kik-[a-z0-9_-]+$/iu.test(viewer)) throw new Error('KiK dokument nemá povolenou viewer adresu.');
    const html = await fetchText(`${viewer}/`);
    const data = dataFromHtml(html);
    const publicationId = String(data.id || '');
    const expectedPublication = String(document.metadata?.publication_id || '');
    const cacheToken = String(data.cacheToken || '');
    if (!cacheToken) throw new Error('KiK Publitas nevrátil cacheToken.');
    if (!publicationId || publicationId !== expectedPublication) throw new Error('KiK aktivní publication ID se změnilo; nejdřív musí proběhnout source sync.');
    const spreads = JSON.parse(await fetchText(`${viewer}/spreads.json?version=${encodeURIComponent(cacheToken)}`));
    if (!Array.isArray(spreads) || !spreads.length) throw new Error('KiK Publitas nevrátil stránky.');
    const built = await buildRows(document, viewer, spreads, today);

    if (built.rows.length === 0 && built.nextValidFrom) {
      const now = new Date().toISOString();
      const healthReason = `Nový KiK leták začne platit ${built.nextValidFrom}; současné veřejné nabídky zůstávají beze změny.`;
      if (!dryRun) {
        await db.from('store_product_sync_state').update({ last_run_at: now, last_error: null, last_parser_error: null, health_status: 'ok', health_reason: healthReason, is_running: false, updated_at: now }).eq('store_id', store.id);
        await db.from('leaflet_sources').update({ last_checked_at: now, last_success_at: now, last_error: null }).eq('id', source.id);
      }
      return json({ ok: true, no_changes: true, future_publication: true, store: 'KiK', pages: built.pages, publishable: 0, valid_from: built.nextValidFrom, today, reason: 'publication_not_started' });
    }
    if (built.rows.length < MIN_SAFE || built.rows.length > MAX_SAFE) throw new Error(`KiK parser vytvořil ${built.rows.length} nabídek; bezpečný rozsah je ${MIN_SAFE}–${MAX_SAFE}.`);
    const signature = await sha256(`${document.source_hash}|${cacheToken}|${PARSER}|${built.payloadFingerprint}`);
    if (dryRun) return json({
      ok: true, dry_run: true, parser: PARSER, store: 'KiK', pages: built.pages, article_ids: built.articleIds, exact_candidates: built.raw,
      api_errors: built.apiErrors, no_price_match: built.noPriceMatch, duplicate_article_ids: built.duplicateArticleIds,
      publishable: built.rows.length, signature, valid_from: built.rows[0]?.valid_from || null, valid_to: today,
      validity_policy: 'daily_verified_snapshot_until_replaced', samples: built.rows,
    });

    if (!force) {
      const { data: state } = await db.from('store_product_sync_state').select('last_source_signature').eq('store_id', store.id).maybeSingle();
      if (state?.last_source_signature === signature) {
        const { count, error: countError } = await db.from('offers').select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('status', 'published').gte('valid_to', today).eq('metadata->>adapter', ADAPTER);
        if (countError) throw countError;
        if ((count || 0) >= MIN_SAFE) {
          await db.from('leaflet_sources').update({ last_checked_at: new Date().toISOString(), last_success_at: new Date().toISOString(), last_error: null }).eq('id', source.id);
          return json({ ok: true, no_changes: true, store: 'KiK', available_offers: count, signature, valid_to: today });
        }
      }
    }

    const { data: result, error: publishError } = await db.rpc('publish_structured_store_offers', {
      p_store_slug: 'kik', p_adapter: ADAPTER, p_signature: signature, p_rows: built.rows, p_min_products: MIN_SAFE, p_max_products: MAX_SAFE,
      p_source_document_url: viewer, p_parser_version: PARSER,
    });
    if (publishError) throw publishError;
    return json({
      ok: true, self_published: true, parser: PARSER, store: 'KiK', pages: built.pages, article_ids: built.articleIds, exact_candidates: built.raw,
      api_errors: built.apiErrors, no_price_match: built.noPriceMatch, duplicate_article_ids: built.duplicateArticleIds,
      publishable: built.rows.length, signature, valid_from: built.rows[0]?.valid_from || null, valid_to: today,
      validity_policy: 'daily_verified_snapshot_until_replaced', result,
    });
  } catch (error) {
    const message = errorText(error);
    const now = new Date().toISOString();
    if (!dryRun) {
      if (storeId) await db.from('store_product_sync_state').update({ last_run_at: now, last_error: message.slice(0, 2000), last_parser_error: message.slice(0, 2000), health_status: 'error', health_reason: 'Nová KiK sada nebyla publikována; předchozí veřejná data zůstala beze změny.', is_running: false, updated_at: now }).eq('store_id', storeId);
      if (sourceId) await db.from('leaflet_sources').update({ last_checked_at: now, last_error: message.slice(0, 1000) }).eq('id', sourceId);
    }
    return json({ error: message, code: 'KIK_PRODUCT_SYNC_FAILED', dry_run: dryRun }, 500);
  }
});
