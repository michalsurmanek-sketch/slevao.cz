(() => {
  'use strict';

  const paths = {
    dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 3.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2V9.6h.1A1.7 1.7 0 0 0 3.6 8a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.06 3.2l.06.06A1.7 1.7 0 0 0 8 3.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2h4v.1A1.7 1.7 0 0 0 15 3.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1A1.7 1.7 0 0 0 19.4 15z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    imagePlus: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/><path d="M18 3v6M15 6h6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
    login: '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>',
    logout: '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    play: '<path d="m8 5 11 7-11 7z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    xCircle: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>',
    external: '<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 20h14"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    repeat: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="m7 22-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
    layers: '<path d="m12 2 9 5-9 5-9-5z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/>',
    listChecks: '<path d="m3 7 2 2 4-4M3 17l2 2 4-4M13 6h8M13 12h8M13 18h8"/>',
    package: '<path d="m21 8-9 5-9-5 9-5z"/><path d="m3 8 9 5v9M21 8l-9 5M21 8v9l-9 5"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.7 2.5 17.2A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.8L13.7 3.7a2 2 0 0 0-3.4 0z"/>',
    eyeOff: '<path d="m3 3 18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 4.2A10.5 10.5 0 0 1 12 4c5 0 9 4 10 8a12.4 12.4 0 0 1-2 4"/><path d="M6.6 6.6A11.8 11.8 0 0 0 2 12c1 4 5 8 10 8a10.7 10.7 0 0 0 5.4-1.5"/>',
    power: '<path d="M12 2v10"/><path d="M6.3 4.8a9 9 0 1 0 11.4 0"/>',
    pause: '<path d="M9 5v14M15 5v14"/>'
  };

  const idIcons = {
    loginBtn: 'login', logout: 'logout', refresh: 'refresh', reload: 'refresh',
    discover: 'search', autoDiscover: 'search', inspect: 'scan', uploadButton: 'upload',
    runNow: 'play', sourceSave: 'plus', editSave: 'save', historyAllButton: 'history',
    prevPage: 'chevronLeft', nextPage: 'chevronRight', clearSelection: 'x',
    bulkStatusApply: 'check', bulkStoreApply: 'check', bulkTrash: 'trash',
    duplicateResolve: 'layers', deleteConfirm: 'trash', editClose: 'x',
    deleteClose: 'x', duplicateClose: 'x', historyClose: 'x'
  };

  const svg = (name, size = '') => `<svg class="admin-ui-icon${size ? ` ${size}` : ''}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.dashboard}</svg>`;
  const clean = (value) => String(value || '')
    .replace(/^[\s\uFE0F\u200D]*(?:[\p{Extended_Pictographic}\u2600-\u27BF][\uFE0F\u200D]*)+/gu, '')
    .replace(/^\s+/, '')
    .trim();
  const normalized = (value) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function iconFor(element) {
    if (idIcons[element.id]) return idIcons[element.id];
    if (element.matches('[data-approve]')) return 'check';
    if (element.matches('[data-reject]')) return 'xCircle';
    if (element.matches('[data-edit-id],[data-edit]')) return 'pencil';
    if (element.matches('[data-delete-id],[data-delete]')) return 'trash';
    if (element.matches('[data-restore-id],[data-restore]')) return 'refresh';
    if (element.matches('[data-duplicate-id]')) return 'layers';
    if (element.matches('[data-history-id]')) return 'history';

    const href = element.getAttribute?.('href') || '';
    if (href.includes('admin-pridat-fotografii')) return 'imagePlus';
    if (href.includes('admin-fotografie')) return 'image';
    if (href.includes('admin-automatizace')) return 'settings';
    if (href === 'admin.html' || href.endsWith('/admin.html')) return 'dashboard';
    if (href === 'index.html' || href.endsWith('/index.html')) return 'globe';

    const label = normalized(element.textContent);
    if (!label) return null;
    if (label.includes('administrace')) return 'dashboard';
    if (label.includes('automatizace')) return 'settings';
    if (label.includes('pridat fotografii')) return 'imagePlus';
    if (label === 'fotografie' || label.includes('fotografii produktu') || label.includes('frontu ke schvaleni')) return 'image';
    if (label.includes('otevrit web') || label.includes('zobrazit web')) return 'globe';
    if (label.includes('odhlasit')) return 'logout';
    if (label.includes('prihlasit')) return 'login';
    if (label.includes('obnovit') || label.includes('nacist znovu')) return 'refresh';
    if (label.includes('spustit')) return 'play';
    if (label.includes('pridat zdroj') || label.startsWith('pridat ')) return 'plus';
    if (label.includes('ulozit')) return 'save';
    if (label.includes('upravit')) return 'pencil';
    if (label.includes('odstranit') || label.includes('smazat') || label.includes('do kose')) return 'trash';
    if (label.includes('schvalit') || label.includes('publikovat')) return 'check';
    if (label.includes('zamitnout')) return 'xCircle';
    if (label === 'zdroj' || label.includes('otevrit zdroj') || label.includes('otevrit stranku')) return 'external';
    if (label.includes('najit') || label.includes('hledat')) return 'search';
    if (label.includes('nahrat') || label.includes('vybrat fotografii')) return 'upload';
    if (label.includes('historie')) return 'history';
    if (label.includes('zrusit') || label === 'zavrit') return 'x';
    if (label.includes('predchozi')) return 'chevronLeft';
    if (label.includes('dalsi')) return 'chevronRight';
    if (label.includes('duplicitu') || label.includes('sloucit')) return 'layers';
    if (label.includes('zmenit produkt')) return 'repeat';
    if (label.includes('nacist fotografii')) return 'scan';
    if (label.includes('skryt')) return 'eyeOff';
    if (label.includes('zapnout')) return 'power';
    if (label.includes('pozastavit')) return 'pause';
    return null;
  }

  function decorate(element) {
    if (!(element instanceof HTMLElement)) return;
    if (element.querySelector(':scope > svg:not(.admin-ui-icon)')) return;
    const name = iconFor(element);
    if (!name) return;
    if (element.querySelector(':scope > .admin-ui-icon')) {
      element.classList.add('admin-ui-control');
      return;
    }
    const label = clean(element.textContent);
    if (!label) return;
    element.innerHTML = `${svg(name)}<span>${label}</span>`;
    element.classList.add('admin-ui-control');
    element.dataset.adminIconized = name;
  }

  function decorateSpecial(root = document) {
    root.querySelectorAll?.('.searchIcon').forEach((element) => {
      if (!element.querySelector('.admin-ui-icon')) element.innerHTML = svg('search', 'icon-lg');
    });
    root.querySelectorAll?.('.selectedIcon,.productThumb').forEach((element) => {
      if (!element.querySelector('.admin-ui-icon')) element.innerHTML = svg('package', 'icon-lg');
    });
    const statusIcon = document.getElementById('statusIcon');
    if (statusIcon && !statusIcon.querySelector('.admin-ui-icon')) {
      const name = /!|chyba|problem/i.test(statusIcon.textContent) ? 'alert' : 'zap';
      statusIcon.innerHTML = svg(name, 'icon-lg');
    }
  }

  function decorateAll(root = document) {
    document.body.classList.add('admin-unified-icons');
    const selector = 'a.btn,button.btn,label.btn,.actions button,.rowButton,.editBtn,.deleteBtn';
    if (root.matches?.(selector)) decorate(root);
    root.querySelectorAll?.(selector).forEach(decorate);
    decorateSpecial(root);
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      decorateAll(document);
    });
  }

  window.addEventListener('DOMContentLoaded', () => {
    decorateAll(document);
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
})();
