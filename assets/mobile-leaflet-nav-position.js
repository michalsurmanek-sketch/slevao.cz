(() => {
  'use strict';

  const mobile = window.matchMedia('(max-width: 800px)');
  const LEAFLETS_URL = '/letaky.html';

  const fold = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  function isHomePage() {
    const path = location.pathname.replace(/\/+$/, '');
    return path === '' || path === '/' || path.endsWith('/index.html');
  }

  function installNearbyAccordion() {
    if (!isHomePage()) return;

    const panel = document.querySelector('.heroNearbyPanel');
    if (!panel) return;

    if (!document.getElementById('slevaoNearbyAccordionStyle')) {
      const style = document.createElement('style');
      style.id = 'slevaoNearbyAccordionStyle';
      style.textContent = `
        .nearbyMobileToggle{display:none}
        @media(max-width:800px){
          .heroNearbyPanel.nearbyMobileCollapsible{
            position:relative!important;
            overflow:hidden!important;
            transition:max-height .32s cubic-bezier(.2,.75,.25,1),padding .25s ease,box-shadow .25s ease!important;
          }
          .heroNearbyPanel.nearbyMobileCollapsible.is-nearby-collapsed{
            min-height:86px!important;
            max-height:86px!important;
            padding:10px 12px!important;
            gap:0!important;
            justify-content:center!important;
            cursor:pointer;
            border-color:rgba(18,154,143,.24)!important;
            background:linear-gradient(145deg,rgba(255,255,255,.96),rgba(239,251,249,.96))!important;
            box-shadow:0 9px 24px rgba(13,108,100,.10)!important;
          }
          .heroNearbyPanel.is-nearby-collapsed > :not(.nearbyMobileToggle){
            display:none!important;
          }
          .heroNearbyPanel.nearbyMobileCollapsible.is-nearby-expanded{
            max-height:1100px!important;
            padding:16px!important;
            cursor:default;
          }
          .nearbyMobileToggle{
            border:0;
            color:#087e75;
            -webkit-tap-highlight-color:transparent;
            cursor:pointer;
          }
          .heroNearbyPanel.is-nearby-collapsed .nearbyMobileToggle{
            position:relative!important;
            inset:auto!important;
            width:100%!important;
            height:66px!important;
            display:grid!important;
            grid-template-columns:42px minmax(0,1fr) 42px;
            align-items:center;
            gap:11px;
            padding:0 4px 0 2px!important;
            border-radius:16px!important;
            background:transparent!important;
            box-shadow:none!important;
            text-align:left!important;
          }
          .nearbyMobileSummaryIcon{
            width:42px;
            height:42px;
            display:grid;
            place-items:center;
            border-radius:50%;
            background:linear-gradient(145deg,#e4faf7,#f7fffe);
            color:#0a978c;
            box-shadow:inset 0 0 0 1px rgba(8,126,117,.08);
          }
          .nearbyMobileSummaryIcon svg{
            width:21px;
            height:21px;
            fill:none;
            stroke:currentColor;
            stroke-width:2.2;
            stroke-linecap:round;
            stroke-linejoin:round;
          }
          .nearbyMobileSummaryCopy{
            min-width:0;
            display:grid;
            gap:4px;
          }
          .nearbyMobileSummaryCopy strong{
            color:#087e75;
            font-size:13px;
            line-height:1.05;
            font-weight:950;
            letter-spacing:.035em;
          }
          .nearbyMobileSummaryCopy small{
            color:#697b79;
            font-size:11px;
            line-height:1.25;
            font-weight:650;
            white-space:nowrap;
            overflow:hidden;
            text-overflow:ellipsis;
          }
          .nearbyMobileChevron{
            width:42px;
            height:42px;
            display:grid;
            place-items:center;
            border:1px solid rgba(8,126,117,.18);
            border-radius:50%;
            background:#fff;
            color:#0a978c;
            box-shadow:0 7px 18px rgba(8,126,117,.12);
          }
          .nearbyMobileChevron svg{
            width:20px;
            height:20px;
            fill:none;
            stroke:currentColor;
            stroke-width:2.5;
            stroke-linecap:round;
            stroke-linejoin:round;
            transition:transform .25s ease;
          }
          .heroNearbyPanel.is-nearby-expanded .nearbyMobileToggle{
            position:absolute!important;
            z-index:8;
            top:12px!important;
            right:12px!important;
            width:40px!important;
            height:40px!important;
            display:grid!important;
            place-items:center;
            padding:0!important;
            border:0!important;
            background:transparent!important;
            box-shadow:none!important;
          }
          .heroNearbyPanel.is-nearby-expanded .nearbyMobileSummaryIcon,
          .heroNearbyPanel.is-nearby-expanded .nearbyMobileSummaryCopy{
            display:none!important;
          }
          .heroNearbyPanel.is-nearby-expanded .nearbyMobileChevron{
            width:40px;
            height:40px;
          }
          .heroNearbyPanel.is-nearby-expanded .nearbyMobileChevron svg{
            transform:rotate(180deg);
          }
          .heroNearbyPanel.is-nearby-expanded .slLiveTopline{
            padding-right:52px!important;
          }
          .nearbyMobileToggle:focus,.nearbyMobileToggle:focus-visible{
            outline:none!important;
          }
          .heroNearbyPanel.is-nearby-collapsed .nearbyMobileToggle:active{
            transform:scale(.985);
          }
        }
        @media(min-width:801px){
          .nearbyMobileToggle{display:none!important}
        }
      `;
      document.head.appendChild(style);
    }

    let toggle = panel.querySelector('.nearbyMobileToggle');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'nearbyMobileToggle';
      toggle.innerHTML = `
        <span class="nearbyMobileSummaryIcon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"/><circle cx="12" cy="10" r="2.2"/></svg>
        </span>
        <span class="nearbyMobileSummaryCopy">
          <strong>POBLÍŽ VÁS</strong>
          <small>Najdi obchody a akce ve svém okolí</small>
        </span>
        <span class="nearbyMobileChevron" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
        </span>
      `;
      panel.prepend(toggle);
    }

    panel.classList.add('nearbyMobileCollapsible');
    const contentNodes = [...panel.children].filter((node) => node !== toggle);

    const setContentInteractive = (enabled) => {
      contentNodes.forEach((node) => {
        if (!(node instanceof HTMLElement)) return;
        node.inert = !enabled;
        if (enabled) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', 'true');
      });
    };

    const setExpanded = (expanded) => {
      if (!mobile.matches) {
        panel.classList.remove('is-nearby-collapsed');
        panel.classList.add('is-nearby-expanded');
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-label', 'Sbalit hledání obchodů poblíž');
        setContentInteractive(true);
        return;
      }

      panel.classList.toggle('is-nearby-expanded', expanded);
      panel.classList.toggle('is-nearby-collapsed', !expanded);
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      toggle.setAttribute('aria-label', expanded ? 'Sbalit hledání obchodů poblíž' : 'Rozbalit hledání obchodů poblíž');
      setContentInteractive(expanded);
    };

    const togglePanel = () => {
      if (!mobile.matches) return;
      setExpanded(!panel.classList.contains('is-nearby-expanded'));
    };

    if (!toggle.dataset.slevaoNearbyBound) {
      toggle.dataset.slevaoNearbyBound = '1';
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggle.blur();
        togglePanel();
      });
    }

    if (!panel.dataset.slevaoNearbyBound) {
      panel.dataset.slevaoNearbyBound = '1';
      panel.addEventListener('click', (event) => {
        if (!mobile.matches || !panel.classList.contains('is-nearby-collapsed')) return;
        if (event.target.closest('.nearbyMobileToggle')) return;
        togglePanel();
      });
    }

    const onViewportChange = () => setExpanded(!mobile.matches);
    if (typeof mobile.addEventListener === 'function' && !panel.dataset.slevaoNearbyViewportBound) {
      panel.dataset.slevaoNearbyViewportBound = '1';
      mobile.addEventListener('change', onViewportChange);
    }

    setExpanded(!mobile.matches);
  }

  function isLeafletsLink(link) {
    if (!link) return false;
    const text = fold(`${link.textContent || ''} ${link.getAttribute('aria-label') || ''} ${link.getAttribute('title') || ''}`);
    const href = link.getAttribute('href') || '';
    return text.includes('letaky')
      || href === '#leafletsSection'
      || href.endsWith('#leafletsSection')
      || href === 'letaky.html'
      || href === '/letaky.html'
      || href.endsWith('/letaky.html');
  }

  function isSearchLink(link) {
    if (!link) return false;
    const text = fold(`${link.textContent || ''} ${link.getAttribute('aria-label') || ''} ${link.getAttribute('title') || ''}`);
    return text.includes('hledat');
  }

  function installVisualFix() {
    if (document.getElementById('slevaoMobileNavFinalFix')) return;
    const style = document.createElement('style');
    style.id = 'slevaoMobileNavFinalFix';
    style.textContent = `
      @media(max-width:800px){
        .mobileNav a,.mobileNav button,.slevaoBottomNav a{-webkit-tap-highlight-color:transparent!important}
        .mobileNav a:focus,.mobileNav button:focus,.mobileNav a:focus-visible,.mobileNav button:focus-visible,
        .mobileNav a:active,.mobileNav button:active,.slevaoBottomNav a:focus,.slevaoBottomNav a:focus-visible,.slevaoBottomNav a:active{
          outline:0!important;box-shadow:none!important
        }
        .mobileNav a[aria-current="page"],.mobileNav button[aria-current="page"],.slevaoBottomNav a.active{
          background:transparent!important;box-shadow:none!important
        }
      }
    `;
    document.head.appendChild(style);
  }

  function patchNavigationLinks(root = document) {
    root.querySelectorAll?.('.mobileNav a, .slevaoBottomNav a').forEach((link) => {
      if (isLeafletsLink(link)) {
        link.setAttribute('href', LEAFLETS_URL);
        link.dataset.slevaoLeafletsPage = '1';
        link.removeAttribute('aria-current');
        link.classList.remove('active');
        return;
      }
      if (isHomePage() && isSearchLink(link)) {
        link.setAttribute('href', '#dealsSection');
        link.dataset.slevaoHomeSearch = '1';
        link.removeAttribute('aria-current');
        link.classList.remove('active');
      }
    });
  }

  function scrollToHomeSearchPosition() {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const align = (behavior = 'auto') => {
      const target = document.querySelector('.sqFoodDock') || document.getElementById('dealsSection');
      if (!target) return;
      const topbar = document.querySelector('.topbar');
      const topbarHeight = Math.ceil(topbar?.getBoundingClientRect().height || 0);
      const absoluteTop = window.scrollY + target.getBoundingClientRect().top;
      const targetTop = Math.max(0, Math.round(absoluteTop - topbarHeight - 14));
      window.scrollTo({ top: targetTop, left: 0, behavior });
    };
    align(reducedMotion ? 'auto' : 'smooth');
    window.setTimeout(() => align('auto'), reducedMotion ? 0 : 380);
  }

  function installHomeScrollTop() {
    if (!isHomePage() || document.getElementById('leafletsScrollTop')) return;
    if (!document.querySelector('link[href*="leaflets-scroll-top.css"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'assets/leaflets-scroll-top.css?v=20260809-1';
      document.head.appendChild(link);
    }
    const button = document.createElement('button');
    button.id = 'leafletsScrollTop';
    button.className = 'leafletsScrollTop';
    button.type = 'button';
    button.setAttribute('aria-label', 'Nahoru');
    button.title = 'Nahoru';
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg>';
    document.body.appendChild(button);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const refresh = () => {
      frame = 0;
      if (!mobile.matches) { button.classList.remove('is-visible'); return; }
      const top = window.scrollY || document.documentElement.scrollTop || 0;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const progress = Math.max(0, Math.min(1, top / max));
      button.style.setProperty('--scroll-progress', `${Math.round(progress * 360)}deg`);
      button.classList.toggle('is-visible', top > 420);
    };
    const scheduleRefresh = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(refresh);
    };
    button.addEventListener('click', () => {
      button.blur();
      window.scrollTo({ top: 0, left: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    });
    window.addEventListener('scroll', scheduleRefresh, { passive: true });
    window.addEventListener('resize', scheduleRefresh, { passive: true });
    if (typeof mobile.addEventListener === 'function') mobile.addEventListener('change', scheduleRefresh);
    refresh();
  }

  installNearbyAccordion();
  installVisualFix();
  patchNavigationLinks();
  installHomeScrollTop();

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('.mobileNav,.slevaoBottomNav,.mobileNav a,.slevaoBottomNav a')) patchNavigationLinks(node.parentElement || node);
        else patchNavigationLinks(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('click', (event) => {
    if (!mobile.matches) return;
    const link = event.target.closest('.mobileNav a, .slevaoBottomNav a');
    if (!link) return;
    if (isHomePage() && isSearchLink(link)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      link.blur?.();
      scrollToHomeSearchPosition();
      return;
    }
    if (!isLeafletsLink(link)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    link.blur?.();
    window.location.assign(LEAFLETS_URL);
  }, true);
})();
