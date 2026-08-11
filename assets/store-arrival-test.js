(() => {
  'use strict';

  const TEST_ID = 'slArrivalTest';
  const TEST_LABEL = '🔔 TEST bez polohy – vyzkoušet';

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
      .slArrivalTest{width:100%;margin-top:7px;min-height:38px;border:1px dashed #9ed9d2;border-radius:11px;background:rgba(240,252,250,.86);color:#087c72;font:900 11px/1.2 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer;transition:background .16s ease,border-color .16s ease,transform .16s ease}
      .slArrivalTest:hover{background:#fff;border-color:#37b8aa;transform:translateY(-1px)}
      .slArrivalTest:disabled{opacity:.65;cursor:wait;transform:none}
      @media(max-width:620px){.slArrivalTest{min-height:36px;font-size:10.5px}}
      @media(prefers-reduced-motion:reduce){.slArrivalTest{transition:none}.slArrivalTest:hover{transform:none}}
    `;
    document.head.appendChild(style);
  }

  async function sendNotification() {
    if (!('Notification' in window)) throw new Error('Tento prohlížeč nepodporuje oznámení.');

    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Nejdřív povol oznámení pro Slevao.cz.');

    const title = '[TEST] Základní potraviny v akci · Kaufland 🛒';
    const options = {
      body: 'Bez nákupního seznamu: Kuřecí maso 44,90 Kč (−50 %) · Mléko 19,90 Kč (−50 %) · Brambory 9,90 Kč (−60 %).',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      image: 'https://uhampjdqjxmbhaptgitn.supabase.co/storage/v1/object/public/product-images/manual/c5f264f1-9fbf-49b7-a606-fa744e6e0615/brambory-chatgpt-1b151632.webp',
      tag: `slevao-arrival-test-${Date.now()}`,
      renotify: false,
      data: { url: '/index.html#dealsSection', test: true, scenario: 'no-list-staples' },
      vibrate: [90, 45, 90],
    };

    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(title, options);
        return;
      } catch {}
    }

    const notification = new Notification(title, options);
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
    button.textContent = 'Odesílám test bez seznamu…';
    setStatus('TEST: GPS ani nákupní seznam se nekontrolují. Simuluji základní potraviny v akci.', 'checking');

    try {
      await sendNotification();
      button.textContent = '✓ Test bez seznamu odeslán';
      setStatus('Test scénáře bez nákupního seznamu byl odeslán. Ve skutečnosti se ceny vyberou z aktuálních akcí konkrétní pobočky.', 'ok');
      window.setTimeout(() => { if (button.isConnected) button.textContent = TEST_LABEL; }, 3200);
    } catch (error) {
      button.textContent = TEST_LABEL;
      setStatus(error?.message || 'Testovací upozornění se nepodařilo odeslat.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  function install() {
    ensureStyle();
    const control = document.getElementById('slArrivalControl');
    if (!control) return false;
    if (document.getElementById(TEST_ID)) return true;

    const button = document.createElement('button');
    button.id = TEST_ID;
    button.className = 'slArrivalTest';
    button.type = 'button';
    button.textContent = TEST_LABEL;
    button.title = 'Simulace upozornění bez GPS a bez nákupního seznamu';
    button.addEventListener('click', testFromUser);

    const status = document.getElementById('slArrivalStatus');
    if (status) status.before(button); else control.appendChild(button);
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
