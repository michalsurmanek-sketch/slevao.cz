(() => {
  'use strict';

  const LIST_KEY = 'slevao-shopping-list-v1';
  const CLAIM_QUANTITY = '__slevao_guest_claim_quantity';
  const CLAIM_COMPLETED = '__slevao_guest_claim_completed';
  const db = window.SlevaoSupabase?.getClient?.();
  if (!db || window.SlevaoShoppingGuestProductFallback) return;

  const norm = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  function readRows() {
    try {
      const rows = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  function rowKey(row) {
    if (row?.product_id) return `p:${String(row.product_id)}`;
    const custom = norm(row?.custom_name || row?.name);
    return custom ? `c:${custom}` : '';
  }

  function positiveQuantity(value) {
    const quantity = Number(value);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  }

  function collapseLocalRows(rows) {
    const result = [];
    const byKey = new Map();

    for (const source of rows || []) {
      const row = { ...source };
      const key = rowKey(row);
      if (!key || row?.server_id) {
        result.push(row);
        continue;
      }

      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, row);
        result.push(row);
        continue;
      }

      existing.quantity = positiveQuantity(existing.quantity) + positiveQuantity(row.quantity);
      existing.completed = Boolean(existing.completed && row.completed);

      const existingClaim = Number(existing?.[CLAIM_QUANTITY]);
      const nextClaim = Number(row?.[CLAIM_QUANTITY]);
      if (Number.isFinite(existingClaim) || Number.isFinite(nextClaim)) {
        existing[CLAIM_QUANTITY] = (Number.isFinite(existingClaim) ? existingClaim : positiveQuantity(existing.quantity) - positiveQuantity(row.quantity))
          + (Number.isFinite(nextClaim) ? nextClaim : positiveQuantity(row.quantity));
        existing[CLAIM_COMPLETED] = Boolean(existing?.[CLAIM_COMPLETED] && row?.[CLAIM_COMPLETED]);
      }
    }

    return result;
  }

  async function sync() {
    const rows = readRows();
    const localProductRows = rows.filter((row) => row?.product_id && !row?.server_id);
    const productIds = [...new Set(localProductRows.map((row) => String(row.product_id || '').trim()).filter(Boolean))];
    if (!productIds.length) return { changed:false, reason:'no-local-products' };

    const { data, error } = await db.from('products')
      .select('id')
      .in('id', productIds);
    if (error) throw error;

    const existingIds = new Set((data || []).map((row) => String(row?.id || '')).filter(Boolean));
    let changed = false;
    const repaired = rows.map((source) => {
      if (!source?.product_id || source?.server_id || existingIds.has(String(source.product_id))) return source;
      const label = String(source?.name || source?.custom_name || 'Položka').trim() || 'Položka';
      changed = true;
      return {
        ...source,
        product_id:null,
        selected_offer_id:null,
        custom_name:label,
        name:label,
        key:`c:${norm(label)}`
      };
    });

    if (!changed) return { changed:false, reason:'all-products-exist' };

    const collapsed = collapseLocalRows(repaired);
    localStorage.setItem(LIST_KEY, JSON.stringify(collapsed));
    window.SlevaoPublic?.updateNavCount?.();
    return {
      changed:true,
      repaired:repaired.filter((row, index) => row !== rows[index]).length,
      rows:collapsed
    };
  }

  window.SlevaoShoppingGuestProductFallback = {
    norm,
    rowKey,
    collapseLocalRows,
    sync
  };
})();
