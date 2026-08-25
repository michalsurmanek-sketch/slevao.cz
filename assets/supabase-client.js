(() => {
  'use strict';

  const url = 'https://uhampjdqjxmbhaptgitn.supabase.co';
  const key = 'sb_publishable_2I9ronLpYyn2kdnLRcdIUA_geOMF4XU';
  let client = null;

  window.SlevaoSupabase = Object.freeze({
    url,
    key,
    getClient() {
      if (!client) {
        if (!window.supabase?.createClient) {
          throw new Error('Supabase knihovna není načtená.');
        }
        client = window.supabase.createClient(url, key);
      }
      return client;
    }
  });
})();
