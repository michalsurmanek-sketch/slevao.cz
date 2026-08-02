(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const TRASH_KEY = 'slevao-product-trash-v2';
  const HISTORY_KEY = 'slevao-product-audit-v2';
  const MAX_ROWS = 10000;

  window.addEventListener('DOMContentLoaded', () => {
    if (!window.supabase || !document.getElementById('app')) return;

    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const $ = (id) => document.getElementById(id);
    const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
    const nullable = (value) => String(value || '').trim() || null;
    const today = () => new Date().toISOString().slice(0, 10);
    const clone = (value) => JSON.parse(JSON.stringify(value));

    let offerRows = [];
    let products = [];
    let stores = [];
    let selectedProduct = null;
    let initialized = false;
    let applyingOfferFilters = false;
    let dashboardLoading = false;
    let deleteTarget = null;

    function readJson(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key) || '') || fallback; } catch { return fallback; }
    }
    function writeJson(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (error) { console.warn(error); }
    }
    function clearPublicCache() {
      try { Object.keys(localStorage).filter((key) => key.startsWith('slevao-public-data-')).forEach((key) => localStorage.removeItem(key)); } catch {}
    }
    function showFormMessage(text, type = 'ok') {
      const box = $('formMsg');
      if (!box) return;
      box.textContent = text;
      box.className = `msg ${type}`;
    }
    function addHistory(action, row, before = null, after = null, note = '') {
      const entries = readJson(HISTORY_KEY, []);
      entries.unshift({
        id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
        offerId: row?.id || before?.id || after?.id || '',
        title: row?.title || after?.title || before?.title || 'Produkt',
        store: row?.stores?.name || '',
        action,
        actor: $('who')?.textContent || 'správce',
        at: new Date().toISOString(),
        before,
        after,
        note,
      });
      writeJson(HISTORY_KEY, entries.slice(0, 1500));
    }
    function saveTrash(row, mode, originalStatus) {
      const trash = readJson(TRASH_KEY, {});
      trash[row.id] = {
        snapshot: clone(row),
        deletedAt: new Date().toISOString(),
        deletedBy: $('who')?.textContent || 'správce',
        mode,
        originalStatus: originalStatus || row.status || 'review',
      };
      writeJson(TRASH_KEY, trash);
    }
    function removeTrash(id) {
      const trash = readJson(TRASH_KEY, {});
      delete trash[id];
      writeJson(TRASH_KEY, trash);
    }

    function icon(name) {
      const paths = {
        alert:'<path d="M10.3 2.9 1.8 17a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 2.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
        check:'<path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="9"/>',
        automation:'<rect x="4" y="7" width="16" height="12" rx="2"/><path d="M9 3h6M12 3v4M8 12h.01M16 12h.01M8 16h8"/>',
        photo:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
        duplicate:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
        clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        review:'<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
        draft:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
        trash:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>',
        search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
        link:'<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1"/>',
      };
      return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.check}</svg>`;
    }

    function installDom() {
      if ($('criticalDashboard')) return;

      const cards = document.querySelector('#dashboard .cards');
      cards?.insertAdjacentHTML('afterend', `
        <section id="criticalDashboard" class="criticalDashboard" aria-label="Provozní kontrola">
          <div id="criticalHealth" class="criticalHealth loadingState">
            <span class="criticalHealthIcon">${icon('automation')}</span>
            <div class="criticalHealthText"><strong id="criticalHealthTitle">Kontroluji provoz webu…</strong><span id="criticalHealthText">Načítám nabídky, fotografie a zdroje letáků.</span></div>
            <a class="criticalHealthAction" href="admin-automatizace.html">Otevřít automatizaci</a>
          </div>
          <div class="criticalGrid">
            <button class="criticalMetric" type="button" data-critical-target="review"><span class="criticalMetricIcon">${icon('review')}</span><span><small>Čeká na kontrolu</small><strong id="criticalReview">—</strong><em>Zobrazit nabídky</em></span></button>
            <button class="criticalMetric" type="button" data-critical-target="draft"><span class="criticalMetricIcon">${icon('draft')}</span><span><small>Koncepty</small><strong id="criticalDraft">—</strong><em>Zobrazit nabídky</em></span></button>
            <button class="criticalMetric warning" type="button" data-critical-target="expired"><span class="criticalMetricIcon">${icon('clock')}</span><span><small>Prošlé publikované</small><strong id="criticalExpired">—</strong><em>Opravit produkty</em></span></button>
            <button class="criticalMetric warning" type="button" data-critical-target="missing-image"><span class="criticalMetricIcon">${icon('photo')}</span><span><small>Bez fotografie</small><strong id="criticalMissing">—</strong><em>Doplnit fotografie</em></span></button>
            <button class="criticalMetric danger" type="button" data-critical-target="duplicates"><span class="criticalMetricIcon">${icon('duplicate')}</span><span><small>Duplicitní řádky</small><strong id="criticalDuplicates">—</strong><em>Vyřešit duplicity</em></span></button>
            <button class="criticalMetric" type="button" data-critical-target="photos"><span class="criticalMetricIcon">${icon('photo')}</span><span><small>Fotky ke schválení</small><strong id="criticalPhotos">—</strong><em>Otevřít frontu</em></span></button>
            <button class="criticalMetric danger" type="button" data-critical-target="sources"><span class="criticalMetricIcon">${icon('alert')}</span><span><small>Problémové zdroje</small><strong id="criticalSources">—</strong><em>Zkontrolovat zdroje</em></span></button>
            <button class="criticalMetric" type="button" data-critical-target="trash"><span class="criticalMetricIcon">${icon('trash')}</span><span><small>V koši</small><strong id="criticalTrash">—</strong><em>Obnovit nebo smazat</em></span></button>
          </div>
        </section>`);

      const offersToolbar = document.querySelector('#offersPage .head .toolbar');
      offersToolbar?.insertAdjacentHTML('beforeend', `
        <select id="criticalOfferStore" class="search criticalSelect" aria-label="Filtrovat nabídky podle obchodu"><option value="all">Všechny obchody</option></select>
        <select id="criticalOfferStatus" class="search criticalSelect" aria-label="Filtrovat nabídky podle stavu">
          <option value="active">Aktivní záznamy</option><option value="all">Všechny stavy</option><option value="published">Publikované</option><option value="review">Ke kontrole</option><option value="draft">Koncepty</option><option value="expired">Ukončené</option><option value="trash">Koš</option>
        </select>
        <select id="criticalOfferProblem" class="search criticalSelect" aria-label="Filtrovat nabídky podle problému">
          <option value="all">Všechny produkty</option><option value="missing-image">Bez fotografie</option><option value="bad-price">Chybná cena</option><option value="expired-published">Prošlé publikované</option><option value="duplicates">Duplicity</option>
        </select>
        <a class="btn light criticalControlLink" href="admin-tesco-kontrola.html?status=trash">${icon('trash')} Správa koše</a>`);

      const titleField = $('title')?.closest('.field');
      titleField?.classList.add('criticalProductField');
      titleField?.insertAdjacentHTML('beforeend', `
        <div id="criticalProductState" class="criticalProductState">Začni psát. Systém zkontroluje existující produkty, aby nevznikla duplicita.</div>
        <div id="criticalProductSuggestions" class="criticalProductSuggestions hidden" role="listbox"></div>`);

      const imageField = $('image')?.closest('.field');
      imageField?.insertAdjacentHTML('beforeend', `
        <div class="criticalImageTools"><span id="criticalImagePreview" class="criticalImagePreview">${icon('photo')}</span><a id="criticalUploadLink" class="criticalInlineLink" href="admin-pridat-fotografii.html">${icon('photo')} Nahrát nebo najít fotografii</a></div>`);

      document.body.insertAdjacentHTML('beforeend', `
        <div id="criticalTrashModal" class="criticalModal hidden" role="dialog" aria-modal="true" aria-labelledby="criticalTrashTitle">
          <div class="criticalModalBox">
            <button id="criticalTrashClose" class="criticalModalClose" type="button" aria-label="Zavřít">×</button>
            <span class="criticalModalIcon">${icon('trash')}</span>
            <h2 id="criticalTrashTitle">Přesunout nabídku do koše?</h2>
            <p>Nabídka zmizí z veřejného webu, ale půjde obnovit v Kontrole produktů.</p>
            <div id="criticalTrashProduct" class="criticalConfirmCard"></div>
            <div class="criticalConfirmWarning"><strong>Nejde o trvalé smazání.</strong> Trvale ji lze odstranit až ze správy koše.</div>
            <div id="criticalTrashMessage" class="criticalModalMessage"></div>
            <div class="criticalModalActions"><button id="criticalTrashCancel" class="btn light" type="button">Zrušit</button><button id="criticalTrashConfirm" class="btn criticalDanger" type="button">${icon('trash')} Přesunout do koše</button></div>
          </div>
        </div>`);

      ['criticalOfferStore','criticalOfferStatus','criticalOfferProblem'].forEach((id) => $(id)?.addEventListener('change', applyOfferFilters));
      $('title')?.addEventListener('input', onProductInput);
      $('title')?.addEventListener('focus', onProductInput);
      $('image')?.addEventListener('input', updateImagePreview);
      $('criticalUploadLink')?.addEventListener('click', () => {
        if (selectedProduct?.id) sessionStorage.setItem('slevao-photo-product-id', selectedProduct.id);
      });
      $('criticalTrashClose')?.addEventListener('click', closeTrashModal);
      $('criticalTrashCancel')?.addEventListener('click', closeTrashModal);
      $('criticalTrashModal')?.addEventListener('click', (event) => { if (event.target === $('criticalTrashModal')) closeTrashModal(); });
      $('criticalTrashConfirm')?.addEventListener('click', confirmTrash);

      document.querySelectorAll('[data-critical-target]').forEach((button) => button.addEventListener('click', () => openCriticalTarget(button.dataset.criticalTarget)));
      document.addEventListener('click', (event) => {
        if (!event.target.closest('.criticalProductField')) $('criticalProductSuggestions')?.classList.add('hidden');
      });
    }

    function openCriticalTarget(target) {
      if (target === 'review' || target === 'draft' || target === 'trash') {
        document.querySelector('[data-page="offersPage"]')?.click();
        if ($('criticalOfferStatus')) $('criticalOfferStatus').value = target;
        if ($('criticalOfferProblem')) $('criticalOfferProblem').value = 'all';
        applyOfferFilters();
        document.querySelector('#offersPage .head')?.scrollIntoView({ behavior:'smooth', block:'start' });
        return;
      }
      const links = {
        expired:'admin-tesco-kontrola.html?issue=expired-published',
        'missing-image':'admin-tesco-kontrola.html?issue=missing-image',
        duplicates:'admin-tesco-kontrola.html?issue=duplicates',
        photos:'admin-fotografie.html',
        sources:'admin-automatizace.html',
      };
      if (links[target]) location.href = links[target];
    }

    async function fetchAllOffers() {
      const result = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.from('offers')
          .select('id,product_id,store_id,title,price,old_price,image_url,status,valid_from,valid_to,published_at,stores(name)')
          .order('published_at', { ascending:false, nullsFirst:false })
          .range(from, from + 999);
        if (error) throw error;
        result.push(...(data || []));
        if (!data || data.length < 1000 || result.length >= MAX_ROWS) break;
      }
      return result;
    }

    function duplicateKey(row) {
      return [row.store_id || '', fold(row.title), Number(row.price || 0).toFixed(2), row.valid_from || '', row.valid_to || ''].join('|');
    }

    async function refreshCritical() {
      if (dashboardLoading) return;
      dashboardLoading = true;
      try {
        const [rows, storeResult, productResult, photoResult, sourceResult, importResult] = await Promise.all([
          fetchAllOffers(),
          db.from('stores').select('id,name,slug,is_active').order('name'),
          db.from('products').select('id,name,brand,quantity_text,ean,category_id,image_url').order('name').limit(5000),
          db.from('product_image_candidates').select('id', { count:'exact', head:true }).eq('status','pending'),
          db.from('leaflet_sources').select('id,name,is_active,last_error,last_checked_at,check_interval_minutes'),
          db.from('leaflet_imports').select('created_at,status,error_message').order('created_at', { ascending:false }).limit(1),
        ]);
        offerRows = rows;
        if (!storeResult.error) stores = storeResult.data || [];
        if (!productResult.error) products = productResult.data || [];

        const active = rows.filter((row) => row.status !== 'trash');
        const duplicateCounts = new Map();
        active.forEach((row) => duplicateCounts.set(duplicateKey(row), (duplicateCounts.get(duplicateKey(row)) || 0) + 1));
        const metrics = {
          review: active.filter((row) => row.status === 'review').length,
          draft: active.filter((row) => row.status === 'draft').length,
          expired: active.filter((row) => row.status === 'published' && row.valid_to && row.valid_to < today()).length,
          missing: active.filter((row) => !row.image_url).length,
          duplicates: active.filter((row) => (duplicateCounts.get(duplicateKey(row)) || 0) > 1).length,
          trash: rows.filter((row) => row.status === 'trash').length + Object.values(readJson(TRASH_KEY, {})).filter((item) => item.mode === 'deleted' && !rows.some((row) => row.id === item.snapshot?.id)).length,
        };

        $('criticalReview').textContent = metrics.review.toLocaleString('cs-CZ');
        $('criticalDraft').textContent = metrics.draft.toLocaleString('cs-CZ');
        $('criticalExpired').textContent = metrics.expired.toLocaleString('cs-CZ');
        $('criticalMissing').textContent = metrics.missing.toLocaleString('cs-CZ');
        $('criticalDuplicates').textContent = metrics.duplicates.toLocaleString('cs-CZ');
        $('criticalTrash').textContent = metrics.trash.toLocaleString('cs-CZ');
        $('criticalPhotos').textContent = photoResult.error ? '—' : String(photoResult.count ?? 0);

        const now = Date.now();
        const sourceRows = sourceResult.error ? [] : (sourceResult.data || []);
        const problemSources = sourceRows.filter((source) => {
          if (!source.is_active) return false;
          if (source.last_error) return true;
          const checked = source.last_checked_at ? new Date(source.last_checked_at).getTime() : 0;
          const maxAge = Math.max(Number(source.check_interval_minutes || 360) * 2, 720) * 60000;
          return !checked || now - checked > maxAge;
        });
        $('criticalSources').textContent = sourceResult.error ? '—' : problemSources.length.toLocaleString('cs-CZ');

        const totalProblems = metrics.expired + metrics.duplicates + problemSources.length;
        const health = $('criticalHealth');
        health.classList.remove('loadingState','okState','warnState','badState');
        if (totalProblems === 0) {
          health.classList.add('okState');
          $('criticalHealthTitle').textContent = 'Provoz webu je v pořádku';
        } else if (problemSources.length || metrics.duplicates) {
          health.classList.add('badState');
          $('criticalHealthTitle').textContent = `${totalProblems} položek potřebuje zásah`;
        } else {
          health.classList.add('warnState');
          $('criticalHealthTitle').textContent = `${totalProblems} položek čeká na kontrolu`;
        }
        const latestImport = importResult.error ? null : importResult.data?.[0];
        const lastText = latestImport?.created_at ? ` Poslední import: ${new Date(latestImport.created_at).toLocaleString('cs-CZ')}.` : '';
        $('criticalHealthText').textContent = `${problemSources.length} problémových zdrojů, ${metrics.duplicates} duplicit a ${metrics.expired} prošlých publikovaných nabídek.${lastText}`;

        $('sOffers').textContent = active.length.toLocaleString('cs-CZ');
        $('sPublished').textContent = active.filter((row) => row.status === 'published').length.toLocaleString('cs-CZ');
        populateOfferStoreFilter();
        applyOfferFilters();
      } catch (error) {
        const health = $('criticalHealth');
        health?.classList.remove('loadingState');
        health?.classList.add('badState');
        if ($('criticalHealthTitle')) $('criticalHealthTitle').textContent = 'Provozní kontrolu se nepodařilo načíst';
        if ($('criticalHealthText')) $('criticalHealthText').textContent = error?.message || 'Neznámá chyba při načítání dat.';
      } finally {
        dashboardLoading = false;
      }
    }

    function populateOfferStoreFilter() {
      const select = $('criticalOfferStore');
      if (!select) return;
      const current = select.value;
      select.innerHTML = '<option value="all">Všechny obchody</option>' + stores.map((store) => `<option value="${esc(store.id)}">${esc(store.name)}</option>`).join('');
      if ([...select.options].some((option) => option.value === current)) select.value = current;
    }

    function applyOfferFilters() {
      if (applyingOfferFilters) return;
      applyingOfferFilters = true;
      requestAnimationFrame(() => {
        try {
          const status = $('criticalOfferStatus')?.value || 'active';
          const storeId = $('criticalOfferStore')?.value || 'all';
          const problem = $('criticalOfferProblem')?.value || 'all';
          const duplicateCounts = new Map();
          offerRows.filter((row) => row.status !== 'trash').forEach((row) => duplicateCounts.set(duplicateKey(row), (duplicateCounts.get(duplicateKey(row)) || 0) + 1));
          let visible = 0;
          document.querySelectorAll('#offers .item').forEach((item) => {
            const id = item.querySelector('[data-edit]')?.dataset.edit || item.querySelector('[data-delete]')?.dataset.delete || '';
            const row = offerRows.find((offer) => offer.id === id);
            if (!row) { item.hidden = false; return; }
            let matches = true;
            if (status === 'active' && row.status === 'trash') matches = false;
            else if (status !== 'all' && status !== 'active' && row.status !== status) matches = false;
            if (storeId !== 'all' && row.store_id !== storeId) matches = false;
            if (problem === 'missing-image' && row.image_url) matches = false;
            if (problem === 'bad-price' && Number(row.price || 0) > 0 && !(Number(row.old_price || 0) > 0 && Number(row.old_price) < Number(row.price))) matches = false;
            if (problem === 'expired-published' && !(row.status === 'published' && row.valid_to && row.valid_to < today())) matches = false;
            if (problem === 'duplicates' && (duplicateCounts.get(duplicateKey(row)) || 0) < 2) matches = false;
            item.hidden = !matches;
            if (matches) visible += 1;

            if (row.status === 'trash') {
              item.classList.add('criticalTrashItem');
              const actions = item.querySelector('.actions');
              if (actions && !actions.dataset.criticalTrashActions) {
                actions.dataset.criticalTrashActions = '1';
                actions.innerHTML = `<button data-critical-restore="${esc(row.id)}">Obnovit</button><a href="admin-tesco-kontrola.html?status=trash">Správa koše</a>`;
              }
            }
          });
          let info = $('criticalOfferFilterInfo');
          if (!info) {
            document.querySelector('#offersPage .card:nth-child(2) h2')?.insertAdjacentHTML('afterend', '<div id="criticalOfferFilterInfo" class="criticalOfferFilterInfo"></div>');
            info = $('criticalOfferFilterInfo');
          }
          if (info) info.textContent = `Zobrazeno ${visible} z posledních ${document.querySelectorAll('#offers .item').length} načtených nabídek.`;
        } finally {
          applyingOfferFilters = false;
        }
      });
    }

    function productLabel(product) {
      return [product.brand, product.name, product.quantity_text].filter(Boolean).join(' · ');
    }
    function onProductInput() {
      const value = $('title')?.value || '';
      if (selectedProduct && fold(value) !== fold(selectedProduct.name)) selectedProduct = null;
      const term = fold(value);
      const panel = $('criticalProductSuggestions');
      if (!panel) return;
      if (term.length < 2 || !products.length) {
        panel.classList.add('hidden');
        updateProductState();
        return;
      }
      const matches = products.filter((product) => fold([product.name, product.brand, product.quantity_text, product.ean].filter(Boolean).join(' ')).includes(term)).slice(0, 8);
      panel.innerHTML = matches.length ? matches.map((product) => `<button type="button" data-critical-product="${esc(product.id)}"><strong>${esc(productLabel(product))}</strong><span>${product.ean ? `EAN ${esc(product.ean)} · ` : ''}${product.image_url ? 'má fotografii' : 'bez fotografie'}</span></button>`).join('') : '<div class="criticalProductEmpty">Nenalezen existující produkt. Při uložení vznikne nový.</div>';
      panel.classList.remove('hidden');
      panel.querySelectorAll('[data-critical-product]').forEach((button) => button.addEventListener('click', () => selectExistingProduct(button.dataset.criticalProduct)));
      updateProductState();
    }
    function selectExistingProduct(id) {
      const product = products.find((item) => item.id === id);
      if (!product) return;
      selectedProduct = product;
      $('title').value = product.name || '';
      if ($('category') && product.category_id) $('category').value = product.category_id;
      if ($('image') && !$('image').value && product.image_url) $('image').value = product.image_url;
      $('criticalProductSuggestions').classList.add('hidden');
      updateProductState();
      updateImagePreview();
    }
    function updateProductState() {
      const box = $('criticalProductState');
      if (!box) return;
      if (selectedProduct) {
        box.className = 'criticalProductState selected';
        box.innerHTML = `${icon('link')} Použije se existující produkt <strong>${esc(productLabel(selectedProduct))}</strong>. Nevznikne duplicita.`;
        return;
      }
      const exact = products.filter((product) => fold(product.name) === fold($('title')?.value));
      if (exact.length) {
        box.className = 'criticalProductState warning';
        box.textContent = 'Tento název už v databázi existuje. Vyber produkt z našeptávače.';
      } else {
        box.className = 'criticalProductState';
        box.textContent = 'Začni psát. Systém zkontroluje existující produkty, aby nevznikla duplicita.';
      }
    }
    function updateImagePreview() {
      const preview = $('criticalImagePreview');
      if (!preview) return;
      const url = nullable($('image')?.value);
      preview.innerHTML = url ? `<img src="${esc(url)}" alt="Náhled fotografie" onerror="this.remove();this.parentElement.textContent='Bez náhledu'">` : icon('photo');
    }

    async function saveOfferSafely() {
      const button = $('saveBtn');
      const name = $('title').value.trim();
      const storeId = $('store').value;
      const price = Number($('price').value);
      const oldPrice = $('oldPrice').value ? Number($('oldPrice').value) : null;
      const validFrom = $('from').value;
      const validTo = $('to').value;
      const status = $('status').value;
      const categoryId = $('category').value || null;
      const typedImage = nullable($('image').value);

      if (!name || !storeId || !Number.isFinite(price) || price <= 0 || !validFrom || !validTo) return showFormMessage('Vyplň název, obchod, cenu a platnost.', 'err');
      if (oldPrice !== null && oldPrice < price) return showFormMessage('Původní cena nesmí být nižší než akční cena.', 'err');
      if (validFrom > validTo) return showFormMessage('Datum začátku nesmí být po datu konce.', 'err');

      button.disabled = true;
      button.textContent = 'Ukládám…';
      try {
        let product = selectedProduct && fold(selectedProduct.name) === fold(name) ? selectedProduct : null;
        const exact = products.filter((item) => fold(item.name) === fold(name));
        if (!product && exact.length === 1) product = exact[0];
        if (!product && exact.length > 1) throw new Error('V databázi je více produktů se stejným názvem. Vyber správný produkt z našeptávače.');

        let productId = product?.id || '';
        const imageUrl = typedImage || product?.image_url || null;
        if (!productId) {
          const { data, error } = await db.from('products').insert({ name, category_id:categoryId, image_url:imageUrl, is_verified:true }).select('id,name,category_id,image_url').single();
          if (error) throw error;
          productId = data.id;
          product = data;
        }

        const payload = {
          product_id:productId,
          store_id:storeId,
          title:name,
          price,
          old_price:oldPrice,
          image_url:imageUrl,
          valid_from:validFrom,
          valid_to:validTo,
          status,
          is_verified:true,
          published_at:status === 'published' ? new Date().toISOString() : null,
        };
        const { data: inserted, error } = await db.from('offers').insert(payload).select('id').single();
        if (error) throw error;
        addHistory(product === selectedProduct || exact.length === 1 ? 'Přidána nabídka k existujícímu produktu' : 'Přidána nová nabídka', { ...payload, id:inserted.id, stores:{ name:stores.find((store) => store.id === storeId)?.name || '' } }, null, payload);
        clearPublicCache();
        showFormMessage(product === selectedProduct || exact.length === 1 ? 'Nabídka byla uložena k existujícímu produktu. Nevznikla duplicita.' : 'Nový produkt a nabídka byly uloženy.', 'ok');
        $('offerForm').reset();
        selectedProduct = null;
        const now = new Date();
        $('from').value = now.toISOString().slice(0, 10);
        $('to').value = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10);
        updateProductState(); updateImagePreview();
        $('reload')?.click();
        await refreshCritical();
      } catch (error) {
        showFormMessage(error?.message || 'Nabídku se nepodařilo uložit.', 'err');
      } finally {
        button.disabled = false;
        button.textContent = 'Uložit nabídku';
      }
    }

    function openTrashModal(id) {
      const row = offerRows.find((offer) => offer.id === id);
      if (!row || row.status === 'trash') return;
      deleteTarget = row;
      $('criticalTrashProduct').innerHTML = `<strong>${esc(row.title || 'Bez názvu')}</strong><span>${esc(row.stores?.name || 'Neznámý obchod')} · ${Number(row.price || 0).toLocaleString('cs-CZ')} Kč · ${esc(row.valid_from || '—')} až ${esc(row.valid_to || '—')}</span>`;
      $('criticalTrashMessage').textContent = '';
      $('criticalTrashModal').classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
    function closeTrashModal() {
      $('criticalTrashModal')?.classList.add('hidden');
      document.body.style.overflow = '';
      deleteTarget = null;
    }
    async function confirmTrash() {
      if (!deleteTarget) return;
      const button = $('criticalTrashConfirm');
      button.disabled = true;
      $('criticalTrashMessage').textContent = 'Přesouvám nabídku do koše…';
      try {
        const row = clone(deleteTarget);
        const originalStatus = row.status || 'review';
        const { error } = await db.from('offers').update({ status:'trash', published_at:null }).eq('id', row.id);
        if (!error) {
          saveTrash(row, 'soft', originalStatus);
          addHistory('Přesunuto do koše', row, row, { ...row, status:'trash', published_at:null }, 'Záznam zůstal v databázi.');
        } else {
          const { error: deleteError } = await db.from('offers').delete().eq('id', row.id);
          if (deleteError) throw new Error(`${error.message}; bezpečný náhradní koš selhal: ${deleteError.message}`);
          saveTrash(row, 'deleted', originalStatus);
          addHistory('Přesunuto do místního koše', row, row, null, 'Databáze nepovolila stav trash; záznam lze obnovit z tohoto prohlížeče v Kontrole produktů.');
        }
        clearPublicCache();
        $('criticalTrashMessage').textContent = 'Nabídka byla přesunuta do koše.';
        $('reload')?.click();
        await refreshCritical();
        setTimeout(closeTrashModal, 500);
      } catch (error) {
        $('criticalTrashMessage').textContent = error?.message || 'Přesun do koše selhal.';
      } finally {
        button.disabled = false;
      }
    }
    async function restoreOffer(id) {
      const row = offerRows.find((offer) => offer.id === id);
      if (!row) return;
      const trash = readJson(TRASH_KEY, {});
      const status = trash[id]?.originalStatus || (row.published_at ? 'published' : 'review');
      const { error } = await db.from('offers').update({ status, published_at:status === 'published' ? (row.published_at || new Date().toISOString()) : null }).eq('id', id);
      if (error) return alert(error.message);
      removeTrash(id);
      addHistory('Obnoveno z koše', row, row, { ...row, status });
      clearPublicCache();
      $('reload')?.click();
      await refreshCritical();
    }

    document.addEventListener('click', (event) => {
      const save = event.target.closest('#saveBtn');
      if (save) {
        event.preventDefault();
        event.stopImmediatePropagation();
        saveOfferSafely();
        return;
      }
      const remove = event.target.closest('[data-delete]');
      if (remove) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openTrashModal(remove.dataset.delete);
        return;
      }
      const restore = event.target.closest('[data-critical-restore]');
      if (restore) {
        event.preventDefault();
        event.stopImmediatePropagation();
        restoreOffer(restore.dataset.criticalRestore);
      }
    }, true);

    const offersObserver = new MutationObserver(() => applyOfferFilters());
    if ($('offers')) offersObserver.observe($('offers'), { childList:true, subtree:true });

    async function initializeForSession(session) {
      if (!session || !['admin','editor'].includes(session.user?.app_metadata?.role || '')) return;
      if (!initialized) {
        installDom();
        initialized = true;
      }
      await refreshCritical();
    }

    db.auth.onAuthStateChange((_event, session) => setTimeout(() => initializeForSession(session), 150));
    db.auth.getSession().then(({ data }) => initializeForSession(data.session));
  });
})();
