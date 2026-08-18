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
  const metrics = await page.evaluate(() => ({
    viewport: window.innerWidth,
    html: document.documentElement.scrollWidth,
    body: document.body.scrollWidth
  }));
  expect(metrics.html, `html overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.body, `body overflow: ${JSON.stringify(metrics)}`).toBeLessThanOrEqual(metrics.viewport + 1);
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
  const links = await page.locator('link[href*="mobile-ux.css"]').count();
  expect(links).toBe(1);
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
    await page.screenshot({ path: testInfo.outputPath(`mobile-${width}.png`), fullPage: true });
  });
}
