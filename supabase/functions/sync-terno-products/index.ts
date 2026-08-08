import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const OCR_ENGINE = 'tesseract-cli-ces-v1';
const PARSER = 'terno-ocr-coordinate-v1';

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

type Word = {
  text: string;
  confidence: number;
  left: number;
  top: number;
  width: number;
  height: number;
  block: number;
  paragraph: number;
  line: number;
  word: number;
};

type Line = {
  key: string;
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  center: number;
  confidence: number;
};

type PriceCandidate = {
  price: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  center: number;
  confidence: number;
  raw: string;
  mode: 'compact' | 'decimal' | 'split';
};

type Quantity = {
  text: string;
  unit: 'kg' | 'g' | 'l' | 'ml';
  value: number;
  base: number;
  line: Line;
};

type UnitPrice = {
  basis: '1kg' | '100g' | '1l' | '100ml';
  value: number;
  line: Line;
};

type Candidate = {
  title: string;
  price: number;
  quantity_text: string | null;
  source_page: number;
  confidence: number;
  raw_data: Record<string, unknown>;
};

function allowed(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const apiKey = req.headers.get('apikey') || '';
  return auth === `Bearer ${SERVICE_ROLE_KEY}`
    || apiKey === SERVICE_ROLE_KEY
    || Boolean(CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET);
}

function clean(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function norm(value: unknown) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs');
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function numberFromText(value: string): number | null {
  const raw = clean(value).replace(/\s/g, '');
  if (/^\d{1,4}[,.]\d{1,2}$/.test(raw)) {
    const result = Number(raw.replace(',', '.'));
    return Number.isFinite(result) ? result : null;
  }
  if (/^\d{3,5}$/.test(raw)) {
    const result = Number(raw) / 100;
    return Number.isFinite(result) ? result : null;
  }
  if (/^\d{1,4}$/.test(raw)) {
    const result = Number(raw);
    return Number.isFinite(result) ? result : null;
  }
  return null;
}

function groupLines(words: Word[]): Line[] {
  const groups = new Map<string, Word[]>();
  for (const word of words) {
    const key = `${word.block}:${word.paragraph}:${word.line}`;
    const group = groups.get(key) || [];
    group.push(word);
    groups.set(key, group);
  }

  return [...groups.entries()].map(([key, group]) => {
    const ordered = [...group].sort((a, b) => a.left - b.left || a.word - b.word);
    const left = Math.min(...ordered.map((item) => item.left));
    const right = Math.max(...ordered.map((item) => item.left + item.width));
    const top = Math.min(...ordered.map((item) => item.top));
    const bottom = Math.max(...ordered.map((item) => item.top + item.height));
    const confidences = ordered.map((item) => item.confidence).filter((value) => value >= 0);
    const confidence = confidences.length ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0;
    return {
      key,
      text: clean(ordered.map((item) => item.text).join(' ')),
      left,
      right,
      top,
      bottom,
      center: (left + right) / 2,
      confidence,
    };
  }).filter((line) => line.text).sort((a, b) => a.top - b.top || a.left - b.left);
}

function compactPrice(word: Word): PriceCandidate | null {
  const raw = clean(word.text).replace(/\s/g, '');
  if (word.confidence < 50 || word.height < 24) return null;

  if (/^\d{3,5}$/.test(raw)) {
    const price = Number(raw) / 100;
    if (price < 2 || price > 5000) return null;
    return {
      price: round2(price),
      left: word.left,
      right: word.left + word.width,
      top: word.top,
      bottom: word.top + word.height,
      center: word.left + word.width / 2,
      confidence: word.confidence,
      raw,
      mode: 'compact',
    };
  }

  if (/^\d{1,4}[,.]\d{2}$/.test(raw)) {
    const price = Number(raw.replace(',', '.'));
    if (price < 2 || price > 5000) return null;
    return {
      price: round2(price),
      left: word.left,
      right: word.left + word.width,
      top: word.top,
      bottom: word.top + word.height,
      center: word.left + word.width / 2,
      confidence: word.confidence,
      raw,
      mode: 'decimal',
    };
  }
  return null;
}

function splitPrices(words: Word[]): PriceCandidate[] {
  const results: PriceCandidate[] = [];
  const wholes = words.filter((word) => /^\d{1,3}$/.test(clean(word.text)) && word.height >= 24 && word.confidence >= 50);
  const cents = words.filter((word) => /^\d{2}$/.test(clean(word.text)) && word.height >= 12 && word.confidence >= 40);

  for (const whole of wholes) {
    const options = cents.filter((cent) =>
      cent.left >= whole.left + whole.width - 8
      && cent.left <= whole.left + whole.width + 55
      && cent.top >= whole.top + 4
      && cent.top <= whole.top + whole.height + 20
    ).sort((a, b) =>
      Math.abs(a.left - (whole.left + whole.width)) - Math.abs(b.left - (whole.left + whole.width))
      || b.confidence - a.confidence
    );
    const cent = options[0];
    if (!cent) continue;
    const price = Number(whole.text) + Number(cent.text) / 100;
    if (price < 2 || price > 5000) continue;
    results.push({
      price: round2(price),
      left: whole.left,
      right: Math.max(whole.left + whole.width, cent.left + cent.width),
      top: whole.top,
      bottom: Math.max(whole.top + whole.height, cent.top + cent.height),
      center: (whole.left + Math.max(whole.left + whole.width, cent.left + cent.width)) / 2,
      confidence: Math.min(whole.confidence, cent.confidence),
      raw: `${whole.text}.${cent.text}`,
      mode: 'split',
    });
  }
  return results;
}

function findPrices(words: Word[]) {
  const all = [
    ...words.map(compactPrice).filter((item): item is PriceCandidate => Boolean(item)),
    ...splitPrices(words),
  ].sort((a, b) => a.top - b.top || a.left - b.left);

  const deduped: PriceCandidate[] = [];
  for (const candidate of all) {
    const duplicate = deduped.find((old) =>
      Math.abs(old.center - candidate.center) < 28
      && Math.abs(old.top - candidate.top) < 28
      && Math.abs(old.price - candidate.price) < 0.02
    );
    if (!duplicate) deduped.push(candidate);
  }
  return deduped;
}

function quantityFromLines(lines: Line[]): Quantity | null {
  for (const line of lines) {
    const text = clean(line.text);
    if (/\b\d+(?:[,.]\d+)?\s*[–-]\s*\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l)\b/i.test(text)) continue;
    if (/\b(?:1\s*kg|100\s*g|1\s*l|100\s*ml)\s*=/i.test(text)) continue;
    if (/cena\s+za\s+100\s*[g9]/i.test(text)) continue;

    const multi = text.match(/\b(\d+)\s*[x×]\s*(\d+(?:[,.]\d+)?)\s*(g|ml)\b/i);
    if (multi) {
      const count = Number(multi[1]);
      const each = Number(multi[2].replace(',', '.'));
      const unit = multi[3].toLowerCase() as 'g' | 'ml';
      if (count > 0 && each > 0) {
        const value = count * each;
        return { text: clean(multi[0]), unit, value, base: value / 1000, line };
      }
    }

    const match = text.match(/\b(\d+(?:[,.]\d+)?)\s*(kg|g|l|ml)\b/i);
    if (!match) continue;
    const value = Number(match[1].replace(',', '.'));
    const unit = match[2].toLowerCase() as Quantity['unit'];
    if (!(value > 0)) continue;
    const base = unit === 'g' || unit === 'ml' ? value / 1000 : value;
    return { text: clean(match[0]), unit, value, base, line };
  }
  return null;
}

