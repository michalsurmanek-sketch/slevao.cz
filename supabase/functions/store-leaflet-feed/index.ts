import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TESCO_LISTING_URL = 'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy';
const PENNY_LISTING_URL = 'https://www.penny.cz/letaky';
const ACTION_LISTING_URL = 'https://www.action.com/cs-cz/letak/';
const TETA_LISTING_URL = 'https://www.tetadrogerie.cz/akce/letak';
const LIDL_LISTING_URL = 'https://www.lidl.cz/c/akcni-letak/s10008644';
const LIDL_API_URL = 'https://endpoints.leaflets.schwarz/v4/overview?client_locale=lidl%2Fcs-CZ';
const ROSSMANN_LISTING_URL = 'https://www.rossmann.cz/obsah/akce-a-letaky';
const MAKRO_LISTING_URL = 'https://www.makro.cz/aktualni-nabidka';
const ROHLIK_DEALS_URL = 'https://www.rohlik.cz/cenove-trhaky';
const KOSIK_DEALS_URL = 'https://www.kosik.cz/s1-akce';
const SUPER_ZOO_DEALS_URL = 'https://www.superzoo.cz/akce/';
const HORNBACH_CATALOGS_URL = 'https://www.hornbach.cz/aktuality/katalogy/';
const MOUNTFIELD_DEALS_URL = 'https://www.mountfield.cz/akce';
const ALZA_DEALS_URL = 'https://www.alza.cz/vyprodej-akce-sleva/e0.htm';
const DATART_LEAFLET_URL = 'https://www.datart.cz/letak';
const DECATHLON_DEALS_URL = 'https://www.decathlon.cz/deals/doprodej';
const SCONTO_LEAFLET_URL = 'https://www.sconto.cz/letak';
const MOEBELIX_DEALS_URL = 'https://www.moebelix.cz/c/slevy';
const XXXLUTZ_LEAFLETS_URL = 'https://www.xxxlutz.cz/c/letaky';
const SPORTISIMO_DEALS_URL = 'https://www.sportisimo.cz/vyprodej/';
const SMARTY_DEALS_URL = 'https://www.smarty.cz/vyprodej-4c10260';
const PILULKA_DEALS_URL = 'https://www.pilulka.cz/akce-a-slevy';
const AUTO_KELLY_BENEFITS_URL = 'https://www.autokelly.cz/page/vernostni-program';
const DEK_DEALS_URL = 'https://www.dek.cz/akce/nabidka/';
const PRO_DOMA_DEALS_URL = 'https://www.pro-doma.cz/akce-a-slevy';
const STAVMAT_DEALS_URL = 'https://www.stavmat.cz/akce/';
const HM_SALE_URL = 'https://www2.hm.com/cs_cz/zeny/vyprodej/zobrazit-vse.html';
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'cache-control': 'public, max-age=600, s-maxage=600',
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type Leaflet = {
  key: string;
  title: string;
  subtitle: string;
  valid_from: string | null;
  valid_to: string | null;
  url: string;
  direct: boolean;
  preview_url?: string;
  embed_url?: string;
  logo_url?: string | null;
};

function isoDate(value: string, endDate = false): string | null {
  const match = value.match(/(\d{1,2})\.(\d{1,2})\.(?:(\d{4}))?/);
  if (!match) return null;
  const now = new Date();
  let year = match[3] ? Number(match[3]) : now.getUTCFullYear();
  const month = Number(match[2]);
  if (!match[3] && endDate && month < now.getUTCMonth() + 1 - 8) year++;
  return `${year}-${String(month).padStart(2, '0')}-${String(Number(match[1])).padStart(2, '0')}`;
}

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&ndash;|&#8211;|&#x2013;/gi, '–')
    .replace(/&mdash;|&#8212;|&#x2014;/gi, '—')
    .replace(/\s+/g, ' ');
}

