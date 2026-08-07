import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/json,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};
const MIN_SAFE_OFFERS = 350;
const MAX_SAFE_OFFERS = 1200;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    const parts = [value.message, value.details, value.hint, value.code].filter(Boolean).map(String);
    if (parts.length) return parts.join(' | ');
    try { return JSON.stringify(error); } catch { return String(error); }
  }
  return String(error);
}

async function allowed(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE_ROLE_KEY) return true;
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return true;
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return false;
  return ['admin', 'editor'].includes(String(data.user.app_metadata?.role || '').toLowerCase());
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalize(value: string) {
  return String(value || '')
    .toLocaleLowerCase('cs')
    .replace(/[^a-z0-9áčďéěíňóřšťúůýž]+/giu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function aliasStem(value: string) {
  return normalize(value)
    .replace(/\b(?:cena za\s*)?\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|ks|rolí|dávek|balení|bal)\b.*$/iu, '')
    .replace(/\b\d+\s*[x×]\s*\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|ks)\b.*$/iu, '')
    .trim();
}

function cleanTitle(value: string) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^[•▼]\s*/u, '')
    .replace(/^\d{1,4}[,.]\s*(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])/u, '')
    .replace(/^(?:EXTRA LETÁK|VÍCE AKCÍ|CO KUPUJETE NEJRADĚJI)\s+/iu, '')
    .trim();
}

const SALE_PRICE = /^[•▼]\s*(\d{1,4}(?:[,.]\d{1,2})?|\d{1,4},-)\s*Kč(?:\s|$)/iu;
const HARD_NOISE = /^(?:NEPORAZITELNÉ|BĚŽNÁ CENA|BEZ|APLIKACE|NAVÍC|PŘI KOUPI|POSLEDNÍ ŠANCE|SOUTĚŽ|www\.|Od \d|CENA ZA|CO KUPUJETE|BOD NAVÍC|EXTRA LETÁK|VÍCE AKCÍ|chuť$|skládané$|z podestýlky|vybrané druhy$|druhy$|do myčky$|perličky$|půln\b|ční\b|a informace\b)/iu;
const QUANTITY_LIKE = /^(?:\d+[×x]?\s*)?(?:\d+[–-]\d+\s*)?(?:g|kg|ml|l|ks|dávek|rolí|bal\.?|%|vel\.)\b/iu;
const DESCRIPTOR = /^(?:ochucen[áé]|přírodní|instantní|světl[ýé]|tmav[ýé]|dětský|funkční|masný|chlazen[áé]|zrnková|prostředek|odmašťovač|vermut|Itálie|Francie|Chile|Španělsko|box\b|silná\b|3 ks\b)/iu;
const PURE_NUMERIC = /^(?:-?\d+\s*%|\d+(?:[,.]\d+)?(?:\s*,-)?|\d+\s*[a-z]{1,3})$/iu;
const MARKETING = /(?:NAVÍC|Soutěž|informací|PŘI KOUPI|POSLEDNÍ ŠANCE|DĚLÍ OD|Galerie|Praha\s*[–-]|Brno\s*[–-]|KREDITY|NEJRADĚJI|VÍCE AKCÍ|EXTRA LETÁK|www\.|AKCE PLATÍ|neplatí pro hypermarket)/iu;

function titleLike(line: string) {
  if (!line || HARD_NOISE.test(line) || QUANTITY_LIKE.test(line) || DESCRIPTOR.test(line) || PURE_NUMERIC.test(line)) return false;
  if (/Kč(?:\s|$)/iu.test(line) || /^[-–]/u.test(line) || line.length > 90) return false;
  const first = line.charAt(0);
  return first === first.toLocaleUpperCase('cs') && /[A-Za-zÁ-ž]/u.test(first);
}

function parseQuantity(block: string) {
  const patterns = [
    /[•\s](\d+\s*[×x]\s*\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|ks))\b/iu,
    /[•\s](\d+(?:[,.]\d+)?\s*[–-]\s*\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|ks))\b/iu,
    /[•\s](\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|ks|dávek|rolí))\b/iu,
  ];
  for (const pattern of patterns) {
    const match = block.match(pattern);
    if (match?.[1]) return match[1].replace(/\s+/g, ' ').trim();
  }
  return null;
}

function looksLikeStrictNewTitle(title: string) {
  const normalized = normalize(title);
  const words = normalized.split(' ').filter(Boolean);
  if (title.length < 5 || title.length > 85 || words.length < 2 || words.length > 9) return false;
  if (MARKETING.test(title) || HARD_NOISE.test(title) || /[,;:]\s*$/u.test(title)) return false;
  if (/^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ0-9\s&+./-]{18,}$/u.test(title)) return false;
  if (/^(?:Nová Karolina|Galerie|Arkády|Forum|OC |Centrum |PŘI |DĚLÍ |POSLEDNÍ )/iu.test(title)) return false;
  return true;
}

