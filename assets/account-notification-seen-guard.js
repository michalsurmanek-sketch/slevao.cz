(() => {
  'use strict';

  const LEGACY_SEEN_KEY = 'slevao-seen-live-notifications';
  const SEEN_KEY_PREFIX = 'slevao-seen-live-notifications-v2:';
  const ACTIVE_USER_KEY = 'slevao-active-user-v1';

  if (Storage.prototype.__slevaoNotificationSeenGuard) return;

  const previousGetItem = Storage.prototype.getItem;
  const previousSetItem = Storage.prototype.setItem;
  const previousRemoveItem = Storage.prototype.removeItem;

  function scopedSeenKey(storage) {
    if (storage !== window.localStorage) return '';
    const userId = String(previousGetItem.call(storage, ACTIVE_USER_KEY) || '').trim();
    return userId ? `${SEEN_KEY_PREFIX}${userId}` : '';
  }

  Object.defineProperty(Storage.prototype, '__slevaoNotificationSeenGuard', {
    value: true,
    configurable: true
  });

  Storage.prototype.getItem = function getItem(key) {
    if (this === window.localStorage && key === LEGACY_SEEN_KEY) {
      const scopedKey = scopedSeenKey(this);
      return scopedKey ? previousGetItem.call(this, scopedKey) : null;
    }
    return previousGetItem.call(this, key);
  };

  Storage.prototype.setItem = function setItem(key, value) {
    if (this === window.localStorage && key === LEGACY_SEEN_KEY) {
      const scopedKey = scopedSeenKey(this);
      if (!scopedKey) return;
      if (!('Notification' in window) || window.Notification.permission !== 'granted') return;
      return previousSetItem.call(this, scopedKey, String(value));
    }
    return previousSetItem.call(this, key, String(value));
  };

  Storage.prototype.removeItem = function removeItem(key) {
    if (this === window.localStorage && key === LEGACY_SEEN_KEY) {
      const scopedKey = scopedSeenKey(this);
      if (!scopedKey) return;
      return previousRemoveItem.call(this, scopedKey);
    }
    return previousRemoveItem.call(this, key);
  };
})();
