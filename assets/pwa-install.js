(() => {
  'use strict';

  if (!document.querySelector('link[rel="manifest"]')) {
    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = 'manifest.webmanifest?v=20260804-1';
    document.head.appendChild(manifest);
  }

  const mobileCapable = document.createElement('meta');
  mobileCapable.name = 'mobile-web-app-capable';
  mobileCapable.content = 'yes';
  if (!document.querySelector('meta[name="mobile-web-app-capable"]')) document.head.appendChild(mobileCapable);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    const registerServiceWorker = () => navigator.serviceWorker.register('/service-worker.js', { scope:'/' }).catch(() => null);
    if (document.readyState === 'complete') registerServiceWorker();
    else window.addEventListener('load', registerServiceWorker, { once:true });
  }

  let installEvent = null;
  let promptNode = null;
  let promptTimer = 0;
  const VISIT_COUNT_KEY = 'slevao-install-visit-count';
  const VISIT_SESSION_KEY = 'slevao-install-visit-counted';
  const DISMISS_UNTIL_KEY = 'slevao-install-dismissed-until';
  const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;
  let engaged = false;

  function readNumber(storage, key) {
    const value = Number(storage.getItem(key) || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function registerVisit() {
    let visits = readNumber(localStorage, VISIT_COUNT_KEY);
    if (sessionStorage.getItem(VISIT_SESSION_KEY) !== '1') {
      visits += 1;
      localStorage.setItem(VISIT_COUNT_KEY, String(Math.min(visits, 20)));
      sessionStorage.setItem(VISIT_SESSION_KEY, '1');
    }
    engaged = visits >= 2;
  }

  function isDismissed() {
    return readNumber(localStorage, DISMISS_UNTIL_KEY) > Date.now();
  }

  function isStandalone() {
    return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function removePrompt() {
    window.clearTimeout(promptTimer);
    promptTimer = 0;
    promptNode?.remove();
    promptNode = null;
  }

  function showPrompt() {
    if (!installEvent || isStandalone() || isDismissed() || !engaged || promptNode) return;
    promptNode = document.createElement('aside');
    promptNode.className = 'sfInstallPrompt';
    promptNode.setAttribute('role', 'region');
    promptNode.setAttribute('aria-label', 'Instalace aplikace Slevao');
    promptNode.innerHTML = `
      <div class="sfInstallPrompt__icon">%</div>
      <div class="sfInstallPrompt__text"><strong>Přidat Slevao na plochu</strong><span>Rychlejší otevření akcí a nákupního seznamu.</span></div>
      <button class="sfInstallPrompt__install" type="button">Přidat</button>
      <button class="sfInstallPrompt__close" type="button" aria-label="Zavřít">×</button>`;
    document.body.appendChild(promptNode);

    promptNode.querySelector('.sfInstallPrompt__install').addEventListener('click', async () => {
      if (!installEvent) return;
      installEvent.prompt();
      const choice = await installEvent.userChoice.catch(() => null);
      if (choice?.outcome !== 'accepted') {
        localStorage.setItem(DISMISS_UNTIL_KEY, String(Date.now() + DISMISS_MS));
      }
      installEvent = null;
      removePrompt();
    });
    promptNode.querySelector('.sfInstallPrompt__close').addEventListener('click', () => {
      localStorage.setItem(DISMISS_UNTIL_KEY, String(Date.now() + DISMISS_MS));
      removePrompt();
    });
  }

  function schedulePrompt(delay = 6000) {
    if (!installEvent || isStandalone() || isDismissed() || !engaged || promptNode || promptTimer) return;
    promptTimer = window.setTimeout(() => {
      promptTimer = 0;
      showPrompt();
    }, delay);
  }

  function markEngaged() {
    if (engaged) return;
    engaged = true;
    schedulePrompt(800);
  }

  const style = document.createElement('style');
  style.textContent = `.sfInstallPrompt{position:fixed;right:20px;bottom:20px;z-index:10040;width:min(380px,calc(100vw - 40px));display:grid;grid-template-columns:auto 1fr auto;gap:11px;align-items:center;padding:12px 13px;border:1px solid #cfe3df;border-radius:18px;background:rgba(255,255,255,.98);box-shadow:0 20px 60px rgba(15,45,40,.2);backdrop-filter:blur(16px);font-family:Inter,system-ui,sans-serif}.sfInstallPrompt__icon{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(135deg,#0b776f,#12b8a6);color:#fff;font-size:22px;font-weight:950}.sfInstallPrompt__text{display:grid;gap:2px;color:#10201e}.sfInstallPrompt__text strong{font-size:15px}.sfInstallPrompt__text span{font-size:12px;color:#667774}.sfInstallPrompt button{border:0;cursor:pointer;font:850 13px system-ui,sans-serif}.sfInstallPrompt__install{grid-column:2/3;justify-self:start;min-height:40px;padding:0 15px;border-radius:11px!important;background:#0b776f;color:#fff}.sfInstallPrompt__close{grid-column:3;grid-row:1;width:36px;height:36px;border-radius:10px!important;background:#eef4f3;color:#4d5e5a;font-size:20px!important}@media(max-width:620px){.sfInstallPrompt{left:12px;right:12px;bottom:78px;width:auto}}`;
  document.head.appendChild(style);

  try {
    registerVisit();
  } catch {
    engaged = false;
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest?.('#searchButton,[data-add-list],.addList,.sfAddList,#savedButton,#homeAutopilot button,#slLiveManual button')) {
      markEngaged();
    }
  }, true);
  document.addEventListener('slevao:list-item-added', markEngaged);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installEvent = event;
    schedulePrompt();
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    removePrompt();
  });
})();
