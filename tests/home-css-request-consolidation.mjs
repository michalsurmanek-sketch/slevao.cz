import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync('index.html', 'utf8');
const storeRow = fs.readFileSync('assets/mobile-store-row-fix.css', 'utf8');
const deals = fs.readFileSync('assets/mobile-deals-heading-fix.css', 'utf8');
const topTip = fs.readFileSync('assets/top-tip-button.css', 'utf8');
const homeFooter = fs.readFileSync('assets/home-footer-redesign.css', 'utf8');
const homeFooterRuntime = fs.readFileSync('assets/home-footer-redesign.js', 'utf8');
const inStore = fs.readFileSync('assets/home-in-store.css', 'utf8');
const quickFoodPersonalize = fs.readFileSync('assets/home-quick-food-personalize.css', 'utf8');
const liveHero = fs.readFileSync('assets/home-live-hero.css', 'utf8');
const publicNav = fs.readFileSync('assets/public-nav-upgrade.js', 'utf8');
const productHtml = fs.readFileSync('produkt.html', 'utf8');
const listHtml = fs.readFileSync('seznam.html', 'utf8');

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

assert.equal(
  index.includes('assets/footer-generated-bg.css'),
  false,
  'homepage must keep footer-generated-bg.css consolidated into home-footer-redesign.css',
);
assert.doesNotMatch(
  homeFooter,
  /@import\s+(?:url\()?['"]?footer-trust-upgrade\.css/i,
  'homepage footer cascade must stay fully inlined instead of restoring the footer-trust @import request',
);
assert.match(homeFooter, /Homepage footer cascade inlined to remove two stylesheet requests\./);
assert.match(homeFooter, /content:"Upozornění na slevy"/);
assert.match(homeFooter, /background-image:url\('footer-background\.webp\?v=20260808-1'\)!important/);
assert.match(homeFooter, /\.footerShell::before,\s*\n\.footerShell::after\{\s*\n\s*display:none!important;/);

assert.doesNotMatch(
  homeFooterRuntime,
  /home-in-store-actions\.css/,
  'homepage runtime must not restore the standalone in-store actions stylesheet request',
);
assert.doesNotMatch(
  homeFooterRuntime,
  /home-in-store-list\.css/,
  'homepage runtime must not restore the standalone in-store list stylesheet request',
);
assert.match(inStore, /Inlined home-in-store extension styles: actions then list\./);
assert.match(inStore, /\.slInStoreActions\{display:flex/);
assert.match(inStore, /\.slInStoreListCoverage\{margin:14px 22px 0/);

assert.match(homeFooter, /Homepage bundle: store-arrival alerts/);
assert.match(homeFooter, /\.slArrivalToggle\{width:100%;min-height:58px;display:grid/);
assert.match(homeFooter, /\.slArrivalSwitch\{position:relative;width:38px;height:22px/);
assert.match(
  publicNav,
  /if \(!isHomePage\(\) && !document\.querySelector\('link\[href\*="store-arrival-alerts\.css"\]'\)\) \{/,
  'homepage must not restore the standalone store-arrival stylesheet request',
);
assert.equal(index.includes('assets/store-arrival-alerts.css'), false, 'homepage must not directly request store-arrival-alerts.css');
assert.match(productHtml, /assets\/store-arrival-alerts\.css\?v=\d{8}-\d+/);
assert.match(listHtml, /assets\/store-arrival-alerts\.css\?v=\d{8}-\d+/);

assert.equal(
  index.includes('assets/home-semantic-filters.css'),
  false,
  'homepage must keep semantic filters bundled into home-quick-food-personalize.css',
);
assert.match(quickFoodPersonalize, /Homepage bundle: semantic filters/);
assert.match(quickFoodPersonalize, /\.slSemanticPanel\[hidden\]\{display:none!important\}/);
assert.match(quickFoodPersonalize, /\.slSemanticRow button\{min-height:36px/);
assert.match(quickFoodPersonalize, /\.dealsSection\.slSemanticActive \.filterPanel\{border-radius:26px/);
assert.match(homeFooterRuntime, /assets\/home-quick-food-personalize\.css\?v=\d{8}-\d+/);
assert.match(index, /assets\/home-quick-food-personalize\.css\?v=\d{8}-\d+/);

assert.equal(
  index.includes('assets/mobile-hero-compact.css'),
  false,
  'homepage must keep mobile hero compact styles bundled into mobile-deals-heading-fix.css',
);
assert.match(deals, /Homepage bundle: mobile hero compact/);
assert.match(deals, /html body \.heroCard\{padding:14px 14px 14px!important;background-image:url\('\/assets\/hero-mobile-combined\.webp\?v=20260815-1'\)!important/);
assert.match(deals, /html body \.heroCopy>\.eyebrow\{width:max-content!important;max-width:100%!important;min-height:28px!important/);
assert.match(deals, /html body \.heroCard \.heroStats>span\{min-height:52px!important\}/);
assert.match(deals, /html body #dealGrid\[data-card-view="mini"\] \.dealCard h3/);
assert.match(index, /assets\/mobile-deals-heading-fix\.css\?v=\d{8}-\d+/);

assert.equal(
  index.includes('assets/home-radius-select.css'),
  false,
  'homepage must keep radius selector styles bundled into home-live-hero.css',
);
assert.match(liveHero, /Homepage bundle: radius selector/);
assert.match(liveHero, /\.slRadiusControl\{position:relative;width:132px;max-width:100%;z-index:25\}/);
assert.match(liveHero, /\.slRadiusTrigger\{width:100%;height:48px;display:grid/);
assert.match(liveHero, /\.slRadiusMenu\{position:fixed;left:0;top:0;width:164px/);
assert.match(liveHero, /@media\(max-width:800px\)[\s\S]*\.heroNearbyPanel \.slLiveOptions \.slRadiusControl\{\s*width:118px!important;\s*max-width:118px!important;/);

assert.equal(
  index.includes('assets/home-leaflet-covers.css'),
  false,
  'homepage must keep leaflet cover styles bundled into home-live-hero.css',
);
assert.match(liveHero, /Homepage bundle: leaflet covers/);
assert.match(liveHero, /#leafletGrid \.leafletCover\{[\s\S]*aspect-ratio:210\/297;/);
assert.match(liveHero, /#leafletGrid \.leafletFrontPage\{[\s\S]*object-fit:contain;/);
assert.match(liveHero, /#leafletGrid \.leafletCurrentBadge\{[\s\S]*border-radius:999px;/);
assert.match(liveHero, /@media\(max-width:520px\)[\s\S]*#leafletGrid\.leafletGrid\{display:flex;gap:13px;overflow-x:auto;/);
assert.match(index, /assets\/home-live-hero\.css\?v=\d{8}-\d+/);

const directCssLinks = [...index.matchAll(/<link\s+rel="stylesheet"\s+href="assets\/[^"?]+\.css(?:\?[^"#]*)?"[^>]*>/g)];
assert.equal(directCssLinks.length, 20, 'homepage should keep the consolidated 20 direct CSS links');
assert.ok(index.includes('assets/mobile-footer-upgrade.css?v='), 'The final direct stylesheet remains the intentional mobile footer upgrade layer.');

console.log('home CSS request consolidation guard: OK');
