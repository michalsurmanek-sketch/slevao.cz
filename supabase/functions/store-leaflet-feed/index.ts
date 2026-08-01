import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TESCO_LISTING_URL = 'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy';
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

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS_HEADERS });
  try {
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
