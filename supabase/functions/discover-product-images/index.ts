import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const KAUFLAND_URL = "https://prodejny.kaufland.cz/nabidka/prehled.html";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-5-mini";
const MAX_RESULTS_PER_PRODUCT = 2;
const MAX_VISUAL_CHECKS_PER_PRODUCT = 3;
const MAX_PRODUCTS_PER_RUN = 20;

const FACTS_PROVIDERS = [
  { key: "open_food_facts", host: "world.openfoodfacts.org" },
  { key: "open_products_facts", host: "world.openproductsfacts.org" },
  { key: "open_beauty_facts", host: "world.openbeautyfacts.org" },
  { key: "open_pet_food_facts", host: "world.openpetfoodfacts.org" },
];

const STOP_WORDS = new Set([
  "akce", "akcni", "bezna", "bezny", "cena", "kartou", "karta", "kaufland",
  "ruzne", "druhy", "druh", "vybrane", "vybrany", "baleni", "pouze", "set",
  "lahev", "pet", "tetra", "pak", "jvp", "kus", "kusu", "ks", "prodej",
  "smesny", "smesna", "tuk", "obsah", "zdarma", "navic", "multipack",
]);

type Product = {
  id: string;
  name: string;
  brand: string | null;
  ean: string | null;
  quantity_text: string | null;
};

type Candidate = {
  image_url: string;
  source_url: string;
  source_domain: string | null;
  source_type: "retailer" | "official_catalog" | "barcode_database" | "unknown";
  width: number | null;
  height: number | null;
  quality_score: number;
  match_score: number;
  metadata: Record<string, unknown>;
};

type CatalogItem = {
  title: string;
  image: string;
  sourceUrl: string;
};

type VisualReview = {
  product_matches: boolean;
  front_or_catalog_view: boolean;
  clean_background: boolean;
  hands_or_people: boolean;
  shelf_or_scene: boolean;
  back_label_dominant: boolean;
  price_or_promo_overlay: boolean;
  text_dominant: boolean;
  package_quantity_matches: boolean | null;
  quality_score: number;
  confidence: number;
  reason: string;
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const row = error as Record<string, unknown>;
    const parts = [
      typeof row.message === "string" ? row.message.trim() : "",
      typeof row.details === "string" ? row.details.trim() : "",
      typeof row.hint === "string" ? row.hint.trim() : "",
      typeof row.code === "string" && row.code.trim() ? `code=${row.code.trim()}` : "",
    ].filter(Boolean);
    if (parts.length) return parts.join(" | ");
    try {
      return JSON.stringify(error);
    } catch {
      // Fall through to the safest string conversion below.
    }
  }
  return String(error);
}

function repairMojibake(value: unknown): string {
  const input = String(value ?? "");
  if (!/[ÃÅÄ]/.test(input)) return input;
  try {
    const bytes = Uint8Array.from([...input].map((char) => char.charCodeAt(0) & 0xff));
    const repaired = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return (repaired.match(/[ÃÅÄ]/g) ?? []).length < (input.match(/[ÃÅÄ]/g) ?? []).length ? repaired : input;
  } catch {
    return input;
  }
}

