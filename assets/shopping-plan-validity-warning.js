(() => {
  'use strict';

  const optimizer = document.getElementById('optimizer');
  if (!optimizer) return;

  const WARNING = 'Jednotlivé akce nemusí platit ve stejný den.';
  const futurePattern = /používá akci začínající během příštích 7 dnů/i;
  let queued = false;

  function syncWarnings() {
    optimizer.querySelectorAll('.sfResultBox').forEach((box) => {
      const note = box.querySelector(':scope > .sfMuted');
      if (!note) return;
      const original = String(note.textContent || '').trim();
      const hasFuture = futurePattern.test(original);
      box.classList.toggle('hasMixedDateWarning', hasFuture);
      if (!hasFuture || original.includes(WARNING)) return;
      note.textContent = `${original} ${WARNING}`;
    });
  }

  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      syncWarnings();
    });
  }

  new MutationObserver(schedule).observe(optimizer, { childList:true, subtree:true });
  schedule();
})();
