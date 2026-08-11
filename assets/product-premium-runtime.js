(() => {
  'use strict';

  if (!/produkt\.html$/i.test(location.pathname)) return;

  function ensureSearch() {
    const header = document.querySelector('.sfTopInner');
    if (!header || header.querySelector('.sfPremiumSearch')) return;
    const form = document.createElement('form');
    form.className = 'sfPremiumSearch';
    form.action = 'hledat.html';
    form.method = 'get';
    form.setAttribute('role', 'search');
    form.innerHTML = '<input name="q" type="search" autocomplete="off" aria-label="Hledat produkt" placeholder="Hledej produkt, značku nebo obchod…"><button type="submit" aria-label="Hledat">⌕</button>';
    const nav = header.querySelector('.sfTopLinks');
    if (nav) header.insertBefore(form, nav); else header.appendChild(form);
  }

  function ensureBreadcrumbs() {
    const shell = document.getElementById('productContent');
    const hero = shell?.querySelector('.sfHero');
    if (!shell || !hero) return;
    let breadcrumbs = shell.querySelector('.sfPremiumBreadcrumbs');
    if (!breadcrumbs) {
      breadcrumbs = document.createElement('nav');
      breadcrumbs.className = 'sfPremiumBreadcrumbs';
      breadcrumbs.setAttribute('aria-label', 'Drobečková navigace');
      breadcrumbs.innerHTML = '<a href="index.html">Domů</a><span class="sep">›</span><a href="hledat.html">Produkty</a><span class="sep">›</span><span class="current">Produkt</span>';
      shell.insertBefore(breadcrumbs, hero);
    }
    const name = document.getElementById('productName')?.textContent?.trim();
    const current = breadcrumbs.querySelector('.current');
    if (current && name && !/^Načítám/i.test(name)) current.textContent = name;
  }

  function ensureHeroExtras() {
    const hero = document.querySelector('.sfHeroMain');
    if (!hero) return false;
    const actions = hero.querySelector('.sfPersonalHeroActions');
    if (!actions) return false;

    if (!actions.querySelector('.sfPremiumBestOffer')) {
      const link = document.createElement('a');
      link.className = 'sfButton sfPremiumBestOffer';
      link.href = '#offers';
      link.textContent = 'Přejít na nejlepší nabídku';
      actions.prepend(link);
    }

    if (!hero.querySelector('.sfHeroTrustChips')) {
      const chips = document.createElement('div');
      chips.className = 'sfHeroTrustChips';
      chips.innerHTML = '<span class="sfHeroTrustChip">Ověřené akční ceny</span><span class="sfHeroTrustChip">Průběžná aktualizace</span><span class="sfHeroTrustChip">Porovnání bez registrace</span>';
      actions.after(chips);
    }
    return true;
  }

  function ensureOffersHeading() {
    const offers = document.getElementById('offers');
    const section = offers?.closest('.sfSection');
    const head = section?.querySelector('.sfSectionHead');
    if (!head || head.querySelector('.sfOffersTitleIcon')) return;
    const left = head.firstElementChild;
    if (!left) return;
    const wrap = document.createElement('div');
    wrap.className = 'sfOffersTitleWrap';
    const icon = document.createElement('span');
    icon.className = 'sfOffersTitleIcon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '⇄';
    head.insertBefore(wrap, left);
    wrap.append(icon, left);
    const right = head.querySelector(':scope > .sfButton');
    if (right) {
      const tools = document.createElement('div');
      tools.className = 'sfSectionTools';
      head.appendChild(tools);
      tools.appendChild(right);
    }
  }

  function init() {
    ensureSearch();
    ensureBreadcrumbs();
    ensureOffersHeading();

    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      ensureBreadcrumbs();
      if (ensureHeroExtras() || attempts >= 60) window.clearInterval(timer);
    }, 100);

    window.addEventListener('slevao:product-offers-rendered', () => {
      ensureBreadcrumbs();
      ensureHeroExtras();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
