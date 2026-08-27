(() => {
  'use strict';

  const api = window.SlevaoSupabase;
  if (!api?.getClient) {
    console.error('[slevao] Safe price history adapter: Supabase client wrapper is unavailable.');
    return;
  }

  let client;
  try {
    client = api.getClient();
  } catch (error) {
    console.error('[slevao] Safe price history adapter could not initialize Supabase.', error);
    return;
  }

  if (!client || client.__slevaoSafePriceHistoryInstalled === true) return;

  const originalFrom = client.from.bind(client);
  const rpc = client.rpc.bind(client);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function safePriceHistoryBuilder() {
    let productId = null;
    let rowLimit = 1000;
    let unsupported = null;

    const builder = {
      select() {
        return builder;
      },
      eq(column, value) {
        if (column === 'product_id') {
          productId = String(value || '').trim();
        } else {
          unsupported = `eq(${String(column)})`;
        }
        return builder;
      },
      order(column) {
        if (column !== 'recorded_at') unsupported = `order(${String(column)})`;
        return builder;
      },
      limit(value) {
        const parsed = Number(value);
        rowLimit = Number.isFinite(parsed) ? Math.max(1, Math.min(Math.trunc(parsed), 2000)) : 1000;
        return builder;
      },
      then(resolve, reject) {
        const run = async () => {
          if (unsupported) {
            return { data: null, error: new Error(`Unsupported public price history query: ${unsupported}`) };
          }
          if (!uuidPattern.test(productId || '')) {
            return { data: null, error: new Error('Missing or invalid product_id for public price history.') };
          }

          const result = await rpc('get_public_product_price_history', {
            p_product_id: productId,
            p_limit: rowLimit,
          });

          if (result?.error) return result;

          return {
            ...result,
            data: (result?.data || []).map((row) => ({
              ...row,
              stores: row?.store_name ? {
                name: row.store_name,
                slug: row.store_slug,
                logo_url: row.store_logo_url,
              } : null,
            })),
          };
        };

        return run().then(resolve, reject);
      },
    };

    return builder;
  }

  const safeFrom = function(table) {
    if (table === 'price_history') return safePriceHistoryBuilder();
    return originalFrom(table);
  };

  try {
    Object.defineProperty(client, 'from', {
      value: safeFrom,
      configurable: true,
      enumerable: false,
      writable: true,
    });
    Object.defineProperty(client, '__slevaoSafePriceHistoryInstalled', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });
    window.__slevaoSafePriceHistory = 'rpc-daily-min-v1';
  } catch (error) {
    console.error('[slevao] Safe price history adapter could not patch the Supabase client.', error);
  }
})();
