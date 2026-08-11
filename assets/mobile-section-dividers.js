(() => {
  'use strict';

  const mobile = () => window.matchMedia('(max-width:800px)').matches;
  const fold = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const icons = {
    price: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 13 13 20 4 11V4h7l9 9Z"/><circle cx="8.5" cy="8.5" r="1.25"/></svg>',
    category: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg>'
  };

  function divider(key, icon) {
    const node = document.createElement('div');
    node.className = 'mobileSectionDivider';
    node.dataset.mobileSectionDivider = key;
    node.setAttribute('aria-hidden', 'true');
    node.innerHTML = `<span class="mobileSectionDividerIcon">${icons[icon] || icons.price}</span>`;
    return node;
  }

  function ensureBefore(target, key, icon) {
    if (!target?.parentNode) return;
    const previous = target.previousElementSibling;
    if (previous?.dataset?.mobileSectionDivider === key) return;
    document.querySelector(`[data-mobile-section-divider="${key}"]`)?.remove();
    target.parentNode.insertBefore(divider(key, icon), target);
  }

  function sectionAfterDealsByHeading() {
    const deals = document.getElementById('dealsSection');
    if (!deals) return null;
    const candidates = [...document.querySelectorAll('main section')];
    const dealIndex = candidates.indexOf(deals);
    if (dealIndex < 0) return null;

    return candidates.slice(dealIndex + 1).find((section) => {
      const heading = fold(section.querySelector('h1,h2,h3,.sectionTitle')?.textContent || '');
      return heading.includes('vyhodne podle kategorie')
        || heading.includes('vyhodne podle kategorii')
        || heading.includes('podle kategorie');
    }) || null;
  }

  function render() {
    if (!mobile()) return;

    const quick = document.querySelector('.sqFoodDock');
    const deals = document.getElementById('dealsSection');
    if (quick && deals && quick.parentNode === deals.parentNode) {
      ensureBefore(deals, 'quick-to-prices', 'price');
    }

    const categoryDeals = sectionAfterDealsByHeading();
    if (categoryDeals) ensureBefore(categoryDeals, 'prices-to-category', 'category');
  }

  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  };

  function init() {
    render();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList:true, subtree:true });
    window.addEventListener('resize', schedule, { passive:true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once:true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
