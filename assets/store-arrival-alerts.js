(() => {
  'use strict';

  const ENABLED_KEY = 'slevao-store-arrival-alerts-v1';
  const STATE_KEY = 'slevao-store-arrival-alert-state-v1';
  const ENTER_RADIUS_METERS = 120;
  const EXIT_RADIUS_METERS = 280;
  const MAX_ACCURACY_METERS = 80;
  const DWELL_MS = 45000;
  const MIN_HITS = 2;
  const COOLDOWN_MS = 4 * 60 * 60 * 1000;
  const CHECK_THROTTLE_MS = 12000;

  const STAPLE_GROUPS = [
    { key:'milk', label:'Mléko', priority:100, pattern:/\bmleko\b/ },
    { key:'butter', label:'Máslo', priority:99, pattern:/\bmaslo\b/ },
    { key:'eggs', label:'Vejce', priority:98, pattern:/\bvejce\b/ },
    { key:'bread', label:'Pečivo', priority:96, pattern:/\b(chleb\w*|rohlik\w*|housk\w*|peciv\w*)\b/ },
    { key:'chicken', label:'Kuřecí maso', priority:95, pattern:/\b(kure\w*|kureci\w*)\b/ },
    { key:'pork', label:'Vepřové maso', priority:93, pattern:/\b(vepr\w*|veprove\w*|veprova\w*|veprovy\w*)\b/ },
    { key:'potatoes', label:'Brambory', priority:92, pattern:/\bbrambor\w*\b/ },
    { key:'cheese', label:'Sýr', priority:90, pattern:/\b(syr\w*|eidam\w*|gouda\w*)\b/ },
    { key:'rice', label:'Rýže', priority:88, pattern:/\bryze\b/ },
    { key:'pasta', label:'Těstoviny', priority:87, pattern:/\b(testovin\w*|spaget\w*|kolink\w*)\b/ },
    { key:'oil', label:'Olej', priority:86, pattern:/\bolej\b/ },
    { key:'flour', label:'Mouka', priority:85, pattern:/\bmouka\b/ },
    { key:'sugar', label:'Cukr', priority:84, pattern:/\bcukr\b/ },
    { key:'apples', label:'Jablka', priority:82, pattern:/\bjablk\w*\b/ },
    { key:'bananas', label:'Banány', priority:81, pattern:/\bbanan\w*\b/ },
    { key:'onion', label:'Cibule', priority:80, pattern:/\bcibul\w*\b/ },
    { key:'tomatoes', label:'Rajčata', priority:79, pattern:/\brajcat\w*\b/ },
  ];

  let watchId = null;
  let checking = false;
  let lastCheckAt = 0;
  let candidate = null;
  let dependencyPromise = null;

  const money = (value) => Number(value || 0).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const api = () => window.SlevaoLocation || null;

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }

  function isEnabled() {
    return localStorage.getItem(ENABLED_KEY) === '1';
  }

  function setEnabled(value) {
    try {
      if (value) localStorage.setItem(ENABLED_KEY, '1');
      else localStorage.removeItem(ENABLED_KEY);
    } catch {}
  }

  function state() {
    const current = readJson(STATE_KEY, {});
    return current && typeof current === 'object' ? current : {};
  }

  function patchState(patch) {
    const next = { ...state(), ...patch };
    writeJson(STATE_KEY, next);
    return next;
  }

  function ensureDependencies() {
    if (api()) return Promise.resolve(api());
    if (dependencyPromise) return dependencyPromise;

    dependencyPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src*="location-service.js"]');
      const wait = () => {
        let tries = 0;
        const timer = window.setInterval(() => {
          tries += 1;
          if (api()) {
            window.clearInterval(timer);
            resolve(api());
          } else if (tries >= 100) {
            window.clearInterval(timer);
            reject(new Error('Polohová služba se nenačetla.'));
          }
        }, 100);
      };

      if (existing) {
        wait();
        return;
      }

      const script = document.createElement('script');
      script.src = 'assets/location-service.js?v=20260811-4';
      script.defer = true;
      script.addEventListener('load', wait, { once:true });
      script.addEventListener('error', () => reject(new Error('Polohová služba se nepodařila načíst.')), { once:true });
      document.head.appendChild(script);
    }).finally(() => { dependencyPromise = null; });

    return dependencyPromise;
  }

  function ensureUi() {
    const panel = document.querySelector('.heroNearbyPanel');
    if (!panel) return null;
    let control = document.getElementById('slArrivalControl');
    if (control) return control;

    control = document.createElement('div');
    control.id = 'slArrivalControl';
    control.className = 'slArrivalControl';
    control.innerHTML = `
      <button id="slArrivalToggle" class="slArrivalToggle" type="button" aria-pressed="false">
        <span class="slArrivalIcon" aria-hidden="true">◎</span>
        <span class="slArrivalCopy"><strong>Upozornit mě v obchodě</strong><small>Seznam má přednost, jinak ukážeme základní potraviny v akci</small></span>
        <span class="slArrivalSwitch" aria-hidden="true"><i></i></span>
      </button>
      <p id="slArrivalStatus" class="slArrivalStatus" role="status" aria-live="polite"></p>`;

    const divider = panel.querySelector('.slLiveDivider');
    if (divider) divider.before(control); else panel.appendChild(control);
    control.querySelector('#slArrivalToggle')?.addEventListener('click', toggleFromUser);
    updateUi();
    return control;
  }

  function setStatus(text, type = '') {
    const node = document.getElementById('slArrivalStatus');
    if (!node) return;
    node.textContent = text || '';
    node.dataset.type = type;
  }

  function updateUi() {
    const button = document.getElementById('slArrivalToggle');
    if (!button) return;
    const enabled = isEnabled();
    button.classList.toggle('is-active', enabled);
    button.setAttribute('aria-pressed', String(enabled));
    const title = button.querySelector('strong');
    const note = button.querySelector('small');
    if (title) title.textContent = enabled ? 'Upozornění v obchodě zapnuté' : 'Upozornit mě v obchodě';
    if (note) note.textContent = enabled
      ? 'Hlídám tvůj seznam nebo základní potraviny v akci'
      : 'Seznam má přednost, jinak ukážeme základní potraviny v akci';
  }

  async function requestNotificationPermission() {
    if (!('Notification' in window)) throw new Error('Tento prohlížeč nepodporuje oznámení.');
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') throw new Error('Oznámení jsou v prohlížeči zakázaná.');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Bez povolení oznámení nelze funkci zapnout.');
    return true;
  }

  async function showNotification(title, body, data) {
    const options = {
      body,
      icon: data.icon || '/favicon.svg',
      badge: '/favicon.svg',
      tag: `slevao-store-arrival-${data.branchId}`,
      renotify: false,
      requireInteraction: false,
      data,
      vibrate: [90, 45, 90],
    };
    if (data.image) options.image = data.image;

    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(title, options);
        return;
      } catch {}
    }

    if ('Notification' in window && Notification.permission === 'granted') {
      const notification = new Notification(title, options);
      notification.onclick = () => {
        window.focus();
        location.href = data.url || '/';
        notification.close();
      };
    }
  }

  function quantityForProduct(list, productId) {
    const row = (list || []).find((item) => String(item.product_id) === String(productId));
    return Math.max(.01, Number(row?.quantity || 1));
  }

  function stapleGroupFor(offer, a) {
    const folded = a.fold ? a.fold(offer?.title || '') : String(offer?.title || '').toLowerCase();
    return STAPLE_GROUPS.find((group) => group.pattern.test(folded)) || null;
  }

  function offerSavingScore(offer, a) {
    const discount = Number(a.documentedDiscount?.(offer) || 0);
    const price = Number(offer?.price || 0);
    const oldPrice = Number(offer?.old_price || 0);
    const absoluteSaving = oldPrice > price && price > 0 ? Math.min(80, oldPrice - price) : 0;
    return discount * 2 + absoluteSaving;
  }

  function selectStapleOffers(offers, a, limit = 3) {
    const bestByGroup = new Map();
    for (const offer of offers || []) {
      if (!(Number(offer?.price) > 0)) continue;
      const group = stapleGroupFor(offer, a);
      if (!group) continue;
      const score = group.priority * 4 + offerSavingScore(offer, a);
      const current = bestByGroup.get(group.key);
      if (!current || score > current.score) bestByGroup.set(group.key, { offer, group, score });
    }
    return [...bestByGroup.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(1, Number(limit) || 3));
  }

  function stapleBody(items, a) {
    const parts = items.map(({ offer, group }) => {
      const discount = Number(a.documentedDiscount?.(offer) || 0);
      const suffix = discount >= 10 ? ` (−${discount} %)` : '';
      return `${group.label} ${money(offer.price)} Kč${suffix}`;
    });
    if (parts.length === 1) return `${parts[0]} je dnes mezi hlavními akcemi.`;
    return `Dnešní základní nákup: ${parts.join(' · ')}.`;
  }

  async function notificationCopy(branch) {
    const a = api();
    const storeName = branch.stores?.name || branch.name || 'obchodě';
    const list = a.readList?.().filter((row) => !row.completed && row.product_id) || [];
    let matchedCount = 0;
    let saving = 0;
    let listImage = '';
    let url = '/index.html#dealsSection';

    if (list.length) {
      try {
        const rows = await a.fetchOffersForList(list, [branch.store_id], [branch]);
        const current = (rows || []).filter((offer) => String(offer.store_id) === String(branch.store_id));
        const products = new Set();
        let bestImageSaving = -1;
        for (const offer of current) {
          const productId = String(offer.product_id || '');
          if (!productId || products.has(productId)) continue;
          products.add(productId);
          matchedCount += 1;
          const oldPrice = Number(offer.old_price || 0);
          const price = Number(offer.price || 0);
          const itemSaving = oldPrice > price && price > 0 ? (oldPrice - price) * quantityForProduct(list, productId) : 0;
          saving += itemSaving;
          if (offer.image_url && itemSaving >= bestImageSaving) {
            bestImageSaving = itemSaving;
            listImage = offer.image_url;
          }
        }
        if (matchedCount) url = '/seznam.html?route=1';
      } catch {}
    }

    if (matchedCount) {
      const suffix = saving >= 1 ? ` Můžeš ušetřit přibližně ${money(saving)} Kč.` : '';
      return {
        title: `Jsi v ${storeName} 🛒`,
        body: `${matchedCount} ${matchedCount === 1 ? 'položka z tvého seznamu je' : matchedCount < 5 ? 'položky z tvého seznamu jsou' : 'položek z tvého seznamu je'} dnes v akci.${suffix}`,
        url,
        image: listImage,
      };
    }

    try {
      const offers = await a.fetchOffersForStores([branch.store_id], [branch]);
      const staples = selectStapleOffers(offers, a, 3);
      if (staples.length) {
        return {
          title: `Základní potraviny v akci · ${storeName} 🛒`,
          body: stapleBody(staples, a),
          url,
          image: staples.find((item) => item.offer?.image_url)?.offer?.image_url || '',
        };
      }

      const top = a.rankOffers?.(offers, 1)?.[0] || offers?.[0];
      if (top) {
        const discount = a.documentedDiscount?.(top) || 0;
        return {
          title: `Jsi v ${storeName} 🛒`,
          body: `${offers.length} dnešních akcí. ${top.title || 'Výhodná nabídka'} za ${money(top.price)} Kč${discount ? ` (−${discount} %)` : ''}.`,
          url,
          image: top.image_url || '',
        };
      }
    } catch {}

    return {
      title: `Jsi v ${storeName} 🛒`,
      body: 'Dnes tu nemáme dost spolehlivých cen základních potravin. Otevři Slevao a zkontroluj aktuální nabídky.',
      url,
    };
  }

  async function triggerArrival(branch, meters, accuracy) {
    const now = Date.now();
    const currentState = state();
    const notified = currentState.notified && typeof currentState.notified === 'object' ? currentState.notified : {};
    const last = Number(notified[branch.id] || 0);
    if (last && now - last < COOLDOWN_MS) return;

    notified[branch.id] = now;
    patchState({ notified, currentBranchId: branch.id, currentStoreId: branch.store_id, lastArrivalAt: now });

    const copy = await notificationCopy(branch);
    await showNotification(copy.title, copy.body, {
      url: copy.url,
      branchId: String(branch.id || ''),
      storeId: String(branch.store_id || ''),
      image: copy.image || '',
      icon: branch.stores?.logo_url || '/favicon.svg',
    });

    window.dispatchEvent(new CustomEvent('slevao:store-arrival', {
      detail: { branch, meters, accuracy, notification: copy },
    }));

    if (document.visibilityState === 'visible') {
      const locate = document.getElementById('slLiveLocate');
      if (locate && !locate.disabled) window.setTimeout(() => locate.click(), 200);
    }

    const storeName = branch.stores?.name || branch.name || 'obchodu';
    setStatus(`Rozpoznán příchod do ${storeName}. Upozornění odesláno.`, 'ok');
  }

  function resetCandidate() {
    candidate = null;
  }

  async function evaluatePosition(position, force = false) {
    if (!isEnabled() || checking) return;
    const now = Date.now();
    if (!force && now - lastCheckAt < CHECK_THROTTLE_MS) return;
    lastCheckAt = now;
    checking = true;

    try {
      const a = await ensureDependencies();
      const latitude = Number(position?.coords?.latitude ?? position?.latitude);
      const longitude = Number(position?.coords?.longitude ?? position?.longitude);
      const accuracy = Math.max(0, Number(position?.coords?.accuracy ?? position?.accuracy ?? 0));
      if (![latitude, longitude].every(Number.isFinite)) return;

      const branches = await a.fetchNearbyBranches(latitude, longitude, 1);
      const nearest = branches[0];
      if (!nearest) {
        resetCandidate();
        patchState({ currentBranchId: null, currentStoreId: null });
        setStatus('Hlídání je aktivní. V okolí teď není evidovaná pobočka.', '');
        return;
      }

      const meters = Number(nearest.distance_km || Infinity) * 1000;
      const enterRadius = Math.min(180, Math.max(ENTER_RADIUS_METERS, accuracy * 1.35));
      const accurateEnough = accuracy > 0 && accuracy <= MAX_ACCURACY_METERS;
      const inside = accurateEnough && meters <= enterRadius;

      if (!inside) {
        if (meters > EXIT_RADIUS_METERS) {
          resetCandidate();
          const current = state();
          if (current.currentBranchId) patchState({ currentBranchId: null, currentStoreId: null });
        }
        setStatus(accuracy > MAX_ACCURACY_METERS
          ? `Hlídání je aktivní · čekám na přesnější GPS (±${Math.round(accuracy)} m).`
          : 'Hlídání je aktivní · čekám na příchod k pobočce.', '');
        return;
      }

      if (!candidate || String(candidate.branchId) !== String(nearest.id)) {
        candidate = { branchId: nearest.id, storeId: nearest.store_id, startedAt: now, hits: 1 };
        setStatus(`Jsi poblíž ${nearest.stores?.name || nearest.name || 'obchodu'} · ověřuji, že nejde jen o průjezd…`, 'checking');
        return;
      }

      candidate.hits += 1;
      const dwell = now - candidate.startedAt;
      if (candidate.hits >= MIN_HITS && dwell >= DWELL_MS) {
        await triggerArrival(nearest, meters, accuracy);
        candidate.startedAt = now;
        candidate.hits = 0;
      } else {
        const seconds = Math.max(0, Math.ceil((DWELL_MS - dwell) / 1000));
        setStatus(`Poblíž ${nearest.stores?.name || nearest.name || 'obchodu'} · potvrzuji pobyt ještě ${seconds} s.`, 'checking');
      }
    } catch (error) {
      setStatus(error?.message || 'Hlídání polohy se dočasně nepodařilo.', 'error');
    } finally {
      checking = false;
    }
  }

  function stopWatch() {
    if (watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    checking = false;
    resetCandidate();
  }

  async function startWatch(initialPosition = null) {
    if (!isEnabled() || watchId != null) return;
    if (!navigator.geolocation) throw new Error('Tento prohlížeč nepodporuje polohu.');
    await ensureDependencies();

    if (initialPosition) evaluatePosition(initialPosition, true);

    watchId = navigator.geolocation.watchPosition(
      (position) => evaluatePosition(position),
      (error) => {
        if (error.code === 1) {
          setEnabled(false);
          stopWatch();
          updateUi();
          setStatus('Přístup k poloze byl zakázán. Hlídání jsem vypnul.', 'error');
        } else {
          setStatus('Čekám na dostupnou polohu telefonu…', '');
        }
      },
      { enableHighAccuracy:false, timeout:20000, maximumAge:45000 },
    );
  }

  async function enableFromUser() {
    setStatus('Zapínám upozornění…', 'checking');
    await requestNotificationPermission();
    const a = await ensureDependencies();
    const position = await a.getPosition();
    setEnabled(true);
    patchState({ enabledAt: Date.now() });
    updateUi();
    setStatus('Zapnuto · při příchodu zkontroluji seznam nebo základní potraviny v akci.', 'ok');
    await startWatch(position);
  }

  function disable() {
    setEnabled(false);
    stopWatch();
    patchState({ currentBranchId:null, currentStoreId:null });
    updateUi();
    setStatus('Upozornění při příchodu jsou vypnutá.', '');
  }

  async function toggleFromUser() {
    const button = document.getElementById('slArrivalToggle');
    if (button) button.disabled = true;
    try {
      if (isEnabled()) disable();
      else await enableFromUser();
    } catch (error) {
      setEnabled(false);
      stopWatch();
      updateUi();
      setStatus(error?.message || 'Funkci se nepodařilo zapnout.', 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  function init() {
    ensureUi();
    let attempts = 0;
    const uiTimer = window.setInterval(() => {
      attempts += 1;
      if (ensureUi() || attempts >= 80) window.clearInterval(uiTimer);
    }, 100);

    if (isEnabled()) {
      if ('Notification' in window && Notification.permission === 'denied') {
        disable();
      } else {
        ensureDependencies().then(() => startWatch()).catch((error) => setStatus(error.message, 'error'));
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && isEnabled() && watchId == null) {
        startWatch().catch(() => {});
      }
    });

    window.addEventListener('pageshow', () => {
      if (isEnabled() && watchId == null) startWatch().catch(() => {});
    });

    window.addEventListener('storage', (event) => {
      if (event.key !== ENABLED_KEY) return;
      updateUi();
      if (isEnabled()) startWatch().catch(() => {}); else stopWatch();
    });
  }

  window.SlevaoStoreArrival = {
    isEnabled,
    enable: enableFromUser,
    disable,
    evaluatePosition,
    status: state,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
