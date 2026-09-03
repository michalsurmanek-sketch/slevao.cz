import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const edge = read('supabase/functions/sync-globus-products/index.ts');
const config = read('supabase/functions/sync-globus-products/config.toml');
const floor = read('supabase/migrations/20260827115000_filter_globus_below_price_floor.sql');
const sourceBinding = read('supabase/migrations/20260827115500_bind_globus_structured_source.sql');

assert.match(config, /verify_jwt\s*=\s*false/, 'Globus Edge používá vlastní cron/service autentizaci a gateway režim musí být explicitní.');
assert.match(edge, /function errorText\(/, 'Globus nesmí zahodit PostgREST chybu na [object Object].');
assert.match(edge, /\[\s*([A-Za-z_$][\w$]*)\.message\s*,\s*\1\.details\s*,\s*\1\.hint\s*,\s*\1\.code\s*\]/, 'Globus diagnostika musí zachovat message/details/hint/code bez závislosti na názvu lokální proměnné.');
assert.match(edge, /API_PAGE_TIMEOUT_MS\s*=\s*12_?000\b/, 'Každá stránka Globus API musí mít omezený timeout 12 000 ms.');
assert.match(edge, /new AbortController\(\)/, 'Globus API fetch musí být přerušitelný.');
assert.match(edge, /attempt\s*<=\s*2/, 'Globus API retry musí být omezený.');
assert.match(edge, /markHealth\('degraded'/, 'Ostré selhání musí zapsat degraded health.');

assert.match(floor, /\(source\.item ->> 'price'\)::numeric >= 2/, 'Globus wrapper musí vynechat nabídky pod globálním 2 Kč limitem.');
assert.match(floor, /v_filtered_count < 300/, 'Cenový filtr nesmí obejít minimální completeness guard.');
assert.match(floor, /skipped_below_price_floor/, 'Výsledek musí přiznat počet vynechaných sub-2 Kč položek.');
assert.doesNotMatch(floor, /drop\s+constraint\s+offers_published_min_price_check/i, 'Globus nesmí oslabit globální public price floor.');

assert.match(sourceBinding, /source_url = p_source_document_url/, 'Globus musí vybrat přesný aktivní API source podle předané URL.');
assert.match(sourceBinding, /v_expected_source_id is null/, 'Chybějící API source musí fail-closed.');
assert.match(sourceBinding, /last_success_at = clock_timestamp\(\)/, 'Přesný API source musí být v transakci preferován před generickou heuristikou.');
assert.match(sourceBinding, /v_source_id is distinct from v_expected_source_id/, 'Po publish se musí ověřit, že import skutečně použil očekávaný source ID.');
assert.match(sourceBinding, /raise exception 'Globus publisher used unexpected source/, 'Nesprávný source musí rollbacknout celý batch.');
assert.match(sourceBinding, /revoke all[\s\S]*from public, anon, authenticated/, 'Globus publisher nesmí být veřejně spustitelný.');
assert.match(sourceBinding, /grant execute[\s\S]*to service_role/, 'Globus publisher má zůstat service-only.');

console.log('Globus structured publish guards OK');
