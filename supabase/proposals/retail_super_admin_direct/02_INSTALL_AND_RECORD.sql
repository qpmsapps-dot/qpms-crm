-- NEW owner-only patch. No authority accounts seeded, no proposals approved, no stores activated.
begin;set local lock_timeout='5s';set local statement_timeout='60s';
do $install$ begin
perform pg_advisory_xact_lock(hashtextextended('retail_super_admin_direct_install',0));
if exists(select 1 from supabase_migrations.schema_migrations where version='20261031090000') then
 if not exists(select 1 from supabase_migrations.schema_migrations where version='20261031090000' and cardinality(statements)=1 and md5(replace(statements[1],E'\r\n',E'\n'))='f2087eb8651b01334bdc6762f8892048') then raise exception 'Direct-approval ledger drift';end if;
 if not exists(select 1 from pg_proc where oid=to_regprocedure('public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text)') and prosecdef and provolatile='s' and md5(replace(prosrc,E'\r\n',E'\n'))='0378a20524bdbf1e50bfbcce9cdb4b66') then raise exception 'Reviewed identity proof helper drift';end if;
if has_function_privilege('anon','public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text)','EXECUTE') or has_function_privilege('authenticated','public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text)','EXECUTE') or has_function_privilege('service_role','public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text)','EXECUTE') then raise exception 'Private proof helper ACL drift';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.retail_identity_final_authorized(uuid,text)') and prosecdef and provolatile='s' and md5(replace(prosrc,E'\r\n',E'\n'))='558355a93f78cf5d74a286a3a1a28bd9' and exists(select 1 from unnest(proconfig) cfg where regexp_replace(cfg,'[[:space:]]','','g')='search_path=pg_catalog,public')) then raise exception 'Direct approval function drift: retail_identity_final_authorized';end if;
if has_function_privilege('anon','public.retail_identity_final_authorized(uuid,text)','EXECUTE') or has_function_privilege('authenticated','public.retail_identity_final_authorized(uuid,text)','EXECUTE') or has_function_privilege('service_role','public.retail_identity_final_authorized(uuid,text)','EXECUTE') is distinct from false then raise exception 'Direct approval function ACL drift: retail_identity_final_authorized';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.rpc_retail_identity_direct_capability(uuid)') and prosecdef and provolatile='s' and md5(replace(prosrc,E'\r\n',E'\n'))='6f676d5f92d57227091e229e3bcfd643' and exists(select 1 from unnest(proconfig) cfg where regexp_replace(cfg,'[[:space:]]','','g')='search_path=pg_catalog,public')) then raise exception 'Direct approval function drift: rpc_retail_identity_direct_capability';end if;
if has_function_privilege('anon','public.rpc_retail_identity_direct_capability(uuid)','EXECUTE') or has_function_privilege('authenticated','public.rpc_retail_identity_direct_capability(uuid)','EXECUTE') or has_function_privilege('service_role','public.rpc_retail_identity_direct_capability(uuid)','EXECUTE') is distinct from true then raise exception 'Direct approval function ACL drift: rpc_retail_identity_direct_capability';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.rpc_retail_identity_direct_approve(uuid,uuid[],text)') and prosecdef and provolatile='v' and md5(replace(prosrc,E'\r\n',E'\n'))='267d419e1ee31eb286590cdcdee6dfd8' and exists(select 1 from unnest(proconfig) cfg where regexp_replace(cfg,'[[:space:]]','','g')='search_path=pg_catalog,public')) then raise exception 'Direct approval function drift: rpc_retail_identity_direct_approve';end if;
if has_function_privilege('anon','public.rpc_retail_identity_direct_approve(uuid,uuid[],text)','EXECUTE') or has_function_privilege('authenticated','public.rpc_retail_identity_direct_approve(uuid,uuid[],text)','EXECUTE') or has_function_privilege('service_role','public.rpc_retail_identity_direct_approve(uuid,uuid[],text)','EXECUTE') is distinct from true then raise exception 'Direct approval function ACL drift: rpc_retail_identity_direct_approve';end if;
if not exists(select 1 from pg_class where oid=to_regclass('public.retail_identity_final_authority') and relrowsecurity) then raise exception 'Authority RLS missing';end if;
 return;end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text)') and prosecdef and provolatile='s' and md5(replace(prosrc,E'\r\n',E'\n'))='f3dc5882e6363359ee1c9b6a24ccc9e9') then raise exception 'Reviewed identity proof helper drift';end if;
