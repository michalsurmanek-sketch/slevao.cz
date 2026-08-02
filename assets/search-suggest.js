(() => {
  'use strict';

  const BASES = [
    new URL('.home-v2-parts/', document.baseURI).href,
    'https://raw.githubusercontent.com/michalsurmanek-sketch/slevao.cz/a7d892d684438c64276490ad25c7a245e46ed9d3/.home-v2-parts/',
  ];
  const FILES = {
    html: { prefix: 'index', count: 2, hash: '669924cc66b447e78339142d50dfbcf86e0ea99199d7a7040d2527f1e23f8c65' },
    css: { prefix: 'css', count: 3, hash: 'a1861642b47ca7efb377ad803786198f942de31a41abe06941285df873cb973a' },
    js: { prefix: 'js', count: 5, hash: '35a686d38a636b61e6f1b4fa3222acee9dff557d9125538e063715d9abd447f7' },
  };

  const cover = document.createElement('div');
  cover.setAttribute('role', 'status');
  cover.innerHTML = '<div><b>SLEVAO<span>.cz</span></b><i></i><small>Načítám nový přehled slev…</small></div>';
  Object.assign(cover.style, {
    position: 'fixed', inset: '0', zIndex: '2147483647', display: 'grid', placeItems: 'center',
    background: '#f5faf9', color: '#172222', fontFamily: 'Inter,system-ui,sans-serif', transition: 'opacity .2s ease'
  });
  const box = cover.firstElementChild;
  Object.assign(box.style, { display: 'grid', justifyItems: 'center', gap: '14px' });
  Object.assign(box.querySelector('b').style, { fontSize: '28px', letterSpacing: '-1px' });
  box.querySelector('span').style.color = '#159e94';
  Object.assign(box.querySelector('i').style, {
    width: '34px', height: '34px', border: '3px solid #cdeeea', borderTopColor: '#159e94',
    borderRadius: '50%', animation: 'slevaoLoaderSpin .75s linear infinite'
  });
  box.querySelector('small').style.color = '#667373';
  const loaderStyle = document.createElement('style');
  loaderStyle.textContent = '@keyframes slevaoLoaderSpin{to{transform:rotate(360deg)}}';
  document.head.appendChild(loaderStyle);
  document.body.appendChild(cover);

  const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');

  async function fetchPart(name) {
    let lastError;
    for (const base of BASES) {
      try {
        const response = await fetch(base + name, { cache: 'force-cache', mode: 'cors' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (!/^[A-Za-z0-9+/=\s]+$/.test(text)) throw new Error('Neplatný obsah');
        return text;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`Soubor ${name} se nepodařilo načíst: ${lastError?.message || 'neznámá chyba'}`);
  }

  async function fetchText({ prefix, count, hash }) {
    const parts = await Promise.all(Array.from({ length: count }, (_, index) => {
      const name = `${prefix}.${String(index + 1).padStart(2, '0')}.b64`;
      return fetchPart(name);
    }));
    const encoded = parts.join('').replace(/\s+/g, '');
    const compressed = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
    if (typeof DecompressionStream !== 'function') throw new Error('Prohlížeč nepodporuje bezpečné rozbalení nové stránky.');
    const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
    const bytes = await new Response(stream).arrayBuffer();
    const digest = hex(await crypto.subtle.digest('SHA-256', bytes));
    if (digest !== hash) throw new Error(`Kontrola souboru ${prefix} nesouhlasí.`);
    return new TextDecoder().decode(bytes);
  }

  async function activate() {
    const [html, css, js] = await Promise.all([
      fetchText(FILES.html), fetchText(FILES.css), fetchText(FILES.js),
    ]);
    if (!html.includes('id="categoriesSection"') || !html.includes('id="leafletsSection"') || !js.includes('function renderOffers')) {
      throw new Error('Nová stránka neprošla kontrolou obsahu.');
    }

    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.querySelectorAll('link[href*="home-v2.css"],script[src*="home-v2.js"]').forEach(node => node.remove());

    document.head.replaceChildren(...[...parsed.head.childNodes].map(node => document.importNode(node, true)));
    const style = document.createElement('style');
    style.id = 'homeV2InlineStyle';
    style.textContent = css;
    document.head.appendChild(style);

    document.body.replaceChildren(...[...parsed.body.childNodes].map(node => document.importNode(node, true)));
    [...parsed.body.attributes].forEach(attribute => document.body.setAttribute(attribute.name, attribute.value));

    const script = document.createElement('script');
    script.id = 'homeV2InlineScript';
    script.textContent = `${js}\n//# sourceURL=assets/home-v2.js`;
    document.body.appendChild(script);
  }

  activate().catch(error => {
    console.error('Nová homepage se nepodařila aktivovat:', error);
    cover.style.opacity = '0';
    setTimeout(() => cover.remove(), 220);
  });
})();
