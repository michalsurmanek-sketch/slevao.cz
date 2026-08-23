import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
    'access-control-allow-methods': 'POST,OPTIONS',
    'content-type': 'application/json; charset=utf-8',
};
const FETCH_HEADERS = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
    accept: 'text/html,application/json,*/*;q=0.8',
    'accept-language': 'cs-CZ,cs;q=0.9',
};
const SOURCE_ADAPTER = 'kik-publitas-v2';
const ADAPTER = 'kik-publitas-text-v3';
const PARSER = 'kik-publitas-text-v3';
const MIN_SAFE = 30;
const MAX_SAFE = 120;
function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: CORS });
}
function errorText(error) {
    if (error instanceof Error)
        return error.message;
    if (error && typeof error === 'object') {
        const e = error;
        return [e.message, e.details, e.hint, e.code].filter(Boolean).map(String).join(' | ') || JSON.stringify(error);
    }
    return String(error);
}
async function allowed(request) {
    const raw = request.headers.get('authorization') || '';
    const token = raw.replace(/^Bearer\s+/i, '').trim();
    if (token === SERVICE)
        return true;
    if (CRON && request.headers.get('x-cron-secret') === CRON)
        return true;
    if (!token)
        return false;
    const { data, error } = await db.auth.getUser(token);
    return !error && !!data.user && ['admin', 'editor'].includes(String(data.user.app_metadata?.role || '').toLowerCase());
}
async function fetchText(url, timeout = 25000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { headers: FETCH_HEADERS, redirect: 'follow', signal: controller.signal });
        const text = await response.text();
        if (!response.ok)
            throw new Error(`${new globalThis.URL(url).hostname} HTTP ${response.status}`);
        return text;
    }
    finally {
        clearTimeout(timer);
    }
}
function dataFromHtml(html) {
    const marker = 'var data =';
    const start = html.indexOf(marker);
    const jsonStart = html.indexOf('{', start + marker.length);
    const end = html.indexOf('Reader.Bootstrap.init', jsonStart);
    if (start < 0 || jsonStart < 0 || end < 0)
        throw new Error('Publitas data mají neočekávaný formát.');
    const block = html.slice(jsonStart, end);
    const semi = block.lastIndexOf(';');
    return JSON.parse((semi >= 0 ? block.slice(0, semi) : block).trim());
}
async function sha256(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function norm(value) {
    return value.toLocaleLowerCase('cs').replace(/[^a-z0-9áčďéěíňóřšťúůýž]+/giu, ' ').trim().replace(/\s+/g, ' ');
}
function isoFromCz(value) {
    const m = value.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/u);
    if (!m)
        return null;
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
function pragueDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
}
function clean(line) {
    return line.replace(/\s+/g, ' ').replace(/[,:;]+$/u, '').trim();
}
const ARTICLE = /^\d{6,8}$/u;
const PRICE = /^\d{2,4}$/u;
const UNIT_PRICE = /^\d+(?:[,.]\d+)?\s*\/\s*(?:ks|kg|litr|l|m|100\s*g|100\s*ml)\b/iu;
const PAGE_NO = /^0?\d{1,2}$/u;
const NOISE = /(?:PLATNOST OD|Obrázky jsou příklady|Obrázek vytvořený|Vsechny ceny jsou|SOUTĚŽ|ROZJEĎTE TO|ZPÁTKY DO ŠKOLY|VÍC |NABÍDEK|KAŽDÝ ŠKOLNÍ|PŘESTÁVK|PRAVÉ FANOUŠKY|VÝHODY NA SRPEN|BALENÍ$|myKiK|aplikaci)/iu;
const DESC = /(?:\bvel\.|\bza$|\bza\b|\brůzn|\bbarv|\bcca\b|\b100%|\bks\b|\bcm\b|\bml\b|\bkg\b|\blitr\b|\bbavlna\b|\bprůměru\b|\bod$)/iu;
const GENERIC = /^(?:Dětská|Dětské|Dámská|Dámské|Pánská|Pánské|Modelovací|různá provedení|různé barvy|za|od)$/iu;
const ROOT_NEEDS_SUFFIX = /^(?:Dětská|Dětské|Dámská|Dámské|Pánská|Pánské|Modelovací)$/iu;
const GENDER_ADJECTIVE = /^(?:Dětská|Dětské|Dámská|Dámské|Pánská|Pánské)\s+[A-Za-zÁ-ž-]+$/u;
function allCaps(value) {
    const letters = value.replace(/[^A-Za-zÁ-ž]/gu, '');
    return letters.length >= 5 && letters === letters.toLocaleUpperCase('cs');
}
function usableRoot(line) {
    const t = clean(line);
    if (!t || t.length < 3 || t.length > 60 || ARTICLE.test(t) || PRICE.test(t) || PAGE_NO.test(t) || UNIT_PRICE.test(t) || NOISE.test(t) || DESC.test(t) || allCaps(t))
        return false;
    return /^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/u.test(t);
}
function appendable(line) {
    const t = clean(line);
    if (!t || t.length > 32 || /^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]/u.test(t) || /[,:;]/u.test(line) || ARTICLE.test(t) || PRICE.test(t) || UNIT_PRICE.test(t) || NOISE.test(t) || DESC.test(t))
        return false;
    return /^[a-záčďéěíňóřšťúůýž]/u.test(t);
}
function findDescriptor(lines, priceIndex) {
    for (let j = priceIndex - 1; j >= Math.max(0, priceIndex - 6); j--) {
        if (/\bza\b/iu.test(clean(lines[j])))
            return j;
    }
    return -1;
}
function findTitle(lines, descriptorIndex) {
    for (let j = descriptorIndex - 1; j >= Math.max(0, descriptorIndex - 9); j--) {
        const root = clean(lines[j]);
        if (!usableRoot(root))
            continue;
        const parts = [root];
        const mayContinue = ROOT_NEEDS_SUFFIX.test(root) || GENDER_ADJECTIVE.test(root) || /(?:\bpro|\ba|\bnebo)$/iu.test(root);
        if (mayContinue) {
            for (let k = j + 1; k < descriptorIndex && parts.length < 3; k++) {
                if (appendable(lines[k]))
                    parts.push(clean(lines[k]));
            }
        }
        const title = parts.join(' ').replace(/\s+/g, ' ').trim();
        if (!GENERIC.test(title) && title.length >= 4 && title.length <= 72)
            return title;
    }
    return '';
}
function parsePage(text, page, today) {
    const lines = String(text || '').split(/\r?\n/u).map(clean).filter(Boolean);
    let validFrom = null;
    for (const line of lines) {
        if (/PLATNOST OD/iu.test(line)) {
            validFrom = isoFromCz(line);
            if (validFrom)
                break;
        }
    }
    if (!validFrom || validFrom > today)
        return [];
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
        if (!PRICE.test(lines[i]))
            continue;
        const price = Number(lines[i]);
        if (!Number.isFinite(price) || price < 15 || price > 5000 || price === page)
            continue;
        const descriptor = findDescriptor(lines, i);
        if (descriptor < 0)
            continue;
        const title = findTitle(lines, descriptor);
        if (!title)
            continue;
        let article = '';
        for (let j = Math.max(0, descriptor - 2); j <= Math.min(lines.length - 1, i + 4); j++) {
            if (ARTICLE.test(lines[j])) {
                article = lines[j];
                break;
            }
        }
        const isFrom = lines.slice(Math.max(0, descriptor - 2), i).some((x) => /^od$/iu.test(x));
        rows.push({ title, normalized_title: norm(title), price, valid_from: validFrom, valid_to: today, source_page: page, article_id: article || null, is_from_price: isFrom, confidence: article ? 0.97 : 0.93 });
    }
    return rows;
}
async function buildRows(document, viewer, spreads, today) {
    const publicationId = String(document.metadata?.publication_id || '');
    const parsed = [];
    let pages = 0;
    for (const spread of spreads) {
        for (const page of Array.isArray(spread?.pages) ? spread.pages : []) {
            pages++;
            parsed.push(...parsePage(String(page?.text || ''), Number(page?.number || pages), today));
        }
    }
    const best = new Map();
    for (const row of parsed) {
        const key = `${row.article_id || ''}|${row.normalized_title}|${row.valid_from}`;
        const prev = best.get(key);
        if (!prev || row.price < prev.price)
            best.set(key, row);
    }
    const rows = [...best.values()]
        .filter((row) => Boolean(row.article_id) && row.is_from_price !== true)
        .sort((a, b) => a.title.localeCompare(b.title, 'cs') || a.price - b.price);
    for (const row of rows) {
        const identity = await sha256(`${publicationId}|${row.article_id}|${row.normalized_title}`);
        row.external_id = `kik:publitas:${identity.slice(0, 40)}`;
        row.source_url = `${viewer}/page/${row.source_page}`;
        row.quantity_text = null;
        row.old_price = null;
        row.image_url = null;
        row.product_id = null;
        row.metadata = {
            adapter: ADAPTER,
            parser_version: PARSER,
            publication_id: publicationId,
            article_id: row.article_id,
            validity_policy: 'daily_verified_snapshot_until_replaced',
            source_validity_text: 'Platnost od uvedeného data; nabídka platí do vyprodání zásob',
            is_from_price: row.is_from_price,
        };
    }
    return { rows, raw: parsed.length, pages };
}
Deno.serve(async (request) => {
    if (request.method === 'OPTIONS')
        return new Response('ok', { headers: CORS });
    if (request.method !== 'POST')
        return json({ error: 'Method not allowed' }, 405);
    if (!(await allowed(request)))
        return json({ error: 'Unauthorized' }, 401);
    let storeId = null;
    let sourceId = null;
    try {
        const body = await request.json().catch(() => ({}));
        const dryRun = body.dry_run === true;
        const force = body.force === true;
        const today = pragueDate();
        const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'kik').single();
        if (storeError || !store)
            throw storeError || new Error('KiK obchod nebyl nalezen.');
        storeId = store.id;
        const { data: source, error: sourceError } = await db.from('leaflet_sources').select('id').eq('store_id', store.id).eq('source_url', 'https://www.kik.cz/tvuj-online-letak').eq('is_active', true).single();
        if (sourceError || !source)
            throw sourceError || new Error('Aktivní zdroj KiK nebyl nalezen.');
        sourceId = source.id;
        const { data: document, error: documentError } = await db.from('leaflet_imports').select('id,source_hash,metadata').eq('store_id', store.id).eq('status', 'published').contains('metadata', { adapter: SOURCE_ADAPTER }).order('updated_at', { ascending: false }).limit(1).single();
        if (documentError || !document)
            throw documentError || new Error('Aktuální KiK Publitas dokument nebyl nalezen.');
        const viewer = String(document.metadata?.viewer_url || '').replace(/\/+$/u, '');
        if (!/^https:\/\/letaki\.kik\.cz\/kik-[a-z0-9_-]+$/iu.test(viewer))
            throw new Error('KiK dokument nemá povolenou viewer adresu.');
        const html = await fetchText(`${viewer}/`);
        const data = dataFromHtml(html);
        const publicationId = String(data.id || '');
        const expectedPublication = String(document.metadata?.publication_id || '');
        const cacheToken = String(data.cacheToken || '');
        if (!cacheToken)
            throw new Error('KiK Publitas nevrátil cacheToken.');
        if (!publicationId || publicationId !== expectedPublication)
            throw new Error('KiK aktivní publication ID se změnilo; nejdřív musí proběhnout source sync.');
        const spreads = JSON.parse(await fetchText(`${viewer}/spreads.json?version=${encodeURIComponent(cacheToken)}`));
        if (!Array.isArray(spreads) || !spreads.length)
            throw new Error('KiK Publitas nevrátil stránky.');
        const built = await buildRows(document, viewer, spreads, today);
        if (built.rows.length < MIN_SAFE || built.rows.length > MAX_SAFE)
            throw new Error(`KiK parser vytvořil ${built.rows.length} nabídek; bezpečný rozsah je ${MIN_SAFE}–${MAX_SAFE}.`);
        const signature = await sha256(`${document.source_hash}|${cacheToken}|${PARSER}`);
        if (dryRun)
            return json({ ok: true, dry_run: true, store: 'KiK', pages: built.pages, raw_candidates: built.raw, publishable: built.rows.length, signature, valid_from: built.rows[0]?.valid_from || null, valid_to: today, validity_policy: 'daily_verified_snapshot_until_replaced', samples: built.rows.slice(0, 100) });
        if (!force) {
            const { data: state } = await db.from('store_product_sync_state').select('last_source_signature').eq('store_id', store.id).maybeSingle();
            if (state?.last_source_signature === signature) {
                const { count, error: countError } = await db.from('offers').select('id', { count: 'exact', head: true }).eq('store_id', store.id).eq('status', 'published').gte('valid_to', today);
                if (countError)
                    throw countError;
                if ((count || 0) >= MIN_SAFE) {
                    await db.from('leaflet_sources').update({ last_checked_at: new Date().toISOString(), last_success_at: new Date().toISOString(), last_error: null }).eq('id', source.id);
                    return json({ ok: true, no_changes: true, store: 'KiK', available_offers: count, signature, valid_to: today });
                }
            }
        }
        const { data: result, error: publishError } = await db.rpc('publish_structured_store_offers', { p_store_slug: 'kik', p_adapter: ADAPTER, p_signature: signature, p_rows: built.rows, p_min_products: MIN_SAFE, p_max_products: MAX_SAFE, p_source_document_url: viewer, p_parser_version: PARSER });
        if (publishError)
            throw publishError;
        return json({ ok: true, self_published: true, store: 'KiK', pages: built.pages, raw_candidates: built.raw, publishable: built.rows.length, signature, valid_from: built.rows[0]?.valid_from || null, valid_to: today, validity_policy: 'daily_verified_snapshot_until_replaced', result });
    }
    catch (error) {
        const message = errorText(error);
        const now = new Date().toISOString();
        if (storeId)
            await db.from('store_product_sync_state').update({ last_run_at: now, last_error: message.slice(0, 2000), last_parser_error: message.slice(0, 2000), health_status: 'error', health_reason: 'Nová KiK sada nebyla publikována; předchozí veřejná data zůstala beze změny.', is_running: false, updated_at: now }).eq('store_id', storeId);
        if (sourceId)
            await db.from('leaflet_sources').update({ last_checked_at: now, last_error: message.slice(0, 1000) }).eq('id', sourceId);
        return json({ error: message, code: 'KIK_PRODUCT_SYNC_FAILED' }, 500);
    }
});