function parseUnitValue(raw: string): number | null {
  const normalized = clean(raw).replace(/\s/g, '');
  const decimal = normalized.match(/(\d{1,4}[,.]\d{1,2})/);
  if (decimal) return Number(decimal[1].replace(',', '.'));
  const compact = normalized.match(/(\d{3,5})/);
  if (compact) return Number(compact[1]) / 100;
  return null;
}

function unitPriceFromLines(lines: Line[]): UnitPrice | null {
  for (const line of lines) {
    const text = clean(line.text);
    const ntext = norm(text);
    if (/\b(?:od|0d)\b/.test(ntext)) continue;
    const basisMatch = ntext.match(/\b(1\s*kg|100\s*g|1\s*l|100\s*ml)\b/);
    if (!basisMatch || !text.includes('=')) continue;
    const after = text.slice(text.indexOf('=') + 1);
    const value = parseUnitValue(after);
    if (!(value && value > 0 && value < 100000)) continue;
    const basis = basisMatch[1].replace(/\s/g, '') as UnitPrice['basis'];
    return { basis, value: round2(value), line };
  }
  return null;
}

function saleBasisFromLines(lines: Line[]) {
  for (const line of lines) {
    const text = norm(line.text).replace(/\s/g, '');
    if (/cenaza100[g9]/.test(text)) return { basis: '100g' as const, line };
    if (/cenaza1kg/.test(text)) return { basis: '1kg' as const, line };
  }
  return null;
}

