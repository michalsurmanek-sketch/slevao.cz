(() => {
  'use strict';

  const optimizer = document.getElementById('optimizer');
  if (!optimizer) return;

  const mobile = window.matchMedia('(max-width: 720px)');
  let expanded = false;
  let queued = false;

  function legacyBoxes() {
    return [...optimizer.querySelectorAll('.sfResultBox')]
      .filter((box) => box.dataset.dayConsistentPlan !== 'true');
  }

  function removeToggle() {
    optimizer.querySelector('#shoppingLegacyPlansToggle')?.remove();
  }

  function sync() {
    queued = false;
    const exact = optimizer.querySelector('[data-day-consistent-plan="true"]');
    const legacy = legacyBoxes();

    if (!mobile.matches || !exact || !legacy.length) {
      legacy.forEach((box) => { box.hidden = false; });
      removeToggle();
      return;
    }

    legacy.forEach((box) => { box.hidden = !expanded; });

    let toggle = optimizer.querySelector('#shoppingLegacyPlansToggle');
    if (!toggle) {
      toggle = document.createElement('button');
      toggle.id = 'shoppingLegacyPlansToggle';
      toggle.className = 'sfLegacyPlansToggle';
      toggle.type = 'button';
      toggle.addEventListener('click', () => {
        expanded = !expanded;
        sync();
      });
      exact.insertAdjacentElement('afterend', toggle);
    }

    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    const nextText = expanded
      ? 'Skrýt další možnosti'
      : `Další možnosti (${legacy.length})`;
    if (toggle.textContent !== nextText) toggle.textContent = nextText;
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }

  new MutationObserver(schedule).observe(optimizer, { childList:true, subtree:true });
  if (typeof mobile.addEventListener === 'function') mobile.addEventListener('change', schedule);
  schedule();
})();
