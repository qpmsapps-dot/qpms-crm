-- Canonical review table for FO checkout-exception Missing KM adjustments.
-- This migration is additive and does not change legacy site visit route KM.

create table if not exists public.fo_missing_km_reviews (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.fo_attendance(id) on delete cascade,
  site_visit_id uuid not null references public.fo_site_visits(id) on delete cascade,
  employee_code text not null,
  review_type text not null,
  window_start_time timestamptz,
  window_end_time timestamptz,
  origin_latitude numeric,
  origin_longitude numeric,
  destination_latitude numeric,
  destination_longitude numeric,
  checkout_distance_meters numeric,
  raw_gps_km numeric not null default 0,
  filtered_gps_km numeric not null default 0,
  google_route_km numeric,
  straight_line_km numeric,
  suggested_missing_km numeric not null default 0,
  approved_missing_km numeric not null default 0,
  rate_per_km numeric,
  suggested_amount numeric not null default 0,
  approved_amount numeric not null default 0,
  calculation_source text,
  evidence_quality text,
  status text not null default 'pending',
  reason_code text,
  requested_clarification text,
  reviewer_employee_code text,
  reviewer_name text,
  reviewed_at timestamptz,
  review_remarks text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fo_missing_km_reviews_review_type_check
    check (review_type in ('checkout_exception')),
  constraint fo_missing_km_reviews_status_check
    check (status in ('pending', 'approved', 'rejected', 'clarification_required')),
  constraint fo_missing_km_reviews_nonnegative_km_check
    check (
      coalesce(raw_gps_km, 0) >= 0 and
      coalesce(filtered_gps_km, 0) >= 0 and
      coalesce(google_route_km, 0) >= 0 and
      coalesce(straight_line_km, 0) >= 0 and
      coalesce(suggested_missing_km, 0) >= 0 and
      coalesce(approved_missing_km, 0) >= 0
    ),
  constraint fo_missing_km_reviews_nonnegative_amount_check
    check (
      coalesce(suggested_amount, 0) >= 0 and
      coalesce(approved_amount, 0) >= 0
    )
);

create unique index if not exists fo_missing_km_reviews_attendance_visit_type_uidx
  on public.fo_missing_km_reviews(attendance_id, site_visit_id, review_type);

create index if not exists fo_missing_km_reviews_attendance_idx
  on public.fo_missing_km_reviews(attendance_id);

create index if not exists fo_missing_km_reviews_site_visit_idx
  on public.fo_missing_km_reviews(site_visit_id);

create index if not exists fo_missing_km_reviews_employee_status_idx
  on public.fo_missing_km_reviews(employee_code, status);

alter table public.fo_missing_km_reviews enable row level security;

drop policy if exists "fo_missing_km_reviews_service_role_all" on public.fo_missing_km_reviews;
create policy "fo_missing_km_reviews_service_role_all"
  on public.fo_missing_km_reviews
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant all on table public.fo_missing_km_reviews to service_role;
