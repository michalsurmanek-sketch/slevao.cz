-- PRO-DOMA: verified staged sync through Jina + pg_net.
-- The direct Edge worker path is intentionally not scheduled because multi-page
-- parsing exceeds the worker resource budget. This pipeline keeps every HTTP
-- request small and publishes only after the whole run is complete.

create or replace function public.parse_pro_doma_event_markdown(p_markdown text,p_event_url text)
returns table(external_id text,title text,normalized_title text,quantity_text text,price numeric,old_price numeric,valid_from date,valid_to date,source_url text,image_url text,metadata jsonb)
language sql stable
set search_path='public','pg_temp'
as $fn$
with parts as (
  select coalesce(p_markdown,'') raw,
         case when strpos(coalesce(p_markdown,''),'## Výpis produktů')>0
              then left(p_markdown,strpos(p_markdown,'## Výpis produktů')-1)
              else coalesce(p_markdown,'') end promo_header
), eligibility as (
  select raw,promo_header,
         not (lower(promo_header) like '%jako dárek%' or lower(promo_header) like '%získáte jako dárek%') allowed_price_event
  from parts
), txt as (
  select raw,promo_header,allowed_price_event,replace(raw,'**',' ') t from eligibility
), d1 as (
  select *,regexp_match(t,'od[[:space:]]+([0-9]{1,2})[.][[:space:]]*([0-9]{1,2})[.][[:space:]]+do[[:space:]]+([0-9]{1,2})[.][[:space:]]*([0-9]{1,2})[.][[:space:]]*([0-9]{4})') m1 from txt
), d2 as (
  select *,regexp_match(t,'od[[:space:]]+([0-9]{1,2})[.][[:space:]]*([0-9]{1,2})[.][[:space:]]*([0-9]{4})[[:space:]]+do[[:space:]]+([0-9]{1,2})[.][[:space:]]*([0-9]{1,2})[.][[:space:]]*([0-9]{4})') m2 from d1
), d3 as (
  select *,regexp_match(t,'([0-9]{1,2})[.][[:space:]]*([0-9]{1,2})[.][[:space:]]*([0-9]{4})[[:space:]]*-[[:space:]]*([0-9]{1,2})[.][[:space:]]*([0-9]{1,2})[.][[:space:]]*([0-9]{4})') m3 from d2
), range as (
  select raw,allowed_price_event,
         case when m2 is not null then make_date((m2)[3]::int,(m2)[2]::int,(m2)[1]::int)
              when m1 is not null then make_date((m1)[5]::int,(m1)[2]::int,(m1)[1]::int)
              when m3 is not null then make_date((m3)[3]::int,(m3)[2]::int,(m3)[1]::int) end vf,
         case when m2 is not null then make_date((m2)[6]::int,(m2)[5]::int,(m2)[4]::int)
              when m1 is not null then make_date((m1)[5]::int,(m1)[4]::int,(m1)[3]::int)
              when m3 is not null then make_date((m3)[6]::int,(m3)[5]::int,(m3)[4]::int) end vt
  from d3
), section as (
  select substring(raw from strpos(raw,'## Výpis produktů')) s,vf,vt
  from range where allowed_price_event and vf is not null and vt is not null and strpos(raw,'## Výpis produktů')>0
), blocks as (
  select vf,vt,ord,block from section,lateral regexp_split_to_table(s,E'\\n\\[!\\[Image') with ordinality x(block,ord) where ord>1
), parsed as (
  select vf,vt,ord,block,
    substring(block from 'https://img[.]pro-doma[.]cz/userimages/product_main/[^)]+') img,
    substring(block from 'https://www[.]pro-doma[.]cz/[^ )]+') url,
    substring(block from E'### \\[([^]]+)\\]') ttl,
    substring(block from E'\\*\\*([0-9][0-9 ]*,[0-9][0-9])\\*\\*Kč/([[:alnum:]²³]+) s DPH') ptxt,
    substring(block from E'\\*\\*[0-9][0-9 ]*,[0-9][0-9]\\*\\*Kč/([[:alnum:]²³]+) s DPH') unit,
    coalesce(substring(block from E'Akce-[0-9]+%[[:space:]]+([0-9][0-9 ]*,[0-9][0-9])[[:space:]]+Kč'),substring(block from E'Ceníková cena dodavatele:[[:space:]]+([0-9][0-9 ]*,[0-9][0-9])[[:space:]]+Kč')) otxt
  from blocks
), safe as (
  select p.*,replace(replace(ptxt,' ',''),',','.')::numeric cp,
         case when otxt is null then null else replace(replace(otxt,' ',''),',','.')::numeric end op
  from parsed p
  where img is not null and url is not null and ttl is not null and ptxt is not null
)
select 'prodoma:'||md5(url),ttl,public.normalize_product_name(ttl),unit,cp,
       case when op>cp then op else null end,vf,vt,url,img,
       jsonb_build_object('adapter','pro-doma-jina-events-v1','parser_version','pro-doma-jina-events-v1','event_url',p_event_url,'price_unit',unit,'price_policy','consumer_price_including_vat')
