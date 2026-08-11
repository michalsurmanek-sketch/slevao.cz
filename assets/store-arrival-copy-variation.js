(() => {
  'use strict';

  const PATCH_KEY = '__slevaoArrivalCopyVariationPatched';
  const WINDOW_MS = 4 * 60 * 60 * 1000;

  function hash(value) {
    let output = 2166136261;
    for (let index = 0; index < String(value).length; index += 1) {
      output ^= String(value).charCodeAt(index);
      output = Math.imul(output, 16777619);
    }
    return output >>> 0;
  }

  function variantIndex(options, kind, count) {
    const data = options?.data || {};
    const branch = data.branchId || data.storeId || 'slevao';
    const timeSlot = Math.floor(Date.now() / WINDOW_MS);
    const start = hash(`${kind}|${branch}`) % count;
    return (start + timeSlot) % count;
  }

  function cleanStoreName(title) {
    const text = String(title || '').replace(/🛒/g, '').trim();
    if (/^Jsi v\s+/i.test(text)) return text.replace(/^Jsi v\s+/i, '').trim();
    if (text.includes('·')) return text.split('·').pop().trim();
    return 'obchod';
  }

  function transformStaples(title, body, options) {
    const storeName = cleanStoreName(title);
    const raw = String(body || '');
    const facts = raw
      .replace(/^Dnešní základní nákup:\s*/i, '')
      .replace(/\s*je dnes mezi hlavními akcemi\.?$/i, '')
      .replace(/\.$/, '')
      .trim();
    if (!facts) return { title, body };

    const variants = [
      {
        title: `Základní potraviny v akci · ${storeName} 🛒`,
        body: `Dnešní základní nákup: ${facts}.`,
      },
      {
        title: `Ceny, které dnes stojí za pozornost · ${storeName}`,
        body: `Základní potraviny právě teď: ${facts}.`,
      },
      {
        title: `Co se dnes vyplatí · ${storeName} 🛒`,
        body: `Slevao vybralo z aktuálních akcí: ${facts}.`,
      },
      {
        title: `Rychlý tip před nákupem · ${storeName}`,
        body: `Mrkni hlavně na tyto ceny: ${facts}.`,
      },
      {
        title: `Dnešní základní nákup · ${storeName}`,
        body: `Z nejdůležitějších potravin jsou právě v akci: ${facts}.`,
      },
    ];
    return variants[variantIndex(options, 'staples', variants.length)];
  }

  function transformList(title, body, options) {
    const storeName = cleanStoreName(title);
    const facts = String(body || '').trim();
    if (!facts) return { title, body };

    const variants = [
      { title: `Jsi v ${storeName} 🛒`, body: facts },
      { title: `Tvůj nákup právě zlevnil · ${storeName}`, body: `Slevao našlo shody s tvým seznamem. ${facts}` },
      { title: `Slevy z tvého seznamu · ${storeName}`, body: `Právě tady se vyplatí zkontrolovat seznam. ${facts}` },
      { title: 'Dobrá zpráva pro tvůj nákup 🛒', body: `${facts} Platí právě pro ${storeName}.` },
      { title: `Mrkni na svůj seznam · ${storeName}`, body: `Některé tvoje položky jsou právě ve slevě. ${facts}` },
    ];
    return variants[variantIndex(options, 'list', variants.length)];
  }

  function transformGeneric(title, body, options) {
    const storeName = cleanStoreName(title);
    const facts = String(body || '').trim();
    const variants = [
      { title: `Jsi v ${storeName} 🛒`, body: facts },
      { title: `Nejlepší tip právě tady · ${storeName}`, body: facts },
      { title: `Akce, která stojí za pozornost · ${storeName}`, body: facts },
      { title: `Rychlý tip · ${storeName} 🛒`, body: facts },
    ];
    return variants[variantIndex(options, 'generic', variants.length)];
  }

  function transformCopy(title, options = {}) {
    const body = String(options.body || '');
    const tag = String(options.tag || '');
    const data = options.data || {};

    if (!tag.startsWith('slevao-store-arrival-') || data.test) return { title, body };

    if (/Základní potraviny v akci/i.test(String(title)) || /^Dnešní základní nákup:/i.test(body)) {
      return transformStaples(title, body, options);
    }

    if (/z tvého seznamu/i.test(body) || /tvého seznamu/i.test(body)) {
      return transformList(title, body, options);
    }

    return transformGeneric(title, body, options);
  }

  function patchServiceWorkerNotifications() {
    const proto = window.ServiceWorkerRegistration?.prototype;
    if (!proto || proto[PATCH_KEY] || typeof proto.showNotification !== 'function') return false;

    const original = proto.showNotification;
    Object.defineProperty(proto, PATCH_KEY, { value: true, configurable: false });
    proto.showNotification = function slevaoShowNotification(title, options = {}) {
      const copy = transformCopy(title, options);
      return original.call(this, copy.title, { ...options, body: copy.body });
    };
    return true;
  }

  window.SlevaoArrivalCopyVariation = {
    transform: transformCopy,
  };

  patchServiceWorkerNotifications();
  window.addEventListener('pageshow', patchServiceWorkerNotifications);
})();
