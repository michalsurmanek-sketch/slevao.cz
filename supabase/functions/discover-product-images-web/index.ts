import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-5-mini";
const MAX_PRODUCTS = 4;
const MAX_PAGES_PER_PRODUCT = 3;
const MAX_VISUAL_CHECKS = 4;
const MAX_ACCEPTED = 2;

type Product = {
  id: string;
  name: string;
  brand: string | null;
  ean: string | null;
  quantity_text: string | null;
};

type SearchPage = {
  url: string;
  title: string;
  source_kind: string;
};

type ImageCandidate = {
  image_url: string;
  source_url: string;
  source_domain: string | null;
  score: number;
  evidence: string;
  extraction: string;
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

const STOP_WORDS = new Set([
  "akce", "akcni", "bezna", "bezny", "cena", "kartou", "karta", "ruzne", "druhy",
  "druh", "vybrane", "vybrany", "baleni", "produkt", "oplatka", "jogurt", "zmrzlina",
  "ks", "kus", "kusu", "g", "kg", "ml", "l",
]);

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: CORS });
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(value: unknown): string[] {
  return [...new Set(normalize(value).split(" ").filter((word) => word.length > 1 && !STOP_WORDS.has(word)))];
}

function quantityTokens(value: unknown): string[] {
  const text = String(value ?? "").toLowerCase();
  const result: string[] = [];
  for (const match of text.matchAll(/\b(\d+(?:[,.]\d+)?)\s*(kg|g|l|ml|cl|ks)\b/g)) {
    const number = Number(match[1].replace(",", "."));
    let unit = match[2];
    let amount = number;
    if (unit === "kg") { amount *= 1000; unit = "g"; }
    if (unit === "l") { amount *= 1000; unit = "ml"; }
    if (unit === "cl") { amount *= 10; unit = "ml"; }
    result.push(`${Number(amount.toFixed(3))}${unit}`);
  }
  return [...new Set(result)];
}

