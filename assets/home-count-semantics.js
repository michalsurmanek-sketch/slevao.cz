(() => {
  'use strict';

  if (window.__slevaoHomeCountSemanticsLoaded) return;
  window.__slevaoHomeCountSemanticsLoaded = true;

  const HORIZON_SUFFIX = ' · dnes + akce začínající do 7 dnů';
  const RECOMMENDED_MARKER = ' doporučených nabídek';
  const TOTAL_MARKER = ' · výběr z ';
  let syncingResult = false;

  function syncHeroLabel() {
    const value = document.getElementById('offerCount');
    const copy = value?.closest('.heroStatCopy');
    const label = copy?.querySelector('.heroStatLabel');
    if (label) label.textContent = 'Platí dnes';
    if (copy) copy.title = 'Počet všech veřejně vyhledatelných nabídek platných dnes';
  }

  function cleanResultText(value) {
    let clean = String(value || '').replace(HORIZON_SUFFIX, '');
    const totalIndex = clean.indexOf(TOTAL_MARKER);
    if (totalIndex >= 0) clean = clean.slice(0, totalIndex);
    clean = clean.replace(RECOMMENDED_MARKER, ' nabídek');
    return clean.trim();
  }

  function syncResultScope() {
    if (syncingResult) return;
    const result = document.getElementById('resultText');
    if (!result) return;

    const clean = cleanResultText(result.textContent);
    const mode = document.querySelector('.quickTab.active')?.dataset.mode || '';
    const searchableTotal = String(document.getElementById('offerCount')?.textContent || '').trim();
    const hasResult = /^Zobrazeno\s/.test(clean);
    let next = clean;

    if (hasResult && mode === 'recommended') {
      next = clean.replace(/\s+nabídek$/, RECOMMENDED_MARKER);
      if (searchableTotal && searchableTotal !== '0') {
        next += `${TOTAL_MARKER}${searchableTotal} nabídek platných dnes`;
      }
    } else if (hasResult && mode !== 'ending') {
      next = clean + HORIZON_SUFFIX;
    }

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

    const offerCount = document.getElementById('offerCount');
    if (offerCount) new MutationObserver(() => {
      syncHeroLabel();
      syncResultScope();
    }).observe(offerCount, { childList: true, characterData: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();