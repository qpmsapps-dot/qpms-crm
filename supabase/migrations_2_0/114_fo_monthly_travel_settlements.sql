begin;

create table if not exists public.fo_monthly_travel_settlements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  employee_code text not null,
  state text not null,
  period_start date not null,
  period_end date not null,
  calculated_claim_amount numeric(14,2) not null,
  finance_reviewed_amount numeric(14,2),
  approved_payable_amount numeric(14,2) not null,
  adjustment_amount numeric(14,2) not null,
  adjustment_type text not null,
  adjustment_reason text,
  remarks text,
  source_reference text not null,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint fo_monthly_travel_settlements_period_check
    check (period_end >= period_start),
  constraint fo_monthly_travel_settlements_amounts_check
    check (
      calculated_claim_amount >= 0
      and (finance_reviewed_amount is null or finance_reviewed_amount >= 0)
      and approved_payable_amount >= 0
      and adjustment_amount = round(approved_payable_amount - calculated_claim_amount, 2)
    ),
  constraint fo_monthly_travel_settlements_adjustment_type_check
    check (adjustment_type in ('FULL_APPROVAL', 'FINANCE_ADJUSTMENT', 'ADVANCE_ALREADY_PAID')),
  constraint fo_monthly_travel_settlements_profile_period_key
    unique (profile_id, period_start, period_end),
  constraint fo_monthly_travel_settlements_employee_period_key
    unique (employee_code, period_start, period_end)
);

create index if not exists idx_fo_monthly_travel_settlements_state_period
  on public.fo_monthly_travel_settlements(state, period_start, period_end);

create index if not exists idx_fo_monthly_travel_settlements_profile_period
  on public.fo_monthly_travel_settlements(profile_id, period_start, period_end);

drop trigger if exists trg_fo_monthly_travel_settlements_updated_at
  on public.fo_monthly_travel_settlements;
create trigger trg_fo_monthly_travel_settlements_updated_at
before update on public.fo_monthly_travel_settlements
for each row execute function public.set_updated_at();

alter table public.fo_monthly_travel_settlements enable row level security;

revoke all on table public.fo_monthly_travel_settlements from public, anon, authenticated;
grant select, insert, update, delete on table public.fo_monthly_travel_settlements to service_role;

drop policy if exists "service role manages monthly travel settlements"
  on public.fo_monthly_travel_settlements;
create policy "service role manages monthly travel settlements"
on public.fo_monthly_travel_settlements
for all
to service_role
using (true)
with check (true);

comment on table public.fo_monthly_travel_settlements is
  'Audited monthly Finance settlement overlay. Operational attendance, GPS, KM and expense source values remain unchanged.';
comment on column public.fo_monthly_travel_settlements.calculated_claim_amount is
  'Snapshot of the system-calculated claim when Finance approved the settlement.';
comment on column public.fo_monthly_travel_settlements.adjustment_amount is
  'Finance adjustment: approved_payable_amount minus calculated_claim_amount.';

do $seed$
declare
  v_expected_count integer := 11;
  v_resolved_count integer;
