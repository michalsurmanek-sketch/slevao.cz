import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const ADAPTER = 'bauhaus-pdf-spatial-v1';
const PARSER = 'bauhaus-pdf-spatial-v1';
const MIN_SAFE = 20;
const MAX_SAFE = 260;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'content-type': 'application/json; charset=utf-8',
};

type Token = { text: string; x: number; y: number; width: number; height: number };
type Page = { page: number; tokens: Token[] };

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: CORS }); }
function message(error: unknown) {
  if (error instanceof Error) return error.message;
  return typeof error === 'object' ? JSON.stringify(error) : String(error);
}
async function allowed(request: Request) {
  const raw = request.headers.get('authorization') || '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE) return true;
  if (CRON && request.headers.get('x-cron-secret') === CRON) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function clean(value: unknown) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function normalizeTitle(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs').replace(/[^a-z0-9]+/g, ' ').trim();
}
function parsePrice(text: string) {
  if (!/^\d{1,3}(?:\.\d{3})?,-$/.test(text)) return null;
  const value = Number(text.slice(0, -2).replace('.', ''));
  return Number.isFinite(value) && value >= 20 && value <= 100000 ? value : null;
}
function isSku(text: string) { return /^\d{8}$/.test(text); }
function quantity(text: string) {
  const match = text.match(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|ks|m|m²|bal\.)\b/i);
  return match?.[0]?.replace(/\s+/g, ' ') || null;
}
function badTitle(text: string) {
  return text.length < 8 || text.length > 80 || !/[A-Za-zÁ-ž]/u.test(text) || /,-/.test(text)
    || /^•/.test(text) || (/^\S+$/.test(text) && /[áéíý]$/i.test(text))
    || /^(?:od |pro |do |na |a |v |s |bez |např|hmotnost|balení|šířka|délka|interiér|exteriér)/i.test(text)
    || /(bauhaus|nakupujte|záruka|cena|pal\.|sleva|platí|materiál|použití|vhodn|ochrana|kvalit|voděodol|ocel|výkon|servis)/i.test(text);
}
function nearby(tokens: Token[], price: Token, dx: number, dy: number) {
  return tokens.filter((token) => Math.abs(token.x - price.x) <= dx && Math.abs(token.y - price.y) <= dy);
}
function extract(pages: Page[], validFrom: string, validTo: string, viewerUrl: string) {
  const rows: any[] = [];
  const rejected: any[] = [];
  for (const page of pages) {
    const tokens = (page.tokens || []).map((token) => ({ ...token, text: clean(token.text) }));
    for (const priceToken of tokens) {
      const price = parsePrice(priceToken.text);
      if (!price || Number(priceToken.height) < 9.5) continue;
      const context = nearby(tokens, priceToken, 125, 45).map((token) => token.text).join(' ');
      if (/(?:\bod\b|při koupi|karta|klub|kupón|sleva\s*%|za\s*\d+\s*ks|pronájem|\/\s*(?:kg|m²?|l)\b)/i.test(context)) {
        rejected.push({ page: page.page, price, reason: 'conditional_price', context });
        continue;
      }
      const skus = tokens
        .filter((token) => isSku(token.text) && Math.abs(token.x - priceToken.x) <= 115 && Math.abs(token.y - priceToken.y) <= 170)
        .sort((a, b) => Math.abs(a.y - priceToken.y) - Math.abs(b.y - priceToken.y));
      if (!skus.length) {
        rejected.push({ page: page.page, price, reason: 'missing_spatial_sku' });
        continue;
      }
      const sku = skus[0];
      if (Math.abs(sku.y - priceToken.y) > 6 && Math.abs(sku.x - priceToken.x) > 15) {
        rejected.push({ page: page.page, price, sku: sku.text, reason: 'weak_sku_price_alignment' });
        continue;
      }
      const skuPriceSameLine = Math.abs(sku.y - priceToken.y) <= 6;
      const titles = tokens
        .filter((token) => {
          if (Number(token.height) < 9.5 || Number(token.height) > 15 || badTitle(token.text)) return false;
          const rowTitle = skuPriceSameLine && token.x >= priceToken.x + 25 && token.x <= priceToken.x + 190
            && token.y >= priceToken.y - 5 && token.y <= priceToken.y + 35;
          const columnTitle = Math.abs(token.x - sku.x) <= 60 && Math.abs(token.y - priceToken.y) >= 8
            && Math.abs(token.y - priceToken.y) <= 105;
          return skuPriceSameLine ? rowTitle : columnTitle;
        })
        .sort((a, b) => {
          const aRow = skuPriceSameLine && a.x >= priceToken.x + 25 && a.y >= priceToken.y - 5 && a.y <= priceToken.y + 35;
          const bRow = skuPriceSameLine && b.x >= priceToken.x + 25 && b.y >= priceToken.y - 5 && b.y <= priceToken.y + 35;
          if (aRow !== bRow) return aRow ? -1 : 1;
          return Math.abs(a.y - priceToken.y) - Math.abs(b.y - priceToken.y);
        });
      if (!titles.length) {
        rejected.push({ page: page.page, price, sku: sku.text, reason: 'missing_spatial_title' });
        continue;
      }
      const anchor = titles[0];
      const titleParts = tokens
        .filter((token) => Number(token.height) >= 9.5 && Number(token.height) <= 15
          && Math.abs(token.x - anchor.x) <= 8 && Math.abs(token.y - anchor.y) <= 22
          && /[A-Za-zÁ-ž]/u.test(token.text) && !/,-/.test(token.text))
        .sort((a, b) => b.y - a.y)
        .map((token) => token.text);
      const title = clean([...new Set(titleParts.length ? titleParts : [anchor.text])].join(' '));
      if (badTitle(title)) continue;
      rows.push({
        external_id: `bauhaus:${sku.text}:${validFrom}:${validTo}`,
        title,
        normalized_title: normalizeTitle(title),
        price,
        old_price: null,
        quantity_text: null,
        valid_from: validFrom,
        valid_to: validTo,
        source_url: viewerUrl,
        source_page: Number(page.page),
        product_id: null,
        image_url: null,
        confidence: 0.98,
        metadata: {
          adapter: ADAPTER,
          parser_version: PARSER,
          bauhaus_sku: sku.text,
          evidence: { price_text: priceToken.text, price_x: priceToken.x, price_y: priceToken.y, sku_x: sku.x, sku_y: sku.y, title_x: anchor.x, title_y: anchor.y },
        },
      });
    }
  }
  const unique = new Map<string, any>();
  for (const row of rows) {
    const previous = unique.get(row.external_id);
    if (!previous || String(row.title).length > String(previous.title).length) unique.set(row.external_id, row);
  }
  return { rows: [...unique.values()].sort((a, b) => a.source_page - b.source_page || a.title.localeCompare(b.title, 'cs')), rejected };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);
  let sourceId: string | null = null;
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const today = new Date().toISOString().slice(0, 10);
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'bauhaus').single();
    if (storeError || !store) throw storeError || new Error('Bauhaus nebyl nalezen.');
    const { data: source, error: sourceError } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).eq('is_active', true).limit(1).single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj Bauhaus nebyl nalezen.');
    sourceId = source.id;
    const { data: imported, error: importError } = await db.from('leaflet_imports')
      .select('id,detected_valid_from,detected_valid_to,metadata,source_document_url')
      .eq('store_id', store.id).lte('detected_valid_from', today).gte('detected_valid_to', today)
      .order('created_at', { ascending: false }).limit(1).single();
    if (importError || !imported) throw importError || new Error('Aktuální Bauhaus import nebyl nalezen.');
    const { data: extracted, error: textError } = await db.from('leaflet_extracted_text').select('parser,page_count,pages,text_chars').eq('import_id', imported.id).single();
    if (textError || !extracted) throw textError || new Error('Bauhaus nemá uloženou textovou vrstvu PDF.');
    if (extracted.parser !== 'pdf-text-v3' || Number(extracted.text_chars || 0) < 10000) throw new Error('Textová vrstva Bauhaus není dostatečná.');
    const validFrom = String(imported.detected_valid_from);
    const validTo = String(imported.detected_valid_to);
    const viewerUrl = String(imported.metadata?.viewer_url || imported.source_document_url);
    const parsed = extract(extracted.pages as Page[], validFrom, validTo, viewerUrl);
    if (parsed.rows.length < MIN_SAFE || parsed.rows.length > MAX_SAFE) throw new Error(`Bauhaus má ${parsed.rows.length} bezpečných kandidátů; očekáváno ${MIN_SAFE}–${MAX_SAFE}.`);
    const signature = await sha256(parsed.rows.map((row) => `${row.external_id}|${row.title}|${row.price}|${row.quantity_text || ''}`).join('\n'));
    if (dryRun) return json({ ok: true, dry_run: true, import_id: imported.id, pages: extracted.page_count, text_chars: extracted.text_chars, publishable: parsed.rows.length, rejected: parsed.rejected.length, signature, candidates: parsed.rows });
    throw new Error('Publikace Bauhaus je zablokovaná, dokud nejsou názvy kandidátů ověřené proti oficiálním SKU.');
    /* Publishing is intentionally unreachable until official SKU validation is implemented.
    const { data: result, error: publishError } = await db.rpc('publish_structured_store_offers', {
      p_store_slug: 'bauhaus', p_adapter: ADAPTER, p_signature: signature, p_rows: parsed.rows,
      p_min_products: MIN_SAFE, p_max_products: MAX_SAFE, p_source_document_url: imported.source_document_url, p_parser_version: PARSER,
    });
    if (publishError) throw publishError;
    await db.from('leaflet_sources').update({ last_checked_at: new Date().toISOString(), last_success_at: new Date().toISOString(), last_error: null, last_strategy_used: PARSER, last_strategy_success_at: new Date().toISOString() }).eq('id', source.id);
    return json({ ok: true, store: store.name, publishable: parsed.rows.length, signature, result });
    */
  } catch (error) {
    const text = message(error);
    if (sourceId) await db.from('leaflet_sources').update({ last_checked_at: new Date().toISOString(), last_error: text.slice(0, 1000) }).eq('id', sourceId);
    return json({ error: text, code: 'BAUHAUS_SPATIAL_SYNC_FAILED' }, 500);
  }
});
