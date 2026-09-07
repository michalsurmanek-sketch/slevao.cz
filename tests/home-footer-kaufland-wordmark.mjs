import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../assets/footer-section-jumps.js', import.meta.url), 'utf8');

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

console.log('Kaufland footer wordmark guard prošel.');
