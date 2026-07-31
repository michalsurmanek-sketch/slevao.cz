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
  source_url: string;
  source_domain: string;
  width: number | null;
  height: number | null;
  quality_score: number;
  match_score: number;
  metadata: Record<string, unknown>;
};

const normalize = (value: unknown) => String(value ?? "")
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

function buildCandidate(master: Product, product: any, exactEan: boolean): Candidate | null {
  const imageUrl = imageFromProduct(product);
  if (!imageUrl) return null;

  const foundName = [product?.product_name_cs, product?.product_name, product?.generic_name_cs]
    .filter(Boolean).join(" ");
  const foundBrand = String(product?.brands ?? "");
  const nameScore = similarity(`${master.brand ?? ""} ${master.name}`, `${foundBrand} ${foundName}`);
  const quantityScore = master.quantity_text ? similarity(master.quantity_text, product?.quantity) : 1;
  const matchScore = exactEan ? 1 : Math.min(0.99, nameScore * 0.88 + quantityScore * 0.12);

  if (!exactEan && matchScore < 0.68) return null;

  const width = Number(product?.images?.front?.sizes?.display?.w ?? product?.image_front_width) || null;
  const height = Number(product?.images?.front?.sizes?.display?.h ?? product?.image_front_height) || null;
  const resolutionBonus = width && height && width >= 500 && height >= 500 ? 15 : 0;
  const qualityScore = Math.min(100, Math.round((exactEan ? 78 : 62) + resolutionBonus + matchScore * 7));

  return {
    image_url: imageUrl,
    source_url: `https://world.openfoodfacts.org/product/${encodeURIComponent(String(product?.code ?? master.ean ?? ""))}`,
    source_domain: "openfoodfacts.org",
    width,
    height,
    quality_score: qualityScore,
    match_score: Number(matchScore.toFixed(4)),
    metadata: {
      provider: "open_food_facts",
      barcode: product?.code ?? null,
      product_name: foundName || null,
      brands: foundBrand || null,
      quantity: product?.quantity ?? null,
      exact_ean: exactEan,
    },
  };
}

async function byEan(ean: string): Promise<any | null> {
  const response = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json`, {
    headers: { "User-Agent": "Slevao.cz/1.0 (product image review)" },
  });
  if (!response.ok) return null;
  const data = await response.json();
  return data?.status === 1 ? data.product : null;
}

async function byName(product: Product): Promise<any[]> {
  const query = [product.brand, product.name, product.quantity_text].filter(Boolean).join(" ");
  const url = new URL("https://world.openfoodfacts.org/cgi/search.pl");
  url.searchParams.set("search_terms", query);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", "8");
  url.searchParams.set("fields", "code,product_name,product_name_cs,generic_name_cs,brands,quantity,image_url,image_front_url,image_front_width,image_front_height,selected_images,images");
  const response = await fetch(url, { headers: { "User-Agent": "Slevao.cz/1.0 (product image review)" } });
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data?.products) ? data.products : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Chybí Supabase secrets.");

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(Number(body?.limit ?? 30), 100));
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: products, error } = await db
      .from("products_missing_verified_images")
      .select("id,name,brand,ean,quantity_text,active_offer_count,last_offer_at")
      .gt("active_offer_count", 0)
      .order("active_offer_count", { ascending: false })
      .order("last_offer_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw error;

    let checked = 0;
    let created = 0;
    let withoutMatch = 0;
    const results: Record<string, unknown>[] = [];

    for (const master of (products ?? []) as Product[]) {
      checked++;
      const found: Candidate[] = [];

      if (master.ean && /^\d{8,14}$/.test(master.ean.replace(/\D/g, ""))) {
        const hit = await byEan(master.ean.replace(/\D/g, ""));
        const candidate = hit ? buildCandidate(master, hit, true) : null;
        if (candidate) found.push(candidate);
      }

      if (!found.length) {
        const hits = await byName(master);
        for (const hit of hits) {
          const candidate = buildCandidate(master, hit, false);
          if (candidate) found.push(candidate);
          if (found.length >= 3) break;
        }
      }

      if (!found.length) {
        withoutMatch++;
        results.push({ product_id: master.id, name: master.name, status: "not_found" });
        continue;
      }

      for (const candidate of found) {
        const { error: insertError } = await db.from("product_image_candidates").upsert({
          product_id: master.id,
          image_url: candidate.image_url,
          source_url: candidate.source_url,
          source_domain: candidate.source_domain,
          source_type: "barcode_database",
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
        if (!insertError) created++;
      }
      results.push({ product_id: master.id, name: master.name, status: "candidates", count: found.length });
    }

    return new Response(JSON.stringify({ ok: true, checked, created, without_match: withoutMatch, results }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error?.message ?? error) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
