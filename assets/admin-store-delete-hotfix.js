(() => {
  'use strict';
  if (window.__slevaoStoreDeleteHotfixLoaded) return;
  window.__slevaoStoreDeleteHotfixLoaded = true;

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const $ = (id) => document.getElementById(id);
  const db = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
  let selectedStore = null;
  let enhanceTimer = 0;

  function installStyles() {
    if ($('storeDeleteStyles')) return;
    const style = document.createElement('style');
    style.id = 'storeDeleteStyles';
    style.textContent = `
      .storePermanentDeleteBtn{border-color:#fecaca!important;background:#fff1f2!important;color:#b42318!important;font-weight:800!important}
      .storePermanentDeleteBtn:hover{background:#ffe4e6!important;border-color:#fda4af!important}
      .storeDeleteAdminNote{display:block;margin-top:8px;color:#9f1239;font-weight:700}
      .storeDeleteModal{position:fixed;inset:0;z-index:2500;display:grid;place-items:center;padding:20px;background:rgba(15,23,42,.72);backdrop-filter:blur(8px)}
      .storeDeleteModal.hidden{display:none}
      .storeDeleteBox{position:relative;width:min(620px,100%);max-height:calc(100vh - 32px);overflow:auto;border:1px solid #fecdd3;border-radius:24px;background:#fff;padding:28px;box-shadow:0 30px 80px rgba(15,23,42,.35)}
      .storeDeleteClose{position:absolute;right:16px;top:14px;width:42px;height:42px;border:0;border-radius:14px;background:#f8fafc;font-size:26px;cursor:pointer}
      .storeDeleteIcon{display:grid;place-items:center;width:58px;height:58px;border-radius:18px;background:#fff1f2;font-size:28px}
      .storeDeleteBox h2{margin:16px 0 8px;font-size:28px;color:#881337}
      .storeDeleteLead{margin:0;color:#475569;line-height:1.55}
      .storeDeleteTarget{margin:18px 0;padding:16px;border:1px solid #e2e8f0;border-radius:18px;background:#f8fafc}
      .storeDeleteTarget strong{display:block;font-size:20px;color:#0f172a}.storeDeleteTarget code{display:inline-block;margin-top:5px;color:#475569}
      .storeDeleteCounts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:16px 0}
      .storeDeleteCount{padding:14px 10px;border:1px solid #e2e8f0;border-radius:16px;text-align:center;background:#fff}
      .storeDeleteCount strong{display:block;font-size:22px;color:#0f172a}.storeDeleteCount span{display:block;margin-top:4px;font-size:12px;color:#64748b}
      .storeDeleteWarning{margin:16px 0;padding:15px 16px;border:1px solid #fda4af;border-radius:16px;background:#fff1f2;color:#9f1239;line-height:1.5}
      .storeDeleteWarning strong{display:block;margin-bottom:4px}
      .storeDeleteConfirmLabel{display:block;margin-top:18px;font-weight:800;color:#0f172a}.storeDeleteConfirmLabel code{color:#be123c}
      .storeDeleteConfirmInput{width:100%;margin-top:8px;padding:13px 14px;border:2px solid #cbd5e1;border-radius:14px;font:inherit}
      .storeDeleteConfirmInput:focus{outline:0;border-color:#e11d48;box-shadow:0 0 0 4px rgba(225,29,72,.12)}
      .storeDeleteMessage{min-height:22px;margin-top:12px;color:#475569}.storeDeleteMessage.error{color:#b42318;font-weight:700}.storeDeleteMessage.ok{color:#047857;font-weight:700}
      .storeDeleteActions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}
      .storeDeleteConfirmBtn{border:0;border-radius:14px;background:#be123c;color:#fff;padding:12px 18px;font-weight:900;cursor:pointer}.storeDeleteConfirmBtn:disabled{cursor:not-allowed;opacity:.45}
      @media(max-width:700px){.storeDeleteBox{padding:22px 18px;border-radius:20px}.storeDeleteCounts{grid-template-columns:repeat(2,minmax(0,1fr))}.storeDeleteActions{flex-direction:column-reverse}.storeDeleteActions button{width:100%}}
    `;
    document.head.append(style);
  }

  function installModal() {
    if ($('storeDeleteModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="storeDeleteModal" class="storeDeleteModal hidden" role="dialog" aria-modal="true" aria-labelledby="storeDeleteTitle">
        <div class="storeDeleteBox">
          <button id="storeDeleteClose" class="storeDeleteClose" type="button" aria-label="Zavřít">×</button>
          <div class="storeDeleteIcon">🗑️</div>
          <h2 id="storeDeleteTitle">Trvale smazat obchod?</h2>
          <p class="storeDeleteLead">Smazání je nevratné a může ho provést pouze administrátor.</p>
          <div class="storeDeleteTarget"><strong id="storeDeleteName">Načítám obchod…</strong><code id="storeDeleteSlug"></code></div>
          <div class="storeDeleteCounts">
            <div class="storeDeleteCount"><strong id="storeDeleteOffers">—</strong><span>nabídek</span></div>
            <div class="storeDeleteCount"><strong id="storeDeleteSources">—</strong><span>zdrojů letáků</span></div>
            <div class="storeDeleteCount"><strong id="storeDeleteImports">—</strong><span>importů letáků</span></div>
            <div class="storeDeleteCount"><strong id="storeDeleteFiles">—</strong><span>archivních souborů</span></div>
          </div>
          <div class="storeDeleteWarning"><strong>Pozor, tato akce je trvalá.</strong>Smaže obchod, jeho nabídky, zdroje a archivované importy. Samostatný HTML soubor stránky v GitHub repozitáři zůstane.</div>
          <label class="storeDeleteConfirmLabel" for="storeDeleteConfirmInput">Pro potvrzení napiš přesně slug <code id="storeDeleteExpected">—</code></label>
          <input id="storeDeleteConfirmInput" class="storeDeleteConfirmInput" autocomplete="off" spellcheck="false" disabled>
          <div id="storeDeleteMessage" class="storeDeleteMessage" aria-live="polite"></div>
          <div class="storeDeleteActions">
            <button id="storeDeleteCancel" class="btn light" type="button">Zrušit</button>
            <button id="storeDeleteConfirm" class="storeDeleteConfirmBtn" type="button" disabled>Trvale smazat obchod</button>
          </div>
        </div>
      </div>`);
  }

  function setMessage(text, type = '') {
    const box = $('storeDeleteMessage');
    if (!box) return;
    box.textContent = text;
    box.className = `storeDeleteMessage ${type}`.trim();
  }

  function withTimeout(promise, milliseconds, text) {
    return Promise.race([
      promise,
      new Promise((_, reject) => window.setTimeout(() => reject(new Error(text)), milliseconds)),
    ]);
  }

  async function getAdminSession() {
    if (!db) throw new Error('Supabase se nepodařilo načíst. Obnov administraci přes Ctrl+F5.');
    const { data, error } = await db.auth.getSession();
    if (error || !data.session) throw new Error('Přihlášení vypršelo. Přihlas se znovu.');
    if (data.session.user.app_metadata?.role !== 'admin') {
      throw new Error('Trvale mazat obchody může pouze administrátor.');
    }
    return data.session;
  }

  function resetModal() {
    selectedStore = null;
    $('storeDeleteName').textContent = 'Načítám obchod…';
    $('storeDeleteSlug').textContent = '';
    $('storeDeleteExpected').textContent = '—';
    ['storeDeleteOffers', 'storeDeleteSources', 'storeDeleteImports', 'storeDeleteFiles'].forEach((id) => {
      $(id).textContent = '—';
    });
    $('storeDeleteConfirmInput').value = '';
    $('storeDeleteConfirmInput').disabled = true;
    $('storeDeleteConfirm').disabled = true;
    $('storeDeleteConfirm').textContent = 'Trvale smazat obchod';
    setMessage('Načítám související data…');
  }

  function archivedDocuments(rows) {
    const unique = new Map();
    for (const row of rows || []) {
      const bucket = typeof row.metadata?.storage_bucket === 'string' ? row.metadata.storage_bucket.trim() : '';
      const path = typeof row.metadata?.storage_path === 'string' ? row.metadata.storage_path.trim() : '';
      if (bucket && path) unique.set(`${bucket}\n${path}`, { bucket, path });
    }
    return [...unique.values()];
  }

  async function loadPreview(storeId) {
    resetModal();
    $('storeDeleteModal').classList.remove('hidden');
    try {
      await getAdminSession();
      const [storeResult, offersResult, sourcesResult, importsResult] = await withTimeout(Promise.all([
        db.from('stores').select('id,name,slug,is_active').eq('id', storeId).maybeSingle(),
        db.from('offers').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
        db.from('leaflet_sources').select('id', { count: 'exact', head: true }).eq('store_id', storeId),
        db.from('leaflet_imports').select('id,metadata', { count: 'exact' }).eq('store_id', storeId),
      ]), 9000, 'Databáze neodpověděla do 9 sekund. Obnov administraci přes Ctrl+F5.');

      const error = storeResult.error || offersResult.error || sourcesResult.error || importsResult.error;
      if (error) throw error;
      if (!storeResult.data) throw new Error('Obchod už neexistuje.');

      selectedStore = {
        ...storeResult.data,
        importIds: (importsResult.data || []).map((row) => row.id).filter(Boolean),
        documents: archivedDocuments(importsResult.data),
      };
      $('storeDeleteName').textContent = selectedStore.name || 'Obchod';
      $('storeDeleteSlug').textContent = selectedStore.slug || '';
      $('storeDeleteExpected').textContent = selectedStore.slug || '—';
      $('storeDeleteOffers').textContent = Number(offersResult.count || 0).toLocaleString('cs-CZ');
      $('storeDeleteSources').textContent = Number(sourcesResult.count || 0).toLocaleString('cs-CZ');
      $('storeDeleteImports').textContent = Number(importsResult.count || 0).toLocaleString('cs-CZ');
      $('storeDeleteFiles').textContent = selectedStore.documents.length.toLocaleString('cs-CZ');
      $('storeDeleteConfirmInput').disabled = !selectedStore.slug;
      setMessage(selectedStore.slug
        ? 'Opsáním slugu odemkneš trvalé smazání.'
        : 'Obchod nemá slug a nelze ho bezpečně smazat.', selectedStore.slug ? '' : 'error');
      if (selectedStore.slug) $('storeDeleteConfirmInput').focus();
    } catch (error) {
      $('storeDeleteName').textContent = 'Načtení obchodu selhalo';
      ['storeDeleteOffers', 'storeDeleteSources', 'storeDeleteImports', 'storeDeleteFiles'].forEach((id) => {
        $(id).textContent = '×';
      });
      setMessage(error?.message || 'Související data se nepodařilo načíst.', 'error');
    }
  }

  async function removeArchivedFiles(documents) {
    const byBucket = new Map();
    for (const document of documents || []) {
      const paths = byBucket.get(document.bucket) || [];
      paths.push(document.path);
      byBucket.set(document.bucket, paths);
    }
    const warnings = [];
    for (const [bucket, paths] of byBucket) {
      for (let index = 0; index < paths.length; index += 100) {
        const { error } = await db.storage.from(bucket).remove(paths.slice(index, index + 100));
        if (error) warnings.push(`Archiv ${bucket}: ${error.message}`);
      }
    }
    return warnings;
  }

  async function deleteStoreRow(storeId) {
    const result = await db.from('stores').delete().eq('id', storeId).select('id').maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new Error('Databáze obchod nesmazala. Zkontroluj oprávnění účtu admin.');
  }

  function isForeignKeyError(error) {
    return error?.code === '23503' || /foreign key|violates.*constraint|stále používá/i.test(error?.message || '');
  }

  async function deleteDependencies(storeId, importIds) {
    setMessage('Odstraňuji nabídky obchodu…');
    const offers = await db.from('offers').delete().eq('store_id', storeId);
    if (offers.error) throw new Error(`Nabídky: ${offers.error.message}`);

    if (importIds.length) {
      setMessage('Odstraňuji importované letáky…');
      for (let index = 0; index < importIds.length; index += 200) {
        const imports = await db.from('leaflet_imports').delete().in('id', importIds.slice(index, index + 200));
        if (imports.error) throw new Error(`Importy letáků: ${imports.error.message}`);
      }
    }

    setMessage('Odstraňuji zdroje letáků…');
    const sources = await db.from('leaflet_sources').delete().eq('store_id', storeId);
    if (sources.error) throw new Error(`Zdroje letáků: ${sources.error.message}`);
  }

  async function deleteStore() {
    if (!selectedStore?.id || $('storeDeleteConfirmInput').value.trim() !== selectedStore.slug) return;
    const button = $('storeDeleteConfirm');
    button.disabled = true;
    button.textContent = 'Mažu obchod…';
    $('storeDeleteConfirmInput').disabled = true;
    setMessage('Ověřuji oprávnění administrátora…');

    try {
      await getAdminSession();
      const store = selectedStore;
      let deleted = false;

      setMessage('Mažu obchod z databáze…');
      try {
        await deleteStoreRow(store.id);
        deleted = true;
      } catch (error) {
        if (!isForeignKeyError(error)) throw error;
        await deleteDependencies(store.id, store.importIds || []);
        setMessage('Dokončuji smazání obchodu…');
        await deleteStoreRow(store.id);
        deleted = true;
      }

      if (deleted && (store.importIds || []).length) {
        const imports = await db.from('leaflet_imports').delete().in('id', store.importIds);
        if (imports.error) console.warn('Úklid importů:', imports.error.message);
      }
      const warnings = await removeArchivedFiles(store.documents || []);

      try {
        Object.keys(localStorage)
          .filter((key) => key.startsWith('slevao-public-data-'))
          .forEach((key) => localStorage.removeItem(key));
      } catch { /* Úložiště může být vypnuté. */ }

      const suffix = warnings.length ? ` Upozornění: ${warnings.join(' | ')}` : '';
      setMessage(`Obchod „${store.name}“ byl trvale smazán.${suffix}`, warnings.length ? 'error' : 'ok');
      document.querySelector(`[data-store-card="${store.id}"]`)?.remove();
      window.setTimeout(() => window.location.reload(), 1100);
    } catch (error) {
      setMessage(error?.message || 'Obchod se nepodařilo smazat.', 'error');
      $('storeDeleteConfirmInput').disabled = false;
      button.textContent = 'Trvale smazat obchod';
      button.disabled = $('storeDeleteConfirmInput').value.trim() !== selectedStore?.slug;
    }
  }

  async function enhanceStoreCards() {
    try {
      await getAdminSession();
      const notice = document.querySelector('#storesPage .storeNotice');
      if (notice && !notice.querySelector('.storeDeleteAdminNote')) {
        notice.insertAdjacentHTML('beforeend', '<span class="storeDeleteAdminNote">Trvalé smazání je dostupné pouze administrátorovi a vyžaduje opsání slugu.</span>');
      }
      document.querySelectorAll('#storesList [data-store-card]').forEach((card) => {
        const actions = card.querySelector('.actions');
        if (!actions || actions.querySelector('[data-store-permanent-delete]')) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'storePermanentDeleteBtn';
        button.dataset.storePermanentDelete = card.dataset.storeCard;
        button.textContent = '🗑️ Smazat obchod';
        actions.append(button);
      });
    } catch { /* Nepřihlášený uživatel nebo editor tlačítko neuvidí. */ }
  }

  function scheduleEnhance() {
    window.clearTimeout(enhanceTimer);
    enhanceTimer = window.setTimeout(enhanceStoreCards, 40);
  }

  function closeModal() {
    if ($('storeDeleteConfirm')?.textContent === 'Mažu obchod…') return;
    $('storeDeleteModal')?.classList.add('hidden');
    selectedStore = null;
  }

  function init() {
    installStyles();
    installModal();
    const list = $('storesList');
    if (list) new MutationObserver(scheduleEnhance).observe(list, { childList: true, subtree: true });
    scheduleEnhance();
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
      closeModal();
    }
  }, true);

  document.addEventListener('input', (event) => {
    if (event.target?.id !== 'storeDeleteConfirmInput') return;
    $('storeDeleteConfirm').disabled = !selectedStore?.slug || event.target.value.trim() !== selectedStore.slug;
  }, true);

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
