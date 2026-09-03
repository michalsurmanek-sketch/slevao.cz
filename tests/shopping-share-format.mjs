import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const bootstrap = readFileSync(new URL('assets/shopping-insights-bootstrap.js', root), 'utf8');
const clipboardBridge = readFileSync(new URL('assets/shopping-clipboard-share-bridge.js', root), 'utf8');
const fallbackGuard = readFileSync(new URL('assets/shopping-share-fallback-guard.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

assert.ok(
  bootstrap.includes("typeof navigator === 'undefined' || !navigator.share"),
  'Share bridge musí bezpečně fungovat i tam, kde navigator není dostupný.'
);
assert.ok(
  bootstrap.includes("const sharedMode = Boolean(sharedHash.get('share'));"),
  'Bootstrap musí shared režim odvozovat pouze z hash tokenu.'
);
assert.ok(
  !bootstrap.includes('new URLSearchParams(location.search)'),
  'Bootstrap nesmí znovu přijímat share token z query stringu.'
);
new Script(clipboardBridge, { filename:'assets/shopping-clipboard-share-bridge.js' });
new Script(fallbackGuard, { filename:'assets/shopping-share-fallback-guard.js' });

const sanitizerMatch = html.match(/<script data-shopping-share-url-sanitizer>([\s\S]*?)<\/script>/i);
assert.ok(sanitizerMatch?.[1], 'Chybí časný sanitizér legacy share URL.');
const sanitizer = sanitizerMatch[1];
new Script(sanitizer, { filename:'shopping-share-url-sanitizer.js' });
for (const needle of [
  "url.searchParams.get('share')",
  "url.searchParams.delete('share')",
  "/^[0-9a-f]{48}$/.test(legacyToken)",
  "hash.set('share', legacyToken)",
  'history.replaceState(history.state',
]) {
  assert.ok(sanitizer.includes(needle), `Chybí sanitizační kontrakt share URL: ${needle}`);
}
assert.ok(html.includes('<meta name="referrer" content="origin">'), 'Seznam musí omezit Referer na origin.');
const sanitizerIndex = html.indexOf('data-shopping-share-url-sanitizer');
const firstStylesheetIndex = html.indexOf('<link rel="stylesheet"');
const firstDeferredScriptIndex = html.indexOf('<script defer');
assert.ok(sanitizerIndex >= 0 && sanitizerIndex < firstStylesheetIndex, 'Share URL se musí sanitizovat před načítáním stylů.');
assert.ok(sanitizerIndex < firstDeferredScriptIndex, 'Share URL se musí sanitizovat před deferred runtime skripty.');

function sanitizeLegacyUrl(href) {
  let replacement = null;
  const context = {
    location: { href },
    history: {
      state: { keep:true },
      replaceState(state, title, value) {
        replacement = { state, title, value };
      },
    },
    URL,
    URLSearchParams,
  };
  new Script(sanitizer, { filename:'shopping-share-url-sanitizer-runtime.js' }).runInNewContext(context);
  return replacement;
}

const validLegacyToken = 'a'.repeat(48);
const migrated = sanitizeLegacyUrl(`https://slevao.cz/seznam.html?utm_source=test&share=${validLegacyToken}`);
assert.equal(migrated?.value, `/seznam.html?utm_source=test#share=${validLegacyToken}`, 'Platný legacy query token se musí převést do hashe a zachovat ostatní query parametry.');
assert.deepEqual(migrated?.state, { keep:true }, 'Sanitizace nesmí zahodit history state.');

const existingHashToken = 'b'.repeat(48);
const existingHash = sanitizeLegacyUrl(`https://slevao.cz/seznam.html?share=${validLegacyToken}#share=${existingHashToken}`);
assert.equal(existingHash?.value, `/seznam.html#share=${existingHashToken}`, 'Existující hash token má přednost před legacy query tokenem.');

const invalidLegacy = sanitizeLegacyUrl('https://slevao.cz/seznam.html?share=test-token');
assert.equal(invalidLegacy?.value, '/seznam.html', 'Neplatný legacy share parametr se musí z URL odstranit.');
assert.equal(sanitizeLegacyUrl('https://slevao.cz/seznam.html#share=test-token'), null, 'Hash-only odkaz se nesmí zbytečně přepisovat.');

const functionStart = bootstrap.indexOf('  function installShareBridge()');
const functionEnd = bootstrap.indexOf('\n  function markerUserId()', functionStart);
assert.ok(functionStart >= 0 && functionEnd > functionStart, 'Share bridge nejde izolovaně otestovat.');
const bridgeFunction = bootstrap.slice(functionStart, functionEnd);

function article({ name, quantity, done = false }) {
  return {
    classList: { contains(value) { return value === 'done' && done; } },
    querySelector(selector) {
      if (selector === '.sfItemName') return { textContent: name };
      if (selector === '[data-quantity]') return { value: String(quantity) };
      return null;
    },
  };
}

const rows = [
  article({ name:'Mléko', quantity:2 }),
  article({ name:'Chléb', quantity:1 }),
  article({ name:'Pivo', quantity:6, done:true }),
];
const document = {
  querySelectorAll(selector) {
    assert.equal(selector, '#listItems [data-id]');
    return rows;
  },
};

const nativeCalls = [];
const navigator = {
  async share(payload) {
    nativeCalls.push(payload);
  },
};
const context = {
  navigator,
  document,
  String,
  Number,
  Object,
  Array,
  Intl,
};

new Script(`
${bridgeFunction}
installShareBridge();
`, { filename:'shopping-share-format-test.js' }).runInNewContext(context);

const url = 'https://slevao.cz/seznam.html#share=test-token';
await navigator.share({
  title:'Nákupní seznam Slevao.cz',
  text:'Původní text',
  url,
});

assert.equal(nativeCalls.length, 1, 'Nativní share se má zavolat právě jednou.');
const payload = nativeCalls[0];
assert.equal(payload.title, 'Nákupní seznam Slevao.cz');
assert.equal(payload.url, undefined, 'URL nesmí být předána podruhé mimo text sdílení.');
assert.match(payload.text, /^Nákupní seznam Slevao\.cz\n2 položky · 3 kusy\n\n/);
assert.ok(payload.text.includes('2× Mléko'), 'Ve sdílení chybí množství a název první položky.');
assert.ok(payload.text.includes('1× Chléb'), 'Ve sdílení chybí druhá položka.');
assert.ok(!payload.text.includes('Pivo'), 'Koupená položka se nemá sdílet.');
assert.ok(payload.text.includes(`Společný seznam:\n${url}`), 'Sdílení musí obsahovat jeden společný odkaz.');
assert.equal(payload.text.split(url).length - 1, 1, 'Sdílený odkaz se nesmí duplikovat.');

const passthrough = { title:'Jiný obsah', text:'Ahoj', url:'https://slevao.cz/' };
await navigator.share(passthrough);
assert.equal(nativeCalls.length, 2, 'Běžné Web Share volání musí projít nativně.');
assert.deepEqual(nativeCalls[1], passthrough, 'Share bridge nesmí měnit nesouvisející sdílení.');

const clipboardCalls = [];
const clipboard = {
  async writeText(value) {
    clipboardCalls.push(value);
  },
};
const clipboardNavigator = { clipboard };
const clipboardContext = {
  navigator: clipboardNavigator,
  document,
  String,
  Number,
  Object,
  Array,
  Intl,
  URL,
  URLSearchParams,
};
new Script(clipboardBridge, { filename:'shopping-clipboard-share-format-test.js' }).runInNewContext(clipboardContext);
assert.equal(clipboard.__slevaoShoppingShareClipboardBridge, true, 'Clipboard share bridge se nenainstaloval.');
const firstClipboardWrapper = clipboard.writeText;

await clipboard.writeText(url);
assert.equal(clipboardCalls.length, 1, 'Clipboard fallback má zapsat právě jednou.');
const clipboardText = clipboardCalls[0];
assert.match(clipboardText, /^Nákupní seznam Slevao\.cz\n2 položky · 3 kusy\n\n/);
assert.ok(clipboardText.includes('2× Mléko'), 'Clipboard fallback neobsahuje první aktivní položku.');
assert.ok(clipboardText.includes('1× Chléb'), 'Clipboard fallback neobsahuje druhou aktivní položku.');
assert.ok(!clipboardText.includes('Pivo'), 'Clipboard fallback nesmí obsahovat koupenou položku.');
assert.ok(clipboardText.includes(`Společný seznam:\n${url}`), 'Clipboard fallback musí obsahovat společný odkaz.');
assert.equal(clipboardText.split(url).length - 1, 1, 'Clipboard fallback nesmí duplikovat URL.');

const ordinaryClipboard = 'https://slevao.cz/produkt.html?id=123';
await clipboard.writeText(ordinaryClipboard);
assert.equal(clipboardCalls.length, 2, 'Běžné kopírování musí projít nativně.');
assert.equal(clipboardCalls[1], ordinaryClipboard, 'Clipboard bridge nesmí měnit nesouvisející text.');

const legacyQueryClipboard = `https://slevao.cz/seznam.html?share=${validLegacyToken}`;
await clipboard.writeText(legacyQueryClipboard);
assert.equal(clipboardCalls.length, 3, 'Legacy query URL musí clipboard bridge předat právě jednou.');
assert.equal(clipboardCalls[2], legacyQueryClipboard, 'Clipboard bridge nesmí považovat query token za bezpečný shared odkaz.');

new Script(clipboardBridge, { filename:'shopping-clipboard-share-second-install.js' }).runInNewContext(clipboardContext);
assert.equal(clipboard.writeText, firstClipboardWrapper, 'Druhá instalace nesmí znovu obalit clipboard.writeText.');

const failedNativeCalls = [];
const failedClipboardCalls = [];
const failedNavigator = {
  clipboard: {
    async writeText(value) {
      failedClipboardCalls.push(value);
    },
  },
  async share(value) {
    failedNativeCalls.push(value);
    const error = new Error('System share blocked');
    error.name = 'NotAllowedError';
    throw error;
  },
};
const failedContext = {
  navigator: failedNavigator,
  document,
  String,
  Number,
  Object,
  Array,
  Intl,
  URL,
  URLSearchParams,
};
new Script(clipboardBridge, { filename:'shopping-failed-share-clipboard-bridge.js' }).runInNewContext(failedContext);
new Script(`${bridgeFunction}\ninstallShareBridge();`, { filename:'shopping-failed-share-format-bridge.js' }).runInNewContext(failedContext);
new Script(fallbackGuard, { filename:'shopping-failed-share-fallback-guard.js' }).runInNewContext(failedContext);
await failedNavigator.share({ title:'Nákupní seznam Slevao.cz', text:'Původní text', url });
assert.equal(failedNativeCalls.length, 1, 'Selhaný systémový share se má zkusit právě jednou.');
assert.equal(failedClipboardCalls.length, 1, 'Po selhání systémového share se má použít clipboard právě jednou.');
assert.match(failedClipboardCalls[0], /^Nákupní seznam Slevao\.cz\n2 položky · 3 kusy\n\n/);
assert.ok(failedClipboardCalls[0].includes(`Společný seznam:\n${url}`), 'Fallback po selhání share musí zachovat společný odkaz.');
assert.equal(failedClipboardCalls[0].split(url).length - 1, 1, 'Fallback po selhání share nesmí duplikovat URL.');

const abortClipboardCalls = [];
const abortNavigator = {
  clipboard: {
    async writeText(value) {
      abortClipboardCalls.push(value);
    },
  },
  async share() {
    const error = new Error('Cancelled');
    error.name = 'AbortError';
    throw error;
  },
};
const abortContext = {
  navigator: abortNavigator,
  document,
  String,
  Number,
  Object,
  Array,
  Intl,
  URL,
  URLSearchParams,
};
new Script(clipboardBridge, { filename:'shopping-abort-clipboard-bridge.js' }).runInNewContext(abortContext);
new Script(`${bridgeFunction}\ninstallShareBridge();`, { filename:'shopping-abort-share-format-bridge.js' }).runInNewContext(abortContext);
new Script(fallbackGuard, { filename:'shopping-abort-share-fallback-guard.js' }).runInNewContext(abortContext);
await assert.rejects(
  abortNavigator.share({ title:'Nákupní seznam Slevao.cz', text:'Původní text', url }),
  (error) => error?.name === 'AbortError'
);
assert.equal(abortClipboardCalls.length, 0, 'Uživatelské zrušení share dialogu nesmí nic kopírovat.');

for (const needle of [
  "navigator.clipboard.__slevaoShoppingShareClipboardBridge",
  "const token = hash.get('share');",
  "return /\\/seznam(?:\\.html)?$/i.test(url.pathname) && Boolean(token);",
]) assert.ok(clipboardBridge.includes(needle), `Chybí clipboard share kontrakt: ${needle}`);
assert.ok(!clipboardBridge.includes("url.searchParams.get('share')"), 'Clipboard bridge nesmí přijímat share token z query stringu.');
for (const needle of [
  "navigator.__slevaoShoppingShareFallbackGuard",
  "if (error?.name === 'AbortError') throw error;",
  "const fallback = String(data?.url || data?.text || '').trim();",
  'await navigator.clipboard.writeText(fallback);',
]) assert.ok(fallbackGuard.includes(needle), `Chybí share fallback kontrakt: ${needle}`);

const clipboardUrl = html.match(/assets\/shopping-clipboard-share-bridge\.js\?v=[^"']+/)?.[0] || '';
const bootstrapUrl = html.match(/assets\/shopping-insights-bootstrap\.js\?v=[^"']+/)?.[0] || '';
const fallbackUrl = html.match(/assets\/shopping-share-fallback-guard\.js\?v=[^"']+/)?.[0] || '';
assert.equal(clipboardUrl, 'assets/shopping-clipboard-share-bridge.js?v=20260828-2');
assert.equal(bootstrapUrl, 'assets/shopping-insights-bootstrap.js?v=20260903-1');
assert.match(fallbackUrl, /^assets\/shopping-share-fallback-guard\.js\?v=20260828-[0-9]+$/);
assert.ok(html.indexOf(clipboardUrl) < html.indexOf(bootstrapUrl), 'Clipboard share bridge musí běžet před bootstrapem seznamu.');
assert.ok(html.indexOf(bootstrapUrl) < html.indexOf(fallbackUrl), 'Share fallback guard musí běžet až po Web Share bridge bootstrapu.');
for (const runtimeUrl of [clipboardUrl, bootstrapUrl, fallbackUrl]) {
  assert.ok(!worker.includes(`'/${runtimeUrl}'`), `${runtimeUrl} se nesmí vrátit do install-time PWA precache.`);
}
const cacheMatch = worker.match(/CACHE_VERSION = '(\d{8})-(\d+)'/);
assert.ok(cacheMatch, 'PWA cache musí používat formát YYYYMMDD-revision.');
const cacheDate = Number(cacheMatch[1]);
const cacheRevision = Number(cacheMatch[2]);
assert.ok(
  cacheDate > 20260828 || (cacheDate === 20260828 && cacheRevision >= 67),
  'PWA cache je starší než hash-only share integrace 20260828-67.',
);
assert.ok(worker.includes("return /\\.(?:css|js|webmanifest)$/i.test(url.pathname);"), 'Share JavaScript musí být obsloužený jako kritický runtime asset.');
assert.ok(worker.includes("cache: 'reload'"), 'Share JavaScript musí být network-first.');
assert.ok(worker.includes('putRuntime(request, response)'), 'Share JavaScript musí být po úspěšném načtení uložitelný do runtime cache.');

console.log('Shopping share hash-only format and legacy URL sanitization OK');
