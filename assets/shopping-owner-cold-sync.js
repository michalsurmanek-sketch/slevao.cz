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

  function recipeSources(row) {
    return [...new Set([
      row?.recipe_id,
      ...(Array.isArray(row?.recipe_ids) ? row.recipe_ids : [])
    ].map((value) => String(value || '').trim()).filter(Boolean))];
  }

  function adoptRecipeRemote(row, remote) {
    if (!row || !remote?.id) return false;
    row.server_id = remote.id;
    row.selected_offer_id = remote.selected_offer_id || null;
    row.custom_name = remote.custom_name || row.custom_name || row.name || null;
    row.name = row.custom_name || row.name || 'Položka';
    row.quantity = 1;
    row.qty = 1;
    row.unit = 'ks';
    row.completed = Boolean(remote.is_completed);
    row.is_completed = Boolean(remote.is_completed);
    row.source = 'recipe';
    row.recipe_ids = Array.isArray(remote.recipe_ids) ? remote.recipe_ids : recipeSources(row);
    row.recipe_cloud_synced = 1;
    row.updated_at = remote.updated_at || row.updated_at || new Date().toISOString();
    delete row.recipe_dirty;
    delete row.recipe_sync_conflict;
    return true;
  }

  function createRemoteRecipeLocalRow(remote) {
    if (!remote?.id || remote?.product_id || !remote?.is_recipe || !String(remote?.custom_name || '').trim()) return null;
    const name = String(remote.custom_name).trim();
    return {
      local_id:`remote:${remote.id}`,
      server_id:remote.id,
      key:itemKey(remote),
      product_id:null,
      selected_offer_id:remote.selected_offer_id || null,
      custom_name:name,
      name,
      quantity:1,
      qty:1,
      unit:'ks',
      completed:Boolean(remote.is_completed),
      is_completed:Boolean(remote.is_completed),
      source:'recipe',
      recipe_ids:recipeSources(remote),
      recipe_cloud_synced:1,
      added_at:remote.created_at || remote.updated_at || new Date().toISOString(),
      updated_at:remote.updated_at || remote.created_at || new Date().toISOString()
    };
  }

  function hydrateRemoteRecipeRows(localRows, remoteRows) {
    const rows = Array.isArray(localRows) ? localRows : [];
    const localByKey = new Map(rows.map((row) => [itemKey(row), row]).filter(([key]) => key && key !== 'c:'));
    let changed = false;
    let added = 0;
    let adopted = 0;

    for (const remote of remoteRows || []) {
      if (!remote?.is_recipe || remote?.product_id || !remote?.id || !String(remote?.custom_name || '').trim()) continue;
      const key = itemKey(remote);
      if (!key || key === 'c:') continue;
      const local = localByKey.get(key);
      if (local) {
        const before = JSON.stringify({
          server_id:local.server_id || null,
          source:local.source || null,
          recipe_ids:recipeSources(local),
          quantity:Number(local.quantity || 1),
          completed:Boolean(local.completed)
        });
        adoptRecipeRemote(local, remote);
        const after = JSON.stringify({
          server_id:local.server_id || null,
          source:local.source || null,
          recipe_ids:recipeSources(local),
          quantity:Number(local.quantity || 1),
          completed:Boolean(local.completed)
        });
        if (before !== after) {
          changed = true;
          adopted += 1;
        }
        continue;
      }

      const created = createRemoteRecipeLocalRow(remote);
      if (!created) continue;
      rows.push(created);
      localByKey.set(key, created);
      changed = true;
      added += 1;
    }

    return { rows, changed, added, adopted };
  }

  function adoptManualConflict(row, remote, reason = 'target_not_recipe_safe') {
    if (!row || !remote?.id) return false;
    row.server_id = remote.id;
    row.selected_offer_id = remote.selected_offer_id || null;
    row.custom_name = remote.custom_name || row.custom_name || row.name || null;
    row.name = row.custom_name || row.name || 'Položka';
    row.quantity = Math.max(0.01, Number(remote.quantity || 1));
    row.qty = row.quantity;
    row.unit = remote.unit || 'ks';
    row.completed = Boolean(remote.is_completed);
    row.is_completed = Boolean(remote.is_completed);
    row.updated_at = remote.updated_at || row.updated_at || new Date().toISOString();
    row.recipe_sync_conflict = String(reason || 'target_not_recipe_safe');
    row.source = 'manual';
    delete row.recipe_id;
    delete row.recipe_ids;
    delete row.recipe_dirty;
    delete row.recipe_cloud_synced;
    return true;
  }

  async function syncLocalRecipeRows(localRows) {
    let synced = 0;
    let conflicts = 0;
    let changed = false;

    for (const row of localRows || []) {
      if (
        row?.source !== 'recipe'
        || row?.product_id
        || row?.completed
        || row?.is_completed
        || !String(row?.custom_name || row?.name || '').trim()
        || (row?.server_id && !row?.recipe_dirty && Number(row?.recipe_cloud_synced) === 1)
      ) continue;

      const { data: sync, error } = await db.rpc('sync_own_shopping_list_recipe_item', {
        p_source_item_id: row?.server_id || null,
        p_custom_name: String(row.custom_name || row.name).trim(),
        p_recipe_ids: recipeSources(row),
      });
      if (error) throw error;

      if (sync?.status === 'conflict') {
        if (adoptManualConflict(row, sync?.item, sync?.reason)) changed = true;
        conflicts += 1;
        continue;
      }

      if (!sync?.item?.id) throw new Error('Atomická synchronizace receptu nepotvrdila položku.');
      if (adoptRecipeRemote(row, sync.item)) changed = true;
      synced += 1;
    }

    return { synced, conflicts, changed };
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

  async function repairRemoteRecipeRows(remoteRows) {
    let repaired = 0;
    for (const row of remoteRows || []) {
      const fix = legacyRecipeRepair(row);
      if (!fix) continue;
      const { data: sync, error } = await db.rpc('sync_own_shopping_list_recipe_item', {
        p_source_item_id: row.id,
        p_custom_name: fix.custom_name,
        p_recipe_ids: [],
      });
      if (error) throw error;
      if (sync?.status === 'conflict' || !sync?.item?.id) continue;
      Object.assign(row, sync.item);
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

  async function loadOwnerSnapshot(ownerId) {
    const { data:list, error:listError } = await db.from('shopping_lists')
      .select('id')
      .eq('user_id', ownerId)
      .eq('is_archived', false)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    if (listError) throw listError;
    if (!list?.id) return { list:null, remoteRows:[], repairedRemote:0 };

    const fetchRows = async () => {
      const { data, error } = await db.from('shopping_list_items')
        .select('id,product_id,selected_offer_id,custom_name,quantity,unit,is_completed,created_at,updated_at,is_recipe,recipe_ids')
        .eq('shopping_list_id', list.id)
        .order('created_at');
      if (error) throw error;
      return data || [];
    };

    let remoteRows = await fetchRows();
    const repairedRemote = await repairRemoteRecipeRows(remoteRows);
    if (repairedRemote > 0) remoteRows = await fetchRows();
    return { list, remoteRows, repairedRemote };
  }

  async function sync(userId) {
    const ownerId = String(userId || '').trim();
    if (!ownerId) return { changed:false, reason:'guest' };

    const localRows = readLocalRows();
    let snapshot = await loadOwnerSnapshot(ownerId);

    // Nejdřív respektuj smazání z jiného zařízení. Teprve řádky, které po
    // tomto kroku zůstaly, smějí projít recipe RPC a případně vytvořit cloud.
    let nextRows = reconcileBeforeMerge(localRows, snapshot.remoteRows);
    const removedBeforeRecipeSync = localRows.length - nextRows.length;

    // Cloud-only recepty musí být v localStorage označené jako recipe ještě
    // před tím, než hlavní shopping-list merge načte obecné custom řádky.
    let hydration = hydrateRemoteRecipeRows(nextRows, snapshot.remoteRows);
    nextRows = hydration.rows;

    const recipeSync = await syncLocalRecipeRows(nextRows);
    let repairedRemote = snapshot.repairedRemote;
    if (recipeSync.changed) {
      snapshot = await loadOwnerSnapshot(ownerId);
      repairedRemote += snapshot.repairedRemote;
      nextRows = reconcileBeforeMerge(nextRows, snapshot.remoteRows);
      const finalHydration = hydrateRemoteRecipeRows(nextRows, snapshot.remoteRows);
      nextRows = finalHydration.rows;
      hydration = {
        changed: hydration.changed || finalHydration.changed,
        added: hydration.added + finalHydration.added,
        adopted: hydration.adopted + finalHydration.adopted
      };
    }

    const removed = localRows.length - nextRows.length + hydration.added;
    const changed = removedBeforeRecipeSync > 0 || recipeSync.changed || hydration.changed;
    if (changed) {
      localStorage.setItem(LIST_KEY, JSON.stringify(nextRows));
      window.SlevaoPublic?.updateNavCount?.();
    }
    if (!changed && !repairedRemote) return { changed:false, reason:'current' };

    return {
      changed:true,
      removed:Math.max(0, localRows.length - nextRows.length + hydration.added),
      removed_before_recipe_sync:removedBeforeRecipeSync,
      repaired_remote:repairedRemote,
      recipe_synced:recipeSync.synced,
      recipe_conflicts:recipeSync.conflicts,
      remote_recipe_added:hydration.added,
      remote_recipe_adopted:hydration.adopted,
      rows:nextRows
    };
  }

  window.SlevaoShoppingOwnerColdSync = {
    itemKey,
    recipeSources,
    adoptRecipeRemote,
    createRemoteRecipeLocalRow,
    hydrateRemoteRecipeRows,
    adoptManualConflict,
    syncLocalRecipeRows,
    legacyRecipeRepair,
    reconcileBeforeMerge,
    loadOwnerSnapshot,
    sync
  };
})();
