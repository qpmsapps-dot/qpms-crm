alter table public.reliance_retail_store_master drop constraint reliance_retail_store_fo_assignment_consistency_check;
alter table public.reliance_retail_store_master add constraint reliance_retail_store_fo_assignment_consistency_check check (
 (assigned_fo_profile_id is not null and nullif(btrim(assigned_fo_employee_code),'') is not null and nullif(btrim(assigned_fo_name_snapshot),'') is not null)
 or (assigned_fo_profile_id is null and assigned_fo_employee_code is null and assigned_fo_name_snapshot is null and assigned_fo_phone_snapshot is null and zone_id is null and upper(coalesce(metadata->>'operational_model',''))='SUPERVISOR_ONLY')
 or (assigned_fo_profile_id is null and assigned_fo_employee_code is null and assigned_fo_name_snapshot is null and assigned_fo_phone_snapshot is null and upper(coalesce(metadata->>'operational_model',''))='IDENTITY_ONLY'
 and coalesce(metadata->>'approval_id','') ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' and coalesce(metadata->>'source_sha256','') ~ '^[a-f0-9]{64}$')
);

create or replace function public.retail_identity_only_approved(p_actor uuid,p_proof jsonb,p_code text,p_state text,p_name text,p_status text,p_ref text,p_evidence text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare p public.retail_provisional_proposals%rowtype;r public.retail_provisional_rows%rowtype;f public.retail_provisional_files%rowtype;e jsonb;m jsonb;
begin
 if p_proof is null or jsonb_typeof(p_proof) is distinct from 'object' then return false;end if;
 select * into p from public.retail_provisional_proposals where id=(p_proof->>'proposal_id')::uuid;
 if not found or p.kind<>'identity' or p.status<>'APPROVED' or p.target_store is not null or p.proposed_by=p.decided_by or p.decided_by is distinct from p_actor then return false;end if;
 select * into r from public.retail_provisional_rows where id=p.row_id;
 if not found then return false;end if;
 select * into f from public.retail_provisional_files where id=r.batch_id;
 if not found or f.withdrawn_at is not null then return false;end if;
 if jsonb_typeof(r.source->'issues') is distinct from 'array' then return false;end if;
 if exists(select 1 from jsonb_array_elements_text(r.source->'issues') issue where issue in ('DUPLICATE_SOURCE_CODE','AMBIGUOUS_STORE_CODE','CANONICAL_GEOGRAPHY_CONFLICT','UNKNOWN_GEOGRAPHY','MISSING_STORE_CODE','TECHNICAL_FORMULA_OR_CELL_ERROR')) then return false;end if;
 if (select count(*) from public.retail_provisional_rows other_row where other_row.batch_id=r.batch_id and upper(btrim(other_row.store_code))=upper(btrim(r.store_code)))<>1 then return false;end if;
 e:=p.decision_reason::jsonb;m:=p.changes->'activation_review';
 return coalesce(p.decided_at is not null and p.decided_at<=now() and p.proposed_by is not null and p.decided_by is not null
  and p.state=p_state and r.source_state=p_state and r.store_code=p_code
  and p.changes->>'state'=p_state and p.changes->>'store_name'=p_name and p.changes->>'operating_status'=p_status
  and p_status in ('Active','Inactive') and nullif(btrim(p_name),'') is not null
  and r.review->>'store_name'=p_name and r.review->>'operating_status'=p_status
  and r.verification_status='VERIFIED' and r.revision=p.revision+1
  and (p_proof->>'saved_row')::uuid=r.id and p_proof->>'source_sha256'=f.sha256 and p_proof->>'row_digest'=r.row_digest
  and (p_proof->>'source_version')::integer=f.version and (p_proof->>'source_row')::integer=r.source_row and (p_proof->>'source_revision')::integer=r.revision
  and m->>'schema'='saved_identity_review_v1' and m->>'operational_model'='IDENTITY_ONLY'
  and m->>'source_sha256'=f.sha256 and m->>'row_digest'=r.row_digest and (m->>'source_revision')::integer=p.revision
  and e->>'scope'='SAVED_SOURCE_IDENTITY' and e->>'reference'=p_ref and e->>'evidence_sha256'=p_evidence and p_evidence ~ '^[a-f0-9]{64}$',false);
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end;$$;
revoke all on function public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text) from public,anon,authenticated,service_role;

create or replace function public.rpc_confirm_retail_bulk_identity(p_actor uuid,p_batch uuid,p_preview_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.retail_store_import_batches%rowtype; d jsonb; r jsonb; payload jsonb; previous jsonb; current_stamp text; states text[]; n integer:=0; proof jsonb;
begin
 if p_actor is null or p_batch is null or p_preview_key is null then raise exception 'Actor, batch and preview key required';end if;
 perform 1 from public.profiles where id=p_actor for share;
 perform public.retail_store_import_admin(p_actor);
 perform pg_advisory_xact_lock(hashtextextended('retail_store_import',0));
 perform pg_advisory_xact_lock(hashtextextended('retail_uploaded_attendance',0));
 lock table public.reliance_retail_store_master in share row exclusive mode;
 lock table public.retail_store_import_approvals in share row exclusive mode;
 select * into b from public.retail_store_import_batches where id=p_batch for update;
 if not found or b.uploaded_by<>p_actor then raise exception using errcode='42501',message='Approval owner mismatch';end if;
 if b.preview_key is distinct from p_preview_key or b.status<>'preview' then raise exception using errcode='40001',message='Fresh uncommitted preview required';end if;
 if encode(sha256(decode(b.original_base64,'base64')),'hex') is distinct from b.checksum then raise exception 'Retained source checksum mismatch';end if;
 if b.checksum !~ '^[a-f0-9]{64}$' or jsonb_typeof(b.review->'rows') is distinct from 'array' then raise exception 'Source review malformed';end if;
 payload:=b.review->'bulk_identity';
 if payload is null or jsonb_typeof(payload->'decisions') is distinct from 'array' then raise exception 'Explicit row decisions required';end if;
 if jsonb_array_length(payload->'decisions') not between 1 and 729 or coalesce(payload->>'decision_file_sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid decision count/hash';end if;
 select details into previous from public.retail_store_import_events where batch_id=b.id and action='BULK_IDENTITY_REVIEW' order by id desc limit 1;
 if previous is not null then
  if previous->'payload'=payload then return previous;end if;
  raise exception 'A different decision receipt already exists; obtain a new reviewed source file';
 end if;
 current_stamp:=public.rpc_retail_store_import_source(p_actor)->>'stamp';
 if current_stamp is distinct from b.baseline_stamp then raise exception using errcode='40001',message='Canonical data or approval registry changed; preview again';end if;
 if exists(select 1 from jsonb_array_elements(payload->'decisions') x group by x->>'store_code' having count(*)>1) then raise exception 'Duplicate decision codes';end if;
 for d in select value from jsonb_array_elements(payload->'decisions') loop
  if jsonb_typeof(d) is distinct from 'object' or coalesce(d->>'row_digest','') !~ '^[a-f0-9]{64}$' or coalesce(d->>'store_code','')='' then raise exception 'Malformed decision';end if;
  if (select count(*) from jsonb_array_elements(b.review->'rows') where (value->>'source_row')::int=(d->>'source_row')::int and value->>'store_code'=d->>'store_code')<>1 then raise exception 'Missing or ambiguous source binding';end if;
  select value into r from jsonb_array_elements(b.review->'rows') where (value->>'source_row')::int=(d->>'source_row')::int and value->>'store_code'=d->>'store_code';
  if r is null or d->>'file_sha256' is distinct from b.checksum or d->>'row_digest' is distinct from r->>'row_digest' then raise exception 'Source binding mismatch';end if;
  if d->>'reviewer_id' is distinct from p_actor::text or nullif(btrim(d->>'approval_ref'),'') is null or coalesce(d->>'evidence_sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'Authenticated reviewer and actual evidence required';end if;
  if coalesce(d->>'decision','') not in ('Approve Identity','Reject','Hold') then raise exception 'Explicit decision required';end if;
  if coalesce(r->>'state','') not in ('TN','PY','KA','KL','TG','AP-1','AP-2') then raise exception 'Invalid geographic state';end if;
  states:=array_append(states,r->>'state');
  if d->>'decision'='Approve Identity' then
   proof:=null;
   if d->>'operational_model'='IDENTITY_ONLY' then
    proof:=(r->'raw'->>'Reviewer Notes')::jsonb;
    if public.retail_identity_only_approved(p_actor,proof,d->>'store_code',r->>'state',d->>'store_name',d->>'store_status',d->>'approval_ref',d->>'evidence_sha256') is not true then raise exception 'Fresh independently approved saved-source identity proof required';end if;
   else
   -- Conservative supported-identity scope from classified-729-rows.json; NOT approval.
   -- Other 720 rows require reviewed evidence resolution and a separate scope change.
   if r->>'state' is distinct from 'KL' or not exists(select 1 from (values
    ('T196',313),('T24R',315),('T8TM',321),('TAU9',326),('T2JF',392),('T3CO',394),('S0GV',405),('TL5D',417),('T0CM',418)
   ) supported(code,source_row) where supported.code=d->>'store_code' and supported.source_row=(d->>'source_row')::int) then raise exception 'Insufficient or unresolved identity evidence: outside reviewed supported scope';end if;
   end if;
   if nullif(btrim(d->>'store_name'),'') is null or coalesce(d->>'store_code','') ~ '[[:space:]/,;|]' or jsonb_typeof(r->'issues') is distinct from 'array' then raise exception 'Identity fields/evidence missing';end if;
   if r->>'approval' is distinct from 'YES' or r->>'approval_ref' is distinct from d->>'approval_ref' or r->>'store_name' is distinct from d->>'store_name' then raise exception 'Final source YES/reference/name mismatch';end if;
   if r->>'canonical_id' is not null or exists(select 1 from public.reliance_retail_store_master where upper(btrim(store_code))=d->>'store_code') then raise exception 'Existing identity is protected';end if;
   if exists(select 1 from jsonb_array_elements_text(r->'issues') x where x not in ('INVALID_BUDGET_PERIOD','EXPIRED_BUDGET_PERIOD','INVALID_AOP_COMPONENT')) then raise exception 'Unresolved identity evidence';end if;
   if coalesce(d->>'store_status','') not in ('Active','Inactive') or coalesce(d->>'operational_model','') not in ('IDENTITY_ONLY','SUPERVISOR_ONLY') or (d->>'operational_model'='SUPERVISOR_ONLY' and nullif(btrim(d->>'supervisor_name'),'') is null) then raise exception 'Explicit status and supported identity model required';end if;
   if exists(select 1 from public.retail_store_import_approvals where kind='identity' and file_sha256=b.checksum and source_row=(d->>'source_row')::int and row_digest=d->>'row_digest') then raise exception 'Registry evidence exists; do not overwrite';end if;
   insert into public.retail_store_import_approvals(kind,status,file_sha256,row_digest,source_row,store_code,approval_ref,reviewer_id,evidence_sha256,approved_at,decision)
   values('identity','APPROVED',b.checksum,d->>'row_digest',(d->>'source_row')::int,d->>'store_code',d->>'approval_ref',p_actor,d->>'evidence_sha256',now(),jsonb_build_object('state',r->>'state','store_name',d->>'store_name','store_status',d->>'store_status','operational_model',d->>'operational_model','supervisor_name',d->>'supervisor_name','bulk_decision_file_sha256',payload->>'decision_file_sha256','saved_identity_proof',proof));
   n:=n+1;
  end if;
 end loop;
 if (select count(distinct x) from unnest(states) x)<>1 then raise exception 'One state per approval batch';end if;
 previous:=jsonb_build_object('batch_id',b.id,'actor_id',p_actor,'approved_count',n,'payload',payload,'identity_only',true,'confirmed_at',now());
 insert into public.retail_store_import_events(batch_id,actor_id,action,details) values(b.id,p_actor,'BULK_IDENTITY_REVIEW',previous);
 return previous;
end;$$;
create or replace function public.rpc_confirm_retail_store_import(p_actor uuid,p_batch uuid,p_preview_key uuid,p_identity boolean,p_aop boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.retail_store_import_batches%rowtype; r jsonb; d public.retail_store_import_approvals%rowtype;
 s public.reliance_retail_store_master%rowtype; source jsonb; stores jsonb:='[]'; allocations jsonb:='[]'; aop_after jsonb:='[]'; aid uuid; av uuid; v_receipt jsonb;
begin
 perform public.retail_store_import_admin(p_actor);
 perform pg_advisory_xact_lock(hashtextextended('retail_store_import',0));
 perform pg_advisory_xact_lock(hashtextextended('retail_uploaded_attendance',0));
 -- Lock canonical rows against concurrent manual edits while validating the snapshot.
 lock table public.reliance_retail_store_master in share row exclusive mode;
 lock table public.retail_store_import_approvals in share mode;
 select * into b from public.retail_store_import_batches where id=p_batch for update;
 if not found or b.uploaded_by<>p_actor then raise exception using errcode='42501',message='Import owner mismatch'; end if;
 if b.preview_key is distinct from p_preview_key then raise exception using errcode='40001',message='Preview changed'; end if;
 if b.status='committed' then return b.receipt; end if;
 if b.status<>'preview' or (not coalesce(p_identity,false) and not coalesce(p_aop,false)) then raise exception 'Choose approved identity or AOP scope'; end if;
 source:=public.rpc_retail_store_import_source(p_actor);
 if source->>'stamp' is distinct from b.baseline_stamp then raise exception using errcode='40001',message='Store, AOP or approval evidence changed; preview again'; end if;
 for r in select value from jsonb_array_elements(b.review->'rows') loop
  if (p_identity and r->>'identity_action'='APPROVED_CANDIDATE') or (p_aop and r->>'aop_action'='APPROVED_CANDIDATE') then
   if r->>'approval'<>'YES' or coalesce(r->>'approval_ref','')='' then raise exception 'Pending source row cannot activate'; end if;
   select * into d from public.retail_store_import_approvals where id=coalesce(nullif(r->>'identity_decision_id',''),nullif(r->>'aop_decision_id',''))::uuid;
   if not found or d.status<>'APPROVED' or d.file_sha256<>b.checksum or d.row_digest<>r->>'row_digest' or d.source_row<>(r->>'source_row')::int
    or d.store_code<>r->>'store_code' or d.approval_ref<>r->>'approval_ref' or d.approved_at>now() or (d.valid_until is not null and d.valid_until<(now() at time zone 'Asia/Kolkata')::date) then raise exception 'Approval evidence invalid'; end if;
   if p_identity and r->>'identity_action'='APPROVED_CANDIDATE' then
    if d.kind<>'identity' or d.decision->>'state' is distinct from r->>'state' or d.decision->>'store_name' is distinct from r->>'store_name'
     or coalesce(d.decision->>'store_status','') not in ('Active','Inactive') or coalesce(d.decision->>'operational_model','') not in ('IDENTITY_ONLY','SUPERVISOR_ONLY')
     or (d.decision->>'operational_model'='SUPERVISOR_ONLY' and nullif(btrim(d.decision->>'supervisor_name'),'') is null) then raise exception 'Explicit identity, status and supported identity model approval required'; end if;
    if d.decision->>'operational_model'='IDENTITY_ONLY' and public.retail_identity_only_approved(p_actor,d.decision->'saved_identity_proof',r->>'store_code',r->>'state',r->>'store_name',d.decision->>'store_status',d.approval_ref,d.evidence_sha256) is not true then raise exception 'Saved-source independent approval proof changed';end if;
    if exists(select 1 from public.reliance_retail_store_master where upper(btrim(store_code))=r->>'store_code') then raise exception 'Existing identity must be preserved'; end if;
    insert into public.reliance_retail_store_master(store_code,store_name,state,city,store_format,status,source_name,metadata)
    values(r->>'store_code',r->>'store_name',r->>'state',nullif(r->>'city',''),nullif(r->>'store_format',''),d.decision->>'store_status',b.filename,
     jsonb_build_object('operational_model',d.decision->>'operational_model','supervisor',case when nullif(btrim(d.decision->>'supervisor_name'),'') is not null then jsonb_build_object('name',d.decision->>'supervisor_name') else null end,'import_batch',b.id,'approval_id',d.id,'source_sha256',b.checksum,'source_row',r->'source_row')) returning * into s;
    stores:=stores||jsonb_build_array(jsonb_build_object('id',s.id,'after',to_jsonb(s)));
   end if;
   if p_aop and r->>'aop_action'='APPROVED_CANDIDATE' then
    if d.kind<>'aop' or d.decision->>'retail_store_id' is distinct from r->>'canonical_id' or d.decision->>'state' is distinct from r->>'state' then raise exception 'AOP identity approval mismatch'; end if;
    if not exists(select 1 from public.reliance_retail_store_master where id=(r->>'canonical_id')::uuid and status='Active') then raise exception 'AOP requires an active existing identity'; end if;
    if (d.decision->>'effective_to')::date < (now() at time zone 'Asia/Kolkata')::date then raise exception 'Expired AOP cannot activate'; end if;
    if aid is null then
     insert into public.retail_attendance_uploads(kind,filename,checksum,uploaded_by,total_rows,valid_rows,rejected_rows,validation_summary,payload,raw_source,status,committed_at)
     values('aop',b.filename,b.checksum,p_actor,0,0,0,jsonb_build_object('store_import_batch',b.id),'[]',jsonb_build_object('store_import_batch',b.id),'committed',now()) returning id into aid;
    end if;
    insert into public.retail_attendance_aop_versions(retail_store_id,hk_count,mepc_count,effective_from,effective_to,source_version,batch_id,created_by)
    values((r->>'canonical_id')::uuid,(d.decision->>'hk_count')::numeric,(d.decision->>'mepc_count')::numeric,(d.decision->>'effective_from')::date,(d.decision->>'effective_to')::date,d.approval_ref,aid,p_actor) returning id into av;
    allocations:=allocations||jsonb_build_array(av);
    aop_after:=aop_after||jsonb_build_array((select to_jsonb(x) from public.retail_attendance_aop_versions x where x.id=av));
   end if;
  end if;
 end loop;
 if jsonb_array_length(stores)+jsonb_array_length(allocations)=0 then raise exception 'No approved rows in selected scope'; end if;
 v_receipt:=jsonb_build_object('batch_id',b.id,'stores',stores,'aop_ids',allocations,'aop_after',aop_after,'aop_upload_id',aid,'identity_selected',p_identity,'aop_selected',p_aop);
 update public.retail_store_import_batches set status='committed',committed_at=now(),receipt=v_receipt where id=b.id;
 insert into public.retail_store_import_events(batch_id,actor_id,action,details) values(b.id,p_actor,'CONFIRM',v_receipt);
 return v_receipt;
end; $$;
create or replace function public.rpc_retail_identity_activation_contract() returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$select jsonb_build_object('version','20261031080000','identity_only',true,'explicit_status_required',true,'supervisor_required',false)$$;
revoke all on function public.rpc_retail_identity_activation_contract() from public,anon,authenticated,service_role;
grant execute on function public.rpc_retail_identity_activation_contract() to service_role;
notify pgrst, 'reload schema';
