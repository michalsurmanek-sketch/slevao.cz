import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const bootstrap = readFileSync(new URL('assets/shopping-insights-bootstrap.js', root), 'utf8');
const clipboardBridge = readFileSync(new URL('assets/shopping-clipboard-share-bridge.js', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

assert.ok(
  bootstrap.includes("typeof navigator === 'undefined' || !navigator.share"),
  'Share bridge musí bezpečně fungovat i tam, kde navigator není dostupný.'
);
new Script(clipboardBridge, { filename:'assets/shopping-clipboard-share-bridge.js' });

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

new Script(clipboardBridge, { filename:'shopping-clipboard-share-second-install.js' }).runInNewContext(clipboardContext);
assert.equal(clipboard.writeText, firstClipboardWrapper, 'Druhá instalace nesmí znovu obalit clipboard.writeText.');

for (const needle of [
  "navigator.clipboard.__slevaoShoppingShareClipboardBridge",
  "hash.get('share') || url.searchParams.get('share')",
  "return /\\/seznam(?:\\.html)?$/i.test(url.pathname) && Boolean(token);",
]) assert.ok(clipboardBridge.includes(needle), `Chybí clipboard share kontrakt: ${needle}`);

const clipboardUrl = html.match(/assets\/shopping-clipboard-share-bridge\.js\?v=[^"']+/)?.[0] || '';
const bootstrapUrl = html.match(/assets\/shopping-insights-bootstrap\.js\?v=[^"']+/)?.[0] || '';
assert.match(clipboardUrl, /^assets\/shopping-clipboard-share-bridge\.js\?v=20260828-[0-9]+$/);
assert.ok(html.indexOf(clipboardUrl) < html.indexOf(bootstrapUrl), 'Clipboard share bridge musí běžet před bootstrapem seznamu.');
assert.ok(worker.includes(`'/${clipboardUrl}'`), 'PWA necachuje clipboard share bridge.');

console.log('Shopping share format OK');
