import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const SOURCE = 'https://www.intersport.cz/akce/';
const ADAPTER = 'intersport-official-sale-html-v1';
const SOURCE_TIMEOUT_MS = 12_000;
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'content-type': 'application/json; charset=utf-8',
};
const SOURCE_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.6',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: HEADERS });
}

function errorText(error: unknown) {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return `timeout po ${SOURCE_TIMEOUT_MS} ms`;
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

async function allowed(request: Request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE || (CRON && request.headers.get('x-cron-secret') === CRON)) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}

async function fetchSourceHtml() {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
    try {
      const response = await fetch(SOURCE, {
        headers: SOURCE_HEADERS,
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Intersport HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Intersport zdroj se nepodařilo načíst po 2 pokusech: ${errorText(lastError)}`);
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function pragueToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function decodeHtml(value: string) {
  const named: Record<string, string> = {
    amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
    aacute: 'á', Aacute: 'Á', ccaron: 'č', Ccaron: 'Č', dcaron: 'ď', Dcaron: 'Ď',
    eacute: 'é', Eacute: 'É', ecaron: 'ě', Ecaron: 'Ě', iacute: 'í', Iacute: 'Í',
    ncaron: 'ň', Ncaron: 'Ň', oacute: 'ó', Oacute: 'Ó', rcaron: 'ř', Rcaron: 'Ř',
    scaron: 'š', Scaron: 'Š', tcaron: 'ť', Tcaron: 'Ť', uacute: 'ú', Uacute: 'Ú',
    uring: 'ů', Uring: 'Ů', yacute: 'ý', Yacute: 'Ý', zcaron: 'ž', Zcaron: 'Ž',
  };
  return value
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10)))
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

function parseProducts(html: string, today: string) {
  const blocks = html.split('<div class="product-card" data-id="').slice(1);
  const rows: any[] = [];
  for (const block of blocks) {
    const id = decodeHtml(block.match(/^([^"]+)"/)?.[1] || '');
    const rawTitle = block.match(/<strong class="product-card__title">([\s\S]*?)<\/strong>/)?.[1] || '';
    const title = decodeHtml(rawTitle.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const image = decodeHtml(block.match(/<img[^>]+src="(https:\/\/image\.1ntersport\.com\/[^"]+)"/)?.[1] || '');
    const relativeHref = decodeHtml(block.match(/<a href="([^"]+)" class="product-card__link"/)?.[1] || '');
    const saleText = block.match(/price-t02__actual-price--discounted[^>]*>([0-9.\s,]+)\s*Kč/)?.[1] || '';
    const oldText = block.match(/price-t02__old-price--crossed[^>]*>[\s\S]*?([0-9.\s,]+)\s*Kč/)?.[1] || '';
    const price = money(saleText);
    const oldPrice = money(oldText);
    if (!/^[a-z0-9._-]{8,}$/i.test(id) || title.length < 4 || title.length > 180) continue;
    if (!relativeHref.startsWith('/p/') || !image.startsWith('https://image.1ntersport.com/')) continue;
    if (price == null || oldPrice == null || price < 20 || price > 30000 || oldPrice <= price || oldPrice > 50000) continue;
    const href = `https://www.intersport.cz${relativeHref}`;
    rows.push({
      external_id: `intersport:${id}`,
      title,
      normalized_title: normalize(title),
      price,
      old_price: oldPrice,
      quantity_text: null,
      valid_from: today,
      valid_to: addDays(today, 1),
      source_url: href,
      source_page: 1,
      product_id: null,
      image_url: image,
      confidence: 0.99,
      metadata: {
        adapter: ADAPTER,
        parser_version: ADAPTER,
        intersport_product_id: id,
        evidence: {
          official_sale_page: true,
          displayed_sale_price: price,
          displayed_regular_price: oldPrice,
        },
      },
    });
  }
  const unique = [...new Map(rows.map((row) => [row.external_id, row])).values()];
  if (unique.length < 5 || unique.length > 10) {
    throw new Error(`Intersport parser našel ${unique.length} bezpečných produktů; očekáváno 5–10.`);
  }
  return unique;
}

async function markHealth(status: 'ok' | 'degraded', reason: string, count: number, error: string | null) {
  try {
    const { data: store } = await db.from('stores').select('id').eq('slug', 'intersport').maybeSingle();
    if (!store) return;
    await db.from('store_product_sync_state').update({
      health_status: status,
      health_reason: reason,
      last_offer_count: count,
      expected_offer_count: status === 'ok' ? count : undefined,
      minimum_offer_count: 5,
      last_run_at: new Date().toISOString(),
      last_success_at: status === 'ok' ? new Date().toISOString() : undefined,
      last_error: error,
      parser_version: ADAPTER,
      adapter_version: 'v1',
      updated_at: new Date().toISOString(),
    }).eq('store_id', store.id);
  } catch {
    // Health telemetry must never turn a successful sync into a failure.
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await request.json().catch(() => ({}));
    const html = await fetchSourceHtml();
    const today = pragueToday();
    const rows = parseProducts(html, today);
    const signature = await sha256(rows.map((row) => `${row.external_id}|${row.title}|${row.price}|${row.old_price}|${row.valid_to}`).join('\n'));

    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'intersport').single();
    if (storeError || !store) throw storeError || new Error('Intersport nebyl nalezen.');

    const { data: existingSource, error: sourceError } = await db.from('leaflet_sources')
      .select('id')
      .eq('store_id', store.id)
      .eq('source_url', SOURCE)
      .maybeSingle();
    if (sourceError) throw sourceError;

    if (existingSource) {
      const { error: updateError } = await db.from('leaflet_sources').update({
        source_url: SOURCE,
        source_type: 'html',
        is_active: true,
        auto_publish: false,
        last_checked_at: new Date().toISOString(),
        last_error: null,
        adapter_key: ADAPTER,
        extraction_strategy: 'structured_html',
      }).eq('id', existingSource.id);
      if (updateError) throw updateError;
    } else {
      const { error } = await db.from('leaflet_sources').insert({
        store_id: store.id,
        name: 'Intersport Výprodej',
        source_url: SOURCE,
        source_type: 'html',
        is_active: true,
        auto_publish: false,
        adapter_key: ADAPTER,
        extraction_strategy: 'structured_html',
      });
      if (error) throw error;
    }

    if (body.dry_run === true) {
      return json({ ok: true, dry_run: true, publishable: rows.length, signature, candidates: rows });
    }

    const { data: result, error: publishError } = await db.rpc('publish_structured_store_offers', {
      p_store_slug: 'intersport',
      p_adapter: ADAPTER,
      p_signature: signature,
      p_rows: rows,
      p_min_products: 5,
      p_max_products: 10,
      p_source_document_url: SOURCE,
      p_parser_version: ADAPTER,
    });
    if (publishError) throw publishError;

    await markHealth('ok', `Automaticky publikováno ${rows.length} ověřených nabídek Intersport.`, rows.length, null);
    return json({ ok: true, store: store.name, published: rows.length, signature, result });
  } catch (error) {
    const message = errorText(error);
    await markHealth('degraded', `Intersport synchronizace selhala: ${message}`, 0, message);
    return json({ error: message, code: 'INTERSPORT_PRODUCTS_SYNC_FAILED' }, 500);
  }
});
