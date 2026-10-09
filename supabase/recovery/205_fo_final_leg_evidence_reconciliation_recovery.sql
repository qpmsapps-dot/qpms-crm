-- Fail-closed recovery for Migration 205.
-- Audit evidence and review resolutions are deliberately retained.

begin;

lock table public.fo_km_financial_control in row exclusive mode;

update public.fo_km_financial_control
set financial_writes_enabled = false,
    changed_by = null,
    changed_by_identity = 'postgres_recovery',
    change_reason = 'Migration 205 recovery: canonical writes disabled',
    changed_at = now()
where control_key = 'canonical_v2';

revoke all on function public.rpc_record_fo_final_leg_evidence_v1(jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_resolve_fo_final_leg_evidence_v1(uuid, text, numeric, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_apply_fo_final_leg_financial_v1(
  uuid, uuid, uuid, text, text, timestamptz, timestamptz,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.rpc_persist_fo_canonical_km_v2(uuid, text, timestamptz, jsonb, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_set_fo_km_financial_write_state_v1(boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_approve_fo_km_financial_change_v1(
  uuid, text, timestamptz, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text
) from public, anon, authenticated, service_role;

-- Deliberately retained:
--   public.fo_final_leg_reconciliation_runs
--   public.fo_final_leg_reconciliation_resolutions
--   all canonical calculation, approval and consumption audit records
--   all attendance, travel-leg, site-visit and reimbursement values

commit;
