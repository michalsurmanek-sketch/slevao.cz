from pathlib import Path

PATH = Path("supabase/functions/process-leaflet/index.ts")
text = PATH.read_text(encoding="utf-8")
original = text

signature_old = """async function extractWithOpenAI(
  storeName: string,
  extension: string,
  mime: string,
  bytes: Uint8Array,
  importId: string,
): Promise<ExtractionResult> {"""
signature_new = """async function extractWithOpenAI(
  storeName: string,
  extension: string,
  mime: string,
  bytes: Uint8Array,
  sourceUrl: string,
  importId: string,
): Promise<ExtractionResult> {"""

image_old = """  } else {
    const dataUrl = `data:${mime};base64,${bytesToBase64(bytes)}`;
    documentInput = { type: 'input_image', image_url: dataUrl, detail: 'high' };
  }"""
image_new = """  } else {
    // Velké stránky letáků neposíláme jako base64 v JSON těle. OpenAI si je
    // stáhne přímo z veřejné HTTPS adresy, čímž se vyhneme limitu velikosti
    // požadavku Edge Function i zbytečnému násobení velikosti přes base64.
    const useRemoteUrl = bytes.length > 4 * 1024 * 1024 && /^https:\\/\\//i.test(sourceUrl);
    const imageUrl = useRemoteUrl ? sourceUrl : `data:${mime};base64,${bytesToBase64(bytes)}`;
    documentInput = { type: 'input_image', image_url: imageUrl, detail: 'high' };
  }"""

storage_old = """      const detected = detectDocumentType(sourceResponse.headers.get('content-type') || '', bytes);
      const canArchiveInStorage = bytes.length <= 45 * 1024 * 1024;
      let storagePath: string | null = null;
      if (canArchiveInStorage) {
        await ensureBucket();
        storagePath = `${job.store_id || 'unknown'}/${importId}/source.${detected.extension}`;
        const { error: uploadError } = await db.storage.from(STORAGE_BUCKET).upload(storagePath, bytes, {
          contentType: detected.mime,
          upsert: true,
        });
        if (uploadError) throw uploadError;
      }

      await db.from('leaflet_imports').update({
        status: 'processing',
        metadata: {
          ...(job.metadata || {}),
          storage_bucket: storagePath ? STORAGE_BUCKET : null,
          storage_path: storagePath,
          storage_skipped_reason: storagePath ? null : 'Soubor překročil bezpečný limit úložiště 45 MB; zpracován přímo.',
          bytes: bytes.length,
          detected_mime: detected.mime,
          ai_model: OPENAI_MODEL,
          processing_started_at: new Date().toISOString(),
        },
      }).eq('id', importId);

      result = await extractWithOpenAI(job.leaflet_sources?.name || '', detected.extension, detected.mime, bytes, importId);"""
storage_new = """      const detected = detectDocumentType(sourceResponse.headers.get('content-type') || '', bytes);
      // Archiv je pouze pomocná kopie. Na některých projektech Supabase platí
      // nižší globální limit objektu než limit nastavený na bucketu. Selhání
      // archivace proto nesmí ukončit samotné zpracování letáku.
      const archiveLimitBytes = 4 * 1024 * 1024;
      const canArchiveInStorage = bytes.length <= archiveLimitBytes;
      let storagePath: string | null = null;
      let storageUploadWarning: string | null = null;
      if (canArchiveInStorage) {
        try {
          await ensureBucket();
          const candidatePath = `${job.store_id || 'unknown'}/${importId}/source.${detected.extension}`;
          const { error: uploadError } = await db.storage.from(STORAGE_BUCKET).upload(candidatePath, bytes, {
            contentType: detected.mime,
            upsert: true,
          });
          if (uploadError) throw uploadError;
          storagePath = candidatePath;
        } catch (storageError) {
          storageUploadWarning = storageError instanceof Error ? storageError.message : String(storageError);
          console.warn('Archivace letáku byla přeskočena:', storageUploadWarning);
        }
      } else {
        storageUploadWarning = `Soubor má ${(bytes.length / 1024 / 1024).toFixed(1)} MB a překročil bezpečný limit archivu 4 MB.`;
      }

      await db.from('leaflet_imports').update({
        status: 'processing',
        metadata: {
          ...(job.metadata || {}),
          storage_bucket: storagePath ? STORAGE_BUCKET : null,
          storage_path: storagePath,
          storage_skipped_reason: storagePath ? null : storageUploadWarning || 'Archivace byla přeskočena; leták se zpracovává přímo.',
          bytes: bytes.length,
          detected_mime: detected.mime,
          ai_model: OPENAI_MODEL,
          processing_started_at: new Date().toISOString(),
        },
      }).eq('id', importId);

      result = await extractWithOpenAI(
        job.leaflet_sources?.name || '',
        detected.extension,
        detected.mime,
        bytes,
        sourceResponse.url || job.source_document_url,
        importId,
      );"""

replacements = [
    (signature_old, signature_new, "signatura extractWithOpenAI"),
    (image_old, image_new, "odeslání velkého obrázku přes URL"),
    (storage_old, storage_new, "bezpečná archivace letáku"),
]

for old, new, label in replacements:
    if new in text:
        continue
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Nelze aplikovat opravu ({label}); očekáván 1 výskyt, nalezeno {count}.")
    text = text.replace(old, new, 1)

if text == original:
    print("Oprava velkých letáků už je aplikovaná.")
else:
    PATH.write_text(text, encoding="utf-8")
    print("Oprava velkých letáků byla aplikovaná.")
