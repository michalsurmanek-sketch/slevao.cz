(() => {
  'use strict';

  const desktop = window.matchMedia('(min-width: 801px)');
  const grid = document.getElementById('dealGrid');
  if (!grid) return;

  const STORE_COLORS = {
    hruska:'#c91624', penny:'#d71920', albert:'#008547', billa:'#e30613', tesco:'#00539f',
    lidl:'#0050aa', kaufland:'#e10915', globus:'#d71920', coop:'#7a4a2f', makro:'#003b7a',
    rohlik:'#6d2aa6', kosik:'#6b2d91', alza:'#76b82a', datart:'#0053a0', dm:'#00509d', rossmann:'#e30613'
  };

  const iconSvg = (name) => {
    const paths = {
      calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
      leaflet:'<path d="M5 3h11l3 3v15H5z"/><path d="M16 3v4h4M8 11h8M8 15h8"/>',
      tag:'<path d="M20 13 11 22 2 13V3h10z"/><circle cx="7" cy="8" r="1.5"/>',
      compare:'<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
      store:'<path d="M3 10h18M5 10v10h14V10M4 4h16l2 6H2z"/><path d="M9 20v-6h6v6"/>',
      add:'<path d="M12 5v14M5 12h14"/>',
      detail:'<path d="M4 19V11M10 19V5M16 19v-9M22 19H2"/>',
      bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.tag}</g></svg>`;
  };

  const formatValidity = (node) => {
    if (!node || node.dataset.cardFormatted === '1') return;
    const raw = node.textContent.replace(/\s+/g, ' ').trim();
    const match = raw.match(/^Platí\s+(.+?)[–-]\s*(.+)$/i);
    node.textContent = '';
    const icon = document.createElement('span');
    icon.className = 'dealFactIcon';
    icon.innerHTML = iconSvg('calendar');
    const text = document.createElement('span');
    text.className = 'dealFactText';
    const label = document.createElement('small');
    label.textContent = 'Platí od–do';
    const strong = document.createElement('strong');
    strong.textContent = match ? `${match[1].trim()} – ${match[2].trim()}` : raw.replace(/^Platí\s*/i, '');
    text.append(label, strong);
    node.append(icon, text);
    node.dataset.cardFormatted = '1';
  };

  const formatLeaflet = (node) => {
    if (!node || node.dataset.cardFormatted === '1') return;
    const raw = node.textContent.replace(/\s+/g, ' ').trim();
    const page = raw.match(/strana\s+(\d+)/i)?.[1] || '';
    node.textContent = '';
    const icon = document.createElement('span');
    icon.className = 'dealFactIcon';
    icon.innerHTML = iconSvg('leaflet');
    const text = document.createElement('span');
    text.className = 'dealFactText';
    const label = document.createElement('small');
    label.textContent = 'Leták';
    const strong = document.createElement('strong');
    strong.textContent = page ? `Strana ${page}` : 'Otevřít leták';
    text.append(label, strong);
    const preview = document.createElement('span');
    preview.className = 'leafletMiniPreview';
    preview.setAttribute('aria-hidden', 'true');
    preview.innerHTML = '<i></i><i></i><i></i><b>⌕</b>';
    node.append(icon, text, preview);
    node.dataset.cardFormatted = '1';
  };

  const makeActionIcon = (name) => {
    const span = document.createElement('span');
    span.className = 'dealActionIcon';
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = iconSvg(name);
    return span;
  };

  const replaceButtonContent = (control, iconName, forcedLabel = '') => {
    if (!control || control.querySelector(':scope > .dealActionIcon')) return;
    const labelText = forcedLabel || control.textContent.replace(/^\s*[＋+✓♡♥]\s*/, '').trim();
    const label = document.createElement('span');
    label.className = 'dealActionLabel';
    label.textContent = labelText;
    control.replaceChildren(makeActionIcon(iconName), label);
  };

  const settleTools = (card) => {
    const slot = card.querySelector('.dealToolsSlot');
    const extra = card.querySelector('.slevaoExtraActions');
    if (slot && extra && extra.parentElement !== slot) slot.appendChild(extra);

    const tools = slot?.querySelector('.slevaoExtraActions') || extra;
    if (tools) {
      replaceButtonContent(tools.querySelector('[data-sf-add]'), 'add', 'Do seznamu');
      replaceButtonContent(tools.querySelector('[data-sf-detail]'), 'detail', 'Detail a ceny');
      replaceButtonContent(tools.querySelector('[data-sf-alert]'), 'bell', 'Hlídat cenu');
    }
  };

  const decorateCard = (card) => {
    if (!desktop.matches || !card) return;
    if (card.dataset.mobileProductCard === '1') {
      settleTools(card);
      const actions = card.querySelector('.dealActions');
      replaceButtonContent(actions?.querySelector('.compareButton'), 'compare');
      replaceButtonContent(actions?.querySelector('.storeButton'), 'store', 'Stránka obchodu');
      return;
    }

    const media = card.querySelector(':scope > .dealMedia');
    const body = card.querySelector(':scope > .dealBody');
    if (!media || !body) return;

    const top = document.createElement('div');
    top.className = 'dealTop';
    const info = document.createElement('div');
    info.className = 'dealInfo';
    card.insertBefore(top, media);
    top.append(media, info);

    const favorite = media.querySelector(':scope > .saveOffer');
    if (favorite) info.appendChild(favorite);

    ['.storeLine','h3','.productDetail','.priceRow','.unitPrice','.saving'].forEach((selector) => {
      const node = body.querySelector(`:scope > ${selector}`);
      if (node) info.appendChild(node);
    });

    const actions = body.querySelector(':scope > .dealActions');
    const storeButton = actions?.querySelector('.storeButton');
    if (storeButton) {
      storeButton.hidden = false;
      try {
        const slug = new URL(storeButton.href, location.href).pathname.split('/').pop()?.replace(/\.html$/i, '') || '';
        card.dataset.storeSlug = slug;
        card.style.setProperty('--deal-store-color', STORE_COLORS[slug] || '#087e75');
      } catch {}
    }

    const detail = info.querySelector('.productDetail');
    const unit = info.querySelector('.unitPrice');
    const parts = detail ? detail.textContent.split('·').map((part) => part.trim()).filter(Boolean) : [];
    const quantity = parts.find((part) => /\b\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|ks)\b/i.test(part)) || '';
    const brand = parts.find((part) => part !== quantity) || '';
    const storeLine = info.querySelector('.storeLine');
    if (brand && storeLine && !storeLine.querySelector('.dealBrandName')) {
      const brandNode = document.createElement('span');
      brandNode.className = 'dealBrandName';
      brandNode.textContent = brand;
      storeLine.appendChild(brandNode);
    }

    const chips = document.createElement('div');
    chips.className = 'dealChips';
    if (quantity) {
      const chip = document.createElement('span');
      const chipIcon = document.createElement('span');
      chipIcon.className = 'dealChipIcon';
      chipIcon.innerHTML = iconSvg('leaflet');
      const chipText = document.createElement('b');
      chipText.textContent = quantity;
      chip.append(chipIcon, chipText);
      chips.appendChild(chip);
    }
    if (unit?.textContent.trim()) {
      const chip = document.createElement('span');
      chip.textContent = unit.textContent.trim();
      chips.appendChild(chip);
    }
    if (chips.childElementCount) {
      const priceRow = info.querySelector('.priceRow');
      if (priceRow) info.insertBefore(chips, priceRow);
      else info.appendChild(chips);
    }
    if (detail) detail.hidden = true;
    if (unit) unit.hidden = true;

    const priceRow = info.querySelector('.priceRow');
    if (priceRow && !priceRow.querySelector('.dealPriceBadge')) {
      const badge = document.createElement('span');
      badge.className = 'dealPriceBadge';
      badge.innerHTML = `${iconSvg('tag')}<span>${info.querySelector('.saving') || media.querySelector('.discountBadge') ? 'Výhodná cena' : 'Akční cena'}</span>`;
      priceRow.appendChild(badge);
    }

    const utility = document.createElement('div');
    utility.className = 'dealUtilityPanel';
    const tools = document.createElement('div');
    tools.className = 'dealToolsSlot';
    const facts = document.createElement('div');
    facts.className = 'dealFacts';
    utility.append(tools, facts);
    if (actions) actions.after(utility);
    else body.prepend(utility);

    const validity = body.querySelector(':scope > .validity');
    const leaflet = body.querySelector(':scope > .leafletLocationButton');
    if (validity) {
      formatValidity(validity);
      facts.appendChild(validity);
    }
    if (leaflet) {
      formatLeaflet(leaflet);
      facts.appendChild(leaflet);
    }
    if (!facts.childElementCount) utility.classList.add('withoutFacts');

    const notice = document.createElement('div');
    notice.className = 'dealNotice';
    const noticeIcon = document.createElement('span');
    noticeIcon.className = 'dealNoticeIcon';
    noticeIcon.innerHTML = iconSvg('tag');
    const noticeCopy = document.createElement('span');
    const noticeTitle = document.createElement('strong');
    noticeTitle.textContent = 'Aktuální akce';
    const noticeText = document.createElement('small');
    noticeText.className = 'dealNoticeText';
    const canCompare = !actions?.querySelector('.compareButton')?.disabled;
    noticeText.textContent = leaflet
      ? `Výhodná cena v letáku. ${canCompare ? 'Porovnejte ji i s dalšími obchody.' : 'Další srovnatelná nabídka zatím není dostupná.'}`
      : `Aktuální akční nabídka. ${canCompare ? 'Porovnejte ji i s dalšími obchody.' : 'Další srovnatelná nabídka zatím není dostupná.'}`;
    noticeCopy.append(noticeTitle, noticeText);
    notice.append(noticeIcon, noticeCopy);

    const source = body.querySelector(':scope > .sourceLine');
    if (source) body.insertBefore(notice, source);
    else body.appendChild(notice);

    card.dataset.mobileProductCard = '1';
    replaceButtonContent(actions?.querySelector('.compareButton'), 'compare');
    replaceButtonContent(actions?.querySelector('.storeButton'), 'store', 'Stránka obchodu');
    settleTools(card);
  };

  let frame = 0;
  const refresh = () => {
    frame = 0;
    if (!desktop.matches) return;
    grid.querySelectorAll('.dealCard').forEach(decorateCard);
  };
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(refresh);
  };

  new MutationObserver(schedule).observe(grid, { childList:true, subtree:true });
  if (typeof desktop.addEventListener === 'function') desktop.addEventListener('change', schedule);
  else if (typeof desktop.addListener === 'function') desktop.addListener(schedule);
  schedule();
})();

(() => {
  'use strict';

  const STORAGE_KEY = 'slevao-deal-card-view';
  const grid = document.getElementById('dealGrid');
  const toolbar = document.querySelector('.dealsContent .toolbar');
  if (!grid || !toolbar || toolbar.querySelector('.dealViewControl')) return;

  const icon = (type) => {
    const paths = type === 'classic'
      ? '<rect x="3" y="4" width="8" height="7" rx="1.5"/><rect x="13" y="4" width="8" height="7" rx="1.5"/><rect x="3" y="13" width="8" height="7" rx="1.5"/><rect x="13" y="13" width="8" height="7" rx="1.5"/>'
      : '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h5M9 12h7M9 16h7"/>';
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;
  };

  const readView = () => {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      if (value === 'classic' || value === 'leaflet') return value;
    } catch {}
    return 'leaflet';
  };

  const control = document.createElement('div');
  control.className = 'dealViewControl';
  control.setAttribute('role', 'group');
  control.setAttribute('aria-label', 'Zobrazení nabídek');
  control.innerHTML = `
    <span class="dealViewLabel">Zobrazení:</span>
    <span class="dealViewSwitch">
      <button class="dealViewButton" type="button" data-card-view="classic" aria-pressed="false">${icon('classic')}<span>Klasické karty</span></button>
      <button class="dealViewButton" type="button" data-card-view="leaflet" aria-pressed="false">${icon('leaflet')}<span>Letákové karty</span></button>
    </span>
    <span class="dealViewHint">Přepněte mezi klasickým a letákovým zobrazením</span>
  `;

  const sort = toolbar.querySelector('#sortSelect');
  if (sort) toolbar.insertBefore(control, sort);
  else toolbar.appendChild(control);

  const buttons = [...control.querySelectorAll('[data-card-view]')];

  const applyView = (view, persist = true) => {
    const next = view === 'classic' ? 'classic' : 'leaflet';
    grid.dataset.cardView = next;
    buttons.forEach((button) => {
      const active = button.dataset.cardView === next;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
    }
  };

  control.addEventListener('click', (event) => {
    const button = event.target.closest('[data-card-view]');
    if (!button) return;
    applyView(button.dataset.cardView);
  });

  applyView(readView(), false);
})();
