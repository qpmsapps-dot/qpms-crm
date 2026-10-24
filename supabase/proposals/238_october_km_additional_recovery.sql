-- PROPOSAL ONLY. Not installed. Requires separate migration/security approval.
-- No existing financial gate, canonical amount, settlement, grant or RLS policy is changed.
begin;
create table public.fo_october_recovery_activation (
  singleton boolean primary key default true check(singleton),
  requests_enabled boolean not null default false,
  approvals_enabled boolean not null default false,
  emergency_exception_approved boolean not null default false,
  allowed_admins uuid[] not null default '{}',
  approval_reference text,
  expires_at timestamptz,
  check(not approvals_enabled or (emergency_exception_approved and coalesce(length(approval_reference),0)>=10 and expires_at is not null))
);
insert into public.fo_october_recovery_activation(singleton) values(true);

create table public.fo_october_km_recoveries (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null,
  employee_name text not null,
  attendance_date date not null check(attendance_date between '2026-10-01' and '2026-10-31'),
  attendance_id uuid references public.fo_attendance(id),
  journey_start timestamptz not null,
  journey_end timestamptz not null,
  journey_type text not null,
  start_location text not null,
  destination text not null,
  intermediate_stops jsonb not null,
  recovery_reason text not null check(recovery_reason in ('Missing Check-Out','Missing Check-In','Missing End Day','Sourcing / Recruitment','Emergency Site Visit','GPS Failure','Offline Sync Failure','Other Official Travel')),
  explanation text not null,
  evidence_refs jsonb not null,
  requested_km numeric(10,2) not null check(requested_km>0 and requested_km<=500),
  journey_total_km numeric(10,2) not null check(journey_total_km>=requested_km and journey_total_km<=1000),
  travel_mode text not null check(travel_mode in ('bike','own_vehicle','car','auto','bus','train','other')),
  travel_rate numeric not null check(travel_rate>=0),
  approved_additional_km numeric(10,2) not null default 0 check(approved_additional_km>=0 and approved_additional_km<=requested_km),
  additional_amount numeric(12,2) not null default 0 check(additional_amount>=0),
  verified_included_km numeric(10,2),
  inclusion_resolution text,
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  submitted_by uuid not null,
  approved_by uuid,
  approved_at timestamptz,
  approval_remarks text,
  original_payable_km numeric(12,2),
  resulting_payable_km numeric(12,2),
  original_claim_amount numeric(12,2),
  resulting_claim_amount numeric(12,2),
  before_state jsonb not null,
  request_key text not null unique,
  request_payload jsonb not null,
  decision_key text unique,
  decision_payload jsonb,
  journey_fingerprint text not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  check(journey_end>journey_start and journey_end<=now()),
  check((journey_start at time zone 'Asia/Kolkata')::date=attendance_date),
  check(journey_end<=(attendance_date+1)::timestamp at time zone 'Asia/Kolkata'),
  check(additional_amount=round(approved_additional_km*travel_rate,2)),
  check(status<>'approved' or (travel_rate>0 and approved_additional_km>0 and approved_by is not null and approved_at is not null and verified_included_km is not null and verified_included_km>=0 and length(inclusion_resolution)>=20 and approved_additional_km<=journey_total_km-verified_included_km))
);
create unique index fo_october_recovery_unique_journey on public.fo_october_km_recoveries(employee_code,attendance_date,journey_fingerprint) where status in ('pending','approved');
create index fo_october_recovery_reporting on public.fo_october_km_recoveries(employee_code,attendance_date,status);
create table public.fo_october_km_recovery_events (
  id bigint generated always as identity primary key,
  recovery_id uuid not null references public.fo_october_km_recoveries(id),
  actor_id uuid not null,
  action text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.fo_october_recovery_activation enable row level security;
alter table public.fo_october_km_recoveries enable row level security;
alter table public.fo_october_km_recovery_events enable row level security;
-- Same service-only convention as existing financial receipts. No browser grant.
revoke all on public.fo_october_recovery_activation, public.fo_october_km_recoveries, public.fo_october_km_recovery_events from public,anon,authenticated,service_role;
grant select on public.fo_october_recovery_activation,public.fo_october_km_recoveries,public.fo_october_km_recovery_events to service_role;

create function public.fo_october_recovery_actor(p_actor uuid) returns public.profiles
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor public.profiles%rowtype;
begin
  if (select count(*) from public.profiles where auth_user_id=p_actor and is_active)<>1 then raise exception 'recovery_admin_ambiguous' using errcode='42501'; end if;
  select * into strict actor from public.profiles where auth_user_id=p_actor and is_active;
  if regexp_replace(upper(coalesce(actor.role,'')),'[^A-Z0-9]','','g') not in ('ADMIN','QPMSADMIN')
    or lower(coalesce(to_jsonb(actor)->>'status','active'))<>'active'
    or coalesce((to_jsonb(actor)->>'web_access_enabled')::boolean,true) is false then raise exception 'recovery_admin_required' using errcode='42501'; end if;
  return actor;
end $$;

create function public.fo_october_recovery_state(p_employee text,p_date date) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
select jsonb_build_object(
 'attendance',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'updated_at',a.updated_at,'payable',a.total_approved_km,'petrol',a.petrol_amount,'mode',a.travel_mode,'allowed',a.payable_km_allowed,'rate',a.rate_per_km) order by a.id) from public.fo_attendance a where upper(a.employee_code)=p_employee and a.attendance_date=p_date),'[]'::jsonb),
 'legs',coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.fo_travel_legs l join public.fo_attendance a on a.id=l.attendance_id where upper(a.employee_code)=p_employee and a.attendance_date=p_date),'[]'::jsonb),
 'approvals',coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.fo_km_financial_approvals f join public.fo_attendance a on a.id=f.attendance_id where upper(a.employee_code)=p_employee and a.attendance_date=p_date),'[]'::jsonb),
 'corrections',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from public.fo_travel_reimbursement_corrections c where upper(c.employee_code)=p_employee and c.attendance_date=p_date),'[]'::jsonb),
 'settlements',coalesce((select jsonb_agg(to_jsonb(s) order by s.id) from public.fo_monthly_travel_settlements s where upper(s.employee_code)=p_employee and p_date between s.period_start and s.period_end),'[]'::jsonb)
);
$$;

