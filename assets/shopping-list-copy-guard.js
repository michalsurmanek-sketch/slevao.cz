(() => {
  'use strict';

  const count = document.getElementById('listCount');
  const optimizer = document.getElementById('optimizer');
  if (!count) return;

  function label(value) {
    const number = Math.max(0, Math.trunc(Number(value) || 0));
    if (number === 1) return 'položka';
    if (number >= 2 && number <= 4) return 'položky';
    return 'položek';
  }

  function missingLabel(value) {
    const number = Math.max(0, Math.trunc(Number(value) || 0));
    if (number === 1) return 'položka bez ceny';
    if (number >= 2 && number <= 4) return 'položky bez ceny';
    return 'položek bez ceny';
  }

  function syncCount() {
    const match = String(count.textContent || '').match(/^\s*(\d+)/);
    if (!match) return;
    const number = Number(match[1]);
    const desired = `${number} ${label(number)}`;
    if (count.textContent !== desired) count.textContent = desired;
  }

  function unresolvedCount() {
    if (!optimizer) return 0;
    const text = String(optimizer.textContent || '').replace(/\s+/g, ' ');
    const match = text.match(/(\d+)\s+(?:položku|položky|položek)\s+se nepodařilo spolehlivě najít/i);
    return match ? Math.max(0, Number(match[1]) || 0) : 0;
  }

  function syncOptimizer() {
    if (!optimizer) return;
    const missing = unresolvedCount();
    optimizer.querySelectorAll('.sfResultBox').forEach((box) => {
      const price = box.querySelector('.sfResultPrice');
      let note = box.querySelector('.sfPartialCoverage');
      if (!price || missing <= 0) {
        note?.remove();
        box.classList.remove('hasPartialCoverage');
        return;
      }
      if (!note) {
        note = document.createElement('p');
        note.className = 'sfMuted sfPartialCoverage';
        price.insertAdjacentElement('afterend', note);
      }
      const desired = `Mezisoučet · ${missing} ${missingLabel(missing)}`;
      if (note.textContent !== desired) note.textContent = desired;
      box.classList.add('hasPartialCoverage');
    });
  }

  let queued = false;
  function sync() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      syncCount();
      syncOptimizer();
    });
  }

  new MutationObserver(sync).observe(count, { childList:true, characterData:true, subtree:true });
  if (optimizer) new MutationObserver(sync).observe(optimizer, { childList:true, characterData:true, subtree:true });
  sync();
})();
