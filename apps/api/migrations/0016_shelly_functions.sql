-- 0016: Shelly — funkcje agregujące wołane przez Workera (supabase.rpc).
-- Całe liczenie po wielu wierszach dzieje się tutaj, nie w Workerze (limit CPU).
--
-- Energia zawsze z przyrostów narastającego licznika (energy_total_wh):
--   przyrost = e - e_poprzednie, a gdy licznik spadł (restart / reset) = e.
-- Przyrost z przedziału [t0, t1] rozkładamy proporcjonalnie na kubełki czasu,
-- więc długa przerwa w próbkowaniu nie robi „szpilki” w jednej godzinie.

-- ---------------------------------------------------------------------------
-- Wh zużyte między p_from a p_to. NULL, gdy brak próbki na/tuż przed p_from
-- (nie da się ocenić, np. integracja jeszcze nie działała).
-- ---------------------------------------------------------------------------
create or replace function public.shelly_energy_between(
  p_device text,
  p_from   timestamptz,
  p_to     timestamptz
)
returns double precision
language sql stable
as $$
  with base as (
    select ts, energy_total_wh as e
    from public.shelly_samples
    where device_id = p_device
      and energy_total_wh is not null
      and ts <= p_from
      and ts > p_from - interval '6 hours'
    order by ts desc
    limit 1
  ),
  pts as (
    select ts, e from base
    union all
    select ts, energy_total_wh
    from public.shelly_samples
    where device_id = p_device
      and energy_total_wh is not null
      and ts > p_from
      and ts <= p_to
  ),
  d as (
    select e, lag(e) over (order by ts) as prev from pts
  )
  select case
           when not exists (select 1 from base) then null
           else coalesce(sum(case when prev is null then 0
                                  when e >= prev then e - prev
                                  else e end), 0)
         end
  from d;
$$;

-- ---------------------------------------------------------------------------
-- Seria zużycia w kubełkach 'hour' | 'day' | 'month' (dni/miesiące wg p_tz).
-- Zwraca pełną oś; wh = NULL tam, gdzie nie ma żadnych danych.
-- source: 'own' (z licznika), 'cloud' (historia z chmury, tylko dni sprzed
-- pierwszej własnej próbki), 'mixed' (miesiąc z obu źródeł).
-- ---------------------------------------------------------------------------
create or replace function public.shelly_energy_series(
  p_device text,
  p_from   timestamptz,
  p_to     timestamptz,
  p_bucket text,
  p_tz     text default 'Europe/Warsaw'
)
returns table (bucket_start timestamptz, wh double precision, source text)
language sql stable
as $$
  with
  step as (
    select case p_bucket when 'hour' then interval '1 hour'
                         when 'day'  then interval '1 day'
                         else interval '1 month' end as s,
           case p_bucket when 'hour' then 'hour'
                         when 'day'  then 'day'
                         else 'month' end as unit
  ),
  axis as (
    select (lb at time zone p_tz)              as bucket_start,
           ((lb + step.s) at time zone p_tz)   as bucket_end
    from step,
         generate_series(date_trunc(step.unit, p_from at time zone p_tz),
                         (p_to at time zone p_tz) - interval '1 microsecond',
                         step.s) as lb
  ),
  s as (
    select ts, energy_total_wh as e
    from public.shelly_samples
    where device_id = p_device
      and energy_total_wh is not null
      and ts >= p_from - interval '7 days'
      and ts <= p_to
  ),
  iv as (
    select lag(ts) over w as t0,
           ts             as t1,
           case when lag(e) over w is null then null
                when e >= lag(e) over w   then e - lag(e) over w
                else e end as wh
    from s
    window w as (order by ts)
  ),
  iv2 as (
    select t0, t1, wh
    from iv
    where t0 is not null and wh is not null
      and t1 > t0 and t1 > p_from and t0 < p_to
  ),
  own as (
    select a.bucket_start,
           sum(iv2.wh
               * extract(epoch from (least(iv2.t1, a.bucket_end) - greatest(iv2.t0, a.bucket_start)))
               / extract(epoch from (iv2.t1 - iv2.t0))) as wh
    from axis a
    join iv2 on iv2.t0 < a.bucket_end and iv2.t1 > a.bucket_start
    group by a.bucket_start
  ),
  first_own as (
    select (min(ts) at time zone p_tz)::date as day
    from public.shelly_samples
    where device_id = p_device and energy_total_wh is not null
  ),
  cloud as (
    select a.bucket_start, sum(c.wh) as wh
    from axis a
    join public.shelly_cloud_daily c
      on c.device_id = p_device
     and (c.day::timestamp at time zone p_tz) >= a.bucket_start
     and (c.day::timestamp at time zone p_tz) <  a.bucket_end
    where p_bucket <> 'hour'
      and c.day < coalesce((select day from first_own), 'infinity'::date)
    group by a.bucket_start
  )
  select a.bucket_start,
         case when o.wh is null and c.wh is null then null
              else coalesce(o.wh, 0) + coalesce(c.wh, 0) end as wh,
         case when o.wh is not null and c.wh is not null then 'mixed'
              when o.wh is not null then 'own'
              when c.wh is not null then 'cloud' end as source
  from axis a
  left join own   o using (bucket_start)
  left join cloud c using (bucket_start)
  order by a.bucket_start;
