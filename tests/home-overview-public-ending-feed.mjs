import assert from 'node:assert/strict';
import fs from 'node:fs';

const overview = fs.readFileSync('assets/home-overview.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

assert(overview.includes('/rest/v1/rpc/get_public_offer_page_filtered'), 'Ending overview must use the public offer RPC.');
assert(!overview.includes('/rest/v1/offers?'), 'Ending overview must not read the offers table directly.');
assert(overview.includes('p_include_upcoming: false'), 'Ending overview must contain only offers already valid today.');
assert(overview.includes("p_sort: 'ending'"), 'Ending overview must keep earliest-expiry ordering.');
assert(overview.includes("p_mode: 'all'"), 'Ending overview must not restrict itself to only offers ending today.');
assert(overview.includes('.map((row) => row?.offer).filter(Boolean)'), 'RPC envelope rows must be unwrapped before rendering.');
assert(overview.includes("const productId = String(offer.product_id || '').trim();"), 'Overview cards must use product_id returned by the public RPC.');
assert(overview.includes('produkt.html?id=${encodeURIComponent(productId)}'), 'Offers with a product_id must link directly to the product detail.');
assert(!index.includes('assets/home-overview-leaflets-fix.js'), 'Homepage must not load the obsolete product-link lookup helper.');

console.log('Homepage public ending feed OK');
