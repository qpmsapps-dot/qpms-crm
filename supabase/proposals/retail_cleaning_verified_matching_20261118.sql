-- REVIEW ONLY. Apply after retail_cleaning_store_only_import_20261118.sql.
-- No historical backfill and no updates to immutable submitted reports.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $preflight$
BEGIN
 IF to_regclass('public.cleaning_verified_submission_once_v2') IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.cleaning_verified_submission_once_v2')
   AND indrelid='public.client_deep_cleaning_schedules'::regclass AND indisunique AND indnkeyatts=1 AND indnatts=1
   AND pg_get_expr(indexprs,indrelid)='(metadata ->> ''verified_submission_id''::text)'
   AND pg_get_expr(indpred,indrelid)='((metadata ->> ''verified_submission_id''::text) IS NOT NULL)'
 ) THEN RAISE EXCEPTION 'Verified submission uniqueness index drift'; END IF;
 IF to_regprocedure('qpms_cleaning_plan.verified_client_source_v2(public.client_deep_cleaning_submissions)') IS NOT NULL AND (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('qpms_cleaning_plan.verified_client_source_v2(public.client_deep_cleaning_submissions)'))<>'13a41c8250ba0455dc8c8e44e2e29088' THEN RAISE EXCEPTION 'Verified matching function drift: qpms_cleaning_plan.verified_client_source_v2(public.client_deep_cleaning_submissions)'; END IF;
 IF to_regprocedure('qpms_cleaning_plan.match_verified_submission_v2()') IS NOT NULL AND (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('qpms_cleaning_plan.match_verified_submission_v2()'))<>'94223a1f8f49d0fe0592565b5f62c609' THEN RAISE EXCEPTION 'Verified matching function drift: qpms_cleaning_plan.match_verified_submission_v2()'; END IF;
 IF to_regprocedure('public.rpc_retail_cleaning_manual_link_v2(uuid,uuid,text,jsonb)') IS NOT NULL AND (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.rpc_retail_cleaning_manual_link_v2(uuid,uuid,text,jsonb)'))<>'866bd1b485a2f87f4da27dfee149a9c9' THEN RAISE EXCEPTION 'Verified matching function drift: public.rpc_retail_cleaning_manual_link_v2(uuid,uuid,text,jsonb)'; END IF;
END $preflight$;
CREATE UNIQUE INDEX IF NOT EXISTS cleaning_verified_submission_once_v2
 ON public.client_deep_cleaning_schedules ((metadata->>'verified_submission_id'))
 WHERE metadata->>'verified_submission_id' IS NOT NULL;

CREATE OR REPLACE FUNCTION qpms_cleaning_plan.verified_client_source_v2(p_source public.client_deep_cleaning_submissions)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,qpms_cleaning_plan AS $function$
DECLARE actor public.profiles%rowtype; prefix text;
BEGIN
 -- Existing command verifies pairs, exact supporting document and stored objects
 -- before this AFTER trigger. Independently recheck every persisted object here.
 IF p_source.status IS DISTINCT FROM 'submitted' OR p_source.final_outcome IS DISTINCT FROM 'Completed'
  OR regexp_replace(upper(coalesce(p_source.business,'')),'[^A-Z]','','g') NOT IN ('RELIANCE','RELIANCERETAIL')
  OR p_source.schedule_id IS NOT NULL OR p_source.retail_store_id IS NULL
  OR p_source.metadata->>'contract_version' IS DISTINCT FROM 'cleaning-independent.phase1b.v1'
  OR p_source.submitted_at IS NULL OR p_source.deep_cleaning_date IS NULL
  OR p_source.deep_cleaning_date>(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
 THEN RETURN false; END IF;
 IF (SELECT count(*) FROM public.profiles WHERE auth_user_id=p_source.submitted_by_user_id)<>1
  OR (SELECT count(*) FROM public.reliance_retail_store_master WHERE upper(btrim(store_code))=upper(btrim(p_source.store_code)))<>1
 THEN RETURN false; END IF;
 SELECT * INTO actor FROM public.profiles WHERE auth_user_id=p_source.submitted_by_user_id
  AND is_active=true AND upper(status)='ACTIVE'
  AND regexp_replace(upper(role),'[^A-Z]','','g') IN ('FO','FIELDOFFICER')
  AND regexp_replace(upper(business),'[^A-Z]','','g') IN ('RELIANCE','RELIANCERETAIL');
 IF NOT FOUND THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.reliance_retail_store_master s WHERE s.id=p_source.retail_store_id
  AND s.status='Active' AND upper(btrim(s.store_code))=upper(btrim(p_source.store_code))
  AND qpms_cleaning_plan.state(s.state)=qpms_cleaning_plan.state(p_source.state)
  AND (qpms_cleaning_plan.state(actor.state)=qpms_cleaning_plan.state(s.state)
   OR (qpms_cleaning_plan.state(actor.state)='AP' AND qpms_cleaning_plan.state(s.state) IN ('AP-1','AP-2'))))
 THEN RETURN false; END IF;
 prefix:='deep-cleaning/reliance-retail/'||coalesce(nullif(left(regexp_replace(regexp_replace(btrim(p_source.store_code),'[^a-zA-Z0-9._-]+','-','g'),'^-+|-+$','','g'),120),''),'store')||'/'||p_source.id::text||'/';
 IF EXISTS(SELECT 1 FROM public.client_deep_cleaning_uploads u WHERE u.submission_id=p_source.id AND (
  u.upload_status IS DISTINCT FROM 'uploaded' OR u.uploaded_by_user_id IS DISTINCT FROM p_source.submitted_by_user_id
  OR u.storage_bucket IS DISTINCT FROM 'client-deep-cleaning-uploads'
  OR left(u.storage_path,length(prefix)) IS DISTINCT FROM prefix
  OR u.file_size IS NULL OR u.file_size NOT BETWEEN 1 AND 5242880
  OR u.upload_type NOT IN ('before','after','document','checklist')
  OR (u.upload_type IN ('before','after') AND u.mime_type NOT IN ('image/jpeg','image/png','image/webp'))
  OR (u.upload_type IN ('document','checklist') AND u.mime_type NOT IN ('image/jpeg','image/png','image/webp','application/pdf'))
  OR u.metadata->>'contract_version' IS DISTINCT FROM 'cleaning-independent.phase1b.v1'
  OR NOT EXISTS(SELECT 1 FROM storage.objects o WHERE o.bucket_id=u.storage_bucket AND o.name=u.storage_path
   AND (o.metadata->>'size')::bigint=u.file_size
   AND lower(coalesce(o.metadata->>'mimetype',o.metadata->>'contentType',''))=lower(u.mime_type))))
 THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.client_deep_cleaning_uploads WHERE submission_id=p_source.id AND upload_type='before')
  OR NOT EXISTS(SELECT 1 FROM public.client_deep_cleaning_uploads WHERE submission_id=p_source.id AND upload_type='after')
  OR (SELECT count(*) FROM public.client_deep_cleaning_uploads WHERE submission_id=p_source.id AND upload_type IN ('document','checklist'))<>1
 THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM public.client_deep_cleaning_uploads WHERE submission_id=p_source.id AND upload_type IN ('before','after')
  GROUP BY metadata->>'pair_id' HAVING nullif(metadata->>'pair_id','') IS NULL
   OR count(*) FILTER(WHERE upload_type='before')<>1 OR count(*) FILTER(WHERE upload_type='after')<>1
   OR count(distinct metadata->>'pair_order')<>1 OR coalesce(min((metadata->>'pair_order')::int),0)<1)
  OR (SELECT count(distinct metadata->>'pair_id')<>count(distinct metadata->>'pair_order')
   FROM public.client_deep_cleaning_uploads WHERE submission_id=p_source.id AND upload_type IN ('before','after'))
 THEN RETURN false; END IF;
 RETURN true;
