(() => {
  'use strict';

  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText || navigator.clipboard.__slevaoShoppingShareClipboardBridge) return;

  const clipboard = navigator.clipboard;
  const nativeWriteText = clipboard.writeText.bind(clipboard);

  function isSharedShoppingListUrl(value) {
    try {
      const url = new URL(String(value || ''), 'https://slevao.cz/');
      const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
      const token = hash.get('share');
      return /\/seznam(?:\.html)?$/i.test(url.pathname) && Boolean(token);
    } catch {
      return false;
    }
  }

  function readListRows() {
    return [...document.querySelectorAll('#listItems [data-id]')]
      .filter((article) => !article.classList.contains('done'))
      .map((article) => {
        const name = String(article.querySelector('.sfItemName')?.textContent || '').trim();
        const rawQuantity = Number(article.querySelector('[data-quantity]')?.value || 1);
        const quantity = Number.isFinite(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1;
        return { name, quantity };
      })
      .filter((row) => row.name);
  }

  const formatQuantity = (value) => Number(value).toLocaleString('cs-CZ', { maximumFractionDigits: 2 });
  const pieceLabel = (value) => Number(value) === 1 ? 'kus' : (Number(value) >= 2 && Number(value) <= 4 ? 'kusy' : 'kusů');
  const itemLabel = (value) => Number(value) === 1 ? 'položka' : (Number(value) >= 2 && Number(value) <= 4 ? 'položky' : 'položek');

  async function enhancedWriteText(value) {
    const raw = String(value ?? '');
    if (!isSharedShoppingListUrl(raw)) return nativeWriteText(raw);

    const rows = readListRows();
    if (!rows.length) return nativeWriteText(raw);

    const totalPieces = rows.reduce((sum, row) => sum + row.quantity, 0);
    const lines = rows.map((row) => `${formatQuantity(row.quantity)}× ${row.name}`);
    const summary = `${rows.length} ${itemLabel(rows.length)} · ${formatQuantity(totalPieces)} ${pieceLabel(totalPieces)}`;
    const text = [
      'Nákupní seznam Slevao.cz',
      summary,
      '',
      ...lines,
      '',
      'Společný seznam:',
      raw
    ].join('\n');

    return nativeWriteText(text);
  }

  try {
    clipboard.writeText = enhancedWriteText;
    Object.defineProperty(clipboard, '__slevaoShoppingShareClipboardBridge', {
      value: true,
      configurable: true
    });
  } catch {
    try {
      Object.defineProperty(clipboard, 'writeText', {
        value: enhancedWriteText,
        configurable: true
      });
      Object.defineProperty(clipboard, '__slevaoShoppingShareClipboardBridge', {
        value: true,
        configurable: true
      });
    } catch {}
  }
})();
