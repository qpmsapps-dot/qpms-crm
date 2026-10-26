-- Forward-only extension of 241. Installation grants no financial authority.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$begin
 if current_user <> 'postgres' then raise exception 'km246_owner_required';end if;
 if not exists(select 1 from public.fo_km_scope_control where control_key='admin_acceptance' and emergency_pause and release_until is null)
 or exists(select 1 from public.fo_km_financial_control where financial_writes_enabled)
 or exists(select 1 from public.fo_km_canonical_policy where enabled or admin_enabled or worker_enabled)
 then raise exception 'km246_install_requires_shutdown';end if;
 if to_regprocedure('public.fo_reconcile_km_239_core(uuid,jsonb,text,uuid,uuid)') is null
 or to_regprocedure('public.rpc_reconcile_fo_policy_km_v1(uuid,jsonb,text,uuid,uuid)') is null
 or to_regprocedure('public.rpc_claim_fo_policy_km_v1()') is null then raise exception 'km246_requires_241';end if;
end $$;

do $$declare f record;begin for f in select * from (values ('public.rpc_claim_fo_policy_km_v1()','f5d8c1657693273565623efd65768d04'),('public.rpc_reconcile_fo_policy_km_v1(uuid,jsonb,text,uuid,uuid)','e056f7a9a549a897ac01d1989557247c'),('public.fo_reconcile_km_239_core(uuid,jsonb,text,uuid,uuid)','1276ba9bd13168d01a47500583f0bd58')) expected(signature,digest) loop if (select md5(replace(prosrc,E'\r','')) from pg_proc where oid=to_regprocedure(f.signature)) is distinct from f.digest then raise exception 'km246_dependency_drift: %',f.signature;end if;end loop;end $$;

create table public.fo_km_attendance_authorizations (
 reference text primary key check(reference ~ '^[A-Z0-9_-]{8,100}$'),
 attendance_id uuid not null references public.fo_attendance(id),
 profile_id uuid not null references public.profiles(id), employee_code text not null,
 fo_user_id text not null, attendance_date date not null, logout_time timestamptz not null,
 generation integer not null check(generation>0),
 trigger_source text not null check(trigger_source in('manual_end_day','auto_end_day','late_gps')),
 provenance_table text not null check(provenance_table in('fo_attendance','fo_location_logs')),
 provenance_id uuid not null, starts_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null, revoked_at timestamptz,
 maximum_incremental_km numeric not null check(maximum_incremental_km>=0 and maximum_incremental_km<'Infinity'::numeric and round(maximum_incremental_km,2)=maximum_incremental_km),
 maximum_incremental_amount numeric not null check(maximum_incremental_amount>=0 and maximum_incremental_amount<'Infinity'::numeric and round(maximum_incremental_amount,2)=maximum_incremental_amount),
 baseline_credit_km numeric not null, baseline_credit_amount numeric not null,
 evidence_digest text not null check(evidence_digest ~ '^[0-9a-f]{64}$'),
 approved_calculation jsonb not null, receipt_id uuid references public.fo_km_incremental_credits(id),
 post_evidence_digest text, credited_km numeric not null default 0, credited_amount numeric not null default 0,
 check(expires_at>starts_at and expires_at<=starts_at+interval '1 hour'),
 check(credited_km>=0 and credited_km<=maximum_incremental_km and credited_amount>=0 and credited_amount<=maximum_incremental_amount)
);
create unique index fo_km_one_live_attendance_authorization on public.fo_km_attendance_authorizations(attendance_id) where revoked_at is null;
alter table public.fo_km_attendance_authorizations enable row level security;
revoke all on public.fo_km_attendance_authorizations from public,anon,authenticated,service_role;

