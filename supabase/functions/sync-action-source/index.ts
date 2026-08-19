import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://www.action.com/cs-cz/tydenni-akce/';
const SOURCE_ADAPTER = 'action-html-v3';
const MIN_PRODUCTS = 20;
const MAX_PRODUCTS = 40;
const IMAGE_CONCURRENCY = 5;
const PRODUCT_TIMEOUT_MS = 12_000;
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
};
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function allowed(req: Request) {
  const auth = req.headers.get('authorization') || '';
  if (auth === `Bearer ${SERVICE_ROLE_KEY}`) return true;
  if (CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET) return true;
  if (!auth.startsWith('Bearer ')) return false;
  const { data } = await db.auth.getUser(auth.slice(7));
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}

function errorMessage(value: unknown) {
  if (value instanceof Error) return value.message;
  if (value && typeof value === 'object' && 'message' in value) return String((value as any).message || 'Unknown error');
  try { return JSON.stringify(value); } catch { return String(value); }
}

function clean(s: string) {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function abs(base: string, href: string) {
  try {
    return new URL(href.replace(/&amp;/g, '&'), base).toString();
  } catch {
    return null;
  }
}

function iso(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function dates(text: string) {
  const m = text.match(/(\d{1,2})\.\s*(\d{1,2})\.\s*[–-]\s*(\d{1,2})\.\s*(\d{1,2})\./);
  if (!m) return { from: null, to: null };
  const y = new Date().getUTCFullYear();
  return {
    from: iso(y, +m[2], +m[1]),
    to: iso((+m[2] === 12 && +m[4] === 1) ? y + 1 : y, +m[4], +m[3]),
  };
}

function titleFrom(text: string) {
  let t = text.replace(/Týdenní akce.*$/i, '').trim();
  t = t.replace(/\d{1,6}(?:[,.]\d{1,2})?\s*Kč\s*\/\s*(?:ks|kg|l|m|m2|m²).*$/i, '').trim();
  t = t.replace(/\d{1,6}(?:[,.]\d{1,2})?\s*Kč.*$/i, '').trim();
  const cut = t.search(/\b\d+(?:[,.]\d+)?\s*(?:ml|cl|l|g|kg|ks|kusů|cm|mm|m|párů|balení|×|x)\b/i);
  if (cut > 2) t = t.slice(0, cut).trim();
  return t.replace(/[|•]+$/, '').trim();
}

function parseActionPrice(text: string): number | null {
  const split = text.match(/(?:^|\s)(\d{1,5})\s+(\d{2})\s*Týdenní akce\s*$/i);
  if (split) {
    const value = Number(`${split[1]}.${split[2]}`);
    return Number.isFinite(value) && value >= 2 && value < 100000 ? value : null;
  }

  const compact = text.match(/(?:^|\s)(\d{3,7})\s*Týdenní akce\s*$/i);
  if (compact) {
    const value = Number(compact[1]) / 100;
    return Number.isFinite(value) && value >= 2 && value < 100000 ? value : null;
  }
  return null;
}

function productNumber(url: string | null) {
  return String(url || '').match(/\/p\/(\d{5,12})\//)?.[1] || null;
}

function itemsFrom(html: string, base: string) {
  const out: any[] = [];
  const seen = new Set<string>();
  const re = /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const text = clean(m[4]);
    if (!/Týdenní akce/i.test(text)) continue;
    const price = parseActionPrice(text);
    if (price == null) continue;
    const title = titleFrom(text);
    if (title.length < 3 || title.length > 140) continue;
    const url = abs(base, m[2]);
    const sku = productNumber(url);
    if (!url || !sku || !/^https:\/\/www\.action\.com\/cs-cz\/p\//i.test(url)) continue;
    const key = `action:${sku}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const quantity = text.match(/\b\d+(?:[,.]\d+)?\s*(?:ml|cl|l|g|kg|ks|kusů|cm|mm|m|párů|balení)\b/i)?.[0] || null;
    out.push({
      title,
      price,
      quantity_text: quantity,
      source_url: url,
      sku,
      confidence: 0.92,
      raw_text: text,
    });
  }
  return out;
}

function decodeEscapes(value: string) {
  return String(value || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&');
}

function actionImageFromHtml(html: string, sku: string) {
  const source = decodeEscapes(html);
  const candidates = source.match(/https:\/\/asset\.action\.com\/image\/upload\/[^\s"'<>\\)]+/gi) || [];
  const safe = candidates.flatMap((candidate) => {
    try {
      const url = new URL(candidate.replace(/[),.;]+$/, ''));
      if (url.protocol !== 'https:' || url.hostname !== 'asset.action.com') return [];
      if (!url.pathname.startsWith('/image/upload/')) return [];
      url.hash = '';
      return [url.toString()];
    } catch {
      return [];
    }
  });
  safe.sort((a, b) => {
    const score = (value: string) =>
      (value.includes(`/${sku}_`) || value.includes(`/${sku}.`) ? 100 : 0)
      + (value.includes('/t_digital_product_image/') ? 20 : 0)
      + (/\/w_(?:1080|1920)\//.test(value) ? 10 : 0);
    return score(b) - score(a);
  });
  return safe[0] || null;
}

async function fetchProductImage(item: any) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PRODUCT_TIMEOUT_MS);
  try {
    const response = await fetch(item.source_url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
        'accept-language': 'cs-CZ,cs;q=0.9',
        accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) return { ...item, image_url: null, image_error: `HTTP ${response.status}` };
    const html = await response.text();
    const image = actionImageFromHtml(html, item.sku);
    return { ...item, image_url: image, image_error: image ? null : 'official_image_not_found' };
  } catch (error) {
    return { ...item, image_url: null, image_error: errorMessage(error).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

async function enrichImages(items: any[]) {
  const out: any[] = [];
  for (let i = 0; i < items.length; i += IMAGE_CONCURRENCY) {
    const batch = items.slice(i, i + IMAGE_CONCURRENCY);
    out.push(...await Promise.all(batch.map(fetchProductImage)));
  }
  return out;
}

async function hash(v: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers: CORS });
  if (!(await allowed(req))) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
  const now = new Date().toISOString();
  try {
    const body = await req.json().catch(() => ({}));
    const { data: store, error: se } = await db.from('stores').select('id').eq('slug', 'action').single();
    if (se || !store) throw se || new Error('Action nebyl nalezen.');
    const { data: source, error: soe } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).order('created_at').limit(1).single();
    if (soe || !source) throw soe || new Error('Action zdroj nebyl nalezen.');

    const res = await fetch(SOURCE_URL, {
      headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'cs-CZ,cs;q=0.9' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`Action stránka HTTP ${res.status}`);
    const html = await res.text();
    const parsed = itemsFrom(html, res.url || SOURCE_URL);
    if (parsed.length < MIN_PRODUCTS || parsed.length > MAX_PRODUCTS) {
      throw new Error(`Action listing parser našel ${parsed.length} produktů; očekáváno ${MIN_PRODUCTS}–${MAX_PRODUCTS}.`);
    }

    const enrichedAll = await enrichImages(parsed);
    const enriched = enrichedAll.filter((item) => /^https:\/\/asset\.action\.com\/image\/upload\//i.test(String(item.image_url || '')));
    if (enriched.length < MIN_PRODUCTS || enriched.length > MAX_PRODUCTS) {
      throw new Error(`Action image enrichment ověřil ${enriched.length}/${parsed.length} produktů; očekáváno alespoň ${MIN_PRODUCTS}.`);
    }

    const d = dates(clean(html));
    if (!d.from || !d.to) throw new Error('Action stránka neobsahuje ověřitelnou platnost týdenní akce.');

    const sourceHash = await hash([
      source.id,d.from,d.to,SOURCE_ADAPTER,
      ...enriched.map((item) => `${item.sku}|${item.title}|${item.price}|${item.image_url}`),
    ].join('\n'));

    if (body.dry_run === true) {
      return Response.json({
        ok: true,
        dry_run: true,
        adapter: SOURCE_ADAPTER,
        parsed: parsed.length,
        approved: enriched.length,
        failed_images: enrichedAll.length - enriched.length,
        dates: d,
        source_hash: sourceHash,
        candidates: enriched.map((item) => ({
          sku: item.sku,title: item.title,price: item.price,quantity_text: item.quantity_text,
          source_url: item.source_url,image_url: item.image_url,
        })),
      }, { headers: CORS });
    }

    await db.from('leaflet_sources').update({ source_url: SOURCE_URL, source_type: 'html', is_active: true, last_error: null }).eq('id', source.id);

    const { data: old } = await db.from('leaflet_imports').select('id,status').eq('source_hash', sourceHash).maybeSingle();
    if (old) {
      await db.from('leaflet_sources').update({
        last_checked_at: now,last_success_at: now,last_error: null,
        last_strategy_used: 'structured_html_v3',last_strategy_success_at: now,
      }).eq('id', source.id);
      return Response.json({ ok: true, existing: true, import_id: old.id, items: enriched.length, dates: d, adapter: SOURCE_ADAPTER }, { headers: CORS });
    }

    const { data: imp, error: ie } = await db.from('leaflet_imports').insert({
      source_id: source.id,
      store_id: store.id,
      source_document_url: SOURCE_URL,
      source_hash: sourceHash,
      status: 'review',
      product_count: enriched.length,
      confidence: 0.99,
      detected_valid_from: d.from,
      detected_valid_to: d.to,
      finished_at: now,
      metadata: {
        adapter: SOURCE_ADAPTER,
        parser_version: SOURCE_ADAPTER,
        ai_used: false,
        image_count: enriched.length,
        failed_count: enrichedAll.length - enriched.length,
        auto_approved_official_source: true,
      },
    }).select('id').single();
    if (ie || !imp) throw ie || new Error('Action v3 import se nepodařilo vytvořit.');

    const rows = enriched.map((item) => ({
      import_id: imp.id,
      title: item.title,
      quantity_text: item.quantity_text,
      price: item.price,
      image_url: item.image_url,
      confidence: 0.99,
      status: 'approved',
      raw_data: {
        parser: SOURCE_ADAPTER,
        raw_text: item.raw_text,
        source_url: item.source_url,
        action_product_number: item.sku,
        official_image: true,
        auto_approved_reason: 'official_action_product_page_and_cdn_image',
      },
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from('leaflet_import_items').insert(rows.slice(i, i + 200));
      if (error) throw error;
    }

    await db.from('leaflet_sources').update({
      last_checked_at: now,
      last_success_at: now,
      last_error: null,
      last_strategy_used: 'structured_html_v3',
      last_strategy_success_at: now,
    }).eq('id', source.id);

    return Response.json({
      ok: true,created: true,import_id: imp.id,items: enriched.length,
      failed_images: enrichedAll.length - enriched.length,dates: d,adapter: SOURCE_ADAPTER,
    }, { headers: CORS });
  } catch (e) {
    const msg = errorMessage(e).slice(0, 1000);
    const { data: store } = await db.from('stores').select('id').eq('slug', 'action').maybeSingle();
    if (store) await db.from('leaflet_sources').update({ last_checked_at: now, last_error: msg }).eq('store_id', store.id);
    return Response.json({ error: msg, code: 'ACTION_SOURCE_SYNC_FAILED' }, { status: 500, headers: CORS });
  }
});
