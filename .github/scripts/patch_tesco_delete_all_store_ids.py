from pathlib import Path

path = Path('supabase/functions/publish-imports/index.ts')
text = path.read_text(encoding='utf-8')
old = """  if (String(job.stores?.slug || '') === 'tesco') {
    const { error: deleteOldOffersError } = await db.from('offers')
      .delete()
      .eq('store_id', job.store_id)
      .eq('status', 'published');
    if (deleteOldOffersError) throw deleteOldOffersError;
  }
"""
new = """  if (String(job.stores?.slug || '') === 'tesco') {
    const { data: tescoStores, error: tescoStoresError } = await db.from('stores')
      .select('id')
      .eq('slug', 'tesco');
    if (tescoStoresError) throw tescoStoresError;
    const tescoStoreIds = (tescoStores || []).map((store: any) => store.id).filter(Boolean);
    if (!tescoStoreIds.length) throw new Error('Obchod Tesco nebyl v databázi nalezen.');
    const { error: deleteOldOffersError } = await db.from('offers')
      .delete()
      .in('store_id', tescoStoreIds)
      .eq('status', 'published');
    if (deleteOldOffersError) throw deleteOldOffersError;
  }
"""
if old not in text:
    raise SystemExit('Expected Tesco cleanup block not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
print('Tesco cleanup updated for all matching store IDs')
