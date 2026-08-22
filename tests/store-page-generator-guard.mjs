import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const NAV_VERSION = '20260822-1';
const NAV_SCRIPT = `assets/store-bottom-nav.js?v=${NAV_VERSION}`;
const FEED_VERSION = '20260822-2';
const FEED_SCRIPT = `assets/store-feed.js?v=${FEED_VERSION}`;
const GENERIC_VERSION = '20260822-3';
const GENERIC_BOOTSTRAP = `assets/store-generic-bootstrap.js?v=${GENERIC_VERSION}`;
const EXPECTED_STORE_COUNT = 73;
const PUBLIC_PAGES = ['kontakt.html', 'ochrana-soukromi.html', 'podminky.html'];
const generator = readFileSync(new URL('../scripts/generate-store-pages.mjs', import.meta.url), 'utf8');
const canonicalCatalog = readFileSync(new URL('../supabase/migrations/20260801133000_complete_store_brand_logos.sql', import.meta.url), 'utf8');
const sitemap = readFileSync(new URL('../sitemap.xml', import.meta.url), 'utf8');
const stores = new Set();
for (const match of canonicalCatalog.matchAll(/\('([a-z0-9-]+)'\s*,\s*'[^']+'\)/g)) stores.add(match[1]);

assert.equal(stores.size, EXPECTED_STORE_COUNT, `Kanonický store katalog musí obsahovat ${EXPECTED_STORE_COUNT} obchodů.`);
assert.match(generator, /20260801133000_complete_store_brand_logos\.sql/, 'Generátor musí používat stabilní kanonický 73-store katalog.');
assert.doesNotMatch(generator, /const CATALOG=/, 'Generátor se nesmí znovu navázat na volatilní homepage CATALOG.');
assert.doesNotMatch(generator, /homepage\.match\(/, 'Generátor nesmí odvozovat store katalog z homepage runtime kódu.');
assert.match(generator, /existsSync\(pageUrl\)/, 'Generátor musí chránit existující store stránky před přepsáním.');
assert.match(generator, /patchExistingStorePage\(pageUrl, slug\)/, 'Existující stránky se mají pouze bezpečně patchovat.');
assert.ok(generator.includes(`const STORE_NAV_VERSION = '${NAV_VERSION}'`), 'Generátor musí používat aktuální cache-bust store navigace.');
assert.ok(generator.includes(`const STORE_FEED_VERSION = '${FEED_VERSION}'`), 'Generátor musí používat aktuální cache-bust store feedu.');
assert.ok(generator.includes(`const EXPECTED_STORE_COUNT = ${EXPECTED_STORE_COUNT}`), 'Generátor musí failnout při neúplném store katalogu.');
assert.ok(generator.includes(`const PUBLIC_PAGES = ['kontakt.html', 'ochrana-soukromi.html', 'podminky.html'];`), 'Generátor musí zachovat povinné veřejné stránky v sitemapě.');
assert.ok(generator.includes('publicPageUrls'), 'Generátor musí veřejné stránky skutečně vložit do sitemap výstupu.');
assert.ok(generator.includes('id="leafletGrid"'), 'Šablona nového obchodu musí obsahovat letákovou sekci.');
assert.ok(generator.includes('id="leafletViewer"'), 'Šablona nového obchodu musí obsahovat interní prohlížeč letáku.');
assert.ok(generator.includes('assets/store-bottom-nav.css'), 'Šablona nového obchodu musí obsahovat mobilní/store navigaci.');

for (const page of PUBLIC_PAGES) {
  assert.ok(existsSync(new URL(`../${page}`, import.meta.url)), `Chybí veřejná stránka ${page}.`);
  assert.ok(sitemap.includes(`<loc>https://slevao.cz/${page}</loc>`), `Sitemap neobsahuje veřejnou stránku ${page}.`);
}

for (const slug of stores) {
  const pageUrl = new URL(`../${slug}.html`, import.meta.url);
  assert.ok(existsSync(pageUrl), `Chybí store stránka ${slug}.html.`);
  assert.ok(sitemap.includes(`<loc>https://slevao.cz/${slug}.html</loc>`), `Sitemap neobsahuje store stránku ${slug}.html.`);
  const html = readFileSync(pageUrl, 'utf8');
  const navRefs = html.match(/assets\/store-bottom-nav\.js\?v=[^"'\s<>]+/g) || [];
  const feedRefs = html.match(/assets\/store-feed\.js\?v=[^"'\s<>]+/g) || [];
  assert.equal(navRefs.length, 1, `${slug}.html musí načítat store-bottom-nav.js právě jednou.`);
  assert.equal(navRefs[0], NAV_SCRIPT, `${slug}.html používá zastaralou verzi store-bottom-nav.js.`);
  assert.equal(feedRefs.length, 1, `${slug}.html musí načítat store-feed.js právě jednou.`);
  assert.equal(feedRefs[0], FEED_SCRIPT, `${slug}.html používá zastaralou verzi store-feed.js.`);
}

const genericPage = readFileSync(new URL('../obchod.html', import.meta.url), 'utf8');
const genericBootstrap = readFileSync(new URL('../assets/store-generic-bootstrap.js', import.meta.url), 'utf8');
assert.ok(genericPage.includes(NAV_SCRIPT), 'obchod.html musí používat stejnou aktuální store-bottom-nav verzi.');
assert.ok(genericPage.includes(GENERIC_BOOTSTRAP), 'obchod.html musí načítat aktuální generický bootstrap.');
assert.ok(genericBootstrap.includes(FEED_SCRIPT), 'Generický bootstrap musí dynamicky načítat aktuální store-feed runtime.');
assert.ok(genericBootstrap.includes('const GROCERY_CATEGORY_STORES = new Set(['), 'Generický bootstrap musí mít explicitní allowlist obchodů pro potravinové filtry.');
assert.ok(genericBootstrap.includes("bar.hidden = !GROCERY_CATEGORY_STORES.has(store.slug);"), 'Nepotravinové obchody nesmí dostat zavádějící potravinové filtry.');
assert.ok(genericBootstrap.includes("bar.dataset.categoryMode = bar.hidden ? 'hidden' : 'grocery';"), 'Režim kategorií musí být diagnostikovatelný v DOM.');

console.log(`OK: ${stores.size} store stránek a ${PUBLIC_PAGES.length} veřejné stránky jsou chráněné; runtime ${FEED_SCRIPT} + ${NAV_SCRIPT}.`);