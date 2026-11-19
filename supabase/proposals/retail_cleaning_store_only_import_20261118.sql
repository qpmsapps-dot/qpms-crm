-- REVIEW ONLY: no production execution authorized. Transactional, drift-checked and idempotent.
-- Existing owner-only ACL, SECURITY DEFINER/search_path and every supplied-FO check remain intact.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $migration$
DECLARE current_definition text; target_definition text;
BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
  AND table_name='client_deep_cleaning_schedules' AND column_name='assigned_fo_profile_id' AND is_nullable<>'YES')
 THEN RAISE EXCEPTION 'FO assignment must already be nullable'; END IF;
 SELECT replace(pg_get_functiondef('qpms_cleaning_plan.validate_row(uuid,jsonb)'::regprocedure),E'\r\n',E'\n') INTO current_definition;
 IF md5(current_definition)='e5aa6e5049715c94e426376669772d70' THEN RETURN; END IF;
 IF md5(current_definition)<>'d4314e51599273b625824601a125238c' THEN RAISE EXCEPTION 'Cleaning validator drift: review installed definition before migration'; END IF;
 target_definition := $definition$CREATE OR REPLACE FUNCTION qpms_cleaning_plan.validate_row(p_actor uuid, p_row jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'qpms_cleaning_plan'
AS $function$
declare s public.reliance_retail_store_master%rowtype; f public.profiles%rowtype;
 day date; matches integer; own jsonb; existing jsonb;
begin
 if jsonb_typeof(p_row)<>'object' then raise exception using errcode='22023',message='Invalid row';end if;
 select count(*) into matches from public.reliance_retail_store_master where upper(btrim(store_code))=upper(btrim(p_row->>'STORE_CODE'));
 if matches<>1 then raise exception using errcode='22023',message='UNKNOWN_OR_AMBIGUOUS_STORE_CODE';end if;
 select * into s from public.reliance_retail_store_master where upper(btrim(store_code))=upper(btrim(p_row->>'STORE_CODE'));
 if s.status<>'Active' then raise exception using errcode='22023',message='INACTIVE_STORE';end if;
 if not public.retail_mis_cleaning_access(p_actor,(case when qpms_cleaning_plan.state(s.state)='PY' then 'TN' else s.state end),'edit') then raise exception using errcode='42501',message='STATE_SCOPE_DENIED';end if;
 if (case when qpms_cleaning_plan.state(p_row->>'STATE') in ('TN','PY') then 'TN' else qpms_cleaning_plan.state(p_row->>'STATE') end) is distinct from (case when qpms_cleaning_plan.state(s.state) in ('TN','PY') then 'TN' else qpms_cleaning_plan.state(s.state) end) then raise exception using errcode='22023',message='STATE_MISMATCH';end if;
 if coalesce(p_row->>'SCHEDULE_DATE','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception using errcode='22023',message='INVALID_DATE';end if;
 day:=(p_row->>'SCHEDULE_DATE')::date;
 if day < date_trunc('month',public.retail_operations_today()::timestamp)::date or day >= (date_trunc('month',public.retail_operations_today()::timestamp) + interval '3 months')::date then raise exception using errcode='22023',message='DATE_OUT_OF_RANGE';end if;
 if length(coalesce(p_row->>'REMARKS',''))>2000 then raise exception using errcode='22023',message='REMARKS_TOO_LONG';end if;
 -- cleaning-store-only.v1: supplied FO validation is unchanged.
 if nullif(btrim(p_row->>'FO_EMPLOYEE_CODE'),'') is not null then
 select count(*) into matches from public.profiles where upper(btrim(employee_code))=upper(btrim(p_row->>'FO_EMPLOYEE_CODE'));
 if matches<>1 then raise exception using errcode='22023',message='INVALID_OR_AMBIGUOUS_FO';end if;
 select * into f from public.profiles where upper(btrim(employee_code))=upper(btrim(p_row->>'FO_EMPLOYEE_CODE'));
 if not coalesce(f.is_active,false) or upper(f.status) is distinct from 'ACTIVE' or f.auth_user_id is null
 or coalesce(regexp_replace(upper(f.role),'[^A-Z]','','g'),'') not in ('FO','FIELDOFFICER')
 or coalesce(regexp_replace(upper(f.business),'[^A-Z]','','g'),'') not in ('RELIANCE','RELIANCERETAIL') then raise exception using errcode='22023',message='INELIGIBLE_FO';end if;
 if qpms_cleaning_plan.state(f.state) is distinct from (case when qpms_cleaning_plan.state(s.state)='PY' then 'TN' else qpms_cleaning_plan.state(s.state) end) then raise exception using errcode='42501',message='FO_STATE_CONFLICT';end if;
 if qpms_cleaning_plan.state(s.state) in ('TN','PY') then
  own:=public.retail_unified_owner(s.id,(day::text||'T23:59:59+05:30')::timestamptz);
  if coalesce((own->>'known')::boolean,false) is not true or nullif(own->>'fo_profile_id','')::uuid is distinct from f.id then raise exception using errcode='42501',message='FO_ZONE_ASSIGNMENT_CONFLICT';end if;
 end if;
 end if;
 select jsonb_build_object('id',id,'status',status,'assigned_fo_profile_id',assigned_fo_profile_id) into existing
 from public.client_deep_cleaning_schedules where retail_store_id=s.id and scheduled_date=day;
 return jsonb_build_object('store_id',s.id,'store_code',s.store_code,'state',s.state,'scheduled_date',day,'fo_profile_id',f.id,'fo_employee_code',f.employee_code,'existing_schedule',existing);
end $function$
$definition$;
 EXECUTE target_definition;
 IF md5(replace(pg_get_functiondef('qpms_cleaning_plan.validate_row(uuid,jsonb)'::regprocedure),E'\r\n',E'\n'))<>'e5aa6e5049715c94e426376669772d70'
 THEN RAISE EXCEPTION 'Installed cleaning validator does not match reviewed bytes'; END IF;
END $migration$;
COMMIT;
