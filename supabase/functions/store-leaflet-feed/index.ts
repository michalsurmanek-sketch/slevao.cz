import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET,OPTIONS',
  'cache-control': 'public, max-age=600, s-maxage=600',
  'content-type': 'application/json; charset=utf-8',
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

type StoreRow = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  website_url: string | null;
};

type PublicLeafletRow = {
  store_id: string;
  store_slug: string;
  store_name: string;
  logo_url: string | null;
  leaflet_key: string | null;
  title: string | null;
  valid_from: string | null;
  valid_to: string | null;
  preview_url: string | null;
  source_url: string | null;
};

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

// These are only browser navigation fallbacks. The Edge Function never fetches
// them server-side. Canonical published leaflet rows always take precedence.
const OFFICIAL_FALLBACKS: Record<string, string> = {
  action: 'https://www.action.com/cs-cz/letak/',
  alza: 'https://www.alza.cz/vyprodej-akce-sleva/e0.htm',
  billa: 'https://www.billa.cz/',
  datart: 'https://www.datart.cz/letak',
  decathlon: 'https://www.decathlon.cz/deals/doprodej',
  enapo: 'https://www.enapo.cz/',
  flop: 'https://www.flop-potraviny.cz/',
  globus: 'https://www.globus.cz/',
  hm: 'https://www2.hm.com/cs_cz/zeny/vyprodej/zobrazit-vse.html',
  hornbach: 'https://www.hornbach.cz/aktuality/katalogy/',
  makro: 'https://www.makro.cz/aktualni-nabidka',
  moebelix: 'https://www.moebelix.cz/c/slevy',
  mountfield: 'https://www.mountfield.cz/akce',
  'new-yorker': 'https://www.newyorker.de/cz/',
  obi: 'https://www.obi.cz/',
  planeo: 'https://www.planeo.cz/akce',
  sconto: 'https://www.sconto.cz/letak',
  smarty: 'https://www.smarty.cz/vyprodej-4c10260',
  sportisimo: 'https://www.sportisimo.cz/vyprodej/',
  stavmat: 'https://www.stavmat.cz/akce/',
  'super-zoo': 'https://www.superzoo.cz/akce/',
  tesco: 'https://www.itesco.cz/akcni-nabidky/letaky-a-katalogy',
  xxxlutz: 'https://www.xxxlutz.cz/c/letaky',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS_HEADERS });
}

function isPrivateOrLocalHost(hostname: string) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;
  if (
    host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || host.endsWith('.lan')
    || host.includes(':')
  ) return true;

  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every((part) => /^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return Boolean(
    a === 0
    || a === 10
    || a === 127
    || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
  );
}

function safeOfficialUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (url.port && url.port !== '443') return '';
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (host === 'slevao.cz' || host.endsWith('.slevao.cz') || isPrivateOrLocalHost(host)) return '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

async function activeStore(storeSlug: string): Promise<StoreRow | null> {
  const { data, error } = await db.from('stores')
    .select('id,slug,name,logo_url,website_url')
    .eq('slug', storeSlug)
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return data as StoreRow | null;
}

async function canonicalLeaflets(storeSlug: string): Promise<Leaflet[]> {
  const { data, error } = await db.rpc('get_public_current_leaflets', { p_limit: 500 });
  if (error) throw error;

  return ((data || []) as PublicLeafletRow[])
    .filter((row) => String(row.store_slug || '') === storeSlug)
    .map((row, index) => {
      const previewUrl = safeOfficialUrl(row.preview_url);
      const sourceUrl = safeOfficialUrl(row.source_url);
      const url = sourceUrl || previewUrl;
      return {
        key: String(row.leaflet_key || `${storeSlug}-${row.valid_from || 'current'}-${index + 1}`),
        title: String(row.title || 'Aktuální leták'),
        subtitle: String(row.store_name || storeSlug),
        valid_from: row.valid_from || null,
        valid_to: row.valid_to || null,
        url,
        direct: Boolean(previewUrl),
        ...(previewUrl ? { preview_url: previewUrl } : {}),
        logo_url: row.logo_url || null,
      };
    })
    .filter((leaflet) => Boolean(leaflet.url));
}

function officialFallback(store: StoreRow): Leaflet[] {
  const url = safeOfficialUrl(OFFICIAL_FALLBACKS[store.slug]) || safeOfficialUrl(store.website_url);
  if (!url) return [];
  return [{
    key: `${store.slug}-official-current`,
    title: 'Aktuální nabídka',
    subtitle: store.name,
    valid_from: null,
    valid_to: null,
    url,
    direct: false,
    logo_url: store.logo_url || null,
  }];
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const storeSlug = new URL(request.url).searchParams.get('store') || 'tesco';
  if (!/^[a-z0-9-]{2,64}$/.test(storeSlug)) return json({ error: 'Neplatný obchod.' }, 400);

  try {
    const store = await activeStore(storeSlug);
    if (!store) return json({ error: 'Obchod nebyl nalezen.' }, 404);

    try {
      const leaflets = await canonicalLeaflets(storeSlug);
      if (leaflets.length) {
        return json({ ok: true, store: storeSlug, source: 'canonical', leaflets });
      }
    } catch (error) {
      console.warn('Canonical leaflet RPC failed', error instanceof Error ? error.message : String(error));
    }

    const leaflets = officialFallback(store);
    return json({
      ok: true,
      store: storeSlug,
      source: leaflets.length ? 'official-fallback' : 'none',
      leaflets,
    });
  } catch (error) {
    console.error('store_leaflet_feed_error', error);
    return json({ ok: false, store: storeSlug, leaflets: [], error: 'Letáky se nepodařilo načíst.' }, 502);
  }
});
