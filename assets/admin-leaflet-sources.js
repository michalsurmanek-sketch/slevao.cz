window.addEventListener('DOMContentLoaded', () => {
  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const db = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY);
  const modal = document.getElementById('storeEditModal');
  const form = document.getElementById('storeEditForm');
  const storeIdInput = document.getElementById('storeEditId');
  const storeNameInput = document.getElementById('storeEditName');
  const storeWebInput = document.getElementById('storeEditWeb');
  const storeSaveButton = document.getElementById('storeEditSave');

  if (!db || !modal || !form || !storeIdInput || !storeSaveButton) return;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const nullable = (value) => String(value || '').trim() || null;
  const formatDate = (value) => value
    ? new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
    : 'Ještě nekontrolováno';

  const section = document.createElement('section');
  section.className = 'leafletSourceManager';
  section.innerHTML = `
    <div class="leafletSourceHead">
      <div>
        <h3>📰 Zdroje letáků</h3>
        <p>Sem vlož oficiální stránku letáku nebo přímé PDF. Automat bude aktivní zdroje pravidelně kontrolovat.</p>
      </div>
      <span id="leafletSourceCount" class="leafletSourceCount">0 zdrojů</span>
    </div>

    <div id="leafletSourceList" class="leafletSourceList"><div class="leafletSourceEmpty">Načítám zdroje…</div></div>

    <div class="leafletSourceEditor">
      <input id="leafletSourceId" type="hidden">
      <div class="field">
        <label for="leafletSourceName">Název zdroje</label>
        <input id="leafletSourceName" placeholder="Například Oficiální akční leták">
      </div>
      <div class="field">
        <label for="leafletSourceUrl">URL zdroje letáků</label>
        <div class="leafletSourceUrlRow">
          <input id="leafletSourceUrl" type="url" placeholder="https://www.obchod.cz/akcni-letak" required>
          <button id="leafletUseStoreWeb" class="leafletMiniButton" type="button">Použít web</button>
        </div>
        <span class="fieldHint">Může to být stránka s letákem, přímé PDF nebo JSON feed.</span>
      </div>
      <div class="leafletSourceGrid">
        <div class="field">
          <label for="leafletSourceType">Typ zdroje</label>
          <select id="leafletSourceType">
            <option value="html">Webová stránka</option>
            <option value="pdf">Přímé PDF</option>
            <option value="json">JSON feed</option>
          </select>
        </div>
        <div class="field">
          <label for="leafletSourceInterval">Kontrola každých</label>
          <select id="leafletSourceInterval">
            <option value="180">3 hodiny</option>
            <option value="360" selected>6 hodin</option>
            <option value="720">12 hodin</option>
            <option value="1440">24 hodin</option>
          </select>
        </div>
      </div>
      <div class="switchRow leafletSourceSwitch">
        <div><strong>Automaticky kontrolovat tento zdroj</strong><div class="fieldHint">Vypnutý zdroj zůstane uložený, ale automat ho nebude používat.</div></div>
        <label class="switch"><input id="leafletSourceActive" type="checkbox" checked><span></span></label>
      </div>
      <div class="leafletSourceActions">
        <button id="leafletSourceSave" class="btn primary" type="button">Přidat zdroj</button>
        <button id="leafletSourceCancel" class="btn light hidden" type="button">Zrušit úpravu</button>
      </div>
      <div id="leafletSourceMsg" class="msg"></div>
    </div>
  `;
  form.insertBefore(section, storeSaveButton);

  const $ = (id) => document.getElementById(id);
  let sources = [];
  let loadedStoreId = '';

  function showMessage(text, type = 'ok') {
    const target = $('leafletSourceMsg');
    target.textContent = text;
    target.className = `msg ${type}`;
  }

  function clearMessage() {
    $('leafletSourceMsg').className = 'msg';
    $('leafletSourceMsg').textContent = '';
  }

  function resetEditor() {
    $('leafletSourceId').value = '';
    $('leafletSourceName').value = '';
    $('leafletSourceUrl').value = '';
    $('leafletSourceType').value = 'html';
    $('leafletSourceInterval').value = '360';
    $('leafletSourceActive').checked = true;
    $('leafletSourceSave').textContent = 'Přidat zdroj';
    $('leafletSourceCancel').classList.add('hidden');
    clearMessage();
  }

  function renderSources() {
    $('leafletSourceCount').textContent = `${sources.length} ${sources.length === 1 ? 'zdroj' : sources.length >= 2 && sources.length <= 4 ? 'zdroje' : 'zdrojů'}`;
    $('leafletSourceList').innerHTML = sources.length ? sources.map((source) => `
      <article class="leafletSourceItem ${source.is_active ? '' : 'isInactive'}">
        <div class="leafletSourceStatus">${source.is_active ? '● Aktivní' : '○ Vypnutý'}</div>
        <div class="leafletSourceInfo">
          <strong>${escapeHtml(source.name || 'Zdroj letáku')}</strong>
          <a href="${escapeHtml(source.source_url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.source_url)}</a>
          <small>${source.source_type.toUpperCase()} · kontrola po ${Number(source.check_interval_minutes || 360) / 60} h · ${escapeHtml(formatDate(source.last_success_at || source.last_checked_at))}</small>
          ${source.last_error ? `<small class="leafletSourceError">Poslední chyba: ${escapeHtml(source.last_error)}</small>` : ''}
        </div>
        <div class="leafletSourceItemActions">
          <button type="button" data-leaflet-edit="${source.id}">✏️ Upravit</button>
          <button type="button" data-leaflet-toggle="${source.id}">${source.is_active ? '⏸ Vypnout' : '▶ Zapnout'}</button>
          <a href="${escapeHtml(source.source_url)}" target="_blank" rel="noopener noreferrer">↗ Otevřít</a>
          <button type="button" class="dangerBtn" data-leaflet-delete="${source.id}">🗑 Smazat</button>
        </div>
      </article>
    `).join('') : '<div class="leafletSourceEmpty"><strong>Zatím není přidaný žádný zdroj.</strong><span>Vlož níže oficiální stránku letáku nebo přímé PDF.</span></div>';

    $('leafletSourceList').querySelectorAll('[data-leaflet-edit]').forEach((button) => button.addEventListener('click', () => editSource(button.dataset.leafletEdit)));
    $('leafletSourceList').querySelectorAll('[data-leaflet-toggle]').forEach((button) => button.addEventListener('click', () => toggleSource(button.dataset.leafletToggle)));
    $('leafletSourceList').querySelectorAll('[data-leaflet-delete]').forEach((button) => button.addEventListener('click', () => deleteSource(button.dataset.leafletDelete)));
  }

  async function loadSources(force = false) {
    const storeId = storeIdInput.value;
    if (!storeId) return;
    if (!force && storeId === loadedStoreId && sources.length) return;
    loadedStoreId = storeId;
    $('leafletSourceList').innerHTML = '<div class="leafletSourceEmpty">Načítám zdroje…</div>';
    const { data, error } = await db.from('leaflet_sources')
      .select('id,name,source_url,source_type,is_active,auto_publish,check_interval_minutes,last_checked_at,last_success_at,last_error')
      .eq('store_id', storeId)
      .order('created_at', { ascending: true });
    if (error) {
      sources = [];
      $('leafletSourceList').innerHTML = `<div class="leafletSourceEmpty leafletSourceError">${escapeHtml(error.message)}</div>`;
      return;
    }
    sources = data || [];
    renderSources();
    resetEditor();
  }

  function editSource(id) {
    const source = sources.find((item) => item.id === id);
    if (!source) return;
    $('leafletSourceId').value = source.id;
    $('leafletSourceName').value = source.name || '';
    $('leafletSourceUrl').value = source.source_url || '';
    $('leafletSourceType').value = source.source_type || 'html';
    $('leafletSourceInterval').value = String(source.check_interval_minutes || 360);
    $('leafletSourceActive').checked = Boolean(source.is_active);
    $('leafletSourceSave').textContent = 'Uložit zdroj';
    $('leafletSourceCancel').classList.remove('hidden');
    clearMessage();
    $('leafletSourceUrl').focus();
  }

  async function saveSource() {
    const storeId = storeIdInput.value;
    const id = $('leafletSourceId').value;
    const sourceUrl = $('leafletSourceUrl').value.trim();
    if (!storeId) return showMessage('Nejdřív otevři obchod k úpravě.', 'err');
    try { new URL(sourceUrl); } catch { return showMessage('Zadej platnou URL adresu zdroje.', 'err'); }

    const sourceType = $('leafletSourceType').value;
    const payload = {
      store_id: storeId,
      name: nullable($('leafletSourceName').value) || `${storeNameInput?.value || 'Obchod'} – leták`,
      source_url: sourceUrl,
      source_type: sourceType,
      is_active: $('leafletSourceActive').checked,
      auto_publish: false,
      check_interval_minutes: Number($('leafletSourceInterval').value || 360),
    };

    $('leafletSourceSave').disabled = true;
    const result = id
      ? await db.from('leaflet_sources').update(payload).eq('id', id)
      : await db.from('leaflet_sources').insert(payload);
    $('leafletSourceSave').disabled = false;
    if (result.error) return showMessage(result.error.message, 'err');

    showMessage(id ? 'Zdroj letáku byl upraven.' : 'Zdroj letáku byl přidán. Automat ho zkontroluje při dalším běhu.');
    await loadSources(true);
  }

  async function toggleSource(id) {
    const source = sources.find((item) => item.id === id);
    if (!source) return;
    const { error } = await db.from('leaflet_sources').update({ is_active: !source.is_active }).eq('id', id);
    if (error) return showMessage(error.message, 'err');
    await loadSources(true);
  }

  async function deleteSource(id) {
    const source = sources.find((item) => item.id === id);
    if (!source || !confirm(`Opravdu smazat zdroj „${source.name || source.source_url}“? Již stažené letáky a nabídky se tím nesmažou.`)) return;
    const { error } = await db.from('leaflet_sources').delete().eq('id', id);
    if (error) return showMessage(error.message, 'err');
    await loadSources(true);
    showMessage('Zdroj byl odstraněn.');
  }

  $('leafletSourceSave').addEventListener('click', saveSource);
  $('leafletSourceCancel').addEventListener('click', resetEditor);
  $('leafletUseStoreWeb').addEventListener('click', () => {
    const value = storeWebInput?.value.trim();
    if (!value) return showMessage('U obchodu zatím není vyplněný web.', 'err');
    $('leafletSourceUrl').value = value;
    $('leafletSourceUrl').focus();
  });
  $('leafletSourceUrl').addEventListener('input', () => {
    const value = $('leafletSourceUrl').value.toLowerCase();
    if (/\.pdf(?:[?#]|$)/.test(value)) $('leafletSourceType').value = 'pdf';
    else if (/\.json(?:[?#]|$)/.test(value)) $('leafletSourceType').value = 'json';
  });

  const observer = new MutationObserver(() => {
    if (!modal.classList.contains('hidden')) {
      loadedStoreId = '';
      setTimeout(() => loadSources(true), 0);
    }
  });
  observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
});
