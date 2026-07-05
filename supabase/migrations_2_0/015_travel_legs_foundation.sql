-- Travel legs foundation for mixed travel days.
-- Additive only: existing attendance, site visit, GPS log, and expense claim flows remain valid without travel_leg_id.

create table if not exists public.fo_travel_legs (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.fo_attendance(id) on delete cascade,
  employee_code text not null,
  fo_user_id text,
  travel_mode text not null,
  payable_km_allowed boolean not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  start_lat double precision,
  start_lng double precision,
  end_lat double precision,
  end_lng double precision,
  calculated_km numeric(10,2) not null default 0,
  payable_km numeric(10,2) not null default 0,
  fare_amount numeric(10,2) not null default 0,
  proof_file_url text,
  remarks text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fo_travel_legs_mode_check
    check (travel_mode in ('bike', 'own_vehicle', 'auto', 'bus', 'train', 'other')),
  constraint fo_travel_legs_status_check
    check (status in ('active', 'completed', 'cancelled', 'submitted', 'approved', 'rejected'))
);

alter table public.fo_site_visits
  add column if not exists travel_leg_id uuid references public.fo_travel_legs(id) on delete set null;

alter table public.fo_location_logs
  add column if not exists travel_leg_id uuid references public.fo_travel_legs(id) on delete set null;

alter table public.fo_travel_expense_claims
  add column if not exists travel_leg_id uuid references public.fo_travel_legs(id) on delete set null;

create index if not exists idx_fo_travel_legs_attendance_started
  on public.fo_travel_legs(attendance_id, started_at);

create index if not exists idx_fo_travel_legs_employee_started
  on public.fo_travel_legs(employee_code, started_at desc);

create index if not exists idx_fo_travel_legs_status
  on public.fo_travel_legs(status);

create index if not exists idx_fo_site_visits_travel_leg_id
  on public.fo_site_visits(travel_leg_id);

create index if not exists idx_fo_location_logs_travel_leg_id
  on public.fo_location_logs(travel_leg_id);

create index if not exists idx_fo_travel_expense_claims_travel_leg_id
  on public.fo_travel_expense_claims(travel_leg_id);

drop trigger if exists trg_fo_travel_legs_updated_at
  on public.fo_travel_legs;

create trigger trg_fo_travel_legs_updated_at
before update on public.fo_travel_legs
for each row execute function public.set_updated_at();

alter table public.fo_travel_legs enable row level security;

grant select, insert, update on public.fo_travel_legs to authenticated;

drop policy if exists "FO can view own travel legs"
  on public.fo_travel_legs;
create policy "FO can view own travel legs"
on public.fo_travel_legs
for select
to authenticated
using (
  public.is_current_fo(fo_user_id)
  or public.is_current_fo(employee_code)
  or public.is_qpms_admin()
);

drop policy if exists "FO can create own travel legs"
  on public.fo_travel_legs;
create policy "FO can create own travel legs"
on public.fo_travel_legs
for insert
to authenticated
with check (
  public.is_current_fo(fo_user_id)
  or public.is_current_fo(employee_code)
  or public.is_qpms_admin()
);

drop policy if exists "FO can update own travel legs"
  on public.fo_travel_legs;
create policy "FO can update own travel legs"
on public.fo_travel_legs
for update
to authenticated
using (
  public.is_current_fo(fo_user_id)
  or public.is_current_fo(employee_code)
  or public.is_qpms_admin()
)
with check (
  public.is_current_fo(fo_user_id)
  or public.is_current_fo(employee_code)
  or public.is_qpms_admin()
);
