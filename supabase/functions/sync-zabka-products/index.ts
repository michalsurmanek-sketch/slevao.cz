import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const SOURCE = 'https://izabka.cz/';
const ADAPTER = 'zabka-official-homepage-html-v3';
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
      if (!response.ok) throw new Error(`Žabka HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 350));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Žabka zdroj se nepodařilo načíst po 2 pokusech: ${errorText(lastError)}`);
}

function decodeHtml(value: string) {
  return value
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'");
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
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
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function quantity(title: string) {
  return title.match(/\b\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|ks)\b/iu)?.[0]?.replace(/\s+/g, ' ') || null;
}

function productBlocks(section: string) {
  const candidates = [...section.matchAll(/<div\b[^>]*class=["']([^"']+)["'][^>]*>/gi)]
    .filter((m) => m[1].split(/\s+/).includes('sale-item'));
  return candidates.map((m, i) => {
    if (i + 1 < candidates.length) return section.slice(m.index!, candidates[i + 1].index!);
    const rest = section.slice(m.index!);
    const cut = rest.slice(m[0].length).search(/<(?:section|h2|h3)\b/iu);
    return cut >= 0 ? rest.slice(0, m[0].length + cut) : rest.slice(0, 6000);
  });
}

function findImage(block: string) {
  const candidates = [...block.matchAll(/<img\b[^>]*(?:src|data-src|data-lazy-src)=["']([^"']+)["'][^>]*>/gi)]
    .map((m) => decodeHtml(m[1]));
  return candidates.find((u) => /^https:\/\/izabka\.cz\/wp-content\/(?:uploads\/|webp-express\/webp-images\/uploads\/)/i.test(u)) || '';
}

function findTitle(block: string) {
  const afterImage = block.match(/<\/div>\s*<span\b[^>]*>([\s\S]*?)<\/span>/i);
  if (afterImage) {
    const v = stripTags(afterImage[1]).replace(/[–—]/g, '-');
    if (v.length >= 4 && v.length <= 160 && /[A-Za-zÁ-ž]/.test(v)) return v;
  }
  const spans = [...block.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)]
    .map((m) => stripTags(m[1]).replace(/[–—]/g, '-'))
    .filter((v) => v.length >= 4 && v.length <= 160 && /[A-Za-zÁ-ž]/.test(v))
    .filter((v) => !/^(?:kč|akce|nabídka|sleva|cena)$/iu.test(v));
  return spans.sort((a, b) => b.length - a.length)[0] || '';
}

function findPrice(block: string) {
  const major = block.match(/class=["'][^"']*sale-item__tag--main-price[^"']*["'][^>]*>\s*([^<]+)<\/span>/i);
  if (!major) return null;
  const majorText = stripTags(major[1]);
  if (/\bod\b/iu.test(majorText)) return null;
  const crownsMatch = majorText.match(/\b(\d{1,4})\b/);
  if (!crownsMatch) return null;
  const minor = block.match(/class=["'][^"']*sale-item__tag--main-subprice[^"']*["'][^>]*>\s*(\d{1,2})\s*<\/span>/i);
  if (!minor) return null;
  const crowns = Number(crownsMatch[1]);
  const cents = Number(minor[1].padEnd(2, '0'));
  const price = crowns + cents / 100;
  return price >= 1 && price <= 5000 ? price : null;
}

async function parseProducts(html: string, today: string) {
  const heading = html.search(/Žabka\s+nabídka/iu);
  if (heading < 0) throw new Error('Oficiální sekce Žabka nabídka nebyla nalezena.');
  const section = html.slice(Math.max(0, heading - 2500), heading + 50000);
  const blocks = productBlocks(section);
  const rows: any[] = [];
  for (const block of blocks) {
    const image = findImage(block);
    const title = findTitle(block).replace(/\s+/g, ' ').trim();
    const price = findPrice(block);
    if (title.length < 4 || title.length > 160 || price === null) continue;
    if (!image) continue;
    const plain = stripTags(block);
    if (/\b(?:klub|aplikac|kup[oó]n|při koupi|od \d+ ks|jen pro členy)\b/iu.test(`${title} ${plain}`)) continue;
    const identity = await sha256(`${normalize(title)}|${image}`);
    rows.push({
      external_id: `zabka:homepage:${identity.slice(0, 40)}`,
      title,
      normalized_title: normalize(title),
      price,
      old_price: null,
      quantity_text: quantity(title),
      valid_from: today,
      valid_to: addDays(today, 1),
      source_url: SOURCE,
      source_page: 1,
      product_id: null,
      image_url: image,
      confidence: 0.99,
      metadata: {
        adapter: ADAPTER,
        parser_version: ADAPTER,
        evidence: {
          official_live_offer_section: true,
          displayed_price: price,
          conditional_price_rejected: true,
        },
      },
    });
  }
  const unique = [...new Map(rows.map((row) => [row.external_id, row])).values()];
  if (unique.length < 3 || unique.length > 12) {
    throw new Error(`Žabka parser našel ${unique.length} bezpečných produktů; očekáváno 3–12.`);
  }
  return unique;
}

async function markHealth(status: 'ok' | 'degraded', reason: string, count: number, error: string | null) {
  try {
    const { data: store } = await db.from('stores').select('id').eq('slug', 'zabka').maybeSingle();
    if (!store) return;
    await db.from('store_product_sync_state').update({
      health_status: status,
      health_reason: reason,
      last_offer_count: count,
      expected_offer_count: status === 'ok' ? count : undefined,
      minimum_offer_count: 3,
      last_run_at: new Date().toISOString(),
      last_success_at: status === 'ok' ? new Date().toISOString() : undefined,
      last_error: error,
      parser_version: ADAPTER,
      adapter_version: 'v3',
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
    const rows = await parseProducts(html, today);
    const signature = await sha256(rows.map((row) => `${row.external_id}|${row.price}|${row.valid_to}`).join('\n'));

    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'zabka').single();
    if (storeError || !store) throw storeError || new Error('Žabka nebyla nalezena.');

    const { data: source, error: sourceError } = await db.from('leaflet_sources')
      .select('id')
      .eq('store_id', store.id)
      .eq('source_url', SOURCE)
      .maybeSingle();
    if (sourceError) throw sourceError;

    if (source) {
      const { error: updateError } = await db.from('leaflet_sources').update({
        source_type: 'html',
        is_active: true,
        auto_publish: false,
        last_checked_at: new Date().toISOString(),
        last_error: null,
        adapter_key: ADAPTER,
        extraction_strategy: 'structured_html',
      }).eq('id', source.id);
      if (updateError) throw updateError;
    } else {
      const { error } = await db.from('leaflet_sources').insert({
        store_id: store.id,
        name: 'Žabka nabídka',
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

    const { data: result, error } = await db.rpc('publish_structured_store_offers', {
      p_store_slug: 'zabka',
      p_adapter: ADAPTER,
      p_signature: signature,
      p_rows: rows,
      p_min_products: 3,
      p_max_products: 12,
      p_source_document_url: SOURCE,
      p_parser_version: ADAPTER,
    });
    if (error) throw error;

    await markHealth(
      'ok',
      `Automaticky publikováno ${rows.length} pevných nabídek Žabka; podmíněné ceny typu od jsou vynechány.`,
      rows.length,
      null,
    );
    return json({ ok: true, store: store.name, published: rows.length, signature, result });
  } catch (error) {
    const message = errorText(error);
    await markHealth('degraded', `Žabka synchronizace selhala: ${message}`, 0, message);
    return json({ error: message, code: 'ZABKA_PRODUCTS_SYNC_FAILED' }, 500);
  }
});
