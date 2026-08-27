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
assert(source.includes("const FACETS_RPC = '/rest/v1/rpc/get_public_offer_facets'"), 'Dedupe must be scoped to the facets RPC.');
assert(source.includes('const GRACE_MS = 1000'), 'Facets dedupe must use the short one-second startup grace window.');
assert(source.includes('response.clone()'), 'Deduped callers must receive independent Response clones.');
assert(source.includes('cleanupExpired(now)'), 'Expired response entries must be cleaned without timers.');
assert(!/localStorage|sessionStorage|setTimeout|setInterval/.test(source), 'Dedupe must not become persistent storage or timer-driven cache.');

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
  window: { fetch: originalFetch },
  Request: undefined,
  Map,
  Date: FakeDate,
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

console.log('Homepage facets request dedupe, startup reuse and fallback OK');
