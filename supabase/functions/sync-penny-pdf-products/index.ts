import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const URL = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CRON = Deno.env.get('CRON_SECRET') || '';
const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const ADAPTER = 'penny-pdf-spatial-v3';
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' };

type Token = { text: string; x: number; y: number; width: number; height: number };
type Page = { page: number; tokens: Token[] };
type Candidate = {
  title: string;
  price: number;
  quantity: string | null;
  page: number;
  confidence: number;
  raw: Record<string, unknown>;
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function allowed(req: Request) {
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${KEY}` || Boolean(CRON && req.headers.get('x-cron-secret') === CRON);
}

function clean(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalized(value: string) {
  return value.toLocaleLowerCase('cs').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function priceValue(text: string) {
  if (!/^\d{1,4}[,.]\d{2}$/.test(text.trim())) return null;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) && value >= 3 && value <= 5000 ? value : null;
}

function titleRejected(text: string) {
  const value = normalized(text);
  if (value.length < 4 || value.length > 85) return true;
  if (!/[a-z]/.test(value) || /^\d/.test(value)) return true;
  if (/\b00\b|%/.test(text)) return true;
  return /^(ruzne druhy|ilustracni foto|zaloha na lahev|nakup den|cena za|pouze|jedinecna(?: nabidka)?|super cena|akcni cena|bezna cena|nejnizsi cena|platnost|penny karta|vice na|www )/.test(value)
    || /(usetrite|sleva|plati pro|maximalne|kus na osobu|fotografie vytvorene|obsah alkoholu)/.test(value);
}

function rowText(tokens: Token[]) {
  return clean(tokens.sort((a, b) => a.x - b.x).map((token) => token.text).join(' '));
}

function uppercaseRatio(text: string) {
  const letters = [...text].filter((char) => /[A-Za-zÁ-ž]/.test(char));
  if (!letters.length) return 0;
  return letters.filter((char) => char === char.toLocaleUpperCase('cs')).length / letters.length;
}

function groupRows(tokens: Token[]) {
  const rows = new Map<number, Token[]>();
  for (const token of tokens) {
    const key = Math.round(token.y / 2.5) * 2.5;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key)!.push(token);
  }
  return [...rows.entries()].map(([y, values]) => ({
    y,
    tokens: values,
    x: Math.min(...values.map((token) => token.x)),
    text: rowText(values),
  }));
}

function findQuantity(tokens: Token[], anchor: Token, left: number, right: number, titleX: number, titleY: number) {
  const nearby = groupRows(tokens.filter((token) =>
    token.x + token.width / 2 >= left && token.x + token.width / 2 <= right
      && token.y >= anchor.y - 72 && token.y <= anchor.y + 72
  )).filter((row) => Math.abs(row.x - titleX) <= 18)
    .sort((a, b) => Math.abs(a.y - titleY) - Math.abs(b.y - titleY));

  // Penny sazba nemá jednotný směr: u některých boxů je balení nad velkou
  // cenou, u jiných pod ní. Nejdřív bereme skutečné balení bez „Kč“, aby se
  // za gramáž výrobku omylem nevzala pouze přepočtená jednotková cena.
  for (const row of nearby) {
    if (/\bKč\b/i.test(row.text)) continue;
    const direct = row.text.match(/\b(?:\d+\s*[x×]\s*)?\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|ks|bal(?:ení)?|rolí|pack)\b/i)?.[0];
    if (direct) return direct.replace(/\s+/g, ' ');
  }
  for (const row of nearby) {
    if (/cena za 1\s*kg/i.test(row.text)) return '1 kg';
  }

  // Leták někdy gramáž vůbec netiskne (typicky kusové akce). „balení“ je
  // poctivá neurčitá prodejní jednotka; na rozdíl od „1 ks“ nic nevymýšlí.
  return 'balení';
}

function selectTitle(tokens: Token[], anchor: Token, left: number, right: number) {
  const rows = groupRows(tokens.filter((token) =>
    token.x + token.width / 2 >= left
      && token.x + token.width / 2 <= right
      && token.y >= anchor.y + 5
      && token.y <= anchor.y + 100
      && token.height >= 4.8
      && token.height <= 12
  )).map((row) => {
    const text = row.text.replace(/[|*]+$/g, '').trim();
    const distance = row.y - anchor.y;
    const ratio = uppercaseRatio(text);
    const averageHeight = row.tokens.reduce((sum, token) => sum + token.height, 0) / row.tokens.length;
    let score = ratio * 4 + Math.min(averageHeight, 8) / 4 - distance / 48;
    if (/\b(?:kg|g|l|ml|ks|bal)\b/i.test(text)) score -= 1.1;
    if (/různé|chlazen|mražen|volná|balen/i.test(text)) score -= 0.5;
    if (titleRejected(text) || priceValue(text) !== null) score = -99;
    return { ...row, text, score, ratio };
  }).filter((row) => row.score > 1.8 && row.ratio >= 0.72).sort((a, b) => b.score - a.score || a.y - b.y);

  const best = rows[0];
  if (!best) return null;

  // Product names are commonly split over two adjacent baselines. Only join a
  // second strong uppercase row from the same price block; never cross the
  // horizontal block boundaries inferred from neighbouring price anchors.
  const companion = rows.find((row) => row !== best
    && Math.abs(row.y - best.y) <= 8
    && row.ratio >= 0.72
    && clean(`${best.text} ${row.text}`).length <= 72
    && !titleRejected(`${best.text} ${row.text}`));
  const title = clean((companion ? [best, companion].sort((a, b) => b.y - a.y) : [best])
    .map((row) => row.text).join(' '));
  return titleRejected(title) ? null : {
    title,
    score: best.score,
    uppercase: best.ratio,
    x: best.x,
    y: best.y,
  };
}

function parsePages(pages: Page[]) {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const page of pages) {
    const tokens = (page.tokens || []).map((token) => ({
      text: clean(token.text), x: Number(token.x), y: Number(token.y),
      width: Number(token.width), height: Number(token.height),
    })).filter((token) => token.text && Number.isFinite(token.x) && Number.isFinite(token.y));

    const anchors = tokens.filter((token) => priceValue(token.text) !== null && token.height >= 13)
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .filter((anchor, index, all) => !all.slice(0, index).some((other) =>
        Math.abs(other.x - anchor.x) < 8 && Math.abs(other.y - anchor.y) < 7
      ));

    for (const anchor of anchors) {
      const sameBand = anchors.filter((other) => Math.abs(other.y - anchor.y) <= 28).sort((a, b) => a.x - b.x);
      const position = sameBand.indexOf(anchor);
      const previous = sameBand[position - 1];
      const next = sameBand[position + 1];
      const left = previous ? (previous.x + previous.width / 2 + anchor.x) / 2 : Math.max(0, anchor.x - 62);
      const right = next ? (anchor.x + anchor.width / 2 + next.x) / 2 : anchor.x + Math.max(82, anchor.width + 38);
      const selected = selectTitle(tokens, anchor, left, right);
      const price = priceValue(anchor.text);
      if (!selected || price === null) continue;
      const quantity = findQuantity(tokens, anchor, left, right, selected.x, selected.y);
      const key = `${page.page}|${normalized(selected.title)}|${price.toFixed(2)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const confidence = Math.min(0.98,
        0.89
        + (anchor.height >= 15 ? 0.035 : 0.015)
        + (selected.uppercase >= 0.82 ? 0.025 : 0)
        + (quantity ? 0.015 : 0)
      );
      if (confidence < 0.93) continue;
      candidates.push({
        title: selected.title,
        price,
        quantity,
        page: page.page,
        confidence,
        raw: {
          parser: ADAPTER,
          deterministic: true,
          price_anchor: { text: anchor.text, x: anchor.x, y: anchor.y, height: anchor.height },
          title_score: selected.score,
          title_uppercase_ratio: selected.uppercase,
          block: { left, right },
        },
      });
    }
  }
  return candidates;
}

