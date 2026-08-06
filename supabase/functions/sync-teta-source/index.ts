import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://www.tetadrogerie.cz/akce';
const BACKEND_URL = 'https://be.tetadrogerie.cz';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'content-type': 'application/json; charset=utf-8',
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

type Campaign = {
  slug: string;
  name: string;
  validFrom: string;
  validTo: string;
};

type Item = {
  title: string;
  quantity_text: string | null;
  price: number;
  old_price: number | null;
  image_url: string | null;
  source_url: string;
  confidence: number;
  raw_data: Record<string, unknown>;
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

async function allowed(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  if (authorization === `Bearer ${SERVICE_ROLE_KEY}`) return true;
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return true;
  if (!authorization.startsWith('Bearer ')) return false;
  const { data } = await db.auth.getUser(authorization.slice(7));
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}

function decode(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function clean(value: string) {
  return decode(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function absolute(base: string, value: string | null | undefined) {
  try {
    return value ? new URL(decode(value), base).toString() : null;
  } catch {
    return null;
  }
}

function money(value: string | null | undefined) {
  if (!value) return null;
  const normalized = clean(value).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.]/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) && number > 0 && number < 100_000 ? number : null;
}

function dateOnly(value: unknown) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || null;
}

function quantity(title: string) {
  return title.match(/\b\d+(?:[,.]\d+)?\s*(?:ml|cl|l|g|kg|ks|pd|bal(?:ení)?|tablet|kapslí|rolí)\b/i)?.[0] || null;
}

async function fetchText(url: string, accept = HEADERS.accept) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const result = await fetch(url, {
      headers: { ...HEADERS, accept, referer: new URL(url).origin + '/' },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!result.ok) throw new Error(`${new URL(url).hostname} HTTP ${result.status}`);
    return { text: await result.text(), url: result.url };
  } finally {
    clearTimeout(timer);
  }
}

function campaignSlugs(html: string) {
  const slugs = new Set<string>();
  for (const match of html.matchAll(/\/akce\/detail\/([a-z0-9-]{5,64})/gi)) slugs.add(match[1].toLowerCase());
  return [...slugs];
}

async function activeCampaigns(listingHtml: string): Promise<Campaign[]> {
  const today = new Date().toISOString().slice(0, 10);
  const slugs = campaignSlugs(listingHtml).slice(0, 30);
  const campaigns: Campaign[] = [];

  for (const slug of slugs) {
    try {
      const { text } = await fetchText(`${BACKEND_URL}/api/v2/shop/actions/${encodeURIComponent(slug)}`, 'application/json,*/*;q=0.8');
      const data = JSON.parse(text);
      const validFrom = dateOnly(data.dateFrom);
      const validTo = dateOnly(data.dateTo);
      if (!data.enabled || String(data.type || '').toLowerCase() !== 'leaflet' || !validFrom || !validTo) continue;
      if (validFrom > today || validTo < today) continue;
      campaigns.push({ slug, name: clean(String(data.name || slug)), validFrom, validTo });
    } catch (error) {
      console.warn('Teta campaign skipped', slug, error instanceof Error ? error.message : String(error));
    }
  }

  return campaigns.sort((a, b) => b.validTo.localeCompare(a.validTo)).slice(0, 8);
}

function cardBlocks(html: string) {
  const starts = [...html.matchAll(/<div class="c-product-card c-product-card--list"/g)].map((match) => match.index || 0);
  return starts.map((start, index) => html.slice(start, starts[index + 1] ?? Math.min(html.length, start + 24_000)));
}

function parseCard(block: string, pageUrl: string, campaign: Campaign): Item | null {
  const href = block.match(/<a[^>]+href="([^"]+\/eshop\/katalog\/[^"]+)"/i)?.[1]
    || block.match(/<a[^>]+href="(\/eshop\/katalog\/[^"]+)"/i)?.[1];
  const title = clean(block.match(/<strong[^>]*c-product-card__title[^>]*>([\s\S]*?)<\/strong>/i)?.[1] || '');
  const currentPrice = money(block.match(/c-product-price__value[^>]*>[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/i)?.[1] || null);
  if (!href || title.length < 3 || title.length > 220 || !currentPrice) return null;

  const former = block.match(/<div class="([^"]*c-product-price__former-price[^"]*)"[^>]*>([\s\S]*?)<\/div>/i);
  const formerPrice = former && !former[1].includes('--hidden') ? money(former[2]) : null;
  const image = block.match(/<img[^>]+(?:src|data-src)="([^"]+)"/i)?.[1] || null;
  const sourceUrl = absolute(pageUrl, href) || pageUrl;

  return {
    title,
    quantity_text: quantity(title),
    price: currentPrice,
    old_price: formerPrice && formerPrice > currentPrice ? formerPrice : null,
    image_url: absolute(pageUrl, image),
    source_url: sourceUrl,
    confidence: 0.96,
    raw_data: {
      parser: 'teta-campaign-html-v2',
      campaign_slug: campaign.slug,
      campaign_name: campaign.name,
      campaign_valid_from: campaign.validFrom,
      campaign_valid_to: campaign.validTo,
      source_url: sourceUrl,
    },
  };
}

