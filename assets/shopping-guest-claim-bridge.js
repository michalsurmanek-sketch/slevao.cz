(() => {
  'use strict';

  const ACTIVE_USER_KEY = 'slevao-active-user-v1';
  const LIST_KEY = 'slevao-shopping-list-v1';
  const CLAIM_QUANTITY = '__slevao_guest_claim_quantity';
  const CLAIM_COMPLETED = '__slevao_guest_claim_completed';

  if (Storage.prototype.__slevaoGuestClaimBridge) return;

  const previousGetItem = Storage.prototype.getItem;
  const previousSetItem = Storage.prototype.setItem;

  const parseRows = (raw) => {
    try {
      const value = JSON.parse(raw || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };
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

  const recipeIds = (row) => [...new Set([
    row?.recipe_id,
    ...(Array.isArray(row?.recipe_ids) ? row.recipe_ids : [])
  ].map((value) => String(value || '').trim()).filter(Boolean))];

  function mergeGuestRows(currentRows, guestRows) {
    const merged = (Array.isArray(currentRows) ? currentRows : []).map((row) => ({ ...row }));
    const byKey = new Map(merged.map((row) => [rowKey(row), row]).filter(([key]) => key));

    for (const source of Array.isArray(guestRows) ? guestRows : []) {
      const key = rowKey(source);
      if (!key) continue;
      const existing = byKey.get(key);
      if (existing) {
        existing.quantity = Math.max(Number(existing.quantity || 1), Number(source.quantity || 1));
        existing.completed = Boolean(existing.completed && source.completed);
        if (rowKind(existing) === 'recipe') {
          existing.source = 'recipe';
          existing.recipe_ids = [...new Set([...recipeIds(existing), ...recipeIds(source)])];
        }
        continue;
      }

      const copy = {
        ...source,
        local_id: source.local_id || crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`
      };
      delete copy.server_id;
      merged.push(copy);
      byKey.set(key, copy);
    }
    return merged;
  }

  Object.defineProperty(Storage.prototype, '__slevaoGuestClaimBridge', {
    value: true,
    configurable: true
  });

  Storage.prototype.setItem = function setItem(key, value) {
    if (this === window.localStorage && key === ACTIVE_USER_KEY) {
      const currentUserId = String(previousGetItem.call(this, ACTIVE_USER_KEY) || '').trim();
      const nextUserId = String(value || '').trim();
      if (nextUserId && !currentUserId) {
        const guestRaw = previousGetItem.call(this, LIST_KEY);
        const guestRows = parseRows(guestRaw);
        if (!guestRows.length) return previousSetItem.call(this, key, value);

        // Owner bridge historically merges custom rows only by display name.
        // Clear the guest scope before switching owners so that name-only merge
        // cannot convert a manual row into a recipe row (or vice versa). Then
        // merge the captured guest snapshot ourselves with provenance-aware keys.
        previousSetItem.call(this, LIST_KEY, '[]');
        let result;
        try {
          result = previousSetItem.call(this, key, value);
        } catch (error) {
          previousSetItem.call(this, LIST_KEY, guestRaw || '[]');
          throw error;
        }

        const currentRows = parseRows(previousGetItem.call(this, LIST_KEY));
        const claimedRows = mergeGuestRows(currentRows, guestRows);
        const guestByKey = new Map(guestRows.map((row) => [rowKey(row), row]).filter(([rowKeyValue]) => rowKeyValue));
        let changed = false;
        for (const row of claimedRows) {
          const source = guestByKey.get(rowKey(row));
          if (!source) continue;
          row[CLAIM_QUANTITY] = Math.max(0.01, Number(source.quantity || 1));
          row[CLAIM_COMPLETED] = Boolean(source.completed);
          changed = true;
        }
        if (changed) previousSetItem.call(this, LIST_KEY, JSON.stringify(claimedRows));
        return result;
      }
    }
    return previousSetItem.call(this, key, value);
  };

  window.SlevaoGuestClaimBridge = {
    quantityKey: CLAIM_QUANTITY,
    completedKey: CLAIM_COMPLETED,
    rowKind,
    rowKey,
    mergeGuestRows,
  };
})();