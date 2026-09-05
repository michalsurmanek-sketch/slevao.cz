(() => {
  'use strict';

  const STORAGE_KEY = 'slevao-quick-food-collapsed';
  const ITEMS = [
    ['mléko','🥛','Mléko'], ['pečivo','🥖','Pečivo'], ['vejce','🥚','Vejce'], ['máslo','🧈','Máslo'],
    ['sýr','🧀','Sýr'], ['maso','🥩','Maso'], ['ovoce','🍎','Ovoce'], ['zelenina','🥕','Zelenina']
  ];
  const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  function installHomepageScrollGuard() {
    if (window.__slevaoHomepageScrollGuardInstalled) return;
    window.__slevaoHomepageScrollGuardInstalled = true;

    const USER_SCROLL_WINDOW_MS = 4000;
    let allowProgrammaticScrollUntil = 0;
    const markUserScrollIntent = (event) => {
      if (!event?.isTrusted) return;
      allowProgrammaticScrollUntil = performance.now() + USER_SCROLL_WINDOW_MS;
    };
    const userAllowedScroll = () => performance.now() <= allowProgrammaticScrollUntil;

    document.addEventListener('click', markUserScrollIntent, true);
    document.addEventListener('keydown', (event) => {
      if (event?.isTrusted && event.key === 'Enter') markUserScrollIntent(event);
    }, true);

    const style = document.createElement('style');
    style.id = 'slevaoHomepageNoScrollAnchor';
    style.textContent = 'html,body{overflow-anchor:none!important}';
    document.head.appendChild(style);

    const originalScrollTo = window.scrollTo.bind(window);
    const originalScroll = typeof window.scroll === 'function' ? window.scroll.bind(window) : originalScrollTo;
    const originalScrollBy = window.scrollBy.bind(window);

    window.scrollTo = (...args) => {
      if (!userAllowedScroll()) return;
      return originalScrollTo(...args);
    };
    window.scroll = (...args) => {
      if (!userAllowedScroll()) return;
      return originalScroll(...args);
    };
    window.scrollBy = (...args) => {
      if (!userAllowedScroll()) return;
      return originalScrollBy(...args);
    };

    const originalScrollIntoView = Element.prototype.scrollIntoView;
    if (typeof originalScrollIntoView === 'function') {
      Element.prototype.scrollIntoView = function guardedScrollIntoView(...args) {
        if (!userAllowedScroll()) return;
        return originalScrollIntoView.apply(this, args);
      };
    }

    const originalFocus = HTMLElement.prototype.focus;
    if (typeof originalFocus === 'function') {
      HTMLElement.prototype.focus = function guardedFocus(options) {
        if (userAllowedScroll()) return originalFocus.call(this, options);
        if (options && typeof options === 'object') return originalFocus.call(this, { ...options, preventScroll:true });
        return originalFocus.call(this, { preventScroll:true });
      };
    }
  }

  installHomepageScrollGuard();

  const INTERNAL_SECTION_HASHES = new Set([
    '#top', '#categoriesSection', '#storesSection', '#leafletsSection', '#dealsSection'
  ]);

  function clearInternalSectionHash() {
    if (!INTERNAL_SECTION_HASHES.has(location.hash)) return;
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  }

  // Never restore an old vertical position automatically on the homepage.
  // This does not block manual scrolling and does not move the page itself.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  clearInternalSectionHash();
  document.addEventListener('click', () => {
    window.setTimeout(clearInternalSectionHash, 0);
  });

  function ensureFreshStyles() {
    const version = '20260829-2';
    const existing = document.querySelector('link[href*="home-quick-food-filter.css"]');
    if (existing) {
      existing.dataset.sqFoodFresh = version;
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `assets/home-quick-food-filter.css?v=${version}`;
    link.dataset.sqFoodFresh = version;
    document.head.appendChild(link);
  }

  function setExistingSearch(value) {
    const input = document.getElementById('sideSearch');
    if (!input) return false;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles:true }));
    return true;
  }

  function scrollToQuickPurchaseResults() {
    const target = document.querySelector('#dealsSection .dealsHeading') || document.getElementById('dealsSection');
    if (!target) return;
    const topbar = document.querySelector('.topbar');
    const headerHeight = topbar ? topbar.getBoundingClientRect().height : 0;
    const top = window.scrollY + target.getBoundingClientRect().top - headerHeight - 10;
    window.scrollTo({ top:Math.max(0, top), behavior:'smooth' });
  }

  function syncActive(dock) {
    const current = fold(document.getElementById('sideSearch')?.value || document.getElementById('q')?.value || '');
    const semanticBase = fold(document.getElementById('slSemanticPanel')?.dataset.semanticBase || '');
    let active = false;
    dock.querySelectorAll('[data-sq-food]').forEach((button) => {
      const selected = current === fold(button.dataset.sqFood) || semanticBase === fold(button.dataset.sqFood);
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
      active ||= selected;
    });
    const clear = dock.querySelector('.sqFoodClear');
    if (clear) {
      clear.classList.toggle('active', active);
      clear.setAttribute('aria-pressed', String(active));
    }
  }

  function setupMobileScroller(dock) {
    const scroller = dock.querySelector('.sqFoodDockItems');
    const previous = dock.querySelector('[data-sq-food-scroll="prev"]');
    const next = dock.querySelector('[data-sq-food-scroll="next"]');
    if (!scroller || !previous || !next) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const left = scroller.scrollLeft;
      const canLeft = left > 6;
      const canRight = left < max - 6;
      previous.disabled = !canLeft;
      next.disabled = !canRight;
      dock.classList.toggle('can-scroll-left', canLeft);
      dock.classList.toggle('can-scroll-right', canRight);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const move = (direction) => {
      const amount = Math.max(150, Math.min(scroller.clientWidth * .72, 320));
      scroller.scrollBy({ left:direction * amount, behavior:'smooth' });
      dock.classList.add('sqFoodInteracted');
      window.setTimeout(schedule, 320);
    };
    previous.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); move(-1); });
    next.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); move(1); });
    scroller.addEventListener('scroll', () => { dock.classList.add('sqFoodInteracted'); schedule(); }, { passive:true });
    window.addEventListener('resize', schedule, { passive:true });
    requestAnimationFrame(update);
    window.setTimeout(update, 250);
  }

  function createDock() {
    if (document.querySelector('.sqFoodDock')) return;
    const deals = document.getElementById('dealsSection');
    if (!deals || !document.getElementById('sideSearch')) return;

    const dock = document.createElement('aside');
    dock.className = 'sqFoodDock';
    dock.setAttribute('aria-label', 'Rychlý filtr základních potravin');
    dock.innerHTML = `
      <div class="sqFoodDockHead"><span class="sqFoodDockTitle">Rychlý<br>nákup</span><button class="sqFoodDockToggle" type="button" aria-label="Sbalit rychlý filtr" aria-expanded="true">‹</button></div>
      <button class="sqFoodScrollArrow sqFoodScrollArrowPrev" type="button" data-sq-food-scroll="prev" aria-label="Předchozí kategorie">‹</button>
      <div class="sqFoodDockItems">${ITEMS.map(([term, icon, label]) => `<button class="sqFoodQuick" type="button" data-sq-food="${term}" aria-pressed="false" title="Filtrovat: ${label}"><span class="sqFoodIcon" aria-hidden="true">${icon}</span><span>${label}</span></button>`).join('')}</div>
      <button class="sqFoodScrollArrow sqFoodScrollArrowNext" type="button" data-sq-food-scroll="next" aria-label="Další kategorie">›</button>
      <button class="sqFoodClear" type="button" aria-pressed="false">Zrušit rychlý filtr</button>`;

    if (localStorage.getItem(STORAGE_KEY) === '1') dock.classList.add('collapsed');
    const toggle = dock.querySelector('.sqFoodDockToggle');
    const syncToggle = () => {
      const collapsed = dock.classList.contains('collapsed');
      toggle.textContent = collapsed ? '›' : '‹';
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', collapsed ? 'Rozbalit rychlý filtr' : 'Sbalit rychlý filtr');
    };
    syncToggle();
    toggle.addEventListener('click', () => {
      dock.classList.toggle('collapsed');
      localStorage.setItem(STORAGE_KEY, dock.classList.contains('collapsed') ? '1' : '0');
      syncToggle();
    });

    dock.addEventListener('click', (event) => {
      const button = event.target.closest('[data-sq-food]');
      if (!button) return;
      const term = button.dataset.sqFood || '';
      const current = fold(document.getElementById('sideSearch')?.value || '');
      setExistingSearch(current === fold(term) ? '' : term);
      syncActive(dock);
      requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(scrollToQuickPurchaseResults, 20)));
    });
    dock.querySelector('.sqFoodClear')?.addEventListener('click', () => { setExistingSearch(''); syncActive(dock); });
    document.getElementById('sideSearch')?.addEventListener('input', () => syncActive(dock));
    document.getElementById('q')?.addEventListener('change', () => syncActive(dock));
    document.addEventListener('slevao:semantic-filter', () => syncActive(dock));

    deals.parentNode.insertBefore(dock, deals);
    syncActive(dock);
    setupMobileScroller(dock);
  }

  function init() {
    ensureFreshStyles();
    createDock();
    if (document.querySelector('.sqFoodDock')) return;
    const observer = new MutationObserver(() => {
      createDock();
      if (document.querySelector('.sqFoodDock')) observer.disconnect();
    });
    observer.observe(document.body, { childList:true, subtree:true });
    window.setTimeout(() => observer.disconnect(), 10000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
