import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/shopping-list.js', root), 'utf8');
new Script(source, { filename:'assets/shopping-list.js' });

assert.match(source, /let customOfferMap = new Map\(\);/, 'Autopilot nemá úložiště kandidátů pro vlastní položky.');
assert.match(source, /get_public_shopping_list_candidates/, 'Autopilot nepoužívá serverový resolver vlastních položek.');
assert.match(source, /p_limit_per_query:\s*30/, 'Resolver vlastních položek nemá omezený počet kandidátů.');
assert.match(source, /function offersForItem\(/, 'Optimalizátor neumí pracovat s nabídkami vlastních položek.');
assert.match(source, /customOfferMap\.get\(norm\(item\.custom_name \|\| item\.name\)\)/, 'Vlastní položky nejsou mapovány přes normalizovaný název.');
assert.match(source, /const allItems = rows\.filter\(\(row\) => !row\.completed\);/, 'Optimalizátor stále vybírá jen položky s product_id.');
assert.match(source, /const unresolved = allItems\.filter\(\(item\) => !offersForItem\(item(?:,\s*null,\s*today)?\)\.length\);/, 'Nenalezené vlastní položky nejsou explicitně oddělené.');
assert.match(source, /await fetchOffers\(\);\n\s*} catch \(error\)/, 'Po přidání vlastní položky se ceny nepřepočítají.');
assert.doesNotMatch(source, /vlastních položek nemá produktové propojení a není započítáno do cen/, 'Staré ignorování vlastních položek zůstalo v UI.');

console.log('Autopilot custom item resolver OK');
