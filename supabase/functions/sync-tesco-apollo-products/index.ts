import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import * as pdfjs from 'npm:pdfjs-dist@4.10.38/legacy/build/pdf.mjs';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const LANDING = 'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy';
const ADAPTER = 'tesco-apollo-pdf-v1';
const db = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

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
  const m = String(value ?? '').match(/^(\d{4}-\d{2}-\d{2})T/);
  return m?.[1] || null;
}
function refId(ref: any) {
  return clean(ref?.__ref);
}
function numberLike(text: string) {
  return /(?:^|\s)\d{1,4}(?:[,.]\d{1,2})?(?:\s*(?:Kč|,-))?(?:\s|$)/i.test(text);
}
function likelyPrice(text: string) {
  const s = clean(text);
  return /^\d{1,4}[,.]\d{1,2}$/.test(s)
    || /^\d{1,4}\s*$/.test(s)
    || /^\d{1,2}\s*$/.test(s)
    || /\d{1,4}(?:[,.]\d{1,2})?\s*(?:Kč|,-)/i.test(s);
}

async function fetchText(url: string) {
  const response = await fetch(url, { headers: BROWSER_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
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
  const pages = pageRefs.map((ref: string) => state[ref]).filter(Boolean).sort((a: any, b: any) => Number(a.page) - Number(b.page));
  const pageImages = pages.map((page: any) => clean(page.pagePNG)).filter((url: string) => /^https:\/\//i.test(url));

  const positionRefs = pages.flatMap((page: any) => (page.positions || []).map(refId)).filter(Boolean);
  const positions = positionRefs.map((ref: string) => ({ ref, ...(state[ref] || {}) })).filter((row: any) => row?.__typename === 'LeafletMetadataPagePosition');
  const productRefs = new Set<string>();
  for (const position of positions) for (const item of position.products || []) {
    const ref = refId(item);
    if (ref) productRefs.add(ref);
  }
  const products = [...productRefs].map((ref) => ({ ref, ...(state[ref] || {}) })).filter((row: any) => row?.__typename === 'LeafletProduct');

  return {
    config: pageProps.config || {},
    state,
    leaflet,
    pages,
    pageImages,
    positions,
    products,
  };
}

async function parsePdf(pdfUrl: string, viewerUrl: string, probePages: number) {
  const response = await fetch(pdfUrl, {
    headers: {
      ...BROWSER_HEADERS,
      accept: 'application/pdf,*/*;q=0.8',
      referer: viewerUrl,
    },
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
  const sample: any[] = [];
  const limit = Math.min(doc.numPages, Math.max(1, Math.min(10, probePages)));
  let totalTextChars = 0;
  let totalTokens = 0;
  let likelyPriceTokens = 0;

  for (let pageNo = 1; pageNo <= limit; pageNo++) {
    const page = await doc.getPage(pageNo);
    const content: any = await page.getTextContent();
    const tokens = (content.items || [])
      .filter((item: any) => typeof item.str === 'string' && clean(item.str))
      .map((item: any) => ({
        text: clean(item.str),
        x: Math.round(Number(item.transform?.[4] || 0) * 10) / 10,
        y: Math.round(Number(item.transform?.[5] || 0) * 10) / 10,
        width: Math.round(Number(item.width || 0) * 10) / 10,
        height: Math.round(Math.abs(Number(item.height || item.transform?.[3] || item.transform?.[0] || 0)) * 10) / 10,
      }));
    const text = tokens.map((t: any) => t.text).join(' ');
    const priceTokens = tokens.filter((t: any) => likelyPrice(t.text));
    totalTextChars += text.length;
    totalTokens += tokens.length;
    likelyPriceTokens += priceTokens.length;

    sample.push({
      page: pageNo,
      width: Math.round(Number(page.view?.[2] || 0) * 10) / 10,
      height: Math.round(Number(page.view?.[3] || 0) * 10) / 10,
      token_count: tokens.length,
      text_chars: text.length,
      numeric_token_count: tokens.filter((t: any) => numberLike(t.text)).length,
      likely_price_token_count: priceTokens.length,
      text_sample: text.slice(0, 5000),
      price_token_sample: priceTokens.slice(0, 120),
      token_sample: tokens.slice(0, 250),
    });
  }

  return {
    pdf_bytes: bytes.length,
    pdf_pages: doc.numPages,
    probed_pages: limit,
    total_text_chars_in_probe: totalTextChars,
    total_tokens_in_probe: totalTokens,
    likely_price_tokens_in_probe: likelyPriceTokens,
    sample,
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
    if (apollo.pages.length < 8 || apollo.pageImages.length !== apollo.pages.length) throw new Error(`Tesco Apollo má neúplné stránky: ${apollo.pages.length}/${apollo.pageImages.length}.`);

    const pdf = await parsePdf(pdfUrl, viewerUrl, Number(body.probe_pages || 3));
    const result = {
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
      ...pdf,
    };
    return json(result);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error), adapter: ADAPTER }, 500);
  }
});
