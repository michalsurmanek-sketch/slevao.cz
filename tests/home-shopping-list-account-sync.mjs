import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/home-filter-range-guard.js', root), 'utf8');
const migration = readFileSync(new URL('supabase/migrations/20260827080000_atomic_owner_shopping_list_offer_add.sql', root), 'utf8');
const customMigration = readFileSync(new URL('supabase/migrations/20260827081000_unique_custom_shopping_list_items.sql', root), 'utf8');

new Script(source, { filename:'assets/home-filter-range-guard.js' });

function section(start, end) {
  const from = source.indexOf(start);
  assert.ok(from >= 0, `Chybí sekce ${start}`);
  const to = end ? source.indexOf(end, from + start.length) : source.length;
  assert.ok(to > from, `Chybí konec sekce ${end}`);
  return source.slice(from, to);
}

const priceGuard = section("  if (minPrice && maxPrice) {", '\n\n  async function publicApi');
assert.match(priceGuard, /min > preset[\s\S]*?minPrice\.value = ''[\s\S]*?dispatchEvent\(new Event\('input'/, 'Původní ochrana cenového rozsahu musí zůstat zachovaná.');

const localAlign = section('  function alignLocalRow', '\n\n  const normalizeRecipeName');
assert.match(localAlign, /active\.server_id = remoteRow\?\.id/, 'Lokální řádek musí převzít server_id potvrzené serverem.');
assert.match(localAlign, /active\.quantity = Math\.max\(0\.01, Number\(remoteRow\?\.quantity/, 'Lokální množství musí převzít potvrzenou serverovou hodnotu.');
assert.match(localAlign, /rows\.filter\(\(row\) => row === active \|\| row\?\.key !== key\)/, 'Lokální duplicitní řádky stejného produktu musí být po synchronizaci sloučené.');

const recipeSync = section('  async function syncPendingRecipeRows()', '\n\n  function runOriginalRecipeAdd');
assert.match(recipeSync, /db\.auth\.getSession\(\)/, 'Synchronizace receptu musí ověřit aktuální session.');
assert.match(recipeSync, /row\?\.source === 'recipe'[\s\S]*?!row\?\.server_id/, 'Do cloudu se mají doplňovat pouze dosud nesynchronizované receptové řádky.');
assert.match(recipeSync, /findOwnerList\(db, session\.user\.id\)/, 'Recept musí hledat pouze aktivní seznam přihlášeného vlastníka.');
assert.match(recipeSync, /loadRemoteRecipeMap\(db, listId\)/, 'Před zápisem receptu se musí načíst už existující cloudové vlastní položky.');
const recipeRemoteLookup = recipeSync.indexOf('let remote = remoteMap.get(key) || null;');
const recipeRpc = recipeSync.indexOf("db.rpc('add_own_shopping_list_custom_item'");
assert.ok(recipeRemoteLookup >= 0 && recipeRpc > recipeRemoteLookup, 'Existující cloudová surovina se musí znovu použít před jakýmkoli RPC přidáním.');
assert.match(recipeSync, /p_custom_name: name,[\s\S]*?p_quantity: 1,[\s\S]*?p_unit: 'ks',[\s\S]*?p_mutation_id: createMutationId\(\)/, 'Recept nesmí poslat gramy nebo mililitry jako počet kusů a každý nový zápis musí mít idempotentní mutation ID.');
assert.match(recipeSync, /alignRecipeRow\(row, remote\);/, 'Lokální receptový řádek musí převzít potvrzené serverové ID.');
assert.match(recipeSync, /api\.writeList\?\.\(rows\);/, 'Po synchronizaci receptu se musí server_id uložit do lokálního seznamu.');

const recipeClick = section(
  "  document.addEventListener('click', (event) => {\n    if (recipeBypass) return;",
  "\n\n  document.addEventListener('click', (event) => {\n    const button = event.target.closest('[data-sf-add]');"
);
assert.match(recipeClick, /closest\?\.\('#recipesSection \[data-recipe\]'\)/, 'Guard musí zachytit tlačítka receptů na homepage.');
assert.match(recipeClick, /event\.preventDefault\(\);[\s\S]*?event\.stopImmediatePropagation\(\);/, 'Recipe guard musí zastavit původní událost, aby nevznikl dvojitý lokální zápis.');
const localRecipeAdd = recipeClick.indexOf('runOriginalRecipeAdd(button);');
const cloudRecipeSync = recipeClick.indexOf('syncPendingRecipeRows()');
assert.ok(localRecipeAdd >= 0 && cloudRecipeSync > localRecipeAdd, 'Recept musí zůstat local-first a cloudová synchronizace má následovat až po lokálním přidání.');
assert.match(recipeClick, /recipeQueue = recipeQueue[\s\S]*?\.then\(\(\) => syncPendingRecipeRows\(\)\)/, 'Více rychlých receptových změn musí být serializováno.');
assert.match(recipeClick, /button\.disabled = true[\s\S]*?finally\(\(\) => \{[\s\S]*?button\.disabled = false/, 'Recipe tlačítko musí být během synchronizace blokované a po dokončení znovu povolené.');
assert.match(recipeClick, /Synchronizace účtu se dokončí po otevření seznamu/, 'Při výpadku cloudu musí uživatel dostat jasný local-first fallback bez ztráty receptu.');

const add = section('  async function addFromHomepage', "\n\n  document.addEventListener('click', (event) => {\n    if (recipeBypass) return;");
assert.match(add, /db\.auth\.getSession\(\)/, 'Přidání musí zjistit aktuální session.');
assert.match(add, /if \(!session\?\.user\?\.id\)[\s\S]*?api\.addItemFromOffer\(offer\)/, 'Host musí dál fungovat lokálně bez účtu.');
assert.match(add, /db\.rpc\('increment_own_shopping_list_offer', \{[\s\S]*?p_offer_id: offerId[\s\S]*?\}\)/, 'Přihlášený uživatel musí použít atomický serverový RPC increment.');
assert.match(add, /const remoteRow = sync\?\.item \|\| null;/, 'Frontend musí převzít serverem potvrzenou položku z RPC odpovědi.');
assert.match(add, /if \(!remoteRow\?\.id\)[\s\S]*?throw new Error/, 'Bez potvrzeného serverového ID se lokální seznam nesmí tvářit jako synchronizovaný.');
assert.doesNotMatch(add, /db\.from\('shopping_list_items'\)/, 'Homepage nesmí vrátit neatomický SELECT/UPDATE/INSERT zápis položky.');
const remoteWrite = add.indexOf("db.rpc('increment_own_shopping_list_offer'");
const localWrite = add.indexOf('alignLocalRow(api, offer, remoteRow)');
assert.ok(remoteWrite >= 0 && localWrite > remoteWrite, 'Přihlášený uživatel musí nejdřív potvrdit serverový zápis a teprve potom změnit lokální seznam.');

const click = section("  document.addEventListener('click', (event) => {\n    const button = event.target.closest('[data-sf-add]');", '\n\n  window.__slevaoPriceRangeGuard');
assert.match(click, /event\.target\.closest\('\[data-sf-add\]'\)/, 'Guard musí zachytit tlačítka Přidat do seznamu.');
assert.match(click, /event\.preventDefault\(\);[\s\S]*?event\.stopImmediatePropagation\(\);/, 'Guard musí zabránit původnímu local-only handleru v dvojitém přidání.');
assert.match(click, /addQueue = addQueue[\s\S]*?\.then\(\(\) => addFromHomepage\(button\)\)/, 'Kliknutí musí být serializováno, aby rychlé opakované přidání neztratilo přírůstek.');
assert.match(click, /button\.disabled = true[\s\S]*?finally\(\(\) => \{[\s\S]*?button\.disabled = false/, 'Tlačítko musí být během zápisu blokované a po dokončení znovu povolené.');

assert.match(source, /window\.__slevaoAccountShoppingListAddGuard = true;/, 'Runtime guard musí vystavit diagnostický příznak.');
assert.match(source, /window\.__slevaoRecipeAccountShoppingListSync = true;/, 'Recipe account-sync runtime musí vystavit diagnostický příznak.');

assert.match(migration, /create unique index if not exists shopping_lists_one_active_per_user_uidx[\s\S]*?on public\.shopping_lists\(user_id\)[\s\S]*?where is_archived = false;/i, 'DB musí garantovat nejvýše jeden aktivní seznam na uživatele.');
assert.match(migration, /create unique index if not exists shopping_list_items_one_product_per_list_uidx[\s\S]*?shopping_list_id, product_id[\s\S]*?where product_id is not null;/i, 'DB musí garantovat nejvýše jednu produktovou položku na seznam.');
assert.match(migration, /create or replace function public\.increment_own_shopping_list_offer\(p_offer_id uuid\)[\s\S]*?security invoker/i, 'Atomický RPC musí zůstat SECURITY INVOKER.');
assert.match(migration, /v_user_id uuid := auth\.uid\(\);[\s\S]*?if v_user_id is null then/i, 'RPC musí vyžadovat přihlášeného uživatele.');
assert.match(migration, /on conflict \(user_id\) where is_archived = false do nothing/i, 'Vytvoření aktivního seznamu musí být bezpečné při souběhu.');
assert.match(migration, /on conflict \(shopping_list_id, product_id\) where product_id is not null[\s\S]*?quantity = case[\s\S]*?shopping_list_items\.quantity \+ 1/i, 'Produktový +1 musí být proveden atomicky uvnitř databáze.');
assert.match(migration, /revoke all on function public\.increment_own_shopping_list_offer\(uuid\) from public, anon;/i, 'RPC nesmí být dostupný rolím public ani anon.');
assert.match(migration, /grant execute on function public\.increment_own_shopping_list_offer\(uuid\) to authenticated;/i, 'RPC musí být explicitně dostupný pouze authenticated.');
assert.match(customMigration, /create unique index if not exists shopping_list_items_one_custom_name_per_list_uidx[\s\S]*?lower\(trim\(custom_name\)\)[\s\S]*?product_id is null/i, 'Vlastní položky musí mít unikátní normalizovaný název v rámci seznamu.');

console.log('Homepage shopping-list atomic account sync OK');
