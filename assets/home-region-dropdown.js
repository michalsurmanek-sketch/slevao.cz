(() => {
  'use strict';

  const native = document.getElementById('regionSelect');
  if (!native || native.dataset.premiumRegionReady === '1') return;
  native.dataset.premiumRegionReady = '1';
  native.classList.add('slevaoRegionNative');

  const pinSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"></path><circle cx="12" cy="10" r="2.5"></circle></svg>';
  const field = document.createElement('div');
  field.className = 'slevaoRegionField';
  native.parentNode.insertBefore(field, native);
  field.appendChild(native);

  const sourceLabel = document.querySelector('label[for="regionSelect"]');
  if (sourceLabel && !sourceLabel.id) sourceLabel.id = 'slevaoRegionLabel';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'slevaoRegionButton';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  if (sourceLabel?.id) button.setAttribute('aria-labelledby', `${sourceLabel.id} slevaoRegionValue`);
  button.innerHTML = `<span class="slevaoRegionPin">${pinSvg}</span><span id="slevaoRegionValue" class="slevaoRegionValue"></span><span class="slevaoRegionChevron" aria-hidden="true">⌄</span>`;
  field.appendChild(button);

  const menu = document.createElement('div');
  menu.id = 'slevaoRegionMenu';
  menu.className = 'slevaoRegionMenu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Vyber kraj');
  document.body.appendChild(menu);
  button.setAttribute('aria-controls', menu.id);

  let open = false;
  let activeIndex = 0;
  let lastValue = null;

  function options() {
    return [...native.options].map((option) => ({ value: option.value, label: option.textContent || option.label || option.value }));
  }

  function selectedIndex() {
    const rows = options();
    const index = rows.findIndex((row) => row.value === native.value);
    return index >= 0 ? index : 0;
  }

  function syncButton() {
    const selected = native.options[native.selectedIndex] || native.options[0];
    const value = selected?.textContent || 'Celá Česká republika';
    button.querySelector('.slevaoRegionValue').textContent = value;
    if (lastValue !== native.value) {
      lastValue = native.value;
      renderMenu();
    }
  }

  function renderMenu() {
    const rows = options();
    activeIndex = Math.min(Math.max(activeIndex, 0), Math.max(rows.length - 1, 0));
    menu.innerHTML = rows.map((row, index) => {
      const selected = row.value === native.value;
      return `<button type="button" class="slevaoRegionOption${selected ? ' is-selected' : ''}${index === activeIndex && open ? ' is-active-descendant' : ''}" role="option" aria-selected="${selected}" data-region-value="${escapeAttr(row.value)}" data-region-index="${index}"><span class="slevaoRegionOptionIcon">${pinSvg}</span><span class="slevaoRegionOptionLabel">${escapeHtml(row.label)}</span><span class="slevaoRegionCheck" aria-hidden="true">✓</span></button>`;
    }).join('');
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function positionMenu() {
    if (!open) return;
    const rect = button.getBoundingClientRect();
    const viewportPad = 12;
    const width = Math.min(Math.max(rect.width, 300), window.innerWidth - viewportPad * 2);
    menu.style.width = `${width}px`;
    menu.style.maxHeight = `${Math.max(180, Math.min(520, window.innerHeight - 32))}px`;
    menu.style.left = `${Math.min(Math.max(window.scrollX + rect.left, window.scrollX + viewportPad), window.scrollX + window.innerWidth - width - viewportPad)}px`;

    const below = window.innerHeight - rect.bottom - viewportPad;
    const above = rect.top - viewportPad;
    const desired = Math.min(menu.scrollHeight, 520);
    const useTop = desired > below && above > below;
    menu.dataset.placement = useTop ? 'top' : 'bottom';
    if (useTop) {
      const height = Math.min(desired, Math.max(180, above - 6));
      menu.style.maxHeight = `${height}px`;
      menu.style.top = `${window.scrollY + rect.top - height - 6}px`;
    } else {
      const height = Math.min(desired, Math.max(180, below - 6));
      menu.style.maxHeight = `${height}px`;
      menu.style.top = `${window.scrollY + rect.bottom + 6}px`;
    }
  }

  function openMenu() {
    if (open) return;
    open = true;
    activeIndex = selectedIndex();
    button.setAttribute('aria-expanded', 'true');
    renderMenu();
    menu.classList.add('is-open');
    positionMenu();
    requestAnimationFrame(() => menu.querySelector('.is-selected')?.scrollIntoView({ block:'nearest' }));
  }

  function closeMenu({ focus = false } = {}) {
    if (!open) return;
    open = false;
    button.setAttribute('aria-expanded', 'false');
    menu.classList.remove('is-open');
    if (focus) button.focus();
  }

  function choose(value) {
    if (native.value !== value) {
      native.value = value;
      native.dispatchEvent(new Event('change', { bubbles:true }));
    }
    syncButton();
    closeMenu({ focus:true });
  }

  function moveActive(delta) {
    const rows = options();
    if (!rows.length) return;
    activeIndex = (activeIndex + delta + rows.length) % rows.length;
    renderMenu();
    menu.querySelector(`[data-region-index="${activeIndex}"]`)?.scrollIntoView({ block:'nearest' });
  }

  button.addEventListener('click', () => open ? closeMenu() : openMenu());
  sourceLabel?.addEventListener('click', (event) => {
    event.preventDefault();
    button.focus();
    openMenu();
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openMenu();
      else moveActive(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (open) {
        event.preventDefault();
        const row = options()[activeIndex];
        if (row) choose(row.value);
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu();
    }
  });

  menu.addEventListener('click', (event) => {
    const option = event.target.closest('[data-region-value]');
    if (option) choose(option.dataset.regionValue);
  });
  menu.addEventListener('mousemove', (event) => {
    const option = event.target.closest('[data-region-index]');
    if (!option) return;
    const index = Number(option.dataset.regionIndex);
    if (Number.isFinite(index) && index !== activeIndex) {
      activeIndex = index;
      menu.querySelectorAll('.is-active-descendant').forEach((item) => item.classList.remove('is-active-descendant'));
      option.classList.add('is-active-descendant');
    }
  });

  native.addEventListener('change', syncButton);
  new MutationObserver(() => { syncButton(); if (open) positionMenu(); }).observe(native, { childList:true, subtree:true });
  document.addEventListener('pointerdown', (event) => {
    if (open && !field.contains(event.target) && !menu.contains(event.target)) closeMenu();
  }, true);
  document.addEventListener('keydown', (event) => {
    if (open && event.key === 'Escape') closeMenu({ focus:true });
  });
  window.addEventListener('resize', positionMenu, { passive:true });
  window.addEventListener('scroll', positionMenu, { passive:true });

  syncButton();
  setInterval(syncButton, 500);
})();
