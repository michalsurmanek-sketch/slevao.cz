import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';

test('homepage keeps scroll-top styles inline and stays at 34 CSS requests', async ({ page }) => {
  const stylesheetRequests = [];

  page.on('request', (request) => {
    let url;
    try { url = new URL(request.url()); } catch { return; }
    if (url.origin !== BASE_URL || request.resourceType() !== 'stylesheet' || !url.pathname.endsWith('.css')) return;
    stylesheetRequests.push(`${url.pathname}${url.search}`);
  });

  const response = await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await page.waitForTimeout(3000);

  expect(stylesheetRequests.filter((item) => item.startsWith('/assets/leaflets-scroll-top.css'))).toEqual([]);
  expect(stylesheetRequests.length, `Expected at most 34 homepage CSS requests, got ${stylesheetRequests.length}`).toBeLessThanOrEqual(34);
  await expect(page.locator('#leafletsScrollTopStyle')).toHaveCount(1);
  await expect(page.locator('link[href*="leaflets-scroll-top.css"]')).toHaveCount(0);
  await expect(page.locator('#leafletsScrollTop')).toHaveCount(1);
});
