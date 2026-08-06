import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://www.terno.cz/prodejny/zlin/';
const PROCESSOR_URL = `${SUPABASE_URL}/functions/v1/process-leaflet`;
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'content-type': 'application/json; charset=utf-8',
};

const BROWSER_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

type Flyer = {
  title: string;
  validFrom: string;
  validTo: string;
  pdfUrl: string;
  coverUrl: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

async function allowed(request: Request) {
  const authorization = request.headers.get('authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  if (token === SERVICE_ROLE_KEY) return true;
  if (CRON_SECRET && request.headers.get('x-cron-secret') === CRON_SECRET) return true;
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  return ['admin', 'editor'].includes(String(data.user?.app_metadata?.role || '').toLowerCase());
}

function decode(value: string) {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&amp;|&#038;/gi, '&')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#8211;|&#x2013;/gi, '–')
    .replace(/&#8212;|&#x2014;/gi, '—')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&');
}

function clean(value: string) {
  return decode(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function iso(day: string, month: string, year: string) {
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function parseRange(value: string) {
  const normalized = clean(value);
  const match = normalized.match(/(\d{1,2})\.(\d{1,2})\.?\s*[–—-]\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!match) return null;
  return {
    validFrom: iso(match[1], match[2], match[5]),
    validTo: iso(match[3], match[4], match[5]),
  };
}

function parseFlyers(html: string): Flyer[] {
  const flyers: Flyer[] = [];
  const pdfMatches = [...html.matchAll(/<a[^>]+href="([^"]+\.pdf(?:\?[^"#]*)?)"[^>]*>/gi)];

  for (const pdfMatch of pdfMatches) {
    const index = pdfMatch.index || 0;
    const start = html.lastIndexOf('<div class="flyer">', index);
    if (start < 0) continue;
    const rawBlock = html.slice(start, index + pdfMatch[0].length);
    const block = decode(rawBlock);
    const title = clean(block.match(/<h3[^>]*flyer__title[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '');
    const range = parseRange(block.match(/<div[^>]*flyer__dates[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
    const pdfUrl = new URL(decode(pdfMatch[1]), SOURCE_URL).toString();
    const coverRaw = block.match(/lightboxThumbnailUrl":"([^"]+)"/i)?.[1]
      || block.match(/"pages":\[\{"src":"([^"]+)"/i)?.[1]
      || null;
    const coverUrl = coverRaw ? new URL(decode(coverRaw), SOURCE_URL).toString() : null;
    if (!title || !range || !pdfUrl.includes('terno.cz/')) continue;
    flyers.push({ title, ...range, pdfUrl, coverUrl });
  }

  const unique = new Map<string, Flyer>();
  for (const flyer of flyers) if (!unique.has(flyer.pdfUrl)) unique.set(flyer.pdfUrl, flyer);
  return [...unique.values()];
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function processImport(importId: string) {
  const result = await fetch(PROCESSOR_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      'content-type': 'application/json',
      ...(CRON_SECRET ? { 'x-cron-secret': CRON_SECRET } : {}),
    },
    body: JSON.stringify({ import_id: importId }),
  });
  if (!result.ok) {
    const text = await result.text().catch(() => '');
    throw new Error(`Terno import ${importId}: HTTP ${result.status} ${text.slice(0, 250)}`);
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  const checkedAt = new Date().toISOString();
  const today = checkedAt.slice(0, 10);
  try {
    const { data: store, error: storeError } = await db.from('stores')
      .select('id,name')
      .eq('slug', 'terno')
      .single();
    if (storeError || !store) throw storeError || new Error('Obchod Terno nebyl nalezen.');

    const { data: activeSource, error: sourceReadError } = await db.from('leaflet_sources')
      .select('id')
      .eq('store_id', store.id)
      .eq('source_url', SOURCE_URL)
      .maybeSingle();
    if (sourceReadError) throw sourceReadError;

    const sourcePayload = {
      name: 'Terno Zlín – aktuální oficiální letáky',
      source_url: SOURCE_URL,
      source_type: 'html',
      is_active: true,
      auto_publish: true,
      check_interval_minutes: 360,
      coverage_scope: 'city',
      city_name: 'Zlín',
      last_error: null,
    };

    let sourceId = activeSource?.id as string | undefined;
    if (sourceId) {
      const { error } = await db.from('leaflet_sources').update(sourcePayload).eq('id', sourceId);
      if (error) throw error;
    } else {
      const { data, error } = await db.from('leaflet_sources').insert({ store_id: store.id, ...sourcePayload }).select('id').single();
      if (error || !data) throw error || new Error('Zdroj Terno se nepodařilo vytvořit.');
      sourceId = data.id;
    }

    const page = await fetch(SOURCE_URL, { headers: BROWSER_HEADERS, redirect: 'follow' });
    if (!page.ok) throw new Error(`Oficiální stránka Terno vrátila HTTP ${page.status}.`);
    const flyers = parseFlyers(await page.text()).filter((flyer) => flyer.validFrom <= today && flyer.validTo >= today);
    if (!flyers.length) throw new Error('Na oficiální stránce Terno nebyl nalezen žádný právě platný PDF leták.');

    const created: Array<{ id: string; title: string; pdf: string }> = [];
    const existing: Array<{ id: string; title: string; status: string }> = [];

    for (const flyer of flyers) {
      const hash = await sha256(`${sourceId}|${flyer.pdfUrl}|terno-zlin-pdf-v1`);
      const { data: old, error: oldError } = await db.from('leaflet_imports')
        .select('id,status')
        .eq('source_hash', hash)
        .maybeSingle();
      if (oldError) throw oldError;
      if (old) {
        existing.push({ id: old.id, title: flyer.title, status: old.status });
        continue;
      }

      const { data: imported, error: importError } = await db.from('leaflet_imports').insert({
        source_id: sourceId,
        store_id: store.id,
        source_document_url: flyer.pdfUrl,
        source_hash: hash,
        status: 'queued',
        coverage_scope: 'city',
        city_name: 'Zlín',
        detected_valid_from: flyer.validFrom,
        detected_valid_to: flyer.validTo,
        metadata: {
          adapter: 'store:terno-zlin-pdf-v1',
          title: flyer.title,
          cover_image_url: flyer.coverUrl,
          source_page: SOURCE_URL,
          region: 'Zlín',
          discovered_at: checkedAt,
        },
      }).select('id').single();
      if (importError || !imported) throw importError || new Error(`Leták ${flyer.title} se nepodařilo zařadit.`);
      created.push({ id: imported.id, title: flyer.title, pdf: flyer.pdfUrl });
    }

    if (created.length) {
      const work = Promise.allSettled(created.map((item) => processImport(item.id))).then((results) => {
        results.forEach((result) => {
          if (result.status === 'rejected') console.error(result.reason);
        });
      });
      const runtime = (globalThis as any).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(work);
      else void work;
    }

    await db.from('leaflet_sources').update({
      last_checked_at: checkedAt,
      last_success_at: checkedAt,
      last_error: null,
      last_strategy_used: 'official_pdf_list',
      last_strategy_success_at: checkedAt,
    }).eq('id', sourceId);

    return json({
      ok: true,
      store: store.name,
      source_id: sourceId,
      current_flyers: flyers,
      created,
      existing,
      processing_started: created.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { data: store } = await db.from('stores').select('id').eq('slug', 'terno').maybeSingle();
    if (store?.id) {
      await db.from('leaflet_sources').update({ last_checked_at: checkedAt, last_error: message.slice(0, 1000) })
        .eq('store_id', store.id)
        .eq('is_active', true);
    }
    return json({ error: message }, 500);
  }
});
