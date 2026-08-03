(() => {
  'use strict';

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

    const subject = encodeURIComponent('Zájem o hlídání slev na Slevao.cz');
    const body = encodeURIComponent([
      'Dobrý den,',
      '',
      'mám zájem o upozornění na nejlepší akce a slevy na Slevao.cz.',
      `Kontaktní e-mail: ${email}`,
      '',
      `Stránka: ${location.href}`
    ].join('\n'));

    status.textContent = 'Otevírám e-mail s připravenou žádostí…';
    window.location.href = `mailto:info@slevao.cz?subject=${subject}&body=${body}`;
  });
})();
