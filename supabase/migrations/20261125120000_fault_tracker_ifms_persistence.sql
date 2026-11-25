-- REVIEW ONLY until separately approved for production. No data rewrite/backfill.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$
begin
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.rpc_retail_fault_update(uuid,uuid,text,text,timestamptz,uuid)')) is distinct from 'c1eb37f6b5cac6031791273a55ce4530'
 or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.retail_mis_fault_update(uuid,uuid,text,text,timestamptz,uuid)')) is distinct from '7d0f7ab70f1f94eb01388ba6f526d961' then
  raise exception 'Fault update definitions drifted; review installed functions before proceeding';
 end if;
end $$;

-- A number reused at another store is a different ticket. Preserve the code's
-- punctuation/leading zeros; never infer an identity from store name or state.
alter table public.fault_tracker_tickets drop constraint fault_tracker_tickets_import_ticket_unique;
create unique index fault_tracker_import_identity_unique on public.fault_tracker_tickets
 (import_batch_id,upper(btrim(ticket_no)),upper(btrim(coalesce(store_code,''))));
create index fault_tracker_history_identity on public.fault_tracker_tickets
 (upper(btrim(ticket_no)),upper(btrim(store_code)),import_batch_id);
create index fault_tracker_verified_event_order on public.fault_tracker_ticket_updates(ticket_id,created_at desc,id desc);

create function public.fault_tracker_ifms_stages() returns text[]
language sql immutable set search_path=pg_catalog as $$
 select array['Fault Raised - Quote Yet to Submit','Quote Submitted - PO Yet to Receive','PO Received - Fund Request Pending','Fund Released - Work Yet to Start','Fund Released - Work in Progress','Work Completed - Documents Pending','Documents Received - JMS Yet to Create','JMS Created - Invoice Yet to Raise','Invoice Raised - Payment Pending','Set Off Pending','CAMC','OEM','MEPC','IOT']::text[]
$$;
create function public.fault_tracker_ifms_group(p_stage text) returns text
language sql immutable set search_path=pg_catalog,public as $$
 select case when array_position(public.fault_tracker_ifms_stages(),p_stage)=10 then 'Closed'
 when array_position(public.fault_tracker_ifms_stages(),p_stage) between 6 and 9 then 'Completed'
 when array_position(public.fault_tracker_ifms_stages(),p_stage)=5 then 'In Progress' else 'Pending' end
$$;

-- Only server workflow events with matching actor evidence qualify. Old events
-- derive identity from their original immutable FK/batch; new events also pin it
-- in metadata. A deleted/recreated canonical store cannot inherit pinned history.
create function public.fault_tracker_verified_updates(p_ticket uuid)
returns setof public.fault_tracker_ticket_updates
language sql stable set search_path=pg_catalog,public as $$
 select u.*
 from public.fault_tracker_tickets target
 join public.fault_tracker_import_batches tb on tb.id=target.import_batch_id and tb.source_name='Reliance Retail IFMS'
 join public.reliance_retail_store_master s on upper(btrim(s.store_code))=upper(btrim(target.store_code))
 join public.fault_tracker_tickets original on upper(btrim(original.ticket_no))=upper(btrim(target.ticket_no))
  and upper(btrim(original.store_code))=upper(btrim(target.store_code))
 join public.fault_tracker_import_batches ob on ob.id=original.import_batch_id and ob.source_name=tb.source_name
 join public.fault_tracker_ticket_updates u on u.ticket_id=original.id
 join public.profiles actor on actor.id::text=u.metadata->>'actor_profile_id'
  and actor.auth_user_id=u.updated_by_auth_user_id and actor.employee_code=u.updated_by_employee_code
 where target.id=p_ticket and btrim(target.ticket_no)<>'' and btrim(target.store_code)<>''
 and (select count(*) from public.reliance_retail_store_master x where upper(btrim(x.store_code))=upper(btrim(target.store_code)))=1
 and u.metadata->>'retail_workflow_version'='1'
 and u.metadata->>'retail_request_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 and u.update_type in ('STAGE_OR_REMARKS','WORK_COMPLETED')
 and u.new_stage=any(public.fault_tracker_ifms_stages()) and u.remarks is not null
 and (not(u.metadata ? 'ifms_identity') or u.metadata->'ifms_identity'=jsonb_build_array(tb.source_name,upper(btrim(target.ticket_no)),upper(btrim(target.store_code)),s.id))
