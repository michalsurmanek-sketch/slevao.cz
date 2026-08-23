import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SOURCE_URL = 'https://www.rossmann.cz/akce-a-slevy';
const PUBLISHER_URL = `${SUPABASE_URL}/functions/v1/publish-imports`;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: CORS }); }
function clean(value: string) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
function price(value: string) {
  const match = String(value || '').replace(/\s/g, '').match(/(\d{1,6}(?:[.,]\d{1,2})?)/);
  return match ? Number(match[1].replace(',', '.')) : null;
}
function iso(date: Date) { return date.toISOString().slice(0, 10); }
async function sha(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function parse(html: string) {
  const parts = html.split(/<div class="product-tile"/i).slice(1);
  const out: any[] = [];
  const seen = new Set<string>();
  for (const block of parts) {
    const title = clean(block.match(/product-tile__title[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] || '');
    const brand = clean(block.match(/product-tile__sub--title[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '') || null;
    const amount = clean(block.match(/product-tile__sub--amount[^>]*>([\s\S]*?)<\/span>/i)?.[1] || '') || null;
    const code = clean(block.match(/product-tile__code[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '').replace(/^Obj\.\s*č\.:\s*/i, '') || null;
    const priceBlock = block.match(/<div class="product-tile__price"[\s\S]*?<div class="product-tile__buy"/i)?.[0] || '';
    const priceTexts = [...priceBlock.matchAll(/>([^<>]*\d[^<>]*Kč[^<>]*)</gi)].map((x) => clean(x[1])).filter(Boolean);
    const numbers = priceTexts.map(price).filter((x): x is number => typeof x === 'number' && x > 0);
    if (title.length < 3 || !numbers.length) continue;
    const current = numbers[numbers.length - 1];
    const oldPrice = numbers.length > 1 && numbers[0] > current ? numbers[0] : null;
    const images = [...block.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((x) => x[1].replace(/&amp;/g, '&'));
    const image = images.find((x) => /\/PRODUCT-/i.test(x)) || null;
    const href = (block.match(/product-tile__title[\s\S]*?<a[^>]+href="([^"]+)"/i)?.[1] || '').replace(/&amp;/g, '&');
    const productUrl = href ? new URL(href, SOURCE_URL).toString() : SOURCE_URL;
    const key = `${title.toLowerCase()}|${current}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title,
      brand,
      quantity_text: amount,
      price: current,
      old_price: oldPrice,
      image_url: image,
      confidence: 0.98,
      raw_data: { parser: 'rossmann-html-v1', product_code: code, product_url: productUrl },
    });
  }
  return out;
}
async function publishImport(importId: string) {
  const response = await fetch(PUBLISHER_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ import_id: importId }),
  });
  const text = await response.text();
  let payload: any = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  const result = Array.isArray(payload?.results) ? payload.results[0] : null;
  if (!response.ok || payload?.ok === false || result?.error) {
    throw new Error(`Rossmann publish-imports HTTP ${response.status}: ${text.slice(0, 800)}`);
  }
  return payload;
}
async function ensurePublished(importId: string, status: string) {
  if (status === 'published') return { reused: true };
  if (!['review', 'publishing'].includes(status)) {
    throw new Error(`Rossmann import ${importId} je ve stavu ${status} a nelze jej bezpečně publikovat.`);
  }
  return await publishImport(importId);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const now = new Date().toISOString();
  try {
    const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'rossmann').single();
    if (storeError) throw storeError;
    let { data: source } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).order('created_at').limit(1).maybeSingle();
    if (!source) {
      const created = await db.from('leaflet_sources').insert({ store_id: store.id, name: 'ROSSMANN – akce a slevy', source_url: SOURCE_URL, source_type: 'html', is_active: true }).select('id').single();
      if (created.error) throw created.error;
      source = created.data;
    }
    await db.from('leaflet_sources').update({
      name: 'ROSSMANN – akce a slevy',
      source_url: SOURCE_URL,
      source_type: 'html',
      is_active: true,
      last_error: null,
      adapter_key: 'rossmann-html',
      extraction_strategy: 'structured_html',
    }).eq('id', source.id);

    const response = await fetch(SOURCE_URL, { headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'cs-CZ,cs;q=0.9' }, redirect: 'follow' });
    if (!response.ok) throw new Error(`Rossmann stránka HTTP ${response.status}`);
    const html = await response.text();
    const items = parse(html);
    if (items.length < 10) throw new Error(`Rossmann parser našel jen ${items.length} produktů.`);

    const from = new Date();
    const to = new Date();
    to.setUTCDate(to.getUTCDate() + 7);
    const validFrom = iso(from);
    const validTo = iso(to);
    const sourceHash = await sha(`${source.id}|${validFrom}|${items.length}|${items.map((x) => `${x.title}:${x.price}`).join('|')}|rossmann-html-v1`);
    const { data: existing, error: existingError } = await db.from('leaflet_imports').select('id,status').eq('source_hash', sourceHash).maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      const publish = await ensurePublished(existing.id, String(existing.status || ''));
      await db.from('leaflet_sources').update({ last_checked_at: now, last_success_at: now, last_error: null, last_strategy_used: 'structured_html', last_strategy_success_at: now }).eq('id', source.id);
      return json({ ok: true, existing: true, published: true, import_id: existing.id, items: items.length, valid_from: validFrom, valid_to: validTo, publish });
    }

    const { data: importRow, error: importError } = await db.from('leaflet_imports').insert({
      source_id: source.id,
      store_id: store.id,
      source_document_url: SOURCE_URL,
      source_hash: sourceHash,
      status: 'review',
      product_count: items.length,
      confidence: 0.98,
      detected_valid_from: validFrom,
      detected_valid_to: validTo,
      finished_at: now,
      metadata: { adapter: 'rossmann-html-v1', ai_used: false, source_type: 'structured_html', validity_strategy: 'rolling_7_days' },
    }).select('id').single();
    if (importError) throw importError;
    const rows = items.map((item) => ({
      import_id: importRow.id,
      title: item.title,
      brand: item.brand,
      quantity_text: item.quantity_text,
      price: item.price,
      old_price: item.old_price,
      image_url: item.image_url,
      confidence: item.confidence,
      status: 'review',
      raw_data: item.raw_data,
    }));
    const { error: rowError } = await db.from('leaflet_import_items').insert(rows);
    if (rowError) throw rowError;

    const publish = await publishImport(importRow.id);
    await db.from('leaflet_sources').update({ last_checked_at: now, last_success_at: now, last_error: null, last_strategy_used: 'structured_html', last_strategy_success_at: now }).eq('id', source.id);
    return json({ ok: true, created: true, published: true, import_id: importRow.id, items: items.length, valid_from: validFrom, valid_to: validTo, publish });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { data: store } = await db.from('stores').select('id').eq('slug', 'rossmann').maybeSingle();
    if (store) await db.from('leaflet_sources').update({ last_checked_at: now, last_error: message }).eq('store_id', store.id);
    return json({ error: message }, 500);
  }
});
