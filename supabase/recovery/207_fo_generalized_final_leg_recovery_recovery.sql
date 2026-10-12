-- Fail-closed recovery for Migration 207.
-- Preserves every immutable evidence, review, approval, apply and correction row.
-- It intentionally does not attempt to reverse a financial apply. Restore the
-- prior RPC definitions with exact Migration 205 followed by Migration 206 only
-- after incident review and protected-row verification.

begin;

revoke execute on function public.rpc_record_fo_final_leg_evidence_v1(jsonb,text)
  from public,anon,authenticated,service_role;
revoke execute on function public.rpc_resolve_fo_final_leg_evidence_v1(uuid,text,numeric,text)
  from public,anon,authenticated,service_role;
revoke execute on function public.rpc_apply_fo_final_leg_financial_v1(
  uuid,uuid,uuid,text,text,timestamptz,timestamptz,
  numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,
  numeric,numeric,numeric,text,text
) from public,anon,authenticated,service_role;

do $verification$
begin
  if has_function_privilege('service_role','public.rpc_record_fo_final_leg_evidence_v1(jsonb,text)','EXECUTE')
     or has_function_privilege('authenticated','public.rpc_resolve_fo_final_leg_evidence_v1(uuid,text,numeric,text)','EXECUTE')
     or has_function_privilege('service_role','public.rpc_apply_fo_final_leg_financial_v1(uuid,uuid,uuid,text,text,timestamptz,timestamptz,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,text)','EXECUTE') then
    raise exception 'Migration 207 fail-closed recovery did not revoke workflow execution';
  end if;
end
$verification$;

commit;
