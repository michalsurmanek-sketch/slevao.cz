import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const PUBLISHER_URL = `${SUPABASE_URL}/functions/v1/publish-imports`;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-cron-secret',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

type OcrPage = {
  page_number: number;
  text_content: string;
  avg_confidence: number | string | null;
};
type Candidate = {
  title: string;
  price: number;
  quantity_text: string;
  source_page: number;
  confidence: number;
  raw_data: Record<string, unknown>;
};

function allowed(req: Request) {
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${SERVICE_ROLE_KEY}` || (CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET);
}
function clean(v: unknown) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
function norm(v: unknown) {
  return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs');
}
function round2(n: number) { return Math.round(n * 100) / 100; }
function letters(s: string) { return (s.match(/[A-Za-zÁ-ž]/g) || []).length; }
function isPromo(s: string) {
  const n = norm(s);
  return /(pri koupi|kup vic|zaplat min|super (ctvrtek|patek|sobota|nedele|pondeli|utery|streda)|pouze (ve|v|dnes)|verne zakazniky|klub|karta|aplikac|kupon|cena plati pro max|na nakup\/den|od \d+\s*ks)/i.test(n);
}
function isNoise(s: string) {
  const n = norm(s);
  if (letters(s) < 3) return true;
  if (s.length < 3 || s.length > 100) return true;
  if (/^(super cena|cena|akce|novinka|vybrane druhy|pultovy prodej|kvalitni potraviny|z naseho regionu)$/i.test(n)) return true;
  if (/^1\s*(kg|l|ks)\s*=/i.test(n)) return true;
  if (/^\d+(?:[,.]\d+)?\s*(g|kg|ml|l|ks)\b/i.test(n)) return true;
  if (/^-?\d+\s*%/.test(n)) return true;
  if (isPromo(s)) return true;
  return false;
}
function parseQuantity(line: string) {
  if (/\d\s*[-–]\s*\d/.test(line)) return null;
  const m = line.match(/\b(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l)\b/i);
  if (!m) return null;
  const value = Number(m[1].replace(',', '.'));
  if (!(value > 0)) return null;
  const unit = m[2].toLowerCase();
  let base = value;
  let baseUnit = unit;
  if (unit === 'g') { base = value / 1000; baseUnit = 'kg'; }
  if (unit === 'ml') { base = value / 1000; baseUnit = 'l'; }
  if (!(base > 0 && base <= 20)) return null;
  return { text: clean(m[0]), base, baseUnit };
}
function parseUnitPrice(lines: string[], index: number, baseUnit: string) {
  for (let j = index; j <= Math.min(lines.length - 1, index + 3); j++) {
    const raw = clean(lines[j]).replace(/\b0d\b/ig, 'od');
    const n = norm(raw);
    if (!n.includes(`1${baseUnit}`) && !n.includes(`1 ${baseUnit}`)) continue;
    if (/\bod\b/i.test(n)) continue;
    const re = new RegExp(`1\\s*${baseUnit}\\s*=\\s*(\\d{1,5})(?:[,.](\\d{1,2}))?`, 'i');
    const m = raw.match(re);
    if (!m) continue;
    const value = Number(m[1]) + Number((m[2] || '0').padEnd(2, '0')) / 100;
    if (value > 0 && value < 100000) return { value: round2(value), line: raw };
  }
  return null;
}
function numericCandidates(line: string) {
  const out = new Set<number>();
  const s = clean(line);
  for (const m of s.matchAll(/\b(\d{1,4})[,.](\d{1,2})\b/g)) {
    const v = Number(m[1]) + Number(m[2].padEnd(2, '0')) / 100;
    if (v >= 2 && v <= 5000) out.add(round2(v));
  }
  for (const m of s.matchAll(/\b(\d{1,3})\s+(\d{2})\b/g)) {
    const v = Number(m[1]) + Number(m[2]) / 100;
    if (v >= 2 && v <= 5000) out.add(round2(v));
  }
  for (const m of s.matchAll(/\b(\d{3,5})\b/g)) {
    const raw = Number(m[1]);
    const v = raw / 100;
    if (v >= 2 && v <= 5000) out.add(round2(v));
  }
  return [...out];
}
function findPrintedPrice(lines: string[], index: number, expected: number) {
  const tolerance = Math.max(0.12, expected * 0.012);
  let best: { value: number; line: string; distance: number } | null = null;
  for (let j = Math.max(0, index - 8); j < index; j++) {
    const line = clean(lines[j]);
    if (/1\s*(kg|l|ks)\s*=/i.test(line) || isPromo(line)) continue;
    for (const value of numericCandidates(line)) {
      const delta = Math.abs(value - expected);
      if (delta <= tolerance && (!best || delta < best.distance)) best = { value, line, distance: delta };
    }
  }
  return best;
}
function findTitle(lines: string[], index: number) {
  const picked: string[] = [];
  for (let j = index - 1; j >= Math.max(0, index - 6); j--) {
    const line = clean(lines[j]);
    if (isNoise(line)) continue;
    if (/\d{2,}/.test(line) && letters(line) < 8) continue;
    picked.unshift(line.replace(/^[-–—|]+|[-–—|]+$/g, '').trim());
    if (picked.length >= 2) break;
  }
  if (!picked.length) return null;
  const title = clean(picked.join(' '));
  if (title.length < 3 || title.length > 110 || letters(title) < 4) return null;
  if (isPromo(title)) return null;
  return title;
}
function localPromo(lines: string[], index: number) {
  for (let j = Math.max(0, index - 8); j <= Math.min(lines.length - 1, index + 4); j++) {
    if (isPromo(lines[j])) return true;
  }
  return false;
}
function parsePage(page: OcrPage): Candidate[] {
  const avg = Number(page.avg_confidence || 0);
  if (avg < 68 || page.page_number === 1) return [];
  const lines = String(page.text_content || '').split(/\r?\n/).map(clean).filter(Boolean);
  const out: Candidate[] = [];
  for (let i = 0; i < lines.length; i++) {
    const quantity = parseQuantity(lines[i]);
    if (!quantity || localPromo(lines, i)) continue;
    const unitPrice = parseUnitPrice(lines, i, quantity.baseUnit);
    if (!unitPrice) continue;
    const expected = round2(unitPrice.value * quantity.base);
    if (!(expected >= 2 && expected <= 5000)) continue;
    const printed = findPrintedPrice(lines, i, expected);
    if (!printed) continue;
    const title = findTitle(lines, i);
    if (!title) continue;
    out.push({
      title,
      price: printed.value,
      quantity_text: quantity.text,
      source_page: page.page_number,
      confidence: 0.97,
      raw_data: {
        parser: 'terno-ocr-unit-price-v1',
        unit_price: unitPrice.value,
        unit_price_line: unitPrice.line,
        expected_price: expected,
        printed_price_line: printed.line,
        price_delta: round2(printed.distance),
        ocr_page_confidence: avg,
        coverage_label: 'Vybrané prodejny Terno',
      },
    });
  }
  return out;
}
async function callPublisher(importId: string) {
  const res = await fetch(PUBLISHER_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      'content-type': 'application/json',
      ...(CRON_SECRET ? { 'x-cron-secret': CRON_SECRET } : {}),
    },
    body: JSON.stringify({ import_id: importId }),
  });
  const text = await res.text();
  let payload: any = null;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!res.ok) throw new Error(`publish-imports HTTP ${res.status}: ${text.slice(0, 500)}`);
  return payload;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(req)) return json({ error: 'Unauthorized' }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run !== false;
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'terno').maybeSingle();
    if (storeError) throw storeError;
    if (!store) throw new Error('Terno store not found.');

    let sourceImport: any = null;
    if (body.import_id) {
      const q = await db.from('leaflet_imports').select('*').eq('id', String(body.import_id)).eq('store_id', store.id).maybeSingle();
      if (q.error) throw q.error;
      sourceImport = q.data;
    } else {
      const q = await db.from('leaflet_imports')
        .select('*')
        .eq('store_id', store.id)
        .not('metadata->>ocr_complete', 'is', null)
        .order('created_at', { ascending: false })
        .limit(20);
      if (q.error) throw q.error;
      sourceImport = (q.data || []).find((x: any) => x?.metadata?.ocr_complete === true && Array.isArray(x?.metadata?.page_image_urls) && x.metadata.page_image_urls.length >= 2) || null;
    }
    if (!sourceImport) throw new Error('Aktuální Terno import s dokončeným OCR nebyl nalezen.');

    const { data: pages, error: pagesError } = await db.from('leaflet_ocr_pages')
      .select('page_number,text_content,avg_confidence')
      .eq('import_id', sourceImport.id)
      .order('page_number', { ascending: true });
    if (pagesError) throw pagesError;
    const rawCandidates = (pages || []).flatMap((p: any) => parsePage(p));
    const seen = new Set<string>();
    const candidates = rawCandidates.filter((c) => {
      const key = `${norm(c.title)}|${c.price}|${c.quantity_text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (dryRun) return json({
      ok: true,
      dry_run: true,
      source_import_id: sourceImport.id,
      source_document_url: sourceImport.source_document_url,
      candidate_count: candidates.length,
      candidates: candidates.slice(0, 80),
    });
    if (candidates.length < 8) throw new Error(`Bezpečný Terno parser našel jen ${candidates.length} položek; publikace zastavena.`);

    const hash = `terno-ocr-safe-v1-${sourceImport.id}`;
    const existing = await db.from('leaflet_imports').select('id,status').eq('source_hash', hash).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.status === 'published') return json({ ok: true, reused: true, import_id: existing.data.id, candidate_count: candidates.length });

    let derivedId = existing.data?.id || null;
    if (!derivedId) {
      const created = await db.from('leaflet_imports').insert({
        source_id: sourceImport.source_id,
        store_id: store.id,
        source_document_url: sourceImport.source_document_url,
        source_hash: hash,
        status: 'queued',
        coverage_scope: 'selected_stores',
        detected_valid_from: sourceImport.detected_valid_from,
        detected_valid_to: sourceImport.detected_valid_to,
        confidence: 0.97,
        metadata: {
          parser: 'terno-ocr-unit-price-v1',
          deterministic: true,
          verified_pipeline: true,
          source_import_id: sourceImport.id,
          coverage_label: 'Vybrané prodejny Terno',
          region: sourceImport.metadata?.region || null,
        },
      }).select('id').single();
      if (created.error) throw created.error;
      derivedId = created.data.id;
    }

    await db.from('leaflet_import_items').delete().eq('import_id', derivedId).neq('status', 'published');
    const inserted = await db.from('leaflet_import_items').insert(candidates.map((c) => ({
      import_id: derivedId,
      title: c.title,
      price: c.price,
      quantity_text: c.quantity_text,
      source_page: c.source_page,
      confidence: c.confidence,
      status: 'approved',
      raw_data: c.raw_data,
    })));
    if (inserted.error) throw inserted.error;
    const upd = await db.from('leaflet_imports').update({
      status: 'review',
      product_count: candidates.length,
      confidence: 0.97,
      error_message: null,
      finished_at: new Date().toISOString(),
    }).eq('id', derivedId);
    if (upd.error) throw upd.error;

    const publish = await callPublisher(derivedId);
    const result = Array.isArray(publish?.results) ? publish.results[0] : null;
    const published = Number(result?.published || 0) + Number(result?.duplicates || 0);
    if (!publish?.ok || result?.error || published < 1) throw new Error(`Terno publish selhal: ${JSON.stringify(publish).slice(0, 700)}`);

    if (sourceImport.source_id) {
      await db.from('leaflet_sources').update({
        last_checked_at: new Date().toISOString(),
        last_success_at: new Date().toISOString(),
        last_error: null,
      }).eq('id', sourceImport.source_id);
    }

    return json({ ok: true, dry_run: false, import_id: derivedId, source_import_id: sourceImport.id, candidate_count: candidates.length, publish });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ ok: false, error: message }, 500);
  }
});