from safe
where cp>0 and cp<=100000 and vf<=vt and url like 'https://www.pro-doma.cz/%' and img like 'https://img.pro-doma.cz/%';
$fn$;

create or replace function public.trigger_pro_doma_verified_sync()
returns bigint
language plpgsql security definer
set search_path='public','net','pg_temp'
as $fn$
declare v_store uuid;v_req bigint;v_run uuid:=gen_random_uuid();v_now timestamptz:=now();
begin
 select id into v_store from public.stores where slug='pro-doma';
 if v_store is null then return null; end if;
 if exists(select 1 from public.structured_retail_http_jobs where store_id=v_store and adapter in ('pro-doma-index-v1','pro-doma-detail-v1') and status='pending' and requested_at>v_now-interval '20 minutes') then return null; end if;
 v_req:=net.http_get(url:='https://r.jina.ai/https://www.pro-doma.cz/akce',headers:=jsonb_build_object('User-Agent','Slevao/1.0','Accept','text/plain,text/markdown'),timeout_milliseconds:=30000);
 insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata) values(v_req,v_store,'pro-doma-index-v1','pending',jsonb_build_object('run_id',v_run,'source_url','https://www.pro-doma.cz/akce'));
 update public.store_product_sync_state set last_run_at=v_now,is_running=true,run_started_at=v_now,health_status='running',last_error=null,updated_at=v_now where store_id=v_store;
 return v_req;
end;$fn$;

create or replace function public.reconcile_pro_doma_index_sync()
returns jsonb
language plpgsql security definer
set search_path='public','net','pg_temp'
as $fn$
declare j record;v_http record;v_url text;v_req bigint;v_count int;v_done int:=0;v_failed int:=0;v_now timestamptz:=now();v_msg text;
begin
 for j in select * from public.structured_retail_http_jobs where adapter='pro-doma-index-v1' and status='pending' order by requested_at limit 5 loop
  select * into v_http from net._http_response where id=j.request_id;
  if not found then if j.requested_at<v_now-interval '20 minutes' then update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message='PRO-DOMA index timeout' where request_id=j.request_id;v_failed:=v_failed+1;end if;continue;end if;
  if coalesce(v_http.status_code,0)<>200 or v_http.timed_out or v_http.error_msg is not null or length(coalesce(v_http.content,''))<5000 then
   v_msg:=format('PRO-DOMA index HTTP %s / length %s',coalesce(v_http.status_code,0),length(coalesce(v_http.content,'')));
   update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_msg where request_id=j.request_id;v_failed:=v_failed+1;continue;
  end if;
  v_count:=0;
  for v_url in
    with b as (select ord,block from regexp_split_to_table(v_http.content,'event_main/') with ordinality x(block,ord) where ord>1)
    select distinct substring(block from 'https://www[.]pro-doma[.]cz/[^ )]+') from b
    where substring(block from 'https://www[.]pro-doma[.]cz/[^ )]+') is not null limit 20
  loop
    v_req:=net.http_get(url:='https://r.jina.ai/'||v_url,headers:=jsonb_build_object('User-Agent','Slevao/1.0','Accept','text/plain,text/markdown'),timeout_milliseconds:=30000);
    insert into public.structured_retail_http_jobs(request_id,store_id,adapter,status,metadata)
    values(v_req,j.store_id,'pro-doma-detail-v1','pending',jsonb_build_object('run_id',j.metadata->>'run_id','event_url',v_url,'index_request_id',j.request_id));
    v_count:=v_count+1;
  end loop;
  if v_count<1 then update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message='PRO-DOMA index neobsahuje eventy' where request_id=j.request_id;v_failed:=v_failed+1;continue;end if;
  update public.structured_retail_http_jobs set status='completed',processed_at=v_now,error_message=null,metadata=metadata||jsonb_build_object('expected_events',v_count,'published',false) where request_id=j.request_id;v_done:=v_done+1;
 end loop;
 return jsonb_build_object('ok',v_failed=0,'completed',v_done,'failed',v_failed);
