-- PROPOSAL. Install/activate separately. Reuses 239 ledgers and 240 executor.
begin;
do $$begin
 if to_regprocedure('public.fo_reconcile_km_239_core(uuid,jsonb,text,uuid,uuid)') is null
 or to_regprocedure('public.rpc_reconcile_fo_scoped_km_v1(uuid,jsonb,uuid,text)') is null then
 raise exception 'km241_installed240_required';end if;
end $$;

do $$declare f record;begin for f in select * from (values ('public.fo_enqueue_km_reconciliation()','cecefa22aaf51f0911c491ff67ff6969'),('public.fo_km_scope_ledger_guard()','9f6b67e1aa7d6d1a058244f8b6bc9489'),('public.fo_km_scope_financial_guard()','71eab5169a6fcd7a226d4a72aa2c1875'),('public.fo_reconcile_km_239_core(uuid,jsonb,text,uuid,uuid)','1276ba9bd13168d01a47500583f0bd58')) expected(signature,digest) loop
 if (select md5(replace(prosrc,E'\r','')) from pg_proc where oid=to_regprocedure(f.signature)) is distinct from f.digest then raise exception 'km241_dependency_drift: %',f.signature;end if;end loop;end $$;
create table public.fo_km_canonical_policy (
 policy_key text primary key check(policy_key='canonical_incremental_v1'),
 enabled boolean not null default false, admin_enabled boolean not null default false,
 worker_enabled boolean not null default false, starts_at timestamptz, expires_at timestamptz,
 date_from date, date_to date, maximum_attendance_km numeric not null default 0,
 maximum_attendance_amount numeric not null default 0,
 check(not enabled or (starts_at is not null and expires_at is not null and expires_at>starts_at and expires_at<=starts_at+interval '30 days'
 and date_from is not null and date_to is not null and date_to>=date_from and maximum_attendance_km>0 and maximum_attendance_km<'Infinity'::numeric
 and maximum_attendance_amount>0 and maximum_attendance_amount<'Infinity'::numeric))
);
insert into public.fo_km_canonical_policy(policy_key) values('canonical_incremental_v1');
-- Only attendance/GPS triggers create this provenance. A queue row or GUC is not authority.
create table public.fo_km_job_provenance (
 attendance_id uuid primary key references public.fo_attendance(id), generation integer not null,
 trigger_source text not null check(trigger_source in('manual_end_day','auto_end_day','late_gps')),
 source_table text not null check(source_table in('fo_attendance','fo_location_logs')),
 source_id uuid not null, created_at timestamptz not null default clock_timestamp()
);
create table public.fo_km_policy_executions (
 id uuid primary key default gen_random_uuid(), attendance_id uuid not null references public.fo_attendance(id),
 transaction_id bigint not null default txid_current(), trigger_source text not null,
 admin_id uuid, lease uuid, input_digest text not null, calculation jsonb not null,
 receipt_id uuid references public.fo_km_incremental_credits(id), result jsonb,
 created_at timestamptz not null default clock_timestamp(), unique(transaction_id,attendance_id)
);
create table public.fo_km_policy_audit (
 id uuid primary key default gen_random_uuid(), event text not null, detail jsonb not null,
 transaction_id bigint not null default txid_current(), created_at timestamptz not null default clock_timestamp()
);
alter table public.fo_km_canonical_policy enable row level security;
alter table public.fo_km_job_provenance enable row level security;
alter table public.fo_km_policy_executions enable row level security;
alter table public.fo_km_policy_audit enable row level security;
revoke all on public.fo_km_canonical_policy,public.fo_km_job_provenance,public.fo_km_policy_executions,public.fo_km_policy_audit from public,anon,authenticated,service_role;

