(() => {
  'use strict';

  if (window.__slevaoManualLeafletClientRegisterLoaded) return;
  window.__slevaoManualLeafletClientRegisterLoaded = true;

  const BUCKET = 'manual-leaflets';
  const ACTIVE_IMPORT_STATUSES = ['queued', 'downloading', 'processing', 'review', 'publishing', 'published'];
  const originalCreateClient = window.supabase?.createClient?.bind(window.supabase);
  if (!originalCreateClient) return;

  const asError = (value, fallback) => {
    if (value instanceof Error) return value;
    return new Error(value?.message || String(value || fallback));
  };

  window.supabase.createClient = (...args) => {
    const client = originalCreateClient(...args);
    const originalInvoke = client.functions.invoke.bind(client.functions);

    async function registerManualLeaflet(options = {}) {
      const body = options.body || {};
      const storeId = String(body.store_id || '').trim();
      const storagePath = String(body.storage_path || '').trim();
      const sha256 = String(body.sha256 || '').trim().toLowerCase();
      const originalFilename = String(body.original_filename || 'letak').trim().slice(0, 300);
      const contentType = String(body.content_type || 'application/octet-stream').trim().slice(0, 100);
      const fileSize = Number(body.file_size || 0);
      const autoPublish = Boolean(body.auto_publish);

      if (!storeId || !storagePath || !sha256) {
        return { data: null, error: new Error('Chybí údaje nahraného letáku.') };
      }

      try {
        const auth = await client.auth.getSession();
        const session = auth.data.session;
        const role = session?.user?.app_metadata?.role || '';
        if (auth.error || !session || !['admin', 'editor'].includes(role)) {
          throw new Error('Přihlášení vypršelo nebo účet nemá oprávnění nahrávat letáky.');
        }

        const signed = await client.storage.from(BUCKET).createSignedUrl(storagePath, 7 * 24 * 60 * 60);
        if (signed.error || !signed.data?.signedUrl) {
          throw signed.error || new Error('Nepodařilo se vytvořit odkaz na nahraný leták.');
        }

        const sourceHash = `manual:${storeId}:${sha256}`;
        const existingResult = await client.from('leaflet_imports')
          .select('id,status,metadata')
          .eq('source_hash', sourceHash)
          .maybeSingle();
        if (existingResult.error) throw existingResult.error;

        const existing = existingResult.data;
        const metadata = {
          ...(existing?.metadata || {}),
          manual_upload: true,
          storage_bucket: BUCKET,
          storage_path: storagePath,
          original_filename: originalFilename,
          content_type: contentType,
          file_size: fileSize,
          sha256,
          auto_publish: autoPublish,
          uploaded_by: session.user.id,
          uploaded_by_email: session.user.email || null,
          uploaded_at: new Date().toISOString(),
          client_side_registration: true,
        };

        if (existing && ACTIVE_IMPORT_STATUSES.includes(existing.status)) {
          const previousPath = String(existing.metadata?.storage_path || '');
          if (previousPath && previousPath !== storagePath) {
            const cleanup = await client.storage.from(BUCKET).remove([storagePath]);
            if (cleanup.error) console.warn('Duplicitní soubor se nepodařilo odstranit:', cleanup.error);
          }
          return {
            data: {
              ok: true,
              duplicate: true,
              import_id: existing.id,
              status: existing.status,
              message: existing.status === 'published'
                ? 'Stejný leták už byl zpracován a publikován.'
                : 'Stejný leták už je v systému.',
            },
            error: null,
          };
        }

        let importId = existing?.id || '';
        if (existing) {
          const updated = await client.from('leaflet_imports').update({
            store_id: storeId,
            source_document_url: signed.data.signedUrl,
            status: 'queued',
            error_message: null,
            started_at: null,
            finished_at: null,
            metadata,
          }).eq('id', existing.id).select('id').single();
          if (updated.error) throw updated.error;
          importId = updated.data.id;
        } else {
          const created = await client.from('leaflet_imports').insert({
            source_id: null,
            store_id: storeId,
            source_document_url: signed.data.signedUrl,
            source_hash: sourceHash,
            status: 'queued',
            metadata,
          }).select('id').single();
          if (created.error) throw created.error;
          importId = created.data.id;
        }

        const processing = await originalInvoke('process-leaflet', {
          body: { import_id: importId },
        });

        if (processing.error || processing.data?.error) {
          const failure = asError(processing.error || processing.data?.error, 'Zpracování letáku se nepodařilo spustit.');
          await client.from('leaflet_imports').update({
            status: 'failed',
            error_message: failure.message.slice(0, 2000),
            finished_at: new Date().toISOString(),
          }).eq('id', importId);

          return {
            data: {
              ok: true,
              accepted: true,
              import_id: importId,
              status: 'failed',
              warning: failure.message,
            },
            error: null,
          };
        }

        return {
          data: {
            ok: true,
            accepted: true,
            import_id: importId,
            status: processing.data?.status || 'processing',
            auto_publish: autoPublish,
          },
          error: null,
        };
      } catch (error) {
        return { data: null, error: asError(error, 'Ruční import se nepodařilo založit.') };
      }
    }

    client.functions.invoke = (functionName, options) => {
      if (functionName === 'register-manual-leaflet') return registerManualLeaflet(options);
      return originalInvoke(functionName, options);
    };

    return client;
  };
})();