function expectedPrice(quantity: Quantity | null, unit: UnitPrice, saleBasis: { basis: '100g' | '1kg'; line: Line } | null) {
  if (saleBasis?.basis === '100g' && unit.basis === '1kg') return unit.value / 10;
  if (saleBasis?.basis === '1kg' && unit.basis === '1kg') return unit.value;
  if (!quantity) return null;

  if (quantity.unit === 'g' && unit.basis === '1kg') return unit.value * (quantity.value / 1000);
  if (quantity.unit === 'kg' && unit.basis === '1kg') return unit.value * quantity.value;
  if (quantity.unit === 'g' && unit.basis === '100g') return unit.value * (quantity.value / 100);
  if (quantity.unit === 'ml' && unit.basis === '1l') return unit.value * (quantity.value / 1000);
  if (quantity.unit === 'l' && unit.basis === '1l') return unit.value * quantity.value;
  if (quantity.unit === 'ml' && unit.basis === '100ml') return unit.value * (quantity.value / 100);
  return null;
}

function promoContext(text: string) {
  const value = norm(text);
  return /\b(super ctvrtek|super patek|vikend|pri koupi|kup vic|zaplat min|s klubem|bez klubu|klubova|do vyprodani|cena plati pro max|pouze)\b/.test(value);
}

function titleNoise(text: string) {
  const value = norm(text);
  return !/[a-zá-ž]/i.test(text)
    || text.length < 3
    || /^(super cena|pultovy prodej|cena|cena za 100[g9]|vybrane druhy|vice druhu|do vyprodani zasob)$/i.test(value)
    || /^(1\s*kg|100\s*g|1\s*l|100\s*ml)\s*=/i.test(value)
    || /^\d+(?:[,.]\d+)?\s*(kg|g|l|ml)\b/i.test(value)
    || /\b1\s*(kg|l)\s*=/.test(value)
    || /\b100\s*(g|ml)\s*=/.test(value)
    || promoContext(text);
}

function titleFromContext(lines: Line[], price: PriceCandidate, quantity: Quantity | null, unit: UnitPrice) {
  const start = price.bottom + 8;
  const end = Math.min(price.top + 190, quantity?.line.top ?? unit.line.top, unit.line.top);
  const options = lines.filter((line) =>
    line.top >= start
    && line.top <= end + 3
    && line.confidence >= 48
    && !titleNoise(line.text)
  );
  if (!options.length) return null;

  const referenceTop = quantity?.line.top ?? unit.line.top;
  const nearest = [...options]
    .sort((a, b) => Math.abs(referenceTop - b.bottom) - Math.abs(referenceTop - a.bottom))
    .slice(0, 2)
    .sort((a, b) => a.top - b.top);

  const title = clean(nearest.map((line) => line.text).join(' '))
    .replace(/^[-–—|]+\s*/, '')
    .replace(/\s*[-–—|]+$/, '')
    .trim();
  if (title.length < 3 || title.length > 105 || !/[A-Za-zÁ-Žá-ž]{3}/.test(title)) return null;
  return title;
}

function parsePage(pageNumber: number, width: number, rawWords: unknown[]): Candidate[] {
  const words: Word[] = rawWords.map((raw: any) => ({
    text: clean(raw?.text),
    confidence: Number(raw?.confidence ?? -1),
    left: Number(raw?.left ?? 0),
    top: Number(raw?.top ?? 0),
    width: Number(raw?.width ?? 0),
    height: Number(raw?.height ?? 0),
    block: Number(raw?.block ?? 0),
    paragraph: Number(raw?.paragraph ?? 0),
    line: Number(raw?.line ?? 0),
    word: Number(raw?.word ?? 0),
  })).filter((word) => word.text && Number.isFinite(word.left) && Number.isFinite(word.top));

  const lines = groupLines(words);
  const prices = findPrices(words);
  const candidates: Candidate[] = [];
  const columnWidth = Math.max(220, width / 4);

  for (const price of prices) {
    const column = Math.max(0, Math.min(3, Math.floor(price.center / columnWidth)));
    const left = Math.max(0, column * columnWidth - 18);
    const right = Math.min(width, (column + 1) * columnWidth + 18);
    const localLines = lines.filter((line) =>
      line.center >= left
      && line.center <= right
      && line.top >= Math.max(0, price.top - 55)
      && line.top <= price.top + 265
    );
    if (!localLines.length) continue;

    const localText = localLines.map((line) => line.text).join(' | ');
    if (promoContext(localText)) continue;

    const unit = unitPriceFromLines(localLines.filter((line) => line.top > price.top));
    if (!unit || unit.line.confidence < 38) continue;
    const quantity = quantityFromLines(localLines.filter((line) => line.top > price.top));
    const saleBasis = saleBasisFromLines(localLines.filter((line) => line.top > price.top));
    const expected = expectedPrice(quantity, unit, saleBasis);
    if (expected == null) continue;

    const tolerance = Math.max(0.16, price.price * 0.009);
    if (Math.abs(expected - price.price) > tolerance) continue;

    const title = titleFromContext(localLines, price, quantity, unit);
    if (!title) continue;

    candidates.push({
      title,
      price: price.price,
      quantity_text: saleBasis?.basis === '100g' ? '100 g' : quantity?.text ?? null,
      source_page: pageNumber,
      confidence: 0.99,
      raw_data: {
        parser: PARSER,
        ocr_engine: OCR_ENGINE,
        price_raw: price.raw,
        price_mode: price.mode,
        price_ocr_confidence: round2(price.confidence),
        unit_basis: unit.basis,
        unit_price: unit.value,
        expected_price: round2(expected),
        sale_basis: saleBasis?.basis ?? null,
        quantity_base: quantity?.base ?? null,
        quantity_unit: quantity?.unit ?? null,
        validation_delta: round2(Math.abs(expected - price.price)),
      },
    });
  }
  return candidates;
}

