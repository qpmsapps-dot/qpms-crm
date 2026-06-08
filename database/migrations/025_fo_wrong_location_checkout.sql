-- Migration 025: FO wrong-location checkout metadata
-- Purpose: Track checkout geofence status and petrol penalty distance when
-- an FO checks out far away from the checked-in site.

alter table public.fo_site_visits
  add column if not exists checkout_distance_meters numeric(12, 2),
  add column if not exists checkout_location_status text not null default 'valid',
  add column if not exists checkout_note text,
  add column if not exists petrol_eligible_after_checkout boolean not null default true,
  add column if not exists petrol_penalty_distance_meters numeric(12, 2) not null default 0;

create index if not exists idx_fo_site_visits_checkout_location_status
  on public.fo_site_visits(checkout_location_status);
