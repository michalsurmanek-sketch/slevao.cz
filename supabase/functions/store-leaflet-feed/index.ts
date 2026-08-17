import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'cache-control': 'public, max-age=300, s-maxage=300',
};
const LIDL_API = 'https://endpoints.leaflets.schwarz/v4/overview?client_locale=lidl%2Fcs-CZ';
const PUBLIC_PAGES: Record<string,{url:string;title:string}> = {
  action:{url:'https://www.action.com/cs-cz/letak/',title:'Týdenní akce'},
  tesco:{url:'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy',title:'Akční letáky a katalogy'},
  penny:{url:'https://www.penny.cz/letaky',title:'Aktuální leták'},
  teta:{url:'https://www.tetadrogerie.cz/akce/letak',title:'Aktuální leták'},
  rossmann:{url:'https://www.rossmann.cz/obsah/akce-a-letaky',title:'Akce a letáky'},
  dm:{url:'https://www.dm.cz/vyprodej/',title:'Akce a nabídky'},
  globus:{url:'https://www.globus.cz/globus/letaky#aktualni',title:'Aktuální leták'},
  makro:{url:'https://www.makro.cz/aktualni-nabidka',title:'Aktuální nabídka'},
  rohlik:{url:'https://www.rohlik.cz/cenove-trhaky',title:'Cenové trháky'},
  kosik:{url:'https://www.kosik.cz/s1-akce',title:'Akční nabídka'},
  'super-zoo':{url:'https://www.superzoo.cz/akce/',title:'Akce a novinky'},
  hornbach:{url:'https://www.hornbach.cz/aktuality/katalogy/',title:'Aktuální letáky a katalogy'},
  mountfield:{url:'https://www.mountfield.cz/akce',title:'Právě probíhající akce'},
  alza:{url:'https://www.alza.cz/vyprodej-akce-sleva/e0.htm',title:'Akce a slevy'},
  datart:{url:'https://www.datart.cz/letak',title:'Aktuální leták'},
  decathlon:{url:'https://www.decathlon.cz/deals/doprodej',title:'Doprodej a speciální nabídky'},
  sconto:{url:'https://www.sconto.cz/letak',title:'Aktuální leták'},
  moebelix:{url:'https://www.moebelix.cz/c/slevy',title:'Slevy a výprodeje'},
  xxxlutz:{url:'https://www.xxxlutz.cz/c/letaky',title:'Aktuální letáky'},
  sportisimo:{url:'https://www.sportisimo.cz/vyprodej/',title:'Výprodej'},
  smarty:{url:'https://www.smarty.cz/vyprodej-4c10260',title:'Výprodej'},
  pilulka:{url:'https://www.pilulka.cz/akce-a-slevy',title:'Akce a slevy'},
  'auto-kelly':{url:'https://www.autokelly.cz/page/vernostni-program',title:'Věrnostní slevy'},
  dek:{url:'https://www.dek.cz/akce/nabidka/',title:'Akční nabídka'},
  'pro-doma':{url:'https://www.pro-doma.cz/akce',title:'Akce a slevy'},
  stavmat:{url:'https://www.stavmat.cz/akce/',title:'Akční nabídka'},
  hm:{url:'https://www2.hm.com/cs_cz/zeny/vyprodej/zobrazit-vse.html',title:'Aktuální výprodej'},
  hruska:{url:'https://mojehruska.cz/',title:'Aktuální týdenní leták'},
  tedi:{url:'https://www.tedi.com/cz/',title:'Aktuální nabídky'},
  'new-yorker':{url:'https://www.newyorker.de/cz/',title:'Aktuální kolekce'},
};

