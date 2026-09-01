(() => {
  'use strict';

  const footerBootStyleId = 'slevaoFooterBootGuard';
  if (!document.getElementById(footerBootStyleId)) {
    const footerBootStyle = document.createElement('style');
    footerBootStyle.id = footerBootStyleId;
    footerBootStyle.textContent = '.footerQuickIcons:not([data-section-jumps="1"]){visibility:hidden!important}.footerDesktopAccount{display:none!important}';
    document.head.appendChild(footerBootStyle);
  }

  if (!document.querySelector('script[src*="footer-section-jumps.js"]')) {
    const sectionJumpScript = document.createElement('script');
    sectionJumpScript.src = 'assets/footer-section-jumps.js?v=20260831-8';
    sectionJumpScript.defer = true;
    document.head.appendChild(sectionJumpScript);
  }

  if (!document.querySelector('link[href*="public-features.css"]')) {
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = 'assets/public-features.css?v=20260816-5';
    document.head.appendChild(style);
  }
  if (!document.querySelector('script[src*="public-features.js"]')) {
    const script = document.createElement('script');
    script.src = 'assets/public-features.js?v=20260828-2';
    script.defer = true;
    document.head.appendChild(script);
  }
  if (!document.querySelector('script[src*="public-nav-upgrade.js"]')) {
    const navScript = document.createElement('script');
    navScript.src = 'assets/public-nav-upgrade.js?v=20260901-2';
    navScript.defer = true;
    document.head.appendChild(navScript);
  }
  if (!document.querySelector('link[href*="home-quick-food-filter.css"]')) {
    const quickFoodStyle = document.createElement('link');
    quickFoodStyle.rel = 'stylesheet';
    quickFoodStyle.href = 'assets/home-quick-food-filter.css?v=20260829-2';
    document.head.appendChild(quickFoodStyle);
  }
  if (!document.querySelector('script[src*="home-quick-food-filter.js"]')) {
    const quickFoodScript = document.createElement('script');
    quickFoodScript.src = 'assets/home-quick-food-filter.js?v=20260829-4';
    quickFoodScript.defer = true;
    document.head.appendChild(quickFoodScript);
  }
  if (!document.querySelector('link[href*="home-quick-food-personalize.css"]')) {
    const quickFoodPersonalizeStyle = document.createElement('link');
    quickFoodPersonalizeStyle.rel = 'stylesheet';
    quickFoodPersonalizeStyle.href = 'assets/home-quick-food-personalize.css?v=20260901-3';
    document.head.appendChild(quickFoodPersonalizeStyle);
  }
  if (!document.querySelector('script[src*="home-quick-food-personalize.js"]')) {
    const quickFoodPersonalizeScript = document.createElement('script');
    quickFoodPersonalizeScript.src = 'assets/home-quick-food-personalize.js?v=20260811-1';
    quickFoodPersonalizeScript.defer = true;
    document.head.appendChild(quickFoodPersonalizeScript);
  }
  if (!document.querySelector('link[href*="home-autopilot.css"]')) {
    const autopilotStyle = document.createElement('link');
    autopilotStyle.rel = 'stylesheet';
    autopilotStyle.href = 'assets/home-autopilot.css?v=20260810-5';
    document.head.appendChild(autopilotStyle);
  }
  if (!document.querySelector('script[src*="home-autopilot.js"]')) {
    const autopilotScript = document.createElement('script');
    autopilotScript.src = 'assets/home-autopilot.js?v=20260829-1';
    autopilotScript.defer = true;
    document.head.appendChild(autopilotScript);
  }
  if (!document.querySelector('link[href*="home-save-today.css"]')) {
    const saveTodayStyle = document.createElement('link');
    saveTodayStyle.rel = 'stylesheet';
    saveTodayStyle.href = 'assets/home-save-today.css?v=20260815-7';
    document.head.appendChild(saveTodayStyle);
  }
  if (!document.querySelector('script[src*="home-save-today.js"]')) {
    const saveTodayScript = document.createElement('script');
    saveTodayScript.src = 'assets/home-save-today.js?v=20260815-8';
    saveTodayScript.defer = true;
    document.head.appendChild(saveTodayScript);
  }
  if (!document.querySelector('script[src*="home-save-text-helper.js"]')) {
    const saveTextHelper = document.createElement('script');
    saveTextHelper.src = 'assets/home-save-text-helper.js?v=20260807-1';
    saveTextHelper.defer = true;
    document.head.appendChild(saveTextHelper);
  }
  if (!document.querySelector('script[src*="location-service.js"]')) {
    const locationScript = document.createElement('script');
    locationScript.src = 'assets/location-service.js?v=20260821-1';
    locationScript.defer = true;
    document.head.appendChild(locationScript);
  }
  if (!document.querySelector('script[src*="home-live.js"]')) {
    const liveScript = document.createElement('script');
    liveScript.src = 'assets/home-live.js?v=20260901-1';
    liveScript.defer = true;
    document.head.appendChild(liveScript);
  }
  if (!document.querySelector('link[href*="home-in-store.css"]')) {
    const inStoreStyle = document.createElement('link');
    inStoreStyle.rel = 'stylesheet';
    inStoreStyle.href = 'assets/home-in-store.css?v=20260807-2';
    document.head.appendChild(inStoreStyle);
  }
  if (!document.querySelector('script[src*="home-in-store.js"]')) {
    const inStoreScript = document.createElement('script');
    inStoreScript.src = 'assets/home-in-store.js?v=20260807-1';
    inStoreScript.defer = true;
    document.head.appendChild(inStoreScript);
  }
  if (!document.querySelector('script[src*="home-in-store-safe.js"]')) {
    const inStoreSafeScript = document.createElement('script');
    inStoreSafeScript.src = 'assets/home-in-store-safe.js?v=20260807-2';
    inStoreSafeScript.defer = true;
    document.head.appendChild(inStoreSafeScript);
  }
  if (!document.querySelector('script[src*="home-in-store-equivalence.js"]')) {
    const inStoreEquivalenceScript = document.createElement('script');
    inStoreEquivalenceScript.src = 'assets/home-in-store-equivalence.js?v=20260807-1';
    inStoreEquivalenceScript.defer = true;
    document.head.appendChild(inStoreEquivalenceScript);
  }
  if (!document.querySelector('script[src*="home-in-store-actions.js"]')) {
    const inStoreActionsScript = document.createElement('script');
    inStoreActionsScript.src = 'assets/home-in-store-actions.js?v=20260807-1';
    inStoreActionsScript.defer = true;
    document.head.appendChild(inStoreActionsScript);
  }
  if (!document.querySelector('script[src*="home-in-store-list.js"]')) {
    const inStoreListScript = document.createElement('script');
    inStoreListScript.src = 'assets/home-in-store-list.js?v=20260807-1';
    inStoreListScript.defer = true;
    document.head.appendChild(inStoreListScript);
  }

  const hideInStore = () => {
    const node = document.getElementById('slInStore');
    if (!node) return;
    node.hidden = true;
    node.innerHTML = '';
  };
  document.addEventListener('submit', (event) => {
    if (event.target?.id === 'slLiveManual') hideInStore();
  });
  document.addEventListener('change', (event) => {
    if (event.target?.id === 'slLiveRadius') hideInStore();
  });

  const socialStyleId = 'slevaoFooterSocialStyle';
  if (!document.getElementById(socialStyleId)) {
    const socialStyle = document.createElement('style');
    socialStyle.id = socialStyleId;
    socialStyle.textContent = `
      .footerSocial{margin-top:18px;padding-top:16px;border-top:1px dashed rgba(145,224,216,.2)}
      .footerWatch .footerSocial{width:100%;box-sizing:border-box}
      .footerSocialTitle{margin:0 0 12px;color:#fff;font-size:15px;font-weight:950}
      .footerSocialLinks{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
      .footerSocialLink{width:44px;height:44px;display:grid;place-items:center;border:1px solid rgba(75,221,207,.42);border-radius:13px;color:#fff;background:rgba(255,255,255,.035);text-decoration:none;box-shadow:inset 0 1px 0 rgba(255,255,255,.04);transition:transform .16s ease,border-color .16s ease,background .16s ease,box-shadow .16s ease}
      .footerSocialLink:hover{transform:translateY(-2px);border-color:#49dfcf;background:rgba(53,215,198,.13);box-shadow:0 8px 20px rgba(0,0,0,.12)}
      .footerSocialLink svg{width:22px;height:22px;display:block;fill:currentColor}
      .footerSocialNote{display:block;margin-top:12px;color:#9fb9b6;font-size:12px;line-height:1.45}
      @media(max-width:900px){.footerSocial{max-width:520px}.footerSocialLink{width:46px;height:46px}}
      @media(max-width:620px){.footerSocial{margin-top:20px}.footerSocialTitle{font-size:14px}.footerSocialLinks{gap:9px}.footerSocialLink{width:43px;height:43px;border-radius:12px}.footerSocialNote{font-size:11.5px}}
      @media(prefers-reduced-motion:reduce){.footerSocialLink{transition:none}.footerSocialLink:hover{transform:none}}
    `;
    document.head.appendChild(socialStyle);
  }

  const footerWatch = document.querySelector('.footerWatch');
  const footerUseful = document.querySelector('.footerColumnUseful');
  let social = document.querySelector('.footerSocial');
  if (!social && (footerWatch || footerUseful)) {
    social = document.createElement('div');
    social.className = 'footerSocial';
    social.innerHTML = `
      <p class="footerSocialTitle">Sledujte nás</p>
      <div class="footerSocialLinks" aria-label="Sociální sítě Slevao.cz">
        <a class="footerSocialLink" href="https://www.facebook.com/" target="_blank" rel="noopener noreferrer" aria-label="Facebook" title="Facebook">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13.6 22v-9h3l.5-3.5h-3.5V7.3c0-1 .3-1.8 1.8-1.8h1.9V2.4c-.3 0-1.5-.1-2.8-.1-2.8 0-4.7 1.7-4.7 4.8v2.4H6.7V13h3.1v9h3.8Z"/></svg>
        </a>
        <a class="footerSocialLink" href="https://www.instagram.com/" target="_blank" rel="noopener noreferrer" aria-label="Instagram" title="Instagram">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.2 2h9.6A5.2 5.2 0 0 1 22 7.2v9.6a5.2 5.2 0 0 1-5.2 5.2H7.2A5.2 5.2 0 0 1 2 16.8V7.2A5.2 5.2 0 0 1 7.2 2Zm0 1.8a3.4 3.4 0 0 0-3.4 3.4v9.6a3.4 3.4 0 0 0 3.4 3.4h9.6a3.4 3.4 0 0 0 3.4-3.4V7.2a3.4 3.4 0 0 0-3.4-3.4H7.2Zm10.1 1.3a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4ZM12 6.9a5.1 5.1 0 1 1 0 10.2 5.1 5.1 0 0 1 0-10.2Zm0 1.8a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Z"/></svg>
        </a>
        <a class="footerSocialLink" href="https://www.tiktok.com/" target="_blank" rel="noopener noreferrer" aria-label="TikTok" title="TikTok">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.3 2h3.1c.2 1.2.8 2.3 1.7 3.1.8.8 1.8 1.3 2.9 1.5v3.2a8.8 8.8 0 0 1-4.6-1.4v6.7A6.9 6.9 0 1 1 11 8.2v3.3a3.7 3.7 0 1 0 3.3 3.6V2Z"/></svg>
        </a>
        <a class="footerSocialLink" href="https://www.youtube.com/" target="_blank" rel="noopener noreferrer" aria-label="YouTube" title="YouTube">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23 7.1a3 3 0 0 0-2.1-2.2C19 4.4 12 4.4 12 4.4s-7 0-8.9.5A3 3 0 0 0 1 7.1C.5 9 .5 12 .5 12s0 3 .5 4.9a3 3 0 0 0 2.1 2.2c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.2c.5-1.9.5-4.9.5-4.9s0-3-.5-4.9ZM9.7 15.3V8.7l5.8 3.3-5.8 3.3Z"/></svg>
        </a>
      </div>
      <small class="footerSocialNote">Nové akce, tipy a slevy každý den.</small>
    `;
  }

  const placeSocial = () => {
    if (!social) return;
    const desktop = window.matchMedia('(min-width:901px)').matches;
    const target = desktop ? footerWatch : footerUseful;
    if (target && social.parentElement !== target) target.appendChild(social);
  };
  placeSocial();
  const desktopMedia = window.matchMedia('(min-width:901px)');
  if (typeof desktopMedia.addEventListener === 'function') desktopMedia.addEventListener('change', placeSocial);
  else if (typeof desktopMedia.addListener === 'function') desktopMedia.addListener(placeSocial);

  const form = document.getElementById('footerAlertsForm');
  const input = document.getElementById('footerAlertEmail');
  const status = document.getElementById('footerAlertStatus');
  if (!form || !input || !status) return;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = input.value.trim();

    if (!email || !input.checkValidity()) {
      status.textContent = 'Zadej platnou e-mailovou adresu.';
      input.focus();
      return;
    }

    localStorage.setItem('slevao-account-email', email);
    status.textContent = 'Pokračuj do účtu a nastav konkrétní produkty i cílové ceny.';
    window.setTimeout(() => {
      window.location.href = `ucet.html?email=${encodeURIComponent(email)}&redirect=${encodeURIComponent(location.href)}`;
    }, 500);
  });
})();
