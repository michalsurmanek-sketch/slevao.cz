import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const detail = read('assets/product-detail.js');
const safety = read('assets/product-detail-safety.js');
const identityGuard = read('assets/product-identity-guard.js');
const identityCss = read('assets/product-identity-guard.css');
const publicFeatures = read('assets/public-features.js');
const publicNav = read('assets/public-nav-upgrade.js');
const seo = read('assets/product-seo.js');
const intelligence = read('assets/product-intelligence.js');
const leaflet = read('assets/product-leaflet-location-global.js');
const premiumRuntime = read('assets/product-premium-runtime.js');
const personalization = read('assets/product-personalization.js');
const equivalence = read('assets/product-equivalence.js');
const equivalenceCss = read('assets/product-equivalence.css');
const serviceWorker = read('service-worker.js');
const html = read('produkt.html');
const accountHtml = read('ucet.html');

for (const [path, source] of [
  ['assets/product-detail.js', detail],
  ['assets/product-detail-safety.js', safety],
  ['assets/product-identity-guard.js', identityGuard],
  ['assets/public-features.js', publicFeatures],
  ['assets/public-nav-upgrade.js', publicNav],
  ['assets/product-seo.js', seo],
  ['assets/product-intelligence.js', intelligence],
  ['assets/product-leaflet-location-global.js', leaflet],
  ['assets/product-premium-runtime.js', premiumRuntime],
  ['assets/product-personalization.js', personalization],
  ['assets/product-equivalence.js', equivalence],
  ['service-worker.js', serviceWorker],
]) {
  new Script(source, { filename:path });
}

