from pathlib import Path

path = Path('supabase/functions/discover-leaflets/index.ts')
text = path.read_text(encoding='utf-8')

old_function = """async function queueProcessor(importId: string) {
  const response = await fetch(PROCESSOR_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'x-cron-secret': CRON_SECRET },
    body: JSON.stringify({ import_id: importId }),
  });
  if (!response.ok) throw new Error(`Processor HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 500)}`);
}
"""

new_function = """async function queueProcessor(importId: string, storeSlug = '') {
  const processorUrl = storeSlug === 'kaufland'
    ? `${SUPABASE_URL}/functions/v1/process-automatic-pdf-v2`
    : PROCESSOR_URL;
  const response = await fetch(processorUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'x-cron-secret': CRON_SECRET },
    body: JSON.stringify({ import_id: importId }),
  });
  if (!response.ok) throw new Error(`Processor HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 500)}`);
}
"""

if old_function not in text:
    if "process-automatic-pdf-v2" not in text:
        raise SystemExit('queueProcessor pattern was not found')
else:
    text = text.replace(old_function, new_function, 1)

old_call = 'await queueProcessor(data.id);'
new_call = 'await queueProcessor(data.id, storeSlug);'
if old_call in text:
    text = text.replace(old_call, new_call, 1)
elif new_call not in text:
    raise SystemExit('queueProcessor call pattern was not found')

path.write_text(text, encoding='utf-8')
