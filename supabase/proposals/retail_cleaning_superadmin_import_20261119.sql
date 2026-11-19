-- PROPOSAL ONLY. Separate production SQL approval required. Apply after the three 20261118 Deep Cleaning proposals.
-- No assignments, RLS changes, matching activation, data writes or permissions for other modules.
BEGIN;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(hashtextextended('cleaning-monthly-superadmin.v1',0));
DO $preflight$
BEGIN
 IF to_regprocedure('qpms_cleaning_plan.monthly_admin_access_v1(uuid)') IS NOT NULL AND (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('qpms_cleaning_plan.monthly_admin_access_v1(uuid)'))<>'8e4c39582860e5eb22a0c93670d92f0d' THEN RAISE EXCEPTION 'Monthly administrator helper drift: qpms_cleaning_plan.monthly_admin_access_v1(uuid)'; END IF;
 IF to_regprocedure('public.rpc_retail_cleaning_schedule_admin_access_v1(uuid,uuid)') IS NOT NULL AND (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.rpc_retail_cleaning_schedule_admin_access_v1(uuid,uuid)'))<>'f7657eb4bb4ff7be5a4e87b02301725f' THEN RAISE EXCEPTION 'Monthly administrator helper drift: public.rpc_retail_cleaning_schedule_admin_access_v1(uuid,uuid)'; END IF;
 IF coalesce((SELECT md5(replace(pg_get_functiondef(oid),E'\r\n',E'\n')) FROM pg_proc WHERE oid=to_regprocedure('qpms_cleaning_plan.validate_row(uuid,jsonb)')),'') NOT IN ('0bdf1da8bbfea39e7d4af22b54e973e5','530d3f42e315dee1e479328586136ae5') THEN RAISE EXCEPTION 'Monthly plan contract drift: qpms_cleaning_plan.validate_row(uuid,jsonb)'; END IF;
 IF coalesce((SELECT md5(replace(pg_get_functiondef(oid),E'\r\n',E'\n')) FROM pg_proc WHERE oid=to_regprocedure('public.rpc_retail_cleaning_plan_v1(uuid,uuid,text,jsonb)')),'') NOT IN ('d5716c616191061673278a59bd65c8d5','70b88ca2e51a15e9ee7627e4366f798a') THEN RAISE EXCEPTION 'Monthly plan contract drift: public.rpc_retail_cleaning_plan_v1(uuid,uuid,text,jsonb)'; END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION qpms_cleaning_plan.monthly_admin_access_v1(p_actor uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,qpms_cleaning_plan AS $function$
 SELECT EXISTS(
  SELECT 1 FROM public.profiles p WHERE p.id=p_actor AND p.is_active IS TRUE
  AND upper(coalesce(p.status,''))='ACTIVE' AND p.auth_user_id IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM public.profiles other WHERE other.auth_user_id=p.auth_user_id AND other.id<>p.id)
  AND coalesce(to_jsonb(p)->>'is_demo','false')<>'true'
  AND coalesce(to_jsonb(p)->'metadata'->>'is_demo','false')<>'true'
  AND coalesce(to_jsonb(p)->>'read_only','false')<>'true'
  AND coalesce(to_jsonb(p)->'metadata'->>'read_only','false')<>'true'
  AND (regexp_replace(upper(p.role),'[^A-Z0-9]','','g')='SUPERADMIN'
   OR (p.id='d40c2b3f-87f1-4c34-8798-cf9b0d9ca784' AND p.auth_user_id='79cd196c-c6f3-404a-b22a-d4683afefa3f'
    AND p.employee_code='QPMSADMIN' AND regexp_replace(upper(p.role),'[^A-Z0-9]','','g') IN ('ADMIN','QPMSADMIN')))
 );
$function$;
REVOKE ALL ON FUNCTION qpms_cleaning_plan.monthly_admin_access_v1(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.rpc_retail_cleaning_schedule_admin_access_v1(p_actor uuid,p_auth uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public,qpms_cleaning_plan AS $function$
 SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_actor AND p.auth_user_id=p_auth)
  AND qpms_cleaning_plan.monthly_admin_access_v1(p_actor);
$function$;
REVOKE ALL ON FUNCTION public.rpc_retail_cleaning_schedule_admin_access_v1(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.rpc_retail_cleaning_schedule_admin_access_v1(uuid,uuid) TO service_role;
DO $patch$
DECLARE definition text;
BEGIN
 definition:=replace(pg_get_functiondef('qpms_cleaning_plan.validate_row(uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
 IF md5(definition)='530d3f42e315dee1e479328586136ae5' THEN RETURN; END IF;
 definition:=replace(definition,$old$OR qpms_cleaning_plan.state_writer_access(p_actor,$old$,$new$OR qpms_cleaning_plan.monthly_admin_access_v1(p_actor) OR qpms_cleaning_plan.state_writer_access(p_actor,$new$);
 IF md5(definition)<>'530d3f42e315dee1e479328586136ae5' THEN RAISE EXCEPTION 'Unexpected monthly plan patch'; END IF;
 EXECUTE definition;
END $patch$;
DO $patch$
DECLARE definition text;
BEGIN
 definition:=replace(pg_get_functiondef('public.rpc_retail_cleaning_plan_v1(uuid,uuid,text,jsonb)'::regprocedure),E'\r\n',E'\n');
 IF md5(definition)='70b88ca2e51a15e9ee7627e4366f798a' THEN RETURN; END IF;
 definition:=replace(definition,$old$OR qpms_cleaning_plan.state_writer_access(p_actor,$old$,$new$OR (p_action IN ('list','history','preview','import') AND qpms_cleaning_plan.monthly_admin_access_v1(p_actor)) OR qpms_cleaning_plan.state_writer_access(p_actor,$new$);
 IF md5(definition)<>'70b88ca2e51a15e9ee7627e4366f798a' THEN RAISE EXCEPTION 'Unexpected monthly plan patch'; END IF;
 EXECUTE definition;
END $patch$;
COMMIT;
