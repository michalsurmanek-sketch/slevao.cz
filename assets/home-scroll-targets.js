(() => {
  const tipButton = document.getElementById('topbarTipButton');
  const quickTabs = document.getElementById('quickTabs');
  const topbar = document.querySelector('.topbar');

  if (!tipButton || !quickTabs) return;

  const scrollToTipTarget = () => {
    const headerHeight = topbar ? topbar.getBoundingClientRect().height : 0;
    const targetTop = window.scrollY + quickTabs.getBoundingClientRect().top - headerHeight - 14;

    window.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth'
    });

    if (window.location.hash !== '#dealsSection') {
      history.replaceState(null, '', '#dealsSection');
    }
  };

  tipButton.addEventListener('click', (event) => {
    event.preventDefault();
    scrollToTipTarget();
  });
})();
