-- Document-pending advancement with no false uploaded-document claim.
-- Other 12-stage evidence, ordering, authority, idempotency, private bucket unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
CREATE OR REPLACE FUNCTION public.retail_oos12_spec(p_stage integer)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select jsonb_build_object('authority','mis','confirmation_department',(array['OOS-MIS','Commercial','Commercial','OOS-MIS','Finance','Branch Head','Branch Head','Operations','OOS-MIS','Commercial','Commercial','Commercial'])[p_stage],
 'fields',case p_stage
 when 2 then '["po_number","po_date","po_received_date"]'::jsonb when 3 then '["confirmation_ref"]'::jsonb
 when 4 then '["fund_request_ref","fund_request_date","fund_request_amount"]'::jsonb when 5 then '["payment_ref","payment_date","payment_amount"]'::jsonb
 when 6 then '["receipt_ref","receipt_date"]'::jsonb when 7 then '["handover_ref","handover_date"]'::jsonb
 when 8 then '["work_completion_ref","completion_date"]'::jsonb when 9 then '[]'::jsonb
 when 10 then '["acknowledgement_ref","received_date"]'::jsonb when 11 then '["jms_number","jms_date"]'::jsonb
 when 12 then '["invoice_number","invoice_date","invoice_amount"]'::jsonb else '[]'::jsonb end || case when p_stage between 2 and 12 then '["confirming_person_name","confirming_department","confirmation_date","confirmation_reference"]'::jsonb else '[]'::jsonb end,'optional_fields',case when p_stage=9 then '["documents_ref","submission_date"]'::jsonb else '[]'::jsonb end,'minimum_evidence',case when p_stage=9 then 0 when p_stage between 2 and 12 then 1 else 0 end);
