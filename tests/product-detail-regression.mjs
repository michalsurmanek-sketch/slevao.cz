import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

const detail = read('assets/product-detail.js');
const publicFeatures = read('assets/public-features.js');
const seo = read('assets/product-seo.js');
const intelligence = read('assets/product-intelligence.js');
const leaflet = read('assets/product-leaflet-location-global.js');
const html = read('produkt.html');

for (const [path, source] of [
  ['assets/product-detail.js', detail],
  ['assets/public-features.js', publicFeatures],
  ['assets/product-seo.js', seo],
  ['assets/product-intelligence.js', intelligence],
  ['assets/product-leaflet-location-global.js', leaflet],
]) {
  new Script(source, { filename:path });
}

// Detail nesmí zaměňovat formáty jedné sítě za různé obchody.
assert.match(detail, /function offerStoreKey\(offer\)\s*\{\s*return String\(offer\?\.store_id/, 'Počet obchodů musí vycházet pouze ze store_id.');
assert.match(detail, /new Set\(visible\.map\(offerStoreKey\)\.filter\(Boolean\)\)/, 'Statistika obchodů nepoužívá unikátní řetězce.');

// Duplicity stejné nabídky nesmí vytvářet dvě karty.
assert.match(detail, /function dedupeOffers\(/, 'Detail nemá deduplikaci nabídek.');
assert.match(detail, /const visible = dedupeOffers\(offers\)/, 'Render nepoužívá deduplikované nabídky.');

// Dnešní a nadcházející cena musí být popsané konzistentně.
assert.match(detail, /nejnižší cena dnes/, 'Detail neoznačuje dnešní minimum jednoznačně.');
assert.match(detail, /nejnižší nadcházející cena/, 'Detail neoznačuje nadcházející minimum jednoznačně.');
assert.match(detail, /const current = visible\.filter\(\(row\) => !isUpcoming\(row\)\)/, 'Hlavní cena musí preferovat aktuálně platné nabídky.');

// SEO se smí sestavit až po dokončení nabídek.
assert.match(detail, /dataset\.loaded = '1'/, 'Detail neoznamuje dokončení renderu nabídek.');
assert.match(detail, /slevao:product-offers-rendered/, 'Detail nevysílá událost po načtení nabídek.');
assert.match(seo, /offersRoot\.dataset\.loaded !== '1'/, 'SEO nečeká na kompletní nabídky.');
assert.doesNotMatch(seo, /schema\.org\/InStock/, 'SEO nesmí tvrdit skladovou dostupnost, kterou neznáme.');

// Hlídaní ceny a hlášení problému nesmí používat blokující prompt dialogy.
assert.doesNotMatch(detail, /\bprompt\s*\(/, 'Detail stále používá prompt() místo modalu.');
assert.match(detail, /sfDetailTargetPrice/, 'Detail nemá formulář cenového hlídače.');
assert.match(detail, /sfDetailReportType/, 'Detail nemá formulář nahlášení problému.');

// Při opakovaném přidání produktu se musí respektovat nabídka, na kterou uživatel klikl.
for (const pattern of [
  /found\.selected_offer_id = offer\.id/,
  /found\.price = Number\(offer\.price/,
  /found\.store_id = offer\.store_id/,
  /found\.store_name = store\?\.name/,
  /found\.store_slug = store\?\.slug/,
]) assert.match(publicFeatures, pattern, `Nákupní seznam neaktualizuje vybranou nabídku: ${pattern}`);
assert.match(publicFeatures, /!offer\.product_id \|\| !detailProduct\?\.id/, 'Detail produktu nesmí otevřít neaktivní/nečitelný produkt.');

// Slevao skóre smí považovat za nezávislé srovnání jen různé obchodní řetězce.
assert.match(intelligence, /function bestOfferPerStore\(/, 'Slevao skóre nesjednocuje nabídky podle obchodního řetězce.');
assert.match(intelligence, /context\.storeCount >= 2/, 'Slevao skóre nevyžaduje dva různé obchody pro market signál.');
assert.match(intelligence, /porovnáno \$\{context\.storeCount\} obchodů/, 'Slevao skóre nekomunikuje počet skutečných obchodů.');
assert.doesNotMatch(intelligence, /offers\.length >= 2/, 'Slevao skóre stále používá počet řádků nabídek místo počtu obchodů.');
assert.match(intelligence, /timeZone:'Europe\/Prague'/, 'Slevao skóre nepoužívá české datum pro platnost nabídek.');

// Přesný odkaz do letáku musí být konzervativní.
assert.match(leaflet, /function exactLocation\(/, 'Detail nemá přesné párování produktu na leták.');
assert.match(leaflet, /unique\.length === 1/, 'Leták se nesmí otevřít na nejednoznačné stránce.');
assert.match(leaflet, /validPdf\(row\.document_url\)/, 'Odkaz do letáku musí ověřovat PDF adresu.');

// Produkční HTML musí načítat opravené verze bez staré cache.
for (const pattern of [
  /public-features\.js\?v=20260811-3/,
  /product-detail\.js\?v=20260811-7/,
  /product-seo\.js\?v=20260811-2/,
  /product-intelligence\.js\?v=20260811-2/,
]) assert.match(html, pattern, `produkt.html nemá očekávanou verzi assetu ${pattern}.`);

console.log('Detail produktu: regresní diagnostika prošla.');
