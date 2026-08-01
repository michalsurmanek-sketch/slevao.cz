import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TESCO_LISTING_URL = 'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy';
const PENNY_LISTING_URL = 'https://www.penny.cz/letaky';
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
    .replace(/\s+/g, ' ');
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
    .select('id,source_document_url,detected_valid_from,detected_valid_to,created_at')
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
    documents = documents.slice(0, 3);
  }
  return documents.map((row: any, index: number) => ({
    key: `${storeSlug}-${index + 1}`,
    title: index === 0 ? 'Aktuální leták' : 'Další platný leták',
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
