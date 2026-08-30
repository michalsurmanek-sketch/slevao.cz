(() => {
  'use strict';

  const ICONS = [
    { href: '#top', label: 'Ušetři mi dnes peníze', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.7l1.55 4.55a4.8 4.8 0 0 0 3.02 3.02L21.1 11.8l-4.53 1.53a4.8 4.8 0 0 0-3.02 3.02L12 20.9l-1.55-4.55a4.8 4.8 0 0 0-3.02-3.02L2.9 11.8l4.53-1.53a4.8 4.8 0 0 0 3.02-3.02L12 2.7Z"/></svg>' },
    { href: '#homeNearbyMobile', fallback: '.heroNearbyPanel', label: 'Poblíž vás', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"/><circle cx="12" cy="10" r="2.2"/></svg>' },
    { href: '#homeAutopilot', label: 'Nákupní autopilot', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l1.35 3.95a4.15 4.15 0 0 0 2.6 2.6L19.9 11.1l-3.95 1.35a4.15 4.15 0 0 0-2.6 2.6L12 19l-1.35-3.95a4.15 4.15 0 0 0-2.6-2.6L4.1 11.1l3.95-1.35a4.15 4.15 0 0 0 2.6-2.6L12 3.2Z"/></svg>' },
    { href: '#categoriesSection', label: 'Nakupuj podle kategorie', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>' },
    { href: '#storesSection', label: 'Obchody', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h16v10H4zM3 10l2-5h14l2 5M8 20v-6h4v6"/><path d="M3 10c0 1.3 1 2.3 2.3 2.3S7.7 11.3 7.7 10c0 1.3 1 2.3 2.3 2.3s2.3-1 2.3-2.3c0 1.3 1 2.3 2.3 2.3s2.3-1 2.3-2.3c0 1.3 1 2.3 2.3 2.3S21 11.3 21 10"/></svg>' },
    { href: '#leafletsSection', label: 'Letáky a nabídky', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H12v18H7.5A3.5 3.5 0 0 0 4 23V5.5ZM20 5.5A3.5 3.5 0 0 0 16.5 2H12v18h4.5A3.5 3.5 0 0 1 20 23V5.5Z"/></svg>' },
    { href: '#dealsSection', label: 'Nejvýhodnější právě teď', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c3 3.4 5.2 5.7 5.2 9.1A5.2 5.2 0 0 1 6.8 12C6.8 9.8 8 7.9 9.5 6c.2 2 1.2 3.1 2.5 4.1.2-2.7.1-4.5 0-7.1Z"/></svg>' },
    { href: 'seznam.html', label: 'Můj seznam', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h12M8 12h12M8 19h12"/><path d="m3.5 5 1 1 2-2M3.5 12l1 1 2-2M3.5 19l1 1 2-2"/></svg>' },
    { href: 'ucet.html', label: 'Můj účet', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>' }
  ];

  function install() {
    const host = document.querySelector('.footerQuickIcons');
    if (!host || host.dataset.sectionJumps === '1') return;
    host.dataset.sectionJumps = '1';
    host.classList.add('footerSectionJumpIcons');
    host.innerHTML = ICONS.map((item) => `<a href="${item.href}" aria-label="${item.label}" title="${item.label}" data-footer-jump="1">${item.icon}</a>`).join('');

    host.addEventListener('click', (event) => {
      const link = event.target.closest('a[data-footer-jump="1"]');
      if (!link) return;
      const href = link.getAttribute('href') || '';
      if (!href.startsWith('#')) return;
      let target = document.querySelector(href);
      const spec = ICONS.find((item) => item.href === href);
      if (!target && spec?.fallback) target = document.querySelector(spec.fallback);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();
