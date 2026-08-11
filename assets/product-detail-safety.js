(() => {
  'use strict';

  const productId = new URLSearchParams(location.search).get('id');
  if (!productId) return;

  function toast(message) {
    if (window.SlevaoPublic?.toast) {
      window.SlevaoPublic.toast(message);
      return;
    }
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
    window.setTimeout(() => box.classList.remove('show'), 3200);
  }

  function retryHtml(message) {
    return `<div class="sfEmpty sfDetailRetry"><strong>${message}</strong><button class="sfButton primary" type="button" data-product-retry>Načíst znovu</button></div>`;
  }

  async function getDb(timeout = 5000) {
    if (window.SlevaoPublic?.getSupabase) return window.SlevaoPublic.getSupabase();
    const started = Date.now();
    while (Date.now() - started < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      if (window.SlevaoPublic?.getSupabase) return window.SlevaoPublic.getSupabase();
    }
    return null;
  }

  async function verifyZeroOffers() {
    const root = document.getElementById('offers');
    if (!root || root.querySelector('.sfOffer') || root.dataset.safetyChecked === '1') return;
    root.dataset.safetyChecked = '1';
    try {
      const db = await getDb();
      if (!db) return;
      const today = new Intl.DateTimeFormat('en-CA', {
        timeZone:'Europe/Prague', year:'numeric', month:'2-digit', day:'2-digit'
      }).format(new Date());
      const upcoming = new Date(`${today}T12:00:00`);
      upcoming.setDate(upcoming.getDate() + 7);
      const upcomingTo = `${upcoming.getFullYear()}-${String(upcoming.getMonth() + 1).padStart(2,'0')}-${String(upcoming.getDate()).padStart(2,'0')}`;
      const { count, error } = await db.from('offers')
        .select('id', { count:'exact', head:true })
        .eq('product_id', productId)
        .eq('status', 'published')
        .lte('valid_from', upcomingTo)
        .gte('valid_to', today);
      if (error) {
        root.innerHTML = retryHtml('Aktuální nabídky se nepodařilo ověřit.');
        return;
      }
      if (Number(count || 0) > 0 && !root.querySelector('.sfOffer')) {
        root.innerHTML = retryHtml('Nabídky existují, ale při prvním načtení se nepodařily zobrazit.');
      }
    } catch {}
  }

  async function verifyHistory() {
    const info = document.getElementById('historyInfo');
    const chart = document.getElementById('priceChart');
    if (!info || !chart || chart.dataset.safetyChecked === '1') return;
    if (!/zatím není dostupná/i.test(info.textContent || '')) return;
    chart.dataset.safetyChecked = '1';
    try {
      const db = await getDb();
      if (!db) return;
      const { count, error } = await db.from('price_history')
        .select('id', { count:'exact', head:true })
        .eq('product_id', productId);
      if (error) {
        chart.innerHTML = retryHtml('Historii cen se nepodařilo ověřit.');
        return;
      }
      if (Number(count || 0) > 0 && /zatím není dostupná/i.test(info.textContent || '')) {
        chart.innerHTML = retryHtml('Historie existuje, ale při prvním načtení se nepodařila zobrazit.');
      }
    } catch {}
  }

  document.addEventListener('error', (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.closest('#productImage')) return;
    const root = document.getElementById('productImage');
    if (root) root.innerHTML = '<div class="sfEmpty">Fotografie se nepodařila načíst. Ceny a nabídky zůstávají dostupné.</div>';
  }, true);

  document.addEventListener('click', (event) => {
    const retry = event.target.closest('[data-product-retry]');
    if (retry) {
      event.preventDefault();
      location.reload();
      return;
    }

    const add = event.target.closest('[data-add-offer]');
    if (add && typeof window.SlevaoPublic?.addItemFromOffer !== 'function') {
      event.preventDefault();
      event.stopImmediatePropagation();
      toast('Nákupní seznam se nenačetl. Obnov stránku a zkus to znovu.');
    }
  }, true);

  const rootObserver = new MutationObserver(() => {
    const root = document.getElementById('productContent');
    if (!root) return;
    const heading = root.querySelector('h1');
    if (/Produkt se nepodařilo načíst/i.test(heading?.textContent || '') && !root.querySelector('[data-product-retry]')) {
      const panel = heading.closest('.sfPanel,.sfCard') || root;
      const button = document.createElement('button');
      button.className = 'sfButton primary';
      button.type = 'button';
      button.dataset.productRetry = '1';
      button.textContent = 'Zkusit znovu';
      panel.appendChild(button);
    }
  });
  rootObserver.observe(document.documentElement, { childList:true, subtree:true });
  window.setTimeout(() => rootObserver.disconnect(), 15000);

  window.addEventListener('slevao:product-offers-rendered', (event) => {
    if (Number(event.detail?.offerCount || 0) === 0) verifyZeroOffers();
    window.setTimeout(verifyHistory, 250);
  });

  window.setTimeout(() => {
    verifyZeroOffers();
    verifyHistory();
  }, 1500);
})();