function decodeHtml(value: string): string {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function normalize(value: unknown): string {
  return repairMojibake(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanName(value: unknown): string {
  return repairMojibake(value)
    .replace(/\([^)]*(?:kart|akc|bezna|cena|ruzne|druh)[^)]*\)/gi, " ")
    .replace(/\b(?:s\s+kartou|akcni\s+set|bezna\s+akcni\s+cena|ruzne\s+druhy|vybrane\s+druhy)\b/gi, " ")
    .replace(/[·•|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: unknown): string[] {
  return [...new Set(normalize(cleanName(value)).split(" ").filter((word) => word.length > 1 && !STOP_WORDS.has(word)))];
}

function canonicalQuantity(numberText: string, unitText: string): string {
  const value = Number(numberText.replace(",", "."));
  const unit = unitText.toLowerCase();
  if (!Number.isFinite(value)) return "";
  if (unit === "kg") return `${Math.round(value * 1000)}g`;
  if (unit === "l") return `${Math.round(value * 1000)}ml`;
  if (unit === "cl") return `${Math.round(value * 10)}ml`;
  return `${Number(value.toFixed(3))}${unit}`;
}

function quantities(value: unknown): string[] {
  const input = repairMojibake(value).toLowerCase();
  const result: string[] = [];
  for (const match of input.matchAll(/\b(\d+(?:[,.]\d+)?)\s*(kg|g|l|ml|cl|ks)\b/g)) {
    result.push(canonicalQuantity(match[1], match[2]));
  }
  for (const match of input.matchAll(/\b(\d+(?:[,.]\d+)?)\s*\/\s*(\d+(?:[,.]\d+)?)\s*(kg|g|l|ml|cl|ks)\b/g)) {
    result.push(canonicalQuantity(match[1], match[3]), canonicalQuantity(match[2], match[3]));
  }
  return [...new Set(result.filter(Boolean))];
}

function productText(product: Product): string {
  return [product.brand, product.name, product.quantity_text].filter(Boolean).join(" ");
}

function lexicalMatch(left: unknown, right: unknown) {
  const a = words(left);
  const b = words(right);
  if (!a.length || !b.length) return { score: 0, common: 0, quantityOverlap: false, quantityConflict: false };
  const setB = new Set(b);
  const commonWords = a.filter((word) => setB.has(word));
  const common = commonWords.length;
  const containment = common / Math.min(a.length, b.length);
  const jaccard = common / new Set([...a, ...b]).size;
  const distinctive = commonWords.some((word) => word.length >= 5);
  const qa = quantities(left);
  const qb = quantities(right);
  const quantityOverlap = qa.some((value) => qb.includes(value));
  const quantityConflict = qa.length > 0 && qb.length > 0 && !quantityOverlap;
  const score = Math.max(0, Math.min(1,
    containment * 0.58
    + jaccard * 0.22
    + (quantityOverlap ? 0.16 : 0)
    + (distinctive ? 0.08 : 0)
    - (quantityConflict ? 0.18 : 0)
  ));
  return { score, common, quantityOverlap, quantityConflict };
}

function viableLexicalCandidate(left: unknown, right: unknown): boolean {
  const match = lexicalMatch(left, right);
  return match.common >= 2 || (match.common >= 1 && (match.quantityOverlap || match.score >= 0.48));
}

function validHttpsUrl(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\//i.test(value);
}

function validImageUrl(value: unknown): value is string {
  return validHttpsUrl(value)
    && !/placeholder|no[-_ ]?image|default-image|favicon|(?:^|[\/_-])logo(?:[\/_.-]|$)/i.test(value);
}

function domainOf(value: unknown): string | null {
  try {
    return new URL(String(value)).hostname;
  } catch {
    return null;
  }
}

function attribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"));
  return decodeHtml(match?.[1] || "").trim();
}

function absoluteUrl(value: string, base: string): string | null {
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value, base);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function responseText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  for (const item of payload?.output || []) {
    for (const part of item?.content || []) {
      if (typeof part?.text === "string" && part.text.trim()) return part.text;
    }
  }
  return "";
}

async function authorize(request: Request, db: any, serviceKey: string, cronSecret: string) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (token === serviceKey) return;
  if (cronSecret && request.headers.get("x-cron-secret") === cronSecret) return;
  if (!token) throw new Error("Unauthorized");
  const { data, error } = await db.auth.getUser(token);
  const role = String(data.user?.app_metadata?.role || "").toLowerCase();
  if (error || !data.user || !["admin", "editor"].includes(role)) throw new Error("Unauthorized");
}

async function loadKauflandCatalog(): Promise<CatalogItem[]> {
  try {
    const response = await fetch(KAUFLAND_URL, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "cs-CZ,cs;q=0.9",
        "cache-control": "no-cache",
      },
      redirect: "follow",
    });
    if (!response.ok) return [];
    const html = await response.text();
    const seen = new Set<string>();
    const items: CatalogItem[] = [];
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = match[0];
      if (!/k-product-tile__main-image/i.test(attribute(tag, "class"))) continue;
      const title = attribute(tag, "alt").replace(/\s+/g, " ").trim();
      const srcset = attribute(tag, "srcset").split(",")[0]?.trim().split(/\s+/)[0] || "";
      const raw = attribute(tag, "src") || attribute(tag, "data-src") || srcset;
      const image = absoluteUrl(raw, response.url || KAUFLAND_URL);
      if (!title || !image || seen.has(image) || !/kaufland\.media\.schwarz$/i.test(domainOf(image) || "")) continue;
      seen.add(image);
      items.push({ title, image, sourceUrl: KAUFLAND_URL });
    }
    return items;
  } catch {
    return [];
  }
}

