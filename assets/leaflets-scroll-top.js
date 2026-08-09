(() => {
  'use strict';

  const button = document.getElementById('leafletsScrollTop');
  if (!button) return;

  const mobile = window.matchMedia('(max-width: 800px)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;

  function refresh() {
    frame = 0;
    if (!mobile.matches) {
      button.classList.remove('is-visible');
      return;
    }

    const top = window.scrollY || document.documentElement.scrollTop || 0;
    const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const progress = Math.max(0, Math.min(1, top / max));

    button.style.setProperty('--scroll-progress', `${Math.round(progress * 360)}deg`);
    button.classList.toggle('is-visible', top > 420);
  }

  function scheduleRefresh() {
    if (frame) return;
    frame = window.requestAnimationFrame(refresh);
  }

  button.addEventListener('click', () => {
    button.blur();
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: reducedMotion.matches ? 'auto' : 'smooth'
    });
  });

  window.addEventListener('scroll', scheduleRefresh, { passive: true });
  window.addEventListener('resize', scheduleRefresh, { passive: true });
  if (typeof mobile.addEventListener === 'function') mobile.addEventListener('change', scheduleRefresh);

  refresh();
})();