function actionPromotionRange(now = new Date()): { from: string; to: string } {
  const day = now.getUTCDay();
  const daysSinceWednesday = (day + 4) % 7;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceWednesday));
  const to = new Date(from.getTime() + 6 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function actionOfficialLeaflet(): Leaflet {
  const range = actionPromotionRange();
  return {
    key: 'action-current',
    title: 'Týdenní akce',
    subtitle: 'Action',
    valid_from: range.from,
    valid_to: range.to,
    url: ACTION_LISTING_URL,
    direct: false,
  };
}

function officialLeaflets(html: string): Leaflet[] {
  const text = visibleText(html);
  const definitions = [
    { key: 'hypermarket', title: 'Akční leták', subtitle: 'Tesco Hypermarket', pattern: /Tesco Hypermarket\s+(\d{1,2}\.\d{1,2}\.)\s*[-–]\s*(\d{1,2}\.\d{1,2}\.\d{4})/i },
    { key: 'supermarket', title: 'Akční leták', subtitle: 'Tesco Supermarket', pattern: /Tesco Supermarket\s+(\d{1,2}\.\d{1,2}\.)\s*[-–]\s*(\d{1,2}\.\d{1,2}\.\d{4})/i },
    { key: 'catalog', title: 'Katalog', subtitle: 'Tesco Katalog', pattern: /Tesco Katalog\s+(\d{1,2}\.\d{1,2}\.)\s*[-–]\s*(\d{1,2}\.\d{1,2}\.\d{4})/i },
  ];
  return definitions.flatMap((definition) => {
    const match = text.match(definition.pattern);
    if (!match) return [];
    return [{
      key: definition.key,
      title: definition.title,
      subtitle: definition.subtitle,
      valid_from: isoDate(match[1]),
      valid_to: isoDate(match[2], true),
      url: TESCO_LISTING_URL,
      direct: false,
    }];
  });
}

function documentKind(url: string): string | null {
  const value = decodeURIComponent(url).toLocaleLowerCase('cs');
  if (/katalog|catalog/.test(value)) return 'catalog';
  if (/supermarket|(?:^|[_-])sm(?:[._-]|$)/.test(value)) return 'supermarket';
  if (/hypermarket|hm-chm/.test(value)) return 'hypermarket';
  return null;
}

function documentsFromOfficialHtml(html: string): Map<string, string> {
  const documents = new Map<string, string>();
  const urls = html.match(/https:\/\/digitalcontent\.api\.tesco\.com\/v2\/media\/dotcom-cz\/[^"'\\\s<>]+\.pdf/gi) || [];
  for (const rawUrl of urls) {
    const url = rawUrl.replace(/&amp;/gi, '&');
    const kind = documentKind(url);
    if (kind && !documents.has(kind)) documents.set(kind, url);
  }
  return documents;
}

function directLeaflet(leaflet: Leaflet, url: string): Leaflet {
  return {
    ...leaflet,
    url,
    direct: true,
    preview_url: `${SUPABASE_URL}/functions/v1/store-leaflet-document?source_url=${encodeURIComponent(url)}`,
  };
}

async function pennyOfficialLeaflet(): Promise<Leaflet> {
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
    accept: 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
    'accept-language': 'cs-CZ,cs;q=0.9',
  };
  const listingResponse = await fetch(PENNY_LISTING_URL, { headers, redirect: 'follow' });
  if (!listingResponse.ok) throw new Error(`PENNY HTTP ${listingResponse.status}`);
  const listingHtml = await listingResponse.text();
  const viewerMatch = listingHtml.match(/href=["'](https:\/\/files\.rewe\.co\.at\/PennyIntLeaflet\/CZ\/[^"'?#<]+)["']/i);
  if (!viewerMatch) throw new Error('PENNY nevrátilo aktuální publikaci.');
  const viewerUrl = viewerMatch[1].replace(/\/+$/, '') + '/';

  const viewerResponse = await fetch(viewerUrl, { headers, redirect: 'follow' });
  if (!viewerResponse.ok) throw new Error(`PENNY prohlížeč HTTP ${viewerResponse.status}`);
  const viewerHtml = await viewerResponse.text();
  const dynamicFolder = viewerHtml.match(/FBInit\.DYNAMIC_FOLDER\s*=\s*["']([^"']+)["']/i)?.[1] || 'files/assets/';
  const workspaceUrl = new URL(`${dynamicFolder.replace(/\/+$/, '')}/workspace.js`, viewerResponse.url).toString();
  const workspaceResponse = await fetch(workspaceUrl, { headers, redirect: 'follow' });
  if (!workspaceResponse.ok) throw new Error(`PENNY konfigurace HTTP ${workspaceResponse.status}`);
  const workspace = JSON.parse((await workspaceResponse.text()).replace(/^\uFEFF/, '').trim());
  const downloadName = String(workspace?.downloads?.url || '').trim();
  const pageCount = Object.keys(workspace?.downloads?.pageFiles || {}).length;
  if (workspace?.downloads?.enabled === false || !/\.pdf$/i.test(downloadName) || pageCount < 2) {
    throw new Error('PENNY nevrátilo úplný vícestránkový PDF leták.');
  }
  const documentUrl = new URL(
    `${dynamicFolder.replace(/\/+$/, '')}/common/downloads/${encodeURIComponent(downloadName)}`,
    viewerResponse.url,
  ).toString();
  const validity = visibleText(listingHtml).match(/(\d{1,2}\.\s*\d{1,2}\.)\s*[-–]\s*(\d{1,2}\.\s*\d{1,2}\.)/);

  return {
    key: 'penny-current',
    title: `${pageCount} stran`,
    subtitle: 'Penny',
    valid_from: validity ? isoDate(validity[1]) : null,
    valid_to: validity ? isoDate(validity[2], true) : null,
    url: viewerUrl,
    direct: true,
    preview_url: `${SUPABASE_URL}/functions/v1/store-leaflet-document?source_url=${encodeURIComponent(documentUrl)}`,
  };
}

async function lidlOfficialLeaflets(): Promise<Leaflet[]> {
  const response = await fetch(LIDL_API_URL, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
      accept: 'application/json,*/*;q=0.8',
      'accept-language': 'cs-CZ,cs;q=0.9',
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`Lidl API HTTP ${response.status}`);
  const overview = await response.json();
  const today = new Date().toISOString().slice(0, 10);
  const flyers = (overview.categories || []).flatMap((category: any) =>
    (category.subcategories || []).flatMap((subcategory: any) =>
      String(subcategory.name || '').toLocaleLowerCase('cs').includes('akční letáky')
        ? (subcategory.flyers || [])
        : []
    )
  ).filter((flyer: any) =>
    flyer.isActive !== false
    && typeof flyer.pdfUrl === 'string'
    && flyer.pdfUrl.startsWith('https://')
    && String(flyer.offerStartDate || flyer.startDate || '') <= today
    && String(flyer.offerEndDate || flyer.endDate || '') >= today
  ).sort((a: any, b: any) =>
    String(a.offerStartDate || a.startDate || '').localeCompare(String(b.offerStartDate || b.startDate || ''))
  );
  if (!flyers.length) throw new Error('Oficiální Lidl API nevrátilo aktuální akční leták.');

  return flyers.map((flyer: any, index: number) => {
    const pdfUrl = String(flyer.pdfUrl);
    return {
      key: `lidl-${String(flyer.id || index + 1)}`,
      title: String(flyer.title || flyer.name || (index === 0 ? 'Akční leták' : 'Další akční leták')),
      subtitle: 'Lidl',
      valid_from: String(flyer.offerStartDate || flyer.startDate || '').slice(0, 10) || null,
      valid_to: String(flyer.offerEndDate || flyer.endDate || '').slice(0, 10) || null,
      url: LIDL_LISTING_URL,
      direct: true,
      preview_url: `${SUPABASE_URL}/functions/v1/store-leaflet-document?source_url=${encodeURIComponent(pdfUrl)}`,
    };
  });
}


async function rossmannOfficialLeaflet(): Promise<Leaflet> {
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
    accept: 'text/html,application/xhtml+xml',
    'accept-language': 'cs-CZ,cs;q=0.9',
  };
  const listingResponse = await fetch(ROSSMANN_LISTING_URL, { headers, redirect: 'follow' });
  if (!listingResponse.ok) throw new Error(`ROSSMANN HTTP ${listingResponse.status}`);
  const listingHtml = await listingResponse.text();
  const detailPath = listingHtml.match(/href=["']([^"']*\/obsah\/publitas\/[^"']*\/akcni-letak[^"']*)["']/i)?.[1];
  if (!detailPath) throw new Error('ROSSMANN nevrátil aktuální akční leták.');
  const detailUrl = new URL(detailPath.replace(/&amp;/gi, '&'), listingResponse.url).toString();

  const detailResponse = await fetch(detailUrl, { headers, redirect: 'follow' });
  if (!detailResponse.ok) throw new Error(`ROSSMANN leták HTTP ${detailResponse.status}`);
  const detailHtml = await detailResponse.text();
  const embedRaw = detailHtml.match(/<iframe\b[^>]*\bsrc=["'](https:\/\/publikace\.rossmann\.cz\/[^"']+)["']/i)?.[1];
  if (!embedRaw) throw new Error('ROSSMANN nevrátil adresu listovacího letáku.');
  const embedUrl = embedRaw.replace(/&amp;/gi, '&');
  const range = embedUrl.match(/akcni-letak-(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{1,2})-(\d{4})/i);

  return {
    key: 'rossmann-current',
    title: 'Akční leták',
    subtitle: 'ROSSMANN',
    valid_from: range ? isoDate(`${range[1]}.${range[2]}.${range[5]}`) : null,
    valid_to: range ? isoDate(`${range[3]}.${range[4]}.${range[5]}`, true) : null,
    url: detailUrl,
    direct: true,
    preview_url: embedUrl,
    embed_url: embedUrl,
  };
}

async function tetaOfficialLeaflets(): Promise<Leaflet[]> {
  const response = await fetch(TETA_LISTING_URL, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'cs-CZ,cs;q=0.9',
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`Teta HTTP ${response.status}`);
  const html = await response.text();
  const listingText = visibleText(html);
  const listingRanges = [...listingText.matchAll(/(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})\s*[-–]\s*(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/g)];
  const matches = [...html.matchAll(/href=["'](https:\/\/letak\.tetadrogerie\.cz\/[^"'?#]+\/?)(?:[?#][^"']*)?["']/gi)];
  const seen = new Set<string>();
  const leaflets: Leaflet[] = [];

  for (const match of matches) {
    const url = match[1].replace(/&amp;/gi, '&');
    if (seen.has(url)) continue;
    seen.add(url);
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || `teta-${leaflets.length + 1}`;
    const context = visibleText(html.slice(Math.max(0, (match.index || 0) - 2200), (match.index || 0) + match[0].length));
    const ranges = [...context.matchAll(/(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})\s*[-–]\s*(\d{1,2}\.\s*\d{1,2}\.\s*\d{4})/g)];
    const range = listingRanges[leaflets.length] || ranges.at(-1);
    const number = slug.match(/(?:letak|te)[-_]?(\d{1,2})(?:-|$)/i)?.[1] || '';
    const title = /technick/i.test(slug)
      ? `Technický leták${number ? ` č. ${number}` : ''}`
      : /klub/i.test(slug)
        ? `Klubový leták${number ? ` č. ${number}` : ''}`
        : /cenovy-tresk/i.test(slug)
          ? 'Cenový třesk'
          : `Akční leták${number ? ` č. ${number}` : ''}`;

    leaflets.push({
      key: `teta-${slug}`,
      title,
      subtitle: 'Teta drogerie',
      valid_from: range ? isoDate(range[1]) : null,
      valid_to: range ? isoDate(range[2], true) : null,
      url,
      direct: true,
      preview_url: `${SUPABASE_URL}/functions/v1/store-leaflet-document?source_url=${encodeURIComponent(url)}`,
    });
  }
  if (!leaflets.length) throw new Error('Teta nevrátila žádný aktuální leták.');
  return leaflets;
}

async function attachDirectDocuments(leaflets: Leaflet[], officialHtml: string): Promise<Leaflet[]> {
  const officialDocuments = documentsFromOfficialHtml(officialHtml);
  if (leaflets.every((leaflet) => officialDocuments.has(leaflet.key))) {
    return leaflets.map((leaflet) => directLeaflet(leaflet, officialDocuments.get(leaflet.key)!));
  }
  const { data: stores } = await db.from('stores').select('id').eq('slug', 'tesco').limit(1);
  if (!stores?.[0]) return leaflets.map((leaflet) => {
    const officialUrl = officialDocuments.get(leaflet.key);
    return officialUrl ? directLeaflet(leaflet, officialUrl) : leaflet;
  });
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await db.from('leaflet_imports')
    .select('id,source_document_url,detected_valid_from,detected_valid_to,created_at')
    .eq('store_id', stores[0].id)
    .in('status', ['published', 'review', 'publishing'])
    .or(`detected_valid_to.is.null,detected_valid_to.gte.${today}`)
    .order('created_at', { ascending: false })
    .limit(30);
  const uniqueByUrl = new Map<string, any>();
  for (const row of data || []) if (!uniqueByUrl.has(row.source_document_url)) uniqueByUrl.set(row.source_document_url, row);
  const uniqueDocuments = [...uniqueByUrl.values()];
  const documents = new Map<string, any>();
  for (const row of data || []) {
    const kind = documentKind(String(row.source_document_url || ''));
    if (kind && !documents.has(kind)) documents.set(kind, row);
  }
  const alreadyUsed = new Set([...documents.values()].map((row) => row.id));
  const unassigned = uniqueDocuments.filter((row) => !alreadyUsed.has(row.id));
  return leaflets.map((leaflet) => {
    const officialUrl = officialDocuments.get(leaflet.key);
    if (officialUrl) return directLeaflet(leaflet, officialUrl);
    const document = documents.get(leaflet.key) || unassigned.shift();
    return document ? {
      ...leaflet,
      url: document.source_document_url,
      direct: true,
      preview_url: `${SUPABASE_URL}/functions/v1/store-leaflet-document?import_id=${encodeURIComponent(document.id)}`,
    } : leaflet;
  });
}

async function storeLeaflets(storeSlug: string): Promise<Leaflet[]> {
  const { data: store, error: storeError } = await db.from('stores')
    .select('id,slug,name,is_active,logo_url')
    .eq('slug', storeSlug)
    .eq('is_active', true)
    .maybeSingle();
  if (storeError || !store) throw new Error('Obchod nebyl nalezen.');

  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await db.from('leaflet_imports')
    .select('id,source_document_url,detected_valid_from,detected_valid_to,created_at,metadata')
    .eq('store_id', store.id)
    .in('status', ['published', 'review', 'publishing'])
    .or(`detected_valid_to.is.null,detected_valid_to.gte.${today}`)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;

  const seen = new Set<string>();
  let documents = (data || []).filter((row: any) => {
    const source = String(row.source_document_url || '');
    if (!source.startsWith('https://') || seen.has(source)) return false;
    seen.add(source);
    return true;
  });
  documents.sort((a: any, b: any) => {
    const fromOrder = String(b.detected_valid_from || '').localeCompare(String(a.detected_valid_from || ''));
    if (fromOrder) return fromOrder;
    return String(a.detected_valid_to || '').localeCompare(String(b.detected_valid_to || ''));
  });
  // PENNY publikuje jeden vícestránkový FlippingBook. Starší obecný adaptér
  // mylně uložil jednotlivé náhledové stránky jako samostatné letáky.
  if (storeSlug === 'penny') {
    const completePdf = documents.find((row: any) => {
      try {
        const url = new URL(String(row.source_document_url || ''));
        return url.hostname === 'files.rewe.co.at'
          && /^\/PennyIntLeaflet\/CZ\/[^/]+\/files\/assets\/common\/downloads\/[^/]+\.pdf$/i.test(url.pathname);
      } catch { return false; }
    });
    documents = completePdf ? [completePdf] : documents.slice(0, 1);
  } else {
    // Vrať všechny aktuální publikace, které prošly databázovým filtrem.
    documents = documents.slice(0, 20);
  }
  return documents.map((row: any, index: number) => ({
    key: `${storeSlug}-${index + 1}`,
    title: String(row.metadata?.title || (index === 0 ? 'Aktuální leták' : 'Další platný leták')),
    subtitle: store.name,
    valid_from: row.detected_valid_from,
    valid_to: row.detected_valid_to,
    url: row.source_document_url,
    direct: true,
    preview_url: `${SUPABASE_URL}/functions/v1/store-leaflet-document?import_id=${encodeURIComponent(row.id)}`,
    logo_url: store.logo_url,
  }));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS_HEADERS });
  try {
    const storeSlug = new URL(request.url).searchParams.get('store') || 'tesco';
    if (!/^[a-z0-9-]{2,64}$/.test(storeSlug)) throw new Error('Neplatný obchod.');
    if (storeSlug === 'action') {
      return Response.json({ ok: true, store: storeSlug, source: ACTION_LISTING_URL, leaflets: [actionOfficialLeaflet()] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'lidl') {
      const leaflets = await lidlOfficialLeaflets();
      return Response.json({ ok: true, store: storeSlug, source: LIDL_API_URL, leaflets }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'teta') {
      const leaflets = await tetaOfficialLeaflets();
      return Response.json({ ok: true, store: storeSlug, source: TETA_LISTING_URL, leaflets }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'rossmann') {
      const leaflet = await rossmannOfficialLeaflet();
      return Response.json({ ok: true, store: storeSlug, source: ROSSMANN_LISTING_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'makro') {
      const leaflet: Leaflet = {
        key: 'makro-current',
        title: 'Aktuální nabídka',
        subtitle: 'Makro',
        valid_from: null,
        valid_to: null,
        url: MAKRO_LISTING_URL,
        direct: false,
      };
      return Response.json({ ok: true, store: storeSlug, source: MAKRO_LISTING_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'rohlik') {
      const leaflet: Leaflet = {
        key: 'rohlik-current',
        title: 'Cenové trháky',
        subtitle: 'Rohlík.cz',
        valid_from: null,
        valid_to: null,
        url: ROHLIK_DEALS_URL,
        direct: false,
      };
      return Response.json({ ok: true, store: storeSlug, source: ROHLIK_DEALS_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'kosik') {
      const leaflet: Leaflet = {
        key: 'kosik-current',
        title: 'Akční nabídka',
        subtitle: 'Košík.cz',
        valid_from: null,
        valid_to: null,
        url: KOSIK_DEALS_URL,
        direct: false,
      };
      return Response.json({ ok: true, store: storeSlug, source: KOSIK_DEALS_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'super-zoo') {
      const leaflet: Leaflet = {
        key: 'super-zoo-current',
        title: 'Akce a novinky',
        subtitle: 'Super zoo',
        valid_from: null,
        valid_to: null,
        url: SUPER_ZOO_DEALS_URL,
        direct: false,
      };
      return Response.json({ ok: true, store: storeSlug, source: SUPER_ZOO_DEALS_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'hornbach') {
      const leaflet: Leaflet = {
        key: 'hornbach-current',
        title: 'Aktuální letáky a katalogy',
        subtitle: 'HORNBACH',
        valid_from: null,
        valid_to: null,
        url: HORNBACH_CATALOGS_URL,
        direct: false,
      };
      return Response.json({ ok: true, store: storeSlug, source: HORNBACH_CATALOGS_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'mountfield') {
      const leaflet: Leaflet = {
        key: 'mountfield-current',
        title: 'Právě probíhající akce',
        subtitle: 'Mountfield',
        valid_from: null,
        valid_to: null,
        url: MOUNTFIELD_DEALS_URL,
        direct: false,
      };
      return Response.json({ ok: true, store: storeSlug, source: MOUNTFIELD_DEALS_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'alza') {
      const leaflet: Leaflet = {
        key: 'alza-current',
        title: 'Cenové bomby – akce a slevy',
        subtitle: 'Alza.cz',
        valid_from: null,
        valid_to: null,
        url: ALZA_DEALS_URL,
        direct: false,
      };
      return Response.json({ ok: true, store: storeSlug, source: ALZA_DEALS_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'datart') {
      const leaflet: Leaflet = {
        key: 'datart-current',
        title: 'Aktuální leták',
        subtitle: 'DATART',
        valid_from: null,
        valid_to: null,
        url: DATART_LEAFLET_URL,
        direct: false,
      };
      return Response.json({ ok: true, store: storeSlug, source: DATART_LEAFLET_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'decathlon') {
      const leaflet: Leaflet = {
        key: 'decathlon-current',
        title: 'Doprodej a speciální nabídky',
        subtitle: 'Decathlon',
        valid_from: null,
        valid_to: null,
        url: DECATHLON_DEALS_URL,
        direct: false,
      };
      return Response.json({ ok: true, store: storeSlug, source: DECATHLON_DEALS_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'sconto') {
      const leaflet: Leaflet = {
        key: 'sconto-current',
        title: 'Nábytek a doplňky z letáku',
        subtitle: 'SCONTO',
        valid_from: null,
        valid_to: null,
        url: SCONTO_LEAFLET_URL,
        direct: false,
      };
      return Response.json({ ok: true, store: storeSlug, source: SCONTO_LEAFLET_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'moebelix') {
      const leaflet: Leaflet = {
        key: 'moebelix-current',
        title: 'Slevy a výprodeje',
        subtitle: 'Möbelix',
        valid_from: null,
        valid_to: null,
        url: MOEBELIX_DEALS_URL,
        direct: false,
      };
      return Response.json({ ok: true, store: storeSlug, source: MOEBELIX_DEALS_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'xxxlutz') {
      const leaflet: Leaflet = {
        key: 'xxxlutz-current',
        title: 'Aktuální letáky',
        subtitle: 'XXXLutz',
        valid_from: null,
        valid_to: null,
        url: XXXLUTZ_LEAFLETS_URL,
        direct: false,
      };
      return Response.json({ ok: true, store: storeSlug, source: XXXLUTZ_LEAFLETS_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'sportisimo') {
      const leaflet: Leaflet = { key: 'sportisimo-current', title: 'Výprodej značkové módy a obuvi', subtitle: 'SPORTISIMO', valid_from: null, valid_to: null, url: SPORTISIMO_DEALS_URL, direct: false };
      return Response.json({ ok: true, store: storeSlug, source: SPORTISIMO_DEALS_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'smarty') {
      const leaflet: Leaflet = { key: 'smarty-current', title: 'Výprodej elektroniky a gamingu', subtitle: 'Smarty.cz', valid_from: null, valid_to: null, url: SMARTY_DEALS_URL, direct: false };
      return Response.json({ ok: true, store: storeSlug, source: SMARTY_DEALS_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'pilulka') {
      const leaflet: Leaflet = { key: 'pilulka-current', title: 'Akce a slevy', subtitle: 'Pilulka.cz', valid_from: null, valid_to: null, url: PILULKA_DEALS_URL, direct: false };
      return Response.json({ ok: true, store: storeSlug, source: PILULKA_DEALS_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'auto-kelly') {
      const leaflet: Leaflet = { key: 'auto-kelly-current', title: 'Věrnostní slevy až 20 %', subtitle: 'Auto Kelly', valid_from: null, valid_to: null, url: AUTO_KELLY_BENEFITS_URL, direct: false };
      return Response.json({ ok: true, store: storeSlug, source: AUTO_KELLY_BENEFITS_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'dek') {
      const leaflet: Leaflet = { key: 'dek-current', title: 'Akční nabídka', subtitle: 'Stavebniny DEK', valid_from: null, valid_to: null, url: DEK_DEALS_URL, direct: false };
      return Response.json({ ok: true, store: storeSlug, source: DEK_DEALS_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'pro-doma') {
      const leaflet: Leaflet = { key: 'pro-doma-current', title: 'Akce a slevy', subtitle: 'PRO-DOMA', valid_from: null, valid_to: null, url: PRO_DOMA_DEALS_URL, direct: false };
      return Response.json({ ok: true, store: storeSlug, source: PRO_DOMA_DEALS_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'stavmat') {
      const leaflet: Leaflet = { key: 'stavmat-current', title: 'Aktuální akční nabídka', subtitle: 'STAVMAT', valid_from: null, valid_to: null, url: STAVMAT_DEALS_URL, direct: false };
      return Response.json({ ok: true, store: storeSlug, source: STAVMAT_DEALS_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'hm') {
      const leaflet: Leaflet = { key: 'hm-current', title: 'Aktuální výprodej', subtitle: 'H&M', valid_from: null, valid_to: null, url: HM_SALE_URL, direct: false };
      return Response.json({ ok: true, store: storeSlug, source: HM_SALE_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
    }
    if (storeSlug === 'penny') {
      try {
        const leaflet = await pennyOfficialLeaflet();
        return Response.json({ ok: true, store: storeSlug, source: PENNY_LISTING_URL, leaflets: [leaflet] }, { headers: CORS_HEADERS });
      } catch (officialError) {
        console.warn('Official PENNY feed failed', officialError instanceof Error ? officialError.message : String(officialError));
      }
    }
    if (storeSlug !== 'tesco') {
      const leaflets = await storeLeaflets(storeSlug);
      return Response.json({ ok: true, store: storeSlug, leaflets }, { headers: CORS_HEADERS });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response: Response;
    try {
      response = await fetch(TESCO_LISTING_URL, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'cs-CZ,cs;q=0.9',
        },
        redirect: 'follow',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`iTesco HTTP ${response.status}`);
    const officialHtml = await response.text();
    const leaflets = await attachDirectDocuments(officialLeaflets(officialHtml), officialHtml);
    if (!leaflets.length) throw new Error('Aktuální letáky se v oficiální stránce nepodařilo rozpoznat.');
    return Response.json({ ok: true, source: TESCO_LISTING_URL, leaflets }, { headers: CORS_HEADERS });
  } catch (error) {
    return Response.json({
      ok: false,
      source: TESCO_LISTING_URL,
      leaflets: [],
      error: error instanceof Error ? error.message : String(error),
    }, { status: 502, headers: CORS_HEADERS });
  }
});