end;$fn$;

create or replace function public.reconcile_pro_doma_detail_sync()
returns jsonb
language plpgsql security definer
set search_path='public','net','pg_temp'
as $fn$
declare idx record;d record;v_http record;v_pending int;v_failed int;v_expected int;v_rows jsonb;v_count int;v_sig text;v_result jsonb;v_now timestamptz:=now();v_today date:=(now() at time zone 'Europe/Prague')::date;v_done int:=0;v_bad int:=0;v_msg text;
begin
 for idx in select * from public.structured_retail_http_jobs where adapter='pro-doma-index-v1' and status='completed' and coalesce(metadata->>'published','false')<>'true' order by requested_at limit 5 loop
  v_expected:=coalesce((idx.metadata->>'expected_events')::int,0);
  if v_expected<1 then continue; end if;
  v_pending:=0;v_failed:=0;
  for d in select * from public.structured_retail_http_jobs where adapter='pro-doma-detail-v1' and metadata->>'run_id'=idx.metadata->>'run_id' loop
    if d.status='pending' then
      select * into v_http from net._http_response where id=d.request_id;
      if not found then if d.requested_at<v_now-interval '20 minutes' then update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message='PRO-DOMA detail timeout' where request_id=d.request_id;v_failed:=v_failed+1;else v_pending:=v_pending+1;end if;
      elsif coalesce(v_http.status_code,0)<>200 or v_http.timed_out or v_http.error_msg is not null or length(coalesce(v_http.content,''))<4000 then
        update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=format('PRO-DOMA detail HTTP %s / length %s',coalesce(v_http.status_code,0),length(coalesce(v_http.content,''))) where request_id=d.request_id;v_failed:=v_failed+1;
      else update public.structured_retail_http_jobs set status='completed',processed_at=v_now,error_message=null where request_id=d.request_id; end if;
    elsif d.status='failed' then v_failed:=v_failed+1; end if;
  end loop;
  if v_pending>0 then continue; end if;
  if v_failed>0 then
    v_msg:=format('PRO-DOMA run neúplný: %s detailů selhalo; předchozí nabídky zachovány.',v_failed);
    update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_msg,metadata=metadata||jsonb_build_object('published',false) where request_id=idx.request_id;
    update public.store_product_sync_state set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,health_status='error',health_reason=v_msg,updated_at=v_now where store_id=idx.store_id;v_bad:=v_bad+1;continue;
  end if;
  with details as (
    select j.request_id,j.metadata->>'event_url' event_url,resp.content
    from public.structured_retail_http_jobs j join net._http_response resp on resp.id=j.request_id
    where j.adapter='pro-doma-detail-v1' and j.metadata->>'run_id'=idx.metadata->>'run_id' and j.status='completed'
  ), parsed as (
    select p.* from details d0 cross join lateral public.parse_pro_doma_event_markdown(d0.content,d0.event_url) p
    where p.valid_from<=v_today and p.valid_to>=v_today
  ), dedup as (
    select distinct on(external_id) * from parsed order by external_id,valid_to desc
  )
  select jsonb_agg(jsonb_build_object('external_id',external_id,'title',title,'normalized_title',normalized_title,'quantity_text',quantity_text,'price',price,'old_price',old_price,'valid_from',valid_from,'valid_to',valid_to,'source_url',source_url,'source_page',1,'product_id',null,'image_url',image_url,'confidence',0.99,'metadata',metadata) order by external_id),count(*),md5(string_agg(external_id||'|'||price::text||'|'||coalesce(old_price::text,'')||'|'||valid_from::text||'|'||valid_to::text,E'\n' order by external_id))
  into v_rows,v_count,v_sig from dedup;
  if coalesce(v_count,0)<5 then
    update public.store_product_sync_state set is_running=false,run_started_at=null,last_error=null,last_parser_error=null,health_status='waiting_source',health_reason=format('PRO-DOMA: aktuální eventy obsahují jen %s bezpečných produktových cen.',coalesce(v_count,0)),last_product_candidates=coalesce(v_count,0),updated_at=v_now where store_id=idx.store_id;
    update public.structured_retail_http_jobs set metadata=metadata||jsonb_build_object('published',true,'result','waiting_source'),processed_at=v_now where request_id=idx.request_id;v_done:=v_done+1;continue;
  end if;
  begin
    v_result:=public.publish_structured_store_offers('pro-doma','pro-doma-jina-events-v1',v_sig,v_rows,5,300,'https://www.pro-doma.cz/akce','pro-doma-jina-events-v1');
    update public.structured_retail_http_jobs set status='completed',metadata=metadata||jsonb_build_object('result',v_result) where adapter='pro-doma-detail-v1' and metadata->>'run_id'=idx.metadata->>'run_id';
    update public.structured_retail_http_jobs set metadata=metadata||jsonb_build_object('published',true,'result',v_result),processed_at=v_now where request_id=idx.request_id;v_done:=v_done+1;
  exception when others then
    v_msg:=sqlerrm;update public.structured_retail_http_jobs set status='failed',processed_at=v_now,error_message=v_msg where request_id=idx.request_id;update public.store_product_sync_state set is_running=false,run_started_at=null,last_error=v_msg,last_parser_error=v_msg,health_status='error',health_reason=v_msg,updated_at=v_now where store_id=idx.store_id;v_bad:=v_bad+1;
  end;
 end loop;
 return jsonb_build_object('ok',v_bad=0,'completed',v_done,'failed',v_bad);
