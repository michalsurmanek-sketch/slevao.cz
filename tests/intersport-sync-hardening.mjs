import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const source = read('supabase/functions/sync-intersport-products/index.ts');
const config = read('supabase/functions/sync-intersport-products/config.toml');

assert.match(config, /verify_jwt\s*=\s*false/, 'Intersport používá vlastní fail-closed autentizaci, proto musí být gateway JWT režim explicitní.');
assert.match(source, /x-cron-secret/, 'Intersport sync musí podporovat interní cron secret.');
assert.match(source, /app_metadata\?\.role/, 'Ruční spuštění musí autorizovat jen privilegované role z app_metadata.');
assert.match(source, /SOURCE_TIMEOUT_MS\s*=\s*12_000/, 'Načtení Intersport zdroje musí mít omezený timeout.');
assert.match(source, /new AbortController\(\)/, 'Zdrojový fetch musí být skutečně přerušitelný.');
assert.match(source, /attempt\s*<=\s*2/, 'Zdrojový fetch musí mít omezený retry, ne nekonečné opakování.');
assert.match(source, /Chrome\/150\.0\.0\.0/, 'Intersport musí používat realistické browser hlavičky.');
assert.match(source, /function errorText\(/, 'Strukturované Supabase chyby se nesmí ztratit na [object Object].');
assert.match(source, /value\.message, value\.details, value\.hint, value\.code/, 'Diagnostika musí zachovat PostgREST message/details/hint/code.');
assert.match(source, /timeZone:\s*'Europe\/Prague'/, 'Platnost nabídek musí používat pražský obchodní den.');
assert.match(source, /\.eq\('store_id', store\.id\)[\s\S]*\.eq\('source_url', SOURCE\)/, 'Sync musí upravovat přesný Intersport zdroj, ne náhodný první zdroj obchodu.');
assert.match(source, /minimum_offer_count:\s*5/, 'Health kontrakt musí odpovídat minimálně pěti bezpečným produktům parseru.');
assert.match(source, /markHealth\('ok'/, 'Úspěšný publish musí explicitně obnovit health stav.');
assert.match(source, /markHealth\('degraded'/, 'Selhání musí explicitně degradovat health stav.');
assert.match(source, /unique\.length < 5 \|\| unique\.length > 10/, 'Parser musí fail-closed při podezřelém počtu nabídek.');
assert.match(source, /oldPrice <= price/, 'Publikovat se smí jen skutečná sleva s vyšší původní cenou.');

console.log('Intersport sync hardening contract OK');
