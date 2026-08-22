import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const NAV_VERSION = '20260822-1';
const NAV_SCRIPT = `assets/store-bottom-nav.js?v=${NAV_VERSION}`;
const generator = readFileSync(new URL('../scripts/generate-store-pages.mjs', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260730124500_expand_czech_store_catalog.sql', import.meta.url), 'utf8').split(')\ninsert into public.stores')[0];
const homepage = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const stores = new Map();
for (const match of migration.matchAll(/\('([a-z0-9-]+)',\s*'([^']+)'/g)) stores.set(match[1], match[2]);
const catalog = homepage.match(/const CATALOG=\[(.*?)\]\.map/s)?.[1] || '';
for (const match of catalog.matchAll(/\['([^']+)','([^']+)'/g)) stores.set(match[1], match[2]);

assert.match(generator, /existsSync\(pageUrl\)/, 'Generátor musí chránit existující store stránky před přepsáním.');
assert.match(generator, /patchExistingStorePage\(pageUrl, slug\)/, 'Existující stránky se mají pouze bezpečně patchovat.');
assert.ok(generator.includes(`const STORE_NAV_VERSION = '${NAV_VERSION}'`), 'Generátor musí používat aktuální cache-bust store navigace.');
assert.ok(generator.includes('id="leafletGrid"'), 'Šablona nového obchodu musí obsahovat letákovou sekci.');
assert.ok(generator.includes('id="leafletViewer"'), 'Šablona nového obchodu musí obsahovat interní prohlížeč letáku.');
assert.ok(generator.includes('assets/store-bottom-nav.css'), 'Šablona nového obchodu musí obsahovat mobilní/store navigaci.');

for (const [slug] of stores) {
  const pageUrl = new URL(`../${slug}.html`, import.meta.url);
  assert.ok(existsSync(pageUrl), `Chybí store stránka ${slug}.html.`);
  const html = readFileSync(pageUrl, 'utf8');
  const navRefs = html.match(/assets\/store-bottom-nav\.js\?v=[^"'\s<>]+/g) || [];
  assert.equal(navRefs.length, 1, `${slug}.html musí načítat store-bottom-nav.js právě jednou.`);
  assert.equal(navRefs[0], NAV_SCRIPT, `${slug}.html používá zastaralou verzi store-bottom-nav.js.`);
}

const genericPage = readFileSync(new URL('../obchod.html', import.meta.url), 'utf8');
assert.ok(genericPage.includes(NAV_SCRIPT), 'obchod.html musí používat stejnou aktuální store-bottom-nav verzi.');

console.log(`OK: ${stores.size} store stránek používá ${NAV_SCRIPT} a generátor zachovává existující HTML.`);
