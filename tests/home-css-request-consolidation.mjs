import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync('index.html', 'utf8');
const storeRow = fs.readFileSync('assets/mobile-store-row-fix.css', 'utf8');
const deals = fs.readFileSync('assets/mobile-deals-heading-fix.css', 'utf8');
const topTip = fs.readFileSync('assets/top-tip-button.css', 'utf8');

for (const path of [
  'assets/mobile-section-dividers.css',
  'assets/mobile-category-scroll-arrow.css',
  'assets/mobile-card-view-row.css',
]) {
  assert.equal(fs.existsSync(path), false, `${path} must stay consolidated`);
}

assert.equal(
  storeRow.includes('mobile-section-dividers.css'),
  false,
  'mobile-store-row-fix.css must not reintroduce the section-divider @import',
);
assert.match(storeRow, /main#top > #homeNearbyMobile::before/);
assert.match(storeRow, /main#top > #homeAutopilot::after/);
assert.match(storeRow, /main#top > #categoriesSection::after/);
assert.match(storeRow, /background:repeating-linear-gradient\(90deg/);
assert.match(storeRow, /background-color:#12a69b!important/);

assert.equal(
  deals.includes('mobile-category-scroll-arrow.css'),
  false,
  'mobile-deals-heading-fix.css must not reintroduce the category-scroll @import',
);
assert.match(deals, /slCategoryArrowNudge/);
assert.match(deals, /Mobile offer view: result count left, 3 icon controls right, sorting below\./);

assert.doesNotMatch(
  topTip,
  /@import\s+(?:url\()?['"]?mobile-home-polish\.css/i,
  'top-tip-button.css must keep mobile-home-polish inlined instead of adding another homepage request',
);
assert.match(topTip, /Inlined from mobile-home-polish\.css/);
assert.match(topTip, /--sl-teal:#0b978d/);
assert.match(topTip, /\.heroNearbyPanel\.is-nearby-collapsed/);

assert.doesNotMatch(
  topTip,
  /@import\s+(?:url\()?['"]?mobile-filter-sheet-fix\.css/i,
  'top-tip-button.css must keep the mobile filter sheet inlined instead of adding another homepage request',
);
assert.match(topTip, /Inlined from mobile-filter-sheet-fix\.css/);
assert.match(topTip, /\.filterColumn:has\(#filterPanel\.open\)::before/);
assert.match(topTip, /#filterPanel\.filterPanel\.open/);

assert.equal(
  index.includes('mobile-card-view-row.css'),
  false,
  'index.html must not request the consolidated toolbar stylesheet separately',
);

const directCssLinks = [...index.matchAll(/<link\s+rel="stylesheet"\s+href="assets\/[^"?]+\.css(?:\?[^"#]*)?"[^>]*>/g)];
assert.equal(directCssLinks.length, 25, 'homepage should keep the consolidated 25 direct CSS links');
assert.ok(index.includes('assets/mobile-hero-compact.css?v='), 'Homepage must keep the intentional mobile hero compact layer.');
assert.ok(index.includes('assets/mobile-footer-upgrade.css?v='), 'The 25th direct stylesheet is the intentional mobile footer upgrade layer.');

console.log('home CSS request consolidation guard: OK');
