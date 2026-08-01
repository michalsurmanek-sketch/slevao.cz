import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-cron-secret, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'cache-control': 'no-store',
};

const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/json,application/pdf,text/javascript,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.6',
  'cache-control': 'no-cache',
  pragma: 'no-cache',
};

const RESOLVER_NAME = 'official-pdf-sync';
const MAX_DOCUMENTS_PER_STORE = 3;
const PUBLIC_MIN_INTERVAL_MS = 2 * 60 * 60 * 1000;
const TRUSTED_SPECIALIZED_STORES = new Set([
  'action', 'albert', 'billa', 'coop', 'globus', 'hruska', 'kaufland', 'lidl', 'makro', 'penny', 'tesco',
]);

interface SourceDefinition {
  slug: string;
  name: string;
  urls: string[];
  intervalMinutes?: number;
}

interface StoreRow {
  id: string;
  slug: string;
  name: string;
}

interface ResolvedDocument {
  url: string;
  referer: string;
  score: number;
}

interface DateRange {
  from: string | null;
  to: string | null;
}

const SOURCE_CATALOG: SourceDefinition[] = [
  { slug: 'enapo', name: 'Enapo – akční leták', urls: ['https://www.enapo.cz/akcni-letak'] },
  { slug: 'flop', name: 'Flop – akční leták', urls: ['https://www.flop.cz/akcni-letak', 'https://www.flop-potraviny.cz/akcni-letak'] },
  { slug: 'terno', name: 'Terno – aktuální letáky', urls: ['https://www.terno.cz/letaky'] },
  { slug: 'trefa', name: 'Trefa – aktuální letáky', urls: ['https://www.trefa.cz/letaky', 'https://www.trefa.cz/akcni-letak'] },
  { slug: 'jip', name: 'JIP – akční nabídka', urls: ['https://www.jip-potraviny.cz/akcni-nabidka', 'https://www.jipoc.cz/akcni-letak'] },
  { slug: 'norma', name: 'NORMA – aktuální nabídka', urls: ['https://www.norma-online.de/cz/angebote/'] },
  { slug: 'zabka', name: 'Žabka – akce', urls: ['https://www.zabka.cz/akce', 'https://www.zabka.cz/akcni-letak'] },
  { slug: 'brnenka', name: 'Brněnka – akční leták', urls: ['https://www.brnenka.cz/akcni-letak', 'https://www.brnenka.cz/letak'] },
  { slug: 'cba', name: 'CBA – akční leták', urls: ['https://www.cba.cz/akcni-letak', 'https://www.cba.cz/letaky'] },
  { slug: 'jednota', name: 'Jednota – akční leták', urls: ['https://www.jednota.cz/akcni-letak', 'https://www.jednota.cz/letaky'] },
  { slug: 'konzum', name: 'Konzum – akční leták', urls: ['https://www.konzumuo.cz/akcni-letak', 'https://www.konzumuo.cz/letaky'] },
  { slug: 'tempo', name: 'TEMPO – akční leták', urls: ['https://www.tempo.cz/akcni-letak', 'https://www.tempo.cz/letaky'] },
  { slug: 'ratio', name: 'Ratio – akční leták', urls: ['https://www.ratio.cz/akcni-letak', 'https://www.ratio.cz/letaky'] },
  { slug: 'kubik', name: 'Kubík – akční leták', urls: ['https://www.kubik.cz/akcni-letak', 'https://www.kubik.cz/letaky'] },
  { slug: 'rosa-market', name: 'Rosa market – akční leták', urls: ['https://www.rosamarket.cz/akcni-letak', 'https://www.rosamarket.cz/letaky'] },
  { slug: 'tamda', name: 'Tamda Foods – akční leták', urls: ['https://www.tamdafoods.eu/akcni-letak', 'https://tamdafoods.eu/letak'] },
  { slug: 'potraviny-muj-obchod', name: 'Můj obchod – akční leták', urls: ['https://www.mujobchod.cz/akcni-letak', 'https://www.mujobchod.cz/letaky'] },
  { slug: 'pramen-cz', name: 'Pramen – akční leták', urls: ['https://www.pramen.cz/akcni-letak', 'https://www.pramen.cz/letaky'] },
  { slug: 'eso-market', name: 'ESO MARKET – akční leták', urls: ['https://www.esomarket.cz/akcni-letak', 'https://www.esomarket.cz/letaky'] },

  { slug: 'rossmann', name: 'ROSSMANN – akce a letáky', urls: ['https://www.rossmann.cz/obsah/akce-a-letaky?action=letak', 'https://www.rossmann.cz/obsah/akce-a-letaky'] },
  { slug: 'teta', name: 'Teta drogerie – aktuální letáky', urls: ['https://www.tetadrogerie.cz/akce/letak', 'https://www.tetadrogerie.cz/akce'] },
  { slug: 'dm', name: 'dm – aktuální nabídky', urls: ['https://www.dm.cz/aktualni-nabidky'] },

  { slug: 'tedi', name: 'TEDi – aktuální prospekt', urls: ['https://www.tedi.com/cz/aktualne/prospekt', 'https://www.tedi.com/cz/prospekt'] },
  { slug: 'pepco', name: 'Pepco – aktuální leták', urls: ['https://pepco.cz/letak/', 'https://pepco.cz/akcni-letak/'] },
  { slug: 'kik', name: 'KiK – aktuální leták', urls: ['https://www.kik.cz/', 'https://www.kik.cz/prospekt'] },
  { slug: 'takko', name: 'Takko Fashion – akční nabídky', urls: ['https://www.takko.com/cs-cz/akcni-nabidky/', 'https://www.takko.com/cs-cz/letak/'] },

  { slug: 'obi', name: 'OBI – aktuální leták', urls: ['https://www.obi.cz/nabidky/aktualni-letak', 'https://www.obi.cz/letak'] },
  { slug: 'hornbach', name: 'HORNBACH – aktuální nabídky', urls: ['https://www.hornbach.cz/aktualni-nabidky/', 'https://www.hornbach.cz/letak/'] },
  { slug: 'bauhaus', name: 'BAUHAUS – akční nabídky', urls: ['https://www.bauhaus.cz/akcni-nabidky', 'https://www.bauhaus.cz/letak'] },
  { slug: 'mountfield', name: 'Mountfield – akční nabídky', urls: ['https://www.mountfield.cz/akcni-nabidky', 'https://www.mountfield.cz/letak'] },
  { slug: 'dek', name: 'DEK – akce a katalogy', urls: ['https://www.dek.cz/akce', 'https://www.dek.cz/katalogy'] },
  { slug: 'pro-doma', name: 'PRO-DOMA – akční nabídky', urls: ['https://www.pro-doma.cz/akcni-nabidky', 'https://www.pro-doma.cz/letak'] },
  { slug: 'stavmat', name: 'STAVMAT – akční nabídky', urls: ['https://www.stavmat.cz/akcni-nabidky', 'https://www.stavmat.cz/letak'] },

  { slug: 'datart', name: 'DATART – aktuální leták', urls: ['https://www.datart.cz/letak.html', 'https://www.datart.cz/akcni-letak.html'] },
  { slug: 'planeo', name: 'PLANEO – aktuální leták', urls: ['https://www.planeo.cz/akcni-letak', 'https://www.planeo.cz/produkt'] },
  { slug: 'okay', name: 'OKAY – akční leták', urls: ['https://www.okay.cz/pages/akcni-letak', 'https://www.okay.cz/akcni-letak'] },
  { slug: 'alza', name: 'Alza – akce a katalogy', urls: ['https://www.alza.cz/akce', 'https://www.alza.cz/katalog'] },
  { slug: 'smarty', name: 'Smarty – akce', urls: ['https://www.smarty.cz/akce', 'https://www.smarty.cz/letak'] },

  { slug: 'ikea', name: 'IKEA – nabídky a katalogy', urls: ['https://www.ikea.com/cz/cs/offers/', 'https://www.ikea.com/cz/cs/customer-service/catalogues/'] },
  { slug: 'jysk', name: 'JYSK – aktuální leták', urls: ['https://jysk.cz/letak', 'https://jysk.cz/campaign'] },
  { slug: 'moebelix', name: 'Möbelix – aktuální leták', urls: ['https://www.moebelix.cz/c/letak'] },
  { slug: 'sconto', name: 'Sconto – akční leták', urls: ['https://www.sconto.cz/akcni-letak', 'https://www.sconto.cz/letaky'] },
  { slug: 'asko', name: 'ASKO – aktuální leták', urls: ['https://www.asko-nabytek.cz/letak', 'https://www.asko-nabytek.cz/akcni-letak'] },
  { slug: 'xxxlutz', name: 'XXXLutz – aktuální leták', urls: ['https://www.xxxlutz.cz/c/letak'] },

  { slug: 'decathlon', name: 'Decathlon – akční nabídky', urls: ['https://www.decathlon.cz/vsechny-sporty/akce', 'https://www.decathlon.cz/letak'] },
  { slug: 'sportisimo', name: 'Sportisimo – akce', urls: ['https://www.sportisimo.cz/akce/', 'https://www.sportisimo.cz/letak/'] },
  { slug: 'intersport', name: 'INTERSPORT – akční nabídky', urls: ['https://www.intersport.cz/akce/', 'https://www.intersport.cz/letak/'] },

  { slug: 'super-zoo', name: 'Super zoo – aktuální leták', urls: ['https://www.superzoo.cz/letak/', 'https://www.superzoo.cz/akce/'] },
  { slug: 'petcenter', name: 'PetCenter – akce a letáky', urls: ['https://www.petcenter.cz/akce/', 'https://www.petcenter.cz/letak/'] },
  { slug: 'dr-max', name: 'Dr. Max – akční nabídky', urls: ['https://www.drmax.cz/akce', 'https://www.drmax.cz/letak'] },
  { slug: 'benu', name: 'BENU – akce a leták', urls: ['https://www.benu.cz/akce', 'https://www.benu.cz/letak'] },
  { slug: 'pilulka', name: 'Pilulka – akce', urls: ['https://www.pilulka.cz/akce', 'https://www.pilulka.cz/letak'] },
  { slug: 'auto-kelly', name: 'Auto Kelly – akční nabídky', urls: ['https://www.autokelly.cz/akce', 'https://www.autokelly.cz/letak'] },
];

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, { status, headers: CORS_HEADERS });
}

