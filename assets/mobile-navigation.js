(() => {
  if (!document.querySelector('link[href*="top-tip-button.css"]')) {
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = 'assets/top-tip-button.css?v=20260808-4';
    styleLink.dataset.topTipStyle = 'true';
    document.head.appendChild(styleLink);
  }

  const savedButton = document.getElementById('savedButton');
  if (savedButton && !document.getElementById('topbarTipButton')) {
    const tipButton = document.createElement('a');
    tipButton.id = 'topbarTipButton';
    tipButton.className = 'topbarTipButton';
    tipButton.href = '#dealsSection';
    tipButton.setAttribute('aria-label', 'Tip dne');
    tipButton.title = 'Tip dne';
    tipButton.innerHTML = '<img src="assets/top-tip-icon.svg?v=20260808-1" alt="" aria-hidden="true">';
    savedButton.after(tipButton);
  }

  const tipButton = document.getElementById('topbarTipButton');
  if (tipButton) {
    tipButton.setAttribute('aria-label', 'Tip dne');
    tipButton.title = 'Tip dne';

    tipButton.addEventListener('click', (event) => {
      event.preventDefault();

      const quickTabs = document.getElementById('quickTabs');
      if (!quickTabs) return;

      const topbar = document.querySelector('.topbar');
      const headerHeight = topbar ? topbar.getBoundingClientRect().height : 0;
      const targetTop = window.scrollY + quickTabs.getBoundingClientRect().top - headerHeight - 14;

      window.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth'
      });

      if (window.location.hash !== '#dealsSection') {
        history.replaceState(null, '', '#dealsSection');
      }
    });
  }

  const mobileViewport = window.matchMedia('(max-width: 800px)');
  const statusPill = document.getElementById('statusPill');

  if (statusPill) {
    let canonicalStatus = statusPill.textContent.trim();
    let renderedStatus = canonicalStatus;

    const displayStatus = (value) => {
      const text = String(value || '').trim();
      if (text === '✓ Aktualizováno dnes') return 'Aktualizováno dnes';
      if (mobileViewport.matches && text === 'Obnovuji aktuální data…') return 'Obnovuji';
      if (mobileViewport.matches && text.startsWith('✓ ')) return text.slice(2);
      return text;
    };

    const syncStatus = () => {
      const current = statusPill.textContent.trim();
      if (current !== renderedStatus) canonicalStatus = current;
      const next = displayStatus(canonicalStatus);
      renderedStatus = next;
      if (current !== next) statusPill.textContent = next;
    };

    new MutationObserver(syncStatus).observe(statusPill, {
      childList: true,
      characterData: true,
      subtree: true
    });

    if (typeof mobileViewport.addEventListener === 'function') {
      mobileViewport.addEventListener('change', syncStatus);
    } else if (typeof mobileViewport.addListener === 'function') {
      mobileViewport.addListener(syncStatus);
    }

    syncStatus();
  }

  const navigation = document.querySelector('.mobileNav');
  if (!navigation) return;

  const links = [...navigation.querySelectorAll('a[href^="#"]')];
  const sections = links
    .map((link) => {
      const id = link.getAttribute('href');
      const section = id === '#top' ? document.querySelector('.hero') : (id ? document.querySelector(id) : null);
      return section ? { link, section } : null;
    })
    .filter(Boolean);

  const setActive = (activeLink) => {
    links.forEach((link) => {
      if (link === activeLink) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  };

  links.forEach((link) => {
    link.addEventListener('click', () => setActive(link));
  });

  if (!('IntersectionObserver' in window) || sections.length === 0) {
    setActive(links[0]);
    return;
  }

  const visible = new Map();
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      visible.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
    });

    const current = sections
      .filter(({ section }) => (visible.get(section) || 0) > 0)
      .sort((a, b) => (visible.get(b.section) || 0) - (visible.get(a.section) || 0))[0];

    if (current) setActive(current.link);
  }, {
    rootMargin: '-18% 0px -62% 0px',
    threshold: [0.01, 0.2, 0.5]
  });

  sections.forEach(({ section }) => observer.observe(section));
  setActive(links.find((link) => link.getAttribute('href') === window.location.hash) || links[0]);
})();