-- Ordinary End Day authorization for the EXISTING canonical outbox/engine/ledger.
-- Disabled on installation. General financial gate and manual holds stay closed.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if session_user<>'postgres' then raise exception 'owner_required';end if;
 if exists(select 1 from public.fo_km_financial_control where financial_writes_enabled)
 or exists(select 1 from public.fo_km_canonical_policy where enabled or worker_enabled or admin_enabled)
 or exists(select 1 from public.fo_km_attendance_authorizations where revoked_at is null)
 or exists(select 1 from public.fo_km_reconciliation_jobs where lease is not null)
 then raise exception 'km247_install_requires_shutdown';end if;
 if (select md5(replace(prosrc,E'\r','')) from pg_proc where oid='public.fo_km_require_canonical_policy(text)'::regprocedure) is distinct from 'e3f084e2378b19a429420645a76cbcdf'
 or (select md5(replace(prosrc,E'\r','')) from pg_proc where oid='public.fo_reconcile_km_239_core(uuid,jsonb,text,uuid,uuid)'::regprocedure) is distinct from '1276ba9bd13168d01a47500583f0bd58'
 then raise exception 'km247_dependency_drift';end if;
end $$;

create table public.fo_km_automatic_control(
 control_key text primary key check(control_key='canonical_end_day'),
 enabled boolean not null default false,
 effective_from date not null default '2026-10-26',
 maximum_attendance_km numeric not null default 0,
 maximum_attendance_amount numeric not null default 0,
 -- NULL means ordinary eligible jobs; object binds an initial canary by ID/gen/caps.
 canary jsonb,
 canary_expires_at timestamptz,
 reason text not null default 'Installed disabled; explicit operational activation required',
 updated_at timestamptz not null default clock_timestamp(),
 check(canary is null or jsonb_typeof(canary)='object'),
 check((canary is null)=(canary_expires_at is null)),
 check(not enabled or (maximum_attendance_km>0 and maximum_attendance_km<'Infinity'::numeric
 and maximum_attendance_amount>0 and maximum_attendance_amount<'Infinity'::numeric))
);
insert into public.fo_km_automatic_control(control_key) values('canonical_end_day');
alter table public.fo_km_automatic_control enable row level security;
revoke all on public.fo_km_automatic_control from public,anon,authenticated,service_role;
alter table public.fo_km_policy_executions add column automatic boolean not null default false;
create index fo_km_automatic_execution_transaction on public.fo_km_policy_executions(transaction_id) where automatic;
alter table public.fo_km_reconciliation_jobs add column claimed_evidence_digest text;

create function public.fo_km_automatic_control_audit() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare item record;
begin
 if new.canary is not null then
  if new.canary_expires_at<=clock_timestamp() or new.canary_expires_at>clock_timestamp()+interval '15 minutes' then raise exception 'km_automatic_invalid_canary_window';end if;
  for item in select key,value from jsonb_each(new.canary) loop
   if item.key!~'^[0-9a-f-]{36}$' or (item.value->>'generation')::integer is null or (item.value->>'generation')::integer<1
   or (item.value->>'maximum_km')::numeric is null or (item.value->>'maximum_km')::numeric<=0 or (item.value->>'maximum_km')::numeric>new.maximum_attendance_km
   or (item.value->>'maximum_amount')::numeric is null or (item.value->>'maximum_amount')::numeric<=0 or (item.value->>'maximum_amount')::numeric>new.maximum_attendance_amount
   then raise exception 'km_automatic_invalid_canary_limit';end if;
  end loop;
 end if;
 new.updated_at:=clock_timestamp();
 insert into public.fo_km_policy_audit(event,detail) values('automatic_control:'||tg_op,jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(new),'session_user',session_user));
 return new;
end $$;
create trigger km_automatic_control_audit before update on public.fo_km_automatic_control
for each row execute function public.fo_km_automatic_control_audit();

