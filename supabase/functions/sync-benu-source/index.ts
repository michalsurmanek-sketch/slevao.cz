import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SOURCE_URL = 'https://www.benu.cz/benu-letak/akce';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const PUBLISHER_URL = `${SUPABASE_URL}/functions/v1/publish-imports`;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession:false, autoRefreshToken:false } });
const CORS = {
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'authorization,apikey,content-type,x-client-info,x-cron-secret',
  'access-control-allow-methods':'POST,OPTIONS',
  'content-type':'application/json; charset=utf-8',
};

function json(body:unknown,status=200){ return new Response(JSON.stringify(body),{status,headers:CORS}); }
function allowed(req:Request){ return req.headers.get('authorization')===`Bearer ${SERVICE_ROLE_KEY}` || Boolean(CRON_SECRET && req.headers.get('x-cron-secret')===CRON_SECRET); }
function clean(value:string){ return String(value||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/\s+/g,' ').trim(); }
function money(value:string){ const n=Number(String(value||'').replace(/\s/g,'').replace(',','.').replace(/[^0-9.]/g,'')); return Number.isFinite(n)&&n>0?n:null; }
function pragueToday(){ const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()); const v=Object.fromEntries(parts.map(p=>[p.type,p.value])); return `${v.year}-${v.month}-${v.day}`; }
async function sha(value:string){ const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)); return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join(''); }

function parse(html:string,pageUrl:string){
  const blocks=html.split(/<section class="product-box[^>]*>/i).slice(1);
  const out:any[]=[];
  for(const block of blocks){
    const title=clean(block.match(/product-box__name[^>]*>([\s\S]*?)<\/h4>/i)?.[1]||'');
    if(title.length<3) continue;
    const href=block.match(/<a href="([^"]+)"[^>]+product-box__link/i)?.[1]||'';
    const img=block.match(/<img[^>]+src="([^"]+)"/i)?.[1]?.replace(/&amp;/g,'&')||null;
    const priceBlock=block.match(/product-box__price[\s\S]*?<\/p>/i)?.[0]||'';
    const oldText=clean(priceBlock.match(/<del>([\s\S]*?)<\/del>/i)?.[1]||'');
    const curText=clean(priceBlock.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1]||'');
    const oldPrice=money(oldText);
    const price=money(curText)||money(oldText);
    if(!price) continue;
    const quantity=title.match(/\b\d+(?:[,.]\d+)?\s*(?:mg|g|kg|ml|l|ks|tbl|tob|cps|sáčků|dávek)\b/i)?.[0]||null;
    out.push({
      title,
      price,
      old_price:oldPrice&&oldPrice>price?oldPrice:null,
      quantity_text:quantity,
      image_url:img,
      confidence:.98,
      raw_data:{ parser:'benu-html-v2', product_url:href?new URL(href,pageUrl).toString():pageUrl, page_url:pageUrl },
    });
  }
  return out;
}

async function fetchPage(page:number){
  const url=page===1?SOURCE_URL:`${SOURCE_URL}?page=${page}`;
  const response=await fetch(url,{
    headers:{
      'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
      'accept-language':'cs-CZ,cs;q=0.9',
      'accept':'text/html,application/xhtml+xml',
    },
    redirect:'follow',
  });
  if(!response.ok) throw new Error(`BENU stránka ${page} HTTP ${response.status}`);
  const html=await response.text();
  return { url:response.url||url, items:parse(html,response.url||url) };
}

async function publishImport(importId:string){
  const response=await fetch(PUBLISHER_URL,{method:'POST',headers:{authorization:`Bearer ${SERVICE_ROLE_KEY}`,apikey:SERVICE_ROLE_KEY,'content-type':'application/json',...(CRON_SECRET?{'x-cron-secret':CRON_SECRET}:{})},body:JSON.stringify({import_id:importId})});
  const text=await response.text();
  if(!response.ok) throw new Error(`publish-imports HTTP ${response.status}: ${text.slice(0,400)}`);
  return JSON.parse(text);
}

