(() => {
  'use strict';

  if (window.__slevaoManualLeafletBucketHotfix) return;
  window.__slevaoManualLeafletBucketHotfix = true;

  const originalCreateClient = window.supabase?.createClient?.bind(window.supabase);
  if (!originalCreateClient) return;

  window.supabase.createClient = (...args) => {
    const client = originalCreateClient(...args);
    const originalFrom = client.storage.from.bind(client.storage);

    client.storage.from = (bucket) => {
      const api = originalFrom(bucket);
      if (bucket !== 'manual-leaflets' || typeof api.uploadToSignedUrl !== 'function') return api;

      api.upload = async (path, file, options = {}) => {
        try {
          const storeId = String(path || '').split('/')[0];
          const { data, error } = await client.functions.invoke('prepare-manual-leaflet-upload', {
            body: {
              store_id: storeId,
              storage_path: path,
              content_type: file?.type || 'application/octet-stream',
              file_size: Number(file?.size || 0),
            },
          });

          if (error) return { data: null, error };
          if (data?.error) return { data: null, error: new Error(data.error) };
          if (!data?.token) return { data: null, error: new Error('Server nevrátil token pro nahrání souboru.') };

          return await api.uploadToSignedUrl(path, data.token, file, {
            cacheControl: options.cacheControl || '3600',
            contentType: options.contentType || file?.type || undefined,
          });
        } catch (error) {
          return { data: null, error };
        }
      };

      return api;
    };

    return client;
  };
})();
