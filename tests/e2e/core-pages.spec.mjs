import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';
const PUBLIC_FEATURES = 'assets/public-features.js';
const PUBLIC_NAV = 'assets/public-nav-upgrade.js';
const SHOPPING_BOOTSTRAP = 'assets/shopping-insights-bootstrap.js';
const SHOPPING_LIST = 'assets/shopping-list.js';
const SHOPPING_PRICE_SUMMARY = 'assets/shopping-list-price-summary.js';

const CORE_PAGES = [
  { path:'/produkt.html', title:/Produkt/i, marker:'#productContent' },
  { path:'/seznam.html', title:/Nákupní seznam/i, marker:'main' },
  { path:'/ucet.html', title:/Můj účet/i, marker:'main' },
];

const SEEDED_SHOPPING_ITEMS = [
  { local_id:'e2e-1', custom_name:'Mléko polotučné', name:'Mléko polotučné', quantity:2, unit:'ks', completed:false },
  { local_id:'e2e-2', custom_name:'Chléb konzumní kmínový', name:'Chléb konzumní kmínový', quantity:1, unit:'ks', completed:false },
  { local_id:'e2e-3', custom_name:'Kuřecí prsní řízky', name:'Kuřecí prsní řízky', quantity:1.5, unit:'ks', completed:false },
  { local_id:'e2e-4', custom_name:'Máslo 250 g', name:'Máslo 250 g', quantity:3, unit:'ks', completed:false },
  { local_id:'e2e-5', custom_name:'Minerální voda jemně perlivá', name:'Minerální voda jemně perlivá', quantity:6, unit:'ks', completed:false },
];

function versionedScript(path) {
  return `script[src^="${path}?v="]`;
}

function versionedShellAsset(path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`/${escaped}\\?v=[^'"\\s]+`);
}

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

async function expectItemsInsideViewport(page) {
  const rows = await page.locator('#listItems .sfListItem').evaluateAll((nodes) => nodes.map((node) => {
    const rect = node.getBoundingClientRect();
    return { left:rect.left, right:rect.right, width:rect.width, viewport:window.innerWidth };
  }));
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.left, `shopping row clipped left: ${JSON.stringify(row)}`).toBeGreaterThanOrEqual(-1);
    expect(row.right, `shopping row clipped right: ${JSON.stringify(row)}`).toBeLessThanOrEqual(row.viewport + 1);
  }
}

async function openCorePage(page, entry, width) {
  await page.setViewportSize({ width, height: width <= 430 ? 844 : 900 });
  const runtime = watchLocalRuntime(page);
  const response = await page.goto(`${BASE_URL}${entry.path}`, { waitUntil:'domcontentloaded' });
  expect(response?.status(), `${entry.path} document status`).toBe(200);
  await expect(page).toHaveTitle(entry.title);
  await expect(page.locator(entry.marker).first()).toBeVisible();
  await expect(page.locator(versionedScript(PUBLIC_FEATURES))).toHaveCount(1);
  await expect(page.locator(versionedScript(PUBLIC_NAV))).toHaveCount(1);
  if (entry.path === '/seznam.html') {
    await expect(page.locator(versionedScript(SHOPPING_BOOTSTRAP))).toHaveCount(1);
    await expect(page.locator(versionedScript(SHOPPING_LIST))).toHaveCount(1);
    await expect(page.locator(versionedScript(SHOPPING_PRICE_SUMMARY))).toHaveCount(1);
  }
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

for (const width of [320, 430]) {
  test(`/seznam.html with populated rows fits ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height:844 });
    await page.addInitScript((items) => {
      localStorage.setItem('slevao-shopping-list-v1', JSON.stringify(items));
    }, SEEDED_SHOPPING_ITEMS);
    const runtime = watchLocalRuntime(page);
    const response = await page.goto(`${BASE_URL}/seznam.html`, { waitUntil:'domcontentloaded' });
    expect(response?.status()).toBe(200);
    await expect(page.locator('#listItems .sfListItem')).toHaveCount(SEEDED_SHOPPING_ITEMS.length, { timeout:10_000 });
    await expect(page.locator('#listItems .sfItemPrice')).toHaveCount(SEEDED_SHOPPING_ITEMS.length, { timeout:10_000 });
    await expectNoHorizontalOverflow(page);
    await expectItemsInsideViewport(page);
    await page.screenshot({ path:`test-results/seznam-mobile-${width}.png`, fullPage:true });
    expect(runtime.failedResponses, '/seznam.html populated local HTTP failures').toEqual([]);
    expect(runtime.requestFailures, '/seznam.html populated local request failures').toEqual([]);
    expect(runtime.pageErrors, '/seznam.html populated uncaught browser errors').toEqual([]);
  });
}

test('PWA service worker exposes the current core-page shell contract', async ({ request }) => {
  const response = await request.get(`${BASE_URL}/service-worker.js`);
  expect(response.status()).toBe(200);
  const source = await response.text();

  expect(source).toMatch(/const CACHE_NAME = 'slevao-shell-[a-z0-9-]+';/i);
  expect(source).toMatch(versionedShellAsset(PUBLIC_FEATURES));
  expect(source).toMatch(versionedShellAsset(SHOPPING_BOOTSTRAP));
  expect(source).toMatch(versionedShellAsset(SHOPPING_LIST));

  const bootstrapResponse = await request.get(`${BASE_URL}/${SHOPPING_BOOTSTRAP}`);
  expect(bootstrapResponse.status()).toBe(200);
  const bootstrapSource = await bootstrapResponse.text();
  const listUrl = bootstrapSource.match(/const LIST_URL = '([^']+)'/)?.[1];
  expect(listUrl, 'Shopping bootstrap must expose its versioned list runtime URL.').toBeTruthy();
  expect(source, 'PWA shell must cache the exact shopping-list runtime loaded by the bootstrap.').toContain(`/${listUrl}`);

  for (const path of ['/produkt.html', '/seznam.html', '/ucet.html']) {
    expect(source, `PWA shell is missing ${path}`).toContain(`'${path}'`);
  }
});
