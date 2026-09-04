(() => {
  'use strict';

  const HOME_FAVORITES_KEY = 'slevao-saved';
  const STORE_FAVORITES_KEY = 'slevao-favorite-offers-v1';
  const FAVORITES_RELOAD_KEY = 'slevao-favorites-key-sync-v1';
  let favoriteStorageReloadPending = false;

  function parseFavoriteList(raw) {
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw);
      return Array.isArray(value) ? [...new Set(value.map(String))] : null;
    } catch {
      return null;
    }
  }

  function mergeFavoriteLists(...lists) {
    const available = lists.filter(Array.isArray);
    return available.length ? [...new Set(available.flat().map(String))] : null;
  }

  function reconcileFavoriteKeys() {
    const homeRaw = localStorage.getItem(HOME_FAVORITES_KEY);
    const storeRaw = localStorage.getItem(STORE_FAVORITES_KEY);
    const merged = mergeFavoriteLists(parseFavoriteList(homeRaw), parseFavoriteList(storeRaw));
    if (merged === null) return { merged:null, storeChanged:false };
    const normalized = JSON.stringify(merged);
    const storeChanged = storeRaw !== normalized;
    if (homeRaw !== normalized) localStorage.setItem(HOME_FAVORITES_KEY, normalized);
    if (storeChanged) localStorage.setItem(STORE_FAVORITES_KEY, normalized);
    return { merged, storeChanged };
  }

  try {
    const initial = reconcileFavoriteKeys();

    if (!Storage.prototype.__slevaoFavoriteSyncPatched) {
      const nativeGetItem = Storage.prototype.getItem;
      const nativeSetItem = Storage.prototype.setItem;
      const nativeRemoveItem = Storage.prototype.removeItem;
      Object.defineProperty(Storage.prototype, '__slevaoFavoriteSyncPatched', { value:true, configurable:true });
      Storage.prototype.setItem = function setItem(key, value) {
        nativeSetItem.call(this, key, value);
        if (this !== window.localStorage) return;
        if (key !== HOME_FAVORITES_KEY && key !== STORE_FAVORITES_KEY) return;
        const parsed = parseFavoriteList(String(value));
        if (parsed === null) return;
        const normalized = JSON.stringify(parsed);
        if (String(value) !== normalized) nativeSetItem.call(this, key, normalized);
        const mirrorKey = key === HOME_FAVORITES_KEY ? STORE_FAVORITES_KEY : HOME_FAVORITES_KEY;
        if (nativeGetItem.call(this, mirrorKey) !== normalized) nativeSetItem.call(this, mirrorKey, normalized);
      };
      Storage.prototype.removeItem = function removeItem(key) {
        nativeRemoveItem.call(this, key);
        if (this !== window.localStorage) return;
        if (key !== HOME_FAVORITES_KEY && key !== STORE_FAVORITES_KEY) return;
        const mirrorKey = key === HOME_FAVORITES_KEY ? STORE_FAVORITES_KEY : HOME_FAVORITES_KEY;
        nativeRemoveItem.call(this, mirrorKey);
      };
    }

    if (initial.storeChanged && !sessionStorage.getItem(FAVORITES_RELOAD_KEY)) {
      sessionStorage.setItem(FAVORITES_RELOAD_KEY, '1');
      location.reload();
      return;
    }
    sessionStorage.removeItem(FAVORITES_RELOAD_KEY);

    window.addEventListener('storage', (event) => {
      if (event.storageArea && event.storageArea !== localStorage) return;
      if (event.key !== HOME_FAVORITES_KEY && event.key !== STORE_FAVORITES_KEY) return;
      if (event.newValue === null) localStorage.removeItem(event.key);
      else {
        const parsed = parseFavoriteList(event.newValue);
        if (parsed === null) return;
        localStorage.setItem(event.key, JSON.stringify(parsed));
      }
      if (favoriteStorageReloadPending) return;
      favoriteStorageReloadPending = true;
      window.setTimeout(() => location.reload(), 0);
    });
  } catch {}

  if (!document.querySelector('link[href*="public-features.css"]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'assets/public-features.css?v=20260816-5';
    document.head.appendChild(style);
  }
  if (!document.querySelector('link[href*="mobile-footer-upgrade.css"]')) {
    const navStyle = document.createElement('link');
    navStyle.rel = 'stylesheet';
    navStyle.href = 'assets/mobile-footer-upgrade.css?v=20260828-6';
    document.head.appendChild(navStyle);
  }
  if (!document.querySelector('script[src*="public-nav-upgrade.js"]')) {
    const navScript = document.createElement('script');
    navScript.src = 'assets/public-nav-upgrade.js?v=20260904-1';
    navScript.async = false;
    document.head.appendChild(navScript);
  }
  if (!document.querySelector('script[src*="public-features.js"]')) {
    const script = document.createElement('script');
    script.src = 'assets/public-features.js?v=20260828-2';
    script.async = false;
    document.head.appendChild(script);
  }

  const config = window.SLEVAO_STORE || {};
  const stores = [
    ['action','Action'],['albert','Albert'],['alza','Alza'],['asko','ASKO'],['auto-kelly','Auto Kelly'],['bauhaus','BAUHAUS'],
    ['benu','BENU'],['billa','BILLA'],['brnenka','Brněnka'],['ca','C&A'],['cba','CBA'],['coop','COOP'],['cropp','Cropp'],
    ['datart','DATART'],['decathlon','Decathlon'],['dek','DEK'],['dm','dm'],['dr-max','Dr. Max'],['enapo','Enapo'],
    ['eso-market','ESO MARKET'],['flop','FLOP'],['globus','Globus'],['hm','H&M'],['hornbach','HORNBACH'],['house','House'],
    ['hruska','Hruška'],['ikea','IKEA'],['intersport','INTERSPORT'],['jednota','Jednota'],['jip','JIP'],['jysk','JYSK'],
    ['kaufland','Kaufland'],['kik','KiK'],['konzum','Konzum'],['kosik','Košík.cz'],['kubik','Kubík'],['lidl','Lidl'],
    ['makro','MAKRO'],['moebelix','Möbelix'],['mountfield','Mountfield'],['new-yorker','NEW YORKER'],['norma','NORMA'],
    ['obi','OBI'],['okay','OKAY'],['penny','PENNY'],['pepco','PEPCO'],['petcenter','PetCenter'],['pilulka','Pilulka.cz'],
    ['planeo','PLANEO'],['potraviny-muj-obchod','Můj obchod'],['pramen-cz','Pramen CZ'],['pro-doma','PRO-DOMA'],['ratio','Ratio'],
    ['reserved','Reserved'],['rohlik','Rohlík.cz'],['rosa-market','ROSA market'],['rossmann','ROSSMANN'],['sconto','SCONTO'],
    ['sinsay','Sinsay'],['smarty','Smarty'],['sportisimo','SPORTISIMO'],['stavmat','STAVMAT'],['super-zoo','Super zoo'],
    ['takko','TAKKO'],['tamda','TAMDA'],['tedi','TEDi'],['tempo','TEMPO'],['terno','TERNO'],['tesco','Tesco'],['teta','Teta'],
    ['trefa','Trefa'],['xxxlutz','XXXLutz'],['zabka','Žabka']
  ];

  if (!config.slug || document.querySelector('.storeBottomNav')) return;
  const index = stores.findIndex(([slug]) => slug === config.slug);
  if (index < 0) return;

  const previous = stores[(index - 1 + stores.length) % stores.length];
  const next = stores[(index + 1) % stores.length];
  const href = ([slug]) => `${encodeURIComponent(slug)}.html`;
  const nav = document.createElement('nav');
  nav.className = 'storeBottomNav';
  nav.setAttribute('aria-label', 'Navigace mezi obchody a letákem');
  nav.innerHTML = `
    <a class="storeBottomNav__side storeBottomNav__previous" href="${href(previous)}" aria-label="Předchozí obchod: ${previous[1]}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg><span><small>Předchozí</small><strong>${previous[1]}</strong></span>
    </a>
    <button class="storeBottomNav__leaflet" type="button" aria-label="Otevřít aktuální leták">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 11h6M9 15h6"/></svg><span>Leták</span>
    </button>
    <a class="storeBottomNav__side storeBottomNav__next" href="${href(next)}" aria-label="Následující obchod: ${next[1]}">
      <span><small>Následující</small><strong>${next[1]}</strong></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
    </a>`;
  document.body.appendChild(nav);
  document.body.classList.add('hasStoreBottomNav');

  const button = nav.querySelector('.storeBottomNav__leaflet');
  const section = document.querySelector('.leafletSection')
    || document.getElementById('leafletHeading')?.closest('section')
    || document.getElementById('storeLeafletHeading')?.closest('section');
  const preview = () => document.querySelector('#leafletGrid [data-leaflet-preview]');

  function scrollToLeaflets() {
    (document.getElementById('leafletHeading') || document.getElementById('storeLeafletHeading') || section)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  button.addEventListener('click', () => {
    const target = preview();
    if (target) {
      target.click();
      document.body.classList.add('leaflet-viewer-fullscreen');
      const viewer = document.getElementById('leafletViewer');
      if (matchMedia('(max-width:820px)').matches && viewer?.requestFullscreen && !document.fullscreenElement) {
        try { viewer.requestFullscreen({ navigationUI: 'hide' })?.catch?.(() => {}); } catch {}
      }
      return;
    }
    scrollToLeaflets();
  });

  document.getElementById('closeLeafletViewer')?.addEventListener('click', () => {
    document.body.classList.remove('leaflet-viewer-fullscreen');
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch?.(() => {});
  }, { capture: true });

  if (section && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(([entry]) => button.classList.toggle('is-visible', entry.isIntersecting), {
      threshold: .18, rootMargin: '-70px 0px -45% 0px'
    });
    observer.observe(section);
  }
})();
