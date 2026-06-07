alter table public.fo_site_visits
  add column if not exists origin_lat numeric(10, 7),
  add column if not exists origin_lng numeric(10, 7),
  add column if not exists destination_lat numeric(10, 7),
  add column if not exists destination_lng numeric(10, 7);
