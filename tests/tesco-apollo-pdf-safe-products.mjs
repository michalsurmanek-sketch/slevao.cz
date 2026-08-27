import assert from 'node:assert/strict';
import fs from 'node:fs';

const sync = fs.readFileSync('supabase/functions/sync-tesco-apollo-products/index.ts', 'utf8');
const probe = fs.readFileSync('supabase/functions/probe-tesco-layout-v14/index.ts', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260823095208_schedule_safe_tesco_apollo_product_sync.sql', 'utf8');

assert(sync.includes("const ADAPTER = 'tesco-apollo-pdf-v16-semantic-public';"), 'Tesco semantic-only adapter revision must stay explicit');
assert(sync.includes('const dryRun = body.dry_run !== false;'), 'Tesco sync must default to dry-run');
assert(sync.includes('start_page: 1'), 'Tesco sync must start parsing at the first leaflet page');
assert(sync.includes('probe_pages: leaflet.pageCount'), 'Tesco sync must parse every current leaflet page');
assert(sync.includes('viewer_url: leaflet.viewer'), 'Tesco parser must be pinned to the viewer snapshot selected by the publisher');
assert(sync.includes('expected_pdf_url: leaflet.pdfUrl'), 'Tesco parser must be pinned to the exact official PDF selected by the publisher');
assert(sync.includes("if (before.fingerprint !== after.fingerprint)"), 'Tesco sync must reject leaflet rollover races');
assert(sync.includes('(semantic >= 2 && layout <= 190)'), 'Tesco sync must require strong multi-word semantic evidence');
assert(sync.includes('(semantic === 1 && layout <= 175)'), 'Tesco sync may accept one-word evidence only inside the parser token-distance bound');
assert(!sync.includes('|| (mathUnique && spatial <= 150)'), 'Tesco sync must never publish a math-only product-price association');
assert(sync.includes("if (rows.length < 20 || rows.length > 50)"), 'Tesco sync must fail closed outside the semantic snapshot range');
assert(sync.includes("const externalId = `tesco-apollo:${stableHash}`;"), 'Tesco product identity must be stable across leaflet IDs');
assert(!sync.includes('tesco-leaflet:${lp.id}'), 'Weekly LeafletProduct ids must not own product identity');
assert(sync.includes("price_kind: 'public'"), 'Tesco v16 must publish public prices only');
assert(sync.includes("p_min_products: 20"), 'Publisher minimum must match safe snapshot contract');
assert(sync.includes("p_max_products: 50"), 'Publisher maximum must match safe snapshot contract');

assert(probe.includes("adapter:'tesco-layout-v14-semantic-math'"), 'Tesco probe revision must stay explicit');
assert(probe.includes("main=products.find((z:any)=>z.isMainProduct===true)"), 'Probe must choose one main product per hotspot');
assert(probe.includes('function layoutScore(c:C,q:T)'), 'Probe must use directional token layout evidence');
assert(probe.includes('function mathEvidence(h:any,c:C)'), 'Probe may use quantity/unit-price math as supporting evidence');
assert(probe.includes('unique:count===1'), 'Math supporting evidence must be unique on the page');
assert(probe.includes('function hungarian(a:number[][])'), 'Probe must use one-to-one page assignment');
assert(probe.includes("x.assigned&&x.candidate.kind==='public'"), 'Probe must not emit Clubcard candidates as public rows');

assert(migration.includes("'slevao-sync-tesco-safe-products'"), 'Tesco product cron must have one canonical name');
assert(migration.includes("'17 */3 * * *'"), 'Tesco product sync must run every three hours');
assert(migration.includes("'{\"dry_run\":false}'::jsonb"), 'Cron must explicitly opt into publishing');

console.log('Tesco Apollo/PDF semantic-only product pipeline contract OK');
