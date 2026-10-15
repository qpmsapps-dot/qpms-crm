-- Additive, one-time historical final-leg recovery mechanism for 1-15 October 2026.
-- V1/V2 financial payloads are superseded/blocked. V3 preserves derived
-- zero-petrol reimbursement without materializing it as a stored payment.
-- Additive dedicated one-time mechanism; does not alter Migration 216 or old RPCs.
begin;
set local lock_timeout='2s';
create schema fo_hist_20261015;
revoke all on schema fo_hist_20261015 from public,anon,authenticated,service_role;
create table fo_hist_20261015.authorizations (
 id uuid primary key default gen_random_uuid(),
 action text not null check(action in ('APPLY','REVERSE')),
 payload_text text not null,
 payload_sha256 text not null check(payload_sha256='9757f1b6a35c19ec1d9c700f5d4cf06e1a1bd37e48049c414338474b376fbc2b'),
 reviewer uuid not null, reason text not null check(length(trim(reason))>=20),
 approved_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null
);
create table fo_hist_20261015.applications (
 singleton boolean primary key default true check(singleton),
 run_id uuid not null unique,
 authorization_id uuid not null unique references fo_hist_20261015.authorizations(id),
 payload_sha256 text not null,
 actor text not null,
 applied_at timestamptz not null default clock_timestamp()
);
create table fo_hist_20261015.adjustments (
 attendance_id uuid primary key references public.fo_attendance(id) on delete restrict,
 run_id uuid not null references fo_hist_20261015.applications(run_id),
 final_leg_identity text not null unique,
 delta_km numeric(14,2) not null check(delta_km>0),
 delta_amount numeric(14,2) not null check(delta_amount>0),
 attendance_before jsonb not null,
 attendance_after jsonb not null,
 snapshot_before_sha256 text not null,
 snapshot_after_sha256 text not null,
 evidence jsonb not null
);
create table fo_hist_20261015.reversals (
 singleton boolean primary key default true check(singleton),
 run_id uuid not null unique references fo_hist_20261015.applications(run_id),
 authorization_id uuid not null unique references fo_hist_20261015.authorizations(id),
 evidence jsonb not null,
 reversed_at timestamptz not null default clock_timestamp()
);
alter table fo_hist_20261015.authorizations enable row level security;
alter table fo_hist_20261015.applications enable row level security;
alter table fo_hist_20261015.adjustments enable row level security;
alter table fo_hist_20261015.reversals enable row level security;
revoke all on all tables in schema fo_hist_20261015 from public,anon,authenticated,service_role;