create function public.fo_km_require_canonical_policy(p_source text) returns public.fo_km_canonical_policy
language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.fo_km_canonical_policy%rowtype;
begin
 -- The existing database emergency control is unconditional, including when the global gate is open.
 perform 1 from public.fo_km_scope_control where control_key='admin_acceptance'
 and not emergency_pause and release_until>clock_timestamp() for share;
 if not found then raise exception 'km_policy_emergency_pause' using errcode='55000';end if;
 select * into p from public.fo_km_canonical_policy where policy_key='canonical_incremental_v1' for share;
 if not found or not p.enabled or p.starts_at is null or p.expires_at is null or p.date_from is null or p.date_to is null or clock_timestamp()<p.starts_at or clock_timestamp()>=p.expires_at
 or (p_source='admin_recalculation' and not p.admin_enabled)
 or (p_source in('manual_end_day','auto_end_day','late_gps') and not p.worker_enabled)
 or p_source not in('admin_recalculation','manual_end_day','auto_end_day','late_gps') or p_source is null
 then raise exception 'km_canonical_policy_inactive' using errcode='55000';end if;
 return p;
end $$;

create function public.rpc_claim_fo_policy_km_v1() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.fo_km_reconciliation_jobs%rowtype; p public.fo_km_canonical_policy%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'km_service_required' using errcode='42501';end if;
 p:=public.fo_km_require_canonical_policy('manual_end_day');
 select q.* into j from public.fo_km_reconciliation_jobs q join public.fo_km_job_provenance v using(attendance_id)
 join public.fo_attendance a on a.id=q.attendance_id
 where v.generation=q.generation and v.trigger_source=q.trigger_source and a.attendance_date between p.date_from and p.date_to
 and q.attempts<8 and q.not_before<=now() and (q.state in('pending','deferred') or (q.state='processing' and q.lease_until<now()))
 order by q.not_before for update of q skip locked limit 1;
 if not found then return null;end if;
 update public.fo_km_reconciliation_jobs set state='processing',lease=gen_random_uuid(),lease_until=now()+interval '3 minutes',claimed_generation=generation,attempts=attempts+1 where attendance_id=j.attendance_id returning * into j;
 return to_jsonb(j);
end $$;

create function public.rpc_reconcile_fo_policy_km_v1(p_attendance_id uuid,p_calculation jsonb,p_trigger text,p_admin uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.fo_km_canonical_policy%rowtype; a public.fo_attendance%rowtype; e uuid; r jsonb; actor public.profiles%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'km_service_required' using errcode='42501';end if;
 p:=public.fo_km_require_canonical_policy(p_trigger);
 perform pg_advisory_xact_lock(hashtextextended(p_attendance_id::text,0));
 select * into strict a from public.fo_attendance where id=p_attendance_id for update;
 if a.attendance_date not between p.date_from and p.date_to then raise exception 'km_policy_date_denied' using errcode='42501';end if;
 if p_trigger='admin_recalculation' then
   if p_lease is not null then raise exception 'km_policy_actor_invalid' using errcode='42501';end if;
   actor:=public.fo_october_recovery_actor(p_admin);
   if upper(actor.employee_code)=upper(a.employee_code) then raise exception 'km_self_approval_forbidden' using errcode='42501';end if;
 else
   if p_admin is not null or not exists(select 1 from public.fo_km_reconciliation_jobs q join public.fo_km_job_provenance v using(attendance_id)
    where q.attendance_id=a.id and q.state='processing' and q.lease=p_lease and q.lease_until>clock_timestamp()
    and q.claimed_generation=q.generation and v.generation=q.generation and v.trigger_source=q.trigger_source and q.trigger_source=p_trigger)
   then raise exception 'km_policy_verified_lease_required' using errcode='42501';end if;
   -- Pin the claimed generation through the entire posting transaction.
   perform 1 from public.fo_km_reconciliation_jobs where attendance_id=a.id for update;
   if not exists(select 1 from public.fo_km_reconciliation_jobs q join public.fo_km_job_provenance v using(attendance_id)
    where q.attendance_id=a.id and q.lease=p_lease and q.lease_until>clock_timestamp() and q.state='processing'
    and q.generation=q.claimed_generation and v.generation=q.generation and q.trigger_source=p_trigger and v.trigger_source=p_trigger)
   then raise exception 'km_policy_verified_lease_required' using errcode='42501';end if;
 end if;
 insert into public.fo_km_policy_executions(attendance_id,trigger_source,admin_id,lease,input_digest,calculation)
 values(a.id,p_trigger,p_admin,p_lease,p_calculation->>'inputDigest',p_calculation) returning id into e;
 r:=public.fo_reconcile_km_239_core(a.id,p_calculation,p_trigger,p_admin,p_lease);
 if (select coalesce(sum(added_km),0) from public.fo_km_incremental_credits where attendance_id=a.id)>p.maximum_attendance_km
 or (select coalesce(sum(amount),0) from public.fo_km_incremental_credits where attendance_id=a.id)>p.maximum_attendance_amount
 then raise exception 'km_policy_limit_exceeded' using errcode='22023';end if;
 perform public.fo_km_require_canonical_policy(p_trigger);
 update public.fo_km_policy_executions set receipt_id=(r->>'receipt_id')::uuid,result=r where id=e;
 insert into public.fo_km_policy_audit(event,detail) values('reconciled',jsonb_build_object('execution',e,'attendance_id',a.id,'result',r));
 return r;
end $$;

create function public.fo_km_policy_credit_allowed(p_attendance uuid,p_digest text,p_source text,p_actor uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.fo_km_policy_executions e where e.attendance_id=p_attendance and e.input_digest=p_digest
 and e.transaction_id=txid_current() and e.receipt_id is null and e.trigger_source=p_source and e.admin_id is not distinct from p_actor)
$$;
create function public.fo_km_policy_control_audit() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 insert into public.fo_km_policy_audit(event,detail) values('policy:'||tg_op,jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(new)));
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger km_canonical_policy_audit after update or delete on public.fo_km_canonical_policy for each row execute function public.fo_km_policy_control_audit();

