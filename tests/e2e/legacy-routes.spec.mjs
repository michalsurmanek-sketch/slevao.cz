import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';

test('legacy account route redirects to ucet and preserves URL state', async ({ page }) => {
  await page.goto(`${BASE_URL}/account.html?tab=favorites#saved`, { waitUntil:'domcontentloaded' });
  await page.waitForURL(`${BASE_URL}/ucet.html?tab=favorites#saved`);
  expect(page.url()).toBe(`${BASE_URL}/ucet.html?tab=favorites#saved`);
  await expect(page).toHaveTitle(/Můj účet/i);
});

test('legacy detail route redirects to produkt and preserves product id', async ({ page }) => {
  const productId = '00000000-0000-4000-8000-000000000000';
  await page.goto(`${BASE_URL}/detail.html?id=${productId}#offers`, { waitUntil:'domcontentloaded' });
  await page.waitForURL(`${BASE_URL}/produkt.html?id=${productId}#offers`);
  expect(page.url()).toBe(`${BASE_URL}/produkt.html?id=${productId}#offers`);
  await expect(page).toHaveTitle(/Produkt/i);
});