function kauflandCandidates(product: Product, catalog: CatalogItem[]): Candidate[] {
  const query = productText(product);
  return catalog
    .filter((item) => viableLexicalCandidate(query, item.title))
    .map((item) => ({ item, match: lexicalMatch(query, item.title) }))
    .sort((a, b) => b.match.score - a.match.score)
    .slice(0, 8)
    .map(({ item, match }) => ({
      image_url: item.image,
      source_url: item.sourceUrl,
      source_domain: "prodejny.kaufland.cz",
      source_type: "retailer" as const,
      width: null,
      height: null,
      quality_score: 88,
      match_score: Number(match.score.toFixed(4)),
      metadata: {
        provider: "official_kaufland_catalog",
        official_retailer: true,
        matched_title: item.title,
        searched_title: query,
        quantity_overlap: match.quantityOverlap,
        quantity_conflict: match.quantityConflict,
      },
    }));
}

function factsImage(row: any): string | null {
  return [
    row?.image_front_url,
    row?.selected_images?.front?.display?.cs,
    row?.selected_images?.front?.display?.en,
    row?.image_url,
  ].find((url) => validImageUrl(url)) || null;
}

async function factsCandidates(product: Product): Promise<Candidate[]> {
  const cleanEan = String(product.ean || "").replace(/\D/g, "");
  const query = productText(product);
  const found: Candidate[] = [];
  const seen = new Set<string>();

  for (const provider of FACTS_PROVIDERS) {
    let rows: any[] = [];
    try {
      if (/^\d{8,14}$/.test(cleanEan)) {
        const response = await fetch(`https://${provider.host}/api/v2/product/${cleanEan}.json`, {
          headers: { "User-Agent": "Slevao.cz/4.0 (https://slevao.cz)" },
        });
        const payload = response.ok ? await response.json() : null;
        if (payload?.status === 1 && payload.product) rows = [payload.product];
      }
      if (!rows.length) {
        const url = new URL(`https://${provider.host}/cgi/search.pl`);
        url.searchParams.set("search_terms", query);
        url.searchParams.set("search_simple", "1");
        url.searchParams.set("action", "process");
        url.searchParams.set("json", "1");
        url.searchParams.set("page_size", "25");
        url.searchParams.set("fields", "code,product_name,product_name_cs,generic_name_cs,brands,quantity,image_url,image_front_url,image_front_width,image_front_height,selected_images");
        const response = await fetch(url, { headers: { "User-Agent": "Slevao.cz/4.0 (https://slevao.cz)" } });
        const payload = response.ok ? await response.json() : null;
        rows = Array.isArray(payload?.products) ? payload.products : [];
      }
    } catch {
      rows = [];
    }

    for (const row of rows) {
      const image = factsImage(row);
      if (!image || seen.has(image)) continue;
      const rowEan = String(row?.code || "").replace(/\D/g, "");
      const exactEan = Boolean(cleanEan && rowEan === cleanEan);
      const title = [row?.brands, row?.product_name_cs, row?.product_name, row?.generic_name_cs, row?.quantity]
        .filter(Boolean).join(" ");
      if (!exactEan && !viableLexicalCandidate(query, title)) continue;
      const match = lexicalMatch(query, title);
      seen.add(image);
      found.push({
        image_url: image,
        source_url: `https://${provider.host}/product/${encodeURIComponent(rowEan || cleanEan)}`,
        source_domain: provider.host,
        source_type: "barcode_database",
        width: Number(row?.image_front_width) || null,
        height: Number(row?.image_front_height) || null,
        quality_score: exactEan ? 96 : 76,
        match_score: exactEan ? 1 : Number(match.score.toFixed(4)),
        metadata: {
          provider: provider.key,
          exact_ean: exactEan,
          matched_title: title,
          searched_title: query,
          quantity_overlap: match.quantityOverlap,
          quantity_conflict: match.quantityConflict,
        },
      });
    }
  }

  return found.sort((a, b) => b.match_score - a.match_score).slice(0, 12);
}

