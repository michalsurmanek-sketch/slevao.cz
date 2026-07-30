import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
};

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(akce|sleva|tesco|clubcard|baleni|ks|g|kg|ml|l)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(value: string): string[] {
  return normalize(value).split(' ').filter((word) => word.length > 1);
}

function score(query: string, candidate: string): number {
  const q = words(query);
  const c = words(candidate);
  if (!q.length || !c.length) return 0;
  const intersection = q.filter((word) => c.includes(word)).length;
  const coverage = intersection / q.length;
  const precision = intersection / c.length;
  return coverage * 0.75 + precision * 0.25;
}

function parseCatalog(html: string): Array<{ title: string; image: string }> {
  const catalog: Array<{ title: string; image: string }> = [];
  for (const match of html.matchAll(/<li\b[^>]*data-testid=["'][^"']+["'][^>]*>([\s\S]*?)<\/li>/gi)) {
    const card = match[1];
    const titleMatch = card.match(/<h2\b[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i);
    const imageMatch = card.match(/<img\b[^>]*\bsrc=["'](https:\/\/digitalcontent\.api\.tesco\.com\/[^"']+)["']/i);
    const title = decodeHtml(String(titleMatch?.[1] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const image = decodeHtml(imageMatch?.[1] || '').replace(/[?&]w=\d+/i, '?w=500');
    if (title && image) catalog.push({ title, image });
  }
  return catalog;
}

async function findOfficialImage(title: string): Promise<string | null> {
  const response = await fetch(`https://nakup.itesco.cz/shop/cs-CZ/search?query=${encodeURIComponent(title)}&inputType=free%20text`, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; SlevaoBot/1.0; +https://slevao.cz)',
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'cs-CZ,cs;q=0.9',
      referer: 'https://nakup.itesco.cz/shop/cs-CZ/',
    },
  });
  if (!response.ok) return null;
  const catalog = parseCatalog(await response.text());
  if (!catalog.length) return null;

  const exact = catalog.find((item) => normalize(item.title) === normalize(title));
  if (exact) return exact.image;

  let best: { title: string; image: string } | null = null;
  let bestScore = 0;
  let secondScore = 0;
  for (const item of catalog) {
    const itemScore = score(title, item.title);
    if (itemScore > bestScore) {
      secondScore = bestScore;
      bestScore = itemScore;
      best = item;
    } else if (itemScore > secondScore) secondScore = itemScore;
  }
  if (!best || bestScore < 0.76 || bestScore - secondScore < 0.06) return null;
  return best.image;
}

async function authorize(request: Request): Promise<boolean> {
  const suppliedCron = request.headers.get('x-cron-secret') || '';
  if (CRON_SECRET && suppliedCron === CRON_SECRET) return true;
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.toLowerCase().startsWith('bearer ')) return false;
  const token = authorization.slice(7);
  if (token === SERVICE_ROLE_KEY) return true;
  const { data } = await db.auth.getUser(token);
  const role = String(data.user?.app_metadata?.role || data.user?.user_metadata?.role || '').toLowerCase();
  return ['admin', 'editor'].includes(role);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!(await authorize(request))) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });

  try {
    const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'tesco').single();
    if (storeError || !store) throw storeError || new Error('Obchod Tesco nebyl nalezen.');

    const today = new Date().toISOString().slice(0, 10);
    const { data: offers, error: offersError } = await db.from('offers')
      .select('id,product_id,title,image_url')
      .eq('store_id', store.id)
      .eq('status', 'published')
      .gte('valid_to', today)
      .limit(1000);
    if (offersError) throw offersError;

    const missing = (offers || []).filter((offer: any) => !/^https?:\/\//i.test(String(offer.image_url || '')));
    let updated = 0;
    let checked = 0;

    for (let offset = 0; offset < missing.length; offset += 5) {
      const batch = missing.slice(offset, offset + 5);
      const images = await Promise.all(batch.map((offer: any) => findOfficialImage(String(offer.title || '')).catch(() => null)));
      for (let index = 0; index < batch.length; index++) {
        checked++;
        const image = images[index];
        if (!image) continue;
        const offer = batch[index];
        const { error: offerError } = await db.from('offers').update({ image_url: image }).eq('id', offer.id);
        if (offerError) throw offerError;
        if (offer.product_id) {
          const { error: productError } = await db.from('products').update({ image_url: image }).eq('id', offer.product_id);
          if (productError) throw productError;
        }
        updated++;
      }
    }

    return Response.json({ ok: true, store: 'Tesco', activeOffers: (offers || []).length, missing: missing.length, checked, updated }, { headers: CORS_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500, headers: CORS_HEADERS });
  }
});
