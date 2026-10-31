-- OWNER, ONLY IF QUARANTINE IS NEEDED. Also close both application write gates. Does not reverse any business decision or remove migration history.
begin;
revoke execute on function public.rpc_confirm_retail_bulk_identity(uuid,uuid,uuid),public.rpc_confirm_retail_store_import(uuid,uuid,uuid,boolean,boolean) from service_role;
commit;
