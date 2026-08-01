import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonHeaders = { ...cors, "Content-Type": "application/json" };
const BUCKET = "product-images";
const MAX_BYTES = 8 * 1024 * 1024;

function detectedType(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { mime: "image/png", extension: "png" };
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return { mime: "image/webp", extension: "webp" };
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp" && /^(avif|avis)$/.test(new TextDecoder().decode(bytes.slice(8, 12)))) return { mime: "image/avif", extension: "avif" };
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false, error: "Metoda není podporována." }), { status: 405, headers: jsonHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("Chybí Supabase secrets.");

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: userData, error: userError } = await db.auth.getUser(token);
    if (userError || !userData.user) return new Response(JSON.stringify({ ok: false, error: "Nepřihlášený uživatel." }), { status: 401, headers: jsonHeaders });
    if (!["admin", "editor"].includes(userData.user.app_metadata?.role)) return new Response(JSON.stringify({ ok: false, error: "Nedostatečné oprávnění." }), { status: 403, headers: jsonHeaders });

    const form = await req.formData();
    const productId = String(form.get("product_id") ?? "");
    const file = form.get("file");
    if (!productId || !(file instanceof File)) throw new Error("Vyber produkt a soubor fotografie.");
    if (!file.size || file.size > MAX_BYTES) throw new Error("Fotografie musí mít nejvýše 8 MB.");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const type = detectedType(bytes);
    if (!type) throw new Error("Soubor není podporovaný obrázek JPG, PNG, WEBP nebo AVIF.");

    const { data: product, error: productError } = await db.from("products").select("id").eq("id", productId).single();
    if (productError || !product) throw new Error("Produkt nebyl nalezen.");

    const { data: bucket } = await db.storage.getBucket(BUCKET);
    if (!bucket) {
      const { error: bucketError } = await db.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: MAX_BYTES,
        allowedMimeTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
      });
      if (bucketError && !/already exists/i.test(bucketError.message)) throw bucketError;
    }

    const path = `manual/${productId}/${crypto.randomUUID()}.${type.extension}`;
    const { error: uploadError } = await db.storage.from(BUCKET).upload(path, bytes, {
      contentType: type.mime,
      cacheControl: "31536000",
      upsert: false,
    });
    if (uploadError) throw uploadError;
    const { data: publicData } = db.storage.from(BUCKET).getPublicUrl(path);
    const imageUrl = publicData.publicUrl;

    const { data: candidate, error: candidateError } = await db.from("product_image_candidates").insert({
      product_id: productId,
      image_url: imageUrl,
      source_url: imageUrl,
      source_domain: new URL(supabaseUrl).hostname,
      source_type: "manual",
      file_size_bytes: file.size,
      mime_type: type.mime,
      quality_score: 75,
      match_score: 1,
      status: "pending",
      metadata: { extractor: "staff_upload", original_name: file.name, uploaded_by: userData.user.id },
    }).select("id,image_url,quality_score,status").single();
    if (candidateError) {
      await db.storage.from(BUCKET).remove([path]);
      throw candidateError;
    }

    return new Response(JSON.stringify({ ok: true, candidate }), { headers: jsonHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: String(error?.message ?? error) }), { status: 400, headers: jsonHeaders });
  }
});
