import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64 x64) AppleWebKit/537.36 Chrome/150 Safari/537.36';
const FLOP_LIST = 'https://www.flop-potraviny.cz/prodejny/';
const FLOP_WP_API = 'https://www.flop-potraviny.cz/wp-json/wp/v2/project';
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization,apikey,content-type,x-cron-secret',
  'access-control-allow-methods': 'POST,OPTIONS',
  'content-type': 'application/json; charset=utf-8',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: CORS });
}

function errorText(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function decodeHtml(value: string) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      try { return String.fromCodePoint(Number.parseInt(hex, 16)); } catch { return ''; }
    })
    .replace(/&#(\d+);/g, (_match, dec) => {
      try { return String.fromCodePoint(Number.parseInt(dec, 10)); } catch { return ''; }
    })
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'");
}

function cleanText(value: string) {
  return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function normalizeProjectUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'www.flop-potraviny.cz' || !url.pathname.startsWith('/project/')) return '';
    const pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
    return `https://www.flop-potraviny.cz${pathname}`;
  } catch {
    return '';
  }
}

async function fetchText(url: string, timeout = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': UA,
        accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'accept-language': 'cs-CZ,cs;q=0.9,en;q=0.7',
        'cache-control': 'no-cache',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
    return { text, url: response.url, headers: response.headers };
  } finally {
    clearTimeout(timer);
  }
}

