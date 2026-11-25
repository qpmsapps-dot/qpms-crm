-- Reviewed release proposal; install only after CI and production approval.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create or replace function public.fault_tracker_ifms_stages() returns text[]
language sql immutable set search_path=pg_catalog as $$
 select array['Fault Raised - Quote Yet to Submit','Quote Submitted - PO Yet to Receive','PO Received - Fund Request Pending','Fund Released - Work Yet to Start','Fund Released - Work in Progress','Work Completed - Documents Pending','Documents Received - JMS Yet to Create','JMS Created - Invoice Yet to Raise','Invoice Raised - Payment Pending','Set Off Pending','CAMC','OEM','MEPC','IOT','Pest Control','HK','Work Completed - Call Yet to Close']::text[]
$$;
create or replace function public.fault_tracker_ifms_group(p_stage text) returns text
language sql immutable set search_path=pg_catalog,public as $$
 select case when array_position(public.fault_tracker_ifms_stages(),p_stage)=10 then 'Closed'
 when p_stage='Work Completed - Call Yet to Close' or array_position(public.fault_tracker_ifms_stages(),p_stage) between 6 and 9 then 'Completed'
 when array_position(public.fault_tracker_ifms_stages(),p_stage)=5 then 'In Progress' else 'Pending' end
$$;

create or replace function public.rpc_retail_fault_update(p_actor uuid,p_ticket uuid,p_stage text,p_remarks text,p_expected timestamptz,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.profiles%rowtype;t public.fault_tracker_tickets%rowtype;e public.fault_tracker_ticket_updates%rowtype; valid text[]:=public.fault_tracker_ifms_stages();completion boolean; identity jsonb; store_id uuid; effective_stage text; effective_remarks text; effective_version timestamptz; event_time timestamptz;
begin
 select * into p from public.profiles where id=p_actor;
 if not found or p.is_active is not true or upper(coalesce(p.status,'Active'))<>'ACTIVE' or regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') not in ('ADMIN','QPMSADMIN','DEVELOPER','DEV','ITADMIN','MANAGEMENTITADMIN') then raise exception using errcode='42501',message='Existing ticket manager required';end if;
 if p_request is null or p_expected is null or p_stage is null or not(p_stage=any(valid)) or p_remarks is null or length(p_remarks)>4000 then raise exception using errcode='22023',message='Invalid ticket update';end if;
 select * into t from public.fault_tracker_tickets where id=p_ticket;
 if not found or t.is_active is not true or (select count(*) from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(t.store_code)))<>1 or not exists(select 1 from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(t.store_code)) and upper(s.status)='ACTIVE') then raise exception using errcode='42501',message='Eligible active Store Code required';end if;
 select s.id into store_id from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(t.store_code));
 select jsonb_build_array(b.source_name,upper(btrim(t.ticket_no)),upper(btrim(t.store_code)),store_id) into identity from public.fault_tracker_import_batches b where b.id=t.import_batch_id and b.source_name='Reliance Retail IFMS';
 if identity is null or btrim(t.ticket_no)='' or coalesce(btrim(t.store_code),'')='' then raise exception using errcode='42501',message='Verified source and store identity required';end if;
 perform pg_advisory_xact_lock(hashtextextended(identity::text,0));
 perform 1 from public.fault_tracker_tickets where id=t.id for update;
 select * into e from public.fault_tracker_verified_updates(t.id) where metadata->>'retail_request_id'=p_request::text order by created_at desc,id desc limit 1;
 if found then
  if e.new_stage is distinct from p_stage or e.remarks is distinct from p_remarks or e.metadata->>'actor_profile_id' is distinct from p.id::text then raise exception using errcode='40001',message='Request ID reused with different command';end if;
  return jsonb_build_object('id',t.id,'replayed',true);
 end if;
 select * into e from public.fault_tracker_verified_updates(t.id) order by created_at desc,id desc limit 1;
 effective_stage:=case when e.id is not null then e.new_stage else t.stage end;
 effective_remarks:=case when e.id is not null then e.remarks else t.remarks end;
 effective_version:=case when e.id is not null then e.created_at else t.updated_at end;
 if effective_version is distinct from p_expected then raise exception using errcode='40001',message='Ticket changed';end if;
 completion:=(array_position(valid,effective_stage) between 1 and 5 or array_position(valid,effective_stage) between 11 and 16) and (array_position(valid,p_stage) between 6 and 10 or p_stage='Work Completed - Call Yet to Close');
 event_time:=greatest(clock_timestamp(),effective_version+interval '1 microsecond');
 insert into public.fault_tracker_ticket_updates(ticket_id,updated_by_auth_user_id,updated_by_employee_code,update_type,previous_stage,new_stage,remarks,metadata,created_at)
 values(t.id,p.auth_user_id,p.employee_code,case when completion then 'WORK_COMPLETED' else 'STAGE_OR_REMARKS' end,effective_stage,p_stage,p_remarks,jsonb_build_object('retail_request_id',p_request,'retail_workflow_version',1,'actor_profile_id',p.id,'previous_remarks',effective_remarks,'ifms_identity',identity),event_time);
 return jsonb_build_object('id',t.id,'saved',true);
