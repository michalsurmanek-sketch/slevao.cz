import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('assets/home-leaflet-control.js', 'utf8');

assert(
  source.includes('if (loading) return loading;'),
  'Leaflet control refreshes must share one in-flight settings request.'
);
assert(
  !source.includes('if (loading && !force) return loading;'),
  'Force refresh must not bypass in-flight request deduplication.'
);
assert(
  source.includes('if (document.hidden) return;\n      refresh(true);'),
  'Periodic leaflet-control refresh must pause while the page is hidden.'
);
assert(
  source.includes("const SETTINGS_REFRESH_MS = 5 * 60 * 1000;"),
  'Leaflet control must define a single five-minute settings freshness window.'
);
assert(
  source.includes('lastSettingsRefreshAt = Date.now();'),
  'Successful settings loads must record their freshness timestamp.'
);
assert(
  source.includes("document.addEventListener('visibilitychange'"),
  'Leaflet control must still react when the user returns to the page.'
);
assert(
  source.includes('if (Date.now() - lastSettingsRefreshAt >= SETTINGS_REFRESH_MS) refresh(true);'),
  'Returning to a fresh tab must not force another store settings request.'
);
assert(
  source.includes('}, SETTINGS_REFRESH_MS);'),
  'Periodic leaflet settings refresh must use the shared freshness constant.'
);

console.log('Homepage leaflet control runtime guard OK');
