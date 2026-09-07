import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const legacy = readFileSync(new URL('../sw.js', import.meta.url), 'utf8').trim();
assert.equal(
  legacy,
  "// Legacy compatibility entrypoint for clients that previously registered /sw.js.\n// Keep one canonical implementation in /service-worker.js.\nimportScripts('/service-worker.js');",
  'Legacy /sw.js must remain a thin compatibility shim to the canonical service worker.'
);

console.log('Legacy service-worker compatibility shim OK.');
