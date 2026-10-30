-- Requires authorization. Stops new draft reads/saves without deleting evidence
-- or changing any operational Store, Zone or FO assignment/history.
begin;
revoke all on function public.rpc_retail_zone_drafts(uuid),public.rpc_retail_zone_draft_save(uuid,uuid,integer,uuid,text,timestamptz,text) from public,anon,authenticated,service_role;
commit;
