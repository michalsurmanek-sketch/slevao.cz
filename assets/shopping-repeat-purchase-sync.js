(() => {
  'use strict';

  const LIST_KEY = 'slevao-shopping-list-v1';
  const HISTORY_KEY = 'slevao-shopping-history-v1';
  const db = window.SlevaoSupabase?.getClient?.();
  if (!db || !document.querySelector('.sfListLayout')) return;

  let busy = false;

  const norm = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function positiveQuantity(value) {
    const quantity = Number(value);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  }

  function rowFromSnapshot(item) {
    return {
      local_id: crypto.randomUUID?.() || `row-${Date.now()}-${Math.random()}`,
      product_id: item?.product_id || null,
      selected_offer_id: null,
      custom_name: item?.product_id ? null : (item?.custom_name || item?.name || 'Položka'),
      name: item?.name || item?.custom_name || 'Položka',
      brand: item?.brand || null,
      quantity_text: item?.quantity_text || null,
      quantity: positiveQuantity(item?.quantity),
      unit: item?.unit || 'ks',
      completed: false,
      added_at: new Date().toISOString()
    };
  }

  function repeatGuestPurchase(purchase) {
    const items = Array.isArray(purchase?.items) ? purchase.items : [];
    if (!items.length) throw new Error('Dokončený nákup neobsahuje žádné položky.');

    const current = readJson(LIST_KEY, []);
    const rows = Array.isArray(current) ? current : [];
    const map = new Map(rows.map((row) => [
      row?.product_id ? `p:${row.product_id}` : `c:${norm(row?.custom_name || row?.name)}`,
      row
    ]));

    for (const item of items) {
      const key = item?.product_id
        ? `p:${item.product_id}`
        : `c:${norm(item?.custom_name || item?.name)}`;
      if (key.endsWith(':')) continue;
      const existing = map.get(key);
      if (existing) {
        existing.quantity = positiveQuantity(existing.quantity) + positiveQuantity(item?.quantity);
        existing.completed = false;
        continue;
      }
      const row = rowFromSnapshot(item);
      rows.push(row);
      map.set(key, row);
    }

    localStorage.setItem(LIST_KEY, JSON.stringify(rows));
    window.SlevaoPublic?.updateNavCount?.();
    return rows;
  }

  function localPurchase(purchaseId) {
    const history = readJson(HISTORY_KEY, []);
    return (Array.isArray(history) ? history : [])
      .find((purchase) => String(purchase?.id) === String(purchaseId)) || null;
  }

  async function repeatCloudPurchase(purchaseId) {
    const { data, error } = await db.rpc('repeat_shopping_purchase', {
      p_purchase_id: purchaseId
    });
    if (error) throw error;
    return data || null;
  }

  async function handleRepeatClick(event) {
    const button = event.target?.closest?.('[data-repeat-purchase]');
    if (!button) return;
    const card = button.closest?.('[data-purchase-id]');
    if (!card?.dataset?.purchaseId) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    if (busy) return;

    busy = true;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = 'Vracím do seznamu…';

    try {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;
      const session = data?.session || null;

      if (session?.user?.id) {
        await repeatCloudPurchase(card.dataset.purchaseId);
      } else {
        const purchase = localPurchase(card.dataset.purchaseId);
        if (!purchase) throw new Error('Dokončený nákup se nepodařilo najít.');
        repeatGuestPurchase(purchase);
      }

      window.SlevaoPublic?.toast?.('Položky byly vráceny do nákupního seznamu.');
      window.setTimeout(() => location.reload(), 350);
    } catch (error) {
      busy = false;
      button.disabled = false;
      button.textContent = originalText;
      window.SlevaoPublic?.toast?.(error?.message || 'Nákup se nepodařilo zopakovat.');
    }
  }

  document.addEventListener('click', handleRepeatClick, true);

  window.SlevaoRepeatPurchaseSync = {
    norm,
    positiveQuantity,
    repeatGuestPurchase,
    repeatCloudPurchase
  };
})();
