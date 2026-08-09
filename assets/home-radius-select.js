(() => {
  'use strict';

  const select = document.getElementById('slLiveRadius');
  if (!select || select.dataset.enhancedRadius === '1') return;

  select.dataset.enhancedRadius = '1';
  select.classList.add('slRadiusNative');

  const control = document.createElement('div');
  control.className = 'slRadiusControl';
  control.setAttribute('data-radius-control', '');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'slRadiusTrigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', 'Vybrat okruh hledání');
  trigger.innerHTML = `
    <span class="slRadiusPin" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false"><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"/><circle cx="12" cy="10" r="2.2"/></svg>
    </span>
    <span class="slRadiusValue"></span>
    <span class="slRadiusChevron" aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false"><path d="m7 9 5 5 5-5"/></svg>
    </span>`;

  const menu = document.createElement('div');
  menu.className = 'slRadiusMenu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Okruh hledání');
  menu.hidden = true;

  const valueNode = trigger.querySelector('.slRadiusValue');
  const options = [...select.options];

  const buttons = options.map((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slRadiusOption';
    button.dataset.value = option.value;
    button.setAttribute('role', 'option');
    button.innerHTML = `<span>${option.textContent.trim()}</span><i aria-hidden="true"></i>`;
    menu.appendChild(button);
    return button;
  });

  select.parentNode.insertBefore(control, select);
  control.append(trigger, menu, select);

  const sync = () => {
    const selected = select.options[select.selectedIndex] || options[0];
    valueNode.textContent = selected ? selected.textContent.trim() : '15 km';
    buttons.forEach((button) => {
      const active = button.dataset.value === select.value;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  };

  const resetMenuPlacement = () => {
    menu.style.removeProperty('position');
    menu.style.removeProperty('left');
    menu.style.removeProperty('top');
    menu.style.removeProperty('right');
    menu.style.removeProperty('bottom');
    menu.style.removeProperty('z-index');
    menu.style.removeProperty('max-height');
    menu.style.removeProperty('overflow-y');
    if (menu.parentElement !== control) control.insertBefore(menu, select);
  };

  const positionPortalMenu = () => {
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const edge = 8;
    const gap = 8;

    if (menu.parentElement !== document.body) document.body.appendChild(menu);
    menu.style.position = 'fixed';
    menu.style.zIndex = '10000';
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
    menu.style.maxHeight = `${Math.max(170, viewportHeight - edge * 2)}px`;
    menu.style.overflowY = 'auto';

    const menuRect = menu.getBoundingClientRect();
    const menuWidth = menuRect.width || Math.max(150, rect.width);
    const menuHeight = menuRect.height || 220;
    const left = Math.min(Math.max(edge, rect.left), Math.max(edge, viewportWidth - menuWidth - edge));

    const roomBelow = viewportHeight - rect.bottom - edge;
    const roomAbove = rect.top - edge;
    let top = rect.bottom + gap;
    if (roomBelow < menuHeight + gap && roomAbove > roomBelow) {
      top = Math.max(edge, rect.top - menuHeight - gap);
    } else {
      top = Math.min(top, Math.max(edge, viewportHeight - menuHeight - edge));
    }

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  };

  const close = (focusTrigger = false) => {
    menu.hidden = true;
    control.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    resetMenuPlacement();
    if (focusTrigger) trigger.focus({ preventScroll: true });
  };

  const open = () => {
    control.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    menu.hidden = false;
    positionPortalMenu();
    const active = buttons.find((button) => button.dataset.value === select.value) || buttons[0];
    requestAnimationFrame(() => active?.focus({ preventScroll: true }));
  };

  const choose = (value) => {
    if (!options.some((option) => option.value === value)) return;
    select.value = value;
    sync();
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
    close(true);
  };

  trigger.addEventListener('click', () => {
    if (menu.hidden) open();
    else close();
  });

  trigger.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    open();
  });

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => choose(button.dataset.value));
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        choose(button.dataset.value);
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const next = (index + direction + buttons.length) % buttons.length;
        buttons[next]?.focus({ preventScroll: true });
      }
      if (event.key === 'Home') {
        event.preventDefault();
        buttons[0]?.focus({ preventScroll: true });
      }
      if (event.key === 'End') {
        event.preventDefault();
        buttons[buttons.length - 1]?.focus({ preventScroll: true });
      }
    });
  });

  select.addEventListener('change', sync);

  document.addEventListener('pointerdown', (event) => {
    if (!control.contains(event.target) && !menu.contains(event.target)) close();
  });

  window.addEventListener('resize', () => close());
  window.addEventListener('scroll', () => {
    if (control.classList.contains('is-open')) close();
  }, { passive: true });

  sync();
})();
