import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';
const SOURCE_URL = 'https://www.albert.cz/aktualni-letaky';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'content-type': 'application/json; charset=utf-8',
};
const HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8',
  'accept-language': 'cs-CZ,cs;q=0.9',
};

type AlbertLeaflet = {
  id: string;
  title?: string | null;
  locationType?: string | null;
  documentType?: string | null;
  validityStartDateFormatted?: string | null;
  validityEndDateFormatted?: string | null;
  viewUrl?: string | null;
  imageUrl?: string | null;
  downloadUrl?: string | null;
};

type CurrentLeaflet = {
  id: string;
  title: string;
  locationType: string;
  documentType: string;
  validFrom: string;
  validTo: string;
  viewerUrl: string;
  coverUrl: string;
  pdfUrl: string;
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

function decodeHtml(value: string) {
  return String(value || '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .trim();
}

async function fetchHtml(url: string, timeoutMs = 25_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: HEADERS, redirect: 'follow', signal: controller.signal });
    const html = await response.text();
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return html;
  } finally {
    clearTimeout(timer);
  }
}

function pragueYear() {
  return Number(new Intl.DateTimeFormat('en', { timeZone: 'Europe/Prague', year: 'numeric' }).format(new Date()));
}

function parseCzechDate(value?: string | null) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) throw new Error(`Albert vrátil neplatné datum: ${value || 'prázdné'}`);

  const day = Number(match[1]);
  const month = Number(match[2]);
  const currentYear = pragueYear();
  let year = Number(match[3]);

  // Albert 25. 8. 2026 zveřejnil příští supermarketový leták se zjevným
  // upstream překlepem „26.08.2926 – 01.09.2026“. Opravujeme pouze velmi
  // úzký tvar 29YY -> 20YY, a jen pokud opravený rok leží v aktuálním
  // provozním okně. Jiné nesmyslné roky dál fail-closed odmítáme.
  if (year < currentYear - 1 || year > currentYear + 2) {
    const repairedYear = Number(`20${match[3].slice(-2)}`);
    const safeAlbertCenturyTypo = match[3].startsWith('29')
      && repairedYear >= currentYear - 1
      && repairedYear <= currentYear + 2;
    if (!safeAlbertCenturyTypo) throw new Error(`Albert vrátil neplatné datum: ${raw}`);
    console.warn('sync-albert-source: opraven zjevný překlep roku v Albert datech', { raw, repairedYear });
    year = repairedYear;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isInteger(day) || !Number.isInteger(month)
    || day < 1 || month < 1 || month > 12
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    throw new Error(`Albert vrátil neplatné datum: ${raw}`);
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function safePdfUrl(value?: string | null) {
  if (!value) throw new Error('Albert u letáku nevrátil PDF adresu.');
  const url = new URL(decodeHtml(value));
  if (url.protocol !== 'https:' || url.hostname !== 'view.publitas.com') {
    throw new Error('Albert vrátil nepovolenou PDF adresu.');
  }
  if (!/^\/90263\/\d+\/pdfs\/[a-f0-9-]+\.pdf$/i.test(url.pathname)) {
    throw new Error('Albert vrátil neočekávaný formát PDF adresy.');
  }
  return url.toString();
}

function safeViewerUrl(value?: string | null) {
  if (!value) throw new Error('Albert u letáku nevrátil adresu prohlížeče.');
  const url = new URL(decodeHtml(value));
  if (url.protocol !== 'https:' || url.hostname !== 'letaky.albert.cz') {
    throw new Error('Albert vrátil nepovolenou adresu prohlížeče.');
  }
  return url.toString();
}

function safeCoverUrl(value?: string | null) {
  if (!value) throw new Error('Albert u letáku nevrátil titulní obrázek.');
  const url = new URL(decodeHtml(value));
  if (url.protocol !== 'https:' || url.hostname !== 'letaky.albert.cz') {
    throw new Error('Albert vrátil nepovolený titulní obrázek.');
  }
  return url.toString();
}

function friendlyTitle(locationType: string, documentType: string) {
  const format = locationType === 'HYPERMARKET' ? 'hypermarket' : 'supermarket';
  const type = documentType === 'CATALOG' ? 'značkový katalog' : 'akční leták';
  return `Albert ${format} – ${type}`;
}

function collectLeaflets(value: unknown, output: Map<string, AlbertLeaflet>, seen = new Set<unknown>()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectLeaflets(item, output, seen);
    return;
  }

  const item = value as Record<string, unknown>;
  if (
    item.__typename === 'Leaflet'
    && typeof item.id === 'string'
    && typeof item.downloadUrl === 'string'
    && typeof item.viewUrl === 'string'
  ) {
    output.set(item.id, item as unknown as AlbertLeaflet);
  }

  for (const nested of Object.values(item)) collectLeaflets(nested, output, seen);
}

