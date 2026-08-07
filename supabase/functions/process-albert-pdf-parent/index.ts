Deno.serve(() => new Response(
  JSON.stringify({ error: 'Disabled: Albert uses direct Publitas product sync.' }),
  { status: 410, headers: { 'content-type': 'application/json; charset=utf-8' } },
));
