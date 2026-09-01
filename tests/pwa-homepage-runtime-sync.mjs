import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const index = readFileSync(new URL('index.html', root), 'utf8');
const leaflets = readFileSync(new URL('letaky.html', root), 'utf8');
const list = readFileSync(new URL('seznam.html', root), 'utf8');
const product = readFileSync(new URL('produkt.html', root), 'utf8');
const account = readFileSync(new URL('ucet.html', root), 'utf8');
const footer = readFileSync(new URL('assets/home-footer-redesign.js', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

const versionedAssets = (source) => [...new Set(
  [...source.matchAll(/assets\/([a-zA-Z0-9._-]+\.(?:css|js))\?v=([0-9-]+)/g)]
    .map((match) => `/assets/${match[1]}?v=${match[2]}`)
)];

const requiredAssets = new Set([
  ...versionedAssets(index),
  ...versionedAssets(leaflets),
  ...versionedAssets(list),
  ...versionedAssets(product),
  ...versionedAssets(account),
  ...versionedAssets(footer),
]);
const missing = [...requiredAssets].filter((asset) => !worker.includes(`'${asset}'`)).sort();
assert.deepEqual(
  missing,
  [],
  `PWA shell postrádá přímé nebo dynamické runtime závislosti:\n${missing.join('\n')}`
);

const versionsFor = (source, asset) => versionedAssets(source)
  .filter((value) => value.startsWith(`/assets/${asset}?v=`))
  .map((value) => value.split('?v=')[1]);
const productPersonalization = versionsFor(product, 'product-personalization.css');
const accountPersonalization = versionsFor(account, 'product-personalization.css');
assert.equal(productPersonalization.length, 1, 'Produkt musí načítat právě jednu verzi product-personalization.css.');
assert.equal(accountPersonalization.length, 1, 'Účet musí načítat právě jednu verzi product-personalization.css.');
assert.equal(productPersonalization[0], accountPersonalization[0], 'Produkt a účet musí používat stejnou verzi product-personalization.css.');

const shellEntries = [...worker.matchAll(/'((?:\/assets\/)[^']+\?v=[^']+)'/g)].map((match) => match[1]);
const versionsByAsset = new Map();
for (const entry of shellEntries) {
  const [path, version = ''] = entry.split('?v=');
  const versions = versionsByAsset.get(path) || new Set();
  versions.add(version);
  versionsByAsset.set(path, versions);
}
const duplicateVersions = [...versionsByAsset.entries()]
  .filter(([, versions]) => versions.size > 1)
  .map(([path, versions]) => `${path}: ${[...versions].sort().join(', ')}`)
  .sort();
assert.deepEqual(
  duplicateVersions,
  [],
  `PWA shell nesmí precachovat více verzí stejného assetu:\n${duplicateVersions.join('\n')}`
);

assert.match(worker, /const CACHE_NAME = 'slevao-shell-20260901-2';/, 'Po změně precache runtime musí být zvýšený PWA cache namespace.');

console.log(`PWA public-page runtime sync OK (${requiredAssets.size} dependencies)`);
