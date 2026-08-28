-- G-force history: one row per company/asset per fetch, for trend/backtest queries.
-- Deliberately minimal: identifiers + price + the 4 gravity totals (masa/distancia/friccion/fuerza_g) + tier.
-- Intermediate signals (change_pct, institutional/options pressure, gamma_flip, put/call ratio, regime, vix)
-- are computed fresh on every fetch and are not persisted.
create table if not exists g_history (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  country text not null,
  sector text not null,
  asset_class text,
  ticker text not null,
  name text not null,
  open numeric not null,
  price numeric not null,
  masa numeric not null,
  distancia numeric not null,
  friccion numeric not null,
  fuerza_g numeric not null,
  tier text not null,
  geo_events jsonb
);

create index if not exists g_history_ticker_created_idx on g_history (ticker, created_at desc);
create index if not exists g_history_country_sector_idx on g_history (country, sector, created_at desc);
create index if not exists g_history_asset_class_idx on g_history (asset_class, created_at desc) where asset_class is not null;

alter table g_history enable row level security;

-- Reads open (dashboard is public); writes only via service role key from API routes.
create policy "g_history_select_public" on g_history for select using (true);
