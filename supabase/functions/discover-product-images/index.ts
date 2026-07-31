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

type Provider = {
  key: string;
  host: string;
  sourceType: "barcode_database";
};

type Candidate = {
  image_url: string;
  source_url: string;
  source_domain: string;
  source_type: "barcode_database";
  width: number | null;
  height: number | null;
  quality_score: number;
  match_score: number;
  metadata: Record<string, unknown>;
};

const providers: Provider[] = [
  { key: "open_food_facts", host: "world.openfoodfacts.org", sourceType: "barcode_database" },
  { key: "open_products_facts", host: "world.openproductsfacts.org", sourceType: "barcode_database" },
  { key: "open_beauty_facts", host: "world.openbeautyfacts.org", sourceType: "barcode_database" },
  { key: "open_pet_food_facts", host: "world.openpetfoodfacts.org", sourceType: "barcode_database" },
];

function repairMojibake(value: unknown): string {
  const input = String(value ?? "");
  if (!/[ÃÅÄ]/.test(input)) return input;
  try {
    const bytes = Uint8Array.from([...input].map((char) => char.charCodeAt(0) & 0xff));
    const repaired = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const before = (input.match(/[ÃÅÄ]/g) ?? []).length;
    const after = (repaired.match(/[ÃÅÄ]/g) ?? []).length;
    return after < before ? repaired : input;
  } catch {
    return input;
  }
}

const normalize = (value: unknown) => repairMojibake(value)
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .trim();

const tokens = (value: unknown) => new Set(normalize(value).split(" ").filter((x) => x.length > 1));

function similarity(a: unknown, b: unknown): number {
  const aa = tokens(a);
  const bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common++;
  return common / Math.max(aa.size, bb.size);
}

function imageFromProduct(product: any): string | null {
  const urls = [
    product?.selected_images?.front?.display?.cs,
    product?.selected_images?.front?.display?.en,
    product?.image_front_url,
    product?.image_url,
  ];
  return urls.find((url) => typeof url === "string" && /^https:\/\//i.test(url)) ?? null;
}

function buildCandidate(master: Product, product: any, exactEan: boolean, provider: Provider): Candidate | null {
  const imageUrl = imageFromProduct(product);
  if (!imageUrl) return null;

  const masterName = repairMojibake(master.name);
  const masterBrand = repairMojibake(master.brand);
  const foundName = [product?.product_name_cs, product?.product_name, product?.generic_name_cs]
    .filter(Boolean).map(repairMojibake).join(" ");
  const foundBrand = repairMojibake(product?.brands);
  const nameScore = similarity(`${masterBrand} ${masterName}`, `${foundBrand} ${foundName}`);
  const quantityScore = master.quantity_text ? similarity(repairMojibake(master.quantity_text), product?.quantity) : 1;
  const matchScore = exactEan ? 1 : Math.min(0.99, nameScore * 0.88 + quantityScore * 0.12);

  if (!exactEan && matchScore < 0.68) return null;

  const width = Number(product?.images?.front?.sizes?.display?.w ?? product?.image_front_width) || null;
  const height = Number(product?.images?.front?.sizes?.display?.h ?? product?.image_front_height) || null;
  const resolutionBonus = width && height && width >= 500 && height >= 500 ? 15 : 0;
  const qualityScore = Math.min(100, Math.round((exactEan ? 78 : 62) + resolutionBonus + matchScore * 7));
  const code = String(product?.code ?? master.ean ?? "");

  return {
    image_url: imageUrl,
    source_url: `https://${provider.host}/product/${encodeURIComponent(code)}`,
    source_domain: provider.host,
    source_type: provider.sourceType,
    width,
    height,
    quality_score: qualityScore,
    match_score: Number(matchScore.toFixed(4)),
    metadata: {
      provider: provider.key,
      barcode: product?.code ?? null,
      product_name: foundName || null,
      brands: foundBrand || null,
      quantity: product?.quantity ?? null,
      exact_ean: exactEan,
      repaired_master_name: masterName,
    },
  };
}

async function byEan(ean: string, provider: Provider): Promise<any | null> {
  try {
    const response = await fetch(`https://${provider.host}/api/v2/product/${encodeURIComponent(ean)}.json`, {
      headers: { "User-Agent": "Slevao.cz/1.2 (product image review)" },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data?.status === 1 ? data.product : null;
  } catch {
    return null;
  }
}

async function byName(product: Product, provider: Provider): Promise<any[]> {
  try {
    const query = [product.brand, product.name, product.quantity_text]
      .filter(Boolean).map(repairMojibake).join(" ");
    const url = new URL(`https://${provider.host}/cgi/search.pl`);
    url.searchParams.set("search_terms", query);
    url.searchParams.set("search_simple", "1");
    url.searchParams.set("action", "process");
    url.searchParams.set("json", "1");
    url.searchParams.set("page_size", "8");
    url.searchParams.set("fields", "code,product_name,product_name_cs,generic_name_cs,brands,quantity,image_url,image_front_url,image_front_width,image_front_height,selected_images,images");
    const response = await fetch(url, { headers: { "User-Agent": "Slevao.cz/1.2 (product image review)" } });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.products) ? data.products : [];
  } catch {
    return [];
  }
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

    let query = db
      .from("products_missing_verified_images")
      .select("id,name,brand,ean,quantity_text,active_offer_count,last_offer_at")
      .gt("active_offer_count", 0);

    if (productId) query = query.eq("id", productId);
    else query = query
      .order("active_offer_count", { ascending: false })
      .order("last_offer_at", { ascending: false, nullsFirst: false });

    const { data: products, error } = await query.limit(productId ? 1 : limit);
    if (error) throw error;
    if (productId && !(products ?? []).length) {
      return new Response(JSON.stringify({ ok: false, error: "Vybraný produkt nebyl nalezen nebo už má ověřenou fotografii." }), {
        status: 404,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let checked = 0;
    let created = 0;
    let withoutMatch = 0;
    const results: Record<string, unknown>[] = [];

    for (const master of (products ?? []) as Product[]) {
      checked++;
      const found: Candidate[] = [];
      const seenImages = new Set<string>();
      const cleanEan = master.ean?.replace(/\D/g, "") ?? "";

      if (/^\d{8,14}$/.test(cleanEan)) {
        for (const provider of providers) {
          const hit = await byEan(cleanEan, provider);
          const candidate = hit ? buildCandidate(master, hit, true, provider) : null;
          if (candidate && !seenImages.has(candidate.image_url)) {
            seenImages.add(candidate.image_url);
            found.push(candidate);
          }
          if (found.length >= 3) break;
        }
      }

      if (!found.length) {
        for (const provider of providers) {
          const hits = await byName(master, provider);
          for (const hit of hits) {
            const candidate = buildCandidate(master, hit, false, provider);
            if (candidate && !seenImages.has(candidate.image_url)) {
              seenImages.add(candidate.image_url);
              found.push(candidate);
            }
            if (found.length >= 3) break;
          }
          if (found.length >= 3) break;
        }
      }

      if (!found.length) {
        withoutMatch++;
        results.push({ product_id: master.id, name: repairMojibake(master.name), original_name: master.name, status: "not_found" });
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
        if (!insertError) {
          created++;
          productCreated++;
        }
      }
      results.push({ product_id: master.id, name: repairMojibake(master.name), status: "candidates", count: productCreated, candidates: found });
    }

    return new Response(JSON.stringify({ ok: true, checked, created, without_match: withoutMatch, product_id: productId || null, providers: providers.map((p) => p.key), results }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error?.message ?? error) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
