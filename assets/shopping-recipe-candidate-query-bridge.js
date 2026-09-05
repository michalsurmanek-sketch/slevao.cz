(() => {
  'use strict';

  const db = window.SlevaoSupabase?.getClient?.();
  if (!db || typeof db.rpc !== 'function' || db.__slevaoRecipeCandidateQueryBridge) return;

  const nativeRpc = db.rpc.bind(db);
  const quantitySuffix = /\s*\(\s*\d+(?:[.,]\d+)?(?:\s*\/\s*\d+(?:[.,]\d+)?)?\s*(?:g|kg|mg|ml|cl|dl|l|ks|kus|kusy|kusů|bal|balení|stroužek|stroužky|stroužků|lžíce|lžic|lžička|lžičky|lžiček|svazek|svazky|hrst|hrsti|špetka|špetky)\s*\)\s*$/iu;

  const normalize = (value) => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const stripRecipeQuantity = (value) => {
    const original = String(value || '').trim();
    if (!original) return '';
    const cleaned = original.replace(quantitySuffix, '').trim();
    return cleaned || original;
  };

  const fallbackFor = (value) => {
    switch (normalize(value)) {
      case 'mlete hovezi maso':
        return 'mleté maso mix';
      default:
        return '';
    }
  };

  const bindCandidateToOriginal = (candidate, original) => ({
    ...candidate,
    query_key: normalize(original),
    query_text: original
  });

  const groupOriginalsByQuery = (originals, querySelector) => {
    const groups = new Map();
    for (const original of originals) {
      const query = String(querySelector(original) || '').trim();
      const key = normalize(query);
      if (!query || !key) continue;
      const group = groups.get(key) || { query, originals: [] };
      group.originals.push(original);
      groups.set(key, group);
    }
    return groups;
  };

  const candidateQueryKey = (candidate) => normalize(candidate?.query_text || candidate?.query_key || '');

  db.rpc = async function slevaoRecipeCandidateRpc(name, args = {}, options) {
    if (name !== 'get_public_shopping_list_candidates' || !Array.isArray(args?.p_queries)) {
      return nativeRpc(name, args, options);
    }

    const originals = [...new Set(args.p_queries
      .map((value) => String(value || '').trim())
      .filter(Boolean))];
    if (!originals.length) return nativeRpc(name, args, options);

    const exactGroups = groupOriginalsByQuery(originals, stripRecipeQuantity);
    const exactQueries = [...exactGroups.values()].map((group) => group.query);
    const exactResult = await nativeRpc(name, { ...args, p_queries: exactQueries }, options);
    if (exactResult?.error || !Array.isArray(exactResult?.data)) return exactResult;

    const merged = [];
    const resolvedOriginals = new Set();

    for (const candidate of exactResult.data) {
      const group = exactGroups.get(candidateQueryKey(candidate));
      if (!group) continue;
      for (const original of group.originals) {
        merged.push(bindCandidateToOriginal(candidate, original));
        resolvedOriginals.add(original);
      }
    }

    const unresolved = originals.filter((original) => !resolvedOriginals.has(original));
    const fallbackGroups = groupOriginalsByQuery(unresolved, (original) => fallbackFor(stripRecipeQuantity(original)));

    if (fallbackGroups.size) {
      try {
        const fallbackQueries = [...fallbackGroups.values()].map((group) => group.query);
        const fallbackResult = await nativeRpc(name, { ...args, p_queries: fallbackQueries }, options);
        if (!fallbackResult?.error && Array.isArray(fallbackResult?.data)) {
          for (const candidate of fallbackResult.data) {
            const group = fallbackGroups.get(candidateQueryKey(candidate));
            if (!group) continue;
            for (const original of group.originals) {
              merged.push(bindCandidateToOriginal(candidate, original));
            }
          }
        }
      } catch (error) {
        console.debug('slevao_recipe_candidate_fallback_failed', error);
      }
    }

    return { ...exactResult, data: merged };
  };

  try {
    Object.defineProperty(db, '__slevaoRecipeCandidateQueryBridge', {
      value: true,
      configurable: true
    });
  } catch {
    db.__slevaoRecipeCandidateQueryBridge = true;
  }
})();