async function fetchAllItems(){
  const merged:any[]=[];
  const seen=new Set<string>();
  let pages=0;
  for(let page=1;page<=10;page++){
    const result=await fetchPage(page);
    pages=page;
    for(const item of result.items){
      const key=`${item.title.toLocaleLowerCase('cs')}|${Number(item.price).toFixed(2)}`;
      if(seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
    if(result.items.length<16) break;
  }
  return { items:merged, pages };
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:CORS});
  if(req.method!=='POST') return json({error:'Method not allowed'},405);
  if(!allowed(req)) return json({error:'Unauthorized'},401);
  const now=new Date().toISOString();
  try{
    const {data:store,error:storeError}=await db.from('stores').select('id').eq('slug','benu').single();
    if(storeError) throw storeError;

    let {data:source,error:sourceError}=await db.from('leaflet_sources').select('id').eq('store_id',store.id).order('created_at').limit(1).maybeSingle();
    if(sourceError) throw sourceError;
    if(!source){
      const created=await db.from('leaflet_sources').insert({store_id:store.id,name:'BENU – letákové produkty v akci',source_url:SOURCE_URL,source_type:'html',is_active:true}).select('id').single();
      if(created.error) throw created.error;
      source=created.data;
    }

    await db.from('leaflet_sources').update({name:'BENU – letákové produkty v akci',source_url:SOURCE_URL,source_type:'html',is_active:true,last_error:null,adapter_key:'benu-html',extraction_strategy:'structured_html'}).eq('id',source.id);

    const {items,pages}=await fetchAllItems();
    if(items.length<20) throw new Error(`BENU parser našel jen ${items.length} produktů na ${pages} stránkách.`);

    const validFrom=pragueToday();
    const validTo=validFrom;
    const sourceHash=await sha(`${source.id}|${validFrom}|${items.length}|${items.slice(0,80).map(x=>`${x.title}:${x.price}`).join('|')}|benu-html-v2`);
    const {data:old,error:oldError}=await db.from('leaflet_imports').select('id,status').eq('source_hash',sourceHash).maybeSingle();
    if(oldError) throw oldError;
    if(old){
      await db.from('leaflet_sources').update({last_checked_at:now,last_success_at:now,last_error:null,last_strategy_used:'structured_html',last_strategy_success_at:now}).eq('id',source.id);
      return json({ok:true,existing:true,import_id:old.id,items:items.length,pages});
    }

    const {data:imp,error:importError}=await db.from('leaflet_imports').insert({
      source_id:source.id,
      store_id:store.id,
      source_document_url:SOURCE_URL,
      source_hash:sourceHash,
      status:'review',
      product_count:items.length,
      confidence:.98,
      detected_valid_from:validFrom,
      detected_valid_to:validTo,
      finished_at:now,
      metadata:{adapter:'benu-html-v1',parser_version:'benu-html-v2',ai_used:false,source_type:'structured_html',validity_strategy:'live_catalog_same_day_snapshot',pages_fetched:pages},
    }).select('id').single();
    if(importError) throw importError;

    const verifiedItems=items.filter(item=>item.quantity_text&&item.old_price&&item.old_price>item.price&&item.confidence>=.95);
    if(verifiedItems.length<1) throw new Error('BENU: nebyla nalezena žádná bezpečně ověřená sleva.');
    const rows=verifiedItems.map(item=>({
      import_id:imp.id,
      title:item.title,
      quantity_text:item.quantity_text,
      price:item.price,
      old_price:item.old_price,
      image_url:item.image_url,
      confidence:item.confidence,
      status:'approved',
      raw_data:item.raw_data,
    }));
    for(let i=0;i<rows.length;i+=200){
      const {error}=await db.from('leaflet_import_items').insert(rows.slice(i,i+200));
      if(error) throw error;
    }

    await db.from('leaflet_imports').update({product_count:verifiedItems.length}).eq('id',imp.id);
    const publish=await publishImport(imp.id);
    await db.from('leaflet_sources').update({last_checked_at:now,last_success_at:now,last_error:null,last_strategy_used:'structured_html',last_strategy_success_at:now}).eq('id',source.id);
    return json({ok:true,created:true,import_id:imp.id,items:items.length,verified_items:verifiedItems.length,pages,valid_from:validFrom,valid_to:validTo,publish});
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    const {data:store}=await db.from('stores').select('id').eq('slug','benu').maybeSingle();
    if(store) await db.from('leaflet_sources').update({last_checked_at:now,last_error:message}).eq('store_id',store.id);
    return json({error:message},500);
  }
});