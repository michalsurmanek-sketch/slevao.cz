import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';

test('homepage keeps desktop overview styles bundled and stays at 24 CSS requests', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
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

  expect(stylesheets.filter((path) => path === '/assets/home-overview.css')).toEqual([]);
  expect(stylesheets.length, `Expected at most 24 homepage CSS requests, got ${stylesheets.length}`).toBeLessThanOrEqual(24);

  const desktop = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = `
      <section class="desktopOverview">
        <div class="desktopOverviewGrid">
          <article class="overviewPanel">
            <header class="overviewPanelHead"><h2>Letáky</h2></header>
            <div class="overviewLeaflets">
              <article class="leafletCard"><div class="leafletCover"><img class="leafletFrontPage"></div></article>
              <article class="leafletCard"><div class="leafletCover"><img class="leafletFrontPage"></div></article>
              <article class="leafletCard"><div class="leafletCover"><img class="leafletFrontPage"></div></article>
            </div>
          </article>
          <article class="overviewPanel"><div class="overviewStores"><div class="storeCard"></div></div></article>
          <article class="overviewPanel"><div class="overviewEnding"><a class="overviewDealRow"></a></div></article>
        </div>
      </section>`;
    document.body.appendChild(host);

    const section = host.querySelector('.desktopOverview');
    const grid = host.querySelector('.desktopOverviewGrid');
    const panel = host.querySelector('.overviewPanel');
    const leaflets = host.querySelector('.overviewLeaflets');
    const cover = host.querySelector('.overviewLeaflets .leafletCover');
    const stores = host.querySelector('.overviewStores');
    const ending = host.querySelector('.overviewEnding');
    const row = host.querySelector('.overviewDealRow');

    const result = {
      sectionDisplay: getComputedStyle(section).display,
      sectionPaddingBottom: getComputedStyle(section).paddingBottom,
      gridDisplay: getComputedStyle(grid).display,
      gridColumns: getComputedStyle(grid).gridTemplateColumns,
      gridGap: getComputedStyle(grid).gap,
      panelRadius: getComputedStyle(panel).borderRadius,
      panelDisplay: getComputedStyle(panel).display,
      leafletsDisplay: getComputedStyle(leaflets).display,
      leafletColumns: getComputedStyle(leaflets).gridTemplateColumns,
      coverHeight: getComputedStyle(cover).height,
      storesDisplay: getComputedStyle(stores).display,
      storeColumns: getComputedStyle(stores).gridTemplateColumns,
      endingDisplay: getComputedStyle(ending).display,
      endingRows: getComputedStyle(ending).gridTemplateRows,
      rowRadius: getComputedStyle(row).borderRadius,
    };
    host.remove();
    return result;
  });

  expect(desktop.sectionDisplay).not.toBe('none');
  expect(desktop.sectionPaddingBottom).toBe('14px');
  expect(desktop.gridDisplay).toBe('grid');
  expect(desktop.gridColumns.split(' ').length).toBe(3);
  expect(desktop.gridGap).toBe('12px');
  expect(desktop.panelRadius).toBe('24px');
  expect(desktop.panelDisplay).toBe('flex');
  expect(desktop.leafletsDisplay).toBe('grid');
  expect(desktop.leafletColumns.split(' ').length).toBe(3);
  expect(desktop.coverHeight).toBe('173px');
  expect(desktop.storesDisplay).toBe('grid');
  expect(desktop.storeColumns.split(' ').length).toBe(4);
  expect(desktop.endingDisplay).toBe('grid');
  expect(desktop.endingRows.split(' ').length).toBe(3);
  expect(desktop.rowRadius).toBe('13px');

  await page.setViewportSize({ width: 1000, height: 900 });
  const hiddenBelowDesktop = await page.evaluate(() => {
    const el = document.createElement('section');
    el.className = 'desktopOverview';
    document.body.appendChild(el);
    const display = getComputedStyle(el).display;
    el.remove();
    return display;
  });
  expect(hiddenBelowDesktop).toBe('none');
});