create function public.fo_km_automatic_eligible(a public.fo_attendance) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce(a.employee_code~'^[A-Z0-9_-]+$' and a.logout_time is not null and a.logout_time<=clock_timestamp() and a.attendance_date<=(clock_timestamp() at time zone 'Asia/Kolkata')::date
 and lower(a.status) in('completed','ended','ended day','closed','auto ended','stale auto ended')
 and (select count(*) from public.profiles r where r.employee_code=a.employee_code and r.is_active is true
 and lower(coalesce(r.status,'')) not in('inactive','disabled','deactivated')
 and a.fo_user_id::text in(r.employee_code,r.id::text,coalesce(r.auth_user_id::text,'')))=1
 -- Only zero or wholly receipt-backed baselines; never guess legacy inclusion.
 and a.total_approved_km=(select coalesce(sum(added_km),0) from public.fo_km_incremental_credits where attendance_id=a.id and applied_to_attendance)
 and a.eligible_km=a.total_approved_km and a.total_route_km=a.total_approved_km
 and a.petrol_amount=(select coalesce(sum(amount),0) from public.fo_km_incremental_credits where attendance_id=a.id and applied_to_attendance)
 and not exists(select 1 from public.fo_monthly_travel_settlements s where s.employee_code=a.employee_code and a.attendance_date between s.period_start and s.period_end)
 and not exists(select 1 from public.fo_october_km_recoveries r where r.employee_code=a.employee_code and r.attendance_date=a.attendance_date and r.status='approved')
 and not exists(select 1 from public.fo_travel_reimbursement_corrections r where r.attendance_id=a.id and r.status='applied'),false);
$$;

create function public.fo_km_require_automatic(p_attendance uuid,p_source text,p_lease uuid)
returns public.fo_km_automatic_control language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.fo_km_automatic_control%rowtype;a public.fo_attendance%rowtype;j public.fo_km_reconciliation_jobs%rowtype;
begin
 select * into strict c from public.fo_km_automatic_control where control_key='canonical_end_day' for share;
 if not c.enabled or (c.canary is not null and c.canary_expires_at<=clock_timestamp()) then raise exception 'km_automatic_paused' using errcode='55000';end if;
 perform 1 from public.fo_km_financial_control where control_key='canonical_v2' and not financial_writes_enabled for share;
 if not found then raise exception 'km_automatic_requires_closed_ordinary_gate' using errcode='55000';end if;
 select * into strict a from public.fo_attendance where id=p_attendance;
 select * into strict j from public.fo_km_reconciliation_jobs where attendance_id=a.id;
 if a.attendance_date<c.effective_from or (not public.fo_km_automatic_eligible(a) and not exists(
 select 1 from public.fo_km_policy_executions e where e.attendance_id=a.id and e.transaction_id=txid_current()
 and e.automatic and e.receipt_id is null and e.lease=p_lease and e.trigger_source=p_source))
 or p_source not in('manual_end_day','auto_end_day','late_gps') or p_source is null
 or j.state<>'processing' or j.lease is distinct from p_lease or j.lease_until<=clock_timestamp()
 or j.claimed_generation is distinct from j.generation or j.trigger_source is distinct from p_source
 or not exists(select 1 from public.fo_km_job_provenance v join public.profiles r on r.employee_code=a.employee_code
 where v.attendance_id=a.id and v.generation=j.generation and v.trigger_source=p_source and public.fo_km_attendance_provenance_v246(a,v,r))
 or (c.canary is not null and (not c.canary ? a.id::text or (c.canary->a.id::text->>'generation')::integer is distinct from j.generation))
 then raise exception 'km_automatic_attendance_or_lease_ineligible' using errcode='42501';end if;
 return c;
end $$;

-- Reuse the existing financial and ledger triggers. Only a private, current
-- transaction automatic execution may use the new permission; manual paths
-- still execute the entire original emergency/policy validator unchanged.
do $patch$
declare body text;anchor text:=E'begin\n';prefix text:=E'begin\n if exists(select 1 from public.fo_km_policy_executions e where e.transaction_id=txid_current() and e.automatic and e.receipt_id is null and e.trigger_source=p_source) then\n  perform public.fo_km_require_automatic(e.attendance_id,e.trigger_source,e.lease) from public.fo_km_policy_executions e where e.transaction_id=txid_current() and e.automatic and e.receipt_id is null and e.trigger_source=p_source;\n  select * into p from public.fo_km_canonical_policy where policy_key=''canonical_incremental_v1'';\n  return p;\n end if;\n';
begin
 select replace(pg_get_functiondef('public.fo_km_require_canonical_policy(text)'::regprocedure),E'\r','') into body;
 if strpos(body,anchor)=0 then raise exception 'km247_policy_anchor_missing';end if;
 body:=overlay(body placing prefix from strpos(body,anchor) for length(anchor));execute body;
