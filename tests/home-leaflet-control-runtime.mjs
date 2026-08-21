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
  source.includes("document.addEventListener('visibilitychange'"),
  'Leaflet control must still refresh when the user returns to the page.'
);

console.log('Homepage leaflet control runtime guard OK');
