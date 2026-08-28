(() => {
  'use strict';

  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const query = new URLSearchParams(location.search);
  const sharedToken = hash.get('share') || query.get('share') || '';
  if (!sharedToken) return;

  const status = document.getElementById('accountStatus');
  const customName = document.getElementById('customName');
  if (!status || !customName) return;

  function sync() {
    const readOnly = Boolean(customName.disabled)
      && /pouze\s+ke\s+čtení/i.test(String(status.textContent || ''));
    document.body.classList.toggle('sfSharedReadonly', readOnly);
  }

  new MutationObserver(sync).observe(status, {
    childList:true,
    subtree:true,
    characterData:true
  });
  new MutationObserver(sync).observe(customName, {
    attributes:true,
    attributeFilter:['disabled']
  });
  sync();
})();
