(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const HISTORY_KEY = 'slevao-product-audit-v2';
  const TRASH_KEY = 'slevao-product-trash-v2';
  const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

  window.addEventListener('DOMContentLoaded', async () => {
    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const $ = (id) => document.getElementById(id);
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
    const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const nullable = (value) => String(value || '').trim() || null;
    const today = () => new Date().toISOString().slice(0, 10);
    const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
    const formatDate = (value) => value ? new Intl.DateTimeFormat('cs-CZ', { day:'numeric', month:'numeric', year:'numeric' }).format(new Date(`${value}T12:00:00`)) : '–';
    const formatDateTime = (value) => value ? new Intl.DateTimeFormat('cs-CZ', { dateStyle:'short', timeStyle:'short' }).format(new Date(value)) : '–';
    const clone = (value) => JSON.parse(JSON.stringify(value));

    let rows = [];
    let stores = [];
    let duplicateCounts = new Map();
    let duplicateGroups = new Map();
    let selectedIds = new Set();
    let canEdit = false;
    let actor = 'neznámý uživatel';
    let page = 1;
    let sort = { key:'published_at', direction:'desc' };
    let confirmHandler = null;
    let duplicateGroup = [];
    let currentEditRow = null;
    let uploadObjectUrl = '';

    function readJson(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch { return fallback; }
    }
    function writeJson(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { console.warn(error); }
    }
    function clearPublicCache() {
      try { Object.keys(localStorage).filter((key) => key.startsWith('slevao-public-data-')).forEach((key) => localStorage.removeItem(key)); } catch {}
    }
    function showMessage(text, type = 'ok', timeout = 4200) {
      const box = $('pageMessage');
      box.textContent = text;
      box.className = `notice ${type}`;
      if (timeout) setTimeout(() => box.classList.add('hidden'), timeout);
    }
    function setFormMessage(id, text, type = '') {
      const box = $(id);
      box.textContent = text;
      box.className = `formMessage${type ? ` ${type}` : ''}`;
    }
    function openModal(id) { $(id).hidden = false; document.body.style.overflow = 'hidden'; }
    function closeModal(id) { $(id).hidden = true; if (![...document.querySelectorAll('.modal')].some((modal) => !modal.hidden)) document.body.style.overflow = ''; }

    function historyEntries() { return readJson(HISTORY_KEY, []); }
    function addHistory(action, row, before = null, after = null, note = '') {
      const entries = historyEntries();
      entries.unshift({
        id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        offerId: row?.id || before?.id || after?.id || '',
        title: row?.title || after?.title || before?.title || 'Produkt',
        store: row?.stores?.name || after?.stores?.name || before?.stores?.name || '',
        action, actor, at: new Date().toISOString(), before, after, note,
      });
      writeJson(HISTORY_KEY, entries.slice(0, 1500));
    }
    function trashStore() {
      const value = readJson(TRASH_KEY, {});
      const cutoff = Date.now() - TRASH_RETENTION_MS;
      Object.entries(value).forEach(([id, item]) => { if (new Date(item.deletedAt || 0).getTime() < cutoff) delete value[id]; });
      writeJson(TRASH_KEY, value);
      return value;
    }
    function saveTrashItem(row, mode, originalStatus) {
      const trash = trashStore();
      trash[row.id] = { snapshot: clone(row), deletedAt: new Date().toISOString(), deletedBy: actor, mode, originalStatus: originalStatus || row.status || 'review' };
      writeJson(TRASH_KEY, trash);
    }
    function removeTrashItem(id) { const trash = trashStore(); delete trash[id]; writeJson(TRASH_KEY, trash); }

    function duplicateKey(row) {
      const storeId = row.store_id || '';
      const externalId = String(row.external_id || '').trim();
      if (externalId) return [storeId, 'external', externalId].join('|');
      return [
        storeId,
        'fallback',
        fold(row.title),
        Number(row.price || 0).toFixed(2),
        row.valid_from || '',
        row.valid_to || '',
        row.coverage_scope || '',
        row.region_code || '',
        row.city_name || '',
        row.store_location_name || '',
      ].join('|');
    }
    function rebuildDuplicates() {
      duplicateCounts = new Map(); duplicateGroups = new Map();
      rows.filter((row) => row.status !== 'trash').forEach((row) => {
        const key = duplicateKey(row);
        duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1);
        if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
        duplicateGroups.get(key).push(row);
      });
    }
    function issues(row) {
      const result = [];
      if (row.status === 'trash') return [{ code:'trash', label:'V koši', tone:'bad' }];
      const price = Number(row.price || 0), oldPrice = Number(row.old_price || 0);
      const count = duplicateCounts.get(duplicateKey(row)) || 0;
      if (count > 1) result.push({ code:'duplicates', label:`Duplicita ${count}×`, tone:'bad' });
      if (!row.image_url) result.push({ code:'missing-image', label:'Bez fotografie', tone:'warn' });
      if (!String(row.title || '').trim()) result.push({ code:'missing-title', label:'Bez názvu', tone:'bad' });
      if (!Number.isFinite(price) || price <= 0) result.push({ code:'bad-price', label:'Neplatná cena', tone:'bad' });
      else if (oldPrice > 0 && oldPrice < price) result.push({ code:'bad-price', label:'Původní cena je nižší', tone:'bad' });
      if (!row.store_id || !row.stores?.name) result.push({ code:'missing-store', label:'Bez obchodu', tone:'bad' });
      if (row.valid_from && row.valid_to && row.valid_from > row.valid_to) result.push({ code:'bad-validity', label:'Obrácená platnost', tone:'bad' });
      if (row.status === 'published' && row.valid_to && row.valid_to < today()) result.push({ code:'expired-published', label:'Publikováno po platnosti', tone:'warn' });
      if (row.valid_from && row.valid_from > today()) result.push({ code:'future', label:'Budoucí nabídka', tone:'info' });
      return result;
    }
    function statusLabel(status) { return ({ published:'Publikováno', review:'Ke kontrole', draft:'Koncept', expired:'Ukončeno', trash:'Koš' }[status] || status || 'Bez stavu'); }

    function updateSummary() {
      const activeRows = rows.filter((row) => row.status !== 'trash');
      const allIssues = activeRows.map(issues);
      $('count').textContent = activeRows.length.toLocaleString('cs-CZ');
      $('storeCount').textContent = new Set(activeRows.map((row) => row.store_id).filter(Boolean)).size.toLocaleString('cs-CZ');
      $('duplicates').textContent = activeRows.filter((row) => (duplicateCounts.get(duplicateKey(row)) || 0) > 1).length.toLocaleString('cs-CZ');
      $('missingImages').textContent = activeRows.filter((row) => !row.image_url).length.toLocaleString('cs-CZ');
      $('badPrices').textContent = allIssues.filter((list) => list.some((item) => item.code === 'bad-price')).length.toLocaleString('cs-CZ');
      $('expiredPublished').textContent = allIssues.filter((list) => list.some((item) => item.code === 'expired-published')).length.toLocaleString('cs-CZ');
    }
    function syncMetricFilters() {
      const active = $('issueFilter').value;
      document.querySelectorAll('[data-summary-filter]').forEach((card) => {
        const filter = card.dataset.summaryFilter;
        const selected = filter === 'all' ? active === 'all' : filter === active;
        card.classList.toggle('active', selected);
        card.setAttribute('aria-pressed', String(selected));
        const hint = card.querySelector('small');
        if (hint && filter !== 'all') hint.textContent = selected ? 'Zrušit filtr' : 'Zobrazit produkty';
      });
    }
    function filteredRows() {
      const query = fold($('search').value), storeId = $('storeFilter').value, status = $('statusFilter').value, issue = $('issueFilter').value;
      return rows.filter((row) => {
        if (query && !fold([row.title, row.products?.name, row.stores?.name, row.id, row.product_id].join(' ')).includes(query)) return false;
        if (storeId !== 'all' && row.store_id !== storeId) return false;
        if (status !== 'all' && row.status !== status) return false;
        if (status === 'all' && row.status === 'trash') return false;
        const rowIssues = issues(row);
        if (issue === 'problem' && !rowIssues.length) return false;
        if (issue !== 'all' && issue !== 'problem' && !rowIssues.some((item) => item.code === issue)) return false;
        return true;
      });
    }
    function sortValue(row, key) {
      if (key === 'title') return fold(row.title || row.products?.name);
      if (key === 'store') return fold(row.stores?.name);
      if (key === 'price') return Number(row.price || 0);
      if (key === 'valid_to') return row.valid_to || '';
      if (key === 'status') return row.status || '';
      if (key === 'issues') return issues(row).length;
      return row[key] || '';
    }
    function sortedRows(input) {
      const direction = sort.direction === 'asc' ? 1 : -1;
      return [...input].sort((a, b) => {
        const av = sortValue(a, sort.key), bv = sortValue(b, sort.key);
        if (av === bv) return 0;
        return av > bv ? direction : -direction;
      });
    }
    function currentPageRows() {
      const all = sortedRows(filteredRows()), size = Number($('pageSize').value || 50), pages = Math.max(1, Math.ceil(all.length / size));
      page = Math.min(Math.max(1, page), pages);
      return { all, pageRows: all.slice((page - 1) * size, page * size), pages, size };
    }
    function syncSelectionBar() {
      selectedIds = new Set([...selectedIds].filter((id) => rows.some((row) => row.id === id && row.status !== 'trash')));
      $('selectedCount').textContent = selectedIds.size;
      $('bulkBar').classList.toggle('hidden', selectedIds.size === 0);
    }
    function rowActions(row) {
      if (row.status === 'trash') return `<button class="rowButton restore" type="button" data-restore-id="${esc(row.id)}" ${canEdit ? '' : 'disabled'}>Obnovit</button><button class="rowButton trash" type="button" data-purge-id="${esc(row.id)}" ${canEdit ? '' : 'disabled'}>Smazat trvale</button>`;
      const isDuplicate = (duplicateCounts.get(duplicateKey(row)) || 0) > 1;
      return `<button class="rowButton edit" type="button" data-edit-id="${esc(row.id)}" ${canEdit ? '' : 'disabled'}>Upravit</button>${isDuplicate ? `<button class="rowButton duplicate" type="button" data-duplicate-id="${esc(row.id)}" ${canEdit ? '' : 'disabled'}>Duplicity</button>` : ''}<button class="rowButton trash" type="button" data-trash-id="${esc(row.id)}" ${canEdit ? '' : 'disabled'}>Do koše</button>`;
    }
    function header(label, key) {
      const active = sort.key === key, mark = active ? (sort.direction === 'asc' ? '▲' : '▼') : '↕';
      return `<th class="sortable" data-sort="${key}">${label}<span class="sortMark">${mark}</span></th>`;
    }
    function render() {
      syncMetricFilters(); syncSelectionBar();
      const { all, pageRows, pages } = currentPageRows();
      $('resultInfo').textContent = `Zobrazeno ${pageRows.length.toLocaleString('cs-CZ')} z ${all.length.toLocaleString('cs-CZ')} odpovídajících záznamů · celkem ${rows.length.toLocaleString('cs-CZ')}`;
      $('pageInfo').textContent = `${page} / ${pages}`;
      $('prevPage').disabled = page <= 1; $('nextPage').disabled = page >= pages;
      if (!pageRows.length) { $('table').innerHTML = '<div class="empty">Žádné produkty neodpovídají zvoleným filtrům.</div>'; return; }
      const allSelected = pageRows.filter((row) => row.status !== 'trash').every((row) => selectedIds.has(row.id));
      $('table').innerHTML = `<table><thead><tr><th class="checkCell"><input id="selectPage" type="checkbox" ${allSelected ? 'checked' : ''} aria-label="Vybrat stránku"></th><th>Foto</th>${header('Produkt','title')}${header('Obchod','store')}${header('Cena','price')}${header('Platnost','valid_to')}${header('Stav','status')}<th>Publikováno</th>${header('Kontrola','issues')}<th>Akce</th></tr></thead><tbody>${pageRows.map((row) => {
        const rowIssues = issues(row), slug = row.stores?.slug || '', selected = selectedIds.has(row.id), trash = row.status === 'trash';
        return `<tr class="${selected ? 'selectedRow ' : ''}${trash ? 'trashRow' : ''}"><td class="checkCell">${trash ? '' : `<input type="checkbox" data-select-id="${esc(row.id)}" ${selected ? 'checked' : ''} aria-label="Vybrat ${esc(row.title)}">`}</td><td><div class="thumb">${row.image_url ? `<img src="${esc(row.image_url)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove();this.parentElement.textContent='—'">` : '—'}</div></td><td><div class="productName">${esc(row.title || row.products?.name || 'Bez názvu')}</div><div class="sub">ID: ${esc(row.id)}${row._localTrash ? ' · místní koš' : ''}</div></td><td><div class="storeCell"><span class="storeDot"></span><div><strong>${esc(row.stores?.name || 'Neznámý obchod')}</strong>${slug ? `<div class="sub"><a href="${encodeURIComponent(slug)}.html" target="_blank" rel="noopener">${esc(slug)}.html</a></div>` : ''}</div></div></td><td><span class="price">${money(row.price)} Kč</span>${Number(row.old_price || 0) > 0 ? `<span class="oldPrice"><s>${money(row.old_price)} Kč</s></span>` : ''}</td><td>${formatDate(row.valid_from)} – ${formatDate(row.valid_to)}</td><td><span class="status ${esc(row.status)}">${esc(statusLabel(row.status))}</span></td><td>${formatDateTime(row.published_at)}</td><td><div class="tags">${rowIssues.length ? rowIssues.map((item) => `<span class="tag ${item.tone}">${esc(item.label)}</span>`).join('') : '<span class="tag">Bez problému</span>'}</div></td><td><div class="rowActions">${rowActions(row)}</div></td></tr>`;
      }).join('')}</tbody></table>`;
    }

    async function fetchAllOffers() {
      const result = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from('offers').select('id,product_id,store_id,external_id,title,price,old_price,image_url,valid_from,valid_to,status,published_at,coverage_scope,region_code,city_name,store_location_name,stores(name,slug,is_active),products(name,image_url)').order('published_at', { ascending:false, nullsFirst:false }).range(from, from + 999);
        if (error) throw error;
        result.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      return result;
    }
    function localTrashRows(databaseRows) {
      const ids = new Set(databaseRows.map((row) => row.id));
      return Object.entries(trashStore()).filter(([id, item]) => item.mode === 'deleted' && !ids.has(id)).map(([id, item]) => ({ ...item.snapshot, id, status:'trash', _localTrash:true }));
    }
    async function load() {
      $('reload').disabled = true;
      $('table').innerHTML = '<div class="empty"><span class="loading"></span>Načítám produkty všech obchodů…</div>';
      try {
        const [{ data: storeData, error: storeError }, offerRows] = await Promise.all([db.from('stores').select('id,name,slug,is_active').order('name'), fetchAllOffers()]);
        if (storeError) throw storeError;
        stores = storeData || [];
        rows = [...offerRows, ...localTrashRows(offerRows)];
        const trash = trashStore();
        rows.forEach((row) => { if (trash[row.id] && row.status === 'trash') row._trashMeta = trash[row.id]; });
        rebuildDuplicates(); updateSummary();
        const storeOptions = stores.map((store) => `<option value="${esc(store.id)}">${esc(store.name)}${store.is_active ? '' : ' (skrytý)'}</option>`).join('');
        const selectedStore = $('storeFilter').value;
        $('storeFilter').innerHTML = '<option value="all">Všechny obchody</option>' + storeOptions;
        if ([...$('storeFilter').options].some((option) => option.value === selectedStore)) $('storeFilter').value = selectedStore;
        $('editStore').innerHTML = storeOptions;
        $('bulkStore').innerHTML = '<option value="">Změnit obchod…</option>' + storeOptions;
        render();
      } catch (error) {
        $('table').innerHTML = `<div class="empty" style="color:var(--bad)"><strong>Produkty se nepodařilo načíst.</strong><br>${esc(error?.message || 'Neznámá chyba')}</div>`;
      } finally { $('reload').disabled = false; }
    }

    async function uploadPhoto(productId, file) {
      if (!productId) throw new Error('Tato nabídka nemá navázaný produkt. Nejdřív produkt ulož bez souboru nebo ho přiřaď v databázi.');
      if (!file) return null;
      const allowed = ['image/jpeg','image/png','image/webp','image/avif'];
      if (!allowed.includes(file.type)) throw new Error('Vyber JPG, PNG, WEBP nebo AVIF.');
      if (file.size > 8 * 1024 * 1024) throw new Error('Fotografie je větší než 8 MB.');
      const { data: sessionData } = await db.auth.getSession();
      const form = new FormData(); form.append('product_id', productId); form.append('file', file, file.name);
      const response = await fetch(`${SUPABASE_URL}/functions/v1/upload-product-image`, { method:'POST', headers:{ Authorization:`Bearer ${sessionData.session.access_token}`, apikey:SUPABASE_KEY }, body:form });
      const output = await response.json();
      if (!response.ok || !output.ok) throw new Error(output.error || 'Fotografii se nepodařilo nahrát.');
      return output.candidate;
    }
    function resetUpload() {
      if (uploadObjectUrl) URL.revokeObjectURL(uploadObjectUrl);
      uploadObjectUrl = ''; $('editUpload').value = ''; $('uploadPreview').classList.add('hidden'); $('uploadPreviewImage').removeAttribute('src'); $('uploadFileName').textContent = '';
    }
    function openEdit(id) {
      if (!canEdit) return $('authWarning').classList.remove('hidden');
      const row = rows.find((item) => item.id === id); if (!row || row.status === 'trash') return;
      currentEditRow = row; resetUpload();
      $('editId').value = row.id; $('editProductId').value = row.product_id || ''; $('editRecordId').textContent = `Nabídka ${row.id}`;
      $('editTitle').value = row.title || row.products?.name || ''; $('editStore').value = row.store_id || ''; $('editStatus').value = row.status || 'review';
      $('editPrice').value = row.price ?? ''; $('editOldPrice').value = row.old_price ?? ''; $('editFrom').value = row.valid_from || ''; $('editTo').value = row.valid_to || ''; $('editImage').value = row.image_url || row.products?.image_url || '';
      setFormMessage('editMessage', 'Změny se projeví na veřejném webu po obnovení dat.'); openModal('editModal');
    }
    async function saveEdit() {
      const id = $('editId').value, productId = $('editProductId').value, title = $('editTitle').value.trim(), storeId = $('editStore').value, status = $('editStatus').value;
      const price = Number($('editPrice').value), oldPrice = $('editOldPrice').value ? Number($('editOldPrice').value) : null, validFrom = $('editFrom').value, validTo = $('editTo').value;
      if (!id || !title || !storeId || !Number.isFinite(price) || price <= 0 || !validFrom || !validTo) return setFormMessage('editMessage', 'Vyplň název, obchod, cenu a platnost.', 'error');
      if (oldPrice !== null && oldPrice < price) return setFormMessage('editMessage', 'Původní cena nesmí být nižší než akční cena.', 'error');
      if (validFrom > validTo) return setFormMessage('editMessage', 'Datum začátku nesmí být po datu konce.', 'error');
      $('editSave').disabled = true;
      try {
        let imageUrl = nullable($('editImage').value); const file = $('editUpload').files?.[0];
        if (file) { setFormMessage('editMessage', 'Nahrávám fotografii…'); const candidate = await uploadPhoto(productId, file); imageUrl = candidate.image_url; }
        const before = clone(currentEditRow);
        const payload = { title, store_id:storeId, status, price, old_price:oldPrice, valid_from:validFrom, valid_to:validTo, image_url:imageUrl, published_at:status === 'published' ? (currentEditRow?.published_at || new Date().toISOString()) : null };
        const { error } = await db.from('offers').update(payload).eq('id', id); if (error) throw error;
        if (productId) { const { error: productError } = await db.from('products').update({ name:title, image_url:imageUrl }).eq('id', productId); if (productError) console.warn(productError.message); }
        addHistory('Upraven produkt', currentEditRow, before, { ...before, ...payload }, file ? `Nahrána fotografie ${file.name}` : ''); clearPublicCache();
        setFormMessage('editMessage', 'Produkt byl uložen.', 'ok'); await load(); setTimeout(() => closeModal('editModal'), 450);
      } catch (error) { setFormMessage('editMessage', error?.message || 'Uložení selhalo.', 'error'); } finally { $('editSave').disabled = false; }
    }

    async function moveToTrash(row) {
      if (!row || row.status === 'trash') return;
      const before = clone(row), originalStatus = row.status || 'review';
      const { error } = await db.from('offers').update({ status:'trash' }).eq('id', row.id);
      if (!error) {
        saveTrashItem(row, 'soft', originalStatus); addHistory('Přesunuto do koše', row, before, { ...before, status:'trash' }, 'Záznam zůstal v databázi.'); return;
      }
      const { error: deleteError } = await db.from('offers').delete().eq('id', row.id);
      if (deleteError) throw new Error(`${error.message}; náhradní přesun do koše také selhal: ${deleteError.message}`);
      saveTrashItem(row, 'deleted', originalStatus); addHistory('Přesunuto do místního koše', row, before, null, 'Databáze nepovolila stav trash; záznam lze obnovit z tohoto prohlížeče.');
    }
    async function restoreRow(row) {
      const trash = trashStore(), item = trash[row.id], status = item?.originalStatus || (row.published_at ? 'published' : 'review');
      if (row._localTrash || item?.mode === 'deleted') {
        const source = clone(item?.snapshot || row); delete source.stores; delete source.products; delete source._localTrash; delete source._trashMeta; source.status = status;
        let { error } = await db.from('offers').insert(source);
        if (error) { const { id, ...withoutId } = source; ({ error } = await db.from('offers').insert(withoutId)); }
        if (error) throw error;
      } else {
        const { error } = await db.from('offers').update({ status }).eq('id', row.id); if (error) throw error;
      }
      removeTrashItem(row.id); addHistory('Obnoveno z koše', row, { ...row, status:'trash' }, { ...row, status }); clearPublicCache();
    }
    async function purgeRow(row) {
      if (!row._localTrash) { const { error } = await db.from('offers').delete().eq('id', row.id); if (error) throw error; }
      removeTrashItem(row.id); addHistory('Trvale odstraněno', row, clone(row), null); clearPublicCache();
    }
    async function bulkUpdate(payload, actionLabel) {
      const ids = [...selectedIds]; if (!ids.length) return;
      const before = rows.filter((row) => ids.includes(row.id)).map(clone);
      const { error } = await db.from('offers').update(payload).in('id', ids); if (error) throw error;
      before.forEach((row) => addHistory(actionLabel, row, row, { ...row, ...payload })); selectedIds.clear(); clearPublicCache(); await load();
    }

    function askConfirm({ title, subtitle = '', body, actionLabel = 'Potvrdit', handler }) {
      $('confirmHeading').textContent = title; $('confirmSubtitle').textContent = subtitle; $('confirmBody').innerHTML = body; $('confirmAction').textContent = actionLabel; setFormMessage('confirmMessage', '');
      confirmHandler = handler; openModal('confirmModal');
    }
    function openTrashConfirm(row) {
      askConfirm({ title:'Přesunout nabídku do koše?', subtitle:'Zkontroluj správný produkt.', actionLabel:'Ano, přesunout do koše', body:`<div class="confirmCard"><strong>${esc(row.title || 'Bez názvu')}</strong>${esc(row.stores?.name || 'Neznámý obchod')} · ${money(row.price)} Kč · ${formatDate(row.valid_from)}–${formatDate(row.valid_to)}</div><div class="confirmWarning">Nabídka zmizí z veřejného webu. Z koše ji můžeš obnovit.</div>`, handler:async () => { await moveToTrash(row); clearPublicCache(); await load(); showMessage('Nabídka byla přesunuta do koše.'); } });
    }
    function openPurgeConfirm(row) {
      askConfirm({ title:'Trvale odstranit nabídku?', subtitle:'Tuto akci nelze vrátit.', actionLabel:'Ano, smazat trvale', body:`<div class="confirmCard"><strong>${esc(row.title || 'Bez názvu')}</strong>${esc(row.stores?.name || 'Neznámý obchod')} · ${money(row.price)} Kč</div><div class="confirmWarning"><strong>Odstranění je nevratné.</strong> Záznam zmizí i z koše.</div>`, handler:async () => { await purgeRow(row); await load(); showMessage('Nabídka byla trvale odstraněna.'); } });
    }

    function openDuplicateResolver(id) {
      const row = rows.find((item) => item.id === id); if (!row) return;
      duplicateGroup = duplicateGroups.get(duplicateKey(row)) || [];
      if (duplicateGroup.length < 2) return showMessage('Tato duplicita už neexistuje.', 'error');
      $('duplicateList').innerHTML = duplicateGroup.map((item, index) => `<label class="duplicateItem"><input type="radio" name="keepDuplicate" value="${esc(item.id)}" ${index === 0 ? 'checked' : ''}><div>${item.image_url ? `<img src="${esc(item.image_url)}" alt="">` : '<div class="thumb">—</div>'}</div><div><strong>${esc(item.title)}</strong><div class="meta">${esc(item.stores?.name || '')} · ${formatDate(item.valid_from)}–${formatDate(item.valid_to)} · ID ${esc(item.id)}</div></div><strong>${money(item.price)} Kč</strong></label>`).join('');
      setFormMessage('duplicateMessage', ''); openModal('duplicateModal');
    }
    async function resolveDuplicates() {
      const keepId = document.querySelector('input[name="keepDuplicate"]:checked')?.value, keep = duplicateGroup.find((row) => row.id === keepId);
      if (!keep) return setFormMessage('duplicateMessage', 'Vyber záznam, který se má ponechat.', 'error');
      $('duplicateResolve').disabled = true;
      try {
        const donors = duplicateGroup.filter((row) => row.id !== keep.id), bestImage = keep.image_url || donors.find((row) => row.image_url)?.image_url || null, bestOldPrice = Math.max(Number(keep.old_price || 0), ...donors.map((row) => Number(row.old_price || 0))) || null;
        if (bestImage !== keep.image_url || bestOldPrice !== keep.old_price) {
          const { error } = await db.from('offers').update({ image_url:bestImage, old_price:bestOldPrice }).eq('id', keep.id); if (error) throw error;
          if (keep.product_id && bestImage) await db.from('products').update({ image_url:bestImage }).eq('id', keep.product_id);
        }
        for (const row of donors) await moveToTrash(row);
        addHistory('Vyřešeny duplicity', keep, clone(keep), { ...keep, image_url:bestImage, old_price:bestOldPrice }, `Ponechán záznam ${keep.id}; ${donors.length} záznamů přesunuto do koše.`);
        clearPublicCache(); setFormMessage('duplicateMessage', 'Duplicity byly vyřešeny.', 'ok'); await load(); setTimeout(() => closeModal('duplicateModal'), 450);
      } catch (error) { setFormMessage('duplicateMessage', error?.message || 'Řešení duplicit selhalo.', 'error'); } finally { $('duplicateResolve').disabled = false; }
    }

    function renderHistory(offerId = '') {
      const entries = historyEntries().filter((entry) => !offerId || entry.offerId === offerId);
      $('historySubtitle').textContent = offerId ? `Změny nabídky ${offerId}` : 'Poslední změny v této administraci';
      $('historyList').innerHTML = entries.length ? entries.map((entry) => {
        const before = entry.before || {}, after = entry.after || {}, changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !['stores','products','_trashMeta','_localTrash'].includes(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key])).slice(0, 10);
        const diff = changed.map((key) => `${key}: ${JSON.stringify(before[key] ?? '—')} → ${JSON.stringify(after[key] ?? '—')}`).join('\n');
        return `<article class="historyItem"><div class="historyTop"><strong>${esc(entry.action)} · ${esc(entry.title)}</strong><time>${formatDateTime(entry.at)}</time></div><p>${esc(entry.actor)}${entry.store ? ` · ${esc(entry.store)}` : ''}${entry.note ? ` · ${esc(entry.note)}` : ''}</p>${diff ? `<div class="historyDiff">${esc(diff)}</div>` : ''}</article>`;
      }).join('') : '<div class="empty">Zatím tu není žádná uložená změna.</div>';
      $('historyClear').dataset.offerId = offerId; openModal('historyModal');
    }

    $('reload').addEventListener('click', load);
    ['search','storeFilter','statusFilter','issueFilter'].forEach((id) => $(id).addEventListener(id === 'search' ? 'input' : 'change', () => { page = 1; render(); }));
    $('pageSize').addEventListener('change', () => { page = 1; render(); });
    $('prevPage').addEventListener('click', () => { page -= 1; render(); }); $('nextPage').addEventListener('click', () => { page += 1; render(); });
    document.querySelectorAll('[data-summary-filter]').forEach((card) => card.addEventListener('click', () => { const filter = card.dataset.summaryFilter; $('issueFilter').value = filter === 'all' || $('issueFilter').value === filter ? 'all' : filter; $('statusFilter').value = 'all'; page = 1; render(); $('table').scrollIntoView({ behavior:'smooth', block:'start' }); }));

    $('table').addEventListener('click', (event) => {
      const sortButton = event.target.closest('[data-sort]'); if (sortButton) { const key = sortButton.dataset.sort; sort = sort.key === key ? { key, direction:sort.direction === 'asc' ? 'desc' : 'asc' } : { key, direction:'asc' }; render(); return; }
      const edit = event.target.closest('[data-edit-id]'); if (edit) return openEdit(edit.dataset.editId);
      const trash = event.target.closest('[data-trash-id]'); if (trash) return openTrashConfirm(rows.find((row) => row.id === trash.dataset.trashId));
      const restore = event.target.closest('[data-restore-id]'); if (restore) return askConfirm({ title:'Obnovit nabídku z koše?', actionLabel:'Obnovit nabídku', body:`<div class="confirmCard"><strong>${esc(rows.find((row) => row.id === restore.dataset.restoreId)?.title || '')}</strong>Nabídka se znovu vrátí do administrace a podle původního stavu také na web.</div>`, handler:async () => { await restoreRow(rows.find((row) => row.id === restore.dataset.restoreId)); await load(); showMessage('Nabídka byla obnovena.'); } });
      const purge = event.target.closest('[data-purge-id]'); if (purge) return openPurgeConfirm(rows.find((row) => row.id === purge.dataset.purgeId));
      const duplicate = event.target.closest('[data-duplicate-id]'); if (duplicate) return openDuplicateResolver(duplicate.dataset.duplicateId);
    });
    $('table').addEventListener('change', (event) => {
      const rowCheck = event.target.closest('[data-select-id]'); if (rowCheck) { rowCheck.checked ? selectedIds.add(rowCheck.dataset.selectId) : selectedIds.delete(rowCheck.dataset.selectId); render(); return; }
      if (event.target.id === 'selectPage') { currentPageRows().pageRows.filter((row) => row.status !== 'trash').forEach((row) => event.target.checked ? selectedIds.add(row.id) : selectedIds.delete(row.id)); render(); }
    });
    $('clearSelection').addEventListener('click', () => { selectedIds.clear(); render(); });
    $('bulkApplyStatus').addEventListener('click', () => { const status = $('bulkStatus').value; if (!status) return showMessage('Vyber stav.', 'error'); askConfirm({ title:`Změnit stav ${selectedIds.size} nabídek?`, actionLabel:'Použít stav', body:`<div class="confirmCard"><strong>${esc(statusLabel(status))}</strong>Změna se použije na všechny vybrané nabídky.</div>`, handler:async () => { await bulkUpdate({ status, published_at:status === 'published' ? new Date().toISOString() : null }, 'Hromadně změněn stav'); showMessage('Stav vybraných nabídek byl změněn.'); } }); });
    $('bulkApplyStore').addEventListener('click', () => { const storeId = $('bulkStore').value, store = stores.find((item) => item.id === storeId); if (!store) return showMessage('Vyber obchod.', 'error'); askConfirm({ title:`Přesunout ${selectedIds.size} nabídek do obchodu ${store.name}?`, actionLabel:'Změnit obchod', body:`<div class="confirmCard"><strong>${esc(store.name)}</strong>Obchod se změní u všech vybraných nabídek.</div>`, handler:async () => { await bulkUpdate({ store_id:storeId }, 'Hromadně změněn obchod'); showMessage('Obchod byl změněn.'); } }); });
    $('bulkTrash').addEventListener('click', () => askConfirm({ title:`Přesunout ${selectedIds.size} nabídek do koše?`, actionLabel:'Přesunout do koše', body:'<div class="confirmWarning">Vybrané nabídky zmizí z veřejného webu. Každou půjde z koše obnovit.</div>', handler:async () => { const targets = rows.filter((row) => selectedIds.has(row.id)); for (const row of targets) await moveToTrash(row); selectedIds.clear(); clearPublicCache(); await load(); showMessage('Vybrané nabídky byly přesunuty do koše.'); } }));

    $('editClose').addEventListener('click', () => closeModal('editModal')); $('editSave').addEventListener('click', saveEdit); $('editHistory').addEventListener('click', () => renderHistory($('editId').value));
    $('editUpload').addEventListener('change', () => { const file = $('editUpload').files?.[0]; if (uploadObjectUrl) URL.revokeObjectURL(uploadObjectUrl); uploadObjectUrl = ''; $('uploadPreview').classList.add('hidden'); if (!file) return; uploadObjectUrl = URL.createObjectURL(file); $('uploadPreviewImage').src = uploadObjectUrl; $('uploadFileName').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`; $('uploadPreview').classList.remove('hidden'); });
    $('confirmClose').addEventListener('click', () => closeModal('confirmModal')); $('confirmCancel').addEventListener('click', () => closeModal('confirmModal'));
    $('confirmAction').addEventListener('click', async () => { if (!confirmHandler) return; $('confirmAction').disabled = true; try { setFormMessage('confirmMessage', 'Provádím změnu…'); await confirmHandler(); confirmHandler = null; closeModal('confirmModal'); } catch (error) { setFormMessage('confirmMessage', error?.message || 'Akce selhala.', 'error'); } finally { $('confirmAction').disabled = false; } });
    $('duplicateClose').addEventListener('click', () => closeModal('duplicateModal')); $('duplicateResolve').addEventListener('click', resolveDuplicates);
    $('historyAllButton').addEventListener('click', () => renderHistory()); $('historyClose').addEventListener('click', () => closeModal('historyModal'));
    $('historyClear').addEventListener('click', () => { const offerId = $('historyClear').dataset.offerId; if (offerId) writeJson(HISTORY_KEY, historyEntries().filter((entry) => entry.offerId !== offerId)); else writeJson(HISTORY_KEY, []); renderHistory(offerId); });
    document.querySelectorAll('.modal').forEach((modal) => modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(modal.id); }));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { const open = [...document.querySelectorAll('.modal')].reverse().find((modal) => !modal.hidden); if (open) closeModal(open.id); } });

    const { data: sessionData } = await db.auth.getSession();
    const session = sessionData.session, role = session?.user?.app_metadata?.role || '';
    canEdit = Boolean(session && ['admin','editor'].includes(role)); actor = session?.user?.email || actor;
    if (!canEdit) $('authWarning').classList.remove('hidden');
    await load();
  });
})();
