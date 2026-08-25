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
  pageImageUrls: string[];
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

function pragueDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + offsetDays));
  return date.toISOString().slice(0, 10);
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
  const starts = [...html.matchAll(/<div class="flyer">/g)].map((match) => match.index || 0);

  for (let index = 0; index < starts.length; index++) {
    const start = starts[index];
    const end = starts[index + 1] ?? Math.min(html.length, start + 250_000);
    const block = decode(html.slice(start, end));
    const title = clean(block.match(/<h3[^>]*flyer__title[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || '');
    const range = parseRange(block.match(/<div[^>]*flyer__dates[^>]*>([\s\S]*?)<\/div>/i)?.[1] || '');
    const pdfRaw = block.match(/<a[^>]+href="([^"]+\.pdf(?:\?[^"#]*)?)"[^>]*>/i)?.[1] || null;
    const rawPageImages = [...block.matchAll(/"src":"([^"]+\.(?:jpe?g|png|webp)(?:\?[^"#]*)?)"/gi)]
      .map((match) => match[1])
      .filter(Boolean);
    const pageImageUrls = [...new Set(rawPageImages
      .map((raw) => {
        try { return new URL(decode(raw), SOURCE_URL).toString(); }
        catch { return null; }
      })
      .filter((url): url is string => Boolean(url && url.includes('terno.cz/'))))];
    const coverRaw = block.match(/lightboxThumbnailUrl":"([^"]+)"/i)?.[1] || rawPageImages[0] || null;
    if (!title || !range || !pdfRaw) continue;

    const pdfUrl = new URL(decode(pdfRaw), SOURCE_URL).toString();
    const coverUrl = coverRaw ? new URL(decode(coverRaw), SOURCE_URL).toString() : null;
    if (!pdfUrl.includes('terno.cz/') || /(?:reklamacni-rad|gdpr)\.pdf/i.test(pdfUrl)) continue;
    flyers.push({ title, ...range, pdfUrl, coverUrl, pageImageUrls });
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
  const today = pragueDate();
  const tomorrow = pragueDate(1);
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
    const flyers = parseFlyers(await page.text()).filter((flyer) => flyer.validFrom <= tomorrow && flyer.validTo >= today);
    if (!flyers.length) throw new Error('Na oficiální stránce Terno nebyl nalezen žádný PDF leták platný dnes ani zítra.');

    const created: Array<{ id: string; title: string; pdf: string }> = [];
    const existing: Array<{ id: string; title: string; status: string; page_images: number }> = [];

    for (const flyer of flyers) {
      const hash = await sha256(`${sourceId}|${flyer.pdfUrl}|terno-zlin-pdf-v1`);
      const { data: old, error: oldError } = await db.from('leaflet_imports')
        .select('id,status,metadata')
        .eq('source_hash', hash)
        .maybeSingle();
      if (oldError) throw oldError;
      if (old) {
        const { error: refreshError } = await db.from('leaflet_imports').update({
          coverage_scope: 'city',
          city_name: 'Zlín',
          detected_valid_from: flyer.validFrom,
          detected_valid_to: flyer.validTo,
          page_count: flyer.pageImageUrls.length || null,
          metadata: {
            ...(old.metadata || {}),
            adapter: 'store:terno-zlin-pdf-v1',
            title: flyer.title,
            cover_image_url: flyer.coverUrl,
            page_image_urls: flyer.pageImageUrls,
            page_image_count: flyer.pageImageUrls.length,
            source_page: SOURCE_URL,
            region: 'Zlín',
            discovered_at: checkedAt,
          },
        }).eq('id', old.id);
        if (refreshError) throw refreshError;
        existing.push({ id: old.id, title: flyer.title, status: old.status, page_images: flyer.pageImageUrls.length });
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
        page_count: flyer.pageImageUrls.length || null,
        metadata: {
          adapter: 'store:terno-zlin-pdf-v1',
          title: flyer.title,
          cover_image_url: flyer.coverUrl,
          page_image_urls: flyer.pageImageUrls,
          page_image_count: flyer.pageImageUrls.length,
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
      discovery_window: { today, tomorrow },
      current_flyers: flyers.map((flyer) => ({
        title: flyer.title,
        validFrom: flyer.validFrom,
        validTo: flyer.validTo,
        pdfUrl: flyer.pdfUrl,
        coverUrl: flyer.coverUrl,
        pageImageCount: flyer.pageImageUrls.length,
      })),
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
