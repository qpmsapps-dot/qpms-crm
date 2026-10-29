begin;
do $guard$ begin
 if exists(select 1 from supabase_migrations.schema_migrations where version='20261029120000') then raise exception 'Proposed migration version already exists; inspect before proceeding'; end if;
 if (select count(*) from public.reliance_retail_store_master)<>130 then raise exception 'Canonical baseline count changed; review before installation'; end if;
 if to_regprocedure('public.rpc_confirm_retail_bulk_identity(uuid,uuid,uuid)') is null then raise exception 'Existing identity approval contract is missing'; end if;
end; $guard$;
-- PREPARED ONLY: install manually after explicit production migration authorization.
-- Separate evidence/review domain. No canonical, attendance, AOP, GPS or KM writes.
create table public.retail_provisional_access (
 actor_id uuid not null references public.profiles(id), state text not null
 check(state in ('TN','PY','KA','KL','TG','AP-1','AP-2')), primary key(actor_id,state)
);
create table public.retail_provisional_files (
 id uuid primary key default gen_random_uuid(), version bigint generated always as identity unique,
 filename text not null, sha256 text not null unique check(sha256 ~ '^[a-f0-9]{64}$'),
 original_base64 text not null, uploaded_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), withdrawn_at timestamptz, withdrawal_reason text
);
create table public.retail_provisional_rows (
 id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.retail_provisional_files(id),
 source_row integer not null check(source_row>1), row_digest text not null check(row_digest ~ '^[a-f0-9]{64}$'),
 source jsonb not null, store_code text not null, source_state text not null,
 review jsonb not null, revision integer not null default 0,
 verification_status text not null default 'PENDING_VERIFICATION' check(verification_status in ('PENDING_VERIFICATION','VERIFIED')),
 unique(batch_id,source_row)
);
create table public.retail_provisional_proposals (
 id uuid primary key default gen_random_uuid(), row_id uuid not null references public.retail_provisional_rows(id),
 revision integer not null, changes jsonb not null, reason text not null, proposed_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), status text not null default 'PENDING' check(status in ('PENDING','APPROVED','REJECTED')),
 decided_by uuid references public.profiles(id), decided_at timestamptz, decision_reason text
);
create unique index retail_provisional_one_pending on public.retail_provisional_proposals(row_id) where status='PENDING';
create table public.retail_provisional_events (
 id bigint generated always as identity primary key, batch_id uuid not null references public.retail_provisional_files(id),
 actor_id uuid not null references public.profiles(id), action text not null, details jsonb not null,
 created_at timestamptz not null default now()
);

create function public.retail_provisional_immutable() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if tg_op='DELETE' or tg_table_name='retail_provisional_events' then raise exception 'Provisional evidence is immutable'; end if;
 if tg_table_name='retail_provisional_files' then
  if old.withdrawn_at is not null or new.withdrawn_at is null or nullif(btrim(new.withdrawal_reason),'') is null
  or (to_jsonb(new)-'withdrawn_at'-'withdrawal_reason') is distinct from (to_jsonb(old)-'withdrawn_at'-'withdrawal_reason') then raise exception 'Only audited source withdrawal is allowed'; end if;
 elsif tg_table_name='retail_provisional_rows' then
  if (to_jsonb(new)-'review'-'revision'-'verification_status') is distinct from (to_jsonb(old)-'review'-'revision'-'verification_status')
  or new.revision<>old.revision+1 or new.verification_status<>'VERIFIED' then raise exception 'Source evidence cannot change'; end if;
 elsif tg_table_name='retail_provisional_proposals' then
  if old.status<>'PENDING' or new.status not in ('APPROVED','REJECTED') or new.decided_by is null or new.decided_at is null
  or (to_jsonb(new)-'status'-'decided_by'-'decided_at'-'decision_reason') is distinct from (to_jsonb(old)-'status'-'decided_by'-'decided_at'-'decision_reason') then raise exception 'Proposal evidence cannot change'; end if;
 end if;
 return new;