-- Owner-only fingerprint used before AND after canonical calculation at approval.
-- The old snapshot is reproduced exactly; raw evidence and identities are pinned
-- additionally, including late/unbound GPS, settlements, corrections and receipts.
create function public.fo_km_attendance_evidence_v246(p_attendance uuid) returns jsonb
language sql volatile security definer set search_path=public,pg_temp as $$
 with a as (select * from public.fo_attendance where id=p_attendance),
 c as (select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]'::jsonb) rows,
 coalesce(sum(x.added_km),0) km,coalesce(sum(x.amount),0) amount from public.fo_km_incremental_credits x where x.attendance_id=p_attendance),
 s as (select jsonb_build_object('attendance',to_jsonb(a),'canonical',public.fo_october_recovery_state(upper(a.employee_code),a.attendance_date),'credits',c.rows,
 'visits',(select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]'::jsonb) from public.fo_site_visits v where v.attendance_id=a.id),
 'recoveries',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]'::jsonb) from public.fo_october_km_recoveries r where r.employee_code=upper(a.employee_code) and r.attendance_date=a.attendance_date and r.status='approved')) body from a cross join c),
 e as (select jsonb_build_object('state',s.body,
 'profiles',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from public.profiles p where upper(btrim(p.employee_code))=upper(btrim(a.employee_code))),
 'gps',(select coalesce(jsonb_agg(to_jsonb(g) order by g.id),'[]'::jsonb) from public.fo_location_logs g
 where g.attendance_id=a.id or (g.attendance_id is null and g.captured_at>=a.login_time and g.captured_at<(a.attendance_date+1)::timestamp at time zone 'Asia/Kolkata'
 and (upper(g.employee_code)=upper(a.employee_code) or g.fo_user_id::text in(a.fo_user_id::text,a.employee_code)
 or exists(select 1 from public.profiles p where upper(p.employee_code)=upper(a.employee_code) and g.fo_user_id::text in(p.id::text,p.auth_user_id::text)))))
 ) body from a cross join s)
 select jsonb_build_object('evidence_digest',encode(sha256(convert_to(e.body::text,'UTF8')),'hex'),
 'snapshot',md5(s.body::text),'credit_km',c.km,'credit_amount',c.amount) from e cross join s cross join c;
$$;

create function public.fo_km_attendance_provenance_v246(a public.fo_attendance,v public.fo_km_job_provenance,r public.profiles) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((v.trigger_source in('manual_end_day','auto_end_day') and v.source_table='fo_attendance' and v.source_id=a.id)
 or (v.trigger_source='late_gps' and v.source_table='fo_location_logs' and exists(select 1 from public.fo_location_logs g
 where g.id=v.source_id and g.captured_at>=a.login_time and g.captured_at<=a.logout_time
 and (g.employee_code is null or upper(g.employee_code)=upper(a.employee_code))
 and (g.attendance_id=a.id or (g.attendance_id is null
 and g.fo_user_id::text in(a.fo_user_id::text,a.employee_code,r.id::text,r.auth_user_id::text)
 and (select count(*) from public.fo_attendance x where x.employee_code=a.employee_code and x.logout_time is not null and g.captured_at>=x.login_time and g.captured_at<=x.logout_time)=1)))),false);
$$;

