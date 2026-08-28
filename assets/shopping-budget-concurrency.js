(() => {
  'use strict';

  const db = window.SlevaoSupabase?.getClient?.();
  if (!db || db.__slevaoBudgetConcurrencyGuard) return;

  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const sharedMode = Boolean(query.get('share') || hash.get('share'));
  if (sharedMode) return;

  const originalFrom = db.from.bind(db);
  const sameBudget = (left, right) => Math.abs(Number(left || 0) - Number(right || 0)) < 0.001;
  const normalizeBudget = (value) => {
    const parsed = Math.max(0, Number(value || 0));
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const formatBudget = (value) => {
    const normalized = normalizeBudget(value);
    return normalized > 0 ? String(Number(normalized.toFixed(2))) : '';
  };

  let userId = '';
  let state = null;
  let statePromise = null;
  let syncing = false;
  let replaying = false;
  let skipNextBudgetWrite = false;

  function mockBudgetWrite() {
    const result = Promise.resolve({ data:null, error:null });
    const builder = {
      eq() { return builder; },
      select() { return builder; },
      maybeSingle() { return result; },
      single() { return result; },
      then(resolve, reject) { return result.then(resolve, reject); },
      catch(reject) { return result.catch(reject); },
      finally(callback) { return result.finally(callback); }
    };
    return builder;
  }

  db.from = function guardedFrom(table) {
    const builder = originalFrom(table);
    if (table !== 'shopping_lists' || !builder || typeof builder.update !== 'function') return builder;

    const originalUpdate = builder.update.bind(builder);
    builder.update = (values, ...args) => {
      if (skipNextBudgetWrite && values && Object.prototype.hasOwnProperty.call(values, 'budget')) {
        skipNextBudgetWrite = false;
        return mockBudgetWrite();
      }
      return originalUpdate(values, ...args);
    };
    return builder;
  };

  async function fetchActiveList() {
    if (!userId) return null;
    const { data, error } = await originalFrom('shopping_lists')
      .select('id,budget,updated_at,created_at')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('created_at')
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async function ensureState({ attempts = 1 } = {}) {
    if (state?.id) return state;
    if (statePromise) return statePromise;

    statePromise = (async () => {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const current = await fetchActiveList();
        if (current?.id) {
          state = {
            id: current.id,
            budget: normalizeBudget(current.budget),
            updated_at: current.updated_at || null
          };
          return state;
        }
        if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 350));
      }
      return null;
    })();

    try {
      return await statePromise;
    } finally {
      statePromise = null;
    }
  }

  async function persistBudget(nextBudget, allowRetry = true) {
    const currentState = await ensureState({ attempts: 1 });
    if (!currentState?.id || !userId) throw new Error('Aktivní nákupní seznam zatím není připravený. Zkus rozpočet uložit znovu.');

    const next = normalizeBudget(nextBudget);
    let request = originalFrom('shopping_lists')
      .update({ budget: next || null })
      .eq('id', currentState.id)
      .eq('user_id', userId);
    if (currentState.updated_at) request = request.eq('updated_at', currentState.updated_at);

    const { data, error } = await request
      .select('id,budget,updated_at')
      .maybeSingle();
    if (error) throw error;

    if (data?.id) {
      state = {
        id: data.id,
        budget: normalizeBudget(data.budget),
        updated_at: data.updated_at || currentState.updated_at || null
      };
      return { conflict:false, state:{ ...state } };
    }

    const latest = await fetchActiveList();
    if (!latest?.id) throw new Error('Aktivní nákupní seznam už není dostupný.');
    const latestState = {
      id: latest.id,
      budget: normalizeBudget(latest.budget),
      updated_at: latest.updated_at || null
    };

    if (sameBudget(latestState.budget, next)) {
      state = latestState;
      return { conflict:false, state:{ ...state } };
    }

    if (allowRetry && sameBudget(latestState.budget, currentState.budget)) {
      state = latestState;
      return persistBudget(next, false);
    }

    state = latestState;
    return { conflict:true, state:{ ...state } };
  }

  function replayBudgetChange(input, { suppressToast = false } = {}) {
    const publicApi = window.SlevaoPublic;
    const originalToast = suppressToast && publicApi?.toast ? publicApi.toast : null;
    if (originalToast) publicApi.toast = () => {};

    skipNextBudgetWrite = true;
    replaying = true;
    try {
      input.dispatchEvent(new Event('change', { bubbles:true }));
    } finally {
      replaying = false;
      window.setTimeout(() => {
        skipNextBudgetWrite = false;
        if (originalToast && window.SlevaoPublic) window.SlevaoPublic.toast = originalToast;
      }, 0);
    }
  }

  async function handleBudgetEvent(event) {
    const input = event.target;
    if (!input || input.id !== 'shoppingBudget' || replaying || !userId) return;

    event.stopImmediatePropagation();
    if (syncing) return;
    syncing = true;

    try {
      if (!state?.id) await ensureState({ attempts: 6 });
      if (!state?.id) throw new Error('Rozpočet se zatím nepodařilo připojit ke cloudovému seznamu. Zkus to znovu.');

      const requestedBudget = normalizeBudget(input.value);
      const result = await persistBudget(requestedBudget);
      if (result.conflict) {
        input.value = formatBudget(result.state.budget);
        replayBudgetChange(input, { suppressToast:true });
        window.setTimeout(() => {
          window.SlevaoPublic?.toast?.('Rozpočet byl mezitím změněn na jiném zařízení. Načetl jsem aktuální hodnotu.');
        }, 0);
        return;
      }

      input.value = formatBudget(result.state.budget);
      replayBudgetChange(input);
    } catch (error) {
      input.value = formatBudget(state?.budget || 0);
      window.SlevaoPublic?.toast?.(error.message || 'Rozpočet se nepodařilo uložit.');
    } finally {
      syncing = false;
    }
  }

  document.addEventListener('change', handleBudgetEvent, true);
  document.addEventListener('blur', handleBudgetEvent, true);

  db.__slevaoBudgetConcurrencyGuard = true;
  window.SlevaoShoppingBudgetConcurrency = {
    normalizeBudget,
    persistBudget,
    getState: () => state ? { ...state } : null
  };

  (async () => {
    try {
      const { data, error } = await db.auth.getSession();
      if (error) throw error;
      userId = String(data?.session?.user?.id || '');
      if (userId) await ensureState({ attempts: 6 });
    } catch {
      userId = '';
      state = null;
    }
  })();
})();