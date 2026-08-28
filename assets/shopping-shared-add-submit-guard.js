(() => {
  'use strict';

  const sharedHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const sharedMode = Boolean(sharedHash.get('share'));
  if (!sharedMode || !document.querySelector('.sfListLayout')) return;

  const RELEASE_TIMEOUT_MS = 15000;
  const PENDING_MUTATION_TTL_MS = 5 * 60 * 1000;
  const MUTATION_RPC = 'mutate_shared_shopping_list';
  let busy = false;
  let releaseTimer = 0;
  let pendingAddMutation = null;

  function mutationId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    const tail = `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.replace(/[^0-9a-f]/gi, '').padEnd(12, '0').slice(0, 12);
    return `00000000-0000-4000-8000-${tail}`;
  }

  function addFingerprint(args = {}) {
    return JSON.stringify([
      args.p_product_id || null,
      args.p_selected_offer_id || null,
      String(args.p_custom_name || '').trim(),
      Number(args.p_quantity ?? 1),
      String(args.p_unit || 'ks'),
      Boolean(args.p_is_completed),
    ]);
  }

  function currentMutationId(args) {
    const fingerprint = addFingerprint(args);
    const now = Date.now();
    if (!pendingAddMutation
        || pendingAddMutation.fingerprint !== fingerprint
        || now - pendingAddMutation.createdAt > PENDING_MUTATION_TTL_MS) {
      pendingAddMutation = { id:mutationId(), fingerprint, createdAt:now };
    }
    return pendingAddMutation.id;
  }

  function clearPendingMutation(id) {
    if (pendingAddMutation?.id === id) pendingAddMutation = null;
  }

  function isAmbiguousFailure(result) {
    if (!result?.error) return false;
    const status = Number(result?.status || 0);
    const message = `${result.error?.message || ''} ${result.error?.details || ''}`;
    return status === 0
      || status >= 500
      || /failed to fetch|network|load failed|connection|timeout/i.test(message);
  }

  function installMutationBridge() {
    const db = window.SlevaoSupabase?.getClient?.();
    if (!db?.rpc || db.__slevaoSharedAddMutationBridge) return;
    const nativeRpc = db.rpc.bind(db);

    const wrappedRpc = function wrappedRpc(fn, args = {}, options) {
      if (fn !== MUTATION_RPC || args?.p_action !== 'add' || args?.p_mutation_id) {
        return nativeRpc(fn, args, options);
      }

      const id = currentMutationId(args);
      let request;
      try {
        request = nativeRpc(fn, { ...args, p_mutation_id:id }, options);
      } catch (error) {
        throw error;
      }

      return Promise.resolve(request).then((result) => {
        if (!result?.error || !isAmbiguousFailure(result)) clearPendingMutation(id);
        return result;
      });
    };

    try {
      db.rpc = wrappedRpc;
      Object.defineProperty(db, '__slevaoSharedAddMutationBridge', { value:true, configurable:true });
    } catch {
      try {
        Object.defineProperty(db, 'rpc', { value:wrappedRpc, configurable:true });
        Object.defineProperty(db, '__slevaoSharedAddMutationBridge', { value:true, configurable:true });
      } catch {}
    }

    window.SlevaoSharedAddMutationBridge = {
      pending: () => pendingAddMutation ? { ...pendingAddMutation } : null,
    };
  }

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

  installMutationBridge();

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
