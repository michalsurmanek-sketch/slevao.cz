import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';

test('homepage inlines footer cascade and stays at 32 CSS requests', async ({ page }) => {
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

  expect(stylesheets.filter((path) => path === '/assets/footer-generated-bg.css')).toEqual([]);
  expect(stylesheets.filter((path) => path === '/assets/footer-trust-upgrade.css')).toEqual([]);
  expect(stylesheets.length, `Expected at most 32 homepage CSS requests, got ${stylesheets.length}`).toBeLessThanOrEqual(32);

  const footer = await page.locator('.footerShell').evaluate((node) => {
    const shell = getComputedStyle(node);
    const features = document.querySelector('.footerFeatures');
    const trust = features ? getComputedStyle(features, '::after') : null;
    const before = getComputedStyle(node, '::before');
    const after = getComputedStyle(node, '::after');
    return {
      backgroundImage: shell.backgroundImage,
      trustContent: trust?.content || '',
      beforeDisplay: before.display,
      afterDisplay: after.display,
    };
  });

  expect(footer.backgroundImage).toContain('footer-background.webp');
  expect(footer.trustContent).toContain('Upozornění na slevy');
  expect(footer.beforeDisplay).toBe('none');
  expect(footer.afterDisplay).toBe('none');
});