end;$$;

create or replace function public.retail_mis_fault_update(p_actor uuid,p_ticket uuid,p_stage text,p_remarks text,p_expected timestamptz,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.profiles%rowtype;t public.fault_tracker_tickets%rowtype;e public.fault_tracker_ticket_updates%rowtype; valid text[]:=public.fault_tracker_ifms_stages();completion boolean; identity jsonb; store_id uuid; effective_stage text; effective_remarks text; effective_version timestamptz; event_time timestamptz;
begin
 select * into p from public.profiles where id=p_actor;
 if not found or p.is_active is not true or upper(coalesce(p.status,'Active'))<>'ACTIVE' or not public.retail_mis_allowed(p_actor,'fault',null,true) then raise exception using errcode='42501',message='Existing ticket manager required';end if;
 if p_request is null or p_expected is null or p_stage is null or not(p_stage=any(valid)) or p_remarks is null or length(p_remarks)>4000 then raise exception using errcode='22023',message='Invalid ticket update';end if;
 select * into t from public.fault_tracker_tickets where id=p_ticket;
 if not found or t.is_active is not true or (select count(*) from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(t.store_code)))<>1 or not exists(select 1 from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(t.store_code)) and upper(s.status)='ACTIVE') then raise exception using errcode='42501',message='Eligible active Store Code required';end if;
 if not exists(select 1 from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(t.store_code)) and public.retail_mis_allowed(p_actor,'fault',s.state,true)) then raise exception using errcode='42501',message='Outside assigned state';end if;
 select s.id into store_id from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(t.store_code));
 select jsonb_build_array(b.source_name,upper(btrim(t.ticket_no)),upper(btrim(t.store_code)),store_id) into identity from public.fault_tracker_import_batches b where b.id=t.import_batch_id and b.source_name='Reliance Retail IFMS';
 if identity is null or btrim(t.ticket_no)='' or coalesce(btrim(t.store_code),'')='' then raise exception using errcode='42501',message='Verified source and store identity required';end if;
 perform pg_advisory_xact_lock(hashtextextended(identity::text,0));
 perform 1 from public.fault_tracker_tickets where id=t.id for update;
 select * into e from public.fault_tracker_verified_updates(t.id) where metadata->>'retail_request_id'=p_request::text order by created_at desc,id desc limit 1;
 if found then
  if e.new_stage is distinct from p_stage or e.remarks is distinct from p_remarks or e.metadata->>'actor_profile_id' is distinct from p.id::text then raise exception using errcode='40001',message='Request ID reused with different command';end if;
  return jsonb_build_object('id',t.id,'replayed',true);
 end if;
 select * into e from public.fault_tracker_verified_updates(t.id) order by created_at desc,id desc limit 1;
 effective_stage:=case when e.id is not null then e.new_stage else t.stage end;
 effective_remarks:=case when e.id is not null then e.remarks else t.remarks end;
 effective_version:=case when e.id is not null then e.created_at else t.updated_at end;
 if effective_version is distinct from p_expected then raise exception using errcode='40001',message='Ticket changed';end if;
 completion:=(array_position(valid,effective_stage) between 1 and 5 or array_position(valid,effective_stage) between 11 and 16) and (array_position(valid,p_stage) between 6 and 10 or p_stage='Work Completed - Call Yet to Close');
 event_time:=greatest(clock_timestamp(),effective_version+interval '1 microsecond');
 insert into public.fault_tracker_ticket_updates(ticket_id,updated_by_auth_user_id,updated_by_employee_code,update_type,previous_stage,new_stage,remarks,metadata,created_at)
 values(t.id,p.auth_user_id,p.employee_code,case when completion then 'WORK_COMPLETED' else 'STAGE_OR_REMARKS' end,effective_stage,p_stage,p_remarks,jsonb_build_object('retail_request_id',p_request,'retail_workflow_version',1,'actor_profile_id',p.id,'previous_remarks',effective_remarks,'ifms_identity',identity),event_time);
 return jsonb_build_object('id',t.id,'saved',true);
end;$$;

commit;