END $function$;
REVOKE ALL ON FUNCTION qpms_cleaning_plan.verified_client_source_v2(public.client_deep_cleaning_submissions) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION qpms_cleaning_plan.match_verified_submission_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,qpms_cleaning_plan AS $function$
DECLARE plan public.client_deep_cleaning_schedules%rowtype;
 actor public.profiles%rowtype; prefix text;
BEGIN
 IF tg_op='UPDATE' AND old.status='submitted' THEN RETURN new; END IF;
 IF NOT qpms_cleaning_plan.verified_client_source_v2(new) THEN RETURN new; END IF;
 SELECT * INTO STRICT actor FROM public.profiles WHERE auth_user_id=new.submitted_by_user_id;
 -- Exact unique canonical store/date only. Ambiguous historical schedules do not match.
 IF (SELECT count(*) FROM public.client_deep_cleaning_schedules WHERE retail_store_id=new.retail_store_id
  AND scheduled_date=new.deep_cleaning_date)<>1 THEN RETURN new; END IF;
 SELECT * INTO plan FROM public.client_deep_cleaning_schedules WHERE retail_store_id=new.retail_store_id
  AND scheduled_date=new.deep_cleaning_date FOR UPDATE;
 IF plan.status NOT IN ('Planned','Scheduled') OR plan.metadata->>'verified_submission_id' IS NOT NULL
  OR (plan.assigned_fo_profile_id IS NOT NULL AND plan.assigned_fo_profile_id<>actor.id)
  OR EXISTS(SELECT 1 FROM public.client_deep_cleaning_submissions WHERE schedule_id=plan.id)
 THEN RETURN new; END IF;
 PERFORM qpms_release.assert_mutation();
 UPDATE public.client_deep_cleaning_schedules SET status='Completed',completed_at=new.submitted_at,
  updated_at=clock_timestamp(),metadata=metadata||jsonb_build_object('verified_submission_id',new.id,
   'verified_link_contract','cleaning-match.v2','verified_actor_profile_id',actor.id,'verified_linked_at',clock_timestamp()) WHERE id=plan.id;
 INSERT INTO public.reliance_retail_management_audit(action,entity_type,entity_id,actor_profile_id,before_state,after_state)
 VALUES('CLEANING_VERIFIED_AUTO_LINK','deep_cleaning_schedule',plan.id,actor.id,to_jsonb(plan),
  jsonb_build_object('submission_id',new.id,'rule','exact canonical store and actual date','contract','cleaning-match.v2'));
 RETURN new;
