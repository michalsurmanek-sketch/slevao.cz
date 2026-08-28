(() => {
  'use strict';

  const MIXED_TEXT = 'Pozor: 7denní odhad může kombinovat ceny z různých dnů. Pro nákup v jednom dni použij přesný plán „Kde nakoupit“.';
  const INTRO_TEXT = 'Orientační 7denní odhad podle nalezených cen. Pokud část akcí začíná později, nemusí všechny ceny platit ve stejný den.';
  const HISTORY_TEXT = 'Uložená částka je plánovaný odhad nákupu, ne skutečná účtenka. Opakovaný nákup se znovu ocení podle aktuálních nabídek.';
  let installed = false;

  function hasMixedTiming(text) {
    const normalized = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return normalized.includes('pouziva akci zacinajici');
  }

  function sync() {
    const insights = document.getElementById('shoppingInsights');
    const hint = document.getElementById('shoppingInsightsHint');
    if (!insights || !hint) return false;

    const intro = insights.querySelector('.sfInsightsHead p');
    if (intro && intro.textContent !== INTRO_TEXT) intro.textContent = INTRO_TEXT;

    const totalLabel = document.getElementById('insightTotal')?.closest('.sfInsightStat')?.querySelector('small');
    if (totalLabel && totalLabel.textContent !== '7denní odhad') totalLabel.textContent = '7denní odhad';

    let warning = document.getElementById('shoppingInsightsTimingWarning');
    if (!warning) {
      warning = document.createElement('p');
      warning.id = 'shoppingInsightsTimingWarning';
      warning.className = 'sfInsightsHint';
      const actions = insights.querySelector('.sfInsightActions');
      if (actions) actions.insertAdjacentElement('beforebegin', warning);
      else insights.querySelector('.sfInsightsCard')?.appendChild(warning);
    }

    const mixed = hasMixedTiming(hint.textContent);
    warning.hidden = !mixed;
    if (warning.textContent !== MIXED_TEXT) warning.textContent = MIXED_TEXT;

    const complete = document.getElementById('completeShopping');
    if (complete) {
      const label = mixed ? 'Dokončit nákup a uložit orientační odhad' : 'Dokončit nákup a uložit historii';
      if (complete.textContent !== label) complete.textContent = label;
    }

    const historyIntro = document.querySelector('#shoppingHistorySection .sfInsightsHead p');
    if (historyIntro && historyIntro.textContent !== HISTORY_TEXT) historyIntro.textContent = HISTORY_TEXT;
    return true;
  }

  function install() {
    if (installed) return true;
    if (!sync()) return false;
    installed = true;
    const hint = document.getElementById('shoppingInsightsHint');
    if (hint) new MutationObserver(() => sync()).observe(hint, { childList:true, subtree:true, characterData:true });
    return true;
  }

  if (!install()) {
    const observer = new MutationObserver(() => {
      if (!document.getElementById('shoppingInsights')) return;
      if (install()) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList:true, subtree:true });
  }

  window.SlevaoShoppingInsightsValidity = { hasMixedTiming };
})();