assert.match(detail, /function offerStoreKey\(offer\)\s*\{\s*return String\(offer\?\.store_id/, 'Počet obchodů musí vycházet pouze ze store_id.');
assert.match(detail, /new Set\(visible\.map\(offerStoreKey\)\.filter\(Boolean\)\)/, 'Statistika obchodů nepoužívá unikátní řetězce.');
assert.match(detail, /function dedupeOffers\(/, 'Detail nemá deduplikaci nabídek.');
assert.match(detail, /const visible = dedupeOffers\(offers\)/, 'Render nepoužívá deduplikované nabídky.');
assert.match(detail, /nejnižší cena dnes/, 'Detail neoznačuje dnešní minimum jednoznačně.');
assert.match(detail, /nejnižší nadcházející cena/, 'Detail neoznačuje nadcházející minimum jednoznačně.');
assert.match(detail, /const current = visible\.filter\(\(row\) => !isUpcoming\(row, today\)\)/, 'Hlavní cena musí preferovat aktuálně platné nabídky proti aktuálnímu pražskému dni.');

assert.match(detail, /function pragueDate\(value = new Date\(\)\)/, 'Detail musí odvozovat business day dynamicky pro Europe/Prague.');
assert.match(detail, /function addCalendarDays\(dateKey, days\)/, 'Sedmidenní okno musí používat kalendářní aritmetiku.');
assert.match(detail, /const today = pragueDate\(\);[\s\S]*const upcomingTo = addCalendarDays\(today, 7\);/, 'Dotaz nabídek musí vytvořit čerstvé pražské sedmidenní okno při načtení.');
assert.doesNotMatch(detail, /offsetDays\s*\*\s*86400000/, 'Detail nesmí posouvat pražský den pevnými 24hodinovými bloky přes DST.');
assert.doesNotMatch(detail, /const today = pragueDate\(0\)|const upcomingTo = pragueDate\(7\)/, 'Detail nesmí zmrazit dnešek a budoucí hranici při inicializaci skriptu.');

assert.match(detail, /window\.__slevaoProductPromise = Promise\.resolve\(productRequest\)/, 'Hlavní detail musí zveřejnit sdílený product request.');
assert.match(detail, /window\.__slevaoProductOffersPromise = Promise\.resolve\(offersRequest\)/, 'Hlavní detail musí zveřejnit jeden sdílený in-flight offers request.');
assert.match(detail, /window\.__slevaoProductHistoryPromise = Promise\.resolve\(historyRequest\)/, 'Hlavní detail musí zveřejnit sdílený history request.');
assert.match(detail, /category_id,is_verified,is_active,metadata/, 'Sdílený produkt musí obsahovat identity metadata potřebná dalšími vrstvami.');
assert.match(detail, /store_location_name,metadata,stores\(id,name,slug,logo_url\)/, 'Sdílený offers snapshot musí obsahovat metadata potřebná pro přesnou lokaci v letáku.');
assert.match(leaflet, /const shared = window\.__slevaoProductOffersPromise/, 'Exact leaflet vrstva musí nejdřív použít sdílený offers request.');
assert.match(leaflet, /if \(!result\?\.error && Array\.isArray\(result\?\.rows\)\) return result\.rows;/, 'Exact leaflet vrstva musí použít úspěšný sdílený snapshot bez druhého query.');
assert.match(leaflet, /const fallback = await db\.from\('offers'\)/, 'Exact leaflet vrstva musí zachovat vlastní offers fallback při selhání sdíleného requestu.');

assert.match(identityGuard, /const shared = window\.__slevaoProductPromise/, 'Identity guard musí používat sdílený produkt před vlastním query.');
assert.match(identityGuard, /const db = await getDb\(\);[\s\S]*db\.from\('products'\)/, 'Identity guard musí zachovat bezpečný product fallback.');
assert.match(intelligence, /const shared = window\.__slevaoProductPromise/, 'Intelligence musí používat sdílený produkt.');
assert.match(intelligence, /const shared = window\.__slevaoProductOffersPromise/, 'Intelligence musí používat sdílené nabídky.');
assert.match(intelligence, /const shared = window\.__slevaoProductHistoryPromise/, 'Intelligence musí používat sdílenou historii.');
assert.match(intelligence, /db\.from\('products'\)[\s\S]*db\.from\('offers'\)[\s\S]*db\.from\('price_history'\)/, 'Intelligence musí zachovat vlastní DB fallbacky pro samostatné použití.');
assert.match(intelligence, /Date\.UTC\(year, month - 1, day \+ Number\(days \|\| 0\)\)/, 'Intelligence fallback musí používat kalendářní sedmidenní okno bez DST driftu.');

assert.match(personalization, /function pragueDate\(value = new Date\(\)\)/, 'Personalizace musí používat čerstvý Europe/Prague business day.');
assert.match(personalization, /function addCalendarDays\(dateKey, days\)/, 'Personalizace musí používat kalendářní aritmetiku pro sedmidenní okno.');
assert.match(personalization, /async function fetchPersonalProducts\(ids\)[\s\S]*const today = pragueDate\(\);[\s\S]*const upcomingTo = addCalendarDays\(today, 7\);/, 'Osobní produkty musí vytvořit čerstvé Prague +7 okno při každém načtení.');
assert.match(personalization, /function bestOffer\(productId, today = pragueDate\(\)\)/, 'Výběr osobní nabídky musí používat čerstvý pražský den.');
assert.match(personalization, /const eligible = rows\.filter\(\(row\) => !row\.valid_to \|\| String\(row\.valid_to\) >= today\);/, 'Personalizace musí po změně dne vyřadit i mezitím expirované nabídky z paměti.');
assert.doesNotMatch(personalization, /const today = new Date\(\)\.toISOString\(\)\.slice\(0, 10\)|Date\.now\(\) \+ 7 \* 86400000/, 'Personalizace nesmí používat top-level UTC den ani pevný 24hodinový +7 offset.');

assert.match(detail, /dataset\.loaded = '1'/, 'Detail neoznamuje dokončení renderu nabídek.');
assert.match(detail, /slevao:product-offers-rendered/, 'Detail nevysílá událost po načtení nabídek.');
assert.match(seo, /offersRoot\.dataset\.loaded !== '1'/, 'SEO nečeká na kompletní nabídky.');
assert.match(seo, /detailRoot\.dataset\.identityReady !== '1'/, 'SEO nečeká na rozhodnutí o přesnosti identity.');
assert.match(seo, /if \(exactIdentity && offerRows\.length\)/, 'AggregateOffer není omezen jen na přesnou identitu.');
assert.doesNotMatch(seo, /schema\.org\/InStock/, 'SEO nesmí tvrdit skladovou dostupnost, kterou neznáme.');

assert.doesNotMatch(detail, /\bprompt\s*\(/, 'Detail stále používá prompt() místo modalu.');
assert.match(detail, /sfDetailTargetPrice/, 'Detail nemá formulář cenového hlídače.');
assert.match(detail, /sfDetailReportType/, 'Detail nemá formulář nahlášení problému.');

for (const pattern of [
  /found\.selected_offer_id = offer\.id/,
  /found\.price = Number\(offer\.price/,
  /found\.store_id = offer\.store_id/,
  /found\.store_name = store\?\.name/,
  /found\.store_slug = store\?\.slug/,
]) assert.match(publicFeatures, pattern, `Nákupní seznam neaktualizuje vybranou nabídku: ${pattern}`);
assert.match(publicFeatures, /!offer\.product_id \|\| !detailProduct\?\.id/, 'Detail produktu nesmí otevřít neaktivní/nečitelný produkt.');

assert.match(safety, /typeof window\.SlevaoPublic\?\.addItemFromOffer !== 'function'/, 'Chybí ochrana tlačítka Přidat do seznamu.');
assert.match(safety, /data-product-retry/, 'Detail nemá možnost zopakovat neúspěšné načtení.');
assert.match(safety, /\.select\('id', \{ count:'exact', head:true \}\)/, 'Ochranná vrstva neověřuje, zda data skutečně existují.');
assert.match(safety, /image\.closest\('#productImage'\)/, 'Chybí fallback při chybě produktové fotografie.');
assert.match(safety, /timeZone:'Europe\/Prague'/, 'Ochranná vrstva nepoužívá české datum nabídek.');

assert.match(identityGuard, /ean \|\| \(product\?\.is_verified === true && brand && quantity\)/, 'Přesná identita není dostatečně konzervativní.');
assert.match(identityGuard, /apply\('comparable'\)/, 'Při chybě identity se musí zvolit bezpečnější srovnatelný režim.');
assert.match(identityGuard, /Srovnatelný produkt:/, 'Srovnatelný režim uživateli nevysvětluje omezení.');
assert.match(identityGuard, /slevao:product-identity-ready/, 'Identity guard nevysílá dokončovací událost.');
assert.match(identityCss, /\.sfIdentityNotice/, 'Srovnatelný režim nemá vlastní vizuální upozornění.');

assert.match(intelligence, /function bestOfferPerStore\(/, 'Slevao skóre nesjednocuje nabídky podle obchodního řetězce.');
assert.match(intelligence, /context\.storeCount >= 2/, 'Slevao skóre nevyžaduje dva různé obchody pro market signál.');
assert.match(intelligence, /if \(!context\.identityExact\)/, 'Slevao skóre neblokuje doporučení u nejisté identity.');
assert.match(intelligence, /BEZ DOPORUČENÍ/, 'Nejistá identita nemá bezpečný stav bez doporučení.');
assert.doesNotMatch(intelligence, /offers\.length >= 2/, 'Slevao skóre stále používá počet řádků nabídek místo počtu obchodů.');
assert.match(intelligence, /timeZone:'Europe\/Prague'/, 'Slevao skóre nepoužívá české datum pro platnost nabídek.');

assert.doesNotMatch(detail, /public_product_leaflet_locations|function matchingLeaflet\(/, 'Základní detail nesmí duplikovat méně přesné párování produktu na leták.');
assert.match(leaflet, /db\.from\('public_product_leaflet_locations'\)/, 'Exact leaflet vrstva musí zůstat jediným vlastníkem location cache.');
assert.match(leaflet, /function exactLocation\(/, 'Detail nemá přesné párování produktu na leták.');
assert.match(leaflet, /unique\.length === 1/, 'Leták se nesmí otevřít na nejednoznačné stránce.');
assert.match(leaflet, /validPdf\(row\.document_url\)/, 'Odkaz do letáku musí ověřovat PDF adresu.');

assert.match(premiumRuntime, /function ensureSearch\(/, 'Detail postrádá desktopové vyhledávání.');
assert.match(premiumRuntime, /function ensureBreadcrumbs\(/, 'Detail postrádá drobečkovou navigaci.');
assert.match(premiumRuntime, /sfPremiumBestOffer/, 'Detail postrádá CTA na nejlepší nabídku.');
assert.match(premiumRuntime, /sfHeroTrustChips/, 'Detail postrádá důvěryhodnostní prvky.');
assert.match(premiumRuntime, /sfOffersTitleIcon/, 'Sekce porovnání postrádá vizuální orientační prvek.');
assert.match(premiumRuntime, /navigator\.share/, 'Detail postrádá nativní sdílení produktu.');
assert.match(premiumRuntime, /navigator\.clipboard\?\.writeText/, 'Sdílení nemá fallback kopírování odkazu.');
assert.match(premiumRuntime, /\.sfOffer\.best/, 'CTA nejlepší nabídky necílí na skutečně nejlepší kartu.');

assert.match(equivalence, /\.gte\('confidence', \.99\)/, 'Ekvivalence musí vyžadovat jistotu alespoň 99 %.');
assert.match(equivalence, /row\.is_verified === true/, 'Ekvivalence musí vyžadovat ověřený produkt.');
assert.match(equivalence, /identityConsistent\(current, row\)/, 'Ekvivalence musí za běhu znovu ověřit identitu produktu.');
assert.match(equivalence, /currentBrand !== otherBrand/, 'Ekvivalence musí kontrolovat shodnou značku.');
assert.match(equivalence, /sameQuantity\(currentQuantity, otherQuantity\)/, 'Ekvivalence musí kontrolovat shodné balení.');
assert.match(equivalence, /sourceSection\.after\(section\)/, 'Ekvivalentní ceny musí zůstat v oddělené sekci.');
assert.doesNotMatch(equivalence, /price_history|price_alerts|product_favorites/, 'Ekvivalence nesmí míchat historii, hlídače ani oblíbené produkty.');
assert.match(equivalence, /function pragueDate\(value = new Date\(\)\)/, 'Ekvivalence musí odvozovat pražský business day dynamicky.');
assert.match(equivalence, /function addCalendarDays\(dateKey, days\)/, 'Ekvivalence musí používat kalendářní sedmidenní okno.');
assert.match(equivalence, /const today = pragueDate\(\);[\s\S]*const upcomingTo = addCalendarDays\(today, 7\);/, 'Ekvivalence musí vytvořit čerstvé datumové okno až při initu.');
assert.doesNotMatch(equivalence, /offsetDays\s*\*\s*86400000|const today = pragueDate\(\);\s*const upcomingTo = pragueDate\(7\);/, 'Ekvivalence nesmí používat 24hodinový offset ani top-level zmrazené datum.');
assert.match(equivalence, /const shared = window\.__slevaoProductPromise/, 'Ekvivalence musí znovu použít sdílený aktuální produkt.');
assert.match(equivalence, /const queryIds = current \? ids : \[productId, \.\.\.ids\]/, 'Ekvivalence má při sdíleném produktu dotazovat jen protější product IDs.');
assert.match(equivalenceCss, /\.sfEqPanel/, 'Ekvivalentní ceny nemají vlastní vzhled.');

const productAssets = [...html.matchAll(/(?:src|href)="assets\/([^"]+\?v=[^"]+)"/g)].map((match) => match[1]);
assert.ok(productAssets.length >= 10, 'produkt.html nemá očekávané verzované assety.');

assert.match(serviceWorker, /const CACHE_NAME = 'slevao-shell-[^']+'/, 'Service worker nemá verzovanou cache.');
for (const asset of productAssets) {
  assert.ok(
    serviceWorker.includes(`'/assets/${asset}'`),
    `PWA cache nemá stejnou verzi assetu jako produkt.html: ${asset}.`,
  );
}

const productPersonalizationVersion = html.match(/assets\/product-personalization\.js\?v=([0-9-]+)/)?.[1] || '';
const accountPersonalizationVersion = accountHtml.match(/assets\/product-personalization\.js\?v=([0-9-]+)/)?.[1] || '';
const dynamicPersonalizationVersion = publicNav.match(/assets\/product-personalization\.js\?v=([0-9-]+)/)?.[1] || '';
assert.ok(productPersonalizationVersion, 'Produkt nemá verzovaný personalizační runtime.');
assert.equal(accountPersonalizationVersion, productPersonalizationVersion, 'Účet musí načítat stejnou verzi personalizace jako produkt.');
assert.equal(dynamicPersonalizationVersion, productPersonalizationVersion, 'Dynamický public-nav loader musí načítat stejnou verzi personalizace jako produkt.');
assert.ok(serviceWorker.includes(`'/assets/product-personalization.js?v=${productPersonalizationVersion}'`), 'PWA musí cacheovat stejnou verzi personalizace jako produkt a účet.');

const productNavVersion = html.match(/assets\/public-nav-upgrade\.js\?v=([0-9-]+)/)?.[1] || '';
const accountNavVersion = accountHtml.match(/assets\/public-nav-upgrade\.js\?v=([0-9-]+)/)?.[1] || '';
assert.ok(productNavVersion, 'Produkt nemá verzovaný public-nav runtime.');
assert.equal(accountNavVersion, productNavVersion, 'Účet musí načítat stejnou verzi public-nav runtime jako produkt.');
assert.ok(serviceWorker.includes(`'/assets/public-nav-upgrade.js?v=${productNavVersion}'`), 'PWA musí cacheovat stejnou verzi public-nav runtime jako produkt a účet.');

console.log('Detail produktu: regresní diagnostika prošla.');