import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const home = fs.readFileSync('assets/home-v2.js', 'utf8');
new vm.Script(home, { filename: 'assets/home-v2.js' });

assert.match(home, /requestVersion:0, suggestionsVersion:0, locationVersion:0, loading:false/, 'Homepage state must track location request versions separately.');
assert.match(home, /const version = \+\+state\.locationVersion;\s*const region = state\.region;/, 'Location facets must capture a request version and region before awaiting the RPC.');
assert.match(home, /if \(version !== state\.locationVersion \|\| state\.region !== region\) return false;/, 'Stale location responses must not mutate the current region state.');
assert.match(home, /console\.warn\('Města pro vybraný kraj se nepodařilo načíst:', error\);\s*state\.locationRows = \[\];\s*return true;/, 'A location-facets failure must degrade to an empty city list instead of blocking the region filter.');
assert.match(home, /const applied = await loadLocationRows\(\);\s*if \(!applied\) return;\s*renderCities\(\);\s*await refreshCurrent\(\);/, 'Region changes must ignore stale location loads and still refresh the feed after the current request settles.');
assert.ok((home.match(/state\.locationVersion \+= 1;/g) || []).length >= 2, 'Resetting or clearing region filters must invalidate any in-flight location request.');

assert.match(home, /Promise\.resolve\(facetsPromise \|\| fetchFacets\(\)\)\.catch\(\(error\) => \{\s*console\.warn\('Facety nabídek se nepodařilo načíst:', error\);\s*return state\.facets;\s*\}\)/, 'A facets failure must not discard a successfully loaded offer page.');
assert.match(home, /loadGlobalFacets\(\)\.catch\(\(error\) => \{\s*console\.warn\('Globální facety se nepodařilo načíst:', error\);\s*return state\.globalFacets;\s*\}\)/, 'Global facets must be non-fatal during homepage startup.');
assert.match(home, /if \(version !== state\.requestVersion\) return;/, 'Main offer responses must remain guarded against stale refreshes.');
assert.match(home, /if \(version !== state\.suggestionsVersion\) return;/, 'Search suggestions must remain guarded against stale responses.');

console.log('Homepage request race and graceful-degradation contract OK');
