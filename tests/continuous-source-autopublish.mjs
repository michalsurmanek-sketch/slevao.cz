import assert from 'node:assert/strict';
import fs from 'node:fs';

for (const [label, path] of [
  ['dm', 'supabase/functions/sync-dm-source/index.ts'],
  ['rossmann', 'supabase/functions/sync-rossmann-source/index.ts'],
]) {
  const source = fs.readFileSync(path, 'utf8');
  assert(source.includes("const PUBLISHER_URL = `${SUPABASE_URL}/functions/v1/publish-imports`;"), `${label}: canonical publisher URL is missing`);
  assert(source.includes('async function publishImport(importId: string)'), `${label}: publish helper is missing`);
  assert(source.includes('async function ensurePublished(importId: string, status: string)'), `${label}: existing review imports must be publishable`);
  assert(source.includes("if (status === 'published') return { reused: true };"), `${label}: published snapshot must be idempotently reused`);
  assert(source.includes("!['review', 'publishing'].includes(status)"), `${label}: unsafe import states must fail closed`);
  assert(source.includes('const publish = await publishImport(importRow.id);'), `${label}: new snapshots must publish before source success`);
  assert(source.includes('const publish = await ensurePublished(existing.id, String(existing.status || \'\'));'), `${label}: existing current review snapshot must be completed`);

  const newPublishAt = source.indexOf('const publish = await publishImport(importRow.id);');
  const successAfterNewAt = source.indexOf('last_success_at:', newPublishAt);
  assert(newPublishAt >= 0 && successAfterNewAt > newPublishAt, `${label}: source success must only be recorded after publishing a new snapshot`);

  const existingPublishAt = source.indexOf("const publish = await ensurePublished(existing.id, String(existing.status || ''));");
  const successAfterExistingAt = source.indexOf('last_success_at:', existingPublishAt);
  assert(existingPublishAt >= 0 && successAfterExistingAt > existingPublishAt, `${label}: source success must only be recorded after completing an existing snapshot`);
}

console.log('Continuous dm/Rossmann source autopublish contract OK');