create function public.fo_authorize_attendance_km_v246(
 p_reference text,p_attendance uuid,p_employee text,p_generation integer,p_source text,
 p_provenance_table text,p_provenance_id uuid,p_logout timestamptz,p_expires timestamptz,
 p_maximum_km numeric,p_maximum_amount numeric,p_evidence_digest text,p_calculation jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.fo_attendance%rowtype;j public.fo_km_reconciliation_jobs%rowtype;v public.fo_km_job_provenance%rowtype;
 actor public.profiles%rowtype;f jsonb;k numeric;m numeric;
begin
 -- No service/API capability can approve itself, even with spoofed JWT GUCs.
 if session_user<>'postgres' then raise exception 'km246_owner_required';end if;
 perform 1 from public.fo_km_scope_control where control_key='admin_acceptance' and emergency_pause and release_until is null for share;
 if not found or exists(select 1 from public.fo_km_financial_control where financial_writes_enabled)
 or exists(select 1 from public.fo_km_canonical_policy where enabled or admin_enabled or worker_enabled)
 then raise exception 'km246_authorize_requires_shutdown' using errcode='55000';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_attendance::text,0));
 select * into strict a from public.fo_attendance where id=p_attendance for update;
 select * into strict j from public.fo_km_reconciliation_jobs where attendance_id=a.id for update;
 select * into strict v from public.fo_km_job_provenance where attendance_id=a.id for share;
 select * into strict actor from public.profiles where upper(btrim(employee_code))=upper(btrim(p_employee)) and is_active is true
 and lower(coalesce(status,'')) not in('inactive','disabled','deactivated');
 if a.employee_code is distinct from p_employee or a.fo_user_id is null or a.logout_time is distinct from p_logout
 or a.fo_user_id::text not in(actor.id::text,coalesce(actor.auth_user_id::text,''),actor.employee_code)
 or a.logout_time is null or a.logout_time>clock_timestamp() or lower(coalesce(a.status,'')) not in('completed','ended','ended day','closed','auto ended','stale auto ended')
 or j.generation is distinct from p_generation or v.generation is distinct from p_generation
 or j.trigger_source is distinct from p_source or v.trigger_source is distinct from p_source
 or v.source_table is distinct from p_provenance_table or v.source_id is distinct from p_provenance_id
 or p_source not in('manual_end_day','auto_end_day','late_gps') or p_source is null
 or not public.fo_km_attendance_provenance_v246(a,v,actor)
 then raise exception 'km246_attendance_or_provenance_changed' using errcode='42501';end if;
 f:=public.fo_km_attendance_evidence_v246(a.id);
 select coalesce(sum((l->>'new_eligible_km')::numeric),0),coalesce(sum(round((l->>'new_eligible_km')::numeric*(l->>'rate_per_km')::numeric,2)),0)
 into k,m from jsonb_array_elements(p_calculation->'legs') l where (l->>'new_eligible_km')::numeric>0;
 if p_evidence_digest is null or p_evidence_digest is distinct from f->>'evidence_digest'
 or p_calculation->>'snapshot' is distinct from f->>'snapshot'
 or p_calculation->>'calculationVersion' is distinct from 'KM_ENGINE_V2' or p_calculation->>'baselineKnown' is distinct from 'true'
 or coalesce(p_calculation->>'inputDigest','')!~'^[0-9a-f]{64}$' or jsonb_typeof(p_calculation->'legs') is distinct from 'array'
 or k is distinct from (p_calculation->>'additionalKm')::numeric or m is distinct from (p_calculation->>'additionalAmount')::numeric
 or k>p_maximum_km or m>p_maximum_amount or p_maximum_km is null or p_maximum_amount is null
 then raise exception 'km246_verified_plan_required' using errcode='42501';end if;
 insert into public.fo_km_attendance_authorizations(reference,attendance_id,profile_id,employee_code,fo_user_id,attendance_date,logout_time,
 generation,trigger_source,provenance_table,provenance_id,expires_at,maximum_incremental_km,maximum_incremental_amount,
 baseline_credit_km,baseline_credit_amount,evidence_digest,approved_calculation)
 values(p_reference,a.id,actor.id,a.employee_code,a.fo_user_id::text,a.attendance_date,a.logout_time,j.generation,j.trigger_source,v.source_table,v.source_id,
 p_expires,p_maximum_km,p_maximum_amount,(f->>'credit_km')::numeric,(f->>'credit_amount')::numeric,p_evidence_digest,p_calculation);
 return jsonb_build_object('reference',p_reference,'attendance_id',a.id,'generation',j.generation,'expires_at',p_expires,'maximum_km',p_maximum_km,'maximum_amount',p_maximum_amount);
end $$;

create function public.fo_km_attendance_authorization_audit_v246() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$begin
 insert into public.fo_km_policy_audit(event,detail) values('attendance_authorization:'||tg_op,jsonb_build_object('before',to_jsonb(old),'after',to_jsonb(new)));
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger fo_km_attendance_authorization_audit after insert or update or delete on public.fo_km_attendance_authorizations for each row execute function public.fo_km_attendance_authorization_audit_v246();

-- Retire only the unscoped worker claim capability. Its function body and all
-- protected 239/240 financial entry points remain unchanged.
revoke all on function public.rpc_claim_fo_km_reconciliation_v1() from public,anon,authenticated,service_role;

-- Keep 241's implementation and all financial triggers unchanged, owner-only.
alter function public.rpc_reconcile_fo_policy_km_v1(uuid,jsonb,text,uuid,uuid) rename to fo_reconcile_policy_km_241_core;
revoke all on function public.fo_reconcile_policy_km_241_core(uuid,jsonb,text,uuid,uuid) from public,anon,authenticated,service_role;

