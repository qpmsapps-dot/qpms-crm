-- REVIEWED PROPOSAL ONLY. No production execution without separate approval.
-- Preserve installed auth helpers, global writer lock, row triggers, credits,
-- immutable evidence, all-date employee correction semantics and atomic commit.
begin;
set local lock_timeout='2s';
do $$begin
  if to_regprocedure('public.retail_mis_allowed(uuid,text,text,boolean)') is null
    or to_regprocedure('public.retail_mis_unique_store(uuid)') is null
    or to_regprocedure('public.rpc_retail_mis_attendance_commit(uuid,uuid,boolean,text,text)') is null
    or to_regprocedure('public.rpc_commit_retail_attendance_upload(uuid,uuid,boolean,text,text)') is null then
    raise exception 'Installed Retail attendance and MIS contracts are required; do not rerun foundational migrations';
  end if;
end;$$;

-- A single JSON row avoids PostgREST's default 1,000-result-row truncation.
-- Existing set-returning RPC remains unchanged for other callers.
create or replace function public.rpc_retail_attendance_conflict_snapshot(p_rows jsonb)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with keys as materialized (
    select distinct employee_code,attendance_date
    from jsonb_to_recordset(p_rows) as r(employee_code text,attendance_date date)
  ), matches as materialized (
    select a.id,a.employee_code,a.attendance_date,a.retail_store_id,a.class,a.credit
    from public.retail_employee_daily_attendance a join keys k using(employee_code,attendance_date)
    where a.superseded_at is null order by a.id::text limit 100001
  ) select jsonb_build_object('count',count(*),'records',coalesce(jsonb_agg(m order by m.id::text),'[]'::jsonb)) from matches m;
$$;
revoke all on function public.rpc_retail_attendance_conflict_snapshot(jsonb) from public,anon,authenticated;
grant execute on function public.rpc_retail_attendance_conflict_snapshot(jsonb) to service_role;

