import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';

test('homepage keeps mobile hero styles bundled and stays at 24 CSS requests', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 844 });
  const stylesheets = [];

  page.on('request', (request) => {
    let url;
    try { url = new URL(request.url()); } catch { return; }
    if (url.origin !== BASE_URL) return;
    if (request.resourceType() === 'stylesheet' && url.pathname.endsWith('.css')) {
      stylesheets.push(url.pathname);
    }
  });

  const response = await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await page.waitForTimeout(3000);

  expect(stylesheets.filter((path) => path === '/assets/mobile-hero-compact.css')).toEqual([]);
  expect(stylesheets.length, `Expected at most 24 homepage CSS requests, got ${stylesheets.length}`).toBeLessThanOrEqual(24);

  const computed = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = `
      <section class="hero">
        <div class="container">
          <div class="heroCard">
            <div class="heroCopy">
              <span class="eyebrow">Test</span>
              <h1>Mobilní hero</h1>
              <p>Popis</p>
            </div>
            <div class="heroStats"><span>Statistika</span></div>
          </div>
        </div>
      </section>
      <div id="dealGrid" data-card-view="mini">
        <article class="dealCard">
          <h3>Třířádkový název produktu pro test</h3>
          <div class="dealChips"><span>cena za 1 kg</span><span>sleva</span></div>
          <button type="button" data-favorite>Oblíbit</button>
        </article>
      </div>`;
    document.body.appendChild(host);

    const hero = host.querySelector('.hero');
    const container = host.querySelector('.hero .container');
    const card = host.querySelector('.heroCard');
    const eyebrow = host.querySelector('.heroCopy > .eyebrow');
    const stat = host.querySelector('.heroStats > span');
    const title = host.querySelector('#dealGrid .dealCard h3');
    const hiddenFavorite = host.querySelector('[data-favorite]');

    const result = {
      heroPaddingTop: getComputedStyle(hero).paddingTop,
      containerPaddingLeft: getComputedStyle(container).paddingLeft,
      cardPaddingTop: getComputedStyle(card).paddingTop,
      cardBackgroundSize: getComputedStyle(card).backgroundSize,
      cardBackgroundImage: getComputedStyle(card).backgroundImage,
      eyebrowMinHeight: getComputedStyle(eyebrow).minHeight,
      statMinHeight: getComputedStyle(stat).minHeight,
      titleHeight: getComputedStyle(title).height,
      titleMinHeight: getComputedStyle(title).minHeight,
      hiddenFavoriteDisplay: getComputedStyle(hiddenFavorite).display,
    };
    host.remove();
    return result;
  });

  expect(computed.heroPaddingTop).toBe('8px');
  expect(computed.containerPaddingLeft).toBe('10px');
  expect(computed.cardPaddingTop).toBe('14px');
  expect(computed.cardBackgroundSize).toBe('cover');
  expect(computed.cardBackgroundImage).toContain('hero-mobile-combined.webp');
  expect(computed.eyebrowMinHeight).toBe('28px');
  expect(computed.statMinHeight).toBe('52px');
  expect(computed.titleHeight).toBe('44px');
  expect(computed.titleMinHeight).toBe('44px');
  expect(computed.hiddenFavoriteDisplay).toBe('none');
});
