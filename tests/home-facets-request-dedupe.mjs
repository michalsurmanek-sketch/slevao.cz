import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = fs.readFileSync('index.html', 'utf8');
const source = fs.readFileSync('assets/rpc-request-dedupe.js', 'utf8');
const home = fs.readFileSync('assets/home-v2.js', 'utf8');

const dedupePos = index.indexOf('assets/rpc-request-dedupe.js?v=');
const homePos = index.indexOf('assets/home-v2.js?v=');
assert(dedupePos >= 0, 'Homepage must load the facets request dedupe bootstrap.');
assert(homePos >= 0 && dedupePos < homePos, 'Facets dedupe must load before home-v2.js.');
assert(source.includes('function markHeroMetricsPending()'), 'Homepage bootstrap must hide transient zero hero metrics while authoritative facets load.');
assert(source.includes("if (value && value.textContent.trim() === '0') value.textContent = '…';"), 'Transient hero metric zeroes must become a neutral pending marker, not a false 0/0 state.');
assert(source.includes("const FACETS_RPC = '/rest/v1/rpc/get_public_offer_facets'"), 'Dedupe must be scoped to the facets RPC.');
assert(source.includes('const GRACE_MS = 1000'), 'Facets dedupe must use the short one-second startup grace window.');
assert(source.includes('response.clone()'), 'Deduped callers must receive independent Response clones.');
assert(source.includes('cleanupExpired(now)'), 'Expired response entries must be cleaned opportunistically.');
assert(!/localStorage|sessionStorage|setInterval/.test(source), 'Dedupe bootstrap must not use persistent storage or an interval-driven cache.');
assert(source.includes('let facetContextEngaged = false;'), 'Contextual facet mode rewriting must start disengaged.');
assert(source.includes('if (!facetContextEngaged) return body;'), 'Clean startup facets must remain byte-identical so dedupe can collapse them.');
assert(source.includes('if (!event.isTrusted) return;'), 'Synthetic startup UI events must not engage contextual facet mode.');
assert(source.includes('setFacetModeHint(quick.dataset.mode);'), 'Quick-filter interaction must still engage contextual facet mode.');

const cleanupStart = source.indexOf('  function cleanupExpired(now)');
const cleanupEnd = source.indexOf('\n  function fetchWithReadRetry', cleanupStart);
assert(cleanupStart >= 0 && cleanupEnd > cleanupStart, 'Dedupe cleanup section is missing.');
const cleanupSource = source.slice(cleanupStart, cleanupEnd);
assert(!/setTimeout|setInterval/.test(cleanupSource), 'Facets cache expiry itself must stay timer-free.');

const retryStart = source.indexOf('  function fetchWithReadRetry');
const retryEnd = source.indexOf('\n  function contextualFacetBody', retryStart);
assert(retryStart >= 0 && retryEnd > retryStart, 'Safe read retry section is missing.');
const retrySource = source.slice(retryStart, retryEnd);
assert.match(retrySource, /window\.setTimeout\(resolve, RETRY_DELAY_MS\)/, 'Transient read retry must keep its bounded one-shot backoff.');
assert.equal((source.match(/setTimeout/g) || []).length, 1, 'The only timeout in this bootstrap must be the bounded transient read retry.');

assert(home.includes('return state.globalFacets;'), 'Global startup facets must be reusable by the main refresh path.');
assert(home.includes('refreshFacets=true, scroll=false, facetsPromise=null'), 'Main refresh must accept an optional shared startup facets promise.');
assert(home.includes('Promise.resolve(facetsPromise || fetchFacets()).catch((error) => {'), 'Main refresh must reuse supplied facets while handling an auxiliary facets failure without discarding the offer page.');
assert(home.includes("console.warn('Facety nabídek se nepodařilo načíst:', error);"), 'Facets fallback must stay observable in the console.');
assert(home.includes('return state.facets;'), 'Facets fallback must preserve the last usable facets state.');
assert(home.includes('const globalFacetsPromise = loadGlobalFacets().catch((error) => {'), 'Homepage startup must create one reusable, non-fatal global facets promise.');
assert(home.includes('refreshCurrent({ facetsPromise: initialQuery ? null : globalFacetsPromise })'), 'Clean startup must reuse global facets while query startup keeps query-specific facets.');
assert(!home.includes('Promise.all([loadGlobalFacets(), refreshCurrent()])'), 'Legacy app-level duplicate startup facets path must stay removed.');

class FakeResponse {
  constructor(body) { this.body = body; }
  clone() { return new FakeResponse(this.body); }
}

let clock = 10_000;
class FakeDate extends Date {
  static now() { return clock; }
}

let underlyingCalls = 0;
let releases = [];
const originalFetch = (url, init) => {
  underlyingCalls += 1;
  return new Promise((resolve) => {
    releases.push(() => resolve(new FakeResponse(`${url}:${init?.body || ''}`)));
  });
};