end; $$;
create trigger retail_provisional_file_immutable before update or delete on public.retail_provisional_files for each row execute function public.retail_provisional_immutable();
create trigger retail_provisional_row_immutable before update or delete on public.retail_provisional_rows for each row execute function public.retail_provisional_immutable();
create trigger retail_provisional_proposal_immutable before update or delete on public.retail_provisional_proposals for each row execute function public.retail_provisional_immutable();
create trigger retail_provisional_event_immutable before update or delete on public.retail_provisional_events for each row execute function public.retail_provisional_immutable();

create function public.retail_provisional_admin(p_actor uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.profiles where id=p_actor and is_active is true
 and upper(coalesce(status,'Active'))='ACTIVE'
 and regexp_replace(upper(coalesce(role,'')),'[^A-Z0-9]','','g') in ('ADMIN','QPMSADMIN'));
$$;
create function public.retail_provisional_allowed(p_actor uuid,p_state text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.retail_provisional_admin(p_actor) or exists(
 select 1 from public.profiles p join public.retail_provisional_access a on a.actor_id=p.id
 where p.id=p_actor and p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE'
 and regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]','','g') in ('RELIANCE','RELIANCERETAIL')
 and regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') in ('HKMIS','HOUSEKEEPINGMIS','TECHMIS','TECHNICALMIS')
 and (p_state is null or a.state=p_state));
$$;

create function public.rpc_retail_provisional_upload(p_actor uuid,p_filename text,p_sha256 text,p_original text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b uuid; r jsonb; n integer;
begin
 if not public.retail_provisional_admin(p_actor) then raise exception using errcode='42501',message='Active Admin required'; end if;
 if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' or nullif(btrim(p_filename),'') is null or length(p_filename)>255
 or p_original is null or length(p_original)>14000000 or jsonb_typeof(p_rows) is distinct from 'array'
 then raise exception 'Invalid source evidence'; end if;
 if encode(sha256(decode(p_original,'base64')),'hex')<>p_sha256 then raise exception 'Source file hash mismatch'; end if;
 n:=jsonb_array_length(p_rows); if n<1 or n>10000 then raise exception 'Invalid row count'; end if;
 perform pg_advisory_xact_lock(hashtextextended('retail_provisional_review',0));
 select id into b from public.retail_provisional_files where sha256=p_sha256;
 if found then return jsonb_build_object('batch_id',b,'replayed',true,'rows',(select count(*) from public.retail_provisional_rows where batch_id=b)); end if;
 insert into public.retail_provisional_files(filename,sha256,original_base64,uploaded_by) values(p_filename,p_sha256,p_original,p_actor) returning id into b;
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r->'raw') is distinct from 'object' or r->>'row_digest' is null or r->>'row_digest' !~ '^[a-f0-9]{64}$'
  or r->>'source_row' is null or r->>'store_code' is null or r->>'state' is null then raise exception 'Invalid row evidence'; end if;
  insert into public.retail_provisional_rows(batch_id,source_row,row_digest,source,store_code,source_state,review)
  values(b,(r->>'source_row')::int,r->>'row_digest',r,r->>'store_code',r->>'state',
   jsonb_build_object('store_name',r->>'store_name','state',r->>'state','city',r->>'city','operating_status','UNKNOWN','duplicate_of',null));
 end loop;
 insert into public.retail_provisional_events(batch_id,actor_id,action,details) values(b,p_actor,'UPLOAD',jsonb_build_object('sha256',p_sha256,'rows',n));
 return jsonb_build_object('batch_id',b,'replayed',false,'rows',n);
end; $$;

