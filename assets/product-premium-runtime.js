(() => {
  'use strict';

  if (!/produkt\.html$/i.test(location.pathname)) return;

  function toast(message) {
    if (window.SlevaoPublic?.toast) {
      window.SlevaoPublic.toast(message);
      return;
    }
    let box = document.querySelector('.sfToast');
    if (!box) {
      box = document.createElement('div');
      box.className = 'sfToast';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    box.textContent = message;
    box.classList.add('show');
    window.setTimeout(() => box.classList.remove('show'), 2800);
  }

  function isComparable() {
    return document.getElementById('productContent')?.dataset.identityMode === 'comparable';
  }

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

  function updateIdentityAwareControls() {
    const comparable = isComparable();
    const best = document.querySelector('.sfPremiumBestOffer');
    if (best) {
      best.textContent = comparable ? 'Přejít na nejnižší srovnatelnou nabídku' : 'Přejít na nejlepší nabídku';
      best.setAttribute('aria-label', comparable ? 'Přejít na nejnižší srovnatelnou nabídku' : 'Přejít na nejlepší nabídku');
    }
    const share = document.querySelector('.sfShareProduct');
    if (share) share.setAttribute('aria-label', comparable ? 'Sdílet toto porovnání srovnatelných nabídek' : 'Sdílet tento produkt');
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
      link.addEventListener('click', (event) => {
        const best = document.querySelector('#offers .sfOffer.best');
        if (!best) return;
        event.preventDefault();
        best.scrollIntoView({ behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block:'center' });
      });
      actions.prepend(link);
    }

    if (!actions.querySelector('.sfShareProduct')) {
      const share = document.createElement('button');
      share.className = 'sfButton sfShareProduct';
      share.type = 'button';
      share.textContent = 'Sdílet';
      share.setAttribute('aria-label', 'Sdílet tento produkt');
      share.addEventListener('click', shareProduct);
      actions.appendChild(share);
    }

    if (!hero.querySelector('.sfHeroTrustChips')) {
      const chips = document.createElement('div');
      chips.className = 'sfHeroTrustChips';
      chips.innerHTML = '<span class="sfHeroTrustChip">Ověřené akční ceny</span><span class="sfHeroTrustChip">Průběžná aktualizace</span><span class="sfHeroTrustChip">Porovnání bez registrace</span>';
      actions.after(chips);
    }
    updateIdentityAwareControls();
    return true;
  }

  async function shareProduct() {
    const name = document.getElementById('productName')?.textContent?.trim() || 'Produkt na Slevao.cz';
    const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
    const price = document.getElementById('currentPrice')?.textContent?.trim() || '';
    const comparable = isComparable();
    const hasPrice = price && !/Bez viditelné ceny/i.test(price);
    const data = {
      title:`${name} | Slevao.cz`,
      text:comparable
        ? (hasPrice ? `${name} – nejnižší srovnatelná nabídka ${price}` : `${name} – srovnatelné nabídky na Slevao.cz`)
        : (hasPrice ? `${name} – nejlepší aktuální cena ${price}` : `${name} – porovnání cen na Slevao.cz`),
      url:canonical
    };

    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(canonical);
        toast('Odkaz na produkt byl zkopírován.');
        return;
      }
      const input = document.createElement('textarea');
      input.value = canonical;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
      toast('Odkaz na produkt byl zkopírován.');
    } catch (error) {
      if (error?.name !== 'AbortError') toast('Sdílení se nepodařilo dokončit.');
    }
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
    window.addEventListener('slevao:product-identity-ready', updateIdentityAwareControls);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
