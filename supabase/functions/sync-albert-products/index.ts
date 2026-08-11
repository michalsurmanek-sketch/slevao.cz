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
const FETCH_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/json,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};
const MIN_SAFE = 220;
const MAX_SAFE = 900;
const PARSER = 'albert-publitas-text-v4';
const PUBLISHER = 'publish_albert_publitas_text_offers_v4';

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: CORS }); }
function errorText(error: unknown) { if (error instanceof Error) return error.message; if (error && typeof error === 'object') { const e = error as Record<string, unknown>; return [e.message, e.details, e.hint, e.code].filter(Boolean).map(String).join(' | ') || JSON.stringify(error); } return String(error); }
async function authorized(request: Request) { const raw = request.headers.get('authorization') || ''; const token = raw.replace(/^Bearer\s+/i, '').trim(); if (token === SERVICE) return true; if (CRON && request.headers.get('x-cron-secret') === CRON) return true; if (!token) return false; const { data, error } = await db.auth.getUser(token); return !error && !!data.user && ['admin', 'editor'].includes(String(data.user.app_metadata?.role || '').toLowerCase()); }
async function hash(value: string) { const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
function norm(value: string) { return String(value || '').toLocaleLowerCase('cs').replace(/[^a-z0-9áčďéěíňóřšťúůýž]+/giu, ' ').trim().replace(/\s+/g, ' '); }
function quantityKey(value: string | null | undefined) { return String(value || '').toLocaleLowerCase('cs').replace(/,/g, '.').replace(/[^0-9a-z.]+/g, ''); }

const PRICE = /^[•▼]\s*(\d{1,4}(?:[,.]\d{1,2})?|\d{1,4},-)\s*Kč(?:\s|$)/iu;
const BAD = /(?:AKČNÍ NABÍDKA|Z BĚŽNÝCH CEN|BĚŽNÁ CENA|NEPORAZITELNÉ|APLIKACE|PŘI KOUPI|POSLEDNÍ ŠANCE|SOUTĚŽ|KREDITY|CO KUPUJETE|NAVÍC|VÍCE AKCÍ|EXTRA LETÁK|AKCE PLATÍ|informací|www\.|Galerie|Arkády|Forum|neplatí pro hypermarket|vybrané druhy|ušetříte|sleva s aplikací|cena s aplikací)/iu;
const START_BAD = /^(?:BEZ|CENA|CENY|BOD|NOVINKA|VÝBĚRU|PŘI|POUZE|DĚLÍ|SOUTĚŽ|AKČNÍ|EXTRA|VÍCE|NAVÍC|APLIKACE|PLATÍ|Od\b|www\.)/iu;
const DESC = /^(?:ochucen[áé]|přírodní|instantní|světl[ýé]|tmav[ýé]|dětský|funkční|masný|chlazen[áé]|zrnková|prostředek|odmašťovač|vermut|Itálie|Francie|Chile|Španělsko|Austrálie|skládané|z podestýlky|druhy|různé druhy|mix druhů|balení)$/iu;
const ONLY_NUM = /^(?:-?\d+\s*%|\d+(?:[,.]\d+)?(?:\s*,-)?|\d+\s*[a-z]{1,3})$/iu;
const GENERIC_BANNER = /^(?:A NATURE.?S PROMISE|Active PRO|Bag in Box|Barva|BARVY|Aviváž|Austrálie|Care Pánský|CENY|BĚŽNÁ CENA|Aplikace|Výběru|Při koupi|A VYHRAJ)$/iu;
const PRODUCT_WORD = /(?:mléko|krém|vodka|gin|rum|whisk|pivo|ležák|oplat|chips|káva|čaj|olej|omáčk|sýr|jogurt|zmrzlin|prací|kapsl|tablet|papír|kapesník|ubrousk|plenk|nápoj|sirup|bonbon|čokolád|těstovin|rýž|mouka|cukr|máslo|maso|kuř|burger|brokolic|rajč|banán|jabl|mandl|kukuřic|nudl|steliv|krmiv|pochout|deodorant|šampon|zubní|sprchov|aviváž|prostředek|mýdlo|pastelk|pánev|mop|houbičk|džus|voda|minerální|sekt|víno|frizzante|primitivo|prosecco|aperitivo|likér|tyčink|kaše|müsli|krekry|grissini|kořen|paprika|bujón|paštik|granule|toaletní|gel|barva na vlasy|sprej|sérum|šunka|salám|klobás|pečivo|chléb|rohlík|vejce|smetan|tvaroh|pomazán|majon|tatarsk|tuňák|losos|sardin|šprot|hranol|brambor|fazol|hrášek|kečup|hořčic|med|džem|cereál|sušenk|piškot|čistič|wc blok|kartáček|pasta|stelivo)/iu;
const LOW_SPECIFICITY = /^(?:frizzante|primitivo|vodka|mouka|mandle|mini|bonb[oó]ny|cukr|sirup|sýr|jogurt|zmrzlina|pivo|oplatka|deodorant(?: sprej)?|granule pro psy|gran reserva|víno|sekt|prosecco|rum|gin|whisky|káva|čaj|máslo|mléko|tvaroh|smetana|šunka|salám|klobása|rýže|těstoviny)$/iu;
const BRAND_STOP = /(?:akční|nabídka|běžn|sleva|cena|aplikac|platí|různé|druhy|balení|obsah|kusů|procent|ušetříte|více|extra|pouze|výběru|novinka|potraviny|drogerie|kosmetika|nápoje)/iu;
const QTY_UNIT = '(?:kg|g|ml|l|cl|ks|kus(?:y|ů)?|bal(?:ení)?|rol(?:e|í)|dáv(?:ka|ek))';
const QTY_RE = new RegExp(`(?:\\d+\\s*[x×]\\s*)?\\d+(?:[,.]\\d+)?\\s*${QTY_UNIT}(?:\\s*[/–-]\\s*(?:\\d+\\s*[x×]\\s*)?\\d+(?:[,.]\\d+)?\\s*${QTY_UNIT})?`, 'iu');
const SUSPECT = /(?:frizzante|primitivo|vodka|mouka|mandl|granule|staropramen|mini|bonbon|deodorant|cukr|zmrzlin|jogurt|pivo|gran reserva)/iu;

function clean(value: string) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[•▼]\s*/u, '')
    .replace(/^-?\d{1,2}\s*%\s*/u, '')
    .replace(/^\d{1,2}\s*[x×]\s+(?=[A-ZÁ-Ž])/u, '')
    .replace(/^\d{1,2}\s+(?:potraviny|drogerie|kosmetika|nápoje)\s+/iu, '')
    .replace(/^\d{1,4}[,.]?\s+(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])/u, '')
    .replace(/^(?:EXTRA LETÁK|VÍCE AKCÍ|CO KUPUJETE NEJRADĚJI)\s+/iu, '')
    .trim();
}
function allCaps(line: string) { const letters = line.replace(/[^A-Za-zÁ-ž]/gu, ''); return letters.length >= 5 && letters === letters.toLocaleUpperCase('cs'); }
function containsQuantity(line: string) { return QTY_RE.test(String(line || '').replace(/\s*=.*$/u, '')); }
function extractQuantity(lines: string[], titleIndex: number, priceIndex: number, title: string) {
  const candidates: string[] = [title];
  const end = Math.min(priceIndex, titleIndex + 5);
  for (let i = titleIndex + 1; i < end; i++) candidates.push(lines[i]);
  for (const raw of candidates) {
    const line = clean(raw);
    if (!line || PRICE.test(line) || /(?:Kč|=\s*\d|cena\s+za)/iu.test(line)) continue;
    const match = line.match(QTY_RE);
    if (!match) continue;
    const qty = match[0].replace(/\s+/g, ' ').replace(/\s*([/–-])\s*/g, '$1').trim();
    if (/^\d+\s*%$/u.test(qty)) continue;
    return qty;
  }
  return null;
}
function stripTrailingQuantity(title: string) { const match = title.match(QTY_RE); if (!match || match.index === undefined) return title; const before = title.slice(0, match.index).replace(/[·,;:/\-–]+\s*$/u, '').trim(); const after = title.slice(match.index + match[0].length).trim(); return before && (!after || /^(?:balení|láhev|plech|PET|multipack)$/iu.test(after)) ? before : title; }
function goodTitle(line: string) { if (!line || line.length < 3 || line.length > 90) return false; if (BAD.test(line) || START_BAD.test(line) || DESC.test(line) || ONLY_NUM.test(line) || GENERIC_BANNER.test(line)) return false; if (PRICE.test(line) || /Kč(?:\s|$)/iu.test(line) || /^[-–%]/u.test(line)) return false; if (containsQuantity(line) && norm(stripTrailingQuantity(line)).split(' ').filter(Boolean).length === 0) return false; if (allCaps(line) && !PRODUCT_WORD.test(line)) return false; if (/[,;:]\s*$/u.test(line)) return false; const words = norm(stripTrailingQuantity(line)).split(' ').filter(Boolean); if (words.length < 1 || words.length > 10) return false; const first = line.charAt(0); return first === first.toLocaleUpperCase('cs') && /[A-Za-zÁ-ž]/u.test(first); }
function brandCandidate(line: string) { const value = clean(line); if (!value || value.length < 2 || value.length > 45) return false; if (!/^[A-Za-zÁ-ž]/u.test(value) || /%/u.test(value)) return false; if (BAD.test(value) || START_BAD.test(value) || DESC.test(value) || ONLY_NUM.test(value) || GENERIC_BANNER.test(value) || BRAND_STOP.test(value)) return false; if (PRICE.test(value) || /Kč/iu.test(value) || containsQuantity(value) || PRODUCT_WORD.test(value)) return false; const words = norm(value).split(' ').filter(Boolean); if (words.length < 1 || words.length > 4) return false; return /[A-Za-zÁ-ž]/u.test(value); }
function findBrand(lines: string[], titleIndex: number) { for (let offset = 1; offset <= 3 && titleIndex - offset >= 0; offset++) { const candidate = clean(lines[titleIndex - offset]); if (brandCandidate(candidate)) return candidate; } return null; }
function lowSpecificity(title: string) { const n = norm(title); const tokens = n.split(' ').filter(Boolean); return LOW_SPECIFICITY.test(n) || (tokens.length <= 2 && PRODUCT_WORD.test(n)); }
function identityStrength(title: string, brand: string | null, quantity: string | null) { const tokenCount = norm(title).split(' ').filter(Boolean).length; if (brand && quantity) return 'strong'; if (quantity && tokenCount >= 2 && !lowSpecificity(title)) return 'strong'; if (quantity || brand || tokenCount >= 3) return 'medium'; return 'weak'; }
function dataFromHtml(html: string) { const marker = 'var data ='; const start = html.indexOf(marker); const jsonStart = html.indexOf('{', start + marker.length); const end = html.indexOf('Reader.Bootstrap.init', jsonStart); if (start < 0 || jsonStart < 0 || end < 0) throw new Error('Publitas data mají neočekávaný formát.'); const block = html.slice(jsonStart, end); const semi = block.lastIndexOf(';'); return JSON.parse((semi >= 0 ? block.slice(0, semi) : block).trim()); }
async function fetchText(url: string, timeout = 25_000) { const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeout); try { const response = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow', signal: controller.signal }); const text = await response.text(); if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`); return text; } finally { clearTimeout(timer); } }

function parsePage(text: string, page: number, document: any) {
  const lines = String(text || '').split(/\r?\n/u).map((x) => x.trim()).filter(Boolean);
  const rows: any[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(PRICE);
    if (!match) continue;
    const price = Number(match[1].replace(',-', '').replace(',', '.'));
    if (!Number.isFinite(price) || price < 2 || price > 9999) continue;

    let rawTitle = '';
    let titleIndex = -1;
    for (let offset = 1; offset <= 12 && i - offset >= 0; offset++) {
      const candidate = clean(lines[i - offset]);
      if (!goodTitle(candidate)) continue;
      rawTitle = candidate;
      titleIndex = i - offset;
      break;
    }
    if (!rawTitle || titleIndex < 0) continue;

    let competing = false;
    for (let k = titleIndex + 1; k < i; k++) {
      const candidate = clean(lines[k]);
      if (candidate !== rawTitle && goodTitle(candidate) && !containsQuantity(candidate)) { competing = true; break; }
    }
    if (competing) continue;

    const quantity = extractQuantity(lines, titleIndex, i, rawTitle);
    let title = stripTrailingQuantity(rawTitle);
    let brand = findBrand(lines, titleIndex);
    if (!brand && lowSpecificity(title)) {
      for (let offset = 1; offset <= 5 && titleIndex - offset >= 0; offset++) {
        const candidate = clean(lines[titleIndex - offset]);
        if (brandCandidate(candidate)) { brand = candidate; break; }
      }
    }
    if (brand && lowSpecificity(title) && !norm(title).startsWith(`${norm(brand)} `)) title = `${brand} ${title}`.replace(/\s+/g, ' ').trim();

    const normalizedTitle = norm(title);
    if (!normalizedTitle || normalizedTitle.length < 3) continue;
    const strength = identityStrength(title, brand, quantity);
    if (strength === 'weak' && lowSpecificity(title)) continue;
    if (/(?:vodka|(^| )gin($| )|(^| )rum($| )|whisk|likér|aperitivo)/iu.test(title) && price < 80) continue;

    const viewer = String(document.metadata?.viewer_url || '').replace(/\/+$/u, '');
    const locationType = String(document.metadata?.location_type || 'ALL').toUpperCase();
    rows.push({ title, normalized_title: normalizedTitle, brand, quantity_text: quantity, identity_strength: strength, price, valid_from: String(document.detected_valid_from || ''), valid_to: String(document.detected_valid_to || ''), source_url: `${viewer}/page/${page}`, source_page: page, product_id: null, image_url: null, confidence: strength === 'strong' ? 0.96 : 0.91, location_type: locationType, metadata: { parser: PARSER, location_type: locationType, document_type: document.metadata?.document_type || null, publication_id: document.metadata?.publication_id || null, source_document_id: document.id, parsed_brand: brand, parsed_quantity: quantity, identity_strength: strength, raw_title: rawTitle } });
  }
  return rows;
}

async function resolveCatalog(rows: any[], albertStoreId: string) {
  const names = [...new Set(rows.map((r) => r.normalized_title))];
  const products: any[] = [];
  const aliases: any[] = [];
  for (let i = 0; i < names.length; i += 100) {
    const chunk = names.slice(i, i + 100);
    const { data: productRows, error: pError } = await db.from('products').select('id,normalized_name,brand,quantity_text,image_url,is_verified,image_verified').in('normalized_name', chunk).eq('is_active', true);
    if (pError) throw pError;
    products.push(...(productRows || []));
    const { data: aliasRows, error: aError } = await db.from('product_aliases').select('product_id,normalized_alias,brand,quantity_text,source_store_id,confidence,products(image_url,is_active,is_verified,image_verified,brand,quantity_text)').in('normalized_alias', chunk);
    if (aError) throw aError;
    aliases.push(...(aliasRows || []));
  }
  const compatible = (candidateBrand: string | null, candidateQty: string | null, row: any) => {
    const rowBrand = norm(row.brand || '');
    const candBrand = norm(candidateBrand || '');
    const rowQty = quantityKey(row.quantity_text);
    const candQty = quantityKey(candidateQty);
    if (rowQty && candQty !== rowQty) return false;
    if (rowBrand && candBrand && rowBrand !== candBrand) return false;
    return true;
  };
  let matched = 0, withImages = 0, newStrict = 0;
  const kept: any[] = [];
  for (const row of rows) {
    const direct = products.filter((p) => p.normalized_name === row.normalized_title && compatible(p.brand, p.quantity_text, row));
    const aliasMatches = aliases.filter((a) => a.normalized_alias === row.normalized_title && (String(a.source_store_id || '') !== albertStoreId || Number(a.confidence || 0) >= 0.98) && a.products?.is_active !== false && compatible(a.brand || a.products?.brand, a.quantity_text || a.products?.quantity_text, row));
    const ids = new Map<string, any>();
    for (const p of direct) ids.set(String(p.id), { id: p.id, image_url: p.image_url || null });
    for (const a of aliasMatches) ids.set(String(a.product_id), { id: a.product_id, image_url: a.products?.image_url || null });
    if (ids.size === 1) {
      const hit = [...ids.values()][0];
      row.product_id = hit.id;
      row.image_url = hit.image_url;
      row.confidence = Math.max(Number(row.confidence || 0), 0.97);
      matched++;
      if (hit.image_url) withImages++;
      kept.push(row);
      continue;
    }
    if (row.identity_strength === 'weak') continue;
    const words = row.normalized_title.split(' ').filter(Boolean);
    if (words.length < 2 && !row.quantity_text && !row.brand) continue;
    if (!PRODUCT_WORD.test(row.title) && !row.brand) continue;
    newStrict++;
    kept.push(row);
  }
  return { rows: kept, matched, withImages, newStrict };
}

async function buildRows(documents: any[], storeId: string) {
  const candidates: any[] = [];
  const tokens: string[] = [];
  for (const document of documents) {
    const viewer = String(document.metadata?.viewer_url || '').replace(/\/+$/u, '');
    if (!/^https:\/\/letaky\.albert\.cz\//iu.test(viewer)) throw new Error('Albert dokument nemá bezpečnou Publitas adresu.');
    const html = await fetchText(`${viewer}/`);
    const data = dataFromHtml(html);
    const cacheToken = String(data.cacheToken || '');
    if (!cacheToken) throw new Error(`Publitas ${viewer} nevrátil cache token.`);
    tokens.push(`${document.id}:${cacheToken}`);
    const spreads = JSON.parse(await fetchText(`${viewer}/spreads.json?version=${encodeURIComponent(cacheToken)}`));
    if (!Array.isArray(spreads) || !spreads.length) throw new Error(`Publitas ${viewer} nevrátil stránky.`);
    for (const spread of spreads) for (const page of Array.isArray(spread?.pages) ? spread.pages : []) candidates.push(...parsePage(String(page?.text || ''), Number(page?.number || 0), document));
  }
  const best = new Map<string, any>();
  for (const row of candidates) {
    const key = [row.location_type, row.normalized_title, norm(row.brand || ''), quantityKey(row.quantity_text), row.valid_from, row.valid_to].join('|');
    const previous = best.get(key);
    if (!previous || row.price < previous.price) best.set(key, row);
  }
  const resolved = await resolveCatalog([...best.values()], storeId);
  const final: any[] = [];
  for (const row of resolved.rows) {
    const identity = ['albert-v4', row.location_type, row.normalized_title, norm(row.brand || ''), quantityKey(row.quantity_text), row.valid_from, row.valid_to].join('|');
    const id = await hash(identity);
    final.push({ ...row, external_id: `albert:text:v4:${id.slice(0, 38)}` });
  }
  final.sort((a, b) => a.title.localeCompare(b.title, 'cs') || String(a.quantity_text || '').localeCompare(String(b.quantity_text || ''), 'cs') || a.price - b.price);
  return { rows: final, raw: candidates.length, deduped: best.size, tokens, matched: resolved.matched, withImages: resolved.withImages, newStrict: resolved.newStrict };
}

async function failure(storeId: string | null, sourceId: string | null, message: string) {
  const now = new Date().toISOString();
  if (storeId) await db.from('store_product_sync_state').upsert({ store_id: storeId, last_run_at: now, is_running: false, last_error: message.slice(0, 2000), last_parser_error: message.slice(0, 2000), health_status: 'error', health_reason: 'Nová Albert v4 sada nebyla publikována; předchozí veřejná data zůstala beze změny.', updated_at: now }, { onConflict: 'store_id' });
  if (sourceId) await db.from('leaflet_sources').update({ last_checked_at: now, last_error: message.slice(0, 1000) }).eq('id', sourceId);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await authorized(request))) return json({ error: 'Unauthorized' }, 401);
  const body = await request.json().catch(() => ({}));
  const dryRun = body.dry_run === true;
  const force = body.force === true;
  let storeId: string | null = null;
  let sourceId: string | null = null;
  try {
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'albert').single();
    if (storeError || !store) throw storeError || new Error('Albert nebyl nalezen.');
    storeId = store.id;
    const { data: source, error: sourceError } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).eq('is_active', true).limit(1).single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj Albert nebyl nalezen.');
    sourceId = source.id;
    const today = new Date().toISOString().slice(0, 10);
    const { data: documents, error: documentsError } = await db.from('leaflet_imports').select('id,source_hash,detected_valid_from,detected_valid_to,metadata').eq('store_id', store.id).eq('status', 'published').contains('metadata', { adapter: 'albert-publitas-v1' }).gte('detected_valid_to', today).order('detected_valid_to');
    if (documentsError) throw documentsError;
    if (!documents || documents.length < 2) throw new Error(`Albert má jen ${documents?.length || 0} aktuálních oficiálních publikací.`);
    const built = await buildRows(documents, store.id);
    if (built.rows.length < MIN_SAFE || built.rows.length > MAX_SAFE) throw new Error(`Albert v4 parser vytvořil ${built.rows.length} nabídek; bezpečný rozsah je ${MIN_SAFE}–${MAX_SAFE}.`);
    const signature = await hash([...documents.map((d: any) => `${d.source_hash}|${d.detected_valid_from}|${d.detected_valid_to}`), ...built.tokens, PARSER].sort().join('\n'));

    if (dryRun) {
      const strengths = built.rows.reduce((acc: Record<string, number>, row: any) => { acc[row.identity_strength] = (acc[row.identity_strength] || 0) + 1; return acc; }, {});
      const sample = (r: any) => ({ title: r.title, brand: r.brand, quantity: r.quantity_text, identity_strength: r.identity_strength, price: r.price, matched: Boolean(r.product_id), has_image: Boolean(r.image_url), page: r.source_page, location_type: r.location_type, valid_from: r.valid_from, valid_to: r.valid_to });
      return json({ ok: true, dry_run: true, parser: PARSER, store: 'Albert', documents: documents.length, raw_candidates: built.raw, deduped_candidates: built.deduped, publishable: built.rows.length, catalog_matches: built.matched, strict_new: built.newStrict, with_images: built.withImages, strengths, signature, suspect_samples: built.rows.filter((r: any) => SUSPECT.test(r.title)).slice(0, 150).map(sample), samples: built.rows.slice(0, 80).map(sample) });
    }

    const { data: state } = await db.from('store_product_sync_state').select('last_source_signature,health_status,last_offer_count,parser_version').eq('store_id', store.id).maybeSingle();
    const { count: currentOffers, error: countError } = await db.from('offers').select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('status', 'published').lte('valid_from', today).gte('valid_to', today);
    if (countError) throw countError;
    if (!force && state?.last_source_signature === signature && state?.health_status === 'ok' && state?.parser_version === PARSER && Number(currentOffers || 0) >= MIN_SAFE) return json({ ok: true, no_changes: true, parser: PARSER, store: 'Albert', current_offers: Number(currentOffers || 0), signature });
    const { data: published, error: publishError } = await db.rpc(PUBLISHER, { p_signature: signature, p_rows: built.rows });
    if (publishError) throw publishError;
    if (!published?.ok || Number(published?.published || 0) < 200) throw new Error('Albert v4 databáze nepotvrdila bezpečné publikování nové sady.');
    return json({ ok: true, self_published: true, parser: PARSER, store: 'Albert', documents: documents.length, raw_candidates: built.raw, deduped_candidates: built.deduped, publishable: built.rows.length, catalog_matches: built.matched, strict_new: built.newStrict, with_images: built.withImages, signature, result: published });
  } catch (error) {
    const message = errorText(error);
    await failure(storeId, sourceId, message);
    return json({ error: message, code: 'ALBERT_PRODUCT_SYNC_V4_FAILED' }, 500);
  }
});
