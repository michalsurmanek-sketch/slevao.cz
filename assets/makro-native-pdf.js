(() => {
  const grid = document.getElementById('leafletGrid');
  const viewer = document.getElementById('leafletViewer');
  if (!grid) return;

  const normalize = (value) => String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('cs');

  let processing = false;

  function removeWrongFirstDuplicate() {
    if (processing) return;
    const cards = [...grid.querySelectorAll('.leafletCard')];
    if (cards.length < 2) return;

    const first = cards[0];
    const second = cards[1];
    const sameStore = normalize(first.querySelector('h3')?.textContent)
      === normalize(second.querySelector('h3')?.textContent);
    const firstValidity = normalize(first.querySelector('.leafletValidity')?.textContent);
    const secondValidity = normalize(second.querySelector('.leafletValidity')?.textContent);
    const sameValidity = Boolean(firstValidity) && firstValidity === secondValidity;

    if (!sameStore || !sameValidity) return;

    processing = true;
    try {
      const firstWasOpen = first.classList.contains('active') && viewer && !viewer.hidden;
      first.remove();
      grid.dataset.count = String(grid.querySelectorAll('.leafletCard').length);

      // Na desktopu mohl společný skript automaticky otevřít první kartu.
      // V tom případě pouze otevřeme ponechanou druhou kartu jejím původním odkazem.
      if (firstWasOpen) queueMicrotask(() => second.click());
    } finally {
      processing = false;
    }
  }

  new MutationObserver(removeWrongFirstDuplicate).observe(grid, {
    childList: true,
    subtree: true,
  });

  removeWrongFirstDuplicate();
})();
