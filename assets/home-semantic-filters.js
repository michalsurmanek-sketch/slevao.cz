(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const CONFIG = {
    pivo: { label:'Pivo', title:'Pivo v akci', info:'Zobrazujeme jen pivo a pivní nápoje podle zvoleného filtru', icon:'🍺', types:[['pivo','Vše'],['lezak','Ležáky'],['vycepni pivo','Výčepní'],['nealkoholicke pivo','Nealkoholické'],['radler','Radlery']], forms:[['pivo','Všechna','♧'],['pivo plech','Plechovky','▣'],['pivo lahev','Lahve','◒'],['multipack pivo','Multipacky','▱']] },
    mleko: { label:'Mléko', title:'Mléko v akci', info:'Zobrazujeme mléko a alternativní nápoje podle zvoleného filtru', icon:'🥛', types:[['mleko','Vše'],['plnotucne mleko','Plnotučné'],['polotucne mleko','Polotučné'],['bezlaktozove mleko','Bez laktózy'],['rostlinny napoj','Rostlinné']], forms:[['mleko','Všechna','♧'],['cerstve mleko','Čerstvé','◒'],['trvanlive mleko','Trvanlivé','▱'],['kondenzovane mleko','Kondenzované','◉']] },
    pecivo: { label:'Pečivo', title:'Pečivo v akci', info:'Zobrazujeme jen pečivo a pekařské výrobky podle zvoleného filtru', icon:'🥖', types:[['pecivo','Vše'],['chleb','Chléb'],['rohliky','Rohlíky'],['housky','Housky'],['bagety','Bagety'],['sladke pecivo','Sladké']], forms:[['pecivo','Všechno','♧'],['cerstve pecivo','Čerstvé','◒'],['balene pecivo','Balené','▱'],['bezlepkove pecivo','Bezlepkové','◎']] },
    vejce: { label:'Vejce', title:'Vejce v akci', info:'Zobrazujeme jen skutečná vejce podle zvoleného filtru', icon:'🥚', types:[['vejce','Vše'],['slepici vejce','Slepičí'],['krepelci vejce','Křepelčí'],['vejce m','Velikost M'],['vejce l','Velikost L']], forms:[['vejce','Všechna','♧'],['vejce volny vybeh','Volný výběh','◒'],['vejce podestylka','Podestýlka','▱'],['bio vejce','Bio','◎']] },
    maslo: { label:'Máslo', title:'Máslo v akci', info:'Zobrazujeme jen skutečné máslo podle zvoleného filtru', icon:'🧈', types:[['maslo','Vše'],['klasicke maslo','Klasické'],['prepustene maslo','Přepuštěné'],['solene maslo','Solené'],['ochucene maslo','Ochucené']], forms:[['maslo','Všechna','♧'],['maslo kostka','Kostka','◒'],['maslo kelimek','Kelímek','▱']] },
    syr: { label:'Sýr', title:'Sýry v akci', info:'Zobrazujeme jen sýry a sýrové výrobky podle zvoleného filtru', icon:'🧀', types:[['syr','Vše'],['eidam','Eidam'],['gouda','Gouda'],['hermelin','Hermelín'],['mozzarella','Mozzarella'],['taveny syr','Tavené']], forms:[['syr','Všechny','♧'],['tvrdy syr','Tvrdé','◒'],['mekky syr','Měkké','▱'],['platkovy syr','Plátkové','▤'],['strouhany syr','Strouhané','◎']] },
    maso: { label:'Maso', title:'Maso v akci', info:'Zobrazujeme jen maso, ryby a masné výrobky podle zvoleného filtru', icon:'🥩', types:[['maso','Vše'],['veprove','Vepřové'],['kureci','Kuřecí'],['hovezi','Hovězí'],['kruti','Krůtí'],['mlete','Mleté'],['ryby','Ryby']], forms:[['cerstve maso','Čerstvé','♧'],['mrazene maso','Mražené','❄'],['uzeniny','Uzeniny','◒'],['marinovane maso','Marinované','♨']] },
    ovoce: { label:'Ovoce', title:'Ovoce v akci', info:'Zobrazujeme čerstvé, mražené a sušené ovoce podle zvoleného filtru', icon:'🍎', types:[['ovoce','Vše'],['jablka','Jablka'],['banany','Banány'],['citrusy','Citrusy'],['bobulove','Bobulové'],['exoticke','Exotické']], forms:[['ovoce','Čerstvé','♧'],['mrazene ovoce','Mražené','❄'],['susene ovoce','Sušené','◒']] },
    zelenina: { label:'Zelenina', title:'Zelenina v akci', info:'Zobrazujeme zeleninu a zeleninové výrobky podle zvoleného filtru', icon:'🥕', types:[['zelenina','Vše'],['brambory','Brambory'],['rajcata','Rajčata'],['papriky','Papriky'],['cibule','Cibule'],['korenova zelenina','Kořenová'],['listova zelenina','Listová']], forms:[['zelenina','Čerstvá','♧'],['mrazena zelenina','Mražená','❄'],['sterilovana zelenina','Sterilovaná','◒'],['zeleninove vyrobky','Výrobky','▱']] }
  };
  const ALIASES = new Map();
  Object.entries(CONFIG).forEach(([base, config]) => {
    ALIASES.set(base, base);
    [...config.types, ...config.forms].forEach(([query]) => ALIASES.set(fold(query), base));
  });

  let semanticCountRequestVersion = 0;
  let semanticCountFingerprint = '';
  let semanticCountCache = new Map();
  let semanticCountTimer = 0;

  const search = () => document.getElementById('sideSearch');
  const currentQuery = () => fold(search()?.value || document.getElementById('q')?.value || '');
  const selectQuery = (query) => {
    const input = search();
    if (!input) return;
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles:true }));
    const top = document.getElementById('q');
    if (top) top.value = query;
  };

  function countFromToolbar() {
    const text = document.getElementById('resultText')?.textContent || '';
    if (/žádná odpovídající nabídka/i.test(text)) return 0;
    const match = text.match(/z\s+(\d[\d\s]*)\s+nab/i) || text.match(/(\d[\d\s]*)\s+nab/i);
    return match ? Number(match[1].replace(/\s/g,'')) : null;
  }

  function countLabel(count) {
    if (!Number.isFinite(count)) return '— nabídek';
    if (count === 1) return '1 nabídka';
    if (count >= 2 && count <= 4) return `${count} nabídky`;
    return `${count} nabídek`;
  }

  function nullableSelect(id) {
    const value = document.getElementById(id)?.value || '';
    return !value || value === 'all' ? null : value;
  }

  function nullableNumber(id) {
    const value = document.getElementById(id)?.value ?? '';
    if (value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0,number) : null;
  }

  function semanticCountContext(base, config) {
    const queries = [...new Set([...config.types, ...config.forms].map(([query]) => query))];
    const payload = {
      p_queries:queries,
      p_include_upcoming:true,
      p_store_slug:nullableSelect('storeSelect'),
      p_min_price:nullableNumber('minPrice'),
      p_max_price:nullableNumber('maxPrice'),
      p_only_images:Boolean(document.getElementById('onlyImages')?.checked),
      p_filter_group:nullableSelect('categorySelect'),
      p_region_code:nullableSelect('regionSelect'),
      p_city_name:nullableSelect('citySelect')
    };
    return { payload, fingerprint:JSON.stringify([base,payload]) };
  }

  function semanticLabelMap(config) {
    return new Map([...config.types, ...config.forms].map(([query,label]) => [query,label]));
  }

  function clearSemanticCountUi() {
    document.querySelectorAll('#slSemanticPanel [data-semantic-query]').forEach((button) => {
      button.querySelector('.slSemanticCount')?.remove();
      button.disabled = false;
      button.classList.remove('is-empty');
      button.removeAttribute('title');
    });
  }

  function applySemanticCounts(base, config, counts) {
    const panel = document.getElementById('slSemanticPanel');
    if (!panel || panel.dataset.semanticBase !== base) return;
    const labels = semanticLabelMap(config);
    panel.querySelectorAll('[data-semantic-query]').forEach((button) => {
      const query = button.dataset.semanticQuery || '';
      const count = counts.get(query);
      if (!Number.isFinite(count)) return;
      let badge = button.querySelector('.slSemanticCount');
      if (!badge) {
        badge = document.createElement('small');
        badge.className = 'slSemanticCount';
        badge.setAttribute('aria-hidden','true');
        button.appendChild(badge);
      }
      badge.textContent = Number(count).toLocaleString('cs-CZ');
      const active = button.classList.contains('active');
      const empty = count === 0;
      button.disabled = empty && !active;
      button.classList.toggle('is-empty', empty);
      button.setAttribute('aria-label', `${labels.get(query) || query}: ${countLabel(count)}`);
      if (empty && !active) button.title = 'Momentálně bez odpovídajících nabídek';
      else button.removeAttribute('title');
    });
  }

  function resetSemanticCountState() {
    semanticCountRequestVersion += 1;
    window.clearTimeout(semanticCountTimer);
    semanticCountFingerprint = '';
    semanticCountCache = new Map();
    clearSemanticCountUi();
  }

  function scheduleSemanticCounts(base, config) {
    if (document.getElementById('savedButton')?.getAttribute('aria-pressed') === 'true') {
      resetSemanticCountState();
      return;
    }

    const { payload, fingerprint } = semanticCountContext(base, config);
    if (fingerprint === semanticCountFingerprint && semanticCountCache.size) {
      applySemanticCounts(base, config, semanticCountCache);
      return;
    }

    semanticCountFingerprint = fingerprint;
    semanticCountCache = new Map();
    const version = ++semanticCountRequestVersion;
    window.clearTimeout(semanticCountTimer);
    semanticCountTimer = window.setTimeout(async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_public_semantic_filter_counts`, {
          method:'POST',
          headers:{ apikey:SUPABASE_KEY, 'content-type':'application/json', accept:'application/json' },
          body:JSON.stringify(payload),
          cache:'no-store',
          signal:controller.signal
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const rows = await response.json();
        if (version !== semanticCountRequestVersion) return;
        const current = semanticCountContext(base, config);
        if (current.fingerprint !== fingerprint) return;
        const panel = document.getElementById('slSemanticPanel');
        if (!panel || panel.dataset.semanticBase !== base) return;
        semanticCountCache = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.query || ''), Number(row.total_count || 0)]));
        applySemanticCounts(base, config, semanticCountCache);
      } catch (error) {
        if (error?.name !== 'AbortError') console.warn('Počty podfiltrů se nepodařilo načíst:', error);
      } finally {
        window.clearTimeout(timer);
      }
    }, 70);
  }

  function ensureFilterUxStyles() {
    if (document.getElementById('slFilterUxStyles')) return;
    const style = document.createElement('style');
    style.id = 'slFilterUxStyles';
    style.textContent = `
      .slFilterBackdrop{display:none}
      .priceRangeHint{margin:7px 0 0;color:#b42318;font-size:11px;font-weight:750;line-height:1.35}
      .priceRangeHint[hidden]{display:none!important}
      .pricePresets button.active{border-color:#159e94;background:#e7faf7;color:#08776f;box-shadow:0 0 0 2px rgba(21,158,148,.08)}
      .filterPanel input[aria-invalid="true"]{border-color:#d92d20!important;box-shadow:0 0 0 3px rgba(217,45,32,.08)!important}
      .dealsSection.slSavedMode .quickTabs{display:none!important}
      .slSemanticCount{display:inline-grid;place-items:center;min-width:22px;height:19px;margin-left:3px;padding:0 5px;border-radius:999px;background:#eef4f3;color:#657371;font-size:9.5px;font-weight:850;line-height:1}
      .slSemanticRow button.active .slSemanticCount{background:rgba(255,255,255,.2);color:inherit}
      .slSemanticForms button.active .slSemanticCount{background:#d9f3ef;color:#08776f}
      .slSemanticRow button:disabled{cursor:not-allowed;opacity:.48;transform:none!important;box-shadow:none!important}
      .slSemanticRow button:disabled .slSemanticCount{background:#f1f3f3;color:#8c9695}
      @media(max-width:800px){
        body.slFilterOpen{overflow:hidden!important}
        .slFilterBackdrop{position:fixed;inset:0;z-index:109;background:rgba(13,30,28,.42);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
        .slFilterBackdrop:not([hidden]){display:block}
        #filterPanel{box-shadow:0 -18px 60px rgba(13,30,28,.22)}
      }
    `;
    document.head.appendChild(style);
  }

  function initFilterUx() {
    const filterPanel = document.getElementById('filterPanel');
    const filterToggle = document.getElementById('filterToggle');
    const filterClose = document.getElementById('filterClose');
    if (!filterPanel || !filterToggle) return;

    ensureFilterUxStyles();
    filterToggle.setAttribute('aria-controls','filterPanel');
    filterClose?.setAttribute('aria-label','Zavřít filtry');

    let backdrop = document.getElementById('slFilterBackdrop');
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.id = 'slFilterBackdrop';
      backdrop.className = 'slFilterBackdrop';
      backdrop.hidden = true;
      backdrop.setAttribute('aria-hidden','true');
      document.body.appendChild(backdrop);
    }

    const mobile = window.matchMedia('(max-width:800px)');
    const syncSheet = () => {
      const isMobile = mobile.matches;
      const open = isMobile && filterPanel.classList.contains('open');
      filterToggle.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('slFilterOpen', open);
      backdrop.hidden = !open;

      if (isMobile) {
        filterPanel.setAttribute('aria-hidden', String(!open));
        if ('inert' in filterPanel) filterPanel.inert = !open;
      } else {
        filterPanel.removeAttribute('aria-hidden');
        if ('inert' in filterPanel) filterPanel.inert = false;
        backdrop.hidden = true;
        document.body.classList.remove('slFilterOpen');
      }
    };

    const closeSheet = ({ restoreFocus = true } = {}) => {
      filterPanel.classList.remove('open');
      syncSheet();
      if (restoreFocus && mobile.matches) filterToggle.focus({ preventScroll:true });
    };

    new MutationObserver(syncSheet).observe(filterPanel, { attributes:true, attributeFilter:['class'] });
    filterToggle.addEventListener('click', () => requestAnimationFrame(syncSheet));
    filterClose?.addEventListener('click', () => requestAnimationFrame(syncSheet));
    backdrop.addEventListener('click', () => closeSheet());
    document.getElementById('resetFilters')?.addEventListener('click', () => {
      if (mobile.matches) requestAnimationFrame(() => closeSheet());
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && mobile.matches && filterPanel.classList.contains('open')) {
        event.preventDefault();
        closeSheet();
      }
    });
    mobile.addEventListener?.('change', syncSheet);
    syncSheet();

    const minPrice = document.getElementById('minPrice');
    const maxPrice = document.getElementById('maxPrice');
    const priceFields = document.querySelector('.priceFields');
    const priceButtons = [...document.querySelectorAll('.pricePresets [data-max-price]')];
    if (!minPrice || !maxPrice || !priceFields) return;

    let hint = document.getElementById('priceRangeHint');
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'priceRangeHint';
      hint.className = 'priceRangeHint';
      hint.textContent = 'Cena od je vyšší než cena do.';
      hint.hidden = true;
      hint.setAttribute('role','status');
      priceFields.insertAdjacentElement('afterend', hint);
    }

    const syncPriceUi = () => {
      const min = minPrice.value === '' ? null : Number(minPrice.value);
      const max = maxPrice.value === '' ? null : Number(maxPrice.value);
      const invalid = Number.isFinite(min) && Number.isFinite(max) && min > max;
      minPrice.setAttribute('aria-invalid', String(invalid));
      maxPrice.setAttribute('aria-invalid', String(invalid));
      hint.hidden = !invalid;

      priceButtons.forEach((button) => {
        const active = !invalid && max !== null && Number(button.dataset.maxPrice) === max;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    };

    minPrice.addEventListener('input', syncPriceUi);
    maxPrice.addEventListener('input', syncPriceUi);
    priceButtons.forEach((button) => button.addEventListener('click', () => requestAnimationFrame(syncPriceUi)));
    document.getElementById('resetFilters')?.addEventListener('click', () => requestAnimationFrame(syncPriceUi));
    syncPriceUi();
  }

  function initSavedModeUi() {
    const button = document.getElementById('savedButton');
    const deals = document.getElementById('dealsSection');
    if (!button || !deals) return;
    const sync = () => {
      const saved = button.getAttribute('aria-pressed') === 'true';
      deals.classList.toggle('slSavedMode', saved);
      if (saved) resetSemanticCountState();
    };
    new MutationObserver(sync).observe(button, { attributes:true, attributeFilter:['aria-pressed','class'] });
    sync();
  }

  function initQuickTabAria() {
    const tabs = document.getElementById('quickTabs');
    if (!tabs) return;
    const sync = () => {
      tabs.querySelectorAll('[data-mode]').forEach((button) => {
        const active = button.classList.contains('active');
        if (!button.id) button.id = `quickTab-${button.dataset.mode}`;
        button.setAttribute('aria-controls', 'dealGrid');
        button.setAttribute('aria-selected', String(active));
        button.tabIndex = active ? 0 : -1;
        if (active) document.getElementById('dealGrid')?.setAttribute('aria-labelledby', button.id);
      });
    };
    new MutationObserver(sync).observe(tabs, { subtree:true, attributes:true, attributeFilter:['class'] });
    tabs.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      const buttons = [...tabs.querySelectorAll('[role="tab"][data-mode]')];
      if (!buttons.length) return;
      const current = Math.max(0, buttons.indexOf(document.activeElement));
      let next = current;
      if (event.key === 'ArrowLeft') next = (current - 1 + buttons.length) % buttons.length;
      if (event.key === 'ArrowRight') next = (current + 1) % buttons.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = buttons.length - 1;
      event.preventDefault();
      buttons[next].focus();
      buttons[next].click();
    });
    sync();
  }

  function alignInitialRecommendedFacets() {
    if (new URLSearchParams(location.search).get('q')?.trim()) return;
    let userInteracted = false;
    let aligned = false;
    const markInteraction = (event) => {
      if (event.isTrusted && event.target.closest?.('#quickTabs,#filterPanel,#categoryChips,#storeGrid,#savedButton')) userInteracted = true;
    };
    document.addEventListener('click', markInteraction, true);
    document.addEventListener('input', markInteraction, true);
    document.addEventListener('change', markInteraction, true);

    const result = document.getElementById('resultText');
    if (!result) return;
    const tryAlign = () => {
      if (aligned || userInteracted) return;
      const ready = /zobrazeno|žádná odpovídající nabídka/i.test(result.textContent || '');
      if (!ready) return;
      const untouched = document.getElementById('storeSelect')?.value === 'all'
        && document.getElementById('categorySelect')?.value === 'all'
        && !document.getElementById('sideSearch')?.value.trim()
        && !document.getElementById('minPrice')?.value
        && !document.getElementById('maxPrice')?.value
        && document.getElementById('onlyImages')?.checked === false
        && document.getElementById('savedButton')?.getAttribute('aria-pressed') !== 'true'
        && document.querySelector('#quickTabs [data-mode="recommended"]')?.classList.contains('active');
      if (!untouched) return;
      aligned = true;
      window.__slevaoInitialFacetAligned = true;
      document.getElementById('storeSelect')?.dispatchEvent(new Event('change', { bubbles:true }));
    };
    new MutationObserver(() => requestAnimationFrame(tryAlign)).observe(result, { childList:true, subtree:true, characterData:true });
    tryAlign();
  }

  function ensurePanel() {
    const quickTabs = document.getElementById('quickTabs');
    if (!quickTabs) return null;
    let panel = document.getElementById('slSemanticPanel');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'slSemanticPanel';
      panel.className = 'slSemanticPanel';
      panel.setAttribute('aria-label','Podrobné filtrování kategorie');
      quickTabs.parentNode.insertBefore(panel, quickTabs);
      panel.addEventListener('click', (event) => {
        const button = event.target.closest('[data-semantic-query]');
        if (button && !button.disabled) selectQuery(button.dataset.semanticQuery || '');
      });
    }
    return panel;
  }

  function render() {
    const query = currentQuery();
    const base = ALIASES.get(query);
    const deals = document.getElementById('dealsSection');
    const panel = ensurePanel();
    if (!deals || !panel) return;
    if (!base) {
      deals.classList.remove('slSemanticActive');
      panel.dataset.semanticBase = '';
      panel.hidden = true;
      resetSemanticCountState();
      document.dispatchEvent(new CustomEvent('slevao:semantic-filter', { detail:{ base:'' } }));
      return;
    }
    const config = CONFIG[base];
    const count = countFromToolbar();
    const selected = [...config.types, ...config.forms].find(([value]) => query === fold(value));
    const selectedLabel = selected?.[1] || 'Vše';
    deals.classList.add('slSemanticActive');
    panel.dataset.semanticBase = base;
    panel.hidden = false;
    const title = document.getElementById('dealsTitle');
    const subtitle = document.getElementById('dealsSubtitle');
    if (title && title.textContent !== config.title) title.textContent = config.title;
    if (subtitle && subtitle.textContent !== 'Vyber druh nebo formu. Výsledky řadíme podle ceny, úspory a platnosti.') subtitle.textContent = 'Vyber druh nebo formu. Výsledky řadíme podle ceny, úspory a platnosti.';
    panel.innerHTML = `
      <div class="slSemanticMeta" aria-live="polite"><span>${config.icon} ${config.label}</span><i></i><span>${selectedLabel}</span><i></i><strong>${countLabel(count)}</strong></div>
      <div class="slSemanticRow slSemanticTypes" role="group" aria-label="Druh ${config.label.toLowerCase()}">
        ${config.types.map(([value,label]) => `<button type="button" data-semantic-query="${value}" aria-pressed="${query === fold(value)}" class="${query === fold(value) ? 'active' : ''}">${label}</button>`).join('')}
      </div>
      <div class="slSemanticBottom">
        <div class="slSemanticRow slSemanticForms" role="group" aria-label="Forma produktu">
          ${config.forms.map(([value,label,icon]) => `<button type="button" data-semantic-query="${value}" aria-pressed="${query === fold(value)}" class="${query === fold(value) ? 'active' : ''}"><span aria-hidden="true">${icon}</span>${label}</button>`).join('')}
        </div>
        <div class="slSemanticInfo"><span aria-hidden="true">♧</span>${config.info}</div>
      </div>`;
    scheduleSemanticCounts(base, config);
    document.dispatchEvent(new CustomEvent('slevao:semantic-filter', { detail:{ base } }));
  }

  function init() {
    ensurePanel();
    initFilterUx();
    initSavedModeUi();
    initQuickTabAria();
    alignInitialRecommendedFacets();
    search()?.addEventListener('input', () => requestAnimationFrame(render));
    document.getElementById('q')?.addEventListener('change', () => requestAnimationFrame(render));
    const observed = document.getElementById('resultText');
    if (observed) new MutationObserver(() => requestAnimationFrame(render)).observe(observed, { childList:true, subtree:true, characterData:true });
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
