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

type Candidate = {
  image_url: string;
  source_url: string | null;
  source_domain: string | null;
  source_type: "retailer" | "official_catalog" | "barcode_database" | "unknown";
  width: number | null;
  height: number | null;
  quality_score: number;
  match_score: number;
  metadata: Record<string, unknown>;
};

const providers = [
  { key: "open_food_facts", host: "world.openfoodfacts.org" },
  { key: "open_products_facts", host: "world.openproductsfacts.org" },
  { key: "open_beauty_facts", host: "world.openbeautyfacts.org" },
  { key: "open_pet_food_facts", host: "world.openpetfoodfacts.org" },
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

function domainOf(url: unknown): string | null {
  try { return new URL(String(url)).hostname; } catch { return null; }
}

function validImageUrl(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\//i.test(value) && !/placeholder|no[-_ ]?image|default-image/i.test(value);
}

async function existingCandidates(db: any, master: Product): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const seen = new Set<string>();
  const add = (url: unknown, source: string, score: number, sourceUrl: unknown = null) => {
    if (!validImageUrl(url) || seen.has(url) || found.length >= 3) return;
    seen.add(url);
    found.push({
      image_url: url,
      source_url: typeof sourceUrl === "string" ? sourceUrl : null,
      source_domain: domainOf(sourceUrl) || domainOf(url),
      source_type: source === "products" ? "official_catalog" : "retailer",
      width: null,
      height: null,
      quality_score: score,
      match_score: 1,
      metadata: { provider: `slevao_${source}`, exact_product_id: true },
    });
  };

  const { data: productRow } = await db.from("products")
    .select("image_url,image_source")
    .eq("id", master.id)
    .maybeSingle();
  add(productRow?.image_url, "products", 88, productRow?.image_source);

  const { data: offers } = await db.from("offers")
    .select("image_url,published_at,stores(name,slug)")
    .eq("product_id", master.id)
    .not("image_url", "is", null)
    .order("published_at", { ascending: false })
    .limit(20);
  for (const row of offers || []) add(row.image_url, "offers", 84, null);

  const { data: imports } = await db.from("leaflet_import_items")
    .select("image_url,created_at")
    .eq("product_id", master.id)
    .not("image_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(20);
  for (const row of imports || []) add(row.image_url, "leaflet_import_items", 78, null);

  return found;
}

function imageFromFacts(product: any): string | null {
  return [product?.selected_images?.front?.display?.cs, product?.selected_images?.front?.display?.en, product?.image_front_url, product?.image_url]
    .find((url) => validImageUrl(url)) ?? null;
}

async function factsCandidates(master: Product): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const seen = new Set<string>();
  const cleanEan = master.ean?.replace(/\D/g, "") ?? "";
  for (const provider of providers) {
    let products: any[] = [];
    try {
      if (/^\d{8,14}$/.test(cleanEan)) {
        const r = await fetch(`https://${provider.host}/api/v2/product/${encodeURIComponent(cleanEan)}.json`, { headers: { "User-Agent": "Slevao.cz/1.4" } });
        const data = r.ok ? await r.json() : null;
        if (data?.status === 1 && data.product) products = [data.product];
      }
      if (!products.length) {
        const url = new URL(`https://${provider.host}/cgi/search.pl`);
        url.searchParams.set("search_terms", productQuery(master));
        url.searchParams.set("search_simple", "1");
        url.searchParams.set("action", "process");
        url.searchParams.set("json", "1");
        url.searchParams.set("page_size", "8");
        url.searchParams.set("fields", "code,product_name,product_name_cs,generic_name_cs,brands,quantity,image_url,image_front_url,image_front_width,image_front_height,selected_images");
        const r = await fetch(url, { headers: { "User-Agent": "Slevao.cz/1.4" } });
        const data = r.ok ? await r.json() : null;
        products = Array.isArray(data?.products) ? data.products : [];
      }
    } catch { products = []; }

    for (const product of products) {
      const image = imageFromFacts(product);
      if (!image || seen.has(image)) continue;
      const exactEan = cleanEan && String(product?.code || "").replace(/\D/g, "") === cleanEan;
      const foundText = [product?.brands, product?.product_name_cs, product?.product_name, product?.quantity].filter(Boolean).join(" ");
      const match = exactEan ? 1 : similarity(productQuery(master), foundText);
      if (!exactEan && match < 0.58) continue;
      seen.add(image);
      found.push({
        image_url: image,
        source_url: `https://${provider.host}/product/${encodeURIComponent(String(product?.code || cleanEan))}`,
        source_domain: provider.host,
        source_type: "barcode_database",
        width: Number(product?.image_front_width) || null,
        height: Number(product?.image_front_height) || null,
        quality_score: exactEan ? 92 : Math.round(68 + match * 18),
        match_score: Number(match.toFixed(4)),
        metadata: { provider: provider.key, exact_ean: exactEan, product_name: foundText },
      });
      if (found.length >= 3) return found;
    }
  }
  return found;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Chybí Supabase secrets.");

    const body = await req.json().catch(() => ({}));
    const productId = typeof body?.product_id === "string" ? body.product_id.trim() : "";
    const limit = Math.max(1, Math.min(Number(body?.limit ?? 30), 100));
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    let query = db.from("products_missing_verified_images")
      .select("id,name,brand,ean,quantity_text,active_offer_count,last_offer_at")
      .gt("active_offer_count", 0);
    if (productId) query = query.eq("id", productId);
    else query = query.order("active_offer_count", { ascending: false }).order("last_offer_at", { ascending: false, nullsFirst: false });
    const { data: products, error } = await query.limit(productId ? 1 : limit);
    if (error) throw error;
    if (productId && !(products || []).length) throw new Error("Vybraný produkt nebyl nalezen nebo už má ověřenou fotografii.");

    let checked = 0, created = 0, withoutMatch = 0;
    const results: Record<string, unknown>[] = [];

    for (const master of (products || []) as Product[]) {
      checked++;
      const found: Candidate[] = [];
      const seen = new Set<string>();
      const addMany = (rows: Candidate[]) => {
        for (const row of rows) {
          if (!seen.has(row.image_url) && found.length < 3) { seen.add(row.image_url); found.push(row); }
        }
      };

      addMany(await existingCandidates(db, master));
      if (found.length < 3) addMany(await factsCandidates(master));

      if (!found.length) {
        withoutMatch++;
        results.push({ product_id: master.id, name: repairMojibake(master.name), status: "not_found", searched: productQuery(master), sources_checked: ["products", "offers", "leaflet_import_items", ...providers.map(p => p.key)] });
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

    return new Response(JSON.stringify({ ok: true, checked, created, without_match: withoutMatch, product_id: productId || null, sources: ["products", "offers", "leaflet_import_items", ...providers.map(p => p.key)], results }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error?.message ?? error) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
