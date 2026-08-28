create or replace function public.normalize_public_offer_report_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text := auth.role();
  v_product_id uuid;
begin
  if v_role in ('anon', 'authenticated') then
    new.status := 'new';
    new.resolved_at := null;
    new.created_at := clock_timestamp();
    new.user_id := auth.uid();

    if new.page_url is not null then
      new.page_url := btrim(new.page_url);
      if new.page_url = '' then
        new.page_url := null;
      elsif char_length(new.page_url) > 2048 then
        raise exception using
          errcode = '22023',
          message = 'URL stránky je příliš dlouhá.';
      elsif new.page_url !~* '^https?://' then
        raise exception using
          errcode = '22023',
          message = 'URL stránky musí používat HTTP nebo HTTPS.';
      end if;
    end if;

    if new.offer_id is not null then
      select o.product_id
        into v_product_id
      from public.offers o
      where o.id = new.offer_id;

      if not found then
        raise exception using
          errcode = '23503',
          message = 'Nabídka pro hlášení neexistuje.';
      end if;

      new.product_id := v_product_id;
    else
      new.product_id := null;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.normalize_public_offer_report_insert() from public, anon, authenticated;
grant execute on function public.normalize_public_offer_report_insert() to postgres, service_role;

drop trigger if exists normalize_public_offer_report_insert on public.offer_reports;
create trigger normalize_public_offer_report_insert
before insert on public.offer_reports
for each row
execute function public.normalize_public_offer_report_insert();
