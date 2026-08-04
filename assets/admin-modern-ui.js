(() => {
  'use strict';

  if (!document.querySelector('script[data-admin-store-delete]')) {
    const script = document.createElement('script');
    script.src = 'assets/admin-store-delete.js?v=20260802-1';
    script.dataset.adminStoreDelete = 'true';
    document.head.append(script);
  }

  const icons = {
    dashboard:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    tag:'<path d="M20 13 13 20l-9-9V4h7z"/><path d="M8.5 8.5h.01"/>',
    store:'<path d="M3 9l2-5h14l2 5"/><path d="M5 13v7h14v-7"/><path d="M9 20v-6h6v6"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>',
    folder:'<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.86 2.86-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.1A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.86-2.86.06-.06A1.7 1.7 0 0 0 3.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2V9.6h.1A1.7 1.7 0 0 0 3.6 8a1.7 1.7 0 0 0-.34-1.88l-.06-.06L6.06 3.2l.06.06A1.7 1.7 0 0 0 8 3.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2h4v.1A1.7 1.7 0 0 0 15 3.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.86 2.86-.06.06A1.7 1.7 0 0 0 19.4 8a1.7 1.7 0 0 0 .6 1 1.7 1.7 0 0 0 1.1.4h.1v4h-.1A1.7 1.7 0 0 0 19.4 15z"/>',
    image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    imagePlus:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/><path d="M18 3v6M15 6h6"/>',
    checklist:'<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
    report:'<path d="M4 4h16v12H7l-3 3z"/><path d="M8 8h8M8 12h5"/>',
    globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
    external:'<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
    logout:'<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>',
    pencil:'<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    eyeOff:'<path d="m3 3 18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 4.2A10.5 10.5 0 0 1 12 4c5 0 9 4 10 8a12.4 12.4 0 0 1-2 4"/><path d="M6.6 6.6A11.8 11.8 0 0 0 2 12c1 4 5 8 10 8a10.7 10.7 0 0 0 5.4-1.5"/>',
    eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    check:'<path d="m5 12 4 4L19 6"/>', plus:'<path d="M12 5v14M5 12h14"/>',
    refresh:'<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    trash:'<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v6M14 11v6"/>',
    power:'<path d="M12 2v10"/><path d="M6.3 4.8a9 9 0 1 0 11.4 0"/>',
    save:'<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>',
    user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'
  };

  const svg = (name) => `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.dashboard}</svg>`;
  const clean = (value) => String(value || '').replace(/^[\s\uFE0F]*(?:🏠|🏷️?|🏪|📂|⚙️?|🖼️?|➕|🛒|🌐|✏️?|↗|🙈|👁️?|🗑️?|✅|⏸️?|▶️?|📰|💾|💬)\s*/u, '').trim();

  function decorate(element, name, label = '') {
    if (!element || element.dataset.uiIconized === 'true') return;
    element.innerHTML = `${svg(name)}<span>${label || clean(element.textContent)}</span>`;
    element.dataset.uiIconized = 'true';
  }

  function ensureReportsLinks() {
    const nav = document.querySelector('.nav');
    if (nav && !nav.querySelector('a[href="admin-hlaseni.html"]')) {
      const link = document.createElement('a');
      link.href = 'admin-hlaseni.html';
      link.textContent = 'Hlášení uživatelů';
      const before = nav.querySelector('a[href="index.html"]');
      nav.insertBefore(link, before || null);
    }
    const toolbar = document.querySelector('#dashboard .toolbar');
    if (toolbar && !toolbar.querySelector('a[href="admin-hlaseni.html"]')) {
      const link = document.createElement('a');
      link.href = 'admin-hlaseni.html';
      link.className = 'btn light';
      link.textContent = 'Hlášení uživatelů';
      toolbar.appendChild(link);
    }
  }

  function productControlLinks() {
    document.querySelectorAll('a[href="admin-tesco-kontrola.html"]').forEach((element) => {
      if (element.dataset.productControlLabel === 'true') return;
      element.innerHTML = `${svg('checklist')}<span>Kontrola produktů</span>`;
      element.dataset.uiIconized = 'true';
      element.dataset.productControlLabel = 'true';
      element.setAttribute('aria-label', 'Kontrola produktů všech obchodů');
    });
  }

  function staticUi() {
    ensureReportsLinks();
    const pages = {dashboard:'dashboard',offersPage:'tag',storesPage:'store',categoriesPage:'folder'};
    document.querySelectorAll('.nav [data-page]').forEach((element) => decorate(element,pages[element.dataset.page] || 'dashboard'));
    document.querySelectorAll('.nav a').forEach((element) => {
      const href = element.getAttribute('href') || '';
      if (href === 'admin-tesco-kontrola.html') return;
      decorate(element, href.includes('hlaseni') ? 'report' : href.includes('automatizace') ? 'settings' : href.includes('pridat-fotografii') ? 'imagePlus' : href.includes('fotografie') ? 'image' : 'globe');
    });
    document.querySelectorAll('.top .toolbar a,.top .toolbar button').forEach((element) => {
      const href = element.getAttribute('href') || '';
      decorate(element,element.id === 'logout' ? 'logout' : href.includes('automatizace') ? 'settings' : href.includes('fotografie') ? 'image' : 'external');
    });
    document.querySelectorAll('#dashboard .toolbar a,#dashboard .toolbar button').forEach((element) => {
      const href = element.getAttribute('href') || '';
      if (href === 'admin-tesco-kontrola.html') return;
      decorate(element, href.includes('hlaseni') ? 'report' : element.dataset.go === 'storesPage' ? 'store' : href.includes('automatizace') ? 'settings' : href.includes('pridat-fotografii') ? 'imagePlus' : href.includes('fotografie') ? 'image' : 'globe');
    });
    document.querySelectorAll('.mobilebar [data-page]').forEach((element) => decorate(element,pages[element.dataset.page] || 'dashboard'));
    document.querySelectorAll('.mobilebar a').forEach((element) => decorate(element,(element.getAttribute('href') || '').includes('automatizace') ? 'settings' : 'image'));
    [['reload','refresh'],['storeRefresh','refresh'],['saveBtn','save'],['storeSave','plus'],['categorySave','plus'],['editSave','save'],['storeEditSave','save']].forEach(([id,name]) => decorate(document.getElementById(id),name));
    decorate(document.querySelector('[data-go="offersPage"]'),'plus');
    productControlLinks();
  }

  function dynamicUi(root = document) {
    root.querySelectorAll?.('[data-store-edit]').forEach((element) => decorate(element,'pencil'));
    root.querySelectorAll?.('.storeCard .actions a').forEach((element) => decorate(element,'external'));
    root.querySelectorAll?.('[data-store-toggle]').forEach((element) => decorate(element,element.classList.contains('successBtn') ? 'eye' : 'eyeOff'));
    root.querySelectorAll?.('.storeTitleLine .pill').forEach((element) => decorate(element,element.classList.contains('visible') ? 'check' : 'eyeOff'));
    root.querySelectorAll?.('[data-edit]').forEach((element) => decorate(element,'pencil'));
    root.querySelectorAll?.('[data-copy]').forEach((element) => decorate(element,'copy'));
    root.querySelectorAll?.('[data-delete]').forEach((element) => decorate(element,'trash'));
    root.querySelectorAll?.('[data-status="published"]').forEach((element) => decorate(element,'check'));
    root.querySelectorAll?.('[data-status="expired"],[data-cat]').forEach((element) => decorate(element,'power'));
    root.querySelectorAll?.('[data-leaflet-edit]').forEach((element) => decorate(element,'pencil'));
    root.querySelectorAll?.('[data-leaflet-toggle]').forEach((element) => decorate(element,element.textContent.includes('Zapnout') ? 'eye' : 'power'));
    root.querySelectorAll?.('[data-leaflet-delete]').forEach((element) => decorate(element,'trash'));
    root.querySelectorAll?.('.leafletSourceItemActions a').forEach((element) => decorate(element,'external'));
  }

  function account() {
    const target = document.getElementById('sideWho');
    if (!target || target.querySelector('.ui-account')) return;
    const email = target.textContent.trim();
    if (!email || !email.includes('@')) return;
    target.innerHTML = `<div class="ui-account">${svg('user')}<div><strong>${email}</strong><small>admin</small></div></div>`;
  }

  window.addEventListener('DOMContentLoaded',() => {
    document.body.classList.add('admin-modern');
    staticUi();
    dynamicUi();
    account();
    new MutationObserver((mutations) => {
      mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => { if (node.nodeType === 1) dynamicUi(node); }));
      ensureReportsLinks();
      productControlLinks();
      account();
    }).observe(document.body,{childList:true,subtree:true});
  });
})();
