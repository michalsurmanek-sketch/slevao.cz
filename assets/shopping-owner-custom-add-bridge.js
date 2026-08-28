(() => {
  'use strict';

  const ACTIVE_USER_KEY = 'slevao-active-user-v1';
  const sharedQuery = new URLSearchParams(location.search);
  const sharedHash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const sharedMode = Boolean(sharedQuery.get('share') || sharedHash.get('share'));
  if (sharedMode || !document.querySelector('.sfListLayout')) return;

  const db = window.SlevaoSupabase?.getClient?.();
  if (!db) return;

  let handling = false;
  let bypass = false;

  function markedUserId() {
    try { return String(localStorage.getItem(ACTIVE_USER_KEY) || '').trim(); }
    catch { return ''; }
  }

  function showMessage(text, bad = false) {
    const element = document.getElementById('listMessage');
    if (!element) return;
    element.textContent = String(text || '');
    element.style.color = bad ? '#b32631' : '#0b7a58';
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

  function forwardOriginal(source) {
    bypass = true;
    try {
      if (source === 'enter') {
        document.getElementById('customName')?.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          bubbles: true,
          cancelable: true,
        }));
      } else {
        document.getElementById('addCustom')?.click();
      }
    } finally {
      bypass = false;
    }
  }

  async function addOwnerCustom(source) {
    if (handling) return;
    const button = document.getElementById('addCustom');
    const nameInput = document.getElementById('customName');
    const quantityInput = document.getElementById('customQuantity');
    if (!button || !nameInput || !quantityInput || button.disabled) return;

    const name = String(nameInput.value || '').trim();
    const quantity = Math.max(0.01, Number(quantityInput.value || 1));
    if (!name) {
      nameInput.focus();
      return;
    }

    handling = true;
    const originallyDisabled = button.disabled;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');

    try {
      const { data:{ session }, error:sessionError } = await db.auth.getSession();
      if (sessionError) throw sessionError;

      if (!session?.user?.id) {
        button.disabled = originallyDisabled;
        button.removeAttribute('aria-busy');
        handling = false;
        forwardOriginal(source);
        return;
      }

      const mutationId = createMutationId();
      const { error } = await db.rpc('add_own_shopping_list_custom_item', {
        p_custom_name: name,
        p_quantity: quantity,
        p_unit: 'ks',
        p_mutation_id: mutationId,
      });
      if (error) throw error;

      nameInput.value = '';
      quantityInput.value = '1';
      showMessage('Položka byla bezpečně přidána. Načítám aktuální seznam.');
      location.reload();
    } catch (error) {
      showMessage(error?.message || 'Položku se nepodařilo přidat.', true);
      button.disabled = originallyDisabled;
      button.removeAttribute('aria-busy');
      handling = false;
    }
  }

  document.addEventListener('click', (event) => {
    if (bypass || !markedUserId()) return;
    const button = event.target?.closest?.('#addCustom');
    if (!button || button.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    addOwnerCustom('click');
  }, true);

  document.addEventListener('keydown', (event) => {
    if (bypass || !markedUserId() || event.key !== 'Enter' || event.target?.id !== 'customName') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    addOwnerCustom('enter');
  }, true);
})();
