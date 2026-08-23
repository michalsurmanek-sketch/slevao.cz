import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as pdfjs from 'npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const LANDING = 'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy';
const ADAPTER = 'tesco-apollo-pdf-v2';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'content-type': 'application/json; charset=utf-8',
};
const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};
const STOP_WORDS = new Set([
  'tesco','vybrane','vybrany','druhy','druh','produkt','produkty','cena','balene','baleny','balena',
  'volny','prodej','clubcard','vice','kus','kusy','gram','kilogram','baleni','akcni','nabidka','nabidky',
]);

type PdfToken = { text: string; x: number; y: number; width: number; height: number };
type PriceCandidate = {
  price: number;
  old_price: number | null;
  x: number;
  y: number;
  kind: 'public' | 'clubcard' | 'unknown';
  source: string;
  context: string;
  context_normalized: string;
};
type Hotspot = {
  position_id: number;
  x_percent: number;
  y_percent: number;
  pdf_x: number;
  pdf_y: number;
  product_refs: string[];
  product_names: string[];
  keywords: string[];
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}
function allowed(req: Request) {
  return req.headers.get('authorization') === `Bearer ${SERVICE}`
    || Boolean(CRON && req.headers.get('x-cron-secret') === CRON);
}
function clean(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
function normalized(value: unknown) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function absolute(path: string) {
  return new URL(path.replace(/&amp;/g, '&'), LANDING).toString();
}
function nextData(html: string) {
  const marker = '<script id="__NEXT_DATA__"';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error('Tesco viewer neobsahuje __NEXT_DATA__.');
  const open = html.indexOf('>', start);
  const close = html.indexOf('</script>', open + 1);
  if (open < 0 || close < 0) throw new Error('Tesco __NEXT_DATA__ nelze vyříznout.');
  return JSON.parse(html.slice(open + 1, close));
}
function dateOnly(value: unknown) {
  const match = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})T/);
  return match?.[1] || null;
}
function refId(ref: any) {
  return clean(ref?.__ref);
}
function decimalPrice(text: string): number | null {
  const match = clean(text).match(/^(\d{1,4})[,.](\d{2})(?:\s*Kč)?$/i);
  if (!match) return null;
  const value = Number(`${match[1]}.${match[2]}`);
  return Number.isFinite(value) && value > 0 && value < 10000 ? value : null;
}
function distance(ax: number, ay: number, bx: number, by: number) {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}
function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? Math.round(sorted[middle] * 10) / 10
    : Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10;
}
function keywords(names: string[]) {
  const out = new Set<string>();
  for (const name of names) {
    for (const word of normalized(name).split(' ')) {
      if (word.length < 4 || STOP_WORDS.has(word) || /^\d+$/.test(word)) continue;
      out.add(word);
    }
  }
  return [...out];
}
function semanticHits(hotspot: Hotspot, candidate: PriceCandidate) {
  const contextWords = new Set(candidate.context_normalized.split(' ').filter(Boolean));
  const matched = hotspot.keywords.filter((word) => contextWords.has(word));
  return { count: matched.length, words: matched };
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: BROWSER_HEADERS,
    redirect: 'follow',
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Tesco HTML HTTP ${response.status}`);
  return { url: response.url, text };
}

async function currentHypermarketViewer() {
  const landing = await fetchText(`${LANDING}?_slevao=${Date.now()}`);
  const match = landing.text.match(/href=["']([^"']*\/hypermarkety\/tesco-letak-\d{4}-\d{2}-\d{2}\/1)["']/i);
  if (!match) throw new Error('Tesco landing neobsahuje aktuální hypermarketový viewer.');
  return absolute(match[1]);
}

function extractApollo(viewerHtml: string) {
  const data = nextData(viewerHtml);
  const pageProps = data?.props?.pageProps || {};
  const state = pageProps?.__APOLLO_STATE__ || {};
  if (!state || typeof state !== 'object') throw new Error('Tesco Apollo state chybí.');

  const leaflets = Object.entries(state)
    .filter(([key, value]: any) => key.startsWith('Leaflet:') && value?.type === 'HM' && Array.isArray(value?.pages))
    .map(([key, value]: any) => ({ key, ...value }));
  if (!leaflets.length) throw new Error('Tesco Apollo state neobsahuje HM leták.');

  leaflets.sort((a: any, b: any) => String(b.validFrom || '').localeCompare(String(a.validFrom || '')));
  const leaflet: any = leaflets[0];
  const pageRefs = leaflet.pages.map(refId).filter(Boolean);
  const pages = pageRefs
    .map((ref: string) => ({ ref, ...(state[ref] || {}) }))
    .filter((page: any) => page?.__typename === 'LeafletMetadataPage')
    .sort((a: any, b: any) => Number(a.page) - Number(b.page));
  const pageImages = pages.map((page: any) => clean(page.pagePNG)).filter((url: string) => /^https:\/\//i.test(url));

  const positionRefs = pages.flatMap((page: any) => (page.positions || []).map(refId)).filter(Boolean);
  const positions = positionRefs
    .map((ref: string) => ({ ref, ...(state[ref] || {}) }))
    .filter((row: any) => row?.__typename === 'LeafletMetadataPagePosition');

  const productRefs = new Set<string>();
  for (const position of positions) {
    for (const item of position.products || []) {
      const ref = refId(item);
      if (ref) productRefs.add(ref);
    }
  }
  const products = [...productRefs]
    .map((ref) => ({ ref, ...(state[ref] || {}) }))
    .filter((row: any) => row?.__typename === 'LeafletProduct');

  return { config: pageProps.config || {}, state, leaflet, pages, pageImages, positions, products };
}

function localContext(tokens: PdfToken[], x: number, y: number) {
  const nearby = tokens
    .filter((token) => Math.abs(token.x - x) <= 115 && Math.abs(token.y - y) <= 95)
    .sort((a, b) => Math.abs(b.y - a.y) > 4 ? b.y - a.y : a.x - b.x)
    .map((token) => token.text);
  const text = clean(nearby.join(' '));
  return { text: text.slice(0, 1200), normalized: normalized(text) };
}

function classifyPrice(contextNormalized: string): 'public' | 'clubcard' | 'unknown' {
  if (contextNormalized.includes('clubcard cena') || contextNormalized.includes('s clubcard')) return 'clubcard';
  if (contextNormalized.includes('cena pro vsechny')) return 'public';
  return 'unknown';
}

function priceCandidates(tokens: PdfToken[]): PriceCandidate[] {
  const candidates: PriceCandidate[] = [];
  const centsTokens = tokens.filter((token) => /^\d{2}$/.test(token.text) && token.height >= 7 && token.height <= 16);
  const integerTokens = tokens.filter((token) => /^\d{1,4}$/.test(token.text) && token.height >= 17 && token.width >= 10);
  const decimalTokens = tokens
    .map((token) => ({ token, value: decimalPrice(token.text) }))
    .filter((row) => row.value !== null) as Array<{ token: PdfToken; value: number }>;

  for (const integer of integerTokens) {
    const whole = Number(integer.text);
    if (!Number.isFinite(whole) || whole <= 0 || whole > 9999) continue;
    const cents = centsTokens
      .filter((token) => token.x >= integer.x + integer.width - 4 && token.x <= integer.x + integer.width + 24)
      .filter((token) => token.y >= integer.y + 2 && token.y <= integer.y + 16)
      .sort((a, b) => distance(integer.x, integer.y, a.x, a.y) - distance(integer.x, integer.y, b.x, b.y))[0];
    if (!cents) continue;

    const price = Math.round((whole + Number(cents.text) / 100) * 100) / 100;
    const old = decimalTokens
      .filter((row) => row.value > price)
      .filter((row) => Math.abs(row.token.x - integer.x) <= 34)
      .filter((row) => row.token.y >= integer.y + 10 && row.token.y <= integer.y + 58)
      .sort((a, b) => Math.abs(a.token.y - integer.y) - Math.abs(b.token.y - integer.y))[0];
    const context = localContext(tokens, integer.x, integer.y);

    candidates.push({
      price,
      old_price: old?.value || null,
      x: Math.round(integer.x * 10) / 10,
      y: Math.round(integer.y * 10) / 10,
      kind: classifyPrice(context.normalized),
      source: `${integer.text}+${cents.text}`,
      context: context.text,
      context_normalized: context.normalized,
    });
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.price}|${candidate.x}|${candidate.y}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pageHotspots(apollo: any, pageRow: any, width: number, height: number): Hotspot[] {
  const positionRefs = (pageRow.positions || []).map(refId).filter(Boolean);
  const rows: Hotspot[] = [];
  for (const positionRef of positionRefs) {
    const position = apollo.state[positionRef];
    if (!position || !Array.isArray(position.products) || !position.products.length) continue;
    const xPercent = Number(position.calculatedPositionX);
    const yPercent = Number(position.calculatedPositionY);
    if (!Number.isFinite(xPercent) || !Number.isFinite(yPercent)) continue;

    const productRefs = position.products.map(refId).filter(Boolean);
    const productNames = productRefs
      .map((ref: string) => clean(apollo.state[ref]?.promoOfferName || apollo.state[ref]?.product?.productName))
      .filter(Boolean);
    if (!productNames.length) continue;

    rows.push({
      position_id: Number(position.id),
      x_percent: Math.round(xPercent * 100) / 100,
      y_percent: Math.round(yPercent * 100) / 100,
      pdf_x: width * xPercent / 100,
      pdf_y: height - (height * yPercent / 100),
      product_refs: productRefs,
      product_names: productNames,
      keywords: keywords(productNames),
    });
  }
  return rows;
}

function pairCost(hotspot: Hotspot, candidate: PriceCandidate) {
  const dx = hotspot.pdf_x - candidate.x;
  const dy = hotspot.pdf_y - candidate.y;
  const spatial = Math.sqrt((dx * 0.9) ** 2 + dy ** 2);
  const semantic = semanticHits(hotspot, candidate);
  const semanticBonus = Math.min(130, semantic.count * 65);
  return {
    cost: Math.max(0, spatial - semanticBonus),
    spatial,
    semantic_count: semantic.count,
    semantic_words: semantic.words,
  };
}

function hungarian(cost: number[][]) {
  const n = cost.length;
  const m = cost[0]?.length || 0;
  if (!n || !m) return [] as number[];
  if (n > m) throw new Error(`Hungarian vyžaduje n<=m, dostal ${n}>${m}.`);
  const u = Array(n + 1).fill(0);
  const v = Array(m + 1).fill(0);
  const p = Array(m + 1).fill(0);
  const way = Array(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(m + 1).fill(Number.POSITIVE_INFINITY);
    const used = Array(m + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Number.POSITIVE_INFINITY;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  const assignment = Array(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] > 0 && p[j] <= n) assignment[p[j] - 1] = j - 1;
  }
  return assignment;
}

function assignHotspots(hotspots: Hotspot[], candidates: PriceCandidate[]) {
  if (!hotspots.length) return [];
  const realCandidateCount = candidates.length;
  const workingCandidates: Array<PriceCandidate | null> = [...candidates];
  while (workingCandidates.length < hotspots.length) workingCandidates.push(null);
  const cost = hotspots.map((hotspot) => workingCandidates.map((candidate) => {
    if (!candidate) return 320;
    return pairCost(hotspot, candidate).cost;
  }));
  const assignment = hungarian(cost);

  return hotspots.map((hotspot, index) => {
    const candidateIndex = assignment[index];
    const candidate = candidateIndex >= 0 && candidateIndex < realCandidateCount ? candidates[candidateIndex] : null;
    if (!candidate) {
      return { ...hotspot, assigned: false, confidence: 'none', candidate: null };
    }
    const metrics = pairCost(hotspot, candidate);
    const confidence = metrics.semantic_count >= 2 || metrics.spatial <= 75
      ? 'high'
      : metrics.semantic_count >= 1 || metrics.spatial <= 125
        ? 'medium'
        : metrics.spatial <= 175 ? 'low' : 'reject';
    return {
      ...hotspot,
      assigned: confidence !== 'reject',
      confidence,
      assignment_cost: Math.round(metrics.cost * 10) / 10,
      spatial_distance: Math.round(metrics.spatial * 10) / 10,
      semantic_count: metrics.semantic_count,
      semantic_words: metrics.semantic_words,
      candidate_index: candidateIndex,
      candidate: {
        price: candidate.price,
        old_price: candidate.old_price,
        kind: candidate.kind,
        x: candidate.x,
        y: candidate.y,
        context: candidate.context.slice(0, 500),
      },
    };
  });
}

async function probePdf(pdfUrl: string, viewerUrl: string, apollo: any, probePages: number) {
  const response = await fetch(pdfUrl, {
    headers: { ...BROWSER_HEADERS, accept: 'application/pdf,*/*;q=0.8', referer: viewerUrl },
    redirect: 'follow',
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Tesco PDF HTTP ${response.status}`);
  const contentType = clean(response.headers.get('content-type')).toLowerCase();
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!contentType.includes('pdf') || bytes.length < 100_000 || bytes.length > 80 * 1024 * 1024) {
    throw new Error(`Tesco PDF má neplatný typ/velikost: ${contentType}, ${bytes.length} B.`);
  }

  const doc = await pdfjs.getDocument({ data: bytes, disableWorker: true, useSystemFonts: true }).promise;
  const limit = Math.min(doc.numPages, Math.max(1, Math.min(8, probePages)));
  const pages: any[] = [];
  const acceptedDistances: number[] = [];
  let totalHotspots = 0;
  let totalCandidates = 0;
  let totalAssigned = 0;
  let totalHigh = 0;
  let totalMedium = 0;
  let totalLow = 0;
  let totalRejected = 0;
  let totalSemantic = 0;

  for (let pageNo = 1; pageNo <= limit; pageNo++) {
    const page = await doc.getPage(pageNo);
    const content: any = await page.getTextContent();
    const tokens: PdfToken[] = (content.items || [])
      .filter((item: any) => typeof item.str === 'string' && clean(item.str))
      .map((item: any) => ({
        text: clean(item.str),
        x: Number(item.transform?.[4] || 0),
        y: Number(item.transform?.[5] || 0),
        width: Number(item.width || 0),
        height: Math.abs(Number(item.height || item.transform?.[3] || item.transform?.[0] || 0)),
      }));
    const width = Number(page.view?.[2] || 0);
    const height = Number(page.view?.[3] || 0);
    const candidates = priceCandidates(tokens);
    const apolloPage = apollo.pages.find((row: any) => Number(row.page) === pageNo);
    const hotspots = apolloPage ? pageHotspots(apollo, apolloPage, width, height) : [];
    const assignments = assignHotspots(hotspots, candidates);

    totalHotspots += hotspots.length;
    totalCandidates += candidates.length;
    for (const row of assignments) {
      if (row.assigned) {
        totalAssigned++;
        acceptedDistances.push(Number(row.spatial_distance || 0));
      } else totalRejected++;
      if (row.confidence === 'high') totalHigh++;
      if (row.confidence === 'medium') totalMedium++;
      if (row.confidence === 'low') totalLow++;
      totalSemantic += Number(row.semantic_count || 0);
    }

    pages.push({
      page: pageNo,
      width: Math.round(width * 10) / 10,
      height: Math.round(height * 10) / 10,
      token_count: tokens.length,
      hotspot_count: hotspots.length,
      candidate_price_count: candidates.length,
      public_candidate_count: candidates.filter((row) => row.kind === 'public').length,
      clubcard_candidate_count: candidates.filter((row) => row.kind === 'clubcard').length,
      assigned_count: assignments.filter((row) => row.assigned).length,
      high_count: assignments.filter((row) => row.confidence === 'high').length,
      medium_count: assignments.filter((row) => row.confidence === 'medium').length,
      low_count: assignments.filter((row) => row.confidence === 'low').length,
      rejected_count: assignments.filter((row) => !row.assigned).length,
      assignments: assignments.slice(0, 60),
      unmatched_price_candidates: candidates
        .map((candidate, index) => ({ candidate, index }))
        .filter(({ index }) => !assignments.some((row) => row.candidate_index === index))
        .slice(0, 30),
    });
  }

  return {
    pdf_bytes: bytes.length,
    pdf_pages: doc.numPages,
    probed_pages: limit,
    probe_hotspots: totalHotspots,
    probe_price_candidates: totalCandidates,
    probe_assigned: totalAssigned,
    probe_high: totalHigh,
    probe_medium: totalMedium,
    probe_low: totalLow,
    probe_rejected: totalRejected,
    probe_semantic_hits: totalSemantic,
    median_accepted_spatial_distance: median(acceptedDistances),
    pages,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(req)) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const viewerUrl = body.viewer_url ? String(body.viewer_url) : await currentHypermarketViewer();
    const viewer = await fetchText(viewerUrl);
    const apollo = extractApollo(viewer.text);
    const pdfUrl = clean(apollo.leaflet.leafletUrl);
    if (!/^https:\/\/digitalcontent\.api\.tesco\.com\//i.test(pdfUrl)) throw new Error('Tesco Apollo nevrátilo oficiální PDF URL.');
    if (apollo.pages.length < 8 || apollo.pageImages.length !== apollo.pages.length) {
      throw new Error(`Tesco Apollo má neúplné stránky: ${apollo.pages.length}/${apollo.pageImages.length}.`);
    }

    const probe = await probePdf(pdfUrl, viewerUrl, apollo, Number(body.probe_pages || 3));
    return json({
      ok: true,
      dry_run: true,
      adapter: ADAPTER,
      viewer_url: viewerUrl,
      apollo_url: clean(apollo.config?.APOLLO_URL),
      leaflet_id: apollo.leaflet.id,
      leaflet_type: apollo.leaflet.type,
      valid_from: dateOnly(apollo.leaflet.validFrom),
      valid_to: dateOnly(apollo.leaflet.validTo),
      page_count: apollo.pages.length,
      page_image_count: apollo.pageImages.length,
      hotspot_count: apollo.positions.length,
      referenced_product_count: apollo.products.length,
      apollo_state_object_count: Object.keys(apollo.state).length,
      pdf_url: pdfUrl,
      ...probe,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error), adapter: ADAPTER }, 500);
  }
});
