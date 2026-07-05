-- Travel mode controls for FO attendance payable KM.
-- Bike / own vehicle remains payable. Public transport modes use expense claims.

alter table public.fo_attendance
  add column if not exists travel_mode text not null default 'bike',
  add column if not exists payable_km_allowed boolean not null default true,
  add column if not exists travel_mode_note text;

update public.fo_attendance
set
  travel_mode = coalesce(nullif(btrim(travel_mode), ''), 'bike'),
  payable_km_allowed = coalesce(payable_km_allowed, true)
where travel_mode is null
   or btrim(travel_mode) = ''
   or payable_km_allowed is null;

update public.fo_attendance
set payable_km_allowed = travel_mode in ('bike', 'own_vehicle')
where travel_mode in ('bike', 'own_vehicle', 'auto', 'bus', 'train', 'other');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fo_attendance_travel_mode_check'
      and conrelid = 'public.fo_attendance'::regclass
  ) then
    alter table public.fo_attendance
      add constraint fo_attendance_travel_mode_check
      check (travel_mode in ('bike', 'own_vehicle', 'auto', 'bus', 'train', 'other'));
  end if;
end $$;

create table if not exists public.fo_travel_expense_claims (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid references public.fo_attendance(id) on delete cascade,
  site_visit_id uuid references public.fo_site_visits(id) on delete set null,
  fo_user_id text,
  employee_code text not null,
  travel_mode text not null,
  fare_amount numeric(10,2) not null default 0,
  remarks text,
  proof_file_url text,
  storage_bucket text,
  status text not null default 'submitted',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fo_travel_expense_claims_mode_check
    check (travel_mode in ('bike', 'own_vehicle', 'auto', 'bus', 'train', 'other')),
  constraint fo_travel_expense_claims_status_check
    check (status in ('submitted', 'approved', 'rejected', 'cancelled'))
);

create index if not exists idx_fo_travel_expense_claims_attendance_id
  on public.fo_travel_expense_claims(attendance_id);

create index if not exists idx_fo_travel_expense_claims_employee_code
  on public.fo_travel_expense_claims(employee_code);

create index if not exists idx_fo_travel_expense_claims_created_at
  on public.fo_travel_expense_claims(created_at desc);

drop trigger if exists trg_fo_travel_expense_claims_updated_at
  on public.fo_travel_expense_claims;

create trigger trg_fo_travel_expense_claims_updated_at
before update on public.fo_travel_expense_claims
for each row execute function public.set_updated_at();

alter table public.fo_travel_expense_claims enable row level security;

grant select, insert, update on public.fo_travel_expense_claims to authenticated;

drop policy if exists "FO can view own travel expense claims"
  on public.fo_travel_expense_claims;
create policy "FO can view own travel expense claims"
on public.fo_travel_expense_claims
for select
to authenticated
using (
  public.is_current_fo(fo_user_id)
  or public.is_current_fo(employee_code)
  or public.is_qpms_admin()
);

drop policy if exists "FO can create own travel expense claims"
  on public.fo_travel_expense_claims;
create policy "FO can create own travel expense claims"
on public.fo_travel_expense_claims
for insert
to authenticated
with check (
  public.is_current_fo(fo_user_id)
  or public.is_current_fo(employee_code)
  or public.is_qpms_admin()
);

drop policy if exists "FO can update own submitted travel expense claims"
  on public.fo_travel_expense_claims;
create policy "FO can update own submitted travel expense claims"
on public.fo_travel_expense_claims
for update
to authenticated
using (
  (
    status = 'submitted'
    and (
      public.is_current_fo(fo_user_id)
      or public.is_current_fo(employee_code)
    )
  )
  or public.is_qpms_admin()
)
with check (
  (
    status = 'submitted'
    and (
      public.is_current_fo(fo_user_id)
      or public.is_current_fo(employee_code)
    )
  )
  or public.is_qpms_admin()
);
