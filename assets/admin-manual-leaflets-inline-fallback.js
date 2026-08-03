(() => {
  'use strict';

  if (window.__slevaoManualLeafletInlineFallbackLoaded) return;
  window.__slevaoManualLeafletInlineFallbackLoaded = true;

  const TARGET_BUCKET = 'manual-leaflets';
  const MAX_INLINE_BYTES = 6 * 1024 * 1024;
  const originalCreateClient = window.supabase?.createClient?.bind(window.supabase);
  if (!originalCreateClient) return;

  const isMissingBucket = (error) => /bucket\s+not\s+found|bucket.*does not exist|not found/i.test(String(error?.message || error || ''));

  async function fileToDataUrl(file) {
    const buffer = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < buffer.length; index += chunkSize) {
      binary += String.fromCharCode(...buffer.subarray(index, index + chunkSize));
    }
    const mime = file.type || 'application/octet-stream';
    return `data:${mime};base64,${btoa(binary)}`;
  }

  window.supabase.createClient = (...args) => {
    const client = originalCreateClient(...args);
    const inlineFiles = new Map();
    const originalFrom = client.storage.from.bind(client.storage);

    client.storage.from = (bucket) => {
      const api = originalFrom(bucket);
      if (bucket !== TARGET_BUCKET) return api;

      const originalUpload = api.upload.bind(api);
      const originalSignedUrl = api.createSignedUrl.bind(api);
      const originalRemove = api.remove.bind(api);

      api.upload = async (path, file, options = {}) => {
        if (!(file instanceof Blob) || !file.size) {
          return { data: null, error: new Error('Nahrávaný soubor je prázdný.') };
        }

        // Malé soubory posíláme rovnou procesoru. Díky tomu nahrávání funguje
        // i v okamžiku, kdy produkční Storage bucket ještě nebyl vytvořen.
        if (file.size <= MAX_INLINE_BYTES) {
          try {
            inlineFiles.set(String(path), await fileToDataUrl(file));
            return {
              data: { path: String(path), fullPath: `${TARGET_BUCKET}/${String(path)}` },
              error: null,
            };
          } catch (error) {
            return { data: null, error };
          }
        }

        try {
          const result = await originalUpload(path, file, options);
          if (!result?.error) return result;
          if (!isMissingBucket(result.error)) return result;
          return {
            data: null,
            error: new Error('Úložiště letáků ještě není aktivní. Soubor je větší než dočasný limit 6 MB.'),
          };
        } catch (error) {
          if (isMissingBucket(error)) {
            return {
              data: null,
              error: new Error('Úložiště letáků ještě není aktivní. Soubor je větší než dočasný limit 6 MB.'),
            };
          }
          return { data: null, error };
        }
      };

      api.createSignedUrl = async (path, expiresIn, options) => {
        const inlineUrl = inlineFiles.get(String(path));
        if (inlineUrl) {
          return {
            data: { signedUrl: inlineUrl, path: String(path), expiresIn },
            error: null,
          };
        }
        return originalSignedUrl(path, expiresIn, options);
      };

      api.remove = async (paths) => {
        const list = Array.isArray(paths) ? paths.map(String) : [];
        const inlineOnly = list.length > 0 && list.every((path) => inlineFiles.has(path));
        list.forEach((path) => inlineFiles.delete(path));
        if (inlineOnly) return { data: list.map((name) => ({ name })), error: null };

        try {
          const result = await originalRemove(paths);
          if (isMissingBucket(result?.error)) return { data: [], error: null };
          return result;
        } catch (error) {
          if (isMissingBucket(error)) return { data: [], error: null };
          return { data: null, error };
        }
      };

      return api;
    };

    return client;
  };
})();
