(() => {
  'use strict';

  const count = document.getElementById('listCount');
  if (!count) return;

  function label(value) {
    const number = Math.max(0, Math.trunc(Number(value) || 0));
    if (number === 1) return 'položka';
    if (number >= 2 && number <= 4) return 'položky';
    return 'položek';
  }

  function sync() {
    const match = String(count.textContent || '').match(/^\s*(\d+)/);
    if (!match) return;
    const number = Number(match[1]);
    const desired = `${number} ${label(number)}`;
    if (count.textContent !== desired) count.textContent = desired;
  }

  new MutationObserver(sync).observe(count, { childList:true, characterData:true, subtree:true });
  sync();
})();
