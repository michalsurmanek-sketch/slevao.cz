import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';
const LIST_KEY = 'slevao-shopping-list-v1';

test('recipe adds ingredient rows as items, not grams, and survives opening the shopping list', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });

  const response = await page.goto(`${BASE_URL}/index.html`, { waitUntil:'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await page.evaluate((key) => localStorage.removeItem(key), LIST_KEY);
  await page.reload({ waitUntil:'domcontentloaded' });

  const section = page.locator('#recipesSection');
  await expect(section).toBeVisible();
  await expect(section.getByRole('heading', { name:'Nakupujte podle receptu' })).toBeVisible();

  const addRizek = section.locator('[data-recipe="rizek"]');
  await expect(addRizek).toBeVisible();
  await addRizek.click();
  await expect(addRizek).toContainText('Přidáno 6 surovin');

  const rows = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), LIST_KEY);
  expect(rows).toHaveLength(6);
  expect(rows.every((row) => row.quantity === 1 && row.qty === 1 && row.unit === 'ks')).toBe(true);
  expect(rows.every((row) => row.source === 'recipe' && row.recipe_id === 'rizek')).toBe(true);

  const chicken = rows.find((row) => row.custom_name === 'Kuřecí prsa (600 g)');
  expect(chicken).toBeTruthy();
  expect(chicken.quantity).toBe(1);
  expect(chicken.qty).toBe(1);
  expect(chicken.unit).toBe('ks');

  const flour = rows.find((row) => row.custom_name === 'Hladká mouka (1 balení)');
  expect(flour).toBeTruthy();
  expect(flour.quantity).toBe(1);

  const sectionMetrics = await section.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { left:rect.left, right:rect.right, viewport:window.innerWidth };
  });
  expect(sectionMetrics.left).toBeGreaterThanOrEqual(-1);
  expect(sectionMetrics.right).toBeLessThanOrEqual(sectionMetrics.viewport + 1);

  await page.goto(`${BASE_URL}/seznam.html`, { waitUntil:'domcontentloaded' });
  await expect(page.locator('#listItems .sfListItem')).toHaveCount(6, { timeout:10_000 });

  const persisted = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), LIST_KEY);
  expect(persisted).toHaveLength(6);
  const persistedChicken = persisted.find((row) => row.custom_name === 'Kuřecí prsa (600 g)');
  expect(persistedChicken?.quantity).toBe(1);
  expect(persistedChicken?.unit).toBe('ks');
});

test('legacy recipe repair is narrow and does not rewrite a manual matching item', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  const seeded = [
    {
      local_id:'legacy-rizek', product_id:null, custom_name:'Kuřecí prsa', name:'Kuřecí prsa',
      quantity:600, qty:600, unit:'g', completed:false, added_at:'2026-09-03T08:21:39.148Z'
    },
    {
      local_id:'manual-cibule', product_id:null, custom_name:'Cibule', name:'Cibule',
      quantity:4, qty:4, unit:'ks', completed:false, added_at:'2026-09-02T08:21:39.148Z'
    }
  ];
  await page.addInitScript(({ key, items }) => localStorage.setItem(key, JSON.stringify(items)), { key:LIST_KEY, items:seeded });

  const response = await page.goto(`${BASE_URL}/seznam.html`, { waitUntil:'domcontentloaded' });
  expect(response?.status()).toBe(200);
  await expect(page.locator('#listItems .sfListItem')).toHaveCount(2, { timeout:10_000 });

  const rows = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '[]'), LIST_KEY);
  const repaired = rows.find((row) => row.local_id === 'legacy-rizek');
  const manual = rows.find((row) => row.local_id === 'manual-cibule');

  expect(repaired?.custom_name).toBe('Kuřecí prsa (600 g)');
  expect(repaired?.quantity).toBe(1);
  expect(repaired?.unit).toBe('ks');
  expect(repaired?.source).toBe('recipe');
  expect(manual?.custom_name).toBe('Cibule');
  expect(manual?.quantity).toBe(4);
  expect(manual?.unit).toBe('ks');
});