end $patch$;

create function public.rpc_fo_km_automatic_authorization_version_v1() returns integer
language plpgsql stable security definer set search_path=public,pg_temp as $$begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'km_service_required' using errcode='42501';end if;return 247;
end $$;

create function public.rpc_claim_fo_automatic_km_v1() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.fo_km_automatic_control%rowtype;j public.fo_km_reconciliation_jobs%rowtype;f jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'km_service_required' using errcode='42501';end if;
 select * into strict c from public.fo_km_automatic_control where control_key='canonical_end_day' for share;
 if not c.enabled or (c.canary is not null and c.canary_expires_at<=clock_timestamp()) then return null;end if;
 if exists(select 1 from public.fo_km_financial_control where financial_writes_enabled) then raise exception 'km_automatic_requires_closed_ordinary_gate' using errcode='55000';end if;
 select q.* into j from public.fo_km_reconciliation_jobs q join public.fo_attendance a on a.id=q.attendance_id
 join public.fo_km_job_provenance v on v.attendance_id=a.id
 where a.attendance_date>=c.effective_from and public.fo_km_automatic_eligible(a)
 and v.generation=q.generation and v.trigger_source=q.trigger_source
 and exists(select 1 from public.profiles r where r.employee_code=a.employee_code and public.fo_km_attendance_provenance_v246(a,v,r))
 and (c.canary is null or (c.canary ? a.id::text and (c.canary->a.id::text->>'generation')::integer=q.generation))
 and q.attempts<8 and q.not_before<=clock_timestamp()
 and (q.state in('pending','deferred') or (q.state='processing' and q.lease_until<clock_timestamp()))
 order by q.not_before,q.attendance_id for update of a,q skip locked limit 1;
 if not found then return null;end if;
 f:=public.fo_km_attendance_evidence_v246(j.attendance_id);
 update public.fo_km_reconciliation_jobs set state='processing',lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '3 minutes',
 claimed_generation=generation,claimed_evidence_digest=f->>'evidence_digest',attempts=attempts+1 where attendance_id=j.attendance_id returning * into j;
 perform public.fo_km_require_automatic(j.attendance_id,j.trigger_source,j.lease);
 return to_jsonb(j)||jsonb_build_object('authorization_version',247,'authorization_reference','CANONICAL_END_DAY_AUTOMATION');
end $$;

