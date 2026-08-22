(() => {
  'use strict';

  const LEGACY_LIST_KEY = 'slevao-shopping-list-v1';
  const LIST_KEY_PREFIX = 'slevao-shopping-list-v2:';
  const ACTIVE_USER_KEY = 'slevao-active-user-v1';

  if (Storage.prototype.__slevaoShoppingListOwnerBridge) return;

  const nativeGetItem = Storage.prototype.getItem;
  const nativeSetItem = Storage.prototype.setItem;
  const nativeRemoveItem = Storage.prototype.removeItem;

  function parseRows(raw) {
    try {
      const value = JSON.parse(raw || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function normalizedName(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function rowKey(row) {
    if (row?.product_id) return `p:${String(row.product_id)}`;
    const name = normalizedName(row?.custom_name || row?.name);
    return name ? `c:${name}` : '';
  }

  function activeUserId() {
    return String(nativeGetItem.call(window.localStorage, ACTIVE_USER_KEY) || '').trim();
  }

  function activeOwner() {
    const userId = activeUserId();
    return userId ? `user:${userId}` : 'guest';
  }

  function storageKey(owner = activeOwner()) {
    return `${LIST_KEY_PREFIX}${String(owner || 'guest')}`;
  }

  function migrateLegacyGuest() {
    const guestKey = storageKey('guest');
    if (nativeGetItem.call(window.localStorage, guestKey) !== null) return;
    const legacyRaw = nativeGetItem.call(window.localStorage, LEGACY_LIST_KEY);
    if (legacyRaw === null) return;
    const legacyRows = parseRows(legacyRaw);
    if (legacyRows.some((row) => row?.server_id)) return;
    nativeSetItem.call(window.localStorage, guestKey, JSON.stringify(legacyRows));
    nativeRemoveItem.call(window.localStorage, LEGACY_LIST_KEY);
  }

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
        continue;
      }
      const copy = { ...source, local_id: source.local_id || crypto.randomUUID?.() || `${Date.now()}-${Math.random()}` };
      delete copy.server_id;
      merged.push(copy);
      byKey.set(key, copy);
    }
    return merged;
  }

  function claimGuestForUser(userId) {
    const normalized = String(userId || '').trim();
    if (!normalized) return;
    migrateLegacyGuest();
    const guestKey = storageKey('guest');
    const guestRows = parseRows(nativeGetItem.call(window.localStorage, guestKey));
    if (!guestRows.length) return;

    const userKey = storageKey(`user:${normalized}`);
    const currentRows = parseRows(nativeGetItem.call(window.localStorage, userKey));
    nativeSetItem.call(window.localStorage, userKey, JSON.stringify(mergeGuestRows(currentRows, guestRows)));
    nativeRemoveItem.call(window.localStorage, guestKey);
  }

  migrateLegacyGuest();

  Object.defineProperty(Storage.prototype, '__slevaoShoppingListOwnerBridge', {
    value: true,
    configurable: true
  });

  Storage.prototype.getItem = function getItem(key) {
    if (this === window.localStorage && key === LEGACY_LIST_KEY) {
      return nativeGetItem.call(this, storageKey());
    }
    return nativeGetItem.call(this, key);
  };

  Storage.prototype.setItem = function setItem(key, value) {
    if (this === window.localStorage && key === ACTIVE_USER_KEY) {
      const nextUserId = String(value || '').trim();
      if (nextUserId && !activeUserId()) claimGuestForUser(nextUserId);
      return nativeSetItem.call(this, key, String(value));
    }
    if (this === window.localStorage && key === LEGACY_LIST_KEY) {
      return nativeSetItem.call(this, storageKey(), String(value));
    }
    return nativeSetItem.call(this, key, String(value));
  };

  Storage.prototype.removeItem = function removeItem(key) {
    if (this === window.localStorage && key === LEGACY_LIST_KEY) {
      return nativeRemoveItem.call(this, storageKey());
    }
    return nativeRemoveItem.call(this, key);
  };

  window.SlevaoListOwnerBridge = {
    activeOwner,
    storageKey,
    migrateLegacyGuest,
    claimGuestForUser
  };
})();
