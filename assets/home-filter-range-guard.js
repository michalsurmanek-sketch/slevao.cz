(() => {
  'use strict';

  const minPrice = document.getElementById('minPrice');
  const maxPrice = document.getElementById('maxPrice');
  if (!minPrice || !maxPrice) return;

  document.querySelectorAll('.pricePresets [data-max-price]').forEach((button) => {
    button.addEventListener('click', () => {
      const preset = Number(button.dataset.maxPrice);
      const min = minPrice.value === '' ? null : Number(minPrice.value);
      if (Number.isFinite(preset) && Number.isFinite(min) && min > preset) {
        minPrice.value = '';
        minPrice.dispatchEvent(new Event('input', { bubbles:true }));
      }
    }, { capture:true });
  });

  window.__slevaoPriceRangeGuard = true;
})();