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
  const rowKey = (row) => row?.product_id
    ? `p:${String(row.product_id)}`
    : (norm(row?.custom_name || row?.name) ? `c:${norm(row?.custom_name || row?.name)}` : '');

  Object.defineProperty(Storage.prototype, '__slevaoGuestClaimBridge', {
    value: true,
    configurable: true
  });

  Storage.prototype.setItem = function setItem(key, value) {
    if (this === window.localStorage && key === ACTIVE_USER_KEY) {
      const currentUserId = String(previousGetItem.call(this, ACTIVE_USER_KEY) || '').trim();
      const nextUserId = String(value || '').trim();
      if (nextUserId && !currentUserId) {
        const guestRows = parseRows(previousGetItem.call(this, LIST_KEY));
        const result = previousSetItem.call(this, key, value);
        if (!guestRows.length) return result;

        const guestByKey = new Map(guestRows.map((row) => [rowKey(row), row]).filter(([rowKeyValue]) => rowKeyValue));
        const claimedRows = parseRows(previousGetItem.call(this, LIST_KEY));
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
  };
})();