function canonicalStoreLinks(html: string) {
  const links = new Set<string>();
  for (const match of html.matchAll(/https:\/\/www[.]flop-potraviny[.]cz\/project\/[^"'<>\s]+\//gi)) {
    const normalized = normalizeProjectUrl(match[0]);
    if (normalized) links.add(normalized);
  }
  return links;
}

type FlopProject = { id: number; link: string; slug: string; title?: { rendered?: string } };

async function fetchCanonicalProjects(canonical: Set<string>) {
  const projects: FlopProject[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const url = new URL(FLOP_WP_API);
    url.searchParams.set('per_page', '100');
    url.searchParams.set('page', String(page));
    url.searchParams.set('orderby', 'id');
    url.searchParams.set('order', 'asc');
    url.searchParams.set('_fields', 'id,link,slug,title');
    const response = await fetchText(url.toString(), 25_000);
    const parsed = JSON.parse(response.text);
    if (!Array.isArray(parsed)) throw new Error('FLOP WordPress API nevrátilo pole project záznamů.');
    for (const item of parsed) {
      const id = Number(item?.id);
      const link = normalizeProjectUrl(String(item?.link || ''));
      if (!Number.isInteger(id) || id <= 0 || !link || !canonical.has(link)) continue;
      projects.push({ id, link, slug: String(item?.slug || ''), title: item?.title });
    }
    const totalPages = Math.max(1, Math.min(5, Number(response.headers.get('x-wp-totalpages') || 1)));
    if (page >= totalPages) break;
  }
  const unique = new Map<number, FlopProject>();
  for (const project of projects) unique.set(project.id, project);
  return [...unique.values()].sort((a, b) => a.id - b.id);
}

function textBlocks(html: string) {
  const values: string[] = [];
  for (const match of html.matchAll(/<div[^>]+class=["'][^"']*\bet_pb_text_inner\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)) {
    const value = cleanText(match[1]);
    if (value) values.push(value);
  }
  return values;
}

function parseAddress(html: string) {
  const blocks = textBlocks(html);

  // Běžná šablona: název → ulice → PSČ město → telefon.
  for (let index = 0; index < blocks.length; index += 1) {
    const match = blocks[index].match(/^(\d{3}\s?\d{2})\s+(.{2,80})$/u);
    if (!match) continue;
    const previous = blocks[index - 1] || '';
    const street = /^(?:tel|telefon|e-mail|email)\b/i.test(previous) ? '' : previous;
    const phoneBlock = blocks.slice(index + 1, index + 4).find((value) => /^(?:tel\.?|telefon)\s*:/i.test(value)) || '';
    return {
      street: street || null,
      postal_code: match[1].replace(/\s+/g, ' ').trim(),
      city: match[2].trim(),
      phone: phoneBlock.replace(/^(?:tel\.?|telefon)\s*:\s*/i, '').trim() || null,
    };
  }

  // Druhá oficiální FLOP šablona PSČ neuvádí: název → ulice → město → telefon.
  for (let index = 0; index < blocks.length; index += 1) {
    if (!/^(?:tel\.?|telefon)\s*:/i.test(blocks[index])) continue;
    const city = (blocks[index - 1] || '').trim();
    const street = (blocks[index - 2] || '').trim();
    if (!city || !street || /otevírací doba/i.test(city) || /otevírací doba/i.test(street)) continue;
    return {
      street,
      postal_code: null,
      city,
      phone: blocks[index].replace(/^(?:tel\.?|telefon)\s*:\s*/i, '').trim() || null,
    };
  }

  return { street: null, postal_code: null, city: null, phone: null };
}

function mapUrlFromHtml(html: string) {
  const match = html.match(/https:\/\/(?:maps[.]app[.]goo[.]gl\/[^"'<>\s]+|goo[.]gl\/maps\/[^"'<>\s]+)/i);
  return match?.[0] || '';
}

function coordinatesFromUrl(value: string) {
  const exact = value.match(/!3d(-?[0-9]+(?:\.[0-9]+)?)!4d(-?[0-9]+(?:\.[0-9]+)?)/i);
  const viewport = value.match(/@(-?[0-9]+(?:\.[0-9]+)?),(-?[0-9]+(?:\.[0-9]+)?)/i);
  const latitude = Number(exact?.[1] ?? viewport?.[1]);
  const longitude = Number(exact?.[2] ?? viewport?.[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < 48.45 || latitude > 51.2 || longitude < 12 || longitude > 19.1) return null;
  return { latitude, longitude };
}

async function resolveMapCoordinates(shortUrl: string) {
  let current = shortUrl;
  for (let hop = 0; hop < 6; hop += 1) {
    const ready = coordinatesFromUrl(current);
    if (ready) return { ...ready, resolved_url: current };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(current, {
        method: 'GET',
        headers: { 'user-agent': UA, accept: 'text/html,*/*;q=0.8' },
        redirect: 'manual',
        signal: controller.signal,
      });
      const location = response.headers.get('location');
      if (location) {
        current = new URL(location, current).toString();
        continue;
      }
      const fromResponse = coordinatesFromUrl(response.url || current);
      if (fromResponse) return { ...fromResponse, resolved_url: response.url || current };
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  const final = coordinatesFromUrl(current);
  return final ? { ...final, resolved_url: current } : null;
}

function storeName(html: string, fallback: string) {
  const raw = cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || fallback);
  return raw.replace(/\s+-\s+FLOP Potraviny\s*$/i, '').trim() || fallback;
}

async function fetchStore(project: FlopProject) {
  try {
    const page = await fetchText(project.link, 20_000);
    const mapUrl = mapUrlFromHtml(page.text);
    if (!mapUrl) return { row: null, error: 'Detail neobsahuje oficiální odkaz „Ukázat na mapě“.', project };
    const coordinates = await resolveMapCoordinates(mapUrl);
    if (!coordinates) return { row: null, error: 'Oficiální mapový odkaz nevrátil validní GPS v ČR.', project };
    const address = parseAddress(page.text);
    if (!address.city) return { row: null, error: 'Detail neobsahuje město v některé z podporovaných oficiálních adresních šablon.', project };
    const fallback = cleanText(project.title?.rendered || project.slug || `FLOP ${project.id}`);
    const name = storeName(page.text, fallback);

    return {
      row: {
        external_id: `flop:${project.id}`,
        name,
        street: address.street,
        city: address.city,
        postal_code: address.postal_code,
        region: null,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        is_active: true,
        opening_hours: {
          source: 'flop-potraviny.cz',
          wordpress_project_id: project.id,
          detail_url: project.link,
          map_url: mapUrl,
          phone: address.phone,
        },
      },
      error: null,
      project,
    };
  } catch (error) {
    return { row: null, error: errorText(error), project };
  }
}

async function upsertRows(rows: any[]) {
  const { data: store, error: storeError } = await db.from('stores').select('id').eq('slug', 'flop').eq('is_active', true).maybeSingle();
  if (storeError) throw storeError;
  if (!store) throw new Error('Aktivní obchod flop nebyl nalezen v tabulce stores.');
  const payload = rows.map((row) => ({ ...row, store_id: store.id }));
  const { error } = await db.from('branches').upsert(payload, { onConflict: 'store_id,external_id' });
  if (error) throw error;
  return payload.length;
}

export async function syncFlopOfficial(body: any) {
  const dryRun = body?.dry_run === true;
  const offset = Math.max(0, Math.floor(Number(body?.offset || 0)));
  const limit = Math.max(1, Math.min(20, Math.floor(Number(body?.limit || 10))));

  const listing = await fetchText(FLOP_LIST, 25_000);
  const canonical = canonicalStoreLinks(listing.text);
  if (canonical.size < 150) return json({
    error: `Oficiální FLOP seznam obsahuje jen ${canonical.size} unikátních prodejen; synchronizace byla zastavena.`,
    code: 'FLOP_LIST_TOO_SMALL',
    dry_run: dryRun,
  }, 409);

  const projects = await fetchCanonicalProjects(canonical);
  if (projects.length < 150 || projects.length < Math.floor(canonical.size * .95)) return json({
    error: `WordPress API spárovalo jen ${projects.length}/${canonical.size} oficiálních FLOP prodejen; synchronizace byla zastavena.`,
    code: 'FLOP_PROJECT_MATCH_INCOMPLETE',
    dry_run: dryRun,
  }, 409);

  const selected = projects.slice(offset, offset + limit);
  if (!selected.length) return json({ ok: true, dry_run: dryRun, source: 'flop_official', total: projects.length, offset, parsed: 0, done: true });

  const results: Array<Awaited<ReturnType<typeof fetchStore>>> = [];
  for (let from = 0; from < selected.length; from += 4) {
    results.push(...await Promise.all(selected.slice(from, from + 4).map(fetchStore)));
  }
  const rows = results.filter((result) => result.row).map((result) => result.row);
  const failures = results.filter((result) => !result.row).map((result) => ({
    id: result.project.id,
    url: result.project.link,
    error: result.error || 'Neznámá chyba parseru.',
  }));
  const minimum = Math.ceil(selected.length * .8);
  if (rows.length < minimum) return json({
    error: `FLOP parser zpracoval jen ${rows.length}/${selected.length} poboček; zápis dávky byl zastaven.`,
    code: 'FLOP_BATCH_INCOMPLETE',
    dry_run: dryRun,
    total: projects.length,
    offset,
    failures,
  }, 409);

  const written = dryRun ? 0 : await upsertRows(rows);
  return json({
    ok: true,
    dry_run: dryRun,
    source: 'flop_official',
    total: projects.length,
    canonical_total: canonical.size,
    offset,
    requested: selected.length,
    parsed: rows.length,
    written,
    next_offset: offset + selected.length,
    done: offset + selected.length >= projects.length,
    failures,
    samples: rows.slice(0, 5),
  });
}
