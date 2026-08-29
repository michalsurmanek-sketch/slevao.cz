import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL=Deno.env.get('SUPABASE_URL')!;
const SERVICE=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON=Deno.env.get('CRON_SECRET')||'';
const db=createClient(URL,SERVICE,{auth:{persistSession:false,autoRefreshToken:false}});
const HEADERS={'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-cron-secret'};
const JINA_HEADERS={'user-agent':'Slevao/1.0','accept':'text/plain,text/markdown','x-with-links-summary':'true','x-with-images-summary':'true','x-no-cache':'true','cache-control':'no-cache'};
const DEFAULT_BATCH=12,MAX_BATCH=16,CONCURRENCY=4;

function json(v:unknown,s=200){return new Response(JSON.stringify(v),{status:s,headers:HEADERS});}
function allowed(r:Request){return r.headers.get('authorization')===`Bearer ${SERVICE}`||Boolean(CRON&&r.headers.get('x-cron-secret')===CRON);}
function errorText(e:unknown){return e instanceof Error?e.message:String(e);}
function validSource(raw:unknown){try{const u=new globalThis.URL(String(raw||''));return u.protocol==='https:'&&u.hostname==='www.sportisimo.cz'&&/^\/[a-z0-9-]+\/[a-z0-9.-]+\/\d+\/?$/i.test(u.pathname)?u.toString():null}catch{return null}}
function extractImage(text:string){const matches=[...text.matchAll(/https:\/\/i[.]sportisimo[.]com\/products\/images\/[^\s)]+\/700x700\/[^\s)]+/gi)];for(const m of matches){try{const u=new globalThis.URL(m[0]);if(u.protocol==='https:'&&u.hostname==='i.sportisimo.com'&&u.pathname.startsWith('/products/images/')&&u.pathname.includes('/700x700/')&&/\.(?:jpe?g|png|webp)$/i.test(u.pathname))return u.toString()}catch{}}return null}
async function fetchDetail(source:string){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);try{const r=await fetch(`https://r.jina.ai/${source}`,{headers:JINA_HEADERS,signal:controller.signal,redirect:'follow'});const text=await r.text();if(!r.ok)throw new Error(`Jina HTTP ${r.status}`);return {image:extractImage(text),bytes:text.length};}finally{clearTimeout(timer)}}
async function worker<T,R>(items:T[],fn:(x:T)=>Promise<R>){const out:R[]=[];let cursor=0;async function run(){while(true){const i=cursor++;if(i>=items.length)return;out[i]=await fn(items[i]);}}await Promise.all(Array.from({length:Math.min(CONCURRENCY,items.length)},()=>run()));return out;}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:HEADERS});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  if(!allowed(req))return json({error:'Unauthorized'},401);
  const body=await req.json().catch(()=>({}));
  const dryRun=body.dry_run===true;
  const requested=Number(body.limit||DEFAULT_BATCH);
  const limit=Math.max(1,Math.min(MAX_BATCH,Number.isFinite(requested)?Math.floor(requested):DEFAULT_BATCH));
  try{
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const {data:store,error:storeError}=await db.from('stores').select('id').eq('slug','sportisimo').single();
    if(storeError||!store)throw storeError||new Error('Sportisimo store not found');
    const {data:offers,error}=await db.from('offers').select('id,external_id,title,source_url,image_url,metadata').eq('store_id',store.id).eq('status','published').lte('valid_from',today).gte('valid_to',today).or('image_url.is.null,image_url.eq.').order('updated_at',{ascending:false}).limit(limit);
    if(error)throw error;
    const rows=(offers||[]).map((o:any)=>({...o,source:validSource(o.source_url)})).filter((o:any)=>o.source);
    const results=await worker(rows,async(o:any)=>{try{const detail=await fetchDetail(o.source);return {id:o.id,external_id:o.external_id,title:o.title,source_url:o.source,image_url:detail.image,bytes:detail.bytes,error:detail.image?null:'image_not_found'};}catch(e){return {id:o.id,external_id:o.external_id,title:o.title,source_url:o.source,image_url:null,bytes:0,error:errorText(e)}}});
    const resolved=results.filter((x:any)=>x.image_url);
    if(!dryRun){
      for(const item of resolved as any[]){
        const current=rows.find((x:any)=>x.id===item.id);
        const metadata={...(current?.metadata||{}),image_source:'sportisimo-jina-detail-v1',image_enriched_at:new Date().toISOString(),image_source_url:item.source_url};
        const {error:updateError}=await db.from('offers').update({image_url:item.image_url,metadata,updated_at:new Date().toISOString()}).eq('id',item.id);
        if(updateError)item.error=errorText(updateError);
      }
    }
    return json({ok:true,dry_run:dryRun,selected:rows.length,resolved:resolved.length,unresolved:results.length-resolved.length,results});
  }catch(e){return json({ok:false,error:errorText(e),code:'SPORTISIMO_IMAGE_ENRICH_FAILED'},500)}
});
