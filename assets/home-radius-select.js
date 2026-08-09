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

  const supportsPopover = typeof menu.showPopover === 'function' && typeof menu.hidePopover === 'function';
  if (supportsPopover) {
    menu.setAttribute('popover', 'manual');
  } else {
    menu.hidden = true;
  }

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
  control.append(trigger, select);

  // Menu zůstává mimo hero kartu. V prohlížečích s Popover API jde navíc do top-layer,
  // takže ho nemůže oříznout overflow, border-radius ani stacking context rodičů.
  document.body.appendChild(menu);

  const sync = () => {
    const selected = select.options[select.selectedIndex] || options[0];
    valueNode.textContent = selected ? selected.textContent.trim() : '15 km';
    buttons.forEach((button) => {
      const active = button.dataset.value === select.value;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  };

  const menuIsOpen = () => supportsPopover
    ? menu.matches(':popover-open')
    : !menu.hidden;

  const positionMenu = () => {
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.visualViewport?.width || document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = window.visualViewport?.height || document.documentElement.clientHeight || window.innerHeight;
    const edge = 10;
    const gap = 8;
    const wantedWidth = Math.max(150, Math.min(178, rect.width + 34));
    const menuWidth = Math.min(wantedWidth, viewportWidth - edge * 2);

    menu.style.setProperty('position', 'fixed', 'important');
    menu.style.setProperty('margin', '0', 'important');
    menu.style.setProperty('inset', 'auto', 'important');
    menu.style.setProperty('width', `${Math.round(menuWidth)}px`, 'important');
    menu.style.setProperty('max-width', `calc(100vw - ${edge * 2}px)`, 'important');
    menu.style.setProperty('max-height', `${Math.max(170, viewportHeight - edge * 2)}px`, 'important');
    menu.style.setProperty('overflow-y', 'auto', 'important');
    menu.style.setProperty('z-index', '2147483647', 'important');

    // Teprve po nastavení šířky změříme skutečnou výšku menu.
    const measured = menu.getBoundingClientRect();
    const menuHeight = Math.min(measured.height || 230, viewportHeight - edge * 2);
    const left = Math.min(
      Math.max(edge, rect.left),
      Math.max(edge, viewportWidth - menuWidth - edge)
    );

    const roomBelow = viewportHeight - rect.bottom - edge;
    const roomAbove = rect.top - edge;
    const opensUp = roomBelow < menuHeight + gap && roomAbove > roomBelow;
    const top = opensUp
      ? Math.max(edge, rect.top - menuHeight - gap)
      : Math.min(rect.bottom + gap, Math.max(edge, viewportHeight - menuHeight - edge));

    menu.style.setProperty('left', `${Math.round(left)}px`, 'important');
    menu.style.setProperty('top', `${Math.round(top)}px`, 'important');
  };

  const close = (focusTrigger = false) => {
    if (supportsPopover) {
      if (menu.matches(':popover-open')) menu.hidePopover();
    } else {
      menu.hidden = true;
    }
    control.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    if (focusTrigger) trigger.focus({ preventScroll: true });
  };

  const open = () => {
    control.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');

    if (supportsPopover) {
      if (!menu.matches(':popover-open')) menu.showPopover();
    } else {
      menu.hidden = false;
    }

    positionMenu();
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
    if (menuIsOpen()) close();
    else open();
  });

  trigger.addEventListener('keydown', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (!menuIsOpen()) open();
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
  }, true);

  window.addEventListener('scroll', () => {
    if (menuIsOpen()) close();
  }, { passive: true });

  const viewport = window.visualViewport;
  viewport?.addEventListener('resize', () => {
    if (menuIsOpen()) positionMenu();
  });

  window.addEventListener('resize', () => {
    if (menuIsOpen()) positionMenu();
  });

  sync();
})();
