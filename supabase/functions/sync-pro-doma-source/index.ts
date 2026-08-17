// Retired: PRO-DOMA is synchronized by the staged pg_net/SQL pipeline in
// supabase/migrations/20260817173500_pro_doma_staged_verified_sync.sql.
// The former multi-page Edge implementation exceeded the worker resource limit.
Deno.serve(() => new Response(JSON.stringify({
  ok: false,
  retired: true,
  replacement: 'staged-pro-doma-pg-net-sync',
}), {
  status: 410,
  headers: { 'content-type': 'application/json; charset=utf-8' },
}));
