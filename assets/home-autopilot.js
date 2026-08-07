(() => {
  'use strict';

  const LIST_KEY = 'slevao-shopping-list-v1';
  const MAX_IDS_PER_QUERY = 50;

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[char]));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const localDate = () => {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  };

  function readList() {
    try {
      const value = JSON.parse(localStorage.getItem(LIST_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function activeRows() {
    return readList().filter((row) => !row.completed && !row.is_completed);
  }

  async function publicApi(timeout = 4000) {
    if (window.SlevaoPublic?.getSupabase) return window.SlevaoPublic;
    const started = Date.now();
    while (Date.now() - started < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (window.SlevaoPublic?.getSupabase) return window.SlevaoPublic;
    }
    throw new Error('Datové služby se ještě nenačetly. Zkus výpočet znovu.');
  }

  function chunks(values, size) {
    const output = [];
    for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
    return output;
  }

  async function loadCurrentOffers(productIds) {
    const api = await publicApi();
    const db = await api.getSupabase();
    const today = localDate();
    const output = [];

    for (const ids of chunks(productIds, MAX_IDS_PER_QUERY)) {
      const { data, error } = await db.from('offers')
        .select('id,product_id,store_id,price,old_price,valid_from,valid_to,stores(name,slug)')
        .in('product_id', ids)
        .eq('status', 'published')
        .lte('valid_from', today)
        .gte('valid_to', today)
        .limit(5000);
      if (error) throw error;
      output.push(...(data || []));
    }
    return output;
  }

  function calculate(rows, offers) {
    const byProduct = new Map();
    offers.forEach((offer) => {
      const key = String(offer.product_id || '');
      if (!key) return;
      const price = Number(offer.price || 0);
      if (!(price >= 0)) return;
      const current = byProduct.get(key);
      if (!current || price < Number(current.price || 0)) byProduct.set(key, offer);
    });

    let total = 0;
    let referenceTotal = 0;
    let linked = 0;
    let documentedReference = 0;
    const stores = new Set();

    rows.forEach((row) => {
      if (!row.product_id) return;
      const offer = byProduct.get(String(row.product_id));
      if (!offer) return;
      const quantity = Math.max(0.01, Number(row.quantity || 1));
      const price = Math.max(0, Number(offer.price || 0));
      const oldPrice = Number(offer.old_price || 0);
      total += price * quantity;
      if (oldPrice > price) {
        referenceTotal += oldPrice * quantity;
        documentedReference++;
      } else {
        referenceTotal += price * quantity;
      }
      if (offer.store_id) stores.add(String(offer.store_id));
      linked++;
    });

    return {
      total: Number(total.toFixed(2)),
      savings: Number(Math.max(0, referenceTotal - total).toFixed(2)),
      stores: stores.size,
      linked,
      missing: Math.max(0, rows.length - linked),
      documentedReference
    };
  }

  function initialHtml(count) {
    if (!count) {
      return '<div class="sqAutopilotEmpty"><strong>Košík je zatím prázdný</strong><span>Přidej produkty do seznamu a tady je spočítáme.</span></div>';
    }
    return `<div class="sqAutopilotEmpty"><strong>${count} ${count === 1 ? 'položka čeká' : count < 5 ? 'položky čekají' : 'položek čeká'} na přepočet</strong><span>Výpočet spustíme až po kliknutí, takže nezpomaluje homepage.</span></div>`;
  }

  function renderResult(box, metrics) {
    if (!metrics.linked) {
      box.innerHTML = '<div class="sqAutopilotEmpty"><strong>Pro položky zatím chybí platné ceny</strong><span>Vlastní položky nebo nepropojené produkty do odhadu nevymýšlíme.</span></div>';
      return;
    }
    const savingsClass = metrics.savings > 0 ? 'sqAutopilotGood' : '';
    box.innerHTML = `
      <div class="sqAutopilotStats">
        <div class="sqAutopilotStat primary"><small>Dnes nejlevněji</small><strong>${money(metrics.total)} Kč</strong></div>
        <div class="sqAutopilotStat"><small>Doložená úspora</small><strong class="${savingsClass}">${money(metrics.savings)} Kč</strong></div>
        <div class="sqAutopilotStat"><small>Obchody</small><strong>${metrics.stores}</strong></div>
      </div>
      <p class="sqAutopilotNote">Započítáno ${metrics.linked} položek.${metrics.missing ? ` U ${metrics.missing} položek chybí propojení nebo dnešní cena.` : ''} Úspora se počítá jen tam, kde nabídka obsahuje doloženou původní cenu.</p>`;
  }

  function inject() {
    if (document.getElementById('homeAutopilot')) return;
    const hero = document.querySelector('.hero');
    if (!hero) return;
    const count = activeRows().length;
    const section = document.createElement('section');
    section.id = 'homeAutopilot';
    section.className = 'sqAutopilotSection';
    section.innerHTML = `
      <div class="container">
        <div class="sqAutopilotCard">
          <div class="sqAutopilotCopy">
            <span class="sqAutopilotEyebrow">Nákupní autopilot</span>
            <h2>Kolik stojí tvůj nákup dnes?</h2>
            <p>Vezme položky z tvého existujícího seznamu a z právě platných nabídek spočítá nejnižší dostupné ceny. Bez vymyšlené AI.</p>
            <div class="sqAutopilotActions">
              <button id="sqAutopilotRun" class="sqAutopilotRun" type="button">Spočítat dnešní nákup</button>
              <a class="sqAutopilotOpen" href="seznam.html">Otevřít můj seznam →</a>
            </div>
          </div>
          <div id="sqAutopilotResult" class="sqAutopilotResult" aria-live="polite">${initialHtml(count)}</div>
        </div>
      </div>`;
    hero.after(section);

    const button = section.querySelector('#sqAutopilotRun');
    const result = section.querySelector('#sqAutopilotResult');
    button.addEventListener('click', async () => {
      const rows = activeRows();
      if (!rows.length) {
        result.innerHTML = initialHtml(0);
        return;
      }
      const productIds = [...new Set(rows.map((row) => row.product_id).filter(Boolean).map(String))];
      if (!productIds.length) {
        result.innerHTML = '<div class="sqAutopilotEmpty"><strong>Seznam obsahuje jen vlastní položky</strong><span>Pro přesný výpočet přidej produkty z nabídek Slevao.</span></div>';
        return;
      }
      button.disabled = true;
      const original = button.textContent;
      button.textContent = 'Počítám…';
      result.innerHTML = '<div class="sqAutopilotEmpty"><strong>Hledám dnešní ceny…</strong><span>Načítám pouze produkty z tvého seznamu.</span></div>';
      try {
        const offers = await loadCurrentOffers(productIds);
        renderResult(result, calculate(rows, offers));
      } catch (error) {
        result.innerHTML = `<div class="sqAutopilotEmpty"><strong>Výpočet se nepodařil</strong><span>${esc(error?.message || 'Zkus to znovu.')}</span></div>`;
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject, { once: true });
  else inject();
})();
