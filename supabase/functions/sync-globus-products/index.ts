import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET=Deno.env.get('CRON_SECRET')||'';
const HOUSE_NUMBER=4008;
const BRANCH_NAME='Olomouc';
const SOURCE_PAGE_URL='https://www.globus.cz/olomouc/hypermarket/akcni-nabidka';
const API_URL=`https://www.globus.cz/api/v1/gsoa/actionOffers/houses/${HOUSE_NUMBER}/actionProductsCatalog`;
const PAGE_SIZE=100,MIN_PRODUCTS=300,MAX_PRODUCTS=1000,MAX_PAGES=10,MAX_REPORTED_GAP=100,MAX_VALIDITY_DAYS=180,INVALID_VALIDITY_SENTINEL_YEAR=2100,API_PAGE_TIMEOUT_MS=12000;
const ADAPTER='globus-action-products-api-v1';
const PARSER_VERSION='globus-action-products-api-v2';
const TAXONOMY_VERSION='globus-productCategories-v1';
const MAX_TITLE_LENGTH=160;
const PUBLISH_CHUNK_SIZE=75;
const SAFE_FOOD_TAGS=new Set([
  'cls_czr_durable_foods','cls_czr_bakery_and_pastry_shop','cls_czr_milk_dairy_products_and_eggs','cls_czr_sweets','cls_czr_frozen_food',
  'cls_czr_sausages_and_delicatessen','cls_czr_ice_cream','cls_czr_cheese','cls_czr_pasta_couscous','cls_czr_side_dish_rice_pasta_leguminous'
]);
const SAFE_HOME_TAGS=new Set([
  'cls_czr_kitchen_utensils','cls_czr_cleaning_tools','cls_czr_household_goods','cls_czr_storage_of_food_and_liquids','cls_czr_mops_brooms_buckets'
]);
const db=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const CORS={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info,x-cron-secret','access-control-allow-methods':'POST,OPTIONS','content-type':'application/json; charset=utf-8'};

function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:CORS});}
function errorText(error:unknown){
  if(error instanceof Error){if(error.name==='AbortError')return `timeout po ${API_PAGE_TIMEOUT_MS} ms`;return error.message;}
  if(error&&typeof error==='object'){const v=error as Record<string,unknown>;return [v.message,v.details,v.hint,v.code].filter(Boolean).map(String).join(' | ')||JSON.stringify(v);}
  return String(error);
}
function allowed(req:Request){return req.headers.get('authorization')===`Bearer ${SERVICE_ROLE_KEY}`||Boolean(CRON_SECRET&&req.headers.get('x-cron-secret')===CRON_SECRET);}
function decodeHtml(value:unknown){return String(value??'').replace(/&nbsp;|&#160;/gi,' ').replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&#(\d+);/g,(_,c)=>String.fromCodePoint(Number(c))).replace(/&#x([0-9a-f]+);/gi,(_,c)=>String.fromCodePoint(parseInt(c,16)));}
function clean(value:unknown){return decodeHtml(value).replace(/<br\s*\/?>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();}
function titleText(product:any){
  const raw=String(product?.name??''),full=clean(raw); if(full&&full.length<=MAX_TITLE_LENGTH)return full;
  const bill=clean(product?.billName); if(bill.length>=3&&bill.length<=MAX_TITLE_LENGTH)return bill;
  const first=clean(raw.split(/(?:<br\s*\/?>\s*){2,}|\r?\n\s*\r?\n/i)[0]); if(first.length>=3&&first.length<=MAX_TITLE_LENGTH)return first;
  const shortened=full.slice(0,MAX_TITLE_LENGTH+1),boundary=shortened.lastIndexOf(' '); return (boundary>=40?shortened.slice(0,boundary):shortened.slice(0,MAX_TITLE_LENGTH)).trim();
}
function normalize(value:unknown){return clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('cs').replace(/[^a-z0-9]+/g,' ').trim();}
function money(value:unknown):number|null{const n=typeof value==='number'?value:Number(String(value??'').replace(',','.'));return Number.isFinite(n)&&n>0&&n<=100000?Math.round(n*100)/100:null;}
function sourceDate(value:unknown):string|null{const m=String(value??'').match(/^(\d{4}-\d{2}-\d{2})T/);return m?.[1]||null;}
function safeValidityWindow(from:string|null,to:string|null){
  if(!from||!to||from>to)return false;const y=Number(to.slice(0,4));if(!Number.isFinite(y)||y>=INVALID_VALIDITY_SENTINEL_YEAR)return false;
  const a=Date.parse(`${from}T00:00:00Z`),b=Date.parse(`${to}T00:00:00Z`);return Number.isFinite(a)&&Number.isFinite(b)&&b>=a&&Math.floor((b-a)/86400000)<=MAX_VALIDITY_DAYS;
}
function firstEan(value:unknown):string|null{for(const raw of (Array.isArray(value)?value:[value])){const d=String(raw??'').replace(/\D/g,'');if(d.length>=8&&d.length<=14)return d;}return null;}
function safeImage(...values:unknown[]):string|null{for(const value of values){const u=clean(value);if(/^https:\/\//i.test(u))return u;}return null;}
function quantityText(product:any):string|null{
  const a=Number(product?.unitAmount),raw=clean(product?.unitId).toLowerCase(),map:Record<string,string>={g:'g',kg:'kg',ml:'ml',l:'l',ks:'ks'},unit=map[raw];
  if(Number.isFinite(a)&&a>0&&unit)return `${Number.isInteger(a)?String(a):String(a).replace('.',',')} ${unit}`;
  return clean(product?.name).match(/\b\d+(?:[,.]\d+)?\s*(?:g|kg|ml|l|ks)\b/i)?.[0]||null;
}
function sourceTaxonomy(product:any){
  const tags=Array.isArray(product?.productCategories)?[...new Set(product.productCategories.map((x:unknown)=>clean(x)).filter(Boolean))]:[];
  const has=(t:string)=>tags.includes(t),hasAny=(s:Set<string>)=>tags.some(t=>s.has(t));
  let root:string|null=null;
  if(has('cls_czr_drinks'))root='Nápoje';
  else if(has('cls_czr_drugstore_and_cosmetics'))root='Drogerie';
  else if(has('cls_czr_car'))root='Auto';
  else if(has('cls_czr_school'))root='Škola';
  else if(has('cls_czr_electro'))root='Elektronika';
  else if(hasAny(SAFE_FOOD_TAGS))root='Potraviny';
  else if(hasAny(SAFE_HOME_TAGS))root='Domácnost';
  return {root,tags};
}
async function sha(value:string){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function fetchPage(page:number){
  const url=`${API_URL}?page=${page}&pageSize=${PAGE_SIZE}&listedProductOnly=true`;let last:unknown=null;
  for(let attempt=1;attempt<=2;attempt++){const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),API_PAGE_TIMEOUT_MS);try{
    const r=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',accept:'application/json','accept-language':'cs-CZ,cs;q=0.9',referer:SOURCE_PAGE_URL},redirect:'follow',signal:ctl.signal});
    if(!r.ok)throw new Error(`Globus API page ${page} HTTP ${r.status}`);const p=await r.json(),products=Array.isArray(p?.products)?p.products:[],totalCount=Number(p?.totalCount),more=p?.paginationShowMore===true;
    if(!Number.isFinite(totalCount)||totalCount<1)throw new Error(`Globus API page ${page} nemá platný totalCount.`);if(more&&!products.length)throw new Error(`Globus API page ${page} tvrdí další stránku, ale nevrátila produkty.`);
    return {products,totalCount,more};
  }catch(e){last=e;if(attempt<2)await new Promise(r=>setTimeout(r,350));}finally{clearTimeout(timer);}}
  throw new Error(`Globus API page ${page} selhala po 2 pokusech: ${errorText(last)}`);
}
async function fetchAllProducts(){
  const all:any[]=[],seen=new Set<string>();let reported:number|null=null,complete=false,pagesFetched=0,duplicates=0;
  for(let page=0;page<MAX_PAGES;page++){const r=await fetchPage(page);pagesFetched=page+1;if(reported===null)reported=r.totalCount;if(reported!==r.totalCount)throw new Error(`Globus totalCount se během stránkování změnil z ${reported} na ${r.totalCount}.`);
    for(const p of r.products){const vanr=clean(p?.vanr);if(!vanr)continue;if(seen.has(vanr)){duplicates++;continue;}seen.add(vanr);all.push(p);}if(!r.more){complete=true;break;}}
  if(!complete)throw new Error(`Globus pagination nedoběhla do konce do ${MAX_PAGES} stran.`);
  if(all.length<MIN_PRODUCTS)throw new Error(`Globus API vrátilo jen ${all.length} unikátních produktů; minimum je ${MIN_PRODUCTS}.`);
  if(all.length>MAX_PRODUCTS)throw new Error(`Globus API vrátilo podezřele mnoho produktů: ${all.length}.`);
  if(duplicates)throw new Error(`Globus API obsahuje ${duplicates} duplicitních VANR napříč stránkami.`);
  const gap=Math.max(0,Number(reported||0)-all.length);if(gap>MAX_REPORTED_GAP)throw new Error(`Globus API reportuje ${reported}, ale stránkovat lze jen ${all.length}; rozdíl ${gap} je nad limitem ${MAX_REPORTED_GAP}.`);
  return {products:all,reportedTotal:Number(reported||all.length),pagesFetched,gap};
}
function normalizeProduct(product:any){
  const h=product?.productInHouse||{},title=titleText(product),normalizedTitle=normalize(title),vanr=clean(product?.vanr),price=money(h?.actualPrice),original=money(h?.originalPrice),oldPrice=original&&price&&original>price?original:null,validFrom=sourceDate(h?.priceValidFrom),validTo=sourceDate(h?.priceValidTo),bonus=h?.bonusProgramPrice||null,bonusPrice=money(bonus?.actualPrice),image=safeImage(product?.imgThumbnail,product?.imgDetail,product?.imgIcon),ean=firstEan(product?.ean),brand=clean(product?.commonBrand?.name)||null,quantity=quantityText(product);
  if(!title||!normalizedTitle||!vanr||!price||!safeValidityWindow(validFrom,validTo))return null;
  return {external_id:`${HOUSE_NUMBER}:${vanr}`,title,normalized_title:normalizedTitle,brand,quantity_text:quantity,price,old_price:oldPrice,image_url:image,source_url:SOURCE_PAGE_URL,valid_from:validFrom,valid_to:validTo,confidence:0.995,metadata:{
    parser:PARSER_VERSION,structured_source:true,ai_used:false,branch:BRANCH_NAME,house_number:HOUSE_NUMBER,vanr,ean,
    availability:clean(h?.availability)||null,stock_amount:Number.isFinite(Number(h?.stockAmount))?Number(h.stockAmount):null,unit_amount:Number.isFinite(Number(product?.unitAmount))?Number(product.unitAmount):null,unit_id:clean(product?.unitId)||null,
    comparison_price:money(h?.comparisonPrice),comparison_unit:clean(h?.comparisonSaleUnitSizeText)||null,
    member_program:bonusPrice&&price&&bonusPrice<price?'Můj Globus':null,member_price:bonusPrice&&price&&bonusPrice<price?bonusPrice:null,member_price_valid_from:sourceDate(bonus?.priceValidFrom),member_price_valid_to:sourceDate(bonus?.priceValidTo),
    discount_percentage:Number.isFinite(Number(h?.discountPercentage))?Number(h.discountPercentage):null,price_tag_id:clean(h?.priceTagId)||null,price_type:clean(h?.priceType)||null
  }};
}
async function publishChunked(signature:string,rows:any[],reportedTotal:number){
  let stagedTotal=0;
  for(let offset=0;offset<rows.length;offset+=PUBLISH_CHUNK_SIZE){
    const chunk=rows.slice(offset,offset+PUBLISH_CHUNK_SIZE);
    const {data,error}=await db.rpc('stage_globus_offer_chunk',{p_signature:signature,p_rows:chunk});
    if(error)throw error;
    stagedTotal=Number(data?.staged_total||stagedTotal+chunk.length);
  }
  if(stagedTotal!==rows.length)throw new Error(`Globus staging incomplete: ${stagedTotal}/${rows.length}`);
  const {data,error}=await db.rpc('finalize_globus_staged_offers',{
    p_signature:signature,
    p_source_document_url:SOURCE_PAGE_URL,
    p_parser_version:PARSER_VERSION,
    p_reported_total_count:reportedTotal,
    p_accessible_product_count:rows.length
  });
  if(error)throw error;
  return data;
}
async function propagateSourceCategories(sourceRows:any[]){
  let updated=0,batches=0;
  for(let i=0;i<40;i++){const {data,error}=await db.rpc('propagate_globus_source_categories',{p_rows:sourceRows});if(error)throw error;const n=Number(data||0);updated+=n;batches++;if(n<12)break;}
  return {updated,batches};
}
async function markHealth(reason:string,error:string){try{const {data:store}=await db.from('stores').select('id').eq('slug','globus').maybeSingle();if(!store)return;await db.from('store_product_sync_state').update({adapter_name:ADAPTER,adapter_version:PARSER_VERSION,parser_version:PARSER_VERSION,source_type:'official-structured-api',source_category:'branch-action-offer',health_status:'degraded',health_reason:reason,minimum_offer_count:MIN_PRODUCTS,last_run_at:new Date().toISOString(),last_error:error,last_parser_error:error,updated_at:new Date().toISOString()}).eq('store_id',store.id);}catch{}}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(req.method!=='POST')return json({error:'Method not allowed'},405);
  if(!allowed(req))return json({error:'Unauthorized'},401);
  let dry=true;
  try{
    const body=await req.json().catch(()=>({}));dry=body.dry_run!==false;
    const fetched=await fetchAllProducts();
    const invalidValidityCount=fetched.products.filter(p=>{const h=p?.productInHouse||{};return !safeValidityWindow(sourceDate(h?.priceValidFrom),sourceDate(h?.priceValidTo));}).length;
    const rows=fetched.products.map(normalizeProduct).filter(Boolean) as any[];if(rows.length<MIN_PRODUCTS)throw new Error(`Po validaci zůstalo jen ${rows.length} Globus produktů.`);
    const rawByVanr=new Map(fetched.products.map((p:any)=>[clean(p?.vanr),p]));
    const sourceCategoryRows=rows.map((row:any)=>{const source=rawByVanr.get(clean(row?.metadata?.vanr));const taxonomy=sourceTaxonomy(source);if(!taxonomy.root)return null;return {external_id:row.external_id,metadata:{source_category_root:taxonomy.root,source_category_path:taxonomy.root,source_category_items:taxonomy.tags,source_category_source:TAXONOMY_VERSION}};}).filter(Boolean) as any[];
    const validityPairs=new Map<string,number>();let publicDiscounts=0,memberPrices=0,missingImages=0,sanitizedTitles=0;
    for(let i=0;i<rows.length;i++){const row=rows[i],source=fetched.products[i],key=`${row.valid_from}|${row.valid_to}`;validityPairs.set(key,(validityPairs.get(key)||0)+1);if(row.old_price&&row.old_price>row.price)publicDiscounts++;if(row.metadata?.member_price&&row.metadata.member_price<row.price)memberPrices++;if(!row.image_url)missingImages++;if(clean(source?.name)!==row.title)sanitizedTitles++;}
    const signature=await sha([PARSER_VERSION,HOUSE_NUMBER,fetched.reportedTotal,rows.length,...rows.map(row=>`${row.external_id}:${row.price}:${row.old_price||''}:${row.valid_from}:${row.valid_to}:${row.metadata?.member_price||''}`)].join('|'));
    const summary={ok:true,adapter:ADAPTER,parser_version:PARSER_VERSION,taxonomy_version:TAXONOMY_VERSION,branch:BRANCH_NAME,house_number:HOUSE_NUMBER,source_url:SOURCE_PAGE_URL,api_url:API_URL,reported_total_count:fetched.reportedTotal,accessible_product_count:fetched.products.length,validated_product_count:rows.length,invalid_validity_count:invalidValidityCount,max_validity_days:MAX_VALIDITY_DAYS,reported_gap:fetched.gap,pages_fetched:fetched.pagesFetched,validity_pair_count:validityPairs.size,public_discount_count:publicDiscounts,member_price_count:memberPrices,missing_image_count:missingImages,sanitized_title_count:sanitizedTitles,source_taxonomy_row_count:sourceCategoryRows.length,signature};
    if(dry)return json({...summary,dry_run:true,validity_pairs:[...validityPairs.entries()].map(([pair,count])=>{const [valid_from,valid_to]=pair.split('|');return {valid_from,valid_to,count};}).sort((a,b)=>b.count-a.count),samples:rows.slice(0,12)});
    const publish=await publishChunked(signature,rows,fetched.reportedTotal);
    const taxonomy=await propagateSourceCategories(sourceCategoryRows);
    return json({...summary,dry_run:false,publish,source_category_products_updated:taxonomy.updated,source_category_batches:taxonomy.batches});
  }catch(error){const message=errorText(error);if(!dry)await markHealth(`Globus Olomouc synchronizace selhala: ${message}`,message);return json({error:message,adapter:ADAPTER},500);}
});