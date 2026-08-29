import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';

async function readShell(request) {
  const response = await request.get(`${BASE_URL}/service-worker.js`);
  expect(response.ok()).toBeTruthy();

  const source = await response.text();
  const shellBody = source.match(/const SHELL = \[([\s\S]*?)\];/)?.[1] || '';
  expect(shellBody).not.toBe('');
  return [...shellBody.matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

test('PWA shell does not precache multiple versions of the same asset', async ({ request }) => {
  const urls = await readShell(request);
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

test('every PWA shell entry resolves successfully', async ({ request }) => {
  const urls = await readShell(request);
  const failures = [];

  for (const value of urls) {
    const response = await request.get(`${BASE_URL}${value}`);
    if (!response.ok()) failures.push({ url:value, status:response.status() });
  }

  expect(failures, `PWA shell contains missing or broken entries: ${JSON.stringify(failures)}`).toEqual([]);
});
