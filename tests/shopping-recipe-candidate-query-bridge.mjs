import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../assets/shopping-recipe-candidate-query-bridge.js', import.meta.url), 'utf8');

function install(handler) {
  const calls = [];
  const db = {
    async rpc(name, args, options) {
      calls.push({ name, args, options });
      return handler(name, args, options);
    }
  };
  const context = {
    window: { SlevaoSupabase: { getClient: () => db } },
    console
  };
  vm.runInNewContext(source, context, { filename: 'shopping-recipe-candidate-query-bridge.js' });
  return { db, calls };
}

{
  const { db, calls } = install(async (_name, args) => {
    if (args.p_queries[0] === 'mleté hovězí maso') return { data: [], error: null };
    if (args.p_queries[0] === 'mleté maso mix') {
      return { data: [{ query_text: 'mleté maso mix', offer: { id: 'mix-1' } }], error: null };
    }
    throw new Error(`unexpected query ${args.p_queries[0]}`);
  });

  const result = await db.rpc('get_public_shopping_list_candidates', {
    p_queries: ['mleté hovězí maso (500 g)'],
    p_limit_per_query: 30
  });

  assert.equal(JSON.stringify(calls.map((call) => call.args.p_queries)), JSON.stringify([
    ['mleté hovězí maso'],
    ['mleté maso mix']
  ]));
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].query_key, 'mlete hovezi maso 500 g');
  assert.equal(result.data[0].query_text, 'mleté hovězí maso (500 g)');
  assert.equal(result.data[0].offer.id, 'mix-1');
}

{
  const { db, calls } = install(async (_name, args) => ({
    data: [{ query_text: args.p_queries[0], offer: { id: 'beef-1' } }],
    error: null
  }));

  const result = await db.rpc('get_public_shopping_list_candidates', {
    p_queries: ['mleté hovězí maso (500 g)']
  });

  assert.equal(calls.length, 1, 'fallback must not run when exact search resolves');
  assert.equal(calls[0].args.p_queries[0], 'mleté hovězí maso');
  assert.equal(result.data[0].offer.id, 'beef-1');
}

{
  const { db, calls } = install(async () => ({ data: [], error: null }));

  await db.rpc('get_public_shopping_list_candidates', {
    p_queries: ['rajčata (krájená)']
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.p_queries[0], 'rajčata (krájená)', 'descriptive parentheses must remain intact');
}

console.log('shopping recipe candidate query bridge: OK');
