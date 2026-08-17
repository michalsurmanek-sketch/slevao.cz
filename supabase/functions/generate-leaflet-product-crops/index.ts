import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "authorization, apikey, content-type",
      },
    });
  }

  return Response.json({
    ok: false,
    paused: true,
    reason: "leaflet_crop_pending_requires_approval",
    message: "Automatické výřezy z letáků jsou dočasně pozastavené. Kandidát obrázku musí nejprve projít schválením před propagací do veřejné nabídky.",
  }, { status: 503 });
});
