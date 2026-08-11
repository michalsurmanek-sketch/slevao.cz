(() => {
  'use strict';

  const main = document.getElementById('top');
  if (!main) return;

  const kindFor = (node) => {
    if (node.id === 'homeNearbyMobile') return 'location';
    if (node.id === 'homeAutopilot') return 'sparkle';
    if (node.id === 'myDealsSection') return 'heart';
    if (node.id === 'categoriesSection') return 'categories';
    if (node.id === 'storesSection') return 'stores';
    if (node.id === 'leafletsSection') return 'leaflet';
    if (node.classList?.contains('sqFoodDock')) return 'cart';
    if (node.id === 'dealsSection') return 'tag';
    return 'sparkle';
  };

  const isMajor = (node) => {
    if (!(node instanceof HTMLElement)) return false;
    if (node.matches('section.hero,#desktopOverview')) return false;
    return node.parentElement === main && (node.matches('section') || node.classList.contains('sqFoodDock'));
  };

  function divider(kind) {
    const element = document.createElement('div');
    element.className = 'mobileSectionDivider';
    element.dataset.dividerKind = kind;
    element.setAttribute('aria-hidden', 'true');
    element.innerHTML = '<span class="mobileSectionDividerIcon"></span>';
    return element;
  }

  function sync() {
    const targets = [...main.children].filter(isMajor);

    main.querySelectorAll(':scope > .mobileSectionDivider').forEach((item) => {
      if (!isMajor(item.nextElementSibling)) item.remove();
    });

    targets.forEach((target) => {
      const kind = kindFor(target);
      let marker = target.previousElementSibling;
      if (!marker?.classList.contains('mobileSectionDivider')) {
        marker = divider(kind);
        main.insertBefore(marker, target);
      }
      marker.dataset.dividerKind = kind;
    });
  }

  sync();
  const observer = new MutationObserver(() => sync());
  observer.observe(main, { childList: true });
})();
