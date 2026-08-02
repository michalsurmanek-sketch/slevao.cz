(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/delete-store`;
  const $ = (id) => document.getElementById(id);
  const db = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
  let selectedStore = null;

  const setMessage = (text, type = '') => {
    const box = $('storeDeleteMessage');
    if (!box) return;
    box.textContent = text;
    box.className = `storeDeleteMessage ${type}`.trim();
  };

  const timeout = (promise, ms, text) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(text)), ms)),
  ]);

  async function getSession() {
    if (!db) throw new Error('Supabase se nepodařilo načíst. Obnov administraci přes Ctrl+F5.');
    const { data, error } = await db.auth.getSession();
    if (error || !data.session) throw new Error('Přihlášení vypršelo. Přihlas se znovu.');
    if (data.session.user.app_metadata?.role !== 'admin') throw new Error('Trvale mazat obchody může pouze administrátor.');
    return data.session;
  }

  function resetModal() {
    selectedStore = null;
    $('storeDeleteName').textContent = 'Načítám obchod…';
    $('storeDeleteSlug').textContent = '';
    $('storeDeleteExpected').textContent = '—';
    ['storeDeleteOffers', 'storeDeleteSources', 'storeDeleteImports', 'storeDeleteFiles'].forEach((id) => {
      if ($(id)) $(id).textContent = '—';
    });
    $('storeDeleteConfirmInput').value = '';
    $('storeDeleteConfirmInput').disabled = true;
    $('storeDeleteConfirm').disabled = true;
    $('storeDeleteConfirm').textContent = 'Trvale smazat obchod';
    setMessage('Načítám související data…');
  }

  function archivedDocumentCount(rows) {
    const unique = new Set();
    for (const row of rows || []) {
      const bucket = typeof row.metadata?.storage_bucket === 'string' ? row.metadata.storage_bucket.trim() : '';
      const path = typeof row.metadata?.storage_path === 'string' ? row.metadata.storage_path.trim() : '';
      if (bucket && path) unique.add(`${bucket}\n${path}`);
    }
    return unique.size;
  }

  async function loadPreview(storeId) {
    resetModal();
    $('storeDeleteModal')?.classList.remove('hidden');
    try {
      await getSession();
      const [storeResult, offersResult, sourcesResult, importsResult] = await timeout(Promise.all([
        db.from('stores').select('id,name,slug,is_active').eq('id', storeId).maybeSingle(),
        db.from('offers').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
        db.from('leaflet_sources').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
        db.from('leaflet_imports').select('id,metadata', { count: 'exact' }).eq('store_id', storeId),
      ]), 9000, 'Databáze neodpověděla do 9 sekund. Obnov administraci přes Ctrl+F5.');

      const error = storeResult.error || offersResult.error || sourcesResult.error || importsResult.error;
      if (error) throw error;
      if (!storeResult.data) throw new Error('Obchod už neexistuje.');

      selectedStore = storeResult.data;
      $('storeDeleteName').textContent = selectedStore.name || 'Obchod';
      $('storeDeleteSlug').textContent = selectedStore.slug || '';
      $('storeDeleteExpected').textContent = selectedStore.slug || '—';
      $('storeDeleteOffers').textContent = Number(offersResult.count || 0).toLocaleString('cs-CZ');
      $('storeDeleteSources').textContent = Number(sourcesResult.count || 0).toLocaleString('cs-CZ');
      $('storeDeleteImports').textContent = Number(importsResult.count || 0).toLocaleString('cs-CZ');
      $('storeDeleteFiles').textContent = archivedDocumentCount(importsResult.data).toLocaleString('cs-CZ');
      $('storeDeleteConfirmInput').disabled = !selectedStore.slug;
      setMessage(selectedStore.slug
        ? 'Opsáním slugu odemkneš trvalé smazání.'
        : 'Obchod nemá slug a nelze ho bezpečně smazat.', selectedStore.slug ? '' : 'error');
      if (selectedStore.slug) $('storeDeleteConfirmInput').focus();
    } catch (error) {
      $('storeDeleteName').textContent = 'Načtení obchodu selhalo';
      ['storeDeleteOffers', 'storeDeleteSources', 'storeDeleteImports', 'storeDeleteFiles'].forEach((id) => {
        if ($(id)) $(id).textContent = '×';
      });
      setMessage(error?.message || 'Související data se nepodařilo načíst.', 'error');
    }
  }

  async function deleteStore() {
    if (!selectedStore?.id || $('storeDeleteConfirmInput').value.trim() !== selectedStore.slug) return;
    const button = $('storeDeleteConfirm');
    button.disabled = true;
    button.textContent = 'Mažu obchod…';
    $('storeDeleteConfirmInput').disabled = true;
    setMessage('Probíhá trvalé smazání. Nezavírej stránku.');

    try {
      const session = await getSession();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let response;
      try {
        response = await fetch(FUNCTION_URL, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_KEY,
            authorization: `Bearer ${session.access_token}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ action: 'delete', store_id: selectedStore.id, confirmation: selectedStore.slug }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      let result = null;
      try { result = await response.json(); } catch { /* Odpověď má být JSON. */ }
      if (!response.ok || !result?.ok) throw new Error(result?.error || `Smazání selhalo (HTTP ${response.status}).`);

      try {
        Object.keys(localStorage).filter((key) => key.startsWith('slevao-public-data-')).forEach((key) => localStorage.removeItem(key));
      } catch { /* Úložiště může být vypnuté. */ }
      setMessage(`Obchod „${selectedStore.name}“ byl trvale smazán.`, 'ok');
      setTimeout(() => window.location.reload(), 900);
    } catch (error) {
      const text = error?.name === 'AbortError'
        ? 'Server pro mazání neodpověděl do 15 sekund.'
        : error?.message || 'Obchod se nepodařilo smazat.';
      setMessage(text, 'error');
      $('storeDeleteConfirmInput').disabled = false;
      button.textContent = 'Trvale smazat obchod';
      button.disabled = $('storeDeleteConfirmInput').value.trim() !== selectedStore.slug;
    }
  }

  document.addEventListener('click', (event) => {
    const deleteButton = event.target.closest?.('[data-store-permanent-delete]');
    if (deleteButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      loadPreview(deleteButton.dataset.storePermanentDelete);
      return;
    }
    if (event.target.closest?.('#storeDeleteConfirm')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      deleteStore();
      return;
    }
    if (event.target.closest?.('#storeDeleteClose,#storeDeleteCancel') || event.target === $('storeDeleteModal')) {
      selectedStore = null;
    }
  }, true);

  document.addEventListener('input', (event) => {
    if (event.target?.id !== 'storeDeleteConfirmInput') return;
    $('storeDeleteConfirm').disabled = !selectedStore?.slug || event.target.value.trim() !== selectedStore.slug;
  }, true);
})();
