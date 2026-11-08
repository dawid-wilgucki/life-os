-- 0015: Shelly Cloud — konfiguracja urządzeń, okresy przerwy, próbki, stan,
-- epizody alertów i historia zużycia pobrana z chmury.
--
-- Dodanie kolejnego urządzenia = jeden wiersz w shelly_devices (albo formularz
-- w zakładce „Urządzenia”). Progi i harmonogramy są danymi, nie kodem.

-- ---------------------------------------------------------------------------
-- Urządzenia (jedno miejsce konfiguracji)
-- ---------------------------------------------------------------------------
create table if not exists public.shelly_devices (
  id                  text primary key,              -- Shelly device id (MAC, małe litery)
  name                text not null,
  icon                text not null default '🔌',
  model_code          text,                          -- np. S4SW-001P16EU (uzupełniane z API)
  gen                 smallint,                      -- 1..4 (uzupełniane z API)
  channel             smallint not null default 0,   -- switch:<channel> / relays[channel]
  has_power_meter     boolean not null default false,
  -- Co znaczy „pracuje”: stan wyjścia (pompa, lampy) albo pobór mocy
  -- (bojler: gniazdko stale włączone, grzeje termostat).
  activity_signal     text not null default 'output' check (activity_signal in ('output', 'power')),
  active_power_min_w  real not null default 20,
  nominal_power_w     real,                          -- dla urządzeń bez pomiaru (szacunek)
  offline_after_hours real not null default 3 check (offline_after_hours > 0),
  -- Harmonogram oczekiwanej pracy, np.
  --   {"type":"runs","days":[1,3,5,7],"at":"sunrise","offset_min":-20,"duration_min":15,"tolerance_min":30}
  --   {"type":"night","tolerance_min":30}
  schedule            jsonb,
  -- Nadpisania progów alertów, np. {"voltage_min":207,"voltage_max":253,"voltage":true,
  -- "device_errors":true,"max_run_min":30,"min_run_wh":10}
  alerts              jsonb not null default '{}'::jsonb,
  latitude            double precision,              -- lokalizacja z ustawień urządzenia (wschód/zachód)
  longitude           double precision,
  enabled             boolean not null default true,
  sort_order          smallint not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists trg_shelly_devices_updated on public.shelly_devices;
create trigger trg_shelly_devices_updated
  before update on public.shelly_devices
  for each row execute function public.set_updated_at();

alter table public.shelly_devices enable row level security;

-- ---------------------------------------------------------------------------
-- Okresy przerwy: w ich trakcie urządzenie nie jest monitorowane (poza
-- opcjonalnym alertem „pracuje w czasie przerwy”).
-- ---------------------------------------------------------------------------
create table if not exists public.shelly_device_periods (
  id                uuid primary key default gen_random_uuid(),
  device_id         text not null references public.shelly_devices(id) on delete cascade,
  recurring         boolean not null,                -- true: co roku (MM-DD), false: jednorazowo
  start_md          text check (start_md ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  end_md            text check (end_md ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
  starts_on         date,
  ends_on           date,
  alert_on_activity boolean not null default true,
  note              text,
  created_at        timestamptz not null default now(),
  constraint shelly_device_periods_shape check (
    (recurring and start_md is not null and end_md is not null)
    or (not recurring and starts_on is not null and ends_on is not null and ends_on >= starts_on)
  )
);
create index if not exists shelly_device_periods_device_idx on public.shelly_device_periods (device_id);

alter table public.shelly_device_periods enable row level security;

-- ---------------------------------------------------------------------------
-- Próbki: nieregularna seria czasowa (poll co 15 min, odświeżenie ręczne, webhook).
-- Energię liczymy z przyrostów energy_total_wh, nie z mocy chwilowej.
-- ---------------------------------------------------------------------------
create table if not exists public.shelly_samples (
  id              bigint generated always as identity primary key,
  device_id       text not null references public.shelly_devices(id) on delete cascade,
  ts              timestamptz not null,
  source          text not null check (source in ('poll', 'live', 'webhook')),
  event           text,                              -- webhook: on | off
  output          boolean,
  apower_w        real,
  voltage_v       real,
  current_a       real,
  freq_hz         real,
  energy_total_wh double precision,                  -- licznik narastający (Gen1: total / 60)
  temp_c          real,
  rssi            smallint,
  uptime_s        bigint,
  errors          text[]
);
create index if not exists shelly_samples_device_ts_idx on public.shelly_samples (device_id, ts desc);

alter table public.shelly_samples enable row level security;

-- ---------------------------------------------------------------------------
-- Bieżący stan: jeden wiersz na urządzenie, nadpisywany przy każdym pollu.
-- ---------------------------------------------------------------------------
create table if not exists public.shelly_device_state (
  device_id             text primary key references public.shelly_devices(id) on delete cascade,
  online                boolean not null default false,
  output                boolean,
  last_reading          jsonb,                       -- znormalizowany ostatni odczyt (UI)
  last_updated_raw      text,                        -- _updated z chmury (UTC, fingerprint)
  last_report_at        timestamptz,                 -- kiedy urządzenie przysłało ostatni status
  last_seen_online_at   timestamptz,
  offline_since         timestamptz,
  last_energy_wh        double precision,            -- licznik z poprzedniego odczytu
  active_since          timestamptz,
  active_since_exact    boolean not null default false,  -- z webhooka / timera urządzenia
  active_energy_start_wh double precision,
  last_active_at        timestamptz,
  last_run              jsonb,                       -- {"start","end","energyWh","avgW","exact"}
  voltage_bad_streak    smallint not null default 0,
  fw_version            text,
  fw_update             text,
  backfill_month        date,                        -- następny miesiąc do pobrania (idzie wstecz)
  backfill_empty_months smallint not null default 0,
  backfill_errors       smallint not null default 0,
  backfill_done         boolean not null default false,
  updated_at            timestamptz not null default now()
);

alter table public.shelly_device_state enable row level security;

-- ---------------------------------------------------------------------------
-- Ustawienia globalne + zdrowie integracji (singleton).
-- ---------------------------------------------------------------------------
create table if not exists public.shelly_settings (
  id                    smallint primary key default 1 check (id = 1),
  quiet_from            time not null default '22:00',   -- cisza nocna (Europe/Warsaw)
  quiet_to              time not null default '07:00',
  latitude              double precision not null default 49.701879,  -- Bircza, jak w weather.ts
  longitude             double precision not null default 22.414214,
  api_failure_threshold smallint not null default 4,      -- 4 polle = 1 h
  consecutive_failures  integer not null default 0,
  last_error            text,
  last_error_kind       text,
  last_success_at       timestamptz,
  last_attempt_at       timestamptz
);
insert into public.shelly_settings (id) values (1) on conflict (id) do nothing;

alter table public.shelly_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Epizody alertów: deduplikacja (max 1 otwarty na regułę i urządzenie),
-- komunikat o powrocie do normy, odroczenie w godzinach ciszy.
-- ---------------------------------------------------------------------------
create table if not exists public.shelly_alerts (
  id                   uuid primary key default gen_random_uuid(),
  device_id            text references public.shelly_devices(id) on delete cascade,  -- NULL = globalny
  rule                 text not null,
  severity             text not null default 'warning' check (severity in ('critical', 'warning')),
  message              text not null,
  resolve_message      text,
  details              jsonb,
  opened_at            timestamptz not null default now(),
  resolved_at          timestamptz,
  resolution           text check (resolution in ('normal', 'break', 'disabled')),
  ok_streak            smallint not null default 0,
  notified_open_at     timestamptz,
  notified_resolved_at timestamptz
);
create unique index if not exists shelly_alerts_one_open_idx
  on public.shelly_alerts (coalesce(device_id, ''), rule) where resolved_at is null;
create index if not exists shelly_alerts_opened_idx on public.shelly_alerts (opened_at desc);

alter table public.shelly_alerts enable row level security;

-- ---------------------------------------------------------------------------
-- Dzienna historia zużycia z chmury Shelly (uzupełnienie wstecz).
-- ---------------------------------------------------------------------------
create table if not exists public.shelly_cloud_daily (
  device_id   text not null references public.shelly_devices(id) on delete cascade,
  day         date not null,                         -- dzień wg Europe/Warsaw
  wh          double precision not null,
  voltage_avg real,
  fetched_at  timestamptz not null default now(),
  primary key (device_id, day)
);

alter table public.shelly_cloud_daily enable row level security;

-- ---------------------------------------------------------------------------
-- Urządzenia startowe. Grzałkę dodaj w zakładce „Urządzenia” (ID z aplikacji
-- Shelly: Ustawienia urządzenia → Informacje o urządzeniu).
-- ---------------------------------------------------------------------------
insert into public.shelly_devices
  (id, name, icon, model_code, gen, has_power_meter, activity_signal, schedule, alerts, sort_order)
values
  ('e4b0637ece04', 'Pompa', '💧', 'S4SW-001P16EU', 4, true, 'output',
   '{"type":"runs","days":[1,3,5,7],"at":"sunrise","offset_min":-20,"duration_min":15,"tolerance_min":30}',
   '{"max_run_min":30,"min_run_wh":10}', 1),
  ('d885ac0681e8', 'Lampy', '💡', 'S3SW-001X8EU', 3, false, 'output',
   '{"type":"night","tolerance_min":30}',
   '{}', 2)
on conflict (id) do nothing;

-- Domyślna przerwa pompy poza sezonem podlewania (zmień w zakładce).
insert into public.shelly_device_periods (device_id, recurring, start_md, end_md, alert_on_activity, note)
select 'e4b0637ece04', true, '10-01', '04-30', true, 'Poza sezonem podlewania'
where not exists (select 1 from public.shelly_device_periods where device_id = 'e4b0637ece04');
