-- RECOVERY PROPOSAL ONLY. Separate production approval required. Roll back the matching application too.
-- Preserve imported schedules, audits, evidence, existing writers and matching activation state.
BEGIN;
SET LOCAL lock_timeout='5s';
SELECT pg_advisory_xact_lock(hashtextextended('cleaning-monthly-superadmin.v1',0));
DO $restore$
DECLARE definition text;
BEGIN
 definition:=replace(pg_get_functiondef('qpms_cleaning_plan.validate_row(uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
 IF md5(definition)='0bdf1da8bbfea39e7d4af22b54e973e5' THEN RETURN; END IF;
 IF md5(definition)<>'530d3f42e315dee1e479328586136ae5' THEN RAISE EXCEPTION 'Monthly recovery contract drift'; END IF;
 definition:=replace(definition,$old$OR qpms_cleaning_plan.monthly_admin_access_v1(p_actor) OR qpms_cleaning_plan.state_writer_access(p_actor,$old$,$new$OR qpms_cleaning_plan.state_writer_access(p_actor,$new$);
 IF md5(definition)<>'0bdf1da8bbfea39e7d4af22b54e973e5' THEN RAISE EXCEPTION 'Unexpected recovery patch'; END IF;
 EXECUTE definition;
END $restore$;
DO $restore$
DECLARE definition text;
BEGIN
 definition:=replace(pg_get_functiondef('public.rpc_retail_cleaning_plan_v1(uuid,uuid,text,jsonb)'::regprocedure),E'\r\n',E'\n');
 IF md5(definition)='d5716c616191061673278a59bd65c8d5' THEN RETURN; END IF;
 IF md5(definition)<>'70b88ca2e51a15e9ee7627e4366f798a' THEN RAISE EXCEPTION 'Monthly recovery contract drift'; END IF;
 definition:=replace(definition,$old$OR (p_action IN ('list','history','preview','import') AND qpms_cleaning_plan.monthly_admin_access_v1(p_actor)) OR qpms_cleaning_plan.state_writer_access(p_actor,$old$,$new$OR qpms_cleaning_plan.state_writer_access(p_actor,$new$);
 IF md5(definition)<>'d5716c616191061673278a59bd65c8d5' THEN RAISE EXCEPTION 'Unexpected recovery patch'; END IF;
 EXECUTE definition;
END $restore$;
DO $helper$
BEGIN
 IF to_regprocedure('public.rpc_retail_cleaning_schedule_admin_access_v1(uuid,uuid)') IS NOT NULL THEN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('public.rpc_retail_cleaning_schedule_admin_access_v1(uuid,uuid)'))<>'f7657eb4bb4ff7be5a4e87b02301725f' THEN RAISE EXCEPTION 'Monthly recovery helper drift'; END IF;
 DROP FUNCTION public.rpc_retail_cleaning_schedule_admin_access_v1(uuid,uuid);
 END IF;
END $helper$;
DO $helper$
BEGIN
 IF to_regprocedure('qpms_cleaning_plan.monthly_admin_access_v1(uuid)') IS NOT NULL THEN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=to_regprocedure('qpms_cleaning_plan.monthly_admin_access_v1(uuid)'))<>'8e4c39582860e5eb22a0c93670d92f0d' THEN RAISE EXCEPTION 'Monthly recovery helper drift'; END IF;
 DROP FUNCTION qpms_cleaning_plan.monthly_admin_access_v1(uuid);
 END IF;
END $helper$;
COMMIT;
