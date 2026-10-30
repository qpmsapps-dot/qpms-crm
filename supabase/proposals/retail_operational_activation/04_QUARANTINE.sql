-- Requires separate authorization. Keeps orders, links, drafts and audit evidence.
begin;
revoke all on function public.rpc_retail_service_snapshot(uuid) from public,anon,authenticated,service_role;
revoke all on function public.rpc_retail_service_command(uuid,uuid,text,uuid,integer,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.rpc_retail_service_import(uuid,text,text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.rpc_retail_zone_draft_save(uuid,uuid,integer,uuid,text,timestamptz,text) from public,anon,authenticated,service_role;
revoke all on function public.rpc_retail_zone_drafts(uuid) from public,anon,authenticated,service_role;
commit;
