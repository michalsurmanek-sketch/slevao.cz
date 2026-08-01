import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

function quantityKeys(value: unknown): Set<string> {
  const found = String(value ?? "").toLowerCase().match(/\d+(?:[.,]\d+)?\s*(?:kg|g|ml|l|ks)\b/g) ?? [];
  return new Set(found.map((x) => x.replace(/\s+/g, "").replace(",", ".")));
}

function hasStrongBrandQuantityMatch(expected: unknown, actual: unknown): boolean {
  const expectedTokens = tokens(expected);
  const actualTokens = tokens(actual);
  let common = 0;
  for (const token of expectedTokens) if (actualTokens.has(token)) common++;
  const expectedQuantities = quantityKeys(expected);
  const actualQuantities = quantityKeys(actual);
  const sameQuantity = [...expectedQuantities].some((x) => actualQuantities.has(x));
  return common >= 2 && sameQuantity;
}

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local")) return true;
  if (/^(127\.|10\.|0\.|169\.254\.|192\.168\.)/.test(h)) return true;
  const m = h.match(/^172\.(\d+)\./);
  return !!m && Number(m[1]) >= 16 && Number(m[1]) <= 31;
}

function absoluteUrl(value: string | null | undefined, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, base);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function canonicalTescoUrl(url: URL): URL | null {
  if (url.hostname.toLowerCase() !== "nakup.itesco.cz") return null;
  const productId = url.pathname.match(/\/products\/(\d+)/)?.[1];
  return productId ? new URL(`https://nakup.itesco.cz/groceries/cs-CZ/products/${productId}`) : null;
}

function metaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) return m[1].replace(/&amp;/g, "&");
  }
  return null;
}

function jsonLdProducts(html: string): any[] {
  const results: any[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const item = queue.shift();
        if (!item || typeof item !== "object") continue;
        if (item["@graph"] && Array.isArray(item["@graph"])) queue.push(...item["@graph"]);
        const type = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
        if (type.some((x: unknown) => String(x).toLowerCase() === "product")) results.push(item);
      }
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return results;
}

function imageFromJsonLd(item: any, base: string): string | null {
  const image = Array.isArray(item?.image) ? item.image[0] : item?.image;
  if (typeof image === "string") return absoluteUrl(image, base);
  if (image && typeof image === "object") return absoluteUrl(image.url || image.contentUrl, base);
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Chybí Supabase secrets.");

    const authHeader = req.headers.get("Authorization") || "";
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await db.auth.getUser(token);
    if (userError || !userData.user) return new Response(JSON.stringify({ ok: false, error: "Nepřihlášený uživatel." }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    const role = userData.user.app_metadata?.role;
    if (!['admin', 'editor'].includes(role)) return new Response(JSON.stringify({ ok: false, error: "Nedostatečné oprávnění." }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });

    const body = await req.json().catch(() => ({}));
    const productId = String(body?.product_id ?? "");
    const pageUrl = String(body?.page_url ?? "");
    if (!productId || !pageUrl) throw new Error("Chybí product_id nebo page_url.");

    const target = new URL(pageUrl);
    if (target.protocol !== "https:" || isPrivateHost(target.hostname)) throw new Error("Povolené jsou pouze veřejné HTTPS adresy.");

    const { data: product, error: productError } = await db.from("products").select("id,name,brand,quantity_text,ean").eq("id", productId).single();
    if (productError || !product) throw new Error("Produkt nebyl nalezen.");

    const expected = `${product.brand ?? ""} ${product.name} ${product.quantity_text ?? ""}`;
    const fetchTarget = canonicalTescoUrl(target) ?? target;
    const response = await fetch(fetchTarget, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/json",
        "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.7",
        "Referer": canonicalTescoUrl(target) ? "https://nakup.itesco.cz/" : target.origin + "/",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Produktová stránka vrátila HTTP ${response.status}.`);
    const contentType = response.headers.get("content-type") || "";
    let best: any = null;
    if (contentType.toLowerCase().startsWith("image/")) {
      best = { image: response.url, title: expected, source: "staff_direct_image", score: 1 };
    } else {
      if (!contentType.includes("text/html")) throw new Error("Odkaz nevede na HTML produktovou stránku ani obrázek.");
      const html = await response.text();
      if (html.length > 3_000_000) throw new Error("Produktová stránka je příliš velká.");
      const candidates: { image: string; title: string; source: string }[] = [];
      for (const item of jsonLdProducts(html)) {
        const image = imageFromJsonLd(item, response.url);
        const title = String(item?.name ?? "");
        if (image) candidates.push({ image, title, source: "json_ld" });
      }
      const ogImage = absoluteUrl(metaContent(html, "og:image"), response.url);
      const ogTitle = metaContent(html, "og:title") || metaContent(html, "twitter:title") || "";
      if (ogImage) candidates.push({ image: ogImage, title: ogTitle, source: "open_graph" });
      const unique = [...new Map(candidates.map((x) => [x.image, x])).values()];
      if (!unique.length) throw new Error("Na stránce nebyla nalezena produktová fotografie.");
      for (const candidate of unique) {
        const score = similarity(expected, candidate.title || html.slice(0, 3000));
        if (!best || score > best.score) best = { ...candidate, score };
      }
      const strongIdentity = best ? hasStrongBrandQuantityMatch(expected, best.title) : false;
      if (!best || (best.score < 0.42 && !strongIdentity)) throw new Error("Název produktové stránky se dostatečně neshoduje s produktem.");
      if (strongIdentity) best.score = Math.max(best.score, 0.72);
    }

    let width: number | null = null;
    let height: number | null = null;
    let mimeType: string | null = null;
    let fileSize: number | null = null;
    try {
      const imageResponse = await fetch(best.image, { method: "HEAD", redirect: "follow", headers: { "User-Agent": "Slevao.cz/1.0" } });
      mimeType = imageResponse.headers.get("content-type");
      fileSize = Number(imageResponse.headers.get("content-length")) || null;
    } catch {
      // Metadata is optional; the administrator still reviews the image.
    }

    const qualityScore = Math.max(70, Math.min(95, Math.round(72 + best.score * 20)));
    const { data: inserted, error: insertError } = await db.from("product_image_candidates").upsert({
      product_id: productId,
      image_url: best.image,
      source_url: response.url,
      source_domain: new URL(response.url).hostname,
      source_type: "retailer",
      width,
      height,
      file_size_bytes: fileSize,
      mime_type: mimeType,
      quality_score: qualityScore,
      match_score: Number(best.score.toFixed(4)),
      has_clean_background: null,
      has_text_overlay: null,
      has_price_overlay: null,
      status: "pending",
      metadata: { extractor: best.source, page_title: best.title || null, expected_name: expected },
    }, { onConflict: "product_id,image_url" }).select("id,image_url,quality_score,match_score").single();
    if (insertError) throw insertError;

    return new Response(JSON.stringify({ ok: true, candidate: inserted }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error?.message ?? error) }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
