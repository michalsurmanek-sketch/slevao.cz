import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
};
const PROVIDERS = [
  { key: 'openfoodfacts', host: 'world.openfoodfacts.org' },
  { key: 'openproductsfacts', host: 'world.openproductsfacts.org' },
  { key: 'openbeautyfacts', host: 'world.openbeautyfacts.org' },
  { key: 'openpetfoodfacts', host: 'world.openpetfoodfacts.org' },
] as const;

type ProductRow = { id:string; name:string; brand:string|null; ean:string|null; quantity_text:string|null; filter_group:string|null; image_url:string|null };
type ProviderHit = { provider:string; host:string; image_url:string; source_url:string; product_name:string|null; brands:string|null; quantity:string|null };

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:CORS});
function digits(value:unknown){return String(value||'').replace(/\D/g,'');}
function validEan(value:unknown){const d=digits(value);return /^\d{8,14}$/.test(d)?d:null;}
function usableImage(value:unknown){const u=String(value||'').trim();return /^https:\/\//i.test(u)&&!/placeholder|no[-_ ]?image|default-image|favicon|logo|sprite|\.svg(?:\?|$)/i.test(u)?u:null;}
async function authorize(req:Request){const auth=req.headers.get('authorization')||'';if(auth===`Bearer ${SERVICE_ROLE_KEY}`)return true;if(CRON_SECRET&&req.headers.get('x-cron-secret')===CRON_SECRET)return true;const token=auth.replace(/^Bearer\s+/i,'').trim();if(!token)return false;const{data,error}=await db.auth.getUser(token);if(error||!data.user)return false;return ['admin','editor'].includes(String(data.user.app_metadata?.role||'').toLowerCase());}

async function providerHit(ean:string):Promise<ProviderHit|null>{
  for(const provider of PROVIDERS){
    const endpoint=`https://${provider.host}/api/v2/product/${encodeURIComponent(ean)}.json?fields=code,product_name,brands,quantity,image_front_url,image_front_small_url,image_url`;
    try{
      const response=await fetch(endpoint,{headers:{'user-agent':'Slevao.cz/1.0 product-image-review','accept':'application/json'},signal:AbortSignal.timeout(9000)});
      if(!response.ok)continue;
      const payload=await response.json().catch(()=>null);
      if(!payload||Number(payload.status)!==1)continue;
      const code=validEan(payload?.product?.code||payload?.code);
      if(code!==ean)continue;
      const product=payload.product||{};
      const image=usableImage(product.image_front_url)||usableImage(product.image_front_small_url)||usableImage(product.image_url);
      if(!image)continue;
      return{
        provider:provider.key,host:provider.host,image_url:image,source_url:`https://${provider.host}/product/${ean}`,
        product_name:product.product_name?String(product.product_name):null,brands:product.brands?String(product.brands):null,quantity:product.quantity?String(product.quantity):null,
      };
    }catch{/* try next provider */}
  }
  return null;
}

async function queue(product:ProductRow,hit:ProviderHit){
  const {error}=await db.from('product_image_candidates').upsert({
    product_id:product.id,
    image_url:hit.image_url,
    source_url:hit.source_url,
    source_domain:hit.host,
    source_type:'barcode_database',
    quality_score:88,
    match_score:1,
    status:'pending',
    metadata:{
      provider:hit.provider,
      workflow:'exact-ean-review-v1',
      exact_ean:true,
      ean:validEan(product.ean),
      provider_product_name:hit.product_name,
      provider_brands:hit.brands,
      provider_quantity:hit.quantity,
      product_name:product.name,
      product_brand:product.brand,
      product_quantity:product.quantity_text,
      automatic:false,
      review_required:true,
      queued_at:new Date().toISOString(),
    },
  },{onConflict:'product_id,image_url',ignoreDuplicates:true});
  if(error)throw error;
}

Deno.serve(async (req) => {
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  if(!(await authorize(req)))return json({error:'Unauthorized'},401);
  try{
    const body=await req.json().catch(()=>({}));
    const limit=Math.max(1,Math.min(Number(body.limit)||40,60));
    const inputIds=Array.isArray(body.product_ids)?body.product_ids.map(String).filter(Boolean):[];
    let query=db.from('products').select('id,name,brand,ean,quantity_text,filter_group,image_url').eq('is_active',true).is('image_url',null).not('ean','is',null).limit(limit);
    if(inputIds.length)query=query.in('id',inputIds.slice(0,limit));
    const {data:products,error}=await query;if(error)throw error;
    let checked=0,found=0,queued=0,notFound=0,failed=0;const results:any[]=[];
    for(const product of (products||[]) as ProductRow[]){
      const ean=validEan(product.ean);if(!ean)continue;checked++;
      try{
        const hit=await providerHit(ean);
        if(!hit){notFound++;results.push({product_id:product.id,name:product.name,ean,status:'not_found'});continue;}
        found++;
        await queue(product,hit);queued++;
        results.push({product_id:product.id,name:product.name,ean,status:'queued_for_review',provider:hit.provider,image_url:hit.image_url,source_url:hit.source_url});
      }catch(error){failed++;results.push({product_id:product.id,name:product.name,ean,status:'failed',error:error instanceof Error?error.message:String(error)});}
    }
    return json({ok:true,workflow:'exact-ean-review-v1',checked,found,queued_for_review:queued,not_found:notFound,failed,applied:0,results});
  }catch(error){return json({error:error instanceof Error?error.message:String(error)},500);}
});
