import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const KAUFLAND_OFFERS_URL = "https://prodejny.kaufland.cz/nabidka/prehled.html";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-5-mini";
const MAX_CANDIDATES_PER_PRODUCT = 1;
const MAX_VISUAL_CHECKS_PER_PRODUCT = 2;

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
  usable_for_product_card: boolean;
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

const providers = [
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

function coreName(value: unknown): string {
  return repairMojibake(value)
    .replace(/\([^)]*(?:kart|akc|bezna|cena|ruzne|druh)[^)]*\)/gi, " ")
    .replace(/(?:^|\s)[·•|]\s*\d[\s\S]*$/u, " ")
    .replace(/\b\d+(?:[,.]\d+)?\s*(?:kg|g|l|ml|cl|ks|%)\b/gi, " ")
    .replace(/\b(?:s\s+kartou|akcni\s+set|bezna\s+akcni\s+cena|ruzne\s+druhy|vybrane\s+druhy)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function significantWords(value: unknown): string[] {
  return [...new Set(normalize(coreName(value)).split(" ").filter((word) => word.length > 1 && !STOP_WORDS.has(word)))];
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

function quantityTokens(value: unknown): string[] {
  const input = repairMojibake(value).toLowerCase();
  return [...new Set([...input.matchAll(/\b(\d+(?:[,.]\d+)?)\s*(kg|g|l|ml|cl|ks)\b/g)]
    .map((match) => canonicalQuantity(match[1], match[2]))
    .filter(Boolean))];
}

function productSearchText(product: Product): string {
  return [coreName(product.brand || ""), coreName(product.name), repairMojibake(product.quantity_text || "")]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchDetails(left: unknown, right: unknown) {
  const a = significantWords(left);
  const b = significantWords(right);
  if (!a.length || !b.length) {
    return { score: 0, common: 0, containment: false, quantityConflict: false, quantityOverlap: false };
  }
  const setB = new Set(b);
  const common = a.filter((word) => setB.has(word)).length;
  const containmentScore = common / Math.min(a.length, b.length);
  const jaccard = common / new Set([...a, ...b]).size;
  const prefixBonus = a[0] === b[0] ? 0.08 : 0;
  const qa = quantityTokens(left);
  const qb = quantityTokens(right);
  const quantityOverlap = qa.some((item) => qb.includes(item));
  const quantityConflict = qa.length > 0 && qb.length > 0 && !quantityOverlap;
  const quantityAdjustment = quantityOverlap ? 0.1 : quantityConflict ? -0.35 : 0;
  const score = Math.max(0, Math.min(1, containmentScore * 0.72 + jaccard * 0.28 + prefixBonus + quantityAdjustment));
  const containment = a.every((word) => setB.has(word)) || b.every((word) => a.includes(word));
  return { score, common, containment, quantityConflict, quantityOverlap };
}

function domainOf(url: unknown): string | null {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return null;
  }
}

function validHttpsUrl(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\//i.test(value);
}

function validImageUrl(value: unknown): value is string {
  return validHttpsUrl(value)
    && !/placeholder|no[-_ ]?image|default-image|favicon|(?:^|[\/_-])logo(?:[\/_.-]|$)|\/leaflet-crops\//i.test(value);
}

function sourceOrImage(sourceUrl: unknown, imageUrl: string): string {
  return validHttpsUrl(sourceUrl) ? sourceUrl : imageUrl;
}

function htmlAttribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"));
  return decodeHtml(match?.[1] || "").trim();
}

function absoluteHttpsUrl(value: string, base: string): string | null {
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

async function loadKauflandCatalog(): Promise<CatalogItem[]> {
  try {
    const response = await fetch(KAUFLAND_OFFERS_URL, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "cs-CZ,cs;q=0.9",
        "cache-control": "no-cache",
      },
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const catalog: CatalogItem[] = [];
    const seen = new Set<string>();

    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const tag = match[0];
      const className = htmlAttribute(tag, "class");
      if (!/k-product-tile__main-image/i.test(className)) continue;
      const title = htmlAttribute(tag, "alt").replace(/\s+/g, " ").trim();
      const srcset = htmlAttribute(tag, "srcset").split(",")[0]?.trim().split(/\s+/)[0] || "";
      const rawImage = htmlAttribute(tag, "src") || htmlAttribute(tag, "data-src") || srcset;
      const image = absoluteHttpsUrl(rawImage, response.url || KAUFLAND_OFFERS_URL);
      if (!title || !image || !/kaufland\.media\.schwarz$/i.test(domainOf(image) || "") || seen.has(image)) continue;
      seen.add(image);
      catalog.push({ title, image, sourceUrl: KAUFLAND_OFFERS_URL });
    }
    return catalog;
  } catch (error) {
    console.warn("Kaufland catalog lookup failed:", error instanceof Error ? error.message : String(error));
    return [];
  }
}

function kauflandCandidates(master: Product, catalog: CatalogItem[]): Candidate[] {
  const query = productSearchText(master);
  return catalog
    .map((item) => ({ item, details: matchDetails(query, item.title) }))
    .filter(({ details }) =>
      details.common >= 2
      && details.score >= 0.74
      && !details.quantityConflict
    )
    .sort((a, b) => b.details.score - a.details.score)
    .slice(0, 5)
    .map(({ item, details }) => ({
      image_url: item.image,
      source_url: item.sourceUrl,
      source_domain: "prodejny.kaufland.cz",
      source_type: "retailer" as const,
      width: null,
      height: null,
      quality_score: Math.round(82 + details.score * 14),
      match_score: Number(details.score.toFixed(4)),
      metadata: {
        provider: "official_kaufland_offer_catalog",
        official_retailer: true,
        matched_title: item.title,
        searched_title: query,
        common_words: details.common,
        quantity_overlap: details.quantityOverlap,
      },
    }));
}

async function existingCandidates(db: any, master: Product): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const seen = new Set<string>();
  const add = (
    url: unknown,
    source: string,
    score: number,
    sourceUrl: unknown = null,
    metadata: Record<string, unknown> = {},
  ) => {
    if (!validImageUrl(url) || seen.has(url)) return;
    const finalSourceUrl = sourceOrImage(sourceUrl, url);
    seen.add(url);
    found.push({
      image_url: url,
      source_url: finalSourceUrl,
      source_domain: domainOf(finalSourceUrl) || domainOf(url),
      source_type: source === "products" ? "official_catalog" : "retailer",
      width: null,
      height: null,
      quality_score: score,
      match_score: 1,
      metadata: { provider: `slevao_${source}`, exact_product_id: true, ...metadata },
    });
  };

  const { data: imports } = await db.from("leaflet_import_items")
    .select("image_url,created_at,source_page,import_id,leaflet_imports(source_document_url)")
    .eq("product_id", master.id)
    .not("image_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(20);
  for (const row of imports || []) {
    const importRow = Array.isArray(row.leaflet_imports) ? row.leaflet_imports[0] : row.leaflet_imports;
    const documentUrl = importRow?.source_document_url || null;
    add(row.image_url, "leaflet_import_items", 82, documentUrl, {
      import_id: row.import_id || null,
      source_page: row.source_page || null,
      source_document_url: documentUrl,
    });
  }

  const { data: offers } = await db.from("offers")
    .select("image_url,published_at,stores(name,slug)")
    .eq("product_id", master.id)
    .not("image_url", "is", null)
    .order("published_at", { ascending: false })
    .limit(20);
  for (const row of offers || []) {
    const store = Array.isArray(row.stores) ? row.stores[0] : row.stores;
    add(row.image_url, "offers", 80, row.image_url, {
      store_name: store?.name || null,
      store_slug: store?.slug || null,
    });
  }

  return found;
}

function imageFromFacts(product: any): string | null {
  return [
    product?.image_front_url,
    product?.image_url,
    product?.selected_images?.front?.display?.cs,
    product?.selected_images?.front?.display?.en,
  ].find((url) => validImageUrl(url)) ?? null;
}

async function factsCandidates(master: Product): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const seen = new Set<string>();
  const cleanEan = master.ean?.replace(/\D/g, "") ?? "";
  const query = productSearchText(master);

  for (const provider of providers) {
    let products: any[] = [];
    try {
      if (/^\d{8,14}$/.test(cleanEan)) {
        const response = await fetch(`https://${provider.host}/api/v2/product/${encodeURIComponent(cleanEan)}.json`, {
          headers: { "User-Agent": "Slevao.cz/3.0 (https://slevao.cz)" },
        });
        const data = response.ok ? await response.json() : null;
        if (data?.status === 1 && data.product) products = [data.product];
      }
      if (!products.length && significantWords(query).length >= 2) {
        const url = new URL(`https://${provider.host}/cgi/search.pl`);
        url.searchParams.set("search_terms", query);
        url.searchParams.set("search_simple", "1");
        url.searchParams.set("action", "process");
        url.searchParams.set("json", "1");
        url.searchParams.set("page_size", "20");
        url.searchParams.set(
          "fields",
          "code,product_name,product_name_cs,generic_name_cs,brands,quantity,image_url,image_front_url,image_front_width,image_front_height,selected_images",
        );
        const response = await fetch(url, { headers: { "User-Agent": "Slevao.cz/3.0 (https://slevao.cz)" } });
        const data = response.ok ? await response.json() : null;
        products = Array.isArray(data?.products) ? data.products : [];
      }
    } catch {
      products = [];
    }

    for (const product of products) {
      const image = imageFromFacts(product);
      if (!image || seen.has(image)) continue;
      const exactEan = Boolean(cleanEan && String(product?.code || "").replace(/\D/g, "") === cleanEan);
      const foundText = [
        product?.brands,
        product?.product_name_cs,
        product?.product_name,
        product?.generic_name_cs,
        product?.quantity,
      ].filter(Boolean).join(" ");
      const details = matchDetails(query, foundText);
      const hasMasterQuantity = quantityTokens(master.quantity_text || master.name).length > 0;
      const candidateHasQuantity = quantityTokens(foundText).length > 0;
      const quantityRequiredButMissing = hasMasterQuantity && !candidateHasQuantity && !exactEan;

      if (!exactEan && (
        details.common < 2
        || details.score < 0.72
        || details.quantityConflict
        || quantityRequiredButMissing
      )) continue;

      const productPage = `https://${provider.host}/product/${encodeURIComponent(String(product?.code || cleanEan))}`;
      seen.add(image);
      found.push({
        image_url: image,
        source_url: productPage,
        source_domain: provider.host,
        source_type: "barcode_database",
        width: Number(product?.image_front_width) || null,
        height: Number(product?.image_front_height) || null,
        quality_score: exactEan ? 94 : Math.round(72 + details.score * 18),
        match_score: exactEan ? 1 : Number(details.score.toFixed(4)),
        metadata: {
          provider: provider.key,
          exact_ean: exactEan,
          matched_title: foundText,
          searched_title: query,
          common_words: details.common,
          quantity_overlap: details.quantityOverlap,
        },
      });
    }
  }

  return found.sort((a, b) => b.match_score - a.match_score).slice(0, 10);
}

