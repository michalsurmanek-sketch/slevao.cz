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

function allowed(req:Request){
  return req.headers.get('authorization')===`Bearer ${KEY}`||Boolean(CRON&&req.headers.get('x-cron-secret')===CRON);
}
function clean(v:unknown){return String(v??'').replace(/\s+/g,' ').trim()}
function norm(v:unknown){return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('cs')}
function number(v:string){return Number(v.replace(',','.'))}
function cx(t:Token){return t.x+t.width/2}
function promo(s:string){
  return /(při koupi|kupte|kupon|aplikac|karta|věrnost|super (čtvrtek|pátek|sobota|neděle)|pouze|od \d+\s*ks|cena od|od pátku|záloha)/i.test(norm(s));
}
function badTitle(s:string){
  const n=norm(s);
  const words=s.split(/\s+/);
  return s.length<4||s.length>80||!/^[A-ZÁ-Ž]/.test(s)||promo(s)||
    /(různé druhy|najdete|boxu|super cena|levnější|cena od)/i.test(n)||
    /^(plech|pivo|bílý|vícezrnný|grigio|knedlíkem|pinot)$/i.test(n)||
    (words.length===1&&s.length<9);
}
function parsePage(page:Page):Candidate[]{
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
    const titles=dedup.filter(t=>t.y>q.y&&t.y-q.y<=38&&t.y-q.y>=1&&Math.abs(cx(t)-cx(q))<45&&!/^\d/.test(t.text)&&/[A-Za-zÁ-ž]/.test(t.text))
      .sort((a,b)=>Math.abs(q.y-a.y)-Math.abs(q.y-b.y));
    const title=clean(titles[0]?.text);
    if(badTitle(title))continue;
    out.push({title,price:p.value,quantity_text:`${m[1]} ${m[2]}`,source_page:page.page,confidence:0.98,raw_data:{
      parser:'norma-pdf-spatial-unit-price-v2',unit_price:unitPrice,unit_price_basis:m[3],expected_price:expected,
      printed_price:p.t.text,price_delta:Math.round(Math.abs(p.value-expected)*100)/100,quantity_token:q.text,
      price_coordinates:{x:p.t.x,y:p.t.y},quantity_coordinates:{x:q.x,y:q.y},deterministic:true
    }});
  }
  return out;
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
    const raw=(Array.isArray(ext.pages)?ext.pages:[]).flatMap((p:Page)=>parsePage(p));
    const seen=new Set<string>();
    const candidates=raw.filter(c=>{const k=`${norm(c.title)}|${c.price}|${c.quantity_text}`;if(seen.has(k))return false;seen.add(k);return true});
    if(body.dry_run!==false)return json({ok:true,dry_run:true,import_id:ext.import_id,parser:'norma-pdf-spatial-unit-price-v2',candidate_count:candidates.length,candidates});
    if(!candidates.length)throw new Error('No deterministically verified Norma products; publication stopped');
    const {data:src,error:ie}=await db.from('leaflet_imports').select('*').eq('id',ext.import_id).single();if(ie)throw ie;
    const hash=`norma-spatial-safe-v2-${src.id}`;
    const {data:old,error:oe}=await db.from('leaflet_imports').select('id,status').eq('source_hash',hash).maybeSingle();if(oe)throw oe;
    if(old?.status==='published')return json({ok:true,reused:true,import_id:old.id,candidate_count:candidates.length});
    let id=old?.id;
    if(!id){
      const {data,error}=await db.from('leaflet_imports').insert({source_id:src.source_id,store_id:src.store_id,source_document_url:src.source_document_url,
        source_hash:hash,status:'queued',coverage_scope:src.coverage_scope,region_code:src.region_code,city_name:src.city_name,
        detected_valid_from:src.detected_valid_from,detected_valid_to:src.detected_valid_to,confidence:0.98,
        metadata:{parser:'norma-pdf-spatial-unit-price-v2',deterministic:true,verified_pipeline:true,source_import_id:src.id}}).select('id').single();
      if(error)throw error;id=data.id;
    }
    await db.from('leaflet_import_items').delete().eq('import_id',id).neq('status','published');
    const {error:ci}=await db.from('leaflet_import_items').insert(candidates.map(c=>({import_id:id,title:c.title,price:c.price,quantity_text:c.quantity_text,
      source_page:c.source_page,confidence:c.confidence,status:'approved',raw_data:c.raw_data})));if(ci)throw ci;
    const {error:ui}=await db.from('leaflet_imports').update({status:'review',product_count:candidates.length,confidence:0.98,error_message:null,finished_at:new Date().toISOString()}).eq('id',id);if(ui)throw ui;
    const result=await publish(id);
    return json({ok:true,dry_run:false,import_id:id,source_import_id:src.id,candidate_count:candidates.length,publish:result});
  }catch(e){return json({ok:false,error:e instanceof Error?e.message:String(e)},500)}
});
