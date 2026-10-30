-- NEW PROPOSAL ONLY. Explicit production authorization required; do not rerun
-- installed Unified migrations. No source, canonical or ownership rows are seeded.
begin;
-- Enforce a defined group on future writes without rewriting legacy mappings.
alter table public.reliance_retail_zones add constraint retail_zones_defined_state check(state is not null and state in ('TN','PY','KA','KL','TG','AP-1','AP-2')) not valid;
create table public.retail_zone_mapping_drafts(
 id uuid primary key default gen_random_uuid(),row_id uuid not null references public.retail_provisional_rows(id) on delete restrict,
 row_revision integer not null,row_digest text not null,state text not null check(state in ('TN','PY','KA','KL','TG','AP-1','AP-2')),
 zone_id uuid references public.reliance_retail_zones(id) on delete restrict,effective_from text not null,effective_to timestamptz,
 reason text not null,proposed_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 status text not null default 'DRAFT_PENDING_IDENTITY' check(status='DRAFT_PENDING_IDENTITY'),fingerprint text not null unique
);
alter table public.retail_zone_mapping_drafts enable row level security;
revoke all on public.retail_zone_mapping_drafts from public,anon,authenticated,service_role;
create function public.retail_zone_draft_immutable() returns trigger language plpgsql set search_path=pg_catalog,public as $$begin raise exception 'Zone mapping drafts are immutable source-bound evidence';end;$$;
create trigger retail_zone_draft_immutable before update or delete on public.retail_zone_mapping_drafts for each row execute function public.retail_zone_draft_immutable();
create function public.rpc_retail_zone_draft_save(p_actor uuid,p_row uuid,p_revision integer,p_zone uuid,p_effective_from text,p_effective_to timestamptz,p_reason text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.retail_provisional_rows%rowtype; d public.retail_zone_mapping_drafts%rowtype; start_at timestamptz; digest text;
begin
 perform pg_advisory_xact_lock(hashtextextended('retail_unified_ownership',0));
 select * into r from public.retail_provisional_rows where id=p_row;
 if not found or not public.retail_unified_access(p_actor,r.source_state,'edit') then raise exception using errcode='42501',message='Retained source and state editor required';end if;
 if r.revision is distinct from p_revision or exists(select 1 from public.retail_provisional_files where id=r.batch_id and withdrawn_at is not null) then raise exception using errcode='40001',message='Source revision changed or withdrawn';end if;
 if exists(select 1 from public.reliance_retail_store_master where upper(btrim(store_code))=upper(btrim(r.store_code))) then raise exception 'Canonical match must use verified Store mapping proposals';end if;
 if p_zone is not null and not exists(select 1 from public.reliance_retail_zones where id=p_zone and state=r.source_state and status='Active') then raise exception 'Active same-geography zone required';end if;
 if coalesce(length(btrim(p_reason)),0) not between 3 and 2000 then raise exception 'Evidence reason required';end if;
 start_at:=case when p_effective_from='ON_ACTIVATION' then now() else p_effective_from::timestamptz end;
 if start_at is null or start_at<now()-interval '1 minute' or (p_effective_to is not null and p_effective_to<=start_at) then raise exception 'Current/future nonempty interval required';end if;
 digest:=md5(jsonb_build_array(p_actor,p_row,p_revision,r.row_digest,p_zone,p_effective_from,p_effective_to,p_reason)::text);
 select * into d from public.retail_zone_mapping_drafts where fingerprint=digest;
 if found then return jsonb_build_object('id',d.id,'replayed',true,'status',d.status,'operational_writes',0);end if;
 insert into public.retail_zone_mapping_drafts(row_id,row_revision,row_digest,state,zone_id,effective_from,effective_to,reason,proposed_by,fingerprint)
 values(r.id,r.revision,r.row_digest,r.source_state,p_zone,p_effective_from,p_effective_to,p_reason,p_actor,digest) returning * into d;
 insert into public.reliance_retail_management_audit(action,entity_type,entity_id,actor_profile_id,after_state) values('ZONE_MAPPING_DRAFT','provisional_zone_mapping',d.id,p_actor,to_jsonb(d));
 return jsonb_build_object('id',d.id,'replayed',false,'status',d.status,'operational_writes',0);
end;$$;
create function public.rpc_retail_zone_drafts(p_actor uuid) returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('source_current',r.revision=d.row_revision and f.withdrawn_at is null,'canonical_now_exists',exists(select 1 from public.reliance_retail_store_master s where upper(btrim(s.store_code))=upper(btrim(r.store_code)))) order by d.created_at),'[]') from public.retail_zone_mapping_drafts d join public.retail_provisional_rows r on r.id=d.row_id join public.retail_provisional_files f on f.id=r.batch_id where public.retail_unified_access(p_actor,d.state,'view');
$$;
revoke all on function public.retail_zone_draft_immutable(),public.rpc_retail_zone_drafts(uuid),public.rpc_retail_zone_draft_save(uuid,uuid,integer,uuid,text,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.rpc_retail_zone_drafts(uuid),public.rpc_retail_zone_draft_save(uuid,uuid,integer,uuid,text,timestamptz,text) to service_role;
commit;
