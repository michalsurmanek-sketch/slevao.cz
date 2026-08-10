(() => {
  'use strict';

  const panel = document.querySelector('.heroNearbyPanel');
  if (!panel) return;

  const mobile = window.matchMedia('(max-width: 800px)');
  const topline = panel.querySelector('.slLiveTopline');
  if (!topline) return;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'nearbyMobileToggle';
  toggle.setAttribute('aria-label', 'Rozbalit hledání obchodů poblíž');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.innerHTML = `
    <span class="nearbyMobileToggleLabel"><i aria-hidden="true"></i>POBLÍŽ VÁS</span>
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
  `;
  panel.appendChild(toggle);
  panel.classList.add('nearbyMobileCollapsible');

  const contentNodes = [...panel.children].filter((node) => node !== topline && node !== toggle);

  function setContentInteractive(enabled) {
    contentNodes.forEach((node) => {
      if (!(node instanceof HTMLElement)) return;
      node.inert = !enabled;
      if (enabled) node.removeAttribute('aria-hidden');
      else node.setAttribute('aria-hidden', 'true');
    });
  }

  function setExpanded(expanded, focusToggle = false) {
    if (!mobile.matches) {
      panel.classList.remove('is-nearby-collapsed');
      panel.classList.add('is-nearby-expanded');
      toggle.setAttribute('aria-expanded', 'true');
      toggle.setAttribute('aria-label', 'Sbalit hledání obchodů poblíž');
      setContentInteractive(true);
      return;
    }

    panel.classList.toggle('is-nearby-expanded', expanded);
    panel.classList.toggle('is-nearby-collapsed', !expanded);
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    toggle.setAttribute('aria-label', expanded ? 'Sbalit hledání obchodů poblíž' : 'Rozbalit hledání obchodů poblíž');
    setContentInteractive(expanded);
    if (focusToggle) toggle.focus({ preventScroll: true });
  }

  function togglePanel() {
    if (!mobile.matches) return;
    setExpanded(!panel.classList.contains('is-nearby-expanded'));
  }

  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    togglePanel();
  });

  panel.addEventListener('click', (event) => {
    if (!mobile.matches || !panel.classList.contains('is-nearby-collapsed')) return;
    if (event.target.closest('a,button,input,select,textarea,label')) return;
    togglePanel();
  });

  panel.addEventListener('keydown', (event) => {
    if (!mobile.matches || !panel.classList.contains('is-nearby-collapsed')) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    togglePanel();
  });

  const onViewportChange = () => setExpanded(!mobile.matches);
  if (typeof mobile.addEventListener === 'function') mobile.addEventListener('change', onViewportChange);

  setExpanded(!mobile.matches);
})();