-- Replacements of existing trigger functions follow below. They preserve the
-- installed 240 checks and add only private, transaction-bound policy executions.

create or replace function public.fo_enqueue_km_reconciliation() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.fo_attendance%rowtype; reason text;
begin
 if tg_table_name='fo_attendance' then
   if new.logout_time is null or (tg_op='UPDATE' and old.logout_time is not null) then return new;end if;
   a:=new;reason:=case when coalesce(new.metadata->>'auto_ended','false')='true' then 'auto_end_day' else 'manual_end_day' end;
 else
   -- Bounded late-sync follow-up, using original capture time and exact ownership.
   if new.captured_at is null then return new;end if;
   if new.attendance_id is null then
     if (select count(*) from public.fo_attendance x where x.logout_time is not null
       and x.employee_code=coalesce(new.employee_code,new.fo_user_id::text)
       and new.captured_at>=x.login_time and new.captured_at<=x.logout_time)<>1 then return new;end if;
     select * into a from public.fo_attendance x where x.logout_time is not null
       and x.employee_code=coalesce(new.employee_code,new.fo_user_id::text)
       and new.captured_at>=x.login_time and new.captured_at<=x.logout_time;
   else select * into a from public.fo_attendance where id=new.attendance_id;end if;
   if a.id is null or a.logout_time is null or new.captured_at<a.login_time
      or new.captured_at>a.logout_time or now()>a.logout_time+interval '7 days'
      or (new.employee_code is not null and new.employee_code<>a.employee_code) then return new;end if;
   reason:='late_gps';
 end if;
 insert into public.fo_km_reconciliation_jobs(attendance_id,trigger_source,not_before)
 values(a.id,reason,now()+interval '30 seconds') on conflict(attendance_id) do update
 set generation=fo_km_reconciliation_jobs.generation+1,state=case when fo_km_reconciliation_jobs.state='processing' then 'processing' else 'pending' end,
 trigger_source=excluded.trigger_source,attempts=0,not_before=excluded.not_before,updated_at=now();
 insert into public.fo_km_job_provenance(attendance_id,generation,trigger_source,source_table,source_id)
 select a.id,j.generation,reason,tg_table_name,new.id from public.fo_km_reconciliation_jobs j where j.attendance_id=a.id
 on conflict(attendance_id) do update set generation=excluded.generation,trigger_source=excluded.trigger_source,source_table=excluded.source_table,source_id=excluded.source_id,created_at=clock_timestamp();
 return new;
