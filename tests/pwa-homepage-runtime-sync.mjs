import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const index = readFileSync(new URL('index.html', root), 'utf8');
const list = readFileSync(new URL('seznam.html', root), 'utf8');
const product = readFileSync(new URL('produkt.html', root), 'utf8');
const account = readFileSync(new URL('ucet.html', root), 'utf8');
const footer = readFileSync(new URL('assets/home-footer-redesign.js', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const extract = (source, pattern, label) => {
  const match = source.match(pattern);
  assert.ok(match?.[1], `Chybí verzovaná URL pro ${label}.`);
  return match[1];
};
const expectInWorker = (asset, version, message) => {
  assert.match(worker, new RegExp(`/assets/${escape(asset)}\\?v=${escape(version)}`), message);
};

const autopilotJs = extract(index, /assets\/home-autopilot\.js\?v=([0-9-]+)/, 'home-autopilot.js');
const leafletPositionJs = extract(index, /assets\/mobile-leaflet-nav-position\.js\?v=([0-9-]+)/, 'mobile-leaflet-nav-position.js');
const autopilotCss = extract(footer, /assets\/home-autopilot\.css\?v=([0-9-]+)/, 'home-autopilot.css');
const shoppingMobileCss = extract(list, /assets\/shopping-list-mobile-focus\.css\?v=([0-9-]+)/, 'shopping-list-mobile-focus.css');
const shoppingRedesignCss = extract(list, /assets\/shopping-list-redesign\.css\?v=([0-9-]+)/, 'shopping-list-redesign.css');
const productPersonalizationCss = extract(product, /assets\/product-personalization\.css\?v=([0-9-]+)/, 'produkt product-personalization.css');
const accountPersonalizationCss = extract(account, /assets\/product-personalization\.css\?v=([0-9-]+)/, 'ucet product-personalization.css');
const accountRedesignCss = extract(account, /assets\/account-redesign\.css\?v=([0-9-]+)/, 'account-redesign.css');
const accountMobileHeroCss = extract(account, /assets\/account-mobile-hero-card\.css\?v=([0-9-]+)/, 'account-mobile-hero-card.css');
const webPushJs = extract(account, /assets\/web-push\.js\?v=([0-9-]+)/, 'web-push.js');
const accountRecoveryJs = extract(account, /assets\/account-recovery\.js\?v=([0-9-]+)/, 'account-recovery.js');

assert.equal(productPersonalizationCss, accountPersonalizationCss, 'Produkt a účet musí používat stejnou verzi product-personalization.css.');
expectInWorker('home-autopilot.js', autopilotJs, 'PWA shell cachuje jinou verzi home-autopilot.js než homepage.');
expectInWorker('mobile-leaflet-nav-position.js', leafletPositionJs, 'PWA shell cachuje jinou verzi mobile-leaflet-nav-position.js než homepage.');
expectInWorker('home-autopilot.css', autopilotCss, 'PWA shell cachuje jinou verzi home-autopilot.css než homepage loader.');
expectInWorker('shopping-list-mobile-focus.css', shoppingMobileCss, 'PWA shell cachuje jinou verzi shopping-list-mobile-focus.css než seznam.html.');
expectInWorker('shopping-list-redesign.css', shoppingRedesignCss, 'PWA shell neobsahuje hlavní vzhled nákupního seznamu.');
expectInWorker('product-personalization.css', productPersonalizationCss, 'PWA shell cachuje jinou verzi product-personalization.css než produkt/účet.');
expectInWorker('account-redesign.css', accountRedesignCss, 'PWA shell neobsahuje hlavní vzhled účtu.');
expectInWorker('account-mobile-hero-card.css', accountMobileHeroCss, 'PWA shell neobsahuje mobilní hero účtu.');
expectInWorker('web-push.js', webPushJs, 'PWA shell neobsahuje web-push runtime účtu.');
expectInWorker('account-recovery.js', accountRecoveryJs, 'PWA shell neobsahuje obnovu hesla účtu.');
assert.match(worker, /const CACHE_NAME = 'slevao-shell-20260830-5';/, 'Po změně precache runtime musí být zvýšený PWA cache namespace.');

console.log('PWA public-page runtime sync OK');
