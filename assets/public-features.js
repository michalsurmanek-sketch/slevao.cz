(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const LEGACY_LIST_KEY = 'slevao-shopping-list-v1';
  const LIST_KEY_PREFIX = 'slevao-shopping-list-v2:';
  const ACTIVE_USER_KEY = 'slevao-active-user-v1';
  const PENDING_ALERT_KEY = 'slevao-pending-price-alert';
  let supabasePromise = null;
  let toastTimer = 0;
  let activeReportOfferId = null;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const uid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  function parseRows(raw) {
    try {
      const value = JSON.parse(raw || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function activeOwner() {
    const userId = String(localStorage.getItem(ACTIVE_USER_KEY) || '').trim();
    return userId ? `user:${userId}` : 'guest';
  }

  function storageKey(owner = activeOwner()) {
    return `${LIST_KEY_PREFIX}${String(owner || 'guest')}`;
  }

  function migrateLegacyGuest() {
    const guestKey = storageKey('guest');
    if (localStorage.getItem(guestKey) !== null) return;
    const legacyRaw = localStorage.getItem(LEGACY_LIST_KEY);
    if (legacyRaw === null) return;
    const legacyRows = parseRows(legacyRaw);
    if (legacyRows.some((row) => row?.server_id)) return;
    try {
      localStorage.setItem(guestKey, JSON.stringify(legacyRows));
      localStorage.removeItem(LEGACY_LIST_KEY);
    } catch {}
  }

  function read(owner = activeOwner()) {
    if (owner === 'guest') migrateLegacyGuest();
    try { return parseRows(localStorage.getItem(storageKey(owner))); } catch { return []; }
  }

  function write(rows, owner = activeOwner()) {
    try { localStorage.setItem(storageKey(owner), JSON.stringify(Array.isArray(rows) ? rows : [])); } catch {}
    updateNavCount();
  }

  function clear(owner = activeOwner()) {
    try { localStorage.removeItem(storageKey(owner)); } catch {}
    updateNavCount();
  }

  function setActiveUser(userId) {
    const normalized = String(userId || '').trim();
    try {
      if (normalized) localStorage.setItem(ACTIVE_USER_KEY, normalized);
      else localStorage.removeItem(ACTIVE_USER_KEY);
    } catch {}
    updateNavCount();
  }

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

  function animateListAddition(button, offer) {
    const desktopTarget = document.querySelector('.shoppingListShortcut');
    const mobileTarget = document.querySelector('.slevaoBottomNav a[href*="seznam"]');
    const target = desktopTarget && getComputedStyle(desktopTarget).display !== 'none' ? desktopTarget : mobileTarget;
    const card = button.closest('.dealCard,.deal');
    const sourceImage = card?.querySelector('.dealMedia img,.dealTop img,img');
    const product = Array.isArray(offer?.products) ? offer.products[0] : offer?.products;
    const imageUrl = sourceImage?.currentSrc || sourceImage?.src || offer?.image_url || product?.image_url || '';

    button.classList.add('is-added');
    const originalLabel = button.getAttribute('data-sf-original-label') || button.textContent.trim();
    button.setAttribute('data-sf-original-label', originalLabel);
    button.textContent = 'Přidáno ✓';

    if (target) {
      const label = target.querySelector('.shoppingListShortcutLabel');
      const originalTargetLabel = label?.textContent || '';
      target.classList.remove('is-receiving');
      void target.offsetWidth;
      target.classList.add('is-receiving');

      let badge = target.querySelector('.shoppingListShortcutBadge');
      if (!badge) {
        badge = document.createElement('em');
        badge.className = 'shoppingListShortcutBadge';
        badge.setAttribute('aria-hidden', 'true');
        target.appendChild(badge);
      }
      badge.textContent = '+1';
      badge.classList.remove('show');
      void badge.offsetWidth;
      badge.classList.add('show');
      if (label) label.textContent = 'Produkt přidán ✓';

      if (!matchMedia('(prefers-reduced-motion: reduce)').matches && imageUrl) {
        const start = (sourceImage || button).getBoundingClientRect();
        const end = target.getBoundingClientRect();
        const flyer = document.createElement('img');
        flyer.className = 'shoppingListFly';
        flyer.src = imageUrl;
        flyer.alt = '';
        flyer.style.left = `${start.left + start.width / 2 - 28}px`;
        flyer.style.top = `${start.top + start.height / 2 - 28}px`;
        document.body.appendChild(flyer);
        const dx = end.left + end.width / 2 - (start.left + start.width / 2);
        const dy = end.top + end.height / 2 - (start.top + start.height / 2);
        flyer.animate([
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          { transform: `translate(${dx * .55}px,${dy * .25 - 38}px) scale(.78)`, opacity: 1, offset: .55 },
          { transform: `translate(${dx}px,${dy}px) scale(.22)`, opacity: .18 }
        ], { duration: 760, easing: 'cubic-bezier(.2,.8,.25,1)', fill: 'forwards' })
          .finished.catch(() => {}).finally(() => flyer.remove());
      }

      clearTimeout(target._sfFeedbackTimer);
      target._sfFeedbackTimer = setTimeout(() => {
        target.classList.remove('is-receiving');
        badge?.classList.remove('show');
        if (label && originalTargetLabel) label.textContent = originalTargetLabel;
      }, 1900);
    }

    clearTimeout(button._sfFeedbackTimer);
    button._sfFeedbackTimer = setTimeout(() => {
      button.classList.remove('is-added');
      button.textContent = originalLabel;
    }, 1700);
  }

  function addItemFromOffer(offer) {
    if (!offer) return false;
    const rows = read();
    const product = Array.isArray(offer.products) ? offer.products[0] : offer.products;
    const store = Array.isArray(offer.stores) ? offer.stores[0] : offer.stores;
    const key = offer.product_id ? `p:${offer.product_id}` : `o:${offer.id}`;
    const found = rows.find((row) => row.key === key && !row.completed);
    const now = new Date().toISOString();
    if (found) {
      found.quantity = Number(found.quantity || 1) + 1;
      found.selected_offer_id = offer.id || found.selected_offer_id || null;
      found.price = Number(offer.price || 0);
      found.store_id = offer.store_id || store?.id || null;
      found.store_name = store?.name || null;
      found.store_slug = store?.slug || null;
      found.image_url = offer.image_url || product?.image_url || found.image_url || null;
      found.brand = product?.brand || found.brand || null;
      found.quantity_text = product?.quantity_text || found.quantity_text || null;
      found.updated_at = now;
    } else {
      rows.push({
        local_id: uid(), key, product_id: offer.product_id || null, selected_offer_id: offer.id,
        name: product?.name || offer.title || 'Produkt', custom_name: null,
        brand: product?.brand || null, quantity_text: product?.quantity_text || null,
        quantity: 1, unit: 'ks', completed: false, price: Number(offer.price || 0),
        store_id: offer.store_id || store?.id || null, store_name: store?.name || null,
        store_slug: store?.slug || null, image_url: offer.image_url || product?.image_url || null,
        added_at: now, updated_at: now
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

  async function submitHomeReport(event) {
    const button = event.target.closest('#sendReport');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    button.disabled = true;
    try {
      const typeValue = document.getElementById('reportType')?.value || 'Jiný problém';
      const typeMap = {
        'Cena neplatí':'wrong_price', 'Špatná fotografie':'wrong_image',
        'Nesprávná gramáž':'wrong_quantity', 'Akce skončila':'expired',
        'Produkt není dostupný':'unavailable', 'Jiný problém':'other'
      };
      const offer = activeReportOfferId ? await restOffer(activeReportOfferId) : null;
      const db = await getSupabase();
      const { data: { session } } = await db.auth.getSession();
      const note = String(document.getElementById('reportNote')?.value || '').slice(0, 2000);
      const { error } = await db.from('offer_reports').insert({
        offer_id: offer?.id || null,
        product_id: offer?.product_id || null,
        user_id: session?.user?.id || null,
        report_type: typeMap[typeValue] || 'other',
        note,
        page_url: location.href,
        status: 'new'
      });
      if (error) throw error;
      const modal = document.getElementById('reportModal');
      if (modal) modal.hidden = true;
      document.body.style.overflow = '';
      const noteField = document.getElementById('reportNote');
      if (noteField) noteField.value = '';
      activeReportOfferId = null;
      toast('Děkujeme. Hlášení bylo uloženo ke kontrole.');
    } catch (error) {
      toast(error?.message || 'Hlášení se nepodařilo uložit.');
    } finally {
      button.disabled = false;
    }
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

  document.addEventListener('click', (event) => {
    const reportTrigger = event.target.closest('[data-report-id]');
    if (reportTrigger) activeReportOfferId = reportTrigger.dataset.reportId || null;
    if (event.target.closest('#footerReport')) activeReportOfferId = null;
    submitHomeReport(event);
  }, true);

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
        animateListAddition(add, offer);
        toast('Produkt byl přidán do nákupního seznamu.');
      } else if (detail) {
        const detailProduct = Array.isArray(offer.products) ? offer.products[0] : offer.products;
        if (!offer.product_id || !detailProduct?.id) throw new Error('Produkt zatím nemá dostupný samostatný detail.');
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

  const listStorage = {
    activeOwner,
    storageKey,
    read,
    write,
    clear,
    setActiveUser,
    readGuest: () => read('guest'),
    clearGuest: () => clear('guest')
  };
  window.SlevaoListStorage = listStorage;
  window.SlevaoPublic = { readList: read, writeList: write, addItemFromOffer, getSupabase, toast, updateNavCount, listStorage };

  window.addEventListener('storage', (event) => {
    if (event.key === ACTIVE_USER_KEY || String(event.key || '').startsWith(LIST_KEY_PREFIX)) updateNavCount();
  });

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