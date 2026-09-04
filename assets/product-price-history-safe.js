(() => {
  'use strict';

  const api = window.SlevaoSupabase;
  if (!api?.getClient) {
    console.error('[slevao] Safe price history adapter: Supabase client wrapper is unavailable.');
    return;
  }

  const RPC_NAME = 'get_public_product_price_history';
  const DEFAULT_LIMIT = 1000;
  const MAX_LIMIT = 2000;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const originalGetClient = api.getClient.bind(api);
  const installedClients = new WeakSet();

  function normalizedLimit(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(1, Math.min(Math.trunc(parsed), MAX_LIMIT)) : DEFAULT_LIMIT;
  }

  function normalizeRows(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      ...row,
      stores: row?.store_name ? {
        name: row.store_name,
        slug: row.store_slug,
        logo_url: row.store_logo_url,
      } : null,
    }));
  }

  async function load(productId, limit = DEFAULT_LIMIT) {
    const id = String(productId || '').trim();
    if (!uuidPattern.test(id)) {
      return { data:null, error:new Error('Missing or invalid product_id for public price history.') };
    }

    let client;
    try {
      client = originalGetClient();
    } catch (error) {
      return { data:null, error };
    }
    if (!client?.rpc) {
      return { data:null, error:new Error('Supabase client is unavailable for public price history.') };
    }

    try {
      const result = await client.rpc(RPC_NAME, {
        p_product_id: id,
        p_limit: normalizedLimit(limit),
      });
      if (result?.error) return { data:null, error:result.error };
      return { ...result, data:normalizeRows(result?.data) };
    } catch (error) {
      return { data:null, error };
    }
  }

  function install(client) {
    if (!client || typeof client.from !== 'function') return false;
    if (installedClients.has(client) || client.__slevaoSafePriceHistoryInstalled === true) return true;

    const originalFrom = client.from.bind(client);

    function safePriceHistoryBuilder() {
      let productId = null;
      let rowLimit = DEFAULT_LIMIT;
      let unsupported = null;

      const builder = {
        select() { return builder; },
        eq(column, value) {
          if (column === 'product_id') productId = String(value || '').trim();
          else unsupported = `eq(${String(column)})`;
          return builder;
        },
        order(column) {
          if (column !== 'recorded_at') unsupported = `order(${String(column)})`;
          return builder;
        },
        limit(value) {
          rowLimit = normalizedLimit(value);
          return builder;
        },
        then(resolve, reject) {
          const run = async () => {
            if (unsupported) {
              return { data:null, error:new Error(`Unsupported public price history query: ${unsupported}`) };
            }
            return load(productId, rowLimit);
          };
          return run().then(resolve, reject);
        },
        catch(reject) {
          return Promise.resolve(builder).catch(reject);
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
        value:safeFrom,
        configurable:true,
        enumerable:false,
        writable:true,
      });
      Object.defineProperty(client, '__slevaoSafePriceHistoryInstalled', {
        value:true,
        configurable:false,
        enumerable:false,
        writable:false,
      });
      installedClients.add(client);
      return true;
    } catch (error) {
      try {
        client.from = safeFrom;
        installedClients.add(client);
        return true;
      } catch {
        console.error('[slevao] Safe price history adapter could not patch the Supabase client.', error);
        return false;
      }
    }
  }

  api.getClient = function safeGetClient() {
    const client = originalGetClient();
    if (client) install(client);
    return client;
  };

  window.SlevaoPriceHistorySafe = {
    load,
    install,
    rpc:RPC_NAME,
  };

  let installed = false;
  try {
    const client = originalGetClient();
    installed = client ? install(client) : false;
  } catch {
    installed = false;
  }

  window.__slevaoSafePriceHistory = {
    ok:true,
    status:installed ? 'patched' : 'lazy',
    rpc:RPC_NAME,
    mode:'rpc-first-lazy-adapter-v2',
  };
})();
