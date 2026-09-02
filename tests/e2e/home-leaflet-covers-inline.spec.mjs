import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';

test('homepage keeps leaflet cover styles bundled and stays at 25 CSS requests', async ({ page }) => {
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

  expect(stylesheets.filter((path) => path === '/assets/home-leaflet-covers.css')).toEqual([]);
  expect(stylesheets.length, `Expected at most 25 homepage CSS requests, got ${stylesheets.length}`).toBeLessThanOrEqual(25);

  const computed = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = `
      <div id="leafletGrid" class="leafletGrid">
        <article class="leafletCard" data-direct-leaflet-card="1">
          <a class="leafletCover leafletCoverLink" href="#">
            <img class="leafletFrontPage" alt="Test leták">
            <span class="leafletCurrentBadge">Aktuální</span>
          </a>
          <div class="leafletBody">
            <div class="leafletStoreIdentity"><h3>Test obchod</h3></div>
          </div>
        </article>
      </div>`;
    document.body.appendChild(host);

    const grid = host.querySelector('#leafletGrid');
    const card = host.querySelector('.leafletCard');
    const cover = host.querySelector('.leafletCover');
    const link = host.querySelector('.leafletCoverLink');
    const image = host.querySelector('.leafletFrontPage');
    const badge = host.querySelector('.leafletCurrentBadge');

    const result = {
      gridDisplay: getComputedStyle(grid).display,
      gridGap: getComputedStyle(grid).gap,
      gridOverflowX: getComputedStyle(grid).overflowX,
      gridScrollSnapType: getComputedStyle(grid).scrollSnapType,
      cardMinWidth: getComputedStyle(card).minWidth,
      cardScrollSnapAlign: getComputedStyle(card).scrollSnapAlign,
      coverAspectRatio: getComputedStyle(cover).aspectRatio,
      coverIsolation: getComputedStyle(cover).isolation,
      coverWidth: cover.getBoundingClientRect().width,
      linkDisplay: getComputedStyle(link).display,
      linkOverflow: getComputedStyle(link).overflow,
      imageWidth: image.getBoundingClientRect().width,
      imageObjectFit: getComputedStyle(image).objectFit,
      badgePosition: getComputedStyle(badge).position,
      badgeBorderRadius: getComputedStyle(badge).borderRadius,
    };
    host.remove();
    return result;
  });

  expect(computed.gridDisplay).toBe('flex');
  expect(computed.gridGap).toBe('13px');
  expect(computed.gridOverflowX).toBe('auto');
  expect(computed.gridScrollSnapType).toContain('x');
  expect(computed.cardMinWidth).toBe('0px');
  expect(computed.cardScrollSnapAlign).toContain('start');
  expect(computed.coverAspectRatio).toBe('210 / 297');
  expect(computed.coverIsolation).toBe('isolate');
  expect(computed.linkDisplay).toBe('grid');
  expect(computed.linkOverflow).toBe('hidden');
  expect(Math.abs(computed.imageWidth - computed.coverWidth)).toBeLessThan(0.5);
  expect(computed.imageObjectFit).toBe('contain');
  expect(computed.badgePosition).toBe('absolute');
  expect(computed.badgeBorderRadius).toBe('999px');
});
