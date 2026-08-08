import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as pdfjs from 'npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type, x-cron-secret' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

type PdfToken = { text:string; x:number; y:number; width:number; height:number };
type PdfPage = { page:number; lines:string[]; tokens:PdfToken[] };

function allowed(req: Request) {
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${SERVICE_ROLE_KEY}` || (CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET);
}
function clean(s: string) { return s.replace(/\s+/g, ' ').trim(); }
function round1(n: unknown) {
  const value = Number(n || 0);
  return Math.round(value * 10) / 10;
}
function num(s: string): number | null {
  const m = s.replace(/\s/g, '').replace(',', '.').match(/(?:^|[^\d])(\d{1,5}(?:[.,]\d{1,2})?)(?:\s*(?:Kč|,-|Kc))?(?:$|[^\d])/i);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
}
function looksLikePrice(s: string) {
  return /(?:^|\s)\d{1,4}(?:[,.]\d{1,2})?\s*(?:Kč|,-|Kc)(?:\s|$)/i.test(s) || /^\d{1,4}[,.]\d{2}$/.test(s.trim());
}
function badTitle(s: string) {
  const t = s.toLocaleLowerCase('cs');
  return s.length < 3 || s.length > 120 || /^\d/.test(s) || /(platnost|nabídka|akce|sleva|kč|www\.|telefon|otevírací|club|leták|strana|cena za|ušetříte)/i.test(t);
}
function extractDates(text: string) {
  const year = new Date().getUTCFullYear();
  const ranges = [...text.matchAll(/(\d{1,2})\s*[.\/-]\s*(\d{1,2})(?:\s*[.\/-]\s*(20\d{2}))?\s*(?:-|–|až|do)\s*(\d{1,2})\s*[.\/-]\s*(\d{1,2})(?:\s*[.\/-]\s*(20\d{2}))?/g)];
  if (!ranges.length) return { from: null, to: null };
  const m = ranges[0];
  const y1 = Number(m[3] || m[6] || year), y2 = Number(m[6] || m[3] || year);
  const iso = (y:number, mo:number, d:number) => `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  return { from: iso(y1, Number(m[2]), Number(m[1])), to: iso(y2, Number(m[5]), Number(m[4])) };
}

async function parsePdf(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: bytes, disableWorker: true, useSystemFonts: true }).promise;
  const pages: PdfPage[] = [];
  let allText = '';
  for (let p = 1; p <= Math.min(doc.numPages, 80); p++) {
    const page = await doc.getPage(p);
    const tc:any = await page.getTextContent();
    const items = (tc.items || []).filter((x:any) => typeof x.str === 'string' && clean(x.str));
    items.sort((a:any,b:any) => {
      const ay = Math.round(a.transform?.[5] || 0), by = Math.round(b.transform?.[5] || 0);
      return Math.abs(by-ay) > 3 ? by-ay : (a.transform?.[4] || 0)-(b.transform?.[4] || 0);
    });
    const tokens: PdfToken[] = items.map((it:any) => ({
      text: clean(it.str),
      x: round1(it.transform?.[4]),
      y: round1(it.transform?.[5]),
      width: round1(it.width),
      height: round1(Math.abs(it.height || it.transform?.[3] || it.transform?.[0] || 0)),
    }));
    const rows = new Map<number,string[]>();
    for (const token of tokens) {
      const y = Math.round(token.y / 4) * 4;
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y)!.push(token.text);
    }
    const lines = [...rows.entries()].sort((a,b)=>b[0]-a[0]).map(([,parts])=>clean(parts.join(' '))).filter(Boolean);
    pages.push({ page:p, lines, tokens });
    allText += '\n' + lines.join('\n');
  }
  return { pageCount: doc.numPages, pages, allText: allText.trim() };
}