const context = {
  window: {
    fetch: originalFetch,
    setTimeout: (callback) => { callback(); return 1; },
  },
  Request: undefined,
  Map,
  Set,
  Date: FakeDate,
  URLSearchParams,
  location: { search: '' },
};
context.window.window = context.window;
vm.createContext(context);
vm.runInContext(source, context, { filename: 'assets/rpc-request-dedupe.js' });

const url = 'https://example.supabase.co/rest/v1/rpc/get_public_offer_facets';
const initA = { method: 'POST', body: JSON.stringify({ p_store_slug: null }) };
const first = context.window.fetch(url, initA);
const second = context.window.fetch(url, initA);
assert.equal(underlyingCalls, 1, 'Concurrent identical facets requests must share one network call.');
releases.shift()();
const [firstResponse, secondResponse] = await Promise.all([first, second]);
assert.notEqual(firstResponse, secondResponse, 'Concurrent callers must not share the same Response object.');
assert.equal(firstResponse.body, secondResponse.body, 'Concurrent callers must receive the same payload.');

const third = await context.window.fetch(url, initA);
assert.equal(underlyingCalls, 1, 'An identical request inside the one-second startup grace window must reuse the completed response.');
assert.equal(third.body, firstResponse.body, 'Grace-window reuse must preserve the payload.');

clock += 1001;
const fourth = context.window.fetch(url, initA);
assert.equal(underlyingCalls, 2, 'The same request after the grace window must go back to the network.');
releases.shift()();
await fourth;

clock += 1001;
const initB = { method: 'POST', body: JSON.stringify({ p_store_slug: 'kaufland' }) };
const fifth = context.window.fetch(url, initA);
const sixth = context.window.fetch(url, initB);
assert.equal(underlyingCalls, 4, 'Different facets payloads must remain independent network calls.');
releases.shift()();
releases.shift()();
await Promise.all([fifth, sixth]);

const otherUrl = 'https://example.supabase.co/rest/v1/rpc/get_public_offer_page_filtered';
const other = context.window.fetch(otherUrl, initA);
assert.equal(underlyingCalls, 5, 'Non-facets RPCs must bypass the dedupe layer.');
releases.shift()();
await other;

// Regression: a synthetic startup UI event can fire between two otherwise identical
// global facet callers. It must not turn the second request into another mode request.
let modeClock = 20_000;
class ModeDate extends Date {
  static now() { return modeClock; }
}
const listeners = {};
const documentStub = {
  querySelector: () => ({}),
  addEventListener: (type, handler) => { listeners[type] = handler; },
  getElementById: () => null,
};
let modeCalls = 0;
let modeBodies = [];
let modeReleases = [];
const modeFetch = (requestUrl, init) => {
  modeCalls += 1;
  modeBodies.push(init?.body || '');
  return new Promise((resolve) => {
    modeReleases.push(() => resolve(new FakeResponse(`${requestUrl}:${init?.body || ''}`)));
  });
};
const modeContext = {
  window: {
    fetch: modeFetch,
    setTimeout: (callback) => { callback(); return 1; },
  },
  document: documentStub,
  Request: undefined,
  Map,
  Set,
  Date: ModeDate,
  URLSearchParams,
  location: { search: '' },
};
modeContext.window.window = modeContext.window;
vm.createContext(modeContext);
vm.runInContext(source, modeContext, { filename: 'assets/rpc-request-dedupe.js' });

const startupPayload = {
  p_include_upcoming:true,
  p_query:null,
  p_mode:'all',
  p_store_slug:null,
  p_min_price:null,
  p_max_price:null,
  p_only_images:false,
  p_filter_group:null,
  p_region_code:null,
  p_city_name:null,
};
const startupInit = { method:'POST', body:JSON.stringify(startupPayload) };
const startupFirst = modeContext.window.fetch(url, startupInit);
listeners.click({ isTrusted:false, target:{} });
const startupSecond = modeContext.window.fetch(url, startupInit);
assert.equal(modeCalls, 1, 'Clean homepage startup must ignore synthetic UI events, keep both global facets payloads identical and collapse them to one network request.');
assert.equal(JSON.parse(modeBodies[0]).p_mode, 'all', 'The reusable startup facets payload must stay global/all.');
modeReleases.shift()();
await Promise.all([startupFirst, startupSecond]);

modeClock += 1001;
listeners.click({
  isTrusted:true,
  target: {
    closest: (selector) => selector === '#quickTabs [data-mode]' ? { dataset:{ mode:'food' } } : null,
  },
});
const afterQuickFilter = modeContext.window.fetch(url, startupInit);
assert.equal(modeCalls, 2, 'A trusted user quick-filter interaction must request fresh contextual facets after the startup grace window.');
assert.equal(JSON.parse(modeBodies[1]).p_mode, 'food', 'After user interaction the facets payload must follow the selected quick-filter mode.');
modeReleases.shift()();
await afterQuickFilter;

console.log('Homepage facets request dedupe, synthetic-startup guard, contextual mode and fallback OK');
