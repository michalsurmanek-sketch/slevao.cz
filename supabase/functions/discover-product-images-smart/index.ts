import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "";
const MAX_PRODUCTS = 4;

function json(body: unknown, status = 200) {
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

function validEan(value: unknown): boolean {
  return /^\d{8,14}$/.test(String(value || "").replace(/\D/g, ""));
}

function looksBranded(name: unknown): boolean {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  return first.length >= 3 && /^[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ0-9][A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ0-9&.!'-]+$/.test(first);
}

function priority(row: any): number {
  let score = Number(row.active_offer_count || 0) * 10;
  if (validEan(row.ean)) score += 1000;
  if (String(row.brand || "").trim()) score += 500;
  else if (looksBranded(row.name)) score += 280;
  if (String(row.quantity_text || "").trim()) score += 120;
  const checkedYear = row.image_checked_at ? new Date(row.image_checked_at).getUTCFullYear() : 0;
  if (checkedYear > 2000) score -= 800;
  return score;
}

async function authorize(request: Request, db: any): Promise<string | null> {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (token === SERVICE_ROLE_KEY) return null;
  if (CRON_SECRET && request.headers.get("x-cron-secret") === CRON_SECRET) return null;
  if (!token) throw new Error("Unauthorized");
  const { data, error } = await db.auth.getUser(token);
  const role = String(data.user?.app_metadata?.role || "").toLowerCase();
  if (error || !data.user || !["admin", "editor"].includes(role)) throw new Error("Unauthorized");
  return data.user.id;
}

async function invokeFunction(name: string, body: Record<string, unknown>, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.ok) {
      throw new Error(String(payload?.error || `${name}: HTTP ${response.status}`));
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function preferredStore(slugs: string[], requested: string): string {
  if (requested) return requested;
  const order = ["kaufland", "tesco", "albert", "billa", "penny", "lidl", "globus", "makro"];
  return order.find((slug) => slugs.includes(slug)) || slugs[0] || "";
}

function runInBackground(task: Promise<unknown>) {
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(task);
  else task.catch((error) => console.error("Background image search failed", error));
}

async function processOne(product: any, storeSlug: string) {
  let primary: any = null;
  let fallback: any = null;
  let error: string | null = null;
  try {
    primary = await invokeFunction("discover-product-images", {
      product_id: String(product.id),
      store_slug: storeSlug,
      limit: 1,
    }, 45_000);
    if (Number(primary.created || 0) === 0) {
      fallback = await invokeFunction("discover-product-images-web", {
        product_ids: [String(product.id)],
        store_slug: storeSlug,
      }, 110_000);
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  return {
    product_id: String(product.id),
    name: product.name,
    brand: product.brand,
    quantity_text: product.quantity_text,
    store_slug: storeSlug,
    priority: priority(product),
    primary_created: Number(primary?.created || 0),
    web_created: Number(fallback?.created || 0),
    created: Number(primary?.created || 0) + Number(fallback?.created || 0),
    rejected: Number(primary?.visually_rejected || 0) + Number(fallback?.rejected || 0),
    error,
  };
}

async function processRun(db: any, runId: string, selected: any[], storesByProduct: Map<string, string[]>, requestedStore: string) {
  try {
    await db.from("product_image_search_runs").update({
      status: "processing",
      started_at: new Date().toISOString(),
      message: "Hledání fotografií běží na serveru.",
      updated_at: new Date().toISOString(),
    }).eq("id", runId);

    const results = await Promise.all(selected.map((product) =>
      processOne(product, preferredStore(storesByProduct.get(String(product.id)) || [], requestedStore))
    ));

    const created = results.reduce((sum, row) => sum + row.created, 0);
    const rejected = results.reduce((sum, row) => sum + row.rejected, 0);
    const errors = results.filter((row) => row.error).length;

    await db.from("product_image_search_runs").update({
      status: "completed",
      processed_count: results.length,
      created_count: created,
      rejected_count: rejected,
      error_count: errors,
      message: created
        ? `Nalezeno ${created} fotografií ke schválení.`
        : "Pro vybrané produkty nebyla nalezena bezpečná fotografie.",
      results,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", runId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from("product_image_search_runs").update({
      status: "failed",
      message: message.slice(0, 1000),
      error_count: 1,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", runId);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json({ ok: false, error: "Chybí serverové secrets." }, 500);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const requestedBy = await authorize(request, db);
    const body = await request.json().catch(() => ({}));
    const requestedStore = normalize(body.store_slug || "").replace(/\s+/g, "-");
    const limit = Math.max(1, Math.min(Number(body.limit || MAX_PRODUCTS), MAX_PRODUCTS));
    const today = new Date().toISOString().slice(0, 10);

    let allowedProductIds: Set<string> | null = null;
    if (requestedStore) {
      const { data: store, error: storeError } = await db.from("stores")
        .select("id")
        .eq("slug", requestedStore)
        .maybeSingle();
      if (storeError) throw storeError;
      if (!store) throw new Error(`Obchod ${requestedStore} nebyl nalezen.`);
      const { data: offers, error: offerError } = await db.from("offers")
        .select("product_id")
        .eq("store_id", store.id)
        .eq("status", "published")
        .gte("valid_to", today)
        .not("product_id", "is", null)
        .limit(5000);
      if (offerError) throw offerError;
      allowedProductIds = new Set((offers || []).map((row: any) => String(row.product_id)).filter(Boolean));
    }

    const { data: poolRows, error: poolError } = await db.from("products_missing_verified_images")
      .select("id,name,brand,ean,quantity_text,image_checked_at,active_offer_count,active_store_count,last_offer_at")
      .gt("active_offer_count", 0)
      .order("image_checked_at", { ascending: true, nullsFirst: true })
      .order("active_offer_count", { ascending: false })
      .limit(500);
    if (poolError) throw poolError;

    const pool = (poolRows || [])
      .filter((row: any) => !allowedProductIds || allowedProductIds.has(String(row.id)))
      .sort((a: any, b: any) => priority(b) - priority(a))
      .slice(0, Math.max(limit * 4, 24));

    if (!pool.length) return json({ ok: true, accepted: false, selected_count: 0, message: "Nejsou další produkty k hledání." });

    const productIds = pool.map((row: any) => String(row.id));
    const { data: activeOffers, error: offersError } = await db.from("offers")
      .select("product_id,stores(slug)")
      .in("product_id", productIds)
      .eq("status", "published")
      .gte("valid_to", today)
      .limit(5000);
    if (offersError) throw offersError;

    const storesByProduct = new Map<string, string[]>();
    for (const row of activeOffers || []) {
      const store = Array.isArray(row.stores) ? row.stores[0] : row.stores;
      const productId = String(row.product_id || "");
      const slug = String(store?.slug || "");
      if (!productId || !slug) continue;
      const current = storesByProduct.get(productId) || [];
      if (!current.includes(slug)) current.push(slug);
      storesByProduct.set(productId, current);
    }

    const selected = pool
      .filter((row: any) => storesByProduct.has(String(row.id)))
      .slice(0, limit);

    if (!selected.length) return json({ ok: true, accepted: false, selected_count: 0, message: "Produkty nemají aktivní obchod." });

    const { data: run, error: runError } = await db.from("product_image_search_runs").insert({
      requested_by: requestedBy,
      store_slug: requestedStore || null,
      status: "queued",
      requested_count: selected.length,
      message: "Hledání bylo zařazeno do fronty.",
      results: selected.map((row: any) => ({
        product_id: row.id,
        name: row.name,
        brand: row.brand,
        quantity_text: row.quantity_text,
        priority: priority(row),
      })),
    }).select("id").single();
    if (runError || !run) throw runError || new Error("Nepodařilo se vytvořit běh hledání.");

    runInBackground(processRun(db, run.id, selected, storesByProduct, requestedStore));

    return json({
      ok: true,
      accepted: true,
      run_id: run.id,
      selected_count: selected.length,
      selected_products: selected.map((row: any) => ({ id: row.id, name: row.name, brand: row.brand, quantity_text: row.quantity_text })),
      selection: "ean_brand_quantity_store_catalog_web_fallback",
    }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return json({ ok: false, error: message }, message === "Unauthorized" ? 401 : 500);
  }
});