$function$
;
CREATE OR REPLACE FUNCTION public.rpc_retail_oos12_transition(p_actor uuid, p_order uuid, p_action text, p_revision integer, p_request uuid, p_fields jsonb, p_evidence uuid[], p_remarks text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare o public.retail_oos12_orders%rowtype;e public.retail_oos12_events%rowtype;b jsonb;spec jsonb;code text;k text;v text;payload jsonb;changed_at timestamptz;today date:=(clock_timestamp() at time zone 'Asia/Kolkata')::date;begin
 if not public.retail_oos12_enabled() then raise exception using errcode='42501',message='Twelve-stage writes disabled';end if;
 if p_request is null or not public.retail_oos12_order_allowed(p_actor,p_order) then raise exception using errcode='42501',message='Verified order scope and request required';end if;
 if p_fields is null or jsonb_typeof(p_fields)<>'object' or length(btrim(coalesce(p_remarks,''))) not between 3 and 2000 or p_revision is null then raise exception 'Fields, revision and remarks required';end if;
 select * into strict o from public.retail_oos12_orders where id=p_order for update;
 perform pg_advisory_xact_lock(hashtextextended('oos12-request:'||p_request::text,0));
 payload:=jsonb_build_object('confirmation_authenticity','MIS_SUBMITTED_UNVERIFIED','system_actor_capacity','OOS-MIS','system_actor_role',(select case role when 'MIS_OOS' then 'OOS-MIS' else role end from public.profiles where id=p_actor),'system_actor_employee_code',(select employee_code from public.profiles where id=p_actor),'fields',p_fields,'evidence_ids',to_jsonb(p_evidence),'remarks',p_remarks,'expected_revision',p_revision);
 select * into e from public.retail_oos12_events where request_id=p_request;
 if found then
 if e.actor_id<>p_actor or e.order_id<>p_order or e.action<>p_action or e.evidence<>payload then raise exception 'Request ID reused with different command';end if;
 -- Revalidate original stage authority even after forward progress; revoked accounts cannot replay.
 if not public.retail_oos12_authority(p_actor,o.state,public.retail_oos12_spec((e.after_value->>'stage')::integer)->>'authority') then raise exception using errcode='42501',message='Replay authority revoked';end if;
 return jsonb_build_object('replayed',true,'order',public.retail_service_public_order(e.after_value));end if;
 if o.revision is distinct from p_revision then raise exception using errcode='40001',message='Revision changed; refresh';end if;
 code:=(select stages->o.stage->>'code' from public.retail_oos_workflow_catalog where version=2);
 if o.stage>=12 or p_action is distinct from code then raise exception 'Only next forward workflow stage allowed; no backward/skipped transition';end if;
 if not public.retail_oos12_can_advance(p_actor,p_order) then raise exception using errcode='42501',message='OOS-MIS next-stage authority required';end if;
 spec:=public.retail_oos12_spec(o.stage+1);
 if exists(select 1 from jsonb_object_keys(p_fields) key where not(spec->'fields' ? key or spec->'optional_fields' ? key)) then raise exception 'Unrelated update field';end if;
 for k in select jsonb_array_elements_text(spec->'fields') loop
 v:=p_fields->>k;if jsonb_typeof(p_fields->k)<>'string' or length(btrim(coalesce(v,''))) not between 1 and 2000 then raise exception 'Required field missing/invalid: %',k;end if;
 if k like '%date' then
 if v!~'^\d{4}-\d{2}-\d{2}$' or v::date>today or to_char(v::date,'YYYY-MM-DD')<>v then raise exception 'Valid non-future business date required: %',k;end if;
 elsif k like '%amount' and (v!~'^[0-9]{1,18}([.][0-9]{1,2})?$' or v::numeric<=0) then raise exception 'Positive exact decimal amount with at most 2 decimals required: %',k;end if;
 end loop;
 if o.stage+1=9 then
   if (p_fields ? 'documents_ref') <> (p_fields ? 'submission_date') then raise exception 'Document reference and submission date must be supplied together';end if;
   if p_fields ? 'documents_ref' then
     if jsonb_typeof(p_fields->'documents_ref')<>'string' or length(btrim(p_fields->>'documents_ref')) not between 1 and 2000 then raise exception 'Valid document reference required';end if;
     v:=p_fields->>'submission_date';
     if jsonb_typeof(p_fields->'submission_date')<>'string' or v!~'^[0-9]{4}-[0-9]{2}-[0-9]{2} or v::date>today or to_char(v::date,'YYYY-MM-DD')<>v then raise exception 'Valid document submission date required';end if;
     if cardinality(coalesce(p_evidence,'{}'::uuid[]))=0 then raise exception 'Supporting evidence required when documents are marked submitted';end if;
   end if;
 end if;
 if regexp_replace(upper(p_fields->>'confirming_department'),'[^A-Z0-9]','','g')<>regexp_replace(upper(spec->>'confirmation_department'),'[^A-Z0-9]','','g') then raise exception 'Confirmation department must be %',spec->>'confirmation_department';end if;
 if cardinality(coalesce(p_evidence,'{}'::uuid[]))<(spec->>'minimum_evidence')::int or cardinality(coalesce(p_evidence,'{}'::uuid[]))>20 or array_position(p_evidence,null) is not null or cardinality(coalesce(p_evidence,'{}'::uuid[]))<>(select count(distinct x) from unnest(coalesce(p_evidence,'{}'::uuid[])) x) then raise exception 'Stage evidence requirements were not satisfied';end if;
 if exists(select 1 from unnest(p_evidence) eid left join public.retail_oos12_evidence d on d.id=eid where d.id is null or d.actor_id<>p_actor or d.order_id<>o.id or d.stage<>o.stage+1 or d.revision<>o.revision or d.status<>'finalized'
 or not exists(select 1 from storage.objects s where s.bucket_id='retail-oos12-evidence' and s.name=d.path and s.metadata->>'mimetype'=d.mime_type and (s.metadata->>'size')::bigint=d.file_size)) then raise exception 'Verified finalized current-stage evidence required';end if;
 b:=to_jsonb(o);changed_at:=clock_timestamp();
 update public.retail_oos12_orders set stage=stage+1,status=code,revision=revision+1,details=details||p_fields||(case when o.stage+1=9 then jsonb_build_object('documents_pending',not(p_fields ? 'documents_ref')) else '{}'::jsonb end),updated_at=changed_at,status_entered_at=changed_at where id=o.id returning * into o;
 insert into public.retail_oos12_events(order_id,request_id,actor_id,action,before_value,after_value,evidence,created_at) values(o.id,p_request,p_actor,code,b,to_jsonb(o),payload,changed_at);
 return jsonb_build_object('replayed',false,'order',public.retail_service_public_order(to_jsonb(o)));end;$function$
;
commit;
 or v::date>today or to_char(v::date,'YYYY-MM-DD')<>v then raise exception 'Valid document submission date required';end if;
     if cardinality(coalesce(p_evidence,'{}'::uuid[]))=0 then raise exception 'Supporting evidence required when documents are marked submitted';end if;
   end if;
 end if;
 if regexp_replace(upper(p_fields->>'confirming_department'),'[^A-Z0-9]','','g')<>regexp_replace(upper(spec->>'confirmation_department'),'[^A-Z0-9]','','g') then raise exception 'Confirmation department must be %',spec->>'confirmation_department';end if;
 if cardinality(coalesce(p_evidence,'{}'::uuid[]))<(spec->>'minimum_evidence')::int or cardinality(coalesce(p_evidence,'{}'::uuid[]))>20 or array_position(p_evidence,null) is not null or cardinality(coalesce(p_evidence,'{}'::uuid[]))<>(select count(distinct x) from unnest(coalesce(p_evidence,'{}'::uuid[])) x) then raise exception 'Stage evidence requirements were not satisfied';end if;
 if exists(select 1 from unnest(p_evidence) eid left join public.retail_oos12_evidence d on d.id=eid where d.id is null or d.actor_id<>p_actor or d.order_id<>o.id or d.stage<>o.stage+1 or d.revision<>o.revision or d.status<>'finalized'
 or not exists(select 1 from storage.objects s where s.bucket_id='retail-oos12-evidence' and s.name=d.path and s.metadata->>'mimetype'=d.mime_type and (s.metadata->>'size')::bigint=d.file_size)) then raise exception 'Verified finalized current-stage evidence required';end if;
 b:=to_jsonb(o);changed_at:=clock_timestamp();
 update public.retail_oos12_orders set stage=stage+1,status=code,revision=revision+1,details=details||p_fields||(case when o.stage+1=9 then jsonb_build_object('documents_pending',not(p_fields ? 'documents_ref')) else '{}'::jsonb end),updated_at=changed_at,status_entered_at=changed_at where id=o.id returning * into o;
 insert into public.retail_oos12_events(order_id,request_id,actor_id,action,before_value,after_value,evidence,created_at) values(o.id,p_request,p_actor,code,b,to_jsonb(o),payload,changed_at);
 return jsonb_build_object('replayed',false,'order',public.retail_service_public_order(to_jsonb(o)));end;$function$
;
commit;