type ParsedOffer = {
  title: string;
  normalized_title: string;
  quantity_text: string | null;
  price: number;
  valid_from: string;
  valid_to: string;
  source_url: string;
  source_page: number;
  product_id: string | null;
  image_url: string | null;
  confidence: number;
  external_id: string;
  metadata: Record<string, unknown>;
};

function parsePageText(text: string, pageNumber: number, document: any) {
  const lines = String(text || '').split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const rows: Array<Omit<ParsedOffer, 'product_id' | 'image_url' | 'confidence' | 'external_id'>> = [];

  for (let index = 0; index < lines.length; index++) {
    const priceMatch = lines[index].match(SALE_PRICE);
    if (!priceMatch) continue;
    const price = Number(priceMatch[1].replace(',-', '').replace(',', '.'));
    if (!Number.isFinite(price) || price <= 0 || price > 10_000) continue;

    let cursor = index - 1;
    let scanned = 0;
    while (cursor >= 0 && scanned < 12) {
      const raw = lines[cursor];
      const line = cleanTitle(raw);
      if (raw.startsWith('•') || raw.startsWith('▼') || !titleLike(line)) {
        cursor--;
        scanned++;
        continue;
      }
      break;
    }
    if (cursor < 0 || scanned >= 12) continue;

    const parts = [cleanTitle(lines[cursor])];
    for (let previous = cursor - 1; previous >= 0 && parts.length < 2; previous--) {
      const raw = lines[previous];
      const line = cleanTitle(raw);
      if (raw.startsWith('•') || raw.startsWith('▼') || HARD_NOISE.test(line) || QUANTITY_LIKE.test(line) || DESCRIPTOR.test(line) || PURE_NUMERIC.test(line) || /Kč(?:\s|$)/iu.test(line)) break;
      if (titleLike(line)) parts.unshift(line);
      else break;
    }

    let title = cleanTitle(parts.join(' '));
    if (title.length < 3 || title.length > 130 || HARD_NOISE.test(title) || DESCRIPTOR.test(title) || MARKETING.test(title)) continue;
    if (/^(?:Midi|Maxi|Junior|\d+×|\d+ dávek|\d+ ml|\d+ g|\d+ ks)/iu.test(title)) continue;

    const block = lines.slice(Math.max(0, cursor - 2), index + 1).join(' ').replace(/\s+/g, ' ').trim();
    const viewer = String(document.metadata?.viewer_url || '').replace(/\/+$/u, '');
    rows.push({
      title,
      normalized_title: normalize(title),
      quantity_text: parseQuantity(block),
      price,
      valid_from: String(document.detected_valid_from || ''),
      valid_to: String(document.detected_valid_to || ''),
      source_url: `${viewer}/page/${pageNumber}`,
      source_page: pageNumber,
      metadata: {
        parser: 'albert-publitas-text-v1',
        location_type: document.metadata?.location_type || null,
        document_type: document.metadata?.document_type || null,
        publication_id: document.metadata?.publication_id || null,
        source_document_id: document.id,
        raw_block: block.slice(0, 650),
      },
    });
  }

  const unique = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const key = `${row.normalized_title}|${row.price}|${row.valid_from}|${row.valid_to}`;
    if (!unique.has(key)) unique.set(key, row);
  }
  return [...unique.values()];
}

function parsePublitasData(html: string) {
  const marker = 'var data =';
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) throw new Error('Publitas neobsahuje vložená data publikace.');
  const jsonStart = html.indexOf('{', markerIndex + marker.length);
  const bootstrap = html.indexOf('Reader.Bootstrap.init', jsonStart);
  if (jsonStart < 0 || bootstrap < 0) throw new Error('Publitas data publikace mají neočekávaný formát.');
  const between = html.slice(jsonStart, bootstrap);
  const semicolon = between.lastIndexOf(';');
  const raw = (semicolon >= 0 ? between.slice(0, semicolon) : between).trim();
  try { return JSON.parse(raw); } catch { throw new Error('Publitas vložená data nejsou platný JSON.'); }
}

async function fetchText(url: string, timeoutMs = 25_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    const text = await response.text();
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return text;
  } finally { clearTimeout(timer); }
}

