import { enableOcr, extractBytes, initWasm } from 'npm:@kreuzberg/wasm';

const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') || '';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-cron-secret',
};

let readyPromise: Promise<void> | null = null;
function ensureReady() {
  if (!readyPromise) {
    readyPromise = (async () => {
      await initWasm();
      await enableOcr();
    })();
  }
  return readyPromise;
}

function allowed(req: Request) {
  const auth = req.headers.get('authorization') || '';
  return auth === `Bearer ${SERVICE_ROLE_KEY}` || Boolean(CRON_SECRET && req.headers.get('x-cron-secret') === CRON_SECRET);
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

function processingImageUrl(input: string) {
  try {
    const url = new URL(input);
    if ((url.hostname === 'www.jip-potraviny.cz' || url.hostname === 'jip-potraviny.cz') && /\/files\/mobile\/\d+\.jpg$/i.test(url.pathname)) {
      url.pathname = url.pathname.replace('/files/mobile/', '/files/thumb/');
      return url.toString();
    }
    return input;
  } catch {
    return input;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!allowed(req)) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = await req.json().catch(() => ({}));
    const imageUrl = String(body.image_url || '');
    const language = String(body.language || 'ces');
    if (!/^https:\/\//i.test(imageUrl)) return json({ error: 'Missing HTTPS image_url' }, 400);

    await ensureReady();

    const processedImageUrl = processingImageUrl(imageUrl);
    const response = await fetch(processedImageUrl, {
      headers: { 'user-agent': 'Mozilla/5.0', accept: 'image/jpeg,image/png,image/webp,*/*' },
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`Stažení obrázku selhalo: HTTP ${response.status}`);

    const contentType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error('Obrázek je prázdný nebo příliš velký.');

    const startedAt = Date.now();
    const result: any = await extractBytes(bytes, contentType, {
      forceOcr: true,
      enableQualityProcessing: false,
      outputFormat: 'plain',
      resultFormat: 'element_based',
      ocr: {
        backend: 'tesseract-wasm',
        language,
        tesseractConfig: { psm: 11, oem: 3 },
        elementConfig: {
          includeElements: true,
          minLevel: 'word',
          minConfidence: 0.25,
          buildHierarchy: false,
        },
      },
    });

    const elements = Array.isArray(result?.ocrElements) ? result.ocrElements : [];
    const compactElements = elements.slice(0, 1200).map((element: any) => ({
      text: String(element?.text || '').trim(),
      level: element?.level ?? null,
      confidence: element?.confidence ?? null,
      geometry: element?.geometry ?? null,
      page_number: element?.pageNumber ?? element?.page_number ?? null,
    })).filter((element: any) => element.text);

    return json({
      ok: true,
      engine: 'kreuzberg-tesseract-wasm',
      language,
      image_url: imageUrl,
      processed_image_url: processedImageUrl,
      used_lightweight_variant: processedImageUrl !== imageUrl,
      bytes: bytes.length,
      elapsed_ms: Date.now() - startedAt,
      content: String(result?.content || ''),
      quality_score: result?.qualityScore ?? result?.quality_score ?? null,
      ocr_element_count: elements.length,
      ocr_elements: compactElements,
      warnings: result?.processingWarnings || result?.processing_warnings || [],
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});