type Leaflet = {key:string;title:string;subtitle:string;valid_from:string|null;valid_to:string|null;url:string;direct:boolean;preview_url?:string;logo_url?:string|null};
function isDocumentUrl(value:string){ try { const u=new URL(value); return u.protocol==='https:' && (/\.(?:pdf|webp|png|jpe?g)(?:$|\?)/i.test(u.pathname+u.search) || u.hostname==='files.rewe.co.at' || u.hostname.includes('leaflets.schwarz') || u.hostname==='digitalcontent.api.tesco.com'); } catch { return false; } }
function fallback(slug:string,name:string,logo:string|null):Leaflet[]{ const x=PUBLIC_PAGES[slug]; return x?[{key:`${slug}-official`,title:x.title,subtitle:name,valid_from:null,valid_to:null,url:x.url,direct:false,logo_url:logo}]:[]; }
async function lidl(name:string,logo:string|null):Promise<Leaflet[]> {
  try {
    const r=await fetch(LIDL_API,{headers:{'user-agent':'Mozilla/5.0','accept':'application/json','accept-language':'cs-CZ,cs;q=0.9'},redirect:'follow'});
    if(!r.ok) throw new Error(`Lidl API HTTP ${r.status}`);
    const data=await r.json(); const today=new Date().toISOString().slice(0,10);
    const flyers=(data.categories||[]).flatMap((c:any)=>(c.subcategories||[]).flatMap((s:any)=>String(s.name||'').toLocaleLowerCase('cs').includes('akční letáky')?(s.flyers||[]):[]))
      .filter((f:any)=>f.isActive!==false&&typeof f.pdfUrl==='string'&&f.pdfUrl.startsWith('https://')&&String(f.offerStartDate||f.startDate||'')<=today&&String(f.offerEndDate||f.endDate||'')>=today);
    return flyers.map((f:any,i:number)=>({key:`lidl-${String(f.id||i+1)}`,title:String(f.title||f.name||'Akční leták'),subtitle:name,valid_from:String(f.offerStartDate||f.startDate||'').slice(0,10)||null,valid_to:String(f.offerEndDate||f.endDate||'').slice(0,10)||null,url:'https://www.lidl.cz/c/akcni-letak/s10008644',direct:true,preview_url:`${SUPABASE_URL}/functions/v1/store-leaflet-document?source_url=${encodeURIComponent(String(f.pdfUrl))}`,logo_url:logo}));
  } catch { return fallback('lidl',name,logo); }
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:CORS});
  if(req.method!=='GET') return Response.json({error:'Method not allowed'},{status:405,headers:CORS});
  try {
    const slug=new URL(req.url).searchParams.get('store')||'tesco';
    if(!/^[a-z0-9-]{2,64}$/.test(slug)) throw new Error('Neplatný obchod.');
    const {data:store,error}=await db.from('stores').select('id,slug,name,is_active,logo_url').eq('slug',slug).eq('is_active',true).maybeSingle();
    if(error||!store) return Response.json({ok:false,store:slug,leaflets:[],error:'Obchod nebyl nalezen.'},{status:404,headers:CORS});
    if(slug==='lidl') return Response.json({ok:true,store:slug,source:LIDL_API,leaflets:await lidl(store.name,store.logo_url)},{headers:CORS});

    const today=new Date().toISOString().slice(0,10);
    const {data,error:importError}=await db.from('leaflet_imports')
      .select('id,source_document_url,detected_valid_from,detected_valid_to,created_at,metadata')
      .eq('store_id',store.id)
      .eq('status','published')
      .or(`detected_valid_to.is.null,detected_valid_to.gte.${today}`)
      .order('created_at',{ascending:false}).limit(30);
    if(importError) throw importError;
    const seen=new Set<string>(); const leaflets:Leaflet[]=[];
    for(const row of data||[]){
      const source=String(row.source_document_url||'');
      const bucket=String(row.metadata?.storage_bucket||''); const path=String(row.metadata?.storage_path||'');
      const hasStored=Boolean(bucket&&path); const doc=isDocumentUrl(source);
      if(!hasStored&&!doc) continue;
      const key=`${source}|${bucket}|${path}`; if(seen.has(key)) continue; seen.add(key);
      leaflets.push({key:`${slug}-${leaflets.length+1}`,title:String(row.metadata?.title||(leaflets.length?'Další platný leták':'Aktuální leták')),subtitle:store.name,valid_from:row.detected_valid_from,valid_to:row.detected_valid_to,url:source,direct:true,preview_url:`${SUPABASE_URL}/functions/v1/store-leaflet-document?import_id=${encodeURIComponent(row.id)}`,logo_url:store.logo_url});
      if(leaflets.length>=20) break;
    }
    const out=leaflets.length?leaflets:fallback(slug,store.name,store.logo_url);
    return Response.json({ok:true,store:slug,leaflets:out},{headers:CORS});
  } catch(e){return Response.json({ok:false,leaflets:[],error:e instanceof Error?e.message:String(e)},{status:502,headers:CORS});}
});
