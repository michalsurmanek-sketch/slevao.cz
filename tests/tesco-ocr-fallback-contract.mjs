import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('supabase/functions/sync-tesco-ocr-source/index.ts', 'utf8');
const worker = fs.readFileSync('scripts/sync_tesco_ocr.py', 'utf8');
const workflow = fs.readFileSync('.github/workflows/sync-tesco-ocr.yml', 'utf8');

assert(source.includes("const ADAPTER = 'tesco-apollo-page-images-v1';"), 'Tesco OCR source must use the canonical Apollo page-image adapter.');
assert(source.includes('const EXPECTED_PAGES = 32;'), 'Tesco HM OCR source must stay locked to the verified 32-page contract.');
assert(source.includes(".eq('metadata->>adapter', ADAPTER)"), 'Tesco source must look for an existing canonical DB import first.');
assert(source.includes(".lte('detected_valid_from', d)"), 'Tesco DB reuse must already be valid on the Prague business date.');
assert(source.includes(".gte('detected_valid_to', d)"), 'Tesco DB reuse must still be valid on the Prague business date.');
assert(source.includes("reuse_mode: 'current-db-canonical'"), 'Tesco source must expose the DB reuse path.');
assert(source.indexOf("reuse_mode: 'current-db-canonical'") < source.indexOf('const viewer = await currentViewer()'), 'Tesco must reuse the current verified DB source before touching the upstream landing page.');
assert(source.includes("row.status !== 'review'"), 'Canonical OCR source must remain an internal review import.');
assert(source.includes("u.hostname === 'digitalcontent.api.tesco.com'"), 'Tesco OCR assets must stay pinned to the official digitalcontent host.');
assert(source.includes("endsWith(`.${i + 1}.jpeg`)"), 'Tesco page images must remain contiguous and ordered.');

assert(worker.includes('SOURCE_ADAPTER = "tesco-apollo-page-images-v1"'), 'Tesco OCR worker must consume only the canonical Apollo source.');
assert(worker.includes('EXPECTED_PAGES = 32'), 'Tesco worker must require exactly 32 pages.');
assert(worker.includes('worker.ENGINE = "tesseract-cli-ces-tesco-v2"'), 'Tesco worker must use the quote-safe OCR engine version.');
assert(worker.includes('validate_pdf_url(pdf_url)'), 'Tesco PDF fallback must validate the official PDF host.');
assert(worker.includes('render_pdf_page(destination, page_number)'), 'Broken page images must fall back to the canonical PDF page.');
assert(worker.includes('"pdftoppm"'), 'Tesco PDF fallback must render an exact page with Poppler.');
assert(worker.includes('for attempt in range(1, 4)'), 'Tesco page-image path must retry before PDF fallback.');
assert(worker.includes('normalize_image(raw_path, destination, page_number)'), 'Direct page images must be normalized before OCR/checksum.');
assert(worker.includes('image.convert("RGB")'), 'Tesco pages must be normalized to RGB.');

assert(workflow.includes('poppler-utils'), 'Tesco OCR workflow must install the PDF renderer.');
assert(workflow.includes('python3-pil'), 'Tesco OCR workflow must install the image decoder.');
assert(workflow.includes('cancel-in-progress: true'), 'New Tesco OCR revisions must cancel stale runs.');
assert(workflow.includes("cron: '17 21 * * 2'"), 'Tesco rollover must prefetch on Tuesday evening.');
assert(workflow.includes("cron: '17 4,6 * * 3'"), 'Tesco rollover must retry on Wednesday morning.');

console.log('Tesco OCR fallback contract OK');
