(() => {
  'use strict';

  const ITEMS = [
    { href:'#homeNearbyMobile', fallback:'.heroNearbyPanel', label:'Poblíž mě', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.1 6-11a6 6 0 1 0-12 0c0 5.9 6 11 6 11Z"/><circle cx="12" cy="10" r="2.2"/></svg>' },
    { href:'#homeAutopilot', label:'Největší slevy', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.45 4.25a4.5 4.5 0 0 0 2.85 2.85l4.25 1.45-4.25 1.45a4.5 4.5 0 0 0-2.85 2.85L12 20l-1.45-4.25a4.5 4.5 0 0 0-2.85-2.85l-4.25-1.45 4.25-1.45a4.5 4.5 0 0 0 2.85-2.85l-4.25-1.45 4.25-1.45a4.5 4.5 0 0 0 2.85-2.85L12 3Z"/></svg>' },
    { href:'#categoriesSection', label:'Kategorie', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1.2"/><rect x="14" y="4" width="6" height="6" rx="1.2"/><rect x="4" y="14" width="6" height="6" rx="1.2"/><rect x="14" y="14" width="6" height="6" rx="1.2"/></svg>' },
    { href:'#storesSection', label:'Obchody', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10h16v10H4zM3 10l2-5h14l2 5M8 20v-6h4v6"/><path d="M3 10c0 1.3 1 2.3 2.3 2.3S7.7 11.3 7.7 10c0 1.3 1 2.3 2.3 2.3s2.3-1 2.3-2.3c0 1.3 1 2.3 2.3 2.3s2.3-1 2.3-2.3c0 1.3 1 2.3 2.3 2.3S21 11.3 21 10"/></svg>' },
    { href:'#leafletsSection', label:'Letáky', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M8 7h8M8 10.5h8M8 14h8M8 17.5h5"/></svg>' },
    { href:'#quickTabs', fallback:'.sqFoodDock', label:'Nákupní seznam', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h2l2.1 9.1a2 2 0 0 0 2 1.5h7.8a2 2 0 0 0 1.9-1.4L21 8H6"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="17.5" cy="19" r="1.4"/></svg>' },
    { href:'#dealsSection', label:'Slevové kódy', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="7" r="2.2"/><circle cx="17" cy="17" r="2.2"/><path d="M18.5 4.5 5.5 19.5"/></svg>' },
    { href:'#dealsSection', label:'Hledej', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>' },
    { href:'seznam.html', label:'Seznam', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>' },
    { href:'ucet.html', label:'Můj účet', icon:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M5 21a7 7 0 0 1 14 0"/></svg>', mobileOnly:true }
  ];

  const styleId = 'footerSectionJumpStyle';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .footerQuickIcons.footerSectionJumpIcons{display:flex!important;flex-wrap:wrap!important;gap:10px!important;max-width:420px}
      .footerQuickIcons.footerSectionJumpIcons>a{width:64px!important;min-height:76px!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:flex-start!important;gap:6px!important;flex:0 0 64px!important;padding:0!important;border:0!important;background:transparent!important;color:#fff!important;text-decoration:none!important;box-shadow:none!important;transition:transform .16s ease!important}
      .footerQuickIcons.footerSectionJumpIcons>a[data-mobile-only="1"]{display:none!important}
      .footerQuickIcons.footerSectionJumpIcons .footerJumpIcon{width:54px;height:54px;display:grid;place-items:center;border:1px solid rgba(75,221,207,.42);border-radius:14px;background:rgba(255,255,255,.025);box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
      .footerQuickIcons.footerSectionJumpIcons .footerJumpLabel{display:block;color:#dce9e7;font-size:10px;line-height:1.15;text-align:center;white-space:normal}
      .footerQuickIcons.footerSectionJumpIcons>a:hover{transform:translateY(-2px)}
      .footerQuickIcons.footerSectionJumpIcons>a:hover .footerJumpIcon{border-color:#49dfcf;background:rgba(255,255,255,.10)}
      .footerQuickIcons.footerSectionJumpIcons svg{width:27px;height:27px;display:block;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
      .footerQuickIcons.footerSectionJumpIcons a:nth-child(2) svg,.footerQuickIcons.footerSectionJumpIcons a:nth-child(3) svg{fill:currentColor;stroke:none}
      @media(max-width:620px){
        .footerQuickIcons.footerSectionJumpIcons{display:grid!important;grid-template-columns:repeat(5,minmax(0,1fr))!important;gap:12px 8px!important;max-width:none!important;width:100%!important}
        .footerQuickIcons.footerSectionJumpIcons>a{width:auto!important;min-width:0!important;min-height:82px!important;flex-basis:auto!important;gap:7px!important}
        .footerQuickIcons.footerSectionJumpIcons>a[data-mobile-only="1"]{display:flex!important}
        .footerQuickIcons.footerSectionJumpIcons .footerJumpIcon{width:52px;height:52px;border-radius:13px}
        .footerQuickIcons.footerSectionJumpIcons .footerJumpLabel{font-size:9.5px;line-height:1.2}
        .footerQuickIcons.footerSectionJumpIcons svg{width:25px;height:25px}
      }
      @media(max-width:380px){
        .footerQuickIcons.footerSectionJumpIcons{gap:10px 5px!important}
        .footerQuickIcons.footerSectionJumpIcons .footerJumpIcon{width:48px;height:48px}
        .footerQuickIcons.footerSectionJumpIcons .footerJumpLabel{font-size:8.7px}
      }
      @media(prefers-reduced-motion:reduce){.footerQuickIcons.footerSectionJumpIcons>a{transition:none}.footerQuickIcons.footerSectionJumpIcons>a:hover{transform:none}}
    `;
    document.head.appendChild(style);
  }

  function removeDiscountAlertFeature() {
    document.querySelectorAll('.footerFeatures>.footerFeature').forEach((item) => {
      if ((item.textContent || '').includes('Upozornění na slevy')) item.remove();
    });
  }

  function removeDesktopAccount() {
    document.querySelectorAll('.footerDesktopAccount').forEach((item) => item.remove());
  }

  function moveSocialUnderWatch() {
    const watch = document.querySelector('.footerWatch');
    if (!watch) return;
    const socials = [...document.querySelectorAll('.footerSocial')];
    if (!socials.length) return;
    const keep = watch.querySelector('.footerSocial') || socials[0];
    if (keep.parentElement !== watch) watch.appendChild(keep);
    socials.forEach((item) => { if (item !== keep) item.remove(); });
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
    removeDiscountAlertFeature();
    removeDesktopAccount();
    moveSocialUnderWatch();
    const host = document.querySelector('.footerQuickIcons');
    if (!host) return;
    host.dataset.sectionJumps = '1';
    host.classList.add('footerSectionJumpIcons');
    host.innerHTML = ITEMS.map((item) => `<a href="${item.href}" aria-label="${item.label}" title="${item.label}" data-footer-jump="1"${item.mobileOnly ? ' data-mobile-only="1"' : ''}><span class="footerJumpIcon">${item.icon}</span><span class="footerJumpLabel">${item.label}</span></a>`).join('');

    host.addEventListener('click', (event) => {
      const link = event.target.closest('a[data-footer-jump="1"]');
      if (!link) return;
      const item = ITEMS.find((entry) => entry.href === link.getAttribute('href') && entry.label === link.getAttribute('aria-label'));
      if (!item || !item.href.startsWith('#')) return;
      const target = resolve(item);
      if (!target) return;
      event.preventDefault();
      target.scrollIntoView({ behavior:'smooth', block:'start' });
      history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    });

    const footer = document.querySelector('.footer');
    if (footer) {
      const observer = new MutationObserver(moveSocialUnderWatch);
      observer.observe(footer, { childList:true, subtree:true });
      window.setTimeout(() => observer.disconnect(), 5000);
    }
    window.setTimeout(moveSocialUnderWatch, 0);
    window.setTimeout(moveSocialUnderWatch, 250);
    window.setTimeout(moveSocialUnderWatch, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once:true });
  else install();
})();