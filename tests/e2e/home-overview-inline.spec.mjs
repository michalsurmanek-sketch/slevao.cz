import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';

test('homepage keeps desktop overview styles bundled and stays at 24 CSS requests', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stylesheets = [];
  page.on('request', (request) => {
    let url;
    try { url = new URL(request.url()); } catch { return; }
    if (url.origin !== BASE_URL) return;
    if (request.resourceType() === 'stylesheet' && url.pathname.endsWith('.css')) stylesheets.push(url.pathname);
  });

  const response = await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await page.waitForTimeout(3000);

  expect(stylesheets.filter((path) => path === '/assets/home-overview.css')).toEqual([]);
  expect(stylesheets.length, `Expected at most 24 homepage CSS requests, got ${stylesheets.length}`).toBeLessThanOrEqual(24);

  const computed = await page.evaluate(() => {
    const host = document.createElement('section');
    host.className = 'desktopOverview';
    host.innerHTML = '<div class="desktopOverviewGrid"><article class="overviewPanel"><div class="overviewPanelHead"><h2>Test</h2></div></article></div>';
    document.body.appendChild(host);
    const grid = host.querySelector('.desktopOverviewGrid');
    const panel = host.querySelector('.overviewPanel');
    const out = { gridDisplay: getComputedStyle(grid).display, panelRadius: getComputedStyle(panel).borderRadius };
    host.remove();
    return out;
  });
  expect(computed.gridDisplay).toBe('grid');
  expect(computed.panelRadius).toBe('24px');
});
