import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const OFFER_URL = 'https://prodejny.kaufland.cz/nabidka/prehled.html?kloffer-week=current';
const SOURCE_URL = 'https://prodejny.kaufland.cz/letak.html';
const ADAPTER = 'kaufland-products-v3-ssr';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}
function formatError(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    const parts = [value.message, value.details, value.hint, value.code].filter(Boolean).map(String);
    if (parts.length) return parts.join(' | ');
    try { return JSON.stringify(error); } catch { return String(error); }
  }
  return String(error);
}
function decodeHtml(value: string) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}
function parseMoney(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? '').replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}
function safeImage(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && ['kaufland.media.schwarz', 'media.kaufland.com'].includes(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
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
async function fetchOfferHtml() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(OFFER_URL, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    const html = await response.text();
    if (!response.ok) throw new Error(`Kaufland nabídka HTTP ${response.status}`);
    if (html.length < 100_000) throw new Error(`Kaufland vrátil podezřele krátkou stránku (${html.length} znaků).`);
    return { response, html };
  } finally {
    clearTimeout(timer);
  }
}
function findTemplate(value: any): any | null {
  if (!value || typeof value !== 'object') return null;
  if (value.component === 'OfferTemplate' && value.props?.offerData) return value;
  for (const child of Object.values(value)) {
    const found = findTemplate(child);
    if (found) return found;
  }
  return null;
}
function parseProducts(html: string) {
  let template: any | null = null;
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1];
    if (!body.includes('OfferTemplate') || !body.includes('offerData')) continue;
    const marker = body.match(/window\.SSR\[[^\]]+\]\s*=/);
    if (!marker || marker.index === undefined) continue;
    const raw = body.slice(marker.index + marker[0].length).trim().replace(/;\s*$/, '');
    try {
      template = findTemplate(JSON.parse(raw));
      if (template) break;
    } catch {
      // Další SSR blok může obsahovat správnou komponentu.
    }
  }
  if (!template) throw new Error('Kaufland změnil SSR strukturu: OfferTemplate nebyl nalezen.');

  const result: any[] = [];
  const seen = new Set<string>();
  for (const cycle of Array.isArray(template.props?.offerData?.cycles) ? template.props.offerData.cycles : []) {
    for (const category of Array.isArray(cycle?.categories) ? cycle.categories : []) {
      for (const item of Array.isArray(category?.offers) ? category.offers : []) {
        const offerId = String(item?.offerId || '').trim();
        const dateFrom = String(item?.dateFrom || category?.dateFrom || '').trim();
        const dateTo = String(item?.dateTo || category?.dateTo || '').trim();
        const price = parseMoney(item?.price);
        if (!offerId || seen.has(offerId)
          || !/^20\d{2}-\d{2}-\d{2}$/.test(dateFrom)
          || !/^20\d{2}-\d{2}-\d{2}$/.test(dateTo)
          || !(Number(price) > 0)) continue;

        const title = decodeHtml(String(item?.title || '').trim());
        const subtitle = decodeHtml(String(item?.subtitle || '').trim());
        const detailTitle = decodeHtml(
          String(item?.detailTitle || [title, subtitle].filter(Boolean).join(' ')).replace(/\\n/g, ' '),
        );
        if (!detailTitle) continue;

        result.push({
          offerId,
          dateFrom,
          dateTo,
          title,
          subtitle,
          detailTitle,
          detailDescription: decodeHtml(String(item?.detailDescription || '').replace(/\\n/g, ' ')),
          price: Number(price),
          oldPrice: parseMoney(item?.formattedOldPrice),
          discount: Number.isFinite(Number(item?.discount)) ? Number(item.discount) : null,
          unit: decodeHtml(String(item?.unit || '').trim()),
          basePrice: decodeHtml(String(item?.formattedBasePrice || item?.basePrice || '').trim()),
          imageUrl: safeImage(item?.listImage || item?.detailImages?.[0]),
          klNr: String(item?.klNr || '').trim() || null,
          label: String(item?.label || '').trim() || null,
          categoryName: String(category?.name || '').trim(),
          categoryDisplayName: decodeHtml(String(category?.displayName || '').trim()),
        });
        seen.add(offerId);
      }
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const current = result.filter((product) => product.dateTo >= today);
  if (current.length < 50) {
    throw new Error(`Kaufland vrátil pouze ${current.length} platných produktů; stará data zůstala zachována.`);
  }
  return current;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();
  let stage = 'start';
  let storeId = '';
  let auditId = '';
  try {
    stage = 'load_store';
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'kaufland').single();
    if (storeError || !store) throw storeError || new Error('Kaufland nebyl nalezen.');
    storeId = store.id;

    stage = 'load_source';
    const { data: source, error: sourceError } = await db.from('leaflet_sources')
      .select('id').eq('store_id', store.id).eq('source_url', SOURCE_URL).eq('is_active', true).single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj Kaufland nebyl nalezen.');

    stage = 'lock';
    await db.rpc('release_stale_product_sync_locks');
    const { data: state, error: stateError } = await db.from('store_product_sync_state')
      .select('is_running,last_offer_count,last_source_signature,last_import_id,last_valid_from,last_valid_to')
      .eq('store_id', store.id)
      .maybeSingle();
    if (stateError) throw stateError;
    if (state?.is_running) throw new Error('Synchronizace Kaufland už právě běží.');
    const { error: lockError } = await db.from('store_product_sync_state').upsert({
      store_id: store.id,
      is_running: true,
      run_started_at: checkedAt,
      last_run_at: checkedAt,
      parser_version: ADAPTER,
      adapter_name: 'sync-kaufland-source',
      adapter_version: ADAPTER,
      last_error: null,
      last_parser_error: null,
    }, { onConflict: 'store_id' });
    if (lockError) throw lockError;

    stage = 'audit';
    const { data: audit, error: auditError } = await db.from('kaufland_product_sync_audit')
      .insert({ source_url: OFFER_URL, status: 'running' }).select('id').single();
    if (auditError || !audit) throw auditError || new Error('Audit Kaufland nešel založit.');
    auditId = audit.id;

    stage = 'fetch_products';
    const { response, html } = await fetchOfferHtml();
    stage = 'parse_products';
    const products = parseProducts(html);
    const signature = await sha256(
      products.map((product) => `${product.offerId}|${product.dateFrom}|${product.dateTo}|${product.price}|${product.oldPrice || ''}`)
        .sort().join('\n'),
    );
    const validFrom = products.map((product) => product.dateFrom).sort()[0];
    const validTo = products.map((product) => product.dateTo).sort().at(-1)!;

    stage = 'check_existing';
    const today = new Date().toISOString().slice(0, 10);
    const { count: currentOfferCount, error: countError } = await db.from('offers')
      .select('id', { count: 'exact', head: true })
      .eq('store_id', store.id)
      .eq('status', 'published')
      .gte('valid_to', today)
      .not('external_id', 'is', null);
    if (countError) throw countError;

    const previousCount = Number(state?.last_offer_count || 0);
    const healthyMinimum = Math.max(50, Math.floor(previousCount * 0.9));
    const unchanged = state?.last_source_signature === signature
      && Boolean(state?.last_import_id)
      && Number(currentOfferCount || 0) >= healthyMinimum;

    if (unchanged) {
      const published = Number(currentOfferCount || 0);
      await db.from('kaufland_product_sync_audit').update({
        status: 'completed',
        http_status: response.status,
        html_length: html.length,
        product_candidates: products.length,
        parsed_products: products.length,
        published_offers: published,
        metadata: {
          parser_version: ADAPTER,
          source_signature: signature,
          import_id: state.last_import_id,
          no_changes: true,
          validity: { from: validFrom, to: validTo },
        },
      }).eq('id', auditId);
      await db.from('store_product_sync_state').upsert({
        store_id: store.id,
        is_running: false,
        run_started_at: null,
        last_run_at: checkedAt,
        last_success_at: checkedAt,
        last_source_signature: signature,
        last_offer_count: published,
        expected_offer_count: products.length,
        last_published_count: published,
        last_valid_from: validFrom,
        last_valid_to: validTo,
        last_audit_id: auditId,
        last_http_status: response.status,
        last_html_length: html.length,
        last_duration_ms: Date.now() - startedAt,
        last_error: null,
        last_parser_error: null,
        health_status: 'ok',
        health_reason: `Oficiální nabídka se nezměnila; ověřeno ${published} produktů.`,
      }, { onConflict: 'store_id' });
      await db.from('leaflet_sources').update({
        last_checked_at: checkedAt,
        last_success_at: checkedAt,
        last_error: null,
        last_strategy_used: 'official_ssr_products_unchanged',
        last_strategy_success_at: checkedAt,
      }).eq('id', source.id);
      return json({
        ok: true,
        self_published: true,
        no_changes: true,
        store: store.name,
        import_id: state.last_import_id,
        parsed_products: products.length,
        published_products: published,
        valid_from: validFrom,
        valid_to: validTo,
      });
    }

    if (previousCount >= 50 && products.length < Math.floor(previousCount * 0.6)) {
      throw new Error(`Kaufland vrátil ${products.length} produktů oproti předchozím ${previousCount}; výměna byla zastavena.`);
    }

    stage = 'prepare_import';
    const sourceHash = await sha256(`${source.id}|${signature}|${ADAPTER}`);
    const metadata = {
      adapter: ADAPTER,
      title: 'Kaufland – aktuální produktová nabídka',
      document_type: 'product_data',
      hide_from_leaflet_feed: true,
      source_page: OFFER_URL,
      source_signature: signature,
      parsed_count: products.length,
      last_seen_at: checkedAt,
    };
    const { data: existingImport, error: importLookupError } = await db.from('leaflet_imports')
      .select('id').eq('source_hash', sourceHash).maybeSingle();
    if (importLookupError) throw importLookupError;

    let importId = existingImport?.id || '';
    if (existingImport) {
      const { error } = await db.from('leaflet_imports').update({
        status: 'processing',
        product_count: products.length,
        detected_valid_from: validFrom,
        detected_valid_to: validTo,
        error_message: null,
        metadata,
        updated_at: checkedAt,
      }).eq('id', existingImport.id);
      if (error) throw error;
    } else {
      const { data: created, error } = await db.from('leaflet_imports').insert({
        source_id: source.id,
        store_id: store.id,
        source_document_url: OFFER_URL,
        source_hash: sourceHash,
        status: 'processing',
        product_count: products.length,
        confidence: 0.99,
        coverage_scope: 'national',
        detected_valid_from: validFrom,
        detected_valid_to: validTo,
        started_at: checkedAt,
        metadata,
      }).select('id').single();
      if (error || !created) throw error || new Error('Produktový import Kaufland nešel založit.');
      importId = created.id;
    }

    stage = 'atomic_publish';
    const { data: applied, error: applyError } = await db.rpc('apply_kaufland_official_offers', {
      p_store_id: store.id,
      p_import_id: importId,
      p_signature: signature,
      p_offers: products,
    });
    if (applyError) throw applyError;
    const published = Number(applied?.published || 0);

    stage = 'finish';
    await db.from('kaufland_product_sync_audit').update({
      status: 'completed',
      http_status: response.status,
      html_length: html.length,
      product_candidates: products.length,
      parsed_products: products.length,
      published_offers: published,
      metadata: {
        parser_version: ADAPTER,
        source_signature: signature,
        import_id: importId,
        result: applied,
        validity: { from: validFrom, to: validTo },
      },
    }).eq('id', auditId);
    await db.from('store_product_sync_state').upsert({
      store_id: store.id,
      is_running: false,
      run_started_at: null,
      last_run_at: checkedAt,
      last_success_at: checkedAt,
      last_source_signature: signature,
      source_fingerprint: signature,
      product_set_hash: signature,
      last_offer_count: published,
      expected_offer_count: products.length,
      last_published_count: published,
      last_valid_from: validFrom,
      last_valid_to: validTo,
      parser_version: ADAPTER,
      adapter_name: 'sync-kaufland-source',
      adapter_version: ADAPTER,
      source_type: 'official-ssr-json',
      source_category: 'current-week',
      last_import_id: importId,
      last_audit_id: auditId,
      last_http_status: response.status,
      last_html_length: html.length,
      last_duration_ms: Date.now() - startedAt,
      last_error: null,
      last_parser_error: null,
      health_status: 'ok',
      health_reason: `Automaticky publikováno ${published}/${products.length} produktů.`,
    }, { onConflict: 'store_id' });
    await db.from('leaflet_sources').update({
      last_checked_at: checkedAt,
      last_success_at: checkedAt,
      last_error: null,
      last_strategy_used: 'official_ssr_products',
      last_strategy_success_at: checkedAt,
    }).eq('id', source.id);

    return json({
      ok: true,
      self_published: true,
      no_changes: false,
      store: store.name,
      import_id: importId,
      parsed_products: products.length,
      published_products: published,
      expired_old_offers: Number(applied?.expired || 0),
      valid_from: validFrom,
      valid_to: validTo,
    });
  } catch (error) {
    const message = `${stage}: ${formatError(error)}`;
    console.error('sync-kaufland-source failed', { stage, error: formatError(error) });
    if (auditId) {
      await db.from('kaufland_product_sync_audit').update({
        status: 'failed',
        error_message: message,
      }).eq('id', auditId);
    }
    if (storeId) {
      await db.from('store_product_sync_state').upsert({
        store_id: storeId,
        is_running: false,
        run_started_at: null,
        last_run_at: checkedAt,
        last_error: message,
        last_parser_error: message,
        health_status: 'error',
        health_reason: message,
        last_duration_ms: Date.now() - startedAt,
      }, { onConflict: 'store_id' });
    }
    return json({ error: message }, 500);
  }
});
