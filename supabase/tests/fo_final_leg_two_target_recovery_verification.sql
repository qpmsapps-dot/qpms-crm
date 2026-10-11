\set ON_ERROR_STOP on
\set VERBOSITY terse

do $$
begin
  if (select financial_writes_enabled from public.fo_km_financial_control where control_key='canonical_v2') then
    raise exception 'test_failed_recovery_gate_open';
  end if;
  if has_function_privilege('service_role', 'public.rpc_record_fo_final_leg_evidence_v1(jsonb,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.rpc_resolve_fo_final_leg_evidence_v1(uuid,text,numeric,text)', 'EXECUTE')
     or has_function_privilege(
       'service_role',
       'public.rpc_apply_fo_final_leg_financial_v1(uuid,uuid,uuid,text,text,timestamptz,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text)',
       'EXECUTE'
     ) then
    raise exception 'test_failed_recovery_execute_still_granted';
  end if;
  if (select count(*) from public.fo_final_leg_reconciliation_runs) <> 2 then
    raise exception 'test_failed_recovery_evidence_lost';
  end if;
  if exists (
    select 1 from public.fo_attendance
    where (id='a8d170e6-cbb4-4788-928d-6eb9999d51e2' and total_route_km<>76.45)
       or (id='d299f0c4-9af7-4f0c-b8cc-86e5b7fb1f91' and total_route_km<>80.62)
  ) then
    raise exception 'test_failed_recovery_financial_change';
  end if;
  if exists (
    select 1 from public.fo_travel_legs
    where (calculated_km,payable_km,payable_amount,fare_amount) is distinct from
          (0::numeric,0::numeric,0::numeric,0::numeric)
  ) then
    raise exception 'test_failed_recovery_leg_change';
  end if;
  raise notice 'TWO_TARGET_RECOVERY_OK';
end
$$;
