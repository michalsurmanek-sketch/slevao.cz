(() => {
  'use strict';

  const TEST_ID = 'slArrivalTest';
  const TEST_LABEL = '🔔 Poslat tuto ukázku';
  const DEALS = [
    '🥩 Kuřecí maso — 44,90 Kč  🔻50 %',
    '🥛 Mléko 1 l — 19,90 Kč  🔻50 %',
    '🥔 Brambory — 9,90 Kč/kg  🔻60 %',
    '🥚 Vejce 10 ks — 39,90 Kč  🔻28 %',
    '🧈 Máslo 250 g — 44,90 Kč  🔻31 %',
  ];
  const EXAMPLES = [
    { title: '🔥 Dnešní základní potraviny v akci', intro: '' },
    { title: '🛒 Co se dnes vyplatí koupit', intro: '' },
    { title: '💸 Dnešní nejlepší ceny základních potravin', intro: '' },
  ];

  let exampleIndex = 0;

  function currentExample() {
    return EXAMPLES[exampleIndex % EXAMPLES.length];
  }

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

    const example = currentExample();
    const body = `${DEALS.join('\n')}\n\n→ Zobrazit všechny akce na SLEVAO`;
    const options = {
      body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: `slevao-arrival-test-${Date.now()}`,
      renotify: false,
      data: { url: '/index.html#dealsSection', test: true, scenario: 'staples-list', variant: exampleIndex },
      vibrate: [90, 45, 90],
    };

    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(example.title, options);
        return;
      } catch {}
    }

    const notification = new Notification(example.title, options);
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
    setStatus(`TEST: odesílám seznamovou variantu ${exampleIndex + 1} z ${EXAMPLES.length}. GPS ani nákupní seznam se nekontrolují.`, 'checking');

    try {
      await sendNotification();
      button.textContent = '✓ Ukázka odeslána';
      exampleIndex = (exampleIndex + 1) % EXAMPLES.length;
      setStatus('Ukázka byla odeslána jako kompaktní seznam bez velkého produktového obrázku.', 'ok');
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
    button.title = 'Pošle seznamovou ukázku bez kontroly GPS a potom připraví další formulaci';
    button.addEventListener('click', testFromUser);

    const status = document.getElementById('slArrivalStatus');
    if (status) status.before(button);
    else control.append(button);
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
