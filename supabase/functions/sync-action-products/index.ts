import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession:false, autoRefreshToken:false } });
const ADAPTER = 'action-official-html-v2';
const SOURCE_ADAPTER = 'action-html-v3';
const CORS = { 'access-control-allow-origin':'*', 'access-control-allow-headers':'authorization,apikey,content-type,x-cron-secret', 'content-type':'application/json; charset=utf-8' };

const json = (value:unknown,status=200) => new Response(JSON.stringify(value),{status,headers:CORS});
function allowed(req:Request){
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
  return token===SERVICE || Boolean(CRON && req.headers.get('x-cron-secret')===CRON);
}
function clean(v:unknown){ return String(v??'').replace(/\s+/g,' ').trim(); }
function norm(v:unknown){ return clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim(); }
function productNumber(url:string){ return url.match(/\/p\/(\d{5,12})\//)?.[1] || null; }
function errorMessage(value:unknown){
  if(value instanceof Error) return value.message;
  if(value && typeof value==='object' && 'message' in value) return String((value as any).message||'Unknown error');
  try{return JSON.stringify(value);}catch{return String(value);}
}
function todayPrague(){
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const o:any={}; for(const x of p)o[x.type]=p.find(y=>y.type===x.type)?.value||x.value; return `${o.year}-${o.month}-${o.day}`;
}
async function sha256(value:string){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function markFailure(storeId:string|undefined,message:string){
  if(!storeId)return;
  await db.from('store_product_sync_state').upsert({store_id:storeId,last_run_at:new Date().toISOString(),last_error:message,last_parser_error:message,health_status:'degraded',health_reason:`Action sync selhal: ${message}`.slice(0,500),is_running:false,run_started_at:null,updated_at:new Date().toISOString(),adapter_name:'sync-action-products',adapter_version:'v2',parser_version:ADAPTER},{onConflict:'store_id'});
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:CORS});
  if(req.method!=='POST') return json({error:'Method not allowed'},405);
  if(!allowed(req)) return json({error:'Unauthorized'},401);
  let storeId:string|undefined;
  try{
    const body=await req.json().catch(()=>({}));
    const today=todayPrague();
    const {data:store,error:storeError}=await db.from('stores').select('id,name').eq('slug','action').single();
    if(storeError||!store) throw new Error(errorMessage(storeError||'Action nebyl nalezen.'));
    storeId=store.id;

    const {data:imp,error:impError}=await db.from('leaflet_imports')
      .select('id,detected_valid_from,detected_valid_to,source_document_url,created_at')
      .eq('store_id',store.id)
      .eq('metadata->>adapter',SOURCE_ADAPTER)
      .lte('detected_valid_from',today).gte('detected_valid_to',today)
      .order('created_at',{ascending:false}).limit(1).single();
    if(impError||!imp) throw new Error(errorMessage(impError||'Aktuální Action v3 import nebyl nalezen.'));

    const {data:items,error:itemError}=await db.from('leaflet_import_items')
      .select('id,title,price,quantity_text,image_url,confidence,status,raw_data')
      .eq('import_id',imp.id).in('status',['approved','published','ignored']);
    if(itemError) throw new Error(errorMessage(itemError));

    const rows:any[]=[];
    for(const item of items||[]){
      const sourceUrl=clean(item.raw_data?.source_url);
      const sku=productNumber(sourceUrl);
      const title=clean(item.title);
      const price=Number(item.price);
      const image=clean(item.image_url);
      if(!sku || title.length<4 || !Number.isFinite(price) || price<2 || price>10000) continue;
      if(!sourceUrl.startsWith('https://www.action.com/cs-cz/p/')) continue;
      if(!/^https:\/\/asset\.action\.com\//i.test(image)) continue;
      rows.push({
        external_id:`action:${sku}`,
        title, normalized_title:norm(title), price, old_price:null,
        quantity_text:clean(item.quantity_text)||null,
        valid_from:imp.detected_valid_from, valid_to:imp.detected_valid_to,
        source_url:sourceUrl, source_page:null, product_id:null,
        image_url:image, confidence:Math.max(0.99,Number(item.confidence||0)),
        metadata:{adapter:ADAPTER,parser_version:ADAPTER,action_product_number:sku,official_image:true,source_import_id:imp.id}
      });
    }
    const unique=[...new Map(rows.map(r=>[r.external_id,r])).values()].sort((a,b)=>a.title.localeCompare(b.title,'cs'));
    if(unique.length<20 || unique.length>40) throw new Error(`Action v3 má ${unique.length} bezpečných produktů; očekáváno 20–40.`);
    if(unique.filter(r=>r.image_url).length!==unique.length) throw new Error('Action v3 nemá obrázek u všech bezpečných produktů.');

    const signature=await sha256(unique.map(r=>`${r.external_id}|${r.title}|${r.price}|${r.image_url}|${r.valid_to}`).join('\n'));
    if(body.dry_run===true) return json({ok:true,dry_run:true,source_import_id:imp.id,publishable:unique.length,images:unique.length,signature,candidates:unique});

    const {data:result,error:publishError}=await db.rpc('publish_structured_store_offers',{
      p_store_slug:'action',p_adapter:ADAPTER,p_signature:signature,p_rows:unique,p_min_products:20,p_max_products:40,
      p_source_document_url:imp.source_document_url,p_parser_version:ADAPTER
    });
    if(publishError) throw new Error(`${publishError.message||'Action publisher failed'} ${publishError.details||''}`.trim());

    await db.from('store_product_sync_state').upsert({store_id:store.id,last_run_at:new Date().toISOString(),last_success_at:new Date().toISOString(),last_offer_count:unique.length,expected_offer_count:unique.length,minimum_offer_count:20,last_published_count:unique.length,parser_version:ADAPTER,adapter_name:'sync-action-products',adapter_version:'v2',source_type:'official-html',source_category:'weekly-sale',last_error:null,last_parser_error:null,health_status:'ok',health_reason:`Action: ${unique.length} aktuálních produktů s oficiálními obrázky.`,is_running:false,run_started_at:null,updated_at:new Date().toISOString(),last_import_id:result?.import_id||null},{onConflict:'store_id'});
    return json({ok:true,published:unique.length,images:unique.length,signature,result});
  }catch(e){
    const message=errorMessage(e).slice(0,1000);
    await markFailure(storeId,message);
    return json({ok:false,error:message,code:'ACTION_PRODUCTS_SYNC_FAILED'},500);
  }
});
