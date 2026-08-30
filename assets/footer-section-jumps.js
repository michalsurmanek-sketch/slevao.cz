(() => {
  'use strict';

  // Stejné symboly a stejné pořadí jako kruhové oddělovače sekcí na homepage.
  const ITEMS = [
    { href:'#homeNearbyMobile', fallback:'.heroNearbyPanel', label:'Poblíž vás', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"/><circle cx="12" cy="10" r="2.2"/></svg>' },
    { href:'#homeAutopilot', label:'Nákupní autopilot', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.45 4.25a4.5 4.5 0 0 0 2.85 2.85l4.25 1.45-4.25 1.45a4.5 4.5 0 0 0-2.85 2.85L12 20l-1.45-4.25a4.5 4.5 0 0 0-2.85-2.85l-4.25-1.45 4.25-1.45a4.5 4.5 0 0 0 2.85-2.85L12 3Z"/></svg>' },
    { href:'#categoriesSection', label:'Nakupuj podle kategorie', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.2"/><rect x="14" y="4" width="6" height="6" rx="1.2"/><rect x="4" y="14" width="6" height="6" rx="1.2"/><rect x="14" y="14" width="6" height="6" rx="1.2"/></svg>' },
    { href:'#storesSection', label:'Obchody', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h16v10H4zM3 10l2-5h14l2 5M8 20v-6h4v6"/><path d="M3 10c0 1.3 1 2.3 2.3 2.3S7.7 11.3 7.7 10c0 1.3 1 2.3 2.3 2.3s2.3-1 2.3-2.3c0 1.3 1 2.3 2.3 2.3s2.3-1 2.3-2.3c0 1.3 1 2.3 2.3 2.3S21 11.3 21 10"/></svg>' },
    { href:'#leafletsSection', label:'Letáky a nabídky', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H12v18H7.5A3.5 3.5 0 0 0 4 23V5.5ZM20 5.5A3.5 3.5 0 0 0 16.5 2H12v18h4.5A3.5 3.5 0 0 1 20 23V5.5Z"/></svg>' },
    { href:'#quickTabs', fallback:'.sqFoodDock', label:'Rychlý nákup', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1.2 11H6.2L5 8Z"/><path d="M8 8V6.5A4 4 0 0 1 12 2.5a4 4 0 0 1 4 4V8"/><circle cx="9" cy="20.5" r="1"/><circle cx="16" cy="20.5" r="1"/></svg>' },
    { href:'#dealsSection', label:'Aktuální ceny', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="7" r="2.2"/><circle cx="17" cy="17" r="2.2"/><path d="M18.5 4.5 5.5 19.5"/></svg>' }
  ];

  const styleId = 'footerSectionJumpStyle';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .footerQuickIcons.footerSectionJumpIcons{display:flex!important;flex-wrap:wrap!important;gap:10px!important;max-width:360px}
      .footerQuickIcons.footerSectionJumpIcons>a{width:54px!important;height:54px!important;display:grid!important;place-items:center!important;flex:0 0 54px!important;padding:0!important;border:1px solid rgba(75,221,207,.34)!important;border-radius:14px!important;background:rgba(255,255,255,.025)!important;color:#32d2c2!important;text-decoration:none!important;box-shadow:inset 0 1px 0 rgba(255,255,255,.04)!important;transition:transform .16s ease,border-color .16s ease,background .16s ease!important}
      .footerQuickIcons.footerSectionJumpIcons>a:hover{transform:translateY(-2px);border-color:#4fdfd0!important;background:rgba(53,215,198,.1)!important}
      .footerQuickIcons.footerSectionJumpIcons svg{width:27px;height:27px;display:block;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
      .footerQuickIcons.footerSectionJumpIcons a:nth-child(2) svg,.footerQuickIcons.footerSectionJumpIcons a:nth-child(3) svg{fill:currentColor;stroke:none}
      @media(max-width:620px){.footerQuickIcons.footerSectionJumpIcons{gap:9px!important;max-width:100%}.footerQuickIcons.footerSectionJumpIcons>a{width:52px!important;height:52px!important;flex-basis:52px!important;border-radius:13px!important}.footerQuickIcons.footerSectionJumpIcons svg{width:25px;height:25px}}
      @media(prefers-reduced-motion:reduce){.footerQuickIcons.footerSectionJumpIcons>a{transition:none}.footerQuickIcons.footerSectionJumpIcons>a:hover{transform:none}}
    `;
    document.head.appendChild(style);
  }

  function resolve(item) {
    let target = null;
    if (item.href.startsWith('#')) {
      try { target = document.querySelector(item.href); } catch {}
    }
    if (!target && item.fallback) target = document.querySelector(item.fallback);
    return target;
  }

  function install() {
    const host = document.querySelector('.footerQuickIcons');
    if (!host || host.dataset.sectionJumps === '1') return;
    host.dataset.sectionJumps = '1';
    host.classList.add('footerSectionJumpIcons');
    host.innerHTML = ITEMS.map((item) => `<a href="${item.href}" aria-label="${item.label}" title="${item.label}" data-footer-jump="1">${item.icon}</a>`).join('');

    host.addEventListener('click', (event) => {
      const link = event.target.closest('a[data-footer-jump="1"]');
      if (!link) return;
      const item = ITEMS.find((entry) => entry.href === link.getAttribute('href'));
      if (!item) return;
      const target = resolve(item);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior:'smooth', block:'start' });
      history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();