create function fo_hist_20261015.snapshot(p_attendance_id uuid) returns jsonb
language sql volatile security definer set search_path=pg_catalog,public set timezone='UTC'
as $fn$ select jsonb_build_object(
'attendance',to_jsonb(a),
'fo_site_visits',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.fo_site_visits t where t.attendance_id=a.id), '[]'::jsonb),
'fo_travel_legs',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.fo_travel_legs t where t.attendance_id=a.id), '[]'::jsonb),
'fo_travel_reimbursement_corrections',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.fo_travel_reimbursement_corrections t where t.attendance_id=a.id), '[]'::jsonb),
'fo_travel_expense_claims',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.fo_travel_expense_claims t where t.attendance_id=a.id), '[]'::jsonb),
'fo_km_financial_approvals',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.fo_km_financial_approvals t where t.attendance_id=a.id), '[]'::jsonb),
'fo_km_financial_approval_consumptions',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.fo_km_financial_approval_consumptions t where t.attendance_id=a.id), '[]'::jsonb),
'fo_final_leg_financial_applies',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.fo_final_leg_financial_applies t where t.attendance_id=a.id), '[]'::jsonb),
'fo_final_leg_recovery_approvals',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.fo_final_leg_recovery_approvals t where t.attendance_id=a.id), '[]'::jsonb),
'fo_final_leg_recovery_runs',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.fo_final_leg_recovery_runs t where t.attendance_id=a.id), '[]'::jsonb),
'fo_final_leg_recovery_approval_consumptions',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.fo_final_leg_recovery_approval_consumptions t where t.attendance_id=a.id), '[]'::jsonb),
'fo_km_auto_recovery_applies',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.fo_km_auto_recovery_applies t where t.attendance_id=a.id), '[]'::jsonb),
'fo_km_calculation_runs',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.fo_km_calculation_runs t where t.attendance_id=a.id), '[]'::jsonb),
'fo_missing_km_reviews',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.fo_missing_km_reviews t where t.attendance_id=a.id), '[]'::jsonb),
'profiles',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.profiles t where t.employee_code=a.employee_code), '[]'::jsonb),
'peers',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.fo_attendance t where t.employee_code=a.employee_code and t.attendance_date=a.attendance_date and t.id<>a.id), '[]'::jsonb),
'settlements',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.fo_monthly_travel_settlements t where t.employee_code=a.employee_code and a.attendance_date between t.period_start and t.period_end), '[]'::jsonb),
'gps',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.fo_location_logs t where (t.attendance_id=a.id or t.fo_user_id=a.fo_user_id) and t.captured_at>(select max(v.check_out_time) from public.fo_site_visits v where v.attendance_id=a.id and lower(coalesce(v.status,v.visit_status,'')) not in ('cancelled','rejected','deleted')) and t.captured_at<=a.logout_time), '[]'::jsonb),
'financial_gate',coalesce((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from public.fo_km_financial_control t where t.control_key='canonical_v2'), '[]'::jsonb)
) from public.fo_attendance a where a.id=p_attendance_id $fn$;

create function fo_hist_20261015.financials(p jsonb) returns jsonb
language sql immutable set search_path=pg_catalog
as $fn$ select jsonb_build_object(
 'total_route_km',round(coalesce((p->>'total_route_km')::numeric,0),2),
 'eligible_km',round(coalesce((p->>'eligible_km')::numeric,0),2),
 'total_approved_km',round(coalesce((p->>'total_approved_km')::numeric,0),2),
 'petrol_amount',round(coalesce((p->>'petrol_amount')::numeric,0),2)) $fn$;

create function fo_hist_20261015.assert_context() returns void
language plpgsql security definer set search_path=pg_catalog,public
as $fn$
begin
 if coalesce(auth.role(),'')<>'service_role'
 or current_setting('transaction_isolation')<>'serializable' then
  raise exception 'Historical apply/reverse requires service_role and caller-owned SERIALIZABLE transaction';
 end if;
 perform 1 from public.fo_km_financial_control
  where control_key='canonical_v2' and financial_writes_enabled is false
  for update nowait;
 if not found then
  raise exception 'Global financial gate must remain closed';
 end if;
 if current_setting('TimeZone')<>'UTC' then raise exception 'Transaction TimeZone must be UTC'; end if;
 -- Lock only the canonical gate row. Target attendance rows are locked in UUID
 -- order below; SERIALIZABLE predicate reads of the exact snapshot detect any
 -- concurrent insert/update affecting protected evidence without table-wide locks.
end $fn$;

