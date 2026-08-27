-- A successful PRO-DOMA publish previously left last_http_status / last_html_length
-- untouched, so stale failure telemetry (for example HTTP 403) could remain visible
-- even while health_status was already ok. Persist telemetry from the successful
-- terminal detail responses without changing parsing or publication semantics.

do $migration$
declare
  v_def text;
  v_marker text := $marker$last_product_candidates=v_count,updated_at=v_now$marker$;
  v_expanded text := $expanded$last_product_candidates=v_count,last_http_status=200,last_html_length=(select coalesce(sum(length(coalesce(resp.content,''))),0)::int from public.structured_retail_http_jobs jj join net._http_response resp on resp.id=jj.request_id where jj.adapter='pro-doma-detail-v1' and jj.metadata->>'run_id'=idx.metadata->>'run_id' and jj.status='completed' and coalesce(jj.metadata->>'superseded_by','')=''),updated_at=v_now$expanded$;
  v_marker_count int;
  v_expanded_count int;
begin
  select pg_get_functiondef('public.reconcile_pro_doma_detail_sync()'::regprocedure)
    into v_def;

  v_marker_count := (length(v_def) - length(replace(v_def, v_marker, ''))) / length(v_marker);
  v_expanded_count := (length(v_def) - length(replace(v_def, v_expanded, ''))) / length(v_expanded);

  if v_expanded_count = 1 then
    null;
  elsif v_expanded_count = 0 and v_marker_count = 1 then
    v_def := replace(v_def, v_marker, v_expanded);
    execute v_def;
  else
    raise exception 'Unexpected reconcile_pro_doma_detail_sync success telemetry shape: marker %, hardened %',
      v_marker_count, v_expanded_count;
  end if;
end
$migration$;
