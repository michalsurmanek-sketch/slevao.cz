import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../assets/footer-section-jumps.js', import.meta.url), 'utf8');
const quickFoodRuntime = readFileSync(new URL('../assets/home-quick-food-personalize.js', import.meta.url), 'utf8');

assert.match(
  index,
  /<a class="footerFavoriteStore" href="kaufland\.html" aria-label="Kaufland"><span class="footerStoreKBox">K<\/span><span class="footerStoreWord footerStoreKaufland">Kaufland<\/span><\/a>/,
  'Homepage musí zachovat přístupný Kaufland odkaz a současnou dvoudílnou wordmark strukturu.',
);

assert.match(
  runtime,
  /function fixKauflandWordmark\(\)/,
  'Footer runtime musí obsahovat izolovanou opravu Kaufland wordmarku.',
);
assert.match(
  runtime,
  /\.footerFavoriteStore\[aria-label="Kaufland"\]/,
  'Oprava musí cílit jen na odkaz Kaufland v oblíbených obchodech.',
);
assert.match(
  runtime,
  /word\.textContent\.trim\(\)\.toLocaleLowerCase\('cs-CZ'\) !== 'kaufland'/,
  'Oprava se smí spustit jen na starém textu Kaufland; staticky opravené HTML nesmí poškodit.',
);
assert.match(
  runtime,
  /word\.textContent = 'aufland';/,
  'Po samostatném K boxu musí viditelná textová část znít aufland, ne Kaufland.',
);

assert.match(
  index,
  /<a href="ochrana-soukromi\.html">Ochrana soukromi<\/a>/,
  'Guard musí odpovídat současnému legacy textu odkazu na ochranu soukromí.',
);
assert.match(
  runtime,
  /function fixPrivacyLinkCopy\(\)/,
  'Footer runtime musí obsahovat izolovanou opravu textu odkazu na ochranu soukromí.',
);
assert.match(
  runtime,
  /\.footerLinks a\[href="ochrana-soukromi\.html"\]/,
  'Oprava musí cílit pouze na existující privacy odkaz a nesmí měnit jeho URL.',
);
assert.match(
  runtime,
  /link\.textContent\.trim\(\) !== 'Ochrana soukromi'/,
  'Oprava se smí spustit jen na starém textu bez diakritiky.',
);
assert.match(
  runtime,
  /link\.textContent = 'Ochrana soukromí';/,
  'Viditelný text privacy odkazu musí být správně česky s diakritikou.',
);

assert.match(
  index,
  /<input id="q" type="search"/,
  'Homepage musí zachovat hlavní vyhledávací pole #q jako cíl footer navigace.',
);
assert.match(
  runtime,
  /\{ href:'#q', label:'Hledej', icon:/,
  'Footer zkratka Hledej musí mířit přímo na hlavní vyhledávač.',
);
assert.doesNotMatch(
  runtime,
  /\{ href:'#dealsSection', label:'Hledej', icon:/,
  'Footer zkratka Hledej nesmí posílat uživatele do sekce aktuálních nabídek.',
);

assert.match(
  runtime,
  /\{ href:'#dealsSection', label:'Nabídky', icon:/,
  'Footer odkaz na dealsSection musí být označený jako Nabídky.',
);
assert.doesNotMatch(
  runtime,
  /label:'Slevové kódy'/,
  'Footer nesmí slibovat slevové kódy, když cílí jen na běžné aktuální nabídky.',
);

assert.match(
  quickFoodRuntime,
  /dock = document\.querySelector\('\.sqFoodDock'\)/,
  'Rychlý nákup musí být navázaný na komponentu .sqFoodDock.',
);
assert.match(
  quickFoodRuntime,
  /<strong>Rychlý nákup<\/strong>/,
  'Komponenta .sqFoodDock musí být skutečně prezentovaná jako Rychlý nákup.',
);
assert.match(
  runtime,
  /\{ href:'#quickFoodDock', fallback:'\.sqFoodDock', label:'Rychlý nákup', icon:/,
  'Footer musí posílat Rychlý nákup na skutečný quick-food dock, ne na filtrační záložky.',
);
assert.doesNotMatch(
  runtime,
  /\{ href:'#quickTabs',[^\n]*label:'Nákupní seznam'/,
  'Footer nesmí vydávat filtrační #quickTabs za nákupní seznam.',
);
assert.match(
  runtime,
  /\{ href:'seznam\.html', label:'Seznam', icon:/,
  'Samostatný odkaz Seznam musí dál vést na skutečnou stránku nákupního seznamu.',
);

console.log('Homepage footer copy + navigation guard prošel.');
