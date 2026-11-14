-- REVIEW ONLY. No production execution. Retained installed fingerprints required.
BEGIN;
SET LOCAL lock_timeout='1s'; SET LOCAL statement_timeout='30s';
DO $preflight$
BEGIN
 IF NOT pg_has_role(session_user,'qpms_release_operator','MEMBER') THEN RAISE EXCEPTION 'Existing authorized DBA required'; END IF;
 IF md5(regexp_replace(replace(pg_get_functiondef('qpms_release.guard_write()'::regprocedure),chr(13),''),'^[[:space:]]+|[[:space:]]+$','','g')) <> 'e67494b2095d7d63fd2cebb62321dd53' THEN RAISE EXCEPTION 'Installed dependency drift: guard_write'; END IF;
 IF md5(regexp_replace(replace(pg_get_functiondef('public.rpc_combined_release_begin(uuid,uuid,text)'::regprocedure),chr(13),''),'^[[:space:]]+|[[:space:]]+$','','g')) <> '6b3b9e39387493cd29411ffcc7d0d8a6' THEN RAISE EXCEPTION 'Installed dependency drift: rpc_combined_release_begin'; END IF;
 IF md5(regexp_replace(replace(pg_get_functiondef('qpms_release.guard_mis_feature()'::regprocedure),chr(13),''),'^[[:space:]]+|[[:space:]]+$','','g')) <> 'fc428fe9091008030e644c0f9e2f1541' THEN RAISE EXCEPTION 'Installed dependency drift: guard_mis_feature'; END IF;
 IF md5(regexp_replace(replace(pg_get_functiondef('qpms_release.guard_mis_storage()'::regprocedure),chr(13),''),'^[[:space:]]+|[[:space:]]+$','','g')) <> '685b59d6a7265cdbabfe3783ae9c4862' THEN RAISE EXCEPTION 'Installed dependency drift: guard_mis_storage'; END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION qpms_release.guard_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'qpms_release'
AS $function$
begin
 if tg_table_schema='storage' then
  if tg_op='INSERT' and not coalesce(qpms_release.storage_row(to_jsonb(new)),false) then return new; end if;
  if tg_op='DELETE' and not coalesce(qpms_release.storage_row(to_jsonb(old)),false) then return old; end if;
  if tg_op='UPDATE' and not coalesce(qpms_release.storage_row(to_jsonb(old)),false) and not coalesce(qpms_release.storage_row(to_jsonb(new)),false) then return new; end if;
 elsif tg_table_name='retail_provisional_proposals' then
  if tg_op='INSERT' and new.kind<>'DC_SCHEDULE' then return new; end if;
  if tg_op='DELETE' and old.kind<>'DC_SCHEDULE' then return old; end if;
  if tg_op='UPDATE' and old.kind<>'DC_SCHEDULE' and new.kind<>'DC_SCHEDULE' then return new; end if;
 elsif tg_table_name in ('fo_activity_submissions','fo_activity_uploads') then
  if tg_op='INSERT' and not qpms_release.legacy_row(to_jsonb(new)) then return new; end if;
  if tg_op='DELETE' and not qpms_release.legacy_row(to_jsonb(old)) then return old; end if;
  if tg_op='UPDATE' and not qpms_release.legacy_row(to_jsonb(old)) and not qpms_release.legacy_row(to_jsonb(new)) then return new; end if;
 end if;
 -- Retire only the existing Cleaning/Training DML freeze; retain truncate and unknown-table protection.
 if tg_table_schema='storage' or (tg_table_schema='public' and tg_table_name in
 ('training_categories','training_types','training_topics','training_sessions','training_session_topics',
 'training_session_attendees','training_evidence','training_events','client_deep_cleaning_schedules',
 'client_deep_cleaning_submissions','client_deep_cleaning_uploads','fo_activity_submissions',
 'fo_activity_uploads','retail_provisional_proposals')) then
  if tg_op='DELETE' then return old;end if;return new;
 end if;
 perform qpms_release.assert_mutation();
 if tg_op='DELETE' then return old; end if;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION public.rpc_combined_release_begin(p_token uuid, p_actor uuid, p_route text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'qpms_release'
AS $function$
begin
 if p_route is null or p_route !~ '^cleaning:phase1b:(begin|update|intent|complete|retire|finalize)$' then
  perform qpms_release.assert_mutation();
 end if;
 if p_token is null or p_actor is null or nullif(p_route,'') is null then raise exception 'Invalid release operation'; end if;
 insert into qpms_release.operations(token,actor,route,epoch)
 select p_token,p_actor,left(p_route,240),epoch from qpms_release.control where id;
end $function$
;
CREATE OR REPLACE FUNCTION qpms_release.guard_mis_feature()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'qpms_release'
AS $function$
declare o jsonb;n jsonb;m text;affected boolean:=false;
begin
 if tg_op<>'INSERT' then o:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then n:=to_jsonb(new);end if;
 if tg_table_name='retail_mis_records' then
  affected:=coalesce((qpms_release.mis_module(o->>'module') and o->>'module' not in ('cleaning','training-hk','training-mepc')),false) or coalesce((qpms_release.mis_module(n->>'module') and n->>'module' not in ('cleaning','training-hk','training-mepc')),false);
 else
  -- Unresolved parent is uncertain, never permission to bypass the freeze.
  for m in select r.module from public.retail_mis_records r where r.id in
   ((o->>'record_id')::uuid,(n->>'record_id')::uuid) loop
   affected:=affected or (qpms_release.mis_module(m) and m not in ('cleaning','training-hk','training-mepc'));
  end loop;
  if (o is not null and not exists(select 1 from public.retail_mis_records where id=(o->>'record_id')::uuid))
   or (n is not null and not exists(select 1 from public.retail_mis_records where id=(n->>'record_id')::uuid)) then affected:=true;end if;
 end if;
 if affected then perform qpms_release.assert_mutation();end if;
 if tg_op='DELETE' then return old;end if;return new;
end $function$
;
CREATE OR REPLACE FUNCTION qpms_release.guard_mis_storage()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'qpms_release'
AS $function$
declare r jsonb;m text;
begin
 for r in select v from (values(case when tg_op<>'INSERT' then to_jsonb(old) end),
 (case when tg_op<>'DELETE' then to_jsonb(new) end)) x(v) where v->>'bucket_id'='retail-mis-evidence' loop
  select p.module into m from public.retail_mis_evidence e join public.retail_mis_records p on p.id=e.record_id
  where e.bucket=r->>'bucket_id' and e.path=r->>'name';
  if m is null or (qpms_release.mis_module(m) and m not in ('cleaning','training-hk','training-mepc')) then perform qpms_release.assert_mutation();end if;
 end loop;
 if tg_op='DELETE' then return old;end if;return new;
end $function$
;
INSERT INTO qpms_release.audit(action,epoch,evidence) SELECT 'normal_retail_freeze_dependency_retired',epoch,jsonb_build_object('principal',session_user,'scope','Cleaning/HK/MEPC normal DML; business authorization and evidence guards retained','normal_release_clearance',false) FROM qpms_release.control WHERE id;
COMMIT;

