import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://www.action.com/cs-cz/tydenni-akce/';
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
  // Action renders the integer and decimal part in separate HTML nodes.
  // After stripping HTML a real 32,90 Kč therefore becomes "32 90 Týdenní akce".
  // The previous parser captured only the trailing "90" and produced 0.90 Kč.
  const split = text.match(/(?:^|\s)(\d{1,5})\s+(\d{2})\s*Týdenní akce\s*$/i);
  if (split) {
    const value = Number(`${split[1]}.${split[2]}`);
    return Number.isFinite(value) && value >= 2 && value < 100000 ? value : null;
  }

  // Fallback for pages where the price is emitted as one compact cents value (3290 => 32.90).
  const compact = text.match(/(?:^|\s)(\d{3,7})\s*Týdenní akce\s*$/i);
  if (compact) {
    const value = Number(compact[1]) / 100;
    return Number.isFinite(value) && value >= 2 && value < 100000 ? value : null;
  }
  return null;
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
    const key = `${title.toLocaleLowerCase('cs')}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const quantity = text.match(/\b\d+(?:[,.]\d+)?\s*(?:ml|cl|l|g|kg|ks|kusů|cm|mm|m|párů|balení)\b/i)?.[0] || null;
    out.push({
      title,
      price,
      quantity_text: quantity,
      source_url: url,
      confidence: 0.92,
      raw_data: { parser: 'action-html-v2', raw_text: text },
    });
  }
  return out;
}

async function hash(v: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!(await allowed(req))) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS });
  const now = new Date().toISOString();
  try {
    const { data: store, error: se } = await db.from('stores').select('id').eq('slug', 'action').single();
    if (se) throw se;
    const { data: source, error: soe } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).order('created_at').limit(1).single();
    if (soe) throw soe;
    await db.from('leaflet_sources').update({ source_url: SOURCE_URL, source_type: 'html', is_active: true, last_error: null }).eq('id', source.id);

    const res = await fetch(SOURCE_URL, {
      headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'cs-CZ,cs;q=0.9' },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`Action stránka HTTP ${res.status}`);
    const html = await res.text();
    const parsed = itemsFrom(html, res.url || SOURCE_URL);
    if (parsed.length < 20) throw new Error(`Action HTML parser našel jen ${parsed.length} produktů.`);
    const d = dates(clean(html));
    const sourceHash = await hash(`${source.id}|${d.from}|${d.to}|${parsed.length}|action-html-v2`);

    const { data: old } = await db.from('leaflet_imports').select('id,status').eq('source_hash', sourceHash).maybeSingle();
    if (old) {
      await db.from('leaflet_sources').update({ last_checked_at: now, last_success_at: now, last_error: null }).eq('id', source.id);
      return Response.json({ ok: true, existing: true, import_id: old.id, items: parsed.length, dates: d }, { headers: CORS });
    }

    const { data: imp, error: ie } = await db.from('leaflet_imports').insert({
      source_id: source.id,
      store_id: store.id,
      source_document_url: SOURCE_URL,
      source_hash: sourceHash,
      status: 'review',
      product_count: parsed.length,
      confidence: 0.92,
      detected_valid_from: d.from,
      detected_valid_to: d.to,
      finished_at: now,
      metadata: { adapter: 'action-html-v2', ai_used: false },
    }).select('id').single();
    if (ie) throw ie;

    const rows = parsed.map((x) => ({
      import_id: imp.id,
      title: x.title,
      quantity_text: x.quantity_text,
      price: x.price,
      confidence: x.confidence,
      status: 'review',
      raw_data: { ...x.raw_data, source_url: x.source_url },
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from('leaflet_import_items').insert(rows.slice(i, i + 200));
      if (error) throw error;
    }
    await db.from('leaflet_sources').update({
      last_checked_at: now,
      last_success_at: now,
      last_error: null,
      last_strategy_used: 'structured_html',
      last_strategy_success_at: now,
    }).eq('id', source.id);
    return Response.json({ ok: true, created: true, import_id: imp.id, items: parsed.length, dates: d }, { headers: CORS });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const { data: store } = await db.from('stores').select('id').eq('slug', 'action').maybeSingle();
    if (store) await db.from('leaflet_sources').update({ last_checked_at: now, last_error: msg }).eq('store_id', store.id);
    return Response.json({ error: msg }, { status: 500, headers: CORS });
  }
});
