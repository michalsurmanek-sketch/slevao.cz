import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('assets/home-overview.js', 'utf8');
let writes = 0;
const target = { set innerHTML(value) { writes++; this.markup = value; } };
const counter = {};
const context = {
  window: {}, Intl, console,
  document: {
    readyState: 'loading', addEventListener() {}, querySelectorAll: () => [],
    getElementById: (id) => id === 'overviewStores' ? target : id === 'overview-stores-page' ? counter : null
  }
};
// Exercise the actual renderer without starting network requests or timers.
vm.runInNewContext(source.replace('  function init() {', `
  window.testStores = (rows) => { overviewStores = rows; syncStores(); };
  window.testPage = (page) => { storePage = page; syncStores(); };
  function init() {`), context);
const rows = Array.from({ length: 9 }, (_, i) => ({ slug: `store-${i}`, name: `Store ${i}`, logo_url: `${i}.png` }));
context.window.testStores(rows);
assert.equal(writes, 1);
for (let i = 0; i < 50; i++) context.window.testStores(structuredClone(rows));
assert.equal(writes, 1, 'Unchanged refreshes must preserve cards and their loaded logos');
context.window.testPage(1);
assert.equal(writes, 2, 'Changing page must render the next stores');
assert.equal(counter.textContent, '2/2');
rows[8].name = 'Updated name';
context.window.testStores(rows);
assert.equal(writes, 3, 'Visible store changes must still render');
context.window.testStores(rows.slice(0, 8));
assert.equal(counter.textContent, '1/1', 'Shrinking directory must normalize page');
assert.equal(writes, 4);
console.log('Overview store stability OK');
