import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const PUBLISHER_URL = `${SUPABASE_URL}/functions/v1/publish-imports`;
const OCR_URL = `${SUPABASE_URL}/functions/v1/ocr-image-kreuzberg`;
const PARSER = 'jip-ocr-spatial-unit-marker-v3';
const OCR_ENGINE = 'kreuzberg-tesseract-wasm-jip-v1';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-cron-secret',
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

type OcrWord = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number | string | null;
  block?: number;
  paragraph?: number;
  line?: number;
  word?: number;
};
type OcrPage = {
  page_number: number;
  text_content: string;
  avg_confidence: number | string | null;
  words: OcrWord[] | null;
};
type Candidate = {
  title: string;
  price: number;
  quantity_text: string;
  source_page: number;
  confidence: number;
  raw_data: Record<string, unknown>;
};
type SpatialLine = {
  text: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  centerX: number;
  confidence: number;
  column: number;
};
type Box = { left:number; top:number; width:number; height:number };

function allowed(req: Request) {
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${SERVICE_ROLE_KEY}` || Boolean(CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET);
}
function clean(v: unknown) { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
function norm(v: unknown) { return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs'); }
function round2(n: number) { return Math.round(n * 100) / 100; }
function letters(s: string) { return (s.match(/[A-Za-zÁ-ž]/g) || []).length; }
function num(value: unknown): number | null { const n=Number(value); return Number.isFinite(n)?n:null; }
function pragueToday() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Prague', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part)=>[part.type,part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
async function sha256(value:string) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b)=>b.toString(16).padStart(2,'0')).join('');
}
function isPromo(s: string) {
  const n = norm(s);
  return /(pri koupi|kup vic|zaplat min|super (ctvrtek|patek|sobota|nedele|pondeli|utery|streda)|pouze (ve|v|dnes)|verne zakazniky|klub|karta|aplikac|kupon|cena plati pro max|na nakup\/den|od \d+\s*ks|cena od|nabidka (ne)?plati pro|do vyprodani zasob|bez dph)/i.test(n);
}
function isNoise(s: string) {
  const n = norm(s);
  if (letters(s) < 3 || s.length < 3 || s.length > 100) return true;
  if (/^(super cena|cena|akce|novinka|vybrane druhy|pultovy prodej|kvalitni potraviny|z naseho regionu)$/i.test(n)) return true;
  if (/^(?:\d+(?:[,.]\d+)?\s*)?(?:g|kg|ml|l|ks)\b/i.test(n)) return true;
  if (/^1\s*(kg|l|ks)\s*=/i.test(n) || /^-?\d+\s*%/.test(n)) return true;
  return isPromo(s);
}
function unitMarker(line: string) {
  const n = norm(line).replace(/\s+/g, '');
  if (/\/100g\b/.test(n)) return { text: '100 g', base: 0.1, baseUnit: 'kg' };
  if (/\/kg\b/.test(n)) return { text: '1 kg', base: 1, baseUnit: 'kg' };
  if (/\/l\b/.test(n)) return { text: '1 l', base: 1, baseUnit: 'l' };
  return null;
}
function printedPrices(value: string) {
  const out = new Set<number>(); const s = clean(value);
  for (const m of s.matchAll(/\b(\d{1,4})[,.](\d{1,2})\b/g)) {
    const v = Number(m[1]) + Number(m[2].padEnd(2, '0')) / 100;
    if (v >= 2 && v <= 5000) out.add(round2(v));
  }
  for (const m of s.matchAll(/\b(\d{1,4})\s*,-\b/g)) {
    const v = Number(m[1]); if (v >= 2 && v <= 5000) out.add(v);
  }
  return [...out];
}
function spatialLines(words: OcrWord[]) {
  const valid = words.filter((w) => clean(w.text) && clean(w.text).length < 120 && Number.isFinite(Number(w.left)) && Number.isFinite(Number(w.top)));
  const groups = new Map<string, OcrWord[]>();
  for (const w of valid) {
    const key = `${w.block ?? 0}|${w.paragraph ?? 0}|${w.line ?? Math.round(Number(w.top) / 8)}`;
    const bucket = groups.get(key) || []; bucket.push(w); groups.set(key, bucket);
  }
  return [...groups.values()].map((group): SpatialLine => {
    group.sort((a, b) => Number(a.left) - Number(b.left));
    const left = Math.min(...group.map((w) => Number(w.left)));
    const right = Math.max(...group.map((w) => Number(w.left) + Number(w.width || 0)));
    const top = Math.min(...group.map((w) => Number(w.top)));
    const bottom = Math.max(...group.map((w) => Number(w.top) + Number(w.height || 0)));
    const confidences = group.map((w) => Number(w.confidence || 0)).filter(Number.isFinite);
    return { text: clean(group.map((w) => w.text).join(' ')), left, right, top, bottom, centerX: (left + right) / 2,
      confidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0, column: 0 };
  }).sort((a, b) => a.top - b.top || a.left - b.left);
}
function parsePage(page: OcrPage): Candidate[] {
  const pageConfidence = Number(page.avg_confidence || 0); const words = Array.isArray(page.words) ? page.words : [];
  if (pageConfidence < 55 || words.length < 25) return [];
  const lines = spatialLines(words); const out: Candidate[] = [];
  for (const markerLine of lines) {
    const marker = unitMarker(markerLine.text); if (!marker || markerLine.confidence < 68) continue;
    const local = lines.filter((line) => Math.abs(line.centerX - markerLine.centerX) <= 240 && line.top >= markerLine.top - 180 && line.top <= markerLine.bottom + 220);
    if (local.some((line) => isPromo(line.text))) continue;
    const priceOptions: Array<{ value: number; line: SpatialLine; distance: number }> = [];
    for (const line of local) {
      if (line.confidence < 78 || unitMarker(line.text) || isPromo(line.text)) continue;
      for (const value of printedPrices(line.text)) {
        const distance = Math.abs(line.centerX - markerLine.centerX) + Math.abs(line.top - markerLine.top) * 1.7;
        if (Math.abs(line.top - markerLine.top) <= 100) priceOptions.push({ value, line, distance });
      }
    }
    priceOptions.sort((a, b) => a.distance - b.distance); const printed = priceOptions[0]; if (!printed) continue;
    const titles = local.filter((line) => {
      if (line === printed.line || line === markerLine || line.confidence < 78 || Math.abs(line.top - markerLine.top) > 180) return false;
      if (printedPrices(line.text).length || unitMarker(line.text) || isNoise(line.text)) return false;
      if (/(cena|dph|nabidka|www\.|jip potraviny|na pultu|\/100g|\/kg)/i.test(norm(line.text))) return false;
      return letters(line.text) >= 5 && line.text.length >= 5 && line.text.length <= 80;
    }).map((line) => ({ line, distance: Math.abs(line.centerX - markerLine.centerX) + Math.abs(line.top - markerLine.top) * 1.25 }))
      .sort((a, b) => a.distance - b.distance);
    const titleLine = titles[0]?.line; if (!titleLine) continue;
    const confidence = Math.min(0.99, round2(0.94 + Math.min(markerLine.confidence, printed.line.confidence, titleLine.confidence, pageConfidence) / 2000));
    out.push({ title: clean(titleLine.text), price: printed.value, quantity_text: marker.text, source_page: page.page_number, confidence,
      raw_data: { parser: PARSER, deterministic: true, printed_unit_marker: markerLine.text, printed_price_line: printed.line.text,
        quantity_base: marker.base, quantity_base_unit: marker.baseUnit,
        marker_coordinates: { left: markerLine.left, top: markerLine.top, right: markerLine.right, bottom: markerLine.bottom },
        price_coordinates: { left: printed.line.left, top: printed.line.top, right: printed.line.right, bottom: printed.line.bottom },
        title_coordinates: { left: titleLine.left, top: titleLine.top, right: titleLine.right, bottom: titleLine.bottom },
        ocr_page_confidence: pageConfidence, coverage_label: 'JIP potraviny – dle omezení uvedených v letáku' } });
  }
  return out;
}

function boxFromGeometry(raw: any): Box | null {
  if (!raw) return null;
  const sources = [raw, raw.boundingBox, raw.bounding_box, raw.bbox, raw.rect, raw.rectangle].filter(Boolean);
  for (const source of sources) {
    if (Array.isArray(source) && source.length >= 4 && source.every((x)=>Number.isFinite(Number(x)))) {
      const a=Number(source[0]),b=Number(source[1]),c=Number(source[2]),d=Number(source[3]);
      const width = c > a && d > b ? c-a : c;
      const height = c > a && d > b ? d-b : d;
      if (width>0 && height>0) return {left:a,top:b,width,height};
    }
    if (typeof source === 'object') {
      const left=num(source.left ?? source.x ?? source.x0 ?? source.minX ?? source.min_x);
      const top=num(source.top ?? source.y ?? source.y0 ?? source.minY ?? source.min_y);
      const width=num(source.width ?? source.w);
      const height=num(source.height ?? source.h);
      const right=num(source.right ?? source.x1 ?? source.maxX ?? source.max_x);
      const bottom=num(source.bottom ?? source.y1 ?? source.maxY ?? source.max_y);
      if (left!==null && top!==null) {
        const w=width!==null?width:(right!==null?right-left:null);
        const h=height!==null?height:(bottom!==null?bottom-top:null);
        if (w!==null && h!==null && w>0 && h>0) return {left,top,width:w,height:h};
      }
      const points = source.points ?? source.vertices ?? source.polygon;
      if (Array.isArray(points) && points.length>=2) {
        const xs=points.map((p:any)=>num(p?.x ?? p?.[0])).filter((x:any)=>x!==null) as number[];
        const ys=points.map((p:any)=>num(p?.y ?? p?.[1])).filter((y:any)=>y!==null) as number[];
        if (xs.length>=2 && ys.length>=2) {
          const l=Math.min(...xs),t=Math.min(...ys),r=Math.max(...xs),b=Math.max(...ys);
          if (r>l && b>t) return {left:l,top:t,width:r-l,height:b-t};
        }
      }
    }
  }
  return null;
}
function confidence100(value:unknown) {
  const n=Number(value); if (!Number.isFinite(n)) return 0;
  return Math.max(0,Math.min(100,n<=1?n*100:n));
}
function normalizeKreuzbergElements(elements:any[]):OcrWord[] {
  const out:OcrWord[]=[]; const seen=new Set<string>();
  for (const element of Array.isArray(elements)?elements:[]) {
    const text=clean(element?.text); if (!text) continue;
    const level=String(element?.level ?? '').toLowerCase();
    if (level && /line|paragraph|block|page/.test(level) && !/word/.test(level)) continue;
    const box=boxFromGeometry(element?.geometry); if (!box) continue;
    const confidence=confidence100(element?.confidence);
    const key=`${text}|${Math.round(box.left)}|${Math.round(box.top)}|${Math.round(box.width)}|${Math.round(box.height)}`;
    if (seen.has(key)) continue; seen.add(key);
    out.push({text,left:box.left,top:box.top,width:box.width,height:box.height,confidence,
      block:0,paragraph:0,line:Math.max(1,Math.round(box.top/8)),word:out.length+1});
  }
  return out;
}
async function ocrOnePage(importId:string,pageNumber:number,imageUrl:string) {
  const response=await fetch(OCR_URL,{method:'POST',headers:{authorization:`Bearer ${SERVICE_ROLE_KEY}`,apikey:SERVICE_ROLE_KEY,'content-type':'application/json',...(CRON_SECRET?{'x-cron-secret':CRON_SECRET}:{})},body:JSON.stringify({image_url:imageUrl,language:'ces'})});
  const text=await response.text(); let payload:any={};
  try { payload=text?JSON.parse(text):{}; } catch { payload={raw:text}; }
  if (!response.ok || !payload?.ok) throw new Error(`JIP OCR strana ${pageNumber}: HTTP ${response.status}: ${text.slice(0,500)}`);
  const words=normalizeKreuzbergElements(payload.ocr_elements || []);
  const avg=words.length?round2(words.reduce((sum,w)=>sum+Number(w.confidence||0),0)/words.length):0;
  if (words.length<20 || avg<35) throw new Error(`JIP OCR strana ${pageNumber} je příliš slabá (${words.length} slov, ${avg} %).`);
  const checksum=await sha256(`${imageUrl}|${payload.content||''}|${words.map(w=>`${w.text}:${Math.round(w.left)}:${Math.round(w.top)}`).join('|')}`);
  const {error}=await db.from('leaflet_ocr_pages').upsert({import_id:importId,page_number:pageNumber,image_url:imageUrl,engine:OCR_ENGINE,language:'ces',text_content:String(payload.content||''),words,avg_confidence:avg,word_count:words.length,checksum,updated_at:new Date().toISOString()},{onConflict:'import_id,page_number'});
  if (error) throw error;
  return {page_number:pageNumber,words:words.length,avg_confidence:avg,elapsed_ms:payload.elapsed_ms??null};
}
async function callPublisher(importId: string) {
  const res = await fetch(PUBLISHER_URL, { method:'POST', headers:{ authorization:`Bearer ${SERVICE_ROLE_KEY}`, apikey:SERVICE_ROLE_KEY, 'content-type':'application/json', ...(CRON_SECRET?{'x-cron-secret':CRON_SECRET}:{}) }, body:JSON.stringify({import_id:importId}) });
  const text = await res.text(); let payload:any=null;
  try { payload=text?JSON.parse(text):{}; } catch { payload={raw:text}; }
  if (!res.ok) throw new Error(`publish-imports HTTP ${res.status}: ${text.slice(0,500)}`);
  return payload;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(req)) return json({ error: 'Unauthorized' }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const batchSize = Math.max(1,Math.min(4,Number(body.ocr_batch_size||3)));
    const today=pragueToday();
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'jip').maybeSingle();
    if (storeError) throw storeError;
    if (!store) throw new Error('JIP store not found.');

    let sourceImport:any=null;
    if (body.import_id) {
      const q=await db.from('leaflet_imports').select('*').eq('id',String(body.import_id)).eq('store_id',store.id).maybeSingle();
      if (q.error) throw q.error; sourceImport=q.data;
    } else {
      const q=await db.from('leaflet_imports').select('*').eq('store_id',store.id).eq('metadata->>adapter','jip-flip-pdf-v1').gt('detected_valid_to',today).order('detected_valid_from',{ascending:true}).order('created_at',{ascending:false}).limit(20);
      if (q.error) throw q.error;
      sourceImport=(q.data||[]).find((x:any)=>Array.isArray(x?.metadata?.page_image_urls)&&x.metadata.page_image_urls.length>=2)||null;
    }
    if (!sourceImport) return json({ok:true,processing:false,published:false,reason:'JIP nemá aktuální nebo nadcházející leták s obrazovými stranami.'});
    if (String(sourceImport.detected_valid_to||'')<=today) return json({ok:true,processing:false,published:false,reason:'Vybraný JIP leták už končí dnes nebo je prošlý.',source_import_id:sourceImport.id});

    const pageImages=Array.isArray(sourceImport?.metadata?.page_image_urls)?sourceImport.metadata.page_image_urls.map(String):[];
    if (pageImages.length<2) throw new Error('JIP import nemá úplný seznam obrazových stran.');
    const {data:existingPages,error:existingPagesError}=await db.from('leaflet_ocr_pages').select('page_number').eq('import_id',sourceImport.id);
    if (existingPagesError) throw existingPagesError;
    const done=new Set((existingPages||[]).map((p:any)=>Number(p.page_number)));
    const missing=pageImages.map((url:string,index:number)=>({url,page:index+1})).filter((x:any)=>!done.has(x.page));
    const generated:any[]=[];
    for (const item of missing.slice(0,batchSize)) generated.push(await ocrOnePage(sourceImport.id,item.page,item.url));

    const {data:refresh}=await db.rpc('refresh_leaflet_ocr_completion',{p_import_id:sourceImport.id});
    const {data:pages,error:pagesError}=await db.from('leaflet_ocr_pages').select('page_number,text_content,avg_confidence,words').eq('import_id',sourceImport.id).order('page_number',{ascending:true});
    if (pagesError) throw pagesError;
    const remaining=Math.max(0,pageImages.length-(pages||[]).length);
    if (remaining>0) return json({ok:true,processing:true,published:false,source_import_id:sourceImport.id,valid_from:sourceImport.detected_valid_from,valid_to:sourceImport.detected_valid_to,ocr_generated:generated,ocr_pages:(pages||[]).length,ocr_expected:pageImages.length,ocr_remaining:remaining,completion:refresh});

    const rawCandidates=(pages||[]).flatMap((p:any)=>parsePage(p));
    const seen=new Set<string>();
    const candidates=rawCandidates.filter((c)=>{const key=`${norm(c.title)}|${c.price}|${c.quantity_text}`;if(seen.has(key))return false;seen.add(key);return true;});
    if (dryRun) return json({ok:true,dry_run:true,processing:false,source_import_id:sourceImport.id,source_document_url:sourceImport.source_document_url,ocr_pages:(pages||[]).length,candidate_count:candidates.length,candidates:candidates.slice(0,100)});
    if (candidates.length<1) return json({ok:true,processing:false,published:false,source_import_id:sourceImport.id,reason:'OCR je kompletní, ale bezpečný JIP parser nenašel deterministicky ověřenou položku. Předchozí data zůstávají beze změny.',candidate_count:0});

    const hash=`jip-ocr-safe-v3-${sourceImport.id}`;
    const existing=await db.from('leaflet_imports').select('id,status').eq('source_hash',hash).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.status==='published') return json({ok:true,reused:true,import_id:existing.data.id,source_import_id:sourceImport.id,candidate_count:candidates.length});

    let derivedId=existing.data?.id||null;
    if (!derivedId) {
      const created=await db.from('leaflet_imports').insert({source_id:sourceImport.source_id,store_id:store.id,source_document_url:sourceImport.source_document_url,source_hash:hash,status:'queued',coverage_scope:sourceImport.coverage_scope||'national',region_code:sourceImport.region_code||null,city_name:sourceImport.city_name||null,store_location_name:sourceImport.store_location_name||null,detected_valid_from:sourceImport.detected_valid_from,detected_valid_to:sourceImport.detected_valid_to,confidence:0.98,metadata:{parser:PARSER,deterministic:true,verified_pipeline:true,source_import_id:sourceImport.id,coverage_label:'JIP potraviny – dle omezení uvedených v letáku',region:sourceImport.metadata?.region||null,ocr_engine:OCR_ENGINE}}).select('id').single();
      if (created.error) throw created.error; derivedId=created.data.id;
    }

    await db.from('leaflet_import_items').delete().eq('import_id',derivedId).neq('status','published');
    const inserted=await db.from('leaflet_import_items').insert(candidates.map((c)=>({import_id:derivedId,title:c.title,price:c.price,quantity_text:c.quantity_text,source_page:c.source_page,confidence:c.confidence,status:'approved',raw_data:c.raw_data})));
    if (inserted.error) throw inserted.error;
    const upd=await db.from('leaflet_imports').update({status:'review',product_count:candidates.length,confidence:0.97,error_message:null,finished_at:new Date().toISOString()}).eq('id',derivedId);
    if (upd.error) throw upd.error;

    const publish=await callPublisher(derivedId);
    const result=Array.isArray(publish?.results)?publish.results[0]:null;
    const published=Number(result?.published||0)+Number(result?.duplicates||0);
    if (!publish?.ok || result?.error || published<1) throw new Error(`JIP publish selhal: ${JSON.stringify(publish).slice(0,700)}`);

    if (sourceImport.source_id) await db.from('leaflet_sources').update({last_checked_at:new Date().toISOString(),last_success_at:new Date().toISOString(),last_error:null,last_strategy_used:'jip_ocr_safe_v3',last_strategy_success_at:new Date().toISOString()}).eq('id',sourceImport.source_id);
    await db.from('store_product_sync_state').upsert({store_id:store.id,last_run_at:new Date().toISOString(),last_success_at:new Date().toISOString(),last_offer_count:published,expected_offer_count:candidates.length,last_published_count:published,last_valid_from:sourceImport.detected_valid_from,last_valid_to:sourceImport.detected_valid_to,parser_version:PARSER,adapter_name:'sync-jip-ocr-products',adapter_version:'v3',source_type:'official-ocr',source_category:'current-leaflet',last_error:null,last_parser_error:null,health_status:published>=10?'ok':'degraded',health_reason:`Bezpečně publikováno ${published}/${candidates.length} OCR nabídek JIP.`,is_running:false,run_started_at:null,updated_at:new Date().toISOString(),last_import_id:derivedId},{onConflict:'store_id'});

    return json({ok:true,dry_run:false,processing:false,published:true,import_id:derivedId,source_import_id:sourceImport.id,ocr_pages:(pages||[]).length,candidate_count:candidates.length,published_count:published,publish});
  } catch (e) {
    const message=e instanceof Error?e.message:(typeof e==='object'?JSON.stringify(e):String(e));
    return json({ok:false,error:message},500);
  }
});