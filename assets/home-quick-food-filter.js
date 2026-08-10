(() => {
  'use strict';

  const STORAGE_KEY = 'slevao-quick-food-collapsed';
  const ITEMS = [
    ['mléko','🥛','Mléko'],
    ['pečivo','🥖','Pečivo'],
    ['vejce','🥚','Vejce'],
    ['máslo','🧈','Máslo'],
    ['sýr','🧀','Sýr'],
    ['maso','🥩','Maso'],
    ['ovoce','🍎','Ovoce'],
    ['zelenina','🥕','Zelenina']
  ];

  const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

  function setExistingSearch(value) {
    const sideSearch = document.getElementById('sideSearch');
    if (!sideSearch) return false;
    sideSearch.value = value;
    sideSearch.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function scrollToDealsTabs() {
    const quickTabs = document.getElementById('quickTabs');
    if (!quickTabs) return;

    const topbar = document.querySelector('.topbar');
    const headerHeight = topbar ? topbar.getBoundingClientRect().height : 0;
    const targetTop = window.scrollY + quickTabs.getBoundingClientRect().top - headerHeight - 14;

    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth'
    });

    if (window.location.hash !== '#dealsSection') {
      history.replaceState(null, '', '#dealsSection');
    }
  }

  function syncActive(dock) {
    const current = fold(document.getElementById('sideSearch')?.value || document.getElementById('q')?.value || '');
    let anyActive = false;

    dock.querySelectorAll('[data-sq-food]').forEach((button) => {
      const active = current === fold(button.dataset.sqFood);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
      if (active) anyActive = true;
    });

    const clearButton = dock.querySelector('.sqFoodClear');
    if (clearButton) {
      clearButton.classList.toggle('active', anyActive);
      clearButton.setAttribute('aria-pressed', String(anyActive));
    }
  }

  function setupMobileScroller(dock) {
    const scroller = dock.querySelector('.sqFoodDockItems');
    const previous = dock.querySelector('[data-sq-food-scroll="prev"]');
    const next = dock.querySelector('[data-sq-food-scroll="next"]');
    const cue = dock.querySelector('.sqFoodSwipeCue');
    if (!scroller || !previous || !next || !cue) return;

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
      cue.hidden = max < 12;
    };

    const scheduleUpdate = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    const move = (direction) => {
      const amount = Math.max(150, Math.min(scroller.clientWidth * .72, 320));
      scroller.scrollBy({ left: direction * amount, behavior: 'smooth' });
      dock.classList.add('sqFoodInteracted');
      window.setTimeout(scheduleUpdate, 320);
    };

    previous.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      move(-1);
    });

    next.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      move(1);
    });

    scroller.addEventListener('scroll', () => {
      dock.classList.add('sqFoodInteracted');
      scheduleUpdate();
    }, { passive: true });

    window.addEventListener('resize', scheduleUpdate, { passive: true });
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
      <div class="sqFoodDockHead">
        <span class="sqFoodDockTitle">Rychlý<br>nákup</span>
        <button class="sqFoodDockToggle" type="button" aria-label="Sbalit rychlý filtr" aria-expanded="true">‹</button>
      </div>
      <button class="sqFoodScrollArrow sqFoodScrollArrowPrev" type="button" data-sq-food-scroll="prev" aria-label="Předchozí kategorie">‹</button>
      <div class="sqFoodDockItems">
        ${ITEMS.map(([term, icon, label]) => `<button class="sqFoodQuick" type="button" data-sq-food="${term}" aria-pressed="false" title="Filtrovat: ${label}"><span class="sqFoodIcon" aria-hidden="true">${icon}</span><span>${label}</span></button>`).join('')}
      </div>
      <button class="sqFoodScrollArrow sqFoodScrollArrowNext" type="button" data-sq-food-scroll="next" aria-label="Další kategorie">›</button>
      <div class="sqFoodSwipeCue" aria-hidden="true"><span>←</span><strong>Posuň do stran pro další kategorie</strong><span>→</span></div>
      <button class="sqFoodClear" type="button" aria-pressed="false">Zrušit rychlý filtr</button>`;

    if (localStorage.getItem(STORAGE_KEY) === '1') dock.classList.add('collapsed');
    const toggle = dock.querySelector('.sqFoodDockToggle');
    const updateToggle = () => {
      const collapsed = dock.classList.contains('collapsed');
      toggle.textContent = collapsed ? '›' : '‹';
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', collapsed ? 'Rozbalit rychlý filtr' : 'Sbalit rychlý filtr');
    };
    updateToggle();

    toggle.addEventListener('click', () => {
      dock.classList.toggle('collapsed');
      localStorage.setItem(STORAGE_KEY, dock.classList.contains('collapsed') ? '1' : '0');
      updateToggle();
    });

    dock.addEventListener('click', (event) => {
      const button = event.target.closest('[data-sq-food]');
      if (!button) return;
      const term = button.dataset.sqFood || '';
      const current = fold(document.getElementById('sideSearch')?.value || '');
      setExistingSearch(current === fold(term) ? '' : term);
      syncActive(dock);
      window.requestAnimationFrame(scrollToDealsTabs);
    });

    dock.querySelector('.sqFoodClear').addEventListener('click', () => {
      setExistingSearch('');
      syncActive(dock);
    });

    document.getElementById('sideSearch')?.addEventListener('input', () => syncActive(dock));
    document.getElementById('q')?.addEventListener('change', () => syncActive(dock));

    deals.parentNode.insertBefore(dock, deals);
    syncActive(dock);
    setupMobileScroller(dock);
  }

  function init() {
    createDock();
    if (!document.querySelector('.sqFoodDock')) {
      const observer = new MutationObserver(() => {
        createDock();
        if (document.querySelector('.sqFoodDock')) observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
      window.setTimeout(() => observer.disconnect(), 10000);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
