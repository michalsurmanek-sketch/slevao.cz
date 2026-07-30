from pathlib import Path

path = Path('supabase/functions/process-leaflet/index.ts')
text = path.read_text(encoding='utf-8')

old1 = """    if (job.stores?.slug === 'billa') await backfillBillaPublishedImages(job.store_id);\n    if (job.stores?.slug === 'albert') await backfillAlbertPublishedImages(job.store_id);\n"""
new1 = """    if (job.stores?.slug === 'billa') await backfillBillaPublishedImages(job.store_id);\n    if (job.stores?.slug === 'albert') await backfillAlbertPublishedImages(job.store_id);\n    if (job.stores?.slug === 'tesco') await backfillAlbertPublishedImages(job.store_id);\n"""

old2 = """    const items = job.stores?.slug === 'kaufland' ? await enrichKauflandImages(extractedItems)\n      : job.stores?.slug === 'billa' ? await enrichBillaImages(extractedItems)\n        : job.stores?.slug === 'albert' ? await enrichAlbertImages(extractedItems, job.store_id)\n        : extractedItems;\n"""
new2 = """    const items = job.stores?.slug === 'kaufland' ? await enrichKauflandImages(extractedItems)\n      : job.stores?.slug === 'billa' ? await enrichBillaImages(extractedItems)\n        : job.stores?.slug === 'albert' ? await enrichAlbertImages(extractedItems, job.store_id)\n          : job.stores?.slug === 'tesco' ? await enrichAlbertImages(extractedItems, job.store_id)\n          : extractedItems;\n"""

if old1 not in text:
    raise SystemExit('Tesco backfill insertion point not found')
if old2 not in text:
    raise SystemExit('Tesco enrichment insertion point not found')

text = text.replace(old1, new1, 1).replace(old2, new2, 1)
path.write_text(text, encoding='utf-8')
