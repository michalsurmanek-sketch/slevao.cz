(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';

  const script = document.createElement('script');
  script.src = `assets/admin-store-delete-hotfix.js?v=20260803-2-${Date.now()}`;
  script.async = false;
  script.dataset.adminStoreDeleteHotfix = 'true';
  script.onerror = () => {
    const message = document.getElementById('storeDeleteMessage');
    if (message) {
      message.textContent = 'Oprava mazání obchodů se nepodařila načíst. Obnov stránku přes Ctrl+F5.';
      message.className = 'storeDeleteMessage error';
    }
  };
  document.head.append(script);

  if (!document.querySelector('script[data-homepage-image-nav]')) {
    const navScript = document.createElement('script');
    navScript.src = `assets/admin-homepage-image-nav.js?v=20260802-1-${Date.now()}`;
    navScript.async = false;
    navScript.dataset.homepageImageNav = 'true';
    document.head.append(navScript);
  }

  window.addEventListener('DOMContentLoaded', () => {
    if (!window.supabase || !document.getElementById('app')) return;

    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const $ = (id) => document.getElementById(id);
    const nullable = (value) => String(value || '').trim() || null;
    const today = () => new Date().toISOString().slice(0, 10);
    let pendingStoreSlug = '';

    function clearPublicCache() {
      try {
        Object.keys(localStorage)
          .filter((key) => key.startsWith('slevao-public-data-') || key === 'slevao-home-v2-data')
          .forEach((key) => localStorage.removeItem(key));
      } catch { /* Úložiště může být vypnuté. */ }
    }

    function setMessage(id, text, type = 'ok') {
      const box = $(id);
      if (!box) return;
      box.textContent = text;
      box.className = `msg ${type}`;
    }

    async function requireStaff() {
      const { data, error } = await db.auth.getSession();
      const role = data.session?.user?.app_metadata?.role || '';
      if (error || !data.session) throw new Error('Přihlášení vypršelo. Přihlas se znovu.');
      if (!['admin', 'editor'].includes(role)) throw new Error('Účet nemá oprávnění upravovat obsah.');
      return data.session;
    }

    async function refreshStats() {
      const [offers, published, stores, activeStores, categories] = await Promise.all([
        db.from('offers').select('id', { count: 'exact', head: true }).neq('status', 'trash'),
        db.from('offers').select('id', { count: 'exact', head: true }).eq('status', 'published'),
        db.from('stores').select('id', { count: 'exact', head: true }),
        db.from('stores').select('id', { count: 'exact', head: true }).eq('is_active', true),
        db.from('categories').select('id', { count: 'exact', head: true }),
      ]);
      if ($('sOffers')) $('sOffers').textContent = offers.error ? '—' : (offers.count ?? 0).toLocaleString('cs-CZ');
      if ($('sPublished')) $('sPublished').textContent = published.error ? '—' : (published.count ?? 0).toLocaleString('cs-CZ');
      if ($('sStores')) $('sStores').textContent = stores.error || activeStores.error ? '—' : `${activeStores.count ?? 0}/${stores.count ?? 0}`;
      if ($('sCategories')) $('sCategories').textContent = categories.error ? '—' : (categories.count ?? 0).toLocaleString('cs-CZ');
    }

    async function moveOfferToTrash(id) {
      if (!id || !confirm('Přesunout nabídku do bezpečného koše? Nabídku bude možné obnovit.')) return;
      try {
        await requireStaff();
        let error = null;
        const rpc = await db.rpc('admin_trash_offer', { target_offer_id: id });
        if (rpc.error) {
          const fallback = await db.from('offers')
            .update({ status: 'trash', published_at: null })
            .eq('id', id)
            .select('id')
            .maybeSingle();
          error = fallback.error || (!fallback.data ? new Error('Databáze změnu nepotvrdila.') : null);
        }
        if (error) throw error;
        clearPublicCache();
        $('reload')?.click();
        await refreshStats();
      } catch (error) {
        alert(`Nabídka nebyla smazána ani přesunuta. Data zůstala zachována.\n\n${error?.message || 'Bezpečný koš není v databázi aktivní.'}`);
      }
    }

    async function restoreOfferSafely(id) {
      if (!id) return;
      try {
        await requireStaff();
        const rpc = await db.rpc('admin_restore_offer', { target_offer_id: id });
        if (rpc.error) {
          const current = await db.from('offers').select('id,valid_to').eq('id', id).maybeSingle();
          if (current.error) throw current.error;
          if (!current.data) throw new Error('Nabídka už neexistuje.');
          const fallbackStatus = current.data.valid_to && current.data.valid_to < today() ? 'expired' : 'review';
          const fallback = await db.from('offers')
            .update({ status: fallbackStatus, published_at: null })
            .eq('id', id)
            .select('id')
            .maybeSingle();
          if (fallback.error) throw fallback.error;
          if (!fallback.data) throw new Error('Databáze obnovení nepotvrdila.');
        }
        clearPublicCache();
        $('reload')?.click();
        await refreshStats();
      } catch (error) {
        alert(error?.message || 'Nabídku se nepodařilo obnovit z koše.');
      }
    }

    async function saveEditedOffer() {
      const button = $('editSave');
      const id = $('editId')?.value;
      const title = $('editTitle')?.value.trim();
      const storeId = $('editStore')?.value;
      const price = Number($('editPrice')?.value);
      const oldPrice = $('editOldPrice')?.value ? Number($('editOldPrice').value) : null;
      const validFrom = $('editFrom')?.value;
      const validTo = $('editTo')?.value;
      const status = $('editStatus')?.value || 'draft';

      if (!id || !title || !storeId || !Number.isFinite(price) || price <= 0 || !validFrom || !validTo) {
        setMessage('editMsg', 'Vyplň název, obchod, kladnou cenu a platnost.', 'err');
        return;
      }
      if (oldPrice !== null && (!Number.isFinite(oldPrice) || oldPrice < price)) {
        setMessage('editMsg', 'Původní cena nesmí být nižší než akční cena.', 'err');
        return;
      }
      if (validFrom > validTo) {
        setMessage('editMsg', 'Datum začátku nesmí být po datu konce.', 'err');
        return;
      }
      if (status === 'published' && validTo < today()) {
        setMessage('editMsg', 'Prošlou nabídku nelze publikovat. Uprav datum platnosti nebo ji ponech ukončenou.', 'err');
        return;
      }

      button.disabled = true;
      button.textContent = 'Ukládám…';
      try {
        await requireStaff();
        const payload = {
          title,
          store_id: storeId,
          price,
          old_price: oldPrice,
          image_url: nullable($('editImage')?.value),
          valid_from: validFrom,
          valid_to: validTo,
          status,
          published_at: status === 'published' ? new Date().toISOString() : null,
        };
        const { data, error } = await db.from('offers').update(payload).eq('id', id).select('id').maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Databáze změnu nepotvrdila.');
        clearPublicCache();
        setMessage('editMsg', 'Změny byly bezpečně uloženy.');
        $('reload')?.click();
        await refreshStats();
        setTimeout(() => $('editModal')?.classList.add('hidden'), 550);
      } catch (error) {
        setMessage('editMsg', error?.message || 'Změny se nepodařilo uložit.', 'err');
      } finally {
        button.disabled = false;
        button.textContent = 'Uložit změny';
      }
    }

    async function preventExpiredPublishing(button, event) {
      const id = button.dataset.id;
      if (!id) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        const { data, error } = await db.from('offers').select('id,title,valid_to').eq('id', id).maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Nabídka už neexistuje.');
        if (data.valid_to && data.valid_to < today()) {
          alert(`Nabídku „${data.title || 'bez názvu'}“ nelze publikovat, protože její platnost skončila ${data.valid_to}.`);
          return;
        }
        const { error: updateError } = await db.from('offers')
          .update({ status: 'published', published_at: new Date().toISOString() })
          .eq('id', id);
        if (updateError) throw updateError;
        clearPublicCache();
        $('reload')?.click();
        await refreshStats();
      } catch (error) {
        alert(error?.message || 'Publikaci se nepodařilo dokončit.');
      }
    }

    document.addEventListener('click', (event) => {
      const remove = event.target.closest('[data-delete]');
      if (remove) {
        event.preventDefault();
        event.stopImmediatePropagation();
        moveOfferToTrash(remove.dataset.delete);
        return;
      }

      const restore = event.target.closest('[data-critical-restore]');
      if (restore) {
        event.preventDefault();
        event.stopImmediatePropagation();
        restoreOfferSafely(restore.dataset.criticalRestore);
        return;
      }

      const editSave = event.target.closest('#editSave');
      if (editSave) {
        event.preventDefault();
        event.stopImmediatePropagation();
        saveEditedOffer();
        return;
      }

      const publish = event.target.closest('[data-status="published"][data-id]');
      if (publish) {
        preventExpiredPublishing(publish, event);
        return;
      }

      const storeSave = event.target.closest('#storeSave');
      if (storeSave) pendingStoreSlug = String($('storeSlug')?.value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    }, true);

    const storeMessage = $('storeMsg');
    if (storeMessage) {
      new MutationObserver(() => {
        if (!pendingStoreSlug || !/Obchod byl přidán/i.test(storeMessage.textContent || '')) return;
        const slug = pendingStoreSlug;
        pendingStoreSlug = '';
        storeMessage.className = 'msg ok';
        storeMessage.innerHTML = `Obchod byl přidán. Veřejná stránka funguje automaticky. <a href="obchod.html?store=${encodeURIComponent(slug)}" target="_blank" rel="noopener">Otevřít stránku obchodu ↗</a>`;
      }).observe(storeMessage, { childList: true, characterData: true, subtree: true });
    }
  });
})();