async function loadAliases(storeId: string) {
  const exact = new Map<string, string>();
  const stems = new Map<string, string | null>();
  for (let from = 0; from < 3000; from += 1000) {
    const { data, error } = await db.from('product_aliases')
      .select('product_id,alias,normalized_alias')
      .eq('source_store_id', storeId)
      .range(from, from + 999);
    if (error) throw error;
    const rows = data || [];
    for (const row of rows) {
      const normalized = normalize(String(row.normalized_alias || row.alias || ''));
      if (!normalized || HARD_NOISE.test(String(row.alias || '')) || MARKETING.test(String(row.alias || ''))) continue;
      if (!exact.has(normalized)) exact.set(normalized, row.product_id);
      else if (exact.get(normalized) !== row.product_id) exact.delete(normalized);
      const stem = aliasStem(String(row.alias || row.normalized_alias || ''));
      if (stem.length < 4) continue;
      if (!stems.has(stem)) stems.set(stem, row.product_id);
      else if (stems.get(stem) !== row.product_id) stems.set(stem, null);
    }
    if (rows.length < 1000) break;
  }
  return { exact, stems };
}

async function buildRows(store: any, documents: any[]) {
  const aliases = await loadAliases(store.id);
  const candidates: any[] = [];
  const cacheTokens: string[] = [];

  for (const document of documents) {
    const viewer = String(document.metadata?.viewer_url || '').replace(/\/+$/u, '');
    if (!/^https:\/\/letaky\.albert\.cz\//iu.test(viewer)) throw new Error('Albert dokument nemá bezpečnou Publitas adresu.');
    const html = await fetchText(`${viewer}/`);
    const data = parsePublitasData(html);
    const cacheToken = String(data.cacheToken || '');
    if (!cacheToken) throw new Error(`Publitas ${viewer} nevrátil cache token.`);
    cacheTokens.push(`${document.id}:${cacheToken}`);
    const spreadsText = await fetchText(`${viewer}/spreads.json?version=${encodeURIComponent(cacheToken)}`);
    let spreads: any[];
    try { spreads = JSON.parse(spreadsText); } catch { throw new Error(`Publitas ${viewer} vrátil neplatný spreads JSON.`); }
    if (!Array.isArray(spreads) || !spreads.length) throw new Error(`Publitas ${viewer} nevrátil stránky.`);
    for (const spread of spreads) {
      for (const page of Array.isArray(spread?.pages) ? spread.pages : []) {
        candidates.push(...parsePageText(String(page?.text || ''), Number(page?.number || 0), document));
      }
    }
  }

  const merged = new Map<string, any>();
  for (const candidate of candidates) {
    const exactProduct = aliases.exact.get(candidate.normalized_title) || null;
    const stemProduct = aliases.stems.get(aliasStem(candidate.title)) || null;
    const productId = exactProduct || stemProduct || null;
    const strictNew = !productId && looksLikeStrictNewTitle(candidate.title);
    if (!productId && !strictNew) continue;

    const key = `${candidate.normalized_title}|${candidate.price}|${candidate.valid_from}|${candidate.valid_to}`;
    const existing = merged.get(key);
    if (existing) {
      const locations = new Set([...(existing.metadata.location_types || []), candidate.metadata.location_type].filter(Boolean));
      const documentTypes = new Set([...(existing.metadata.document_types || []), candidate.metadata.document_type].filter(Boolean));
      const pages = new Set([...(existing.metadata.source_pages || []), `${candidate.metadata.publication_id}:${candidate.source_page}`]);
      const viewers = new Set([...(existing.metadata.viewer_urls || []), candidate.source_url.replace(/\/page\/\d+$/u, '')]);
      existing.metadata.location_types = [...locations];
      existing.metadata.document_types = [...documentTypes];
      existing.metadata.source_pages = [...pages];
      existing.metadata.viewer_urls = [...viewers];
      if (!existing.product_id && productId) {
        existing.product_id = productId;
        existing.confidence = exactProduct ? 0.97 : 0.95;
      }
      continue;
    }

    merged.set(key, {
      ...candidate,
      product_id: productId,
      image_url: null,
      confidence: exactProduct ? 0.97 : productId ? 0.95 : 0.88,
      metadata: {
        parser: 'albert-publitas-text-v1',
        location_types: [candidate.metadata.location_type].filter(Boolean),
        document_types: [candidate.metadata.document_type].filter(Boolean),
        source_pages: [`${candidate.metadata.publication_id}:${candidate.source_page}`],
        viewer_urls: [candidate.source_url.replace(/\/page\/\d+$/u, '')],
        raw_block: candidate.metadata.raw_block,
      },
    });
  }

  const rows: ParsedOffer[] = [];
  for (const row of merged.values()) {
    const externalHash = await sha256(`albert|${row.normalized_title}|${row.price}|${row.valid_from}|${row.valid_to}`);
    rows.push({ ...row, external_id: `albert:text:${externalHash.slice(0, 40)}` });
  }
  rows.sort((a, b) => a.title.localeCompare(b.title, 'cs') || a.price - b.price);
  return { rows, candidates: candidates.length, cacheTokens };
}

async function setFailure(storeId: string | null, sourceId: string | null, message: string) {
  const now = new Date().toISOString();
  if (storeId) {
    await db.from('store_product_sync_state').upsert({
      store_id: storeId,
      last_run_at: now,
      is_running: false,
      last_error: message.slice(0, 2000),
      last_parser_error: message.slice(0, 2000),
      health_status: 'error',
      health_reason: 'Nová Albert sada nebyla publikována; předchozí veřejná data zůstala beze změny.',
      updated_at: now,
    }, { onConflict: 'store_id' });
  }
  if (sourceId) await db.from('leaflet_sources').update({ last_checked_at: now, last_error: message.slice(0, 1000) }).eq('id', sourceId);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  const body = await request.json().catch(() => ({}));
  const dryRun = body.dry_run === true;
  const force = body.force === true;
  let storeId: string | null = null;
  let sourceId: string | null = null;

  try {
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'albert').single();
    if (storeError || !store) throw storeError || new Error('Albert nebyl nalezen.');
    storeId = store.id;

    const { data: source, error: sourceError } = await db.from('leaflet_sources')
      .select('id').eq('store_id', store.id).eq('is_active', true).limit(1).single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj Albert nebyl nalezen.');
    sourceId = source.id;

    const today = new Date().toISOString().slice(0, 10);
    const { data: documents, error: documentsError } = await db.from('leaflet_imports')
      .select('id,source_hash,detected_valid_from,detected_valid_to,metadata')
      .eq('store_id', store.id)
      .eq('status', 'published')
      .contains('metadata', { adapter: 'albert-publitas-v1' })
      .gte('detected_valid_to', today)
      .order('detected_valid_to');
    if (documentsError) throw documentsError;
    if (!documents || documents.length < 2) throw new Error(`Albert má jen ${documents?.length || 0} aktuálních oficiálních publikací.`);

    const built = await buildRows(store, documents);
    if (built.rows.length < MIN_SAFE_OFFERS || built.rows.length > MAX_SAFE_OFFERS) {
      throw new Error(`Albert parser vytvořil ${built.rows.length} nabídek; bezpečný rozsah je ${MIN_SAFE_OFFERS}–${MAX_SAFE_OFFERS}.`);
    }

    const signature = await sha256([
      ...documents.map((document: any) => `${document.source_hash}|${document.detected_valid_from}|${document.detected_valid_to}`),
      ...built.cacheTokens,
      'albert-publitas-text-v1',
    ].sort().join('\n'));

    const matched = built.rows.filter((row) => Boolean(row.product_id)).length;
    const newStrict = built.rows.length - matched;
    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        store: 'Albert',
        documents: documents.length,
        raw_candidates: built.candidates,
        publishable: built.rows.length,
        matched_catalog_products: matched,
        strict_new_products: newStrict,
        signature,
        samples: built.rows.slice(0, 30).map((row) => ({ title: row.title, price: row.price, quantity: row.quantity_text, confidence: row.confidence, matched: Boolean(row.product_id), valid_from: row.valid_from, valid_to: row.valid_to })),
        new_samples: built.rows.filter((row) => !row.product_id).slice(0, 30).map((row) => ({ title: row.title, price: row.price, quantity: row.quantity_text })),
      });
    }

    const { data: state } = await db.from('store_product_sync_state')
      .select('last_source_signature,health_status,last_offer_count').eq('store_id', store.id).maybeSingle();
    const { count: currentOffers, error: countError } = await db.from('offers')
      .select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('status', 'published').lte('valid_from', today).gte('valid_to', today);
    if (countError) throw countError;
    if (!force && state?.last_source_signature === signature && state?.health_status === 'ok' && Number(currentOffers || 0) >= MIN_SAFE_OFFERS) {
      return json({ ok: true, no_changes: true, store: 'Albert', current_offers: Number(currentOffers || 0), signature });
    }

    const { data: published, error: publishError } = await db.rpc('publish_albert_publitas_text_offers', {
      p_signature: signature,
      p_rows: built.rows,
    });
    if (publishError) throw publishError;
    if (!published?.ok || Number(published?.published || 0) < MIN_SAFE_OFFERS) throw new Error('Albert databáze nepotvrdila bezpečné publikování nové sady.');

    return json({
      ok: true,
      self_published: true,
      store: 'Albert',
      documents: documents.length,
      raw_candidates: built.candidates,
      publishable: built.rows.length,
      matched_catalog_products: matched,
      strict_new_products: newStrict,
      signature,
      result: published,
    });
  } catch (error) {
    const message = formatError(error);
    await setFailure(storeId, sourceId, message);
    return json({ error: message, code: 'ALBERT_PRODUCT_SYNC_FAILED' }, 500);
  }
});
