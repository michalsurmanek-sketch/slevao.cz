(() => {
  'use strict';

  const url = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const key = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  let client = null;
  let originalCreateClient = null;

  function installSingletonFactory() {
    const api = window.supabase;
    if (!api?.createClient) return false;

    if (!originalCreateClient) {
      originalCreateClient = api.createClient.bind(api);
    }

    if (api.createClient.__slevaoSingletonWrapper === true) return true;

    const singletonCreateClient = function(projectUrl, projectKey, options) {
      if (projectUrl === url && projectKey === key) {
        return getClient();
      }
      return originalCreateClient(projectUrl, projectKey, options);
    };

    Object.defineProperty(singletonCreateClient, '__slevaoSingletonWrapper', {
      value: true,
      configurable: false,
      enumerable: false,
      writable: false,
    });

    api.createClient = singletonCreateClient;
    return true;
  }

  function getClient() {
    if (!client) {
      if (!installSingletonFactory() || !originalCreateClient) {
        throw new Error('Supabase knihovna není načtená.');
      }
      client = originalCreateClient(url, key);
    }
    return client;
  }

  installSingletonFactory();

  window.SlevaoSupabase = Object.freeze({
    url,
    key,
    getClient,
  });
})();