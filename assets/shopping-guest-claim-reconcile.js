(() => {
  'use strict';

  const LIST_KEY = 'slevao-shopping-list-v1';
  const CLAIM_QUANTITY = '__slevao_guest_claim_quantity';
  const CLAIM_COMPLETED = '__slevao_guest_claim_completed';
  const MAX_ATTEMPTS = 40;
  const RETRY_MS = 250;

  const norm = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const rowKind = (row) => row?.source === 'recipe' || row?.is_recipe === true ? 'recipe' : 'manual';
  const rowKey = (row) => row?.product_id
    ? `p:${String(row.product_id)}`
    : (norm(row?.custom_name || row?.name) ? `c:${rowKind(row)}:${norm(row?.custom_name || row?.name)}` : '');
  const readRows = () => {
    try {
      const rows = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  };
  const hasClaim = (row) => Number.isFinite(Number(row?.[CLAIM_QUANTITY]));

  function mergeClaimedState(local, remote) {
    const claimQuantity = Math.max(0.01, Number(local?.[CLAIM_QUANTITY] || 1));
    const claimCompleted = Boolean(local?.[CLAIM_COMPLETED]);
    return {
      quantity: Math.max(Number(remote?.quantity || 1), claimQuantity),
      completed: Boolean(remote?.is_completed && claimCompleted),
    };
  }

  function resolveClaimRemote(local, remoteById, remoteByKey) {
    const serverId = String(local?.server_id || '').trim();
    const remote = (serverId ? remoteById.get(serverId) : null) || remoteByKey.get(rowKey(local));
    if (!remote?.id) return null;
    if (rowKind(local) !== rowKind(remote)) return null;
    return remote;
  }

  async function waitForListSync() {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const rows = readRows();
      const claimed = rows.filter(hasClaim);
      if (!claimed.length) return null;
      const syncedMessage = String(document.getElementById('listMessage')?.textContent || '').includes('synchronizovaný');
      if (syncedMessage && claimed.every((row) => row.server_id)) return rows;
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
    return null;
  }

  async function reconcile() {
    if (!document.querySelector('.sfListLayout')) return;
    const db = window.SlevaoSupabase?.getClient?.();
    if (!db) return;

    const { data:{ session }, error:sessionError } = await db.auth.getSession();
    if (sessionError || !session?.user?.id) return;

    const rows = await waitForListSync();
    if (!rows) return;
    const claimedRows = rows.filter(hasClaim);
    if (!claimedRows.length) return;

    const { data:list, error:listError } = await db.from('shopping_lists')
      .select('id')
      .eq('user_id', session.user.id)
      .eq('is_archived', false)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    if (listError || !list?.id) return;

    const { data:remoteRows, error:remoteError } = await db.from('shopping_list_items')
      .select('id,shopping_list_id,product_id,custom_name,quantity,unit,is_completed,is_recipe')
      .eq('shopping_list_id', list.id);
    if (remoteError) return;

    const remoteById = new Map((remoteRows || []).filter((row) => row?.id).map((row) => [String(row.id), row]));
    const remoteByKey = new Map((remoteRows || []).map((row) => [rowKey(row), row]).filter(([key]) => key));

    for (const local of claimedRows) {
      const remote = resolveClaimRemote(local, remoteById, remoteByKey);
      if (!remote?.id) return;
      const desired = mergeClaimedState(local, remote);
      if (Number(remote.quantity || 1) !== desired.quantity || Boolean(remote.is_completed) !== desired.completed) {
        const { error:updateError } = await db.from('shopping_list_items')
          .update({ quantity: desired.quantity, is_completed: desired.completed })
          .eq('id', remote.id)
          .eq('shopping_list_id', list.id);
        if (updateError) return;
      }
      local.server_id = remote.id;
      local.quantity = desired.quantity;
      local.completed = desired.completed;
      delete local[CLAIM_QUANTITY];
      delete local[CLAIM_COMPLETED];
    }

    localStorage.setItem(LIST_KEY, JSON.stringify(rows));
    location.reload();
  }

  window.SlevaoGuestClaimReconcile = { mergeClaimedState, rowKind, rowKey, resolveClaimRemote };
  reconcile().catch(() => {});
})();