async function storedCandidates(db: any, product: Product): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const seen = new Set<string>();
  const add = (image: unknown, sourceUrl: unknown, sourceType: Candidate["source_type"], metadata: Record<string, unknown>) => {
    if (!validImageUrl(image) || seen.has(image)) return;
    seen.add(image);
    found.push({
      image_url: image,
      source_url: validHttpsUrl(sourceUrl) ? sourceUrl : image,
      source_domain: domainOf(sourceUrl) || domainOf(image),
      source_type: sourceType,
      width: null,
      height: null,
      quality_score: 72,
      match_score: 1,
      metadata,
    });
  };

  const { data: imports, error: importsError } = await db.from("leaflet_import_items")
    .select("image_url,import_id,source_page,leaflet_imports(source_document_url)")
    .eq("product_id", product.id)
    .not("image_url", "is", null)
    .limit(10);
  if (importsError) throw importsError;
  for (const row of imports || []) {
    const importRow = Array.isArray(row.leaflet_imports) ? row.leaflet_imports[0] : row.leaflet_imports;
    add(row.image_url, importRow?.source_document_url, "retailer", {
      provider: "leaflet_import",
      import_id: row.import_id,
      source_page: row.source_page,
    });
  }

  const { data: offers, error: offersError } = await db.from("offers")
    .select("image_url,stores(slug,name)")
    .eq("product_id", product.id)
    .not("image_url", "is", null)
    .limit(10);
  if (offersError) throw offersError;
  for (const row of offers || []) {
    const store = Array.isArray(row.stores) ? row.stores[0] : row.stores;
    add(row.image_url, row.image_url, "retailer", {
      provider: "existing_offer",
      store_slug: store?.slug || null,
      store_name: store?.name || null,
    });
  }

  return found;
}

async function blockedUrls(db: any, productId: string): Promise<Set<string>> {
  const { data, error } = await db.from("product_image_candidates")
    .select("image_url")
    .eq("product_id", productId)
    .in("status", ["rejected", "invalid"]);
  if (error) throw error;
  return new Set((data || []).map((row: any) => String(row.image_url || "")).filter(Boolean));
}

async function visualReview(product: Product, candidate: Candidate): Promise<VisualReview> {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "product_matches", "front_or_catalog_view", "clean_background", "hands_or_people",
      "shelf_or_scene", "back_label_dominant", "price_or_promo_overlay", "text_dominant",
      "package_quantity_matches", "quality_score", "confidence", "reason",
    ],
    properties: {
      product_matches: { type: "boolean" },
      front_or_catalog_view: { type: "boolean" },
      clean_background: { type: "boolean" },
      hands_or_people: { type: "boolean" },
      shelf_or_scene: { type: "boolean" },
      back_label_dominant: { type: "boolean" },
      price_or_promo_overlay: { type: "boolean" },
      text_dominant: { type: "boolean" },
      package_quantity_matches: { type: ["boolean", "null"] },
      quality_score: { type: "integer", minimum: 0, maximum: 100 },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string" },
    },
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      store: false,
      input: [{
        role: "user",
        content: [
          {
            type: "input_text",
            text:
              `Posuď fotografii pro produkt: ${repairMojibake(product.name)}. `
              + `Značka: ${repairMojibake(product.brand || "neuvedena")}. `
              + `Balení: ${repairMojibake(product.quantity_text || "neuvedeno")}. `
              + `Rozlišuj tvrdé chyby a pouze kosmetické nedostatky. Tvrdá chyba je jiný produkt, prokazatelně jiné balení, `
              + `zadní etiketa jako hlavní obsah, ruka nebo člověk zakrývající produkt, cenovka či reklamní grafika. `
              + `Horší pozadí, regál nebo běžná fotografie nejsou samy o sobě důvod k zamítnutí, pokud je produkt zepředu dobře viditelný. `
              + `U čerstvých potravin přijmi čistou ilustrační fotografii daného druhu.`,
          },
          { type: "input_image", image_url: candidate.image_url, detail: "high" },
        ],
      }],
      text: { format: { type: "json_schema", name: "slevao_balanced_image_review", strict: true, schema } },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  const text = responseText(payload);
  if (!text) throw new Error("Vizuální kontrola nevrátila výsledek.");
  return JSON.parse(text) as VisualReview;
}

