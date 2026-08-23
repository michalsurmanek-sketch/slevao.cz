import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const ADAPTER = 'jip-basic-html-column-v2-vat';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const HEADERS = { 'content-type': 'application/json; charset=utf-8' };

type Cell = { row:number; start:number; end:number; center:number; text:string };
type Point = { row:number; center:number; value:number; cell:Cell };
type Candidate = { title:string; price:number; quantity_text:string; source_page:number; confidence:number; raw_data:Record<string, unknown> };

const json = (body:unknown, status=200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
const clean = (v:unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const norm = (v:unknown) => clean(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs');
const letters = (v:string) => (v.match(/[A-Za-zÁ-ž]/g) || []).length;
function allowed(req:Request) {
  return req.headers.get('authorization') === `Bearer ${SERVICE_ROLE_KEY}` || Boolean(CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET);
}
function todayPrague() {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Prague', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date());
  const x = Object.fromEntries(p.map(v => [v.type, v.value]));
  return `${x.year}-${x.month}-${x.day}`;
}
function decodeHtml(v:string) {
  return v
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function codeText(html:string) {
  const a = html.indexOf('<code>');
  const b = html.indexOf('</code>', a + 6);
  if (a < 0 || b < 0) throw new Error('JIP basic HTML neobsahuje <code> textovou vrstvu.');
  return decodeHtml(html.slice(a + 6, b)).replace(/\r/g, '');
}
function cells(text:string):Cell[] {
  const out:Cell[] = [];
  const lines = text.split('\n');
  lines.forEach((line, row) => {
    const expanded = line.replace(/\t/g, '    ');
    const re = /(\S(?:.*?\S)?)(?=\s{2,}|$)/g;
    for (const m of expanded.matchAll(re)) {
      const value = clean(m[1]);
      if (!value) continue;
      const start = m.index ?? 0;
      out.push({ row, start, end:start + m[1].length, center:start + m[1].length / 2, text:value });
    }
  });
  return out;
}
function prices(cell:Cell) {
  if (/bez\s*dph/i.test(cell.text)) return [] as Array<{value:number; center:number}>;
  const out:Array<{value:number; center:number}> = [];
  for (const m of cell.text.matchAll(/\b(\d{1,4}),(\d{2})\b/g)) {
    const value = Number(m[1]) + Number(m[2]) / 100;
    if (value < 2 || value > 5000) continue;
    const idx = m.index ?? 0;
    out.push({ value:Math.round(value * 100) / 100, center:cell.start + idx + m[0].length / 2 });
  }
  return out;
}
function preTax(cell:Cell) {
  const out:Array<{value:number;center:number}> = [];
  const re = /bez\s*dph\s*(\d{1,4})(?:\s+(\d{2}))?(?:\s*\/\s*(?:kg|l|100\s*g))?/gi;
  for (const m of cell.text.matchAll(re)) {
    const whole = Number(m[1]);
    if (!Number.isFinite(whole) || whole <= 0) continue;
    const value = whole + (m[2] ? Number(m[2]) / 100 : 0);
    const idx = (m.index ?? 0) + m[0].lastIndexOf(m[1]);
    out.push({ value:Math.round(value*100)/100, center:cell.start + idx + m[1].length/2 });
  }
  return out;
}
function quantity(cell:Cell) {
  if (/\d+(?:[,.]\d+)?\s*-\s*\d+(?:[,.]\d+)?\s*(?:kg|g|ml|l)\b/i.test(cell.text)) return null;
  let m = cell.text.match(/\b(\d{1,2})\s*[x×]\s*(\d+(?:[,.]\d+)?)\s*(kg|g|ml|l)\b/i);
  if (m) return { text:`${m[1]} x ${m[2]} ${m[3]}`, center:cell.start + (m.index ?? 0) + m[0].length / 2 };
  m = cell.text.match(/\b(?:bal\.\s*)?(?:cca\s*)?(\d+(?:[,.]\d+)?)\s*(kg|g|ml|l)\b/i);
  if (m) return { text:`${m[1]} ${m[2]}`, center:cell.start + (m.index ?? 0) + m[0].length / 2 };
  return null;
}
function isNoise(v:string) {
  const n = norm(v);
  if (letters(v) < 5 || v.length < 5 || v.length > 90) return true;
  if (/^(bez dph|cena s dph|cena|str\.?\s*\d+|jip potraviny|www\.|po-ne|po-pa|pultovy prodej)/i.test(n)) return true;
  if (/(nabidka (ne)?plati pro|plati pro pobocku|svoboda nad upou|ceske budejovice|nachod|most|susice|nemandicka|upska|delnicka)/i.test(n)) return true;
  if (/(pri koupi|kup\s+\d+|zdarma|kupon|karta|aplikac|cena od|do vyprodani)/i.test(n)) return true;
  if (/^(ruzne druhy|natur|original|classic|mix|baleni|kus|platy|platky|ochucena|perlivá|neperlivá)$/i.test(n)) return true;
  if (/\b\d{1,4},\d{2}\b/.test(v)) return true;
  if (/\b\d+(?:[,.]\d+)?\s*(kg|g|ml|l)\b/i.test(v)) return true;
  return false;
}
function sanitizeTitle(v:string) {
  return clean(v)
    .replace(/\brůzné druhy\b/gi, ' ')
    .replace(/(?:\s+\d{1,3})+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function titleFor(anchor:{row:number; center:number}, all:Cell[]) {
  const local = all
    .filter(c => c.row >= anchor.row - 5 && c.row <= anchor.row && Math.abs(c.center - anchor.center) <= 9 && !isNoise(c.text))
    .sort((a,b) => b.row - a.row || Math.abs(a.center-anchor.center)-Math.abs(b.center-anchor.center));
  const core = local[0];
  if (!core) return null;
  const chosen = local
    .filter(c => c.row >= core.row - 2 && c.row <= core.row && Math.abs(c.center-core.center) <= 6)
    .sort((a,b)=>a.row-b.row)
    .slice(-3);
  const title = sanitizeTitle(chosen.map(c=>c.text).join(' '));
  return isNoise(title) ? null : title;
}
function vatEvidence(price:number, row:number, center:number, points:Point[]) {
  const candidates = points
    .filter(v => Math.abs(v.row-row) <= 5 && Math.abs(v.center-center) <= 11)
    .map(v => {
      const p12 = Math.round(v.value * 1.12 * 100) / 100;
      const p21 = Math.round(v.value * 1.21 * 100) / 100;
      const d12 = Math.abs(p12-price), d21=Math.abs(p21-price);
      const rate = d12 <= d21 ? 12 : 21;
      return {...v, rate, expected:rate===12?p12:p21, delta:Math.min(d12,d21), distance:Math.abs(v.row-row)*7+Math.abs(v.center-center)};
    })
    .filter(v => v.delta <= 0.06)
    .sort((a,b)=>a.delta-b.delta || a.distance-b.distance);
  return candidates[0] || null;
}
function parsePage(page:number, text:string):Candidate[] {
  const all = cells(text);
  const pricePoints:Point[] = all.flatMap(c => prices(c).map(p => ({...p,row:c.row,cell:c})));
  const vatPoints:Point[] = all.flatMap(c => preTax(c).map(p => ({...p,row:c.row,cell:c})));
  const quantityPoints = all.map(c => ({cell:c,q:quantity(c)})).filter((x):x is {cell:Cell;q:{text:string;center:number}} => Boolean(x.q));
  const out:Candidate[] = [];
  for (const {cell,q} of quantityPoints) {
    const nearby = pricePoints
      .filter(p => Math.abs(p.row-cell.row) <= 4 && Math.abs(p.center-q.center) <= 9)
      .sort((a,b) => (Math.abs(a.row-cell.row)*7 + Math.abs(a.center-q.center)) - (Math.abs(b.row-cell.row)*7 + Math.abs(b.center-q.center)));
    const price = nearby[0];
    if (!price) continue;
    const vat = vatEvidence(price.value,price.row,price.center,vatPoints);
    if (!vat) continue;
    const title = titleFor({row:cell.row,center:q.center}, all) || titleFor({row:price.row,center:price.center}, all);
    if (!title) continue;
    const windowText = norm(all.filter(c => c.row >= Math.min(cell.row,price.row)-3 && c.row <= Math.max(cell.row,price.row)+2 && Math.abs(c.center-q.center)<=11).map(c=>c.text).join(' '));
    if (/(nabidka (ne)?plati pro|plati pro pobocku|pri koupi|zdarma|kupon|cena od)/i.test(windowText)) continue;
    out.push({
      title,
      price:price.value,
      quantity_text:q.text,
      source_page:page,
      confidence:0.99,
      raw_data:{
        parser:ADAPTER, deterministic:true, html_column:true, vat_verified:true,
        quantity_cell:cell.text, price_cell:price.cell.text, pretax_cell:vat.cell.text,
        pretax_price:vat.value, vat_rate:vat.rate, vat_expected_price:vat.expected, vat_delta:Math.round(vat.delta*100)/100,
        quantity_center:Math.round(q.center*10)/10, price_center:Math.round(price.center*10)/10,
        row_distance:Math.abs(price.row-cell.row)
      }
    });
  }
  const seen = new Set<string>();
  return out.filter(c => {
    const key = `${norm(c.title)}|${c.price}|${norm(c.quantity_text)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
async function fetchPage(base:string, page:number) {
  const url = `${base.replace(/\/?$/, '/')}files/basic-html/page${page}.html`;
  const r = await fetch(url, { headers:{'user-agent':'Mozilla/5.0','accept':'text/html,*/*'}, redirect:'follow', signal:AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`JIP basic HTML strana ${page}: HTTP ${r.status}`);
  return { page, url, text:codeText(await r.text()) };
}

Deno.serve(async req => {
  if (req.method !== 'POST') return json({error:'Method not allowed'},405);
  if (!allowed(req)) return json({error:'Unauthorized'},401);
  try {
    const body = await req.json().catch(()=>({}));
    const today = todayPrague();
    const {data:store,error:storeError} = await db.from('stores').select('id').eq('slug','jip').maybeSingle();
    if (storeError) throw storeError;
    if (!store) throw new Error('JIP store not found.');
    let source:any = null;
    if (body.import_id) {
      const q = await db.from('leaflet_imports').select('*').eq('id',String(body.import_id)).eq('store_id',store.id).maybeSingle();
      if (q.error) throw q.error;
      source = q.data;
    } else {
      const q = await db.from('leaflet_imports').select('*').eq('store_id',store.id).eq('metadata->>adapter','jip-flip-pdf-v1').lte('detected_valid_from',today).gte('detected_valid_to',today).order('created_at',{ascending:false}).limit(20);
      if (q.error) throw q.error;
      const rows = q.data || [];
      source = rows.find((x:any)=>/\/CC-UCC-/i.test(String(x.source_document_url||''))) || rows.find((x:any)=>/\/MO-/i.test(String(x.source_document_url||''))) || rows[0] || null;
    }
    if (!source) return json({ok:true,dry_run:true,reason:'JIP nemá leták platný dnes.'});
    if (String(source.detected_valid_from||'') > today || String(source.detected_valid_to||'') < today) throw new Error('Vybraný JIP import není platný dnes.');
    const pageCount = Math.max(1,Math.min(40,Number(source?.metadata?.page_count || source?.metadata?.page_image_urls?.length || 0)));
    if (pageCount < 2) throw new Error('JIP import nemá platný počet stran.');
    const pages:Array<{page:number;url:string;text:string}> = [];
    for (let start=1; start<=pageCount; start+=6) {
      pages.push(...await Promise.all(Array.from({length:Math.min(6,pageCount-start+1)},(_,i)=>fetchPage(String(source.source_document_url),start+i))));
    }
    const candidates = pages.flatMap(p=>parsePage(p.page,p.text));
    const seen = new Set<string>();
    const unique = candidates.filter(c=>{const k=`${norm(c.title)}|${c.price}|${norm(c.quantity_text)}`;if(seen.has(k))return false;seen.add(k);return true;});
    return json({
      ok:true,
      dry_run:true,
      adapter:ADAPTER,
      source_import_id:source.id,
      source_document_url:source.source_document_url,
      valid_from:source.detected_valid_from,
      valid_to:source.detected_valid_to,
      page_count:pageCount,
      candidate_count:unique.length,
      candidates:unique.slice(0,120)
    });
  } catch (e) {
    return json({ok:false,error:e instanceof Error?e.message:String(e),adapter:ADAPTER},500);
  }
});
