-- 200: Canonical FO KM Engine V2 reconciliation.
--
-- Deliberately numbered outside the out-of-ledger 113-118 range. This file is
-- additive and must not be applied until the reviewed production preflight is
-- run. It never rewrites historical attendance or reimbursement rows by itself.

begin;

do $preflight$
declare
  v_table text;
  v_column record;
  v_v2_already_applied boolean :=
    to_regclass('public.fo_km_calculation_runs') is not null
    and to_regprocedure('public.rpc_persist_fo_canonical_km_v2(uuid,text,timestamp with time zone,jsonb,text,text)') is not null;
begin
  foreach v_table in array array[
    'fo_attendance',
    'fo_location_logs',
    'fo_site_visits',
    'fo_travel_legs',
    'fo_missing_km_reviews'
  ] loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'KM V2 preflight failed: required table public.% is missing', v_table;
    end if;
  end loop;

  if (to_regclass('public.fo_km_calculation_runs') is null) <>
     (to_regprocedure('public.rpc_persist_fo_canonical_km_v2(uuid,text,timestamp with time zone,jsonb,text,text)') is null) then
    raise exception 'KM V2 preflight failed: partial canonical V2 installation detected';
  end if;
  if not v_v2_already_applied and (
    to_regclass('public.fo_final_leg_reconciliation_runs') is not null
    or to_regprocedure('public.rpc_record_fo_final_leg_evidence_v1(jsonb,text)') is not null
  ) then
    raise exception 'KM V2 preflight failed: Migration 205 objects exist before Migration 200';
  end if;

  for v_column in
    select * from (values
      ('fo_attendance', 'id', 'uuid'),
      ('fo_attendance', 'fo_user_id', 'text'),
      ('fo_attendance', 'employee_code', 'text'),
      ('fo_attendance', 'attendance_date', 'date'),
      ('fo_attendance', 'logout_time', 'timestamptz'),
      ('fo_attendance', 'updated_at', 'timestamptz'),
      ('fo_attendance', 'status', 'text'),
      ('fo_attendance', 'end_latitude', 'numeric'),
      ('fo_attendance', 'end_longitude', 'numeric'),
      ('fo_attendance', 'rate_per_km', 'numeric'),
      ('fo_attendance', 'route_sync_status', 'text'),
      ('fo_attendance', 'metadata', 'jsonb'),
      ('fo_attendance', 'total_route_km', 'numeric'),
      ('fo_attendance', 'eligible_km', 'numeric'),
      ('fo_attendance', 'total_approved_km', 'numeric'),
      ('fo_attendance', 'petrol_amount', 'numeric'),
      ('fo_travel_legs', 'id', 'uuid'),
      ('fo_travel_legs', 'attendance_id', 'uuid'),
      ('fo_travel_legs', 'employee_code', 'text'),
      ('fo_travel_legs', 'fo_user_id', 'text'),
      ('fo_travel_legs', 'travel_mode', 'text'),
      ('fo_travel_legs', 'payable_km_allowed', 'bool'),
      ('fo_travel_legs', 'started_at', 'timestamptz'),
      ('fo_travel_legs', 'ended_at', 'timestamptz'),
      ('fo_travel_legs', 'start_lat', 'float8'),
      ('fo_travel_legs', 'start_lng', 'float8'),
      ('fo_travel_legs', 'end_lat', 'float8'),
      ('fo_travel_legs', 'end_lng', 'float8'),
      ('fo_travel_legs', 'calculated_km', 'numeric'),
      ('fo_travel_legs', 'payable_km', 'numeric'),
      ('fo_travel_legs', 'rate_per_km', 'numeric'),
      ('fo_travel_legs', 'payable_amount', 'numeric'),
      ('fo_travel_legs', 'fare_amount', 'numeric'),
      ('fo_travel_legs', 'status', 'text'),
      ('fo_travel_legs', 'updated_at', 'timestamptz'),
      ('fo_site_visits', 'id', 'uuid'),
      ('fo_site_visits', 'attendance_id', 'uuid'),
      ('fo_site_visits', 'check_in_time', 'timestamptz'),
      ('fo_site_visits', 'check_out_time', 'timestamptz'),
      ('fo_site_visits', 'check_out_latitude', 'numeric'),
      ('fo_site_visits', 'check_out_longitude', 'numeric'),
      ('fo_site_visits', 'route_km', 'numeric'),
      ('fo_location_logs', 'id', 'uuid'),
      ('fo_location_logs', 'attendance_id', 'uuid'),
      ('fo_location_logs', 'latitude', 'numeric'),
      ('fo_location_logs', 'longitude', 'numeric'),
      ('fo_location_logs', 'accuracy', 'numeric'),
      ('fo_location_logs', 'captured_at', 'timestamptz'),
      ('fo_missing_km_reviews', 'attendance_id', 'uuid'),
      ('fo_missing_km_reviews', 'status', 'text'),
      ('fo_missing_km_reviews', 'approved_missing_km', 'numeric'),
      ('fo_missing_km_reviews', 'approved_amount', 'numeric')
    ) as expected(table_name, column_name, udt_name)
  loop
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = v_column.table_name
        and c.column_name = v_column.column_name
        and c.udt_name = v_column.udt_name
    ) then
      raise exception 'KM V2 preflight failed: expected %.% type %',
        v_column.table_name, v_column.column_name, v_column.udt_name;
    end if;
  end loop;

  if not exists (
    select 1
    from pg_index i
    join pg_class idx on idx.oid = i.indexrelid
    join pg_class tbl on tbl.oid = i.indrelid
    join pg_namespace n on n.oid = tbl.relnamespace
    where n.nspname = 'public'
      and tbl.relname = 'fo_travel_legs'
      and idx.relname = 'ux_fo_travel_legs_attendance_started'
      and i.indisunique
      and pg_get_indexdef(i.indexrelid) like '%(attendance_id, started_at)%'
  ) then
    raise exception 'KM V2 preflight failed: unique attendance/start travel-leg index is missing or incompatible';
  end if;

  if exists (
    select 1 from (values
      ('fo_attendance'), ('fo_location_logs'), ('fo_site_visits'),
      ('fo_travel_legs'), ('fo_missing_km_reviews')
    ) as required_rls(table_name)
    where not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = required_rls.table_name and c.relrowsecurity
    )
  ) then
    raise exception 'KM V2 preflight failed: required RLS is not enabled';
  end if;

  if to_regprocedure('public.refresh_fo_attendance_actual_travel_km(uuid)') is null
     or to_regprocedure('public.refresh_fo_attendance_payable_route_km(uuid)') is null then
    raise exception 'KM V2 preflight failed: expected legacy refresh functions are missing';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'fo_location_logs'
      and t.tgname = 'trg_fo_location_logs_actual_travel_km'
      and pg_get_triggerdef(t.oid) like '%trg_refresh_fo_attendance_actual_travel_km%'
      and not t.tgisinternal
  ) then
    raise exception 'KM V2 preflight failed: expected location audit trigger is missing';
  end if;

  if not v_v2_already_applied and exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'fo_location_logs'
      and t.tgname = 'trg_fo_location_logs_actual_travel_km'
      and t.tgenabled = 'D'
      and not t.tgisinternal
  ) then
    raise exception 'KM V2 preflight failed: legacy location audit trigger was disabled before first V2 application';
  end if;

  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'fo_site_visits'
      and t.tgname = 'trg_fo_site_visits_payable_route_km'
      and t.tgenabled <> 'D'
      and pg_get_triggerdef(t.oid) like '%trg_refresh_fo_attendance_payable_route_km%'
      and not t.tgisinternal
  ) then
    raise exception 'KM V2 preflight failed: expected site-visit provisional trigger is missing';
  end if;

  if not has_function_privilege('service_role', 'public.refresh_fo_attendance_payable_route_km(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.refresh_fo_attendance_payable_route_km(uuid)', 'EXECUTE') then
    raise exception 'KM V2 preflight failed: legacy payable refresh grants are incompatible';
  end if;