if has_function_privilege('anon','public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text)','EXECUTE') or has_function_privilege('authenticated','public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text)','EXECUTE') or has_function_privilege('service_role','public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text)','EXECUTE') then raise exception 'Private proof helper ACL drift';end if;
if to_regclass('public.retail_identity_final_authority') is not null then raise exception 'Unexpected final-authority table';end if;
execute $source$create table public.retail_identity_final_authority (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references public.profiles(id),auth_user_id uuid not null,
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),enabled boolean not null default true,
 granted_at timestamptz not null default now(),authorization_reference text not null check(length(btrim(authorization_reference))>=3),
 granted_by_db_role text not null default current_user,unique(actor_id,source_sha256),unique(auth_user_id,source_sha256)
);
alter table public.retail_identity_final_authority enable row level security;
revoke all on public.retail_identity_final_authority from public,anon,authenticated,service_role;

create function public.retail_identity_final_authorized(p_actor uuid,p_sha text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.retail_provisional_admin(p_actor) and exists(select 1 from public.retail_identity_final_authority a
 join public.retail_provisional_files f on f.sha256=a.source_sha256 join public.profiles p on p.id=a.actor_id and p.auth_user_id=a.auth_user_id
 where a.actor_id=p_actor and a.enabled and a.auth_user_id in ('79cd196c-c6f3-404a-b22a-d4683afefa3f'::uuid,'7e84cddf-821a-4513-b7ce-25895d660393'::uuid,'f9238141-8f44-4073-86aa-2749b8a3dccf'::uuid,'377ca7a2-95cc-4891-8840-338f2cb20bb9'::uuid) and a.source_sha256=p_sha and f.version=2 and f.withdrawn_at is null and f.source_format='UNIFIED MASTER');
$$;
revoke all on function public.retail_identity_final_authorized(uuid,text) from public,anon,authenticated,service_role;

create function public.rpc_retail_identity_direct_capability(p_actor uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('version','20261031090000','available',true,'authorized',exists(select 1 from public.retail_identity_final_authority a where a.actor_id=p_actor and public.retail_identity_final_authorized(p_actor,a.source_sha256)),
 'approval_reason','Super Admin authorized Reliance Retail Store Master activation.','source_version',2);
$$;
revoke all on function public.rpc_retail_identity_direct_capability(uuid) from public,anon,authenticated;
grant execute on function public.rpc_retail_identity_direct_capability(uuid) to service_role;

create function public.rpc_retail_identity_direct_approve(p_actor uuid,p_proposals uuid[],p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare pid uuid;p public.retail_provisional_proposals%rowtype;r public.retail_provisional_rows%rowtype;f public.retail_provisional_files%rowtype;
 grant_id uuid;approver_auth_id uuid;file_id uuid;source_sha text;receipt bigint;e jsonb;valid uuid[]:='{}';replayed uuid[]:='{}';held jsonb:='[]';receipt_ids jsonb:='[]';
begin
 if not public.retail_provisional_admin(p_actor) then raise exception using errcode='42501',message='Authenticated active Admin identity required';end if;
 if p_reason is distinct from 'Super Admin authorized Reliance Retail Store Master activation.' then raise exception 'Explicit Super Admin approval reason required';end if;
 if cardinality(p_proposals) is null or cardinality(p_proposals) not between 1 and 1000 or array_position(p_proposals,null) is not null or (select count(distinct x) from unnest(p_proposals) x)<>cardinality(p_proposals) then raise exception 'Select 1-1000 distinct proposal IDs';end if;
 if not exists(select 1 from public.retail_identity_final_authority a where a.actor_id=p_actor and public.retail_identity_final_authorized(p_actor,a.source_sha256)) then raise exception using errcode='42501',message='Super Admin final-approval authorization is not mapped to this account/source';end if;
 perform pg_advisory_xact_lock(hashtextextended('retail_super_admin_identity_approval',0));
 for pid in select x from unnest(p_proposals) x order by x loop
  begin
   select * into p from public.retail_provisional_proposals where id=pid for update;
   if not found or p.kind<>'identity' or p.target_store is not null then raise exception 'Not a new Store Master identity proposal';end if;
   select * into r from public.retail_provisional_rows where id=p.row_id for update;
   if not found then raise exception 'Saved source row missing';end if;
   select * into f from public.retail_provisional_files where id=r.batch_id for share;
   if not found or not public.retail_identity_final_authorized(p_actor,f.sha256) then raise exception 'Outside authorized confirmed Version 2 source';end if;
   if file_id is not null and file_id<>f.id then raise exception 'Use one confirmed saved source version per direct batch';end if;
   if p.status='APPROVED' then
    e:=p.decision_reason::jsonb;
    if p.decided_by=p_actor and e->>'approval_mode'='SUPER_ADMIN_DIRECT' and public.retail_identity_only_approved(p_actor,jsonb_build_object('proposal_id',p.id,'saved_row',r.id,'source_sha256',f.sha256,'row_digest',r.row_digest,'source_version',f.version,'source_row',r.source_row,'source_revision',r.revision),r.store_code,p.state,p.changes->>'store_name',p.changes->>'operating_status',e->>'reference',e->>'evidence_sha256') then replayed:=array_append(replayed,p.id);receipt_ids:=receipt_ids||jsonb_build_array(e->>'direct_receipt_id');continue;end if;
    raise exception 'Already reviewed; existing approval cannot be overwritten';
   end if;
   if p.status<>'PENDING' or p.decided_by is not null then raise exception 'Pending unreviewed proposal required';end if;
   if p.changes->>'operating_status' is distinct from 'Active' then raise exception 'Only explicitly proposed Active identities enter operational direct approval';end if;
   if p.proposed_by is null or coalesce(length(btrim(p.reason)),0)<3 or r.source_state not in ('TN','PY','KA','KL','TG','AP-1','AP-2') or p.state<>r.source_state or p.changes->>'state' is distinct from r.source_state or p.changes->>'store_name' is distinct from r.review->>'store_name' or nullif(btrim(p.changes->>'store_name'),'') is null or nullif(btrim(r.store_code),'') is null then raise exception 'Maker, official name, reason or State evidence invalid';end if;
   if p.revision<>r.revision or p.changes->'activation_review'->>'schema' is distinct from 'saved_identity_review_v1' or p.changes->'activation_review'->>'operational_model' is distinct from 'IDENTITY_ONLY' or p.changes->'activation_review'->>'source_sha256' is distinct from f.sha256 or p.changes->'activation_review'->>'row_digest' is distinct from r.row_digest or (p.changes->'activation_review'->>'source_revision')::integer is distinct from p.revision then raise exception 'Source revision/hash/digest changed';end if;
   if r.store_code ~ '[[:space:]/,;|]' or jsonb_typeof(r.source->'issues') is distinct from 'array' or exists(select 1 from jsonb_array_elements_text(r.source->'issues') issue where issue in ('DUPLICATE_SOURCE_CODE','AMBIGUOUS_STORE_CODE','CANONICAL_GEOGRAPHY_CONFLICT','UNKNOWN_GEOGRAPHY','MISSING_STORE_CODE','TECHNICAL_FORMULA_OR_CELL_ERROR')) then raise exception 'Unresolved Store Code/State identity conflict';end if;
   if (select count(*) from public.retail_provisional_rows x where x.batch_id=r.batch_id and upper(btrim(x.store_code))=upper(btrim(r.store_code)))<>1 or exists(select 1 from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(r.store_code))) then raise exception 'Duplicate/existing canonical Store Code is protected';end if;
   file_id:=f.id;source_sha:=f.sha256;valid:=array_append(valid,p.id);
  exception when others then held:=held||jsonb_build_array(jsonb_build_object('proposal_id',pid,'reason',sqlerrm));end;
 end loop;
 if cardinality(valid)>0 then
  select a.id,a.auth_user_id into strict grant_id,approver_auth_id from public.retail_identity_final_authority a where a.actor_id=p_actor and a.source_sha256=source_sha and a.enabled for share;
  insert into public.retail_provisional_events(batch_id,actor_id,action,details) values(file_id,p_actor,'SUPER_ADMIN_DIRECT_IDENTITY_APPROVAL',jsonb_build_object('approval_mode','SUPER_ADMIN_DIRECT','reason',p_reason,'authority_grant_id',grant_id,'approver_auth_user_id',approver_auth_id,'approved_proposal_ids',to_jsonb(valid),'source_sha256',source_sha,'source_version',2,'approved_at',now(),'held',held)) returning id into receipt;
  foreach pid in array valid loop
   select * into p from public.retail_provisional_proposals where id=pid;
   e:=jsonb_build_object('scope','SAVED_SOURCE_IDENTITY','approval_mode','SUPER_ADMIN_DIRECT','reason',p_reason,'reference','SUPER_ADMIN_DIRECT:'||receipt::text,'direct_receipt_id',receipt::text,'authority_grant_id',grant_id,'approver_auth_user_id',approver_auth_id,'evidence_kind','CONFIRMED_SOURCE_FILE','evidence_sha256',source_sha);
   update public.retail_provisional_proposals set status='APPROVED',decided_by=p_actor,decided_at=now(),decision_reason=e::text where id=p.id;
   update public.retail_provisional_rows set review=review||p.changes,revision=revision+1,verification_status='VERIFIED' where id=p.row_id;
   insert into public.reliance_retail_management_audit(action,entity_type,entity_id,actor_profile_id,after_state) values('SUPER_ADMIN_DIRECT_IDENTITY_APPROVAL','proposal',p.id,p_actor,jsonb_build_object('state',p.state,'approval',e,'approval_reason',p_reason));
  end loop;
  receipt_ids:=receipt_ids||jsonb_build_array(receipt::text);
 end if;
 select coalesce(jsonb_agg(distinct x),'[]'::jsonb) into receipt_ids from jsonb_array_elements(receipt_ids) x;
 return jsonb_build_object('approval_mode','SUPER_ADMIN_DIRECT','actor_id',p_actor,'approved_count',cardinality(valid),'approved_proposal_ids',to_jsonb(valid),'replayed_count',cardinality(replayed),'held_count',jsonb_array_length(held),'held',held,'receipt_ids',receipt_ids,'activated_count',0,'approval_reason',p_reason);
end;$$;
revoke all on function public.rpc_retail_identity_direct_approve(uuid,uuid[],text) from public,anon,authenticated;
grant execute on function public.rpc_retail_identity_direct_approve(uuid,uuid[],text) to service_role;

create or replace function public.retail_identity_only_approved(p_actor uuid,p_proof jsonb,p_code text,p_state text,p_name text,p_status text,p_ref text,p_evidence text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare p public.retail_provisional_proposals%rowtype;r public.retail_provisional_rows%rowtype;f public.retail_provisional_files%rowtype;e jsonb;m jsonb;
begin
 if p_proof is null or jsonb_typeof(p_proof) is distinct from 'object' then return false;end if;
 select * into p from public.retail_provisional_proposals where id=(p_proof->>'proposal_id')::uuid;
 if not found or p.kind<>'identity' or p.status<>'APPROVED' or p.target_store is not null or p.decided_by is distinct from p_actor then return false;end if;
 select * into r from public.retail_provisional_rows where id=p.row_id;
 if not found then return false;end if;
 select * into f from public.retail_provisional_files where id=r.batch_id;
 if not found or f.withdrawn_at is not null then return false;end if;
 if jsonb_typeof(r.source->'issues') is distinct from 'array' then return false;end if;
 if exists(select 1 from jsonb_array_elements_text(r.source->'issues') issue where issue in ('DUPLICATE_SOURCE_CODE','AMBIGUOUS_STORE_CODE','CANONICAL_GEOGRAPHY_CONFLICT','UNKNOWN_GEOGRAPHY','MISSING_STORE_CODE','TECHNICAL_FORMULA_OR_CELL_ERROR')) then return false;end if;
 if (select count(*) from public.retail_provisional_rows other_row where other_row.batch_id=r.batch_id and upper(btrim(other_row.store_code))=upper(btrim(r.store_code)))<>1 then return false;end if;
 e:=p.decision_reason::jsonb;m:=p.changes->'activation_review';
 if e->>'approval_mode'='SUPER_ADMIN_DIRECT' then
  if public.retail_identity_final_authorized(p_actor,f.sha256) is not true or e->>'reason' is distinct from 'Super Admin authorized Reliance Retail Store Master activation.'
   or e->>'evidence_kind' is distinct from 'CONFIRMED_SOURCE_FILE' or e->>'evidence_sha256' is distinct from f.sha256
   or e->>'reference' is distinct from 'SUPER_ADMIN_DIRECT:'||(e->>'direct_receipt_id')
   or not exists(select 1 from public.retail_provisional_events ev join public.retail_identity_final_authority a on a.id=(e->>'authority_grant_id')::uuid
    where ev.id=(e->>'direct_receipt_id')::bigint and ev.actor_id=p_actor and ev.batch_id=f.id and ev.action='SUPER_ADMIN_DIRECT_IDENTITY_APPROVAL'
    and a.actor_id=p_actor and a.enabled and a.source_sha256=f.sha256 and ev.details->>'authority_grant_id'=a.id::text
    and ev.details->>'approver_auth_user_id'=a.auth_user_id::text and e->>'approver_auth_user_id'=a.auth_user_id::text
    and ev.details->>'reason'='Super Admin authorized Reliance Retail Store Master activation.' and ev.details->>'source_sha256'=f.sha256
    and ev.details->'approved_proposal_ids' @> jsonb_build_array(p.id::text)) then return false;end if;
 else
  if p.proposed_by=p.decided_by then return false;end if;
 end if;
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

notify pgrst, 'reload schema';
$source$;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text)') and prosecdef and provolatile='s' and md5(replace(prosrc,E'\r\n',E'\n'))='0378a20524bdbf1e50bfbcce9cdb4b66') then raise exception 'Reviewed identity proof helper drift';end if;
if has_function_privilege('anon','public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text)','EXECUTE') or has_function_privilege('authenticated','public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text)','EXECUTE') or has_function_privilege('service_role','public.retail_identity_only_approved(uuid,jsonb,text,text,text,text,text,text)','EXECUTE') then raise exception 'Private proof helper ACL drift';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.retail_identity_final_authorized(uuid,text)') and prosecdef and provolatile='s' and md5(replace(prosrc,E'\r\n',E'\n'))='558355a93f78cf5d74a286a3a1a28bd9' and exists(select 1 from unnest(proconfig) cfg where regexp_replace(cfg,'[[:space:]]','','g')='search_path=pg_catalog,public')) then raise exception 'Direct approval function drift: retail_identity_final_authorized';end if;
if has_function_privilege('anon','public.retail_identity_final_authorized(uuid,text)','EXECUTE') or has_function_privilege('authenticated','public.retail_identity_final_authorized(uuid,text)','EXECUTE') or has_function_privilege('service_role','public.retail_identity_final_authorized(uuid,text)','EXECUTE') is distinct from false then raise exception 'Direct approval function ACL drift: retail_identity_final_authorized';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.rpc_retail_identity_direct_capability(uuid)') and prosecdef and provolatile='s' and md5(replace(prosrc,E'\r\n',E'\n'))='6f676d5f92d57227091e229e3bcfd643' and exists(select 1 from unnest(proconfig) cfg where regexp_replace(cfg,'[[:space:]]','','g')='search_path=pg_catalog,public')) then raise exception 'Direct approval function drift: rpc_retail_identity_direct_capability';end if;
if has_function_privilege('anon','public.rpc_retail_identity_direct_capability(uuid)','EXECUTE') or has_function_privilege('authenticated','public.rpc_retail_identity_direct_capability(uuid)','EXECUTE') or has_function_privilege('service_role','public.rpc_retail_identity_direct_capability(uuid)','EXECUTE') is distinct from true then raise exception 'Direct approval function ACL drift: rpc_retail_identity_direct_capability';end if;
if not exists(select 1 from pg_proc where oid=to_regprocedure('public.rpc_retail_identity_direct_approve(uuid,uuid[],text)') and prosecdef and provolatile='v' and md5(replace(prosrc,E'\r\n',E'\n'))='267d419e1ee31eb286590cdcdee6dfd8' and exists(select 1 from unnest(proconfig) cfg where regexp_replace(cfg,'[[:space:]]','','g')='search_path=pg_catalog,public')) then raise exception 'Direct approval function drift: rpc_retail_identity_direct_approve';end if;
if has_function_privilege('anon','public.rpc_retail_identity_direct_approve(uuid,uuid[],text)','EXECUTE') or has_function_privilege('authenticated','public.rpc_retail_identity_direct_approve(uuid,uuid[],text)','EXECUTE') or has_function_privilege('service_role','public.rpc_retail_identity_direct_approve(uuid,uuid[],text)','EXECUTE') is distinct from true then raise exception 'Direct approval function ACL drift: rpc_retail_identity_direct_approve';end if;
if not exists(select 1 from pg_class where oid=to_regclass('public.retail_identity_final_authority') and relrowsecurity) then raise exception 'Authority RLS missing';end if;
insert into supabase_migrations.schema_migrations(version,name,statements) values('20261031090000','retail_super_admin_direct',array[$source$create table public.retail_identity_final_authority (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references public.profiles(id),auth_user_id uuid not null,
 source_sha256 text not null check(source_sha256 ~ '^[a-f0-9]{64}$'),enabled boolean not null default true,
 granted_at timestamptz not null default now(),authorization_reference text not null check(length(btrim(authorization_reference))>=3),
 granted_by_db_role text not null default current_user,unique(actor_id,source_sha256),unique(auth_user_id,source_sha256)
);
alter table public.retail_identity_final_authority enable row level security;
revoke all on public.retail_identity_final_authority from public,anon,authenticated,service_role;

create function public.retail_identity_final_authorized(p_actor uuid,p_sha text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.retail_provisional_admin(p_actor) and exists(select 1 from public.retail_identity_final_authority a
 join public.retail_provisional_files f on f.sha256=a.source_sha256 join public.profiles p on p.id=a.actor_id and p.auth_user_id=a.auth_user_id
 where a.actor_id=p_actor and a.enabled and a.auth_user_id in ('79cd196c-c6f3-404a-b22a-d4683afefa3f'::uuid,'7e84cddf-821a-4513-b7ce-25895d660393'::uuid,'f9238141-8f44-4073-86aa-2749b8a3dccf'::uuid,'377ca7a2-95cc-4891-8840-338f2cb20bb9'::uuid) and a.source_sha256=p_sha and f.version=2 and f.withdrawn_at is null and f.source_format='UNIFIED MASTER');
$$;
revoke all on function public.retail_identity_final_authorized(uuid,text) from public,anon,authenticated,service_role;

create function public.rpc_retail_identity_direct_capability(p_actor uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('version','20261031090000','available',true,'authorized',exists(select 1 from public.retail_identity_final_authority a where a.actor_id=p_actor and public.retail_identity_final_authorized(p_actor,a.source_sha256)),
 'approval_reason','Super Admin authorized Reliance Retail Store Master activation.','source_version',2);
$$;
revoke all on function public.rpc_retail_identity_direct_capability(uuid) from public,anon,authenticated;
grant execute on function public.rpc_retail_identity_direct_capability(uuid) to service_role;

create function public.rpc_retail_identity_direct_approve(p_actor uuid,p_proposals uuid[],p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare pid uuid;p public.retail_provisional_proposals%rowtype;r public.retail_provisional_rows%rowtype;f public.retail_provisional_files%rowtype;
 grant_id uuid;approver_auth_id uuid;file_id uuid;source_sha text;receipt bigint;e jsonb;valid uuid[]:='{}';replayed uuid[]:='{}';held jsonb:='[]';receipt_ids jsonb:='[]';
begin
 if not public.retail_provisional_admin(p_actor) then raise exception using errcode='42501',message='Authenticated active Admin identity required';end if;
 if p_reason is distinct from 'Super Admin authorized Reliance Retail Store Master activation.' then raise exception 'Explicit Super Admin approval reason required';end if;
 if cardinality(p_proposals) is null or cardinality(p_proposals) not between 1 and 1000 or array_position(p_proposals,null) is not null or (select count(distinct x) from unnest(p_proposals) x)<>cardinality(p_proposals) then raise exception 'Select 1-1000 distinct proposal IDs';end if;
 if not exists(select 1 from public.retail_identity_final_authority a where a.actor_id=p_actor and public.retail_identity_final_authorized(p_actor,a.source_sha256)) then raise exception using errcode='42501',message='Super Admin final-approval authorization is not mapped to this account/source';end if;
 perform pg_advisory_xact_lock(hashtextextended('retail_super_admin_identity_approval',0));
 for pid in select x from unnest(p_proposals) x order by x loop
  begin
   select * into p from public.retail_provisional_proposals where id=pid for update;
   if not found or p.kind<>'identity' or p.target_store is not null then raise exception 'Not a new Store Master identity proposal';end if;
   select * into r from public.retail_provisional_rows where id=p.row_id for update;
   if not found then raise exception 'Saved source row missing';end if;
   select * into f from public.retail_provisional_files where id=r.batch_id for share;
   if not found or not public.retail_identity_final_authorized(p_actor,f.sha256) then raise exception 'Outside authorized confirmed Version 2 source';end if;
   if file_id is not null and file_id<>f.id then raise exception 'Use one confirmed saved source version per direct batch';end if;
   if p.status='APPROVED' then
    e:=p.decision_reason::jsonb;
    if p.decided_by=p_actor and e->>'approval_mode'='SUPER_ADMIN_DIRECT' and public.retail_identity_only_approved(p_actor,jsonb_build_object('proposal_id',p.id,'saved_row',r.id,'source_sha256',f.sha256,'row_digest',r.row_digest,'source_version',f.version,'source_row',r.source_row,'source_revision',r.revision),r.store_code,p.state,p.changes->>'store_name',p.changes->>'operating_status',e->>'reference',e->>'evidence_sha256') then replayed:=array_append(replayed,p.id);receipt_ids:=receipt_ids||jsonb_build_array(e->>'direct_receipt_id');continue;end if;
    raise exception 'Already reviewed; existing approval cannot be overwritten';
   end if;
   if p.status<>'PENDING' or p.decided_by is not null then raise exception 'Pending unreviewed proposal required';end if;
   if p.changes->>'operating_status' is distinct from 'Active' then raise exception 'Only explicitly proposed Active identities enter operational direct approval';end if;
   if p.proposed_by is null or coalesce(length(btrim(p.reason)),0)<3 or r.source_state not in ('TN','PY','KA','KL','TG','AP-1','AP-2') or p.state<>r.source_state or p.changes->>'state' is distinct from r.source_state or p.changes->>'store_name' is distinct from r.review->>'store_name' or nullif(btrim(p.changes->>'store_name'),'') is null or nullif(btrim(r.store_code),'') is null then raise exception 'Maker, official name, reason or State evidence invalid';end if;
   if p.revision<>r.revision or p.changes->'activation_review'->>'schema' is distinct from 'saved_identity_review_v1' or p.changes->'activation_review'->>'operational_model' is distinct from 'IDENTITY_ONLY' or p.changes->'activation_review'->>'source_sha256' is distinct from f.sha256 or p.changes->'activation_review'->>'row_digest' is distinct from r.row_digest or (p.changes->'activation_review'->>'source_revision')::integer is distinct from p.revision then raise exception 'Source revision/hash/digest changed';end if;
   if r.store_code ~ '[[:space:]/,;|]' or jsonb_typeof(r.source->'issues') is distinct from 'array' or exists(select 1 from jsonb_array_elements_text(r.source->'issues') issue where issue in ('DUPLICATE_SOURCE_CODE','AMBIGUOUS_STORE_CODE','CANONICAL_GEOGRAPHY_CONFLICT','UNKNOWN_GEOGRAPHY','MISSING_STORE_CODE','TECHNICAL_FORMULA_OR_CELL_ERROR')) then raise exception 'Unresolved Store Code/State identity conflict';end if;
   if (select count(*) from public.retail_provisional_rows x where x.batch_id=r.batch_id and upper(btrim(x.store_code))=upper(btrim(r.store_code)))<>1 or exists(select 1 from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(r.store_code))) then raise exception 'Duplicate/existing canonical Store Code is protected';end if;
   file_id:=f.id;source_sha:=f.sha256;valid:=array_append(valid,p.id);
  exception when others then held:=held||jsonb_build_array(jsonb_build_object('proposal_id',pid,'reason',sqlerrm));end;
 end loop;
 if cardinality(valid)>0 then
  select a.id,a.auth_user_id into strict grant_id,approver_auth_id from public.retail_identity_final_authority a where a.actor_id=p_actor and a.source_sha256=source_sha and a.enabled for share;
  insert into public.retail_provisional_events(batch_id,actor_id,action,details) values(file_id,p_actor,'SUPER_ADMIN_DIRECT_IDENTITY_APPROVAL',jsonb_build_object('approval_mode','SUPER_ADMIN_DIRECT','reason',p_reason,'authority_grant_id',grant_id,'approver_auth_user_id',approver_auth_id,'approved_proposal_ids',to_jsonb(valid),'source_sha256',source_sha,'source_version',2,'approved_at',now(),'held',held)) returning id into receipt;
  foreach pid in array valid loop
   select * into p from public.retail_provisional_proposals where id=pid;
   e:=jsonb_build_object('scope','SAVED_SOURCE_IDENTITY','approval_mode','SUPER_ADMIN_DIRECT','reason',p_reason,'reference','SUPER_ADMIN_DIRECT:'||receipt::text,'direct_receipt_id',receipt::text,'authority_grant_id',grant_id,'approver_auth_user_id',approver_auth_id,'evidence_kind','CONFIRMED_SOURCE_FILE','evidence_sha256',source_sha);
   update public.retail_provisional_proposals set status='APPROVED',decided_by=p_actor,decided_at=now(),decision_reason=e::text where id=p.id;
   update public.retail_provisional_rows set review=review||p.changes,revision=revision+1,verification_status='VERIFIED' where id=p.row_id;
   insert into public.reliance_retail_management_audit(action,entity_type,entity_id,actor_profile_id,after_state) values('SUPER_ADMIN_DIRECT_IDENTITY_APPROVAL','proposal',p.id,p_actor,jsonb_build_object('state',p.state,'approval',e,'approval_reason',p_reason));
  end loop;
  receipt_ids:=receipt_ids||jsonb_build_array(receipt::text);
 end if;
 select coalesce(jsonb_agg(distinct x),'[]'::jsonb) into receipt_ids from jsonb_array_elements(receipt_ids) x;
 return jsonb_build_object('approval_mode','SUPER_ADMIN_DIRECT','actor_id',p_actor,'approved_count',cardinality(valid),'approved_proposal_ids',to_jsonb(valid),'replayed_count',cardinality(replayed),'held_count',jsonb_array_length(held),'held',held,'receipt_ids',receipt_ids,'activated_count',0,'approval_reason',p_reason);
end;$$;
revoke all on function public.rpc_retail_identity_direct_approve(uuid,uuid[],text) from public,anon,authenticated;
grant execute on function public.rpc_retail_identity_direct_approve(uuid,uuid[],text) to service_role;

create or replace function public.retail_identity_only_approved(p_actor uuid,p_proof jsonb,p_code text,p_state text,p_name text,p_status text,p_ref text,p_evidence text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare p public.retail_provisional_proposals%rowtype;r public.retail_provisional_rows%rowtype;f public.retail_provisional_files%rowtype;e jsonb;m jsonb;
begin
 if p_proof is null or jsonb_typeof(p_proof) is distinct from 'object' then return false;end if;
 select * into p from public.retail_provisional_proposals where id=(p_proof->>'proposal_id')::uuid;
 if not found or p.kind<>'identity' or p.status<>'APPROVED' or p.target_store is not null or p.decided_by is distinct from p_actor then return false;end if;
 select * into r from public.retail_provisional_rows where id=p.row_id;
 if not found then return false;end if;
 select * into f from public.retail_provisional_files where id=r.batch_id;
 if not found or f.withdrawn_at is not null then return false;end if;
 if jsonb_typeof(r.source->'issues') is distinct from 'array' then return false;end if;
 if exists(select 1 from jsonb_array_elements_text(r.source->'issues') issue where issue in ('DUPLICATE_SOURCE_CODE','AMBIGUOUS_STORE_CODE','CANONICAL_GEOGRAPHY_CONFLICT','UNKNOWN_GEOGRAPHY','MISSING_STORE_CODE','TECHNICAL_FORMULA_OR_CELL_ERROR')) then return false;end if;
 if (select count(*) from public.retail_provisional_rows other_row where other_row.batch_id=r.batch_id and upper(btrim(other_row.store_code))=upper(btrim(r.store_code)))<>1 then return false;end if;
 e:=p.decision_reason::jsonb;m:=p.changes->'activation_review';
 if e->>'approval_mode'='SUPER_ADMIN_DIRECT' then
  if public.retail_identity_final_authorized(p_actor,f.sha256) is not true or e->>'reason' is distinct from 'Super Admin authorized Reliance Retail Store Master activation.'
   or e->>'evidence_kind' is distinct from 'CONFIRMED_SOURCE_FILE' or e->>'evidence_sha256' is distinct from f.sha256
   or e->>'reference' is distinct from 'SUPER_ADMIN_DIRECT:'||(e->>'direct_receipt_id')
   or not exists(select 1 from public.retail_provisional_events ev join public.retail_identity_final_authority a on a.id=(e->>'authority_grant_id')::uuid
    where ev.id=(e->>'direct_receipt_id')::bigint and ev.actor_id=p_actor and ev.batch_id=f.id and ev.action='SUPER_ADMIN_DIRECT_IDENTITY_APPROVAL'
    and a.actor_id=p_actor and a.enabled and a.source_sha256=f.sha256 and ev.details->>'authority_grant_id'=a.id::text
    and ev.details->>'approver_auth_user_id'=a.auth_user_id::text and e->>'approver_auth_user_id'=a.auth_user_id::text
    and ev.details->>'reason'='Super Admin authorized Reliance Retail Store Master activation.' and ev.details->>'source_sha256'=f.sha256
    and ev.details->'approved_proposal_ids' @> jsonb_build_array(p.id::text)) then return false;end if;
 else
  if p.proposed_by=p.decided_by then return false;end if;
 end if;
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

notify pgrst, 'reload schema';
$source$]);
end;$install$;commit;