create function public.rpc_submit_fo_october_recovery_v1(p_actor uuid,p_request jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor public.profiles%rowtype; person public.profiles%rowtype; gate public.fo_october_recovery_activation%rowtype;
 r public.fo_october_km_recoveries%rowtype; code text:=upper(btrim(p_request->>'employee_code')); d date:=(p_request->>'date')::date;
 mode text:=p_request->>'travel_mode'; rate numeric; prior public.fo_october_km_recoveries%rowtype; existing_km numeric; existing_amount numeric;
begin
 actor:=public.fo_october_recovery_actor(p_actor);
 select * into strict gate from public.fo_october_recovery_activation where singleton for share;
 if not gate.requests_enabled or not coalesce(p_actor=any(gate.allowed_admins),false) then raise exception 'recovery_requests_inactive' using errcode='42501'; end if;
 if jsonb_typeof(p_request)<>'object' or d not between '2026-10-01' and '2026-10-31'
  or length(coalesce(p_request->>'start_location',''))<3 or length(coalesce(p_request->>'destination',''))<3
  or length(coalesce(p_request->>'explanation',''))<3 or length(coalesce(p_request->>'journey_type',''))<3
  or coalesce(p_request->>'idempotency_key','') !~ '^[A-Za-z0-9_-]{16,100}$'
  or jsonb_typeof(p_request->'intermediate_stops') is distinct from 'array' or jsonb_array_length(p_request->'intermediate_stops')>10
  or jsonb_typeof(p_request->'evidence_refs') is distinct from 'array' or jsonb_array_length(p_request->'evidence_refs')>10
  then raise exception 'recovery_request_invalid' using errcode='22023'; end if;
 if (select count(*) from public.profiles where upper(employee_code)=code and is_active)<>1 then raise exception 'recovery_employee_ambiguous' using errcode='42501'; end if;
 select * into strict person from public.profiles where upper(employee_code)=code and is_active;
 if person.auth_user_id=p_actor or upper(actor.employee_code)=code then raise exception 'recovery_self_approval_forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('october_recovery:'||code||':'||d::text,0));
 select * into prior from public.fo_october_km_recoveries where request_key=p_request->>'idempotency_key';
 if found then
  if prior.submitted_by<>p_actor or prior.request_payload is distinct from p_request then raise exception 'recovery_idempotency_conflict' using errcode='23505'; end if;
  return to_jsonb(prior);
 end if;
 -- Lock canonical parents without changing them. Existing 237 guards remain intact.
 perform 1 from public.fo_attendance where upper(employee_code)=code and attendance_date=d order by id for update;
 if exists(select 1 from public.fo_attendance where upper(employee_code)=code and attendance_date=d and ((nullif(btrim(travel_mode),'') is not null and lower(btrim(travel_mode)) is distinct from mode) or (payable_km_allowed is false and mode in ('bike','own_vehicle','car')))) then
  raise exception 'recovery_recorded_transport_mismatch_or_ineligible' using errcode='22023';
 end if;
 rate:=case mode when 'bike' then 4 when 'own_vehicle' then 4 when 'car' then 8 else 0 end;
 if mode in ('bike','own_vehicle','car') then
  if (select count(distinct rate_per_km) from public.fo_attendance where upper(employee_code)=code and attendance_date=d and rate_per_km is not null)>1 then raise exception 'recovery_rate_requires_review' using errcode='22023'; end if;
  select coalesce(min(rate_per_km),rate) into rate from public.fo_attendance where upper(employee_code)=code and attendance_date=d;
 end if;
 select case when count(*)=0 then 0 when count(total_approved_km)=count(*) then sum(total_approved_km) else null end,
   case when count(*)=0 then 0 when count(petrol_amount)=count(*) then sum(petrol_amount) else null end into existing_km,existing_amount
   from public.fo_attendance where upper(employee_code)=code and attendance_date=d;
 select existing_km+coalesce(sum(approved_additional_km),0),existing_amount+coalesce(sum(additional_amount),0) into existing_km,existing_amount from public.fo_october_km_recoveries where employee_code=code and attendance_date=d and status='approved';
 insert into public.fo_october_km_recoveries(employee_code,employee_name,attendance_date,attendance_id,journey_start,journey_end,journey_type,start_location,destination,intermediate_stops,recovery_reason,explanation,evidence_refs,requested_km,journey_total_km,travel_mode,travel_rate,submitted_by,before_state,request_key,request_payload,original_payable_km,resulting_payable_km,original_claim_amount,resulting_claim_amount,journey_fingerprint)
 values(code,coalesce(person.full_name,code),d,(select id from public.fo_attendance where upper(employee_code)=code and attendance_date=d order by id limit 1),
 (p_request->>'journey_start')::timestamptz,(p_request->>'journey_end')::timestamptz,p_request->>'journey_type',p_request->>'start_location',p_request->>'destination',p_request->'intermediate_stops',p_request->>'reason',p_request->>'explanation',p_request->'evidence_refs',
 (p_request->>'requested_km')::numeric,(p_request->>'journey_total_km')::numeric,mode,rate,p_actor,public.fo_october_recovery_state(code,d),p_request->>'idempotency_key',p_request,existing_km,existing_km,existing_amount,existing_amount,
 md5(jsonb_build_array((p_request->>'journey_start')::timestamptz,(p_request->>'journey_end')::timestamptz,lower(btrim(p_request->>'start_location')),lower(btrim(p_request->>'destination')))::text)) returning * into r;
 insert into public.fo_october_km_recovery_events(recovery_id,actor_id,action,snapshot) values(r.id,p_actor,'submitted',to_jsonb(r));
 return to_jsonb(r);
end $$;

create function public.rpc_decide_fo_october_recovery_v1(p_actor uuid,p_id uuid,p_version integer,p_action text,p_approved_km numeric,p_remarks text,p_included_km numeric,p_inclusion_resolution text,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor public.profiles%rowtype; gate public.fo_october_recovery_activation%rowtype; r public.fo_october_km_recoveries%rowtype;
 body jsonb; state jsonb; base_km numeric; base_amount numeric; credited_km numeric; credited_amount numeric; known_included numeric;
begin
 actor:=public.fo_october_recovery_actor(p_actor);
 select * into strict gate from public.fo_october_recovery_activation where singleton for share;
 -- Dedicated, explicit, expiring exception authorizes this ledger only. It does
 -- not open or change the emergency/maintenance/global canonical controls.
 if not gate.approvals_enabled or not gate.emergency_exception_approved or coalesce(length(gate.approval_reference),0)<10 or gate.expires_at is null or gate.expires_at<=now() or not coalesce(p_actor=any(gate.allowed_admins),false) then raise exception 'recovery_approval_inactive' using errcode='42501'; end if;
 perform 1 from public.fo_km_financial_control where control_key='canonical_v2' and financial_writes_enabled is false for share;
 if not found then raise exception 'recovery_global_gate_must_remain_closed' using errcode='55000'; end if;
 select * into strict r from public.fo_october_km_recoveries where id=p_id;
 if upper(actor.employee_code)=r.employee_code or exists(select 1 from public.profiles where upper(employee_code)=r.employee_code and auth_user_id=p_actor) then raise exception 'recovery_self_approval_forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('october_recovery:'||r.employee_code||':'||r.attendance_date::text,0));
 select * into strict r from public.fo_october_km_recoveries where id=p_id for update;
 body:=jsonb_build_array(p_actor,p_action,p_approved_km,p_remarks,p_included_km,p_inclusion_resolution);
 if coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9_-]{16,100}$' then raise exception 'recovery_decision_key_required' using errcode='22023'; end if;
 if r.status<>'pending' then
  if r.decision_key=p_idempotency_key and r.decision_payload=body then return to_jsonb(r); end if;
  raise exception 'recovery_decision_conflict' using errcode='40001';
 end if;
 if p_version is null or r.version<>p_version or p_action is null or p_action not in ('approve','reject') or coalesce(length(btrim(p_remarks)),0)<10 then raise exception 'recovery_decision_invalid' using errcode='22023'; end if;
 perform 1 from public.fo_attendance where upper(employee_code)=r.employee_code and attendance_date=r.attendance_date order by id for update;
 perform 1 from public.fo_travel_legs where attendance_id in(select id from public.fo_attendance where upper(employee_code)=r.employee_code and attendance_date=r.attendance_date) order by id for update;
 perform 1 from public.fo_monthly_travel_settlements where upper(employee_code)=r.employee_code and r.attendance_date between period_start and period_end order by id for share;
 state:=public.fo_october_recovery_state(r.employee_code,r.attendance_date);
 if p_action='approve' then
  if state is distinct from r.before_state then raise exception 'recovery_snapshot_stale' using errcode='40001'; end if;
  if r.travel_rate<=0 or p_approved_km is null or p_approved_km<=0 or p_approved_km>r.requested_km
   or p_approved_km<>round(p_approved_km,2) or p_included_km is null or p_included_km<0
   or p_approved_km>r.journey_total_km-p_included_km or coalesce(length(btrim(p_inclusion_resolution)),0)<20 then raise exception 'recovery_inclusion_or_mode_unverified' using errcode='22023'; end if;
  if exists(select 1 from public.fo_october_km_recoveries where employee_code=r.employee_code and attendance_date=r.attendance_date and status='approved' and journey_start<r.journey_end and journey_end>r.journey_start and id<>r.id) then raise exception 'recovery_overlapping_credit' using errcode='23505'; end if;
  select coalesce(sum(payable_km),0) into known_included from public.fo_travel_legs where attendance_id in(select id from public.fo_attendance where upper(employee_code)=r.employee_code and attendance_date=r.attendance_date)
   and superseded_at is null and status in ('completed','calculated') and started_at>=r.journey_start and ended_at<=r.journey_end and payable_km>0;
  if p_included_km<known_included then raise exception 'recovery_already_included_distance' using errcode='22023'; end if;
 end if;
 select case when count(*)=0 then 0 when count(total_approved_km)=count(*) then sum(total_approved_km) else null end,
   case when count(*)=0 then 0 when count(petrol_amount)=count(*) then sum(petrol_amount) else null end into base_km,base_amount
   from public.fo_attendance where upper(employee_code)=r.employee_code and attendance_date=r.attendance_date;
 if p_action='approve' and (base_km is null or base_amount is null) then raise exception 'recovery_saved_baseline_unknown' using errcode='22023'; end if;
 select coalesce(sum(approved_additional_km),0),coalesce(sum(additional_amount),0) into credited_km,credited_amount from public.fo_october_km_recoveries where employee_code=r.employee_code and attendance_date=r.attendance_date and status='approved';
 update public.fo_october_km_recoveries set status=case p_action when 'approve' then 'approved' else 'rejected' end,
 approved_additional_km=case p_action when 'approve' then p_approved_km else 0 end,
 additional_amount=case p_action when 'approve' then round(p_approved_km*travel_rate,2) else 0 end,
 verified_included_km=p_included_km,inclusion_resolution=p_inclusion_resolution,approved_by=p_actor,approved_at=now(),approval_remarks=p_remarks,
 original_payable_km=base_km+credited_km,resulting_payable_km=base_km+credited_km+case p_action when 'approve' then p_approved_km else 0 end,
 original_claim_amount=base_amount+credited_amount,resulting_claim_amount=base_amount+credited_amount+case p_action when 'approve' then round(p_approved_km*travel_rate,2) else 0 end,
 decision_key=p_idempotency_key,decision_payload=body,version=version+1 where id=p_id returning * into r;
 insert into public.fo_october_km_recovery_events(recovery_id,actor_id,action,snapshot) values(r.id,p_actor,p_action,to_jsonb(r));
 return to_jsonb(r);
end $$;
revoke all on function public.fo_october_recovery_actor(uuid),public.fo_october_recovery_state(text,date),public.rpc_submit_fo_october_recovery_v1(uuid,jsonb),public.rpc_decide_fo_october_recovery_v1(uuid,uuid,integer,text,numeric,text,numeric,text,text) from public,anon,authenticated;
grant execute on function public.rpc_submit_fo_october_recovery_v1(uuid,jsonb),public.rpc_decide_fo_october_recovery_v1(uuid,uuid,integer,text,numeric,text,numeric,text,text) to service_role;
-- Once an additive credit exists, a later canonical recalculation must not
-- absorb/re-credit it. Tracking-only updates and zero-value attendance creation
-- remain possible. Resolving a financial rebase needs a separate reviewed design.
create function public.fo_october_recovery_preserve_baseline() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare target jsonb; field text;
begin
 target:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if (target->>'attendance_date')::date between '2026-10-01' and '2026-10-31' then
  perform pg_advisory_xact_lock(hashtextextended('october_recovery:'||upper(target->>'employee_code')||':'||(target->>'attendance_date'),0));
 end if;
 if tg_op='UPDATE' and (old.employee_code is distinct from new.employee_code or old.attendance_date is distinct from new.attendance_date)
  and exists(select 1 from public.fo_october_km_recoveries where employee_code=upper(old.employee_code) and attendance_date=old.attendance_date and status='approved') then
  raise exception 'recovery_approved_baseline_protected' using errcode='55000';
 end if;
 if exists(select 1 from public.fo_october_km_recoveries where employee_code=upper(target->>'employee_code') and attendance_date=(target->>'attendance_date')::date and status='approved') then
  if tg_op='DELETE' then raise exception 'recovery_approved_baseline_protected' using errcode='55000'; end if;
  foreach field in array array['total_approved_km','eligible_km','total_route_km','petrol_amount','travel_mode','payable_km_allowed','rate_per_km'] loop
   if (tg_op='UPDATE' and to_jsonb(old)->field is distinct from target->field)
    or (tg_op='INSERT' and field in ('total_approved_km','eligible_km','total_route_km','petrol_amount') and coalesce((target->>field)::numeric,0)<>0) then
    raise exception 'recovery_approved_baseline_protected' using errcode='55000';
   end if;
  end loop;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger trg_october_recovery_preserve_baseline before insert or update or delete on public.fo_attendance for each row execute function public.fo_october_recovery_preserve_baseline();
revoke all on function public.fo_october_recovery_preserve_baseline() from public,anon,authenticated;
comment on table public.fo_october_km_recoveries is 'Additional approved October 2026 official travel only; report overlay, never canonical replacement or proof of payment.';
commit;
