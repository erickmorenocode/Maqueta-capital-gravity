-- G-force history: one row per company per fetch, for trend/backtest queries.
create table if not exists g_history (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  country text not null,
  sector text not null,
  regime text not null,
  vix numeric not null,
  ticker text not null,
  name text not null,
  price numeric not null,
  change_pct numeric not null,
  masa numeric not null,
  distancia numeric not null,
  friccion numeric not null,
  fuerza_g numeric not null,
  institutional_pressure numeric not null,
  options_pressure numeric not null,
  gamma_flip numeric,
  put_call_ratio numeric not null,
  tier text not null,
  market_cap numeric not null
);

create index if not exists g_history_ticker_created_idx on g_history (ticker, created_at desc);
create index if not exists g_history_country_sector_idx on g_history (country, sector, created_at desc);

alter table g_history enable row level security;

-- Reads open (dashboard is public); writes only via service role key from API routes.
create policy "g_history_select_public" on g_history for select using (true);
