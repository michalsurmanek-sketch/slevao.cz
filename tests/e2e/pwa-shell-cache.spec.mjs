import { test, expect } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4173';

async function readWorker(request) {
  const response = await request.get(`${BASE_URL}/service-worker.js`);
  expect(response.ok()).toBeTruthy();
  return response.text();
}

async function readCoreShell(request) {
  const source = await readWorker(request);
  const offlineUrl = source.match(/const OFFLINE_URL = '([^']+)'/)?.[1] || '';
  const shellBody = source.match(/const CORE_SHELL = \[([\s\S]*?)\];/)?.[1] || '';
  expect(offlineUrl).not.toBe('');
  expect(shellBody).not.toBe('');
  const urls = [...shellBody.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  if (/\bOFFLINE_URL\b/.test(shellBody)) urls.unshift(offlineUrl);
  return urls;
}

test('PWA core install cache stays minimal and has no duplicate paths', async ({ request }) => {
  const urls = await readCoreShell(request);
  expect(urls.length, `PWA core cache unexpectedly grew: ${JSON.stringify(urls)}`).toBeLessThanOrEqual(5);
  expect(urls.some((value) => value.startsWith('/assets/')), 'Versioned page assets must stay out of install-time core cache.').toBeFalsy();

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

  expect(duplicates, `PWA core cache contains duplicate paths: ${JSON.stringify(duplicates)}`).toEqual([]);
});

test('every mandatory PWA core entry resolves successfully', async ({ request }) => {
  const urls = await readCoreShell(request);
  const failures = [];

  for (const value of urls) {
    const response = await request.get(`${BASE_URL}${value}`);
    if (!response.ok()) failures.push({ url:value, status:response.status() });
  }

  expect(failures, `PWA core cache contains missing or broken entries: ${JSON.stringify(failures)}`).toEqual([]);
});

test('PWA install remains atomic for the minimal core cache', async ({ request }) => {
  const source = await readWorker(request);
  const installStart = source.indexOf("self.addEventListener('install'");
  const activateStart = source.indexOf("self.addEventListener('activate'", installStart);
  expect(installStart).toBeGreaterThanOrEqual(0);
  expect(activateStart).toBeGreaterThan(installStart);

  const installBlock = source.slice(installStart, activateStart);
  expect(installBlock).toContain("await cache.addAll(CORE_SHELL.map((url) => new Request(url, { cache: 'reload' })));" );
  expect(installBlock).not.toContain('Promise.all(CORE_SHELL.map');
  expect(installBlock).not.toMatch(/cache\.add\([^)]*\)[\s\S]*catch\s*\{\s*\}/);
});
