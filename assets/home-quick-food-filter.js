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

  function syncActive(dock) {
    const current = fold(document.getElementById('sideSearch')?.value || document.getElementById('q')?.value || '');
    dock.querySelectorAll('[data-sq-food]').forEach((button) => {
      const active = current === fold(button.dataset.sqFood);
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
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
      <div class="sqFoodDockItems">
        ${ITEMS.map(([term, icon, label]) => `<button class="sqFoodQuick" type="button" data-sq-food="${term}" aria-pressed="false" title="Filtrovat: ${label}"><span class="sqFoodIcon" aria-hidden="true">${icon}</span><span>${label}</span></button>`).join('')}
      </div>
      <button class="sqFoodClear" type="button">Zrušit rychlý filtr</button>`;

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
      document.getElementById('dealsSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    dock.querySelector('.sqFoodClear').addEventListener('click', () => {
      setExistingSearch('');
      syncActive(dock);
    });

    document.getElementById('sideSearch')?.addEventListener('input', () => syncActive(dock));
    document.getElementById('q')?.addEventListener('change', () => syncActive(dock));

    deals.parentNode.insertBefore(dock, deals);
    syncActive(dock);
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
