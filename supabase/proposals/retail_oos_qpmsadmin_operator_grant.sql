-- PREPARED ONLY. Requires separate approval of this exact identity and seven-state scope.
-- Apply the operator extension first; do not rerun the original MIS migration.
-- Does not enable either write gate or grant reviewer authority.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if exists(select 1 from public.retail_mis_assignments) or not exists(select 1 from public.retail_mis_controls where singleton and oos_writes_enabled=false) then raise exception 'Expected zero MIS assignments and closed OOS gate';end if;
end;$$;
select public.rpc_retail_oos_operator_grant(
 'd40c2b3f-87f1-4c34-8798-cf9b0d9ca784'::uuid,true,
 array['AP-1','AP-2','KA','KL','TG','TN','PY']::text[],
 'Separately approved live OOS training for existing verified QPMSADMIN; no reviewer authority',0);
commit;