END $function$;
REVOKE ALL ON FUNCTION qpms_cleaning_plan.match_verified_submission_v2() FROM PUBLIC,anon,authenticated,service_role;
-- Install disabled until matching backend/frontend readers are deployed and approved.
DO $trigger_install$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.client_deep_cleaning_submissions'::regclass AND tgname='z90_cleaning_verified_match_v2') THEN
  EXECUTE 'CREATE TRIGGER z90_cleaning_verified_match_v2 AFTER INSERT OR UPDATE OF status ON public.client_deep_cleaning_submissions FOR EACH ROW EXECUTE FUNCTION qpms_cleaning_plan.match_verified_submission_v2()';
  ALTER TABLE public.client_deep_cleaning_submissions DISABLE TRIGGER z90_cleaning_verified_match_v2;
 ELSIF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.client_deep_cleaning_submissions'::regclass AND tgname='z90_cleaning_verified_match_v2' AND pg_get_triggerdef(oid)='CREATE TRIGGER z90_cleaning_verified_match_v2 AFTER INSERT OR UPDATE OF status ON public.client_deep_cleaning_submissions FOR EACH ROW EXECUTE FUNCTION qpms_cleaning_plan.match_verified_submission_v2()' AND tgenabled IN ('O','D')) THEN RAISE EXCEPTION 'Verified matching trigger drift'; END IF;