create function public.rpc_retail_provisional_propose(p_actor uuid,p_row uuid,p_revision integer,p_changes jsonb,p_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.retail_provisional_rows%rowtype; proposal uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended('retail_provisional_review',0));
 select * into r from public.retail_provisional_rows where id=p_row for update;
 if not found or not public.retail_provisional_allowed(p_actor,r.source_state) then raise exception using errcode='42501',message='State review access required'; end if;
 if exists(select 1 from public.retail_provisional_files where id=r.batch_id and withdrawn_at is not null) then raise exception 'Source version withdrawn'; end if;
 if p_revision is distinct from r.revision then raise exception using errcode='40001',message='Review changed; reload'; end if;
 if jsonb_typeof(p_changes) is distinct from 'object' or
 (select count(*) from jsonb_object_keys(p_changes))<>5 or not(p_changes ?& array['store_name','state','city','operating_status','duplicate_of'])
 or coalesce(jsonb_typeof(p_changes->'store_name'),'')<>'string' or coalesce(length(btrim(p_changes->>'store_name')),0) not between 1 and 500
 or coalesce(p_changes->>'state','') not in ('TN','PY','KA','KL','TG','AP-1','AP-2')
 or not public.retail_provisional_allowed(p_actor,p_changes->>'state')
 or coalesce(jsonb_typeof(p_changes->'city'),'')<>'string' or length(p_changes->>'city')>500
 or coalesce(p_changes->>'operating_status','') not in ('UNKNOWN','Active','Inactive','Closed')
 or coalesce(length(btrim(p_reason)),0) not between 3 and 2000
 then raise exception 'Complete proposed identity, allowed geography, status and reason required'; end if;
 if p_changes->>'duplicate_of' is not null and not exists(select 1 from public.reliance_retail_store_master where id=(p_changes->>'duplicate_of')::uuid) then raise exception 'Duplicate mapping must reference an existing canonical store'; end if;
 insert into public.retail_provisional_proposals(row_id,revision,changes,reason,proposed_by) values(p_row,p_revision,p_changes,p_reason,p_actor) returning id into proposal;
 insert into public.retail_provisional_events(batch_id,actor_id,action,details) values(r.batch_id,p_actor,'PROPOSE',jsonb_build_object('proposal_id',proposal,'row_id',r.id,'before',r.review,'after',p_changes,'reason',p_reason));
 return proposal;
end; $$;

