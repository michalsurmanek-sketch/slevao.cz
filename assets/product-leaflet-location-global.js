(() => {
  'use strict';

  const SUPABASE_URL = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  const productId = new URLSearchParams(location.search).get('id');
  const offersRoot = document.getElementById('offers');
  if (!productId || !offersRoot || !window.supabase?.createClient) return;

  const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const validPdf = (value) => {
    const url = String(value || '');
    return /^https:\/\/.*\.pdf(?:\?|$)/i.test(url) && !/\/storage\/v1\/object\/sign\//i.test(url);
  };

  const overlap = (offer, row) => {
    const offerFrom = String(offer?.valid_from || '');
    const offerTo = String(offer?.valid_to || '');
    const rowFrom = String(row?.valid_from || '');
    const rowTo = String(row?.valid_to || '');
    if (rowFrom && offerTo && rowFrom > offerTo) return false;
    if (rowTo && offerFrom && rowTo < offerFrom) return false;
    return true;
  };

  const keyOf = (row) => `${Number(row.source_page || 0)}|${String(row.document_url || '')}`;

  function metadataLocation(offer) {
    const page = Number(offer?.metadata?.leaflet_page || 0);
    const documentUrl = String(offer?.metadata?.leaflet_document_url || '');
    if (!Number.isInteger(page) || page < 1 || page > 500 || !validPdf(documentUrl)) return null;
    return {
      store_id: offer.store_id,
      source_page: page,
      document_url: documentUrl,
      valid_from: offer.valid_from || null,
      valid_to: offer.valid_to || null,
    };
  }

  function exactLocation(offer, locations) {
    const candidates = locations.filter((row) =>
      row.store_id === offer.store_id
      && Number.isInteger(Number(row.source_page))
      && Number(row.source_page) >= 1
      && Number(row.source_page) <= 500
      && validPdf(row.document_url)
      && overlap(offer, row)
    );
    if (!candidates.length) return null;

    const exactValidity = candidates.filter((row) =>
      (!row.valid_from || row.valid_from === offer.valid_from)
      && (!row.valid_to || row.valid_to === offer.valid_to)
    );
    const exactUnique = [...new Map(exactValidity.map((row) => [keyOf(row), row])).values()];
    if (exactUnique.length === 1) return exactUnique[0];

    const unique = [...new Map(candidates.map((row) => [keyOf(row), row])).values()];
    return unique.length === 1 ? unique[0] : null;
  }

  function storePageUrl(offer) {
    const slug = String(offer?.stores?.slug || '').trim();
    return slug ? `${encodeURIComponent(slug)}.html` : 'index.html#storesSection';
  }

  function destinationFor(card) {
    const actions = card.querySelector('.sfOfferActions');
    if (!actions) return null;
    const anchors = [...actions.querySelectorAll('a.sfButton')];
    let destination = anchors.find((anchor) => /^(Leták|Zobrazit nabídku|Stránka obchodu|Ověřuji leták)/i.test(anchor.textContent.trim()));
    if (!destination) {
      destination = document.createElement('a');
      destination.className = 'sfButton';
      const report = actions.querySelector('[data-report-offer]');
      if (report) actions.insertBefore(destination, report);
      else actions.appendChild(destination);
    }
    return destination;
  }

  function neutralizeUnverifiedLeaflet(card) {
    const destination = destinationFor(card);
    if (!destination || !/^Leták/i.test(destination.textContent.trim())) return;
    destination.removeAttribute('href');
    destination.removeAttribute('target');
    destination.removeAttribute('rel');
    destination.setAttribute('aria-disabled', 'true');
    destination.setAttribute('aria-label', 'Ověřuji přesnou stranu produktu v letáku');
    if (destination.textContent !== 'Ověřuji leták…') destination.textContent = 'Ověřuji leták…';
    destination.dataset.leafletVerifying = '1';
    delete destination.dataset.exactLeafletLocation;
  }

  function applyToCard(card, offer, locationRow) {
    const destination = destinationFor(card);
    if (!destination) return;
    destination.removeAttribute('aria-disabled');
    delete destination.dataset.leafletVerifying;

    if (locationRow) {
      const page = Math.max(1, Number(locationRow.source_page || 1));
      destination.href = `${locationRow.document_url}#page=${page}&zoom=page-fit`;
      destination.target = '_blank';
      destination.rel = 'noopener noreferrer';
      if (destination.textContent !== `Leták · strana ${page}`) destination.textContent = `Leták · strana ${page}`;
      destination.setAttribute('aria-label', `Ukázat produkt v letáku na straně ${page}`);
      destination.dataset.exactLeafletLocation = '1';
      return;
    }

    const sourceUrl = String(offer.source_url || '').trim();
    if (/^https:\/\//i.test(sourceUrl)) {
      destination.href = sourceUrl;
      destination.target = '_blank';
      destination.rel = 'noopener noreferrer';
      if (destination.textContent !== 'Zobrazit nabídku') destination.textContent = 'Zobrazit nabídku';
      destination.setAttribute('aria-label', 'Otevřít původní nabídku obchodu');
    } else {
      destination.href = storePageUrl(offer);
      destination.removeAttribute('target');
      destination.removeAttribute('rel');
      if (destination.textContent !== 'Stránka obchodu') destination.textContent = 'Stránka obchodu';
      destination.setAttribute('aria-label', 'Otevřít stránku obchodu');
    }
    delete destination.dataset.exactLeafletLocation;
  }

  async function loadData() {
    const [offersResult, locationsResult] = await Promise.all([
      db.from('offers')
        .select('id,store_id,valid_from,valid_to,source_url,metadata,stores(slug)')
        .eq('product_id', productId)
        .eq('status', 'published')
        .limit(100),
      db.from('public_product_leaflet_locations')
        .select('store_id,source_page,document_url,valid_from,valid_to,updated_at')
        .eq('product_id', productId)
        .order('updated_at', { ascending: false })
        .limit(100),
    ]);

    if (offersResult.error) throw offersResult.error;
    const offers = new Map((offersResult.data || []).map((offer) => [String(offer.id), offer]));
    const locations = locationsResult.error ? [] : (locationsResult.data || []);
    return { offers, locations };
  }

  let resolved = null;
  let failed = false;

  function syncCards() {
    offersRoot.querySelectorAll('.sfOffer').forEach((card) => {
      if (!resolved) {
        neutralizeUnverifiedLeaflet(card);
        if (failed) {
          const destination = destinationFor(card);
          if (destination?.dataset.leafletVerifying === '1') {
            destination.href = 'index.html#storesSection';
            destination.removeAttribute('aria-disabled');
            destination.textContent = 'Stránka obchodu';
            destination.setAttribute('aria-label', 'Otevřít přehled obchodů');
            delete destination.dataset.leafletVerifying;
          }
        }
        return;
      }

      const id = card.querySelector('[data-add-offer]')?.dataset.addOffer;
      if (!id) return;
      const offer = resolved.offers.get(String(id));
      if (!offer) return;
      const locationRow = metadataLocation(offer) || exactLocation(offer, resolved.locations);
      applyToCard(card, offer, locationRow);
    });
  }

  // Observer se instaluje okamžitě. Jakmile základní detail vytvoří kartu, žádný
  // neověřený odkaz na konkrétní stranu PDF nezůstane ani krátce kliknutelný.
  const observer = new MutationObserver(syncCards);
  observer.observe(offersRoot, { childList: true, subtree: true });
  syncCards();

  loadData().then((data) => {
    resolved = data;
    syncCards();
  }).catch((error) => {
    failed = true;
    syncCards();
    console.warn('Přesná poloha produktu v letáku není dostupná:', error);
  });

  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
})();
