(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const money = (value) => Number(String(value || '').replace(/[^0-9,.-]/g, '').replace(',', '.'));

  function ensureMeta(property, content) {
    if (!content) return;
    let meta = document.head.querySelector(`meta[property="${property}"]`);
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('property', property);
      document.head.appendChild(meta);
    }
    meta.content = content;
  }

  function build() {
    const name = $('#productName')?.textContent?.trim();
    const offersRoot = $('#offers');
    const detailRoot = $('#productContent');
    if (!name || name === 'Načítám produkt…' || !offersRoot || !detailRoot
      || offersRoot.dataset.loaded !== '1' || detailRoot.dataset.identityReady !== '1') return false;

    const exactIdentity = detailRoot.dataset.identityMode === 'exact';
    const metaText = $('#productMeta')?.textContent?.trim() || '';
    const image = $('#productImage img')?.src || '';
    const canonical = document.querySelector('link[rel="canonical"]')?.href || location.href;
    const cards = [...offersRoot.querySelectorAll('.sfOffer')];
    const offerRows = cards.map((card) => {
      const price = money(card.querySelector('.sfPrice')?.textContent);
      const store = (card.querySelector('.sfOfferStore')?.textContent || 'Obchod').split(' · ')[0].trim();
      return Number.isFinite(price) && price > 0 ? {
        '@type':'Offer',
        price,
        priceCurrency:'CZK',
        url:canonical,
        seller:{ '@type':'Organization', name:store }
      } : null;
    }).filter(Boolean);

    const prices = offerRows.map((row) => row.price);
    const comparisonText = exactIdentity
      ? 'Porovnání akčních cen stejného produktu na Slevao.cz.'
      : 'Přehled srovnatelných akčních nabídek na Slevao.cz; identita stejného SKU není garantovaná.';
    const product = {
      '@context':'https://schema.org',
      '@type':'Product',
      name,
      description: metaText ? `${name} – ${metaText}. ${comparisonText}` : `${name} – ${comparisonText}`,
      url:canonical
    };
    if (image) product.image = [image];

    // AggregateOffer smí popisovat pouze nabídky, u kterých máme dostatečně
    // silnou identitu stejného SKU. U generických/srovnatelných záznamů by
    // společný cenový rozsah byl pro vyhledávač zavádějící.
    if (exactIdentity && offerRows.length) {
      product.offers = {
        '@type':'AggregateOffer',
        priceCurrency:'CZK',
        lowPrice:Math.min(...prices),
        highPrice:Math.max(...prices),
        offerCount:offerRows.length,
        offers:offerRows.slice(0, 20)
      };
    }

    let script = document.getElementById('productStructuredData');
    if (!script) {
      script = document.createElement('script');
      script.id = 'productStructuredData';
      script.type = 'application/ld+json';
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(product);

    const description = product.description;
    ensureMeta('og:type', 'product');
    ensureMeta('og:title', `${name} – ceny a historie | Slevao.cz`);
    ensureMeta('og:description', description);
    ensureMeta('og:url', canonical);
    if (image) ensureMeta('og:image', image);
    return true;
  }

  let completed = false;
  const tryBuild = () => {
    if (completed) return true;
    completed = build();
    return completed;
  };

  if (tryBuild()) return;

  window.addEventListener('slevao:product-offers-rendered', () => {
    if (tryBuild()) observer.disconnect();
  });
  window.addEventListener('slevao:product-identity-ready', () => {
    if (tryBuild()) observer.disconnect();
  });

  const observer = new MutationObserver(() => {
    if (tryBuild()) observer.disconnect();
  });
  observer.observe(document.documentElement, {
    childList:true,
    subtree:true,
    characterData:true,
    attributes:true,
    attributeFilter:['data-loaded','data-identity-ready','data-identity-mode']
  });
  window.setTimeout(() => observer.disconnect(), 15000);
})();
