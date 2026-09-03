(() => {
  'use strict';

  const LIST_KEY = 'slevao-shopping-list-v1';
  const LEGACY_RECIPE_START = Date.parse('2026-09-03T08:15:00Z');
  const LEGACY_RECIPE_END = Date.parse('2026-09-03T09:00:00Z');
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

  const legacyRecipeRows = new Map([
    ['Špagety',1,'balení','Špagety (1 balení)'],['Mleté hovězí maso',500,'g','Mleté hovězí maso (500 g)'],['Rajčatové pyré',1,'ks','Rajčatové pyré (1 ks)'],['Cibule',1,'ks','Cibule (1 ks)'],['Česnek',2,'stroužky','Česnek (2 stroužky)'],['Mrkev',1,'ks','Mrkev (1 ks)'],['Parmazán',1,'balení','Parmazán (1 balení)'],['Olivový olej',1,'ks','Olivový olej (1 ks)'],
    ['Kuřecí prsa',600,'g','Kuřecí prsa (600 g)'],['Hladká mouka',1,'balení','Hladká mouka (1 balení)'],['Vejce',3,'ks','Vejce (3 ks)'],['Strouhanka',1,'balení','Strouhanka (1 balení)'],['Olej na smažení',1,'ks','Olej na smažení (1 ks)'],['Brambory',1,'kg','Brambory (1 kg)'],
    ['Hovězí maso',800,'g','Hovězí maso (800 g)'],['Cibule',4,'ks','Cibule (4 ks)'],['Sádlo',1,'ks','Sádlo (1 ks)'],['Sladká paprika',1,'balení','Sladká paprika (1 balení)'],['Česnek',3,'stroužky','Česnek (3 stroužky)'],['Kmín',1,'balení','Kmín (1 balení)'],['Majoránka',1,'balení','Majoránka (1 balení)'],['Hovězí vývar',1,'l','Hovězí vývar (1 l)'],
    ['Hladká mouka',250,'g','Hladká mouka (250 g)'],['Mléko',500,'ml','Mléko (500 ml)'],['Vejce',2,'ks','Vejce (2 ks)'],['Olej',1,'ks','Olej (1 ks)'],['Marmeláda',1,'ks','Marmeláda (1 ks)']
  ].map(([name, quantity, unit, fixedName]) => [`${norm(name)}|${quantity}|${norm(unit)}`, fixedName]));

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

  function legacyRecipeRepair(row) {
    if (!row?.id || row.product_id) return null;
    const createdAt = Date.parse(String(row.created_at || ''));
    if (!Number.isFinite(createdAt) || createdAt < LEGACY_RECIPE_START || createdAt >= LEGACY_RECIPE_END) return null;
    const name = String(row.custom_name || '').trim();
    const quantity = Number(row.quantity);
    const unit = String(row.unit || 'ks').trim();
    if (!name || !Number.isFinite(quantity) || quantity <= 0) return null;
    const fixedName = legacyRecipeRows.get(`${norm(name)}|${quantity}|${norm(unit)}`);
    return fixedName ? { custom_name:fixedName, quantity:1, unit:'ks' } : null;
  }

  async function repairRemoteRecipeRows(listId, remoteRows) {
    let repaired = 0;
    for (const row of remoteRows || []) {
      const fix = legacyRecipeRepair(row);
      if (!fix) continue;
      const { error } = await db.from('shopping_list_items')
        .update(fix)
        .eq('id', row.id)
        .eq('shopping_list_id', listId);
      if (error) throw error;
      Object.assign(row, fix);
      repaired += 1;
    }
    return repaired;
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
    const { data:list, error:listError } = await db.from('shopping_lists')
      .select('id')
      .eq('user_id', ownerId)
      .eq('is_archived', false)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    if (listError) throw listError;

    let remoteRows = [];
    let repairedRemote = 0;
    if (list?.id) {
      const { data, error } = await db.from('shopping_list_items')
        .select('id,product_id,custom_name,quantity,unit,created_at')
        .eq('shopping_list_id', list.id)
        .order('created_at');
      if (error) throw error;
      remoteRows = data || [];
      repairedRemote = await repairRemoteRecipeRows(list.id, remoteRows);
    }

    const nextRows = reconcileBeforeMerge(localRows, remoteRows);
    const removed = localRows.length - nextRows.length;
    if (removed > 0) {
      localStorage.setItem(LIST_KEY, JSON.stringify(nextRows));
      window.SlevaoPublic?.updateNavCount?.();
    }
    if (!removed && !repairedRemote) return { changed:false, reason:'current' };

    return {
      changed:true,
      removed,
      repaired_remote:repairedRemote,
      rows:nextRows
    };
  }

  window.SlevaoShoppingOwnerColdSync = {
    itemKey,
    legacyRecipeRepair,
    reconcileBeforeMerge,
    sync
  };
})();
