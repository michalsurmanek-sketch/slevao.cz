import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Product = {
  id: string;
  name: string;
  brand: string | null;
  ean: string | null;
  quantity_text: string | null;
};

type Provider = { key: string; host: string };
type SourceType = "barcode_database" | "retailer" | "manufacturer" | "unknown";

type Candidate = {
  image_url: string;
  source_url: string;
  source_domain: string;
  source_type: SourceType;
  width: number | null;
  height: number | null;
  quality_score: number;
  match_score: number;
  metadata: Record<string, unknown>;
};

const providers: Provider[] = [
  { key: "open_food_facts", host: "world.openfoodfacts.org" },
  { key: "open_products_facts", host: "world.openproductsfacts.org" },
  { key: "open_beauty_facts", host: "world.openbeautyfacts.org" },
  { key: "open_pet_food_facts", host: "world.openpetfoodfacts.org" },
];

const trustedRetailers = [
  "rohlik.cz", "kosik.cz", "itesco.cz", "tesco.com", "billa.cz", "albert.cz",
  "kaufland.cz", "lidl.cz", "globus.cz", "penny.cz", "makro.cz", "coopclub.cz",
  "dm.cz", "rossmann.cz", "pilulka.cz", "drmax.cz", "alza.cz", "datart.cz",
];

function repairMojibake(value: unknown): string {
  const input = String(value ?? "");
  if (!/[ÃÅÄ]/.test(input)) return input;
  try {
    const bytes = Uint8Array.from([...input].map((char) => char.charCodeAt(0) & 0xff));
    const repaired = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return (repaired.match(/[ÃÅÄ]/g) ?? []).length < (input.match(/[ÃÅÄ]/g) ?? []).length ? repaired : input;
  } catch { return input; }
}

const normalize = (value: unknown) => repairMojibake(value)
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, " ").trim();

const tokens = (value: unknown) => new Set(normalize(value).split(" ").filter((x) => x.length > 1));

function similarity(a: unknown, b: unknown): number {
  const aa = tokens(a), bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common++;
  return common / Math.max(aa.size, bb.size);
}

