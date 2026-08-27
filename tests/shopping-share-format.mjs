import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const bootstrap = readFileSync(new URL('assets/shopping-insights-bootstrap.js', root), 'utf8');

assert.ok(
  bootstrap.includes("typeof navigator === 'undefined' || !navigator.share"),
  'Share bridge musí bezpečně fungovat i tam, kde navigator není dostupný.'
);

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

const nativeCalls = [];
const navigator = {
  async share(payload) {
    nativeCalls.push(payload);
  },
};
const document = {
  querySelectorAll(selector) {
    assert.equal(selector, '#listItems [data-id]');
    return [
      article({ name:'Mléko', quantity:2 }),
      article({ name:'Chléb', quantity:1 }),
      article({ name:'Pivo', quantity:6, done:true }),
    ];
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

console.log('Shopping share format OK');