async function probePdf(url: string) {
  const response = await fetch(url, {
    headers: { ...HEADERS, accept: 'application/pdf,*/*;q=0.8', range: 'bytes=0-7' },
    redirect: 'follow',
  });
  if (!response.ok && response.status !== 206) throw new Error(`Albert PDF vrátil HTTP ${response.status}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 4 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    throw new Error('Albert místo PDF vrátil jiný dokument.');
  }
}

async function loadCurrentLeaflets(): Promise<CurrentLeaflet[]> {
  const html = await fetchHtml(SOURCE_URL);
  const match = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('Albert stránka neobsahuje vložená data letáků.');

  let nextData: unknown;
  try {
    nextData = JSON.parse(decodeHtml(match[1]));
  } catch {
    throw new Error('Albert vrátil poškozená data letáků.');
  }

  const found = new Map<string, AlbertLeaflet>();
  collectLeaflets(nextData, found);
  const today = new Date().toISOString().slice(0, 10);
  const leaflets: CurrentLeaflet[] = [];

  for (const leaflet of found.values()) {
    const locationType = String(leaflet.locationType || '').toUpperCase();
    const documentType = String(leaflet.documentType || '').toUpperCase();
    if (!['HYPERMARKET', 'SUPERMARKET'].includes(locationType)) continue;
    if (!['LEAFLET', 'CATALOG'].includes(documentType)) continue;

    const validFrom = parseCzechDate(leaflet.validityStartDateFormatted);
    const validTo = parseCzechDate(leaflet.validityEndDateFormatted);
    if (validTo < today) continue;
    if (validFrom > validTo) throw new Error(`Albert vrátil obrácenou platnost letáku ${leaflet.id}: ${validFrom} > ${validTo}`);

    leaflets.push({
      id: leaflet.id,
      title: friendlyTitle(locationType, documentType),
      locationType,
      documentType,
      validFrom,
      validTo,
      viewerUrl: safeViewerUrl(leaflet.viewUrl),
      coverUrl: safeCoverUrl(leaflet.imageUrl),
      pdfUrl: safePdfUrl(leaflet.downloadUrl),
    });
  }

  if (!leaflets.length) throw new Error('Albert nevrátil žádný aktuálně platný leták.');
  leaflets.sort((a, b) => a.locationType.localeCompare(b.locationType) || a.documentType.localeCompare(b.documentType));
  for (const leaflet of leaflets) await probePdf(leaflet.pdfUrl);
  return leaflets;
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!(await allowed(request))) return json({ error: 'Unauthorized' }, 401);

  const checkedAt = new Date().toISOString();
  const today = checkedAt.slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  try {
    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'albert').single();
    if (storeError || !store) throw storeError || new Error('Obchod Albert nebyl nalezen.');

    const { data: source, error: sourceError } = await db.from('leaflet_sources')
      .select('id')
      .eq('store_id', store.id)
      .eq('source_url', SOURCE_URL)
      .eq('is_active', true)
      .single();
    if (sourceError || !source) throw sourceError || new Error('Aktivní zdroj Albert nebyl nalezen.');

    const leaflets = await loadCurrentLeaflets();
    const activeHashes = new Set<string>();
    const imports: Array<{ id: string; title: string; valid_from: string; valid_to: string }> = [];

    for (const leaflet of leaflets) {
      const sourceHash = await sha256(`${source.id}|${leaflet.id}|albert-publitas-v1`);
      activeHashes.add(sourceHash);
      const metadata = {
        adapter: 'albert-publitas-v1',
        title: leaflet.title,
        publication_id: leaflet.id,
        location_type: leaflet.locationType,
        document_type: leaflet.documentType,
        viewer_url: leaflet.viewerUrl,
        cover_image_url: leaflet.coverUrl,
        source_page: SOURCE_URL,
        last_seen_at: checkedAt,
      };

      const { data: existing, error: existingError } = await db.from('leaflet_imports')
        .select('id')
        .eq('source_hash', sourceHash)
        .maybeSingle();
      if (existingError) throw existingError;

      let importId = '';
      if (existing) {
        importId = existing.id;
        const { error } = await db.from('leaflet_imports').update({
          source_document_url: leaflet.pdfUrl,
          status: 'published',
          product_count: 0,
          confidence: 0.99,
          coverage_scope: 'national',
          detected_valid_from: leaflet.validFrom,
          detected_valid_to: leaflet.validTo,
          finished_at: checkedAt,
          error_message: null,
          metadata,
          updated_at: checkedAt,
        }).eq('id', existing.id);
        if (error) throw error;
      } else {
        const { data: imported, error: importError } = await db.from('leaflet_imports').insert({
          source_id: source.id,
          store_id: store.id,
          source_document_url: leaflet.pdfUrl,
          source_hash: sourceHash,
          status: 'published',
          product_count: 0,
          confidence: 0.99,
          coverage_scope: 'national',
          detected_valid_from: leaflet.validFrom,
          detected_valid_to: leaflet.validTo,
          finished_at: checkedAt,
          metadata,
        }).select('id').single();
        if (importError || !imported) throw importError || new Error(`Leták ${leaflet.title} se nepodařilo uložit.`);
        importId = imported.id;
      }
      imports.push({ id: importId, title: leaflet.title, valid_from: leaflet.validFrom, valid_to: leaflet.validTo });
    }

    const { data: oldImports, error: oldError } = await db.from('leaflet_imports')
      .select('id,source_hash,metadata')
      .eq('source_id', source.id)
      .in('status', ['published', 'review', 'publishing'])
      .or(`detected_valid_to.is.null,detected_valid_to.gte.${today}`);
    if (oldError) throw oldError;

    const expired: string[] = [];
    for (const oldImport of oldImports || []) {
      if (activeHashes.has(String(oldImport.source_hash || ''))) continue;
      const { error } = await db.from('leaflet_imports').update({
        detected_valid_to: yesterday,
        metadata: { ...(oldImport.metadata || {}), expired_by_source_at: checkedAt },
        updated_at: checkedAt,
      }).eq('id', oldImport.id);
      if (error) throw error;
      expired.push(oldImport.id);
    }

    await db.from('leaflet_sources').update({
      last_checked_at: checkedAt,
      last_success_at: checkedAt,
      last_error: null,
      last_strategy_used: 'official_next_apollo_pdfs',
      last_strategy_success_at: checkedAt,
    }).eq('id', source.id);

    return json({ ok: true, store: store.name, leaflets, imports, expired });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const { data: store } = await db.from('stores').select('id').eq('slug', 'albert').maybeSingle();
    if (store?.id) {
      await db.from('leaflet_sources').update({
        last_checked_at: checkedAt,
        last_error: message.slice(0, 1000),
      }).eq('store_id', store.id).eq('is_active', true);
    }
    return json({ error: message }, 500);
  }
});