END $trigger_install$;
CREATE OR REPLACE FUNCTION public.rpc_retail_cleaning_manual_link_v2(p_actor uuid,p_auth uuid,p_action text,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,qpms_cleaning_plan AS $function$
DECLARE actor public.profiles%rowtype; source public.client_deep_cleaning_submissions%rowtype;
 plan public.client_deep_cleaning_schedules%rowtype; result jsonb; reason text; revision integer;
BEGIN
 SELECT * INTO actor FROM public.profiles WHERE id=p_actor AND auth_user_id=p_auth AND is_active AND upper(status)='ACTIVE'
  AND regexp_replace(upper(role),'[^A-Z0-9]','','g') IN ('ADMIN','QPMSADMIN');
 IF NOT FOUND THEN RAISE EXCEPTION USING errcode='42501',message='Existing active authorized Admin required'; END IF;
 IF p_action NOT IN ('preview','link') OR p_action IS NULL THEN RAISE EXCEPTION USING errcode='22023',message='Invalid manual link action'; END IF;
 SELECT * INTO source FROM public.client_deep_cleaning_submissions WHERE id=(p_data->>'source_id')::uuid FOR UPDATE;
 IF NOT FOUND OR NOT qpms_cleaning_plan.verified_client_source_v2(source) THEN RAISE EXCEPTION USING errcode='42501',message='Verified immutable canonical submission and stored evidence required'; END IF;
 SELECT * INTO plan FROM public.client_deep_cleaning_schedules WHERE id=(p_data->>'schedule_id')::uuid FOR UPDATE;
 IF NOT FOUND OR plan.retail_store_id<>source.retail_store_id OR NOT EXISTS(SELECT 1 FROM public.reliance_retail_store_master WHERE id=plan.retail_store_id AND public.retail_unified_access(p_actor,state,'edit')) THEN RAISE EXCEPTION USING errcode='42501',message='Authorized exact canonical schedule store required'; END IF;
 IF plan.scheduled_date>(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date THEN RAISE EXCEPTION USING errcode='22023',message='Future schedules cannot be completed'; END IF;
 IF plan.assigned_fo_profile_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=plan.assigned_fo_profile_id AND auth_user_id=source.submitted_by_user_id) THEN RAISE EXCEPTION USING errcode='42501',message='Correct and audit the schedule assignment before linking another FO'; END IF;
 revision:=coalesce((plan.metadata->>'plan_revision')::integer,0);
 result:=jsonb_build_object('schedule_id',plan.id,'source_id',source.id,'scheduled_date',plan.scheduled_date,'actual_date',source.deep_cleaning_date,'employee_code',source.submitted_by_employee_code,'store_code',source.store_code,'revision',revision,'exact_date',plan.scheduled_date=source.deep_cleaning_date);
 IF p_action='preview' THEN RETURN result; END IF;
 PERFORM qpms_release.assert_mutation();
 reason:=btrim(coalesce(p_data->>'reason',''));
 IF length(reason) NOT BETWEEN 20 AND 2000 THEN RAISE EXCEPTION USING errcode='22023',message='Manual review reason must be 20-2000 characters'; END IF;
 IF plan.metadata->>'verified_link_contract'='cleaning-match.manual.v2' AND plan.metadata->>'verified_submission_id'=source.id::text THEN
  IF plan.metadata->>'manual_reason' IS DISTINCT FROM reason THEN RAISE EXCEPTION USING errcode='23505',message='Manual link retry changed its reason'; END IF;
  RETURN result||jsonb_build_object('saved',true,'replayed',true);
 END IF;
 IF plan.status NOT IN ('Planned','Scheduled') OR plan.metadata->>'verified_submission_id' IS NOT NULL
  OR exists(SELECT 1 FROM public.client_deep_cleaning_submissions WHERE schedule_id=plan.id)
  OR (p_data->>'revision')::integer IS DISTINCT FROM revision
 THEN RAISE EXCEPTION USING errcode='40001',message='Schedule changed or already started/completed'; END IF;
 IF plan.scheduled_date<>source.deep_cleaning_date AND coalesce((p_data->>'allow_date_exception')::boolean,false) IS NOT TRUE THEN RAISE EXCEPTION USING errcode='22023',message='Explicit reviewed date exception required'; END IF;
 IF EXISTS(SELECT 1 FROM public.client_deep_cleaning_schedules WHERE metadata->>'verified_submission_id'=source.id::text) THEN RAISE EXCEPTION USING errcode='23505',message='Submission is already linked to another schedule'; END IF;
 UPDATE public.client_deep_cleaning_schedules SET status='Completed',completed_at=source.submitted_at,updated_at=clock_timestamp(),
  metadata=metadata||jsonb_build_object('verified_submission_id',source.id,'verified_link_contract','cleaning-match.manual.v2',
   'verified_actor_profile_id',p_actor,'verified_linked_at',clock_timestamp(),'verified_actual_date',source.deep_cleaning_date,
   'manual_reason',reason,'manual_date_exception',plan.scheduled_date<>source.deep_cleaning_date) WHERE id=plan.id;
 INSERT INTO public.reliance_retail_management_audit(action,entity_type,entity_id,actor_profile_id,before_state,after_state)
 VALUES('CLEANING_VERIFIED_MANUAL_LINK','deep_cleaning_schedule',plan.id,p_actor,to_jsonb(plan),result||jsonb_build_object('reason',reason,'date_exception',plan.scheduled_date<>source.deep_cleaning_date));
 RETURN result||jsonb_build_object('saved',true,'replayed',false);
END $function$;
REVOKE ALL ON FUNCTION public.rpc_retail_cleaning_manual_link_v2(uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
-- Service execution is granted only by the separately approved activation script.
COMMIT;
