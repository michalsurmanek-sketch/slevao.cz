import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...cors, "Content-Type": "application/json" };
const BUCKET = "homepage-leaflet-images";
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_ROLES = new Set(["admin", "editor"]);

function detectedType(bytes: Uint8Array): { mime: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg" };
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { mime: "image/png" };
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return { mime: "image/webp" };
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp" && /^(avif|avis)$/.test(new TextDecoder().decode(bytes.slice(8, 12)))) return { mime: "image/avif" };
  return null;
}

function validSlug(value: unknown): string {
  const slug = String(value ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Neplatný slug obchodu.");
  return slug;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "Metoda není podporována." }), { status: 405, headers: jsonHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Chybí Supabase secrets.");

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await db.auth.getUser(token);
    if (userError || !userData.user) return new Response(JSON.stringify({ ok: false, error: "Přihlášení vypršelo." }), { status: 401, headers: jsonHeaders });
    if (!ALLOWED_ROLES.has(userData.user.app_metadata?.role)) return new Response(JSON.stringify({ ok: false, error: "Nedostatečné oprávnění." }), { status: 403, headers: jsonHeaders });

    const contentType = req.headers.get("content-type") || "";
    let action = "upload";
    let slug = "";
    let file: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      action = String(form.get("action") || "upload");
      slug = validSlug(form.get("store_slug"));
      const candidate = form.get("file");
      file = candidate instanceof File ? candidate : null;
    } else {
      const payload = await req.json().catch(() => ({}));
      action = String(payload?.action || "");
      slug = validSlug(payload?.store_slug);
    }

    const { data: store, error: storeError } = await db.from("stores").select("id,name,slug").eq("slug", slug).maybeSingle();
    if (storeError) throw storeError;
    if (!store) throw new Error("Obchod nebyl nalezen.");

    const { data: existingBucket } = await db.storage.getBucket(BUCKET);
    if (!existingBucket) {
      const { error: bucketError } = await db.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: MAX_BYTES,
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
      });
      if (bucketError && !/already exists/i.test(bucketError.message)) throw bucketError;
    }

    const path = `${slug}/cover`;
    if (action === "delete") {
      const { error: deleteError } = await db.storage.from(BUCKET).remove([path]);
      if (deleteError && !/not found|does not exist/i.test(deleteError.message)) throw deleteError;
      return new Response(JSON.stringify({ ok: true, action: "delete", store }), { headers: jsonHeaders });
    }

    if (action !== "upload") throw new Error("Neplatná akce.");
    if (!file) throw new Error("Vyber fotografii z počítače.");
    if (!file.size || file.size > MAX_BYTES) throw new Error("Fotografie musí mít nejvýše 8 MB.");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = detectedType(bytes);
    if (!type) throw new Error("Soubor není podporovaný obrázek JPG, PNG, WEBP nebo AVIF.");

    const { error: uploadError } = await db.storage.from(BUCKET).upload(path, bytes, {
      contentType: type.mime,
      cacheControl: "300",
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const { data: publicData } = db.storage.from(BUCKET).getPublicUrl(path);
    return new Response(JSON.stringify({
      ok: true,
      action: "upload",
      store,
      image_url: `${publicData.publicUrl}?v=${Date.now()}`,
      uploaded_by: userData.user.id,
    }), { headers: jsonHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error?.message ?? error) }), { status: 400, headers: jsonHeaders });
  }
});
