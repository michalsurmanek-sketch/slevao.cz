(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const BUCKET = 'manual-leaflets';
  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  const ALLOWED_EXTENSIONS = ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif'];
  const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
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
  let refreshTimer = 0;

  function setMessage(text = '', type = 'info') {
    const box = $('uploadMessage');
    if (!box) return;
    box.hidden = !text;
    box.textContent = text;
    box.className = `message ${type}`;
  }

  function safeName(name) {
    const dot = name.lastIndexOf('.');
    const ext = dot >= 0 ? name.slice(dot).toLowerCase() : '';
    const base = (dot >= 0 ? name.slice(0, dot) : name)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'letak';
    return `${base}${ext}`;
  }

  function extension(file) {
    return file.name.split('.').pop()?.toLowerCase() || '';
  }

  function validateFile(file) {
    if (!file?.size) throw new Error(`${file?.name || 'Soubor'} je prázdný.`);
    if (file.size > MAX_FILE_SIZE) throw new Error(`${file.name} je větší než 50 MB.`);
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
      storagePath: '',
    };
  }

  function addFiles(fileList) {
    const incoming = [...(fileList || [])];
    if (!incoming.length) return;
    const errors = [];
    for (const file of incoming) {
      try {
        validateFile(file);
        const duplicate = queue.some((item) => item.file.name === file.name && item.file.size === file.size);
        if (!duplicate) queue.push(queueItem(file));
      } catch (error) {
        errors.push(error.message || String(error));
      }
    }
    renderQueue();
    if (errors.length) setMessage(errors.join(' '), 'err');
    else setMessage(`${incoming.length} souborů bylo přidáno do fronty.`, 'ok');
  }

  function statusLabel(item) {
    if (item.status === 'hashing') return 'Kontroluji';
    if (item.status === 'uploading') return 'Nahrávám';
    if (item.status === 'registering') return 'Spouštím AI';
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
      target.innerHTML = '<div class="queueEmpty"><div><strong>Zatím nejsou vybrané žádné letáky.</strong><br><small>Přetáhni sem PDF nebo obrázky.</small></div></div>';
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
    const bytes = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  function storagePath(storeId, file) {
    const now = new Date();
    const year = String(now.getFullYear());
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${storeId}/${year}/${month}/${id}-${safeName(file.name)}`;
  }

  async function registerUpload(item, storeId, hash, autoPublish) {
    const { data, error } = await db.functions.invoke('register-manual-leaflet', {
      body: {
        store_id: storeId,
        storage_path: item.storagePath,
        original_filename: item.file.name,
        content_type: item.file.type || 'application/octet-stream',
        file_size: item.file.size,
        sha256: hash,
        auto_publish: autoPublish,
      },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  async function uploadOne(item, storeId, autoPublish) {
    item.status = 'hashing';
    item.progress = 8;
    item.message = 'Počítám kontrolní otisk…';
    renderQueue();

    const hash = await sha256(item.file);
    item.status = 'uploading';
    item.progress = 28;
    item.message = 'Nahrávám do bezpečného úložiště…';
    item.storagePath = storagePath(storeId, item.file);
    renderQueue();

    const { error: uploadError } = await db.storage.from(BUCKET).upload(item.storagePath, item.file, {
      cacheControl: '3600',
      contentType: item.file.type || undefined,
      upsert: false,
    });
    if (uploadError) throw uploadError;

    item.status = 'registering';
    item.progress = 72;
    item.message = 'Zakládám import a spouštím zpracování…';
    renderQueue();

    try {
      const result = await registerUpload(item, storeId, hash, autoPublish);
      item.importId = result.import_id || '';
      item.progress = 100;
      if (result.duplicate) {
        item.status = 'duplicate';
        item.message = result.message || 'Stejný leták už je v systému.';
      } else {
        item.status = 'done';
        item.message = autoPublish ? 'AI zpracování spuštěno; kvalitní výsledek se publikuje automaticky.' : 'AI zpracování spuštěno; výsledek půjde ke kontrole.';
      }
    } catch (error) {
      await db.storage.from(BUCKET).remove([item.storagePath]).catch(() => {});
      item.storagePath = '';
      throw error;
    }
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
    setMessage(`Nahrávám ${pending.length} souborů. Nezavírej stránku.`, 'info');
    renderQueue();
    let success = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        await uploadOne(item, storeId, $('autoPublish').checked);
        success++;
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
      ? `Dokončeno: ${success} souborů spuštěno, ${failed} souborů skončilo chybou.`
      : `Všech ${success} letáků bylo předáno automatickému zpracování.`, failed ? 'err' : 'ok');
    await loadRecent();
  }

  function importStatus(status) {
    const labels = {
      queued: 'Ve frontě', downloading: 'Stahuji', processing: 'AI zpracování', review: 'Ke kontrole',
      publishing: 'Publikuji', published: 'Publikováno', failed: 'Chyba', ignored: 'Přeskočeno',
    };
    return labels[status] || status || 'Neznámý stav';
  }

  function recentHtml(row) {
    const metadata = row.metadata || {};
    const retry = row.status === 'failed' && metadata.storage_path && metadata.sha256;
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
    const { data, error } = await db.from('leaflet_imports')
      .select('id,store_id,status,error_message,metadata,created_at,updated_at,stores(name)')
      .contains('metadata', { manual_upload: true })
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) {
      target.innerHTML = `<div class="queueEmpty">${esc(error.message)}</div>`;
      return;
    }
    target.innerHTML = (data || []).map(recentHtml).join('') || '<div class="queueEmpty">Zatím nebyl ručně nahrán žádný leták.</div>';
    window.__manualLeafletImports = data || [];
  }

  async function retryImport(id) {
    const row = (window.__manualLeafletImports || []).find((item) => item.id === id);
    if (!row) return;
    const metadata = row.metadata || {};
    const button = document.querySelector(`[data-retry-import="${CSS.escape(id)}"]`);
    if (button) {
      button.disabled = true;
      button.textContent = 'Spouštím…';
    }
    try {
      const { data, error } = await db.functions.invoke('register-manual-leaflet', {
        body: {
          store_id: row.store_id,
          storage_path: metadata.storage_path,
          original_filename: metadata.original_filename,
          content_type: metadata.content_type,
          file_size: metadata.file_size,
          sha256: metadata.sha256,
          auto_publish: Boolean(metadata.auto_publish),
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMessage('Import byl znovu spuštěn.', 'ok');
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
    const { data, error } = await db.from('stores')
      .select('id,name,slug')
      .eq('is_active', true)
      .order('name');
    if (error) throw error;
    select.innerHTML = '<option value="">Vyber obchod…</option>' + (data || [])
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
      setMessage(error?.message || 'Administraci se nepodařilo načíst.', 'err');
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
