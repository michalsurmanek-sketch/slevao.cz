(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/delete-store`;
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));

  let db = null;
  let selectedStore = null;
  let enhancing = false;
  let enhanceTimer = 0;

  function clearPublicCache() {
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith('slevao-public-data-'))
        .forEach((key) => localStorage.removeItem(key));
    } catch { /* Úložiště může být vypnuté. */ }
  }

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
      .storeDeleteBox{position:relative;width:min(620px,100%);max-height:min(780px,calc(100vh - 32px));overflow:auto;border:1px solid #fecdd3;border-radius:24px;background:#fff;padding:28px;box-shadow:0 30px 80px rgba(15,23,42,.35)}
      .storeDeleteClose{position:absolute;right:16px;top:14px;width:42px;height:42px;border:0;border-radius:14px;background:#f8fafc;font-size:26px;cursor:pointer}
      .storeDeleteIcon{display:grid;place-items:center;width:58px;height:58px;border-radius:18px;background:#fff1f2;font-size:28px}
      .storeDeleteBox h2{margin:16px 0 8px;font-size:28px;color:#881337}
      .storeDeleteLead{margin:0;color:#475569;line-height:1.55}
      .storeDeleteTarget{margin:18px 0;padding:16px;border:1px solid #e2e8f0;border-radius:18px;background:#f8fafc}
      .storeDeleteTarget strong{display:block;font-size:20px;color:#0f172a}
      .storeDeleteTarget code{display:inline-block;margin-top:5px;color:#475569}
      .storeDeleteCounts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:16px 0}
      .storeDeleteCount{padding:14px 10px;border:1px solid #e2e8f0;border-radius:16px;text-align:center;background:#fff}
      .storeDeleteCount strong{display:block;font-size:22px;color:#0f172a}.storeDeleteCount span{display:block;margin-top:4px;font-size:12px;color:#64748b}
      .storeDeleteWarning{margin:16px 0;padding:15px 16px;border:1px solid #fda4af;border-radius:16px;background:#fff1f2;color:#9f1239;line-height:1.5}
      .storeDeleteWarning strong{display:block;margin-bottom:4px}
      .storeDeleteConfirmLabel{display:block;margin-top:18px;font-weight:800;color:#0f172a}
      .storeDeleteConfirmLabel code{color:#be123c}
      .storeDeleteConfirmInput{width:100%;margin-top:8px;padding:13px 14px;border:2px solid #cbd5e1;border-radius:14px;font:inherit}
      .storeDeleteConfirmInput:focus{outline:0;border-color:#e11d48;box-shadow:0 0 0 4px rgba(225,29,72,.12)}
      .storeDeleteMessage{min-height:22px;margin-top:12px;color:#475569}.storeDeleteMessage.error{color:#b42318;font-weight:700}.storeDeleteMessage.ok{color:#047857;font-weight:700}
      .storeDeleteActions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}
      .storeDeleteConfirmBtn{border:0;border-radius:14px;background:#be123c;color:#fff;padding:12px 18px;font-weight:900;cursor:pointer}
      .storeDeleteConfirmBtn:disabled{cursor:not-allowed;opacity:.45}
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
          <p class="storeDeleteLead">Nejdřív načtu související data. Smazání je nevratné a může ho provést pouze administrátor.</p>
          <div class="storeDeleteTarget"><strong id="storeDeleteName">Načítám obchod…</strong><code id="storeDeleteSlug"></code></div>
          <div class="storeDeleteCounts">
            <div class="storeDeleteCount"><strong id="storeDeleteOffers">—</strong><span>nabídek</span></div>
            <div class="storeDeleteCount"><strong id="storeDeleteSources">—</strong><span>zdrojů letáků</span></div>
            <div class="storeDeleteCount"><strong id="storeDeleteImports">—</strong><span>importů letáků</span></div>
            <div class="storeDeleteCount"><strong id="storeDeleteFiles">—</strong><span>archivních souborů</span></div>
          </div>
          <div class="storeDeleteWarning"><strong>Pozor, tato akce je trvalá.</strong>Smaže obchod, jeho nabídky, zdroje a archivované importy. Samostatný HTML soubor stránky v GitHub repozitáři zůstane, ale obchod zmizí z databáze a veřejných seznamů.</div>
          <label class="storeDeleteConfirmLabel" for="storeDeleteConfirmInput">Pro potvrzení napiš přesně slug <code id="storeDeleteExpected">—</code></label>
          <input id="storeDeleteConfirmInput" class="storeDeleteConfirmInput" autocomplete="off" spellcheck="false" disabled>
          <div id="storeDeleteMessage" class="storeDeleteMessage" aria-live="polite"></div>
          <div class="storeDeleteActions">
            <button id="storeDeleteCancel" class="btn light" type="button">Zrušit</button>
            <button id="storeDeleteConfirm" class="storeDeleteConfirmBtn" type="button" disabled>Trvale smazat obchod</button>
          </div>
        </div>
      </div>`);

    $('storeDeleteClose').addEventListener('click', closeModal);
    $('storeDeleteCancel').addEventListener('click', closeModal);
    $('storeDeleteModal').addEventListener('click', (event) => {
      if (event.target === $('storeDeleteModal')) closeModal();
    });
    $('storeDeleteConfirmInput').addEventListener('input', updateConfirmationState);
    $('storeDeleteConfirm').addEventListener('click', confirmDelete);
  }

  function message(text = '', type = '') {
    const target = $('storeDeleteMessage');
    target.textContent = text;
    target.className = `storeDeleteMessage ${type}`.trim();
  }

  function resetModal() {
    selectedStore = null;
    $('storeDeleteName').textContent = 'Načítám obchod…';
    $('storeDeleteSlug').textContent = '';
    $('storeDeleteExpected').textContent = '—';
    ['storeDeleteOffers', 'storeDeleteSources', 'storeDeleteImports', 'storeDeleteFiles'].forEach((id) => { $(id).textContent = '—'; });
    $('storeDeleteConfirmInput').value = '';
    $('storeDeleteConfirmInput').disabled = true;
    $('storeDeleteConfirm').disabled = true;
    $('storeDeleteConfirm').textContent = 'Trvale smazat obchod';
    message('Načítám související data…');
  }

  function closeModal() {
    if ($('storeDeleteConfirm')?.disabled && $('storeDeleteConfirm')?.textContent === 'Mažu obchod…') return;
    $('storeDeleteModal')?.classList.add('hidden');
    selectedStore = null;
  }

  function updateConfirmationState() {
    const matches = Boolean(selectedStore?.slug) && $('storeDeleteConfirmInput').value.trim() === selectedStore.slug;
    $('storeDeleteConfirm').disabled = !matches;
  }

  async function session() {
    const { data, error } = await db.auth.getSession();
    if (error || !data.session) throw new Error('Přihlášení vypršelo. Přihlas se znovu.');
    return data.session;
  }

  async function invoke(payload) {
    const activeSession = await session();
    const response = await fetch(FUNCTION_URL, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        authorization: `Bearer ${activeSession.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    let result = null;
    try { result = await response.json(); } catch { /* Edge Function má vždy vracet JSON. */ }
    if (!response.ok || !result?.ok) throw new Error(result?.error || `Smazání selhalo (HTTP ${response.status}).`);
    return result;
  }

  async function openDelete(storeId) {
    resetModal();
    $('storeDeleteModal').classList.remove('hidden');
    try {
      const result = await invoke({ action: 'preview', store_id: storeId });
      selectedStore = result.store;
      const summary = result.summary || {};
      $('storeDeleteName').textContent = selectedStore.name || 'Obchod';
      $('storeDeleteSlug').textContent = selectedStore.slug || '';
      $('storeDeleteExpected').textContent = selectedStore.slug || '';
      $('storeDeleteOffers').textContent = Number(summary.offers || 0).toLocaleString('cs-CZ');
      $('storeDeleteSources').textContent = Number(summary.leaflet_sources || 0).toLocaleString('cs-CZ');
      $('storeDeleteImports').textContent = Number(summary.leaflet_imports || 0).toLocaleString('cs-CZ');
      $('storeDeleteFiles').textContent = Number(summary.archived_documents || 0).toLocaleString('cs-CZ');
      $('storeDeleteConfirmInput').disabled = !selectedStore.slug;
      message(selectedStore.slug ? 'Opsáním slugu odemkneš trvalé smazání.' : 'Obchod nemá slug a nelze ho bezpečně smazat.', selectedStore.slug ? '' : 'error');
      if (selectedStore.slug) $('storeDeleteConfirmInput').focus();
    } catch (error) {
      message(error.message || 'Související data se nepodařilo načíst.', 'error');
    }
  }

  async function confirmDelete() {
    if (!selectedStore?.id || $('storeDeleteConfirmInput').value.trim() !== selectedStore.slug) return;
    const button = $('storeDeleteConfirm');
    button.disabled = true;
    button.textContent = 'Mažu obchod…';
    $('storeDeleteConfirmInput').disabled = true;
    message('Probíhá trvalé smazání. Nezavírej stránku.');
    try {
      const result = await invoke({
        action: 'delete',
        store_id: selectedStore.id,
        confirmation: selectedStore.slug,
      });
      clearPublicCache();
      const warning = Array.isArray(result.warnings) && result.warnings.length
        ? ` Obchod byl smazán, ale úklid archivu hlásí: ${result.warnings.join(' | ')}`
        : '';
      message(`Obchod „${selectedStore.name}“ byl trvale smazán.${warning}`, warning ? 'error' : 'ok');
      document.querySelector(`[data-store-card="${selectedStore.id}"]`)?.remove();
      document.getElementById('storeRefresh')?.click();
      document.getElementById('reload')?.click();
      setTimeout(() => window.location.reload(), 1100);
    } catch (error) {
      message(error.message || 'Obchod se nepodařilo smazat.', 'error');
      $('storeDeleteConfirmInput').disabled = false;
      button.textContent = 'Trvale smazat obchod';
      updateConfirmationState();
    }
  }

  async function currentRole() {
    try {
      const activeSession = await session();
      return activeSession.user.app_metadata?.role || '';
    } catch {
      return '';
    }
  }

  async function enhanceStoreCards() {
    if (enhancing) return;
    enhancing = true;
    try {
      const role = await currentRole();
      if (role !== 'admin') return;
      const notice = document.querySelector('#storesPage .storeNotice');
      if (notice && !notice.querySelector('.storeDeleteAdminNote')) {
        notice.insertAdjacentHTML('beforeend', '<span class="storeDeleteAdminNote">Trvalé smazání je dostupné pouze administrátorovi a vyžaduje opsání slugu.</span>');
      }
      document.querySelectorAll('#storesList [data-store-card]').forEach((card) => {
        const actions = card.querySelector('.actions');
        const storeId = card.dataset.storeCard;
        if (!actions || !storeId || actions.querySelector('[data-store-permanent-delete]')) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'storePermanentDeleteBtn';
        button.dataset.storePermanentDelete = storeId;
        button.textContent = '🗑️ Smazat obchod';
        button.addEventListener('click', () => openDelete(storeId));
        actions.append(button);
      });
    } finally {
      enhancing = false;
    }
  }

  function scheduleEnhance() {
    clearTimeout(enhanceTimer);
    enhanceTimer = window.setTimeout(enhanceStoreCards, 30);
  }

  function init() {
    if (!window.supabase || !$('storesList')) return;
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    installStyles();
    installModal();
    new MutationObserver(scheduleEnhance).observe($('storesList'), { childList: true, subtree: true });
    scheduleEnhance();
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
