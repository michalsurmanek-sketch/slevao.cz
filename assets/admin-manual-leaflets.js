(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const MAX_INLINE_FILE_SIZE = 4 * 1024 * 1024;
  const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif'];
  const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  const ACTIVE_IMPORT_STATUSES = ['queued', 'downloading', 'processing', 'review', 'publishing', 'published'];

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
  let stores = new Map();
  let uploading = false;
  let refreshTimer = 0;

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
    if (file.size > MAX_INLINE_FILE_SIZE) {
      throw new Error(`${file.name} má ${formatBytes(file.size)}. Spolehlivý přímý import nyní podporuje maximálně 4 MB na jeden soubor; větší PDF rozděl na jednotlivé stránky nebo zmenši.`);
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
    if (item.status === 'encoding') return 'Připravuji';
    if (item.status === 'registering') return 'Zakládám import';
    if (item.status === 'starting') return 'Spouštím AI';
    if (item.status === 'done') return 'Zpracovává se';
    if (item.status === 'duplicate') return 'Už existuje';
    if (item.status === 'failed') return 'Chyba';
    return 'Připraveno';
  }

  function renderQueue() {
    const target = $('uploadQueue');
    if (!target) return;
    $('uploadCount').textContent = queue.length ? `${queue.length} souborů` : 'Prázdná fronta';
    $('uploadButton').disabled = uploading || !queue.some((item) => item.status === 'ready' || item.status === 'failed');
    $('clearButton').disabled = uploading || !queue.length;

    if (!queue.length) {
      target.innerHTML = '<div class="queueEmpty"><div><strong>Zatím nejsou vybrané žádné letáky.</strong><br><small>Přetáhni sem PDF nebo obrázky do 4 MB.</small></div></div>';
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
          <span class="statusPill ${item.status === 'failed' ? 'failed' : item.status === 'done' ? 'processing' : ''}">${statusLabel(item)}</span>
          <button class="removeFile" type="button" data-remove-file="${esc(item.id)}" aria-label="Odebrat soubor" ${uploading || !['ready','failed','duplicate','done'].includes(item.status) ? 'disabled' : ''}>×</button>
        </div>
      </div>`).join('');
  }

  async function sha256(file) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function fileToDataUrl(file) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error || new Error('Soubor se nepodařilo načíst.'));
      reader.onload = () => resolve(String(reader.result || ''));
      reader.readAsDataURL(file);
    });
  }

  async function detailedError(error, fallback = 'Operace se nepodařila.') {
    if (!error) return fallback;
    const response = error.context instanceof Response ? error.context : null;
    if (response) {
      try {
        const payload = await response.clone().json();
        if (payload?.error) return String(payload.error);
        if (payload?.message) return String(payload.message);
      } catch {
        try {
          const text = await response.clone().text();
          if (text.trim()) return text.trim().slice(0, 1000);
        } catch {}
      }
    }
    return String(error.message || error || fallback);
  }

  async function ensureManualSource(storeId) {
    const store = stores.get(storeId);
    if (!store) throw new Error('Vybraný obchod nebyl nalezen.');
    const sourceUrl = `manual-inline://${storeId}`;
    const existing = await db.from('leaflet_sources').select('id').eq('source_url', sourceUrl).maybeSingle();
    if (existing.error) throw existing.error;
    if (existing.data?.id) return existing.data.id;

    const created = await db.from('leaflet_sources').insert({
      store_id: storeId,
      name: `${store.name} – ruční nahrání`,
      source_url: sourceUrl,
      source_type: 'pdf',
      is_active: false,
      auto_publish: false,
      check_interval_minutes: 525600,
    }).select('id').single();
    if (!created.error && created.data?.id) return created.data.id;

    const raced = await db.from('leaflet_sources').select('id').eq('source_url', sourceUrl).maybeSingle();
    if (raced.error || !raced.data?.id) throw created.error || raced.error || new Error('Ruční zdroj se nepodařilo založit.');
    return raced.data.id;
  }

  async function registerInlineImport({ storeId, sourceId, hash, dataUrl, file, autoPublish }) {
    const sourceHash = `manual-inline:${storeId}:${hash}`;
    const existingResult = await db.from('leaflet_imports')
      .select('id,status,metadata')
      .eq('source_hash', sourceHash)
      .maybeSingle();
    if (existingResult.error) throw existingResult.error;

    const existing = existingResult.data;
    if (existing && ACTIVE_IMPORT_STATUSES.includes(existing.status)) {
      return {
        duplicate: true,
        importId: existing.id,
        status: existing.status,
        message: existing.status === 'published'
          ? 'Stejný soubor už byl zpracován a publikován.'
          : 'Stejný soubor už je v systému.',
      };
    }

    const metadata = {
      ...(existing?.metadata || {}),
      manual_upload: true,
      inline_document: true,
      original_filename: file.name,
      content_type: file.type || 'application/octet-stream',
      file_size: file.size,
      sha256: hash,
      auto_publish: autoPublish,
      uploaded_by: session.user.id,
      uploaded_by_email: session.user.email || null,
      uploaded_at: new Date().toISOString(),
      upload_transport: 'database-data-url',
    };

    if (existing) {
      const updated = await db.from('leaflet_imports').update({
        source_id: sourceId,
        store_id: storeId,
        source_document_url: dataUrl,
        status: 'queued',
        error_message: null,
        started_at: null,
        finished_at: null,
        metadata,
      }).eq('id', existing.id).select('id').single();
      if (updated.error) throw updated.error;
      return { duplicate: false, importId: updated.data.id, status: 'queued' };
    }

    const created = await db.from('leaflet_imports').insert({
      source_id: sourceId,
      store_id: storeId,
      source_document_url: dataUrl,
      source_hash: sourceHash,
      status: 'queued',
      metadata,
    }).select('id').single();
    if (created.error || !created.data?.id) throw created.error || new Error('Import se nepodařilo založit.');
    return { duplicate: false, importId: created.data.id, status: 'queued' };
  }

  async function startProcessor(importId) {
    const result = await db.functions.invoke('process-leaflet', { body: { import_id: importId } });
    if (!result.error && !result.data?.error) return result.data || { accepted: true };

    await sleep(900);
    const check = await db.from('leaflet_imports').select('status,error_message').eq('id', importId).maybeSingle();
    if (!check.error && check.data && ACTIVE_IMPORT_STATUSES.includes(check.data.status)) {
      return { accepted: true, status: check.data.status, recovered_after_network_error: true };
    }

    const message = result.data?.error || await detailedError(result.error, 'Procesor letáku se nepodařilo spustit.');
    await db.from('leaflet_imports').update({
      status: 'failed',
      error_message: String(message).slice(0, 2000),
      finished_at: new Date().toISOString(),
    }).eq('id', importId);
    throw new Error(message);
  }

  async function uploadOne(item, storeId, autoPublish) {
    item.status = 'hashing';
    item.progress = 10;
    item.message = 'Kontroluji duplicitu…';
    renderQueue();

    const hash = await sha256(item.file);
    item.status = 'encoding';
    item.progress = 34;
    item.message = 'Připravuji soubor bez závislosti na Storage…';
    renderQueue();
    const dataUrl = await fileToDataUrl(item.file);
    if (!dataUrl.startsWith('data:')) throw new Error('Soubor se nepodařilo převést pro zpracování.');

    item.status = 'registering';
    item.progress = 58;
    item.message = 'Zakládám import v databázi…';
    renderQueue();
    const sourceId = await ensureManualSource(storeId);
    const registered = await registerInlineImport({
      storeId,
      sourceId,
      hash,
      dataUrl,
      file: item.file,
      autoPublish,
    });
    item.importId = registered.importId;

    if (registered.duplicate) {
      item.status = 'duplicate';
      item.progress = 100;
      item.message = registered.message;
      return;
    }

    item.status = 'starting';
    item.progress = 82;
    item.message = 'Spouštím existující procesor letáků…';
    renderQueue();
    await startProcessor(item.importId);

    item.status = 'done';
    item.progress = 100;
    item.message = autoPublish
      ? 'Zpracování běží; kvalitní výsledek se publikuje automaticky.'
      : 'Zpracování běží; výsledek se zobrazí ke kontrole.';
  }

  async function uploadQueue() {
    if (uploading) return;
    const storeId = $('storeSelect').value;
    if (!storeId) {
      setMessage('Nejdřív vyber obchod, kterému letáky patří.', 'err');
      return;
    }
    const pending = queue.filter((item) => item.status === 'ready' || item.status === 'failed');
    if (!pending.length) return;

    uploading = true;
    setMessage(`Zpracovávám ${pending.length} souborů. Nezavírej stránku.`, 'info');
    renderQueue();
    let success = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        validateFile(item.file);
        await uploadOne(item, storeId, $('autoPublish').checked);
        success++;
      } catch (error) {
        item.status = 'failed';
        item.progress = 0;
        item.message = await detailedError(error, 'Zpracování souboru selhalo.');
        failed++;
      }
      renderQueue();
    }

    uploading = false;
    renderQueue();
    setMessage(failed
      ? `Dokončeno: ${success} souborů spuštěno, ${failed} souborů skončilo chybou. Přesná chyba je uvedená u souboru.`
      : `Všech ${success} souborů bylo předáno automatickému zpracování.`, failed ? 'err' : 'ok');
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
    const retry = row.status === 'failed';
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
    const row = (window.__manualLeafletImports || []).find((item) => item.id === id);
    if (!row) return;
    const button = document.querySelector(`[data-retry-import="${CSS.escape(id)}"]`);
    if (button) {
      button.disabled = true;
      button.textContent = 'Spouštím…';
    }
    try {
      await db.from('leaflet_imports').update({
        status: 'queued',
        error_message: null,
        started_at: null,
        finished_at: null,
      }).eq('id', id);
      await startProcessor(id);
      setMessage('Import byl znovu spuštěn.', 'ok');
      await loadRecent();
    } catch (error) {
      setMessage(await detailedError(error, 'Import se nepodařilo znovu spustit.'), 'err');
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
    stores = new Map((result.data || []).map((store) => [store.id, store]));
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
        queue = queue.filter((item) => item.id !== remove.dataset.removeFile);
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
    try {
      await Promise.all([loadStores(), loadRecent()]);
    } catch (error) {
      setMessage(await detailedError(error, 'Administraci se nepodařilo načíst.'), 'err');
    }
    refreshTimer = window.setInterval(loadRecent, 5000);
    window.addEventListener('beforeunload', (event) => {
      if (!uploading) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  window.addEventListener('pagehide', () => window.clearInterval(refreshTimer));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
