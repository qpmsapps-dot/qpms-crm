-- Fail-closed recovery for Migration 208.
-- Preserves all immutable authorizations, evidence snapshots and financial applies.
-- It intentionally does not reverse an applied financial delta.

begin;

revoke execute on function public.rpc_apply_fo_gps_complete_missing_leg_v1(uuid,jsonb,uuid,text)
  from public,anon,authenticated,service_role;

do $verification$
begin
  if has_function_privilege(
    'service_role',
    'public.rpc_apply_fo_gps_complete_missing_leg_v1(uuid,jsonb,uuid,text)',
    'EXECUTE'
  ) then
    raise exception 'Migration 208 fail-closed recovery did not revoke automatic apply execution';
  end if;
end
$verification$;

commit;
