import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-route-freshness.js', root), 'utf8');
const autostart = readFileSync(new URL('assets/shopping-route-autostart.js', root), 'utf8');
const css = readFileSync(new URL('assets/shopping-route-freshness.css', root), 'utf8');
const html = readFileSync(new URL('seznam.html', root), 'utf8');
const worker = readFileSync(new URL('service-worker.js', root), 'utf8');

new Script(source, { filename:'assets/shopping-route-freshness.js' });
new Script(autostart, { filename:'assets/shopping-route-autostart.js' });

for (const needle of [
  'const STALE_MS = 5 * 60 * 1000;',
  "results.querySelector('.srRouteResults') !== routeNode",
  "warning.id = 'srRouteFreshness';",
  "warning.setAttribute('role', 'status');",
  'Ceny v této trase jsou starší než 5 minut.',
  'staleTimer = window.setTimeout(() => markStale(results, routeNode), STALE_MS);',
  "resultObserver.observe(results, { childList:true });",
]) assert.ok(source.includes(needle), `Chybí route freshness kontrakt: ${needle}`);

for (const needle of [
  'function ownerGateReady()',
  'script[src*="shopping-insights-bootstrap.js"]',
  'script[src*="shopping-list.js"]',
  'if (!ownerGateReady()) return false;',
]) assert.ok(autostart.includes(needle), `Chybí auth-owner gate route autostartu: ${needle}`);

assert.ok(!source.includes('.click('), 'Freshness guard nesmí automaticky přepočítávat trasu.');
assert.ok(!source.includes('getPosition'), 'Freshness guard nesmí sám žádat GPS polohu.');
assert.ok(!source.includes('geolocation'), 'Freshness guard nesmí sahat přímo na geolokaci.');
assert.ok(css.includes('.srRouteFreshness'), 'Chybí styl upozornění na starou trasu.');

let routeNode = { id:'route-1' };
let warning = null;
let timeoutCallback = null;
let timeoutMs = 0;
let observerCallback = null;

const results = {
  querySelector(selector) {
    if (selector === '.srRouteResults') return routeNode;
    if (selector === '#srRouteFreshness') return warning;
    return null;
  },
  appendChild(node) {
    warning = node;
    node.remove = () => { if (warning === node) warning = null; };
  },
};

class MockMutationObserver {
  constructor(callback) { observerCallback = callback; }
  observe() {}
  disconnect() {}
}

const context = {
  MutationObserver:MockMutationObserver,
  document:{
    getElementById(id) { return id === 'srResults' ? results : null; },
    createElement() {
      return {
        id:'', className:'', textContent:'',
        setAttribute(name, value) { this[name] = value; },
        remove() {},
      };
    },
  },
  window:{
    setTimeout(callback, ms) { timeoutCallback = callback; timeoutMs = ms; return 11; },
    clearTimeout() {},
    setInterval() { throw new Error('Při dostupném srResults se nemá spouštět attach polling.'); },
    clearInterval() {},
    addEventListener() {},
  },
};

new Script(source, { filename:'shopping-route-freshness-runtime.js' }).runInNewContext(context);
assert.equal(timeoutMs, 300000, 'Nový výsledek trasy nemá přesně pětiminutovou freshness hranici.');
assert.equal(typeof timeoutCallback, 'function', 'Freshness timer nebyl založen.');
timeoutCallback();
assert.equal(warning?.id, 'srRouteFreshness', 'Po pěti minutách se nezobrazí freshness upozornění.');
assert.match(String(warning?.textContent || ''), /starší než 5 minut/i, 'Freshness upozornění nevysvětluje stáří cen.');

routeNode = { id:'route-2' };
observerCallback();
assert.equal(warning, null, 'Nový výpočet musí staré freshness upozornění odstranit.');
assert.equal(timeoutMs, 300000, 'Nový výpočet musí znovu založit pětiminutovou freshness hranici.');

const cssUrl = html.match(/assets\/shopping-route-freshness\.css\?v=[^"']+/)?.[0] || '';
const jsUrl = html.match(/assets\/shopping-route-freshness\.js\?v=[^"']+/)?.[0] || '';
const autostartUrl = html.match(/assets\/shopping-route-autostart\.js\?v=[^"']+/)?.[0] || '';
assert.match(cssUrl, /^assets\/shopping-route-freshness\.css\?v=20260828-[0-9]+$/, 'HTML nenačítá verzovaný route freshness CSS.');
assert.match(jsUrl, /^assets\/shopping-route-freshness\.js\?v=20260828-[0-9]+$/, 'HTML nenačítá verzovaný route freshness runtime.');
assert.ok(autostartUrl, 'HTML nenačítá route autostart runtime.');
for (const runtimeUrl of [cssUrl, jsUrl, autostartUrl]) {
  assert.ok(!worker.includes(`'/${runtimeUrl}'`), `${runtimeUrl} se nesmí vrátit do install-time PWA precache.`);
}
assert.ok(worker.includes("cache: 'reload'"), 'Route CSS/JS musí být network-first.');
assert.ok(worker.includes('putRuntime(request, response)'), 'Route CSS/JS musí být po úspěšném načtení uložitelný do runtime cache.');

let listGateReady = false;
let autostartInterval = null;
let routeClicks = 0;
let routeStatus = '';
const routeButton = {
  disabled:false,
  click() { routeClicks += 1; },
};
const routeStatusNode = {
  set textContent(value) { routeStatus = String(value); },
  get textContent() { return routeStatus; },
};
const autostartContext = {
  localStorage:{ getItem() { return null; } },
  location:{ search:'?route=1' },
  URLSearchParams,
  JSON,
  Number,
  String,
  Boolean,
  document:{
    readyState:'complete',
    addEventListener() {},
    querySelector(selector) {
      if (selector.includes('shopping-insights-bootstrap.js')) return {};
      if (selector.includes('shopping-list.js')) return listGateReady ? {} : null;
      return null;
    },
    getElementById(id) {
      if (id === 'srCalculate') return routeButton;
      if (id === 'srStatus') return routeStatusNode;
      return null;
    },
  },
  window:{
    setInterval(callback) { autostartInterval = callback; return 1; },
    clearInterval() {},
    setTimeout(callback) { callback(); return 1; },
  },
};
new Script(autostart, { filename:'shopping-route-autostart-runtime.js' }).runInNewContext(autostartContext);
assert.equal(typeof autostartInterval, 'function', 'Route autostart nezaložil čekání na připravený runtime.');
autostartInterval();
assert.equal(routeClicks, 0, 'Route autostart klikl před dokončením auth-owner gate.');
listGateReady = true;
autostartInterval();
assert.equal(routeClicks, 1, 'Route autostart se nespustil po dokončení auth-owner gate.');
assert.match(routeStatus, /připravuji GPS trasu/i, 'Route autostart po odemčení gate neaktualizoval stav.');

console.log('Shopping route becomes visibly stale after five minutes and autostart waits for auth-owner readiness');
