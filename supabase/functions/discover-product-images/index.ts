import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const KAUFLAND_OFFERS_URL = "https://prodejny.kaufland.cz/nabidka/prehled.html";
const MAX_CANDIDATES_PER_PRODUCT = 3;

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

function quantityTokens(value: unknown): string[] {
  const input = repairMojibake(value).toLowerCase().replace(/,/g, ".");
  return [...new Set([...input.matchAll(/\b(\d+(?:\.\d+)?)\s*(kg|g|l|ml|cl|ks)\b/g)]
    .map((match) => `${Number(match[1])}${match[2]}`))];
}

function matchDetails(left: unknown, right: unknown) {
  const a = significantWords(left);
  const b = significantWords(right);
  if (!a.length || !b.length) return { score: 0, common: 0, containment: false, quantityConflict: false };
  const setB = new Set(b);
  const common = a.filter((word) => setB.has(word)).length;
  const containmentScore = common / Math.min(a.length, b.length);
  const jaccard = common / new Set([...a, ...b]).size;
  const prefixBonus = a[0] === b[0] ? 0.08 : 0;
  const qa = quantityTokens(left);
  const qb = quantityTokens(right);
  const quantityOverlap = qa.some((item) => qb.includes(item));
  const quantityConflict = qa.length > 0 && qb.length > 0 && !quantityOverlap;
  const quantityAdjustment = quantityOverlap ? 0.08 : quantityConflict ? -0.16 : 0;
  const score = Math.max(0, Math.min(1, containmentScore * 0.72 + jaccard * 0.28 + prefixBonus + quantityAdjustment));
  const containment = a.every((word) => setB.has(word)) || b.every((word) => a.includes(word));
  return { score, common, containment, quantityConflict };
}

