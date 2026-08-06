(() => {
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
