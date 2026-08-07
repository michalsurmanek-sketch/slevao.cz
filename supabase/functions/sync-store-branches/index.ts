import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36';
const KAUFLAND_LIST = 'https://prodejny.kaufland.cz/aktualne/servis/seznam-prodejen.html';
const OVERPASS_ENDPOINTS = ['https://overpass.private.coffee/api/interpreter', 'https://overpass-api.de/api/interpreter'];

const CHAINS = [
  { slug: 'kaufland', search: 'Kaufland', match: /\bkaufland\b/i, min: 5 },
  { slug: 'lidl', search: 'Lidl', match: /\blidl\b/i, min: 5 },
  { slug: 'albert', search: 'Albert', match: /\balbert\b/i, min: 5 },
  { slug: 'billa', search: 'BILLA', match: /\bbilla\b/i, min: 5 },
  { slug: 'penny', search: 'Penny|PENNY', match: /\bpenny(?:\s+market)?\b/i, min: 5 },
  { slug: 'tesco', search: 'Tesco', match: /\btesco\b/i, min: 5 },
  { slug: 'globus', search: 'Globus', match: /\bglobus\b/i, min: 2 },
  { slug: 'makro', search: 'MAKRO|Makro', match: /\bmakro\b/i, min: 2 },
  { slug: 'norma', search: 'Norma|NORMA', match: /\bnorma\b/i, min: 2 },
  { slug: 'hruska', search: 'Hruška|Hruska', match: /\bhruska\b/i, min: 2 },
  { slug: 'terno', search: 'Terno', match: /\bterno\b/i, min: 2 },
  { slug: 'enapo', search: 'Enapo', match: /\benapo\b/i, min: 2 },
  { slug: 'flop', search: 'Flop|FLOP', match: /\bflop\b/i, min: 2 },
  { slug: 'jip', search: 'JIP', match: /\bjip\b/i, min: 2 },
  { slug: 'zabka', search: 'Žabka|Zabka', match: /\bzabka\b/i, min: 2 },
  { slug: 'coop', search: 'COOP', match: /\bcoop\b/i, min: 2 },
] as const;
const DEFAULT_CHAIN_SLUGS = ['lidl', 'albert', 'billa', 'penny', 'tesco', 'globus', 'makro'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}
function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const row = error as Record<string, unknown>;
    return [row.message, row.details, row.hint, row.code].filter(Boolean).map(String).join(' | ') || JSON.stringify(error);
  }
  return String(error);
}
async function allowed(request: Request) {
  const raw = request.headers.get('authorization') || '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE) return true;
  if (CRON && request.headers.get('x-cron-secret') === CRON) return true;
  if (!token) return false;
  const { data, error } = await db.auth.getUser(token);
  return !error && !!data.user && ['admin', 'editor'].includes(String(data.user.app_metadata?.role || '').toLowerCase());
}
function fold(value: unknown) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}
function decodeHtml(value: string) {
  return String(value || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&ndash;|&#8211;/gi, '–')
    .replace(/&mdash;|&#8212;/gi, '—')
    .replace(/&aacute;/gi, 'á').replace(/&Aacute;/g, 'Á')
    .replace(/&eacute;/gi, 'é').replace(/&Eacute;/g, 'É')
    .replace(/&iacute;/gi, 'í').replace(/&Iacute;/g, 'Í')
    .replace(/&oacute;/gi, 'ó').replace(/&Oacute;/g, 'Ó')
    .replace(/&uacute;/gi, 'ú').replace(/&Uacute;/g, 'Ú')
    .replace(/&yacute;/gi, 'ý').replace(/&Yacute;/g, 'Ý');
}
function cleanText(value: string) {
  return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}
async function fetchText(url: string, timeout = 18_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7', 'cache-control': 'no-cache' },
      redirect: 'follow', signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return { text, url: response.url, status: response.status };
  } finally { clearTimeout(timer); }
}

function markerContexts(html: string) {
  const markers = ['latitude','longitude','data-lat','data-lng','coordinates','geo','googleMaps','maps','storeLocation','Města Mayen'];
  const contexts: Array<{ marker: string; context: string }> = [];
  const lower = html.toLowerCase();
  for (const marker of markers) {
    let from = 0;
    while (contexts.length < 60) {
      const index = lower.indexOf(marker.toLowerCase(), from);
      if (index < 0) break;
      contexts.push({ marker, context: html.slice(Math.max(0,index-280), Math.min(html.length,index+620)).replace(/\s+/g,' ') });
      from = index + marker.length;
    }
    if (contexts.length >= 60) break;
  }
  return contexts;
}
function scriptUrls(html: string, base: string) {
  const urls = new Set<string>();
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|mjs)(?:\?[^"']*)?)["']/gi)) {
    try { urls.add(new URL(decodeHtml(match[1]), base).toString()); } catch { /* ignore */ }
  }
  return [...urls].slice(0,100);
}
async function diagnoseKauflandDetail(rawUrl: unknown) {
  const url = new URL(String(rawUrl || ''));
  if (url.protocol !== 'https:' || url.hostname !== 'prodejny.kaufland.cz') throw new Error('Diagnostika dovoluje pouze oficiální doménu prodejny.kaufland.cz.');
  const page = await fetchText(url.toString());
  return { ok:true, dry_run:true, mode:'kaufland_detail_diagnostic', url:page.url, status:page.status, bytes:page.text.length,
    title:cleanText(page.text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ''), marker_contexts:markerContexts(page.text), script_urls:scriptUrls(page.text,page.url) };
}

function kauflandLinks(html: string) {
  const links = new Set<string>();
  for (const match of html.matchAll(/href=["']([^"']*\/aktualne\/servis\/prodejna\/[^"'#?]+\.html)["']/gi)) {
    try {
      const url = new URL(decodeHtml(match[1]), KAUFLAND_LIST);
      if (url.hostname === 'prodejny.kaufland.cz' && !url.pathname.includes('%7BfriendlyUrl%7D') && !url.pathname.includes('{friendlyUrl}')) links.add(url.toString());
    } catch { /* ignore */ }
  }
  return [...links].sort();
}
function itempropText(html: string, prop: string) {
  const a = html.match(new RegExp(`<[^>]+itemprop=["']${prop}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i'))?.[1];
  if (a) return cleanText(a);
  const b = html.match(new RegExp(`<[^>]+itemprop=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))?.[1];
  if (b) return cleanText(b);
  const c = html.match(new RegExp(`<[^>]+content=["']([^"']+)["'][^>]+itemprop=["']${prop}["']`, 'i'))?.[1];
  return c ? cleanText(c) : '';
}
function parseKauflandDetail(html: string, detailUrl: string) {
  const storeCode = html.match(/data-force-store-change=["'](CZ\d+)["']/i)?.[1] || '';
  const lat = Number(html.match(/data-lat=["']([0-9.\-]+)["']/i)?.[1]);
  const lng = Number(html.match(/data-lng=["']([0-9.\-]+)["']/i)?.[1]);
  if (!storeCode || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 48.45 || lat > 51.2 || lng < 12 || lng > 19.1) return null;
  const title = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  let locationName = title.replace(/^Kaufland\s+/i,'').replace(/\s+[–—-]\s+.*$/,'').trim();
  if (!locationName) locationName = itempropText(html,'name').replace(/^Kaufland\s+/i,'').trim();
  const street = itempropText(html,'streetAddress') || null;
  const postalCode = itempropText(html,'postalCode') || null;
  let city = itempropText(html,'addressLocality') || null;
  if (!city && locationName) city = locationName.replace(/\s+-\s+.*$/,'').trim();
  const opens = [...html.matchAll(/itemprop=["']opens["'][^>]+content=["']([^"']+)["']/gi)].map((m)=>m[1]);
  const closes = [...html.matchAll(/itemprop=["']closes["'][^>]+content=["']([^"']+)["']/gi)].map((m)=>m[1]);
  return {
    external_id:`kaufland:${storeCode}`, name:`Kaufland ${locationName}`.trim(), street, city, postal_code:postalCode, region:null,
    latitude:lat, longitude:lng, is_active:true,
    opening_hours:{ source:'kaufland.cz', store_code:storeCode, detail_url:detailUrl, opens:[...new Set(opens)], closes:[...new Set(closes)] },
  };
}
async function fetchKauflandDetail(url: string) {
  try { const page = await fetchText(url); return { url:page.url, row:parseKauflandDetail(page.text,page.url), error:null }; }
  catch (error) { return { url, row:null, error:errorText(error) }; }
}
async function syncKauflandOfficial(body: any) {
  const dryRun = body.dry_run === true;
  const offset = Math.max(0, Math.floor(Number(body.offset || 0)));
  const limit = Math.max(1, Math.min(20, Math.floor(Number(body.limit || 12))));
  const listPage = await fetchText(KAUFLAND_LIST);
  const links = kauflandLinks(listPage.text);
  if (links.length < 100) return json({ error:`Oficiální seznam Kauflandu obsahuje jen ${links.length} detailů; synchronizace byla zastavena.`, code:'KAUFLAND_LIST_TOO_SMALL', dry_run:dryRun },409);
  const selected = links.slice(offset, offset + limit);
  if (!selected.length) return json({ ok:true, dry_run:dryRun, source:'kaufland_official', total:links.length, offset, parsed:0, done:true });
  const results: Array<{url:string;row:any;error:string|null}> = [];
  for (let from=0; from<selected.length; from+=5) results.push(...await Promise.all(selected.slice(from,from+5).map(fetchKauflandDetail)));
  const rows = results.filter((r)=>r.row).map((r)=>r.row);
  const failures = results.filter((r)=>!r.row).map((r)=>({url:r.url,error:r.error || 'detail neobsahuje očekávané GPS/ID'}));
  const minimum = Math.ceil(selected.length * .8);
  if (rows.length < minimum) return json({ error:`Kaufland parser zpracoval jen ${rows.length}/${selected.length} detailů; zápis byl zastaven.`, code:'KAUFLAND_BATCH_INCOMPLETE', dry_run:dryRun, total:links.length, offset, failures },409);
  const { data:store, error:storeError } = await db.from('stores').select('id,name,slug').eq('slug','kaufland').eq('is_active',true).maybeSingle();
  if (storeError) throw storeError;
  if (!store) throw new Error('Aktivní obchod kaufland nebyl nalezen v tabulce stores.');
  const payload = rows.map((row)=>({ ...row, store_id:store.id }));
  if (!dryRun) {
    const { error } = await db.from('branches').upsert(payload,{onConflict:'store_id,external_id'});
    if (error) throw error;
  }
  return json({ ok:true, dry_run:dryRun, source:'kaufland_official', total:links.length, offset, requested:selected.length, parsed:rows.length, written:dryRun?0:rows.length,
    next_offset:offset+selected.length, done:offset+selected.length>=links.length, failures, samples:payload.slice(0,5).map(({store_id:_storeId,...row})=>row) });
}

function buildChainQuery(search: string) {
  return `[out:json][timeout:18][bbox:48.45,12.0,51.2,19.1];(nwr["shop"~"^(supermarket|convenience|wholesale)$"]["brand"~"^(${search})$",i];nwr["shop"~"^(supermarket|convenience|wholesale)$"]["name"~"${search}",i];nwr["shop"~"^(supermarket|convenience|wholesale)$"]["operator"~"${search}",i];);out center tags;`;
}
async function fetchOverpassChain(chain: (typeof CHAINS)[number]) {
  let lastError: unknown = null;
  const query = buildChainQuery(chain.search);
  for (const endpoint of OVERPASS_ENDPOINTS) {
    const controller = new AbortController(); const timer=setTimeout(()=>controller.abort(),22_000);
    try {
      const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8',accept:'application/json','user-agent':'Slevao.cz branch synchronizer/1.2 (https://slevao.cz)'},body:new URLSearchParams({data:query}).toString(),signal:controller.signal});
      const text=await response.text(); if(!response.ok) throw new Error(`${new URL(endpoint).hostname} HTTP ${response.status}`);
      const data=JSON.parse(text); if(!Array.isArray(data?.elements)) throw new Error('Overpass nevrátil elements.');
      return {chain,endpoint,elements:data.elements as any[]};
    } catch(error){lastError=error;} finally{clearTimeout(timer);}
  }
  throw new Error(`${chain.slug}: ${errorText(lastError || 'zdroj není dostupný')}`);
}
function osmCoordinates(element:any){const latitude=Number(element?.lat??element?.center?.lat),longitude=Number(element?.lon??element?.center?.lon);if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude<48.45||latitude>51.2||longitude<12||longitude>19.1)return null;return{latitude,longitude};}
function osmCandidate(element:any,chain:(typeof CHAINS)[number]){
  const tags=(element?.tags&&typeof element.tags==='object'?element.tags:{}) as Record<string,unknown>, haystack=fold([tags.brand,tags.name,tags.operator].filter(Boolean).join(' '));
  if(!chain.match.test(haystack))return null;const point=osmCoordinates(element);if(!point||!element?.type||!element?.id)return null;
  const street=[String(tags['addr:street']||tags['addr:place']||'').trim(),String(tags['addr:housenumber']||'').trim()].filter(Boolean).join(' ')||null;
  return{external_id:`osm:${element.type}:${element.id}`,name:String(tags.name||tags.brand||tags.operator||chain.slug).trim()||null,street,city:String(tags['addr:city']||tags['addr:place']||tags['addr:suburb']||'').trim()||null,postal_code:String(tags['addr:postcode']||'').trim()||null,region:String(tags['addr:state']||'').trim()||null,...point,opening_hours:{source:'OpenStreetMap',raw:String(tags.opening_hours||'').trim()||null},is_active:true,slug:chain.slug};
}
async function syncOverpassFallback(body:any){
  const dryRun=body.dry_run===true, requested=Array.isArray(body.chains)?body.chains.map(String):DEFAULT_CHAIN_SLUGS, selected=CHAINS.filter((c)=>requested.includes(c.slug)&&c.slug!=='kaufland');
  if(!selected.length)return json({error:'Nebyl vybrán podporovaný fallback řetězec.'},400);
  const successes:any[]=[],failures:any[]=[];
  for(let from=0;from<selected.length;from+=3){const batch=selected.slice(from,from+3),settled=await Promise.allSettled(batch.map(fetchOverpassChain));settled.forEach((r,i)=>r.status==='fulfilled'?successes.push(r.value):failures.push({slug:batch[i].slug,error:errorText(r.reason)}));}
  const candidates:any[]=[],diagnostics:Record<string,unknown>={};
  for(const result of successes){const map=new Map<string,any>();result.elements.map((e:any)=>osmCandidate(e,result.chain)).filter(Boolean).forEach((row:any)=>map.set(row.external_id,row));const rows=[...map.values()];diagnostics[result.chain.slug]={source:result.endpoint,source_elements:result.elements.length,matched:rows.length,minimum:result.chain.min};if(rows.length>=result.chain.min)candidates.push(...rows);else failures.push({slug:result.chain.slug,error:`jen ${rows.length} poboček`});}
  const slugs=[...new Set(candidates.map((r)=>r.slug))];
  if(candidates.length<20||slugs.length<3)return json({error:`Fallback zastaven: ${candidates.length} poboček / ${slugs.length} řetězce.`,code:'STORE_BRANCH_SYNC_TOO_SMALL',dry_run:dryRun,diagnostics,failures},409);
  const {data:stores,error:storeError}=await db.from('stores').select('id,slug').in('slug',slugs).eq('is_active',true);if(storeError)throw storeError;const storeMap=new Map((stores||[]).map((s)=>[s.slug,s.id]));
  const rows=candidates.filter((r)=>storeMap.has(r.slug)).map(({slug,...r})=>({...r,store_id:storeMap.get(slug)}));
  if(!dryRun){for(let from=0;from<rows.length;from+=300){const{error}=await db.from('branches').upsert(rows.slice(from,from+300),{onConflict:'store_id,external_id'});if(error)throw error;}}
  return json({ok:true,dry_run:dryRun,source:'overpass_fallback',matched_branches:rows.length,matched_chains:slugs,failures,written:dryRun?0:rows.length});
}

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:CORS});
  if(request.method!=='POST')return json({error:'Method not allowed'},405);
  if(!(await allowed(request)))return json({error:'Unauthorized'},401);
  try{
    const body=await request.json().catch(()=>({}));
    if(body.discover==='kaufland_detail'){if(body.dry_run!==true)return json({error:'Diagnostika je povolená pouze v dry_run režimu.'},409);return json(await diagnoseKauflandDetail(body.url));}
    if(body.source==='overpass_fallback')return await syncOverpassFallback(body);
    return await syncKauflandOfficial(body);
  }catch(error){console.error('sync-store-branches failed',error);return json({error:errorText(error),code:'STORE_BRANCH_SYNC_FAILED'},500);}
});