function productQuery(product: Product): string {
  return [repairMojibake(product.brand), repairMojibake(product.name), repairMojibake(product.quantity_text)]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function imageFromProduct(product: any): string | null {
  return [
    product?.selected_images?.front?.display?.cs,
    product?.selected_images?.front?.display?.en,
    product?.image_front_url,
    product?.image_url,
  ].find((url) => typeof url === "string" && /^https:\/\//i.test(url)) ?? null;
}

function buildFactsCandidate(master: Product, product: any, exactEan: boolean, provider: Provider): Candidate | null {
  const imageUrl = imageFromProduct(product);
  if (!imageUrl) return null;
  const foundName = [product?.product_name_cs, product?.product_name, product?.generic_name_cs].filter(Boolean).map(repairMojibake).join(" ");
  const foundBrand = repairMojibake(product?.brands);
  const nameScore = similarity(productQuery(master), `${foundBrand} ${foundName} ${product?.quantity || ""}`);
  const matchScore = exactEan ? 1 : Math.min(0.99, nameScore);
  if (!exactEan && matchScore < 0.58) return null;
  const width = Number(product?.images?.front?.sizes?.display?.w ?? product?.image_front_width) || null;
  const height = Number(product?.images?.front?.sizes?.display?.h ?? product?.image_front_height) || null;
  const qualityScore = Math.min(100, Math.round((exactEan ? 80 : 64) + (width && height && width >= 500 && height >= 500 ? 12 : 0) + matchScore * 6));
  const code = String(product?.code ?? master.ean ?? "");
  return {
    image_url: imageUrl,
    source_url: `https://${provider.host}/product/${encodeURIComponent(code)}`,
    source_domain: provider.host,
    source_type: "barcode_database",
    width, height, quality_score: qualityScore, match_score: Number(matchScore.toFixed(4)),
    metadata: { provider: provider.key, barcode: product?.code ?? null, product_name: foundName || null, brands: foundBrand || null, quantity: product?.quantity ?? null, exact_ean: exactEan },
  };
}

async function byEan(ean: string, provider: Provider): Promise<any | null> {
  try {
    const response = await fetch(`https://${provider.host}/api/v2/product/${encodeURIComponent(ean)}.json`, { headers: { "User-Agent": "Slevao.cz/1.3" } });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.status === 1 ? data.product : null;
  } catch { return null; }
}

async function byName(product: Product, provider: Provider): Promise<any[]> {
  try {
    const url = new URL(`https://${provider.host}/cgi/search.pl`);
    url.searchParams.set("search_terms", productQuery(product));
    url.searchParams.set("search_simple", "1");
    url.searchParams.set("action", "process");
    url.searchParams.set("json", "1");
    url.searchParams.set("page_size", "10");
    url.searchParams.set("fields", "code,product_name,product_name_cs,generic_name_cs,brands,quantity,image_url,image_front_url,image_front_width,image_front_height,selected_images,images");
    const response = await fetch(url, { headers: { "User-Agent": "Slevao.cz/1.3" } });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.products) ? data.products : [];
  } catch { return []; }
}

function decodeHtml(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function trustedDomain(host: string): boolean {
  const clean = host.toLowerCase().replace(/^www\./, "");
  return trustedRetailers.some((domain) => clean === domain || clean.endsWith(`.${domain}`));
}

async function bingImageCandidates(master: Product): Promise<Candidate[]> {
  try {
    const exact = productQuery(master);
    const query = `\"${exact}\" produkt fotografie`;
    const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5",
      },
    });
    if (!response.ok) return [];
    const html = await response.text();
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    const matches = html.matchAll(/\bm="([^"]+)"/g);
    for (const match of matches) {
      try {
        const data = JSON.parse(decodeHtml(match[1]));
        const imageUrl = String(data?.murl || "");
        const pageUrl = String(data?.purl || "");
        const title = String(data?.t || data?.desc || "");
        if (!/^https:\/\//i.test(imageUrl) || !/^https:\/\//i.test(pageUrl) || seen.has(imageUrl)) continue;
        const pageHost = new URL(pageUrl).hostname;
        if (!trustedDomain(pageHost)) continue;
        const score = similarity(exact, `${title} ${pageUrl}`);
        if (score < 0.38) continue;
        const width = Number(data?.w) || null;
        const height = Number(data?.h) || null;
        if (width && height && (width < 300 || height < 300)) continue;
        seen.add(imageUrl);
        candidates.push({
          image_url: imageUrl,
          source_url: pageUrl,
          source_domain: pageHost,
          source_type: "retailer",
          width,
          height,
          quality_score: Math.min(92, Math.round(68 + score * 18 + (width && height && width >= 600 && height >= 600 ? 8 : 0))),
          match_score: Number(Math.min(0.98, score).toFixed(4)),
          metadata: { provider: "bing_images_trusted_retailers", search_query: exact, result_title: title },
        });
        if (candidates.length >= 3) break;
      } catch { /* ignore malformed result */ }
    }
    return candidates;
  } catch { return []; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Chybí Supabase secrets.");
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body?.limit ?? 30), 100));
    const productId = typeof body?.product_id === "string" ? body.product_id.trim() : "";
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    let query = db.from("products_missing_verified_images")
      .select("id,name,brand,ean,quantity_text,active_offer_count,last_offer_at")
      .gt("active_offer_count", 0);
    if (productId) query = query.eq("id", productId);
    else query = query.order("active_offer_count", { ascending: false }).order("last_offer_at", { ascending: false, nullsFirst: false });
    const { data: products, error } = await query.limit(productId ? 1 : limit);
    if (error) throw error;
    if (productId && !(products ?? []).length) throw new Error("Vybraný produkt nebyl nalezen nebo už má ověřenou fotografii.");

    let checked = 0, created = 0, withoutMatch = 0;
    const results: Record<string, unknown>[] = [];

    for (const master of (products ?? []) as Product[]) {
      checked++;
      const found: Candidate[] = [];
      const seenImages = new Set<string>();
      const add = (candidate: Candidate | null) => {
        if (candidate && !seenImages.has(candidate.image_url) && found.length < 3) {
          seenImages.add(candidate.image_url); found.push(candidate);
        }
      };
      const cleanEan = master.ean?.replace(/\D/g, "") ?? "";
      if (/^\d{8,14}$/.test(cleanEan)) {
        for (const provider of providers) { add(buildFactsCandidate(master, await byEan(cleanEan, provider), true, provider)); if (found.length >= 3) break; }
      }
      if (found.length < 3) {
        for (const provider of providers) {
          for (const hit of await byName(master, provider)) add(buildFactsCandidate(master, hit, false, provider));
          if (found.length >= 3) break;
        }
      }
      if (found.length < 3) for (const candidate of await bingImageCandidates(master)) add(candidate);

      if (!found.length) {
        withoutMatch++;
        results.push({ product_id: master.id, name: repairMojibake(master.name), status: "not_found", searched: productQuery(master) });
        continue;
      }
      let productCreated = 0;
      for (const candidate of found) {
        const { error: insertError } = await db.from("product_image_candidates").upsert({
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
        }, { onConflict: "product_id,image_url", ignoreDuplicates: true });
        if (!insertError) { created++; productCreated++; }
      }
      results.push({ product_id: master.id, name: repairMojibake(master.name), status: "candidates", count: productCreated, candidates: found });
    }

    return new Response(JSON.stringify({ ok: true, checked, created, without_match: withoutMatch, product_id: productId || null, providers: [...providers.map((p) => p.key), "bing_images_trusted_retailers"], results }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error?.message ?? error) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
