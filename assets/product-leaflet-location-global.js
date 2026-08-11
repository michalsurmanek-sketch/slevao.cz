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

  function applyToCard(card, offer, locationRow) {
    const actions = card.querySelector('.sfOfferActions');
    if (!actions) return;
    const anchors = [...actions.querySelectorAll('a.sfButton')];
    let destination = anchors.find((anchor) => /^(Leták|Stránka obchodu)/i.test(anchor.textContent.trim()));

    if (!destination) {
      destination = document.createElement('a');
      destination.className = 'sfButton';
      const report = actions.querySelector('[data-report-offer]');
      if (report) actions.insertBefore(destination, report);
      else actions.appendChild(destination);
    }

    if (locationRow) {
      const page = Math.max(1, Number(locationRow.source_page || 1));
      destination.href = `${locationRow.document_url}#page=${page}&zoom=page-fit`;
      destination.target = '_blank';
      destination.rel = 'noopener noreferrer';
      destination.textContent = `Leták · strana ${page}`;
      destination.setAttribute('aria-label', `Ukázat produkt v letáku na straně ${page}`);
      destination.dataset.exactLeafletLocation = '1';
      return;
    }

    destination.href = storePageUrl(offer);
    destination.removeAttribute('target');
    destination.removeAttribute('rel');
    destination.textContent = 'Stránka obchodu';
    destination.setAttribute('aria-label', 'Otevřít stránku obchodu');
    delete destination.dataset.exactLeafletLocation;
  }

  async function loadData() {
    const [offersResult, locationsResult] = await Promise.all([
      db.from('offers')
        .select('id,store_id,valid_from,valid_to,stores(slug)')
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

  function install({ offers, locations }) {
    const apply = () => {
      offersRoot.querySelectorAll('.sfOffer').forEach((card) => {
        const id = card.querySelector('[data-add-offer]')?.dataset.addOffer;
        if (!id) return;
        const offer = offers.get(String(id));
        if (!offer) return;
        applyToCard(card, offer, exactLocation(offer, locations));
      });
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(offersRoot, { childList: true, subtree: true });
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
  }

  loadData().then(install).catch((error) => {
    console.warn('Přesná poloha produktu v letáku není dostupná:', error);
  });
})();
