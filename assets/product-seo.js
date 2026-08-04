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
    if (!name || name === 'Načítám produkt…') return false;

    const metaText = $('#productMeta')?.textContent?.trim() || '';
    const image = $('#productImage img')?.src || '';
    const cards = [...document.querySelectorAll('#offers .sfOffer')];
    const offerRows = cards.map((card) => {
      const price = money(card.querySelector('.sfPrice')?.textContent);
      const store = (card.querySelector('.sfOfferStore')?.textContent || 'Obchod').split(' · ')[0].trim();
      const link = card.querySelector('a[href]')?.href || location.href;
      return Number.isFinite(price) && price > 0 ? {
        '@type':'Offer',
        price,
        priceCurrency:'CZK',
        availability:'https://schema.org/InStock',
        url:link,
        seller:{ '@type':'Organization', name:store }
      } : null;
    }).filter(Boolean);

    const prices = offerRows.map((row) => row.price);
    const product = {
      '@context':'https://schema.org',
      '@type':'Product',
      name,
      description: metaText ? `${name} – ${metaText}. Porovnání akčních cen na Slevao.cz.` : `${name} – porovnání akčních cen na Slevao.cz.`,
      url:location.href
    };
    if (image) product.image = [image];
    if (offerRows.length) {
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
    ensureMeta('og:url', location.href);
    if (image) ensureMeta('og:image', image);
    return true;
  }

  if (build()) return;
  const observer = new MutationObserver(() => {
    if (build()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList:true, subtree:true, characterData:true });
  window.setTimeout(() => observer.disconnect(), 12000);
})();
