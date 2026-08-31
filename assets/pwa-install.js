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

  function isStandalone() {
    return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function removePrompt() {
    promptNode?.remove();
    promptNode = null;
  }

  function showPrompt() {
    if (!installEvent || isStandalone() || promptNode) return;
    promptNode = document.createElement('aside');
    promptNode.className = 'sfInstallPrompt';
    promptNode.setAttribute('role', 'dialog');
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
      await installEvent.userChoice.catch(() => null);
      installEvent = null;
      removePrompt();
    });
    promptNode.querySelector('.sfInstallPrompt__close').addEventListener('click', () => {
      sessionStorage.setItem('slevao-install-dismissed', '1');
      removePrompt();
    });
  }

  const style = document.createElement('style');
  style.textContent = `.sfInstallPrompt{position:fixed;left:50%;bottom:82px;z-index:10040;width:min(94vw,620px);transform:translateX(-50%);display:grid;grid-template-columns:auto 1fr auto auto;gap:12px;align-items:center;padding:12px 13px;border:1px solid #cfe3df;border-radius:18px;background:rgba(255,255,255,.98);box-shadow:0 20px 60px rgba(15,45,40,.2);backdrop-filter:blur(16px);font-family:Inter,system-ui,sans-serif}.sfInstallPrompt__icon{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(135deg,#0b776f,#12b8a6);color:#fff;font-size:22px;font-weight:950}.sfInstallPrompt__text{display:grid;gap:2px;color:#10201e}.sfInstallPrompt__text strong{font-size:15px}.sfInstallPrompt__text span{font-size:12px;color:#667774}.sfInstallPrompt button{border:0;cursor:pointer;font:850 13px system-ui,sans-serif}.sfInstallPrompt__install{min-height:40px;padding:0 15px;border-radius:11px!important;background:#0b776f;color:#fff}.sfInstallPrompt__close{width:36px;height:36px;border-radius:10px!important;background:#eef4f3;color:#4d5e5a;font-size:20px!important}@media(max-width:620px){.sfInstallPrompt{grid-template-columns:auto 1fr auto}.sfInstallPrompt__install{grid-column:2/3;justify-self:start}.sfInstallPrompt__close{grid-column:3;grid-row:1}}`;
  document.head.appendChild(style);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installEvent = event;
    if (sessionStorage.getItem('slevao-install-dismissed') !== '1') setTimeout(showPrompt, 1500);
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    removePrompt();
  });
})();