async function campaignItems(campaign: Campaign) {
  const items: Item[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= 8; page++) {
    const pageUrl = `https://www.tetadrogerie.cz/akce/detail/${campaign.slug}${page > 1 ? `?strana=${page}` : ''}`;
    const { text, url } = await fetchText(pageUrl);
    const blocks = cardBlocks(text);
    let added = 0;

    for (const block of blocks) {
      const item = parseCard(block, url, campaign);
      if (!item) continue;
      const key = `${item.source_url}|${item.price}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
      added++;
    }

    if (blocks.length < 40 || added === 0) break;
  }

  return items;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return response({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return response({ error: 'Unauthorized' }, 401);

  const now = new Date().toISOString();
  try {
    const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'teta').single();
    if (storeError || !store) throw storeError || new Error('Teta nebyla nalezena v obchodech.');

    const { data: source, error: sourceError } = await db.from('leaflet_sources')
      .select('id')
      .eq('store_id', store.id)
      .eq('is_active', true)
      .eq('source_url', SOURCE_URL)
      .single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj Tety nebyl nalezen.');

    const listing = await fetchText(SOURCE_URL);
    const campaigns = await activeCampaigns(listing.text);
    if (!campaigns.length) throw new Error('Teta nevrátila žádnou právě platnou letákovou kampaň.');

    const parsed = (await Promise.all(campaigns.map(campaignItems))).flat();
    const unique = new Map<string, Item>();
    for (const item of parsed) {
      const key = `${item.title.toLocaleLowerCase('cs')}|${item.price}`;
      if (!unique.has(key)) unique.set(key, item);
    }
    const items = [...unique.values()];
    if (items.length < 10) throw new Error(`Teta parser našel jen ${items.length} produktů.`);

    const validFrom = campaigns.map((campaign) => campaign.validFrom).sort()[0];
    const validTo = campaigns.map((campaign) => campaign.validTo).sort().at(-1)!;
    const signature = campaigns.map((campaign) => `${campaign.slug}:${campaign.validFrom}:${campaign.validTo}`).sort().join('|');
    const sourceHash = await sha256(`${source.id}|${signature}|${items.length}|teta-campaign-html-v2`);

    const { data: existing, error: existingError } = await db.from('leaflet_imports')
      .select('id,status,product_count')
      .eq('source_hash', sourceHash)
      .maybeSingle();
    if (existingError) throw existingError;

    if (existing) {
      await db.from('leaflet_sources').update({
        last_checked_at: now,
        last_success_at: now,
        last_error: null,
        last_strategy_used: 'structured_html',
        last_strategy_success_at: now,
      }).eq('id', source.id);
      return response({ ok: true, existing: true, import_id: existing.id, items: existing.product_count, campaigns });
    }

    const { data: imported, error: importError } = await db.from('leaflet_imports').insert({
      source_id: source.id,
      store_id: store.id,
      source_document_url: SOURCE_URL,
      source_hash: sourceHash,
      status: 'review',
      product_count: items.length,
      confidence: 0.94,
      detected_valid_from: validFrom,
      detected_valid_to: validTo,
      finished_at: now,
      metadata: {
        adapter: 'teta-campaign-html-v2',
        ai_used: false,
        campaigns,
      },
    }).select('id').single();
    if (importError || !imported) throw importError || new Error('Import Tety se nepodařilo vytvořit.');

    const rows = items.map((item) => ({
      import_id: imported.id,
      title: item.title,
      quantity_text: item.quantity_text,
      price: item.price,
      old_price: item.old_price,
      image_url: item.image_url,
      confidence: item.confidence,
      status: 'review',
      raw_data: item.raw_data,
    }));
    for (let index = 0; index < rows.length; index += 200) {
      const { error } = await db.from('leaflet_import_items').insert(rows.slice(index, index + 200));
      if (error) throw error;
    }

    await db.from('leaflet_sources').update({
      last_checked_at: now,
      last_success_at: now,
      last_error: null,
      last_strategy_used: 'structured_html',
      last_strategy_success_at: now,
    }).eq('id', source.id);

    return response({
      ok: true,
      created: true,
      import_id: imported.id,
      items: items.length,
      valid_from: validFrom,
      valid_to: validTo,
      campaigns,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { data: store } = await db.from('stores').select('id').eq('slug', 'teta').maybeSingle();
    if (store) {
      await db.from('leaflet_sources').update({ last_checked_at: now, last_error: message.slice(0, 1000) })
        .eq('store_id', store.id)
        .eq('is_active', true);
    }
    return response({ error: message }, 500);
  }
});