function hardReject(review: VisualReview): boolean {
  return !review.product_matches
    || !review.front_or_catalog_view
    || review.hands_or_people
    || review.back_label_dominant
    || review.price_or_promo_overlay
    || review.text_dominant
    || review.package_quantity_matches === false
    || review.quality_score < 50
    || review.confidence < 0.6;
}

function reviewTier(review: VisualReview): "clean" | "usable_manual" {
  return review.clean_background && !review.shelf_or_scene && review.quality_score >= 74 && review.confidence >= 0.82
    ? "clean"
    : "usable_manual";
}

async function saveCandidate(db: any, product: Product, candidate: Candidate, review: VisualReview, status: "pending" | "invalid") {
  const tier = status === "pending" ? reviewTier(review) : "rejected";
  const { data, error } = await db.from("product_image_candidates").upsert({
    product_id: product.id,
    image_url: candidate.image_url,
    source_url: candidate.source_url,
    source_domain: candidate.source_domain,
    source_type: candidate.source_type,
    width: candidate.width,
    height: candidate.height,
    quality_score: Math.max(0, Math.min(100, Math.min(candidate.quality_score, review.quality_score))),
    match_score: Math.max(0, Math.min(1, Math.min(candidate.match_score, review.confidence))),
    has_clean_background: review.clean_background,
    has_text_overlay: review.text_dominant,
    has_price_overlay: review.price_or_promo_overlay,
    status,
    rejection_reason: status === "invalid" ? `Automatická kontrola: ${review.reason}`.slice(0, 500) : null,
    reviewed_at: status === "invalid" ? new Date().toISOString() : null,
    metadata: {
      ...candidate.metadata,
      visual_validation: review,
      review_tier: tier,
      validation_version: 2,
    },
  }, { onConflict: "product_id,image_url", ignoreDuplicates: true }).select("id");
  if (error) throw error;
  return Array.isArray(data) ? data.length : 0;
}

