(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const UPLOAD_FUNCTION = 'manual-leaflet-upload-v2';
  const MAX_FILE_SIZE = 8 * 1024 * 1024;
  const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif'];
  const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const ACTIVE_STATUSES = new Set(['queued', 'downloading', 'processing', 'publishing']);
  const SUCCESS_STATUSES = new Set(['review', 'published']);

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const formatBytes = (value) => {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} kB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  };
  const formatDate = (value) => value
    ? new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
    : '—';

  let db;
  let session;
  let queue = [];
  let uploading = false;
  let backendReady = false;
  let refreshTimer = 0;
  let healthTimer = 0;

  function setMessage(text = '', type = 'info') {
    const box = $('uploadMessage');
    if (!box) return;
    box.hidden = !text;
    box.textContent = text;
    box.className = `message ${type}`;
  }

  function extension(file) {
    return file.name.split('.').pop()?.toLowerCase() || '';
  }

  function validateFile(file) {
    if (!file?.size) throw new Error(`${file?.name || 'Soubor'} je prázdný.`);
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`${file.name} má ${formatBytes(file.size)}. Maximální velikost jednoho souboru je 8 MB.`);
    }
    if (!ALLOWED_EXTENSIONS.includes(extension(file)) && !ALLOWED_TYPES.includes(file.type)) {
      throw new Error(`${file.name} není podporovaný PDF nebo obrázek.`);
    }
  }

  function queueItem(file) {
    return {
      id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
      file,
      status: 'ready',
      progress: 0,
      message: 'Připraveno',
      importId: '',
      monitorToken: '',
    };
  }

  function addFiles(fileList) {
    const incoming = [...(fileList || [])];
    if (!incoming.length) return;
    const errors = [];
    let added = 0;
    for (const file of incoming) {
      try {
        validateFile(file);
        const duplicate = queue.some((item) => item.file.name === file.name && item.file.size === file.size);
        if (!duplicate) {
          queue.push(queueItem(file));
          added++;
        }
      } catch (error) {
        errors.push(error.message || String(error));
      }
    }
    renderQueue();
    if (errors.length) setMessage(errors.join(' '), 'err');
    else setMessage(`${added} souborů bylo přidáno do fronty.`, 'ok');
  }

  function statusLabel(item) {
    if (item.status === 'hashing') return 'Kontroluji';
    if (item.status === 'uploading') return 'Nahrávám';
    if (item.status === 'queued') return 'Ve frontě';
    if (item.status === 'downloading') return 'Načítám';
    if (item.status === 'processing') return 'AI zpracování';
    if (item.status === 'publishing') return 'Publikuji';
    if (item.status === 'review') return 'Ke kontrole';
    if (item.status === 'published') return 'Publikováno';
    if (item.status === 'duplicate') return 'Už existuje';
    if (item.status === 'failed') return 'Chyba';
    if (item.status === 'ignored') return 'Přeskočeno';
    return 'Připraveno';
  }

  function renderQueue() {
    const target = $('uploadQueue');
    if (!target) return;
    $('uploadCount').textContent = queue.length ? `${queue.length} souborů` : 'Prázdná fronta';
    $('uploadButton').disabled = !backendReady || uploading || !queue.some((item) => item.status === 'ready' || item.status === 'failed');
    $('clearButton').disabled = uploading || !queue.length;

    if (!queue.length) {
      target.innerHTML = '<div class="queueEmpty"><div><strong>Zatím nejsou vybrané žádné letáky.</strong><br><small>Přetáhni sem PDF nebo obrázky do 8 MB.</small></div></div>';
      return;
    }

    target.innerHTML = queue.map((item) => `
      <div class="queueItem" data-queue-id="${esc(item.id)}">
        <span class="fileIcon">${extension(item.file) === 'pdf' ? 'PDF' : 'IMG'}</span>
        <div class="queueCopy">
          <strong title="${esc(item.file.name)}">${esc(item.file.name)}</strong>
          <small>${formatBytes(item.file.size)} · ${esc(item.message || statusLabel(item))}</small>
          <div class="progress"><span style="width:${Math.max(0, Math.min(100, item.progress || 0))}%"></span></div>
        </div>
        <div class="queueStatus">
          <span class="statusPill ${item.status === 'failed' ? 'failed' : SUCCESS_STATUSES.has(item.status) ? 'processing' : ''}">${statusLabel(item)}</span>
          <button class="removeFile" type="button" data-remove-file="${esc(item.id)}" aria-label="Odebrat soubor" ${uploading || ['hashing', 'uploading'].includes(item.status) ? 'disabled' : ''}>×</button>
        </div>
      </div>`).join('');
  }

  async function sha256(file) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function responsePayload(response) {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); }
    catch { return { error: text.slice(0, 1000) }; }
  }

  async function currentAccessToken() {
    const auth = await db.auth.getSession();
    session = auth.data.session;
    if (!session?.access_token) throw new Error('Přihlášení vypršelo. Přihlas se znovu do administrace.');
    return session.access_token;
  }

  async function checkBackendHealth({ quiet = false } = {}) {
    try {
      const token = await currentAccessToken();
      const response = await fetch(`${SUPABASE_URL}/functions/v1/${UPLOAD_FUNCTION}?health=1&t=${Date.now()}`, {
        method: 'GET',
        headers: {
          apikey: SUPABASE_KEY,
          authorization: `Bearer ${token}`,
        },
        cache: 'no-store',
      });
      const payload = await responsePayload(response);
      if (!response.ok || payload?.ok !== true || payload?.upload !== 'ready' || payload?.processor !== 'ready') {
        throw new Error(payload?.error || `Serverový import není připravený (HTTP ${response.status}).`);
      }
      backendReady = true;
      renderQueue();
      if (!quiet) setMessage('Serverové nahrávání i procesor letáků jsou připravené.', 'ok');
      return true;
    } catch (error) {
      backendReady = false;
      renderQueue();
      setMessage(`Nahrávání je dočasně vypnuté: ${error?.message || error}`, 'err');
      return false;
    }
  }

  async function callUploadFunction(body, json = false) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 120_000);
    try {
      const headers = {
        authorization: `Bearer ${await currentAccessToken()}`,
        apikey: SUPABASE_KEY,
      };
      if (json) headers['content-type'] = 'application/json';
      const response = await fetch(`${SUPABASE_URL}/functions/v1/${UPLOAD_FUNCTION}`, {
        method: 'POST',
        headers,
        body: json ? JSON.stringify(body) : body,
        signal: controller.signal,
      });
      const payload = await responsePayload(response);
      if (!response.ok || payload?.ok === false || payload?.error) {
        throw new Error(payload?.error || `Server vrátil HTTP ${response.status}.`);
      }
      return payload;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('Server neodpověděl do 120 sekund.');
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function statusProgress(status) {
    if (status === 'queued') return 78;
    if (status === 'downloading') return 84;
    if (status === 'processing') return 92;
    if (status === 'publishing') return 97;
    return 100;
  }

  function statusMessage(status, errorMessage = '') {
    if (status === 'queued') return 'Import čeká ve frontě.';
    if (status === 'downloading') return 'Server načítá bezpečně uložený soubor.';
    if (status === 'processing') return 'AI rozpoznává produkty, ceny a platnost.';
    if (status === 'publishing') return 'Kvalitní výsledek se publikuje.';
    if (status === 'review') return 'Hotovo. Výsledek je připravený ke kontrole.';
    if (status === 'published') return 'Hotovo. Nabídky byly publikovány.';
    if (status === 'failed') return errorMessage || 'Zpracování skončilo chybou.';
    if (status === 'ignored') return 'Import byl přeskočen.';
    return `Stav importu: ${status || 'neznámý'}.`;
  }

  async function monitorImport(item) {
    const token = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    item.monitorToken = token;
    const deadline = Date.now() + 10 * 60 * 1000;
    let consecutiveErrors = 0;

    while (item.monitorToken === token && queue.includes(item) && Date.now() < deadline) {
      const result = await db.from('leaflet_imports')
        .select('status,error_message,product_count,updated_at')
        .eq('id', item.importId)
        .maybeSingle();

      if (result.error) {
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          item.message = `Import běží, ale nepodařilo se ověřit stav: ${result.error.message}`;
          renderQueue();
        }
      } else if (result.data) {
        consecutiveErrors = 0;
        const status = String(result.data.status || '');
        item.status = status;
        item.progress = statusProgress(status);
        item.message = statusMessage(status, result.data.error_message || '');
        renderQueue();

        if (SUCCESS_STATUSES.has(status)) {
          await loadRecent();
          return;
        }
        if (status === 'failed' || status === 'ignored') {
          item.progress = status === 'failed' ? 0 : 100;
          renderQueue();
          await loadRecent();
          return;
        }
      }
      await sleep(3000);
    }

    if (item.monitorToken === token && queue.includes(item) && ACTIVE_STATUSES.has(item.status)) {
      item.message = 'Zpracování stále běží. Aktuální stav uvidíš v posledních importech.';
      renderQueue();
    }
  }

  async function uploadOne(item, storeId, autoPublish) {
    item.status = 'hashing';
    item.progress = 10;
    item.message = 'Počítám kontrolní otisk a ověřuji duplicitu…';
    renderQueue();

    const hash = await sha256(item.file);
    item.status = 'uploading';
    item.progress = 35;
    item.message = 'Posílám soubor zabezpečenému serverovému uploadu…';
    renderQueue();

    const form = new FormData();
    form.append('action', 'upload');
    form.append('store_id', storeId);
    form.append('sha256', hash);
    form.append('auto_publish', String(Boolean(autoPublish)));
    form.append('file', item.file, item.file.name);

    const result = await callUploadFunction(form);
    item.importId = result.import_id || '';
    if (!item.importId) throw new Error('Server nevrátil identifikátor importu.');

    const status = String(result.status || 'queued');
    item.status = status;
    item.progress = statusProgress(status);
    item.message = result.message || statusMessage(status);
    renderQueue();

    if (result.duplicate && !ACTIVE_STATUSES.has(status) && !SUCCESS_STATUSES.has(status)) {
      item.status = 'duplicate';
      item.progress = 100;
      item.message = result.message || 'Stejný leták už je v systému.';
      renderQueue();
      return;
    }

    if (ACTIVE_STATUSES.has(status)) void monitorImport(item);
  }

  async function uploadQueue() {
    if (uploading) return;
    if (!backendReady && !await checkBackendHealth()) return;

    const storeId = $('storeSelect').value;
    if (!storeId) {
      setMessage('Nejdřív vyber obchod, kterému letáky patří.', 'err');
      return;
    }
    const pending = queue.filter((item) => item.status === 'ready' || item.status === 'failed');
    if (!pending.length) return;

    uploading = true;
    setMessage(`Nahrávám ${pending.length} souborů. Nezavírej stránku.`, 'info');
    renderQueue();
    let accepted = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        validateFile(item.file);
        await uploadOne(item, storeId, $('autoPublish').checked);
        accepted++;
      } catch (error) {
        item.status = 'failed';
        item.progress = 0;
        item.message = error?.message || 'Nahrání selhalo.';
        failed++;
      }
      renderQueue();
    }

    uploading = false;
    renderQueue();
    setMessage(failed
      ? `Dokončeno: ${accepted} souborů přijato, ${failed} souborů skončilo chybou. Přesná chyba je uvedená u souboru.`
      : `Všech ${accepted} souborů bylo bezpečně nahráno a procesor potvrdil jejich převzetí.`, failed ? 'err' : 'ok');
    await loadRecent();
  }

  function importStatus(status) {
    const labels = {
      queued: 'Ve frontě', downloading: 'Načítám soubor', processing: 'AI zpracování', review: 'Ke kontrole',
      publishing: 'Publikuji', published: 'Publikováno', failed: 'Chyba', ignored: 'Přeskočeno',
    };
    return labels[status] || status || 'Neznámý stav';
  }

  function recentHtml(row) {
    const metadata = row.metadata || {};
    const retry = row.status === 'failed' && metadata.storage_bucket === 'leaflets' && metadata.storage_path;
    return `<article class="recentItem">
      <div>
        <strong>${esc(metadata.original_filename || 'Nahraný leták')}</strong>
        <div class="recentMeta">${esc(row.stores?.name || 'Neznámý obchod')} · ${formatBytes(metadata.file_size)} · nahráno ${formatDate(row.created_at)}</div>
        ${row.error_message ? `<div class="recentError">${esc(row.error_message)}</div>` : ''}
      </div>
      <div class="recentActions">
        <span class="statusPill ${esc(row.status)}">${esc(importStatus(row.status))}</span>
        ${retry ? `<button class="miniBtn" type="button" data-retry-import="${esc(row.id)}">Zkusit znovu</button>` : ''}
      </div>
    </article>`;
  }

  async function loadRecent() {
    const target = $('recentList');
    if (!target || !session) return;
    const result = await db.from('leaflet_imports')
      .select('id,store_id,status,error_message,metadata,created_at,updated_at,stores(name)')
      .contains('metadata', { manual_upload: true })
      .order('created_at', { ascending: false })
      .limit(30);
    if (result.error) {
      target.innerHTML = `<div class="queueEmpty">${esc(result.error.message)}</div>`;
      return;
    }
    target.innerHTML = (result.data || []).map(recentHtml).join('') || '<div class="queueEmpty">Zatím nebyl ručně nahrán žádný leták.</div>';
    window.__manualLeafletImports = result.data || [];
  }

  async function retryImport(id) {
    const button = document.querySelector(`[data-retry-import="${CSS.escape(id)}"]`);
    if (button) {
      button.disabled = true;
      button.textContent = 'Spouštím…';
    }
    try {
      if (!backendReady && !await checkBackendHealth()) throw new Error('Serverový import není připravený.');
      const result = await callUploadFunction({ action: 'retry', import_id: id }, true);
      setMessage(`Import byl znovu spuštěn. Aktuální stav: ${importStatus(result.status)}.`, 'ok');
      await loadRecent();
    } catch (error) {
      setMessage(error?.message || 'Import se nepodařilo znovu spustit.', 'err');
      if (button) {
        button.disabled = false;
        button.textContent = 'Zkusit znovu';
      }
    }
  }

  async function loadStores() {
    const select = $('storeSelect');
    const result = await db.from('stores')
      .select('id,name,slug')
      .eq('is_active', true)
      .order('name');
    if (result.error) throw result.error;
    select.innerHTML = '<option value="">Vyber obchod…</option>' + (result.data || [])
      .map((store) => `<option value="${esc(store.id)}">${esc(store.name)}</option>`).join('');
  }

  function bind() {
    const fileInput = $('fileInput');
    const dropZone = $('dropZone');
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener('change', () => {
      addFiles(fileInput.files);
      fileInput.value = '';
    });
    ['dragenter', 'dragover'].forEach((name) => dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.add('drag');
    }));
    ['dragleave', 'drop'].forEach((name) => dropZone.addEventListener(name, (event) => {
      event.preventDefault();
      dropZone.classList.remove('drag');
    }));
    dropZone.addEventListener('drop', (event) => addFiles(event.dataTransfer?.files));
    $('uploadButton').addEventListener('click', uploadQueue);
    $('clearButton').addEventListener('click', () => {
      if (uploading) return;
      queue.forEach((item) => { item.monitorToken = ''; });
      queue = [];
      renderQueue();
      setMessage('', 'info');
    });
    $('logoutButton').addEventListener('click', async () => {
      await db.auth.signOut();
      location.href = 'admin.html';
    });
    document.addEventListener('click', (event) => {
      const remove = event.target.closest?.('[data-remove-file]');
      if (remove && !uploading) {
        const item = queue.find((entry) => entry.id === remove.dataset.removeFile);
        if (item) item.monitorToken = '';
        queue = queue.filter((entry) => entry.id !== remove.dataset.removeFile);
        renderQueue();
      }
      const retry = event.target.closest?.('[data-retry-import]');
      if (retry) retryImport(retry.dataset.retryImport);
    });
  }

  async function init() {
    if (!window.supabase) {
      $('authState').classList.remove('hidden');
      $('authState').innerHTML = '<h1>Nepodařilo se načíst Supabase</h1><p>Obnov stránku přes Ctrl + F5.</p>';
      return;
    }
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const auth = await db.auth.getSession();
    session = auth.data.session;
    const role = session?.user?.app_metadata?.role || '';
    if (!session || !['admin', 'editor'].includes(role)) {
      $('authState').classList.remove('hidden');
      $('authState').innerHTML = '<h1>Je potřeba přihlášení</h1><p>Přihlas se v hlavní administraci účtem admin nebo editor.</p><a class="btn primary" href="admin.html">Otevřít přihlášení</a>';
      return;
    }

    $('app').classList.remove('hidden');
    $('who').textContent = `${session.user.email} · ${role}`;
    bind();
    renderQueue();
    setMessage('Ověřuji serverové nahrávání a procesor letáků…', 'info');

    const healthOk = await checkBackendHealth({ quiet: true });
    try {
      await Promise.all([loadStores(), loadRecent()]);
      if (healthOk) setMessage('Systém je připravený. Vyber obchod a nahraj leták.', 'ok');
    } catch (error) {
      setMessage(error?.message || 'Administraci se nepodařilo načíst.', 'err');
    }

    refreshTimer = window.setInterval(loadRecent, 5000);
    healthTimer = window.setInterval(() => checkBackendHealth({ quiet: true }), 60_000);
    window.addEventListener('beforeunload', (event) => {
      if (!uploading) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  window.addEventListener('pagehide', () => {
    window.clearInterval(refreshTimer);
    window.clearInterval(healthTimer);
    queue.forEach((item) => { item.monitorToken = ''; });
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();