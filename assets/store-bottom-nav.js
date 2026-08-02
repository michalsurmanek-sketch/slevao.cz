(() => {
  'use strict';

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
  const isPhone = () => window.matchMedia('(max-width: 820px)').matches;

  const nav = document.createElement('nav');
  nav.className = 'storeBottomNav';
  nav.setAttribute('aria-label', 'Navigace mezi obchody a letákem');
  nav.innerHTML = `
    <a class="storeBottomNav__side storeBottomNav__previous" href="${href(previous)}" aria-label="Předchozí obchod: ${previous[1]}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
      <span><small>Předchozí</small><strong>${previous[1]}</strong></span>
    </a>
    <button class="storeBottomNav__leaflet" type="button" aria-label="Otevřít aktuální leták přes celou obrazovku">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4M9 11h6M9 15h6"/></svg>
      <span>Leták</span>
    </button>
    <a class="storeBottomNav__side storeBottomNav__next" href="${href(next)}" aria-label="Následující obchod: ${next[1]}">
      <span><small>Následující</small><strong>${next[1]}</strong></span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>
    </a>`;

  document.body.appendChild(nav);
  document.body.classList.add('hasStoreBottomNav');

  const leafletButton = nav.querySelector('.storeBottomNav__leaflet');
  const leafletSection = document.querySelector('.leafletSection')
    || document.getElementById('leafletHeading')?.closest('section')
    || document.getElementById('storeLeafletHeading')?.closest('section');

  const firstPreviewButton = () => document.querySelector('#leafletGrid [data-leaflet-preview]');

  function activateFullscreenViewer() {
    document.body.classList.add('leaflet-viewer-fullscreen');
    const viewer = document.getElementById('leafletViewer');
    if (!isPhone() || !viewer || !viewer.requestFullscreen || document.fullscreenElement) return;
    try {
      const result = viewer.requestFullscreen({ navigationUI: 'hide' });
      result?.catch?.(() => {});
    } catch {
      // iPhone Safari používá místo Fullscreen API celoobrazovkové CSS.
    }
  }

  function openLoadedLeaflet() {
    const preview = firstPreviewButton();
    if (!preview) return false;
    preview.click();
    activateFullscreenViewer();
    leafletButton.classList.remove('is-loading');
    leafletButton.classList.add('is-active');
    window.setTimeout(() => leafletButton.classList.remove('is-active'), 1400);
    return true;
  }

  function scrollToLeaflets() {
    const target = document.getElementById('leafletHeading')
      || document.getElementById('storeLeafletHeading')
      || leafletSection;
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  leafletButton.addEventListener('click', () => {
    if (!isPhone()) {
      scrollToLeaflets();
      leafletButton.classList.add('is-active');
      window.setTimeout(() => leafletButton.classList.remove('is-active'), 1400);
      return;
    }

    if (openLoadedLeaflet()) return;

    leafletButton.classList.add('is-loading');
    leafletButton.querySelector('span').textContent = 'Načítám';
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (openLoadedLeaflet()) {
        window.clearInterval(timer);
        leafletButton.querySelector('span').textContent = 'Leták';
        return;
      }
      if (Date.now() - started < 4500) return;
      window.clearInterval(timer);
      leafletButton.classList.remove('is-loading');
      leafletButton.querySelector('span').textContent = 'Leták';
      scrollToLeaflets();
    }, 150);
  });

  document.getElementById('closeLeafletViewer')?.addEventListener('click', () => {
    document.body.classList.remove('leaflet-viewer-fullscreen');
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch?.(() => {});
    }
  }, { capture: true });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !document.body.classList.contains('leaflet-viewer-open')) {
      document.body.classList.remove('leaflet-viewer-fullscreen');
    }
  });

  if (leafletSection && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(([entry]) => {
      leafletButton.classList.toggle('is-visible', entry.isIntersecting);
    }, { threshold: 0.18, rootMargin: '-70px 0px -45% 0px' });
    observer.observe(leafletSection);
  }
})();