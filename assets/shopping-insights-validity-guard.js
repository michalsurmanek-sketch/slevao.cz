(() => {
  'use strict';

  const MIXED_TEXT = 'Pozor: 7denní odhad může kombinovat ceny z různých dnů. Pro nákup v jednom dni použij přesný plán „Kde nakoupit“.';
  const INTRO_TEXT = 'Orientační 7denní odhad podle nalezených cen. Pokud část akcí začíná později, nemusí všechny ceny platit ve stejný den.';
  const HISTORY_TEXT = 'Uložená částka je plánovaný odhad nákupu, ne skutečná účtenka. Opakovaný nákup se znovu ocení podle aktuálních nabídek.';
  const RETRY_DELAYS = [4000, 10000, 20000];
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const sharedMode = Boolean(query.get('share') || hash.get('share'));
  let installed = false;
  let retryTimer = 0;
  let retryAttempts = 0;
  let lastErrorText = '';

  function normalizeText(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  function hasMixedTiming(text) {
    return normalizeText(text).includes('pouziva akci zacinajici');
  }

  function isSuccessHint(text) {
    const normalized = normalizeText(text);
    if (!normalized.trim()) return false;
    return [
      'z vlastnich polozek nema spolehlive nalezenou cenu',
      'se nepodarilo najit platnou ani brzy zacinajici cenu',
      'pouziva akci zacinajici',
      'vsechny polozky maji nalezenou cenu',
      'pridej polozky do seznamu a odhad se vypocita automaticky'
    ].some((needle) => normalized.includes(needle));
  }

  function clearRetryState() {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = 0;
    retryAttempts = 0;
    lastErrorText = '';
  }

  function scheduleRetry(errorText) {
    if (sharedMode || !String(errorText || '').trim() || isSuccessHint(errorText)) return;
    const normalizedError = normalizeText(errorText).trim();
    if (normalizedError !== lastErrorText) {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = 0;
      retryAttempts = 0;
      lastErrorText = normalizedError;
    }
    if (retryTimer || retryAttempts >= RETRY_DELAYS.length) return;

    const delay = RETRY_DELAYS[retryAttempts];
    retryTimer = window.setTimeout(() => {
      retryTimer = 0;
      if (document.hidden) {
        scheduleRetry(document.getElementById('shoppingInsightsHint')?.textContent || errorText);
        return;
      }
      const refresh = document.getElementById('refreshShoppingInsights');
      if (!refresh || refresh.disabled) {
        scheduleRetry(document.getElementById('shoppingInsightsHint')?.textContent || errorText);
        return;
      }
      retryAttempts += 1;
      refresh.click();
      retryTimer = window.setTimeout(() => {
        retryTimer = 0;
        sync();
      }, 8000);
    }, delay);
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

    const hintText = hint.textContent || '';
    const hasHint = Boolean(hintText.trim());
    const success = hasHint && isSuccessHint(hintText);
    const mixed = success && hasMixedTiming(hintText);
    warning.hidden = !mixed;
    if (warning.textContent !== MIXED_TEXT) warning.textContent = MIXED_TEXT;

    const complete = document.getElementById('completeShopping');
    if (complete) {
      if (!hasHint) {
        complete.disabled = true;
        complete.textContent = 'Počítám odhad…';
        complete.title = 'Dokončení nákupu bude dostupné po výpočtu odhadu.';
      } else if (!success) {
        complete.disabled = true;
        complete.textContent = 'Dokončení čeká na přepočet';
        complete.title = 'Odhad se nepodařilo obnovit. Nejdřív proběhne nový přepočet.';
      } else {
        const label = mixed ? 'Dokončit nákup a uložit orientační odhad' : 'Dokončit nákup a uložit historii';
        if (complete.textContent !== label) complete.textContent = label;
      }
    }

    if (success) clearRetryState();
    else if (hasHint) scheduleRetry(hintText);

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

  window.addEventListener('beforeunload', clearRetryState, { once:true });
  window.SlevaoShoppingInsightsValidity = { hasMixedTiming, isSuccessHint };
})();
