(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);

  function enhanceHeader() {
    const inner = $('.sfTopInner');
    if (!inner || $('.sfPremiumSearch', inner)) return;

    const form = document.createElement('form');
    form.className = 'sfPremiumSearch';
    form.setAttribute('role', 'search');
    form.innerHTML = '<input type="search" name="q" autocomplete="off" aria-label="Hledat na Slevao.cz" placeholder="Hledat produkt, kategorii nebo obchod…"><button type="submit" aria-label="Hledat">⌕</button>';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const query = form.elements.q.value.trim();
      location.href = query ? `hledat.html?q=${encodeURIComponent(query)}` : 'hledat.html';
    });

    const nav = $('.sfTopLinks', inner);
    inner.insertBefore(form, nav || null);
  }

  function enhanceBreadcrumbs() {
    const shell = $('.sfShell');
    const hero = $('.sfHero');
    if (!shell || !hero) return;

    let crumbs = $('.sfPremiumBreadcrumbs', shell);
    if (!crumbs) {
      crumbs = document.createElement('nav');
      crumbs.className = 'sfPremiumBreadcrumbs';
      crumbs.setAttribute('aria-label', 'Drobečková navigace');
      crumbs.innerHTML = '<a href="index.html">⌂</a><span class="sep">›</span><a href="hledat.html">Produkty</a><span class="sep">›</span><span class="current">Produkt</span>';
      shell.insertBefore(crumbs, hero);
    }

    const name = $('#productName')?.textContent?.trim();
    const current = $('.current', crumbs);
    if (name && !/^Načítám/i.test(name) && current && current.textContent !== name) current.textContent = name;
  }

  function enhanceHeroPrice() {
    const price = $('#currentPrice');
    if (!price || price.dataset.premiumReady === '1') return;
    price.dataset.premiumReady = '1';

    const parent = price.parentElement;
    if (!parent) return;
    parent.classList.add('sfCurrentPriceRow');

    const badge = document.createElement('span');
    badge.className = 'sfCurrentBestBadge';
    badge.textContent = 'Nejnižší cena právě teď';
    price.insertAdjacentElement('afterend', badge);
  }

  function enhanceHeroActions() {
    const hero = $('.sfHeroMain');
    const actions = $('.sfPersonalHeroActions', hero);
    if (!hero || !actions) return;

    if (!$('.sfPremiumBestOffer', actions)) {
      const best = document.createElement('a');
      best.className = 'sfButton sfPremiumBestOffer';
      best.href = '#offersSection';
      best.textContent = 'Zobrazit nejlepší nabídku';
      actions.prepend(best);
    }

    if (!$('.sfHeroTrustChips', hero)) {
      const trust = document.createElement('div');
      trust.className = 'sfHeroTrustChips';
      trust.innerHTML = '<span class="sfHeroTrustChip">Ověřené obchody</span><span class="sfHeroTrustChip">Aktuální ceny</span><span class="sfHeroTrustChip">Žádné skryté poplatky</span>';
      actions.insertAdjacentElement('afterend', trust);
    }
  }

  function enhanceOffersSection() {
    const offers = $('#offers');
    const section = offers?.closest('.sfSection');
    if (!offers || !section) return;
    section.id = 'offersSection';

    const head = $('.sfSectionHead', section);
    if (!head || head.dataset.premiumReady === '1') return;
    head.dataset.premiumReady = '1';

    const title = head.firstElementChild;
    if (title && !title.classList.contains('sfOffersTitleWrap')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'sfOffersTitleWrap';
      const icon = document.createElement('span');
      icon.className = 'sfOffersTitleIcon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '⚖';
      head.insertBefore(wrapper, title);
      wrapper.append(icon, title);
    }

    let tools = $('.sfSectionTools', head);
    if (!tools) {
      tools = document.createElement('div');
      tools.className = 'sfSectionTools';
      const existing = head.querySelector(':scope > .sfButton');
      if (existing) tools.appendChild(existing);
      head.appendChild(tools);
    }

    if (!$('[data-premium-watch]', tools)) {
      const watch = document.createElement('button');
      watch.type = 'button';
      watch.className = 'sfButton';
      watch.dataset.premiumWatch = '1';
      watch.textContent = '♧ Sledovat cenu';
      watch.addEventListener('click', () => {
        const firstAlert = $('[data-alert-offer]');
        if (firstAlert) firstAlert.click();
        else window.SlevaoPublic?.toast?.('Cenový hlídač bude dostupný po načtení nabídky.');
      });
      tools.prepend(watch);
    }
  }

  function updateDynamicText() {
    enhanceBreadcrumbs();
    const badge = $('.sfCurrentBestBadge');
    const price = $('#currentPrice')?.textContent?.trim();
    if (badge && (!price || /^Bez/i.test(price) || price === '—')) badge.hidden = true;
    else if (badge) badge.hidden = false;
  }

  function enhance() {
    enhanceHeader();
    enhanceBreadcrumbs();
    enhanceHeroPrice();
    enhanceHeroActions();
    enhanceOffersSection();
    updateDynamicText();
  }

  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      enhance();
    });
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', queue, { once:true });
  else queue();

  const observer = new MutationObserver(queue);
  observer.observe(document.documentElement, { childList:true, subtree:true, characterData:true });
  window.setTimeout(() => observer.disconnect(), 15000);
})();
