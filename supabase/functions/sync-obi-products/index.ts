import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret', 'content-type': 'application/json; charset=utf-8' };
const PARSER = 'obi-pdf-spatial-v1';
type Token = { text: string; x: number; y: number; width: number; height: number };
type Page = { page: number; tokens: Token[] };

function response(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: CORS }); }
function clean(value: unknown) { return String(value || '').replace(/\s+/g, ' ').trim(); }
function errorText(error: unknown) { return error instanceof Error ? error.message : String(error); }
async function allowed(request: Request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE || (CRON && request.headers.get('x-cron-secret') === CRON)) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function normalize(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function parseSku(text: string) { return text.match(/^OBI č\.\s*(\d{7})(?:\s|$)/i)?.[1] || null; }
function parsePrice(text: string) {
  const match = text.match(/^(\d{1,3}(?:[ .]\d{3})*),-$/);
  if (!match) return null;
  const value = Number(match[1].replace(/[ .]/g, ''));
  return Number.isFinite(value) && value >= 20 && value <= 100000 ? value : null;
}
function badContext(text: string) { return /(bez aplikace heyOBI|heyOBI|paletov[aá] cena|při koupi|od \d|za \d+ ks|pronájem|Kč\/(?:kg|m|m2|m²|l)|\bAKCE\b.*\bden)/i.test(text); }
function badTitle(text: string) {
  return text.length < 6 || text.length > 100 || !/[A-Za-zÁ-ž]/u.test(text) || /[*]|OBI č\.|cena|nabídka|sleva|aplikace|palet/i.test(text)
    || /^(?:bez|pro|při|od|včetně|barva|rozměr|balení|výhodné)/i.test(text);
}
function extract(pages: Page[], validFrom: string, validTo: string, sourceUrl: string) {
  const candidates: any[] = [];
  const rejected: any[] = [];
  for (const page of pages) {
    const tokens = (page.tokens || []).map((token) => ({ ...token, text: clean(token.text) }));
    for (const skuToken of tokens) {
      const sku = parseSku(skuToken.text);
      if (!sku || /\baj\./i.test(skuToken.text)) continue;
      const local = tokens.filter((t) => Math.abs(t.x - skuToken.x) <= 105 && Math.abs(t.y - skuToken.y) <= 150);
      const context = local.map((t) => t.text).join(' ');
      if (badContext(context)) { rejected.push({ page: page.page, sku, reason: 'conditional_context' }); continue; }
      const prices = local.filter((t) => parsePrice(t.text) !== null && Number(t.height) >= 14)
        .sort((a, b) => Math.abs(a.x - skuToken.x) + Math.abs(a.y - skuToken.y) - Math.abs(b.x - skuToken.x) - Math.abs(b.y - skuToken.y));
      if (prices.length !== 1) { rejected.push({ page: page.page, sku, reason: prices.length ? 'ambiguous_price' : 'missing_price' }); continue; }
      const priceToken = prices[0];
      const price = parsePrice(priceToken.text)!;
      const titleTokens = local.filter((t) => Number(t.height) >= 9.5 && Number(t.height) <= 15 && !badTitle(t.text)
        && t.y > skuToken.y && t.y <= skuToken.y + 90 && Math.abs(t.x - skuToken.x) <= 35)
        .sort((a, b) => b.y - a.y);
      if (!titleTokens.length) { rejected.push({ page: page.page, sku, reason: 'missing_title' }); continue; }
      const anchor = titleTokens[0];
      const title = clean(tokens.filter((t) => Number(t.height) >= 9.5 && Number(t.height) <= 15 && Math.abs(t.x - anchor.x) <= 7 && Math.abs(t.y - anchor.y) <= 20 && !badTitle(t.text)).sort((a, b) => b.y - a.y).map((t) => t.text).join(' '));
      if (badTitle(title)) continue;
      candidates.push({
        external_id: `obi:${sku}:${validFrom}:${validTo}`, title, normalized_title: normalize(title), price, old_price: null, quantity_text: null,
        valid_from: validFrom, valid_to: validTo, source_url: sourceUrl, source_page: Number(page.page), product_id: null, image_url: null,
        confidence: 0.98, metadata: { adapter: PARSER, parser_version: PARSER, obi_sku: sku, evidence: { sku_text: skuToken.text, sku_x: skuToken.x, sku_y: skuToken.y, price_text: priceToken.text, price_x: priceToken.x, price_y: priceToken.y } }
      });
    }
  }
  const unique = new Map<string, any>();
  for (const row of candidates) if (!unique.has(row.external_id)) unique.set(row.external_id, row);
  return { rows: [...unique.values()].sort((a, b) => a.source_page - b.source_page), rejected };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return response({ error: 'Unauthorized' }, 401);
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const importId = clean(body.import_id || '3cc5cda4-e7ae-4ec8-a01c-07019ddf319d');
    const { data: imported, error: importError } = await db.from('leaflet_imports').select('id,store_id,detected_valid_from,detected_valid_to,metadata,source_document_url').eq('id', importId).single();
    if (importError || !imported) throw importError || new Error('OBI import nebyl nalezen.');
    const { data: store } = await db.from('stores').select('slug').eq('id', imported.store_id).single();
    if (store?.slug !== 'obi') throw new Error('Import nepatří obchodu OBI.');
    const { data: extracted, error: textError } = await db.from('leaflet_extracted_text').select('parser,page_count,pages,text_chars').eq('import_id', importId).single();
    if (textError || !extracted || extracted.parser !== 'pdf-text-v3') throw textError || new Error('Chybí textová vrstva pdf-text-v3.');
    const parsed = extract(extracted.pages as Page[], String(imported.detected_valid_from), String(imported.detected_valid_to), String(imported.metadata?.viewer_url || imported.source_document_url));
    const rows = parsed.rows;
    const signature = await sha256(rows.map((r) => `${r.external_id}|${r.title}|${r.price}`).join('\n'));
    if (dryRun) return response({ ok: true, dry_run: true, import_id: importId, pages: extracted.page_count, text_chars: extracted.text_chars, publishable: rows.length, rejected: parsed.rejected.length, signature, candidates: rows, rejection_sample: parsed.rejected.slice(0, 50) });
    throw new Error('Publikace OBI je zablokovaná, dokud názvy a ceny nejsou ověřené proti oficiálním SKU.');
  } catch (error) { return response({ error: errorText(error), code: 'OBI_SPATIAL_SYNC_FAILED' }, 500); }
});
