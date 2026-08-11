(() => {
  'use strict';

  const STORAGE_KEY = 'slevao-deal-card-view';
  const grid = document.getElementById('dealGrid');
  const toolbar = document.querySelector('.dealsContent .toolbar');
  if (!grid || !toolbar) return;

  const icon = (type) => {
    const paths = type === 'classic'
      ? '<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/>'
      : '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h5M9 12h7M9 16h7"/>';
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
  };

  const readView = () => {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      if (value === 'classic' || value === 'leaflet') return value;
    } catch {}
    return 'leaflet';
  };

  const control = document.createElement('div');
  control.className = 'dealViewControl';
  control.setAttribute('role', 'group');
  control.setAttribute('aria-label', 'Zobrazení nabídek');
  control.innerHTML = `
    <span class="dealViewLabel">Zobrazení:</span>
    <span class="dealViewSwitch">
      <button class="dealViewButton" type="button" data-card-view="classic" aria-pressed="false">${icon('classic')}<span>Klasické karty</span></button>
      <button class="dealViewButton" type="button" data-card-view="leaflet" aria-pressed="false">${icon('leaflet')}<span>Letákové karty</span></button>
    </span>
    <span class="dealViewHint">Přepněte mezi klasickým a letákovým zobrazením</span>
  `;

  const sort = toolbar.querySelector('#sortSelect');
  if (sort) toolbar.insertBefore(control, sort);
  else toolbar.appendChild(control);

  const buttons = [...control.querySelectorAll('[data-card-view]')];

  const applyView = (view, persist = true) => {
    const next = view === 'classic' ? 'classic' : 'leaflet';
    grid.dataset.cardView = next;
    buttons.forEach((button) => {
      const active = button.dataset.cardView === next;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    }
  };

  control.addEventListener('click', (event) => {
    const button = event.target.closest('[data-card-view]');
    if (!button) return;
    applyView(button.dataset.cardView);
  });

  applyView(readView(), false);
})();
