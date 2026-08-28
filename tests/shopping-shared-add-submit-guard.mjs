import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-shared-add-submit-guard.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-shared-add-submit-guard.js' });

for (const needle of [
  'const RELEASE_TIMEOUT_MS = 15000;',
  'if (!sharedMode || !document.querySelector(\'.sfListLayout\')) return;',
  'function release()',
  'button.disabled = Boolean(nameInput?.disabled);',
  'function begin()',
  "button.setAttribute('aria-busy', 'true');",
  "return !document.querySelector('#listItems .sfLoading');",
  'if (busy) {',
  'event.stopImmediatePropagation();',
  "event.target?.closest?.('#addCustom')",
  "event.key !== 'Enter' || event.target?.id !== 'customName'",
  'new MutationObserver(() =>',
]) {
  assert.ok(source.includes(needle), `Chybí shared add submit guard: ${needle}`);
}

function createEvent(target) {
  return {
    target,
    prevented:false,
    stopped:false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; },
  };
}

const clickHandlers = [];
const keyHandlers = [];
const observerCallbacks = [];
const attributes = new Map();
const button = {
  disabled:false,
  setAttribute(name, value) { attributes.set(name, value); },
  removeAttribute(name) { attributes.delete(name); },
};
const nameInput = { disabled:false };
const list = {};
const message = { textContent:'' };
const target = { closest(selector) { return selector === '#addCustom' ? button : null; } };

class MutationObserverMock {
  constructor(callback) { observerCallbacks.push(callback); }
  observe() {}
}

const document = {
  querySelector(selector) {
    if (selector === '.sfListLayout') return {};
    if (selector === '#listItems .sfLoading') return null;
    return null;
  },
  getElementById(id) {
    if (id === 'addCustom') return button;
    if (id === 'customName') return nameInput;
    if (id === 'listItems') return list;
    if (id === 'listMessage') return message;
    return null;
  },
  addEventListener(type, callback) {
    if (type === 'click') clickHandlers.push(callback);
    if (type === 'keydown') keyHandlers.push(callback);
  },
};

let timerId = 0;
const window = {
  setTimeout() { timerId += 1; return timerId; },
};
const context = {
  document,
  window,
  location:{ search:'?share=test-token', hash:'' },
  URLSearchParams,
  MutationObserver:MutationObserverMock,
  clearTimeout() {},
  String,
  Boolean,
};
new Script(source, { filename:'shared-add-submit-guard-simulation.js' }).runInNewContext(context);

assert.equal(clickHandlers.length, 1, 'Shared guard nezaregistroval click capture handler.');
assert.equal(keyHandlers.length, 1, 'Shared guard nezaregistroval Enter capture handler.');
assert.equal(observerCallbacks.length, 2, 'Shared guard nesleduje render i chybovou zprávu.');

const first = createEvent(target);
clickHandlers[0](first);
assert.equal(first.prevented, false, 'První shared add nesmí být zastavený.');
assert.equal(first.stopped, false, 'První shared add musí dojít k původnímu handleru.');
assert.equal(button.disabled, true, 'První shared add nezamkl tlačítko proti double submitu.');
assert.equal(attributes.get('aria-busy'), 'true', 'První shared add nemá aria-busy stav.');

const second = createEvent(target);
clickHandlers[0](second);
assert.equal(second.prevented, true, 'Druhý shared add během busy nebyl zastavený.');
assert.equal(second.stopped, true, 'Druhý shared add během busy propadl do původního handleru.');

observerCallbacks[0]();
assert.equal(button.disabled, false, 'Po úspěšném shared renderu se edit tlačítko znovu neodemklo.');
assert.equal(attributes.has('aria-busy'), false, 'Po úspěšném shared renderu zůstal aria-busy stav.');

const third = createEvent(target);
clickHandlers[0](third);
assert.equal(third.prevented, false, 'Po dokončení první operace nejde přidat další položku.');
nameInput.disabled = true;
observerCallbacks[0]();
assert.equal(button.disabled, true, 'View-only shared seznam se po release chybně odemkl.');

console.log('Shared custom add double-submit guard OK');
