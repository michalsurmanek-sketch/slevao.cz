(() => {
  'use strict';

  const TEST_ID = 'slArrivalTest';
  const PREVIEW_ID = 'slArrivalTestPreview';
  const TEST_LABEL = '🔔 Poslat tuto ukázku';
  const EXAMPLE_TITLE = '[TEST] Základní potraviny v akci · Kaufland 🛒';
  const EXAMPLE_BODY = 'Kuřecí maso 44,90 Kč (−50 %) · Mléko 19,90 Kč (−50 %) · Brambory 9,90 Kč (−60 %).';
  const EXAMPLE_IMAGE = 'https://uhampjdqjxmbhaptgitn.supabase.co/storage/v1/object/public/product-images/manual/c5f264f1-9fbf-49b7-a606-fa744e6e0615/brambory-chatgpt-1b151632.webp';

  function setStatus(text, type = '') {
    const node = document.getElementById('slArrivalStatus');
    if (!node) return;
    node.textContent = text || '';
    node.dataset.type = type;
  }

  function ensureStyle() {
    if (document.getElementById('slArrivalTestStyle')) return;
    const style = document.createElement('style');
    style.id = 'slArrivalTestStyle';
    style.textContent = `
      .slArrivalTestPreview{margin-top:8px;padding:10px;border:1px solid rgba(8,126,117,.16);border-radius:13px;background:#fff;box-shadow:0 8px 22px rgba(8,126,117,.08)}
      .slArrivalTestPreviewLabel{display:block;margin-bottom:7px;color:#6f7d7b;font:800 9px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.06em;text-transform:uppercase}
      .slArrivalTestPreviewCard{display:grid;grid-template-columns:54px minmax(0,1fr);gap:9px;align-items:center}
      .slArrivalTestPreviewImage{width:54px;height:54px;display:block;object-fit:contain;border-radius:10px;background:#f4faf9;border:1px solid rgba(8,126,117,.1)}
      .slArrivalTestPreviewCopy{min-width:0;display:grid;gap:3px}
      .slArrivalTestPreviewCopy strong{color:#12202d;font:900 11.5px/1.25 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .slArrivalTestPreviewCopy span{color:#53615f;font:700 10.5px/1.35 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .slArrivalTestPreviewCopy small{color:#0a8b80;font:800 9.5px/1.25 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .slArrivalTest{width:100%;margin-top:7px;min-height:38px;border:1px dashed #9ed9d2;border-radius:11px;background:rgba(240,252,250,.86);color:#087c72;font:900 11px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;transition:background .16s ease,border-color .16s ease,transform .16s ease}
      .slArrivalTest:hover{background:#fff;border-color:#37b8aa;transform:translateY(-1px)}
      .slArrivalTest:disabled{opacity:.65;cursor:wait;transform:none}
      @media(max-width:620px){.slArrivalTest{min-height:36px;font-size:10.5px}.slArrivalTestPreviewCard{grid-template-columns:48px minmax(0,1fr)}.slArrivalTestPreviewImage{width:48px;height:48px}}
      @media(prefers-reduced-motion:reduce){.slArrivalTest{transition:none}.slArrivalTest:hover{transform:none}}
    `;
    document.head.appendChild(style);
  }

  async function sendNotification() {
    if (!('Notification' in window)) throw new Error('Tento prohlížeč nepodporuje oznámení.');

    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Nejdřív povol oznámení pro Slevao.cz.');

    const options = {
      body: `Ukázka bez nákupního seznamu: ${EXAMPLE_BODY}`,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      image: EXAMPLE_IMAGE,
      tag: `slevao-arrival-test-${Date.now()}`,
      renotify: false,
      data: { url: '/index.html#dealsSection', test: true, scenario: 'no-list-staples' },
      vibrate: [90, 45, 90],
    };

    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(EXAMPLE_TITLE, options);
        return;
      } catch {}
    }

    const notification = new Notification(EXAMPLE_TITLE, options);
    notification.onclick = () => {
      window.focus();
      window.location.href = options.data.url;
      notification.close();
    };
  }

  async function testFromUser() {
    const button = document.getElementById(TEST_ID);
    if (!button) return;
    button.disabled = true;
    button.textContent = 'Odesílám ukázku…';
    setStatus('TEST: GPS ani nákupní seznam se nekontrolují. Odesílám ukázku výše.', 'checking');

    try {
      await sendNotification();
      button.textContent = '✓ Ukázka odeslána';
      setStatus('Ukázka byla odeslána jako systémové upozornění. Ve skutečnosti se produkty a ceny vyberou z aktuálních akcí konkrétního obchodu.', 'ok');
      window.setTimeout(() => { if (button.isConnected) button.textContent = TEST_LABEL; }, 3200);
    } catch (error) {
      button.textContent = TEST_LABEL;
      setStatus(error?.message || 'Testovací upozornění se nepodařilo odeslat.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  function createPreview() {
    const preview = document.createElement('div');
    preview.id = PREVIEW_ID;
    preview.className = 'slArrivalTestPreview';
    preview.innerHTML = `
      <span class="slArrivalTestPreviewLabel">Ukázka upozornění bez seznamu</span>
      <div class="slArrivalTestPreviewCard">
        <img class="slArrivalTestPreviewImage" src="${EXAMPLE_IMAGE}" alt="Ukázka produktu Brambory" loading="lazy">
        <div class="slArrivalTestPreviewCopy">
          <strong>Základní potraviny v akci · Kaufland 🛒</strong>
          <span>${EXAMPLE_BODY}</span>
          <small>Skutečné upozornění použije právě platné ceny v obchodě.</small>
        </div>
      </div>`;
    return preview;
  }

  function install() {
    ensureStyle();
    const control = document.getElementById('slArrivalControl');
    if (!control) return false;
    if (document.getElementById(TEST_ID)) return true;

    const preview = createPreview();
    const button = document.createElement('button');
    button.id = TEST_ID;
    button.className = 'slArrivalTest';
    button.type = 'button';
    button.textContent = TEST_LABEL;
    button.title = 'Pošle zobrazenou ukázku bez kontroly GPS a bez nákupního seznamu';
    button.addEventListener('click', testFromUser);

    const status = document.getElementById('slArrivalStatus');
    if (status) {
      status.before(preview);
      status.before(button);
    } else {
      control.append(preview, button);
    }
    return true;
  }

  function init() {
    if (install()) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (install() || tries >= 100) window.clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once:true });
  else init();
})();