end;$fn$;

-- Reuse one historical source row instead of creating duplicate PRO-DOMA sources.
with target as (
  select ls.id
  from public.leaflet_sources ls join public.stores s on s.id=ls.store_id
  where s.slug='pro-doma'
  order by ls.is_active desc,ls.created_at
  limit 1
)
update public.leaflet_sources
set name='PRO-DOMA oficiální akce',source_url='https://www.pro-doma.cz/akce',source_type='html',is_active=true,auto_publish=false,
    adapter_key='pro-doma-jina-events-v1',extraction_strategy='structured_markdown',last_error=null,updated_at=now()
where id=(select id from target);

revoke all on function public.trigger_pro_doma_verified_sync() from public,anon,authenticated;
revoke all on function public.reconcile_pro_doma_index_sync() from public,anon,authenticated;
revoke all on function public.reconcile_pro_doma_detail_sync() from public,anon,authenticated;
grant execute on function public.trigger_pro_doma_verified_sync() to service_role;
grant execute on function public.reconcile_pro_doma_index_sync() to service_role;
grant execute on function public.reconcile_pro_doma_detail_sync() to service_role;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('sync-pro-doma-verified','reconcile-pro-doma-index','reconcile-pro-doma-details');
exception when others then null; end $$;
select cron.schedule('sync-pro-doma-verified','27 */6 * * *','select public.trigger_pro_doma_verified_sync();');
select cron.schedule('reconcile-pro-doma-index','*/5 * * * *','select public.reconcile_pro_doma_index_sync();');
select cron.schedule('reconcile-pro-doma-details','2-59/5 * * * *','select public.reconcile_pro_doma_detail_sync();');
