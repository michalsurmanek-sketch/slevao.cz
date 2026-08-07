import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL=Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET=Deno.env.get('CRON_SECRET')||'';
const db=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const CORS={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-cron-secret','access-control-allow-methods':'POST,OPTIONS','content-type':'application/json; charset=utf-8'};
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:CORS});}
function formatError(error:unknown){if(error instanceof Error)return error.message;if(error&&typeof error==='object'){const v=error as Record<string,unknown>;return [v.message,v.details,v.hint,v.code].filter(Boolean).map(String).join(' | ')||JSON.stringify(error);}return String(error);}
async function allowed(request:Request){const auth=request.headers.get('authorization')||'';const token=auth.replace(/^Bearer\s+/i,'').trim();if(token===SERVICE_ROLE_KEY)return true;if(CRON_SECRET&&request.headers.get('x-cron-secret')===CRON_SECRET)return true;if(!token)return false;const{data}=await db.auth.getUser(token);return['admin','editor'].includes(String(data.user?.app_metadata?.role||'').toLowerCase());}
async function sha256(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function invokeProcessor(importId:string){const response=await fetch(`${SUPABASE_URL}/functions/v1/process-automatic-pdf-v2`,{method:'POST',headers:{authorization:`Bearer ${SERVICE_ROLE_KEY}`,apikey:SERVICE_ROLE_KEY,'content-type':'application/json'},body:JSON.stringify({import_id:importId})});const text=await response.text();if(!response.ok)throw new Error(`process-automatic-pdf-v2 HTTP ${response.status}: ${text.slice(0,500)}`);}

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  if(!(await allowed(request)))return json({error:'Unauthorized'},401);
  const startedAt=new Date().toISOString();
  try{
    const{data:store,error:storeError}=await db.from('stores').select('id,name').eq('slug','albert').single();
    if(storeError||!store)throw storeError||new Error('Albert nebyl nalezen.');
    const{data:source,error:sourceError}=await db.from('leaflet_sources').select('id').eq('store_id',store.id).eq('is_active',true).limit(1).single();
    if(sourceError||!source)throw sourceError||new Error('Aktivní zdroj Albert nebyl nalezen.');
    const today=startedAt.slice(0,10);
    const{data:documents,error:docsError}=await db.from('leaflet_imports')
      .select('id,source_hash,source_document_url,detected_valid_from,detected_valid_to,metadata')
      .eq('store_id',store.id).eq('status','published')
      .contains('metadata',{adapter:'albert-publitas-v1'})
      .gte('detected_valid_to',today).order('detected_valid_to');
    if(docsError)throw docsError;
    if(!documents||documents.length<2)throw new Error(`Albert má jen ${documents?.length||0} aktuálních oficiálních PDF.`);
    const signature=await sha256(documents.map((d:any)=>`${d.source_hash}|${d.detected_valid_from}|${d.detected_valid_to}`).sort().join('\n'));

    const{data:running,error:runningError}=await db.from('albert_product_sync_runs').select('id,status,started_at').eq('store_id',store.id).eq('status','running').order('started_at',{ascending:false}).limit(1).maybeSingle();
    if(runningError)throw runningError;
    if(running)return json({ok:true,accepted:true,already_running:true,run_id:running.id},202);

    const{data:state}=await db.from('store_product_sync_state').select('last_source_signature,last_success_at,health_status,last_offer_count').eq('store_id',store.id).maybeSingle();
    const{count:currentOffers,error:offerError}=await db.from('offers').select('id',{count:'exact',head:true}).eq('store_id',store.id).eq('status','published').lte('valid_from',today).gte('valid_to',today);
    if(offerError)throw offerError;
    if(state?.last_source_signature===signature&&state?.health_status==='ok'&&Number(currentOffers||0)>=180){
      return json({ok:true,no_changes:true,store:'Albert',current_offers:Number(currentOffers||0),signature});
    }

    const{data:run,error:runError}=await db.from('albert_product_sync_runs').insert({store_id:store.id,source_id:source.id,source_signature:signature,status:'running',expected_documents:documents.length,parent_import_ids:[],metadata:{adapter:'albert-pdf-ai-v2',official_document_ids:documents.map((d:any)=>d.id)}}).select('id').single();
    if(runError||!run)throw runError||new Error('Albert dávku se nepodařilo založit.');
    const runId=run.id;
    const parentIds:string[]=[];
    try{
      for(const doc of documents as any[]){
        const parentHash=`albert-product-parent-v2:${runId}:${doc.id}`;
        const metadata={adapter:'albert-product-parent-v2',automatic_processor_required:true,trusted_automatic_source:true,auto_publish:false,product_batch_key:runId,albert_run_id:runId,official_document_id:doc.id,official_document_adapter:'albert-publitas-v1',batch_valid_from:doc.detected_valid_from,batch_valid_to:doc.detected_valid_to,title:doc.metadata?.title||'Albert produktový leták'};
        const{data:parent,error:parentError}=await db.from('leaflet_imports').insert({source_id:source.id,store_id:store.id,source_document_url:doc.source_document_url,source_hash:parentHash,status:'queued',detected_valid_from:doc.detected_valid_from,detected_valid_to:doc.detected_valid_to,coverage_scope:'national',metadata}).select('id').single();
        if(parentError||!parent)throw parentError||new Error('Technický Albert import se nepodařilo vytvořit.');
        parentIds.push(parent.id);
      }
      await db.from('albert_product_sync_runs').update({parent_import_ids:parentIds}).eq('id',runId);
      await db.from('store_product_sync_state').upsert({store_id:store.id,last_run_at:startedAt,last_source_signature:signature,source_fingerprint:signature,parser_version:'albert-pdf-ai-v2',adapter_name:'sync-albert-products',adapter_version:'albert-pdf-ai-v2',source_type:'official-pdf-ai',source_category:'current-leaflets',is_running:true,run_started_at:startedAt,health_status:'running',health_reason:'Albert PDF stránky se automaticky zpracovávají.',last_error:null,last_parser_error:null,updated_at:startedAt},{onConflict:'store_id'});
      await Promise.all(parentIds.map(invokeProcessor));
      return json({ok:true,accepted:true,run_id:runId,documents:documents.length,parent_imports:parentIds.length,signature},202);
    }catch(error){
      const message=formatError(error);
      await db.from('albert_product_sync_runs').update({status:'failed',error_message:message.slice(0,2000),finished_at:new Date().toISOString(),parent_import_ids:parentIds}).eq('id',runId);
      await db.from('store_product_sync_state').update({is_running:false,last_error:message.slice(0,2000),last_parser_error:message.slice(0,2000),health_status:'error',health_reason:'Albert dávku se nepodařilo spustit; veřejná data nebyla změněna.',updated_at:new Date().toISOString()}).eq('store_id',store.id);
      throw error;
    }
  }catch(error){return json({error:formatError(error)},500);}
});
