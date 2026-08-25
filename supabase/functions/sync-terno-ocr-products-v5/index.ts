import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const PUBLISHER_URL = `${SUPABASE_URL}/functions/v1/publish-imports`;
const PARSER = 'terno-ocr-spatial-unit-price-v5';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession:false, autoRefreshToken:false } });

const CORS = {
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'authorization,apikey,content-type,x-cron-secret',
};
const json = (body:unknown,status=200) => Response.json(body,{status,headers:CORS});

type OcrWord = { text:string; left:number; top:number; width:number; height:number; confidence:number|string|null; block?:number; paragraph?:number; line?:number };
type OcrPage = { page_number:number; avg_confidence:number|string|null; words:OcrWord[]|null };
type SpatialLine = { text:string; left:number; right:number; top:number; bottom:number; centerX:number; confidence:number; column:number };
type PrintedPrice = { value:number; text:string; delta:number; confidence:number; mode:'single_word'|'split_major_cents' };
type Candidate = { title:string; price:number; quantity_text:string; source_page:number; confidence:number; raw_data:Record<string,unknown> };

function allowed(req:Request){
  const auth=req.headers.get('authorization')||'';
  return auth===`Bearer ${SERVICE_ROLE_KEY}` || Boolean(CRON_SECRET && req.headers.get('x-cron-secret')===CRON_SECRET);
}
function clean(v:unknown){ return String(v??'').replace(/\s+/g,' ').trim(); }
function norm(v:unknown){ return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('cs'); }
function round2(n:number){ return Math.round(n*100)/100; }
function letters(s:string){ return (s.match(/[A-Za-zÁ-ž]/g)||[]).length; }
function isPromo(s:string){
  const n=norm(s);
  return /(pri koupi|kup vic|zaplat min|super (ctvrtek|patek|sobota|nedele|pondeli|utery|streda)|pouze (ve|v|dnes)|verne zakazniky|klub|karta|aplikac|kupon|cena plati pro max|na nakup\/den|od \d+\s*ks|cena od)/i.test(n);
}
function isNoise(s:string){
  const n=norm(s);
  if(letters(s)<3 || s.length<3 || s.length>100) return true;
  if(/^(super cena|cena|akce|novinka|vybrane druhy|pultovy prodej|kvalitni potraviny|z naseho regionu)$/i.test(n)) return true;
  if(/^(?:\d+(?:[,.]\d+)?\s*)?(?:g|kg|ml|l|ks)\b/i.test(n)) return true;
  if(/^1\s*(kg|l|ks)\s*=/i.test(n) || /^-?\d+\s*%/.test(n)) return true;
  return isPromo(s);
}
function parseQuantity(line:string){
  if(/\d\s*[-–]\s*\d/.test(line) || /\d+\s*[x×]\s*\d+/i.test(line)) return null;
  const m=line.match(/\b(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l)\b/i);
  if(!m) return null;
  const value=Number(m[1].replace(',','.'));
  if(!(value>0)) return null;
  const unit=m[2].toLowerCase();
  let base=value;
  let baseUnit=unit;
  if(unit==='g'){ base=value/1000; baseUnit='kg'; }
  if(unit==='ml'){ base=value/1000; baseUnit='l'; }
  if(!(base>0 && base<=20)) return null;
  return { text:clean(m[0]), base, baseUnit };
}
function parseUnitPrice(line:string,baseUnit:string){
  const raw=clean(line).replace(/\b0d\b/ig,'od');
  if(/\bod\b/i.test(norm(raw))) return null;
  const re=new RegExp(`1\\s*${baseUnit}\\s*=\\s*(\\d{1,5})(?:[,.](\\d{1,2}))?`,'i');
  const m=raw.match(re);
  if(!m) return null;
  const value=Number(m[1])+Number((m[2]||'0').padEnd(2,'0'))/100;
  return value>0 && value<100000 ? round2(value) : null;
}
function numericCandidates(value:string){
  const out=new Set<number>();
  const s=clean(value);
  for(const m of s.matchAll(/\b(\d{1,4})[,.](\d{1,2})\b/g)){
    const v=Number(m[1])+Number(m[2].padEnd(2,'0'))/100;
    if(v>=2 && v<=5000) out.add(round2(v));
  }
  for(const m of s.matchAll(/^\D*(\d{2,5})\D*$/g)){
    const raw=Number(m[1]);
    const v=raw>=1000 ? raw/100 : raw;
    if(v>=2 && v<=5000) out.add(round2(v));
  }
  return [...out];
}
function spatialLines(words:OcrWord[]){
  const valid=words.filter(w=>clean(w.text)&&Number.isFinite(Number(w.left))&&Number.isFinite(Number(w.top)));
  const maxRight=Math.max(1000,...valid.map(w=>Number(w.left)+Number(w.width||0)));
  const columnWidth=maxRight/4;
  const groups=new Map<string,OcrWord[]>();
  for(const w of valid){
    const key=`${w.block??0}|${w.paragraph??0}|${w.line??Math.round(Number(w.top)/8)}`;
    const bucket=groups.get(key)||[];
    bucket.push(w);
    groups.set(key,bucket);
  }
  return [...groups.values()].map((group):SpatialLine=>{
    group.sort((a,b)=>Number(a.left)-Number(b.left));
    const left=Math.min(...group.map(w=>Number(w.left)));
    const right=Math.max(...group.map(w=>Number(w.left)+Number(w.width||0)));
    const top=Math.min(...group.map(w=>Number(w.top)));
    const bottom=Math.max(...group.map(w=>Number(w.top)+Number(w.height||0)));
    const confidences=group.map(w=>Number(w.confidence||0)).filter(Number.isFinite);
    const centerX=(left+right)/2;
    return {
      text:clean(group.map(w=>w.text).join(' ')),left,right,top,bottom,centerX,
      confidence:confidences.length?confidences.reduce((a,b)=>a+b,0)/confidences.length:0,
      column:Math.max(0,Math.min(3,Math.floor(centerX/columnWidth))),
    };
  }).sort((a,b)=>a.top-b.top||a.left-b.left);
}
function nearestUnitPriceLine(lines:SpatialLine[],quantityLine:SpatialLine,baseUnit:string){
  return lines
    .filter(line=>line.column===quantityLine.column && line.confidence>=65 && line.top>=quantityLine.top-35 && line.top<=quantityLine.bottom+95)
    .map(line=>({line,unitPrice:parseUnitPrice(line.text,baseUnit),distance:Math.abs(line.top-quantityLine.top)}))
    .filter(x=>x.unitPrice!==null)
    .sort((a,b)=>a.distance-b.distance||b.line.confidence-a.line.confidence)[0]||null;
}
function splitPricePairs(words:OcrWord[]){
  const sorted=[...words].sort((a,b)=>Number(a.left)-Number(b.left));
  const out:Array<{value:number;text:string;confidence:number}> = [];
  for(let i=0;i<sorted.length;i++){
    const major=sorted[i];
    const majorText=clean(major.text);
    if(!/^\d{1,4}$/.test(majorText)) continue;
    const majorValue=Number(majorText);
    if(!(majorValue>=2 && majorValue<=5000)) continue;
    for(let j=i+1;j<Math.min(sorted.length,i+4);j++){
      const cents=sorted[j];
      const centsText=clean(cents.text);
      if(!/^\d{2}$/.test(centsText)) continue;
      const majorLeft=Number(major.left), majorRight=majorLeft+Number(major.width||0);
      const centsLeft=Number(cents.left), centsRight=centsLeft+Number(cents.width||0);
      const gap=centsLeft-majorRight;
      if(gap < -4 || gap > 40) continue;
      const majorTop=Number(major.top), majorBottom=majorTop+Number(major.height||0);
      const centsTop=Number(cents.top), centsBottom=centsTop+Number(cents.height||0);
      const verticalOverlap=Math.min(majorBottom,centsBottom)-Math.max(majorTop,centsTop);
      const baselineDelta=Math.abs(majorBottom-centsBottom);
      if(verticalOverlap < 0 && baselineDelta > 14) continue;
      const majorHeight=Number(major.height||0), centsHeight=Number(cents.height||0);
      if(centsHeight < majorHeight*0.35 || centsHeight > majorHeight*1.25) continue;
      const value=round2(majorValue+Number(centsText)/100);
      if(value<2 || value>5000) continue;
      out.push({value,text:`${majorText},${centsText}`,confidence:Math.min(Number(major.confidence||0),Number(cents.confidence||0))});
      break;
    }
  }
  return out;
}
function findPrintedPrice(priceWords:OcrWord[],expected:number):PrintedPrice|null{
  let printed:PrintedPrice|null=null;
  for(const word of priceWords){
    for(const value of numericCandidates(clean(word.text))){
      const delta=Math.abs(value-expected);
      if(delta<=0.06 && (!printed || delta<printed.delta)){
        printed={value,text:clean(word.text),delta,confidence:Number(word.confidence||0),mode:'single_word'};
      }
    }
  }
  for(const pair of splitPricePairs(priceWords)){
    const delta=Math.abs(pair.value-expected);
    if(delta<=0.06 && (!printed || delta<printed.delta)){
      printed={value:pair.value,text:pair.text,delta,confidence:pair.confidence,mode:'split_major_cents'};
    }
  }
  return printed;
}
function parsePage(page:OcrPage):Candidate[]{
  const pageConfidence=Number(page.avg_confidence||0);
  const words=Array.isArray(page.words)?page.words:[];
  if(pageConfidence<60 || page.page_number===1 || words.length<30) return [];
  const lines=spatialLines(words);
  const out:Candidate[]=[];
  const maxRight=Math.max(1000,...words.map(x=>Number(x.left)+Number(x.width||0)));
  const columnWidth=maxRight/4;

  for(const quantityLine of lines){
    const quantity=parseQuantity(quantityLine.text);
    if(!quantity || quantityLine.confidence<72) continue;
    const unitHit=nearestUnitPriceLine(lines,quantityLine,quantity.baseUnit);
    if(!unitHit || unitHit.unitPrice===null) continue;
    const unitPrice=unitHit.unitPrice;
    const expected=round2(unitPrice*quantity.base);
    if(!(expected>=2 && expected<=5000)) continue;

    const local=lines.filter(line=>line.column===quantityLine.column && line.top>=quantityLine.top-320 && line.top<=quantityLine.bottom+95);
    if(local.some(line=>isPromo(line.text))) continue;

    const priceWords=words.filter(w=>{
      const centerX=Number(w.left)+Number(w.width||0)/2;
      const wordColumn=Math.max(0,Math.min(3,Math.floor(centerX/columnWidth)));
      return wordColumn===quantityLine.column
        && Number(w.top)>=quantityLine.top-300
        && Number(w.top)<=quantityLine.top-20
        && Number(w.height||0)>=18
        && Number(w.confidence||0)>=55;
    });
    const printed=findPrintedPrice(priceWords,expected);
    if(!printed) continue;

    const titleLines=lines.filter(line=>line.column===quantityLine.column && line.bottom<=quantityLine.top+2 && line.top>=quantityLine.top-90 && line.confidence>=72 && !isNoise(line.text)).slice(-2);
    const title=clean(titleLines.map(line=>line.text).join(' '));
    if(title.length<4 || title.length>110 || letters(title)<5 || isPromo(title)) continue;

    const confidence=Math.min(0.99,round2(0.94+Math.min(quantityLine.confidence,unitHit.line.confidence,printed.confidence,pageConfidence)/2000));
    out.push({
      title,price:printed.value,quantity_text:quantity.text,source_page:page.page_number,confidence,
      raw_data:{
        parser:PARSER,unit_price:unitPrice,unit_price_line:unitHit.line.text,
        unit_price_distance:round2(unitHit.distance),expected_price:expected,
        printed_price_word:printed.text,printed_price_mode:printed.mode,
        price_delta:round2(printed.delta),quantity_coordinates:{left:quantityLine.left,top:quantityLine.top,right:quantityLine.right,bottom:quantityLine.bottom},
        ocr_page_confidence:pageConfidence,coverage_label:'Vybrané prodejny Terno',deterministic_price_check:true,
      },
    });
  }
  return out;
}
async function callPublisher(importId:string){
  const res=await fetch(PUBLISHER_URL,{
    method:'POST',
    headers:{authorization:`Bearer ${SERVICE_ROLE_KEY}`,apikey:SERVICE_ROLE_KEY,'content-type':'application/json',...(CRON_SECRET?{'x-cron-secret':CRON_SECRET}:{})},
    body:JSON.stringify({import_id:importId}),
  });
  const text=await res.text();
  let payload:any=null;
  try{ payload=text?JSON.parse(text):{}; }catch{ payload={raw:text}; }
  if(!res.ok) throw new Error(`publish-imports HTTP ${res.status}: ${text.slice(0,500)}`);
  return payload;
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:CORS});
  if(req.method!=='POST') return json({error:'Method not allowed'},405);
  if(!allowed(req)) return json({error:'Unauthorized'},401);
  try{
    const body=await req.json().catch(()=>({}));
    const dryRun=body.dry_run!==false;
    const {data:store,error:storeError}=await db.from('stores').select('id,name').eq('slug','terno').maybeSingle();
    if(storeError) throw storeError;
    if(!store) throw new Error('Terno store not found.');

    let sourceImport:any=null;
    if(body.import_id){
      const q=await db.from('leaflet_imports').select('*').eq('id',String(body.import_id)).eq('store_id',store.id).maybeSingle();
      if(q.error) throw q.error;
      sourceImport=q.data;
    }else{
      const q=await db.from('leaflet_imports').select('*').eq('store_id',store.id).not('metadata->>ocr_complete','is',null).order('created_at',{ascending:false}).limit(20);
      if(q.error) throw q.error;
      sourceImport=(q.data||[]).find((x:any)=>x?.metadata?.ocr_complete===true && Array.isArray(x?.metadata?.page_image_urls) && x.metadata.page_image_urls.length>=2)||null;
    }
    if(!sourceImport) throw new Error('Aktuální Terno import s dokončeným OCR nebyl nalezen.');

    const {data:pages,error:pagesError}=await db.from('leaflet_ocr_pages').select('page_number,avg_confidence,words').eq('import_id',sourceImport.id).order('page_number',{ascending:true});
    if(pagesError) throw pagesError;
    const rawCandidates=(pages||[]).flatMap((p:any)=>parsePage(p));
    const seen=new Set<string>();
    const candidates=rawCandidates.filter((c)=>{ const key=`${norm(c.title)}|${c.price}|${c.quantity_text}`; if(seen.has(key)) return false; seen.add(key); return true; });

    if(dryRun) return json({ok:true,dry_run:true,parser:PARSER,source_import_id:sourceImport.id,source_document_url:sourceImport.source_document_url,candidate_count:candidates.length,candidates:candidates.slice(0,80)});
    if(candidates.length<1) throw new Error('Bezpečný Terno parser v5 nenašel žádnou deterministicky ověřenou položku; publikace zastavena.');

    const hash=`terno-ocr-safe-v5-${sourceImport.id}`;
    const existing=await db.from('leaflet_imports').select('id,status').eq('source_hash',hash).maybeSingle();
    if(existing.error) throw existing.error;
    if(existing.data?.status==='published') return json({ok:true,reused:true,parser:PARSER,import_id:existing.data.id,candidate_count:candidates.length});

    let derivedId=existing.data?.id||null;
    if(!derivedId){
      const created=await db.from('leaflet_imports').insert({
        source_id:sourceImport.source_id,store_id:store.id,source_document_url:sourceImport.source_document_url,source_hash:hash,status:'queued',
        coverage_scope:sourceImport.coverage_scope||'city',region_code:sourceImport.region_code||null,city_name:sourceImport.city_name||null,
        store_location_name:sourceImport.store_location_name||null,detected_valid_from:sourceImport.detected_valid_from,detected_valid_to:sourceImport.detected_valid_to,
        confidence:0.98,
        metadata:{parser:PARSER,deterministic:true,verified_pipeline:true,source_import_id:sourceImport.id,coverage_label:'Vybrané prodejny Terno',region:sourceImport.metadata?.region||null,split_price_support:true},
      }).select('id').single();
      if(created.error) throw created.error;
      derivedId=created.data.id;
    }

    await db.from('leaflet_import_items').delete().eq('import_id',derivedId).neq('status','published');
    const inserted=await db.from('leaflet_import_items').insert(candidates.map(c=>({import_id:derivedId,title:c.title,price:c.price,quantity_text:c.quantity_text,source_page:c.source_page,confidence:c.confidence,status:'approved',raw_data:c.raw_data})));
    if(inserted.error) throw inserted.error;
    const upd=await db.from('leaflet_imports').update({status:'review',product_count:candidates.length,confidence:0.97,error_message:null,finished_at:new Date().toISOString()}).eq('id',derivedId);
    if(upd.error) throw upd.error;

    const publish=await callPublisher(derivedId);
    const result=Array.isArray(publish?.results)?publish.results[0]:null;
    const published=Number(result?.published||0)+Number(result?.duplicates||0);
    if(!publish?.ok || result?.error || published<1) throw new Error(`Terno publish selhal: ${JSON.stringify(publish).slice(0,700)}`);

    if(sourceImport.source_id) await db.from('leaflet_sources').update({last_checked_at:new Date().toISOString(),last_success_at:new Date().toISOString(),last_error:null}).eq('id',sourceImport.source_id);
    return json({ok:true,dry_run:false,parser:PARSER,import_id:derivedId,source_import_id:sourceImport.id,candidate_count:candidates.length,publish});
  }catch(e){
    const message=e instanceof Error?e.message:(typeof e==='object'?JSON.stringify(e):String(e));
    return json({ok:false,error:message},500);
  }
});
