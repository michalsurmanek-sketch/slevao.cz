(() => {
  'use strict';

  const STORAGE_KEY = 'slevao-quick-food-collapsed';
  const ITEMS = [
    ['mléko','🥛','Mléko'], ['pečivo','🥖','Pečivo'], ['vejce','🥚','Vejce'], ['máslo','🧈','Máslo'],
    ['sýr','🧀','Sýr'], ['maso','🥩','Maso'], ['ovoce','🍎','Ovoce'], ['zelenina','🥕','Zelenina']
  ];
  const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  function guardInitialHomepagePosition() {
    const navigation = performance.getEntriesByType?.('navigation')?.[0];
    const navigationType = navigation?.type || 'navigate';
    if (navigationType === 'back_forward') return;

    const internalSectionHashes = new Set([
      '#top', '#categoriesSection', '#storesSection', '#leafletsSection', '#dealsSection'
    ]);
    if (internalSectionHashes.has(location.hash)) {
      history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    }

    let userInteracted = false;
    const markUserInteraction = () => { userInteracted = true; };
    window.addEventListener('pointerdown', markUserInteraction, { once:true, capture:true });
    window.addEventListener('keydown', markUserInteraction, { once:true, capture:true });
    window.addEventListener('wheel', markUserInteraction, { once:true, capture:true, passive:true });
    window.addEventListener('touchstart', markUserInteraction, { once:true, capture:true, passive:true });

    const canRestoreScroll = 'scrollRestoration' in history;
    if (canRestoreScroll) history.scrollRestoration = 'manual';
    window.addEventListener('load', () => {
      if (!userInteracted) window.scrollTo({ top:0, left:0, behavior:'auto' });
      if (canRestoreScroll) history.scrollRestoration = 'auto';
    }, { once:true });
  }

  function ensureFreshStyles() {
    const version = '20260829-2';
    if (document.querySelector(`link[data-sq-food-fresh="${version}"]`)) return;
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

  guardInitialHomepagePosition();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();