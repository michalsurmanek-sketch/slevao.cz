import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-5-mini';
const PAGE_BUCKET = 'product-images';
const MAX_PAGE_GROUPS_PER_RUN = 3;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, x-client-info, content-type, x-cron-secret',
};
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

type ImportItem = {
  id: string;
  import_id: string;
  product_id: string | null;
  title: string;
  brand: string | null;
  quantity_text: string | null;
  price: number | string | null;
  image_url: string | null;
  source_page: number | null;
  status: string;
  raw_data: Record<string, unknown> | null;
};
type CropBox = {
  item_id: string;
  has_product_image: boolean;
  x_pct: number | null;
  y_pct: number | null;
  width_pct: number | null;
  height_pct: number | null;
  confidence: number;
};
class DependencyBlockedError extends Error {
  retryAfterHours: number;
  constructor(message: string, retryAfterHours = 6) {
    super(message);
    this.name = 'DependencyBlockedError';
    this.retryAfterHours = retryAfterHours;
  }
}

function json(body: unknown, status = 200) { return Response.json(body, { status, headers: CORS_HEADERS }); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error || 'Neznámá chyba.'); }
function runInBackground(task: Promise<unknown>) {
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(task);
  else task.catch((error) => console.error('Background crop task failed:', error));
}
async function authorize(request: Request) {
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return;
  const authorization = request.headers.get('authorization') || '';
  if (authorization === `Bearer ${SERVICE_ROLE_KEY}`) return;
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new Error('Unauthorized');
  const { data, error } = await db.auth.getUser(token);
  const role = String(data.user?.app_metadata?.role || '').toLowerCase();
  if (error || !data.user || !['admin', 'editor'].includes(role)) throw new Error('Unauthorized');
}
function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  return btoa(binary);
}
function responseText(payload: any) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  for (const output of payload?.output || []) for (const part of output?.content || []) if (typeof part?.text === 'string' && part.text.trim()) return part.text;
  return '';
}
function safeSegment(value: unknown, fallback: string) {
  const clean = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return clean || fallback;
}
function stableHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
function detectImage(bytes: Uint8Array, suggestedMime: unknown) {
  const mime = String(suggestedMime || '').toLowerCase().split(';')[0].trim();
  if (mime === 'image/webp' || (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP')) return { mime: 'image/webp', extension: 'webp' };
  if (mime === 'image/png' || (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) return { mime: 'image/png', extension: 'png' };
  if (mime === 'image/jpeg' || (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return { mime: 'image/jpeg', extension: 'jpg' };
  throw new Error('Výřezy podporují pouze stránku ve formátu WebP, PNG nebo JPG.');
}
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function normalizedBox(box: CropBox) {
  if (!box.has_product_image) return null;
  const rawX = Number(box.x_pct), rawY = Number(box.y_pct), rawW = Number(box.width_pct), rawH = Number(box.height_pct);
  const confidence = clamp(Number(box.confidence || 0), 0, 1);
  if (![rawX, rawY, rawW, rawH].every(Number.isFinite)) return null;
  if (rawW < 3 || rawH < 3 || rawW > 95 || rawH > 95 || confidence < 0.62) return null;
  const padding = 2.2;
  const x = clamp(rawX - padding, 0, 97), y = clamp(rawY - padding, 0, 97);
  return { x:Number(x.toFixed(3)), y:Number(y.toFixed(3)), width:Number(clamp(rawW + padding * 2, 3, 100 - x).toFixed(3)), height:Number(clamp(rawH + padding * 2, 3, 100 - y).toFixed(3)), confidence };
}
function cropUrl(pageUrl: string, box: ReturnType<typeof normalizedBox>) {
  if (!box) return null;
  const params = new URLSearchParams({ url:pageUrl, cx:`${box.x}%`, cy:`${box.y}%`, cw:`${box.width}%`, ch:`${box.height}%`, precrop:'1', w:'720', h:'720', fit:'contain', output:'webp', q:'86' });
  return `https://wsrv.nl/?${params.toString()}`;
}
function itemPageSource(item: ImportItem) { return String((item.raw_data as any)?.page_image_url || '').trim(); }
function pageSource(job: any, pageNumber: number, sourceOverride = '') {
  if (sourceOverride) return sourceOverride;
  const pages = Array.isArray(job.metadata?.page_image_urls) ? job.metadata.page_image_urls : [];
  return String(pages[pageNumber - 1] || '').trim() || String(job.source_document_url || '');
}
async function loadPage(job: any, pageNumber: number, sourceOverride = '') {
  const bucket = String(job.metadata?.storage_bucket || ''), path = String(job.metadata?.storage_path || '');
  let bytes: Uint8Array, mime = String(job.metadata?.content_type || '');
  if (bucket && path && !Array.isArray(job.metadata?.page_image_urls)) {
    const downloaded = await db.storage.from(bucket).download(path);
    if (downloaded.error || !downloaded.data) throw downloaded.error || new Error('Uloženou stránku letáku nelze stáhnout.');
    bytes = new Uint8Array(await downloaded.data.arrayBuffer()); mime = downloaded.data.type || mime;
  } else {
    const source = pageSource(job, pageNumber, sourceOverride);
    if (!/^https:\/\//i.test(source)) throw new Error(`Stránka ${pageNumber} nemá bezpečnou HTTPS adresu obrázku.`);
    const response = await fetch(source, { redirect:'follow' });
    if (!response.ok) throw new Error(`Stažení stránky letáku selhalo: HTTP ${response.status}`);
    bytes = new Uint8Array(await response.arrayBuffer()); mime = response.headers.get('content-type') || mime;
  }
  if (!bytes.length) throw new Error('Stránka letáku je prázdná.');
  if (bytes.length > 8 * 1024 * 1024) throw new Error('Stránka letáku je větší než 8 MB.');
  return { bytes, ...detectImage(bytes, mime) };
}
async function ensurePublicPage(job: any, page: { bytes:Uint8Array; mime:string; extension:string }, pageNumber: number, sourceUrl: string) {
  const store = safeSegment(job.stores?.slug || job.store_id, 'store');
  const batch = safeSegment(job.metadata?.page_batch_id || job.id, job.id);
  const hash = safeSegment(String(job.metadata?.sha256 || job.source_hash || job.id).slice(0, 20), 'page');
  const sourceHash = stableHash(sourceUrl || String(job.source_document_url || ''));
  const path = `leaflet-pages/${store}/${batch}/page-${String(pageNumber).padStart(3, '0')}-${sourceHash}-${hash}.${page.extension}`;
  const upload = await db.storage.from(PAGE_BUCKET).upload(path, page.bytes, { contentType:page.mime, cacheControl:'31536000', upsert:true });
  if (upload.error) throw upload.error;
  const url = db.storage.from(PAGE_BUCKET).getPublicUrl(path).data?.publicUrl;
  if (!url) throw new Error('Nepodařilo se vytvořit veřejnou adresu stránky letáku.');
  return url;
}
async function locateBoxes(page: { bytes:Uint8Array; mime:string }, items: ImportItem[], storeName: string): Promise<CropBox[]> {
  if (!OPENAI_API_KEY) throw new DependencyBlockedError('V Supabase chybí OPENAI_API_KEY.', 24);
  const schema = { type:'object', additionalProperties:false, required:['boxes'], properties:{ boxes:{ type:'array', maxItems:120, items:{ type:'object', additionalProperties:false, required:['item_id','has_product_image','x_pct','y_pct','width_pct','height_pct','confidence'], properties:{ item_id:{type:'string'}, has_product_image:{type:'boolean'}, x_pct:{type:['number','null'],minimum:0,maximum:100}, y_pct:{type:['number','null'],minimum:0,maximum:100}, width_pct:{type:['number','null'],minimum:0,maximum:100}, height_pct:{type:['number','null'],minimum:0,maximum:100}, confidence:{type:'number',minimum:0,maximum:1} } } } } };
  const itemList = items.map((item)=>({ item_id:item.id, title:item.title, brand:item.brand, quantity:item.quantity_text, price:Number(item.price || 0) }));
  const response = await fetch('https://api.openai.com/v1/responses', { method:'POST', headers:{ authorization:`Bearer ${OPENAI_API_KEY}`, 'content-type':'application/json' }, body:JSON.stringify({ model:OPENAI_MODEL, store:false, input:[{ role:'user', content:[{ type:'input_text', text:`Na přiložené stránce akčního letáku obchodu ${storeName || 'neuvedený obchod'} najdi obrazovou fotografii každé položky z JSON seznamu. Pro každé item_id vrať právě jeden záznam. Souřadnice jsou procenta celé stránky. Ohranič pouze samotný výrobek nebo fotografii čerstvé potraviny; nezahrnuj cenu, text, slevový štítek ani okolní produkt. Pokud nelze fotografii bezpečně přiřadit, nastav has_product_image=false a souřadnice null. Položky: ${JSON.stringify(itemList)}` },{ type:'input_image', image_url:`data:${page.mime};base64,${bytesToBase64(page.bytes)}`, detail:'high' }] }], text:{ format:{ type:'json_schema', name:'slevao_leaflet_product_boxes', strict:true, schema } } }) });
  const payload = await response.json().catch(()=>({}));
  if (!response.ok) {
    const code=String(payload?.error?.code||'').toLowerCase(), type=String(payload?.error?.type||'').toLowerCase(), message=String(payload?.error?.message||`HTTP ${response.status}`);
    if (response.status===429 || code==='insufficient_quota' || type.includes('quota') || /quota|billing|credit/i.test(message)) throw new DependencyBlockedError(`OpenAI není dočasně dostupné: ${message}`,6);
    if (response.status>=500) throw new DependencyBlockedError(`OpenAI je dočasně nedostupné: ${message}`,1);
    throw new Error(`AI určení výřezů selhalo: ${message}`);
  }
  const text=responseText(payload); if (!text) throw new Error('AI nevrátila souřadnice výřezů.');
  const parsed=JSON.parse(text); return Array.isArray(parsed?.boxes) ? parsed.boxes : [];
}
async function queueCropCandidate(job:any,item:ImportItem,imageUrl:string,pageUrl:string,box:any,pageNumber:number) {
  if (!item.product_id) return false;
  const candidate = await db.from('product_image_candidates').upsert({
    product_id:item.product_id, image_url:imageUrl, source_url:pageUrl, source_domain:new URL(SUPABASE_URL).hostname,
    source_type:'official_catalog', quality_score:Math.round(72 + Number(box.confidence || 0) * 20), match_score:Number(box.confidence || 0),
    has_clean_background:false, has_text_overlay:false, has_price_overlay:false, status:'pending',
    metadata:{ provider:'leaflet_ai_crop_review_only_v5', import_id:job.id, import_item_id:item.id, page_number:pageNumber, page_batch_id:job.metadata?.page_batch_id || null, public_page_url:pageUrl, crop_box_percent:box, review_tier:'usable_manual', automatic:false }
  }, { onConflict:'product_id,image_url', ignoreDuplicates:true });
  if (candidate.error) throw candidate.error;
  return true;
}
async function processImport(importId:string) {
  const { data:loadedJob,error:jobError } = await db.from('leaflet_imports').select('*,stores(name,slug)').eq('id',importId).single();
  if (jobError || !loadedJob) throw jobError || new Error('Import nebyl nalezen.');
  const job=loadedJob as any;
  if (!['review','published'].includes(String(job.status||''))) return;
  const runId=crypto.randomUUID();
  const claim=await db.rpc('claim_leaflet_crop_import',{p_import_id:importId,p_run_id:runId});
  if (claim.error) throw claim.error; if (!claim.data) return; job.metadata=claim.data;
  const { data:loadedItems,error:itemsError }=await db.from('leaflet_import_items').select('id,import_id,product_id,title,brand,quantity_text,price,image_url,source_page,status,raw_data').eq('import_id',importId).not('status','in','(ignored,rejected)').order('created_at');
  if (itemsError) throw itemsError;
  const items=((loadedItems||[]) as ImportItem[]).filter((item)=>{
    const cropStatus=String((item.raw_data as any)?.leaflet_crop?.status||'');
    return !String(item.image_url||'').trim() && !['no_safe_product_image','candidate_pending_review'].includes(cropStatus);
  });
  if (!items.length) {
    await db.from('leaflet_imports').update({ metadata:{ ...(job.metadata||{}), crop_processor:'generate-leaflet-product-crops-v5-review-only', crop_status:'completed', crop_run_id:null, crop_error:null, crop_blocked_reason:null, crop_next_retry_at:null, crop_remaining_page_groups:0, crop_finished_at:new Date().toISOString() } }).eq('id',importId);
    return;
  }
  let created=0,skipped=0;
  const publicPageUrls:Record<string,string>={};
  const itemsByPage=new Map<string,{pageNumber:number;sourceUrl:string;items:ImportItem[]}>();
  for (const item of items) {
    const pageNumber=Math.max(1,Number(item.source_page||job.metadata?.page_number||1));
    const sourceUrl=itemPageSource(item), key=`${sourceUrl||'job'}#${pageNumber}`;
    const group=itemsByPage.get(key)||{pageNumber,sourceUrl,items:[]}; group.items.push(item); itemsByPage.set(key,group);
  }
  const ordered=[...itemsByPage.values()].sort((a,b)=>a.pageNumber-b.pageNumber||a.sourceUrl.localeCompare(b.sourceUrl));
  const selected=ordered.slice(0,MAX_PAGE_GROUPS_PER_RUN), remaining=Math.max(0,ordered.length-selected.length);
  for (const group of selected) {
    const page=await loadPage(job,group.pageNumber,group.sourceUrl);
    const pageUrl=await ensurePublicPage(job,page,group.pageNumber,group.sourceUrl);
    publicPageUrls[`${group.pageNumber}:${safeSegment(group.sourceUrl,'job-source').slice(-32)}`]=pageUrl;
    const boxes=new Map<string,CropBox>();
    for (const box of await locateBoxes(page,group.items,String(job.stores?.name||''))) boxes.set(String(box.item_id),box);
    for (const item of group.items) {
      const rawBox=boxes.get(item.id), box=rawBox ? normalizedBox(rawBox) : null, imageUrl=cropUrl(pageUrl,box);
      if (!box || !imageUrl) {
        const upd=await db.from('leaflet_import_items').update({ raw_data:{ ...(item.raw_data||{}), leaflet_crop:{ provider:'leaflet_ai_crop_review_only_v5', status:'no_safe_product_image', page_url:pageUrl, page_number:group.pageNumber, confidence:Number(rawBox?.confidence||0), generated_at:new Date().toISOString() } } }).eq('id',item.id);
        if (upd.error) throw upd.error; skipped++; continue;
      }
      if (await queueCropCandidate(job,item,imageUrl,pageUrl,box,group.pageNumber)) created++;
      const upd=await db.from('leaflet_import_items').update({ raw_data:{ ...(item.raw_data||{}), leaflet_crop:{ provider:'leaflet_ai_crop_review_only_v5', status:'candidate_pending_review', candidate_image_url:imageUrl, page_url:pageUrl, page_number:group.pageNumber, box, confidence:box.confidence, generated_at:new Date().toISOString() } } }).eq('id',item.id);
      if (upd.error) throw upd.error;
    }
  }
  await db.from('leaflet_imports').update({ metadata:{ ...(job.metadata||{}), crop_processor:'generate-leaflet-product-crops-v5-review-only', crop_status:remaining>0?'queued':'completed', crop_run_id:null, crop_error:null, crop_blocked_reason:null, crop_next_retry_at:null, public_page_urls:{ ...(job.metadata?.public_page_urls||{}), ...publicPageUrls }, crop_candidate_count:Number(job.metadata?.crop_candidate_count||0)+created, crop_skipped_count:Number(job.metadata?.crop_skipped_count||0)+skipped, crop_remaining_page_groups:remaining, crop_finished_at:new Date().toISOString() } }).eq('id',importId);
  if (remaining>0) {
    const response=await fetch(`${SUPABASE_URL}/functions/v1/generate-leaflet-product-crops`,{ method:'POST', headers:{authorization:`Bearer ${SERVICE_ROLE_KEY}`,'content-type':'application/json'}, body:JSON.stringify({import_id:importId}) });
    if (!response.ok) throw new Error(`Navazující dávku výřezů nelze zařadit: HTTP ${response.status}`);
  }
}

Deno.serve(async (request)=>{
  if (request.method==='OPTIONS') return new Response('ok',{headers:CORS_HEADERS});
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({error:'Na serveru chybí Supabase secrets.'},500);
  try { await authorize(request); } catch { return json({error:'Unauthorized'},401); }
  if (request.method!=='POST') return json({error:'Metoda není podporována.'},405);
  const body=await request.json().catch(()=>({}));
  const importId=String(body.import_id||'').trim();
  if (!/^[0-9a-f-]{36}$/i.test(importId)) return json({error:'Missing import_id'},400);
  runInBackground(processImport(importId).catch(async(error)=>{
    console.error('Leaflet crop processing failed:',importId,errorMessage(error));
    const {data:job}=await db.from('leaflet_imports').select('metadata').eq('id',importId).maybeSingle();
    const blocked=error instanceof DependencyBlockedError;
    const retryAt=blocked ? new Date(Date.now()+error.retryAfterHours*60*60*1000).toISOString() : null;
    await db.from('leaflet_imports').update({ metadata:{ ...(job?.metadata||{}), crop_processor:'generate-leaflet-product-crops-v5-review-only', crop_status:blocked?'blocked_dependency':'failed', crop_run_id:null, crop_error:errorMessage(error).slice(0,1000), crop_blocked_reason:blocked?'image_localization_provider_unavailable':null, crop_next_retry_at:retryAt, crop_finished_at:new Date().toISOString() } }).eq('id',importId);
  }));
  return json({ok:true,accepted:true,mode:'review_only',import_id:importId},202);
});
