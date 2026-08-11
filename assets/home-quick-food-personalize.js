(() => {
  'use strict';

  const STORAGE_KEY = 'slevao-quick-food-preferences-v1';
  const DEFAULT_KEYS = ['mléko','pečivo','vejce','máslo','sýr','maso','ovoce','zelenina'];
  const CATALOG = [
    { key:'mléko', icon:'🥛', label:'Mléko' },
    { key:'pečivo', icon:'🥖', label:'Pečivo' },
    { key:'vejce', icon:'🥚', label:'Vejce' },
    { key:'máslo', icon:'🧈', label:'Máslo' },
    { key:'sýr', icon:'🧀', label:'Sýr' },
    { key:'maso', icon:'🥩', label:'Maso' },
    { key:'ovoce', icon:'🍎', label:'Ovoce' },
    { key:'zelenina', icon:'🥕', label:'Zelenina' },
    { key:'uzeniny', icon:'🌭', label:'Uzeniny' },
    { key:'ryby', icon:'🐟', label:'Ryby' },
    { key:'káva', icon:'☕', label:'Káva' },
    { key:'nápoje', icon:'🥤', label:'Nápoje' },
    { key:'pivo', icon:'🍺', label:'Pivo' },
    { key:'sladkosti', icon:'🍫', label:'Sladkosti' },
    { key:'mražené', icon:'❄️', label:'Mražené' },
    { key:'drogerie', icon:'🧴', label:'Drogerie' }
  ];
  const byKey = new Map(CATALOG.map((item) => [item.key, item]));

  let dock = null;
  let selected = readPreferences();
  let draft = null;
  let modal = null;
  let previousBodyOverflow = '';

  function readPreferences() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!Array.isArray(parsed)) return [...DEFAULT_KEYS];
      const clean = [...new Set(parsed.map(String).filter((key) => byKey.has(key)))];
      return clean.length ? clean : [...DEFAULT_KEYS];
    } catch {
      return [...DEFAULT_KEYS];
    }
  }

  function savePreferences(keys) {
    selected = [...new Set(keys.filter((key) => byKey.has(key)))];
    if (!selected.length) selected = [...DEFAULT_KEYS];
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(selected)); } catch {}
  }

  function buttonMarkup(key) {
    const item = byKey.get(key);
    if (!item) return '';
    return `<button class="sqFoodQuick" type="button" data-sq-food="${item.key}" aria-pressed="false" title="Filtrovat: ${item.label}"><span class="sqFoodIcon" aria-hidden="true">${item.icon}</span><span>${item.label}</span></button>`;
  }

  function refreshDock() {
    if (!dock) return;
    const scroller = dock.querySelector('.sqFoodDockItems');
    if (!scroller) return;
    scroller.innerHTML = selected.map(buttonMarkup).join('');

    const currentSearch = document.getElementById('sideSearch');
    if (currentSearch) currentSearch.dispatchEvent(new Event('input', { bubbles:true }));
    window.dispatchEvent(new Event('resize'));
  }

  function ensureControls() {
    if (!dock || dock.dataset.sqFoodPersonalized === '1') return;
    dock.dataset.sqFoodPersonalized = '1';

    const head = dock.querySelector('.sqFoodDockHead');
    const toggle = head?.querySelector('.sqFoodDockToggle');
    if (head && !head.querySelector('.sqFoodCustomize')) {
      const button = document.createElement('button');
      button.className = 'sqFoodCustomize';
      button.type = 'button';
      button.setAttribute('aria-label', 'Upravit Rychlý nákup');
      button.title = 'Upravit Rychlý nákup';
      button.textContent = '⚙';
      if (toggle) head.insertBefore(button, toggle);
      else head.appendChild(button);
    }

    if (!dock.querySelector('.sqFoodMobileBar')) {
      const bar = document.createElement('div');
      bar.className = 'sqFoodMobileBar';
      bar.innerHTML = '<strong>Rychlý nákup</strong><button class="sqFoodMobileCustomize" type="button">Upravit</button>';
      const previous = dock.querySelector('[data-sq-food-scroll="prev"]');
      if (previous) dock.insertBefore(bar, previous);
      else dock.prepend(bar);
    }

    dock.addEventListener('click', (event) => {
      const customize = event.target.closest('.sqFoodCustomize,.sqFoodMobileCustomize');
      if (!customize) return;
      event.preventDefault();
      event.stopPropagation();
      openEditor();
    });
  }

  function ensureModal() {
    if (modal?.isConnected) return modal;
    modal = document.createElement('div');
    modal.className = 'sqFoodEditor';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="sqFoodEditorBackdrop" data-sq-food-editor-close></div>
      <section class="sqFoodEditorSheet" role="dialog" aria-modal="true" aria-labelledby="sqFoodEditorTitle">
        <div class="sqFoodEditorHead">
          <div><small>Vlastní nastavení</small><h2 id="sqFoodEditorTitle">Rychlý nákup</h2></div>
          <button class="sqFoodEditorClose" type="button" data-sq-food-editor-close aria-label="Zavřít">×</button>
        </div>
        <p class="sqFoodEditorHint">Vyber si svoje položky a nastav jejich pořadí. Nastavení zůstane uložené v tomto zařízení.</p>
        <div class="sqFoodEditorSection">
          <div class="sqFoodEditorSectionHead"><strong>Moje lišta</strong><span data-sq-food-selected-count></span></div>
          <div class="sqFoodEditorSelected" data-sq-food-editor-selected></div>
        </div>
        <div class="sqFoodEditorSection">
          <div class="sqFoodEditorSectionHead"><strong>Přidat další</strong></div>
          <div class="sqFoodEditorCatalog" data-sq-food-editor-catalog></div>
        </div>
        <div class="sqFoodEditorActions">
          <button class="sqFoodEditorReset" type="button" data-sq-food-editor-reset>Obnovit výchozí</button>
          <button class="sqFoodEditorSave" type="button" data-sq-food-editor-save>Uložit</button>
        </div>
      </section>`;
    document.body.appendChild(modal);

    modal.addEventListener('click', (event) => {
      if (event.target.closest('[data-sq-food-editor-close]')) {
        closeEditor();
        return;
      }

      const add = event.target.closest('[data-sq-food-add]');
      if (add) {
        const key = add.dataset.sqFoodAdd;
        if (byKey.has(key) && !draft.includes(key)) draft.push(key);
        renderEditor();
        return;
      }

      const remove = event.target.closest('[data-sq-food-remove]');
      if (remove) {
        if (draft.length <= 1) return;
        draft = draft.filter((key) => key !== remove.dataset.sqFoodRemove);
        renderEditor();
        return;
      }

      const move = event.target.closest('[data-sq-food-move]');
      if (move) {
        const key = move.dataset.sqFoodKey;
        const index = draft.indexOf(key);
        if (index < 0) return;
        const direction = move.dataset.sqFoodMove === 'up' ? -1 : 1;
        const target = index + direction;
        if (target < 0 || target >= draft.length) return;
        [draft[index], draft[target]] = [draft[target], draft[index]];
        renderEditor();
        return;
      }

      if (event.target.closest('[data-sq-food-editor-reset]')) {
        draft = [...DEFAULT_KEYS];
        renderEditor();
        return;
      }

      if (event.target.closest('[data-sq-food-editor-save]')) {
        savePreferences(draft);
        refreshDock();
        closeEditor();
      }
    });

    return modal;
  }

  function renderEditor() {
    ensureModal();
    const selectedRoot = modal.querySelector('[data-sq-food-editor-selected]');
    const catalogRoot = modal.querySelector('[data-sq-food-editor-catalog]');
    const count = modal.querySelector('[data-sq-food-selected-count]');
    if (!selectedRoot || !catalogRoot) return;

    if (count) count.textContent = `${draft.length} položek`;
    selectedRoot.innerHTML = draft.map((key, index) => {
      const item = byKey.get(key);
      return `<div class="sqFoodEditorRow">
        <span class="sqFoodEditorRowIcon" aria-hidden="true">${item.icon}</span>
        <strong>${item.label}</strong>
        <div class="sqFoodEditorMove" aria-label="Změnit pořadí ${item.label}">
          <button type="button" data-sq-food-move="up" data-sq-food-key="${key}" aria-label="Posunout ${item.label} doleva" ${index === 0 ? 'disabled' : ''}>←</button>
          <button type="button" data-sq-food-move="down" data-sq-food-key="${key}" aria-label="Posunout ${item.label} doprava" ${index === draft.length - 1 ? 'disabled' : ''}>→</button>
        </div>
        <button class="sqFoodEditorRemove" type="button" data-sq-food-remove="${key}" aria-label="Odebrat ${item.label}" ${draft.length <= 1 ? 'disabled' : ''}>×</button>
      </div>`;
    }).join('');

    const available = CATALOG.filter((item) => !draft.includes(item.key));
    catalogRoot.innerHTML = available.length
      ? available.map((item) => `<button type="button" data-sq-food-add="${item.key}"><span aria-hidden="true">${item.icon}</span><strong>${item.label}</strong><b>+</b></button>`).join('')
      : '<span class="sqFoodEditorAllAdded">Všechny dostupné položky už máš v liště.</span>';
  }

  function openEditor() {
    ensureModal();
    draft = [...selected];
    renderEditor();
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('is-open'));
    modal.querySelector('.sqFoodEditorClose')?.focus({ preventScroll:true });
  }

  function closeEditor() {
    if (!modal || modal.hidden) return;
    modal.classList.remove('is-open');
    document.body.style.overflow = previousBodyOverflow;
    window.setTimeout(() => { if (modal) modal.hidden = true; }, 180);
  }

  function install() {
    dock = document.querySelector('.sqFoodDock');
    if (!dock) return false;
    ensureControls();
    refreshDock();
    return true;
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.hidden) closeEditor();
  });

  function init() {
    if (install()) return;
    const observer = new MutationObserver(() => {
      if (!install()) return;
      observer.disconnect();
    });
    observer.observe(document.body, { childList:true, subtree:true });
    window.setTimeout(() => observer.disconnect(), 12000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
