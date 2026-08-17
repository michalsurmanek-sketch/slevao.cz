import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': 'authorization, range, content-type, apikey',
  'access-control-expose-headers': 'accept-ranges, content-disposition, content-length, content-range, content-type',
};
const BROWSER = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.6',
};

const j = (body: unknown, status: number) => Response.json(body, { status, headers: CORS });
function normalizedEscapes(value: string) { return String(value || '').replace(/\\u0026/gi,'&').replace(/\\u002F/gi,'/').replace(/\\\//g,'/').replace(/&amp;/gi,'&'); }
function isGlobusPdf(value: string) { try { const u=new URL(value); return u.protocol==='https:'&&u.hostname==='gapi.globus.cz'&&u.pathname==='/OnlineAsset/3/asset'&&/^[0-9a-f-]{36}$/i.test(u.searchParams.get('assetID')||'')&&!u.searchParams.has('type'); } catch { return false; } }
function isTetaViewer(value: string) { try { const u=new URL(value); return u.protocol==='https:'&&u.hostname==='letak.tetadrogerie.cz'&&/^\/[a-z0-9-]+\/?$/i.test(u.pathname); } catch { return false; } }
function officialPublicDocument(value: string): string | null {
  try {
    const u=new URL(value); if(u.protocol!=='https:') return null;
    const tesco=u.hostname==='digitalcontent.api.tesco.com'&&u.pathname.startsWith('/v2/media/dotcom-cz/')&&/\.(?:pdf|webp|png|jpe?g)$/i.test(u.pathname);
    const penny=u.hostname==='files.rewe.co.at'&&/^\/PennyIntLeaflet\/CZ\/[^/]+\/files\/assets\/common\/downloads\/[^/]+\.pdf$/i.test(u.pathname);
    const lidl=(u.hostname==='endpoints.leaflets.schwarz'||u.hostname.endsWith('.leaflets.schwarz'))&&/\.pdf$/i.test(u.pathname);
    return tesco||penny||lidl||isGlobusPdf(u.toString())||isTetaViewer(u.toString()) ? u.toString() : null;
  } catch { return null; }
}
function globusPdfFromHtml(html:string){ const src=normalizedEscapes(html); const xs=src.match(/https:\/\/gapi\.globus\.cz\/OnlineAsset\/3\/asset\?assetID=[0-9a-f-]{36}(?:&[^\s\"'<>]*)?/gi)||[]; for(const x of xs){const c=x.replace(/[),.;]+$/,'');if(isGlobusPdf(c))return new URL(c).toString();} return null; }
async function resolveGlobus(source:string){ if(isGlobusPdf(source)) return {url:source,referer:'https://www.globus.cz/'}; const u=new URL(source); if(u.protocol!=='https:'&&!(u.hostname==='globus.cz'||u.hostname.endsWith('.globus.cz'))) throw new Error('Globus má nepovolený zdroj.'); const r=await fetch(u,{headers:{...BROWSER,accept:'text/html,application/xhtml+xml,*/*;q=0.8'},redirect:'follow'}); if(!r.ok)throw new Error(`Globus HTTP ${r.status}`); const pdf=globusPdfFromHtml(await r.text()); if(!pdf)throw new Error('Globus nevrátil PDF.'); return {url:pdf,referer:r.url}; }
async function resolveTeta(source:string){ if(!isTetaViewer(source)) throw new Error('Teta má nepovolený zdroj.'); const r=await fetch(source,{headers:{...BROWSER,accept:'text/html,application/xhtml+xml,*/*;q=0.8'},redirect:'follow'}); if(!r.ok)throw new Error(`Teta HTTP ${r.status}`); const html=normalizedEscapes(await r.text()); const xs=html.match(/https:\/\/liveecpaperdmp\.blob\.core\.windows\.net\/[^\s\"'<>]+\.pdf(?:\?[^\s\"'<>]*)?/gi)||[]; if(!xs[0])throw new Error('Teta nevrátila PDF.'); return {url:new URL(xs[0].replace(/[),.;]+$/,'')).toString(),referer:r.url}; }
function upstreamContext(url:string, fallback=''){ if(url.includes('files.rewe.co.at'))return{referer:'https://www.penny.cz/',origin:'https://www.penny.cz'}; if(url.includes('digitalcontent.api.tesco.com'))return{referer:'https://www.itesco.cz/',origin:'https://www.itesco.cz'}; if(url.includes('leaflets.schwarz'))return{referer:'https://www.lidl.cz/',origin:'https://www.lidl.cz'}; if(isGlobusPdf(url))return{referer:fallback||'https://www.globus.cz/'}; if(url.includes('liveecpaperdmp.blob.core.windows.net'))return{referer:fallback||'https://letak.tetadrogerie.cz/'}; return{referer:fallback||url}; }
function storedType(path:string,type:string){ if(type&&type!=='application/octet-stream')return type; if(/\.pdf$/i.test(path))return'application/pdf'; if(/\.webp$/i.test(path))return'image/webp'; if(/\.png$/i.test(path))return'image/png'; if(/\.jpe?g$/i.test(path))return'image/jpeg'; return'application/octet-stream'; }

Deno.serve(async (req)=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:CORS});
  if(!['GET','HEAD'].includes(req.method)) return j({error:'Method not allowed'},405);
  const q=new URL(req.url).searchParams;
  const importId=q.get('import_id')||'';
  const official=officialPublicDocument(q.get('source_url')||'');
  let job:any=null; let slug=''; let source=official||''; let referer='';
  if(!official){
    if(!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(importId)) return j({error:'Neplatný identifikátor letáku.'},400);
    const {data,error}=await db.from('leaflet_imports').select('id,source_document_url,status,detected_valid_to,metadata,stores(slug,is_active)').eq('id',importId).maybeSingle();
    job=data; const store=Array.isArray(job?.stores)?job.stores[0]:job?.stores; slug=String(store?.slug||'');
    if(error||!job||store?.is_active===false||String(job.status)!=='published') return j({error:'Leták nebyl nalezen.'},404);
    if(job.detected_valid_to&&job.detected_valid_to<new Date().toISOString().slice(0,10)) return j({error:'Platnost letáku skončila.'},410);
    source=String(job.source_document_url||'');
  } else if(isGlobusPdf(official)) slug='globus'; else if(isTetaViewer(official)) slug='teta';

  const bucket=typeof job?.metadata?.storage_bucket==='string'?job.metadata.storage_bucket:'';
  const path=typeof job?.metadata?.storage_path==='string'?job.metadata.storage_path:'';
  if(bucket&&path){
    const {data,error}=await db.storage.from(bucket).download(path);
    if(!error&&data){ const h=new Headers(CORS); h.set('content-type',storedType(path,data.type)); h.set('content-length',String(data.size)); h.set('cache-control','private, no-store'); h.set('content-disposition','inline; filename="letak"'); h.set('x-content-type-options','nosniff'); return new Response(req.method==='HEAD'?null:data.stream(),{status:200,headers:h}); }
  }

  try {
    if(slug==='globus'){const x=await resolveGlobus(source);source=x.url;referer=x.referer;} else if(slug==='teta'){const x=await resolveTeta(source);source=x.url;referer=x.referer;}
    if(!/^https:\/\//i.test(source)) return j({error:'Leták nemá bezpečný HTTPS zdroj.'},404);
    const ctx=upstreamContext(source,referer);
    const upstream=await fetch(source,{method:req.method,headers:{...BROWSER,accept:'application/pdf,image/webp,image/png,image/jpeg,*/*;q=0.8',referer:ctx.referer,...(ctx.origin?{origin:ctx.origin}:{}),...(req.headers.get('range')?{range:req.headers.get('range')!}:{})},redirect:'follow'});
    if(!upstream.ok&&upstream.status!==206)return j({error:`Zdroj letáku vrátil HTTP ${upstream.status}.`},502);
    const h=new Headers(CORS); for(const n of ['accept-ranges','content-length','content-range','etag','last-modified']){const v=upstream.headers.get(n);if(v)h.set(n,v);} h.set('content-type',isGlobusPdf(source)?'application/pdf':upstream.headers.get('content-type')||'application/octet-stream'); h.set('cache-control','public, max-age=900, s-maxage=900'); h.set('content-disposition','inline; filename="letak"'); h.set('x-content-type-options','nosniff');
    return new Response(req.method==='HEAD'?null:upstream.body,{status:upstream.status,headers:h});
  } catch(e){ return j({error:e instanceof Error?e.message:'Leták se nepodařilo načíst.'},502); }
});
