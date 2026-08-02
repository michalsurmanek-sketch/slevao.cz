import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'cache-control': 'public, max-age=300, s-maxage=300',
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type StoreRow = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  sort_order: number | null;
};

type ImportRow = {
  id: string;
  store_id: string;
  source_document_url: string;
  detected_valid_from: string | null;
  detected_valid_to: string | null;
  created_at: string | null;
};

type HomepageLeaflet = {
  store_slug: string;
  store_name: string;
  logo_url: string | null;
  sort_order: number;
  import_id: string;
  title: string;
  valid_from: string | null;
  valid_to: string | null;
  preview_url: string;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

function positiveLimit(value: string | null): number {
  const parsed = Number(value || 12);
  if (!Number.isFinite(parsed)) return 12;
  return Math.min(24, Math.max(1, Math.trunc(parsed)));
}

function validHttps(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isCompletePennyDocument(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === 'files.rewe.co.at'
      && /^\/PennyIntLeaflet\/CZ\/[^/]+\/files\/assets\/common\/downloads\/[^/]+\.pdf$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function documentScore(storeSlug: string, row: ImportRow): number {
  const url = String(row.source_document_url || '').toLocaleLowerCase('cs');
  let score = 0;
  if (/\.pdf(?:$|[?#])/.test(url)) score += 30;
  if (/\.(?:webp|png|jpe?g)(?:$|[?#])/.test(url)) score += 20;
  if (storeSlug === 'penny' && isCompletePennyDocument(row.source_document_url)) score += 100;
  if (/thumbnail|thumb|preview|page[_-]?\d+/i.test(url)) score -= 40;
  if (row.detected_valid_from) score += 2;
  if (row.detected_valid_to) score += 3;
  return score;
}

function chooseCurrentImport(store: StoreRow, rows: ImportRow[]): ImportRow | null {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => {
    const scoreDifference = documentScore(store.slug, b) - documentScore(store.slug, a);
    if (scoreDifference) return scoreDifference;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
  return sorted[0] || null;
}

async function loadStores(): Promise<StoreRow[]> {
  const { data, error } = await db
    .from('stores')
    .select('id,slug,name,logo_url,sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('name', { ascending: true });

  if (error) throw error;
  return (data || []) as StoreRow[];
}

async function loadImports(storeIds: string[], today: string): Promise<ImportRow[]> {
  if (!storeIds.length) return [];
  const output: ImportRow[] = [];

  for (let offset = 0; offset < storeIds.length; offset += 60) {
    const batchIds = storeIds.slice(offset, offset + 60);
    const { data, error } = await db
      .from('leaflet_imports')
      .select('id,store_id,source_document_url,detected_valid_from,detected_valid_to,created_at')
      .in('store_id', batchIds)
      .in('status', ['published', 'review', 'publishing'])
      .or(`detected_valid_to.is.null,detected_valid_to.gte.${today}`)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) throw error;
    output.push(...((data || []) as ImportRow[]));
  }

  return output.filter((row) => validHttps(row.source_document_url));
}

function toHomepageLeaflet(store: StoreRow, row: ImportRow): HomepageLeaflet {
  return {
    store_slug: store.slug,
    store_name: store.name,
    logo_url: store.logo_url,
    sort_order: Number(store.sort_order ?? 9999),
    import_id: row.id,
    title: 'Aktuální leták',
    valid_from: row.detected_valid_from,
    valid_to: row.detected_valid_to,
    preview_url: `${SUPABASE_URL}/functions/v1/store-leaflet-document?import_id=${encodeURIComponent(row.id)}`,
  };
}

async function officialLeaflet(store: StoreRow): Promise<HomepageLeaflet | null> {
  if (!['tesco', 'penny'].includes(store.slug)) return null;

  try {
    const response = await fetch(
      `${SUPABASE_URL}/functions/v1/store-leaflet-feed?store=${encodeURIComponent(store.slug)}&source=homepage-all-v1`,
      {
        headers: {
          apikey: SERVICE_ROLE_KEY,
          authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        },
      },
    );
    if (!response.ok) return null;
    const payload = await response.json();
    const today = new Date().toISOString().slice(0, 10);
    const leaflet = (Array.isArray(payload?.leaflets) ? payload.leaflets : [])
      .filter((item: any) => item?.preview_url)
      .filter((item: any) => !item.valid_from || item.valid_from <= today)
      .filter((item: any) => !item.valid_to || item.valid_to >= today)
      .sort((a: any, b: any) => {
        const aKey = `${a.key === 'hypermarket' ? '0' : '1'}|${a.valid_to || '9999-12-31'}`;
        const bKey = `${b.key === 'hypermarket' ? '0' : '1'}|${b.valid_to || '9999-12-31'}`;
        return aKey.localeCompare(bKey);
      })[0];

    if (!leaflet) return null;
    return {
      store_slug: store.slug,
      store_name: store.name,
      logo_url: leaflet.logo_url || store.logo_url,
      sort_order: Number(store.sort_order ?? 9999),
      import_id: `official-${store.slug}`,
      title: leaflet.title || 'Aktuální leták',
      valid_from: leaflet.valid_from || null,
      valid_to: leaflet.valid_to || null,
      preview_url: String(leaflet.preview_url),
    };
  } catch (error) {
    console.warn(`Official homepage leaflet failed for ${store.slug}:`, error);
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);

  try {
    const requestUrl = new URL(request.url);
    const limit = positiveLimit(requestUrl.searchParams.get('limit'));
    const today = new Date().toISOString().slice(0, 10);

    const stores = await loadStores();
    const imports = await loadImports(stores.map((store) => store.id), today);
    const importsByStore = new Map<string, ImportRow[]>();

    for (const row of imports) {
      if (!importsByStore.has(row.store_id)) importsByStore.set(row.store_id, []);
      importsByStore.get(row.store_id)!.push(row);
    }

    const candidates = new Map<string, HomepageLeaflet>();
    for (const store of stores) {
      const chosen = chooseCurrentImport(store, importsByStore.get(store.id) || []);
      if (chosen) candidates.set(store.slug, toHomepageLeaflet(store, chosen));
    }

    const specialStores = stores.filter((store) => ['tesco', 'penny'].includes(store.slug));
    const specialResults = await Promise.allSettled(specialStores.map(officialLeaflet));
    specialResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value) {
        candidates.set(specialStores[index].slug, result.value);
      }
    });

    const leaflets = [...candidates.values()]
      .sort((a, b) => a.sort_order - b.sort_order || a.store_name.localeCompare(b.store_name, 'cs'))
      .slice(0, limit);

    return json({
      ok: true,
      generated_at: new Date().toISOString(),
      count: leaflets.length,
      leaflets,
    });
  } catch (error) {
    console.error('Homepage leaflet feed failed:', error);
    return json({
      ok: false,
      leaflets: [],
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});