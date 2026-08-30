import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL=Deno.env.get('SUPABASE_URL')!;
const KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON=Deno.env.get('CRON_SECRET')||'';
const db=createClient(URL,KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-cron-secret'};
const json=(body:unknown,status=200)=>Response.json(body,{status,headers});
type Token={text:string;x:number;y:number;width:number;height:number};
type Page={page:number;tokens:Token[]};
type Candidate={title:string;price:number;quantity_text:string;source_page:number;confidence:number;raw_data:Record<string,unknown>};
type ExistingImport={id:string;status:string;product_count:number|null;source_document_url:string|null;detected_valid_from:string|null;detected_valid_to:string|null;source_hash:string;metadata:Record<string,unknown>|null};

function allowed(req:Request){
  return req.headers.get('authorization')===`Bearer ${KEY}`||Boolean(CRON&&req.headers.get('x-cron-secret')===CRON);
}
function clean(v:unknown){return String(v??'').replace(/\s+/g,' ').trim()}
function norm(v:unknown){return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('cs')}
function number(v:string){return Number(v.replace(',','.'))}
function cx(t:Token){return t.x+t.width/2}
function promo(s:string){
  return /(pri koupi|kupte|kupon|aplikac|karta|vernost|super (ctvrtek|patek|sobota|nedele)|pouze|od \d+\s*ks|cena od|od patku|zaloha)/i.test(norm(s));
}
function badTitle(s:string){
  const n=norm(s);
  const words=s.split(/\s+/);
  return s.length<4||s.length>100||!/^[A-ZÁ-Ž]/.test(s)||promo(s)||
    /(ruzne druhy|najdete|boxu|super cena|levnejsi|cena od)/i.test(n)||
    /^(plech|pivo|bily|vicezrnny|grigio|knedlikem|pinot)$/i.test(n)||
    /^(?:mramorove\s*\/\s*tradicni|kremzska\s*\/\s*plnotucna)$/i.test(n)||
    (words.length===1&&s.length<9);
}
function multilineNoise(s:string){
  const n=norm(s);
  return promo(s)||/^(?:najdete|boxu|v chladicim|pack|ruzne druhy)$/i.test(n)||/super cena|levnejsi|cena od/i.test(n)||/^[+\-]?\s*\d+\s*[º°o]?\s*c$/i.test(clean(s));
}
function mergeTitleLines(lines:Token[]){
  const reversed=[...lines].sort((a,b)=>b.y-a.y).map(x=>clean(x.text)).filter(Boolean);
  let parts:string[]=[];
  for(const line of reversed){
    const n=norm(line);
    if(!n||multilineNoise(line))continue;
    const combined=norm(parts.join(' '));
    if(parts.some(p=>norm(p)===n))continue;
    if(combined&&(combined.endsWith(' '+n)||combined.startsWith(n+' ')))continue;
    if(combined&&(n.endsWith(' '+combined)||n.startsWith(combined+' '))){parts=[line];continue;}
    if(combined&&n.startsWith(combined+' ')){parts=[line];continue;}
    if(combined&&combined.startsWith(n+' '))continue;
    parts.push(line);
  }
  return clean(parts.join(' '));
}
function parsePage(page:Page,multilineTitles=false):Candidate[]{
  const tokens=(page.tokens||[]).map(t=>({text:clean(t.text),x:Number(t.x),y:Number(t.y),width:Number(t.width),height:Number(t.height)}))
    .filter(t=>t.text&&[t.x,t.y,t.width,t.height].every(Number.isFinite));
  const dedup=[...new Map(tokens.map(t=>[`${t.text}|${t.x}|${t.y}|${t.width}|${t.height}`,t])).values()];
  const out:Candidate[]=[];
  const quantity=/\b(\d+(?:[,.]\d+)?)\s*(g|kg|ml|l)\s*\((100\s*g|1\s*kg|100\s*ml|1\s*l)\s+(\d+(?:[,.]\d+)?)\)/i;
  for(const q of dedup){
    const m=q.text.match(quantity);
    if(!m||promo(q.text))continue;
    const amount=number(m[1]),unit=m[2].toLowerCase(),basis=norm(m[3]),unitPrice=number(m[4]);
    const amountBase=unit==='g'||unit==='ml'?amount/1000:amount;
    const basisBase=basis.startsWith('100')?0.1:1;
    const expected=Math.round(unitPrice*(amountBase/basisBase)*100)/100;
    if(!(expected>=2&&expected<=5000))continue;
    const prices=dedup.filter(t=>/^\d{1,4},\d{2}$/.test(t.text)&&t.height>=25&&t.y<q.y&&q.y-t.y>=20&&q.y-t.y<=220&&Math.abs(cx(t)-cx(q))<=45)
      .map(t=>({t,value:number(t.text)})).filter(p=>Math.abs(p.value-expected)<=0.11).sort((a,b)=>Math.abs(a.value-expected)-Math.abs(b.value-expected));
    if(!prices.length)continue;
    const p=prices[0];
    const local=dedup.filter(t=>Math.abs(cx(t)-cx(q))<=65&&t.y>=p.t.y-80&&t.y<=q.y+25).map(t=>t.text).join(' ');
    if(promo(local))continue;
    const titleLines=dedup.filter(t=>t.y>q.y&&t.y-q.y<=38&&t.y-q.y>=1&&Math.abs(cx(t)-cx(q))<45&&!/^\d/.test(t.text)&&/[A-Za-zÁ-ž]/.test(t.text));
    const nearest=[...titleLines].sort((a,b)=>Math.abs(q.y-a.y)-Math.abs(q.y-b.y));
    const multiline=titleLines.filter(t=>t.height>=8&&!multilineNoise(t.text)).slice(0,6);
    const title=multilineTitles?mergeTitleLines(multiline):clean(nearest[0]?.text);
    if(multilineTitles&&title&&!/^\p{Lu}/u.test(title))continue;
    if(badTitle(title))continue;
    out.push({title,price:p.value,quantity_text:`${m[1]} ${m[2]}`,source_page:page.page,confidence:0.98,raw_data:{
      parser:'norma-pdf-spatial-unit-price-v2',title_parser:multilineTitles?'norma-title-multiline-v2':undefined,unit_price:unitPrice,unit_price_basis:m[3],expected_price:expected,
      printed_price:p.t.text,price_delta:Math.round(Math.abs(p.value-expected)*100)/100,quantity_token:q.text,
      price_coordinates:{x:p.t.x,y:p.t.y},quantity_coordinates:{x:q.x,y:q.y},deterministic:true
    }});
  }
  return out;
}
function canonicalRaw(raw:any){
  return {
    parser:clean(raw?.parser),
    ...(clean(raw?.title_parser)?{title_parser:clean(raw?.title_parser)}:{}),
    unit_price:Number(raw?.unit_price),
    unit_price_basis:clean(raw?.unit_price_basis),
    expected_price:Number(raw?.expected_price),
    printed_price:clean(raw?.printed_price),
    price_delta:Number(raw?.price_delta),
    quantity_token:clean(raw?.quantity_token),
    price_coordinates:{x:Number(raw?.price_coordinates?.x),y:Number(raw?.price_coordinates?.y)},
    quantity_coordinates:{x:Number(raw?.quantity_coordinates?.x),y:Number(raw?.quantity_coordinates?.y)},
    deterministic:raw?.deterministic===true,
  };
}
function parserRow(c:Candidate){
  return {title:clean(c.title),price:Number(c.price),quantity_text:clean(c.quantity_text),source_page:Number(c.source_page),confidence:Number(c.confidence),raw_data:canonicalRaw(c.raw_data)};
}
function storedBaseTitle(item:any){
  const title=clean(item?.title),quantity=clean(item?.quantity_text),suffix=quantity?` · ${quantity}`:'';
  return suffix&&title.endsWith(suffix)?title.slice(0,-suffix.length).trim():title;
}
function storedRow(item:any){
  return {title:storedBaseTitle(item),price:Number(item.price),quantity_text:clean(item.quantity_text),source_page:Number(item.source_page),confidence:Number(item.confidence),raw_data:canonicalRaw(item.raw_data)};
}
function stableSort<T>(rows:T[]):T[]{
  return [...rows].sort((a,b)=>{const left=JSON.stringify(a),right=JSON.stringify(b);return left<right?-1:left>right?1:0});
}
function sameStoredPayload(items:any[],candidates:Candidate[]){
  if(items.length!==candidates.length)return false;
  return JSON.stringify(stableSort(items.map(storedRow)))===JSON.stringify(stableSort(candidates.map(parserRow)));
}
async function sha256Hex(value:unknown){
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function payloadHash(candidates:Candidate[],src:any){
  return await sha256Hex({
    payload_contract:'norma-spatial-safe-v3',
    parser_contract:'norma-pdf-spatial-unit-price-v2',
    source_import_id:String(src.id),
    source_document_url:String(src.source_document_url||''),
    valid_from:String(src.detected_valid_from||''),
    valid_to:String(src.detected_valid_to||''),
    coverage_scope:String(src.coverage_scope||''),
    region_code:String(src.region_code||''),
    city_name:String(src.city_name||''),
    rows:stableSort(candidates.map(parserRow)),
  });
}
async function storedImportMatches(row:ExistingImport,candidates:Candidate[],src:any){
  if(row.status!=='published')return false;
  if(Number(row.product_count||0)!==candidates.length)return false;
  if(String(row.source_document_url||'')!==String(src.source_document_url||''))return false;
  if(String(row.detected_valid_from||'')!==String(src.detected_valid_from||''))return false;
  if(String(row.detected_valid_to||'')!==String(src.detected_valid_to||''))return false;
  const {data:items,error}=await db.from('leaflet_import_items').select('title,price,quantity_text,source_page,confidence,raw_data,status').eq('import_id',row.id);
  if(error)throw error;
  if((items||[]).some((item:any)=>item.status!=='published'))return false;
  return sameStoredPayload(items||[],candidates);
}
async function extraction(importId?:string){
  const {data:store,error:se}=await db.from('stores').select('id').eq('slug','norma').maybeSingle();
  if(se)throw se;if(!store)throw new Error('Norma store not found');
  let ids:string[]=[];
  if(importId)ids=[importId];else{
    const today=new Date().toISOString().slice(0,10);
    const {data,error}=await db.from('leaflet_imports').select('id,detected_valid_from,detected_valid_to').eq('store_id',store.id)
      .gte('detected_valid_to',today).order('detected_valid_from',{ascending:true}).limit(20);
    if(error)throw error;ids=(data||[]).map(x=>x.id);
  }
  for(const id of ids){
    const {data,error}=await db.from('leaflet_extracted_text').select('*').eq('import_id',id).eq('parser','pdf-text-v3').maybeSingle();
    if(error)throw error;if(data)return data;
  }
  throw new Error('No current Norma pdf-text-v3 extraction found');
}
async function publish(importId:string){
  const r=await fetch(`${URL}/functions/v1/publish-imports`,{method:'POST',headers:{authorization:`Bearer ${KEY}`,apikey:KEY,'content-type':'application/json',...(CRON?{'x-cron-secret':CRON}:{})},body:JSON.stringify({import_id:importId})});
  const text=await r.text();if(!r.ok)throw new Error(`publish-imports HTTP ${r.status}: ${text.slice(0,400)}`);
  return JSON.parse(text);
}
Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  if(!allowed(req))return json({error:'Unauthorized'},401);
  try{
    const body=await req.json().catch(()=>({}));
    const ext=await extraction(body.import_id?String(body.import_id):undefined);
    const {data:src,error:ie}=await db.from('leaflet_imports').select('*').eq('id',ext.import_id).single();if(ie)throw ie;
    const issue=String(src.source_document_url||'').match(/\/(\d{4})-(\d{2})_CZ\.pdf(?:\?|$)/i);
    const multilineTitles=Boolean(issue&&Number(issue[2])>=37);

    if(!multilineTitles&&body.dry_run===false){
      const {data:frozen,error:fe}=await db.from('leaflet_imports').select('id,status,product_count,metadata')
        .eq('store_id',src.store_id).eq('source_document_url',src.source_document_url).eq('status','published')
        .eq('metadata->>source_import_id',String(src.id)).order('product_count',{ascending:false}).limit(1).maybeSingle();
      if(fe)throw fe;
      if(frozen)return json({ok:true,reused:true,legacy_frozen:true,source_import_id:src.id,import_id:frozen.id,product_count:frozen.product_count,title_parser:'legacy-single-line'});
    }

    const raw=(Array.isArray(ext.pages)?ext.pages:[]).flatMap((p:Page)=>parsePage(p,multilineTitles));
    const seen=new Set<string>();
    const candidates=raw.filter(c=>{const k=`${norm(c.title)}|${c.price}|${c.quantity_text}`;if(seen.has(k))return false;seen.add(k);return true});
    const fullPayloadSha256=await payloadHash(candidates,src);
    const hash=`norma-spatial-safe-v3-${fullPayloadSha256}`;
    if(body.dry_run!==false)return json({ok:true,dry_run:true,import_id:ext.import_id,parser:'norma-pdf-spatial-unit-price-v2',title_parser:multilineTitles?'norma-title-multiline-v2':'legacy-single-line',payload_contract:'norma-spatial-safe-v3',candidate_count:candidates.length,full_payload_sha256:fullPayloadSha256,candidates});
    if(!candidates.length)throw new Error('No deterministically verified Norma products; publication stopped');

    const selectExisting='id,status,product_count,source_document_url,detected_valid_from,detected_valid_to,source_hash,metadata';
    const {data:current,error:ce}=await db.from('leaflet_imports').select(selectExisting).eq('source_hash',hash).maybeSingle();if(ce)throw ce;
    if(current?.status==='published'){
      if(!await storedImportMatches(current as ExistingImport,candidates,src))throw new Error('NORMA v3 payload hash odpovídá importu, ale publikované položky se liší; reuse zastaven');
      return json({ok:true,reused:true,import_id:current.id,candidate_count:candidates.length,payload_contract:'norma-spatial-safe-v3',full_payload_sha256:fullPayloadSha256});
    }

    const legacyHash=`norma-spatial-safe-v2-${src.id}`;
    const {data:legacy,error:le}=await db.from('leaflet_imports').select(selectExisting).eq('source_hash',legacyHash).maybeSingle();if(le)throw le;
    if(legacy?.status==='published'&&await storedImportMatches(legacy as ExistingImport,candidates,src)){
      const alreadyVerified=legacy.metadata?.full_payload_hash_version==='norma-spatial-safe-v3'&&legacy.metadata?.full_payload_sha256===fullPayloadSha256;
      if(!alreadyVerified){
        const metadata={...(legacy.metadata||{}),full_payload_hash_version:'norma-spatial-safe-v3',full_payload_sha256:fullPayloadSha256,legacy_source_hash:legacyHash,verified_at:new Date().toISOString()};
        const {error:mu}=await db.from('leaflet_imports').update({metadata}).eq('id',legacy.id);if(mu)throw mu;
      }
      return json({ok:true,reused:true,migrated_legacy_hash:!alreadyVerified,legacy_source_hash_retained:true,import_id:legacy.id,candidate_count:candidates.length,payload_contract:'norma-spatial-safe-v3',full_payload_sha256:fullPayloadSha256});
    }

    let id=current?.id;
    if(!id){
      const {data,error}=await db.from('leaflet_imports').insert({source_id:src.source_id,store_id:src.store_id,source_document_url:src.source_document_url,
        source_hash:hash,status:'queued',coverage_scope:src.coverage_scope,region_code:src.region_code,city_name:src.city_name,
        detected_valid_from:src.detected_valid_from,detected_valid_to:src.detected_valid_to,confidence:0.98,
        metadata:{parser:'norma-pdf-spatial-unit-price-v2',title_parser:multilineTitles?'norma-title-multiline-v2':'legacy-single-line',deterministic:true,verified_pipeline:true,source_import_id:src.id,full_payload_hash_version:'norma-spatial-safe-v3',full_payload_sha256:fullPayloadSha256}}).select('id').single();
      if(error)throw error;id=data.id;
    }
    await db.from('leaflet_import_items').delete().eq('import_id',id).neq('status','published');
    const {error:ci}=await db.from('leaflet_import_items').insert(candidates.map(c=>({import_id:id,title:c.title,price:c.price,quantity_text:c.quantity_text,
      source_page:c.source_page,confidence:c.confidence,status:'approved',raw_data:c.raw_data})));if(ci)throw ci;
    const {error:ui}=await db.from('leaflet_imports').update({status:'review',product_count:candidates.length,confidence:0.98,error_message:null,finished_at:new Date().toISOString()}).eq('id',id);if(ui)throw ui;
    const result=await publish(id);
    return json({ok:true,dry_run:false,import_id:id,source_import_id:src.id,candidate_count:candidates.length,title_parser:multilineTitles?'norma-title-multiline-v2':'legacy-single-line',payload_contract:'norma-spatial-safe-v3',full_payload_sha256:fullPayloadSha256,publish:result});
  }catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},500)}
});