$$;

-- Invoked only after the existing backend state/store authorization. Service
-- role only, just like the existing server-mediated update RPC. No RLS changes.
create function public.rpc_fault_tracker_retained_updates(p_tickets uuid[]) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(jsonb_build_object(
 'id',t.id,'source_stage',t.stage,'source_remarks',t.remarks,
 'stage',case when e.id is not null then e.new_stage else t.stage end,
 'stage_group',case when e.id is not null then public.fault_tracker_ifms_group(e.new_stage) else t.stage_group end,
 'remarks',case when e.id is not null then e.remarks else t.remarks end,
 'updated_at',case when e.id is not null then e.created_at else t.updated_at end,
 'manual_update_id',e.id,'last_updated_by',e.updated_by_employee_code,
 'verified_updates',coalesce(h.events,'[]'::jsonb))),'[]'::jsonb)
 from public.fault_tracker_tickets t
 left join lateral (select * from public.fault_tracker_verified_updates(t.id) order by created_at desc,id desc limit 1) e on true
 left join lateral (select jsonb_agg(jsonb_build_object('id',u.id,'ticket_id',u.ticket_id,'update_type',u.update_type,'previous_stage',u.previous_stage,'new_stage',u.new_stage,'remarks',u.remarks,'created_at',u.created_at,'updated_by_employee_code',u.updated_by_employee_code,'metadata',u.metadata) order by u.created_at,u.id) events from public.fault_tracker_verified_updates(t.id) u) h on true
 where t.id=any(p_tickets) and cardinality(p_tickets)<=200
$$;

