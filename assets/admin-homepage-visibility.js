(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const ANON_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const SETTINGS_URL = `${SUPABASE_URL}/storage/v1/object/public/homepage-leaflet-settings/visibility.json`;
  const VISIBILITY_KEY = 'slevao-leaflet-visibility';
  const FORCE_KEY = 'slevao-leaflet-force';
  const EMPTY_META_BASE = 'https://slevao.cz/';
  const TODAY = new Date().toISOString().slice(0, 10);
  const MAX_AUTO_CARDS = 12;
  const STORE_BATCH_SIZE = 8;
  const PRIORITY_SLUGS = [
    'tesco', 'penny', 'makro', 'kaufland', 'lidl', 'albert', 'billa', 'globus',
    'coop', 'hruska', 'norma', 'terno', 'action', 'dm', 'rossmann', 'teta',
  ];
  const PRIORITY = new Map(PRIORITY_SLUGS.map((slug, index) => [slug, index]));
  const $ = (id) => document.getElementById(id);
  const db = window.supabase?.createClient(SUPABASE_URL, ANON_KEY);

  let allStores = [];
  let stores = [];
  let automaticSlugs = new Set();
  let hidden = new Set();
  let legacyHidden = new Set();
  let busy = '';

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const fold = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const icon = (name) => {
    if (name === 'eye') return '<svg class="uiIcon" viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    if (name === 'plus') return '<svg class="uiIcon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
    if (name === 'remove') return '<svg class="uiIcon" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M8 10v8M12 10v8M16 10v8M5 6l1 15h12l1-15"/></svg>';
    return '<svg class="uiIcon" viewBox="0 0 24 24"><path d="m3 3 18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 4.2A10.5 10.5 0 0 1 12 4c5 0 9 4 10 8a12.4 12.4 0 0 1-2 4"/><path d="M6.6 6.6A11.8 11.8 0 0 0 2 12c1 4 5 8 10 8a10.7 10.7 0 0 0 5.4-1.5"/></svg>';
  };

  function show(text, type = 'ok') {
    const box = $('message');
    if (!box) return;
    box.textContent = text;
    box.className = `visibilityMessage show ${type}`;
  }

  function clearMessage() {
    const box = $('message');
    if (!box) return;
    box.textContent = '';
    box.className = 'visibilityMessage';
  }

  function parseMeta(value) {
    const raw = String(value || '').trim();
    const index = raw.indexOf('#');
    if (index < 0) return { base: raw, params: new URLSearchParams() };
    return { base: raw.slice(0, index), params: new URLSearchParams(raw.slice(index + 1)) };
  }

  function metaIn(value, key) {
    return parseMeta(value).params.get(key) || '';
  }

  function storeMeta(store, key) {
    return metaIn(store?.website_url, key) || metaIn(store?.logo_url, key) || '';
  }

  function storeMarker(store) {
    const marker = storeMeta(store, VISIBILITY_KEY);
    return marker === 'hidden' || marker === 'visible' ? marker : '';
  }

  function isForced(store) {
    return storeMeta(store, FORCE_KEY) === '1';
  }

  function withMetadata(value, updates) {
    const parsed = parseMeta(value);
    Object.entries(updates).forEach(([key, setting]) => {
      if (setting === '' || setting === null || setting === undefined) parsed.params.delete(key);
      else parsed.params.set(key, String(setting));
    });
    const query = parsed.params.toString();
    return query ? `${parsed.base || EMPTY_META_BASE}#${query}` : (parsed.base || EMPTY_META_BASE);
  }

  function sortByHomepagePriority(rows) {
    return [...rows].sort((a, b) => {
      const aRank = PRIORITY.has(a.slug) ? PRIORITY.get(a.slug) : 999;
      const bRank = PRIORITY.has(b.slug) ? PRIORITY.get(b.slug) : 999;
      return aRank - bRank || String(a.name || '').localeCompare(String(b.name || ''), 'cs');
    });
  }

  async function currentSession() {
    if (!db) throw new Error('Supabase se nepodařilo načíst. Obnov stránku přes Ctrl+F5.');
    const { data, error } = await db.auth.getSession();
    const session = data?.session;
    if (error || !session) throw new Error('Přihlášení vypršelo. Přihlas se znovu.');
    if (!['admin', 'editor'].includes(session.user.app_metadata?.role)) {
      throw new Error('Účet nemá oprávnění měnit hlavní sekci letáků.');
    }
    return session;
  }

  async function fetchWithTimeout(url, options = {}, milliseconds = 9000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), milliseconds);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function readLegacySettings() {
    try {
      const response = await fetch(`${SETTINGS_URL}?v=${Date.now()}`, { cache: 'no-store' });
      if (response.status === 404) return new Set();
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      return new Set((Array.isArray(payload?.hidden_slugs) ? payload.hidden_slugs : [])
        .map((slug) => String(slug || '').trim().toLowerCase())
        .filter((slug) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)));
    } catch (error) {
      console.warn('Staré nastavení viditelnosti není dostupné:', error);
      return new Set();
    }
  }

  function currentLeaflet(rows) {
    return (Array.isArray(rows) ? rows : [])
      .filter((leaflet) => leaflet?.preview_url)
      .filter((leaflet) => !leaflet.valid_from || leaflet.valid_from <= TODAY)
      .filter((leaflet) => !leaflet.valid_to || leaflet.valid_to >= TODAY)
      .sort((a, b) => {
        const aPriority = a.key === 'hypermarket' ? 0 : a.key === 'supermarket' ? 1 : 2;
        const bPriority = b.key === 'hypermarket' ? 0 : b.key === 'supermarket' ? 1 : 2;
        return aPriority - bPriority
          || String(a.valid_to || '9999-12-31').localeCompare(String(b.valid_to || '9999-12-31'));
      })[0] || null;
  }

  async function activeOfferStoreIds() {
    const ids = new Set();
    for (let from = 0; from < 5000; from += 1000) {
      const { data, error } = await db.from('offers')
        .select('store_id')
        .eq('status', 'published')
        .lte('valid_from', TODAY)
        .gte('valid_to', TODAY)
        .range(from, from + 999);
      if (error) throw error;
      (data || []).forEach((row) => row.store_id && ids.add(String(row.store_id)));
      if (!data || data.length < 1000) break;
    }
    return ids;
  }

  async function hasCurrentHomepageLeaflet(store) {
    const endpoint = `${SUPABASE_URL}/functions/v1/store-leaflet-feed?store=${encodeURIComponent(store.slug)}&source=admin-homepage-visibility-v3`;
    const response = await fetchWithTimeout(endpoint, {
      headers: { apikey: ANON_KEY }, cache: 'no-store',
    });
    if (!response.ok) throw new Error(`${store.slug}: HTTP ${response.status}`);
    const payload = await response.json();
    return Boolean(currentLeaflet(payload?.leaflets));
  }

  async function resolveAutomaticStores(rows) {
    let activeIds = null;
    try {
      activeIds = await activeOfferStoreIds();
    } catch (error) {
      console.warn('Obchody se nepodařilo omezit podle aktivních nabídek:', error);
    }

    const candidates = sortByHomepagePriority(rows.filter((store) =>
      store?.slug && store?.name && store.is_active && (!activeIds || activeIds.has(String(store.id)))));
    const output = [];

    for (let offset = 0; offset < candidates.length && output.length < MAX_AUTO_CARDS; offset += STORE_BATCH_SIZE) {
      const batch = candidates.slice(offset, offset + STORE_BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(async (store) => ({
        store, available: await hasCurrentHomepageLeaflet(store),
      })));
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.available && output.length < MAX_AUTO_CARDS) {
          output.push(result.value.store);
        }
      });
    }
    return output;
  }

  function rebuildVisibleStores(automatic) {
    automaticSlugs = new Set(automatic.map((store) => store.slug));
    const combined = new Map(automatic.map((store) => [store.slug, store]));
    allStores.filter(isForced).forEach((store) => combined.set(store.slug, store));
    stores = sortByHomepagePriority([...combined.values()]);
  }

  function rebuildHidden() {
    const allowed = new Set(stores.map((store) => store.slug));
    hidden = new Set([...legacyHidden].filter((slug) => allowed.has(slug)));
    for (const store of stores) {
      const marker = storeMarker(store);
      if (marker === 'hidden') hidden.add(store.slug);
      if (marker === 'visible') hidden.delete(store.slug);
    }
  }

  function cleanLogoUrl(store) {
    return parseMeta(store?.logo_url).base;
  }

  function logo(store) {
    const logoUrl = cleanLogoUrl(store);
    return logoUrl
      ? `<img src="${esc(logoUrl)}" alt="Logo ${esc(store.name)}" onerror="this.replaceWith(document.createTextNode('%'))">`
      : '%';
  }

  function metrics() {
    $('totalCount').textContent = stores.length.toLocaleString('cs-CZ');
    $('hiddenCount').textContent = hidden.size.toLocaleString('cs-CZ');
    $('visibleCount').textContent = Math.max(0, stores.length - hidden.size).toLocaleString('cs-CZ');
  }

  function ensureAddPanel() {
    if ($('manualStorePanel')) return;
    const panel = document.querySelector('.visibilityPanel');
    const toolbar = panel?.querySelector('.visibilityToolbar');
    if (!panel || !toolbar) return;

    const style = document.createElement('style');
    style.textContent = `
      .manualStorePanel{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:end;margin-bottom:18px;padding:18px;border:1px solid #cfeae7;border-radius:15px;background:#f3fbfa}
      .manualStorePanel h2{margin:0 0 5px;font-size:18px;font-weight:650}.manualStorePanel p{margin:0 0 12px;color:#64748b;font-size:13px}
      .manualStorePanel select{width:100%;height:44px;padding:0 12px;border:1px solid var(--line);border-radius:10px;background:#fff}
      .manualStorePanel .btn{min-width:190px;height:44px}.manualStoreHint{grid-column:1/-1;margin:0!important;color:#51716e!important}
      .manualRemoveBtn{min-width:auto!important}.visibilityActions{flex-wrap:wrap}
      @media(max-width:760px){.manualStorePanel{grid-template-columns:1fr}.manualStorePanel .btn{width:100%}}
    `;
    document.head.append(style);

    const section = document.createElement('section');
    section.id = 'manualStorePanel';
    section.className = 'manualStorePanel';
    section.innerHTML = `
      <div>
        <h2>Přidat další obchod</h2>
        <p>Vlastní karta umožní zobrazit obchod i bez automaticky nalezeného letáku.</p>
        <select id="manualStoreSelect" aria-label="Vyber další obchod"><option value="">Načítám obchody…</option></select>
      </div>
      <button id="manualStoreAdd" class="btn primary" type="button" disabled>${icon('plus')}Přidat do sekce</button>
      <p class="manualStoreHint">Má-li obchod vlastní titulní stranu, použije se. Jinak se vytvoří čistá značková titulní strana.</p>
    `;
    panel.insertBefore(section, toolbar);
    $('manualStoreSelect').addEventListener('change', () => {
      $('manualStoreAdd').disabled = !$('manualStoreSelect').value || Boolean(busy);
    });
    $('manualStoreAdd').addEventListener('click', addManualStore);
  }

  function renderAddOptions() {
    ensureAddPanel();
    const select = $('manualStoreSelect');
    const button = $('manualStoreAdd');
    if (!select || !button) return;
    const current = new Set(stores.map((store) => store.slug));
    const choices = allStores
      .filter((store) => store.is_active && !current.has(store.slug))
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'cs'));
    select.innerHTML = choices.length
      ? `<option value="">Vyber obchod…</option>${choices.map((store) => `<option value="${esc(store.id)}">${esc(store.name)} (${esc(store.slug)})</option>`).join('')}`
      : '<option value="">Všechny aktivní obchody už jsou v sekci</option>';
    button.disabled = !choices.length || Boolean(busy);
  }

  function render() {
    const term = fold($('search').value.trim());
    const filter = $('filter').value;
    const rows = stores.filter((store) => {
      const isHidden = hidden.has(store.slug);
      if (filter === 'visible' && isHidden) return false;
      if (filter === 'hidden' && !isHidden) return false;
      return !term || fold(`${store.name} ${store.slug}`).includes(term);
    });

    $('list').innerHTML = rows.length ? rows.map((store) => {
      const isHidden = hidden.has(store.slug);
      const forced = isForced(store);
      const automatic = automaticSlugs.has(store.slug);
      const waiting = busy === store.slug;
      return `<article class="visibilityStore ${isHidden ? 'isHidden' : ''}">
        <div class="visibilityLogo">${logo(store)}</div>
        <div>
          <h2>${esc(store.name)}</h2>
          <div class="visibilityMeta">
            <span class="visibilityPill">${esc(store.slug)}</span>
            <span class="visibilityPill ${forced ? 'warn' : 'ok'}">${forced && !automatic ? 'Vlastní karta nabídky' : forced ? 'Automatická + vlastní karta' : 'Má aktuální kartu letáku'}</span>
            <span class="visibilityPill ${isHidden ? 'bad' : 'ok'}">${isHidden ? 'Na hlavní stránce skrytý' : 'Na hlavní stránce zobrazený'}</span>
          </div>
        </div>
        <div class="visibilityActions">
          <button class="btn ${isHidden ? 'successBtn' : 'dangerBtn'}" type="button" data-toggle="${esc(store.slug)}" ${waiting ? 'disabled' : ''}>
            ${waiting ? 'Ukládám…' : isHidden ? `${icon('eye')}Zobrazit v sekci` : `${icon('eyeOff')}Skrýt ze sekce`}
          </button>
          ${forced ? `<button class="btn light manualRemoveBtn" type="button" data-remove-force="${esc(store.slug)}" ${waiting ? 'disabled' : ''}>${icon('remove')}Odebrat vlastní kartu</button>` : ''}
        </div>
      </article>`;
    }).join('') : '<div class="visibilityEmpty">Žádná karta neodpovídá filtru.</div>';

    $('list').querySelectorAll('[data-toggle]').forEach((button) => {
      button.addEventListener('click', () => toggle(button.dataset.toggle));
    });
    $('list').querySelectorAll('[data-remove-force]').forEach((button) => {
      button.addEventListener('click', () => removeManualStore(button.dataset.removeForce));
    });
    metrics();
    renderAddOptions();
  }

  async function readFreshStore(id) {
    const { data, error } = await db.from('stores')
      .select('id,name,slug,logo_url,website_url,is_active')
      .eq('id', id)
      .single();
    if (error || !data) throw error || new Error('Obchod nebyl nalezen.');
    return data;
  }

  async function saveMetadata(store, updates) {
    const fresh = await readFreshStore(store.id);
    const nextValue = withMetadata(fresh.website_url, updates);
    const field = 'website_url';
    const { data, error } = await db.from('stores')
      .update({ [field]: nextValue })
      .eq('id', fresh.id)
      .select('id,name,slug,logo_url,website_url,is_active')
      .single();
    if (error) throw error;
    return data || { ...fresh, [field]: nextValue };
  }

  function announceChange(slug) {
    try {
      localStorage.setItem('slevao-leaflet-visibility-changed', `${slug}:${Date.now()}`);
    } catch { /* localStorage může být vypnuté */ }
    window.dispatchEvent(new CustomEvent('slevao:leaflet-visibility-changed', { detail: { slug } }));
  }

  async function addManualStore() {
    const id = $('manualStoreSelect')?.value;
    const store = allStores.find((item) => item.id === id);
    if (!store || busy) return;
    busy = store.slug;
    clearMessage();
    render();
    try {
      await currentSession();
      const saved = await saveMetadata(store, {
        [FORCE_KEY]: '1',
        [VISIBILITY_KEY]: 'visible',
      });
      const index = allStores.findIndex((item) => item.id === saved.id);
      if (index >= 0) allStores[index] = saved;
      rebuildVisibleStores(stores.filter((item) => automaticSlugs.has(item.slug)));
      rebuildHidden();
      announceChange(saved.slug);
      show(`${saved.name} byl přidán do hlavní sekce letáků.`);
    } catch (error) {
      show(error?.message || 'Obchod se nepodařilo přidat.', 'err');
    } finally {
      busy = '';
      render();
    }
  }

  async function removeManualStore(slug) {
    const store = allStores.find((item) => item.slug === slug);
    if (!store || busy) return;
    busy = slug;
    clearMessage();
    render();
    try {
      await currentSession();
      const saved = await saveMetadata(store, { [FORCE_KEY]: '' });
      const index = allStores.findIndex((item) => item.id === saved.id);
      if (index >= 0) allStores[index] = saved;
      const automatic = stores.filter((item) => automaticSlugs.has(item.slug));
      rebuildVisibleStores(automatic);
      rebuildHidden();
      announceChange(saved.slug);
      show(automaticSlugs.has(slug)
        ? `${saved.name} už nemá vlastní připnutí, ale zůstává jako automatická karta.`
        : `${saved.name} byl z vlastních karet odebrán.`);
    } catch (error) {
      show(error?.message || 'Ruční přidání se nepodařilo odebrat.', 'err');
    } finally {
      busy = '';
      render();
    }
  }

  async function toggle(slug) {
    const store = allStores.find((item) => item.slug === slug);
    if (!store || busy) return;
    const makeVisible = hidden.has(slug);
    busy = slug;
    clearMessage();
    render();
    try {
      await currentSession();
      const saved = await saveMetadata(store, {
        [VISIBILITY_KEY]: makeVisible ? 'visible' : 'hidden',
      });
      const index = allStores.findIndex((item) => item.id === saved.id);
      if (index >= 0) allStores[index] = saved;
      const visibleIndex = stores.findIndex((item) => item.id === saved.id);
      if (visibleIndex >= 0) stores[visibleIndex] = saved;
      rebuildHidden();
      announceChange(saved.slug);
      show(makeVisible
        ? `${saved.name} se na hlavní stránce znovu zobrazí.`
        : `${saved.name} byl z hlavní sekce letáků skryt.`);
    } catch (error) {
      show(error?.message || 'Nastavení se nepodařilo uložit.', 'err');
    } finally {
      busy = '';
      render();
    }
  }

  async function load() {
    clearMessage();
    $('reload').disabled = true;
    $('list').innerHTML = '<div class="visibilityEmpty">Načítám karty hlavní stránky…</div>';
    ensureAddPanel();
    try {
      await currentSession();
      const [{ data, error }, oldSettings] = await Promise.all([
        db.from('stores').select('id,name,slug,logo_url,website_url,is_active').order('name'),
        readLegacySettings(),
      ]);
      if (error) throw error;
      allStores = (data || []).filter((store) => store?.slug && store?.name);
      const automatic = await resolveAutomaticStores(allStores);
      rebuildVisibleStores(automatic);
      legacyHidden = oldSettings;
      rebuildHidden();
      render();
      if (!stores.length) show('Hlavní stránka nyní nemá žádnou kartu letáku.', 'err');
    } catch (error) {
      show(error?.name === 'AbortError'
        ? 'Načítání aktuálních letáků překročilo časový limit. Klikni na Obnovit.'
        : error?.message || 'Data se nepodařilo načíst.', 'err');
      $('list').innerHTML = '<div class="visibilityEmpty">Načtení selhalo.</div>';
    } finally {
      $('reload').disabled = false;
    }
  }

  async function authenticate() {
    if (!db) throw new Error('Supabase se nepodařilo načíst. Obnov stránku přes Ctrl+F5.');
    const { data: { session } } = await db.auth.getSession();
    if (!session) {
      $('loginBox').classList.remove('hidden');
      $('app').classList.add('hidden');
      return;
    }
    if (!['admin', 'editor'].includes(session.user.app_metadata?.role)) {
      await db.auth.signOut();
      throw new Error('Účet nemá roli admin nebo editor.');
    }
    $('loginBox').classList.add('hidden');
    $('app').classList.remove('hidden');
    $('who').textContent = `${session.user.email} · ${session.user.app_metadata.role}`;
    $('sideWho').textContent = `${session.user.email} · ${session.user.app_metadata.role}`;
    await load();
  }

  function bind() {
    $('search').addEventListener('input', render);
    $('filter').addEventListener('change', render);
    $('reload').addEventListener('click', load);
    $('loginBtn').addEventListener('click', async () => {
      const { error } = await db.auth.signInWithPassword({
        email: $('email').value.trim(), password: $('password').value,
      });
      if (error) {
        const box = $('loginMsg');
        box.textContent = error.message;
        box.className = 'visibilityMessage show err';
        return;
      }
      authenticate().catch((authError) => {
        const box = $('loginMsg');
        box.textContent = authError.message;
        box.className = 'visibilityMessage show err';
      });
    });
    $('logout').addEventListener('click', async () => {
      await db.auth.signOut();
      location.reload();
    });
  }

  function init() {
    bind();
    authenticate().catch((error) => {
      const box = $('loginMsg');
      box.textContent = error.message;
      box.className = 'visibilityMessage show err';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();