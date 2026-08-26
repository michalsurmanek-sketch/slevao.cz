import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const H = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
  'cache-control': 'no-cache, no-store',
  pragma: 'no-cache',
};

const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const dateOnly = (v: unknown) => String(v ?? '').match(/^(\d{4}-\d{2}-\d{2})T/)?.[1] || null;
const todayPrague = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

function nextData(html: string) {
  const a = html.indexOf('<script id="__NEXT_DATA__"');
  const b = html.indexOf('>', a);
  const c = html.indexOf('</script>', b + 1);
  if (a < 0 || b < 0 || c < 0) throw new Error('Tesco viewer neobsahuje čitelné __NEXT_DATA__.');
  return JSON.parse(html.slice(b + 1, c));
}

async function fetchText(url: string) {
  const response = await fetch(url, {
    headers: H,
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Tesco HTML HTTP ${response.status}`);
  return { text, url: response.url };
}

async function inspectCurrentLeaflet(sourceUrl: string) {
  const landing = await fetchText(`${sourceUrl}${sourceUrl.includes('?') ? '&' : '?'}_slevao=${Date.now()}`);
  const today = todayPrague();
  const candidates = [...landing.text.matchAll(/href=["']([^"']*\/hypermarkety\/tesco-letak-(\d{4}-\d{2}-\d{2})\/1)["']/gi)]
    .map((match) => ({
      start: match[2],
      url: new URL(match[1].replace(/&amp;/g, '&'), landing.url).toString(),
    }))
    .filter((item) => item.start <= today)
    .sort((a, b) => b.start.localeCompare(a.start));

  if (!candidates.length) throw new Error(`Tesco landing neobsahuje HM viewer platný nejpozději ${today}.`);

  const viewerUrl = candidates[0].url;
  const viewer = await fetchText(viewerUrl);
  const pageProps = nextData(viewer.text)?.props?.pageProps || {};
  const state = pageProps.__APOLLO_STATE__ || {};
  const leaflets = Object.values(state)
    .filter((v: any) => v?.__typename === 'Leaflet' && v?.type === 'HM' && Array.isArray(v?.pages))
    .sort((a: any, b: any) => String(b.validFrom || '').localeCompare(String(a.validFrom || ''))) as any[];
  const leaflet = leaflets[0];
  if (!leaflet) throw new Error('Tesco Apollo state neobsahuje aktuální HM leták.');

  const validFrom = dateOnly(leaflet.validFrom);
  const validTo = dateOnly(leaflet.validTo);
  const pdfUrl = clean(leaflet.leafletUrl);
  const pageCount = Array.isArray(leaflet.pages) ? leaflet.pages.length : 0;

  if (!validFrom || !validTo || validFrom > validTo) throw new Error('Tesco leták nemá platnou dobu akce.');
  if (today < validFrom || today > validTo) throw new Error(`Tesco HM leták ${validFrom}–${validTo} dnes neplatí.`);
  if (!/^https:\/\/digitalcontent\.api\.tesco\.com\//i.test(pdfUrl)) throw new Error('Tesco Apollo nevrátilo oficiální PDF URL.');
  if (pageCount < 1) throw new Error('Tesco Apollo nevrátilo stránky letáku.');

  return {
    viewerUrl,
    leafletId: Number(leaflet.id) || null,
    validFrom,
    validTo,
    pdfUrl,
    pageCount,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok');
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

  const authorization = req.headers.get('authorization') || '';
  const allowedByService = authorization === `Bearer ${SERVICE_ROLE_KEY}`;
  const allowedByCron = Boolean(CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET);
  if (!allowedByService && !allowedByCron) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: source, error } = await db.from('leaflet_sources')
    .select('id,store_id,name,source_url,stores!inner(slug)')
    .eq('is_active', true)
    .eq('stores.slug', 'tesco')
    .single();
  if (error || !source) return Response.json({ error: error?.message || 'Tesco source not found' }, { status: 404 });

  const checkedAt = new Date().toISOString();
  try {
    const leaflet = await inspectCurrentLeaflet(source.source_url);
    const { error: updateError } = await db.from('leaflet_sources').update({
      last_checked_at: checkedAt,
      last_success_at: checkedAt,
      last_error: null,
    }).eq('id', source.id);
    if (updateError) throw updateError;

    return Response.json({
      ok: true,
      adapter: 'tesco-current-health-v5',
      source: source.name,
      created: [],
      ...leaflet,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.from('leaflet_sources').update({
      last_checked_at: checkedAt,
      last_error: message.slice(0, 2000),
    }).eq('id', source.id);
    return Response.json({ ok: false, adapter: 'tesco-current-health-v5', error: message }, { status: 502 });
  }
});
