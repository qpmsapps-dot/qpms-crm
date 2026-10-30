-- Authorization required. Non-destructive rollback: stops new tracker access,
-- preserves existing service orders, source evidence and immutable audit history.
begin;
revoke all on function public.rpc_retail_service_snapshot(uuid),public.rpc_retail_service_command(uuid,uuid,text,uuid,integer,jsonb),public.rpc_retail_service_import(uuid,text,text,text,jsonb) from public,anon,authenticated,service_role;
commit;
