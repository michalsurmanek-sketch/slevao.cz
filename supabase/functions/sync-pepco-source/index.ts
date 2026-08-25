import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://pepco.cz/kolekce/letaky/';
const PUBLISH_URL = `${SUPABASE_URL}/functions/v1/publish-imports`;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'content-type': 'application/json; charset=utf-8',
};
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

type ParsedProduct = {
  title: string;
  description: string | null;
  price: number;
  productUrl: string;
  imageUrl: string | null;
};

type DateRange = { from: string; to: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    return [value.message, value.details, value.hint, value.code].filter(Boolean).map(String).join(' | ') || JSON.stringify(error);
  }
  return String(error);
}

async function allowed(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE_ROLE_KEY) return true;
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}

function decode(value: string) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function clean(value: string) {
  return decode(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function money(value: string | null | undefined) {
  const normalized = clean(String(value || ''))
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[^0-9.]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 2 && parsed < 100_000 ? parsed : null;
}

function quantity(value: string) {
  return value.match(/\b\d+(?:[,.]\d+)?\s*(?:ml|cl|l|g|kg|ks|bal(?:ení)?|pár|dílů|cm|mm)\b/i)?.[0] || null;
}

function pragueToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function pragueYear() {
  return Number(pragueToday().slice(0, 4));
}

function validIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return month >= 1 && month <= 12 && day >= 1
    && date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function dateRange(fromDay: number, fromMonth: number, toDay: number, toMonth: number): DateRange | null {
  const fromYear = pragueYear();
  const toYear = toMonth < fromMonth ? fromYear + 1 : fromYear;
  if (!validIsoDate(fromYear, fromMonth, fromDay) || !validIsoDate(toYear, toMonth, toDay)) return null;
  const from = `${fromYear}-${String(fromMonth).padStart(2, '0')}-${String(fromDay).padStart(2, '0')}`;
  const to = `${toYear}-${String(toMonth).padStart(2, '0')}-${String(toDay).padStart(2, '0')}`;
  return from <= to ? { from, to } : null;
}

function parseDateRange(html: string): DateRange | null {
  const text = clean(html);
  const numeric = text.match(/(?:jen\s+)?od\s+(\d{1,2})\.\s*(\d{1,2})\.\s+do\s+(\d{1,2})\.\s*(\d{1,2})\./i)
    || text.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*[–—-]\s*(\d{1,2})\.\s*(\d{1,2})\./i);
  if (numeric) return dateRange(Number(numeric[1]), Number(numeric[2]), Number(numeric[3]), Number(numeric[4]));

  const months: Record<string, number> = {
    ledna: 1, února: 2, unora: 2, března: 3, brezna: 3, dubna: 4,
    května: 5, kvetna: 5, června: 6, cervna: 6, července: 7, cervence: 7,
    srpna: 8, září: 9, zari: 9, října: 10, rijna: 10, listopadu: 11, prosince: 12,
  };
  const named = text.match(/(?:v\s+nabídce\s+)?od\s+(\d{1,2})\.\s+do\s+(\d{1,2})\.\s+(ledna|února|unora|března|brezna|dubna|května|kvetna|června|cervna|července|cervence|srpna|září|zari|října|rijna|listopadu|prosince)/i);
  if (!named) return null;
  const month = months[named[3].toLocaleLowerCase('cs')];
  return month ? dateRange(Number(named[1]), month, Number(named[2]), month) : null;
}

function collectionTitle(html: string) {
  const headings = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
    .map((match) => clean(match[1]))
    .filter((value) => value.length >= 3 && value.length <= 140);
  return headings.find((value) => !/pepco|kolekce|leták/i.test(value)) || headings[0] || 'Aktuální leták Pepco';
}

function absolute(value: string | null | undefined, base = SOURCE_URL) {
  try { return value ? new URL(decode(value), base).toString() : null; }
  catch { return null; }
}

function parseProducts(html: string): ParsedProduct[] {
  const products: ParsedProduct[] = [];
  const starts = [...html.matchAll(/<a[^>]+href=["']([^"']*\/products\/[^"']+)["'][^>]*>/gi)];

  for (const startMatch of starts) {
    const start = startMatch.index || 0;
    const end = html.indexOf('</a>', start);
    if (end < 0 || end - start > 35_000) continue;
    const block = html.slice(start, end + 4);
    const openTag = startMatch[0];
    const productUrl = absolute(startMatch[1]);
    if (!productUrl) continue;

    const heading = clean(block.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '');
    const cardLabel = decode(openTag.match(/aria-label=["']([^"']+)["']/i)?.[1] || '');
    const labelMatch = cardLabel.match(/^(.+?)\s*-\s*([0-9]+(?:[.,][0-9]+)?)\s*Kč\s*$/i);
    const title = heading || clean(labelMatch?.[1] || '');
    const price = money(
      block.match(/aria-label=["']Product price:\s*([^"']+)["']/i)?.[1]
      || labelMatch?.[2]
      || block.match(/class=["'][^"']*price-medium[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1],
    );
    if (title.length < 3 || title.length > 220 || !price) continue;

    const description = clean(
      block.match(/aria-label=["']Product description:\s*([^"']+)["']/i)?.[1]
      || block.match(/class=["'][^"']*line-clamp-2[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
      || '',
    ) || null;
    products.push({ title, description, price, productUrl, imageUrl: null });
  }

  const unique = new Map<string, ParsedProduct>();
  for (const product of products) {
    const key = `${product.productUrl}|${product.price}`;
    if (!unique.has(key)) unique.set(key, product);
  }
  return [...unique.values()];
}

async function fetchText(url: string, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return { text: await response.text(), finalUrl: response.url };
  } finally {
    clearTimeout(timer);
  }
}

function imageFromDetail(html: string, pageUrl: string) {
  const candidates = [
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1],
    html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1],
    html.match(/"image"\s*:\s*"([^"]+)"/i)?.[1],
  ];
  for (const candidate of candidates) {
    const url = absolute(candidate, pageUrl);
    if (url && /^https:\/\//i.test(url)) return url;
  }
  return null;
}

async function enrichImages(products: ParsedProduct[]) {
  const output = [...products];
  let cursor = 0;
  async function worker() {
    while (cursor < output.length) {
      const index = cursor++;
      try {
        const detail = await fetchText(output[index].productUrl, 10_000);
        output[index].imageUrl = imageFromDetail(detail.text, detail.finalUrl);
      } catch (error) {
        console.warn('Pepco image skipped', output[index].productUrl, errorText(error));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(10, output.length) }, worker));
  return output;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function publishImport(importId: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(PUBLISH_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ import_id: importId }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: any = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { /* handled below */ }
    if (!response.ok) throw new Error(`publish-imports HTTP ${response.status}: ${text.slice(0, 800)}`);
    if (payload?.ok !== true || Number(payload?.processed || 0) < 1) {
      throw new Error(`publish-imports nepotvrdil zpracování Pepco importu ${importId}.`);
    }
    const result = Array.isArray(payload.results)
      ? payload.results.find((item: any) => String(item?.import_id || '') === importId)
      : null;
    if (!result || result.error) throw new Error(`Pepco publikace selhala: ${String(result?.error || 'chybí výsledek')}`);
    if (Number(result.published || 0) < 1 && Number(result.duplicates || 0) < 1) {
      throw new Error('Pepco publisher nevytvořil ani nepotvrdil žádnou nabídku.');
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function currentOfferCount(storeId: string, range: DateRange) {
  const today = pragueToday();
  const { count, error } = await db.from('offers')
    .select('id', { count: 'exact', head: true })
    .eq('store_id', storeId)
    .eq('status', 'published')
    .lte('valid_from', today)
    .gte('valid_to', today);
  if (error) throw error;
  if (range.to >= today && Number(count || 0) < 1) throw new Error('Pepco po publikaci nemá žádnou aktuální nabídku.');
  return Number(count || 0);
}

async function archiveDuplicateReviews(sourceId: string, importId: string, range: DateRange) {
  const { data, error } = await db.from('leaflet_imports')
    .select('id,metadata')
    .eq('source_id', sourceId)
    .eq('status', 'review')
    .eq('detected_valid_from', range.from)
    .eq('detected_valid_to', range.to)
    .neq('id', importId);
  if (error) throw error;
  for (const row of data || []) {
    const { error: updateError } = await db.from('leaflet_imports').update({
      status: 'ignored',
      metadata: { ...(row.metadata || {}), archive_reason: 'superseded_pepco_review', archived_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }).eq('id', row.id);
    if (updateError) throw updateError;
  }
}

async function markSourceSuccess(sourceId: string, checkedAt: string) {
  const { error } = await db.from('leaflet_sources').update({
    last_checked_at: checkedAt,
    last_success_at: checkedAt,
    last_error: null,
    last_strategy_used: 'structured_html_synchronous_publish',
    last_strategy_success_at: checkedAt,
  }).eq('id', sourceId);
  if (error) throw error;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  const checkedAt = new Date().toISOString();
  let sourceId = '';
  try {
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'pepco').single();
    if (storeError || !store) throw storeError || new Error('Obchod Pepco nebyl nalezen.');

    const { data: source, error: sourceError } = await db.from('leaflet_sources')
      .select('id')
      .eq('store_id', store.id)
      .eq('source_url', SOURCE_URL)
      .eq('is_active', true)
      .single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj Pepco nebyl nalezen.');
    sourceId = source.id;

    const page = await fetchText(SOURCE_URL, 18_000);
    const range = parseDateRange(page.text);
    if (!range) throw new Error('Pepco nevrátilo rozpoznatelnou platnost kolekce.');
    if (range.to < pragueToday()) throw new Error(`Pepco kolekce už skončila ${range.to}.`);

    const title = collectionTitle(page.text);
    const parsed = parseProducts(page.text);
    if (parsed.length < 10) throw new Error(`Pepco parser našel jen ${parsed.length} produktů.`);
    const products = await enrichImages(parsed);
    const sourceHash = await sha256(`${source.id}|${title}|${range.from}|${range.to}|${products.length}|pepco-collection-html-v2`);

    const { data: existing, error: existingError } = await db.from('leaflet_imports')
      .select('id,status,product_count')
      .eq('source_hash', sourceHash)
      .maybeSingle();
    if (existingError) throw existingError;

    let importId = existing?.id || '';
    let publishResult: any = null;

    if (existing && existing.status === 'published') {
      await archiveDuplicateReviews(source.id, existing.id, range);
      const offers = await currentOfferCount(store.id, range);
      await markSourceSuccess(source.id, checkedAt);
      return json({ ok: true, existing: true, published: true, import_id: existing.id, items: existing.product_count, current_offers: offers, title, ...range });
    }

    if (existing && ['review', 'publishing'].includes(String(existing.status || ''))) {
      publishResult = await publishImport(existing.id);
      await archiveDuplicateReviews(source.id, existing.id, range);
      const offers = await currentOfferCount(store.id, range);
      await markSourceSuccess(source.id, checkedAt);
      return json({ ok: true, existing: true, published: true, import_id: existing.id, items: existing.product_count, current_offers: offers, publish_result: publishResult, title, ...range });
    }

    if (existing) throw new Error(`Pepco import ${existing.id} je ve stavu ${existing.status} a nelze ho bezpečně znovu publikovat.`);

    const { data: imported, error: importError } = await db.from('leaflet_imports').insert({
      source_id: source.id,
      store_id: store.id,
      source_document_url: SOURCE_URL,
      source_hash: sourceHash,
      status: 'review',
      product_count: products.length,
      confidence: 0.95,
      detected_valid_from: range.from,
      detected_valid_to: range.to,
      finished_at: checkedAt,
      metadata: { adapter: 'pepco-collection-html-v2', title, ai_used: false, synchronous_publish: true },
    }).select('id').single();
    if (importError || !imported) throw importError || new Error('Import Pepco se nepodařilo vytvořit.');
    importId = imported.id;

    const rows = products.map((product) => ({
      import_id: imported.id,
      title: product.title,
      quantity_text: quantity(`${product.title} ${product.description || ''}`),
      price: product.price,
      old_price: null,
      image_url: product.imageUrl,
      confidence: product.imageUrl ? 0.97 : 0.93,
      status: 'review',
      raw_data: {
        parser: 'pepco-collection-html-v2',
        collection_title: title,
        product_url: product.productUrl,
        description: product.description,
        source_url: SOURCE_URL,
      },
    }));

    for (let index = 0; index < rows.length; index += 200) {
      const { error } = await db.from('leaflet_import_items').insert(rows.slice(index, index + 200));
      if (error) throw error;
    }

    publishResult = await publishImport(imported.id);
    await archiveDuplicateReviews(source.id, imported.id, range);
    const offers = await currentOfferCount(store.id, range);
    await markSourceSuccess(source.id, checkedAt);

    return json({
      ok: true,
      created: true,
      published: true,
      import_id: imported.id,
      title,
      parsed_items: products.length,
      current_offers: offers,
      items_with_images: products.filter((product) => product.imageUrl).length,
      publish_result: publishResult,
      valid_from: range.from,
      valid_to: range.to,
    });
  } catch (error) {
    const message = errorText(error);
    if (sourceId) {
      await db.from('leaflet_sources').update({ last_checked_at: checkedAt, last_error: message.slice(0, 1000) }).eq('id', sourceId);
    }
    return json({ error: message }, 500);
  }
});
