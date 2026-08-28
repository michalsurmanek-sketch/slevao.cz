(() => {
  'use strict';

  const LIST_KEY = 'slevao-shopping-list-v1';

  function safeQuantity(value) {
    const quantity = Number(value);
    if (!Number.isFinite(quantity)) return 1;
    return Math.max(0.01, quantity);
  }

  function sanitizeLocalRows(storage = localStorage) {
    let rows;
    try {
      rows = JSON.parse(storage.getItem(LIST_KEY) || '[]');
    } catch {
      return false;
    }
    if (!Array.isArray(rows)) return false;

    let changed = false;
    const next = rows.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row) || row.quantity == null) return row;
      const numeric = Number(row.quantity);
      if (Number.isFinite(numeric) && numeric >= 0.01) return row;
      changed = true;
      return { ...row, quantity:safeQuantity(row.quantity) };
    });

    if (changed) storage.setItem(LIST_KEY, JSON.stringify(next));
    return changed;
  }

  sanitizeLocalRows();
  window.SlevaoShoppingLocalQuantityGuard = { safeQuantity, sanitizeLocalRows };
})();