create function public.rpc_retail_provisional_decide(p_actor uuid,p_proposal uuid,p_approve boolean,p_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.retail_provisional_proposals%rowtype; r public.retail_provisional_rows%rowtype;
begin
 if not public.retail_provisional_admin(p_actor) then raise exception using errcode='42501',message='Active Admin approval required'; end if;
 if p_approve is null or coalesce(length(btrim(p_reason)),0) not between 3 and 2000 then raise exception 'Decision and evidence reference required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('retail_provisional_review',0));
 select * into p from public.retail_provisional_proposals where id=p_proposal for update;
 if not found or p.status<>'PENDING' then raise exception 'Proposal already decided or missing'; end if;
 if p.proposed_by=p_actor then raise exception using errcode='42501',message='A different Admin must review this proposal'; end if;
 select * into r from public.retail_provisional_rows where id=p.row_id for update;
 if r.revision<>p.revision then raise exception using errcode='40001',message='Review changed; propose again'; end if;
 if exists(select 1 from public.retail_provisional_files where id=r.batch_id and withdrawn_at is not null) then raise exception 'Source version withdrawn'; end if;
 if p_approve then
  if p.changes->>'operating_status'='UNKNOWN' then raise exception 'Verify operating status before approval'; end if;
  if p.changes->>'duplicate_of' is not null and not exists(select 1 from public.reliance_retail_store_master where id=(p.changes->>'duplicate_of')::uuid) then raise exception 'Canonical mapping no longer exists'; end if;
  update public.retail_provisional_rows set review=p.changes,revision=revision+1,verification_status='VERIFIED' where id=r.id;
 end if;
 update public.retail_provisional_proposals set status=case when p_approve then 'APPROVED' else 'REJECTED' end,decided_by=p_actor,decided_at=now(),decision_reason=p_reason where id=p.id;
 insert into public.retail_provisional_events(batch_id,actor_id,action,details) values(r.batch_id,p_actor,case when p_approve then 'APPROVE_STAGING' else 'REJECT' end,jsonb_build_object('proposal_id',p.id,'row_id',r.id,'before',r.review,'after',p.changes,'reason',p_reason));
 return p.id;
end; $$;

create function public.rpc_retail_provisional_withdraw(p_actor uuid,p_batch uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not public.retail_provisional_admin(p_actor) then raise exception using errcode='42501',message='Active Admin required'; end if;
 if coalesce(length(btrim(p_reason)),0) not between 3 and 2000 then raise exception 'Withdrawal reason required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('retail_provisional_review',0));
 update public.retail_provisional_files set withdrawn_at=now(),withdrawal_reason=p_reason where id=p_batch and withdrawn_at is null;
 if not found then raise exception 'Source missing or already withdrawn'; end if;
 insert into public.retail_provisional_events(batch_id,actor_id,action,details) values(p_batch,p_actor,'WITHDRAW',jsonb_build_object('reason',p_reason));
 return p_batch;
end; $$;

create function public.rpc_retail_provisional_review(p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare rows jsonb; files jsonb; proposals jsonb; events jsonb; canonical jsonb;
begin
 if not public.retail_provisional_allowed(p_actor,null) then raise exception using errcode='42501',message='Authorized state review access required'; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.version desc),'[]') into files from (
 select f.id,f.version,f.filename,f.sha256,f.created_at,f.withdrawn_at,f.withdrawal_reason from public.retail_provisional_files f
 where public.retail_provisional_admin(p_actor) or exists(select 1 from public.retail_provisional_rows r where r.batch_id=f.id and public.retail_provisional_allowed(p_actor,r.source_state))) x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.source_state,x.store_code,x.source_row),'[]') into rows from (
 select r.*,f.sha256,f.filename,f.version,f.withdrawn_at,
 (select count(*) from public.retail_provisional_rows d where d.batch_id=r.batch_id and d.store_code=r.store_code) as duplicate_count,
 (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'store_code',c.store_code,'store_name',c.store_name,'state',c.state)),'[]') from public.reliance_retail_store_master c where upper(btrim(c.store_code))=r.store_code) as canonical_matches,
 exists(select 1 from public.retail_provisional_rows d join public.retail_provisional_files df on df.id=d.batch_id where d.batch_id<>r.batch_id and df.withdrawn_at is null and d.store_code=r.store_code) as other_version_match
 from public.retail_provisional_rows r join public.retail_provisional_files f on f.id=r.batch_id where public.retail_provisional_allowed(p_actor,r.source_state)) x;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc),'[]') into proposals from public.retail_provisional_proposals p join public.retail_provisional_rows r on r.id=p.row_id where public.retail_provisional_allowed(p_actor,r.source_state);
 -- Restrict events to visible rows; batch events contain no other states' row data.
 select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') into events from public.retail_provisional_events e where
 (e.details ? 'row_id' and exists(select 1 from public.retail_provisional_rows r where r.id=(e.details->>'row_id')::uuid and public.retail_provisional_allowed(p_actor,r.source_state)))
 or (not(e.details ? 'row_id') and public.retail_provisional_admin(p_actor));
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'store_code',c.store_code,'store_name',c.store_name,'state',c.state) order by c.store_code),'[]') into canonical from public.reliance_retail_store_master c where public.retail_provisional_allowed(p_actor,c.state);
 return jsonb_build_object('admin',public.retail_provisional_admin(p_actor),'files',files,'rows',rows,'proposals',proposals,'events',events,'canonical',canonical);
end; $$;

-- Only the trusted backend can execute RPCs; clients cannot supply their own actor.
-- Even service_role has no table writes or access-registry administration.
do $$ declare t text; f regprocedure; begin
 foreach t in array array['retail_provisional_access','retail_provisional_files','retail_provisional_rows','retail_provisional_proposals','retail_provisional_events'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'rpc_retail_provisional_%' or p.proname in ('retail_provisional_admin','retail_provisional_allowed','retail_provisional_immutable')) loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f);
  if f::text like '%rpc_retail_provisional_%' then execute format('grant execute on function %s to service_role',f); end if;
 end loop;
end; $$;

