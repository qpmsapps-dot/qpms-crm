-- Manual post-commit recovery for Migration 200.
-- Run only while KM_FINANCIAL_WRITES_MAINTENANCE=true and the old backend is
-- not processing KM writes. This preserves all V2 calculation evidence and
-- financial rows; it does not invent or reverse financial values.

begin;

lock table public.fo_attendance in share row exclusive mode;
lock table public.fo_travel_legs in share row exclusive mode;
lock table public.fo_km_financial_control in row exclusive mode;

update public.fo_km_financial_control
set financial_writes_enabled = false,
    changed_by = null,
    changed_by_identity = 'postgres_recovery',
    change_reason = 'Migration 200 recovery: canonical writes disabled',
    changed_at = now()
where control_key = 'canonical_v2';

do $recovery$
declare
  v_snapshot public.fo_km_v2_recovery_snapshot%rowtype;
  v_v2_run_count bigint;
  v_v2_attendance_count bigint;
begin
  select * into v_snapshot
  from public.fo_km_v2_recovery_snapshot
  where snapshot_key = 'pre_v2';
  if not found then
    raise exception 'KM V2 recovery snapshot is missing; automatic function restoration is unsafe';
  end if;

  select count(*), count(distinct attendance_id)
  into v_v2_run_count, v_v2_attendance_count
  from public.fo_km_calculation_runs;

  execute v_snapshot.actual_travel_function_def;
  execute v_snapshot.payable_route_function_def;

  if v_snapshot.location_trigger_enabled = 'D' then
    alter table public.fo_location_logs disable trigger trg_fo_location_logs_actual_travel_km;
  else
    alter table public.fo_location_logs enable trigger trg_fo_location_logs_actual_travel_km;
  end if;

  raise notice 'KM V2 recovery preserved % calculation runs affecting % attendances; reconcile those financial rows before resuming legacy KM writes',
    v_v2_run_count, v_v2_attendance_count;
end
$recovery$;

do $revoke_optional$
begin
  if to_regprocedure('public.rpc_record_fo_final_leg_evidence_v1(jsonb,text)') is not null then
    execute 'revoke all on function public.rpc_record_fo_final_leg_evidence_v1(jsonb, text) from public, anon, authenticated, service_role';
  end if;
  if to_regprocedure('public.rpc_resolve_fo_final_leg_evidence_v1(uuid,text,numeric,text)') is not null then
    execute 'revoke all on function public.rpc_resolve_fo_final_leg_evidence_v1(uuid, text, numeric, text) from public, anon, authenticated, service_role';
  end if;
  if to_regprocedure('public.rpc_apply_fo_final_leg_financial_v1(uuid,uuid,uuid,text,text,timestamp with time zone,timestamp with time zone,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text)') is not null then
    execute 'revoke all on function public.rpc_apply_fo_final_leg_financial_v1(uuid, uuid, uuid, text, text, timestamptz, timestamptz, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text, text) from public, anon, authenticated, service_role';
  end if;
end
$revoke_optional$;

drop trigger if exists trg_protect_fo_canonical_km_v2_financials on public.fo_attendance;
drop function if exists public.trg_protect_fo_canonical_km_v2_financials();

revoke all on function public.rpc_persist_fo_canonical_km_v2(uuid, text, timestamptz, jsonb, text, text)
  from public, anon, authenticated, service_role;
drop function if exists public.rpc_persist_fo_canonical_km_v2(uuid, text, timestamptz, jsonb, text, text);
revoke all on function public.rpc_get_fo_km_financial_write_state_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_set_fo_km_financial_write_state_v1(boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_approve_fo_km_financial_change_v1(
  uuid, text, timestamptz, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text
) from public, anon, authenticated, service_role;

-- Deliberately retained for audit/reconciliation:
--   public.fo_km_calculation_runs
--   public.fo_km_v2_recovery_snapshot
--   public.fo_km_financial_control/control_audit/approvals/consumptions
--   public.fo_final_leg_reconciliation_runs/resolutions, when installed
--   public.fo_final_leg_financial_applies, when installed
--   fo_travel_legs.calculation_version/calculation_run_id/
--     canonical_calculated/superseded_at
--   all V2 attendance and travel-leg financial values
-- The recovery operator must compare each retained run with its attendance and
-- explicitly approve any financial adjustment. This script never deletes or
-- rewrites financial history.

commit;
