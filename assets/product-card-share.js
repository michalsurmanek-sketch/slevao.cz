(() => {
  'use strict';

  const grid = document.getElementById('dealGrid');
  if (!grid) return;

  const shareIcon = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="18" cy="5" r="3"/>
        <circle cx="6" cy="12" r="3"/>
        <circle cx="18" cy="19" r="3"/>
        <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>
      </g>
    </svg>`;

  const cleanText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

  const toast = (message) => {
    const node = document.getElementById('toast');
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => {
      node.hidden = true;
    }, 2600);
  };

  const copyText = async (text) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    if (!ok) throw new Error('copy-failed');
  };

  const shareDataForCard = (card) => {
    const title = cleanText(card.querySelector('.dealInfo h3, .dealBody h3')?.textContent) || 'Akční nabídka';
    const store = cleanText(card.querySelector('.storeLine')?.childNodes?.[0]?.textContent || card.querySelector('.storeLine')?.textContent);
    const price = cleanText(card.querySelector('.price')?.textContent);
    const validity = cleanText(card.querySelector('.dealFactText strong, .validity')?.textContent);

    const url = new URL(location.href);
    url.hash = 'dealsSection';

    const bits = [title];
    if (price) bits.push(`za ${price}`);
    if (store) bits.push(`v ${store}`);
    if (validity) bits.push(`(${validity})`);

    return {
      title: `${title} | Slevao.cz`,
      text: `${bits.join(' ')} – Slevao.cz`,
      url: url.toString()
    };
  };

  const shareCard = async (card, button) => {
    const data = shareDataForCard(card);
    button.classList.add('is-sharing');

    try {
      if (navigator.share) {
        await navigator.share(data);
        toast('Nabídka byla sdílena.');
        return;
      }

      await copyText(`${data.text}\n${data.url}`);
      toast('Odkaz na nabídku byl zkopírován.');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      try {
        await copyText(data.url);
        toast('Odkaz na nabídku byl zkopírován.');
      } catch {
        window.prompt('Zkopíruj odkaz na nabídku:', data.url);
      }
    } finally {
      button.classList.remove('is-sharing');
    }
  };

  const enhanceCard = (card) => {
    if (!card || card.querySelector('.shareOffer')) return;

    const info = card.querySelector('.dealInfo');
    if (!info) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'shareOffer';
    button.setAttribute('aria-label', 'Sdílet nabídku');
    button.setAttribute('title', 'Sdílet nabídku');
    button.innerHTML = shareIcon;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      shareCard(card, button);
    });

    info.appendChild(button);
  };

  let frame = 0;
  const refresh = () => {
    frame = 0;
    grid.querySelectorAll('.dealCard[data-mobile-product-card="1"]').forEach(enhanceCard);
  };
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(refresh);
  };

  new MutationObserver(schedule).observe(grid, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-mobile-product-card'] });
  window.addEventListener('resize', schedule, { passive: true });
  schedule();
})();