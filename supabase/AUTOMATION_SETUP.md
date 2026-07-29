# Automatizace letáků

Migrace `20260729190000_automate_leaflets_and_expire_offers.sql` nastaví:

- každých 15 minut archivaci a odstranění nabídek, jejichž `valid_to` už skončilo,
- každé 3 hodiny kontrolu aktivních zdrojů letáků,
- archiv kompletního původního záznamu v `expired_offer_archive`.

## Jednorázové nastavení tajemství

Hodnota musí být stejná jako `CRON_SECRET` nastavený u Supabase Edge Functions.
V Supabase SQL Editoru spusť pouze jednou:

```sql
select vault.create_secret(
  'SEM_VLOZ_STEJNOU_HODNOTU_JAKO_CRON_SECRET',
  'slevao_cron_secret',
  'Ověření automatické kontroly letáků Slevao.cz'
);
```

Tajnou hodnotu nikdy neukládej do GitHubu ani do veřejného HTML.

## Kontrola

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname like 'slevao-%'
order by jobname;

select public.archive_and_delete_expired_offers();
select public.trigger_leaflet_discovery();
```
