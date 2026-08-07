import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const CLASSIFIER_MODEL = Deno.env.get('OPENAI_PRODUCT_IMAGE_CLASSIFIER_MODEL') || 'gpt-5.6-luna';
const IMAGE_MODEL = Deno.env.get('OPENAI_PRODUCT_IMAGE_MODEL') || 'gpt-image-2';
const BUCKET = 'product-images';
const FUNCTION_NAME = 'generate-generic-product-images';
const WORKER_SIZE = 2;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-cron-secret',
  'access-control-allow-methods': 'POST, OPTIONS',
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });
const now = () => new Date().toISOString();
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error || 'Neznámá chyba');
const OPENAI_BILLING_ERROR = /no credits remaining|insufficient[_ -]?quota|billing[_ -]?(?:hard[_ -]?limit)?|quota exceeded/i;
const isOpenAiBillingError = (error: unknown) => OPENAI_BILLING_ERROR.test(errorMessage(error));

function runInBackground(task: Promise<unknown>) {
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(task);
  else task.catch((error) => console.error('generic product image background task failed', error));
}

async function authorize(request: Request): Promise<string | null> {
  const authorization = request.headers.get('authorization') || '';
  if (authorization === `Bearer ${SERVICE_ROLE_KEY}`) return null;
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return null;
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('Unauthorized');
  const { data, error } = await db.auth.getUser(token);
  const role = String(data.user?.app_metadata?.role || '').toLowerCase();
  if (error || !data.user || !['admin', 'editor'].includes(role)) throw new Error('Unauthorized');
  return data.user.id;
}

