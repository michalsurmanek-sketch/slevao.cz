import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';
const CSS_BUDGET = 25;
const JS_BUDGET = 40;

test('homepage stays within real CSS and JavaScript request budget', async ({ page }) => {
  const requests = { stylesheet: [], script: [] };

  page.on('request', (request) => {
    let url;
    try { url = new URL(request.url()); } catch { return; }
    if (url.origin !== BASE_URL) return;
    const type = request.resourceType();
    if (type === 'stylesheet' && url.pathname.endsWith('.css')) {
      requests.stylesheet.push(`${url.pathname}${url.search}`);
      return;
    }
    if (type === 'script' && url.pathname.endsWith('.js')) {
      requests.script.push(`${url.pathname}${url.search}`);
    }
  });

  const response = await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await page.waitForTimeout(3000);

  const summarize = (items) => {
    const byPath = new Map();
    for (const item of items) {
      const path = item.split('?')[0];
      byPath.set(path, (byPath.get(path) || 0) + 1);
    }
    return {
      total: items.length,
      uniquePaths: byPath.size,
      duplicatePaths: [...byPath.entries()].filter(([, count]) => count > 1),
      items,
    };
  };

  const css = summarize(requests.stylesheet);
  const js = summarize(requests.script);
  console.log('HOMEPAGE_REQUEST_BUDGET', JSON.stringify({ css, js }));

  expect(css.duplicatePaths, `Duplicate stylesheet requests: ${JSON.stringify(css.duplicatePaths)}`).toEqual([]);
  expect(js.duplicatePaths, `Duplicate script requests: ${JSON.stringify(js.duplicatePaths)}`).toEqual([]);
  expect(css.total, `Homepage CSS request budget exceeded: ${css.total} > ${CSS_BUDGET}`).toBeLessThanOrEqual(CSS_BUDGET);
  expect(js.total, `Homepage JS request budget exceeded: ${js.total} > ${JS_BUDGET}`).toBeLessThanOrEqual(JS_BUDGET);
});
