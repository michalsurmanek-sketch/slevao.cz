import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';
const MOBILE_WIDTHS = [320, 360, 375, 390, 412, 430];

async function openHomepage(page) {
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#dealGrid')).toBeVisible();
  await expect.poll(async () => page.locator('#dealGrid .dealCard').count(), {
    timeout: 25_000,
    message: 'Homepage must render at least one real offer card from the public API.'
  }).toBeGreaterThan(0);
  await expect(page.locator('body')).not.toContainText('Nabídky se nepodařilo načíst');
}

async function expectNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const root = document.scrollingElement || document.documentElement;
    const bodyRect = document.body.getBoundingClientRect();
    const initialX = window.scrollX;
    const initialY = window.scrollY;

    // Horizontal rails (categories, stores, quick tabs) intentionally have a large
    // internal scrollWidth. The page itself must still be impossible to pan sideways.
    window.scrollTo(1_000_000, initialY);
    const attemptedPageScrollX = window.scrollX;
    window.scrollTo(initialX, initialY);

    return {
      viewport,
      rootScrollWidth: root.scrollWidth,
      rootClientWidth: root.clientWidth,
      htmlScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      bodyLeft: Number(bodyRect.left.toFixed(1)),
      bodyRight: Number(bodyRect.right.toFixed(1)),
      bodyWidth: Number(bodyRect.width.toFixed(1)),
      attemptedPageScrollX
    };
  });

  expect(
    metrics.rootScrollWidth,
    `root overflow: ${JSON.stringify(metrics)}`
  ).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(
    metrics.rootClientWidth,
    `root client width mismatch: ${JSON.stringify(metrics)}`
  ).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.bodyLeft, `body escapes left: ${JSON.stringify(metrics)}`).toBeGreaterThanOrEqual(-1);
  expect(metrics.bodyRight, `body escapes right: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.attemptedPageScrollX, `page can pan horizontally: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(1);
}

test('homepage loads the canonical mobile UX stylesheet only once', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => {
    if (request.url().includes('/assets/mobile-ux.css')) requests.push(request.url());
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await openHomepage(page);
  await page.waitForTimeout(750);

  expect(requests, `mobile-ux requests: ${JSON.stringify(requests)}`).toHaveLength(1);
  expect(await page.locator('link[href*="mobile-ux.css"]').count()).toBe(1);
});

test('homepage does not scroll itself during delayed startup work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE_URL}/index.html`, { waitUntil: 'domcontentloaded' });

  await expect.poll(async () => page.evaluate(() => window.scrollY), {
    timeout: 1_000,
    message: 'Homepage must start at the top.'
  }).toBeLessThan(5);

  await page.waitForTimeout(3_000);
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(5);
});

test('fresh homepage ignores stale section hash and restored deals scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto(`${BASE_URL}/index.html#dealsSection`, { waitUntil: 'load' });
  await expect.poll(async () => page.evaluate(() => window.scrollY), {
    timeout: 3_000,
    message: 'Fresh homepage entry must stay at the top even with a stale internal hash.'
  }).toBeLessThan(5);
  expect(new URL(page.url()).hash).toBe('');

  await page.mouse.wheel(0, 2400);
  await expect.poll(async () => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);

  await page.reload({ waitUntil: 'load' });
  await expect.poll(async () => page.evaluate(() => window.scrollY), {
    timeout: 3_000,
    message: 'Reloading the homepage must not restore the deals-section scroll position.'
  }).toBeLessThan(5);
});

test('quick purchase scroll happens only after a real click', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHomepage(page);
  await expect(page.locator('.sqFoodDock [data-sq-food]').first()).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBeLessThan(5);

  await page.locator('.sqFoodDock [data-sq-food]').first().click();
  await expect.poll(async () => page.evaluate(() => window.scrollY), {
    timeout: 3_000,
    message: 'A trusted quick-purchase click should be allowed to scroll to results.'
  }).toBeGreaterThan(100);
});

test('homepage sends one initial facets request', async ({ page }) => {
  const requests = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST'
      && request.url().includes('/rest/v1/rpc/get_public_offer_facets')
    ) {
      requests.push({ url: request.url(), body: request.postData() || '' });
    }
  });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await openHomepage(page);
  await page.waitForTimeout(750);

  expect(requests, `facets requests: ${JSON.stringify(requests)}`).toHaveLength(1);
});

test('desktop homepage renders server-paginated offers', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openHomepage(page);

  const cards = page.locator('#dealGrid .dealCard');
  const count = await cards.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(24);

  const offerCount = Number((await page.locator('#offerCount').innerText()).replace(/\D/g, ''));
  const storeCount = Number((await page.locator('#storeCount').innerText()).replace(/\D/g, ''));
  expect(offerCount).toBeGreaterThan(0);
  expect(storeCount).toBeGreaterThan(0);
  await expectNoHorizontalOverflow(page);
});

test('search uses the public server search and returns mleko results', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openHomepage(page);

  const search = page.locator('#q');
  await expect(search).toBeVisible();
  await search.fill('mleko');
  await search.press('Enter');

  await expect(search).toHaveValue('mleko');
  await expect.poll(async () => page.locator('#dealGrid .dealCard').count(), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(page.locator('#resultText')).toContainText('Zobrazeno');
});

for (const width of MOBILE_WIDTHS) {
  test(`mobile ${width}px has offers, hero metrics, bottom nav and no horizontal overflow`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await openHomepage(page);

    const offerCount = Number((await page.locator('#offerCount').innerText()).replace(/\D/g, ''));
    const storeCount = Number((await page.locator('#storeCount').innerText()).replace(/\D/g, ''));
    expect(offerCount).toBeGreaterThan(0);
    expect(storeCount).toBeGreaterThan(0);

    const nav = page.locator('.slevaoBottomNav');
    await expect(nav).toBeVisible({ timeout: 10_000 });
    const navBox = await nav.boundingBox();
    expect(navBox).not.toBeNull();
    expect(navBox.x).toBeGreaterThanOrEqual(-1);
    expect(navBox.x + navBox.width).toBeLessThanOrEqual(width + 1);

    await expect(page.locator('#q')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`mobile-${width}.png`), fullPage: false });
  });
}