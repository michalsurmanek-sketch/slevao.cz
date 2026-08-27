(() => {
  'use strict';

  const LIST_KEY = 'slevao-shopping-list-v1';
  const CLAIM_QUANTITY = '__slevao_guest_claim_quantity';
  const POLL_MS = 30000;
  const VERIFY_ATTEMPTS = 16;
  const VERIFY_DELAY_MS = 250;
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

  function rowIdentity(row, remote = false) {
    const id = remote ? row?.id : row?.server_id;
    if (!id) return '';
    const itemKey = row?.product_id
      ? `p:${String(row.product_id)}`
      : `c:${norm(row?.custom_name || row?.name)}`;
    const completed = remote ? Boolean(row?.is_completed) : Boolean(row?.completed);
    return [
      String(id),
      itemKey,
      String(row?.selected_offer_id || ''),
      String(Number(row?.quantity || 1)),
      String(row?.unit || 'ks'),
      completed ? '1' : '0',
    ].join('|');
  }

  function signature(rows, remote = false) {
    return (rows || []).map((row) => rowIdentity(row, remote)).filter(Boolean).sort().join('||');
  }

  function localIsSettled(rows) {
    return (rows || []).every((row) => row?.server_id && !Number.isFinite(Number(row?.[CLAIM_QUANTITY])));
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
    if (!currentListId) return { status:localRows.length ? 'mismatch' : 'current' };

    const { data:remoteRows, error:remoteError } = await db.from('shopping_list_items')
      .select('id,product_id,selected_offer_id,custom_name,quantity,unit,is_completed')
      .eq('shopping_list_id', currentListId)
      .order('created_at');
    if (remoteError) throw remoteError;

    const localSignature = signature(localRows, false);
    const remoteSignature = signature(remoteRows || [], true);
    return {
      status: localSignature === remoteSignature ? 'current' : 'mismatch',
      localSignature,
      remoteSignature,
    };
  }

  async function checkRemote() {
    if (checking || verifyingCompletion || document.hidden || editingList()) return;
    checking = true;
    try {
      const state = await snapshotState();
      if (state.status === 'mismatch') location.reload();
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

  async function guardCompletionClick(event) {
    const button = event.target?.closest?.('#completeShopping');
    if (!button || completionBypass || button.disabled) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (verifyingCompletion) return;

    verifyingCompletion = true;
    button.disabled = true;
    const originalTitle = button.title;
    button.title = 'Ověřuji aktuální stav seznamu…';
    try {
      const state = await verifyBeforeCompletion();
      if (state.status === 'current' || state.status === 'guest') {
        completionBypass = true;
        button.disabled = false;
        button.title = originalTitle;
        button.click();
        completionBypass = false;
        return;
      }
      if (state.status === 'mismatch') {
        window.SlevaoPublic?.toast?.('Seznam se mezitím změnil na jiném zařízení. Načítám aktuální stav.');
        location.reload();
        return;
      }
      window.SlevaoPublic?.toast?.('Před dokončením se nepodařilo ověřit aktuální seznam. Zkus to prosím znovu.');
    } catch (error) {
      console.debug('Ověření seznamu před dokončením selhalo:', error);
      window.SlevaoPublic?.toast?.('Před dokončením se nepodařilo ověřit aktuální seznam. Zkus to prosím znovu.');
    } finally {
      if (!completionBypass) {
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

  window.SlevaoOwnerCloudRefresh = { signature, localIsSettled, snapshotState, verifyBeforeCompletion };
})();