create function public.rpc_approve_fo_hist_20261015(p_payload text,p_reason text,p_action text)
returns uuid language plpgsql security definer set search_path=pg_catalog,public,fo_hist_20261015
as $fn$
declare v_id uuid; v_user uuid:=auth.uid(); v_payload jsonb;
begin
 if v_user is null or not public.is_qpms_admin() then raise exception 'Authenticated authorized admin reviewer required'; end if;
 if p_action is null or p_action not in ('APPLY','REVERSE') or length(trim(coalesce(p_reason,'')))<20 then raise exception 'Explicit action and meaningful reason required'; end if;
 if p_payload is null or encode(extensions.digest(trim(p_payload),'sha256'),'hex') is distinct from '9757f1b6a35c19ec1d9c700f5d4cf06e1a1bd37e48049c414338474b376fbc2b' then raise exception 'Exact non-NULL reviewed payload required'; end if;
 v_payload:=trim(p_payload)::jsonb;
 if jsonb_typeof(v_payload->'rows') is distinct from 'array' then raise exception 'Reviewed payload rows array required'; end if;
 if p_action='APPLY' and (v_payload->>'financial_projection_version') is distinct from 'FINANCE_BASELINE_V3_DERIVED_PRESERVED' then
  raise exception 'Only the reviewed baseline-preserving V3 projection may be authorized';
 end if;
 if exists(select 1 from public.profiles p join jsonb_array_elements(v_payload->'rows') r on p.employee_code=r->>'employee_code' where p.id=v_user) then raise exception 'Self-approval prohibited'; end if;
 perform pg_advisory_xact_lock(hashtextextended('fo_hist_20261015',0));
 if p_action='APPLY' and exists(select 1 from fo_hist_20261015.applications) then raise exception 'Batch already consumed; do not reauthorize'; end if;
 if p_action='REVERSE' and (not exists(select 1 from fo_hist_20261015.applications) or exists(select 1 from fo_hist_20261015.reversals)) then raise exception 'No unreversed batch'; end if;
 insert into fo_hist_20261015.authorizations(action,payload_text,payload_sha256,reviewer,reason,expires_at)
 values(p_action,trim(p_payload),'9757f1b6a35c19ec1d9c700f5d4cf06e1a1bd37e48049c414338474b376fbc2b',v_user,trim(p_reason),clock_timestamp()+interval '1 hour') returning id into v_id;
 return v_id;
end $fn$;

