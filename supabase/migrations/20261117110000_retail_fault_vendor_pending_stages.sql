-- Approved 2026-11-17: extend Retail Fault Tracker to 14 stages.
-- The four appended options are pending vendor calls; never classify as completed/closed.
-- Preserve existing authorization, idempotency, immutable import snapshots and history.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
DO $guard$
BEGIN
 IF to_regprocedure('public.rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid)') IS NULL OR
    to_regprocedure('public.retail_mis_fault_update(uuid,uuid,text,text,timestamptz,uuid)') IS NULL THEN
  RAISE EXCEPTION 'Existing Retail Fault Tracker functions required; stop rather than create a new bypass';
 END IF;
 IF (SELECT md5(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='rpc_retail_fault_update') <> 'c23ca06d8a5446c69b624112c817e9fa' OR
    (SELECT md5(p.prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='retail_mis_fault_update') <> '991f7fb1c7b9e47b34e662f4819df476' THEN
   RAISE EXCEPTION 'Retail Fault Tracker live function fingerprints changed; review current definitions before installing';
 END IF;
END
$guard$;

create or replace function public.rpc_retail_fault_update(p_actor uuid,p_ticket uuid,p_stage text,p_remarks text,p_expected timestamptz,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.profiles%rowtype;t public.fault_tracker_tickets%rowtype;e public.fault_tracker_ticket_updates%rowtype; valid text[]:=array['Fault Raised - Quote Yet to Submit','Quote Submitted - PO Yet to Receive','PO Received - Fund Request Pending','Fund Released - Work Yet to Start','Fund Released - Work in Progress','Work Completed - Documents Pending','Documents Received - JMS Yet to Create','JMS Created - Invoice Yet to Raise','Invoice Raised - Payment Pending','Set Off Pending','CAMC','OEM','MEPC','IOT'];completion boolean;
begin
 select * into p from public.profiles where id=p_actor;
 if not found or p.is_active is not true or upper(coalesce(p.status,'Active'))<>'ACTIVE' or regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') not in ('ADMIN','QPMSADMIN','DEVELOPER','DEV','ITADMIN','MANAGEMENTITADMIN') then raise exception using errcode='42501',message='Existing ticket manager required';end if;
 if p_request is null or p_expected is null or p_stage is null or not(p_stage=any(valid)) or p_remarks is null or length(p_remarks)>4000 then raise exception using errcode='22023',message='Invalid ticket update';end if;
 select * into t from public.fault_tracker_tickets where id=p_ticket for update;
 if not found or t.is_active is not true or (select count(*) from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(t.store_code)))<>1 or not exists(select 1 from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(t.store_code)) and upper(s.status)='ACTIVE') then raise exception using errcode='42501',message='Eligible active Store Code required';end if;
 select * into e from public.fault_tracker_ticket_updates where ticket_id=t.id and metadata->>'retail_request_id'=p_request::text;
 if found then
  if e.new_stage is distinct from p_stage or e.remarks is distinct from p_remarks or e.metadata->>'actor_profile_id' is distinct from p.id::text then raise exception using errcode='40001',message='Request ID reused with different command';end if;
  return jsonb_build_object('id',t.id,'replayed',true);
 end if;
 if t.updated_at is distinct from p_expected then raise exception using errcode='40001',message='Ticket changed';end if;
 completion:=(array_position(valid,t.stage) between 1 and 5 or array_position(valid,t.stage) between 11 and 14) and array_position(valid,p_stage) between 6 and 10;
 insert into public.fault_tracker_ticket_updates(ticket_id,updated_by_auth_user_id,updated_by_employee_code,update_type,previous_stage,new_stage,remarks,metadata)
 values(t.id,p.auth_user_id,p.employee_code,case when completion then 'WORK_COMPLETED' else 'STAGE_OR_REMARKS' end,t.stage,p_stage,p_remarks,jsonb_build_object('retail_request_id',p_request,'retail_workflow_version',1,'actor_profile_id',p.id,'previous_remarks',t.remarks));
 update public.fault_tracker_tickets set stage=p_stage,stage_group=case when array_position(valid,p_stage)=10 then 'Closed' when array_position(valid,p_stage) between 6 and 9 then 'Completed' when array_position(valid,p_stage)=5 then 'In Progress' else 'Pending' end,remarks=p_remarks,updated_at=clock_timestamp(),metadata=coalesce(metadata,'{}')||jsonb_build_object('lastUpdatedBy',p.employee_code) where id=t.id;
 return jsonb_build_object('id',t.id,'saved',true);
end;$$;

create or replace function public.retail_mis_fault_update(p_actor uuid,p_ticket uuid,p_stage text,p_remarks text,p_expected timestamptz,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.profiles%rowtype;t public.fault_tracker_tickets%rowtype;e public.fault_tracker_ticket_updates%rowtype; valid text[]:=array['Fault Raised - Quote Yet to Submit','Quote Submitted - PO Yet to Receive','PO Received - Fund Request Pending','Fund Released - Work Yet to Start','Fund Released - Work in Progress','Work Completed - Documents Pending','Documents Received - JMS Yet to Create','JMS Created - Invoice Yet to Raise','Invoice Raised - Payment Pending','Set Off Pending','CAMC','OEM','MEPC','IOT'];completion boolean;
begin
 select * into p from public.profiles where id=p_actor;
 if not found or p.is_active is not true or upper(coalesce(p.status,'Active'))<>'ACTIVE' or not public.retail_mis_allowed(p_actor,'fault',null,true) then raise exception using errcode='42501',message='Existing ticket manager required';end if;
 if p_request is null or p_expected is null or p_stage is null or not(p_stage=any(valid)) or p_remarks is null or length(p_remarks)>4000 then raise exception using errcode='22023',message='Invalid ticket update';end if;
 select * into t from public.fault_tracker_tickets where id=p_ticket for update;
 if not found or t.is_active is not true or (select count(*) from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(t.store_code)))<>1 or not exists(select 1 from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(t.store_code)) and upper(s.status)='ACTIVE') then raise exception using errcode='42501',message='Eligible active Store Code required';end if;
 if not exists(select 1 from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(t.store_code)) and public.retail_mis_allowed(p_actor,'fault',s.state,true)) then raise exception using errcode='42501',message='Outside assigned state';end if;
 select * into e from public.fault_tracker_ticket_updates where ticket_id=t.id and metadata->>'retail_request_id'=p_request::text;
 if found then
  if e.new_stage is distinct from p_stage or e.remarks is distinct from p_remarks or e.metadata->>'actor_profile_id' is distinct from p.id::text then raise exception using errcode='40001',message='Request ID reused with different command';end if;
  return jsonb_build_object('id',t.id,'replayed',true);
 end if;
 if t.updated_at is distinct from p_expected then raise exception using errcode='40001',message='Ticket changed';end if;
 completion:=(array_position(valid,t.stage) between 1 and 5 or array_position(valid,t.stage) between 11 and 14) and array_position(valid,p_stage) between 6 and 10;
 insert into public.fault_tracker_ticket_updates(ticket_id,updated_by_auth_user_id,updated_by_employee_code,update_type,previous_stage,new_stage,remarks,metadata)
 values(t.id,p.auth_user_id,p.employee_code,case when completion then 'WORK_COMPLETED' else 'STAGE_OR_REMARKS' end,t.stage,p_stage,p_remarks,jsonb_build_object('retail_request_id',p_request,'retail_workflow_version',1,'actor_profile_id',p.id,'previous_remarks',t.remarks));
 update public.fault_tracker_tickets set stage=p_stage,stage_group=case when array_position(valid,p_stage)=10 then 'Closed' when array_position(valid,p_stage) between 6 and 9 then 'Completed' when array_position(valid,p_stage)=5 then 'In Progress' else 'Pending' end,remarks=p_remarks,updated_at=clock_timestamp(),metadata=coalesce(metadata,'{}')||jsonb_build_object('lastUpdatedBy',p.employee_code) where id=t.id;
 return jsonb_build_object('id',t.id,'saved',true);
end;$$;

-- Fail closed if any permission changed by replacement (none expected).
DO $verify$
BEGIN
 IF has_function_privilege('anon','public.rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid)','EXECUTE') OR
    has_function_privilege('authenticated','public.rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid)','EXECUTE') OR
    NOT has_function_privilege('service_role','public.rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid)','EXECUTE') THEN
  RAISE EXCEPTION 'Unexpected Fault Tracker RPC privilege after replacement';
 END IF;
END
$verify$;
COMMIT;
