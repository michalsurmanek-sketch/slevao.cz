import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SOURCE_URL = 'https://www.dm.cz/vyprodej/';
const API_URL = 'https://product-search.services.dmtech.com/cz/search/static?query=vyprodej&pageSize=90&searchType=search';
const PUBLISHER_URL = `${SUPABASE_URL}/functions/v1/publish-imports`;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-client-info',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}
function money(value: unknown) {
  if (typeof value === 'number') return value;
  return Number(String(value ?? '').replace(/[^0-9,.-]/g, '').replace(',', '.'));
}
function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
async function sha(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
    throw new Error(`dm publish-imports HTTP ${response.status}: ${text.slice(0, 800)}`);
  }
  return payload;
}
async function ensurePublished(importId: string, status: string) {
  if (status === 'published') return { reused: true };
  if (!['review', 'publishing'].includes(status)) {
    throw new Error(`dm import ${importId} je ve stavu ${status} a nelze jej bezpečně publikovat.`);
  }
  return await publishImport(importId);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const now = new Date();
  const nowIso = now.toISOString();
  const validFrom = isoDate(now);
  const validToDate = new Date(now);
  validToDate.setUTCDate(validToDate.getUTCDate() + 7);
  const validTo = isoDate(validToDate);

  try {
    const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'dm').single();
    if (storeError) throw storeError;

    let { data: source } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).order('created_at').limit(1).maybeSingle();
    if (!source) {
      const created = await db.from('leaflet_sources').insert({
        store_id: store.id,
        name: 'dm – aktuální nabídky',
        source_url: SOURCE_URL,
        source_type: 'api',
        is_active: true,
      }).select('id').single();
      if (created.error) throw created.error;
      source = created.data;
    }

    await db.from('leaflet_sources').update({
      name: 'dm – aktuální nabídky',
      source_url: SOURCE_URL,
      source_type: 'api',
      is_active: true,
      last_error: null,
      adapter_key: 'dm-product-api-v2',
      extraction_strategy: 'structured_api',
    }).eq('id', source.id);

    const response = await fetch(API_URL, {
      headers: {
        'user-agent': 'Mozilla/5.0',
        accept: 'application/json',
        origin: 'https://www.dm.cz',
        referer: SOURCE_URL,
      },
    });
    if (!response.ok) throw new Error(`dm API HTTP ${response.status}`);

    const payload = await response.json();
    const products = Array.isArray(payload?.products) ? payload.products : [];
    const items = products.map((product: any) => {
      const tile = product.tileData || {};
      const current = money(tile?.trackingData?.price ?? tile?.price?.price?.current?.value);
      const previous = money(tile?.price?.price?.previous?.value);
      const title = String(product.title || tile?.title?.tileHeadline || '').trim();
      const brand = String(product.brandName || tile?.brand?.name || '').trim() || null;
      const quantity = title.match(/\b\d+(?:[,.]\d+)?\s*(?:ml|l|g|kg|ks|bal)\b/i)?.[0] || null;
      const image = tile?.images?.[0]?.tileSrc || null;
      const productUrl = tile?.self ? new URL(tile.self, 'https://www.dm.cz').toString() : SOURCE_URL;
      return {
        title,
        brand,
        price: current,
        old_price: previous > current ? previous : null,
        quantity_text: quantity,
        image_url: image,
        confidence: 0.99,
        raw_data: {
          parser: 'dm-product-api-v2',
          gtin: product.gtin || null,
          dan: product.dan || null,
          product_url: productUrl,
          continuous_offer: true,
        },
      };
    }).filter((item: any) => item.title.length > 2 && item.price > 0);

    if (items.length < 5) throw new Error(`dm API vrátilo jen ${items.length} produktů.`);

    const sourceHash = await sha(`${source.id}|${validFrom}|${items.length}|${items.slice(0, 30).map((x: any) => `${x.title}:${x.price}:${x.old_price || ''}`).join('|')}|dm-product-api-v2`);
    const { data: existing, error: existingError } = await db.from('leaflet_imports').select('id,status').eq('source_hash', sourceHash).maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      const publish = await ensurePublished(existing.id, String(existing.status || ''));
      await db.from('leaflet_sources').update({
        last_checked_at: nowIso,
        last_success_at: nowIso,
        last_error: null,
        last_strategy_used: 'api',
        last_strategy_success_at: nowIso,
      }).eq('id', source.id);
      return json({ ok: true, existing: true, published: true, import_id: existing.id, items: items.length, valid_from: validFrom, valid_to: validTo, publish });
    }

    const { data: importRow, error: importError } = await db.from('leaflet_imports').insert({
      source_id: source.id,
      store_id: store.id,
      source_document_url: SOURCE_URL,
      source_hash: sourceHash,
      status: 'review',
      product_count: items.length,
      confidence: 0.99,
      detected_valid_from: validFrom,
      detected_valid_to: validTo,
      finished_at: nowIso,
      metadata: {
        adapter: 'dm-product-api-v2',
        ai_used: false,
        source_type: 'api',
        continuous_offer: true,
        validity_strategy: 'rolling_7_days',
        api_url: API_URL,
      },
    }).select('id').single();
    if (importError) throw importError;

    for (let i = 0; i < items.length; i += 200) {
      const rows = items.slice(i, i + 200).map((item: any) => ({
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
      const { error } = await db.from('leaflet_import_items').insert(rows);
      if (error) throw error;
    }

    const publish = await publishImport(importRow.id);
    await db.from('leaflet_sources').update({
      last_checked_at: nowIso,
      last_success_at: nowIso,
      last_error: null,
      last_strategy_used: 'api',
      last_strategy_success_at: nowIso,
    }).eq('id', source.id);

    return json({ ok: true, created: true, published: true, import_id: importRow.id, items: items.length, valid_from: validFrom, valid_to: validTo, publish });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { data: store } = await db.from('stores').select('id').eq('slug', 'dm').maybeSingle();
    if (store) {
      await db.from('leaflet_sources').update({ last_checked_at: nowIso, last_error: message }).eq('store_id', store.id);
    }
    return json({ error: message }, 500);
  }
});
