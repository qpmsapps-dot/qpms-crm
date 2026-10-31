-- PROPOSAL ONLY. Requires explicit production installation authorization.
-- Reuse existing ticket/update tables; never rewrite imported raw_row/source dates.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create unique index if not exists retail_fault_update_request on public.fault_tracker_ticket_updates(ticket_id,(metadata->>'retail_request_id')) where metadata ? 'retail_request_id';
create or replace function public.rpc_retail_fault_update_capability() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$select true$$;
create or replace function public.rpc_retail_fault_update(p_actor uuid,p_ticket uuid,p_stage text,p_remarks text,p_expected timestamptz,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.profiles%rowtype;t public.fault_tracker_tickets%rowtype;e public.fault_tracker_ticket_updates%rowtype; valid text[]:=array['Fault Raised - Quote Yet to Submit','Quote Submitted - PO Yet to Receive','PO Received - Fund Request Pending','Fund Released - Work Yet to Start','Fund Released - Work in Progress','Work Completed - Documents Pending','Documents Received - JMS Yet to Create','JMS Created - Invoice Yet to Raise','Invoice Raised - Payment Pending','Set Off Pending'];completion boolean;
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
 completion:=array_position(valid,t.stage) between 1 and 5 and array_position(valid,p_stage)>=6;
 insert into public.fault_tracker_ticket_updates(ticket_id,updated_by_auth_user_id,updated_by_employee_code,update_type,previous_stage,new_stage,remarks,metadata)
 values(t.id,p.auth_user_id,p.employee_code,case when completion then 'WORK_COMPLETED' else 'STAGE_OR_REMARKS' end,t.stage,p_stage,p_remarks,jsonb_build_object('retail_request_id',p_request,'retail_workflow_version',1,'actor_profile_id',p.id,'previous_remarks',t.remarks));
 update public.fault_tracker_tickets set stage=p_stage,stage_group=case when array_position(valid,p_stage)=10 then 'Closed' when array_position(valid,p_stage)>=6 then 'Completed' when array_position(valid,p_stage)=5 then 'In Progress' else 'Pending' end,remarks=p_remarks,updated_at=clock_timestamp(),metadata=coalesce(metadata,'{}')||jsonb_build_object('lastUpdatedBy',p.employee_code) where id=t.id;
 return jsonb_build_object('id',t.id,'saved',true);
end;$$;
revoke all on function public.rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid),public.rpc_retail_fault_update_capability() from public,anon,authenticated;
grant execute on function public.rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid),public.rpc_retail_fault_update_capability() to service_role;
commit;
