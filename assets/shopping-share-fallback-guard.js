(() => {
  'use strict';

  if (typeof navigator === 'undefined' || !navigator.share || navigator.__slevaoShoppingShareFallbackGuard) return;

  const nativeShare = navigator.share.bind(navigator);

  async function guardedShare(data = {}) {
    const title = String(data?.title || '').toLocaleLowerCase('cs-CZ');
    const isShoppingList = title.includes('nákupní seznam slevao.cz');
    if (!isShoppingList) return nativeShare(data);

    try {
      return await nativeShare(data);
    } catch (error) {
      if (error?.name === 'AbortError') throw error;

      const fallback = String(data?.url || data?.text || '').trim();
      if (!fallback || !navigator.clipboard?.writeText) throw error;

      try {
        await navigator.clipboard.writeText(fallback);
        return;
      } catch {
        throw error;
      }
    }
  }

  try {
    navigator.share = guardedShare;
    Object.defineProperty(navigator, '__slevaoShoppingShareFallbackGuard', {
      value: true,
      configurable: true
    });
  } catch {
    try {
      Object.defineProperty(navigator, 'share', {
        value: guardedShare,
        configurable: true
      });
      Object.defineProperty(navigator, '__slevaoShoppingShareFallbackGuard', {
        value: true,
        configurable: true
      });
    } catch {}
  }
})();
