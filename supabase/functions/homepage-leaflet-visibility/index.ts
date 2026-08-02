import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...cors, "Content-Type": "application/json" };
const BUCKET = "homepage-leaflet-settings";
const SETTINGS_PATH = "visibility.json";
const MAX_BYTES = 64 * 1024;
const ALLOWED_ROLES = new Set(["admin", "editor"]);

function validSlug(value: unknown): string {
  const slug = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Neplatný slug obchodu.");
  return slug;
}

function normalizeHidden(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? "").trim().toLowerCase())
    .filter((slug) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)))].sort();
}

async function ensureBucket(db: ReturnType<typeof createClient>) {
  const { data: bucket } = await db.storage.getBucket(BUCKET);
  if (bucket) return;
  const { error } = await db.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: ["application/json"],
  });
  if (error && !/already exists/i.test(error.message)) throw error;
}

async function readSettings(db: ReturnType<typeof createClient>) {
  await ensureBucket(db);
  const { data, error } = await db.storage.from(BUCKET).download(SETTINGS_PATH);
  if (error) {
    if (/not found|does not exist|404/i.test(error.message)) return { hidden_slugs: [] as string[] };
    throw error;
  }
  try {
    const parsed = JSON.parse(await data.text());
    return { hidden_slugs: normalizeHidden(parsed?.hidden_slugs) };
  } catch {
    return { hidden_slugs: [] as string[] };
  }
}

async function writeSettings(db: ReturnType<typeof createClient>, hiddenSlugs: string[]) {
  const payload = JSON.stringify({
    hidden_slugs: normalizeHidden(hiddenSlugs),
    updated_at: new Date().toISOString(),
  });
  const bytes = new TextEncoder().encode(payload);
  if (bytes.byteLength > MAX_BYTES) throw new Error("Nastavení je příliš velké.");
  const { error } = await db.storage.from(BUCKET).upload(SETTINGS_PATH, bytes, {
    contentType: "application/json",
    cacheControl: "60",
    upsert: true,
  });
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Metoda není podporována." }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Chybí Supabase secrets.");

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await db.auth.getUser(token);
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ ok: false, error: "Přihlášení vypršelo." }), {
        status: 401,
        headers: jsonHeaders,
      });
    }
    if (!ALLOWED_ROLES.has(userData.user.app_metadata?.role)) {
      return new Response(JSON.stringify({ ok: false, error: "Nedostatečné oprávnění." }), {
        status: 403,
        headers: jsonHeaders,
      });
    }

    const payload = await req.json().catch(() => ({}));
    const action = String(payload?.action || "get");
    const settings = await readSettings(db);

    if (action === "get") {
      return new Response(JSON.stringify({ ok: true, ...settings }), { headers: jsonHeaders });
    }

    if (action !== "set") throw new Error("Neplatná akce.");
    const slug = validSlug(payload?.store_slug);
    const visible = payload?.visible === true;

    const { data: store, error: storeError } = await db.from("stores")
      .select("id,name,slug")
      .eq("slug", slug)
      .maybeSingle();
    if (storeError) throw storeError;
    if (!store) throw new Error("Obchod nebyl nalezen.");

    const hidden = new Set(settings.hidden_slugs);
    if (visible) hidden.delete(slug);
    else hidden.add(slug);
    const hiddenSlugs = [...hidden].sort();
    await writeSettings(db, hiddenSlugs);

    return new Response(JSON.stringify({
      ok: true,
      store,
      visible,
      hidden_slugs: hiddenSlugs,
      updated_by: userData.user.id,
    }), { headers: jsonHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error?.message ?? error) }), {
      status: 400,
      headers: jsonHeaders,
    });
  }
});
