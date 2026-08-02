(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const ANON_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const SETTINGS_URL = `${SUPABASE_URL}/storage/v1/object/public/homepage-leaflet-settings/visibility.json`;
  const META_KEY = 'slevao-leaflet-visibility';
  const EMPTY_META_BASE = 'https://slevao.cz/';
  const TODAY = new Date().toISOString().slice(0, 10);
  const MAX_CARDS = 12;
  const STORE_BATCH_SIZE = 8;
  const PRIORITY_SLUGS = [
    'tesco', 'penny', 'makro', 'kaufland', 'lidl', 'albert', 'billa', 'globus',
    'coop', 'hruska', 'norma', 'terno', 'action', 'dm', 'rossmann', 'teta',
  ];
  const PRIORITY = new Map(PRIORITY_SLUGS.map((slug, index) => [slug, index]));
  const $ = (id) => document.getElementById(id);
  const db = window.supabase?.createClient(SUPABASE_URL, ANON_KEY);

  let stores = [];
  let hidden = new Set();
  let legacyHidden = new Set();
  let busy = '';

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
  const fold = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const icon = (name) => name === 'eye'
    ? '<svg class="uiIcon" viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'
    : '<svg class="uiIcon" viewBox="0 0 24 24"><path d="m3 3 18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 4.2A10.5 10.5 0 0 1 12 4c5 0 9 4 10 8a12.4 12.4 0 0 1-2 4"/><path d="M6.6 6.6A11.8 11.8 0 0 0 2 12c1 4 5 8 10 8a10.7 10.7 0 0 0 5.4-1.5"/></svg>';

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
    return {
      base: raw.slice(0, index),
      params: new URLSearchParams(raw.slice(index + 1)),
    };
  }

  function markerIn(value) {
    const marker = parseMeta(value).params.get(META_KEY);
    return marker === 'hidden' || marker === 'visible' ? marker : '';
  }

  function storeMarker(store) {
    return markerIn(store?.website_url) || markerIn(store?.logo_url) || '';
  }

  function markerField(store) {
    if (markerIn(store?.website_url)) return 'website_url';
    if (markerIn(store?.logo_url)) return 'logo_url';
    if (String(store?.website_url || '').trim()) return 'website_url';
    if (String(store?.logo_url || '').trim()) return 'logo_url';
    return 'website_url';
  }

  function withMarker(value, marker) {
    const parsed = parseMeta(value);
    parsed.params.set(META_KEY, marker);
    return `${parsed.base || EMPTY_META_BASE}#${parsed.params.toString()}`;
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
      throw new Error('Účet nemá oprávnění měnit viditelnost letáků.');
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
    const endpoint = `${SUPABASE_URL}/functions/v1/store-leaflet-feed?store=${encodeURIComponent(store.slug)}&source=admin-homepage-visibility-v2`;
    const response = await fetchWithTimeout(endpoint, {
      headers: { apikey: ANON_KEY },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`${store.slug}: HTTP ${response.status}`);
    const payload = await response.json();
    return Boolean(currentLeaflet(payload?.leaflets));
  }

  async function resolveHomepageStores(allStores) {
    let activeIds = null;
    try {
      activeIds = await activeOfferStoreIds();
    } catch (error) {
      console.warn('Obchody se nepodařilo omezit podle aktivních nabídek:', error);
    }

    const candidates = sortByHomepagePriority(allStores.filter((store) =>
      store?.slug && store?.name && store.is_active && (!activeIds || activeIds.has(String(store.id)))));
    const output = [];

    for (let offset = 0; offset < candidates.length && output.length < MAX_CARDS; offset += STORE_BATCH_SIZE) {
      const batch = candidates.slice(offset, offset + STORE_BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(async (store) => ({
        store,
        available: await hasCurrentHomepageLeaflet(store),
      })));
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.available && output.length < MAX_CARDS) {
          output.push(result.value.store);
        }
      });
    }

    return output;
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

  function logo(store) {
    const logoUrl = parseMeta(store.logo_url).base;
    return logoUrl
      ? `<img src="${esc(logoUrl)}" alt="Logo ${esc(store.name)}" onerror="this.replaceWith(document.createTextNode('%'))">`
      : '%';
  }

  function metrics() {
    $('totalCount').textContent = stores.length.toLocaleString('cs-CZ');
    $('hiddenCount').textContent = hidden.size.toLocaleString('cs-CZ');
    $('visibleCount').textContent = Math.max(0, stores.length - hidden.size).toLocaleString('cs-CZ');
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
      const waiting = busy === store.slug;
      return `<article class="visibilityStore ${isHidden ? 'isHidden' : ''}">
        <div class="visibilityLogo">${logo(store)}</div>
        <div>
          <h2>${esc(store.name)}</h2>
          <div class="visibilityMeta">
            <span class="visibilityPill">${esc(store.slug)}</span>
            <span class="visibilityPill ok">Má aktuální kartu letáku</span>
            <span class="visibilityPill ${isHidden ? 'bad' : 'ok'}">${isHidden ? 'Na hlavní stránce skrytý' : 'Na hlavní stránce zobrazený'}</span>
          </div>
        </div>
        <div class="visibilityActions">
          <button class="btn ${isHidden ? 'successBtn' : 'dangerBtn'}" type="button" data-toggle="${esc(store.slug)}" ${waiting ? 'disabled' : ''}>
            ${waiting ? 'Ukládám…' : isHidden ? `${icon('eye')}Zobrazit v sekci` : `${icon('eyeOff')}Skrýt ze sekce`}
          </button>
        </div>
      </article>`;
    }).join('') : '<div class="visibilityEmpty">Žádná aktuální karta neodpovídá filtru.</div>';

    $('list').querySelectorAll('[data-toggle]').forEach((button) => {
      button.addEventListener('click', () => toggle(button.dataset.toggle));
    });
    metrics();
  }

  async function load() {
    clearMessage();
    $('reload').disabled = true;
    $('list').innerHTML = '<div class="visibilityEmpty">Načítám stejné karty jako na hlavní stránce…</div>';
    try {
      await currentSession();
      const [{ data, error }, oldSettings] = await Promise.all([
        db.from('stores').select('id,name,slug,logo_url,website_url,is_active').order('name'),
        readLegacySettings(),
      ]);
      if (error) throw error;
      stores = await resolveHomepageStores(data || []);
      legacyHidden = oldSettings;
      rebuildHidden();
      render();
      if (!stores.length) show('Hlavní stránka nyní nemá žádnou dostupnou aktuální kartu letáku.', 'err');
    } catch (error) {
      show(error?.name === 'AbortError'
        ? 'Načítání aktuálních letáků překročilo časový limit. Klikni na Obnovit.'
        : error?.message || 'Data se nepodařilo načíst.', 'err');
      $('list').innerHTML = '<div class="visibilityEmpty">Načtení selhalo.</div>';
    } finally {
      $('reload').disabled = false;
    }
  }

  async function toggle(slug) {
    const store = stores.find((item) => item.slug === slug);
    if (!store || busy) return;
    const makeVisible = hidden.has(slug);
    const marker = makeVisible ? 'visible' : 'hidden';
    busy = slug;
    clearMessage();
    render();

    try {
      await currentSession();
      const { data: fresh, error: readError } = await db.from('stores')
        .select('id,name,slug,logo_url,website_url,is_active')
        .eq('id', store.id)
        .single();
      if (readError || !fresh) throw readError || new Error('Obchod nebyl nalezen.');

      const field = markerField(fresh);
      const nextValue = withMarker(fresh[field], marker);
      const { data, error } = await db.from('stores')
        .update({ [field]: nextValue })
        .eq('id', store.id)
        .select('id,name,slug,logo_url,website_url,is_active')
        .single();
      if (error) throw error;

      Object.assign(store, data || { [field]: nextValue });
      rebuildHidden();
      try {
        localStorage.setItem('slevao-leaflet-visibility-changed', `${slug}:${Date.now()}`);
      } catch { /* localStorage může být vypnuté */ }
      window.dispatchEvent(new CustomEvent('slevao:leaflet-visibility-changed', { detail: { slug } }));
      show(makeVisible
        ? `${store.name} se na hlavní stránce znovu zobrazí.`
        : `${store.name} byl z hlavní sekce letáků skryt.`);
    } catch (error) {
      show(error?.message || 'Nastavení se nepodařilo uložit.', 'err');
    } finally {
      busy = '';
      render();
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
        email: $('email').value.trim(),
        password: $('password').value,
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
