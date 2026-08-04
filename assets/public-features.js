(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const LIST_KEY = 'slevao-shopping-list-v1';
  const PENDING_ALERT_KEY = 'slevao-pending-price-alert';
  let supabasePromise = null;
  let toastTimer = 0;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const read = () => { try { const rows = JSON.parse(localStorage.getItem(LIST_KEY) || '[]'); return Array.isArray(rows) ? rows : []; } catch { return []; } };
  const write = (rows) => { try { localStorage.setItem(LIST_KEY, JSON.stringify(rows)); } catch {} updateNavCount(); };
  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  async function getSupabase() {
    if (!supabasePromise) {
      supabasePromise = import('https://esm.sh/@supabase/supabase-js@2').then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_KEY));
    }
    return supabasePromise;
  }

  async function restOffer(id) {
    const params = new URLSearchParams({
      select: 'id,product_id,store_id,title,price,old_price,image_url,valid_from,valid_to,products(id,name,brand,quantity_text,image_url,slug),stores(id,name,slug)',
      id: `eq.${id}`,
      limit: '1'
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/offers?${params}`, { headers: { apikey: SUPABASE_KEY }, cache: 'no-store' });
    if (!response.ok) throw new Error(`Nabídku se nepodařilo načíst (${response.status}).`);
    return (await response.json())[0] || null;
  }

  function toast(message) {
    let box = document.querySelector('.sfToast');
    if (!box) {
      box = document.createElement('div');
      box.className = 'sfToast';
      box.setAttribute('role', 'status');
      box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    box.textContent = message;
    box.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('show'), 3000);
  }

  function addItemFromOffer(offer) {
    if (!offer) return false;
    const rows = read();
    const product = Array.isArray(offer.products) ? offer.products[0] : offer.products;
    const store = Array.isArray(offer.stores) ? offer.stores[0] : offer.stores;
    const key = offer.product_id ? `p:${offer.product_id}` : `o:${offer.id}`;
    const found = rows.find((row) => row.key === key && !row.completed);
    if (found) {
      found.quantity = Number(found.quantity || 1) + 1;
      found.updated_at = new Date().toISOString();
    } else {
      rows.push({
        local_id: uid(), key, product_id: offer.product_id || null, selected_offer_id: offer.id,
        name: product?.name || offer.title || 'Produkt', custom_name: null,
        brand: product?.brand || null, quantity_text: product?.quantity_text || null,
        quantity: 1, unit: 'ks', completed: false, price: Number(offer.price || 0),
        store_id: offer.store_id || store?.id || null, store_name: store?.name || null,
        store_slug: store?.slug || null, image_url: offer.image_url || product?.image_url || null,
        added_at: new Date().toISOString(), updated_at: new Date().toISOString()
      });
    }
    write(rows);
    return true;
  }

  function updateNavCount() {
    const count = read().filter((row) => !row.completed).reduce((sum, row) => sum + Number(row.quantity || 1), 0);
    document.querySelectorAll('[data-sf-list-count]').forEach((node) => { node.textContent = count ? String(count) : ''; node.hidden = !count; });
  }

  function bottomNav() {
    if (document.querySelector('.slevaoBottomNav')) return;
    const path = location.pathname.split('/').pop() || 'index.html';
    const nav = document.createElement('nav');
    nav.className = 'slevaoBottomNav';
    nav.setAttribute('aria-label', 'Hlavní mobilní navigace');
    const items = [
      ['index.html','⌂','Domů', path === '' || path === 'index.html'],
      ['index.html#dealsSection','⌕','Hledat', false],
      ['index.html#leafletsSection','▤','Letáky', false],
      ['seznam.html','✓','Seznam', path === 'seznam.html'],
      ['ucet.html','○','Účet', path === 'ucet.html']
    ];
    nav.innerHTML = items.map(([href,icon,label,active]) => `<a href="${href}" class="${active ? 'active' : ''}"><span>${icon}</span>${label}${label === 'Seznam' ? '<b data-sf-list-count hidden></b>' : ''}</a>`).join('');
    document.body.appendChild(nav);
    updateNavCount();
  }

  function modalBase(title, eyebrow = 'Slevao.cz') {
    const modal = document.createElement('div');
    modal.className = 'sfModal';
    modal.innerHTML = `<div class="sfModalBox" role="dialog" aria-modal="true"><div class="sfModalHead"><div><small>${esc(eyebrow)}</small><h2>${esc(title)}</h2></div><button class="sfModalClose" type="button" aria-label="Zavřít">×</button></div><div class="sfModalBody"></div></div>`;
    modal.querySelector('.sfModalClose').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
    document.body.appendChild(modal);
    return modal;
  }

  async function alertForOffer(offer) {
    const product = Array.isArray(offer.products) ? offer.products[0] : offer.products;
    if (!offer?.product_id) { toast('Tento produkt zatím není sjednocený a hlídač nelze vytvořit.'); return; }
    const modal = modalBase('Hlídat cenu produktu', 'Cenový hlídač');
    const body = modal.querySelector('.sfModalBody');
    body.innerHTML = `<p><strong>${esc(product?.name || offer.title)}</strong></p><p class="sfMuted">Aktuální cena: ${money(offer.price)} Kč</p><label>Upozorni mě při ceně nejvýše<input id="sfTargetPrice" type="number" min="0.01" step="0.1" value="${esc(Math.max(1, Math.floor(Number(offer.price || 0) * .9)))}"></label><label><input id="sfOnlyStore" type="checkbox"> Pouze v obchodě ${esc((Array.isArray(offer.stores) ? offer.stores[0] : offer.stores)?.name || '')}</label><div class="sfModalActions"><button class="sfButton" type="button" data-cancel>Zrušit</button><button class="sfButton primary" type="button" data-save>Zapnout hlídač</button></div>`;
    body.querySelector('[data-cancel]').addEventListener('click', () => modal.remove());
    body.querySelector('[data-save]').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const target = Number(body.querySelector('#sfTargetPrice').value || 0);
      if (!(target > 0)) { toast('Zadej cílovou cenu.'); return; }
      button.disabled = true;
      try {
        const db = await getSupabase();
        const { data: { session } } = await db.auth.getSession();
        const payload = {
          product_id: offer.product_id, search_term: product?.name || offer.title,
          target_price: target, store_id: body.querySelector('#sfOnlyStore').checked ? offer.store_id : null,
          offer_id: offer.id, return_url: location.href
        };
        if (!session) {
          localStorage.setItem(PENDING_ALERT_KEY, JSON.stringify(payload));
          location.href = `ucet.html?redirect=${encodeURIComponent(location.href)}`;
          return;
        }
        const { error } = await db.from('price_alerts').insert({
          user_id: session.user.id, product_id: payload.product_id, search_term: payload.search_term,
          target_price: payload.target_price, store_id: payload.store_id, is_active: true
        });
        if (error) throw error;
        modal.remove();
        toast(`Hlídač je zapnutý pro cenu do ${money(target)} Kč.`);
      } catch (error) {
        button.disabled = false;
        toast(error?.message || 'Hlídač se nepodařilo vytvořit.');
      }
    });
  }

  function offerIdFromCard(card) {
    return card.querySelector('[data-save-id]')?.dataset.saveId
      || card.querySelector('[data-favorite]')?.dataset.favorite
      || card.querySelector('[data-report-id]')?.dataset.reportId
      || null;
  }

  function enhanceCard(card) {
    if (card.dataset.sfEnhanced === '1') return;
    const offerId = offerIdFromCard(card);
    if (!offerId) return;
    card.dataset.sfEnhanced = '1';
    const target = card.querySelector('.dealActions') || card.querySelector('.body') || card.querySelector('.dealBody') || card;
    const actions = document.createElement('div');
    actions.className = 'slevaoExtraActions';
    actions.innerHTML = `<button type="button" class="sfPrimary" data-sf-add="${esc(offerId)}">＋ Do seznamu</button><button type="button" data-sf-detail="${esc(offerId)}">Detail a ceny</button><button type="button" data-sf-alert="${esc(offerId)}">Hlídat cenu</button>`;
    target.appendChild(actions);
  }

  function enhanceAll(root = document) {
    root.querySelectorAll?.('.dealCard,.deal').forEach(enhanceCard);
  }

  document.addEventListener('click', async (event) => {
    const add = event.target.closest('[data-sf-add]');
    const detail = event.target.closest('[data-sf-detail]');
    const alert = event.target.closest('[data-sf-alert]');
    const control = add || detail || alert;
    if (!control) return;
    event.preventDefault();
    control.disabled = true;
    try {
      const offer = await restOffer(control.dataset.sfAdd || control.dataset.sfDetail || control.dataset.sfAlert);
      if (!offer) throw new Error('Nabídka už není dostupná.');
      if (add) {
        addItemFromOffer(offer);
        toast('Produkt byl přidán do nákupního seznamu.');
      } else if (detail) {
        if (!offer.product_id) throw new Error('Produkt zatím nemá samostatný detail.');
        location.href = `produkt.html?id=${encodeURIComponent(offer.product_id)}`;
      } else {
        await alertForOffer(offer);
      }
    } catch (error) {
      toast(error?.message || 'Akci se nepodařilo dokončit.');
    } finally {
      if (control.isConnected) control.disabled = false;
    }
  });

  window.SlevaoPublic = { readList: read, writeList: write, addItemFromOffer, getSupabase, toast, updateNavCount };

  function init() {
    bottomNav();
    enhanceAll();
    const observer = new MutationObserver((records) => records.forEach((record) => record.addedNodes.forEach((node) => {
      if (!(node instanceof Element)) return;
      if (node.matches('.dealCard,.deal')) enhanceCard(node);
      enhanceAll(node);
    })));
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
