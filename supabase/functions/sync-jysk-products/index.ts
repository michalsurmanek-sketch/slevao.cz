import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36';
const SEARCH_URL = 'https://jysk.cz/service/search/search';
const SOURCE_URL = 'https://jysk.cz/akce';
const ADAPTER = 'jysk-search-api-v1';
const PARSER = 'jysk-search-api-v1';
const PAGE_SIZE = 48;
const MIN_SAFE = 500;
const MAX_SAFE = 2500;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}
function err(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    return [e.message, e.details, e.hint, e.code].filter(Boolean).map(String).join(' | ') || JSON.stringify(error);
  }
  return String(error);
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
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function dateOnly(value: unknown) {
  const m = String(value || '').match(/(\d{4})[\/-](\d{2})[\/-](\d{2})/u);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
function numberValue(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function firstImage(product: any) {
  const images = Array.isArray(product?.media?.images) ? product.media.images : [];
  const preferred = images.find((x: any) => x?.url && String(x.typeGroup || '').toLowerCase() === 'cutout') || images.find((x: any) => x?.url);
  return preferred?.url ? String(preferred.url) : null;
}
function searchBody(from: number) {
  return {
    locale: 'cs-CZ',
    q: '',
    size: PAGE_SIZE,
    from,
    type: 'products',
    filters: [],
    showTotalHitsForTypes: ['products'],
    sort: 'score',
    staticFilters: [{ name: 'onSale' }],
  };
}
async function searchPage(from: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: {
        'user-agent': UA,
        accept: 'application/json,text/plain,*/*',
        'content-type': 'application/json',
        'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
        referer: SOURCE_URL,
        configuration: 'control',
      },
      body: JSON.stringify(searchBody(from)),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`JYSK Search API HTTP ${response.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    return {
      totalHits: Number(data?.products?.totalHits || 0),
      hits: Array.isArray(data?.products?.hits) ? data.products.hits : [],
      configuration: response.headers.get('configuration') || 'control',
    };
  } finally {
    clearTimeout(timer);
  }
}
async function loadAllProducts() {
  const first = await searchPage(0);
  if (!first.totalHits || !first.hits.length) throw new Error('JYSK Search API nevrátilo žádné akční produkty.');
  const offsets: number[] = [];
  for (let from = PAGE_SIZE; from < first.totalHits; from += PAGE_SIZE) offsets.push(from);
  const pages: any[] = [first];
  for (let i = 0; i < offsets.length; i += 6) {
    const batch = offsets.slice(i, i + 6);
    pages.push(...await Promise.all(batch.map((from) => searchPage(from))));
  }
  const byId = new Map<string, any>();
  for (const page of pages) {
    for (const product of page.hits) {
      const id = String(product?.id || '').trim();
      if (id) byId.set(id, product);
    }
  }
  return { totalHits: first.totalHits, products: [...byId.values()], pages: pages.length, configuration: first.configuration };
}
function toRow(product: any, today: string) {
  const id = String(product?.id || '').trim();
  const title = String(product?.title || '').replace(/\s+/g, ' ').trim();
  const campaign = product?.price?.campaignInfo || {};
  const validFrom = dateOnly(campaign.campaignPriceStartDate);
  const validTo = dateOnly(campaign.campaignPriceEndDate);
  const price = numberValue(product?.price?.unformatted?.campaign ?? product?.price?.unformatted?.minSingle);
  const regular = numberValue(product?.price?.unformatted?.gross);
  if (!id || !title || !price || price <= 0 || !validFrom || !validTo) return null;
  if (validFrom > today || validTo < today) return null;
  const oldPrice = regular && regular > price ? regular : null;
  return {
    external_id: `jysk:${id}:${validFrom}:${validTo}`,
    title,
    price,
    old_price: oldPrice,
    quantity_text: String(product?.price?.formatted?.unit || '').replace(/^\//u, '').trim() || null,
    valid_from: validFrom,
    valid_to: validTo,
    source_url: new URL(String(product?.url || `/search?q=${encodeURIComponent(title)}`), 'https://jysk.cz').toString(),
    source_page: null,
    product_id: null,
    image_url: firstImage(product),
    confidence: 0.99,
    metadata: {
      adapter: ADAPTER,
      jysk_id: id,
      status_code: product?.statusCode || null,
      categories: Array.isArray(product?.categoryNames) ? product.categoryNames : [],
      labels: Array.isArray(product?.labels) ? product.labels : [],
      series: product?.relations?.series?.seriesId || null,
      brand: product?.relations?.brand?.name || null,
      discount_percent: numberValue(product?.price?.discount?.percentage),
      is_online_sales: Boolean(product?.isOnlineSales),
      is_store_sales: Boolean(product?.isStoreSales),
      is_click_collect: Boolean(product?.isClickCollect),
      parser_version: PARSER,
    },
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  let storeId: string | null = null;
  let sourceId: string | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const force = body.force === true;
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'jysk').single();
    if (storeError || !store) throw storeError || new Error('JYSK obchod nebyl nalezen.');
    storeId = store.id;
    const { data: source, error: sourceError } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).eq('is_active', true).limit(1).single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj JYSK nebyl nalezen.');
    sourceId = source.id;

    const today = new Date().toISOString().slice(0, 10);
    const loaded = await loadAllProducts();
    const rows = loaded.products.map((p) => toRow(p, today)).filter(Boolean) as any[];
    const unique = new Map<string, any>();
    for (const row of rows) unique.set(row.external_id, row);
    const finalRows = [...unique.values()].sort((a, b) => a.title.localeCompare(b.title, 'cs'));
    if (finalRows.length < MIN_SAFE || finalRows.length > MAX_SAFE) {
      throw new Error(`JYSK má ${finalRows.length} platných akčních produktů; bezpečný rozsah je ${MIN_SAFE}–${MAX_SAFE}.`);
    }
    const identity = finalRows.map((r) => `${r.external_id}|${r.price}|${r.old_price || ''}`).sort().join('\n');
    const signature = await sha256(`${PARSER}\n${identity}`);

    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        store: 'JYSK',
        search_total_hits: loaded.totalHits,
        fetched_unique: loaded.products.length,
        pages: loaded.pages,
        publishable: finalRows.length,
        with_images: finalRows.filter((x) => x.image_url).length,
        validity_ranges: [...new Set(finalRows.map((x) => `${x.valid_from}..${x.valid_to}`))].sort(),
        signature,
        samples: finalRows.slice(0, 100),
      });
    }

    if (!force) {
      const { data: state } = await db.from('store_product_sync_state').select('last_source_signature').eq('store_id', store.id).maybeSingle();
      if (state?.last_source_signature === signature) {
        const { count, error: countError } = await db.from('offers').select('id', { count: 'exact', head: true })
          .eq('store_id', store.id).eq('status', 'published').lte('valid_from', today).gte('valid_to', today);
        if (countError) throw countError;
        if ((count || 0) >= MIN_SAFE) {
          const now = new Date().toISOString();
          await db.from('leaflet_sources').update({ last_checked_at: now, last_success_at: now, last_error: null }).eq('id', source.id);
          return json({ ok: true, no_changes: true, store: 'JYSK', current_offers: count, signature });
        }
      }
    }

    const { data: result, error: publishError } = await db.rpc('publish_structured_store_offers', {
      p_store_slug: 'jysk',
      p_adapter: ADAPTER,
      p_signature: signature,
      p_rows: finalRows,
      p_min_products: MIN_SAFE,
      p_max_products: MAX_SAFE,
      p_source_document_url: SOURCE_URL,
      p_parser_version: PARSER,
    });
    if (publishError) throw publishError;
    return json({
      ok: true,
      self_published: true,
      store: 'JYSK',
      search_total_hits: loaded.totalHits,
      fetched_unique: loaded.products.length,
      publishable: finalRows.length,
      with_images: finalRows.filter((x) => x.image_url).length,
      signature,
      result,
    });
  } catch (error) {
    const message = err(error);
    const now = new Date().toISOString();
    if (storeId) await db.from('store_product_sync_state').upsert({
      store_id: storeId,
      last_run_at: now,
      is_running: false,
      last_error: message.slice(0, 2000),
      last_parser_error: message.slice(0, 2000),
      health_status: 'error',
      health_reason: 'Nová JYSK sada nebyla publikována; předchozí veřejná data zůstala beze změny.',
      updated_at: now,
    }, { onConflict: 'store_id' });
    if (sourceId) await db.from('leaflet_sources').update({ last_checked_at: now, last_error: message.slice(0, 1000) }).eq('id', sourceId);
    return json({ error: message, code: 'JYSK_PRODUCT_SYNC_FAILED' }, 500);
  }
});
