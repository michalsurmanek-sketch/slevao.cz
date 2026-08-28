import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const PUBLISHER_URL = `${URL}/functions/v1/publish-imports`;
const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

type Token = { text:string; x:number; y:number; width:number; height:number };
type Page = { page:number; tokens:Token[] };
type Candidate = {
  title:string;
  price:number;
  quantity_text:string;
  source_page:number;
  confidence:number;
  raw_data:Record<string, unknown>;
};
type Validity = { from:string; to:string };

type ExistingImport = {
  id:string;
  status:string;
  product_count:number | null;
  source_document_url:string | null;
  detected_valid_from:string | null;
  detected_valid_to:string | null;
  source_hash:string;
  metadata:Record<string, unknown> | null;
};

function allowed(req: Request) {
  return req.headers.get('authorization') === `Bearer ${KEY}` || Boolean(CRON && req.headers.get('x-cron-secret') === CRON);
}
function clean(v: unknown) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
function norm(v: unknown) { return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs'); }
function round2(n: number) { return Math.round(n * 100) / 100; }
function n(v: string) { return Number(v.replace(',', '.')); }
function letters(v: string) { return (v.match(/[A-Za-zÁ-ž]/g) || []).length; }
function tokenRight(t: Token) { return t.x + t.width; }
function isPromo(v: string) {
  const s = norm(v);
  return /(s klubem|bez klubu|při koupi|pri koupi|při nákupu|pri nakupu|pouze|aktivujte|kupon|kup[o ]?n|cena od|\bod\s+\d+\s*(ks|g)|super (středa|ctvrtek|čtvrtek|pátek|sobota|neděle|pondělí|úterý)|nálep|body navíc)/i.test(s);
}
function badTitle(v: string) {
  const s = clean(v);
  const z = norm(s);
  if (s.length < 3 || s.length > 110 || letters(s) < 3) return true;
  if (/^(top cena|super cena|cenová bomba|z pultu|čerstvé každý den|ovoce a zelenina|lahůdky|maso|akce|novinka)$/i.test(z)) return true;
  if (/^-?\d+\s*%$/.test(s) || /^\d/.test(s) || /kč|1\s*(kg|l)\s*=|\b(kg|g|ml|l)\b/i.test(s)) return true;
  return isPromo(s);
}
function parseQuantity(v: string) {
  if (/[×x]/i.test(v)) return null;
  const m = clean(v).match(/^(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l)(?:\s*\|.*)?$/i);
  if (!m) return null;
  const amount = n(m[1]);
  if (!(amount > 0)) return null;
  const unit = m[2].toLowerCase();
  const base = unit === 'g' || unit === 'ml' ? amount / 1000 : amount;
  if (!(base > 0 && base <= 20)) return null;
  return { amount, unit, base, text: `${m[1]} ${m[2]}` };
}
function parseUnitPrice(v: string) {
  const s = clean(v);
  if (isPromo(s) || /\bod\b/i.test(norm(s))) return null;
  const m = s.match(/^1\s*(kg|l)\s*=\s*(\d+(?:[,.]\d+)?)\s*Kč(?:\s|$)/i);
  if (!m) return null;
  const value = n(m[2]);
  return value > 0 && value < 100000 ? { unit: m[1].toLowerCase(), value } : null;
}
function normalizedTokens(page: Page): Token[] {
  const raw = (page.tokens || []).map((t) => ({
    text: clean(t.text), x:Number(t.x), y:Number(t.y), width:Number(t.width), height:Number(t.height),
  })).filter((t) => t.text && [t.x,t.y,t.width,t.height].every(Number.isFinite));
  return [...new Map(raw.map((t) => [`${t.text}|${t.x}|${t.y}|${t.width}|${t.height}`, t])).values()];
}
function combineLargePrices(tokens: Token[], quantity: Token, expected: number) {
  const direct = tokens
    .filter((t) => /^\d{1,4}[,.]\d{2}$/.test(t.text) && t.height >= 11 && t.y >= quantity.y + 18 && t.y <= quantity.y + 130 && t.x >= quantity.x - 15 && t.x <= quantity.x + 85)
    .map((t) => ({ value:n(t.text), text:t.text, x:t.x, y:t.y, height:t.height, delta:Math.abs(n(t.text)-expected) }))
    .filter((p) => p.delta <= 0.06);

  const integers = tokens.filter((t) => /^\d{1,4}$/.test(t.text) && t.height >= 14 && t.y >= quantity.y + 18 && t.y <= quantity.y + 130 && t.x >= quantity.x - 15 && t.x <= quantity.x + 85);
  const split:any[] = [];
  for (const whole of integers) {
    const cents = tokens.filter((t) => /^\d{2}$/.test(t.text) && t.height >= 9 && t.x >= whole.x + whole.width * 0.55 && t.x <= tokenRight(whole) + 28 && Math.abs(t.y - whole.y) <= 26);
    for (const cent of cents) {
      const value = Number(whole.text) + Number(cent.text) / 100;
      const delta = Math.abs(value - expected);
      if (delta <= 0.06) split.push({ value, text:`${whole.text},${cent.text}`, x:whole.x, y:whole.y, height:whole.height, delta });
    }
  }
  return [...direct, ...split].sort((a,b) => a.delta-b.delta || b.height-a.height)[0] || null;
}
function titleFor(tokens: Token[], quantity: Token, priceY: number) {
  const upper = Math.min(priceY - 3, quantity.y + 55);
  const eligible = tokens.filter((t) =>
    t.y >= quantity.y + 2 && t.y <= upper &&
    Math.abs(t.x - quantity.x) <= 45 &&
    t.height >= 6 && t.height <= 14 &&
    !badTitle(t.text)
  );
  const seed = [...eligible].sort((a,b) =>
    Math.abs(a.x - quantity.x) - Math.abs(b.x - quantity.x) ||
    a.y - b.y
  )[0];
  if (!seed) return '';
  const parts = eligible.filter((t) =>
    Math.abs(t.x - seed.x) <= 28 && Math.abs(t.x - quantity.x) <= 42
  ).sort((a,b) => b.y-a.y || a.x-b.x).slice(0, 3);
  const title = clean(parts.map((t) => t.text).join(' '));
  return badTitle(title) ? '' : title;
}
function localPromo(tokens: Token[], quantity: Token, priceY: number) {
  return tokens.some((t) =>
    t.y >= quantity.y - 5 && t.y <= priceY + 45 &&
    t.x >= quantity.x - 20 && t.x <= quantity.x + 95 &&
    isPromo(t.text)
  );
}
function parsePage(page: Page): Candidate[] {
  const tokens = normalizedTokens(page);
  const out: Candidate[] = [];
  for (const q of tokens) {
    const quantity = parseQuantity(q.text);
    if (!quantity) continue;
    const unitToken = tokens
      .map((t) => ({ t, parsed:parseUnitPrice(t.text) }))
      .filter((x) => x.parsed && Math.abs(x.t.x-q.x) <= 5 && x.t.y < q.y && q.y-x.t.y >= 3 && q.y-x.t.y <= 13)
      .sort((a,b) => (q.y-a.t.y)-(q.y-b.t.y))[0];
    if (!unitToken?.parsed) continue;
    const expectedUnit = quantity.unit === 'g' || quantity.unit === 'kg' ? 'kg' : 'l';
    if (unitToken.parsed.unit !== expectedUnit) continue;
    const expected = round2(unitToken.parsed.value * quantity.base);
    if (!(expected >= 2 && expected <= 3000)) continue;
    const printed = combineLargePrices(tokens, q, expected);
    if (!printed) continue;
    if (localPromo(tokens, q, printed.y)) continue;
    const title = titleFor(tokens, q, printed.y);
    if (!title) continue;
    out.push({
      title,
      price:printed.value,
      quantity_text:quantity.text,
      source_page:page.page,
      confidence:0.99,
      raw_data:{
        parser:'flop-pdf-spatial-unit-price-v3',
        deterministic:true,
        verification:'printed_unit_price_math',
        unit_price:unitToken.parsed.value,
        unit_price_unit:unitToken.parsed.unit,
        unit_price_token:unitToken.t.text,
        expected_price:expected,
        printed_price:printed.text,
        price_delta:round2(printed.delta),
        quantity_token:q.text,
        quantity_coordinates:{x:q.x,y:q.y},
        price_coordinates:{x:printed.x,y:printed.y},
      },
    });
  }
  return out;
}
function deriveValidity(url: string): Validity | null {
  const m = url.match(/\/(\d{1,2})_(\d{2})_(?:tisk_nahled_s|online)\.pdf$/i);
  if (!m) return null;
  const week = Number(m[1]), year = 2000 + Number(m[2]);
  if (!(week >= 1 && week <= 53)) return null;
  const jan4 = new Date(Date.UTC(year,0,4));
  const dow = jan4.getUTCDay() || 7;
  const monday = new Date(jan4); monday.setUTCDate(jan4.getUTCDate() - dow + 1 + (week-1)*7);
  const from = new Date(monday); from.setUTCDate(monday.getUTCDate()+2);
  const to = new Date(monday); to.setUTCDate(monday.getUTCDate()+8);
  return { from:from.toISOString().slice(0,10), to:to.toISOString().slice(0,10) };
}

function canonicalRaw(raw: any) {
  return {
    parser:clean(raw?.parser),
    deterministic:raw?.deterministic === true,
    verification:clean(raw?.verification),
    unit_price:Number(raw?.unit_price),
    unit_price_unit:clean(raw?.unit_price_unit),
    unit_price_token:clean(raw?.unit_price_token),
    expected_price:Number(raw?.expected_price),
    printed_price:clean(raw?.printed_price),
    price_delta:Number(raw?.price_delta),
    quantity_token:clean(raw?.quantity_token),
    quantity_coordinates:{x:Number(raw?.quantity_coordinates?.x),y:Number(raw?.quantity_coordinates?.y)},
    price_coordinates:{x:Number(raw?.price_coordinates?.x),y:Number(raw?.price_coordinates?.y)},
  };
}
function parserRow(c: Candidate) {
  return {
    title:clean(c.title),
    normalized_title:norm(c.title),
    price:Number(c.price),
    quantity_text:clean(c.quantity_text),
    source_page:Number(c.source_page),
    confidence:Number(c.confidence),
    raw_data:canonicalRaw(c.raw_data),
  };
}
function storedRow(item: any) {
  return {
    title:clean(item.title),
    price:Number(item.price),
    quantity_text:clean(item.quantity_text),
    source_page:Number(item.source_page),
    confidence:Number(item.confidence),
    raw_data:canonicalRaw(item.raw_data),
  };
}
function expectedStoredRow(c: Candidate) {
  const row = parserRow(c);
  return {
    title:`${row.title} · ${row.quantity_text}`,
    price:row.price,
    quantity_text:row.quantity_text,
    source_page:row.source_page,
    confidence:row.confidence,
    raw_data:row.raw_data,
  };
}
function stableSort<T>(rows: T[]): T[] {
  return [...rows].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function sameStoredPayload(items: any[], candidates: Candidate[]) {
  if (items.length !== candidates.length) return false;
  return JSON.stringify(stableSort(items.map(storedRow))) === JSON.stringify(stableSort(candidates.map(expectedStoredRow)));
}
async function sha256Hex(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2,'0')).join('');
}
async function payloadHash(candidates: Candidate[], src: any, validity: Validity) {
  const rows = stableSort(candidates.map(parserRow));
  return await sha256Hex({
    payload_contract:'flop-pdf-spatial-safe-v4',
    parser_contract:'flop-pdf-spatial-unit-price-v3',
    source_import_id:String(src.id),
    source_document_url:String(src.source_document_url || ''),
    valid_from:validity.from,
    valid_to:validity.to,
    coverage_scope:'store',
    store_location_name:'FLOP TOP',
    rows,
  });
}
async function storedImportMatches(row: ExistingImport, candidates: Candidate[], src: any, validity: Validity) {
  if (row.status !== 'published') return false;
  if (Number(row.product_count || 0) !== candidates.length) return false;
  if (String(row.source_document_url || '') !== String(src.source_document_url || '')) return false;
  if (row.detected_valid_from !== validity.from || row.detected_valid_to !== validity.to) return false;
  const { data:items,error } = await db.from('leaflet_import_items')
    .select('title,price,quantity_text,source_page,confidence,raw_data,status')
    .eq('import_id',row.id);
  if (error) throw error;
  if ((items || []).some((item:any) => item.status !== 'published')) return false;
  return sameStoredPayload(items || [],candidates);
}
async function extraction(importId?: string) {
  const { data:store,error:se } = await db.from('stores').select('id').eq('slug','flop').maybeSingle();
  if (se) throw se;
  if (!store) throw new Error('Flop store not found');
  if (importId) {
    const { data,error } = await db.from('leaflet_extracted_text').select('*,leaflet_imports!inner(*)').eq('import_id',importId).eq('parser','pdf-text-v3').maybeSingle();
    if (error) throw error;
    if (!data || data.leaflet_imports?.store_id !== store.id) throw new Error('Flop pdf-text-v3 extraction not found for import');
    return data;
  }
  const { data:imports,error } = await db.from('leaflet_imports').select('id,source_document_url,created_at').eq('store_id',store.id).not('source_document_url','is',null).order('created_at',{ascending:false}).limit(20);
  if (error) throw error;
  const today = new Date().toISOString().slice(0,10);
  for (const row of imports || []) {
    if (/\/Flop_A_/i.test(row.source_document_url || '')) continue;
    const validity = deriveValidity(String(row.source_document_url || ''));
    if (!validity || validity.from > today || validity.to < today) continue;
    const { data,error:ee } = await db.from('leaflet_extracted_text').select('*').eq('import_id',row.id).eq('parser','pdf-text-v3').maybeSingle();
    if (ee) throw ee;
    if (data) return data;
  }
  throw new Error('No current Flop pdf-text-v3 extraction found');
}
async function publish(importId: string) {
  const r = await fetch(PUBLISHER_URL, {
    method:'POST',
    headers:{ authorization:`Bearer ${KEY}`, apikey:KEY, 'content-type':'application/json', ...(CRON ? {'x-cron-secret':CRON} : {}) },
    body:JSON.stringify({ import_id:importId }),
  });
  const text = await r.text();
  let payload:any = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw:text }; }
  const result = Array.isArray(payload?.results) ? payload.results[0] : null;
  if (!r.ok || payload?.ok === false || result?.error) throw new Error(`publish-imports HTTP ${r.status}: ${text.slice(0,700)}`);
  return payload;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok',{headers});
  if (req.method !== 'POST') return json({error:'Method not allowed'},405);
  if (!allowed(req)) return json({error:'Unauthorized'},401);
  try {
    const body = await req.json().catch(()=>({}));
    const ext:any = await extraction(body.import_id ? String(body.import_id) : undefined);
    const raw = (Array.isArray(ext.pages) ? ext.pages : []).flatMap((p:Page) => parsePage(p));
    const seen = new Set<string>();
    const candidates = raw.filter((c) => {
      const key = `${norm(c.title)}|${c.price}|${c.quantity_text}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    const { data:src,error:ie } = await db.from('leaflet_imports').select('*').eq('id',ext.import_id).single();
    if (ie) throw ie;
    const validity = (src.detected_valid_from && src.detected_valid_to)
      ? { from:src.detected_valid_from, to:src.detected_valid_to }
      : deriveValidity(String(src.source_document_url || ''));
    if (!validity) throw new Error('Flop validity cannot be derived');
    const fullPayloadSha256 = await payloadHash(candidates,src,validity);
    if (body.dry_run !== false) return json({
      ok:true,dry_run:true,source_import_id:src.id,source_document_url:src.source_document_url,
      parser:'flop-pdf-spatial-unit-price-v3',payload_contract:'flop-pdf-spatial-safe-v4',full_payload_sha256:fullPayloadSha256,
      candidate_count:candidates.length,validity,candidates:candidates.slice(0,100),
    });
    if (candidates.length < 25) throw new Error(`Flop spatial parser found only ${candidates.length} deterministic products; publication stopped`);

    const hash = `flop-pdf-spatial-safe-v4-${fullPayloadSha256}`;
    const { data:oldV4,error:oe } = await db.from('leaflet_imports')
      .select('id,status,product_count,source_document_url,detected_valid_from,detected_valid_to,source_hash,metadata')
      .eq('source_hash',hash).maybeSingle();
    if (oe) throw oe;
    if (oldV4?.status === 'published') {
      if (!await storedImportMatches(oldV4 as ExistingImport,candidates,src,validity)) {
        throw new Error('FLOP v4 payload hash odpovídá importu, ale publikované položky se liší; automatické reuse zastaveno.');
      }
      return json({ok:true,reused:true,import_id:oldV4.id,candidate_count:candidates.length,validity,payload_contract:'flop-pdf-spatial-safe-v4',full_payload_sha256:fullPayloadSha256});
    }

    const legacyHash = `flop-pdf-spatial-safe-v3-${src.id}`;
    const { data:legacy,error:le } = await db.from('leaflet_imports')
      .select('id,status,product_count,source_document_url,detected_valid_from,detected_valid_to,source_hash,metadata')
      .eq('source_hash',legacyHash).maybeSingle();
    if (le) throw le;
    if (legacy?.status === 'published' && await storedImportMatches(legacy as ExistingImport,candidates,src,validity)) {
      const migratedAt = new Date().toISOString();
      const metadata = {
        ...(legacy.metadata || {}),
        full_payload_hash_version:'flop-pdf-spatial-safe-v4',
        full_payload_sha256:fullPayloadSha256,
        legacy_source_hash:legacyHash,
        full_payload_verified_at:migratedAt,
      };
      const { error:me } = await db.from('leaflet_imports').update({metadata}).eq('id',legacy.id);
      if (me) throw me;
      return json({ok:true,reused:true,migrated_legacy_hash:true,import_id:legacy.id,candidate_count:candidates.length,validity,payload_contract:'flop-pdf-spatial-safe-v4',full_payload_sha256:fullPayloadSha256});
    }

    let id = oldV4?.id;
    if (!id) {
      const created = await db.from('leaflet_imports').insert({
        source_id:src.source_id,store_id:src.store_id,source_document_url:src.source_document_url,
        source_hash:hash,status:'queued',coverage_scope:'store',store_location_name:'FLOP TOP',
        detected_valid_from:validity.from,detected_valid_to:validity.to,confidence:0.99,
        metadata:{
          parser:'flop-pdf-spatial-unit-price-v3',adapter:'flop-pdf-spatial-unit-price-v3',deterministic:true,
          verified_pipeline:true,source_import_id:src.id,partial_coverage:true,
          payload_contract:'flop-pdf-spatial-safe-v4',full_payload_hash_version:'flop-pdf-spatial-safe-v4',full_payload_sha256:fullPayloadSha256,
        },
      }).select('id').single();
      if (created.error) throw created.error;
      id = created.data.id;
    }
    await db.from('leaflet_import_items').delete().eq('import_id',id).neq('status','published');
    const ins = await db.from('leaflet_import_items').insert(candidates.map((c) => ({
      import_id:id,title:c.title,price:c.price,quantity_text:c.quantity_text,source_page:c.source_page,
      confidence:c.confidence,status:'approved',raw_data:c.raw_data,
    })));
    if (ins.error) throw ins.error;
    const upd = await db.from('leaflet_imports').update({
      status:'review',product_count:candidates.length,confidence:0.99,error_message:null,finished_at:new Date().toISOString(),
      metadata:{
        ...(oldV4?.metadata || {}),parser:'flop-pdf-spatial-unit-price-v3',adapter:'flop-pdf-spatial-unit-price-v3',deterministic:true,
        verified_pipeline:true,source_import_id:src.id,partial_coverage:true,
        payload_contract:'flop-pdf-spatial-safe-v4',full_payload_hash_version:'flop-pdf-spatial-safe-v4',full_payload_sha256:fullPayloadSha256,
      },
    }).eq('id',id);
    if (upd.error) throw upd.error;
    const result = await publish(id);
    await db.from('offers').update({status:'expired',updated_at:new Date().toISOString()})
      .eq('store_id',src.store_id).eq('status','published').eq('store_location_name','FLOP TOP')
      .lt('valid_to',validity.from);
    return json({
      ok:true,dry_run:false,import_id:id,source_import_id:src.id,candidate_count:candidates.length,validity,publish:result,
      payload_contract:'flop-pdf-spatial-safe-v4',full_payload_sha256:fullPayloadSha256,
    });
  } catch (e) {
    return json({ok:false,error:e instanceof Error ? e.message : String(e)},500);
  }
});