create function public.rpc_apply_fo_hist_20261015(p_authorization_id uuid,p_actor text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,fo_hist_20261015 set timezone='UTC'
as $fn$
declare v_auth fo_hist_20261015.authorizations%rowtype; v_existing fo_hist_20261015.applications%rowtype;
 v_payload jsonb; r jsonb; s jsonb; t jsonb; v_before jsonb; v_after jsonb; v_finance jsonb;
 v_pending jsonb:='[]'::jsonb; v_run uuid:=gen_random_uuid(); v_n integer; v_km numeric; v_amount numeric;
 v_zero_count integer; v_derived_baseline numeric; v_effective_delta numeric;
 v_previous_flag text:=current_setting('app.km_v2_authorized_financial_write',true);
begin
 if p_authorization_id is null then raise exception 'Explicit apply authorization UUID required'; end if;
 if not exists(select 1 from fo_hist_20261015.authorizations where id=p_authorization_id
  and (payload_text::jsonb->>'financial_projection_version')='FINANCE_BASELINE_V3_DERIVED_PRESERVED') then
  raise exception 'Historical financial projection remains on finance hold';
 end if;
 perform pg_advisory_xact_lock(hashtextextended('fo_hist_20261015',0));
 perform fo_hist_20261015.assert_context();
 select * into v_existing from fo_hist_20261015.applications;
 if found then
  if v_existing.authorization_id is distinct from p_authorization_id or exists(select 1 from fo_hist_20261015.reversals) then raise exception 'Batch consumed/reversed or authorization mismatch'; end if;
  for r in select to_jsonb(x) from fo_hist_20261015.adjustments x loop
   s:=fo_hist_20261015.snapshot((r->>'attendance_id')::uuid);
   if encode(extensions.digest(s::text,'sha256'),'hex') is distinct from r->>'snapshot_after_sha256' then raise exception 'Replay postimage changed: %',r->>'attendance_id'; end if;
  end loop;
  return jsonb_build_object('idempotent_replay',true,'run_id',v_existing.run_id,'records',174,'additional_km',2843.53,'additional_amount',11374.12);
 end if;
 select * into strict v_auth from fo_hist_20261015.authorizations where id=p_authorization_id for update;
 if v_auth.action is distinct from 'APPLY' or v_auth.expires_at is null or v_auth.expires_at<=clock_timestamp() or length(trim(coalesce(p_actor,'')))<3 then raise exception 'Apply authorization expired/invalid'; end if;
 if not exists(select 1 from public.profiles where id=v_auth.reviewer) then raise exception 'Reviewer no longer exists'; end if;
 v_payload:=v_auth.payload_text::jsonb;
 select count(*),sum((x->>'km')::numeric),sum((x->>'amount')::numeric) into v_n,v_km,v_amount from jsonb_array_elements(v_payload->'rows') x;
 if v_n is distinct from 174 or v_km is distinct from 2843.53 or v_amount is distinct from 11374.12 or (select count(distinct x->>'attendance_id') from jsonb_array_elements(v_payload->'rows') x) is distinct from 174 then raise exception 'Exact batch totals/uniqueness mismatch'; end if;
 select count(*) filter(where x->'financial_projection'->>'storage_action'='PRESERVE_DERIVED_ZERO'),
  round(sum(case when x->'financial_projection'->>'storage_action'='PRESERVE_DERIVED_ZERO' then (x->'financial_projection'->>'existing_effective_reimbursement')::numeric else 0 end),2),
  round(sum((x->'financial_projection'->>'effective_reimbursement_after')::numeric-(x->'financial_projection'->>'existing_effective_reimbursement')::numeric),2)
 into v_zero_count,v_derived_baseline,v_effective_delta from jsonb_array_elements(v_payload->'rows') x;
 if v_zero_count is distinct from 97 or v_derived_baseline is distinct from 12422.12 or v_effective_delta is distinct from 11374.12
 then raise exception 'Derived-baseline/effective-increase aggregate mismatch'; end if;
 -- Preflight the complete batch before making ANY financial change.
 for r in select value from jsonb_array_elements(v_payload->'rows') order by value->>'attendance_id' loop
  perform pg_advisory_xact_lock(hashtextextended(r->>'attendance_id',0));
  perform 1 from public.fo_attendance where id=(r->>'attendance_id')::uuid for update;
  s:=fo_hist_20261015.snapshot((r->>'attendance_id')::uuid);
  if s is null or encode(extensions.digest(s::text,'sha256'),'hex') is distinct from r->>'snapshot_sha256' then raise exception 'Source/protection drift; re-audit and reapprove: %',r->>'attendance_id'; end if;
  if (r->>'attendance_date')::date not between date '2026-10-01' and date '2026-10-15'
   or (r->>'km')::numeric is null or (r->>'km')::numeric<=0
   or (r->>'rate_per_km')::numeric is null or (r->>'rate_per_km')::numeric<=0
   or (r->>'amount')::numeric is null
   or (r->>'amount')::numeric is distinct from round((r->>'km')::numeric*(r->>'rate_per_km')::numeric,2)
   or r->>'engine_source' is null or r->>'engine_source' not in ('GPS_BASED','GPS_ROUTE_SUPPORTED','GOOGLE_ROUTE_FALLBACK') then raise exception 'Out-of-scope, NULL or unsupported evidence'; end if;
  v_before:=s->'attendance';
  v_finance:=r->'financial_projection';
  if jsonb_typeof(v_finance) is distinct from 'object'
   or (v_finance->>'version') is distinct from 'FINANCE_BASELINE_V3_DERIVED_PRESERVED'
   or (v_finance->>'storage_action') not in ('PRESERVE_DERIVED_ZERO','ADD_FINAL_DELTA_TO_STORED')
   or (v_finance->>'raw_petrol_before')::numeric is null
   or (v_finance->>'raw_petrol_after')::numeric is null
   or (v_finance->>'existing_effective_reimbursement')::numeric is null
   or (v_finance->>'baseline_materialization_amount')::numeric is null
   or (v_finance->>'final_leg_reimbursement_delta')::numeric is null
   or (v_finance->>'effective_reimbursement_after')::numeric is null
   or round((v_finance->>'baseline_materialization_amount')::numeric,2) is distinct from 0
   or round((v_finance->>'raw_petrol_before')::numeric,2) is distinct from round((r->'before'->>'petrol_amount')::numeric,2)
   or round((v_finance->>'raw_petrol_after')::numeric,2) is distinct from round((r->'after'->>'petrol_amount')::numeric,2)
   or round((v_finance->>'final_leg_reimbursement_delta')::numeric,2) is distinct from round((r->>'amount')::numeric,2)
   or round((v_finance->>'effective_reimbursement_after')::numeric,2) is distinct from
      round((v_finance->>'existing_effective_reimbursement')::numeric+(r->>'amount')::numeric,2)
   or (v_finance->>'effective_reimbursement_after')::numeric < (v_finance->>'existing_effective_reimbursement')::numeric
   or ((v_finance->>'storage_action')='PRESERVE_DERIVED_ZERO' and
       (round((r->'before'->>'petrol_amount')::numeric,2) is distinct from 0 or round((r->'after'->>'petrol_amount')::numeric,2) is distinct from 0))
   or ((v_finance->>'storage_action')='ADD_FINAL_DELTA_TO_STORED' and
       (round((r->'before'->>'petrol_amount')::numeric,2)=0 or
        round((r->'after'->>'petrol_amount')::numeric,2) is distinct from round((r->'before'->>'petrol_amount')::numeric+(r->>'amount')::numeric,2)))
  then raise exception 'Baseline-preserving financial proof failed: %',r->>'attendance_id'; end if;
  if fo_hist_20261015.financials(v_before) is distinct from r->'before' then raise exception 'Financial before-image mismatch'; end if;
  if r->>'employee_code' is distinct from v_before->>'employee_code' or r->>'attendance_date' is distinct from v_before->>'attendance_date' then raise exception 'Employee/date mismatch'; end if;
 end loop;
 perform set_config('app.km_v2_authorized_financial_write','true',true);
 for r in select value from jsonb_array_elements(v_payload->'rows') order by value->>'attendance_id' loop
  select to_jsonb(a) into v_before from public.fo_attendance a where a.id=(r->>'attendance_id')::uuid;
  update public.fo_attendance set
   total_route_km=(r->'after'->>'total_route_km')::numeric,eligible_km=(r->'after'->>'eligible_km')::numeric,
   total_approved_km=(r->'after'->>'total_approved_km')::numeric,petrol_amount=(r->'after'->>'petrol_amount')::numeric
   where id=(r->>'attendance_id')::uuid returning to_jsonb(fo_attendance) into v_after;
  if fo_hist_20261015.financials(v_after) is distinct from r->'after'
   or (v_before-array['total_route_km','eligible_km','total_approved_km','petrol_amount','updated_at']) is distinct from (v_after-array['total_route_km','eligible_km','total_approved_km','petrol_amount','updated_at']) then raise exception 'Unexpected target mutation; entire batch rolled back'; end if;
  v_pending:=v_pending||jsonb_build_array(jsonb_build_object('plan',r,'before',v_before,'after',v_after));
 end loop;
 perform set_config('app.km_v2_authorized_financial_write',coalesce(v_previous_flag,'false'),true);
 insert into fo_hist_20261015.applications(run_id,authorization_id,payload_sha256,actor)
 values(v_run,p_authorization_id,v_auth.payload_sha256,p_actor);
 for t in select value from jsonb_array_elements(v_pending) loop
  r:=t->'plan';s:=fo_hist_20261015.snapshot((r->>'attendance_id')::uuid);
  -- Prove all non-attendance evidence remains unchanged. Replace only attendance
  -- with its saved before-image and require the original complete snapshot hash.
  if encode(extensions.digest(jsonb_set(s,'{attendance}',t->'before')::text,'sha256'),'hex') is distinct from r->>'snapshot_sha256' then raise exception 'Protected evidence changed during apply'; end if;
  insert into fo_hist_20261015.adjustments(attendance_id,run_id,final_leg_identity,delta_km,delta_amount,attendance_before,attendance_after,snapshot_before_sha256,snapshot_after_sha256,evidence)
  values((r->>'attendance_id')::uuid,v_run,r->>'final_leg_identity',(r->>'km')::numeric,(r->>'amount')::numeric,t->'before',t->'after',r->>'snapshot_sha256',encode(extensions.digest(s::text,'sha256'),'hex'),r);
 end loop;
 return jsonb_build_object('idempotent_replay',false,'run_id',v_run,'records',174,'additional_km',2843.53,'additional_amount',11374.12);
end $fn$;

create function public.rpc_reverse_fo_hist_20261015(p_authorization_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,fo_hist_20261015 set timezone='UTC'
as $fn$
declare v_auth fo_hist_20261015.authorizations%rowtype; v_run uuid; r fo_hist_20261015.adjustments%rowtype;
 s jsonb; v_after jsonb; v_reversal jsonb:='[]'::jsonb; v_existing fo_hist_20261015.reversals%rowtype;
 v_previous_flag text:=current_setting('app.km_v2_authorized_financial_write',true);
begin
 if p_authorization_id is null then raise exception 'Explicit reversal authorization UUID required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('fo_hist_20261015',0));
 perform fo_hist_20261015.assert_context();
 select * into v_existing from fo_hist_20261015.reversals;
 if found then
  if v_existing.authorization_id is distinct from p_authorization_id then raise exception 'Reversal already consumed'; end if;
  return jsonb_build_object('idempotent_replay',true,'run_id',v_existing.run_id,'reversed',true);
 end if;
 select * into strict v_auth from fo_hist_20261015.authorizations where id=p_authorization_id for update;
 if v_auth.action is distinct from 'REVERSE' or v_auth.expires_at is null or v_auth.expires_at<=clock_timestamp() then raise exception 'Separate unexpired reversal authorization required'; end if;
 select run_id into strict v_run from fo_hist_20261015.applications;
 if (select count(*) from fo_hist_20261015.adjustments)<>174 then raise exception 'Incomplete application ledger'; end if;
 -- Check ALL saved postimages and protections before restoring any values.
 for r in select * from fo_hist_20261015.adjustments order by attendance_id loop
  perform 1 from public.fo_attendance where id=r.attendance_id for update;
  s:=fo_hist_20261015.snapshot(r.attendance_id);
  if encode(extensions.digest(s::text,'sha256'),'hex') is distinct from r.snapshot_after_sha256 then raise exception 'Post-apply drift/finance progress; STOP for manual review: %',r.attendance_id; end if;
 end loop;
 perform set_config('app.km_v2_authorized_financial_write','true',true);
 for r in select * from fo_hist_20261015.adjustments order by attendance_id loop
  update public.fo_attendance set total_route_km=(r.attendance_before->>'total_route_km')::numeric,
   eligible_km=(r.attendance_before->>'eligible_km')::numeric,
   total_approved_km=(r.attendance_before->>'total_approved_km')::numeric,
   petrol_amount=(r.attendance_before->>'petrol_amount')::numeric
   where id=r.attendance_id returning to_jsonb(fo_attendance) into v_after;
  if (v_after-'updated_at') is distinct from (r.attendance_before-'updated_at') then raise exception 'Restore mismatch; entire reversal rolled back'; end if;
  v_reversal:=v_reversal||jsonb_build_array(jsonb_build_object('attendance_id',r.attendance_id,'restored',v_after));
 end loop;
 perform set_config('app.km_v2_authorized_financial_write',coalesce(v_previous_flag,'false'),true);
 insert into fo_hist_20261015.reversals(run_id,authorization_id,evidence) values(v_run,p_authorization_id,v_reversal);
 return jsonb_build_object('run_id',v_run,'reversed',true,'records',174);
end $fn$;

create function public.rpc_status_fo_hist_20261015()
returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,fo_hist_20261015
as $fn$
declare v_result jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Backend service role required'; end if;
 select jsonb_build_object(
  'active_apply_authorization',(
   select jsonb_build_object('id',a.id,'reviewer',a.reviewer,'reason',a.reason,'approved_at',a.approved_at,'expires_at',a.expires_at)
   from fo_hist_20261015.authorizations a
   where a.action='APPLY' and a.expires_at>clock_timestamp()
     and not exists(select 1 from fo_hist_20261015.applications x where x.authorization_id=a.id)
   order by a.approved_at desc limit 1),
  'application',(
   select jsonb_build_object('run_id',x.run_id,'authorization_id',x.authorization_id,'actor',x.actor,'applied_at',x.applied_at,
    'records',(select count(*) from fo_hist_20261015.adjustments d where d.run_id=x.run_id),
    'additional_km',(select round(sum(d.delta_km),2) from fo_hist_20261015.adjustments d where d.run_id=x.run_id),
    'additional_amount',(select round(sum(d.delta_amount),2) from fo_hist_20261015.adjustments d where d.run_id=x.run_id))
   from fo_hist_20261015.applications x limit 1),
  'reversal',(
   select jsonb_build_object('run_id',r.run_id,'authorization_id',r.authorization_id,'reversed_at',r.reversed_at)
   from fo_hist_20261015.reversals r limit 1),
  'authorizations',coalesce((
   select jsonb_agg(jsonb_build_object('id',a.id,'action',a.action,'reviewer',a.reviewer,'reason',a.reason,
    'approved_at',a.approved_at,'expires_at',a.expires_at) order by a.approved_at)
   from fo_hist_20261015.authorizations a),'[]'::jsonb)
 ) into v_result;
 return v_result;
end $fn$;

create function public.rpc_read_fo_hist_20261015(p_authorized_attendance_ids uuid[])
returns setof jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,fo_hist_20261015
as $fn$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Backend service role required'; end if;
 if p_authorized_attendance_ids is null or cardinality(p_authorized_attendance_ids)>174 then raise exception 'Bounded authorized attendance IDs required'; end if;
 return query select to_jsonb(d)||jsonb_build_object('reversed',false)
 from fo_hist_20261015.adjustments d
 join fo_hist_20261015.applications a on a.run_id=d.run_id
 join fo_hist_20261015.authorizations approval on approval.id=a.authorization_id
 where d.attendance_id=any(p_authorized_attendance_ids) and approval.action='APPLY'
 and not exists(select 1 from fo_hist_20261015.reversals r where r.run_id=d.run_id)
 order by d.attendance_id;
end $fn$;

create trigger immutable_authorizations before update or delete on fo_hist_20261015.authorizations for each row execute function public.trg_reject_fo_km_audit_mutation();
create trigger immutable_applications before update or delete on fo_hist_20261015.applications for each row execute function public.trg_reject_fo_km_audit_mutation();
create trigger immutable_adjustments before update or delete on fo_hist_20261015.adjustments for each row execute function public.trg_reject_fo_km_audit_mutation();
create trigger immutable_reversals before update or delete on fo_hist_20261015.reversals for each row execute function public.trg_reject_fo_km_audit_mutation();
revoke all on all functions in schema fo_hist_20261015 from public,anon,authenticated,service_role;
revoke all on function public.rpc_approve_fo_hist_20261015(text,text,text) from public,anon,service_role;
grant execute on function public.rpc_approve_fo_hist_20261015(text,text,text) to authenticated;
revoke all on function public.rpc_apply_fo_hist_20261015(uuid,text) from public,anon,authenticated;
revoke all on function public.rpc_reverse_fo_hist_20261015(uuid) from public,anon,authenticated;
revoke all on function public.rpc_status_fo_hist_20261015() from public,anon,authenticated;
revoke all on function public.rpc_read_fo_hist_20261015(uuid[]) from public,anon,authenticated;
grant execute on function public.rpc_apply_fo_hist_20261015(uuid,text) to service_role;
grant execute on function public.rpc_reverse_fo_hist_20261015(uuid) to service_role;
grant execute on function public.rpc_status_fo_hist_20261015() to service_role;
grant execute on function public.rpc_read_fo_hist_20261015(uuid[]) to service_role;
commit;