async function loadTarget(importId?: string) {
  let query = db.from('leaflet_imports')
    .select('id,store_id,source_document_url,detected_valid_from,detected_valid_to,coverage_scope,region_code,city_name,store_location_name,metadata,stores!inner(slug)')
    .eq('stores.slug', 'terno');
  if (importId) query = query.eq('id', importId);
  else query = query.lte('detected_valid_from', new Date().toISOString().slice(0, 10)).gte('detected_valid_to', new Date().toISOString().slice(0, 10)).eq('metadata->>title', 'Akční nabídka').order('created_at', { ascending: false }).limit(1);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Aktuální Terno Akční nabídka import nebyl nalezen.');
  return data;
}

async function writeCandidates(importId: string, candidates: Candidate[]) {
  const { data: job, error: jobError } = await db.from('leaflet_imports').select('metadata').eq('id', importId).single();
  if (jobError) throw jobError;

  const del = await db.from('leaflet_import_items').delete().eq('import_id', importId).neq('status', 'published');
  if (del.error) throw del.error;

  if (candidates.length) {
    const insert = await db.from('leaflet_import_items').insert(candidates.map((candidate) => ({
      import_id: importId,
      title: candidate.title,
      price: candidate.price,
      quantity_text: candidate.quantity_text,
      source_page: candidate.source_page,
      confidence: candidate.confidence,
      status: 'approved',
      raw_data: candidate.raw_data,
    })));
    if (insert.error) throw insert.error;
  }

  const update = await db.from('leaflet_imports').update({
    status: 'review',
    product_count: candidates.length,
    confidence: candidates.length ? 0.99 : null,
    error_message: candidates.length ? null : 'Terno OCR parser nenašel matematicky ověřené položky.',
    finished_at: new Date().toISOString(),
    metadata: {
      ...(job.metadata || {}),
      parser: PARSER,
      ocr_engine: OCR_ENGINE,
      verified_ocr_items: candidates.length,
      deterministic: true,
    },
  }).eq('id', importId);
  if (update.error) throw update.error;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(req)) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const target = await loadTarget(body.import_id ? String(body.import_id) : undefined);
    const { data: pages, error } = await db.from('leaflet_ocr_pages')
      .select('page_number,image_width,image_height,words,avg_confidence,word_count')
      .eq('import_id', target.id)
      .eq('engine', OCR_ENGINE)
      .order('page_number', { ascending: true });
    if (error) throw error;
    if (!pages?.length) throw new Error('Terno OCR stránky nejsou dostupné.');

    const expectedPages = Number(target.metadata?.page_image_count || target.metadata?.ocr_pages_expected || 0);
    if (expectedPages && pages.length < expectedPages) {
      throw new Error(`Terno OCR není kompletní: ${pages.length}/${expectedPages} stran.`);
    }

    const raw = pages.flatMap((page: any) => parsePage(
      Number(page.page_number),
      Number(page.image_width || 1085),
      Array.isArray(page.words) ? page.words : [],
    ));

    const seen = new Set<string>();
    const unique = raw.filter((candidate) => {
      const key = `${norm(candidate.title)}|${candidate.price.toFixed(2)}|${candidate.quantity_text || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (body.dry_run === false) await writeCandidates(target.id, unique);

    return json({
      ok: true,
      dry_run: body.dry_run !== false,
      import_id: target.id,
      parser: PARSER,
      ocr_pages: pages.length,
      candidate_count: unique.length,
      candidates: unique.slice(0, 180),
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