function lexical(product: Product, text: unknown) {
  const expected = words([product.brand, product.name].filter(Boolean).join(" "));
  const actual = words(text);
  const set = new Set(actual);
  const common = expected.filter((word) => set.has(word));
  const brand = normalize(product.brand || "");
  const brandMatch = Boolean(brand && normalize(text).includes(brand));
  const expectedQty = quantityTokens([product.name, product.quantity_text].filter(Boolean).join(" "));
  const actualQty = quantityTokens(text);
  const quantityMatch = expectedQty.some((value) => actualQty.includes(value));
  const quantityConflict = expectedQty.length > 0 && actualQty.length > 0 && !quantityMatch;
  const score = Math.min(1,
    (common.length / Math.max(1, expected.length)) * 0.65
    + (brandMatch ? 0.2 : 0)
    + (quantityMatch ? 0.15 : 0)
    - (quantityConflict ? 0.35 : 0)
  );
  return { common: common.length, brandMatch, quantityMatch, quantityConflict, score };
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

function validHttpsUrl(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\//i.test(value);
}

function genericImage(value: unknown): boolean {
  return /placeholder|no[-_ ]?image|default-image|favicon|sprite|logo|opengraph|social|banner|header|footer|icon(?:[\/_.-]|$)|\.svg(?:\?|$)/i.test(String(value || ""));
}

function validImageUrl(value: unknown): value is string {
  return validHttpsUrl(value) && !genericImage(value);
}

function domainOf(value: unknown): string | null {
  try { return new URL(String(value)).hostname; } catch { return null; }
}

function absoluteUrl(value: string, base: string): string | null {
  try {
    const cleaned = String(value || "")
      .replace(/\\u002F/gi, "/")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");
    const url = new URL(cleaned.startsWith("//") ? `https:${cleaned}` : cleaned, base);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function htmlAttribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, "i"));
  return String(match?.[1] || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
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

async function searchPages(product: Product): Promise<SearchPage[]> {
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["pages"],
    properties: {
      pages: {
        type: "array",
        maxItems: MAX_PAGES_PER_PRODUCT,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["url", "title", "source_kind"],
          properties: {
            url: { type: "string" },
            title: { type: "string" },
            source_kind: { type: "string" },
          },
        },
      },
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
      tools: [{
        type: "web_search",
        search_context_size: "low",
        user_location: { type: "approximate", country: "CZ" },
      }],
      input:
        `Najdi přesné produktové stránky pro „${product.name}“. `
        + `Značka: ${product.brand || "neuvedena"}. Balení: ${product.quantity_text || "neuvedeno"}. EAN: ${product.ean || "neuveden"}. `
        + `Vrať maximálně tři konkrétní detailní stránky přesně tohoto produktu. `
        + `Upřednostni výrobce, BILLA e-shop, Globus, Albert, Tesco, Košík, Rohlík, COOP nebo jiný český e-shop s jasnou produktovou fotografií. `
        + `Nevracej domovskou stránku obchodu, kategorii, vyhledávání, sociální síť ani jinou gramáž.`,
      text: {
        format: {
          type: "json_schema",
          name: "slevao_exact_product_pages_v2",
          strict: true,
          schema,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Webové hledání selhalo: HTTP ${response.status}`);
  const text = responseText(payload);
  if (!text) return [];
  const parsed = JSON.parse(text);
  return (Array.isArray(parsed?.pages) ? parsed.pages : [])
    .filter((page: SearchPage) => validHttpsUrl(page?.url))
    .filter((page: SearchPage) => !/\/search|\/hledat|\/kategorie|\/category|\/online-nakup\/?$/i.test(page.url))
    .slice(0, MAX_PAGES_PER_PRODUCT);
}

function collectJsonLdImages(value: any, pageUrl: string, output: ImageCandidate[], product: Product) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonLdImages(item, pageUrl, output, product));
    return;
  }
  if (!value || typeof value !== "object") return;
  const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
  const isProduct = types.some((type) => /product/i.test(String(type || "")));
  if (isProduct) {
    const name = String(value.name || value.headline || "");
    const pageMatch = lexical(product, name);
    const images = Array.isArray(value.image) ? value.image : [value.image];
    for (const imageValue of images) {
      const raw = typeof imageValue === "string"
        ? imageValue
        : imageValue?.contentUrl || imageValue?.url || imageValue?.thumbnailUrl;
      const image = absoluteUrl(String(raw || ""), pageUrl);
      if (!image || !validImageUrl(image)) continue;
      output.push({
        image_url: image,
        source_url: pageUrl,
        source_domain: domainOf(pageUrl),
        score: 120 + Math.round(pageMatch.score * 30),
        evidence: name,
        extraction: "json_ld_product",
      });
    }
  }
  Object.values(value).forEach((item) => {
    if (item && typeof item === "object") collectJsonLdImages(item, pageUrl, output, product);
  });
}

function extractImagesFromHtml(html: string, pageUrl: string, pageTitle: string, product: Product): ImageCandidate[] {
  const candidates: ImageCandidate[] = [];
  const add = (raw: string, score: number, evidence: string, extraction: string) => {
    const image = absoluteUrl(raw, pageUrl);
    if (!image || !validImageUrl(image)) return;
    const match = lexical(product, `${pageTitle} ${evidence} ${image}`);
    if (match.quantityConflict && match.common < 2 && !match.brandMatch) return;
    candidates.push({
      image_url: image,
      source_url: pageUrl,
      source_domain: domainOf(pageUrl),
      score: score + Math.round(match.score * 60),
      evidence,
      extraction,
    });
  };

  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      collectJsonLdImages(parsed, pageUrl, candidates, product);
    } catch {
      // Some stores emit invalid JSON-LD; other extraction paths continue.
    }
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const alt = htmlAttribute(tag, "alt");
    const title = htmlAttribute(tag, "title");
    const classes = `${htmlAttribute(tag, "class")} ${htmlAttribute(tag, "id")} ${htmlAttribute(tag, "itemprop")}`;
    const evidence = `${alt} ${title} ${classes}`;
    const srcset = htmlAttribute(tag, "srcset").split(",").pop()?.trim().split(/\s+/)[0] || "";
    const raw = htmlAttribute(tag, "data-zoom-image")
      || htmlAttribute(tag, "data-large-image")
      || htmlAttribute(tag, "data-original")
      || htmlAttribute(tag, "data-lazy-src")
      || htmlAttribute(tag, "data-src")
      || srcset
      || htmlAttribute(tag, "src");
    if (!raw) continue;
    const matchScore = lexical(product, evidence);
    let score = 20;
    if (/product|gallery|detail|primary|main|packshot|pdp|zoom/i.test(classes)) score += 45;
    if (matchScore.brandMatch) score += 45;
    if (matchScore.common >= 2) score += 50;
    else if (matchScore.common === 1) score += 20;
    if (matchScore.quantityMatch) score += 25;
    add(raw, score, evidence, "img_tag");
  }

  const jsonPatterns = [
    /"(?:imageUrl|image_url|mainImage|primaryImage|productImage|zoomImage|largeImage)"\s*:\s*"([^"]+)"/gi,
    /"image"\s*:\s*"(https?:\\?\/\\?\/[^"]+)"/gi,
    /"images"\s*:\s*\[\s*"([^"]+)"/gi,
  ];
  for (const pattern of jsonPatterns) {
    for (const match of html.matchAll(pattern)) add(match[1], 65, pageTitle, "embedded_json");
  }

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = (htmlAttribute(tag, "property") || htmlAttribute(tag, "name")).toLowerCase();
    if (!["og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"].includes(key)) continue;
    add(htmlAttribute(tag, "content"), 10, pageTitle, "page_meta");
  }

  const unique = new Map<string, ImageCandidate>();
  for (const candidate of candidates) {
    const previous = unique.get(candidate.image_url);
    if (!previous || candidate.score > previous.score) unique.set(candidate.image_url, candidate);
  }
  return [...unique.values()].sort((a, b) => b.score - a.score).slice(0, 10);
}

async function pageImages(page: SearchPage, product: Product): Promise<ImageCandidate[]> {
  try {
    const response = await fetch(page.url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
        accept: "text/html,application/xhtml+xml,image/avif,image/webp,*/*",
        "accept-language": "cs-CZ,cs;q=0.9,en;q=0.7",
      },
      redirect: "follow",
    });
    if (!response.ok) return [];
    const contentType = response.headers.get("content-type") || "";
    if (contentType.startsWith("image/") && validImageUrl(response.url)) {
      return [{ image_url: response.url, source_url: response.url, source_domain: domainOf(response.url), score: 100, evidence: page.title, extraction: "direct_image" }];
    }
    if (!contentType.includes("text/html")) return [];
    const html = (await response.text()).slice(0, 5_000_000);
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const htmlTitle = String(titleMatch?.[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const combinedTitle = `${page.title} ${htmlTitle}`;
    const pageMatch = lexical(product, combinedTitle);
    if (pageMatch.quantityConflict && pageMatch.common < 2 && !pageMatch.brandMatch) return [];
    return extractImagesFromHtml(html, response.url || page.url, combinedTitle, product);
  } catch {
    return [];
  }
}

async function visualReview(product: Product, imageUrl: string): Promise<VisualReview> {
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
              `Urči pouze identitu a použitelnost fotografie pro produkt „${product.name}“. `
              + `Značka: ${product.brand || "neuvedena"}. Balení: ${product.quantity_text || "neuvedeno"}. `
              + `product_matches znamená, že jde o správnou značku a produkt; kosmetické nedostatky tuto hodnotu nemění. `
              + `Malá promo nálepka, regál nebo horší pozadí jsou dovoleny pro ruční kontrolu. `
              + `Odmítni jiný produkt, jinou gramáž, obecné logo obchodu, banner, zadní etiketu nebo obrázek tvořený hlavně textem.`,
          },
          { type: "input_image", image_url: imageUrl, detail: "high" },
        ],
      }],
      text: { format: { type: "json_schema", name: "slevao_web_image_review_v2", strict: true, schema } },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Vizuální kontrola selhala: HTTP ${response.status}`);
  const text = responseText(payload);
  if (!text) throw new Error("Vizuální kontrola nevrátila výsledek.");
  return JSON.parse(text) as VisualReview;
}

function accepted(review: VisualReview): boolean {
  return review.product_matches
    && review.front_or_catalog_view
    && !review.hands_or_people
    && !review.back_label_dominant
    && !review.text_dominant
    && review.package_quantity_matches !== false
    && review.quality_score >= 35
    && review.confidence >= 0.58;
}

function reviewTier(review: VisualReview): "clean" | "usable_manual" {
  return review.clean_background && !review.shelf_or_scene && !review.price_or_promo_overlay && review.quality_score >= 74 && review.confidence >= 0.82
    ? "clean"
    : "usable_manual";
}

async function blockedUrls(db: any, productId: string): Promise<Set<string>> {
  const { data } = await db.from("product_image_candidates")
    .select("image_url")
    .eq("product_id", productId)
    .in("status", ["pending", "approved", "rejected", "invalid"]);
  return new Set((data || []).map((row: any) => String(row.image_url || "")).filter(Boolean));
}

async function saveCandidate(db: any, product: Product, candidate: ImageCandidate, review: VisualReview, status: "pending" | "invalid") {
  const tier = status === "pending" ? reviewTier(review) : "rejected";
  const { data, error } = await db.from("product_image_candidates").upsert({
    product_id: product.id,
    image_url: candidate.image_url,
    source_url: candidate.source_url,
    source_domain: candidate.source_domain,
    source_type: "retailer",
    width: null,
    height: null,
    quality_score: Math.max(0, Math.min(100, review.quality_score)),
    match_score: Math.max(0, Math.min(1, review.confidence)),
    has_clean_background: review.clean_background,
    has_text_overlay: review.text_dominant,
    has_price_overlay: review.price_or_promo_overlay,
    status,
    rejection_reason: status === "invalid" ? `Automatická kontrola: ${review.reason}`.slice(0, 500) : null,
    reviewed_at: status === "invalid" ? new Date().toISOString() : null,
    metadata: {
      provider: "exact_product_page_v2",
      extraction: candidate.extraction,
      extraction_score: candidate.score,
      extraction_evidence: candidate.evidence,
      visual_validation: review,
      review_tier: tier,
      validation_version: 3,
    },
  }, { onConflict: "product_id,image_url", ignoreDuplicates: true }).select("id");
  if (error) throw error;
  return Array.isArray(data) ? data.length : 0;
}

async function processProduct(db: any, product: Product) {
  const blocked = await blockedUrls(db, product.id);
  const pages = await searchPages(product);
  const pageResults = await Promise.all(pages.map((page) => pageImages(page, product)));
  const unique = new Map<string, ImageCandidate>();
  for (const candidate of pageResults.flat()) {
    if (blocked.has(candidate.image_url)) continue;
    const previous = unique.get(candidate.image_url);
    if (!previous || candidate.score > previous.score) unique.set(candidate.image_url, candidate);
  }
  const candidates = [...unique.values()].sort((a, b) => b.score - a.score);

  let checked = 0;
  let created = 0;
  let rejected = 0;
  const acceptedRows: any[] = [];
  const errors: string[] = [];

  for (const candidate of candidates) {
    if (checked >= MAX_VISUAL_CHECKS || created >= MAX_ACCEPTED) break;
    checked++;
    try {
      const review = await visualReview(product, candidate.image_url);
      if (accepted(review)) {
        created += await saveCandidate(db, product, candidate, review, "pending");
        acceptedRows.push({ image_url: candidate.image_url, source_url: candidate.source_url, tier: reviewTier(review), extraction: candidate.extraction });
      } else {
        await saveCandidate(db, product, candidate, review, "invalid");
        rejected++;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  await db.from("products").update({ image_checked_at: new Date().toISOString() }).eq("id", product.id);
  return {
    product_id: product.id,
    name: product.name,
    pages_found: pages.length,
    images_found: candidates.length,
    checked,
    created,
    rejected,
    errors,
    accepted: acceptedRows,
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
    const inputIds = Array.isArray(body.product_ids) ? body.product_ids : body.product_id ? [body.product_id] : [];
    const productIds = [...new Set(inputIds.map((value: unknown) => String(value || "").trim()).filter(Boolean))].slice(0, MAX_PRODUCTS);
    if (!productIds.length) return json({ ok: false, error: "Chybí product_ids." }, 400);

    const { data: products, error } = await db.from("products")
      .select("id,name,brand,ean,quantity_text")
      .in("id", productIds);
    if (error) throw error;

    const results = [];
    for (const product of (products || []) as Product[]) results.push(await processProduct(db, product));

    return json({
      ok: true,
      checked: results.length,
      created: results.reduce((sum, row) => sum + row.created, 0),
      rejected: results.reduce((sum, row) => sum + row.rejected, 0),
      images_found: results.reduce((sum, row) => sum + row.images_found, 0),
      errors: results.reduce((sum, row) => sum + row.errors.length, 0),
      extraction: "json_ld_img_alt_gallery_embedded_json_meta_last",
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, message === "Unauthorized" ? 401 : 500);
  }
});
