(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const PAGE_SIZE = 100;

  function init() {
    if (window.__slevaoAdminOffersFullListLoaded || !window.supabase || !document.getElementById('offers')) return;
    window.__slevaoAdminOffersFullListLoaded = true;

    const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    const $ = (id) => document.getElementById(id);
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
    const today = () => new Date().toISOString().slice(0, 10);
    let rows = [];
    let filtered = [];
    let page = 0;
    let loading = false;

    function installUi() {
      if ($('adminOfferPager')) return;
      const list = $('offers');
      list.insertAdjacentHTML('afterend', `
        <div id="adminOfferPager" class="adminOfferPager" hidden>
          <button id="adminOfferPrev" class="btn light" type="button">← Předchozí</button>
          <span id="adminOfferPageInfo">1/1</span>
          <button id="adminOfferNext" class="btn light" type="button">Další →</button>
        </div>`);
      const style = document.createElement('style');
      style.textContent = `
        .adminOfferPager{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:16px;padding-top:14px;border-top:1px solid var(--line,#dbe8e5)}
        .adminOfferPager[hidden]{display:none}.adminOfferPager span{min-width:160px;text-align:center;font-weight:900;color:var(--muted,#64748b)}
        .adminOfferLoading{padding:28px;text-align:center;color:var(--muted,#64748b)}
        .adminOfferSummary{margin:0 0 12px;color:var(--muted,#64748b);font-size:13px;font-weight:800}
      `;
      document.head.append(style);
      $('adminOfferPrev').addEventListener('click', () => { if (page > 0) { page -= 1; render(); } });
      $('adminOfferNext').addEventListener('click', () => {
        if ((page + 1) * PAGE_SIZE < filtered.length) { page += 1; render(); }
      });
    }

    async function requireStaff() {
      const { data, error } = await db.auth.getSession();
      const role = data.session?.user?.app_metadata?.role || '';
      if (error || !data.session || !['admin', 'editor'].includes(role)) throw new Error('Přihlášení vypršelo nebo účet nemá oprávnění.');
      return data.session;
    }

    function offerHtml(offer) {
      const status = esc(offer.status || 'review');
      const store = esc(offer.stores?.name || 'Neznámý obchod');
      const price = Number(offer.price || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
      const oldPrice = offer.old_price ? Number(offer.old_price).toLocaleString('cs-CZ', { maximumFractionDigits: 2 }) : '';
      const trash = offer.status === 'trash';
      return `<div class="item ${trash ? 'criticalTrashItem' : ''}" data-full-offer="${esc(offer.id)}">
        <div>
          <span class="pill ${status}">${status}</span>
          <h3>${esc(offer.title || 'Bez názvu')}</h3>
          <div><b>${price} Kč</b>${oldPrice ? ` <small class="muted"><s>${oldPrice} Kč</s></small>` : ''}</div>
          <small class="muted">${store} · ${esc(offer.valid_from || '—')} až ${esc(offer.valid_to || '—')}</small>
        </div>
        <div class="actions">
          ${trash
            ? `<button data-critical-restore="${esc(offer.id)}">Obnovit</button>`
            : `<button data-edit="${esc(offer.id)}">Upravit</button>
               <button data-copy="${esc(offer.id)}">Kopírovat</button>
               <button data-status="published" data-id="${esc(offer.id)}">Publikovat</button>
               <button data-status="expired" data-id="${esc(offer.id)}">Ukončit</button>
               <button class="danger" data-delete="${esc(offer.id)}">Do koše</button>`}
        </div>
      </div>`;
    }

    function applySearch() {
      const query = String($('offerSearch')?.value || '').trim().toLowerCase();
      filtered = rows.filter((offer) => !query
        || String(offer.title || '').toLowerCase().includes(query)
        || String(offer.stores?.name || '').toLowerCase().includes(query));
      page = 0;
      render();
    }

    function render() {
      installUi();
      const list = $('offers');
      const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      page = Math.min(page, totalPages - 1);
      const start = page * PAGE_SIZE;
      const visible = filtered.slice(start, start + PAGE_SIZE);
      list.innerHTML = `<div class="adminOfferSummary">Celkem ${filtered.length.toLocaleString('cs-CZ')} nabídek · zobrazeno ${visible.length.toLocaleString('cs-CZ')}</div>`
        + (visible.map(offerHtml).join('') || '<p class="muted">Žádné nabídky neodpovídají hledání.</p>');
      $('adminOfferPager').hidden = filtered.length <= PAGE_SIZE;
      $('adminOfferPageInfo').textContent = `Strana ${page + 1} z ${totalPages}`;
      $('adminOfferPrev').disabled = page === 0;
      $('adminOfferNext').disabled = page >= totalPages - 1;
    }

    async function loadAll() {
      if (loading) return;
      loading = true;
      installUi();
      $('offers').innerHTML = '<div class="adminOfferLoading">Načítám kompletní seznam nabídek…</div>';
      try {
        await requireStaff();
        const output = [];
        for (let from = 0; from < 50000; from += 1000) {
          const result = await db.from('offers')
            .select('id,product_id,store_id,category_id,title,price,old_price,image_url,status,valid_from,valid_to,published_at,created_at,stores(name)')
            .order('created_at', { ascending: false })
            .range(from, from + 999);
          if (result.error) throw result.error;
          output.push(...(result.data || []));
          if ((result.data || []).length < 1000) break;
        }
        rows = output;
        applySearch();
      } catch (error) {
        $('offers').innerHTML = `<p class="muted">${esc(error?.message || 'Kompletní seznam se nepodařilo načíst.')}</p>`;
      } finally {
        loading = false;
      }
    }

    function openEdit(id) {
      const offer = rows.find((item) => item.id === id);
      if (!offer) return;
      $('editId').value = offer.id;
      $('editTitle').value = offer.title || '';
      $('editStore').value = offer.store_id || '';
      $('editPrice').value = offer.price ?? '';
      $('editOldPrice').value = offer.old_price ?? '';
      $('editImage').value = offer.image_url || '';
      $('editFrom').value = offer.valid_from || '';
      $('editTo').value = offer.valid_to || '';
      $('editStatus').value = offer.status === 'trash' ? 'review' : (offer.status || 'draft');
      $('editMsg').className = 'msg';
      $('editMsg').textContent = '';
      $('editModal').classList.remove('hidden');
    }

    async function copyOffer(id) {
      const offer = rows.find((item) => item.id === id);
      if (!offer) return;
      if (!confirm(`Vytvořit kopii nabídky „${offer.title}“ jako koncept?`)) return;
      try {
        await requireStaff();
        const result = await db.from('offers').insert({
          product_id: offer.product_id,
          store_id: offer.store_id,
          category_id: offer.category_id || null,
          title: `${offer.title} – kopie`,
          price: offer.price,
          old_price: offer.old_price,
          image_url: offer.image_url,
          valid_from: offer.valid_from,
          valid_to: offer.valid_to,
          status: 'draft',
          is_verified: true,
          published_at: null,
        });
        if (result.error) throw result.error;
        await loadAll();
      } catch (error) {
        alert(error?.message || 'Kopii se nepodařilo vytvořit.');
      }
    }

    async function setStatus(id, status) {
      const offer = rows.find((item) => item.id === id);
      if (!offer) return;
      if (status === 'published' && offer.valid_to && offer.valid_to < today()) {
        alert(`Nabídku nelze publikovat. Platnost skončila ${offer.valid_to}.`);
        return;
      }
      try {
        await requireStaff();
        const result = await db.from('offers').update({
          status,
          published_at: status === 'published' ? new Date().toISOString() : null,
        }).eq('id', id).select('id').maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) throw new Error('Databáze změnu nepotvrdila.');
        await loadAll();
      } catch (error) {
        alert(error?.message || 'Stav nabídky se nepodařilo změnit.');
      }
    }

    window.addEventListener('click', (event) => {
      const reload = event.target.closest?.('#reload');
      if (reload) {
        event.preventDefault();
        event.stopImmediatePropagation();
        loadAll();
        return;
      }

      const edit = event.target.closest?.('[data-edit]');
      if (edit && edit.closest('#offers')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openEdit(edit.dataset.edit);
        return;
      }

      const copy = event.target.closest?.('[data-copy]');
      if (copy && copy.closest('#offers')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        copyOffer(copy.dataset.copy);
        return;
      }

      const status = event.target.closest?.('[data-status][data-id]');
      if (status && status.closest('#offers')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setStatus(status.dataset.id, status.dataset.status);
      }
    }, true);

    window.addEventListener('input', (event) => {
      if (event.target?.id !== 'offerSearch') return;
      event.stopImmediatePropagation();
      applySearch();
    }, true);

    db.auth.onAuthStateChange((_event, session) => {
      const role = session?.user?.app_metadata?.role || '';
      if (['admin', 'editor'].includes(role)) setTimeout(loadAll, 100);
    });
    db.auth.getSession().then(({ data }) => {
      const role = data.session?.user?.app_metadata?.role || '';
      if (['admin', 'editor'].includes(role)) setTimeout(loadAll, 150);
    });
  }

  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
