(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const ANON_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const SETTINGS_URL = `${SUPABASE_URL}/storage/v1/object/public/homepage-leaflet-settings/visibility.json`;
  const META_KEY = 'slevao-leaflet-visibility';
  const EMPTY_META_BASE = 'https://slevao.cz/';
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

  function rebuildHidden() {
    hidden = new Set(legacyHidden);
    for (const store of stores) {
      const marker = storeMarker(store);
      if (marker === 'hidden') hidden.add(store.slug);
      if (marker === 'visible') hidden.delete(store.slug);
    }
  }

  function logo(store) {
    return store.logo_url
      ? `<img src="${esc(store.logo_url)}" alt="Logo ${esc(store.name)}" onerror="this.replaceWith(document.createTextNode('%'))">`
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
            <span class="visibilityPill ${store.is_active ? 'ok' : 'warn'}">${store.is_active ? 'Obchod je na webu' : 'Obchod je obecně skrytý'}</span>
            <span class="visibilityPill ${isHidden ? 'bad' : 'ok'}">${isHidden ? 'V letácích skrytý' : 'V letácích zobrazený'}</span>
          </div>
        </div>
        <div class="visibilityActions">
          <button class="btn ${isHidden ? 'successBtn' : 'dangerBtn'}" type="button" data-toggle="${esc(store.slug)}" ${waiting ? 'disabled' : ''}>
            ${waiting ? 'Ukládám…' : isHidden ? `${icon('eye')}Zobrazit v sekci` : `${icon('eyeOff')}Skrýt ze sekce`}
          </button>
        </div>
      </article>`;
    }).join('') : '<div class="visibilityEmpty">Žádný obchod neodpovídá filtru.</div>';

    $('list').querySelectorAll('[data-toggle]').forEach((button) => {
      button.addEventListener('click', () => toggle(button.dataset.toggle));
    });
    metrics();
  }

  async function load() {
    clearMessage();
    $('reload').disabled = true;
    $('list').innerHTML = '<div class="visibilityEmpty">Načítám obchody…</div>';
    try {
      await currentSession();
      const [{ data, error }, oldSettings] = await Promise.all([
        db.from('stores').select('id,name,slug,logo_url,website_url,is_active').order('name'),
        readLegacySettings(),
      ]);
      if (error) throw error;
      stores = (data || []).filter((store) => store.slug && store.name);
      legacyHidden = oldSettings;
      rebuildHidden();
      render();
    } catch (error) {
      show(error?.message || 'Data se nepodařilo načíst.', 'err');
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
    const field = markerField(store);
    const nextValue = withMarker(store[field], marker);
    busy = slug;
    clearMessage();
    render();

    try {
      await currentSession();
      const { data, error } = await db.from('stores')
        .update({ [field]: nextValue })
        .eq('id', store.id)
        .select('id,name,slug,logo_url,website_url,is_active')
        .single();
      if (error) throw error;
      Object.assign(store, data || { [field]: nextValue });
      rebuildHidden();
      try {
        localStorage.setItem('slevao-leaflet-visibility-changed', String(Date.now()));
      } catch { /* localStorage může být vypnuté */ }
      show(makeVisible
        ? `${store.name} se v hlavní sekci znovu zobrazí.`
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