async function processProduct(db: any, product: Product, storeSlug: string, catalog: CatalogItem[]) {
  const pool: Candidate[] = [];
  const seen = new Set<string>();
  const blocked = await blockedUrls(db, product.id);
  const add = (rows: Candidate[]) => {
    for (const row of rows) {
      if (!validImageUrl(row.image_url) || seen.has(row.image_url) || blocked.has(row.image_url)) continue;
      if (row.width && row.height && (row.width < 280 || row.height < 280)) continue;
      seen.add(row.image_url);
      pool.push(row);
    }
  };

  add(await storedCandidates(db, product));
  if (storeSlug === "kaufland") add(kauflandCandidates(product, catalog));
  add(await factsCandidates(product));

  pool.sort((a, b) =>
    Number(Boolean(b.metadata?.official_retailer)) - Number(Boolean(a.metadata?.official_retailer))
    || b.match_score - a.match_score
    || b.quality_score - a.quality_score
  );

  let checked = 0;
  let created = 0;
  let rejected = 0;
  let validationError: string | null = null;
  const accepted: Array<{ image_url: string; tier: string }> = [];

  for (const candidate of pool) {
    if (created >= MAX_RESULTS_PER_PRODUCT || checked >= MAX_VISUAL_CHECKS_PER_PRODUCT) break;
    checked++;
    try {
      const review = await visualReview(product, candidate);
      if (hardReject(review)) {
        await saveCandidate(db, product, candidate, review, "invalid");
        rejected++;
      } else {
        created += await saveCandidate(db, product, candidate, review, "pending");
        accepted.push({ image_url: candidate.image_url, tier: reviewTier(review) });
      }
    } catch (error) {
      validationError = errorMessage(error);
      break;
    }
  }

  if (!validationError) {
    const { error: checkedError } = await db.from("products")
      .update({ image_checked_at: new Date().toISOString() })
      .eq("id", product.id);
    if (checkedError) throw checkedError;
  }
  return {
    product_id: product.id,
    name: repairMojibake(product.name),
    status: created ? "candidates" : "not_found",
    pool_size: pool.length,
    visual_checks: checked,
    count: created,
    visually_rejected: rejected,
    validation_error: validationError,
    accepted,
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const cronSecret = Deno.env.get("CRON_SECRET") || "";
    if (!supabaseUrl || !serviceKey || !OPENAI_API_KEY) throw new Error("Chybí serverové secrets.");
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    await authorize(request, db, serviceKey, cronSecret);

    const body = await request.json().catch(() => ({}));
    if (body.force_provider_check !== true) {
      const cooldownSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const recentBillingFailure = await db.from("product_image_generation_runs")
        .select("finished_at")
        .eq("status", "failed")
        .ilike("message", "%OpenAI API nemá dostupný kredit%")
        .gte("finished_at", cooldownSince)
        .order("finished_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (recentBillingFailure.error) throw recentBillingFailure.error;
      if (recentBillingFailure.data) {
        const retryAt = new Date(new Date(recentBillingFailure.data.finished_at).getTime() + 24 * 60 * 60 * 1000).toISOString();
        return json({ ok: true, checked: 0, created: 0, without_match: 0, visually_rejected: 0, validation_errors: 0, blocked_reason: "openai_billing_cooldown", retry_after: retryAt, message: "Vizuální ověření je po chybě kreditu v 24hodinové pauze. Ruční kontrolu lze vynutit parametrem force_provider_check." });
      }
    }
    const productId = typeof body.product_id === "string" ? body.product_id.trim() : "";
    const storeSlug = typeof body.store_slug === "string" ? normalize(body.store_slug).replace(/\s+/g, "-") : "";
    const requestedLimit = Number(body.limit || 15);
    const limit = productId ? 1 : Math.max(1, Math.min(requestedLimit, MAX_PRODUCTS_PER_RUN));

    let storeProductIds: string[] | null = null;
    if (storeSlug && !productId) {
      const { data: store, error } = await db.from("stores").select("id").eq("slug", storeSlug).maybeSingle();
      if (error) throw error;
      if (!store) throw new Error(`Obchod ${storeSlug} nebyl nalezen.`);
      const today = new Date().toISOString().slice(0, 10);
      const { data: offers, error: offerError } = await db.from("offers")
        .select("product_id")
        .eq("store_id", store.id)
        .eq("status", "published")
        .gte("valid_to", today)
        .not("product_id", "is", null)
        .limit(5000);
      if (offerError) throw offerError;
      storeProductIds = [...new Set<string>((offers || []).map((row: any) => String(row.product_id)).filter(Boolean))];
      if (!storeProductIds.length) return json({ ok: true, checked: 0, created: 0, without_match: 0, visually_rejected: 0, results: [] });
    }

    let query = db.from("products_missing_verified_images")
      .select("id,name,brand,ean,quantity_text,image_checked_at,active_offer_count,last_offer_at")
      .gt("active_offer_count", 0);
    if (productId) query = query.eq("id", productId);
    else if (storeProductIds) query = query.in("id", storeProductIds);
    query = query
      .order("image_checked_at", { ascending: true, nullsFirst: true })
      .order("active_offer_count", { ascending: false })
      .order("last_offer_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    const { data: rows, error } = await query;
    if (error) throw error;
    if (productId && !(rows || []).length) throw new Error("Produkt nebyl nalezen nebo už má ověřenou fotografii.");

    const catalog = storeSlug === "kaufland" ? await loadKauflandCatalog() : [];
    const products = (rows || []) as Product[];
    const results: Record<string, unknown>[] = [];
    const concurrency = 4;
    for (let index = 0; index < products.length; index += concurrency) {
      const chunk = products.slice(index, index + concurrency);
      results.push(...await Promise.all(chunk.map((product) => processProduct(db, product, storeSlug, catalog))));
    }

    const created = results.reduce((sum, row: any) => sum + Number(row.count || 0), 0);
    const withoutMatch = results.filter((row: any) => row.status === "not_found").length;
    const rejected = results.reduce((sum, row: any) => sum + Number(row.visually_rejected || 0), 0);
    const errors = results.filter((row: any) => row.validation_error).length;

    return json({
      ok: true,
      checked: results.length,
      created,
      without_match: withoutMatch,
      visually_rejected: rejected,
      validation_errors: errors,
      kaufland_catalog_items: catalog.length,
      store_slug: storeSlug || null,
      product_id: productId || null,
      mode: "balanced_manual_review",
      results,
    });
  } catch (error) {
    const message = errorMessage(error);
    return json({ ok: false, error: message }, message === "Unauthorized" ? 401 : 500);
  }
});