function decodeEscapes(value: string): string {
  return String(value || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#38;/gi, '&');
}

function absoluteUrl(base: string, value: string): string | null {
  const cleaned = decodeEscapes(value).trim().replace(/[),.;]+$/, '');
  if (!cleaned || /^(?:data|javascript|mailto|tel):/i.test(cleaned)) return null;
  try {
    const url = new URL(cleaned, base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    url.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'fbclid'].forEach((key) => url.searchParams.delete(key));
    return url.toString();
  } catch {
    return null;
  }
}

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function candidateScore(value: string): number {
  const lower = decodeURIComponent(value).toLocaleLowerCase('cs');
  const currentYear = new Date().getUTCFullYear();
  const rejected = [
    'vyrocni', 'annual-report', 'udrzitel', 'sustainab', 'obchodni-podminky', 'privacy',
    'gdpr', 'manual', 'navod', 'bezpecnostni-list', 'reklamacni', 'kariera', 'press-release',
    'vseobecne-podminky', 'ochrana-osobnich', 'formular', 'cenik-sluzeb', 'newsletter',
  ];
  if (rejected.some((part) => lower.includes(part))) return -100;
  if (!/\.pdf(?:[?#]|$)/i.test(lower)) return -100;

  let score = 100;
  if (/(letak|leták|prospekt|katalog|catalog|leaflet|flyer|weekly|akcni|akční|nabidka|nabídka)/i.test(lower)) score += 45;
  if (/(current|aktual|2026|week|tyden|týden)/i.test(lower)) score += 20;
  if (/(download|stahnout|stáhnout|media|uploads|documents)/i.test(lower)) score += 8;

  const years = [...lower.matchAll(/(?:^|\D)(20\d{2})(?:\D|$)/g)].map((match) => Number(match[1]));
  if (years.some((year) => year < currentYear - 1)) score -= 90;
  if (years.includes(currentYear)) score += 25;
  return score;
}

function extractPdfCandidates(text: string, baseUrl: string): string[] {
  const decoded = decodeEscapes(text);
  const found = new Map<string, number>();
  const patterns = [
    /https?:\/\/[^\s"'<>\\]+?\.pdf(?:\?[^\s"'<>\\]*)?/gi,
    /(?:href|src|data-src|data-url|data-href|data-download|content)=["']([^"']+?\.pdf(?:\?[^"']*)?)["']/gi,
    /(?:pdfUrl|pdf_url|downloadPdfUrl|download_pdf_url|downloadUrl|download_url|documentUrl|document_url|catalogUrl|catalog_url)["']?\s*[:=]\s*["']([^"']+)["']/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(decoded))) {
      const url = absoluteUrl(baseUrl, match[1] || match[0]);
      if (!url) continue;
      const score = candidateScore(url);
      if (score < 80) continue;
      found.set(url, Math.max(score, found.get(url) || 0));
    }
  }

  return [...found.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([url]) => url)
    .slice(0, 40);
}

function extractLeafletLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const pattern = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const raw = decodeEscapes(match[1]);
    if (!/(letak|leták|prospekt|katalog|catalog|leaflet|flyer|flipbook|publitas|akcni|akční)/i.test(raw)) continue;
    const url = absoluteUrl(baseUrl, raw);
    if (!url || /\.pdf(?:[?#]|$)/i.test(url)) continue;
    try {
      const target = new URL(url);
      const base = new URL(baseUrl);
      if (target.hostname === base.hostname || /(?:publitas|flippingbook|fliphtml5|publuu|files\.rewe)/i.test(target.hostname)) links.add(url);
    } catch { /* ignore */ }
  }
  return [...links].slice(0, 8);
}

function extractAssetLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const pattern = /<(?:script|link)[^>]+(?:src|href)=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html))) {
    const url = absoluteUrl(baseUrl, match[1]);
    if (!url) continue;
    try {
      const target = new URL(url);
      const base = new URL(baseUrl);
      if (target.hostname === base.hostname && /\.(?:js|json)(?:[?#]|$)/i.test(target.pathname + target.search)) links.add(url);
    } catch { /* ignore */ }
  }
  return [...links].slice(0, 8);
}

async function fetchText(url: string, referer = '', timeoutMs = 12_000): Promise<{ text: string; url: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        ...BROWSER_HEADERS,
        ...(referer ? { referer } : {}),
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > 8_000_000) throw new Error('Stránka je příliš velká.');
    return { text, url: response.url };
  } finally {
    clearTimeout(timer);
  }
}

