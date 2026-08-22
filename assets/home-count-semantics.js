(() => {
  'use strict';

  if (window.__slevaoHomeCountSemanticsLoaded) return;
  window.__slevaoHomeCountSemanticsLoaded = true;

  const RESULT_SUFFIX = ' · dnes + akce začínající do 7 dnů';
  let syncingResult = false;

  function syncHeroLabel() {
    const value = document.getElementById('offerCount');
    const copy = value?.closest('.heroStatCopy');
    const label = copy?.querySelector('.heroStatLabel');
    if (label) label.textContent = 'Platí dnes';
    if (copy) copy.title = 'Počet ověřených nabídek platných dnes';
  }

  function syncResultScope() {
    if (syncingResult) return;
    const result = document.getElementById('resultText');
    if (!result) return;

    const clean = String(result.textContent || '').replace(RESULT_SUFFIX, '');
    const mode = document.querySelector('.quickTab.active')?.dataset.mode || '';
    const shouldExplainUpcoming = /^Zobrazeno\s/.test(clean) && mode !== 'ending';
    const next = shouldExplainUpcoming ? clean + RESULT_SUFFIX : clean;

    if (result.textContent !== next) {
      syncingResult = true;
      result.textContent = next;
      syncingResult = false;
    }
  }

  function init() {
    syncHeroLabel();
    syncResultScope();

    const result = document.getElementById('resultText');
    if (result) new MutationObserver(syncResultScope).observe(result, { childList: true, characterData: true, subtree: true });

    const tabs = document.getElementById('quickTabs');
    if (tabs) new MutationObserver(syncResultScope).observe(tabs, { attributes: true, subtree: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
