-- REVIEW ONLY. Apply through a separately approved Supabase migration.
-- Based on production qpms_cleaning_plan.validate_row inspected 2026-11-18.
-- Preserve explicit legacy FO validation; only blank/missing FO is unassigned.
CREATE OR REPLACE FUNCTION qpms_cleaning_plan.validate_row(p_actor uuid, p_row jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'qpms_cleaning_plan'
AS $function$
DECLARE
 s public.reliance_retail_store_master%rowtype;
 f public.profiles%rowtype;
 day date;
 matches integer;
 own jsonb;
 existing jsonb;
 fo_code text;
 fo_id uuid;
BEGIN
 IF jsonb_typeof(p_row)<>'object' THEN RAISE EXCEPTION USING errcode='22023',message='Invalid row'; END IF;
 SELECT count(*) INTO matches FROM public.reliance_retail_store_master WHERE upper(btrim(store_code))=upper(btrim(p_row->>'STORE_CODE'));
 IF matches<>1 THEN RAISE EXCEPTION USING errcode='22023',message='UNKNOWN_OR_AMBIGUOUS_STORE_CODE'; END IF;
 SELECT * INTO s FROM public.reliance_retail_store_master WHERE upper(btrim(store_code))=upper(btrim(p_row->>'STORE_CODE'));
 IF s.status<>'Active' THEN RAISE EXCEPTION USING errcode='22023',message='INACTIVE_STORE'; END IF;
 IF NOT public.retail_mis_cleaning_access(p_actor,(CASE WHEN qpms_cleaning_plan.state(s.state)='PY' THEN 'TN' ELSE s.state END),'edit')
 THEN RAISE EXCEPTION USING errcode='42501',message='STATE_SCOPE_DENIED'; END IF;
 IF (CASE WHEN qpms_cleaning_plan.state(p_row->>'STATE') IN ('TN','PY') THEN 'TN' ELSE qpms_cleaning_plan.state(p_row->>'STATE') END)
 IS DISTINCT FROM (CASE WHEN qpms_cleaning_plan.state(s.state) IN ('TN','PY') THEN 'TN' ELSE qpms_cleaning_plan.state(s.state) END)
 THEN RAISE EXCEPTION USING errcode='22023',message='STATE_MISMATCH'; END IF;
 IF coalesce(p_row->>'SCHEDULE_DATE','') !~ '^\\d{4}-\\d{2}-\\d{2}$' THEN RAISE EXCEPTION USING errcode='22023',message='INVALID_DATE'; END IF;
 day:=(p_row->>'SCHEDULE_DATE')::date;
 IF day < date_trunc('month',public.retail_operations_today()::timestamp)::date
 OR day >= (date_trunc('month',public.retail_operations_today()::timestamp)+interval '3 months')::date
 THEN RAISE EXCEPTION USING errcode='22023',message='DATE_OUT_OF_RANGE'; END IF;
 IF length(coalesce(p_row->>'REMARKS',''))>2000 THEN RAISE EXCEPTION USING errcode='22023',message='REMARKS_TOO_LONG'; END IF;
 fo_code:=nullif(btrim(p_row->>'FO_EMPLOYEE_CODE'),'');
 IF fo_code IS NOT NULL THEN
  SELECT count(*) INTO matches FROM public.profiles WHERE upper(btrim(employee_code))=upper(fo_code);
  IF matches<>1 THEN RAISE EXCEPTION USING errcode='22023',message='INVALID_OR_AMBIGUOUS_FO'; END IF;
  SELECT * INTO f FROM public.profiles WHERE upper(btrim(employee_code))=upper(fo_code);
  IF NOT coalesce(f.is_active,false) OR upper(f.status) IS DISTINCT FROM 'ACTIVE' OR f.auth_user_id IS NULL
  OR coalesce(regexp_replace(upper(f.role),'[^A-Z]','','g'),'') NOT IN ('FO','FIELDOFFICER')
  OR coalesce(regexp_replace(upper(f.business),'[^A-Z]','','g'),'') NOT IN ('RELIANCE','RELIANCERETAIL')
  THEN RAISE EXCEPTION USING errcode='22023',message='INELIGIBLE_FO'; END IF;
  IF qpms_cleaning_plan.state(f.state) IS DISTINCT FROM (CASE WHEN qpms_cleaning_plan.state(s.state)='PY' THEN 'TN' ELSE qpms_cleaning_plan.state(s.state) END)
  THEN RAISE EXCEPTION USING errcode='42501',message='FO_STATE_CONFLICT'; END IF;
  IF qpms_cleaning_plan.state(s.state) IN ('TN','PY') THEN
   own:=public.retail_unified_owner(s.id,(day::text||'T23:59:59+05:30')::timestamptz);
   IF coalesce((own->>'known')::boolean,false) IS NOT TRUE OR nullif(own->>'fo_profile_id','')::uuid IS DISTINCT FROM f.id
   THEN RAISE EXCEPTION USING errcode='42501',message='FO_ZONE_ASSIGNMENT_CONFLICT'; END IF;
  END IF;
  fo_id:=f.id;
 END IF;
 SELECT jsonb_build_object('id',id,'status',status,'assigned_fo_profile_id',assigned_fo_profile_id)
 INTO existing FROM public.client_deep_cleaning_schedules WHERE retail_store_id=s.id AND scheduled_date=day;
 RETURN jsonb_build_object('store_id',s.id,'store_code',s.store_code,'state',s.state,'scheduled_date',day,
 'fo_profile_id',fo_id,'fo_employee_code',fo_code,'existing_schedule',existing);
END $function$;
-- Existing rpc_retail_cleaning_plan_v1 imports nullable fo_profile_id without change.
-- Before applying, verify assigned_fo_profile_id is nullable and test preview/import in staging.
