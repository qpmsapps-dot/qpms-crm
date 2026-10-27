-- Accept existing exact employee identities containing ordinary internal spaces.
-- No account renaming, control activation, queueing or financial writes.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $patch$
declare f record;body text;pattern text:='^[A-Z0-9_-]+$';
begin
 if session_user<>'postgres' then raise exception 'km252_owner_required';end if;
 for f in select * from(values
 ('public.fo_km_automatic_eligible(public.fo_attendance)','eea2c513b23b02ec8d308c025c6c4c43'),
 ('public.rpc_approve_fo_missing_km_v1(uuid,timestamptz,uuid,numeric,text,boolean,boolean)','1bfa97cffd250eb53c682ba312662acd')
 )x(signature,hash) loop
  if (select md5(replace(prosrc,E'\r','')) from pg_proc where oid=to_regprocedure(f.signature)) is distinct from f.hash then raise exception 'km252_dependency_drift: %',f.signature;end if;
  body:=replace(pg_get_functiondef(f.signature::regprocedure),E'\r','');
  if strpos(body,pattern)=0 then raise exception 'km252_identity_anchor_missing';end if;
  execute replace(body,pattern,'^[A-Z0-9_-]+( [A-Z0-9_-]+)*$');
 end loop;
end $patch$;
notify pgrst,'reload schema';
commit;
