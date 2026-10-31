-- Reviewed installed 20261028120000 baseline; test reference only, not a production installer.
create or replace function public.rpc_confirm_retail_bulk_identity(p_actor uuid,p_batch uuid,p_preview_key uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.retail_store_import_batches%rowtype; d jsonb; r jsonb; payload jsonb; previous jsonb; current_stamp text; states text[]; n integer:=0;
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
   -- Conservative supported-identity scope from classified-729-rows.json; NOT approval.
   -- Other 720 rows require reviewed evidence resolution and a separate scope change.
   if r->>'state' is distinct from 'KL' or not exists(select 1 from (values
    ('T196',313),('T24R',315),('T8TM',321),('TAU9',326),('T2JF',392),('T3CO',394),('S0GV',405),('TL5D',417),('T0CM',418)
   ) supported(code,source_row) where supported.code=d->>'store_code' and supported.source_row=(d->>'source_row')::int) then raise exception 'Insufficient or unresolved identity evidence: outside reviewed supported scope';end if;
   if nullif(btrim(d->>'store_name'),'') is null or coalesce(d->>'store_code','') ~ '[[:space:]/,;|]' or jsonb_typeof(r->'issues') is distinct from 'array' then raise exception 'Identity fields/evidence missing';end if;
   if r->>'approval' is distinct from 'YES' or r->>'approval_ref' is distinct from d->>'approval_ref' or r->>'store_name' is distinct from d->>'store_name' then raise exception 'Final source YES/reference/name mismatch';end if;
   if r->>'canonical_id' is not null or exists(select 1 from public.reliance_retail_store_master where upper(btrim(store_code))=d->>'store_code') then raise exception 'Existing identity is protected';end if;
   if exists(select 1 from jsonb_array_elements_text(r->'issues') x where x not in ('INVALID_BUDGET_PERIOD','EXPIRED_BUDGET_PERIOD','INVALID_AOP_COMPONENT')) then raise exception 'Unresolved identity evidence';end if;
   if coalesce(d->>'store_status','') not in ('Active','Inactive') or d->>'operational_model' is distinct from 'SUPERVISOR_ONLY' or nullif(btrim(d->>'supervisor_name'),'') is null then raise exception 'Explicit status and genuine supervisor required';end if;
   if exists(select 1 from public.retail_store_import_approvals where kind='identity' and file_sha256=b.checksum and source_row=(d->>'source_row')::int and row_digest=d->>'row_digest') then raise exception 'Registry evidence exists; do not overwrite';end if;
   insert into public.retail_store_import_approvals(kind,status,file_sha256,row_digest,source_row,store_code,approval_ref,reviewer_id,evidence_sha256,approved_at,decision)
   values('identity','APPROVED',b.checksum,d->>'row_digest',(d->>'source_row')::int,d->>'store_code',d->>'approval_ref',p_actor,d->>'evidence_sha256',now(),jsonb_build_object('state',r->>'state','store_name',d->>'store_name','store_status',d->>'store_status','operational_model','SUPERVISOR_ONLY','supervisor_name',d->>'supervisor_name','bulk_decision_file_sha256',payload->>'decision_file_sha256'));
   n:=n+1;
  end if;
 end loop;
 if (select count(distinct x) from unnest(states) x)<>1 then raise exception 'One state per approval batch';end if;
 previous:=jsonb_build_object('batch_id',b.id,'actor_id',p_actor,'approved_count',n,'payload',payload,'identity_only',true,'confirmed_at',now());
 insert into public.retail_store_import_events(batch_id,actor_id,action,details) values(b.id,p_actor,'BULK_IDENTITY_REVIEW',previous);
 return previous;
end;$$;