function normalize(value: unknown): string {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs')
    .replace(/\b(akce|sleva|super cena|clubcard|vybrane druhy|dle nabidky)\b/g, ' ')
    .replace(/[^a-z0-9%]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function safeSegment(value: unknown, fallback = 'produkt'): string {
  return normalize(value).replace(/\s+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || fallback;
}
function cleanEan(value: unknown): string { return String(value || '').replace(/\D/g, ''); }
const BRAND_GUARD = /\b(coca[ -]?cola|nutella|nescafe|nescafé|kinder|madeta)\b/i;
function deterministicBlock(product: any) {
  if (String(product.brand || '').trim()) return { classification:'branded', status:'skipped_branded', reason:'Produkt má vyplněnou značku.' };
  if (BRAND_GUARD.test(String(product.name || ''))) return { classification:'branded', status:'skipped_branded', reason:'Název obsahuje známou značku.' };
  const ean = cleanEan(product.ean);
  if (ean.length >= 8 && ean.length <= 14) return { classification:'specific_packaged', status:'needs_manual_review', reason:'Produkt má EAN a může jít o konkrétní balený výrobek.' };
  return null;
}

function responseText(payload: any): string {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  for (const output of payload?.output || []) for (const part of output?.content || []) if (typeof part?.text === 'string' && part.text.trim()) return part.text;
  return '';
}

async function openaiStructured(prompt: string, schemaName: string, schema: any, imageDataUrl?: string): Promise<any> {
  if (!OPENAI_API_KEY) throw new Error('V Supabase chybí OPENAI_API_KEY.');
  const content: any[] = [{ type:'input_text', text:prompt }];
  if (imageDataUrl) content.push({ type:'input_image', image_url:imageDataUrl, detail:'high' });
  const response = await fetch('https://api.openai.com/v1/responses', {
    method:'POST', headers:{ authorization:`Bearer ${OPENAI_API_KEY}`, 'content-type':'application/json' },
    body:JSON.stringify({ model:CLASSIFIER_MODEL, store:false, input:[{ role:'user', content }], text:{ format:{ type:'json_schema', name:schemaName, strict:true, schema } } }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI Responses HTTP ${response.status}`);
  const text = responseText(payload);
  if (!text) throw new Error('OpenAI nevrátil strukturovaný výsledek.');
  return JSON.parse(text);
}

async function classify(products: any[]): Promise<Map<string, any>> {
  if (!products.length) return new Map();
  const schema = { type:'object', additionalProperties:false, required:['items'], properties:{ items:{ type:'array', maxItems:50, items:{ type:'object', additionalProperties:false, required:['product_id','generate','classification','normalized_name','product_type','variant','quantity_text','reason'], properties:{ product_id:{type:'string'}, generate:{type:'boolean'}, classification:{type:'string',enum:['unbranded_generic','branded','ambiguous','specific_packaged']}, normalized_name:{type:'string'}, product_type:{type:'string'}, variant:{type:'string'}, quantity_text:{type:'string'}, reason:{type:'string'} } } } } };
  const input = products.map((p) => ({ product_id:String(p.id), name:String(p.name || ''), brand:String(p.brand || ''), quantity_text:String(p.quantity_text || '') }));
  const prompt = `Jsi konzervativní klasifikátor produktů pro Slevao.cz. Rozhoduješ, zda je bezpečné vytvořit NEZNAČKOVOU ilustrační produktovou fotografii. Generovat smíš pouze jasné obecné potraviny nezávislé na značce: ovoce, zelenina, brambory, cibule, rajčata, papriky a jejich barvy, hrozny bílé/tmavé, běžné pečivo, vejce, syrové maso a jasné řezy (kuřecí prsa/stehna/křídla, vepřová kýta bez kosti), jasné rybí filety a podobné základní komodity. Jednoduchý základní mléčný produkt povol jen tehdy, když jej lze zobrazit neutrálně bez loga a vymyšlené značky. Pokud název působí jako značka, obchodní řada, konkrétní receptura/příchuť, hotové jídlo, doplněk, kosmetika, drogerie, technika, nebo je význam nejistý, generate=false. Nikdy nevymýšlej značku. Variantu (barvu, filet, s kůží, bez kosti apod.) zachovej přesně. Gramáž použij jen pro pochopení produktu, ne jako důvod vymýšlet obal. Vrať právě jeden záznam pro každý product_id. Produkty: ${JSON.stringify(input)}`;
  const parsed = await openaiStructured(prompt, 'slevao_unbranded_product_classification', schema);
  return new Map((parsed.items || []).map((item: any) => [String(item.product_id), item]));
}

function imagePrompt(product: any, classification: any): string {
  const variant = String(classification.variant || '').trim();
  const quantity = String(classification.quantity_text || product.quantity_text || '').trim();
  return ['Fotorealistická prémiová produktová fotografie pro čistý český e-shop.', `Produkt: ${classification.product_type || product.name}.`, variant ? `Přesná varianta: ${variant}.` : '', quantity ? `Množství nebo velikost pouze respektuj přirozeně, pokud je vizuálně relevantní: ${quantity}.` : '', 'Absolutně čisté jednolité bílé pozadí #FFFFFF, bez horizontu a bez dekorací.', 'Produkt přesně uprostřed, celý viditelný, realistické proporce, přirozené studiové světlo, jemný přirozený stín přímo pod produktem.', 'Žádný text, žádná cena, žádný watermark, žádné logo, žádná značka, žádná reklamní grafika.', 'U nebaleného ovoce, zeleniny, masa, ryb a pečiva nepoužívej žádný obal. U vajec může být několik vajec nebo jednoduché neoznačené plato.', 'Pokud produkt skutečně potřebuje nádobu, smí být jen zcela neutrální bez etikety, textu nebo značky.', 'Nevytvářej jinou příchuť, barvu, řez masa, druh ryby ani variantu, než určuje název.'].filter(Boolean).join(' ');
}

function base64ToBytes(value: string): Uint8Array { const binary=atob(value); const bytes=new Uint8Array(binary.length); for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i); return bytes; }
function bytesToBase64(bytes: Uint8Array): string { let binary=''; const chunk=0x8000; for(let i=0;i<bytes.length;i+=chunk) binary+=String.fromCharCode(...bytes.subarray(i,i+chunk)); return btoa(binary); }

async function generateImage(prompt: string): Promise<Uint8Array> {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method:'POST', headers:{ authorization:`Bearer ${OPENAI_API_KEY}`, 'content-type':'application/json' },
    body:JSON.stringify({ model:IMAGE_MODEL, prompt, size:'1024x1024', quality:'medium', background:'opaque', output_format:'webp', n:1 }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI Images HTTP ${response.status}`);
  const item = payload?.data?.[0];
  if (typeof item?.b64_json === 'string' && item.b64_json) return base64ToBytes(item.b64_json);
  if (typeof item?.url === 'string' && /^https:\/\//i.test(item.url)) { const imageResponse=await fetch(item.url); if(!imageResponse.ok) throw new Error(`Stažení obrázku selhalo: HTTP ${imageResponse.status}`); return new Uint8Array(await imageResponse.arrayBuffer()); }
  throw new Error('OpenAI Images nevrátil obrázek.');
}
async function sha256(bytes: Uint8Array): Promise<string> { const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)); return [...digest].map((x)=>x.toString(16).padStart(2,'0')).join(''); }

async function visualQc(product: any, classification: any, bytes: Uint8Array): Promise<any> {
  const schema = { type:'object', additionalProperties:false, required:['product_matches','variant_matches','generic_unbranded','clean_white_background','no_logo_or_brand','no_text','no_price','no_watermark','packaging_is_appropriate','realistic','quality_score','confidence','reason'], properties:{ product_matches:{type:'boolean'}, variant_matches:{type:'boolean'}, generic_unbranded:{type:'boolean'}, clean_white_background:{type:'boolean'}, no_logo_or_brand:{type:'boolean'}, no_text:{type:'boolean'}, no_price:{type:'boolean'}, no_watermark:{type:'boolean'}, packaging_is_appropriate:{type:'boolean'}, realistic:{type:'boolean'}, quality_score:{type:'integer',minimum:0,maximum:100}, confidence:{type:'number',minimum:0,maximum:1}, reason:{type:'string'} } };
  const prompt = `Zkontroluj vygenerovanou produktovou fotografii pro Slevao.cz. Očekávaný produkt: ${product.name}. Typ: ${classification.product_type}. Varianta: ${classification.variant || 'bez zvláštní varianty'}. Obrázek může být automaticky přiřazen pouze pokud jde jednoznačně o tento obecný neznačkový produkt, varianta sedí, pozadí je čistě bílé, nejsou vidět žádná loga/značky, texty, ceny ani watermarky, obal není vymyšlený nebo nevhodný a fotografie působí realisticky jako e-shopová produktová fotografie.`;
  return openaiStructured(prompt, 'slevao_generated_product_image_qc', schema, `data:image/webp;base64,${bytesToBase64(bytes)}`);
}
function qcSafe(qc: any): boolean { return Boolean(qc?.product_matches&&qc?.variant_matches&&qc?.generic_unbranded&&qc?.clean_white_background&&qc?.no_logo_or_brand&&qc?.no_text&&qc?.no_price&&qc?.no_watermark&&qc?.packaging_is_appropriate&&qc?.realistic&&Number(qc?.quality_score||0)>=80&&Number(qc?.confidence||0)>=0.90); }

async function uploadGenerated(product: any, bytes: Uint8Array) {
  const filename=`${safeSegment(product.name)}-${String(product.id).slice(0,8)}.webp`;
  const path=`generated/unbranded/${product.id}/${filename}`;
  const upload=await db.storage.from(BUCKET).upload(path,bytes,{contentType:'image/webp',cacheControl:'31536000',upsert:true});
  if(upload.error) throw upload.error;
  const url=db.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl;
  if(!url) throw new Error('Nepodařilo se získat veřejnou URL vygenerovaného obrázku.');
  return {url,path};
}

async function scheduleWorker(runId:string){
  const response=await fetch(`${SUPABASE_URL}/functions/v1/${FUNCTION_NAME}`,{method:'POST',headers:{authorization:`Bearer ${SERVICE_ROLE_KEY}`,apikey:SERVICE_ROLE_KEY,'content-type':'application/json'},body:JSON.stringify({mode:'worker',run_id:runId})});
  if(!response.ok) console.error('Nepodařilo se naplánovat další worker',response.status,await response.text().catch(()=>''));
}
async function saveJob(product:any,runId:string,patch:any){ const {error}=await db.from('product_image_generation_jobs').upsert({run_id:runId,product_id:product.id,normalized_name:patch.normalized_name||normalize(product.name),quantity_text:patch.quantity_text||product.quantity_text||null,...patch},{onConflict:'product_id'}); if(error) throw error; }
async function runCounts(runId:string){const result=await db.from('product_image_generation_jobs').select('status').eq('run_id',runId);if(result.error)throw result.error;const jobs=result.data||[];const count=(status:string)=>jobs.filter((x:any)=>x.status===status).length;return{processed_count:jobs.length,assigned_count:count('assigned'),manual_count:count('needs_manual_review'),skipped_branded_count:count('skipped_branded'),failed_count:count('failed')}}

async function seedRun(requestedBy:string|null,requestedLimit:unknown){
  if(!OPENAI_API_KEY) throw new Error('V Supabase chybí OPENAI_API_KEY.');
  const limit=Math.max(1,Math.min(Number(requestedLimit)||20,50));
  const since=new Date(Date.now()-2*60*60*1000).toISOString();
  const active=await db.from('product_image_generation_runs').select('id',{count:'exact',head:true}).in('status',['queued','processing']).gte('created_at',since);
  if(active.error) throw active.error;
  if((active.count||0)>0) return {accepted:false,message:'Předchozí dávka generování ještě běží.'};
  const missing=await db.from('products_missing_verified_images').select('id,name,brand,ean,quantity_text,active_offer_count,active_store_count,last_offer_at').gt('active_offer_count',0).order('active_offer_count',{ascending:false}).limit(500);
  if(missing.error) throw missing.error;
  const rows=missing.data||[]; if(!rows.length) return {accepted:false,message:'Nejsou produkty bez kvalitní fotografie.'};
  const ids=rows.map((x:any)=>x.id);
  const existing=await db.from('product_image_generation_jobs').select('product_id,status,attempt_count').in('product_id',ids); if(existing.error) throw existing.error;
  const existingById=new Map((existing.data||[]).map((x:any)=>[String(x.product_id),x]));
  const selected=rows.filter((p:any)=>{const job:any=existingById.get(String(p.id));return !job||(job.status==='failed'&&Number(job.attempt_count||0)<2)}).slice(0,limit);
  if(!selected.length) return {accepted:false,message:'Všechny chybějící produkty už mají stav v generovací frontě.'};
  const runInsert=await db.from('product_image_generation_runs').insert({requested_by:requestedBy,status:'processing',requested_count:selected.length,started_at:now(),message:'Klasifikuji produkty a připravuji bezpečnou frontu.'}).select('id').single();
  if(runInsert.error) throw runInsert.error; const runId=String(runInsert.data.id);
  const aiInput:any[]=[];
  for(const product of selected){const blocked=deterministicBlock(product);if(blocked) await saveJob(product,runId,{status:blocked.status,classification:blocked.classification,reason:blocked.reason,metadata:{generation_workflow:'unbranded_v1',deterministic_block:true}});else aiInput.push(product)}
  let classified=new Map<string,any>();
  try{classified=await classify(aiInput)}catch(error){
    if(isOpenAiBillingError(error)){
      const message=errorMessage(error).slice(0,1000);
      for(const product of aiInput) await saveJob(product,runId,{status:'failed',classification:'ambiguous',attempt_count:0,last_error:message,reason:'OpenAI API nemá dostupný kredit; produkt zůstává připravený k automatickému opakování.',metadata:{generation_workflow:'unbranded_v1',provider_blocked:'openai_billing'}});
      const counts=await runCounts(runId);
      await db.from('product_image_generation_runs').update({status:'failed',...counts,message:'OpenAI API nemá dostupný kredit. Žádné generování nebylo provedeno a produkty zůstávají připravené k opakování.',finished_at:now()}).eq('id',runId);
      return {accepted:false,blocked_reason:'openai_billing',run_id:runId,selected_count:selected.length,queued_count:0,message:'OpenAI API nemá dostupný kredit. Produkty nebyly ztraceny a lze je později automaticky zopakovat.'};
    }
    const reason=`Klasifikace selhala bezpečně: ${errorMessage(error)}`;
    for(const product of aiInput) await saveJob(product,runId,{status:'needs_manual_review',classification:'ambiguous',reason,metadata:{generation_workflow:'unbranded_v1',classifier_error:true}})
  }
  if(classified.size) for(const product of aiInput){const item=classified.get(String(product.id));if(!item){await saveJob(product,runId,{status:'needs_manual_review',classification:'ambiguous',reason:'Klasifikátor nevrátil tento produkt.',metadata:{generation_workflow:'unbranded_v1'}});continue}const status=item.generate&&item.classification==='unbranded_generic'?'queued_for_generation':item.classification==='branded'?'skipped_branded':'needs_manual_review';await saveJob(product,runId,{status,classification:item.classification,normalized_name:item.normalized_name||normalize(product.name),product_type:item.product_type||product.name,variant:item.variant||null,quantity_text:item.quantity_text||product.quantity_text||null,reason:item.reason||null,metadata:{generation_workflow:'unbranded_v1',classifier_model:CLASSIFIER_MODEL}})}
  const queued=await db.from('product_image_generation_jobs').select('id',{count:'exact',head:true}).eq('run_id',runId).eq('status','queued_for_generation'); if(queued.error) throw queued.error;
  if((queued.count||0)>0) runInBackground(scheduleWorker(runId)); else runInBackground(finalizeRun(runId));
  return {accepted:true,run_id:runId,selected_count:selected.length,queued_count:queued.count||0};
}

async function processJob(job:any):Promise<'openai_billing'|void>{
  const attempt=Number(job.attempt_count||0)+1;
  const start=await db.from('product_image_generation_jobs').update({status:'generating',attempt_count:attempt,started_at:now(),last_error:null}).eq('id',job.id).eq('status','queued_for_generation'); if(start.error) throw start.error;
  try{
    const productResult=await db.from('products').select('id,name,brand,ean,quantity_text,image_url,image_verified,image_quality').eq('id',job.product_id).single(); if(productResult.error) throw productResult.error; const product=productResult.data;
    if(product.image_url&&product.image_verified&&Number(product.image_quality||0)>=70){await db.from('product_image_generation_jobs').update({status:'assigned',reason:'Produkt mezitím získal ověřenou fotografii.',assigned_at:now()}).eq('id',job.id);return}
    const blocked=deterministicBlock(product); if(blocked){await db.from('product_image_generation_jobs').update({status:blocked.status,classification:blocked.classification,reason:blocked.reason}).eq('id',job.id);return}
    if(job.classification!=='unbranded_generic'){await db.from('product_image_generation_jobs').update({status:'needs_manual_review',reason:'Před generováním nebyla potvrzena neznačková klasifikace.'}).eq('id',job.id);return}
    const prompt=imagePrompt(product,job); const bytes=await generateImage(prompt); if(bytes.length<20000||bytes.length>12*1024*1024) throw new Error(`Neobvyklá velikost obrázku: ${bytes.length} B`); const hash=await sha256(bytes);
    const duplicate=await db.from('product_image_generation_jobs').select('product_id,image_url,status').eq('image_hash',hash).neq('product_id',product.id).in('status',['generated','assigned']).limit(1); if(duplicate.error) throw duplicate.error;
    if((duplicate.data||[]).length){await db.from('product_image_generation_jobs').update({status:'needs_manual_review',image_hash:hash,reason:'Stejný obrazový hash už používá jiný produkt.',prompt}).eq('id',job.id);return}
    const stored=await uploadGenerated(product,bytes);
    await db.from('product_image_generation_jobs').update({status:'generated',prompt,image_url:stored.url,image_hash:hash,generated_at:now(),metadata:{...(job.metadata||{}),storage_path:stored.path,image_model:IMAGE_MODEL}}).eq('id',job.id);
    const qc=await visualQc(product,job,bytes); const safe=qcSafe(qc);
    const candidateMetadata={generation_workflow:'unbranded_v1',provider:'openai',image_model:IMAGE_MODEL,classifier_model:CLASSIFIER_MODEL,auto_approved:safe,product_classification:{classification:job.classification,normalized_name:job.normalized_name,product_type:job.product_type,variant:job.variant,quantity_text:job.quantity_text},visual_validation:{product_matches:Boolean(qc.product_matches),front_or_catalog_view:true,package_quantity_matches:Boolean(qc.variant_matches),hands_or_people:false,back_label_dominant:false,price_or_promo_overlay:!qc.no_price,text_dominant:!qc.no_text,clean_background:Boolean(qc.clean_white_background),shelf_or_scene:false,quality_score:Number(qc.quality_score||0),confidence:Number(qc.confidence||0)},qc};
    const candidate=await db.from('product_image_candidates').upsert({product_id:product.id,image_url:stored.url,source_url:null,source_domain:'openai-generated',source_type:'unknown',width:1024,height:1024,file_size_bytes:bytes.length,mime_type:'image/webp',quality_score:Math.max(0,Math.min(100,Number(qc.quality_score||0))),match_score:Math.max(0,Math.min(1,Number(qc.confidence||0))),has_clean_background:Boolean(qc.clean_white_background),has_text_overlay:!qc.no_text,has_price_overlay:!qc.no_price,status:'pending',rejection_reason:null,metadata:candidateMetadata},{onConflict:'product_id,image_url'}).select('id').single(); if(candidate.error) throw candidate.error;
    await db.from('product_image_generation_jobs').update({candidate_id:candidate.data.id,metadata:{...(job.metadata||{}),storage_path:stored.path,image_model:IMAGE_MODEL,qc}}).eq('id',job.id);
    if(!safe){await db.from('product_image_generation_jobs').update({status:'needs_manual_review',reason:`Vizuální QC neprošlo: ${String(qc.reason||'nesplněná bezpečnostní kritéria')}`}).eq('id',job.id);return}
    const approve=await db.from('product_image_candidates').update({status:'approved',metadata:candidateMetadata}).eq('id',candidate.data.id).eq('status','pending'); if(approve.error) throw approve.error;
    const verification=await db.from('products').select('image_url,image_verified,image_quality').eq('id',product.id).single(); if(verification.error) throw verification.error;
    const assigned=verification.data.image_url===stored.url&&verification.data.image_verified&&Number(verification.data.image_quality||0)>=70; if(!assigned) throw new Error('Schválený obrázek se nepropsal do hlavního produktu.');
    await db.from('product_image_library').update({image_hash:hash}).eq('product_id',product.id).eq('image_url',stored.url).eq('is_active',true);
    await db.from('product_image_generation_jobs').update({status:'assigned',assigned_at:now(),reason:'Automaticky přiřazeno po dvojité kontrole.',metadata:{...(job.metadata||{}),storage_path:stored.path,image_model:IMAGE_MODEL,qc,assignment_verified:true}}).eq('id',job.id);
  }catch(error){
    const message=errorMessage(error).slice(0,1000);
    if(isOpenAiBillingError(error)){
      await db.from('product_image_generation_jobs').update({status:'failed',attempt_count:0,last_error:message,reason:'OpenAI API nemá dostupný kredit; produkt zůstává připravený k automatickému opakování.'}).eq('id',job.id);
      return 'openai_billing';
    }
    const retry=attempt<2;
    await db.from('product_image_generation_jobs').update({status:retry?'queued_for_generation':'failed',last_error:message,reason:retry?'Dočasná chyba, worker provede jeden automatický opakovaný pokus.':'Generování selhalo po opakovaném pokusu.'}).eq('id',job.id)
  }
}

async function finalizeRun(runId:string){
  const result=await db.from('product_image_generation_jobs').select('status,image_url,image_hash,metadata').eq('run_id',runId); if(result.error) throw result.error; const jobs=result.data||[]; const count=(status:string)=>jobs.filter((x:any)=>x.status===status).length;
  if(count('queued_for_generation')+count('generating')>0) return;
  const assignedJobs=jobs.filter((x:any)=>x.status==='assigned'); const hashes=assignedJobs.map((x:any)=>x.image_hash).filter(Boolean); const duplicates=hashes.filter((h:string,i:number)=>hashes.indexOf(h)!==i);
  const verification={duplicate_hashes:[...new Set(duplicates)],white_background_pass:assignedJobs.every((x:any)=>x.metadata?.qc?.clean_white_background===true),filename_pass:assignedJobs.every((x:any)=>/\/generated\/unbranded\/[^/]+\/[^/]+\.webp(?:\?|$)/i.test(String(x.image_url||''))),assignment_pass:assignedJobs.every((x:any)=>x.metadata?.assignment_verified===true)};
  (verification as any).all_assigned_safe=(verification as any).duplicate_hashes.length===0&&verification.white_background_pass&&verification.filename_pass&&verification.assignment_pass;
  const assigned=count('assigned'),manual=count('needs_manual_review'),skipped=count('skipped_branded'),failed=count('failed');
  await db.from('product_image_generation_runs').update({status:'completed',processed_count:jobs.length,assigned_count:assigned,manual_count:manual,skipped_branded_count:skipped,failed_count:failed,verification,message:`Hotovo: ${assigned} přiřazeno, ${manual} ruční kontrola, ${skipped} značkové přeskočeno, ${failed} chyby.`,finished_at:now()}).eq('id',runId);
}

async function processWorker(runId:string){
  try{
    const run=await db.from('product_image_generation_runs').select('id,status').eq('id',runId).maybeSingle();if(run.error||!run.data||run.data.status!=='processing') return;
    const queued=await db.from('product_image_generation_jobs').select('*').eq('run_id',runId).eq('status','queued_for_generation').order('updated_at',{ascending:true}).limit(WORKER_SIZE);if(queued.error) throw queued.error;
    if(!(queued.data||[]).length){await finalizeRun(runId);return}
    const outcomes=await Promise.all((queued.data||[]).map(processJob));
    if(outcomes.includes('openai_billing')){
      await db.from('product_image_generation_jobs').update({status:'failed',attempt_count:0,last_error:'OpenAI API nemá dostupný kredit.',reason:'OpenAI API nemá dostupný kredit; produkt zůstává připravený k automatickému opakování.'}).eq('run_id',runId).eq('status','queued_for_generation');
      const counts=await runCounts(runId);
      await db.from('product_image_generation_runs').update({status:'failed',...counts,message:'OpenAI API nemá dostupný kredit. Worker byl zastaven bez dalších pokusů a produkty zůstávají připravené k opakování.',finished_at:now()}).eq('id',runId);
      return;
    }
    const remaining=await db.from('product_image_generation_jobs').select('id',{count:'exact',head:true}).eq('run_id',runId).eq('status','queued_for_generation');if(remaining.error) throw remaining.error;if((remaining.count||0)>0) await scheduleWorker(runId);else await finalizeRun(runId)
  }catch(error){console.error('worker failed',error);await db.from('product_image_generation_runs').update({status:'failed',message:`Worker selhal: ${errorMessage(error).slice(0,1000)}`,finished_at:now()}).eq('id',runId)}
}

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS') return new Response('ok',{headers:CORS});
  if(request.method!=='POST') return json({ok:false,error:'Method not allowed'},405);
  try{const requestedBy=await authorize(request);const body=await request.json().catch(()=>({}));if(body.mode==='worker'){if(!body.run_id) return json({ok:false,error:'Chybí run_id.'},400);runInBackground(processWorker(String(body.run_id)));return json({ok:true,accepted:true,worker:true},202)}const result=await seedRun(requestedBy,body.limit);return json({ok:true,...result},result.accepted?202:200)}catch(error){const message=errorMessage(error);return json({ok:false,error:message},message==='Unauthorized'?401:500)}
});