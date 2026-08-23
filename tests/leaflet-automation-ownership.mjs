import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('supabase/functions/run-leaflet-pipeline-v2/index.ts', 'utf8');

assert(source.includes("function automationMode(source:any)"), 'Pipeline must normalize automation_mode from the database.');
assert(source.includes("automationMode(source)==='specialized'"), 'Specialized routing must be driven by automation_mode.');
assert(source.includes("automationMode(source)==='automatic'"), 'Generic routing must be driven by automation_mode.');
assert(source.includes("Specializovaný zdroj nemá runtime adapter."), 'Specialized sources without an adapter must fail closed.');
assert(source.includes("Aktivní pipeline zdroj má nepodporovaný automation_mode."), 'Unexpected active automation modes must fail closed.');

const specializedMap = source.match(/const SPECIALIZED:Record<string,string>=\{([^}]*)\};/)?.[1] || '';
assert(!/tesco\s*:/.test(specializedMap), 'Tesco has a dedicated scheduler and must not be routed through central specialized pipeline.');
assert(/benu\s*:\s*'sync-benu-source'/.test(specializedMap), 'BENU must remain on its specialized source adapter.');
assert(/bauhaus\s*:\s*'sync-bauhaus-source'/.test(specializedMap), 'BAUHAUS must remain on its specialized source adapter.');
assert(/action\s*:\s*'sync-action-source'/.test(specializedMap), 'Action must remain on its specialized source adapter.');

console.log('Leaflet automation ownership contract OK');