$$;

-- ---------------------------------------------------------------------------
-- Czas pracy (godziny) w kubełkach. Stan z próbki obowiązuje do następnej
-- próbki (maks. 6 h); ostatni stan liczymy maks. 20 min w przód.
-- „Praca” = wyjście włączone albo (p_use_power) moc >= p_min_w.
-- active_hours = NULL, gdy w kubełku nie było żadnych danych.
-- ---------------------------------------------------------------------------
create or replace function public.shelly_activity_series(
  p_device    text,
  p_from      timestamptz,
  p_to        timestamptz,
  p_bucket    text,
  p_use_power boolean default false,
  p_min_w     real default 20,
  p_tz        text default 'Europe/Warsaw'
)
returns table (bucket_start timestamptz, active_hours double precision)
language sql stable
as $$
  with
  step as (
    select case p_bucket when 'hour' then interval '1 hour'
                         when 'day'  then interval '1 day'
                         else interval '1 month' end as s,
           case p_bucket when 'hour' then 'hour'
                         when 'day'  then 'day'
                         else 'month' end as unit
  ),
  axis as (
    select (lb at time zone p_tz)            as bucket_start,
           ((lb + step.s) at time zone p_tz) as bucket_end
    from step,
         generate_series(date_trunc(step.unit, p_from at time zone p_tz),
                         (p_to at time zone p_tz) - interval '1 microsecond',
                         step.s) as lb
  ),
  s as (
    select ts,
           case when p_use_power then coalesce(apower_w >= p_min_w, false)
                else coalesce(output, false) end as active
    from public.shelly_samples
    where device_id = p_device
      and ts >= p_from - interval '1 day'
      and ts <= p_to
      and (output is not null or apower_w is not null)
  ),
  iv as (
    select ts as t0,
           least(coalesce(lead(ts) over (order by ts), least(now(), ts + interval '20 minutes')),
                 ts + interval '6 hours') as t1,
           active
    from s
  ),
  agg as (
    select a.bucket_start,
           sum(case when iv.active
                    then extract(epoch from (least(iv.t1, a.bucket_end) - greatest(iv.t0, a.bucket_start)))
                    else 0 end) / 3600.0 as hours
    from axis a
    join iv on iv.t1 > iv.t0 and iv.t0 < a.bucket_end and iv.t1 > a.bucket_start
    group by a.bucket_start
  )
  select a.bucket_start, g.hours
  from axis a
  left join agg g using (bucket_start)
  order by a.bucket_start;
$$;
