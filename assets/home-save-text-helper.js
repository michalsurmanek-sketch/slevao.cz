(() => {
  'use strict';

  const fold = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

  function parse(modal) {
    const request = modal.querySelector('#sqSaveRequest');
    if (!request) return;
    const text = fold(request.value);

    const people = text.match(/(?:pro|na)\s+(\d{1,2})\s*(?:lidi|lidi|lidí|osob|osoby)/);
    if (people) {
      const input = modal.querySelector('#sqSavePeople');
      if (input) input.value = String(Math.max(1, Math.min(30, Number(people[1]))));
    }

    const budget = text.match(/(?:do|max(?:imalne)?|rozpocet(?:\s+je)?)\s*[:\-]?\s*(\d{2,5})\s*(?:kc|korun)?/);
    if (budget) {
      const input = modal.querySelector('#sqSaveBudget');
      if (input && !Number(input.value || 0)) input.value = String(Number(budget[1]));
    }

    let scenario = '';
    if (text.includes('gril')) scenario = 'grill';
    else if (text.includes('tyden') || text.includes('tydenni')) scenario = 'weekly';
    if (!scenario) return;

    const button = modal.querySelector(`[data-sq-scenario="${scenario}"]`);
    if (button && !button.classList.contains('active')) button.click();
  }

  function bind(modal) {
    if (!modal || modal.dataset.sqTextHelper === '1') return;
    modal.dataset.sqTextHelper = '1';
    const request = modal.querySelector('#sqSaveRequest');
    if (!request) return;
    request.addEventListener('change', () => parse(modal));
    request.addEventListener('blur', () => parse(modal));
    const action = modal.querySelector('#sqSaveAction');
    action?.addEventListener('pointerdown', () => parse(modal), true);
  }

  function init() {
    const existing = document.querySelector('.sqSaveModal');
    if (existing) { bind(existing); return; }
    let attempts = 0;
    const timer = setInterval(() => {
      attempts++;
      const modal = document.querySelector('.sqSaveModal');
      if (modal) { clearInterval(timer); bind(modal); }
      else if (attempts >= 80) clearInterval(timer);
    }, 100);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
