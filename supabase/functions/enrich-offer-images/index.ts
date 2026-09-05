import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SERPAPI_KEY = Deno.env.get('SERPAPI_KEY') || '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-cron-secret',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const OFFICIAL_DOMAINS = [
  'alza.cz','itesco.cz','tesco.com','rohlik.cz','kosik.cz','benu.cz','pilulka.cz','datart.cz','sportisimo.cz','superzoo.cz','petcenter.cz',
  'rossmann.cz','dm.cz','kaufland.cz','lidl.cz','globus.cz','albert.cz','penny.cz','coop.cz','terno.cz','action.com','mountfield.cz','bauhaus.cz',
];
const REJECTED_URL_PARTS = ['/letak','/letaky','/leaflet','/catalog','/katalog','/page-','/pages/','prospekt','akcniletak','.pdf','screenshot','preview-page'];

type Match = { url:string; score:number; source:'verified_catalog'|'official_web'|'web_search'; sourceUrl?:string; sourceProductId?:string; sourceProductName?:string };
const json=(payload:unknown,status=200)=>Response.json(payload,{status,headers:CORS});
function errorText(error:unknown){return error instanceof Error?error.message:String(error||'Neznámá chyba');}
function normalize(value:unknown){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(akce|akcni|baleni|vybrane druhy|dle nabidky|chlazene|cerstve|clubcard|sleva|super cena)\b/g,' ').replace(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l|ks|%)\b/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();}
function tokenSet(value:unknown){return new Set(normalize(value).split(' ').filter((x)=>x.length>=3));}
function similarity(a:unknown,b:unknown){const l=tokenSet(a),r=tokenSet(b);if(!l.size||!r.size)return 0;let hit=0;for(const t of l)if(r.has(t))hit++;const coverage=hit/Math.min(l.size,r.size);const union=new Set([...l,...r]).size;return coverage*.72+(union?hit/union:0)*.28;}
function hostname(value:unknown){try{return new URL(String(value||'')).hostname.replace(/^www\./,'').toLowerCase();}catch{return '';}}
function isOfficialDomain(value:unknown){const host=hostname(value);return OFFICIAL_DOMAINS.some((d)=>host===d||host.endsWith(`.${d}`));}
function validProductImageUrl(value:unknown){const url=String(value||'').trim();if(!/^https:\/\//i.test(url))return null;const lower=url.toLowerCase();if(REJECTED_URL_PARTS.some((p)=>lower.includes(p)))return null;if(!/\.(?:jpe?g|png|webp|avif)(?:\?|$)/i.test(url))return null;return url;}
async function authorize(request:Request){const auth=request.headers.get('authorization')||'';if(auth===`Bearer ${SERVICE_ROLE_KEY}`)return true;if(CRON_SECRET&&request.headers.get('x-cron-secret')===CRON_SECRET)return true;const token=auth.replace(/^Bearer\s+/i,'').trim();if(!token)return false;const{data}=await db.auth.getUser(token);return ['admin','editor'].includes(String(data.user?.app_metadata?.role||'').toLowerCase());}

async function existingVerifiedImage(title:string):Promise<Match|null>{
  const probe=[...tokenSet(title)][0]; if(!probe)return null;
  const {data,error}=await db.from('products').select('id,name,image_url,image_verified,image_quality').eq('image_verified',true).gte('image_quality',70).not('image_url','is',null).ilike('name',`%${probe}%`).limit(120);
  if(error)throw error;
  let best:Match|null=null, second=0;
  for(const row of data||[]){const url=validProductImageUrl(row.image_url);if(!url)continue;const score=similarity(title,row.name);if(!best||score>best.score){second=best?.score||0;best={url,score,source:'verified_catalog',sourceProductId:String(row.id),sourceProductName:String(row.name||'')};}else if(score>second)second=score;}
  if(!best||best.score<.9||best.score-second<.12)return null;
  return best;
}

async function serpImage(title:string,storeName:string):Promise<Match|null>{
  if(!SERPAPI_KEY)return null;
  const endpoint=new URL('https://serpapi.com/search.json');
  endpoint.searchParams.set('engine','google_images');endpoint.searchParams.set('q',`"${title}" ${storeName} produkt -leták -letak -katalog`);endpoint.searchParams.set('hl','cs');endpoint.searchParams.set('gl','cz');endpoint.searchParams.set('safe','active');endpoint.searchParams.set('api_key',SERPAPI_KEY);
  const response=await fetch(endpoint,{signal:AbortSignal.timeout(20000)}).catch(()=>null);if(!response?.ok)return null;const payload=await response.json().catch(()=>({}));let best:Match|null=null;
  for(const item of payload?.images_results||[]){const url=validProductImageUrl(item.original)||validProductImageUrl(item.thumbnail);const sourceUrl=String(item.link||item.source||'');let score=similarity(title,`${item.title||''} ${item.source||''}`);if(!url||score<.64)continue;const official=isOfficialDomain(sourceUrl)||isOfficialDomain(url);if(official)score=Math.min(1,score+.12);const source=official?'official_web':'web_search';if(!best||score>best.score||(score===best.score&&source==='official_web'))best={url,score,source,sourceUrl:sourceUrl||url};}
  return best;
}

async function queueCandidate(offer:any,match:Match){
  if(!offer.product_id)throw new Error('Nabídka není propojena s hlavním produktem.');
  const sourceType=match.source==='official_web'?'official_catalog':match.source==='verified_catalog'?'product_database':'web_search';
  const quality=match.source==='verified_catalog'?82:match.source==='official_web'?78:68;
  const {error}=await db.from('product_image_candidates').upsert({
    product_id:offer.product_id,image_url:match.url,source_url:match.sourceUrl||match.url,source_domain:hostname(match.sourceUrl||match.url)||null,source_type:sourceType,
    quality_score:quality,match_score:Number(Math.min(match.score,1).toFixed(4)),status:'pending',
    metadata:{provider:match.source,offer_id:offer.id,offer_title:offer.title,source_product_id:match.sourceProductId||null,source_product_name:match.sourceProductName||null,automatic:false,review_required:true,policy:'review-only-v8'}
  },{onConflict:'product_id,image_url',ignoreDuplicates:true});
  if(error)throw error;
}

async function enrich(storeId?:string,limit=100){
  const today=new Date().toISOString().slice(0,10);
  let query=db.from('offers').select('id,product_id,title,store_id,image_url,stores(name,slug),products(image_url)').eq('status','published').eq('is_verified',true).lte('valid_from',today).gte('valid_to',today).order('published_at',{ascending:false}).limit(Math.max(1,Math.min(Number(limit)||100,200)));
  if(storeId)query=query.eq('store_id',storeId);
  const {data:offers,error}=await query;if(error)throw error;
  let queued=0,notFound=0,failed=0;const bySource:Record<string,number>={};const results:any[]=[];
  for(const offer of offers||[]){
    if(validProductImageUrl((offer as any).image_url)||validProductImageUrl((offer as any).products?.image_url))continue;
    try{const storeName=String((offer as any).stores?.name||(offer as any).stores?.slug||'');const match=await existingVerifiedImage(String(offer.title||''))||await serpImage(String(offer.title||''),storeName);if(!match){notFound++;results.push({offer_id:offer.id,title:offer.title,status:'not_found'});continue;}await queueCandidate(offer,match);queued++;bySource[match.source]=(bySource[match.source]||0)+1;results.push({offer_id:offer.id,title:offer.title,status:'queued_for_review',source:match.source,score:match.score});}catch(e){failed++;results.push({offer_id:offer.id,title:offer.title,status:'failed',error:errorText(e)});}
  }
  return{checked:offers?.length||0,mode:'review_only',applied:0,queued_for_review:queued,not_found:notFound,failed,by_source:bySource,serpapi_configured:Boolean(SERPAPI_KEY),results};
}

Deno.serve(async(request)=>{if(request.method==='OPTIONS')return new Response('ok',{headers:CORS});if(request.method!=='POST')return json({error:'Method not allowed'},405);if(!(await authorize(request)))return json({error:'Unauthorized'},401);try{const body=await request.json().catch(()=>({}));return json({ok:true,...await enrich(body.store_id,body.limit)});}catch(e){return json({error:errorText(e)},500);}});