-- One transaction publishes the batch and all source rows. Imports never read
-- or write manual history, so overlapping saves cannot be lost by import order.
create function public.rpc_fault_tracker_import(p_actor uuid,p_rows jsonb,p_file_name text,p_sheet_name text,p_metadata jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.profiles%rowtype;b public.fault_tracker_import_batches%rowtype;n integer;
begin
 select * into p from public.profiles where id=p_actor;
 if not found or p.is_active is not true or upper(coalesce(p.status,'Active'))<>'ACTIVE' or regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') not in ('ADMIN','QPMSADMIN','DEVELOPER','DEV','ITADMIN','MANAGEMENTITADMIN') then raise exception using errcode='42501',message='Existing ticket manager required';end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 20000 then raise exception using errcode='22023',message='Invalid import rows';end if;
 perform pg_advisory_xact_lock(hashtextextended('fault-tracker-import:Reliance Retail IFMS',0));
 insert into public.fault_tracker_import_batches(uploaded_by_auth_user_id,uploaded_by_employee_code,uploaded_by_name,uploaded_by_role,source_name,original_file_name,sheet_name,ticket_count,metadata,imported_at)
 values(p.auth_user_id,p.employee_code,coalesce(p.full_name,p.display_name,p.email),p.role,'Reliance Retail IFMS',p_file_name,p_sheet_name,jsonb_array_length(p_rows),coalesce(p_metadata,'{}'),clock_timestamp()) returning * into b;
 insert into public.fault_tracker_tickets(import_batch_id,ticket_no,created_at_source,updated_at_source,store_code,store_name,city,state_code,state_label,category,category_group,stage,stage_group,ageing_days,ageing_bucket,supervisor_name,supervisor_employee_code,supervisor_mobile,supervisor_email,vendor_name,vendor_code,remarks,raw_row,metadata,is_active)
 select b.id,r.ticket_no,r.created_at_source,r.updated_at_source,r.store_code,r.store_name,r.city,r.state_code,r.state_label,r.category,r.category_group,r.stage,r.stage_group,r.ageing_days,r.ageing_bucket,r.supervisor_name,r.supervisor_employee_code,r.supervisor_mobile,r.supervisor_email,r.vendor_name,r.vendor_code,r.remarks,coalesce(r.raw_row,'{}'),coalesce(r.metadata,'{}'),coalesce(r.is_active,true)
 from jsonb_populate_recordset(null::public.fault_tracker_tickets,p_rows) r;
 get diagnostics n=row_count;
 if n<>b.ticket_count then raise exception 'Incomplete import';end if;
 return to_jsonb(b);
end $$;

-- Existing update RPC replacements follow, with their original authorization
-- and ACLs retained. Both share the identity lock and compare the effective
-- history version, preventing stale saves through different snapshot row IDs.

create or replace function public.rpc_retail_fault_update(p_actor uuid,p_ticket uuid,p_stage text,p_remarks text,p_expected timestamptz,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.profiles%rowtype;t public.fault_tracker_tickets%rowtype;e public.fault_tracker_ticket_updates%rowtype; valid text[]:=array['Fault Raised - Quote Yet to Submit','Quote Submitted - PO Yet to Receive','PO Received - Fund Request Pending','Fund Released - Work Yet to Start','Fund Released - Work in Progress','Work Completed - Documents Pending','Documents Received - JMS Yet to Create','JMS Created - Invoice Yet to Raise','Invoice Raised - Payment Pending','Set Off Pending','CAMC','OEM','MEPC','IOT'];completion boolean; identity jsonb; store_id uuid; effective_stage text; effective_remarks text; effective_version timestamptz; event_time timestamptz;
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
 completion:=(array_position(valid,effective_stage) between 1 and 5 or array_position(valid,effective_stage) between 11 and 14) and array_position(valid,p_stage) between 6 and 10;
 event_time:=greatest(clock_timestamp(),effective_version+interval '1 microsecond');
 insert into public.fault_tracker_ticket_updates(ticket_id,updated_by_auth_user_id,updated_by_employee_code,update_type,previous_stage,new_stage,remarks,metadata,created_at)
 values(t.id,p.auth_user_id,p.employee_code,case when completion then 'WORK_COMPLETED' else 'STAGE_OR_REMARKS' end,effective_stage,p_stage,p_remarks,jsonb_build_object('retail_request_id',p_request,'retail_workflow_version',1,'actor_profile_id',p.id,'previous_remarks',effective_remarks,'ifms_identity',identity),event_time);
 return jsonb_build_object('id',t.id,'saved',true);
end;$$;

create or replace function public.retail_mis_fault_update(p_actor uuid,p_ticket uuid,p_stage text,p_remarks text,p_expected timestamptz,p_request uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.profiles%rowtype;t public.fault_tracker_tickets%rowtype;e public.fault_tracker_ticket_updates%rowtype; valid text[]:=array['Fault Raised - Quote Yet to Submit','Quote Submitted - PO Yet to Receive','PO Received - Fund Request Pending','Fund Released - Work Yet to Start','Fund Released - Work in Progress','Work Completed - Documents Pending','Documents Received - JMS Yet to Create','JMS Created - Invoice Yet to Raise','Invoice Raised - Payment Pending','Set Off Pending','CAMC','OEM','MEPC','IOT'];completion boolean; identity jsonb; store_id uuid; effective_stage text; effective_remarks text; effective_version timestamptz; event_time timestamptz;
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
 completion:=(array_position(valid,effective_stage) between 1 and 5 or array_position(valid,effective_stage) between 11 and 14) and array_position(valid,p_stage) between 6 and 10;
 event_time:=greatest(clock_timestamp(),effective_version+interval '1 microsecond');
 insert into public.fault_tracker_ticket_updates(ticket_id,updated_by_auth_user_id,updated_by_employee_code,update_type,previous_stage,new_stage,remarks,metadata,created_at)
 values(t.id,p.auth_user_id,p.employee_code,case when completion then 'WORK_COMPLETED' else 'STAGE_OR_REMARKS' end,effective_stage,p_stage,p_remarks,jsonb_build_object('retail_request_id',p_request,'retail_workflow_version',1,'actor_profile_id',p.id,'previous_remarks',effective_remarks,'ifms_identity',identity),event_time);
 return jsonb_build_object('id',t.id,'saved',true);
end;$$;

revoke all on function public.fault_tracker_ifms_stages(),public.fault_tracker_ifms_group(text),public.fault_tracker_verified_updates(uuid),public.rpc_fault_tracker_retained_updates(uuid[]),public.rpc_fault_tracker_import(uuid,jsonb,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.rpc_fault_tracker_retained_updates(uuid[]),public.rpc_fault_tracker_import(uuid,jsonb,text,text,jsonb) to service_role;
-- CREATE OR REPLACE retains the existing update RPC ACLs, including the private
-- MIS helper. This migration changes no role, assignment, RLS policy or grant.
commit;