async function publitasCandidates(text: string, baseUrl: string): Promise<string[]> {
  const decoded = decodeEscapes(text);
  const publications = new Map<string, { group: string; publication: string }>();
  const pattern = /https?:\/\/view\.publitas\.com\/([^/"'?#\s]+)\/([^/"'?#\s]+)\/?/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(decoded))) {
    publications.set(`${match[1]}/${match[2]}`, { group: match[1], publication: match[2] });
  }

  const results: string[] = [];
  for (const item of [...publications.values()].slice(0, 6)) {
    try {
      const apiUrl = `https://api.publitas.com/v1/groups/${encodeURIComponent(item.group)}/publications/${encodeURIComponent(item.publication)}.json`;
      const response = await fetchText(apiUrl, baseUrl, 10_000);
      const payload = JSON.parse(response.text);
      const raw = payload?.config?.downloadPdfUrl || payload?.downloadPdfUrl || payload?.publication?.downloadPdfUrl;
      const url = raw ? absoluteUrl('https://view.publitas.com/', String(raw)) : null;
      if (url && candidateScore(url) >= 80) results.push(url);
    } catch (error) {
      console.warn('Publitas publication skipped:', error instanceof Error ? error.message : String(error));
    }
  }
  return results;
}

async function flippingBookCandidates(text: string, baseUrl: string): Promise<string[]> {
  const viewers = new Set<string>();
  const decoded = decodeEscapes(text);
  const patterns = [
    /https?:\/\/files\.rewe\.co\.at\/[^\s"'<>]+/gi,
    /https?:\/\/[^\s"'<>]*(?:flippingbook|flipbook)[^\s"'<>]*/gi,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(decoded))) {
      const url = absoluteUrl(baseUrl, match[0]);
      if (url && !/\.pdf(?:[?#]|$)/i.test(url)) viewers.add(url);
    }
  }

  const results: string[] = [];
  for (const viewerUrl of [...viewers].slice(0, 6)) {
    try {
      const viewer = await fetchText(viewerUrl, baseUrl, 10_000);
      results.push(...extractPdfCandidates(viewer.text, viewer.url));
      const dynamicFolder = viewer.text.match(/FBInit\.DYNAMIC_FOLDER\s*=\s*["']([^"']+)["']/i)?.[1];
      if (!dynamicFolder) continue;
      const workspaceUrl = new URL(`${dynamicFolder.replace(/\/+$/, '')}/workspace.js`, viewer.url).toString();
      const workspace = await fetchText(workspaceUrl, viewer.url, 10_000);
      results.push(...extractPdfCandidates(workspace.text, workspace.url));
      try {
        const payload = JSON.parse(workspace.text.replace(/^\uFEFF/, '').trim());
        const downloadName = String(payload?.downloads?.url || '').trim();
        if (/\.pdf$/i.test(downloadName)) {
          const url = new URL(`${dynamicFolder.replace(/\/+$/, '')}/common/downloads/${encodeURIComponent(downloadName)}`, viewer.url).toString();
          results.push(url);
        }
      } catch { /* workspace can be JavaScript instead of JSON */ }
    } catch (error) {
      console.warn('Flipbook publication skipped:', error instanceof Error ? error.message : String(error));
    }
  }
  return results;
}

async function validatePdf(url: string, referer: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14_000);
  try {
    const response = await fetch(url, {
      headers: {
        ...BROWSER_HEADERS,
        accept: 'application/pdf,*/*;q=0.5',
        range: 'bytes=0-8191',
        ...(referer ? { referer } : {}),
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok && response.status !== 206) return null;
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const reader = response.body?.getReader();
    const first = reader ? await reader.read() : { value: new Uint8Array(), done: true };
    await reader?.cancel().catch(() => undefined);
    const bytes = first.value || new Uint8Array();
    const signature = bytes.length >= 4
      && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    if (!contentType.includes('application/pdf') && !signature) return null;
    return absoluteUrl(response.url, response.url);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function isoDate(day: number, month: number, year: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function detectCurrentRange(text: string): DateRange {
  const cleaned = visibleText(text);
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const matches = cleaned.matchAll(/(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(\d{4}))?\s*(?:-|–|—|až|do)\s*(\d{1,2})\.\s*(\d{1,2})\.(?:\s*(\d{4}))?/gi);

  const ranges: Array<{ from: string; to: string; distance: number }> = [];
  for (const match of matches) {
    let fromYear = match[3] ? Number(match[3]) : now.getUTCFullYear();
    let toYear = match[6] ? Number(match[6]) : fromYear;
    const fromMonth = Number(match[2]);
    const toMonth = Number(match[5]);
    if (!match[6] && toMonth < fromMonth) toYear++;
    let from = isoDate(Number(match[1]), fromMonth, fromYear);
    let to = isoDate(Number(match[4]), toMonth, toYear);
    if (!from || !to) continue;
    if (!match[3] && to < today && Date.parse(`${today}T00:00:00Z`) - Date.parse(`${to}T00:00:00Z`) > 180 * 86_400_000) {
      fromYear++;
      toYear++;
      from = isoDate(Number(match[1]), fromMonth, fromYear);
      to = isoDate(Number(match[4]), toMonth, toYear);
    }
    if (!from || !to || from > to) continue;
    const duration = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
    if (duration > 120 * 86_400_000) continue;
    const distance = Math.abs(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`));
    ranges.push({ from, to, distance });
  }

  ranges.sort((left, right) => {
    const leftCurrent = left.from <= today && left.to >= today ? 0 : 1;
    const rightCurrent = right.from <= today && right.to >= today ? 0 : 1;
    return leftCurrent - rightCurrent || left.distance - right.distance;
  });
  return ranges[0] ? { from: ranges[0].from, to: ranges[0].to } : { from: null, to: null };
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function ensureLandingSource(store: StoreRow, definition: SourceDefinition, sourceUrl: string) {
  const { data: existing, error: readError } = await db.from('leaflet_sources')
    .select('id,is_active,auto_publish,last_checked_at')
    .eq('source_url', sourceUrl)
    .maybeSingle();
  if (readError) throw readError;

  if (existing) {
    const { data, error } = await db.from('leaflet_sources').update({
      store_id: store.id,
      name: definition.name,
      source_type: 'html',
      check_interval_minutes: definition.intervalMinutes || 360,
      coverage_scope: 'national',
    }).eq('id', existing.id).select('id,is_active,auto_publish,last_checked_at').single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await db.from('leaflet_sources').insert({
    store_id: store.id,
    name: definition.name,
    source_url: sourceUrl,
    source_type: 'html',
    is_active: false,
    auto_publish: false,
    check_interval_minutes: definition.intervalMinutes || 360,
    coverage_scope: 'national',
    last_checked_at: null,
    last_error: 'Čeká na automatické ověření oficiálního PDF',
  }).select('id,is_active,auto_publish,last_checked_at').single();
  if (error) throw error;
  return data;
}

async function resolveLandingPage(landingUrl: string): Promise<{ documents: ResolvedDocument[]; range: DateRange; finalUrl: string }> {
  const landing = await fetchText(landingUrl);
  const candidateMap = new Map<string, ResolvedDocument>();
  const add = (url: string, referer = landing.url) => {
    const normalized = absoluteUrl(referer, url);
    if (!normalized) return;
    const score = candidateScore(normalized);
    if (score < 80) return;
    const previous = candidateMap.get(normalized);
    if (!previous || previous.score < score) candidateMap.set(normalized, { url: normalized, referer, score });
  };

  extractPdfCandidates(landing.text, landing.url).forEach((url) => add(url, landing.url));
  (await publitasCandidates(landing.text, landing.url)).forEach((url) => add(url, landing.url));
  (await flippingBookCandidates(landing.text, landing.url)).forEach((url) => add(url, landing.url));

  const linkedPages = extractLeafletLinks(landing.text, landing.url);
  for (const pageUrl of linkedPages.slice(0, 6)) {
    try {
      const page = await fetchText(pageUrl, landing.url, 10_000);
      extractPdfCandidates(page.text, page.url).forEach((url) => add(url, page.url));
      (await publitasCandidates(page.text, page.url)).forEach((url) => add(url, page.url));
      (await flippingBookCandidates(page.text, page.url)).forEach((url) => add(url, page.url));
    } catch (error) {
      console.warn('Linked leaflet page skipped:', pageUrl, error instanceof Error ? error.message : String(error));
    }
  }

  const assets = extractAssetLinks(landing.text, landing.url);
  for (const assetUrl of assets.slice(0, 6)) {
    try {
      const asset = await fetchText(assetUrl, landing.url, 8_000);
      extractPdfCandidates(asset.text, asset.url).forEach((url) => add(url, landing.url));
    } catch { /* optional asset */ }
  }

  const ordered = [...candidateMap.values()].sort((left, right) => right.score - left.score);
  const documents: ResolvedDocument[] = [];
  for (const candidate of ordered.slice(0, 18)) {
    const verified = await validatePdf(candidate.url, candidate.referer);
    if (!verified || documents.some((document) => document.url === verified)) continue;
    documents.push({ ...candidate, url: verified });
    if (documents.length >= MAX_DOCUMENTS_PER_STORE) break;
  }

  return {
    documents,
    range: detectCurrentRange(landing.text),
    finalUrl: landing.url,
  };
}

async function syncImports(store: StoreRow, sourceId: string, landingUrl: string, documents: ResolvedDocument[], range: DateRange) {
  const now = new Date().toISOString();
  const urls = documents.map((document) => document.url);
  const { data: existingRows, error: existingError } = await db.from('leaflet_imports')
    .select('id,source_document_url,status,metadata')
    .eq('store_id', store.id)
    .limit(200);
  if (existingError) throw existingError;

  const existingByUrl = new Map((existingRows || []).map((row: any) => [String(row.source_document_url), row]));
  let inserted = 0;
  let restored = 0;

  for (const document of documents) {
    const existing = existingByUrl.get(document.url) as any;
    if (existing) {
      const isOwned = existing.metadata?.resolver === RESOLVER_NAME;
      if (isOwned && ['ignored', 'failed'].includes(String(existing.status))) {
        const { error } = await db.from('leaflet_imports').update({
          status: 'review',
          source_id: sourceId,
          detected_valid_from: range.from,
          detected_valid_to: range.to,
          confidence: 1,
          error_message: null,
          finished_at: now,
          metadata: {
            ...(existing.metadata || {}),
            display_only: true,
            resolver: RESOLVER_NAME,
            landing_url: landingUrl,
            verified_pdf: true,
            refreshed_at: now,
          },
        }).eq('id', existing.id);
        if (error) throw error;
        restored++;
      }
      continue;
    }

    const sourceHash = await sha256(`${RESOLVER_NAME}:${store.id}:${document.url}`);
    const { error } = await db.from('leaflet_imports').insert({
      source_id: sourceId,
      store_id: store.id,
      source_document_url: document.url,
      source_hash: sourceHash,
      status: 'review',
      detected_valid_from: range.from,
      detected_valid_to: range.to,
      page_count: null,
      product_count: 0,
      confidence: 1,
      error_message: null,
      finished_at: now,
      metadata: {
        display_only: true,
        resolver: RESOLVER_NAME,
        landing_url: landingUrl,
        verified_pdf: true,
        discovered_at: now,
      },
    });
    if (error && !String(error.message || '').includes('duplicate key')) throw error;
    if (!error) inserted++;
  }

  const staleIds = (existingRows || [])
    .filter((row: any) => row.metadata?.resolver === RESOLVER_NAME)
    .filter((row: any) => !urls.includes(String(row.source_document_url || '')))
    .filter((row: any) => !['ignored', 'failed'].includes(String(row.status || '')))
    .map((row: any) => String(row.id));

  if (staleIds.length) {
    const { error } = await db.from('leaflet_imports').update({
      status: 'ignored',
      error_message: 'Nahrazen novějším oficiálním letákem',
      finished_at: now,
    }).in('id', staleIds);
    if (error) throw error;
  }

  return { inserted, restored, hidden_old: staleIds.length };
}

async function processDefinition(store: StoreRow, definition: SourceDefinition, force: boolean) {
  let lastError = 'Oficiální stránka nevrátila ověřitelné PDF.';
  let source: any = null;
  let checkedUrl = definition.urls[0];

  for (const landingUrl of definition.urls) {
    checkedUrl = landingUrl;
    try {
      source = await ensureLandingSource(store, definition, landingUrl);
      const lastChecked = source?.last_checked_at ? Date.parse(source.last_checked_at) : 0;
      const intervalMs = Math.max(definition.intervalMinutes || 360, 120) * 60_000;
      if (!force && lastChecked && Date.now() - lastChecked < Math.max(PUBLIC_MIN_INTERVAL_MS, intervalMs)) {
        return { slug: store.slug, status: 'skipped', reason: 'Zdroj byl kontrolován nedávno.' };
      }

      const result = await resolveLandingPage(landingUrl);
      if (!result.documents.length) throw new Error('Na stránce nebylo nalezeno platné PDF letáku.');
      const sync = await syncImports(store, source.id, result.finalUrl, result.documents, result.range);
      const now = new Date().toISOString();
      const { error: sourceError } = await db.from('leaflet_sources').update({
        last_checked_at: now,
        last_success_at: now,
        last_error: null,
      }).eq('id', source.id);
      if (sourceError) throw sourceError;

      return {
        slug: store.slug,
        status: 'ok',
        source: result.finalUrl,
        documents: result.documents.map((document) => document.url),
        valid_from: result.range.from,
        valid_to: result.range.to,
        ...sync,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.warn(`Official leaflet source ${store.slug} failed:`, landingUrl, lastError);
      if (source?.id) {
        await db.from('leaflet_sources').update({
          last_checked_at: new Date().toISOString(),
          last_error: lastError.slice(0, 1000),
        }).eq('id', source.id);
      }
    }
  }

  return { slug: store.slug, status: 'not-found', source: checkedUrl, error: lastError };
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const authorization = request.headers.get('authorization') || '';
  const suppliedCronSecret = request.headers.get('x-cron-secret') || '';
  const trusted = authorization === `Bearer ${SERVICE_ROLE_KEY}` || Boolean(CRON_SECRET && suppliedCronSecret === CRON_SECRET);
  const body = await request.json().catch(() => ({}));
  const requestedSlug = String(body?.store_slug || '').trim().toLocaleLowerCase('cs');
  const force = trusted && Boolean(body?.force);
  const requestedLimit = Math.max(1, Math.min(80, Number(body?.limit || 80)));

  const { data: stores, error: storesError } = await db.from('stores')
    .select('id,slug,name')
    .eq('is_active', true)
    .limit(500);
  if (storesError) return json({ error: storesError.message }, 500);
  const storeMap = new Map((stores || []).map((store: any) => [String(store.slug), store as StoreRow]));

  const definitions = SOURCE_CATALOG
    .filter((definition) => !TRUSTED_SPECIALIZED_STORES.has(definition.slug))
    .filter((definition) => !requestedSlug || definition.slug === requestedSlug)
    .filter((definition) => storeMap.has(definition.slug))
    .slice(0, requestedLimit);

  const results = await mapConcurrent(definitions, 4, async (definition) => {
    const store = storeMap.get(definition.slug)!;
    try {
      return await processDefinition(store, definition, force);
    } catch (error) {
      return {
        slug: definition.slug,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  const added = results.reduce((sum: number, result: any) => sum + Number(result.inserted || 0), 0);
  const restored = results.reduce((sum: number, result: any) => sum + Number(result.restored || 0), 0);
  const hiddenOld = results.reduce((sum: number, result: any) => sum + Number(result.hidden_old || 0), 0);
  return json({
    ok: true,
    resolver: RESOLVER_NAME,
    checked: results.length,
    added,
    restored,
    hidden_old: hiddenOld,
    successful_stores: results.filter((result: any) => result.status === 'ok').map((result: any) => result.slug),
    results,
  });
});