begin
  with approved_values (
    profile_id,
    employee_code,
    calculated_claim_amount,
    approved_payable_amount,
    adjustment_type,
    adjustment_reason
  ) as (
    values
      ('2fefccc5-b8c2-40d5-bf4a-502b0c095324'::uuid, 'QPMSKA3846', 8130.20::numeric, 0.00::numeric, 'ADVANCE_ALREADY_PAID', 'Advance amount already paid; no further payment required against this claim.'),
      ('7061caa7-eadd-48b0-a680-9464eeea8bfc'::uuid, 'QPMSKA0958', 7862.12::numeric, 7862.12::numeric, 'FULL_APPROVAL', 'Travel to Bangalore undertaken for Annexure submission and IFMS Head meeting; full submitted claim approved.'),
      ('1377272b-3a84-4ff0-ac1c-1a23c924285b'::uuid, 'QPMSKA2487', 1295.08::numeric, 1295.08::numeric, 'FULL_APPROVAL', null),
      ('d7ccb49e-88be-4a5d-a2e4-03835ed93410'::uuid, 'QPMSKA0353', 7129.96::numeric, 5049.00::numeric, 'FINANCE_ADJUSTMENT', 'Management approved payable restricted to Rs.5,049.00. Finance requested reduction equivalent to 520 KM. Actual travelled KM retained unchanged.'),
      ('a33ec2f3-1ef5-4173-a10c-77e337ed7398'::uuid, 'QPMSKAC16966', 4175.36::numeric, 4175.36::numeric, 'FULL_APPROVAL', null),
      ('90adfd18-eda9-40ea-8f9b-5a1b50531245'::uuid, 'QPMSKA0173', 6319.76::numeric, 6319.76::numeric, 'FULL_APPROVAL', 'Travel to Bangalore undertaken for Annexure submission and IFMS Head meeting; full submitted claim approved.'),
      ('bf6057d1-9cfb-4522-93dc-050fed713609'::uuid, 'QPMSKA1542', 3100.24::numeric, 2680.40::numeric, 'FINANCE_ADJUSTMENT', 'Finance-approved payable for August-2026 is Rs.2,680.40.'),
      ('7eacaea6-0ff5-4175-94b8-ce913623f2a8'::uuid, '4176', 8841.12::numeric, 8841.12::numeric, 'FULL_APPROVAL', 'Travel to Bangalore undertaken for Annexure submission and IFMS Head meeting; full submitted claim approved.'),
      ('4e603e20-b4b0-446f-8b63-32c9bcf2fc6a'::uuid, 'QPMSKA4324', 464.40::numeric, 464.40::numeric, 'FULL_APPROVAL', null),
      ('5403fc64-94d9-4341-9e4b-a3ce3bf0f957'::uuid, 'QPMSKA3715', 4523.78::numeric, 4523.78::numeric, 'FULL_APPROVAL', null),
      ('fc352646-14dc-4ca7-9e27-1e2517630a0f'::uuid, 'QPMSKAC16986', 2330.20::numeric, 2330.20::numeric, 'FULL_APPROVAL', null)
  )
  select count(*)
    into v_resolved_count
  from approved_values v
  join public.profiles p
    on p.id = v.profile_id
   and p.employee_code = v.employee_code
   and upper(btrim(coalesce(p.state, ''))) in ('KA', 'KARNATAKA')
   and p.is_active is true;

  if v_resolved_count <> v_expected_count then
    raise exception 'Karnataka August-2026 settlement prerequisite failed: resolved % of % exact active profiles',
      v_resolved_count, v_expected_count;
  end if;

  with approved_values (
    profile_id,
    employee_code,
    calculated_claim_amount,
    approved_payable_amount,
    adjustment_type,
    adjustment_reason
  ) as (
    values
      ('2fefccc5-b8c2-40d5-bf4a-502b0c095324'::uuid, 'QPMSKA3846', 8130.20::numeric, 0.00::numeric, 'ADVANCE_ALREADY_PAID', 'Advance amount already paid; no further payment required against this claim.'),
      ('7061caa7-eadd-48b0-a680-9464eeea8bfc'::uuid, 'QPMSKA0958', 7862.12::numeric, 7862.12::numeric, 'FULL_APPROVAL', 'Travel to Bangalore undertaken for Annexure submission and IFMS Head meeting; full submitted claim approved.'),
      ('1377272b-3a84-4ff0-ac1c-1a23c924285b'::uuid, 'QPMSKA2487', 1295.08::numeric, 1295.08::numeric, 'FULL_APPROVAL', null),
      ('d7ccb49e-88be-4a5d-a2e4-03835ed93410'::uuid, 'QPMSKA0353', 7129.96::numeric, 5049.00::numeric, 'FINANCE_ADJUSTMENT', 'Management approved payable restricted to Rs.5,049.00. Finance requested reduction equivalent to 520 KM. Actual travelled KM retained unchanged.'),
      ('a33ec2f3-1ef5-4173-a10c-77e337ed7398'::uuid, 'QPMSKAC16966', 4175.36::numeric, 4175.36::numeric, 'FULL_APPROVAL', null),
      ('90adfd18-eda9-40ea-8f9b-5a1b50531245'::uuid, 'QPMSKA0173', 6319.76::numeric, 6319.76::numeric, 'FULL_APPROVAL', 'Travel to Bangalore undertaken for Annexure submission and IFMS Head meeting; full submitted claim approved.'),
      ('bf6057d1-9cfb-4522-93dc-050fed713609'::uuid, 'QPMSKA1542', 3100.24::numeric, 2680.40::numeric, 'FINANCE_ADJUSTMENT', 'Finance-approved payable for August-2026 is Rs.2,680.40.'),
      ('7eacaea6-0ff5-4175-94b8-ce913623f2a8'::uuid, '4176', 8841.12::numeric, 8841.12::numeric, 'FULL_APPROVAL', 'Travel to Bangalore undertaken for Annexure submission and IFMS Head meeting; full submitted claim approved.'),
      ('4e603e20-b4b0-446f-8b63-32c9bcf2fc6a'::uuid, 'QPMSKA4324', 464.40::numeric, 464.40::numeric, 'FULL_APPROVAL', null),
      ('5403fc64-94d9-4341-9e4b-a3ce3bf0f957'::uuid, 'QPMSKA3715', 4523.78::numeric, 4523.78::numeric, 'FULL_APPROVAL', null),
      ('fc352646-14dc-4ca7-9e27-1e2517630a0f'::uuid, 'QPMSKAC16986', 2330.20::numeric, 2330.20::numeric, 'FULL_APPROVAL', null)
  )
  insert into public.fo_monthly_travel_settlements (
    profile_id,
    employee_code,
    state,
    period_start,
    period_end,
    calculated_claim_amount,
    finance_reviewed_amount,
    approved_payable_amount,
    adjustment_amount,
    adjustment_type,
    adjustment_reason,
    remarks,
    source_reference,
    approved_by,
    approved_at
  )
  select
    v.profile_id,
    v.employee_code,
    'KA',
    date '2026-08-01',
    date '2026-08-31',
    v.calculated_claim_amount,
    v.approved_payable_amount,
    v.approved_payable_amount,
    round(v.approved_payable_amount - v.calculated_claim_amount, 2),
    v.adjustment_type,
    v.adjustment_reason,
    'Finance-approved Karnataka August-2026 travel settlement.',
    'August 2026 Karnataka Finance Approval',
    null,
    timezone('utc', now())
  from approved_values v
  on conflict (profile_id, period_start, period_end) do update
  set employee_code = excluded.employee_code,
      state = excluded.state,
      calculated_claim_amount = excluded.calculated_claim_amount,
      finance_reviewed_amount = excluded.finance_reviewed_amount,
      approved_payable_amount = excluded.approved_payable_amount,
      adjustment_amount = excluded.adjustment_amount,
      adjustment_type = excluded.adjustment_type,
      adjustment_reason = excluded.adjustment_reason,
      remarks = excluded.remarks,
      source_reference = excluded.source_reference,
      approved_by = excluded.approved_by,
      approved_at = coalesce(public.fo_monthly_travel_settlements.approved_at, excluded.approved_at)
  where (
    public.fo_monthly_travel_settlements.employee_code,
    public.fo_monthly_travel_settlements.state,
    public.fo_monthly_travel_settlements.calculated_claim_amount,
    public.fo_monthly_travel_settlements.finance_reviewed_amount,
    public.fo_monthly_travel_settlements.approved_payable_amount,
    public.fo_monthly_travel_settlements.adjustment_amount,
    public.fo_monthly_travel_settlements.adjustment_type,
    public.fo_monthly_travel_settlements.adjustment_reason,
    public.fo_monthly_travel_settlements.remarks,
    public.fo_monthly_travel_settlements.source_reference,
    public.fo_monthly_travel_settlements.approved_by
  ) is distinct from (
    excluded.employee_code,
    excluded.state,
    excluded.calculated_claim_amount,
    excluded.finance_reviewed_amount,
    excluded.approved_payable_amount,
    excluded.adjustment_amount,
    excluded.adjustment_type,
    excluded.adjustment_reason,
    excluded.remarks,
    excluded.source_reference,
    excluded.approved_by
  );

  if (
    select round(sum(approved_payable_amount), 2)
    from public.fo_monthly_travel_settlements
    where state = 'KA'
      and period_start = date '2026-08-01'
      and period_end = date '2026-08-31'
      and profile_id in (
        '2fefccc5-b8c2-40d5-bf4a-502b0c095324'::uuid,
        '7061caa7-eadd-48b0-a680-9464eeea8bfc'::uuid,
        '1377272b-3a84-4ff0-ac1c-1a23c924285b'::uuid,
        'd7ccb49e-88be-4a5d-a2e4-03835ed93410'::uuid,
        'a33ec2f3-1ef5-4173-a10c-77e337ed7398'::uuid,
        '90adfd18-eda9-40ea-8f9b-5a1b50531245'::uuid,
        'bf6057d1-9cfb-4522-93dc-050fed713609'::uuid,
        '7eacaea6-0ff5-4175-94b8-ce913623f2a8'::uuid,
        '4e603e20-b4b0-446f-8b63-32c9bcf2fc6a'::uuid,
        '5403fc64-94d9-4341-9e4b-a3ce3bf0f957'::uuid,
        'fc352646-14dc-4ca7-9e27-1e2517630a0f'::uuid
      )
  ) <> 43541.22::numeric then
    raise exception 'Karnataka August-2026 approved payable total verification failed';
  end if;
end
$seed$;

commit;
