(() => {
  'use strict';

  const LIST_KEY = 'slevao-shopping-list-v1';
  const CLAIM_QUANTITY = '__slevao_guest_claim_quantity';
  const POLL_MS = 30000;
  const VERIFY_ATTEMPTS = 16;
  const VERIFY_DELAY_MS = 250;
  const COMPLETION_RECOVERY_ATTEMPTS = 40;
  const COMPLETION_RECOVERY_DELAY_MS = 250;
  const sharedQuery = new URLSearchParams(location.search);
  const sharedHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const sharedMode = Boolean(sharedQuery.get('share') || sharedHash.get('share'));
  if (sharedMode || !document.querySelector('.sfListLayout')) return;

  let checking = false;
  let verifyingCompletion = false;
  let completionBypass = false;
  let timer = 0;
  let listId = '';

  const norm = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  function readLocalRows() {
    try {
      const value = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function itemKey(row) {
    return row?.product_id
      ? `p:${String(row.product_id)}`
      : `c:${norm(row?.custom_name || row?.name)}`;
  }

  function normalizedRecipeIds(row) {
    return [...new Set((Array.isArray(row?.recipe_ids) ? row.recipe_ids : [])
      .map((value) => String(value || '').trim())
      .filter(Boolean))].sort();
  }

  function rowIdentity(row, remote = false) {
    const id = remote ? row?.id : row?.server_id;
    if (!id) return '';
    const completed = remote ? Boolean(row?.is_completed) : Boolean(row?.completed);
    const isRecipe = remote ? Boolean(row?.is_recipe) : row?.source === 'recipe';
    return [
      String(id),
      itemKey(row),
      String(row?.selected_offer_id || ''),
      String(Number(row?.quantity || 1)),
      String(row?.unit || 'ks'),
      completed ? '1' : '0',
      isRecipe ? 'recipe' : 'manual',
      normalizedRecipeIds(row).join(','),
    ].join('|');
  }

  function signature(rows, remote = false) {
    return (rows || []).map((row) => rowIdentity(row, remote)).filter(Boolean).sort().join('||');
  }

  function localIsSettled(rows) {
    return (rows || []).every((row) => row?.server_id && !Number.isFinite(Number(row?.[CLAIM_QUANTITY])));
  }

  function applyRemoteProvenance(merged, remote) {
    if (remote?.is_recipe) {
      merged.source = 'recipe';
      merged.recipe_ids = normalizedRecipeIds(remote);
      merged.recipe_cloud_synced = 1;
      delete merged.recipe_sync_conflict;
      delete merged.recipe_dirty;
      return merged;
    }

    if (merged.source === 'recipe' || merged.recipe_ids || merged.recipe_cloud_synced) {
      merged.source = 'manual';
      delete merged.recipe_id;
      delete merged.recipe_ids;
      delete merged.recipe_dirty;
      delete merged.recipe_cloud_synced;
    }
    return merged;
  }

  function reconcileRemoteRows(localRows, remoteRows) {
    const remoteById = new Map((remoteRows || [])
      .filter((row) => row?.id)
      .map((row) => [String(row.id), row]));
    const next = [];

    for (const row of localRows || []) {
      if (!row?.server_id) {
        next.push(row);
        continue;
      }
      const remote = remoteById.get(String(row.server_id));
      if (!remote) continue;
      if (itemKey(row) !== itemKey(remote)) continue;

      const merged = {
        ...row,
        selected_offer_id: remote.selected_offer_id || null,
        quantity: Number(remote.quantity || 1),
        unit: remote.unit || row.unit || 'ks',
        completed: Boolean(remote.is_completed),
        updated_at: remote.updated_at || row.updated_at || null,
      };
      if (!merged.product_id && remote.custom_name) {
        merged.custom_name = remote.custom_name;
        merged.name = remote.custom_name;
      }
      next.push(applyRemoteProvenance(merged, remote));
    }
    return next;
  }

  function persistRemoteState(state) {
    if (!Array.isArray(state?.localRows) || !Array.isArray(state?.remoteRows)) return;
    const next = reconcileRemoteRows(state.localRows, state.remoteRows);
    localStorage.setItem(LIST_KEY, JSON.stringify(next));
    window.SlevaoPublic?.updateNavCount?.();
  }

  function editingList() {
    const active = document.activeElement;
    return Boolean(active?.closest?.('#listItems, .sfAddRow') && active.matches?.('input,textarea,select,button'));
  }

  async function resolveListId(db, userId) {
    if (listId) return listId;
    const { data, error } = await db.from('shopping_lists')
      .select('id')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    listId = String(data?.id || '');
    return listId;
  }

  async function snapshotState({ requireSettled = true } = {}) {
    const db = window.SlevaoSupabase?.getClient?.();
    if (!db) return { status:'unavailable' };

    const localRows = readLocalRows();
    if (requireSettled && !localIsSettled(localRows)) return { status:'pending' };

    const { data:{ session }, error:sessionError } = await db.auth.getSession();
    if (sessionError) throw sessionError;
    if (!session?.user?.id) return { status:'guest' };

    const currentListId = await resolveListId(db, session.user.id);
    if (!currentListId) {
      return {
        status: localRows.length ? 'mismatch' : 'current',
        localRows,
        remoteRows:[],
      };
    }

    const { data:remoteRows, error:remoteError } = await db.from('shopping_list_items')
      .select('id,product_id,selected_offer_id,custom_name,quantity,unit,is_completed,updated_at,is_recipe,recipe_ids')
      .eq('shopping_list_id', currentListId)
      .order('created_at');
    if (remoteError) throw remoteError;

    const safeRemoteRows = remoteRows || [];
    const localSignature = signature(localRows, false);
    const remoteSignature = signature(safeRemoteRows, true);
    return {
      status: localSignature === remoteSignature ? 'current' : 'mismatch',
      localSignature,
      remoteSignature,
      localRows,
      remoteRows:safeRemoteRows,
    };
  }

  async function checkRemote() {
    if (checking || verifyingCompletion || document.hidden || editingList()) return;
    checking = true;
    try {
      const state = await snapshotState();
      if (state.status === 'mismatch') {
        persistRemoteState(state);
        location.reload();
      }
    } catch (error) {
      console.debug('Kontrola cloudového nákupního seznamu selhala:', error);
    } finally {
      checking = false;
    }
  }

  async function verifyBeforeCompletion() {
    let lastState = { status:'pending' };
    for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt++) {
      lastState = await snapshotState();
      if (lastState.status === 'current' || lastState.status === 'guest') return lastState;
      if (lastState.status === 'unavailable') return lastState;
      await new Promise((resolve) => setTimeout(resolve, VERIFY_DELAY_MS));
    }
    return lastState;
  }

  async function recoverAfterCompletionAttempt(button) {
    for (let attempt = 0; attempt < COMPLETION_RECOVERY_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, COMPLETION_RECOVERY_DELAY_MS));
      if (!document.contains(button)) return { status:'unmounted' };
      if (button.disabled) continue;

      const state = await snapshotState({ requireSettled:false });
      if (state.status === 'mismatch') {
        persistRemoteState(state);
        window.SlevaoPublic?.toast?.('Seznam se mezitím změnil na jiném zařízení. Načítám aktuální stav.');
        location.reload();
      }
      return state;
    }
    return { status:'busy' };
  }

  async function guardCompletionClick(event) {
    const button = event.target?.closest?.('#completeShopping');
    if (!button || completionBypass || button.disabled) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (verifyingCompletion) return;

    verifyingCompletion = true;
    button.disabled = true;
    const originalTitle = button.title;
    let forwarded = false;
    button.title = 'Ověřuji aktuální stav seznamu…';
    try {
      const state = await verifyBeforeCompletion();
      if (state.status === 'current' || state.status === 'guest') {
        completionBypass = true;
        button.disabled = false;
        button.title = originalTitle;
        button.click();
        completionBypass = false;
        forwarded = true;
        void recoverAfterCompletionAttempt(button).catch((error) => {
          console.debug('Obnova seznamu po konfliktu dokončení selhala:', error);
        });
        return;
      }
      if (state.status === 'mismatch') {
        persistRemoteState(state);
        window.SlevaoPublic?.toast?.('Seznam se mezitím změnil na jiném zařízení. Načítám aktuální stav.');
        location.reload();
        return;
      }
      window.SlevaoPublic?.toast?.('Před dokončením se nepodařilo ověřit aktuální seznam. Zkus to prosím znovu.');
    } catch (error) {
      console.debug('Ověření seznamu před dokončením selhalo:', error);
      window.SlevaoPublic?.toast?.('Před dokončením se nepodařilo ověřit aktuální seznam. Zkus to prosím znovu.');
    } finally {
      if (!completionBypass && !forwarded) {
        button.disabled = false;
        button.title = originalTitle;
      }
      verifyingCompletion = false;
    }
  }

  function scheduleSoon() {
    window.setTimeout(() => checkRemote(), 500);
  }

  document.addEventListener('click', guardCompletionClick, true);
  window.addEventListener('focus', scheduleSoon);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleSoon();
  });
  timer = window.setInterval(() => checkRemote(), POLL_MS);
  window.addEventListener('pagehide', () => clearInterval(timer), { once:true });

  window.SlevaoOwnerCloudRefresh = {
    signature,
    localIsSettled,
    applyRemoteProvenance,
    reconcileRemoteRows,
    snapshotState,
    verifyBeforeCompletion,
    recoverAfterCompletionAttempt,
  };
})();
