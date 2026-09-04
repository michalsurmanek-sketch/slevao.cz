import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('assets/home-filter-range-guard.js', root), 'utf8');
const migration = readFileSync(new URL('supabase/migrations/20260827080000_atomic_owner_shopping_list_offer_add.sql', root), 'utf8');
const customMigration = readFileSync(new URL('supabase/migrations/20260827081000_unique_custom_shopping_list_items.sql', root), 'utf8');
const recipeMigration = readFileSync(new URL('supabase/migrations/20260904133530_atomic_recipe_item_sync.sql', root), 'utf8');

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

const recipeRpc = section('  async function syncRecipeRow', '\n\n  async function syncPendingRecipeRows');
assert.match(recipeRpc, /db\.rpc\('sync_own_shopping_list_recipe_item'/, 'Recept musí používat samostatný atomický recipe RPC.');
assert.match(recipeRpc, /p_source_item_id:\s*row\?\.server_id \|\| null/, 'Atomický recipe RPC musí dostat původní cloudové ID při přejmenování.');
assert.match(recipeRpc, /p_custom_name:\s*name/, 'Recipe RPC musí dostat výsledný display název s receptovým množstvím.');
assert.match(recipeRpc, /p_recipe_ids:\s*recipeSources\(row\)/, 'Recipe RPC musí persistovat původ receptů kvůli idempotenci více zařízení.');
assert.match(recipeRpc, /sync\?\.status === 'conflict'[\s\S]*?synced:false, conflict:true/, 'Nejasný cloudový konflikt se musí vrátit fail-closed bez lokálního přepsání server_id.');
assert.match(recipeRpc, /alignRecipeRow\(row, remote\)/, 'Teprve potvrzený atomický výsledek smí přepsat lokální server_id.');

const recipeSync = section('  async function syncPendingRecipeRows()', '\n\n  function runOriginalRecipeAdd');
assert.match(recipeSync, /db\.auth\.getSession\(\)/, 'Synchronizace receptu musí ověřit aktuální session.');
assert.match(recipeSync, /row\?\.source === 'recipe'[\s\S]*?\(!row\?\.server_id \|\| row\?\.recipe_dirty\)/, 'Do recipe RPC mají jít nové nebo přejmenované receptové řádky.');
assert.match(recipeSync, /const result = await syncRecipeRow\(db, row\)/, 'Každý kandidát musí projít atomickým recipe RPC.');
assert.match(recipeSync, /if \(result\.conflict\)[\s\S]*?conflicts \+= 1;[\s\S]*?continue;/, 'Jeden nejasný konflikt nesmí zastavit synchronizaci ostatních surovin.');
assert.match(recipeSync, /if \(result\.synced\)[\s\S]*?synced \+= 1;[\s\S]*?api\.writeList\?\.\(rows\)/, 'Každý potvrzený recipe server_id se má průběžně uložit local-first.');
assert.doesNotMatch(recipeSync, /add_own_shopping_list_custom_item/, 'Recipe synchronizace se nesmí vrátit k obecnému RPC, které navyšuje quantity.');
assert.doesNotMatch(recipeSync, /db\.from\('shopping_list_items'\)[\s\S]*?\.update\(/, 'Recipe rename se nesmí dělat neatomickým přímým UPDATE z browseru.');

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
assert.match(recipeClick, /nejasných konfliktů ponecháno beze změny/, 'Fail-closed recipe konflikt musí být v uživatelském feedbacku transparentní.');
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
assert.match(migration, /create or replace function public\.increment_own_shopping_list_offer\(p_offer_id uuid\)[\s\S]*?security invoker/i, 'Atomický produktový RPC musí zůstat SECURITY INVOKER.');
assert.match(customMigration, /create unique index if not exists shopping_list_items_one_custom_name_per_list_uidx[\s\S]*?lower\(trim\(custom_name\)\)[\s\S]*?product_id is null/i, 'Vlastní položky musí mít unikátní normalizovaný název v rámci seznamu.');

assert.match(recipeMigration, /add column if not exists is_recipe boolean not null default false/i, 'Cloud musí explicitně uchovávat recipe provenance.');
assert.match(recipeMigration, /add column if not exists recipe_ids text\[\] not null default '\{\}'::text\[\]/i, 'Cloud musí uchovávat recipe_ids pro cross-device idempotenci.');
assert.match(recipeMigration, /create or replace function public\.sync_own_shopping_list_recipe_item/i, 'Musí existovat dedikovaný recipe sync RPC.');
assert.match(recipeMigration, /security invoker/i, 'Recipe RPC nesmí obcházet RLS.');
assert.match(recipeMigration, /v_user_id uuid := \(select auth\.uid\(\)\)/i, 'Recipe RPC musí vyžadovat aktuálního uživatele.');
assert.match(recipeMigration, /slevao-owner-shopping-list-custom:[\s\S]*?pg_advisory_xact_lock/i, 'Recipe RPC musí používat stejný per-item advisory lock namespace jako obecný custom zápis.');
assert.match(recipeMigration, /v_target_safe := v_target\.is_recipe[\s\S]*?v_target\.quantity = 1[\s\S]*?v_target\.custom_name ~\*/i, 'Legacy cílový řádek se smí deduplikovat jen při úzkém recipe-safe podpisu.');
assert.match(recipeMigration, /if not v_target_safe then[\s\S]*?'status', 'conflict'/i, 'Nejasný target musí failnout bez destruktivního sloučení.');
assert.match(recipeMigration, /if v_source_found and v_source\.id <> v_item\.id then[\s\S]*?delete from public\.shopping_list_items/i, 'Zdroj se smí smazat až po potvrzeném bezpečném cíli.');
assert.match(recipeMigration, /quantity = 1,[\s\S]*?unit = 'ks',[\s\S]*?is_recipe = true/i, 'Recipe RPC nesmí převést gramy ani opakované syncy na počet kusů seznamu.');
assert.match(recipeMigration, /revoke all on function public\.sync_own_shopping_list_recipe_item\(uuid, text, text\[\]\) from public, anon;/i, 'Recipe RPC nesmí být dostupný public ani anon.');
assert.match(recipeMigration, /grant execute on function public\.sync_own_shopping_list_recipe_item\(uuid, text, text\[\]\) to authenticated;/i, 'Recipe RPC musí být dostupný pouze authenticated.');

console.log('Homepage shopping-list atomic account + recipe sync OK');
