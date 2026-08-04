import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
const OPENAI_MODEL = Deno.env.get("OPENAI_MODEL") || "gpt-5-mini";
const MAX_PRODUCTS = 10;
const MAX_PAGES_PER_PRODUCT = 4;
const MAX_IMAGES_PER_PRODUCT = 6;
const MAX_ACCEPTED_PER_PRODUCT = 2;

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

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function validImageUrl(value: unknown): value is string {
  return validHttpsUrl(value)
    && !/placeholder|no[-_ ]?image|default-image|favicon|sprite|(?:^|[\/_-])logo(?:[\/_.-]|$)/i.test(value)
    && !/\.svg(?:\?|$)/i.test(value);
}

function domainOf(value: unknown): string | null {
  try {
    return new URL(String(value)).hostname;
  } catch {
    return null;
  }
}

function absoluteUrl(value: string, base: string): string | null {
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value, base);
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
        `Najdi přesné webové stránky pro produkt „${product.name}“. `
        + `Značka: ${product.brand || "neuvedena"}. Balení: ${product.quantity_text || "neuvedeno"}. EAN: ${product.ean || "neuveden"}. `
        + `Vrať maximálně čtyři HTTPS stránky, ze kterých lze získat hlavní fotografii přesně tohoto produktu. `
        + `Upřednostni oficiální web výrobce, český web výrobce, oficiální stránku supermarketu nebo spolehlivou databázi produktů. `
        + `Nevracej sociální sítě, diskuse, obecné články, vyhledávače, srovnávače cen ani marketplace, pokud existuje lepší zdroj. `
        + `Jinou gramáž nebo jinou variantu produktu neuváděj. Pokud přesnou stránku nenajdeš, vrať prázdné pages.`,
      text: {
        format: {
          type: "json_schema",
          name: "slevao_product_pages",
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
    .slice(0, MAX_PAGES_PER_PRODUCT);
}

function extractImagesFromHtml(html: string, pageUrl: string): string[] {
  const images: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const absolute = absoluteUrl(value, pageUrl);
    if (!absolute || !validImageUrl(absolute) || seen.has(absolute)) return;
    seen.add(absolute);
    images.push(absolute);
  };

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = (htmlAttribute(tag, "property") || htmlAttribute(tag, "name")).toLowerCase();
    if (["og:image", "og:image:secure_url", "twitter:image", "twitter:image:src"].includes(key)) {
      add(htmlAttribute(tag, "content"));
    }
  }

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (/\bimage_src\b/i.test(htmlAttribute(tag, "rel"))) add(htmlAttribute(tag, "href"));
  }

  for (const match of html.matchAll(/"image"\s*:\s*(?:"([^"]+)"|\[\s*"([^"]+)")/gi)) {
    add(match[1] || match[2] || "");
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const className = `${htmlAttribute(tag, "class")} ${htmlAttribute(tag, "id")} ${htmlAttribute(tag, "itemprop")}`;
    if (!/product|main|primary|hero|detail|gallery/i.test(className)) continue;
    const srcset = htmlAttribute(tag, "srcset").split(",").pop()?.trim().split(/\s+/)[0] || "";
    add(htmlAttribute(tag, "src") || htmlAttribute(tag, "data-src") || srcset);
  }

  return images.slice(0, MAX_IMAGES_PER_PRODUCT);
}

async function pageImages(page: SearchPage): Promise<Array<{ image: string; page: SearchPage }>> {
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
      return [{ image: response.url, page: { ...page, url: response.url } }];
    }
    if (!contentType.includes("text/html")) return [];
    const html = await response.text();
    return extractImagesFromHtml(html.slice(0, 3_000_000), response.url || page.url)
      .map((image) => ({ image, page: { ...page, url: response.url || page.url } }));
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
              `Posuď obrázek pro produkt „${product.name}“. Značka: ${product.brand || "neuvedena"}. `
              + `Balení: ${product.quantity_text || "neuvedeno"}. `
              + `Přijmi správný produkt dobře viditelný zepředu. Horší pozadí nebo regál je dovoleno pro ruční kontrolu. `
              + `Odmítni jiný produkt, jinou variantu nebo gramáž, zadní etiketu, obrázek tvořený hlavně textem, cenovku, reklamní banner `
              + `nebo fotografii, kde ruka či člověk produkt zakrývá. U ovoce, zeleniny, masa a pečiva přijmi odpovídající čistou ilustrační fotografii.`,
          },
          { type: "input_image", image_url: imageUrl, detail: "high" },
        ],
      }],
      text: { format: { type: "json_schema", name: "slevao_web_image_review", strict: true, schema } },
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
    && !review.price_or_promo_overlay
    && !review.text_dominant
    && review.package_quantity_matches !== false
    && review.quality_score >= 50
    && review.confidence >= 0.6;
}

