import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';

test('PWA shell does not precache multiple versions of the same asset', async ({ request }) => {
  const response = await request.get(`${BASE_URL}/service-worker.js`);
  expect(response.ok()).toBeTruthy();

  const source = await response.text();
  const shellBody = source.match(/const SHELL = \[([\s\S]*?)\];/)?.[1] || '';
  expect(shellBody).not.toBe('');

  const urls = [...shellBody.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  const byPath = new Map();

  for (const value of urls) {
    const pathname = value.split('?')[0];
    const versions = byPath.get(pathname) || [];
    versions.push(value);
    byPath.set(pathname, versions);
  }

  const duplicates = [...byPath.entries()]
    .filter(([, versions]) => versions.length > 1)
    .map(([pathname, versions]) => ({ pathname, versions }));

  expect(duplicates, `PWA shell contains duplicate asset paths: ${JSON.stringify(duplicates)}`).toEqual([]);
});