function productQuery(product: Product): string {
  const cleanName = coreName(product.name);
  const brand = coreName(product.brand || "");
  const query = [brand, cleanName].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return query || repairMojibake(product.name).trim();
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
    && !/placeholder|no[-_ ]?image|default-image|favicon|(?:^|[\/_-])logo(?:[\/_.-]|$)/i.test(value);
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

function kauflandCandidate(master: Product, catalog: CatalogItem[]): Candidate | null {
  if (!catalog.length) return null;
  const query = productQuery(master);
  let best: CatalogItem | null = null;
  let bestDetails = { score: 0, common: 0, containment: false, quantityConflict: false };
  let secondScore = 0;

  for (const item of catalog) {
    const details = matchDetails(query, item.title);
    if (details.score > bestDetails.score) {
      secondScore = bestDetails.score;
      bestDetails = details;
      best = item;
    } else if (details.score > secondScore) {
      secondScore = details.score;
    }
  }

  const uniqueEnough = bestDetails.containment || bestDetails.score - secondScore >= 0.07;
  if (!best || bestDetails.common < 2 || bestDetails.score < 0.72 || bestDetails.quantityConflict || !uniqueEnough) return null;

  return {
    image_url: best.image,
    source_url: best.sourceUrl,
    source_domain: "prodejny.kaufland.cz",
    source_type: "retailer",
    width: null,
    height: null,
    quality_score: Math.round(82 + bestDetails.score * 14),
    match_score: Number(bestDetails.score.toFixed(4)),
    metadata: {
      provider: "official_kaufland_offer_catalog",
      official_retailer: true,
      matched_title: best.title,
      searched_title: query,
      common_words: bestDetails.common,
    },
  };
}

async function existingCandidates(db: any, master: Product): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const seen = new Set<string>();
  const add = (url: unknown, source: string, score: number, sourceUrl: unknown = null, metadata: Record<string, unknown> = {}) => {
    if (!validImageUrl(url) || seen.has(url) || found.length >= MAX_CANDIDATES_PER_PRODUCT) return;
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

  const { data: productRow } = await db.from("products")
    .select("image_url,image_source")
    .eq("id", master.id)
    .maybeSingle();
  add(productRow?.image_url, "products", 88, productRow?.image_source);

  const { data: imports } = await db.from("leaflet_import_items")
    .select("image_url,created_at,source_page,import_id,leaflet_imports(source_document_url)")
    .eq("product_id", master.id)
    .not("image_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(20);
  for (const row of imports || []) {
    const importRow = Array.isArray(row.leaflet_imports) ? row.leaflet_imports[0] : row.leaflet_imports;
    const documentUrl = importRow?.source_document_url || null;
    add(row.image_url, "leaflet_import_items", 86, documentUrl, {
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
    add(row.image_url, "offers", 82, row.image_url, {
      store_name: store?.name || null,
      store_slug: store?.slug || null,
    });
  }

  return found;
}

function imageFromFacts(product: any): string | null {
  return [
    product?.selected_images?.front?.display?.cs,
    product?.selected_images?.front?.display?.en,
    product?.image_front_url,
    product?.image_url,
  ].find((url) => validImageUrl(url)) ?? null;
}

async function factsCandidates(master: Product): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const seen = new Set<string>();
  const cleanEan = master.ean?.replace(/\D/g, "") ?? "";
  const query = productQuery(master);

  for (const provider of providers) {
    let products: any[] = [];
    try {
      if (/^\d{8,14}$/.test(cleanEan)) {
        const response = await fetch(`https://${provider.host}/api/v2/product/${encodeURIComponent(cleanEan)}.json`, {
          headers: { "User-Agent": "Slevao.cz/2.0 (https://slevao.cz)" },
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
        url.searchParams.set("page_size", "10");
        url.searchParams.set("fields", "code,product_name,product_name_cs,generic_name_cs,brands,quantity,image_url,image_front_url,image_front_width,image_front_height,selected_images");
        const response = await fetch(url, { headers: { "User-Agent": "Slevao.cz/2.0 (https://slevao.cz)" } });
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
      const foundText = [product?.brands, product?.product_name_cs, product?.product_name, product?.quantity].filter(Boolean).join(" ");
      const details = matchDetails(query, foundText);
      const quantitySafe = !details.quantityConflict;
      if (!exactEan && (details.common < 2 || details.score < 0.6 || !quantitySafe)) continue;
      const productPage = `https://${provider.host}/product/${encodeURIComponent(String(product?.code || cleanEan))}`;
      seen.add(image);
      found.push({
        image_url: image,
        source_url: productPage,
        source_domain: provider.host,
        source_type: "barcode_database",
        width: Number(product?.image_front_width) || null,
        height: Number(product?.image_front_height) || null,
        quality_score: exactEan ? 94 : Math.round(70 + details.score * 18),
        match_score: exactEan ? 1 : Number(details.score.toFixed(4)),
        metadata: {
          provider: provider.key,
          exact_ean: exactEan,
          matched_title: foundText,
          searched_title: query,
          common_words: details.common,
        },
      });
      if (found.length >= MAX_CANDIDATES_PER_PRODUCT) return found;
    }
  }
  return found;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const cronSecret = Deno.env.get("CRON_SECRET") || "";
    if (!supabaseUrl || !serviceKey) throw new Error("Chybí Supabase secrets.");

    const body = await req.json().catch(() => ({}));
    const productId = typeof body?.product_id === "string" ? body.product_id.trim() : "";
    const storeSlug = typeof body?.store_slug === "string" ? normalize(body.store_slug).replace(/\s+/g, "-") : "";
    const limit = Math.max(1, Math.min(Number(body?.limit ?? 30), 100));
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
      storeProductIds = [...new Set((storeOffers || []).map((row: any) => String(row.product_id)).filter(Boolean))];
      if (!storeProductIds.length) {
        return new Response(JSON.stringify({ ok: true, checked: 0, created: 0, without_match: 0, store_slug: storeSlug, results: [] }), {
          headers: { ...cors, "Content-Type": "application/json" },
        });
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
    if (productId && !(products || []).length) throw new Error("Vybraný produkt nebyl nalezen nebo už má ověřenou fotografii.");

    const kauflandCatalog = storeSlug === "kaufland" ? await loadKauflandCatalog() : [];
    let checked = 0;
    let created = 0;
    let withoutMatch = 0;
    let kauflandMatches = 0;
    let factsMatches = 0;
    const results: Record<string, unknown>[] = [];

    for (const master of (products || []) as Product[]) {
      checked++;
      const found: Candidate[] = [];
      const seen = new Set<string>();
      const addMany = (rows: Candidate[]) => {
        for (const row of rows) {
          if (!seen.has(row.image_url) && found.length < MAX_CANDIDATES_PER_PRODUCT) {
            seen.add(row.image_url);
            found.push(row);
          }
        }
      };

      addMany(await existingCandidates(db, master));
      if (storeSlug === "kaufland" && found.length < MAX_CANDIDATES_PER_PRODUCT) {
        const official = kauflandCandidate(master, kauflandCatalog);
        if (official) {
          addMany([official]);
          kauflandMatches++;
        }
      }
      if (found.length < MAX_CANDIDATES_PER_PRODUCT) {
        const facts = await factsCandidates(master);
        if (facts.length) factsMatches++;
        addMany(facts);
      }

      if (!found.length) {
        withoutMatch++;
        await db.from("products").update({ image_checked_at: new Date().toISOString() }).eq("id", master.id);
        results.push({
          product_id: master.id,
          name: repairMojibake(master.name),
          status: "not_found",
          searched: productQuery(master),
          sources_checked: ["products", "leaflet_import_items", "offers", ...(storeSlug === "kaufland" ? ["official_kaufland_offer_catalog"] : []), ...providers.map((provider) => provider.key)],
        });
        continue;
      }

      let productCreated = 0;
      for (const candidate of found) {
        const { data: inserted, error: insertError } = await db.from("product_image_candidates").upsert({
          product_id: master.id,
          image_url: candidate.image_url,
          source_url: candidate.source_url,
          source_domain: candidate.source_domain,
          source_type: candidate.source_type,
          width: candidate.width,
          height: candidate.height,
          quality_score: candidate.quality_score,
          match_score: candidate.match_score,
          has_clean_background: null,
          has_text_overlay: false,
          has_price_overlay: false,
          status: "pending",
          metadata: candidate.metadata,
        }, { onConflict: "product_id,image_url", ignoreDuplicates: true }).select("id");
        if (insertError) {
          console.warn("Candidate insert failed", master.id, insertError.message);
          continue;
        }
        const insertedCount = Array.isArray(inserted) ? inserted.length : 0;
        created += insertedCount;
        productCreated += insertedCount;
      }
      await db.from("products").update({ image_checked_at: new Date().toISOString() }).eq("id", master.id);
      results.push({ product_id: master.id, name: repairMojibake(master.name), status: "candidates", count: productCreated, candidates: found });
    }

    return new Response(JSON.stringify({
      ok: true,
      checked,
      created,
      without_match: withoutMatch,
      kaufland_catalog_items: kauflandCatalog.length,
      kaufland_matches: kauflandMatches,
      facts_matches: factsMatches,
      product_id: productId || null,
      store_slug: storeSlug || null,
      sources: ["products", "leaflet_import_items", "offers", ...(storeSlug === "kaufland" ? ["official_kaufland_offer_catalog"] : []), ...providers.map((provider) => provider.key)],
      results,
    }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String((error as any)?.message ?? error) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
