(() => {
  const leafletGrid = document.getElementById('leafletGrid');
  const offerGrid = document.getElementById('grid');
  const viewer = document.getElementById('leafletViewer');
  if (!leafletGrid) return;

  const normalize = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('cs');

  let processingLeaflets = false;

  function removeWrongFirstDuplicate() {
    if (processingLeaflets) return;
    const cards = [...leafletGrid.querySelectorAll('.leafletCard')];
    if (cards.length < 2) return;

    const first = cards[0];
    const second = cards[1];
    const sameStore = normalize(first.querySelector('h3')?.textContent)
      === normalize(second.querySelector('h3')?.textContent);
    const firstValidity = normalize(first.querySelector('.leafletValidity')?.textContent);
    const secondValidity = normalize(second.querySelector('.leafletValidity')?.textContent);
    const sameValidity = Boolean(firstValidity) && firstValidity === secondValidity;

    if (!sameStore || !sameValidity) return;

    processingLeaflets = true;
    try {
      const firstWasOpen = first.classList.contains('active') && viewer && !viewer.hidden;
      first.remove();
      leafletGrid.dataset.count = String(leafletGrid.querySelectorAll('.leafletCard').length);

      // Druhá karta zůstává beze změny. Pokud byl na desktopu otevřen první
      // chybný leták, otevře se původní odkaz ponechané druhé karty.
      if (firstWasOpen) queueMicrotask(() => second.click());
    } finally {
      processingLeaflets = false;
    }
  }

  function parseCzechPrice(value) {
    const number = String(value || '')
      .replace(/\s/g, '')
      .replace(/[^\d,.-]/g, '')
      .replace(',', '.');
    const parsed = Number(number);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function correctCurrentMakroPrices() {
    if (!offerGrid) return;

    offerGrid.querySelectorAll('.deal').forEach((card) => {
      if (card.dataset.makroPriceCorrected === 'true') return;
      const validity = normalize(card.querySelector('.validity')?.textContent);
      // Jednorázová oprava chybně publikovaného Ultra Fresh letáku.
      // Import přidal k hlavní ceně ještě jednou 12 % DPH.
      if (!/29\.\s*7\..*4\.\s*8\./.test(validity)) return;

      const priceElement = card.querySelector('.price');
      const publishedPrice = parseCzechPrice(priceElement?.textContent);
      if (!priceElement || !(publishedPrice > 0)) return;

      const leafletPrice = Math.round((publishedPrice / 1.12) * 100) / 100;
      priceElement.textContent = `${leafletPrice.toLocaleString('cs-CZ', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} Kč`;
      card.dataset.makroPriceCorrected = 'true';
    });
  }

  new MutationObserver(removeWrongFirstDuplicate).observe(leafletGrid, {
    childList: true,
    subtree: true,
  });
  if (offerGrid) {
    new MutationObserver(correctCurrentMakroPrices).observe(offerGrid, {
      childList: true,
      subtree: true,
    });
  }

  removeWrongFirstDuplicate();
  correctCurrentMakroPrices();
})();
