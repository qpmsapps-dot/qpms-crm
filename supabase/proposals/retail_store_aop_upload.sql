-- PREPARED ONLY. Number against verified live migration history before installation.
-- No seeds, no changes to existing store identities, no GPS or financial logic.
begin;
-- Attendance-master geography only. Existing GPS functions remain unchanged.
do $$ declare c text; begin
 select pg_get_constraintdef(oid) into c from pg_constraint where conrelid='public.reliance_retail_store_master'::regclass and conname='reliance_retail_store_state_check';
 create temp table retail_import_expected_state(state text check(upper(btrim(state)) in ('TN','PY','KA','KL','AP-1','AP-2'))) on commit drop;
 if c is distinct from (select pg_get_constraintdef(oid) from pg_constraint where conrelid='pg_temp.retail_import_expected_state'::regclass and contype='c') then raise exception 'Store state contract drift; review live definitions'; end if;
end; $$;
alter table public.reliance_retail_store_master drop constraint reliance_retail_store_state_check;
alter table public.reliance_retail_store_master add constraint reliance_retail_store_state_check check(upper(btrim(state)) in ('TN','PY','KA','KL','AP-1','AP-2','TG'));
create table public.retail_store_import_approvals (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in ('identity','aop')),
 status text not null check(status in ('APPROVED','REVOKED')),
 file_sha256 text not null check(file_sha256 ~ '^[a-f0-9]{64}$'),
 row_digest text not null check(row_digest ~ '^[a-f0-9]{64}$'), source_row integer not null check(source_row>1),
 store_code text not null, approval_ref text not null check(btrim(approval_ref)<>''),
 reviewer_id uuid not null references public.profiles(id), evidence_sha256 text not null check(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 approved_at timestamptz not null, valid_until date, decision jsonb not null,
 unique(kind,file_sha256,source_row,row_digest)
);
create table public.retail_store_import_batches (
 id uuid primary key default gen_random_uuid(), checksum text not null unique check(checksum ~ '^[a-f0-9]{64}$'),
 filename text not null, original_base64 text not null, uploaded_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), preview_key uuid not null, baseline_stamp text not null,
 review jsonb not null, status text not null default 'preview' check(status in ('preview','committed','rolled_back')),
 committed_at timestamptz, receipt jsonb, rollback_reason text, rolled_back_at timestamptz
);
create table public.retail_store_import_events (
 id bigint generated always as identity primary key, batch_id uuid not null references public.retail_store_import_batches(id),
 actor_id uuid not null references public.profiles(id), action text not null, created_at timestamptz not null default now(), details jsonb not null
);
create function public.retail_store_import_admin(p_actor uuid) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not exists(select 1 from public.profiles p where p.id=p_actor and p.is_active is true
  and upper(coalesce(p.status,'Active'))='ACTIVE'
  and regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') in ('ADMIN','QPMSADMIN')) then
  raise exception using errcode='42501',message='Active Admin role required';
 end if;
end; $$;
create function public.rpc_retail_store_import_source(p_actor uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare s jsonb; a jsonb; d jsonb;
begin
 perform public.retail_store_import_admin(p_actor);
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into s from public.reliance_retail_store_master x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into a from public.retail_attendance_aop_versions x where superseded_at is null;
 select coalesce(jsonb_agg(x.decision||(to_jsonb(x)-'decision') order by x.id),'[]') into d from public.retail_store_import_approvals x;
 return jsonb_build_object('stores',s,'aop',a,'decisions',d,'stamp',md5(s::text||a::text||d::text));
end; $$;
create function public.retail_store_import_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if tg_op='DELETE' then raise exception 'Import evidence cannot be deleted'; end if;
 if tg_table_name='retail_store_import_events' then raise exception 'Import events are immutable'; end if;
 if old.status <> 'preview' and (to_jsonb(new)-'status'-'rollback_reason'-'rolled_back_at') is distinct from (to_jsonb(old)-'status'-'rollback_reason'-'rolled_back_at') then raise exception 'Committed import evidence is immutable'; end if;
 if old.status='rolled_back' then raise exception 'Rolled back import is immutable'; end if;
 if old.status='committed' and new.status<>'rolled_back' then raise exception 'Committed import can only transition to audited rollback'; end if;
 return new;
end; $$;
create trigger retail_store_batch_immutable before update or delete on public.retail_store_import_batches for each row execute function public.retail_store_import_immutable();
create trigger retail_store_events_immutable before update or delete on public.retail_store_import_events for each row execute function public.retail_store_import_immutable();

create function public.rpc_confirm_retail_store_import(p_actor uuid,p_batch uuid,p_preview_key uuid,p_identity boolean,p_aop boolean)
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
     or coalesce(d.decision->>'store_status','') not in ('Active','Inactive') or d.decision->>'operational_model' is distinct from 'SUPERVISOR_ONLY'
     or nullif(btrim(d.decision->>'supervisor_name'),'') is null then raise exception 'Explicit identity, status and genuine supervisor approval required'; end if;
    if exists(select 1 from public.reliance_retail_store_master where upper(btrim(store_code))=r->>'store_code') then raise exception 'Existing identity must be preserved'; end if;
    insert into public.reliance_retail_store_master(store_code,store_name,state,city,store_format,status,source_name,metadata)
    values(r->>'store_code',r->>'store_name',r->>'state',nullif(r->>'city',''),nullif(r->>'store_format',''),d.decision->>'store_status',b.filename,
     jsonb_build_object('operational_model','SUPERVISOR_ONLY','supervisor',jsonb_build_object('name',d.decision->>'supervisor_name'),'import_batch',b.id,'approval_id',d.id,'source_sha256',b.checksum,'source_row',r->'source_row')) returning * into s;
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

-- Compensating rollback retains canonical IDs and all evidence. Never delete identities.
create function public.rpc_rollback_retail_store_import(p_actor uuid,p_batch uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.retail_store_import_batches%rowtype; item jsonb; s public.reliance_retail_store_master%rowtype; fk record; referenced boolean;
begin
 perform public.retail_store_import_admin(p_actor);
 if length(btrim(coalesce(p_reason,'')))<10 then raise exception 'Rollback reason required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('retail_store_import',0));
 perform pg_advisory_xact_lock(hashtextextended('retail_uploaded_attendance',0));
 lock table public.reliance_retail_store_master in share row exclusive mode;
 select * into b from public.retail_store_import_batches where id=p_batch for update;
 if not found or b.uploaded_by<>p_actor then raise exception using errcode='42501',message='Import owner mismatch'; end if;
 if b.status='rolled_back' then return jsonb_build_object('batch_id',b.id,'status','rolled_back'); end if;
 if b.status<>'committed' then raise exception 'Only committed imports can roll back'; end if;
 for item in select value from jsonb_array_elements(b.receipt->'aop_after') loop
  if item is distinct from (select to_jsonb(x) from public.retail_attendance_aop_versions x where x.id=(item->>'id')::uuid for update) then raise exception 'AOP changed; separate correction review required'; end if;
 end loop;
 for item in select value from jsonb_array_elements(b.receipt->'stores') loop
  select * into s from public.reliance_retail_store_master where id=(item->>'id')::uuid for update;
  if not found or to_jsonb(s) is distinct from item->'after' then raise exception 'Imported identity changed; separate correction review required'; end if;
  -- Refuse rollback once any referencing operational table has used a new identity.
  for fk in select c.conrelid::regclass as rel,a.attname as col from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid='public.reliance_retail_store_master'::regclass loop
   execute format('select exists(select 1 from %s where %I=$1)',fk.rel,fk.col) into referenced using s.id;
   if referenced then raise exception 'Imported identity is referenced; separate correction review required'; end if;
  end loop;
  update public.reliance_retail_store_master set status='Inactive',metadata=metadata||jsonb_build_object('rollback_batch',b.id) where id=s.id;
 end loop;
 if exists(select 1 from public.retail_attendance_aop_versions where id::text in(select jsonb_array_elements_text(b.receipt->'aop_ids')) and superseded_at is not null) then raise exception 'AOP changed; separate correction review required'; end if;
 update public.retail_attendance_aop_versions set superseded_at=now(),superseded_by_batch=(b.receipt->>'aop_upload_id')::uuid where id::text in(select jsonb_array_elements_text(b.receipt->'aop_ids'));
 update public.retail_store_import_batches set status='rolled_back',rolled_back_at=now(),rollback_reason=btrim(p_reason) where id=b.id;
 insert into public.retail_store_import_events(batch_id,actor_id,action,details) values(b.id,p_actor,'ROLLBACK',jsonb_build_object('reason',btrim(p_reason)));
 return jsonb_build_object('batch_id',b.id,'status','rolled_back');
end; $$;

alter table public.retail_store_import_approvals enable row level security;
alter table public.retail_store_import_batches enable row level security;
alter table public.retail_store_import_events enable row level security;
revoke all on public.retail_store_import_approvals,public.retail_store_import_batches,public.retail_store_import_events from public,anon,authenticated,service_role;
grant select on public.retail_store_import_approvals to service_role;
grant select,insert,update on public.retail_store_import_batches to service_role;
revoke all on function public.retail_store_import_admin(uuid),public.retail_store_import_immutable(),public.rpc_retail_store_import_source(uuid),public.rpc_confirm_retail_store_import(uuid,uuid,uuid,boolean,boolean),public.rpc_rollback_retail_store_import(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.rpc_retail_store_import_source(uuid),public.rpc_confirm_retail_store_import(uuid,uuid,uuid,boolean,boolean),public.rpc_rollback_retail_store_import(uuid,uuid,text) to service_role;
commit;
