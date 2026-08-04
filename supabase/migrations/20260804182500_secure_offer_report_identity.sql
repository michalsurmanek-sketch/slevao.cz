drop policy if exists "Public create offer reports" on public.offer_reports;
create policy "Public create offer reports"
on public.offer_reports for insert
to anon, authenticated
with check (
  char_length(coalesce(note,'')) <= 2000
  and status = 'new'
  and (
    (auth.uid() is null and user_id is null)
    or (auth.uid() is not null and user_id = auth.uid())
  )
);
