(() => {
  'use strict';

  const sharedQuery = new URLSearchParams(location.search);
  const sharedHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const sharedMode = Boolean(sharedQuery.get('share') || sharedHash.get('share'));
  if (!sharedMode || !document.querySelector('.sfListLayout')) return;

  const RELEASE_TIMEOUT_MS = 15000;
  let busy = false;
  let releaseTimer = 0;

  function elements() {
    return {
      button: document.getElementById('addCustom'),
      nameInput: document.getElementById('customName'),
      list: document.getElementById('listItems'),
      message: document.getElementById('listMessage'),
    };
  }

  function release() {
    if (!busy) return;
    busy = false;
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = 0;
    const { button, nameInput } = elements();
    if (button) {
      button.removeAttribute('aria-busy');
      button.disabled = Boolean(nameInput?.disabled);
    }
  }

  function begin() {
    const { button } = elements();
    busy = true;
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
    if (releaseTimer) clearTimeout(releaseTimer);
    releaseTimer = window.setTimeout(release, RELEASE_TIMEOUT_MS);
  }

  function listIsReady() {
    return !document.querySelector('#listItems .sfLoading');
  }

  function block(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  document.addEventListener('click', (event) => {
    const button = event.target?.closest?.('#addCustom');
    if (!button) return;
    if (!listIsReady()) {
      block(event);
      return;
    }
    if (busy) {
      block(event);
      return;
    }
    if (button.disabled) return;
    begin();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.target?.id !== 'customName') return;
    if (!listIsReady()) {
      block(event);
      return;
    }
    if (busy) {
      block(event);
      return;
    }
    if (document.getElementById('addCustom')?.disabled) return;
    begin();
  }, true);

  const { list, message } = elements();
  if (list) {
    new MutationObserver(() => {
      if (busy && listIsReady()) release();
    }).observe(list, { childList:true, subtree:true });
  }
  if (message) {
    new MutationObserver(() => {
      if (busy && String(message.textContent || '').trim()) release();
    }).observe(message, { childList:true, characterData:true, subtree:true });
  }
})();