end $$;

create or replace function public.fo_km_scope_ledger_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if public.fo_km_policy_credit_allowed(new.attendance_id,new.input_digest,new.trigger_source,new.actor) then
   perform public.fo_km_require_canonical_policy(new.trigger_source);return new;
 end if;
 if exists(select 1 from public.fo_km_financial_control where control_key='canonical_v2' and financial_writes_enabled) then return new;end if;
 if not exists(select 1 from public.fo_km_scope_executions e join public.fo_km_scope_authorizations s using(reference) join public.fo_km_scope_control c on c.control_key='admin_acceptance'
 where e.transaction_id=txid_current() and e.receipt_id is null and e.attendance_id=new.attendance_id and e.admin_auth_user_id=new.actor and e.input_digest=new.input_digest
 and s.revoked_at is null and clock_timestamp()>=s.starts_at and clock_timestamp()<s.expires_at and not c.emergency_pause and clock_timestamp()<c.release_until and new.trigger_source='admin_recalculation') then raise exception 'km_scope_ledger_denied' using errcode='42501';end if;
 return new;
end $$;

create or replace function public.fo_km_scope_financial_guard() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if tg_op='UPDATE' and exists(select 1 from public.fo_km_policy_executions e join public.fo_km_incremental_credits c
 on c.attendance_id=e.attendance_id and c.input_digest=e.input_digest and c.transaction_id=e.transaction_id
 where e.transaction_id=txid_current() and e.receipt_id is null and e.attendance_id=new.id and c.applied_to_attendance
 and c.evidence->'canonical_after'=jsonb_build_object('total_approved_km',new.total_approved_km,'eligible_km',new.eligible_km,'total_route_km',new.total_route_km,'petrol_amount',new.petrol_amount)) then
   perform public.fo_km_require_canonical_policy((select trigger_source from public.fo_km_policy_executions where attendance_id=new.id and transaction_id=txid_current()));return new;
 end if;
 if exists(select 1 from public.fo_km_financial_control where control_key='canonical_v2' and financial_writes_enabled) then return new;end if;
 if tg_op='INSERT' then
   if coalesce(new.total_approved_km,0)=0 and coalesce(new.eligible_km,0)=0 and coalesce(new.total_route_km,0)=0 and coalesce(new.petrol_amount,0)=0 then return new;end if;
 else
   if (new.total_approved_km,new.eligible_km,new.total_route_km,new.petrol_amount) is not distinct from (old.total_approved_km,old.eligible_km,old.total_route_km,old.petrol_amount) then return new;end if;
   if exists(select 1 from public.fo_km_scope_executions e join public.fo_km_incremental_credits c on c.attendance_id=e.attendance_id and c.input_digest=e.input_digest and c.transaction_id=e.transaction_id
    where e.transaction_id=txid_current() and e.receipt_id is null and e.attendance_id=new.id and c.applied_to_attendance and c.evidence->'canonical_after'=jsonb_build_object('total_approved_km',new.total_approved_km,'eligible_km',new.eligible_km,'total_route_km',new.total_route_km,'petrol_amount',new.petrol_amount)) then return new;end if;
 end if;
 raise exception 'km_scope_unrelated_financial_write_denied' using errcode='42501';
end $$;
revoke all on function public.fo_km_require_canonical_policy(text),public.rpc_claim_fo_policy_km_v1(),public.rpc_reconcile_fo_policy_km_v1(uuid,jsonb,text,uuid,uuid),public.fo_km_policy_credit_allowed(uuid,text,text,uuid),public.fo_km_policy_control_audit() from public,anon,authenticated,service_role;
grant execute on function public.rpc_claim_fo_policy_km_v1(),public.rpc_reconcile_fo_policy_km_v1(uuid,jsonb,text,uuid,uuid) to service_role;
commit;
