(() => {
  const mobileUxVersion = '20260809-8';
  if (!document.querySelector(`link[data-mobile-ux-version="${mobileUxVersion}"]`)) {
    const mobileUxLink = document.createElement('link');
    mobileUxLink.rel = 'stylesheet';
    mobileUxLink.href = `assets/mobile-ux.css?v=${mobileUxVersion}`;
    mobileUxLink.dataset.mobileUxVersion = mobileUxVersion;
    document.head.appendChild(mobileUxLink);
  }

  if (!document.querySelector('link[href*="top-tip-button.css"]')) {
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = 'assets/top-tip-button.css?v=20260808-4';
    styleLink.dataset.topTipStyle = 'true';
    document.head.appendChild(styleLink);
  }

  const savedButton = document.getElementById('savedButton');
  if (savedButton && !document.getElementById('topbarTipButton')) {
    const tipButton = document.createElement('a');
    tipButton.id = 'topbarTipButton';
    tipButton.className = 'topbarTipButton';
    tipButton.href = '#dealsSection';
    tipButton.setAttribute('aria-label', 'Tip dne');
    tipButton.title = 'Tip dne';
    tipButton.innerHTML = '<img src="assets/top-tip-icon.svg?v=20260808-1" alt="" aria-hidden="true">';
    savedButton.after(tipButton);
  }

  const scrollWithHeaderOffset = (target, hash = '#dealsSection', gap = 14) => {
    if (!target) return;
    const topbar = document.querySelector('.topbar');
    const headerHeight = topbar ? topbar.getBoundingClientRect().height : 0;
    const targetTop = window.scrollY + target.getBoundingClientRect().top - headerHeight - gap;

    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth'
    });

    if (hash && window.location.hash !== hash) {
      history.replaceState(null, '', hash);
    }
  };

  const tipButton = document.getElementById('topbarTipButton');
  if (tipButton) {
    tipButton.setAttribute('aria-label', 'Tip dne');
    tipButton.title = 'Tip dne';

    tipButton.addEventListener('click', (event) => {
      event.preventDefault();
      scrollWithHeaderOffset(document.getElementById('quickTabs'));
    });
  }

  const fold = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  const scrollToSearchResults = () => {
    const activeFilters = document.getElementById('activeFilters');
    const target = activeFilters && !activeFilters.hidden && activeFilters.getClientRects().length
      ? activeFilters
      : (document.querySelector('#dealsSection .dealsLayout') || document.getElementById('dealsSection'));

    scrollWithHeaderOffset(target, '#dealsSection');
  };

  const scheduleSearchResultScroll = () => {
    window.setTimeout(() => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(scrollToSearchResults));
    }, 90);
  };

  document.addEventListener('click', (event) => {
    const searchButton = event.target.closest('#searchButton');
    const suggestionBox = event.target.closest('#searchSuggestions');
    if (!searchButton && !suggestionBox) return;

    const query = document.getElementById('q')?.value?.trim();
    if (!query && searchButton) return;
    scheduleSearchResultScroll();
  });

  document.getElementById('q')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !event.currentTarget.value.trim()) return;
    scheduleSearchResultScroll();
  });

  document.addEventListener('click', (event) => {
    const control = event.target.closest('a,button');
    if (!control || control.id === 'topbarTipButton' || control.closest('.sqFoodDock')) return;

    const href = control.getAttribute('href') || '';

    if (href === '#categoriesSection' || href.endsWith('#categoriesSection')) {
      event.preventDefault();
      window.requestAnimationFrame(() => {
        scrollWithHeaderOffset(document.getElementById('categoriesSection'), '#categoriesSection', 8);
      });
      return;
    }

    if (control.closest('.footer') && (href === '#leafletsSection' || href.endsWith('#leafletsSection'))) {
      event.preventDefault();
      document.body.classList.add('showOriginalLeaflets');
      window.requestAnimationFrame(() => {
        scrollWithHeaderOffset(
          document.querySelector('#leafletsSection .sectionHead') || document.getElementById('leafletsSection'),
          '#leafletsSection'
        );
      });
      return;
    }

    if (control.closest('.footer') && (href === '#storesSection' || href.endsWith('#storesSection'))) {
      event.preventDefault();
      document.body.classList.add('showOriginalStores');

      const expandAndScroll = () => {
        const toggle = document.getElementById('showAllStores');
        if (toggle && fold(toggle.textContent) !== 'zobrazit mene') {
          toggle.click();
        }

        window.setTimeout(() => {
          scrollWithHeaderOffset(
            document.querySelector('#storesSection .sectionHead') || document.getElementById('storesSection'),
            '#storesSection'
          );
        }, 90);
      };

      window.requestAnimationFrame(() => window.requestAnimationFrame(expandAndScroll));
      return;
    }

    const text = fold(`${control.textContent || ''} ${control.getAttribute('aria-label') || ''} ${control.getAttribute('title') || ''}`);
    const isCurrentDeals = text.includes('aktualni slev') || text.includes('aktualni nabid');
    if (!isCurrentDeals) return;

    if (control.tagName === 'A' && href !== '#dealsSection' && !href.endsWith('#dealsSection')) return;

    event.preventDefault();
    scrollWithHeaderOffset(document.querySelector('#dealsSection .dealsHeading') || document.getElementById('dealsSection'));
  });

  const mobileViewport = window.matchMedia('(max-width: 800px)');
  const statusPill = document.getElementById('statusPill');

  if (statusPill) {
    let canonicalStatus = statusPill.textContent.trim();
    let renderedStatus = canonicalStatus;

    const displayStatus = (value) => {
      const text = String(value || '').trim();
      if (text === '✓ Aktualizováno dnes') return 'Aktualizováno dnes';
      if (mobileViewport.matches && text === 'Obnovuji aktuální data…') return 'Obnovuji';
      if (mobileViewport.matches && text.startsWith('✓ ')) return text.slice(2);
      return text;
    };

    const syncStatus = () => {
      const current = statusPill.textContent.trim();
      if (current !== renderedStatus) canonicalStatus = current;
      const next = displayStatus(canonicalStatus);
      renderedStatus = next;
      if (current !== next) statusPill.textContent = next;
    };

    new MutationObserver(syncStatus).observe(statusPill, {
      childList: true,
      characterData: true,
      subtree: true
    });

    if (typeof mobileViewport.addEventListener === 'function') {
      mobileViewport.addEventListener('change', syncStatus);
    } else if (typeof mobileViewport.addListener === 'function') {
      mobileViewport.addListener(syncStatus);
    }

    syncStatus();
  }

  const STORE_COLORS = {
    hruska:'#c91624', penny:'#d71920', albert:'#008547', billa:'#e30613', tesco:'#00539f',
    lidl:'#0050aa', kaufland:'#e10915', globus:'#d71920', coop:'#7a4a2f', makro:'#003b7a',
    rohlik:'#6d2aa6', kosik:'#6b2d91', alza:'#76b82a', datart:'#0053a0', dm:'#00509d', rossmann:'#e30613'
  };
  let productCardFrame = 0;

  const iconSvg = (name) => {
    const paths = {
      calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
      leaflet:'<path d="M5 3h11l3 3v15H5z"/><path d="M16 3v4h4M8 11h8M8 15h8"/>',
      tag:'<path d="M20 13 11 22 2 13V3h10z"/><circle cx="7" cy="8" r="1.5"/>'
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

  const settleProductCardTools = (card) => {
    if (!mobileViewport.matches || !card?.dataset.mobileProductCard) return;
    const slot = card.querySelector('.dealToolsSlot');
    const extra = card.querySelector('.slevaoExtraActions');
    if (slot && extra && extra.parentElement !== slot) slot.appendChild(extra);
  };

  const decorateProductCard = (card) => {
    if (!mobileViewport.matches || !card) return;
    if (card.dataset.mobileProductCard === '1') {
      settleProductCardTools(card);
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

    const storeButton = body.querySelector(':scope > .dealActions .storeButton');
    if (storeButton) {
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

    const actions = body.querySelector(':scope > .dealActions');
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
    settleProductCardTools(card);
  };

  const refreshProductCards = () => {
    productCardFrame = 0;
    if (!mobileViewport.matches) return;
    document.querySelectorAll('#dealGrid .dealCard').forEach(decorateProductCard);
  };

  const scheduleProductCardRefresh = () => {
    if (productCardFrame) return;
    productCardFrame = window.requestAnimationFrame(refreshProductCards);
  };

  const dealGrid = document.getElementById('dealGrid');
  if (dealGrid) {
    new MutationObserver(scheduleProductCardRefresh).observe(dealGrid, { childList:true, subtree:true });
    scheduleProductCardRefresh();
  }

  const navigation = document.querySelector('.mobileNav');
  if (!navigation) return;

  const links = [...navigation.querySelectorAll('a[href^="#"]')];
  const sections = links
    .map((link) => {
      const id = link.getAttribute('href');
      const section = id === '#top' ? document.querySelector('.hero') : (id ? document.querySelector(id) : null);
      return section ? { link, section } : null;
    })
    .filter(Boolean);

  const setActive = (activeLink) => {
    links.forEach((link) => {
      if (link === activeLink) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  };

  links.forEach((link) => {
    link.addEventListener('click', () => setActive(link));
  });

  if (!('IntersectionObserver' in window) || sections.length === 0) {
    setActive(links[0]);
    return;
  }

  const visible = new Map();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      visible.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
    });

    const current = sections
      .filter(({ section }) => (visible.get(section) || 0) > 0)
      .sort((a, b) => (visible.get(b.section) || 0) - (visible.get(a.section) || 0))[0];

    if (current) setActive(current.link);
  }, {
    rootMargin: '-18% 0px -62% 0px',
    threshold: [0.01, 0.2, 0.5]
  });

  sections.forEach(({ section }) => observer.observe(section));
  setActive(links.find((link) => link.getAttribute('href') === window.location.hash) || links[0]);
})();