async function visualReview(master: Product, candidate: Candidate): Promise<VisualReview> {
  if (!OPENAI_API_KEY) throw new Error("V Supabase chybí OPENAI_API_KEY.");

  const schema = {
    type: "object",
    additionalProperties: false,
    required: [
      "usable_for_product_card",
      "product_matches",
      "front_or_catalog_view",
      "clean_background",
      "hands_or_people",
      "shelf_or_scene",
      "back_label_dominant",
      "price_or_promo_overlay",
      "text_dominant",
      "package_quantity_matches",
      "quality_score",
      "confidence",
      "reason",
    ],
    properties: {
      usable_for_product_card: { type: "boolean" },
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
              `Zkontroluj kandidátní fotografii pro produktovou kartu e-shopového typu.\n`
              + `Očekávaný produkt: ${repairMojibake(master.name)}.\n`
              + `Značka: ${repairMojibake(master.brand || "neuvedena")}.\n`
              + `Balení: ${repairMojibake(master.quantity_text || "neuvedeno")}.\n`
              + `Fotografie je přijatelná jen tehdy, když zobrazuje správný produkt nebo čistou fotografii čerstvé potraviny, `
              + `je dobře viditelná zepředu či jako profesionální katalogový záběr a neobsahuje ruku, člověka, regál, nákupní scénu, cenovku ani reklamní grafiku. `
              + `Běžný text vytištěný na přední straně obalu není text_dominant. text_dominant nastav true jen pro zadní etiketu, složení, screenshot nebo obrázek tvořený hlavně textem. `
              + `back_label_dominant nastav true, pokud je vidět hlavně zadní strana, složení nebo nutriční tabulka. `
              + `package_quantity_matches nastav false, když je z obrázku zřejmé jiné balení než očekávané; null, když množství nelze ověřit. `
              + `Buď přísný. Fotografie s rukou, zadní etiketou nebo jinou gramáží je nepoužitelná.`,
          },
          {
            type: "input_image",
            image_url: candidate.image_url,
            detail: "high",
          },
        ],
      }],
      text: {
        format: {
          type: "json_schema",
          name: "slevao_product_image_validation",
          strict: true,
          schema,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Vizuální kontrola selhala: ${payload?.error?.message || `HTTP ${response.status}`}`);
  }
  const text = responseText(payload);
  if (!text) throw new Error("Vizuální kontrola nevrátila výsledek.");
  return JSON.parse(text) as VisualReview;
}

function visualAccepted(review: VisualReview): boolean {
  return review.usable_for_product_card
    && review.product_matches
    && review.front_or_catalog_view
    && !review.hands_or_people
    && !review.shelf_or_scene
    && !review.back_label_dominant
    && !review.price_or_promo_overlay
    && !review.text_dominant
    && review.package_quantity_matches !== false
    && review.quality_score >= 74
    && review.confidence >= 0.82;
}

async function knownBlockedUrls(db: any, productId: string): Promise<Set<string>> {
  const { data } = await db.from("product_image_candidates")
    .select("image_url")
    .eq("product_id", productId)
    .in("status", ["rejected", "invalid"]);
  return new Set((data || []).map((row: any) => String(row.image_url || "")).filter(Boolean));
}

async function saveRejectedCandidate(db: any, master: Product, candidate: Candidate, review: VisualReview) {
  await db.from("product_image_candidates").upsert({
    product_id: master.id,
    image_url: candidate.image_url,
    source_url: candidate.source_url,
    source_domain: candidate.source_domain,
    source_type: candidate.source_type,
    width: candidate.width,
    height: candidate.height,
    quality_score: Math.max(0, Math.min(100, Number(review.quality_score || 0))),
    match_score: Math.max(0, Math.min(1, Math.min(candidate.match_score, Number(review.confidence || 0)))),
    has_clean_background: review.clean_background,
    has_text_overlay: review.text_dominant,
    has_price_overlay: review.price_or_promo_overlay,
    status: "invalid",
    rejection_reason: `Automatická vizuální kontrola: ${review.reason}`.slice(0, 500),
    reviewed_at: new Date().toISOString(),
    metadata: {
      ...candidate.metadata,
      visual_validation: review,
      validation_version: 1,
    },
  }, { onConflict: "product_id,image_url", ignoreDuplicates: true });
}

async function savePendingCandidate(db: any, master: Product, candidate: Candidate, review: VisualReview): Promise<number> {
  const { data, error } = await db.from("product_image_candidates").upsert({
    product_id: master.id,
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
    status: "pending",
    metadata: {
      ...candidate.metadata,
      visual_validation: review,
      validation_version: 1,
    },
  }, { onConflict: "product_id,image_url", ignoreDuplicates: true }).select("id");
  if (error) throw error;
  return Array.isArray(data) ? data.length : 0;
}

async function processProduct(
  db: any,
  master: Product,
  storeSlug: string,
  kauflandCatalog: CatalogItem[],
): Promise<Record<string, unknown>> {
  const blocked = await knownBlockedUrls(db, master.id);
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  const addMany = (rows: Candidate[]) => {
    for (const row of rows) {
      if (!validImageUrl(row.image_url) || seen.has(row.image_url) || blocked.has(row.image_url)) continue;
      if (row.width && row.height && (row.width < 500 || row.height < 500)) continue;
      seen.add(row.image_url);
      candidates.push(row);
    }
  };

  addMany(await existingCandidates(db, master));
  if (storeSlug === "kaufland") addMany(kauflandCandidates(master, kauflandCatalog));
  addMany(await factsCandidates(master));
  candidates.sort((a, b) =>
    Number(Boolean(b.metadata?.official_retailer)) - Number(Boolean(a.metadata?.official_retailer))
    || b.match_score - a.match_score
    || b.quality_score - a.quality_score
  );

  let visualChecks = 0;
  let created = 0;
  const rejected: Array<{ image_url: string; reason: string }> = [];
  let validationError: string | null = null;

  for (const candidate of candidates) {
    if (created >= MAX_CANDIDATES_PER_PRODUCT || visualChecks >= MAX_VISUAL_CHECKS_PER_PRODUCT) break;
    visualChecks++;
    try {
      const review = await visualReview(master, candidate);
      if (visualAccepted(review)) {
        created += await savePendingCandidate(db, master, candidate, review);
      } else {
        await saveRejectedCandidate(db, master, candidate, review);
        rejected.push({ image_url: candidate.image_url, reason: review.reason });
      }
    } catch (error) {
      validationError = error instanceof Error ? error.message : String(error);
      console.warn("Visual candidate validation failed", master.id, validationError);
      break;
    }
  }

  await db.from("products").update({ image_checked_at: new Date().toISOString() }).eq("id", master.id);

  return {
    product_id: master.id,
    name: repairMojibake(master.name),
    status: created > 0 ? "candidates" : "not_found",
    count: created,
    visual_checks: visualChecks,
    visually_rejected: rejected.length,
    validation_error: validationError,
    rejected,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const cronSecret = Deno.env.get("CRON_SECRET") || "";
    if (!supabaseUrl || !serviceKey) throw new Error("Chybí Supabase secrets.");
    if (!OPENAI_API_KEY) throw new Error("Chybí OPENAI_API_KEY pro vizuální kontrolu fotografií.");

    const body = await req.json().catch(() => ({}));
    const productId = typeof body?.product_id === "string" ? body.product_id.trim() : "";
    const storeSlug = typeof body?.store_slug === "string" ? normalize(body.store_slug).replace(/\s+/g, "-") : "";
    const limit = Math.max(1, Math.min(Number(body?.limit ?? 30), 50));
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

    const authorization = req.headers.get("authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    const isService = token === serviceKey;
    const isCron = Boolean(cronSecret && req.headers.get("x-cron-secret") === cronSecret);
    let isStaff = false;
    if (!isService && !isCron && token) {
      const { data } = await db.auth.getUser(token);
      isStaff = ["admin", "editor"].includes(String(data.user?.app_metadata?.role || "").toLowerCase());
    }
    if (!isService && !isCron && !isStaff) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let storeProductIds: string[] | null = null;
    if (storeSlug && !productId) {
      const { data: store, error: storeError } = await db.from("stores").select("id").eq("slug", storeSlug).maybeSingle();
      if (storeError) throw storeError;
      if (!store) throw new Error(`Obchod ${storeSlug} nebyl nalezen.`);
      const today = new Date().toISOString().slice(0, 10);
      const { data: storeOffers, error: offerError } = await db.from("offers")
        .select("product_id")
        .eq("store_id", store.id)
        .eq("status", "published")
        .gte("valid_to", today)
        .not("product_id", "is", null)
        .limit(5000);
      if (offerError) throw offerError;
      storeProductIds = [...new Set<string>((storeOffers || []).map((row: any) => String(row.product_id)).filter(Boolean))];
      if (!storeProductIds.length) {
        return new Response(JSON.stringify({
          ok: true,
          checked: 0,
          created: 0,
          without_match: 0,
          visually_rejected: 0,
          store_slug: storeSlug,
          results: [],
        }), { headers: { ...cors, "Content-Type": "application/json" } });
      }
    }

    let query = db.from("products_missing_verified_images")
      .select("id,name,brand,ean,quantity_text,image_checked_at,active_offer_count,last_offer_at")
      .gt("active_offer_count", 0);
    if (productId) query = query.eq("id", productId);
    else if (storeProductIds) query = query.in("id", storeProductIds);
    query = query
      .order("image_checked_at", { ascending: true, nullsFirst: true })
      .order("active_offer_count", { ascending: false })
      .order("last_offer_at", { ascending: false, nullsFirst: false });

    const { data: products, error } = await query.limit(productId ? 1 : limit);
    if (error) throw error;
    if (productId && !(products || []).length) {
      throw new Error("Vybraný produkt nebyl nalezen nebo už má ověřenou fotografii.");
    }

    const kauflandCatalog = storeSlug === "kaufland" ? await loadKauflandCatalog() : [];
    const results: Record<string, unknown>[] = [];
    const productRows = (products || []) as Product[];
    const concurrency = 5;

    for (let index = 0; index < productRows.length; index += concurrency) {
      const chunk = productRows.slice(index, index + concurrency);
      const chunkResults = await Promise.all(chunk.map((master) => processProduct(db, master, storeSlug, kauflandCatalog)));
      results.push(...chunkResults);
    }

    const created = results.reduce((sum, row: any) => sum + Number(row.count || 0), 0);
    const withoutMatch = results.filter((row: any) => row.status === "not_found").length;
    const visuallyRejected = results.reduce((sum, row: any) => sum + Number(row.visually_rejected || 0), 0);
    const validationErrors = results.filter((row: any) => row.validation_error).length;

    return new Response(JSON.stringify({
      ok: true,
      checked: results.length,
      created,
      without_match: withoutMatch,
      visually_rejected: visuallyRejected,
      validation_errors: validationErrors,
      kaufland_catalog_items: kauflandCatalog.length,
      product_id: productId || null,
      store_slug: storeSlug || null,
      visual_validation: "required",
      results,
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String((error as any)?.message ?? error) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
