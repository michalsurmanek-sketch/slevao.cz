(() => {
  'use strict';

  const LIST_KEY = 'slevao-shopping-list-v1';
  const sharedQuery = new URLSearchParams(location.search);
  const sharedHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const sharedMode = Boolean(sharedQuery.get('share') || sharedHash.get('share'));
  if (sharedMode || !document.querySelector('.sfListLayout')) return;

  const db = window.SlevaoSupabase?.getClient?.();
  if (!db || window.SlevaoShoppingOwnerColdSync) return;

  const norm = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  function itemKey(row) {
    return row?.product_id
      ? `p:${String(row.product_id)}`
      : `c:${norm(row?.custom_name || row?.name)}`;
  }

  function readLocalRows() {
    try {
      const rows = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  function reconcileBeforeMerge(localRows, remoteRows) {
    const remoteIds = new Set((remoteRows || []).map((row) => String(row?.id || '')).filter(Boolean));
    const remoteKeys = new Set((remoteRows || []).map(itemKey).filter((key) => key && key !== 'c:'));

    return (localRows || []).filter((row) => {
      const serverId = String(row?.server_id || '');
      if (!serverId) return true;
      if (remoteIds.has(serverId)) return true;
      const key = itemKey(row);
      return Boolean(key && key !== 'c:' && remoteKeys.has(key));
    });
  }

  async function sync(userId) {
    const ownerId = String(userId || '').trim();
    if (!ownerId) return { changed:false, reason:'guest' };

    const localRows = readLocalRows();
    if (!localRows.some((row) => row?.server_id)) return { changed:false, reason:'no-synced-rows' };

    const { data:list, error:listError } = await db.from('shopping_lists')
      .select('id')
      .eq('user_id', ownerId)
      .eq('is_archived', false)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    if (listError) throw listError;

    let remoteRows = [];
    if (list?.id) {
      const { data, error } = await db.from('shopping_list_items')
        .select('id,product_id,custom_name')
        .eq('shopping_list_id', list.id)
        .order('created_at');
      if (error) throw error;
      remoteRows = data || [];
    }

    const nextRows = reconcileBeforeMerge(localRows, remoteRows);
    if (nextRows.length === localRows.length) return { changed:false, reason:'current' };

    localStorage.setItem(LIST_KEY, JSON.stringify(nextRows));
    window.SlevaoPublic?.updateNavCount?.();
    return {
      changed:true,
      removed:localRows.length - nextRows.length,
      rows:nextRows
    };
  }

  window.SlevaoShoppingOwnerColdSync = {
    itemKey,
    reconcileBeforeMerge,
    sync
  };
})();