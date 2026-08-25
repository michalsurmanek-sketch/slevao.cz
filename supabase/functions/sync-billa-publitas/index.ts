import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const LANDING_URL = 'https://www.billa.cz/letaky-billa';
const GROUP = 'billa-cz';
const API_ROOT = `https://api.publitas.com/v1/groups/${GROUP}/publications`;
const PDF_ROOT = 'https://view.publitas.com';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession:false, autoRefreshToken:false } });

const CORS = {
  'access-control-allow-origin':'*',
  'access-control-allow-headers':'authorization,apikey,content-type,x-cron-secret',
  'content-type':'application/json; charset=utf-8',
};
const BROWSER_HEADERS = {
  'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept:'text/html,application/json,*/*;q=0.8',
  'accept-language':'cs-CZ,cs;q=0.9',
  'cache-control':'no-cache',
};
const json = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers:CORS});

type Campaign = { slug:string; validFrom:string; validTo:string };
type Publication = Campaign & { publicationId:number|null; title:string; pdfUrl:string; pageCount:number };

function allowed(req:Request){
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
  return token===SERVICE_ROLE_KEY || Boolean(CRON_SECRET && req.headers.get('x-cron-secret')===CRON_SECRET);
}
function clean(v:unknown){ return String(v??'').replace(/\s+/g,' ').trim(); }
function pragueDate(){
  const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const m=Object.fromEntries(p.map(x=>[x.type,x.value]));
  return `${m.year}-${m.month}-${m.day}`;
}
function iso(y:number,m:number,d:number){ return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function asUtcDate(value:string){ const [y,m,d]=value.split('-').map(Number); return new Date(Date.UTC(y,m-1,d,12)); }
function addDays(value:string,days:number){ const d=asUtcDate(value); d.setUTCDate(d.getUTCDate()+days); return iso(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate()); }
function campaignForStart(start:string):Campaign{
  const d=asUtcDate(start); const end=asUtcDate(addDays(start,6));
  const slug=`velky-letak-${d.getUTCDate()}-${d.getUTCMonth()+1}-${end.getUTCDate()}-${end.getUTCMonth()+1}-${end.getUTCFullYear()}`;
  return {slug,validFrom:start,validTo:addDays(start,6)};
}
function fallbackCampaigns(today:string){
  const d=asUtcDate(today);
  const delta=(d.getUTCDay()-3+7)%7;
  d.setUTCDate(d.getUTCDate()-delta);
  const current=iso(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());
  return [campaignForStart(current),campaignForStart(addDays(current,7))];
}
function parseCampaignSlug(slug:string):Campaign|null{
  const m=slug.match(/^velky-letak-(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{1,2})-(20\d{2})$/i);
  if(!m) return null;
  const [,fd,fm,td,tm,y]=m;
  return {slug:slug.toLowerCase(),validFrom:iso(Number(y),Number(fm),Number(fd)),validTo:iso(Number(y),Number(tm),Number(td))};
}
async function fetchText(url:string){
  const r=await fetch(url,{headers:BROWSER_HEADERS,redirect:'follow'});
  if(!r.ok) throw new Error(`${new URL(url).hostname} HTTP ${r.status}`);
  return await r.text();
}
async function discoverCampaigns(today:string,tomorrow:string){
  const candidates=new Map<string,Campaign>();
  try{
    const html=await fetchText(LANDING_URL);
    for(const m of html.matchAll(/https:\/\/view\.publitas\.com\/billa-cz\/(velky-letak-[a-z0-9-]+)/gi)){
      const parsed=parseCampaignSlug(m[1]);
      if(parsed) candidates.set(parsed.slug,parsed);
    }
  }catch(e){
    console.warn('BILLA landing fallback:',e instanceof Error?e.message:String(e));
  }
  for(const campaign of fallbackCampaigns(today)) candidates.set(campaign.slug,campaign);
  return [...candidates.values()]
    .filter(c=>c.validFrom<=tomorrow && c.validTo>=today)
    .sort((a,b)=>b.validFrom.localeCompare(a.validFrom));
}
async function publication(campaign:Campaign):Promise<Publication|null>{
  const r=await fetch(`${API_ROOT}/${campaign.slug}.json`,{headers:{accept:'application/json'},redirect:'follow'});
  if(r.status===404) return null;
  if(!r.ok) throw new Error(`Publitas ${campaign.slug} HTTP ${r.status}`);
  const payload:any=await r.json();
  const download=clean(payload?.config?.downloadPdfUrl);
  if(!/^\/\d+\/\d+\/pdfs\/[a-z0-9-]+\.pdf$/i.test(download)) throw new Error(`Publitas ${campaign.slug} nevrátil bezpečný PDF endpoint.`);
  const pdfUrl=new URL(download,PDF_ROOT).toString();
  const probe=await fetch(pdfUrl,{headers:{range:'bytes=0-7',accept:'application/pdf'},redirect:'follow'});
  const type=probe.headers.get('content-type')||'';
  const prefix=new TextDecoder().decode(new Uint8Array(await probe.arrayBuffer()).slice(0,8));
  if(!probe.ok || !type.toLowerCase().includes('application/pdf') || !prefix.startsWith('%PDF-')){
    throw new Error(`BILLA PDF ${campaign.slug} není validní dokument (${probe.status}, ${type}).`);
  }
  const pageCount=(payload?.spreads||[]).reduce((sum:number,s:any)=>sum+(Array.isArray(s?.pages)?s.pages.length:0),0);
  return {
    ...campaign,
    publicationId:Number(payload?.config?.publicationId)||null,
    title:clean(payload?.config?.publicationTitle)||campaign.slug,
    pdfUrl,
    pageCount,
  };
}
async function sha256(value:string){
  const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(d)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function findExisting(hash:string,pdfUrl:string){
  const byHash=await db.from('leaflet_imports').select('id,status,metadata,source_hash').eq('source_hash',hash).maybeSingle();
  if(byHash.error) throw byHash.error;
  if(byHash.data) return byHash.data;
  const byUrl=await db.from('leaflet_imports').select('id,status,metadata,source_hash').eq('source_document_url',pdfUrl).eq('store_id',(await db.from('stores').select('id').eq('slug','billa').single()).data?.id).order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(byUrl.error) throw byUrl.error;
  return byUrl.data || null;
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:CORS});
  if(req.method!=='POST') return json({error:'Method not allowed'},405);
  if(!allowed(req)) return json({error:'Unauthorized'},401);
  const now=new Date().toISOString();
  try{
    const today=pragueDate();
    const tomorrow=addDays(today,1);
    const {data:store,error:storeError}=await db.from('stores').select('id,name').eq('slug','billa').single();
    if(storeError||!store) throw storeError||new Error('BILLA store nebyl nalezen.');
    const {data:source,error:sourceError}=await db.from('leaflet_sources').select('id').eq('store_id',store.id).eq('is_active',true).order('created_at',{ascending:true}).limit(1).maybeSingle();
    if(sourceError) throw sourceError;
    if(!source) throw new Error('BILLA nemá aktivní zdroj letáků.');

    const campaigns=await discoverCampaigns(today,tomorrow);
    const publications:Publication[]=[];
    for(const campaign of campaigns){
      const p=await publication(campaign);
      if(p) publications.push(p);
    }
    if(!publications.length) throw new Error('BILLA Publitas nevrátil Velký leták platný dnes ani zítra.');

    const created:any[]=[];
    const existing:any[]=[];
    for(const p of publications){
      const hash=`billa-official-publitas-v2-${await sha256(p.pdfUrl)}`;
      let old:any=null;
      const byHash=await db.from('leaflet_imports').select('id,status,metadata,source_hash').eq('source_hash',hash).maybeSingle();
      if(byHash.error) throw byHash.error;
      old=byHash.data;
      if(!old){
        const byUrl=await db.from('leaflet_imports').select('id,status,metadata,source_hash').eq('store_id',store.id).eq('source_document_url',p.pdfUrl).order('created_at',{ascending:false}).limit(1).maybeSingle();
        if(byUrl.error) throw byUrl.error;
        old=byUrl.data;
      }
      const metadata={
        ...(old?.metadata||{}),adapter:'store:billa',official_publication:true,
        publitas_publication_id:p.publicationId,publitas_slug:p.slug,title:p.title,
        page_count:p.pageCount,discovered_at:now,discovery_window:{today,tomorrow},
      };
      if(old){
        const {error}=await db.from('leaflet_imports').update({
          source_document_url:p.pdfUrl,detected_valid_from:p.validFrom,detected_valid_to:p.validTo,
          page_count:p.pageCount||null,metadata,updated_at:now,
        }).eq('id',old.id);
        if(error) throw error;
        existing.push({id:old.id,status:old.status,source_hash:old.source_hash,slug:p.slug,valid_from:p.validFrom,valid_to:p.validTo});
      }else{
        const {data:row,error}=await db.from('leaflet_imports').insert({
          source_id:source.id,store_id:store.id,source_document_url:p.pdfUrl,source_hash:hash,status:'queued',
          coverage_scope:'national',detected_valid_from:p.validFrom,detected_valid_to:p.validTo,
          page_count:p.pageCount||null,metadata,
        }).select('id,status').single();
        if(error||!row) throw error||new Error('BILLA import se nepodařilo založit.');
        created.push({id:row.id,status:row.status,slug:p.slug,valid_from:p.validFrom,valid_to:p.validTo});
      }
    }

    const {data:reconcile,error:reconcileError}=await db.rpc('reconcile_billa_verified_pipeline');
    if(reconcileError) throw reconcileError;
    await db.from('leaflet_sources').update({
      last_checked_at:now,last_success_at:now,last_error:null,last_strategy_used:'billa_publitas_pdf_v2',last_strategy_success_at:now,
    }).eq('id',source.id);

    return json({ok:true,store:store.name,window:{today,tomorrow},publications:publications.map(p=>({slug:p.slug,valid_from:p.validFrom,valid_to:p.validTo,pdf_url:p.pdfUrl,page_count:p.pageCount,publication_id:p.publicationId})),created,existing,reconcile});
  }catch(e){
    const message=e instanceof Error?e.message:String(e);
    const {data:store}=await db.from('stores').select('id').eq('slug','billa').maybeSingle();
    if(store?.id) await db.from('leaflet_sources').update({last_checked_at:now,last_error:message.slice(0,1000)}).eq('store_id',store.id).eq('is_active',true);
    return json({ok:false,error:message},500);
  }
});
