from pathlib import Path

path = Path('supabase/functions/publish-imports/index.ts')
text = path.read_text(encoding='utf-8')

old_query = "let query = db.from('leaflet_imports').select('*').eq('status', 'publishing').limit(10);\n    if (body.import_id) query = db.from('leaflet_imports').select('*').eq('id', String(body.import_id)).limit(1);"
new_query = "let query = db.from('leaflet_imports').select('*,stores(slug)').eq('status', 'publishing').limit(10);\n    if (body.import_id) query = db.from('leaflet_imports').select('*,stores(slug)').eq('id', String(body.import_id)).limit(1);"
if old_query not in text:
    raise SystemExit('Expected import query not found')
text = text.replace(old_query, new_query, 1)

anchor = "  let published = 0, skippedDuplicates = 0, failed = 0;\n\n  for (const item of items) {"
replacement = "  let published = 0, skippedDuplicates = 0, failed = 0;\n\n  if (String(job.stores?.slug || '') === 'tesco') {\n    const { error: deleteOldOffersError } = await db.from('offers')\n      .delete()\n      .eq('store_id', job.store_id)\n      .eq('status', 'published');\n    if (deleteOldOffersError) throw deleteOldOffersError;\n  }\n\n  for (const item of items) {"
if anchor not in text:
    raise SystemExit('Expected publish loop anchor not found')
text = text.replace(anchor, replacement, 1)

path.write_text(text, encoding='utf-8')
print('Tesco replacement rule added')
