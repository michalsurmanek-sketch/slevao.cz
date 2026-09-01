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
  let eligible = false;
  let engaged = false;

  const VISIT_COUNT_KEY = 'slevao-install-visit-count';
  const VISIT_SESSION_KEY = 'slevao-install-visit-counted';
  const PERMANENT_DISMISS_KEY = 'slevao-install-dismissed-permanently';
  const COOLDOWN_UNTIL_KEY = 'slevao-install-cooldown-until';
  const LAST_SHOWN_KEY = 'slevao-install-last-shown';
  const DISMISS_UNTIL_KEY = 'slevao-install-dismissed-until';
  const DISMISS_MS = 14 * 24 * 60 * 60 * 1000;
  const CHOICE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;
  const SHOW_FREQUENCY_MS = 7 * 24 * 60 * 60 * 1000;

  function safeGet(storage, key) {
    try { return storage.getItem(key); } catch { return null; }
  }

  function safeSet(storage, key, value) {
    try { storage.setItem(key, String(value)); return true; } catch { return false; }
  }

  function readNumber(storage, key) {
    const value = Number(safeGet(storage, key) || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function registerVisit() {
    let visits = readNumber(localStorage, VISIT_COUNT_KEY);
    if (safeGet(sessionStorage, VISIT_SESSION_KEY) !== '1') {
      visits += 1;
      safeSet(localStorage, VISIT_COUNT_KEY, Math.min(visits, 20));
      safeSet(sessionStorage, VISIT_SESSION_KEY, '1');
    }
    engaged = visits >= 2;
    eligible = visits >= 2;
  }

  function isPermanentlyDismissed() {
    return safeGet(localStorage, PERMANENT_DISMISS_KEY) === '1';
  }

  function isCoolingDown() {
    return Math.max(
      readNumber(localStorage, COOLDOWN_UNTIL_KEY),
      readNumber(localStorage, DISMISS_UNTIL_KEY)
    ) > Date.now();
  }

  function wasShownRecently() {
    const lastShown = readNumber(localStorage, LAST_SHOWN_KEY);
    return lastShown > 0 && Date.now() - lastShown < SHOW_FREQUENCY_MS;
  }

  function isSuppressed() {
    return isPermanentlyDismissed() || isCoolingDown() || wasShownRecently();
  }

  function isStandalone() {
    return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function isVisibleInViewport(node) {
    if (!node || node.hidden) return false;
    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0
      && rect.bottom > 0 && rect.top < window.innerHeight
      && rect.right > 0 && rect.left < window.innerWidth;
  }

  function isPrimaryExperienceVisible() {
    const blockers = [
      document.querySelector('.heroCard'),
      document.getElementById('homeAutopilot'),
      document.querySelector('.sfModal:not([hidden])'),
      document.querySelector('#compareModal:not([hidden])'),
      document.querySelector('#reportModal:not([hidden])')
    ];
    return blockers.some(isVisibleInViewport);
  }

  function removePrompt() {
    window.clearTimeout(promptTimer);
    promptTimer = 0;
    promptNode?.remove();
    promptNode = null;
  }

  function schedulePrompt(delay = 6000) {
    if (!installEvent || isStandalone() || isSuppressed() || !eligible || promptNode || promptTimer) return;
    promptTimer = window.setTimeout(() => {
      promptTimer = 0;
      showPrompt();
    }, delay);
  }

  function showPrompt() {
    if (!installEvent || isStandalone() || isSuppressed() || !eligible || promptNode) return;
    if (isPrimaryExperienceVisible()) {
      schedulePrompt(1800);
      return;
    }

    safeSet(localStorage, LAST_SHOWN_KEY, Date.now());
    promptNode = document.createElement('aside');
    promptNode.className = 'sfInstallPrompt';
    promptNode.setAttribute('role', 'region');
    promptNode.setAttribute('aria-label', 'Instalace aplikace Slevao');
    promptNode.innerHTML = `
      <div class="sfInstallPrompt__icon">%</div>
      <div class="sfInstallPrompt__text"><strong>Přidat Slevao na plochu</strong><span>Rychlejší otevření akcí a nákupního seznamu.</span></div>
      <button class="sfInstallPrompt__install" type="button">Přidat</button>
      <button class="sfInstallPrompt__close" type="button" aria-label="Už nenabízet instalaci" title="Už nenabízet">×</button>`;
    document.body.appendChild(promptNode);

    promptNode.querySelector('.sfInstallPrompt__install').addEventListener('click', async () => {
      if (!installEvent) return;
      installEvent.prompt();
      const choice = await installEvent.userChoice.catch(() => null);
      if (choice?.outcome !== 'accepted') {
        safeSet(localStorage, COOLDOWN_UNTIL_KEY, Date.now() + CHOICE_COOLDOWN_MS);
        // Keep the legacy key for older cached clients while the new client enforces 30 days.
        try { localStorage.setItem(DISMISS_UNTIL_KEY, String(Date.now() + DISMISS_MS)); } catch {}
      }
      installEvent = null;
      removePrompt();
    });

    promptNode.querySelector('.sfInstallPrompt__close').addEventListener('click', () => {
      safeSet(localStorage, PERMANENT_DISMISS_KEY, '1');
      installEvent = null;
      removePrompt();
    });
  }

  function markEngaged() {
    if (eligible || isPermanentlyDismissed()) return;
    engaged = true;
    eligible = true;
    schedulePrompt(800);
  }

  const markSuccessfulAction = markEngaged;

  function verifySuccessfulListAddition(button) {
    if (!button || eligible) return;
    const deadline = Date.now() + 6000;
    const verify = () => {
      if (eligible || isPermanentlyDismissed()) return;
      const added = button.classList?.contains('is-added') || /^Přidáno\b/i.test(String(button.textContent || '').trim());
      if (added) {
        markSuccessfulAction();
        return;
      }
      if (button.isConnected && Date.now() < deadline) window.setTimeout(verify, 120);
    };
    window.setTimeout(verify, 120);
  }

  const style = document.createElement('style');
  style.textContent = `.sfInstallPrompt{position:fixed;right:20px;bottom:20px;z-index:10040;width:min(380px,calc(100vw - 40px));display:grid;grid-template-columns:auto 1fr auto;gap:11px;align-items:center;padding:12px 13px;border:1px solid #cfe3df;border-radius:18px;background:rgba(255,255,255,.98);box-shadow:0 20px 60px rgba(15,45,40,.2);backdrop-filter:blur(16px);font-family:Inter,system-ui,sans-serif}.sfInstallPrompt__icon{width:44px;height:44px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(135deg,#0b776f,#12b8a6);color:#fff;font-size:22px;font-weight:950}.sfInstallPrompt__text{display:grid;gap:2px;color:#10201e}.sfInstallPrompt__text strong{font-size:15px}.sfInstallPrompt__text span{font-size:12px;color:#667774}.sfInstallPrompt button{border:0;cursor:pointer;font:850 13px system-ui,sans-serif}.sfInstallPrompt__install{grid-column:2/3;justify-self:start;min-height:40px;padding:0 15px;border-radius:11px!important;background:#0b776f;color:#fff}.sfInstallPrompt__close{grid-column:3;grid-row:1;width:36px;height:36px;border-radius:10px!important;background:#eef4f3;color:#4d5e5a;font-size:20px!important}@media(max-width:620px){.sfInstallPrompt{left:12px;right:12px;bottom:78px;width:auto}}`;
  document.head.appendChild(style);

  registerVisit();

  // First-visit eligibility is based on a completed action, never on a bare CTA click.
  document.addEventListener('click', (event) => {
    const addButton = event.target.closest?.('[data-sf-add],[data-add-list],.addList,.sfAddList');
    if (addButton) verifySuccessfulListAddition(addButton);
  }, true);
  document.addEventListener('slevao:list-item-added', markSuccessfulAction);
  document.addEventListener('slevao:successful-action', markSuccessfulAction);

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installEvent = event;
    schedulePrompt();
  });

  window.addEventListener('scroll', () => schedulePrompt(900), { passive:true });
  window.addEventListener('resize', () => schedulePrompt(900), { passive:true });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    removePrompt();
  });

  window.SlevaoPwaInstall = { markSuccessfulAction };
})();
