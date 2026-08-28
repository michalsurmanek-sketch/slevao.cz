(() => {
  'use strict';

  const LIST_KEY = 'slevao-shopping-list-v1';
  const ACTIVE_USER_KEY = 'slevao-active-user-v1';
  const SNAPSHOT_TTL_MS = 30000;
  const sharedQuery = new URLSearchParams(location.search);
  const sharedHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const sharedMode = Boolean(sharedQuery.get('share') || sharedHash.get('share'));
  if (sharedMode || !document.querySelector('.sfListLayout')) return;

  const db = window.SlevaoSupabase?.getClient?.();
  if (!db || db.__slevaoOwnerItemSemanticCas) return;

  const nativeFrom = db.from.bind(db);
  const nativeRpc = db.rpc.bind(db);
  const expectedById = new Map();
  let batchExpected = null;
  let reloadQueued = false;

  function markedUserId() {
    try { return String(localStorage.getItem(ACTIVE_USER_KEY) || '').trim(); }
    catch { return ''; }
  }

  function readRows() {
    try {
      const value = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function semanticRow(row) {
    return {
      id: String(row?.server_id || ''),
      quantity: Math.max(0.01, Number(row?.quantity || 1)),
      unit: row?.unit || 'ks',
      is_completed: Boolean(row?.completed),
      selected_offer_id: row?.selected_offer_id || null,
    };
  }

  function snapshotAll() {
    expectedById.clear();
    const now = Date.now();
    const rows = readRows();
    for (const row of rows) {
      if (!row?.server_id) continue;
      const expected = semanticRow(row);
      expectedById.set(expected.id, { at:now, expected });
    }
    return rows;
  }

  function snapshotBatchCompleted() {
    const rows = snapshotAll();
    const now = Date.now();
    const expected = rows
      .filter((row) => row?.server_id && row?.completed)
      .map(semanticRow);
    batchExpected = { at:now, rows:new Map(expected.map((row) => [row.id, row])) };
  }

  function consumeExpected(itemId) {
    const id = String(itemId || '');
    const entry = expectedById.get(id) || null;
    expectedById.clear();
    if (!entry || Date.now() - entry.at > SNAPSHOT_TTL_MS) return null;
    return entry.expected;
  }

  function consumeBatch(ids) {
    const entry = batchExpected;
    batchExpected = null;
    expectedById.clear();
    if (!entry || Date.now() - entry.at > SNAPSHOT_TTL_MS) return null;
    const rows = [];
    for (const id of ids || []) {
      const expected = entry.rows.get(String(id));
      if (!expected) return null;
      rows.push(expected);
    }
    return rows;
  }

  function mutationError(message, code = 'SLEVAO_ITEM_CONFLICT') {
    return { message, code };
  }

  function queueCurrentStateReload(message = 'Seznam se mezitím změnil na jiném zařízení. Načítám aktuální stav.') {
    if (reloadQueued) return;
    reloadQueued = true;
    const text = String(message);
    window.SlevaoPublic?.toast?.(text);
    const inline = document.getElementById('listMessage');
    if (inline) {
      inline.textContent = text;
      inline.style.color = '#b32631';
    }
    window.setTimeout(() => location.reload(), 0);
  }

  function callValue(calls, method, field) {
    const call = calls.find(([name, args]) => name === method && String(args?.[0]) === String(field));
    return call ? call[1][1] : undefined;
  }

  function onlyMethods(calls, allowed) {
    return calls.every(([name]) => allowed.has(name));
  }

  async function executeNative(operation, payload, calls) {
    let query = nativeFrom('shopping_list_items');
    query = operation === 'update' ? query.update(payload) : query.delete();
    for (const [name, args] of calls) {
      if (typeof query?.[name] !== 'function') throw new Error(`Unsupported shopping-list query method: ${name}`);
      query = query[name](...args);
    }
    return await query;
  }

  async function executeSingle(operation, payload, calls, itemId, listId) {
    const expected = consumeExpected(itemId);
    if (!expected) {
      queueCurrentStateReload('Aktuální stav položky se nepodařilo bezpečně ověřit. Načítám seznam znovu.');
      return { data:null, error:mutationError('Aktuální stav položky se nepodařilo bezpečně ověřit.', 'SLEVAO_ITEM_UNVERIFIED') };
    }

    const nextQuantity = Object.prototype.hasOwnProperty.call(payload || {}, 'quantity')
      ? Math.max(0.01, Number(payload.quantity || 1))
      : expected.quantity;
    const nextUnit = Object.prototype.hasOwnProperty.call(payload || {}, 'unit')
      ? (payload.unit || 'ks')
      : expected.unit;
    const nextCompleted = Object.prototype.hasOwnProperty.call(payload || {}, 'is_completed')
      ? Boolean(payload.is_completed)
      : expected.is_completed;
    const nextSelectedOffer = Object.prototype.hasOwnProperty.call(payload || {}, 'selected_offer_id')
      ? (payload.selected_offer_id || null)
      : expected.selected_offer_id;

    const { data, error } = await nativeRpc('mutate_owner_shopping_list_item_if_current', {
      p_item_id: itemId,
      p_shopping_list_id: listId,
      p_action: operation,
      p_expected_quantity: expected.quantity,
      p_expected_unit: expected.unit,
      p_expected_is_completed: expected.is_completed,
      p_expected_selected_offer_id: expected.selected_offer_id,
      p_next_quantity: operation === 'update' ? nextQuantity : null,
      p_next_unit: operation === 'update' ? nextUnit : null,
      p_next_is_completed: operation === 'update' ? nextCompleted : null,
      p_next_selected_offer_id: operation === 'update' ? nextSelectedOffer : null,
    });
    if (error) return { data:null, error };

    const status = String(data?.status || '');
    if ((operation === 'update' && status === 'updated') || (operation === 'delete' && status === 'deleted')) {
      return { data:null, error:null };
    }

    if (status === 'conflict' || status === 'missing') {
      queueCurrentStateReload();
      return { data:null, error:mutationError('Položka byla mezitím změněna na jiném zařízení.') };
    }

    return { data:null, error:mutationError('Server nepotvrdil změnu položky.', 'SLEVAO_ITEM_UNEXPECTED') };
  }

  async function executeBatchDelete(calls, ids, listId) {
    const expected = consumeBatch(ids);
    if (!expected) {
      queueCurrentStateReload('Aktuální stav koupených položek se nepodařilo bezpečně ověřit. Načítám seznam znovu.');
      return { data:null, error:mutationError('Aktuální stav koupených položek se nepodařilo bezpečně ověřit.', 'SLEVAO_BATCH_UNVERIFIED') };
    }

    const { data, error } = await nativeRpc('delete_owner_shopping_list_items_if_current', {
      p_shopping_list_id: listId,
      p_expected: expected,
    });
    if (error) return { data:null, error };

    const status = String(data?.status || '');
    if (status === 'deleted') return { data:null, error:null };
    if (status === 'conflict') {
      queueCurrentStateReload();
      return { data:null, error:mutationError('Koupené položky se mezitím změnily na jiném zařízení.') };
    }
    return { data:null, error:mutationError('Server nepotvrdil odstranění koupených položek.', 'SLEVAO_BATCH_UNEXPECTED') };
  }

  function deferredMutation(operation, payload) {
    const calls = [];
    let execution = null;
    let proxy = null;

    const executeOnce = () => {
      if (execution) return execution;
      execution = (async () => {
        if (!markedUserId()) return executeNative(operation, payload, calls);
        if (!onlyMethods(calls, new Set(['eq', 'in']))) return executeNative(operation, payload, calls);

        const listId = callValue(calls, 'eq', 'shopping_list_id');
        const itemId = callValue(calls, 'eq', 'id');
        const ids = callValue(calls, 'in', 'id');
        if (!listId) return executeNative(operation, payload, calls);

        if (itemId && !ids) return executeSingle(operation, payload, calls, itemId, listId);
        if (operation === 'delete' && Array.isArray(ids) && !itemId) {
          return executeBatchDelete(calls, ids, listId);
        }
        return executeNative(operation, payload, calls);
      })();
      return execution;
    };

    const promiseLike = {
      then(onFulfilled, onRejected) { return executeOnce().then(onFulfilled, onRejected); },
      catch(onRejected) { return executeOnce().catch(onRejected); },
      finally(onFinally) { return executeOnce().finally(onFinally); },
    };

    proxy = new Proxy(promiseLike, {
      get(target, property) {
        if (property === Symbol.toStringTag) return 'Promise';
        if (property in target) {
          const value = target[property];
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return (...args) => {
          calls.push([String(property), args]);
          return proxy;
        };
      },
    });
    return proxy;
  }

  function wrappedFrom(table) {
    const base = nativeFrom(table);
    if (String(table) !== 'shopping_list_items') return base;
    return new Proxy(base, {
      get(target, property) {
        if (property === 'update') return (payload) => deferredMutation('update', payload || {});
        if (property === 'delete') return () => deferredMutation('delete', null);
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }

  try {
    db.from = wrappedFrom;
  } catch {
    try {
      Object.defineProperty(db, 'from', { value:wrappedFrom, configurable:true, writable:true });
    } catch {
      return;
    }
  }
  Object.defineProperty(db, '__slevaoOwnerItemSemanticCas', { value:true, configurable:true });

  document.addEventListener('change', (event) => {
    if (!markedUserId()) return;
    if (!event.target?.matches?.('#listItems [data-complete], #listItems [data-quantity]')) return;
    snapshotAll();
  }, true);

  document.addEventListener('click', (event) => {
    if (!markedUserId()) return;
    if (event.target?.closest?.('#clearCompleted')) {
      snapshotBatchCompleted();
      return;
    }
    if (event.target?.closest?.('#listItems [data-delete], #addCustom')) snapshotAll();
  }, true);

  document.addEventListener('keydown', (event) => {
    if (!markedUserId() || event.key !== 'Enter' || event.target?.id !== 'customName') return;
    snapshotAll();
  }, true);

  window.SlevaoOwnerItemSemanticCas = {
    semanticRow,
    snapshotAll,
    snapshotBatchCompleted,
  };
})();
