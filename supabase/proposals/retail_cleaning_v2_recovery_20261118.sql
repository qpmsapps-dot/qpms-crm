-- RECOVERY ONLY: NOT an installation step. Separate production approval required.
-- Preserve all schedules, evidence, submitted records, links and audit history.
BEGIN;
SET LOCAL lock_timeout='5s';
ALTER TABLE public.client_deep_cleaning_submissions DISABLE TRIGGER z90_cleaning_verified_match_v2;
REVOKE EXECUTE ON FUNCTION public.rpc_retail_cleaning_manual_link_v2(uuid,uuid,text,jsonb) FROM service_role;
UPDATE public.access_roles SET active=false WHERE code='retail_deep_cleaning_schedule_writer' AND module_id=(SELECT id FROM public.access_modules WHERE code='deep_cleaning') AND user_type='internal';
DO $recovery$
DECLARE installed text;
BEGIN
 SELECT replace(pg_get_functiondef('qpms_cleaning_plan.validate_row(uuid,jsonb)'::regprocedure),E'\r\n',E'\n') INTO installed;
 IF md5(installed)='e5aa6e5049715c94e426376669772d70' THEN RETURN; END IF;
 IF md5(installed)<>'0bdf1da8bbfea39e7d4af22b54e973e5' THEN RAISE EXCEPTION 'Recovery contract drift: qpms_cleaning_plan.validate_row(uuid,jsonb)'; END IF;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION qpms_cleaning_plan.validate_row(p_actor uuid, p_row jsonb)
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
END $recovery$;
DO $recovery$
DECLARE installed text;
BEGIN
 SELECT replace(pg_get_functiondef('public.rpc_retail_cleaning_plan_v1(uuid,uuid,text,jsonb)'::regprocedure),E'\r\n',E'\n') INTO installed;
 IF md5(installed)='b506646a0ae8b14cef719facb709366f' THEN RETURN; END IF;
 IF md5(installed)<>'d5716c616191061673278a59bd65c8d5' THEN RAISE EXCEPTION 'Recovery contract drift: public.rpc_retail_cleaning_plan_v1(uuid,uuid,text,jsonb)'; END IF;
 EXECUTE $definition$CREATE OR REPLACE FUNCTION public.rpc_retail_cleaning_plan_v1(p_actor uuid, p_auth uuid, p_action text, p_data jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'qpms_cleaning_plan'
AS $function$
declare row_value jsonb; v jsonb; results jsonb:='[]'; issues jsonb; keys text[]:='{}'; key text;
 valid_count integer:=0; row_number integer:=1; request uuid; receipt jsonb; digest text;
 c public.client_deep_cleaning_schedules%rowtype; before_value jsonb; revision integer; reason text; target_date date;
begin
 if not exists(select 1 from public.profiles where id=p_actor and auth_user_id=p_auth and is_active=true and upper(status)='ACTIVE') then raise exception using errcode='42501',message='Verified actor required';end if;
 if not exists(select 1 from public.reliance_retail_store_master where public.retail_mis_cleaning_access(p_actor,state,'edit')) then raise exception using errcode='42501',message='Active Cleaning MIS assignment required';end if;
 if p_action='list' then
  if coalesce(p_data->>'month','')!~'^\d{4}-(0[1-9]|1[0-2])$' then raise exception using errcode='22023',message='Month required';end if;
  return jsonb_build_object('schedules',(select coalesce(jsonb_agg(to_jsonb(q) order by q.scheduled_date,q.id),'[]') from
   (select plan.*,s.store_code,s.store_name,s.state,f.employee_code as fo_employee_code,
    coalesce((plan.metadata->>'plan_revision')::integer,0) as revision,
    exists(select 1 from public.client_deep_cleaning_submissions d where d.schedule_id=plan.id) as started
    from public.client_deep_cleaning_schedules plan join public.reliance_retail_store_master s on s.id=plan.retail_store_id
    left join public.profiles f on f.id=plan.assigned_fo_profile_id
    where to_char(plan.scheduled_date,'YYYY-MM')=p_data->>'month' and public.retail_mis_cleaning_access(p_actor,s.state,'edit')) q));
 elsif p_action='history' then
  select * into c from public.client_deep_cleaning_schedules where id=(p_data->>'schedule_id')::uuid;
  if not found or not exists(select 1 from public.reliance_retail_store_master where id=c.retail_store_id and public.retail_mis_cleaning_access(p_actor,state,'edit')) then raise exception using errcode='42501',message='Schedule scope denied';end if;
  return jsonb_build_object('history',(select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at),'[]') from public.reliance_retail_management_audit a where a.entity_type='deep_cleaning_schedule' and a.entity_id=c.id));
 end if;
 if p_action not in ('preview','import','correct') then raise exception using errcode='22023',message='Unknown action';end if;
 -- Preview is read-only. All committed mutations acquire the shared DB fence.
 if p_action<>'preview' then perform qpms_release.assert_mutation();end if;
 if p_action in ('preview','import') then
  if jsonb_typeof(p_data->'rows') is distinct from 'array' or jsonb_array_length(p_data->'rows') not between 1 and 500 then raise exception using errcode='22023',message='Supply 1-500 rows';end if;
  if coalesce(p_data->>'month','')!~'^\d{4}-(0[1-9]|1[0-2])$' then raise exception using errcode='22023',message='Month required';end if;
  if p_action='import' then
   request:=(p_data->>'request_id')::uuid;if request is null then raise exception 'Import identity required';end if;
   digest:=md5((p_data-'request_id')::text);
   perform pg_advisory_xact_lock(hashtextextended('cleaning-import:'||request,0));
   select after_state into receipt from public.reliance_retail_management_audit where action='CLEANING_MONTHLY_IMPORT' and entity_id=request limit 1;
   if found then
    if receipt->>'actor' is distinct from p_actor::text or receipt->>'digest' is distinct from digest then raise exception using errcode='23505',message='Import identity reused with changed payload';end if;
    return receipt||jsonb_build_object('replayed',true);
   end if;
   -- Deterministic lock order prevents simultaneous imports/corrections changing validation.
   perform 1 from public.reliance_retail_store_master s where upper(btrim(s.store_code)) in (select upper(btrim(x->>'STORE_CODE')) from jsonb_array_elements(p_data->'rows') x) order by s.id for update;
   perform 1 from public.profiles f where upper(btrim(f.employee_code)) in (select upper(btrim(x->>'FO_EMPLOYEE_CODE')) from jsonb_array_elements(p_data->'rows') x) order by f.id for share;
  end if;
  for row_value in select value from jsonb_array_elements(p_data->'rows') loop
   row_number:=row_number+1;issues:='[]';v:=null;
   begin
    v:=qpms_cleaning_plan.validate_row(p_actor,row_value);
    if left(v->>'scheduled_date',7)<>p_data->>'month' then issues:=issues||'"MONTH_MISMATCH"'::jsonb;end if;
    key:=(v->>'store_id')||':'||(v->>'scheduled_date');
    if key=any(keys) then issues:=issues||'"DUPLICATE_IN_FILE"'::jsonb;end if;keys:=array_append(keys,key);
    if v->'existing_schedule'<>'null'::jsonb then issues:=issues||'"EXISTING_SCHEDULE_USE_CORRECTION"'::jsonb;end if;
   exception when sqlstate '22023' or sqlstate '22007' or sqlstate '22008' or sqlstate '42501' or sqlstate '23505' then issues:=jsonb_build_array(sqlerrm);end;
   if issues='[]'::jsonb then valid_count:=valid_count+1;end if;
   results:=results||jsonb_build_array(jsonb_build_object('row',row_number,'input',row_value,'resolved',v,'errors',issues));
  end loop;
  if p_action='preview' then return jsonb_build_object('rows',results,'total',jsonb_array_length(results),'valid',valid_count,'invalid',jsonb_array_length(results)-valid_count);end if;
  if valid_count<>jsonb_array_length(results) then raise exception using errcode='22023',message='Import rejected: resolve every preview error; no rows imported',detail=results::text;end if;
  receipt:='[]';
  for row_value in select value from jsonb_array_elements(results) loop
   v:=row_value->'resolved';
   insert into public.client_deep_cleaning_schedules(retail_store_id,scheduled_date,assigned_fo_profile_id,status,source_type,source_reference,created_by_profile_id,metadata)
   values((v->>'store_id')::uuid,(v->>'scheduled_date')::date,(v->>'fo_profile_id')::uuid,'Planned','MIS_DIRECT',request::text||':'||(row_value->>'row'),p_actor,
    jsonb_build_object('source','monthly_cleaning_v1','import_id',request,'row',row_value->'row','notes',row_value->'input'->>'REMARKS','plan_revision',0)) returning * into c;
   insert into public.reliance_retail_management_audit(action,entity_type,entity_id,actor_profile_id,after_state) values('CLEANING_MONTHLY_ROW','deep_cleaning_schedule',c.id,p_actor,to_jsonb(c));
   receipt:=receipt||jsonb_build_array(jsonb_build_object('row',row_value->'row','schedule_id',c.id,'store_id',c.retail_store_id,'fo_profile_id',c.assigned_fo_profile_id));
  end loop;
  receipt:=jsonb_build_object('actor',p_actor,'digest',digest,'request_id',request,'receipts',receipt,'replayed',false);
  insert into public.reliance_retail_management_audit(action,entity_type,entity_id,actor_profile_id,after_state) values('CLEANING_MONTHLY_IMPORT','cleaning_import',request,p_actor,receipt);
  return receipt;
 end if;
 -- Lock parent BEFORE checking drafts, exactly as submission/finalization does.
 select * into c from public.client_deep_cleaning_schedules where id=(p_data->>'schedule_id')::uuid for update;
 if not found or not exists(select 1 from public.reliance_retail_store_master where id=c.retail_store_id and public.retail_mis_cleaning_access(p_actor,state,'edit')) then raise exception using errcode='42501',message='Schedule scope denied';end if;
 reason:=btrim(coalesce(p_data->>'reason',''));
 if length(reason) not between 8 and 2000 then raise exception using errcode='22023',message='Correction reason must be 8-2000 characters';end if;
 revision:=coalesce((c.metadata->>'plan_revision')::integer,0);
 if (p_data->>'revision')::integer is distinct from revision then raise exception using errcode='40001',message='Schedule changed; refresh before correction';end if;
 if c.status not in ('Planned','Scheduled') or exists(select 1 from public.client_deep_cleaning_submissions where schedule_id=c.id) then raise exception using errcode='40001',message='Started or terminal schedule cannot be corrected';end if;
 if p_data->>'operation' not in ('cancel','reassign','reschedule') or p_data->>'operation' is null then raise exception using errcode='22023',message='Invalid correction operation';end if;
 before_value:=to_jsonb(c);
 if p_data->>'operation'='cancel' then c.status:='Cancelled';c.not_done_reason:=reason;
 else
  select jsonb_build_object('STATE',s.state,'STORE_CODE',s.store_code,'SCHEDULE_DATE',coalesce(p_data->>'scheduled_date',c.scheduled_date::text),'FO_EMPLOYEE_CODE',coalesce(p_data->>'fo_employee_code',f.employee_code)) into row_value
  from public.reliance_retail_store_master s left join public.profiles f on f.id=c.assigned_fo_profile_id where s.id=c.retail_store_id;
  v:=qpms_cleaning_plan.validate_row(p_actor,row_value);target_date:=(v->>'scheduled_date')::date;
  if v->'existing_schedule'->>'id' is not null and v->'existing_schedule'->>'id'<>c.id::text then raise exception using errcode='23505',message='Target date already scheduled';end if;
  c.scheduled_date:=target_date;c.assigned_fo_profile_id:=(v->>'fo_profile_id')::uuid;
 end if;
 update public.client_deep_cleaning_schedules set scheduled_date=c.scheduled_date,assigned_fo_profile_id=c.assigned_fo_profile_id,status=c.status,not_done_reason=c.not_done_reason,
 metadata=metadata||jsonb_build_object('plan_revision',revision+1),updated_at=clock_timestamp() where id=c.id returning * into c;
 insert into public.reliance_retail_management_audit(action,entity_type,entity_id,actor_profile_id,before_state,after_state)
 values('CLEANING_CORRECTION','deep_cleaning_schedule',c.id,p_actor,before_value,to_jsonb(c)||jsonb_build_object('correction_reason',reason,'operation',p_data->>'operation'));
 return jsonb_build_object('schedule',to_jsonb(c),'revision',revision+1);
end $function$
$definition$;
END $recovery$;
COMMIT;
