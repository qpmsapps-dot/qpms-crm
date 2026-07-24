-- Add Car travel mode and per-leg rate/amount snapshots.
-- Forward-only and additive except for widening existing travel-mode check constraints.

alter table public.fo_travel_legs
  add column if not exists rate_per_km numeric(10,2),
  add column if not exists payable_amount numeric(10,2);

alter table public.fo_live_status
  add column if not exists travel_mode text,
  add column if not exists rate_per_km numeric(10,2);

alter table public.fo_attendance
  drop constraint if exists fo_attendance_travel_mode_check;

alter table public.fo_attendance
  add constraint fo_attendance_travel_mode_check
  check (travel_mode in ('bike', 'own_vehicle', 'car', 'auto', 'bus', 'train', 'other'));

alter table public.fo_travel_expense_claims
  drop constraint if exists fo_travel_expense_claims_mode_check;

alter table public.fo_travel_expense_claims
  add constraint fo_travel_expense_claims_mode_check
  check (travel_mode in ('bike', 'own_vehicle', 'car', 'auto', 'bus', 'train', 'other'));

alter table public.fo_travel_legs
  drop constraint if exists fo_travel_legs_mode_check;

alter table public.fo_travel_legs
  add constraint fo_travel_legs_mode_check
  check (travel_mode in ('bike', 'own_vehicle', 'car', 'auto', 'bus', 'train', 'other'));

update public.fo_travel_legs
set
  rate_per_km = coalesce(rate_per_km, case when travel_mode = 'car' then 8 else 4 end),
  payable_amount = coalesce(payable_amount, fare_amount)
where rate_per_km is null
   or payable_amount is null;

comment on column public.fo_travel_legs.rate_per_km is
  'Per-KM reimbursement rate snapshotted for this travel leg.';

comment on column public.fo_travel_legs.payable_amount is
  'Payable amount for this travel leg, calculated from payable_km and rate_per_km.';

comment on column public.fo_live_status.travel_mode is
  'Latest active attendance travel mode for live dashboard display.';

comment on column public.fo_live_status.rate_per_km is
  'Latest active attendance per-KM reimbursement rate for live dashboard display.';