async function publishImport(importId: string) {
  const response = await fetch(`${URL}/functions/v1/publish-imports`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, apikey: KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ import_id: importId }),
  });
  const text = await response.text();
  let payload: any = {};
  try { payload = JSON.parse(text); } catch { /* keep payload empty */ }
  if (!response.ok || payload?.ok !== true) throw new Error(`Publikace selhala: HTTP ${response.status} ${text.slice(0, 500)}`);
  return payload;
}

async function expireSupersededOffers(importId: string, storeId: string, validFrom: string, validTo: string) {
  const { data: items, error: itemsError } = await db.from('leaflet_import_items')
    .select('product_id,price').eq('import_id', importId).not('product_id', 'is', null);
  if (itemsError) throw itemsError;
  const current = new Set((items || []).map((item: any) => `${item.product_id}|${Number(item.price).toFixed(2)}`));

  const { data: offers, error: offersError } = await db.from('offers')
    .select('id,product_id,price')
    .eq('store_id', storeId).eq('status', 'published')
    .lte('valid_from', validTo).gte('valid_to', validFrom);
  if (offersError) throw offersError;
  const stale = (offers || []).filter((offer: any) =>
    !current.has(`${offer.product_id}|${Number(offer.price).toFixed(2)}`)
  );
  for (let offset = 0; offset < stale.length; offset += 100) {
    const chunk = stale.slice(offset, offset + 100);
    const ids = chunk.map((offer: any) => offer.id);
    const { error } = await db.from('offers').update({ status: 'expired' }).in('id', ids);
    if (error) throw error;
  }
  return stale.length;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: HEADERS });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  if (!allowed(req)) return reply({ error: 'Unauthorized' }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date());

    const { data: store, error: storeError } = await db.from('stores').select('id,name').eq('slug', 'penny').single();
    if (storeError || !store) throw storeError || new Error('Penny nebylo nalezeno.');

    let sourceQuery = db.from('leaflet_imports').select('*')
      .eq('store_id', store.id)
      .eq('metadata->>adapter', 'store:penny-flippingbook')
      .lte('detected_valid_from', today)
      .gte('detected_valid_to', today)
      .order('created_at', { ascending: false })
      .limit(1);
    if (body.source_import_id) sourceQuery = db.from('leaflet_imports').select('*').eq('id', String(body.source_import_id)).limit(1);
    const { data: imports, error: importError } = await sourceQuery;
    if (importError) throw importError;
    const source = imports?.[0];
    if (!source) throw new Error('Aktuální kompletní PDF leták Penny nebyl nalezen.');

    const { data: extracted, error: textError } = await db.from('leaflet_extracted_text')
      .select('pages,page_count,text_chars').eq('import_id', source.id).maybeSingle();
    if (textError) throw textError;
    if (!extracted?.pages) throw new Error('PDF Penny ještě nemá uloženou textovou vrstvu se souřadnicemi.');

    const candidates = parsePages(extracted.pages as Page[]);
    const uniquePages = [...new Set(candidates.map((item) => item.page))].sort((a, b) => a - b);
    if (dryRun) return reply({
      ok: true, dry_run: true, source_import_id: source.id, page_count: extracted.page_count,
      candidates: candidates.length, pages_with_products: uniquePages.length,
      page_range: uniquePages.length ? [uniquePages[0], uniquePages.at(-1)] : [],
      sample: candidates.slice(0, 40),
    });

    if (candidates.length < 25 || candidates.length > 450) {
      throw new Error(`Bezpečnostní kontrola Penny: očekáváno 25–450 produktů, nalezeno ${candidates.length}.`);
    }
    if (uniquePages.length < 8) throw new Error(`Bezpečnostní kontrola Penny: produkty jen na ${uniquePages.length} stranách.`);

    const sourceHash = `${ADAPTER}:${source.id}`;
    const { data: existing, error: existingError } = await db.from('leaflet_imports')
      .select('id,status').eq('source_hash', sourceHash).maybeSingle();
    if (existingError) throw existingError;
    if (existing?.status === 'published') return reply({ ok: true, reused: true, import_id: existing.id, candidates: candidates.length });

    let importId = existing?.id || null;
    if (!importId) {
      const { data: created, error: createError } = await db.from('leaflet_imports').insert({
        source_id: source.source_id,
        store_id: store.id,
        source_document_url: source.source_document_url,
        source_hash: sourceHash,
        status: 'queued',
        product_count: candidates.length,
        page_count: source.page_count,
        confidence: candidates.reduce((sum, item) => sum + item.confidence, 0) / candidates.length,
        coverage_scope: source.coverage_scope || 'national',
        detected_valid_from: source.detected_valid_from,
        detected_valid_to: source.detected_valid_to,
        metadata: {
          adapter: ADAPTER, parser: ADAPTER, deterministic: true,
          source_import_id: source.id, complete_document: true,
          pages_with_products: uniquePages.length,
        },
      }).select('id').single();
      if (createError) throw createError;
      importId = created.id;
    } else {
      await db.from('leaflet_import_items').delete().eq('import_id', importId);
    }

    const rows = candidates.map((item) => ({
      import_id: importId,
      title: item.title,
      quantity_text: item.quantity,
      price: item.price,
      source_page: item.page,
      confidence: item.confidence,
      status: 'approved',
      raw_data: { ...item.raw, source_import_id: source.id, source_document_url: source.source_document_url },
    }));
    const { error: insertError } = await db.from('leaflet_import_items').insert(rows);
    if (insertError) throw insertError;
    const { error: readyError } = await db.from('leaflet_imports').update({
      status: 'review', product_count: rows.length, error_message: null, finished_at: new Date().toISOString(),
    }).eq('id', importId);
    if (readyError) throw readyError;

    const publication = await publishImport(importId);
    const result = Array.isArray(publication.results) ? publication.results[0] : null;
    if (result?.error) throw new Error(result.error);
    const accepted = Number(result?.published || 0) + Number(result?.duplicates || 0);
    if (accepted < 20) throw new Error(`Publikace Penny přijala jen ${accepted}/${candidates.length} produktů.`);

    const expiredSuperseded = await expireSupersededOffers(
      importId, store.id, source.detected_valid_from, source.detected_valid_to,
    );

    return reply({
      ok: true, import_id: importId, source_import_id: source.id,
      candidates: candidates.length, accepted, expired_superseded: expiredSuperseded, publication,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reply({ ok: false, error: message }, 500);
  }
});