create function public.rpc_reconcile_fo_automatic_km_v1(p_attendance_id uuid,p_calculation jsonb,p_trigger text,p_admin uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.fo_km_automatic_control%rowtype;j public.fo_km_reconciliation_jobs%rowtype;f jsonb;e uuid;r jsonb;receipt uuid;km numeric;amount numeric;
begin
 if coalesce(auth.role(),'')<>'service_role' or p_admin is not null then raise exception 'km_service_worker_required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_attendance_id::text,0));
 perform 1 from public.fo_attendance where id=p_attendance_id for update;
 select * into strict j from public.fo_km_reconciliation_jobs where attendance_id=p_attendance_id for update;
 -- Brief persistence-only locks serialize against approvals arriving concurrently.
 lock table public.fo_monthly_travel_settlements,public.fo_october_km_recoveries,public.fo_travel_reimbursement_corrections in share mode;
 c:=public.fo_km_require_automatic(p_attendance_id,p_trigger,p_lease);
 if p_calculation->>'calculationVersion' is distinct from 'KM_ENGINE_V2' or p_calculation->>'incrementalRecovery' is distinct from 'true'
 or p_calculation->>'baselineKnown' is distinct from 'true' or coalesce(p_calculation->>'inputDigest','')!~'^[0-9a-f]{64}$'
 or jsonb_typeof(p_calculation->'legs') is distinct from 'array' then raise exception 'km_automatic_verified_plan_required' using errcode='22023';end if;
 select id into receipt from public.fo_km_incremental_credits where attendance_id=p_attendance_id and input_digest=p_calculation->>'inputDigest' order by id limit 1;
 if receipt is not null then return jsonb_build_object('receipt_id',receipt,'additionalKm',0,'additionalAmount',0,'idempotent_replay',true);end if;
 f:=public.fo_km_attendance_evidence_v246(p_attendance_id);
 if j.claimed_evidence_digest is null or f->>'evidence_digest' is distinct from j.claimed_evidence_digest
 or f->>'snapshot' is distinct from p_calculation->>'snapshot' then raise exception 'km_automatic_evidence_changed' using errcode='40001';end if;
 insert into public.fo_km_policy_executions(attendance_id,trigger_source,lease,input_digest,calculation,automatic)
 values(p_attendance_id,p_trigger,p_lease,p_calculation->>'inputDigest',p_calculation,true) returning id into e;
 r:=public.fo_reconcile_km_239_core(p_attendance_id,p_calculation,p_trigger,null,p_lease);
 select coalesce(sum(credit.added_km),0),coalesce(sum(credit.amount),0) into km,amount from public.fo_km_incremental_credits credit where credit.attendance_id=p_attendance_id;
 if km>c.maximum_attendance_km or amount>c.maximum_attendance_amount
 or (c.canary is not null and (km>(c.canary->p_attendance_id::text->>'maximum_km')::numeric or amount>(c.canary->p_attendance_id::text->>'maximum_amount')::numeric))
 then raise exception 'km_automatic_operating_limit' using errcode='22023';end if;
 if exists(select 1 from public.fo_km_incremental_credits where attendance_id=p_attendance_id and transaction_id=txid_current() and not applied_to_attendance)
 then raise exception 'km_automatic_settled_claim_preserved' using errcode='42501';end if;
 if not exists(select 1 from public.fo_attendance a where a.id=p_attendance_id and public.fo_km_automatic_eligible(a))
 then raise exception 'km_automatic_final_baseline_or_conflict_changed' using errcode='40001';end if;
 perform public.fo_km_require_automatic(p_attendance_id,p_trigger,p_lease);
 update public.fo_km_policy_executions set receipt_id=(r->>'receipt_id')::uuid,result=r where id=e;
 insert into public.fo_km_policy_audit(event,detail) values('automatic_reconciled',jsonb_build_object('execution',e,'attendance_id',p_attendance_id,'generation',j.generation,'result',r));
 return r;
end $$;

-- The existing finish RPC retains generation/restart semantics and records
-- bounded exponential retry eligibility instead of losing partial diagnostics.
create or replace function public.rpc_finish_fo_km_reconciliation_v1(p_attendance uuid,p_lease uuid,p_posted boolean,p_error text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'km_service_required' using errcode='42501';end if;
 update public.fo_km_reconciliation_jobs set state=case when generation<>claimed_generation then 'pending'
 when p_posted and p_error in('unchanged','partial_unresolved') then 'unchanged' when p_posted then 'posted'
 when p_error in('KM_FINANCIAL_WRITES_MAINTENANCE','KM_SHARED_RECONCILIATION_INACTIVE','55000') then 'deferred' when attempts>=8 then 'failed' else 'deferred' end,
 attempts=case when p_error in('KM_FINANCIAL_WRITES_MAINTENANCE','KM_SHARED_RECONCILIATION_INACTIVE','55000') then greatest(0,attempts-1) else attempts end,
 last_error=left(p_error,300),lease=null,lease_until=null,claimed_evidence_digest=null,
 not_before=clock_timestamp()+case when p_error in('KM_FINANCIAL_WRITES_MAINTENANCE','KM_SHARED_RECONCILIATION_INACTIVE','55000') then interval '1 minute'
 else make_interval(secs=>least(1800,30*power(2,greatest(0,attempts-1)))::integer) end,updated_at=clock_timestamp()
 where attendance_id=p_attendance and lease=p_lease;
end $$;

revoke all on function public.fo_km_automatic_control_audit(),public.fo_km_automatic_eligible(public.fo_attendance),public.fo_km_require_automatic(uuid,text,uuid),
 public.rpc_fo_km_automatic_authorization_version_v1(),public.rpc_claim_fo_automatic_km_v1(),public.rpc_reconcile_fo_automatic_km_v1(uuid,jsonb,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.rpc_fo_km_automatic_authorization_version_v1(),public.rpc_claim_fo_automatic_km_v1(),public.rpc_reconcile_fo_automatic_km_v1(uuid,jsonb,text,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