create or replace function public.rpc_claim_fo_policy_km_v1() returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.fo_km_reconciliation_jobs%rowtype;u public.fo_km_attendance_authorizations%rowtype;p public.fo_km_canonical_policy%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'km_service_required' using errcode='42501';end if;
 p:=public.fo_km_require_canonical_policy('manual_end_day');
 perform 1 from public.fo_km_financial_control where control_key='canonical_v2' and not financial_writes_enabled for share;
 if not found then raise exception 'km246_global_gate_must_remain_closed' using errcode='55000';end if;
 select q.* into j from public.fo_km_reconciliation_jobs q
 join public.fo_attendance a on a.id=q.attendance_id
 join public.fo_km_job_provenance v on v.attendance_id=a.id
 join public.fo_km_attendance_authorizations s on s.attendance_id=a.id and s.revoked_at is null
 join public.profiles r on r.id=s.profile_id
 where clock_timestamp()>=s.starts_at and clock_timestamp()<s.expires_at
 and a.employee_code=s.employee_code and a.fo_user_id::text=s.fo_user_id and a.attendance_date=s.attendance_date
 and a.logout_time=s.logout_time and a.logout_time<=clock_timestamp() and lower(a.status) in('completed','ended','ended day','closed','auto ended','stale auto ended')
 and r.employee_code=s.employee_code and r.is_active is true and lower(coalesce(r.status,'')) not in('inactive','disabled','deactivated')
 and a.attendance_date between p.date_from and p.date_to
 and q.generation=s.generation and v.generation=s.generation and q.trigger_source=s.trigger_source and v.trigger_source=s.trigger_source
 and v.source_table=s.provenance_table and v.source_id=s.provenance_id
 and public.fo_km_attendance_provenance_v246(a,v,r)
 and (public.fo_km_attendance_evidence_v246(a.id)->>'evidence_digest')=coalesce(s.post_evidence_digest,s.evidence_digest)
 and q.attempts<8 and q.not_before<=now() and (q.state in('pending','deferred') or (q.state='processing' and q.lease_until<now()))
 order by q.not_before,q.attendance_id for update of a,q,s skip locked limit 1;
 if not found then return null;end if;
 select * into strict u from public.fo_km_attendance_authorizations where attendance_id=j.attendance_id and revoked_at is null;
 perform public.fo_km_require_canonical_policy('manual_end_day');
 if clock_timestamp()>=u.expires_at then return null;end if;
 update public.fo_km_reconciliation_jobs set state='processing',lease=gen_random_uuid(),lease_until=now()+interval '3 minutes',claimed_generation=generation,attempts=attempts+1
 where attendance_id=j.attendance_id returning * into j;
 return to_jsonb(j)||jsonb_build_object('authorization_reference',u.reference,'authorization_version',246);
end $$;