function extractItems(pages:PdfPage[]) {
  const out:any[] = [];
  const seen = new Set<string>();
  for (const pg of pages) {
    const lines = pg.lines;
    for (let i=0;i<lines.length;i++) {
      if (!looksLikePrice(lines[i])) continue;
      const price = num(lines[i]);
      if (!price) continue;
      let title = '';
      for (let j=i-1;j>=Math.max(0,i-4);j--) {
        const candidate = clean(lines[j]);
        if (!badTitle(candidate) && !looksLikePrice(candidate)) { title = candidate; break; }
      }
      if (!title) {
        for (let j=i+1;j<=Math.min(lines.length-1,i+2);j++) {
          const candidate = clean(lines[j]);
          if (!badTitle(candidate) && !looksLikePrice(candidate)) { title = candidate; break; }
        }
      }
      if (!title) continue;
      const quantity = title.match(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|ks|bal)\b/i)?.[0] || null;
      const key = `${title.toLocaleLowerCase('cs')}|${price}|${pg.page}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ title, price, quantity_text: quantity, source_page: pg.page, confidence: 0.58, raw_data: { parser:'pdf-text-v3', price_line:lines[i] } });
      if (out.length >= 400) return out;
    }
  }
  return out;
}

async function persistExtractedText(importId: string, parsed: { pageCount:number; pages:PdfPage[]; allText:string }) {
  const now = new Date().toISOString();
  const { error } = await db.from('leaflet_extracted_text').upsert({
    import_id: importId,
    parser: 'pdf-text-v3',
    page_count: parsed.pageCount,
    text_content: parsed.allText,
    pages: parsed.pages,
    text_chars: parsed.allText.length,
    updated_at: now,
  }, { onConflict: 'import_id' });
  if (error) throw new Error(`Uložení extrahovaného textu selhalo: ${error.message}`);
}

async function processImport(importId:string) {
  const run = await db.from('leaflet_basic_parser_runs').insert({ import_id: importId, status:'processing' }).select('id').single();
  const runId = run.data?.id;
  try {
    const { data: job, error } = await db.from('leaflet_imports').select('*,stores(name,slug)').eq('id', importId).single();
    if (error || !job) throw error || new Error('Import nebyl nalezen.');
    const url = String(job.source_document_url || '');
    if (!/^https:\/\//i.test(url) || !/\.pdf(?:\?|$)/i.test(url)) throw new Error('Základní parser podporuje digitální PDF.');
    await db.from('leaflet_imports').update({ status:'processing', error_message:null, started_at:new Date().toISOString() }).eq('id', importId);
    const res = await fetch(url, { headers:{ 'user-agent':'Mozilla/5.0', accept:'application/pdf,*/*' }, redirect:'follow' });
    if (!res.ok) throw new Error(`Stažení PDF selhalo: HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length || bytes.length > 80*1024*1024) throw new Error('PDF je prázdné nebo příliš velké.');
    const parsed = await parsePdf(bytes);
    await persistExtractedText(importId, parsed);
    const items = extractItems(parsed.pages);
    const dates = extractDates(parsed.allText);
    await db.from('leaflet_import_items').delete().eq('import_id', importId).neq('status','published');
    if (items.length) {
      const rows = items.map(x => ({ import_id:importId, title:x.title, quantity_text:x.quantity_text, price:x.price, source_page:x.source_page, confidence:x.confidence, status:'review', raw_data:x.raw_data }));
      const ins = await db.from('leaflet_import_items').insert(rows);
      if (ins.error) throw ins.error;
    }
    await db.from('leaflet_imports').update({
      status:'review', product_count:items.length, confidence:items.length ? 0.58 : null,
      detected_valid_from:dates.from, detected_valid_to:dates.to, page_count:parsed.pageCount,
      error_message:items.length ? null : 'PDF neobsahuje použitelnou textovou vrstvu. Použij ruční import nebo OCR.',
      finished_at:new Date().toISOString(),
      metadata:{ ...(job.metadata||{}), processor:'process-leaflet-basic', parser:'pdf-text-v3', ai_used:false, ai_unavailable:false, extracted_text_chars:parsed.allText.length, extracted_text_persisted:true, extracted_token_coordinates:true }
    }).eq('id', importId);
    if (runId) await db.from('leaflet_basic_parser_runs').update({ status:'completed', items_found:items.length, finished_at:new Date().toISOString() }).eq('id',runId);
    return { ok:true, import_id:importId, items:items.length, pages:parsed.pageCount, text_chars:parsed.allText.length, dates };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (runId) await db.from('leaflet_basic_parser_runs').update({ status:'failed', error_message:msg, finished_at:new Date().toISOString() }).eq('id',runId);
    await db.from('leaflet_imports').update({ status:'review', error_message:`Ne-AI parser: ${msg}`, finished_at:new Date().toISOString() }).eq('id',importId);
    return { ok:false, import_id:importId, error:msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok',{headers:CORS});
  if (req.method !== 'POST') return json({error:'Method not allowed'},405);
  if (!allowed(req)) return json({error:'Unauthorized'},401);
  const body = await req.json().catch(()=>({}));
  const importId = String(body.import_id||'');
  if (!/^[0-9a-f-]{36}$/i.test(importId)) return json({error:'Missing import_id'},400);
  return json(await processImport(importId));
});
