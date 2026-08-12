import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-cron-secret',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

type Token = { text:string; x:number; y:number; width:number; height:number };
type Page = { page:number; lines?:string[]; tokens:Token[] };
type Anchor = { x:number; y:number; kind:'normal' };
type Candidate = {
  title:string;
  price:number;
  quantity_text:string;
  source_page:number;
  confidence:number;
  raw_data:Record<string,unknown>;
};

function allowed(req: Request) {
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${SERVICE_ROLE_KEY}` || (CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET);
}
function clean(value: unknown) { return String(value ?? '').replace(/\s+/g, ' ').trim(); }
function norm(value: unknown) {
  return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs');
}
function round2(n:number) { return Math.round(n * 100) / 100; }
function centerX(t:Token) { return t.x + Math.max(0, t.width) / 2; }
function isDigits(t:Token, min=1, max=3) { return new RegExp(`^\\d{${min},${max}}$`).test(clean(t.text)); }
function isPromoText(s:string) {
  const n = norm(s);
  return /\b(pouze|streda|ctvrtek|patek|sobota|nedele|pondeli|utery|pri koupi|kupon|soutez|sleva na nakup)\b/.test(n);
}
function isNoiseLine(s:string) {
  const n = norm(s);
  return !/[a-zá-ž]/i.test(s)
    || /^(nase cena|klubova cena|cena|vybrane druhy|bez lepku|\d+\s*%\s*masa)$/i.test(n)
    || /^(1\s*(kg|l|ks)\s*=)/i.test(n)
    || /^\d+(?:[,.]\d+)?\s*(g|kg|ml|l|ks)\b/i.test(n)
    || isPromoText(s);
}

function directAnchors(tokens:Token[]): Anchor[] {
  const out:Anchor[] = [];
  for (const t of tokens) {
    if (norm(t.text) === 'nase cena') out.push({ x:t.x, y:t.y, kind:'normal' });
  }
  const nase = tokens.filter(t => norm(t.text) === 'nase');
  const cena = tokens.filter(t => norm(t.text) === 'cena');
  for (const n of nase) {
    const c = cena.find(c => Math.abs(c.x - n.x) <= 6 && c.y < n.y && n.y - c.y <= 10);
    if (c) out.push({ x:Math.min(n.x,c.x), y:Math.max(n.y,c.y), kind:'normal' });
  }
  out.sort((a,b)=>b.y-a.y || a.x-b.x);
  const dedup:Anchor[] = [];
  for (const a of out) {
    if (!dedup.some(d => Math.abs(d.x-a.x)<8 && Math.abs(d.y-a.y)<10)) dedup.push(a);
  }
  return dedup;
}

function findPrice(tokens:Token[], anchor:Anchor) {
  const ints = tokens.filter(t => isDigits(t,1,3)
    && t.height >= 14
    && t.y <= anchor.y - 7 && t.y >= anchor.y - 42
    && centerX(t) >= anchor.x - 10 && centerX(t) <= anchor.x + 45);
  ints.sort((a,b) => (Math.abs((anchor.y-24)-a.y) - Math.abs((anchor.y-24)-b.y)) || b.height-a.height);
  for (const whole of ints) {
    const suffixes = tokens.filter(t => isDigits(t,2,2)
      && t !== whole
      && t.height >= 7 && t.height <= 22
      && t.y >= whole.y + 2 && t.y <= whole.y + 22
      && t.x >= whole.x + whole.width - 6 && t.x <= whole.x + whole.width + 38);
    suffixes.sort((a,b)=>Math.abs(a.x-(whole.x+whole.width))-Math.abs(b.x-(whole.x+whole.width)));
    const suffix = suffixes[0];
    const price = Number(whole.text) + (suffix ? Number(suffix.text)/100 : 0);
    if (price >= 2 && price <= 5000) return { price:round2(price), whole, suffix:suffix || null };
  }
  return null;
}

function anchorBand(anchors:Anchor[], anchor:Anchor, pageWidth:number) {
  const row = anchors.filter(a => Math.abs(a.y-anchor.y) <= 12).sort((a,b)=>a.x-b.x);
  const idx = row.findIndex(a => a === anchor);
  const prev = idx > 0 ? row[idx-1] : null;
  const next = idx >= 0 && idx < row.length-1 ? row[idx+1] : null;
  const left = prev ? (prev.x+anchor.x)/2 : Math.max(0, anchor.x-32);
  const right = next ? (anchor.x+next.x)/2 : Math.min(pageWidth, anchor.x+145);
  return { left, right };
}

function groupLines(tokens:Token[]) {
  const groups:{y:number;tokens:Token[]}[] = [];
  for (const t of [...tokens].sort((a,b)=>b.y-a.y || a.x-b.x)) {
    let g = groups.find(g => Math.abs(g.y-t.y) <= 2.5);
    if (!g) { g={y:t.y,tokens:[]}; groups.push(g); }
    g.tokens.push(t);
    g.y = Math.max(g.y,t.y);
  }
  return groups.sort((a,b)=>b.y-a.y).map(g=>({
    y:g.y,
    text:clean(g.tokens.sort((a,b)=>a.x-b.x).map(t=>t.text).join(' ')),
    tokens:g.tokens,
  }));
}

function extractQuantity(lines:{y:number;text:string}[]) {
  const re = /\b(\d+(?:[,.]\d+)?)(?:\s*[–-]\s*(\d+(?:[,.]\d+)?))?\s*(kg|g|l|ml|ks)\b/i;
  for (const line of lines) {
    const m = line.text.match(re);
    if (!m) continue;
    const a = Number(m[1].replace(',','.'));
    const b = m[2] ? Number(m[2].replace(',','.')) : null;
    const selected = b && b > a ? b : a;
    const unit = m[3].toLowerCase();
    let base = selected;
    if (unit === 'g') base = selected/1000;
    if (unit === 'ml') base = selected/1000;
    if (unit === 'kg' || unit === 'l') base = selected;
    if (unit === 'ks') base = selected;
    if (!(base > 0)) continue;
    return { text:clean(m[0]), base, unit, range:Boolean(b) };
  }
  return null;
}

function unitPrices(lines:{y:number;text:string}[]) {
  const values:number[] = [];
  for (const line of lines) {
    if (!/^\s*1\s*(kg|l|ks)\s*=/i.test(line.text)) continue;
    for (const m of line.text.matchAll(/(\d{1,5}(?:[,.]\d{1,2})?)\s*Kč/gi)) {
      const n = Number(m[1].replace(',','.'));
      if (Number.isFinite(n) && n > 0 && n < 100000) values.push(n);
    }
  }
  return [...new Set(values.map(round2))];
}

function buildTitle(lines:{y:number;text:string}[]) {
  const usable = lines.filter(l => !isNoiseLine(l.text) && !/\b(klubem|bez klubu)\b/i.test(l.text));
  if (!usable.length) return null;
  const first = usable[0].text;
  if (norm(first) === 'vybrane druhy' || first.length < 3) return null;
  const second = usable[1]?.text || '';
  const secondGood = second && !/\b\d+(?:[,.]\d+)?\s*(g|kg|ml|l|ks)\b/i.test(second) && norm(second) !== 'vybrane druhy';
  const title = clean(secondGood ? `${first} ${second}` : first).replace(/\s*\|\s*$/,'');
  // A second price anchor inside the title means the horizontal band crossed into a neighbouring product.
  if (/\bnase cena\b/.test(norm(title))) return null;
  return title.length >= 3 && title.length <= 100 ? title : null;
}

function hasLocalPromo(tokens:Token[], band:{left:number;right:number}, anchor:Anchor, priceY:number) {
  return tokens.some(t => centerX(t)>=band.left && centerX(t)<=band.right
    && t.y <= anchor.y+28 && t.y >= priceY-85
    && isPromoText(t.text));
}

function parsePage(page:Page):Candidate[] {
  const tokens = (page.tokens || []).map(t=>({
    text:clean(t.text), x:Number(t.x), y:Number(t.y), width:Number(t.width), height:Number(t.height),
  })).filter(t=>t.text && Number.isFinite(t.x) && Number.isFinite(t.y));
  const anchors = directAnchors(tokens);
  const pageWidth = Math.max(595, ...tokens.map(t=>t.x+t.width));
  const out:Candidate[] = [];
  for (const anchor of anchors) {
    const p = findPrice(tokens, anchor);
    if (!p) continue;
    const band = anchorBand(anchors, anchor, pageWidth);
    if (hasLocalPromo(tokens, band, anchor, p.whole.y)) continue;
    const below = tokens.filter(t => centerX(t)>=band.left && centerX(t)<=band.right
      && t.y < p.whole.y-3 && t.y >= p.whole.y-72);
    const lines = groupLines(below).map(l=>({y:l.y,text:l.text}));
    const quantity = extractQuantity(lines);
    if (!quantity) continue;
    const title = buildTitle(lines);
    if (!title) continue;
    const unit = unitPrices(lines);
    if (!unit.length) continue;
    const expected = quantity.unit === 'ks' ? p.price/quantity.base : p.price/quantity.base;
    const matched = unit.find(u => Math.abs(u-expected) <= Math.max(0.06, expected*0.006));
    if (!matched) continue;
    out.push({
      title,
      price:p.price,
      quantity_text:quantity.text,
      source_page:page.page,
      confidence:0.99,
      raw_data:{
        parser:'hruska-coordinate-v1',
        price_anchor:'NAŠE CENA',
        price_whole:p.whole.text,
        price_suffix:p.suffix?.text || null,
        unit_price_match:matched,
        expected_unit_price:round2(expected),
        quantity_base:quantity.base,
        quantity_unit:quantity.unit,
        quantity_range:quantity.range,
      },
    });
  }
  return out;
}

function parseValidity(text:string) {
  const m = text.match(/Platnost:\s*(\d{1,2})\.\s*(\d{1,2})\.\s*[–-]\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})/i);
  if (!m) return { from:null, to:null };
  const iso=(d:string,mo:string,y:string)=>`${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  return { from:iso(m[1],m[2],m[5]), to:iso(m[3],m[4],m[5]) };
}

async function latestHruskaExtraction(importId?:string) {
  if (importId) {
    const { data, error } = await db.from('leaflet_extracted_text').select('*').eq('import_id',importId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Extrahovaný text importu nebyl nalezen.');
    return data;
  }
  const { data:store,error:storeError } = await db.from('stores').select('id').eq('slug','hruska').maybeSingle();
  if (storeError) throw storeError;
  if (!store) throw new Error('Obchod Hruška nebyl nalezen.');
  const { data:imports,error:importsError } = await db.from('leaflet_imports').select('id').eq('store_id',store.id).order('created_at',{ascending:false}).limit(20);
  if (importsError) throw importsError;
  for (const row of imports || []) {
    const { data } = await db.from('leaflet_extracted_text').select('*').eq('import_id',row.id).maybeSingle();
    if (data?.parser === 'pdf-text-v3') return data;
  }
  throw new Error('Hruška zatím nemá souřadnicovou extrakci pdf-text-v3.');
}

async function writeCandidates(importId:string, candidates:Candidate[], validity:{from:string|null;to:string|null}) {
  if (!validity.from || !validity.to) throw new Error('Nepodařilo se ověřit platnost Hruška letáku.');
  // The generic PDF processor may publish raw OCR rows before this verified parser runs.
  // Replace the complete import atomically at the logical level so only coordinate-verified rows survive.
  const del = await db.from('leaflet_import_items').delete().eq('import_id',importId);
  if (del.error) throw del.error;
  if (candidates.length) {
    const { error } = await db.from('leaflet_import_items').insert(candidates.map(c=>({
      import_id:importId,
      title:c.title,
      price:c.price,
      quantity_text:c.quantity_text,
      source_page:c.source_page,
      confidence:c.confidence,
      status:'approved',
      raw_data:c.raw_data,
    })));
    if (error) throw error;
  }
  const { data:job,error:jobError } = await db.from('leaflet_imports').select('metadata').eq('id',importId).single();
  if (jobError) throw jobError;
  const { error:updateError } = await db.from('leaflet_imports').update({
    status:'review',
    product_count:candidates.length,
    confidence:candidates.length ? 0.99 : null,
    detected_valid_from:validity.from,
    detected_valid_to:validity.to,
    error_message:candidates.length ? null : 'Souřadnicový parser nenašel bezpečně ověřené produkty.',
    finished_at:new Date().toISOString(),
    metadata:{ ...(job.metadata || {}), parser:'hruska-coordinate-v1', verified_coordinate_items:candidates.length, deterministic:true },
  }).eq('id',importId);
  if (updateError) throw updateError;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok',{headers:CORS});
  if (req.method !== 'POST') return json({error:'Method not allowed'},405);
  if (!allowed(req)) return json({error:'Unauthorized'},401);
  try {
    const body = await req.json().catch(()=>({}));
    const extraction = await latestHruskaExtraction(body.import_id ? String(body.import_id) : undefined);
    const pages = Array.isArray(extraction.pages) ? extraction.pages as Page[] : [];
    const candidates = pages.flatMap(parsePage);
    const seen = new Set<string>();
    const unique = candidates.filter(c=>{
      const key=`${norm(c.title)}|${c.price.toFixed(2)}|${c.quantity_text}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    const validity = parseValidity(clean(extraction.text_content));
    if (body.dry_run === false) await writeCandidates(extraction.import_id, unique, validity);
    return json({
      ok:true,
      dry_run:body.dry_run !== false,
      import_id:extraction.import_id,
      parser:'hruska-coordinate-v1',
      validity,
      candidate_count:unique.length,
      candidates:unique.slice(0,120),
    });
  } catch (e) {
    return json({error:e instanceof Error ? e.message : String(e)},500);
  }
});