insert into supabase_migrations.schema_migrations(version,name,statements) values('20261029120000','retail_provisional_stores',array['-- PREPARED ONLY: install manually after explicit production migration authorization.
-- Separate evidence/review domain. No canonical, attendance, AOP, GPS or KM writes.
begin;
create table public.retail_provisional_access (
 actor_id uuid not null references public.profiles(id), state text not null
 check(state in (''TN'',''PY'',''KA'',''KL'',''TG'',''AP-1'',''AP-2'')), primary key(actor_id,state)
);
create table public.retail_provisional_files (
 id uuid primary key default gen_random_uuid(), version bigint generated always as identity unique,
 filename text not null, sha256 text not null unique check(sha256 ~ ''^[a-f0-9]{64}$''),
 original_base64 text not null, uploaded_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), withdrawn_at timestamptz, withdrawal_reason text
);
create table public.retail_provisional_rows (
 id uuid primary key default gen_random_uuid(), batch_id uuid not null references public.retail_provisional_files(id),
 source_row integer not null check(source_row>1), row_digest text not null check(row_digest ~ ''^[a-f0-9]{64}$''),
 source jsonb not null, store_code text not null, source_state text not null,
 review jsonb not null, revision integer not null default 0,
 verification_status text not null default ''PENDING_VERIFICATION'' check(verification_status in (''PENDING_VERIFICATION'',''VERIFIED'')),
 unique(batch_id,source_row)
);
create table public.retail_provisional_proposals (
 id uuid primary key default gen_random_uuid(), row_id uuid not null references public.retail_provisional_rows(id),
 revision integer not null, changes jsonb not null, reason text not null, proposed_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), status text not null default ''PENDING'' check(status in (''PENDING'',''APPROVED'',''REJECTED'')),
 decided_by uuid references public.profiles(id), decided_at timestamptz, decision_reason text
);
create unique index retail_provisional_one_pending on public.retail_provisional_proposals(row_id) where status=''PENDING'';
create table public.retail_provisional_events (
 id bigint generated always as identity primary key, batch_id uuid not null references public.retail_provisional_files(id),
 actor_id uuid not null references public.profiles(id), action text not null, details jsonb not null,
 created_at timestamptz not null default now()
);