create or replace function public.rpc_retail_mis_attendance_commit(
  p_batch uuid,p_actor uuid,p_replace boolean default false,p_reason text default null,p_preview_key text default null
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.retail_attendance_uploads%rowtype; current_ids uuid[]; p public.profiles%rowtype;
begin
  select * into p from public.profiles where id=p_actor;
  if not found or p.is_active is not true or not (public.retail_mis_allowed(p_actor,'attendance-hk',null,true)
    or public.retail_mis_allowed(p_actor,'attendance-mepc',null,true)) then
    raise exception using errcode='42501',message='Administrative upload authorization required';
  end if;
  -- Same lock as every existing attendance writer/trigger; fail fast rather
  -- than accumulating requests that outlive the browser's deadline.
  if not pg_try_advisory_xact_lock(hashtextextended('retail_uploaded_attendance',0)) then
    raise exception using errcode='55P03',message='Another attendance writer is active. Check batch status before retrying.';
  end if;
  select * into b from public.retail_attendance_uploads where id=p_batch for update nowait;
  if not found or b.uploaded_by<>p_actor then raise exception using errcode='42501',message='Upload owner mismatch';end if;
  if b.kind<>'attendance' then raise exception using errcode='42501',message='Attendance upload required';end if;

  -- Same canonical-code uniqueness and role/class/state predicates as installed.
  -- Group normalized Store Master codes once; evaluate the existing authorization
  -- helper once per distinct state/class, not once per employee row.
  if exists(
    with rows as materialized (
      select distinct * from jsonb_to_recordset(b.payload) as r(retail_store_id uuid,store_code text,class text)
    ), canonical_codes as materialized (
      select upper(btrim(store_code)) code,count(*) n from public.reliance_retail_store_master group by upper(btrim(store_code))
    ), scopes as materialized (
      select distinct s.state,r.class from rows r left join public.reliance_retail_store_master s on s.id=r.retail_store_id
    ), permissions as materialized (
      select state,class,public.retail_mis_allowed(p_actor,case when class='HK' then 'attendance-hk' when class='MEPC' then 'attendance-mepc' else '' end,state,true) allowed from scopes
    ) select 1 from rows r left join public.reliance_retail_store_master s on s.id=r.retail_store_id
      left join canonical_codes c on c.code=upper(btrim(s.store_code))
      left join permissions a on a.state=s.state and a.class=r.class
    where s.id is null or nullif(btrim(s.store_code),'') is null or c.n is distinct from 1::bigint
      or upper(btrim(r.store_code)) is distinct from upper(btrim(s.store_code)) or a.allowed is not true
  ) then raise exception using errcode='42501',message='Entire attendance upload must remain within assigned class/state';end if;

  with keys as materialized (
    select distinct employee_code,attendance_date from jsonb_to_recordset(b.payload) as r(employee_code text,attendance_date date)
  ) select coalesce(array_agg(x.id order by x.id::text),'{}'::uuid[]) into current_ids
    from public.retail_employee_daily_attendance x join keys k using(employee_code,attendance_date) where x.superseded_at is null;
  if exists(
    with scopes as materialized (
      select distinct x.class,s.state from public.retail_employee_daily_attendance x
      join unnest(current_ids) ids(id) on ids.id=x.id
      left join public.reliance_retail_store_master s on s.id=x.retail_store_id
    ) select 1 from scopes where state is null or not public.retail_mis_allowed(p_actor,case when class='HK' then 'attendance-hk' else 'attendance-mepc' end,state,true)
  ) then raise exception using errcode='42501',message='Cross-scope employee/day correction denied';end if;
  if b.status='committed' then return b.id;end if;
  if p_preview_key is distinct from b.validation_summary->>'preview_key' then raise exception using errcode='40001',message='Preview changed; review it again';end if;
  if b.valid_rows=0 or b.valid_rows<>jsonb_array_length(b.payload) then raise exception 'Resolve upload validation errors first';end if;
  if to_jsonb(current_ids)<>b.expected_ids then raise exception using errcode='40001',message='Data changed since preview; upload again for a new complete preview';end if;
  if cardinality(current_ids)>0 and (not p_replace or nullif(btrim(p_reason),'') is null) then raise exception 'Explicit correction confirmation and reason required';end if;

  -- UUID predicate retains the primary-key index. Existing row triggers still run
  -- for every change, including employee-day cap and evidence immutability checks.
  update public.retail_employee_daily_attendance a set superseded_at=now(),superseded_by_batch=b.id
    from unnest(current_ids) ids(id) where a.id=ids.id;
  insert into public.retail_employee_daily_attendance(attendance_date,employee_code,employee_name,retail_store_id,store_code_snapshot,class,original_status,credit,batch_id,source_row)
    select r.attendance_date,r.employee_code,r.employee_name,r.retail_store_id,r.store_code,r.class,r.original_status,r.credit,b.id,r.source_row
    from jsonb_to_recordset(b.payload) as r(attendance_date date,employee_code text,employee_name text,retail_store_id uuid,store_code text,class text,original_status text,credit numeric,source_row integer);
  update public.retail_attendance_uploads set status='committed',committed_at=now(),correction_reason=nullif(btrim(p_reason),'') where id=b.id;
  return b.id;
end;$$;
revoke all on function public.rpc_retail_mis_attendance_commit(uuid,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.rpc_retail_mis_attendance_commit(uuid,uuid,boolean,text,text) to service_role;

-- Owner-scoped, read-only recovery of an ambiguous HTTP outcome. A preview row
-- does not prove rollback while a transaction remains active. Report global
-- writer activity conservatively; it need not be this particular batch.
create or replace function public.rpc_retail_mis_attendance_status(p_batch uuid,p_actor uuid,p_preview_key text)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare b public.retail_attendance_uploads%rowtype; lock_key bigint:=hashtextextended('retail_uploaded_attendance',0); busy boolean;
begin
  if not (public.retail_mis_allowed(p_actor,'attendance-hk',null,true) or public.retail_mis_allowed(p_actor,'attendance-mepc',null,true)) then
    raise exception using errcode='42501',message='Attendance authorization required';end if;
  select * into b from public.retail_attendance_uploads where id=p_batch;
  if not found or b.uploaded_by<>p_actor or b.kind<>'attendance' then raise exception using errcode='42501',message='Upload owner mismatch';end if;
  if p_preview_key is distinct from b.validation_summary->>'preview_key' then raise exception using errcode='40001',message='Preview changed; review it again';end if;
  if exists(
    with scopes as materialized (
      select distinct r.class,s.state from jsonb_to_recordset(b.payload) as r(retail_store_id uuid,class text)
      left join public.reliance_retail_store_master s on s.id=r.retail_store_id
    ) select 1 from scopes where state is null or not public.retail_mis_allowed(p_actor,case when class='HK' then 'attendance-hk' when class='MEPC' then 'attendance-mepc' else '' end,state,true)
  ) then raise exception using errcode='42501',message='Batch is outside current attendance scope';end if;
  select exists(select 1 from pg_locks where locktype='advisory' and granted and database=(select oid from pg_database where datname=current_database())
    and classid=((lock_key>>32)&4294967295)::oid and objid=(lock_key&4294967295)::oid and objsubid=1) into busy;
  return jsonb_build_object('id',b.id,'status',b.status,'writer_busy',busy,'valid_rows',b.valid_rows,'committed_at',b.committed_at,
    'date_from',b.date_from,'date_to',b.date_to,'correction_reason',b.correction_reason);
end;$$;
revoke all on function public.rpc_retail_mis_attendance_status(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.rpc_retail_mis_attendance_status(uuid,uuid,text) to service_role;
commit;