create function public.rpc_reconcile_fo_policy_km_v1(p_attendance_id uuid,p_calculation jsonb,p_trigger text,p_admin uuid,p_lease uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.fo_attendance%rowtype;u public.fo_km_attendance_authorizations%rowtype;j public.fo_km_reconciliation_jobs%rowtype;
 v public.fo_km_job_provenance%rowtype;r public.profiles%rowtype;f jsonb;result jsonb;employee text;day date;k numeric;m numeric;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'km_service_required' using errcode='42501';end if;
 perform public.fo_km_require_canonical_policy(p_trigger);
 perform 1 from public.fo_km_financial_control where control_key='canonical_v2' and not financial_writes_enabled for share;
 if not found then raise exception 'km246_global_gate_must_remain_closed' using errcode='55000';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_attendance_id::text,0));
 select employee_code,attendance_date into strict employee,day from public.fo_attendance where id=p_attendance_id;
 perform pg_advisory_xact_lock(hashtextextended('october_recovery:'||upper(employee)||':'||day,0));
 select * into strict a from public.fo_attendance where id=p_attendance_id for update;
 select * into u from public.fo_km_attendance_authorizations where attendance_id=a.id and revoked_at is null for update;
 if not found then raise exception 'km246_attendance_not_authorized' using errcode='42501';end if;
 select * into strict r from public.profiles where id=u.profile_id for share;
 -- Lock existing evidence before the outbox, matching the GPS trigger's order.
 perform 1 from public.fo_site_visits where attendance_id=a.id order by id for share;
 perform 1 from public.fo_travel_legs where attendance_id=a.id order by id for share;
 perform 1 from public.fo_location_logs g where g.attendance_id=a.id or
 (g.attendance_id is null and g.captured_at>=a.login_time and g.captured_at<(a.attendance_date+1)::timestamp at time zone 'Asia/Kolkata'
 and (upper(g.employee_code)=upper(a.employee_code) or g.fo_user_id::text in(a.fo_user_id::text,a.employee_code,r.id::text,r.auth_user_id::text))) order by g.id for share;
 select * into strict j from public.fo_km_reconciliation_jobs where attendance_id=a.id for update;
 select * into strict v from public.fo_km_job_provenance where attendance_id=a.id for share;
 if clock_timestamp()<u.starts_at or clock_timestamp()>=u.expires_at
 or a.employee_code is distinct from u.employee_code or a.fo_user_id::text is distinct from u.fo_user_id or a.attendance_date is distinct from u.attendance_date
 or a.logout_time is distinct from u.logout_time or a.logout_time is null or lower(coalesce(a.status,'')) not in('completed','ended','ended day','closed','auto ended','stale auto ended')
 or r.employee_code is distinct from u.employee_code or r.is_active is distinct from true or lower(coalesce(r.status,'')) in('inactive','disabled','deactivated')
 or j.generation is distinct from u.generation or v.generation is distinct from u.generation
 or j.trigger_source is distinct from u.trigger_source or v.trigger_source is distinct from u.trigger_source
 or v.source_table is distinct from u.provenance_table or v.source_id is distinct from u.provenance_id
 or (p_trigger<>'admin_recalculation' and p_trigger is distinct from u.trigger_source)
 or not public.fo_km_attendance_provenance_v246(a,v,r)
 then raise exception 'km246_authorization_expired_or_stale' using errcode='42501';end if;
 if p_calculation is distinct from u.approved_calculation then raise exception 'km246_plan_not_authorized' using errcode='42501';end if;
 f:=public.fo_km_attendance_evidence_v246(a.id);
 if f->>'evidence_digest' is distinct from coalesce(u.post_evidence_digest,u.evidence_digest)
 then raise exception 'km246_evidence_changed' using errcode='40001';end if;
 if u.receipt_id is null and p_calculation->>'snapshot' is distinct from f->>'snapshot'
 then raise exception 'km246_baseline_changed' using errcode='40001';end if;
 if u.receipt_id is not null and not exists(select 1 from public.fo_km_incremental_credits c where c.id=u.receipt_id and c.attendance_id=a.id and c.input_digest=p_calculation->>'inputDigest')
 then raise exception 'km246_receipt_changed' using errcode='40001';end if;
 result:=public.fo_reconcile_policy_km_241_core(a.id,p_calculation,p_trigger,p_admin,p_lease);
 f:=public.fo_km_attendance_evidence_v246(a.id);
 k:=(f->>'credit_km')::numeric-u.baseline_credit_km;m:=(f->>'credit_amount')::numeric-u.baseline_credit_amount;
 if k<0 or m<0 or k>u.maximum_incremental_km or m>u.maximum_incremental_amount
 or clock_timestamp()>=u.expires_at then raise exception 'km246_attendance_limit_or_expiry' using errcode='22023';end if;
 update public.fo_km_attendance_authorizations set receipt_id=coalesce(receipt_id,(result->>'receipt_id')::uuid),
 credited_km=k,credited_amount=m,post_evidence_digest=f->>'evidence_digest' where reference=u.reference;
 return result;
end $$;

create function public.rpc_fo_km_attendance_authorization_version_v1() returns integer
language plpgsql stable security definer set search_path=public,pg_temp as $$begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'km_service_required' using errcode='42501';end if;
 return 246;
end $$;
revoke all on function public.fo_km_attendance_evidence_v246(uuid),public.fo_authorize_attendance_km_v246(text,uuid,text,integer,text,text,uuid,timestamptz,timestamptz,numeric,numeric,text,jsonb),
 public.fo_km_attendance_authorization_audit_v246(),public.fo_km_attendance_provenance_v246(public.fo_attendance,public.fo_km_job_provenance,public.profiles),public.rpc_claim_fo_policy_km_v1(),public.rpc_reconcile_fo_policy_km_v1(uuid,jsonb,text,uuid,uuid),public.rpc_fo_km_attendance_authorization_version_v1()
 from public,anon,authenticated,service_role;
grant execute on function public.rpc_claim_fo_policy_km_v1(),public.rpc_reconcile_fo_policy_km_v1(uuid,jsonb,text,uuid,uuid),public.rpc_fo_km_attendance_authorization_version_v1() to service_role;
notify pgrst, 'reload schema';
commit;