create function public.retail_provisional_immutable() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if tg_op=''DELETE'' or tg_table_name=''retail_provisional_events'' then raise exception ''Provisional evidence is immutable''; end if;
 if tg_table_name=''retail_provisional_files'' then
  if old.withdrawn_at is not null or new.withdrawn_at is null or nullif(btrim(new.withdrawal_reason),'''') is null
  or (to_jsonb(new)-''withdrawn_at''-''withdrawal_reason'') is distinct from (to_jsonb(old)-''withdrawn_at''-''withdrawal_reason'') then raise exception ''Only audited source withdrawal is allowed''; end if;
 elsif tg_table_name=''retail_provisional_rows'' then
  if (to_jsonb(new)-''review''-''revision''-''verification_status'') is distinct from (to_jsonb(old)-''review''-''revision''-''verification_status'')
  or new.revision<>old.revision+1 or new.verification_status<>''VERIFIED'' then raise exception ''Source evidence cannot change''; end if;
 elsif tg_table_name=''retail_provisional_proposals'' then
  if old.status<>''PENDING'' or new.status not in (''APPROVED'',''REJECTED'') or new.decided_by is null or new.decided_at is null
  or (to_jsonb(new)-''status''-''decided_by''-''decided_at''-''decision_reason'') is distinct from (to_jsonb(old)-''status''-''decided_by''-''decided_at''-''decision_reason'') then raise exception ''Proposal evidence cannot change''; end if;
 end if;
 return new;
end; $$;
create trigger retail_provisional_file_immutable before update or delete on public.retail_provisional_files for each row execute function public.retail_provisional_immutable();
create trigger retail_provisional_row_immutable before update or delete on public.retail_provisional_rows for each row execute function public.retail_provisional_immutable();
create trigger retail_provisional_proposal_immutable before update or delete on public.retail_provisional_proposals for each row execute function public.retail_provisional_immutable();
create trigger retail_provisional_event_immutable before update or delete on public.retail_provisional_events for each row execute function public.retail_provisional_immutable();

create function public.retail_provisional_admin(p_actor uuid) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.profiles where id=p_actor and is_active is true
 and upper(coalesce(status,''Active''))=''ACTIVE''
 and regexp_replace(upper(coalesce(role,'''')),''[^A-Z0-9]'','''',''g'') in (''ADMIN'',''QPMSADMIN''));
$$;
create function public.retail_provisional_allowed(p_actor uuid,p_state text) returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.retail_provisional_admin(p_actor) or exists(
 select 1 from public.profiles p join public.retail_provisional_access a on a.actor_id=p.id
 where p.id=p_actor and p.is_active is true and upper(coalesce(p.status,''Active''))=''ACTIVE''
 and regexp_replace(upper(coalesce(p.business,'''')),''[^A-Z0-9]'','''',''g'') in (''RELIANCE'',''RELIANCERETAIL'')
 and regexp_replace(upper(coalesce(p.role,'''')),''[^A-Z0-9]'','''',''g'') in (''HKMIS'',''HOUSEKEEPINGMIS'',''TECHMIS'',''TECHNICALMIS'')
 and (p_state is null or a.state=p_state));
$$;

create function public.rpc_retail_provisional_upload(p_actor uuid,p_filename text,p_sha256 text,p_original text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b uuid; r jsonb; n integer;
begin
 if not public.retail_provisional_admin(p_actor) then raise exception using errcode=''42501'',message=''Active Admin required''; end if;
 if p_sha256 is null or p_sha256 !~ ''^[a-f0-9]{64}$'' or nullif(btrim(p_filename),'''') is null or length(p_filename)>255
 or p_original is null or length(p_original)>14000000 or jsonb_typeof(p_rows) is distinct from ''array''
 then raise exception ''Invalid source evidence''; end if;
 if encode(sha256(decode(p_original,''base64'')),''hex'')<>p_sha256 then raise exception ''Source file hash mismatch''; end if;
 n:=jsonb_array_length(p_rows); if n<1 or n>10000 then raise exception ''Invalid row count''; end if;
 perform pg_advisory_xact_lock(hashtextextended(''retail_provisional_review'',0));
 select id into b from public.retail_provisional_files where sha256=p_sha256;
 if found then return jsonb_build_object(''batch_id'',b,''replayed'',true,''rows'',(select count(*) from public.retail_provisional_rows where batch_id=b)); end if;
 insert into public.retail_provisional_files(filename,sha256,original_base64,uploaded_by) values(p_filename,p_sha256,p_original,p_actor) returning id into b;
 for r in select value from jsonb_array_elements(p_rows) loop
  if jsonb_typeof(r->''raw'') is distinct from ''object'' or r->>''row_digest'' is null or r->>''row_digest'' !~ ''^[a-f0-9]{64}$''
  or r->>''source_row'' is null or r->>''store_code'' is null or r->>''state'' is null then raise exception ''Invalid row evidence''; end if;
  insert into public.retail_provisional_rows(batch_id,source_row,row_digest,source,store_code,source_state,review)
  values(b,(r->>''source_row'')::int,r->>''row_digest'',r,r->>''store_code'',r->>''state'',
   jsonb_build_object(''store_name'',r->>''store_name'',''state'',r->>''state'',''city'',r->>''city'',''operating_status'',''UNKNOWN'',''duplicate_of'',null));
 end loop;
 insert into public.retail_provisional_events(batch_id,actor_id,action,details) values(b,p_actor,''UPLOAD'',jsonb_build_object(''sha256'',p_sha256,''rows'',n));
 return jsonb_build_object(''batch_id'',b,''replayed'',false,''rows'',n);
end; $$;

create function public.rpc_retail_provisional_propose(p_actor uuid,p_row uuid,p_revision integer,p_changes jsonb,p_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.retail_provisional_rows%rowtype; proposal uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(''retail_provisional_review'',0));
 select * into r from public.retail_provisional_rows where id=p_row for update;
 if not found or not public.retail_provisional_allowed(p_actor,r.source_state) then raise exception using errcode=''42501'',message=''State review access required''; end if;
 if exists(select 1 from public.retail_provisional_files where id=r.batch_id and withdrawn_at is not null) then raise exception ''Source version withdrawn''; end if;
 if p_revision is distinct from r.revision then raise exception using errcode=''40001'',message=''Review changed; reload''; end if;
 if jsonb_typeof(p_changes) is distinct from ''object'' or
 (select count(*) from jsonb_object_keys(p_changes))<>5 or not(p_changes ?& array[''store_name'',''state'',''city'',''operating_status'',''duplicate_of''])
 or coalesce(jsonb_typeof(p_changes->''store_name''),'''')<>''string'' or coalesce(length(btrim(p_changes->>''store_name'')),0) not between 1 and 500
 or coalesce(p_changes->>''state'','''') not in (''TN'',''PY'',''KA'',''KL'',''TG'',''AP-1'',''AP-2'')
 or not public.retail_provisional_allowed(p_actor,p_changes->>''state'')
 or coalesce(jsonb_typeof(p_changes->''city''),'''')<>''string'' or length(p_changes->>''city'')>500
 or coalesce(p_changes->>''operating_status'','''') not in (''UNKNOWN'',''Active'',''Inactive'',''Closed'')
 or coalesce(length(btrim(p_reason)),0) not between 3 and 2000
 then raise exception ''Complete proposed identity, allowed geography, status and reason required''; end if;
 if p_changes->>''duplicate_of'' is not null and not exists(select 1 from public.reliance_retail_store_master where id=(p_changes->>''duplicate_of'')::uuid) then raise exception ''Duplicate mapping must reference an existing canonical store''; end if;
 insert into public.retail_provisional_proposals(row_id,revision,changes,reason,proposed_by) values(p_row,p_revision,p_changes,p_reason,p_actor) returning id into proposal;
 insert into public.retail_provisional_events(batch_id,actor_id,action,details) values(r.batch_id,p_actor,''PROPOSE'',jsonb_build_object(''proposal_id'',proposal,''row_id'',r.id,''before'',r.review,''after'',p_changes,''reason'',p_reason));
 return proposal;
end; $$;

create function public.rpc_retail_provisional_decide(p_actor uuid,p_proposal uuid,p_approve boolean,p_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.retail_provisional_proposals%rowtype; r public.retail_provisional_rows%rowtype;
begin
 if not public.retail_provisional_admin(p_actor) then raise exception using errcode=''42501'',message=''Active Admin approval required''; end if;
 if p_approve is null or coalesce(length(btrim(p_reason)),0) not between 3 and 2000 then raise exception ''Decision and evidence reference required''; end if;
 perform pg_advisory_xact_lock(hashtextextended(''retail_provisional_review'',0));
 select * into p from public.retail_provisional_proposals where id=p_proposal for update;
 if not found or p.status<>''PENDING'' then raise exception ''Proposal already decided or missing''; end if;
 if p.proposed_by=p_actor then raise exception using errcode=''42501'',message=''A different Admin must review this proposal''; end if;
 select * into r from public.retail_provisional_rows where id=p.row_id for update;
 if r.revision<>p.revision then raise exception using errcode=''40001'',message=''Review changed; propose again''; end if;
 if exists(select 1 from public.retail_provisional_files where id=r.batch_id and withdrawn_at is not null) then raise exception ''Source version withdrawn''; end if;
 if p_approve then
  if p.changes->>''operating_status''=''UNKNOWN'' then raise exception ''Verify operating status before approval''; end if;
  if p.changes->>''duplicate_of'' is not null and not exists(select 1 from public.reliance_retail_store_master where id=(p.changes->>''duplicate_of'')::uuid) then raise exception ''Canonical mapping no longer exists''; end if;
  update public.retail_provisional_rows set review=p.changes,revision=revision+1,verification_status=''VERIFIED'' where id=r.id;
 end if;
 update public.retail_provisional_proposals set status=case when p_approve then ''APPROVED'' else ''REJECTED'' end,decided_by=p_actor,decided_at=now(),decision_reason=p_reason where id=p.id;
 insert into public.retail_provisional_events(batch_id,actor_id,action,details) values(r.batch_id,p_actor,case when p_approve then ''APPROVE_STAGING'' else ''REJECT'' end,jsonb_build_object(''proposal_id'',p.id,''row_id'',r.id,''before'',r.review,''after'',p.changes,''reason'',p_reason));
 return p.id;
end; $$;

create function public.rpc_retail_provisional_withdraw(p_actor uuid,p_batch uuid,p_reason text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if not public.retail_provisional_admin(p_actor) then raise exception using errcode=''42501'',message=''Active Admin required''; end if;
 if coalesce(length(btrim(p_reason)),0) not between 3 and 2000 then raise exception ''Withdrawal reason required''; end if;
 perform pg_advisory_xact_lock(hashtextextended(''retail_provisional_review'',0));
 update public.retail_provisional_files set withdrawn_at=now(),withdrawal_reason=p_reason where id=p_batch and withdrawn_at is null;
 if not found then raise exception ''Source missing or already withdrawn''; end if;
 insert into public.retail_provisional_events(batch_id,actor_id,action,details) values(p_batch,p_actor,''WITHDRAW'',jsonb_build_object(''reason'',p_reason));
 return p_batch;
end; $$;

create function public.rpc_retail_provisional_review(p_actor uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare rows jsonb; files jsonb; proposals jsonb; events jsonb; canonical jsonb;
begin
 if not public.retail_provisional_allowed(p_actor,null) then raise exception using errcode=''42501'',message=''Authorized state review access required''; end if;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.version desc),''[]'') into files from (
 select f.id,f.version,f.filename,f.sha256,f.created_at,f.withdrawn_at,f.withdrawal_reason from public.retail_provisional_files f
 where public.retail_provisional_admin(p_actor) or exists(select 1 from public.retail_provisional_rows r where r.batch_id=f.id and public.retail_provisional_allowed(p_actor,r.source_state))) x;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.source_state,x.store_code,x.source_row),''[]'') into rows from (
 select r.*,f.sha256,f.filename,f.version,f.withdrawn_at,
 (select count(*) from public.retail_provisional_rows d where d.batch_id=r.batch_id and d.store_code=r.store_code) as duplicate_count,
 (select coalesce(jsonb_agg(jsonb_build_object(''id'',c.id,''store_code'',c.store_code,''store_name'',c.store_name,''state'',c.state)),''[]'') from public.reliance_retail_store_master c where upper(btrim(c.store_code))=r.store_code) as canonical_matches,
 exists(select 1 from public.retail_provisional_rows d join public.retail_provisional_files df on df.id=d.batch_id where d.batch_id<>r.batch_id and df.withdrawn_at is null and d.store_code=r.store_code) as other_version_match
 from public.retail_provisional_rows r join public.retail_provisional_files f on f.id=r.batch_id where public.retail_provisional_allowed(p_actor,r.source_state)) x;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc),''[]'') into proposals from public.retail_provisional_proposals p join public.retail_provisional_rows r on r.id=p.row_id where public.retail_provisional_allowed(p_actor,r.source_state);
 -- Restrict events to visible rows; batch events contain no other states'' row data.
 select coalesce(jsonb_agg(to_jsonb(e) order by e.id),''[]'') into events from public.retail_provisional_events e where
 (e.details ? ''row_id'' and exists(select 1 from public.retail_provisional_rows r where r.id=(e.details->>''row_id'')::uuid and public.retail_provisional_allowed(p_actor,r.source_state)))
 or (not(e.details ? ''row_id'') and public.retail_provisional_admin(p_actor));
 select coalesce(jsonb_agg(jsonb_build_object(''id'',c.id,''store_code'',c.store_code,''store_name'',c.store_name,''state'',c.state) order by c.store_code),''[]'') into canonical from public.reliance_retail_store_master c where public.retail_provisional_allowed(p_actor,c.state);
 return jsonb_build_object(''admin'',public.retail_provisional_admin(p_actor),''files'',files,''rows'',rows,''proposals'',proposals,''events'',events,''canonical'',canonical);
end; $$;

-- Only the trusted backend can execute RPCs; clients cannot supply their own actor.
-- Even service_role has no table writes or access-registry administration.
do $$ declare t text; f regprocedure; begin
 foreach t in array array[''retail_provisional_access'',''retail_provisional_files'',''retail_provisional_rows'',''retail_provisional_proposals'',''retail_provisional_events''] loop
  execute format(''alter table public.%I enable row level security'',t);
  execute format(''revoke all on public.%I from public,anon,authenticated,service_role'',t);
 end loop;
 for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=''public'' and (p.proname like ''rpc_retail_provisional_%'' or p.proname in (''retail_provisional_admin'',''retail_provisional_allowed'',''retail_provisional_immutable'')) loop
  execute format(''revoke all on function %s from public,anon,authenticated,service_role'',f);
  if f::text like ''%rpc_retail_provisional_%'' then execute format(''grant execute on function %s to service_role'',f); end if;
 end loop;
end; $$;
commit;
']);
commit;
