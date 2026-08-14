import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const ADAPTER = 'auto-kelly-marketing-deals-v1';
const HOME = 'https://www.autokelly.cz/';
const ORIGIN = 'https://www.autokelly.cz';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: CORS }); }
function allowed(req: Request) { return req.headers.get('authorization') === `Bearer ${SERVICE_ROLE_KEY}` || Boolean(CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET); }
function clean(value: unknown) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function money(value: unknown) {
  const raw = String(value ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.').replace(/[^0-9.]/g, '');
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 100000 ? n : null;
}
function pragueToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
function quantity(title: string) {
  return title.match(/(?:\d+\s*[x×]\s*)?\d+(?:[,.]\d+)?\s*(?:ml|cl|l|g|kg|mm|cm|m|ks|kusů|párů)\b/i)?.[0] || null;
}
function getSetCookies(res: Response) {
  const headers = res.headers as any;
  const values: string[] = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : [];
  return values.map(x => x.split(';')[0]).join('; ');
}
function mergeCookies(a: string, b: string) {
  const map = new Map<string, string>();
  for (const raw of `${a};${b}`.split(';')) {
    const part = raw.trim();
    if (!part || !part.includes('=')) continue;
    const i = part.indexOf('=');
    map.set(part.slice(0, i), part.slice(i + 1));
  }
  return [...map].map(([k, v]) => `${k}=${v}`).join('; ');
}
async function post(path: string, cookie: string, body: unknown) {
  const response = await fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
      'accept': 'application/json, text/plain, */*',
      'accept-language': 'cs-CZ,cs;q=0.9',
      'content-type': 'application/json;charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest',
      'referer': HOME,
      'cookie': cookie,
    },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const text = await response.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* keep text */ }
  return { status: response.status, data, setCookie: getSetCookies(response) };
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, '0')).join('');
}
function safeImage(value: unknown) {
  const url = clean(value);
  if (!/^https:\/\//i.test(url)) return null;
  if (/EmptyImage|placeholder|no[-_]?image/i.test(url)) return null;
  if (!/^https:\/\/content\.lkq\.cz\//i.test(url)) return null;
  return url;
}
function safeProductUrl(value: unknown) {
  const path = clean(value);
  if (!/^\/Product\//i.test(path)) return null;
  try {
    const url = new URL(path, ORIGIN).toString();
    return url.startsWith(`${ORIGIN}/Product/`) ? url : null;
  } catch { return null; }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(req)) return json({ error: 'Unauthorized' }, 401);
  const body = await req.json().catch(() => ({}));
  try {
    const initial = await fetch(HOME, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
        'accept': 'text/html,application/xhtml+xml',
        'accept-language': 'cs-CZ,cs;q=0.9',
      },
      redirect: 'follow',
    });
    if (!initial.ok) throw new Error(`Auto Kelly homepage HTTP ${initial.status}`);
    await initial.text();
    let cookie = getSetCookies(initial);

    const deals = await post('/MarketingDeals/Data', cookie, {});
    cookie = mergeCookies(cookie, deals.setCookie);
    if (deals.status !== 200 || !deals.data?.data) throw new Error(`Auto Kelly MarketingDeals HTTP ${deals.status}`);
    const data = deals.data.data;
    if (data.showVatPrice !== true) throw new Error('Auto Kelly neposkytuje spotřebitelské ceny s DPH.');
    if (clean(data.weekly?.text) !== 'Probíhající akce') throw new Error(`Neočekávaná sekce weekly: ${clean(data.weekly?.text)}`);
    if (clean(data.sales?.text) !== 'Výprodej') throw new Error(`Neočekávaná sekce sales: ${clean(data.sales?.text)}`);

    const selected = [
      ...(Array.isArray(data.weekly?.products) ? data.weekly.products.map((p: any) => ({ ...p, section: 'weekly' })) : []),
      ...(Array.isArray(data.sales?.products) ? data.sales.products.map((p: any) => ({ ...p, section: 'sales' })) : []),
    ];
    const ids = [...new Set(selected.map((p: any) => String(p.ProductId || '')).filter(Boolean))];
    if (ids.length < 8 || ids.length > 50) throw new Error(`Auto Kelly MarketingDeals má podezřelý počet produktů: ${ids.length}.`);

    const prices = await post('/UserPrice/Data', cookie, { productIds: ids });
    if (prices.status !== 200 || !Array.isArray(prices.data?.Content)) throw new Error(`Auto Kelly UserPrice HTTP ${prices.status}`);
    const priceMap = new Map(prices.data.Content.map((p: any) => [String(p.ProductId), p]));
    const today = pragueToday();
    const rows: any[] = [];

    for (const product of selected) {
      const id = String(product.ProductId || '');
      const title = clean(product.ProductName);
      const sourceUrl = safeProductUrl(product.ProductLink);
      const current = priceMap.get(id) as any;
      const price = money(current?.PriceVat);
      const old = money(current?.OriginalPrice);
      if (!/^\d+$/.test(id) || title.length < 3 || title.length > 180 || !sourceUrl || !price) continue;
      rows.push({
        external_id: `autokelly:${id}`,
        title,
        normalized_title: normalize(title),
        brand: null,
        quantity_text: quantity(title),
        price,
        old_price: old && old > price ? old : null,
        valid_from: today,
        valid_to: today,
        source_url: sourceUrl,
        source_page: null,
        image_url: safeImage(product.ProductImage?.PathBig) || safeImage(product.ProductImage?.Path),
        confidence: 0.99,
        metadata: {
          adapter: ADAPTER,
          parser_version: ADAPTER,
          auto_kelly_product_id: id,
          auto_kelly_code: clean(product.ProductCode) || null,
          promotion_section: product.section,
          promotion_type: product.Type ?? null,
          source_label: product.section === 'weekly' ? 'Probíhající akce' : 'Výprodej',
          price_mode: 'vat_included',
          official_image: Boolean(safeImage(product.ProductImage?.PathBig) || safeImage(product.ProductImage?.Path)),
        },
      });
    }

    const unique = [...new Map(rows.map(r => [r.external_id, r])).values()].sort((a, b) => a.title.localeCompare(b.title, 'cs'));
    if (unique.length < 8 || unique.length > 20) throw new Error(`Po validaci zůstalo ${unique.length} Auto Kelly nabídek; očekáváno 8–20.`);
    const weeklyCount = unique.filter(x => x.metadata.promotion_section === 'weekly').length;
    const salesCount = unique.filter(x => x.metadata.promotion_section === 'sales').length;
    if (weeklyCount < 3 || salesCount < 3) throw new Error(`Auto Kelly sekce jsou neúplné: akce ${weeklyCount}, výprodej ${salesCount}.`);
    const signature = await sha256(`${today}|${unique.map(r => `${r.external_id}|${r.price}|${r.old_price || ''}|${r.source_url}`).join('\n')}`);

    if (body.dry_run === true) {
      return json({ ok: true, dry_run: true, adapter: ADAPTER, date: today, publishable: unique.length, weekly: weeklyCount, sales: salesCount, images: unique.filter(x => x.image_url).length, signature, candidates: unique });
    }

    const { data: result, error } = await db.rpc('publish_structured_store_offers', {
      p_store_slug: 'auto-kelly',
      p_adapter: ADAPTER,
      p_signature: signature,
      p_rows: unique,
      p_min_products: 8,
      p_max_products: 20,
      p_source_document_url: HOME,
      p_parser_version: ADAPTER,
    });
    if (error) throw error;
    return json({ ok: true, adapter: ADAPTER, published: unique.length, weekly: weeklyCount, sales: salesCount, images: unique.filter(x => x.image_url).length, signature, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { data: store } = await db.from('stores').select('id').eq('slug', 'auto-kelly').maybeSingle();
    if (store?.id) {
      await db.from('store_product_sync_state').upsert({ store_id: store.id, last_run_at: new Date().toISOString(), last_error: message, last_parser_error: message, health_status: 'degraded', health_reason: message, is_running: false, updated_at: new Date().toISOString() }, { onConflict: 'store_id' });
    }
    return json({ error: message, code: 'AUTO_KELLY_PRODUCTS_SYNC_FAILED' }, 500);
  }
});