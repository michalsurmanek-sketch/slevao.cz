import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';
const TARGETS = [
  '/assets/home-quick-food-filter.css',
  '/assets/product-personalization.css',
  '/assets/product-personalization.js',
];

test('homepage loads deduplicated quick-food and personalization assets', async ({ page }) => {
  const counts = new Map(TARGETS.map((path) => [path, 0]));

  page.on('request', (request) => {
    let url;
    try { url = new URL(request.url()); } catch { return; }
    if (url.origin !== BASE_URL || !counts.has(url.pathname)) return;
    counts.set(url.pathname, counts.get(url.pathname) + 1);
  });

  const response = await page.goto(`${BASE_URL}/index.html`, { waitUntil:'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await page.waitForTimeout(2_000);

  const domCounts = await page.evaluate(() => ({
    quickFoodCss: document.querySelectorAll('link[href*="home-quick-food-filter.css"]').length,
    personalizationCss: document.querySelectorAll('link[href*="product-personalization.css"]').length,
    personalizationJs: document.querySelectorAll('script[src*="product-personalization.js"]').length,
  }));

  expect(domCounts.quickFoodCss, 'Homepage contains duplicate home-quick-food-filter.css links').toBe(1);
  expect(domCounts.personalizationCss, 'Homepage contains duplicate product-personalization.css links').toBe(1);
  expect(domCounts.personalizationJs, 'Homepage contains duplicate product-personalization.js scripts').toBe(1);

  for (const path of TARGETS) {
    expect(counts.get(path), `Homepage requested ${path} more than once`).toBeLessThanOrEqual(1);
  }
});