function reviewTier(review: VisualReview): "clean" | "usable_manual" {
  return review.clean_background && !review.shelf_or_scene && review.quality_score >= 74 && review.confidence >= 0.82
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

async function saveCandidate(
  db: any,
  product: Product,
  imageUrl: string,
  page: SearchPage,
  review: VisualReview,
  status: "pending" | "invalid",
) {
  const tier = status === "pending" ? reviewTier(review) : "rejected";
  const { data, error } = await db.from("product_image_candidates").upsert({
    product_id: product.id,
    image_url: imageUrl,
    source_url: page.url,
    source_domain: domainOf(page.url) || domainOf(imageUrl),
    source_type: "official_catalog",
    width: null,
    height: null,
    quality_score: Math.max(0, Math.min(100, review.quality_score)),
    match_score: Math.max(0, Math.min(1, review.confidence)),
    has_clean_background: review.clean_background,
    has_text_overlay: review.text_dominant,
    has_price_overlay: review.price_or_promo_overlay,
    status,
    rejection_reason: status === "invalid" ? `Webová kontrola: ${review.reason}`.slice(0, 500) : null,
    reviewed_at: status === "invalid" ? new Date().toISOString() : null,
    metadata: {
      provider: "openai_web_search",
      source_page_title: page.title,
      source_kind: page.source_kind,
      visual_validation: review,
      review_tier: tier,
      validation_version: 2,
    },
  }, { onConflict: "product_id,image_url", ignoreDuplicates: true }).select("id");
  if (error) throw error;
  return Array.isArray(data) ? data.length : 0;
}

async function processProduct(db: any, product: Product) {
  const pages = await searchPages(product);
  const blocked = await blockedUrls(db, product.id);
  const candidates: Array<{ image: string; page: SearchPage }> = [];
  const seen = new Set<string>();

  for (const result of await Promise.all(pages.map(pageImages))) {
    for (const candidate of result) {
      if (seen.has(candidate.image) || blocked.has(candidate.image)) continue;
      seen.add(candidate.image);
      candidates.push(candidate);
      if (candidates.length >= MAX_IMAGES_PER_PRODUCT) break;
    }
    if (candidates.length >= MAX_IMAGES_PER_PRODUCT) break;
  }

  let created = 0;
  let rejected = 0;
  let checked = 0;
  let error: string | null = null;
  const acceptedImages: string[] = [];

  for (const candidate of candidates) {
    if (created >= MAX_ACCEPTED_PER_PRODUCT || checked >= MAX_IMAGES_PER_PRODUCT) break;
    checked++;
    try {
      const review = await visualReview(product, candidate.image);
      if (accepted(review)) {
        created += await saveCandidate(db, product, candidate.image, candidate.page, review, "pending");
        acceptedImages.push(candidate.image);
      } else {
        await saveCandidate(db, product, candidate.image, candidate.page, review, "invalid");
        rejected++;
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
      continue;
    }
  }

  await db.from("products").update({ image_checked_at: new Date().toISOString() }).eq("id", product.id);
  return {
    product_id: product.id,
    name: product.name,
    pages_found: pages.length,
    images_found: candidates.length,
    visual_checks: checked,
    created,
    rejected,
    error,
    accepted_images: acceptedImages,
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
    const requestedIds = Array.isArray(body.product_ids)
      ? [...new Set<string>(body.product_ids.map((id: unknown) => String(id)).filter((id: string) => /^[0-9a-f-]{36}$/i.test(id)))]
      : [];
    const productId = typeof body.product_id === "string" && /^[0-9a-f-]{36}$/i.test(body.product_id)
      ? body.product_id
      : "";
    const ids = (productId ? [productId] : requestedIds).slice(0, MAX_PRODUCTS);

    let query = db.from("products").select("id,name,brand,ean,quantity_text");
    if (ids.length) {
      query = query.in("id", ids);
    } else {
      const { data: missing, error: missingError } = await db.from("products_missing_verified_images")
        .select("id")
        .gt("active_offer_count", 0)
        .order("image_checked_at", { ascending: true, nullsFirst: true })
        .limit(MAX_PRODUCTS);
      if (missingError) throw missingError;
      const missingIds = (missing || []).map((row: any) => row.id);
      if (!missingIds.length) return json({ ok: true, checked: 0, created: 0, results: [] });
      query = query.in("id", missingIds);
    }

    const { data: products, error } = await query.limit(MAX_PRODUCTS);
    if (error) throw error;
    const rows = (products || []) as Product[];
    const results: Record<string, unknown>[] = [];

    for (const product of rows) {
      results.push(await processProduct(db, product));
    }

    const created = results.reduce((sum, row: any) => sum + Number(row.created || 0), 0);
    const rejected = results.reduce((sum, row: any) => sum + Number(row.rejected || 0), 0);
    const imagesFound = results.reduce((sum, row: any) => sum + Number(row.images_found || 0), 0);
    const errors = results.filter((row: any) => row.error).length;

    return json({
      ok: true,
      checked: results.length,
      created,
      rejected,
      images_found: imagesFound,
      errors,
      mode: "web_fallback_manual_review",
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, message === "Unauthorized" ? 401 : 500);
  }
});