end
$preflight$;

create table if not exists public.fo_km_v2_recovery_snapshot (
  snapshot_key text primary key,
  actual_travel_function_def text not null,
  payable_route_function_def text not null,
  location_trigger_enabled "char" not null,
  captured_at timestamptz not null default now(),
  constraint fo_km_v2_recovery_snapshot_key_check check (snapshot_key = 'pre_v2')
);

insert into public.fo_km_v2_recovery_snapshot (
  snapshot_key,
  actual_travel_function_def,
  payable_route_function_def,
  location_trigger_enabled
)
select
  'pre_v2',
  pg_get_functiondef(to_regprocedure('public.refresh_fo_attendance_actual_travel_km(uuid)')),
  pg_get_functiondef(to_regprocedure('public.refresh_fo_attendance_payable_route_km(uuid)')),
  t.tgenabled
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'fo_location_logs'
  and t.tgname = 'trg_fo_location_logs_actual_travel_km'
  and not t.tgisinternal
on conflict (snapshot_key) do nothing;

alter table public.fo_km_v2_recovery_snapshot enable row level security;
revoke all on table public.fo_km_v2_recovery_snapshot from public, anon, authenticated;
grant select on table public.fo_km_v2_recovery_snapshot to service_role;

alter table public.fo_travel_legs
  add column if not exists calculation_version text,
  add column if not exists calculation_run_id uuid,
  add column if not exists canonical_calculated boolean not null default false,
  add column if not exists superseded_at timestamptz;

