import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';
const PUBLIC_FEATURES = 'assets/public-features.js?v=20260815-3';
const PUBLIC_NAV = 'assets/public-nav-upgrade.js?v=20260822-2';

const CORE_PAGES = [
  { path:'/produkt.html', title:/Produkt/i, marker:'#productContent' },
  { path:'/seznam.html', title:/Nákupní seznam/i, marker:'main' },
  { path:'/ucet.html', title:/Můj účet/i, marker:'main' },
];

function watchLocalRuntime(page) {
  const failedResponses = [];
  const requestFailures = [];
  const pageErrors = [];

  page.on('response', (response) => {
    const request = response.request();
    const type = request.resourceType();
    if (!['document', 'script', 'stylesheet'].includes(type)) return;
    let url;
    try { url = new URL(response.url()); } catch { return; }
    if (url.origin !== BASE_URL || response.status() < 400) return;
    failedResponses.push(`${response.status()} ${type} ${url.pathname}${url.search}`);
  });

  page.on('requestfailed', (request) => {
    const type = request.resourceType();
    if (!['document', 'script', 'stylesheet'].includes(type)) return;
    let url;
    try { url = new URL(request.url()); } catch { return; }
    if (url.origin !== BASE_URL) return;
    requestFailures.push(`${type} ${url.pathname}${url.search}: ${request.failure()?.errorText || 'failed'}`);
  });

  page.on('pageerror', (error) => pageErrors.push(error?.message || String(error)));
  return { failedResponses, requestFailures, pageErrors };
}

async function expectNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(metrics.html, `html overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.body, `body overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(metrics.viewport + 1);
}

async function openCorePage(page, entry, width) {
  await page.setViewportSize({ width, height: width <= 430 ? 844 : 900 });
  const runtime = watchLocalRuntime(page);
  const response = await page.goto(`${BASE_URL}${entry.path}`, { waitUntil:'domcontentloaded' });
  expect(response?.status(), `${entry.path} document status`).toBe(200);
  await expect(page).toHaveTitle(entry.title);
  await expect(page.locator(entry.marker).first()).toBeVisible();
  await expect(page.locator(`script[src="${PUBLIC_FEATURES}"]`)).toHaveCount(1);
  await expect(page.locator(`script[src="${PUBLIC_NAV}"]`)).toHaveCount(1);
  await page.waitForTimeout(1_000);
  await expectNoHorizontalOverflow(page);
  expect(runtime.failedResponses, `${entry.path} local HTTP failures`).toEqual([]);
  expect(runtime.requestFailures, `${entry.path} local request failures`).toEqual([]);
  expect(runtime.pageErrors, `${entry.path} uncaught browser errors`).toEqual([]);
}

for (const entry of CORE_PAGES) {
  test(`${entry.path} renders its desktop shell without local runtime failures`, async ({ page }) => {
    await openCorePage(page, entry, 1280);
  });

  test(`${entry.path} renders at 390px without horizontal overflow`, async ({ page }) => {
    await openCorePage(page, entry, 390);
  });
}

test('PWA service worker exposes the current core-page shell contract', async ({ request }) => {
  const response = await request.get(`${BASE_URL}/service-worker.js`);
  expect(response.status()).toBe(200);
  const source = await response.text();

  expect(source).toContain("const CACHE_NAME = 'slevao-shell-20260822-12';");
  expect(source).toContain(`/${PUBLIC_FEATURES}`);
  for (const path of ['/produkt.html', '/seznam.html', '/ucet.html']) {
    expect(source, `PWA shell is missing ${path}`).toContain(`'${path}'`);
  }
});
