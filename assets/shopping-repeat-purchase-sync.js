(() => {
  'use strict';

  const LIST_KEY = 'slevao-shopping-list-v1';
  const HISTORY_KEY = 'slevao-shopping-history-v1';
  const REPEAT_PENDING_KEY = 'slevao-shopping-repeat-pending-v1';
  const db = window.SlevaoSupabase?.getClient?.();
  if (!db || !document.querySelector('.sfListLayout')) return;

  let busy = false;
  const pendingRepeatMemory = new Map();

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

  function createMutationId() {
    const source = globalThis.crypto;
    if (source?.randomUUID) return source.randomUUID();
    if (!source?.getRandomValues) throw new Error('Prohlížeč neumí bezpečně vytvořit identifikátor změny.');
    const bytes = new Uint8Array(16);
    source.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function repeatMutationKey(userId, purchaseId) {
    return `${String(userId || '').trim()}:${String(purchaseId || '').trim()}`;
  }

  function readPendingRepeats() {
    const value = readJson(REPEAT_PENDING_KEY, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function rememberRepeatMutation(userId, purchaseId) {
    const key = repeatMutationKey(userId, purchaseId);
    if (!key || key.startsWith(':') || key.endsWith(':')) throw new Error('Nákup se nepodařilo bezpečně identifikovat.');

    const stored = readPendingRepeats();
    const known = String(stored[key] || pendingRepeatMemory.get(key) || '').trim();
    if (known) {
      pendingRepeatMemory.set(key, known);
      return known;
    }

    const mutationId = createMutationId();
    pendingRepeatMemory.set(key, mutationId);
    stored[key] = mutationId;
    try { localStorage.setItem(REPEAT_PENDING_KEY, JSON.stringify(stored)); } catch {}
    return mutationId;
  }

  function clearRepeatMutation(userId, purchaseId, mutationId) {
    const key = repeatMutationKey(userId, purchaseId);
    if (!key) return;
    if (pendingRepeatMemory.get(key) === mutationId) pendingRepeatMemory.delete(key);
    try {
      const stored = readPendingRepeats();
      if (String(stored[key] || '') !== String(mutationId || '')) return;
      delete stored[key];
      if (Object.keys(stored).length) localStorage.setItem(REPEAT_PENDING_KEY, JSON.stringify(stored));
      else localStorage.removeItem(REPEAT_PENDING_KEY);
    } catch {}
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

  async function repeatCloudPurchase(purchaseId, userId = '') {
    let ownerId = String(userId || '').trim();
    if (!ownerId) {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;
      ownerId = String(data?.session?.user?.id || '').trim();
    }
    if (!ownerId) throw new Error('Přihlášení je vyžadováno.');

    const mutationId = rememberRepeatMutation(ownerId, purchaseId);
    const { data, error } = await db.rpc('repeat_shopping_purchase', {
      p_purchase_id: purchaseId,
      p_mutation_id: mutationId
    });
    if (error) throw error;
    clearRepeatMutation(ownerId, purchaseId, mutationId);
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
        await repeatCloudPurchase(card.dataset.purchaseId, session.user.id);
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
    createMutationId,
    rememberRepeatMutation,
    clearRepeatMutation,
    repeatGuestPurchase,
    repeatCloudPurchase
  };
})();
