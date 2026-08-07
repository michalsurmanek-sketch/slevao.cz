(() => {
  'use strict';

  const productId = new URLSearchParams(location.search).get('id');
  if (!productId) return;

  const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, Number(value) || 0));
  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const localDate = () => {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  };
  const addDays = (date, days) => {
    const next = new Date(`${date}T12:00:00`);
    next.setDate(next.getDate() + days);
    const pad = (value) => String(value).padStart(2, '0');
    return `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
  };
  const median = (values) => {
    const rows = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    if (!rows.length) return null;
    const middle = Math.floor(rows.length / 2);
    return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
  };

  async function getDb(timeout = 5000) {
    if (window.SlevaoPublic?.getSupabase) return window.SlevaoPublic.getSupabase();
    const started = Date.now();
    while (Date.now() - started < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 80));
      if (window.SlevaoPublic?.getSupabase) return window.SlevaoPublic.getSupabase();
    }
    throw new Error('Datové služby nejsou dostupné.');
  }

  function scoreLabel(score) {
    if (score >= 90) return 'Mimořádná nabídka';
    if (score >= 75) return 'Velmi dobrá';
    if (score >= 60) return 'Dobrá';
    return 'Běžná nabídka';
  }

  function discountPercent(offer) {
    const price = Number(offer.price || 0);
    const oldPrice = Number(offer.old_price || 0);
    return oldPrice > price && oldPrice > 0 ? ((oldPrice - price) / oldPrice) * 100 : null;
  }

  function buildContext(offers, history) {
    const now = Date.now();
    const history90 = history.filter((row) => new Date(row.recorded_at).getTime() >= now - 90 * 86400000 && Number(row.price) > 0);
    const history30 = history.filter((row) => new Date(row.recorded_at).getTime() >= now - 30 * 86400000 && Number(row.price) > 0);
    const typical = median(history90.map((row) => row.price));
    const min30 = history30.length ? Math.min(...history30.map((row) => Number(row.price))) : null;
    const marketPrices = offers.map((offer) => Number(offer.price)).filter((price) => price > 0);
    const marketMin = marketPrices.length ? Math.min(...marketPrices) : null;
    const marketMax = marketPrices.length ? Math.max(...marketPrices) : null;
    return { history90, history30, typical, min30, marketMin, marketMax };
  }

  function intelligenceFor(offer, context, offers) {
    const price = Number(offer.price || 0);
    if (!(price > 0)) return { sufficient: false, score: null, label: 'Málo dat', decision: 'NEUTRÁLNÍ', decisionClass: 'neutral', reasons: [] };

    const signals = [];
    if (context.history90.length >= 3 && context.typical > 0) {
      const value = clamp(50 + ((context.typical - price) / context.typical) * 250);
      signals.push({ key: 'history', value, weight: .4 });
    }
    if (offers.length >= 2 && context.marketMin != null && context.marketMax != null) {
      const spread = context.marketMax - context.marketMin;
      const value = spread < .01 ? 50 : clamp(((context.marketMax - price) / spread) * 100);
      signals.push({ key: 'market', value, weight: .25 });
    }
    const discount = discountPercent(offer);
    if (discount != null) signals.push({ key: 'discount', value: clamp((discount / 40) * 100), weight: .2 });
    if (context.history30.length >= 2 && context.min30 > 0) {
      const delta = (price - context.min30) / context.min30;
      const value = delta <= .01 ? 100 : clamp(100 - delta * 400);
      signals.push({ key: 'minimum', value, weight: .15 });
    }

    const sufficient = signals.length >= 2 && (context.history90.length >= 3 || offers.length >= 2);
    if (!sufficient) return { sufficient: false, score: null, label: 'Málo dat', decision: 'NEUTRÁLNÍ', decisionClass: 'neutral', reasons: [] };

    const weight = signals.reduce((sum, signal) => sum + signal.weight, 0);
    const score = Math.round(signals.reduce((sum, signal) => sum + signal.value * signal.weight, 0) / weight);
    const cheaperElsewhere = context.marketMin != null && price > context.marketMin * 1.10;
    const strongHistoricalPrice = (context.typical && price <= context.typical * .92) || (context.min30 && price <= context.min30 * 1.03);
    const strongDiscount = discount != null && discount >= 25;

    let decision = 'POČKEJ';
    let decisionClass = 'wait';
    if (cheaperElsewhere) {
      decision = 'NEVYPLATÍ SE';
      decisionClass = 'skip';
    } else if (score >= 85 && (strongHistoricalPrice || strongDiscount)) {
      decision = 'KUP TEĎ';
      decisionClass = 'buy';
    }

    const reasons = [];
    if (context.typical) reasons.push(`obvyklá cena ${money(context.typical)} Kč`);
    if (context.min30) reasons.push(`30denní minimum ${money(context.min30)} Kč`);
    if (offers.length >= 2) reasons.push(`porovnáno ${offers.length} nabídek`);
    if (discount != null) reasons.push(`sleva ${Math.round(discount)} %`);

    return { sufficient: true, score, label: scoreLabel(score), decision, decisionClass, reasons };
  }

  function decorateCards(offers, context) {
    document.querySelectorAll('.sfOffer').forEach((card) => {
      if (card.dataset.sqIntel === '1') return;
      const id = card.querySelector('[data-add-offer]')?.dataset.addOffer;
      if (!id) return;
      const offer = offers.find((row) => String(row.id) === String(id));
      if (!offer) return;
      const intel = intelligenceFor(offer, context, offers);
      const badges = document.createElement('div');
      badges.className = 'sqIntelBadges';
      badges.innerHTML = intel.sufficient
        ? `<span class="sqIntelBadge">Slevao skóre ${intel.score}/100 · ${intel.label}</span><span class="sqIntelBadge ${intel.decisionClass}">${intel.decision}</span>`
        : '<span class="sqIntelBadge neutral">Slevao skóre: zatím málo dat</span><span class="sqIntelBadge neutral">Bez doporučení</span>';
      const anchor = card.querySelector('.sfOfferStore');
      if (anchor) anchor.after(badges); else card.prepend(badges);
      card.dataset.sqIntel = '1';
    });
  }

  function renderSummary(offers, context) {
    if (document.getElementById('sqIntelSummary')) return;
    const stats = document.querySelector('.sfStats');
    if (!stats) return;
    const today = localDate();
    const current = offers.filter((offer) => String(offer.valid_from || '') <= today);
    const candidates = (current.length ? current : offers).slice().sort((a, b) => Number(a.price || 0) - Number(b.price || 0));
    const best = candidates[0];
    if (!best) return;
    const intel = intelligenceFor(best, context, offers);
    const summary = document.createElement('section');
    summary.id = 'sqIntelSummary';
    summary.className = 'sqIntelSummary';
    summary.innerHTML = `
      <div class="sqIntelScore"><strong>${intel.sufficient ? intel.score : '—'}</strong><small>${intel.sufficient ? '/ 100' : 'málo dat'}</small></div>
      <div><h3>${intel.sufficient ? `Slevao skóre: ${intel.label}` : 'Slevao skóre zatím nezobrazujeme'}</h3><p>${intel.sufficient ? `Nejlevnější dostupná nabídka ${money(best.price)} Kč vychází z reálného srovnání. ${intel.reasons.join(' · ')}.` : 'Pro spolehlivé hodnocení potřebujeme alespoň dva nezávislé cenové signály, například historii a srovnání více obchodů.'}</p><p class="sqIntelMethod">Skóre používá pouze dostupná data: historii ceny, porovnání obchodů, doloženou původní cenu a 30denní minimum. Chybějící signál se do skóre nezapočítá.</p></div>
      <div class="sqIntelDecision ${intel.decisionClass}">${intel.sufficient ? intel.decision : 'BEZ DOPORUČENÍ'}</div>`;
    stats.after(summary);
  }

  async function init() {
    try {
      const db = await getDb();
      const today = localDate();
      const upcomingTo = addDays(today, 7);
      const since = new Date(Date.now() - 120 * 86400000).toISOString();
      const [offersResult, historyResult] = await Promise.all([
        db.from('offers')
          .select('id,product_id,store_id,price,old_price,unit_price,valid_from,valid_to')
          .eq('product_id', productId)
          .eq('status', 'published')
          .gte('valid_to', today)
          .lte('valid_from', upcomingTo)
          .limit(100),
        db.from('price_history')
          .select('price,old_price,unit_price,recorded_at')
          .eq('product_id', productId)
          .gte('recorded_at', since)
          .order('recorded_at', { ascending: true })
          .limit(1000)
      ]);
      if (offersResult.error) throw offersResult.error;
      if (historyResult.error) throw historyResult.error;
      const offers = offersResult.data || [];
      const history = historyResult.data || [];
      const context = buildContext(offers, history);
      renderSummary(offers, context);
      decorateCards(offers, context);
      const target = document.getElementById('offers');
      if (target) {
        const observer = new MutationObserver(() => decorateCards(offers, context));
        observer.observe(target, { childList: true, subtree: true });
        window.setTimeout(() => observer.disconnect(), 10000);
      }
    } catch (error) {
      console.warn('Slevao intelligence:', error?.message || error);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
