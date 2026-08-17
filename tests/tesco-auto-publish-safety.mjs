import fs from 'node:fs';
import assert from 'node:assert/strict';

const migration = fs.readFileSync(new URL('../supabase/migrations/20260817224500_pause_tesco_auto_publish.sql', import.meta.url), 'utf8');

assert.match(migration, /s\.slug\s*=\s*'tesco'/i, 'Tesco safety migration must target only Tesco.');
assert.match(migration, /auto_publish\s*=\s*false/i, 'Tesco auto-publish must remain disabled until full replacement is transactional.');
assert.doesNotMatch(migration, /is_active\s*=\s*false/i, 'Tesco discovery/source must stay active while auto-publish is paused.');

console.log('tesco-auto-publish-safety: ok');
