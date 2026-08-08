import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = { 'access-control-allow-origin':'*', 'access-control-allow-headers':'authorization, apikey, content-type, x-cron-secret' };
const json = (body:unknown,status=200)=>Response.json(body,{status,headers:CORS});

type Token={text:string;x:number;y:number;width:number;height:number};
type Page={page:number;tokens:Token[]};
type Anchor={x:number;y:number};
type Candidate={title:string;price:number;quantity_text:string;source_page:number;confidence:number;raw_data:Record<string,unknown>};

function allowed(req:Request){
  const auth=req.headers.get('authorization')||'';
  return auth===`Bearer ${SERVICE_ROLE_KEY}` || Boolean(CRON_SECRET && req.headers.get('x-cron-secret')===CRON_SECRET);
}
function clean(v:unknown){return String(v??'').replace(/\s+/g,' ').trim();}
function norm(v:unknown){return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('cs');}
function n(v:string){const x=Number(v.replace(/\s/g,'').replace(',','.'));return Number.isFinite(x)?x:null;}
function round2(v:number){return Math.round(v*100)/100;}
function cx(t:Token){return t.x+Math.max(0,t.width)/2;}
function decimalPrice(t:Token){return /^\d{1,4}[,.]\d{2}$/.test(clean(t.text));}
function groupLines(tokens:Token[]){
  const groups:{y:number;tokens:Token[]}[]=[];
  for(const t of [...tokens].sort((a,b)=>b.y-a.y||a.x-b.x)){
    let g=groups.find(g=>Math.abs(g.y-t.y)<=2.5);
    if(!g){g={y:t.y,tokens:[]};groups.push(g);}
    g.tokens.push(t);g.y=Math.max(g.y,t.y);
  }
  return groups.sort((a,b)=>b.y-a.y).map(g=>({y:g.y,text:clean(g.tokens.sort((a,b)=>a.x-b.x).map(t=>t.text).join(' '))}));
}
function anchors(tokens:Token[]):Anchor[]{
  const nase=tokens.filter(t=>norm(t.text)==='nase');
  const cena=tokens.filter(t=>norm(t.text)==='cena');
  const out:Anchor[]=[];
  for(const a of nase){
    const b=cena.find(c=>Math.abs(c.x-a.x)<=8 && c.y<a.y && a.y-c.y>=5 && a.y-c.y<=18);
    if(b) out.push({x:(a.x+b.x)/2,y:Math.max(a.y,b.y)});
  }
  return out.filter((a,i,arr)=>!arr.slice(0,i).some(b=>Math.abs(a.x-b.x)<7&&Math.abs(a.y-b.y)<8));
}
function bandFor(all:Anchor[],a:Anchor,pageWidth:number){
  const row=all.filter(x=>Math.abs(x.y-a.y)<=22).sort((x,y)=>x.x-y.x);
  const i=row.indexOf(a);
  const prev=i>0?row[i-1]:null,next=i>=0&&i<row.length-1?row[i+1]:null;
  return {left:prev?(prev.x+a.x)/2:Math.max(0,a.x-80),right:next?(a.x+next.x)/2:Math.min(pageWidth,a.x+105)};
}
function findMainPrice(tokens:Token[],a:Anchor,band:{left:number;right:number}){
  const choices=tokens.filter(t=>decimalPrice(t)&&t.height>=14&&t.y<a.y-4&&t.y>=a.y-85&&cx(t)>=band.left&&cx(t)<=band.right)
    .map(t=>({t,price:n(t.text)!}))
    .filter(x=>x.price>=2&&x.price<=5000)
    .sort((u,v)=>Math.abs(cx(u.t)-a.x)-Math.abs(cx(v.t)-a.x)||v.t.height-u.t.height||v.t.y-u.t.y);
  return choices[0]||null;
}
function badContext(text:string){
  const s=norm(text);
  return /\b(s klubem|bez klubu|klubova|billa bonus|pri koupi|od 2 ks|od 3 ks|kombo|super patek|pouze|nalepky|streda a ctvrtek|od 6\. 8\.|do 9\. 8\.)\b/.test(s);
}
function quantity(lines:{y:number;text:string}[]){
  for(const l of lines){
    const m=l.text.match(/\b(\d+(?:[,.]\d+)?)\s*(kg|g|l|ml|ks)\b/i);
    if(!m) continue;
    const value=n(m[1]); if(!value||value<=0) continue;
    const unit=m[2].toLowerCase();
    const base=unit==='g'||unit==='ml'?value/1000:value;
    return {text:`${m[1]} ${m[2]}`,value,unit,base};
  }
  return null;
}
function explicitSaleUnit(lines:{y:number;text:string}[]){
  for(const l of lines){
    const m=l.text.match(/cena\s+za\s+(1\s*kg|100\s*g|1\s*l|1\s*ks)/i);
    if(m) return clean(m[1]);
  }
  return null;
}
function printedUnitPrices(lines:{y:number;text:string}[]){
  const out:{basis:string;value:number}[]=[];
  for(const l of lines){
    if(/s Klubem|bez Klubu/i.test(l.text)) continue;
    const m=l.text.match(/\b(1\s*kg|100\s*g|1\s*l|100\s*ml|1\s*ks)\s*=\s*(\d{1,5}(?:[,.]\d{1,2})?)\s*Kč/i);
    if(m){const value=n(m[2]);if(value&&value>0)out.push({basis:clean(m[1]).toLowerCase(),value});}
  }
  return out;
}
function expectedFromUnit(q:{value:number;unit:string;base:number},u:{basis:string;value:number}){
  if(u.basis==='1 kg'&&q.unit==='g')return u.value*(q.value/1000);
  if(u.basis==='1 kg'&&q.unit==='kg')return u.value*q.value;
  if(u.basis==='100 g'&&q.unit==='g')return u.value*(q.value/100);
  if(u.basis==='1 l'&&q.unit==='ml')return u.value*(q.value/1000);
  if(u.basis==='1 l'&&q.unit==='l')return u.value*q.value;
  if(u.basis==='100 ml'&&q.unit==='ml')return u.value*(q.value/100);
  if(u.basis==='1 ks'&&q.unit==='ks')return u.value*q.value;
  return null;
}
function isNoise(line:string){
  const s=norm(line);
  return !/[a-zá-ž]/i.test(line)
    || /^(nase|cena|nase cena|bezna cena|vice druhu|vybrane druhy|2 druhy|3 druhy|100% ceske maso)$/i.test(s)
    || /^\d+(?:[,.]\d+)?\s*(kg|g|l|ml|ks)\b/i.test(s)
    || /^(1\s*(kg|l|ks)|100\s*(g|ml))\s*=/i.test(s)
    || /^cena\s+za\s+/i.test(s)
    || /^-?\d+\s*%/.test(s)
    || badContext(line);
}
function buildTitle(lines:{y:number;text:string}[],quantityY:number|null){
  const source=quantityY==null?lines:lines.filter(l=>l.y>quantityY-1);
  const usable=source.filter(l=>!isNoise(l.text)&&!/[0-9]{1,4}[,.][0-9]{2}\/?/.test(l.text));
  if(!usable.length)return null;
  const near=[...usable].sort((a,b)=>a.y-b.y).slice(0,3).sort((a,b)=>b.y-a.y);
  let title=clean(near.map(l=>l.text).join(' '));
  title=title.replace(/\s*\|\s*$/,'').trim();
  if(title.length<3||title.length>110)return null;
  return title;
}
function parsePage(page:Page):Candidate[]{
  const tokens=(page.tokens||[]).map(t=>({text:clean(t.text),x:Number(t.x),y:Number(t.y),width:Number(t.width),height:Number(t.height)})).filter(t=>t.text&&Number.isFinite(t.x)&&Number.isFinite(t.y));
  const as=anchors(tokens),pageWidth=Math.max(595,...tokens.map(t=>t.x+t.width));
  const out:Candidate[]=[];
  for(const a of as){
    const band=bandFor(as,a,pageWidth),p=findMainPrice(tokens,a,band); if(!p)continue;
    const contextTokens=tokens.filter(t=>cx(t)>=band.left&&cx(t)<=band.right&&t.y>a.y+3&&t.y<=a.y+125);
    const lines=groupLines(contextTokens);
    const contextText=lines.map(l=>l.text).join(' | '); if(badContext(contextText))continue;
    const q=quantity(lines),saleUnit=explicitSaleUnit(lines),units=printedUnitPrices(lines);
    let verifiedBy:string|null=null,matchedUnit:number|null=null,expected:number|null=null;
    if(saleUnit){
      if(saleUnit.toLowerCase()==='1 kg'||saleUnit.toLowerCase()==='1 l'||saleUnit.toLowerCase()==='1 ks'){
        verifiedBy=`explicit:${saleUnit}`; expected=p.price;
      }else if(saleUnit.toLowerCase()==='100 g'){
        verifiedBy='explicit:100 g'; expected=p.price;
      }
    }
    if(!verifiedBy&&q){
      for(const u of units){
        const e=expectedFromUnit(q,u); if(e==null)continue;
        if(Math.abs(e-p.price)<=Math.max(0.06,p.price*0.006)){
          verifiedBy=`unit:${u.basis}`;matchedUnit=u.value;expected=e;break;
        }
      }
    }
    if(!verifiedBy)continue;
    const qLine=q?lines.find(l=>l.text.match(new RegExp(`\\b${q.value.toString().replace('.', '[,.]')}\\s*${q.unit}\\b`,'i'))):null;
    const title=buildTitle(lines,qLine?.y??null); if(!title)continue;
    out.push({
      title,price:round2(p.price),quantity_text:q?.text||saleUnit||'',source_page:page.page,confidence:0.99,
      raw_data:{parser:'billa-coordinate-v1',price_anchor:'NAŠE CENA',verification:verifiedBy,printed_unit_price:matchedUnit,expected_price:expected==null?null:round2(expected),main_price_token:p.t.text}
    });
  }
  return out;
}
function parseValidity(text:string){
  const m=text.match(/Nabídka\s+platí\s+od\s+[^\d]*(\d{1,2})\.\s*(\d{1,2})\.\s+do\s+[^\d]*(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})/i)
    || text.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*[–-]\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(20\d{2})/);
  if(!m)return{from:null,to:null};
  const iso=(d:string,mo:string,y:string)=>`${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  return{from:iso(m[1],m[2],m[5]),to:iso(m[3],m[4],m[5])};
}
async function extraction(importId?:string){
  if(importId){const{data,error}=await db.from('leaflet_extracted_text').select('*').eq('import_id',importId).maybeSingle();if(error)throw error;if(!data)throw new Error('BILLA extraction nebyla nalezena.');return data;}
  const{data:store}=await db.from('stores').select('id').eq('slug','billa').maybeSingle();if(!store)throw new Error('BILLA store nebyl nalezen.');
  const{data:imports}=await db.from('leaflet_imports').select('id').eq('store_id',store.id).order('created_at',{ascending:false}).limit(20);
  for(const row of imports||[]){const{data}=await db.from('leaflet_extracted_text').select('*').eq('import_id',row.id).maybeSingle();if(data?.parser==='pdf-text-v3')return data;}
  throw new Error('BILLA nemá pdf-text-v3 extraction.');
}
async function write(importId:string,candidates:Candidate[],validity:{from:string|null;to:string|null}){
  if(!validity.from||!validity.to)throw new Error('BILLA validity nebyla ověřena.');
  const del=await db.from('leaflet_import_items').delete().eq('import_id',importId).neq('status','published');if(del.error)throw del.error;
  if(candidates.length){const ins=await db.from('leaflet_import_items').insert(candidates.map(c=>({import_id:importId,title:c.title,price:c.price,quantity_text:c.quantity_text||null,source_page:c.source_page,confidence:c.confidence,status:'approved',raw_data:c.raw_data})));if(ins.error)throw ins.error;}
  const{data:job}=await db.from('leaflet_imports').select('metadata').eq('id',importId).single();
  const upd=await db.from('leaflet_imports').update({status:'review',product_count:candidates.length,confidence:candidates.length?0.99:null,detected_valid_from:validity.from,detected_valid_to:validity.to,error_message:candidates.length?null:'BILLA coordinate parser nenašel bezpečné položky.',finished_at:new Date().toISOString(),metadata:{...(job?.metadata||{}),parser:'billa-coordinate-v1',verified_coordinate_items:candidates.length,deterministic:true}}).eq('id',importId);if(upd.error)throw upd.error;
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  if(!allowed(req))return json({error:'Unauthorized'},401);
  try{
    const body=await req.json().catch(()=>({}));
    const ex=await extraction(body.import_id?String(body.import_id):undefined);
    const pages=Array.isArray(ex.pages)?ex.pages as Page[]:[];
    const raw=pages.flatMap(parsePage),seen=new Set<string>();
    const unique=raw.filter(c=>{const key=`${norm(c.title)}|${c.price.toFixed(2)}|${c.quantity_text}`;if(seen.has(key))return false;seen.add(key);return true;});
    const validity=parseValidity(clean(ex.text_content));
    if(body.dry_run===false)await write(ex.import_id,unique,validity);
    return json({ok:true,dry_run:body.dry_run!==false,import_id:ex.import_id,parser:'billa-coordinate-v1',validity,candidate_count:unique.length,candidates:unique.slice(0,160)});
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},500);}
});