do $constraints$
begin
  if not exists (select 1 from pg_constraint where conname = 'fo_travel_legs_v2_nonnegative_check') then
    alter table public.fo_travel_legs add constraint fo_travel_legs_v2_nonnegative_check
      check (coalesce(calculated_km, 0) >= 0 and coalesce(payable_km, 0) >= 0
        and coalesce(payable_amount, 0) >= 0 and coalesce(rate_per_km, 0) >= 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fo_travel_legs_v2_time_check') then
    alter table public.fo_travel_legs add constraint fo_travel_legs_v2_time_check
      check (ended_at is null or started_at is null or ended_at >= started_at) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fo_attendance_v2_nonnegative_check') then
    alter table public.fo_attendance add constraint fo_attendance_v2_nonnegative_check
      check (coalesce(total_route_km, 0) >= 0 and coalesce(eligible_km, 0) >= 0
        and coalesce(total_approved_km, 0) >= 0 and coalesce(petrol_amount, 0) >= 0) not valid;
  end if;
end
$constraints$;

create table if not exists public.fo_km_calculation_runs (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.fo_attendance(id) on delete restrict,
  calculation_version text not null,
  input_digest text not null,
  input_row_count integer not null default 0,
  accepted_point_count integer not null default 0,
  rejected_point_counts_by_reason jsonb not null default '{}'::jsonb,
  accepted_gps_km numeric(14,2) not null default 0,
  reconstructed_gap_km numeric(14,2) not null default 0,
  direct_google_km numeric(14,2),
  payable_km numeric(14,2) not null default 0,
  reimbursement numeric(14,2) not null default 0,
  mode_rate_snapshot jsonb not null default '[]'::jsonb,
  risk_flags jsonb not null default '[]'::jsonb,
  decision text not null,
  calculation_reason text,
  source_entry_point text not null,
  dry_run boolean not null default false,
  actor_source text,
  source_row_ids jsonb not null default '[]'::jsonb,
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint fo_km_calculation_runs_version_check check (calculation_version = 'KM_ENGINE_V2'),
  constraint fo_km_calculation_runs_digest_check check (input_digest ~ '^[0-9a-f]{64}$'),
  constraint fo_km_calculation_runs_nonnegative_check check (
    input_row_count >= 0
    and accepted_point_count >= 0
    and accepted_gps_km >= 0
    and reconstructed_gap_km >= 0
    and (direct_google_km is null or direct_google_km >= 0)
    and payable_km >= 0
    and reimbursement >= 0
  ),
  constraint fo_km_calculation_runs_decision_check check (
    decision in ('ACCEPTED', 'ACCEPTED_WITH_WARNING', 'MANUAL_REVIEW', 'REJECTED')
  ),
  constraint fo_km_calculation_runs_rejections_object_check check (
    jsonb_typeof(rejected_point_counts_by_reason) = 'object'
  ),
  constraint fo_km_calculation_runs_result_object_check check (jsonb_typeof(result) = 'object'),
  constraint fo_km_calculation_runs_attendance_digest_key unique (
    attendance_id, calculation_version, input_digest
  )
);

-- The database gate is the authority for persistence. Railway environment
-- flags are an additional operational brake, never the only protection.
create table if not exists public.fo_km_financial_control (
  control_key text primary key,
  financial_writes_enabled boolean not null default false,
  changed_by uuid,
  changed_by_identity text,
  change_reason text,
  changed_at timestamptz not null default now(),
  constraint fo_km_financial_control_key_check check (control_key = 'canonical_v2')
);

insert into public.fo_km_financial_control (control_key, financial_writes_enabled, change_reason)
values ('canonical_v2', false, 'Migration 200 installs fail-closed')
on conflict (control_key) do nothing;

create table if not exists public.fo_km_financial_control_audit (
  id uuid primary key default gen_random_uuid(),
  control_key text not null check (control_key = 'canonical_v2'),
  financial_writes_enabled boolean not null,
  reviewer_user_id uuid not null,
  reviewer_identity text not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.fo_km_financial_approvals (
  id uuid primary key default gen_random_uuid(),
  attendance_id uuid not null references public.fo_attendance(id) on delete restrict,
  input_digest text not null,
  expected_attendance_updated_at timestamptz not null,
  before_total_route_km numeric(14,2) not null,
  before_eligible_km numeric(14,2) not null,
  before_total_approved_km numeric(14,2) not null,
  before_petrol_amount numeric(14,2) not null,
  after_total_route_km numeric(14,2) not null,
  after_eligible_km numeric(14,2) not null,
  after_total_approved_km numeric(14,2) not null,
  after_petrol_amount numeric(14,2) not null,
  reviewer_user_id uuid not null,
  reviewer_identity text not null,
  approval_reason text not null,
  approved_at timestamptz not null default now(),
  constraint fo_km_financial_approvals_digest_check check (input_digest ~ '^[0-9a-f]{64}$'),
  constraint fo_km_financial_approvals_nonnegative_check check (
    before_total_route_km >= 0 and before_eligible_km >= 0
    and before_total_approved_km >= 0 and before_petrol_amount >= 0
    and after_total_route_km >= 0 and after_eligible_km >= 0
    and after_total_approved_km >= 0 and after_petrol_amount >= 0
  ),
  constraint fo_km_financial_approvals_attendance_digest_key unique (attendance_id, input_digest)
);

create table if not exists public.fo_km_financial_approval_consumptions (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null unique references public.fo_km_financial_approvals(id) on delete restrict,
  attendance_id uuid not null references public.fo_attendance(id) on delete restrict,
  calculation_run_id uuid not null unique references public.fo_km_calculation_runs(id) on delete restrict,
  input_digest text not null,
  consumed_at timestamptz not null default now(),
  constraint fo_km_financial_consumptions_digest_check check (input_digest ~ '^[0-9a-f]{64}$')
);

create or replace function public.trg_reject_fo_km_audit_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  raise exception using errcode = '55000', message = 'km_v2_immutable_audit_record';
end
$function$;

drop trigger if exists trg_immutable_fo_km_financial_approvals on public.fo_km_financial_approvals;
create trigger trg_immutable_fo_km_financial_approvals
before update or delete on public.fo_km_financial_approvals
for each row execute function public.trg_reject_fo_km_audit_mutation();

drop trigger if exists trg_immutable_fo_km_financial_consumptions on public.fo_km_financial_approval_consumptions;
create trigger trg_immutable_fo_km_financial_consumptions
before update or delete on public.fo_km_financial_approval_consumptions
for each row execute function public.trg_reject_fo_km_audit_mutation();

drop trigger if exists trg_immutable_fo_km_financial_control_audit on public.fo_km_financial_control_audit;
create trigger trg_immutable_fo_km_financial_control_audit
before update or delete on public.fo_km_financial_control_audit
for each row execute function public.trg_reject_fo_km_audit_mutation();

create index if not exists idx_fo_km_calculation_runs_attendance_created
  on public.fo_km_calculation_runs(attendance_id, created_at desc);
create index if not exists idx_fo_km_calculation_runs_decision_created
  on public.fo_km_calculation_runs(decision, created_at desc);
create index if not exists idx_fo_travel_legs_canonical_run
  on public.fo_travel_legs(attendance_id, calculation_run_id)
  where canonical_calculated is true;

alter table public.fo_km_calculation_runs enable row level security;
revoke all on table public.fo_km_calculation_runs from public, anon, authenticated;
grant select on table public.fo_km_calculation_runs to service_role;

drop policy if exists "fo_km_calculation_runs_service_role" on public.fo_km_calculation_runs;
create policy "fo_km_calculation_runs_service_role"
  on public.fo_km_calculation_runs
  for all
  to service_role
  using (true)
  with check (true);

alter table public.fo_km_financial_control enable row level security;
alter table public.fo_km_financial_control_audit enable row level security;
alter table public.fo_km_financial_approvals enable row level security;
alter table public.fo_km_financial_approval_consumptions enable row level security;
revoke all on table public.fo_km_financial_control from public, anon, authenticated, service_role;
revoke all on table public.fo_km_financial_control_audit from public, anon, authenticated, service_role;
revoke all on table public.fo_km_financial_approvals from public, anon, authenticated, service_role;
revoke all on table public.fo_km_financial_approval_consumptions from public, anon, authenticated, service_role;
grant select on table public.fo_km_financial_control to service_role;
grant select on table public.fo_km_financial_control_audit to service_role;
grant select on table public.fo_km_financial_approvals to service_role;
grant select on table public.fo_km_financial_approval_consumptions to service_role;

create or replace function public.rpc_get_fo_km_financial_write_state_v1()
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $function$
  select jsonb_build_object(
    'financial_writes_enabled', financial_writes_enabled,
    'changed_at', changed_at,
    'change_reason', change_reason
  )
  from public.fo_km_financial_control
  where control_key = 'canonical_v2'
$function$;

create or replace function public.rpc_set_fo_km_financial_write_state_v1(
  p_enabled boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_reviewer uuid := auth.uid();
  v_identity text := coalesce(
    auth.jwt() ->> 'email',
    auth.jwt() ->> 'employee_code',
    v_reviewer::text
  );
begin
  if v_reviewer is null or not public.is_qpms_admin() then
    raise exception using errcode = '42501', message = 'km_v2_financial_control_admin_required';
  end if;
  if p_enabled is null or nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'km_v2_financial_control_reason_required';
  end if;

  update public.fo_km_financial_control
  set financial_writes_enabled = p_enabled,
      changed_by = v_reviewer,
      changed_by_identity = v_identity,
      change_reason = trim(p_reason),
      changed_at = now()
  where control_key = 'canonical_v2';

  insert into public.fo_km_financial_control_audit (
    control_key, financial_writes_enabled, reviewer_user_id, reviewer_identity, reason
  ) values ('canonical_v2', p_enabled, v_reviewer, v_identity, trim(p_reason));

  return jsonb_build_object('ok', true, 'financial_writes_enabled', p_enabled);
end
$function$;

create or replace function public.rpc_approve_fo_km_financial_change_v1(
  p_attendance_id uuid,
  p_input_digest text,
  p_expected_attendance_updated_at timestamptz,
  p_before_total_route_km numeric,
  p_before_eligible_km numeric,
  p_before_total_approved_km numeric,
  p_before_petrol_amount numeric,
  p_after_total_route_km numeric,
  p_after_eligible_km numeric,
  p_after_total_approved_km numeric,
  p_after_petrol_amount numeric,
  p_approval_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_attendance public.fo_attendance%rowtype;
  v_approval public.fo_km_financial_approvals%rowtype;
  v_reviewer uuid := auth.uid();
  v_identity text := coalesce(
    auth.jwt() ->> 'email',
    auth.jwt() ->> 'employee_code',
    v_reviewer::text
  );
begin
  if v_reviewer is null or not public.is_qpms_admin() then
    raise exception using errcode = '42501', message = 'km_v2_financial_approval_admin_required';
  end if;
  if p_attendance_id is null or coalesce(p_input_digest, '') !~ '^[0-9a-f]{64}$'
     or p_expected_attendance_updated_at is null
     or nullif(trim(coalesce(p_approval_reason, '')), '') is null then
    raise exception using errcode = '22023', message = 'km_v2_financial_approval_input_invalid';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_attendance_id::text, 0));
  select * into v_attendance from public.fo_attendance
  where id = p_attendance_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'km_v2_financial_approval_attendance_not_found';
  end if;
  if v_attendance.updated_at is distinct from p_expected_attendance_updated_at
     or round(coalesce(v_attendance.total_route_km, 0), 2) <> round(coalesce(p_before_total_route_km, -1), 2)
     or round(coalesce(v_attendance.eligible_km, 0), 2) <> round(coalesce(p_before_eligible_km, -1), 2)
     or round(coalesce(v_attendance.total_approved_km, 0), 2) <> round(coalesce(p_before_total_approved_km, -1), 2)
     or round(coalesce(v_attendance.petrol_amount, 0), 2) <> round(coalesce(p_before_petrol_amount, -1), 2) then
    raise exception using errcode = '40001', message = 'km_v2_financial_approval_stale_before_state';
  end if;

  insert into public.fo_km_financial_approvals (
    attendance_id, input_digest, expected_attendance_updated_at,
    before_total_route_km, before_eligible_km, before_total_approved_km, before_petrol_amount,
    after_total_route_km, after_eligible_km, after_total_approved_km, after_petrol_amount,
    reviewer_user_id, reviewer_identity, approval_reason
  ) values (
    p_attendance_id, p_input_digest, p_expected_attendance_updated_at,
    round(p_before_total_route_km, 2), round(p_before_eligible_km, 2),
    round(p_before_total_approved_km, 2), round(p_before_petrol_amount, 2),
    round(p_after_total_route_km, 2), round(p_after_eligible_km, 2),
    round(p_after_total_approved_km, 2), round(p_after_petrol_amount, 2),
    v_reviewer, v_identity, trim(p_approval_reason)
  )
  on conflict (attendance_id, input_digest) do nothing
  returning * into v_approval;

  if not found then
    select * into v_approval from public.fo_km_financial_approvals
    where attendance_id = p_attendance_id and input_digest = p_input_digest;
    if v_approval.expected_attendance_updated_at is distinct from p_expected_attendance_updated_at
       or v_approval.before_total_route_km <> round(p_before_total_route_km, 2)
       or v_approval.before_eligible_km <> round(p_before_eligible_km, 2)
       or v_approval.before_total_approved_km <> round(p_before_total_approved_km, 2)
       or v_approval.before_petrol_amount <> round(p_before_petrol_amount, 2)
       or v_approval.after_total_route_km <> round(p_after_total_route_km, 2)
       or v_approval.after_eligible_km <> round(p_after_eligible_km, 2)
       or v_approval.after_total_approved_km <> round(p_after_total_approved_km, 2)
       or v_approval.after_petrol_amount <> round(p_after_petrol_amount, 2) then
      raise exception using errcode = '40001', message = 'km_v2_financial_approval_digest_state_mismatch';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'approval_id', v_approval.id, 'input_digest', v_approval.input_digest);
end
$function$;

alter function public.rpc_get_fo_km_financial_write_state_v1() owner to postgres;
alter function public.rpc_set_fo_km_financial_write_state_v1(boolean, text) owner to postgres;
alter function public.rpc_approve_fo_km_financial_change_v1(
  uuid, text, timestamptz, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text
) owner to postgres;
revoke all on function public.rpc_get_fo_km_financial_write_state_v1() from public, anon, authenticated;
grant execute on function public.rpc_get_fo_km_financial_write_state_v1() to service_role;
revoke all on function public.rpc_set_fo_km_financial_write_state_v1(boolean, text) from public, anon, service_role;
grant execute on function public.rpc_set_fo_km_financial_write_state_v1(boolean, text) to authenticated;
revoke all on function public.rpc_approve_fo_km_financial_change_v1(
  uuid, text, timestamptz, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text
) from public, anon, service_role;
grant execute on function public.rpc_approve_fo_km_financial_change_v1(
  uuid, text, timestamptz, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text
) to authenticated;

-- Location-trigger output is retained as cheap audit evidence only. It no
-- longer writes actual_km or any payable/approved/reimbursement field.
create or replace function public.refresh_fo_attendance_actual_travel_km(
  p_attendance_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if p_attendance_id is null then return; end if;

  with ordered_logs as (
    select
      id,
      latitude::numeric as latitude,
      longitude::numeric as longitude,
      accuracy::numeric as accuracy,
      coalesce(captured_at, logged_at, created_at) as captured_at
    from public.fo_location_logs
    where attendance_id = p_attendance_id
      and latitude::numeric between -90 and 90
      and longitude::numeric between -180 and 180
      and not (latitude::numeric = 0 and longitude::numeric = 0)
      and coalesce(is_mocked, false) = false
      and coalesce(accuracy, 999999) <= 50
  ), paired as (
    select *,
      lag(latitude) over (order by captured_at, id) as previous_latitude,
      lag(longitude) over (order by captured_at, id) as previous_longitude,
      lag(captured_at) over (order by captured_at, id) as previous_captured_at,
      lag(accuracy) over (order by captured_at, id) as previous_accuracy
    from ordered_logs
  ), segments as (
    select
      extract(epoch from captured_at - previous_captured_at) as gap_seconds,
      accuracy,
      previous_accuracy,
      6371 * 2 * asin(least(1, sqrt(
        power(sin(radians((latitude - previous_latitude) / 2)), 2)
        + cos(radians(previous_latitude)) * cos(radians(latitude))
          * power(sin(radians((longitude - previous_longitude) / 2)), 2)
      ))) as segment_km
    from paired
    where previous_latitude is not null and previous_longitude is not null
  ), totals as (
    select
      coalesce(sum(segment_km) filter (where gap_seconds > 0 and segment_km * 1000 >= 5), 0) as raw_km,
      coalesce(sum(segment_km) filter (
        where gap_seconds > 0 and gap_seconds <= 600
          and segment_km * 1000 between 5 and 1000
          and (segment_km * 1000) / nullif(gap_seconds, 0) <= 33.33
          and coalesce(accuracy, 999999) <= 50
          and coalesce(previous_accuracy, 999999) <= 50
      ), 0) as filtered_km
    from segments
  )
  update public.fo_attendance a
  set raw_gps_km = round(t.raw_km::numeric, 2),
      filtered_gps_km = round(t.filtered_km::numeric, 2),
      actual_travel_km = round(t.filtered_km::numeric, 2),
      total_raw_km = round(t.raw_km::numeric, 2),
      actual_travel_updated_at = now(),
      metadata = coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object(
        'gps_trigger_role', 'evidence_only',
        'gps_trigger_calculation_version', 'KM_ENGINE_V2_AUDIT'
      ),
      updated_at = now()
  from totals t
  where a.id = p_attendance_id;
end
$function$;

-- Recomputing an entire attendance after every GPS insert is both competing
-- calculation authority and O(n^2) ingestion work. V2 calculates audit and
-- financial evidence at explicit lifecycle/scheduler entry points instead.
alter table public.fo_location_logs
  disable trigger trg_fo_location_logs_actual_travel_km;

-- Old clients may still submit visit route evidence during an active day. The
-- value is explicitly provisional and can never overwrite a V2-finalized row.
create or replace function public.refresh_fo_attendance_payable_route_km(
  p_attendance_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_has_travel_legs boolean;
begin
  if p_attendance_id is null then return; end if;
  if not exists (
    select 1 from public.fo_km_financial_control
    where control_key = 'canonical_v2' and financial_writes_enabled is true
  ) then
    return;
  end if;
  select exists (
    select 1 from public.fo_travel_legs l
    where l.attendance_id = p_attendance_id
      and lower(coalesce(l.status, '')) <> 'cancelled'
  ) into v_has_travel_legs;
  if v_has_travel_legs then return; end if;

  update public.fo_attendance a
  set total_route_km = case when lower(coalesce(a.travel_mode, 'bike')) in ('bike','own_vehicle','car') then r.route_km else 0 end,
      eligible_km = case when lower(coalesce(a.travel_mode, 'bike')) in ('bike','own_vehicle','car') then r.route_km else 0 end,
      total_approved_km = case when lower(coalesce(a.travel_mode, 'bike')) in ('bike','own_vehicle','car') then r.route_km else 0 end,
      petrol_amount = case
        when lower(coalesce(a.travel_mode, 'bike')) in ('bike','own_vehicle') then round(r.route_km * 4, 2)
        when lower(coalesce(a.travel_mode, '')) = 'car' then round(r.route_km * 8, 2)
        else 0 end,
      route_sync_status = 'legacy_provisional_active_day',
      metadata = coalesce(a.metadata, '{}'::jsonb) || jsonb_build_object(
        'financial_authority', 'provisional_old_client',
        'canonical_v2_pending', true
      ),
      updated_at = now()
  from (
    select round(coalesce(sum(route_km) filter (where route_km > 0), 0)::numeric, 2) as route_km
    from public.fo_site_visits where attendance_id = p_attendance_id
  ) r
  where a.id = p_attendance_id
    and lower(coalesce(a.status, '')) = 'active'
    and a.logout_time is null
    and coalesce(a.route_sync_status, '') not like 'canonical_v2%'
    and coalesce(a.metadata ->> 'km_calculation_version', '') <> 'KM_ENGINE_V2';
end
$function$;

revoke all on function public.refresh_fo_attendance_actual_travel_km(uuid)
  from public, anon, authenticated;
revoke all on function public.refresh_fo_attendance_payable_route_km(uuid)
  from public, anon, authenticated;
grant execute on function public.refresh_fo_attendance_actual_travel_km(uuid) to service_role;
grant execute on function public.refresh_fo_attendance_payable_route_km(uuid) to service_role;

-- Once V2 has finalized an attendance, authenticated/legacy clients may still
-- send their old provisional fields but cannot overwrite canonical money.
create or replace function public.trg_protect_fo_canonical_km_v2_financials()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
declare
  v_request_role text := coalesce(
    current_setting('request.jwt.claim.role', true),
    (coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb ->> 'role'),
    ''
  );
  v_authorized_financial_write boolean :=
    coalesce(current_setting('app.km_v2_authorized_financial_write', true) = 'true', false);
  v_financial_changed boolean;
begin
  v_financial_changed :=
    new.total_route_km is distinct from old.total_route_km
    or new.eligible_km is distinct from old.eligible_km
    or new.total_approved_km is distinct from old.total_approved_km
    or new.petrol_amount is distinct from old.petrol_amount;

  if session_user <> 'postgres' and (
    coalesce(old.metadata ->> 'km_calculation_version', '') = 'KM_ENGINE_V2'
    or (
      new.logout_time is not null
      and lower(coalesce(new.status, '')) <> 'active'
    )
  ) then
    if v_request_role = 'service_role' and v_financial_changed and not v_authorized_financial_write then
      raise exception using errcode = '55000', message = 'km_v2_direct_financial_write_not_authorized';
    end if;
    if v_request_role <> 'service_role' then
      new.total_route_km := old.total_route_km;
      new.eligible_km := old.eligible_km;
      new.total_approved_km := old.total_approved_km;
      new.petrol_amount := old.petrol_amount;
      new.route_sync_status := case
        when coalesce(old.metadata ->> 'km_calculation_version', '') = 'KM_ENGINE_V2'
          then old.route_sync_status
        else 'pending_canonical_end_day_recalculation'
      end;
      new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
        'km_calculation_version', old.metadata ->> 'km_calculation_version',
        'km_calculation_run_id', old.metadata ->> 'km_calculation_run_id',
        'km_input_digest', old.metadata ->> 'km_input_digest',
        'financial_authority', old.metadata ->> 'financial_authority'
      ) || case
        when coalesce(old.metadata ->> 'km_calculation_version', '') = 'KM_ENGINE_V2' then '{}'::jsonb
        else jsonb_build_object(
          'canonical_recalculation_pending', true,
          'financial_authority', 'backend_canonical_v2_pending'
        )
      end;
    end if;
  end if;
  return new;
end
$function$;

drop trigger if exists trg_protect_fo_canonical_km_v2_financials on public.fo_attendance;
create trigger trg_protect_fo_canonical_km_v2_financials
before update of total_route_km, eligible_km, total_approved_km, petrol_amount,
  route_sync_status, metadata
on public.fo_attendance
for each row execute function public.trg_protect_fo_canonical_km_v2_financials();

create or replace function public.rpc_persist_fo_canonical_km_v2(
  p_attendance_id uuid,
  p_input_digest text,
  p_expected_attendance_updated_at timestamptz,
  p_calculation jsonb,
  p_source_entry_point text,
  p_actor_source text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_attendance public.fo_attendance%rowtype;
  v_existing public.fo_km_calculation_runs%rowtype;
  v_run_id uuid := gen_random_uuid();
  v_leg jsonb;
  v_started_at timestamptz;
  v_payable_leg_km numeric := 0;
  v_payable_leg_amount numeric := 0;
  v_missing_km numeric := 0;
  v_missing_amount numeric := 0;
  v_total_km numeric := 0;
  v_total_amount numeric := 0;
  v_authoritative_correction jsonb;
  v_expected_route_km numeric := 0;
  v_expected_total_km numeric := 0;
  v_expected_total_amount numeric := 0;
  v_financial_changes boolean := false;
  v_financial_writes_enabled boolean := false;
  v_unresolved_final_leg_evidence boolean := false;
  v_has_payable_final_leg boolean := false;
  v_proposed_final_leg_km numeric := 0;
  v_approved_final_evidence_km numeric := null;
  v_approval public.fo_km_financial_approvals%rowtype;
  v_current_started_at timestamptz[] := array[]::timestamptz[];
begin
  if p_attendance_id is null or p_calculation is null then
    raise exception using errcode = '22023', message = 'km_v2_required_input_missing';
  end if;
  if coalesce(p_calculation ->> 'calculationVersion', '') <> 'KM_ENGINE_V2'
     or coalesce(p_input_digest, '') !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'km_v2_invalid_version_or_digest';
  end if;
  if coalesce(p_source_entry_point, '') = '' then
    raise exception using errcode = '22023', message = 'km_v2_source_entry_point_required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_attendance_id::text, 0));

  select * into v_attendance
  from public.fo_attendance
  where id = p_attendance_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'km_v2_attendance_not_found';
  end if;

  if exists (
    select 1 from public.fo_travel_legs
    where attendance_id = p_attendance_id
      and lower(coalesce(status, '')) <> 'cancelled'
      and started_at is not null
      and ended_at is not null
      and ended_at < started_at
  ) then
    raise exception using errcode = '22023', message = 'km_v2_legacy_invalid_leg_time_manual_review';
  end if;

  select * into v_existing
  from public.fo_km_calculation_runs
  where attendance_id = p_attendance_id
    and calculation_version = 'KM_ENGINE_V2'
    and input_digest = p_input_digest;
  if found then
    v_expected_route_km := coalesce(
      (v_existing.result #>> '{authoritativeAppliedCorrection,routeKm}')::numeric,
      v_existing.payable_km - coalesce((v_existing.result ->> 'approvedMissingKm')::numeric, 0)
    );
    if coalesce(v_attendance.metadata ->> 'km_calculation_version', '') <> 'KM_ENGINE_V2'
       or coalesce(v_attendance.metadata ->> 'km_calculation_run_id', '') <> v_existing.id::text
       or coalesce(v_attendance.metadata ->> 'km_input_digest', '') <> p_input_digest
       or coalesce(v_attendance.total_route_km, 0) <> coalesce(v_expected_route_km, 0)
       or coalesce(v_attendance.total_approved_km, 0) <> v_existing.payable_km
       or coalesce(v_attendance.eligible_km, 0) <> v_existing.payable_km
       or coalesce(v_attendance.petrol_amount, 0) <> v_existing.reimbursement then
      raise exception using errcode = '40001', message = 'km_v2_idempotent_replay_state_mismatch';
    end if;
    return jsonb_build_object(
      'ok', true, 'idempotent_replay', true, 'calculation_run_id', v_existing.id,
      'payable_km', v_existing.payable_km, 'reimbursement', v_existing.reimbursement
    );
  end if;

  if p_expected_attendance_updated_at is null
     or v_attendance.updated_at is distinct from p_expected_attendance_updated_at then
    raise exception using errcode = '40001', message = 'km_v2_stale_input_digest';
  end if;

  select financial_writes_enabled into v_financial_writes_enabled
  from public.fo_km_financial_control
  where control_key = 'canonical_v2'
  for share;
  if coalesce(v_financial_writes_enabled, false) is not true then
    raise exception using errcode = '55000', message = 'km_v2_database_financial_writes_closed';
  end if;

  select
    coalesce(round(sum(
      case when coalesce(value ->> 'decision', 'REJECTED') in ('ACCEPTED', 'ACCEPTED_WITH_WARNING')
        then greatest(coalesce((value ->> 'payableKm')::numeric, 0), 0) else 0 end
    )::numeric, 2), 0),
    coalesce(round(sum(
      case when coalesce(value ->> 'decision', 'REJECTED') in ('ACCEPTED', 'ACCEPTED_WITH_WARNING')
        then greatest(coalesce((value ->> 'payableAmount')::numeric, 0), 0) else 0 end
    )::numeric, 2), 0),
    coalesce(bool_or(
      coalesce(value ->> 'type', '') = 'last_checkout_to_end_day'
      and coalesce(value ->> 'decision', 'REJECTED') in ('ACCEPTED', 'ACCEPTED_WITH_WARNING')
      and greatest(coalesce((value ->> 'payableKm')::numeric, 0), 0) > 0
    ), false),
    coalesce(round(max(
      case when coalesce(value ->> 'type', '') = 'last_checkout_to_end_day'
        and coalesce(value ->> 'decision', 'REJECTED') in ('ACCEPTED', 'ACCEPTED_WITH_WARNING')
        then greatest(coalesce((value ->> 'payableKm')::numeric, 0), 0) else 0 end
    )::numeric, 2), 0)
  into v_payable_leg_km, v_payable_leg_amount, v_has_payable_final_leg, v_proposed_final_leg_km
  from jsonb_array_elements(coalesce(p_calculation -> 'canonicalLegs', '[]'::jsonb));

  select
    coalesce(round(sum(approved_missing_km)::numeric, 2), 0),
    coalesce(round(sum(approved_amount)::numeric, 2), 0)
  into v_missing_km, v_missing_amount
  from public.fo_missing_km_reviews
  where attendance_id = p_attendance_id and status = 'approved';

  v_expected_route_km := v_payable_leg_km;
  v_expected_total_km := round(v_payable_leg_km + v_missing_km, 2);
  v_expected_total_amount := round(v_payable_leg_amount + v_missing_amount, 2);
  v_authoritative_correction := p_calculation -> 'authoritativeAppliedCorrection';
  if jsonb_typeof(v_authoritative_correction) = 'object'
     and coalesce(v_authoritative_correction ->> 'reason', '') = 'PRESERVE_APPLIED_CORRECTION' then
    if coalesce((v_authoritative_correction ->> 'payableKm')::numeric, -1) < 0
       or coalesce((v_authoritative_correction ->> 'reimbursement')::numeric, -1) < 0
       or coalesce((v_authoritative_correction ->> 'routeKm')::numeric, -1) < 0 then
      raise exception using errcode = '22023', message = 'km_v2_invalid_authoritative_correction_state';
    end if;
    v_expected_route_km := round((v_authoritative_correction ->> 'routeKm')::numeric, 2);
    v_expected_total_km := round((v_authoritative_correction ->> 'payableKm')::numeric, 2);
    v_expected_total_amount := round((v_authoritative_correction ->> 'reimbursement')::numeric, 2);
  end if;

  if to_regclass('public.fo_final_leg_reconciliation_runs') is not null then
    if to_regclass('public.fo_final_leg_reconciliation_resolutions') is null then
      raise exception using errcode = '55000', message = 'km_v2_final_leg_evidence_schema_incomplete';
    end if;
    execute $pending_evidence$
      select exists (
        select 1
        from public.fo_final_leg_reconciliation_runs e
        left join public.fo_final_leg_reconciliation_resolutions r
          on r.reconciliation_run_id = e.id
        where e.attendance_id = $1
          and (r.id is null or r.decision <> 'APPROVED_EVIDENCE')
      )
    $pending_evidence$ into v_unresolved_final_leg_evidence using p_attendance_id;
    execute $approved_evidence$
      select max(r.approved_evidence_km)
      from public.fo_final_leg_reconciliation_runs e
      join public.fo_final_leg_reconciliation_resolutions r
        on r.reconciliation_run_id = e.id and r.decision = 'APPROVED_EVIDENCE'
      where e.attendance_id = $1
    $approved_evidence$ into v_approved_final_evidence_km using p_attendance_id;
  end if;
  if v_unresolved_final_leg_evidence and v_has_payable_final_leg then
    raise exception using errcode = '55000', message = 'km_v2_final_leg_evidence_unresolved';
  end if;
  if v_has_payable_final_leg and v_approved_final_evidence_km is not null
     and v_proposed_final_leg_km > v_approved_final_evidence_km then
    raise exception using errcode = '55000', message = 'km_v2_final_leg_exceeds_approved_evidence';
  end if;

  v_financial_changes :=
    round(coalesce(v_attendance.total_route_km, 0), 2) <> v_expected_route_km
    or round(coalesce(v_attendance.eligible_km, 0), 2) <> v_expected_total_km
    or round(coalesce(v_attendance.total_approved_km, 0), 2) <> v_expected_total_km
    or round(coalesce(v_attendance.petrol_amount, 0), 2) <> v_expected_total_amount;

  if (v_attendance.logout_time is not null or lower(coalesce(v_attendance.status, '')) <> 'active')
     and v_financial_changes then
    select a.* into v_approval
    from public.fo_km_financial_approvals a
    where a.attendance_id = p_attendance_id
      and a.input_digest = p_input_digest
      and a.expected_attendance_updated_at = p_expected_attendance_updated_at
      and a.before_total_route_km = round(coalesce(v_attendance.total_route_km, 0), 2)
      and a.before_eligible_km = round(coalesce(v_attendance.eligible_km, 0), 2)
      and a.before_total_approved_km = round(coalesce(v_attendance.total_approved_km, 0), 2)
      and a.before_petrol_amount = round(coalesce(v_attendance.petrol_amount, 0), 2)
      and a.after_total_route_km = v_expected_route_km
      and a.after_eligible_km = v_expected_total_km
      and a.after_total_approved_km = v_expected_total_km
      and a.after_petrol_amount = v_expected_total_amount
      and not exists (
        select 1 from public.fo_km_financial_approval_consumptions c where c.approval_id = a.id
      )
    for update of a;
    if not found then
      raise exception using errcode = '55000', message = 'km_v2_financial_approval_required';
    end if;
  end if;

  for v_leg in select value from jsonb_array_elements(coalesce(p_calculation -> 'canonicalLegs', '[]'::jsonb))
  loop
    v_started_at := (v_leg ->> 'startedAt')::timestamptz;
    if v_started_at is null or (v_leg ->> 'endedAt')::timestamptz < v_started_at then
      raise exception using errcode = '22023', message = 'km_v2_invalid_leg_window';
    end if;
    v_current_started_at := array_append(v_current_started_at, v_started_at);

    insert into public.fo_travel_legs (
      attendance_id, employee_code, fo_user_id, travel_mode, payable_km_allowed,
      started_at, ended_at, start_lat, start_lng, end_lat, end_lng,
      calculated_km, payable_km, rate_per_km, payable_amount, fare_amount,
      status, calculation_version, calculation_run_id, canonical_calculated,
      superseded_at, updated_at
    ) values (
      p_attendance_id, v_attendance.employee_code, v_attendance.fo_user_id,
      nullif(v_leg ->> 'travelMode', ''), coalesce((v_leg ->> 'payableKmAllowed')::boolean, false),
      v_started_at, (v_leg ->> 'endedAt')::timestamptz,
      (v_leg ->> 'startLat')::numeric, (v_leg ->> 'startLng')::numeric,
      (v_leg ->> 'endLat')::numeric, (v_leg ->> 'endLng')::numeric,
      greatest(coalesce((v_leg ->> 'calculatedKm')::numeric, 0), 0),
      case when coalesce(v_leg ->> 'decision', 'REJECTED') in ('ACCEPTED', 'ACCEPTED_WITH_WARNING')
        then greatest(coalesce((v_leg ->> 'payableKm')::numeric, 0), 0) else 0 end,
      greatest(coalesce((v_leg ->> 'ratePerKm')::numeric, 0), 0),
      case when coalesce(v_leg ->> 'decision', 'REJECTED') in ('ACCEPTED', 'ACCEPTED_WITH_WARNING')
        then greatest(coalesce((v_leg ->> 'payableAmount')::numeric, 0), 0) else 0 end,
      case when coalesce(v_leg ->> 'decision', 'REJECTED') in ('ACCEPTED', 'ACCEPTED_WITH_WARNING')
        then greatest(coalesce((v_leg ->> 'payableAmount')::numeric, 0), 0) else 0 end,
      'completed', 'KM_ENGINE_V2', v_run_id, true, null, now()
    )
    on conflict (attendance_id, started_at) do update
    set calculated_km = excluded.calculated_km,
        payable_km = excluded.payable_km,
        rate_per_km = excluded.rate_per_km,
        payable_amount = excluded.payable_amount,
        fare_amount = excluded.fare_amount,
        payable_km_allowed = excluded.payable_km_allowed,
        calculation_version = excluded.calculation_version,
        calculation_run_id = excluded.calculation_run_id,
        canonical_calculated = true,
        superseded_at = null,
        status = 'completed',
        updated_at = now();
  end loop;

  update public.fo_travel_legs
  set status = 'cancelled', superseded_at = now(), updated_at = now()
  where attendance_id = p_attendance_id
    and canonical_calculated is true
    and status = 'completed'
    and not (started_at = any(v_current_started_at));

  select
    coalesce(round(sum(payable_km)::numeric, 2), 0),
    coalesce(round(sum(coalesce(payable_amount, payable_km * coalesce(rate_per_km, 0)))::numeric, 2), 0)
  into v_payable_leg_km, v_payable_leg_amount
  from public.fo_travel_legs
  where attendance_id = p_attendance_id
    and canonical_calculated is true
    and status = 'completed'
    and superseded_at is null;

  select
    coalesce(round(sum(approved_missing_km)::numeric, 2), 0),
    coalesce(round(sum(approved_amount)::numeric, 2), 0)
  into v_missing_km, v_missing_amount
  from public.fo_missing_km_reviews
  where attendance_id = p_attendance_id and status = 'approved';

  v_total_km := round(v_payable_leg_km + v_missing_km, 2);
  v_total_amount := round(v_payable_leg_amount + v_missing_amount, 2);
  v_authoritative_correction := p_calculation -> 'authoritativeAppliedCorrection';
  if jsonb_typeof(v_authoritative_correction) = 'object'
     and coalesce(v_authoritative_correction ->> 'reason', '') = 'PRESERVE_APPLIED_CORRECTION' then
    if coalesce((v_authoritative_correction ->> 'payableKm')::numeric, -1) < 0
       or coalesce((v_authoritative_correction ->> 'reimbursement')::numeric, -1) < 0
       or coalesce((v_authoritative_correction ->> 'routeKm')::numeric, -1) < 0 then
      raise exception using errcode = '22023', message = 'km_v2_invalid_authoritative_correction_state';
    end if;
    v_payable_leg_km := round((v_authoritative_correction ->> 'routeKm')::numeric, 2);
    v_total_km := round((v_authoritative_correction ->> 'payableKm')::numeric, 2);
    v_total_amount := round((v_authoritative_correction ->> 'reimbursement')::numeric, 2);
  end if;

  if v_payable_leg_km <> v_expected_route_km
     or v_total_km <> v_expected_total_km
     or v_total_amount <> v_expected_total_amount then
    raise exception using errcode = '40001', message = 'km_v2_persisted_leg_totals_changed_after_approval';
  end if;

  insert into public.fo_km_calculation_runs (
    id, attendance_id, calculation_version, input_digest, input_row_count,
    accepted_point_count, rejected_point_counts_by_reason, accepted_gps_km,
    reconstructed_gap_km, direct_google_km, payable_km, reimbursement,
    mode_rate_snapshot, risk_flags, decision, calculation_reason,
    source_entry_point, dry_run, actor_source, source_row_ids, result
  ) values (
    v_run_id, p_attendance_id, 'KM_ENGINE_V2', p_input_digest,
    coalesce((p_calculation ->> 'inputRowCount')::integer, 0),
    coalesce((p_calculation ->> 'acceptedPointCount')::integer, 0),
    coalesce(p_calculation -> 'rejectedPointReasons', '{}'::jsonb),
    coalesce((p_calculation ->> 'acceptedGpsKm')::numeric, 0),
    coalesce((p_calculation ->> 'reconstructedGapKm')::numeric, 0),
    (p_calculation ->> 'directGoogleKm')::numeric,
    v_total_km, v_total_amount,
    coalesce(p_calculation -> 'modeRateSnapshot', '[]'::jsonb),
    coalesce(p_calculation -> 'riskFlags', '[]'::jsonb),
    coalesce(p_calculation ->> 'decision', 'REJECTED'),
    p_calculation ->> 'calculationReason', p_source_entry_point, false,
    p_actor_source, coalesce(p_calculation -> 'sourceRowIds', '[]'::jsonb),
    p_calculation || jsonb_build_object(
      'persistedPayableKm', v_total_km,
      'persistedReimbursement', v_total_amount,
      'persistedRouteKm', v_payable_leg_km,
      'approvedMissingKm', v_missing_km,
      'approvedMissingAmount', v_missing_amount
    )
  );

  if v_approval.id is not null then
    insert into public.fo_km_financial_approval_consumptions (
      approval_id, attendance_id, calculation_run_id, input_digest
    ) values (v_approval.id, p_attendance_id, v_run_id, p_input_digest);
  end if;

  perform set_config('app.km_v2_authorized_financial_write', 'true', true);

  update public.fo_attendance
  set total_route_km = v_payable_leg_km,
      eligible_km = v_total_km,
      total_approved_km = v_total_km,
      petrol_amount = v_total_amount,
      route_sync_status = 'canonical_v2_persisted',
      metadata = coalesce(metadata, '{}'::jsonb)
        || coalesce(p_calculation -> 'attendanceMetadata', '{}'::jsonb)
        || jsonb_build_object(
          'km_calculation_version', 'KM_ENGINE_V2',
          'km_calculation_run_id', v_run_id,
          'km_input_digest', p_input_digest,
          'financial_authority', 'backend_canonical_v2',
          'approved_missing_km_total', v_missing_km
        ),
      updated_at = now()
  where id = p_attendance_id;

  return jsonb_build_object(
    'ok', true, 'idempotent_replay', false, 'calculation_run_id', v_run_id,
    'payable_km', v_total_km, 'reimbursement', v_total_amount,
    'approved_missing_km', v_missing_km
  );
end
$function$;

alter function public.rpc_persist_fo_canonical_km_v2(uuid, text, timestamptz, jsonb, text, text)
  owner to postgres;
alter function public.refresh_fo_attendance_actual_travel_km(uuid) owner to postgres;
alter function public.refresh_fo_attendance_payable_route_km(uuid) owner to postgres;
alter function public.trg_protect_fo_canonical_km_v2_financials() owner to postgres;
revoke all on function public.rpc_persist_fo_canonical_km_v2(uuid, text, timestamptz, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.rpc_persist_fo_canonical_km_v2(uuid, text, timestamptz, jsonb, text, text)
  to service_role;

comment on table public.fo_km_calculation_runs is
  'Immutable KM Engine V2 run evidence. Raw GPS remains in fo_location_logs.';
comment on function public.rpc_persist_fo_canonical_km_v2(uuid, text, timestamptz, jsonb, text, text) is
  'Atomically locks an attendance, verifies freshness, persists V2 legs/totals/evidence, and includes approved Missing KM.';

commit;
