-- PROPOSAL ONLY. Separate schema/security/release approval required. No backfill,
-- financial activation, replacement of V2, or changes to 237/238 protections.
begin;
create table public.fo_km_incremental_credits (
 id uuid primary key default gen_random_uuid(), attendance_id uuid not null references public.fo_attendance(id),
 employee_code text not null, attendance_date date not null, leg_key text not null,
 input_digest text not null, started_at timestamptz not null, ended_at timestamptz not null,
 baseline_km numeric not null check(baseline_km>=0), added_km numeric not null check(added_km>0),
 rate numeric not null check(rate>0), amount numeric not null check(amount=round(added_km*rate,2)),
 applied_to_attendance boolean not null, actor uuid, trigger_source text not null,
 evidence jsonb not null, transaction_id bigint not null default txid_current(), created_at timestamptz not null default now(),
 check(ended_at>started_at), unique(attendance_id,input_digest,leg_key)
);
create index fo_km_incremental_leg_history on public.fo_km_incremental_credits(attendance_id,leg_key);
create index fo_km_incremental_reporting on public.fo_km_incremental_credits(employee_code,attendance_date);
create table public.fo_km_reconciliation_jobs (
 attendance_id uuid primary key references public.fo_attendance(id), generation integer not null default 1,
 state text not null default 'pending' check(state in('pending','processing','deferred','posted','unchanged','failed')),
 trigger_source text not null, attempts integer not null default 0,
 not_before timestamptz not null default now(), lease uuid, lease_until timestamptz,
 claimed_generation integer, last_error text, updated_at timestamptz not null default now()
);
alter table public.fo_km_incremental_credits enable row level security;
alter table public.fo_km_reconciliation_jobs enable row level security;
revoke all on public.fo_km_incremental_credits,public.fo_km_reconciliation_jobs from public,anon,authenticated,service_role;
grant select on public.fo_km_incremental_credits to service_role;

create function public.fo_enqueue_km_reconciliation() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
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
 return new;
end $$;
create trigger trg_shared_km_end_day after insert or update of logout_time on public.fo_attendance for each row execute function public.fo_enqueue_km_reconciliation();
create trigger trg_shared_km_late_gps after insert on public.fo_location_logs for each row execute function public.fo_enqueue_km_reconciliation();

create function public.rpc_claim_fo_km_reconciliation_v1() returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.fo_km_reconciliation_jobs%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'km_service_required' using errcode='42501';end if;
 select * into j from public.fo_km_reconciliation_jobs where attempts<8 and not_before<=now()
 and (state in('pending','deferred') or (state='processing' and lease_until<now())) order by not_before for update skip locked limit 1;
 if not found then return null;end if;
 update public.fo_km_reconciliation_jobs set state='processing',lease=gen_random_uuid(),lease_until=now()+interval '3 minutes',claimed_generation=generation,attempts=attempts+1 where attendance_id=j.attendance_id returning * into j;
 return to_jsonb(j);
end $$;
create function public.rpc_finish_fo_km_reconciliation_v1(p_attendance uuid,p_lease uuid,p_posted boolean,p_error text) returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'km_service_required' using errcode='42501';end if;
 update public.fo_km_reconciliation_jobs set state=case when generation<>claimed_generation then 'pending' when p_posted and p_error='unchanged' then 'unchanged' when p_posted then 'posted' when p_error in('KM_FINANCIAL_WRITES_MAINTENANCE','KM_SHARED_RECONCILIATION_INACTIVE','55000') then 'deferred' when attempts>=8 then 'failed' else 'deferred' end,
 attempts=case when p_error in('KM_FINANCIAL_WRITES_MAINTENANCE','KM_SHARED_RECONCILIATION_INACTIVE','55000') then greatest(0,attempts-1) else attempts end,last_error=left(p_error,300),lease=null,lease_until=null,not_before=now()+case when p_error in('KM_FINANCIAL_WRITES_MAINTENANCE','KM_SHARED_RECONCILIATION_INACTIVE','55000') then interval '15 minutes' else interval '5 minutes' end,updated_at=now()
 where attendance_id=p_attendance and lease=p_lease;
end $$;

create function public.rpc_fo_km_reconciliation_state_v1(p_attendance_id uuid) returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare a public.fo_attendance%rowtype;s jsonb;c jsonb;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'km_service_required' using errcode='42501';end if;
 select * into strict a from public.fo_attendance where id=p_attendance_id;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.id),'[]') into c from public.fo_km_incremental_credits x where attendance_id=a.id;
 s:=jsonb_build_object('attendance',to_jsonb(a),'canonical',public.fo_october_recovery_state(upper(a.employee_code),a.attendance_date),'credits',c,'visits',(select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]') from public.fo_site_visits v where v.attendance_id=a.id),
 'recoveries',(select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from public.fo_october_km_recoveries r where employee_code=upper(a.employee_code) and attendance_date=a.attendance_date and status='approved'));
 return jsonb_build_object('digest',md5(s::text),'credits',c);
end $$;

create function public.rpc_reconcile_fo_incremental_km_v1(p_attendance_id uuid,p_calculation jsonb,p_trigger text,p_admin uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.fo_attendance%rowtype; actor public.profiles%rowtype; leg jsonb; original_km numeric; original_amount numeric; saved public.fo_travel_legs%rowtype; recorded_mode text; recorded_allowed boolean; included numeric; previous numeric; supplemental numeric; delta numeric; total_km numeric:=0;total_amount numeric:=0;rate numeric; credit_id uuid; receipt uuid; canonical boolean;known numeric; previous_financial_write_context text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'km_service_required' using errcode='42501';end if;
 -- This contract NEVER uses the P1 emergency exception. Ordinary global financial
 -- activation is mandatory, in addition to strict application pause/maintenance guards.
 perform 1 from public.fo_km_financial_control where control_key='canonical_v2' and financial_writes_enabled is true for share;
 if not found then raise exception 'km_v2_database_financial_writes_closed' using errcode='55000';end if;
 if p_trigger not in('admin_recalculation','manual_end_day','auto_end_day','late_gps') or p_trigger is null then raise exception 'km_trigger_invalid' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_attendance_id::text,0));
 select * into strict a from public.fo_attendance where id=p_attendance_id for update;
 -- Serialize across the P1 supplement path too. Same employee/date lock order
 -- as the immutable supplement baseline trigger; deadlock aborts remain atomic.
 perform pg_advisory_xact_lock(hashtextextended('october_recovery:'||upper(a.employee_code)||':'||a.attendance_date,0));
 if a.logout_time is null then raise exception 'km_completed_attendance_required' using errcode='55000';end if;
 if p_trigger='admin_recalculation' then
   actor:=public.fo_october_recovery_actor(p_admin);
   if upper(actor.employee_code)=upper(a.employee_code) then raise exception 'km_self_approval_forbidden' using errcode='42501';end if;
 elsif not exists(select 1 from public.fo_km_reconciliation_jobs where attendance_id=a.id and lease=p_lease and lease_until>now() and state='processing' and trigger_source=p_trigger) then
   raise exception 'km_worker_lease_required' using errcode='42501';
 end if;
 -- Exact committed retry returns the original immutable receipt, never a new credit.
 select id into receipt from public.fo_km_incremental_credits where attendance_id=a.id and input_digest=p_calculation->>'inputDigest' order by id limit 1;
 if receipt is not null then return jsonb_build_object('receipt_id',receipt,'additionalKm',0,'additionalAmount',0,'idempotent_replay',true);end if;
 if a.total_approved_km is null or a.petrol_amount is null or a.eligible_km is null or a.total_route_km is null then raise exception 'km_saved_baseline_unknown' using errcode='22023';end if;
 if p_calculation->>'calculationVersion' is distinct from 'KM_ENGINE_V2' or p_calculation->>'baselineKnown' is distinct from 'true'
 or coalesce(p_calculation->>'inputDigest','')!~'^[0-9a-f]{64}$' or (p_calculation->>'snapshot') is distinct from (public.rpc_fo_km_reconciliation_state_v1(a.id)->>'digest') then
   raise exception 'km_reconciliation_snapshot_stale_or_unverified' using errcode='40001';end if;
 perform 1 from public.fo_site_visits where attendance_id=a.id order by id for share;
 perform 1 from public.fo_travel_legs where attendance_id=a.id order by id for share;
 perform 1 from public.fo_monthly_travel_settlements where upper(employee_code)=upper(a.employee_code) and a.attendance_date between period_start and period_end for share;
 if (p_calculation->>'snapshot') is distinct from (public.rpc_fo_km_reconciliation_state_v1(a.id)->>'digest') then raise exception 'km_snapshot_changed_while_locking' using errcode='40001';end if;
 original_km:=a.total_approved_km+(select coalesce(sum(added_km),0) from public.fo_km_incremental_credits where attendance_id=a.id and not applied_to_attendance)+(select coalesce(sum(approved_additional_km),0) from public.fo_october_km_recoveries where employee_code=upper(a.employee_code) and attendance_date=a.attendance_date and status='approved');
 original_amount:=a.petrol_amount+(select coalesce(sum(amount),0) from public.fo_km_incremental_credits where attendance_id=a.id and not applied_to_attendance)+(select coalesce(sum(additional_amount),0) from public.fo_october_km_recoveries where employee_code=upper(a.employee_code) and attendance_date=a.attendance_date and status='approved');
 canonical:=not exists(select 1 from public.fo_monthly_travel_settlements where upper(employee_code)=upper(a.employee_code) and a.attendance_date between period_start and period_end)
   and not exists(select 1 from public.fo_october_km_recoveries where employee_code=upper(a.employee_code) and attendance_date=a.attendance_date and status='approved');
 for leg in select value from jsonb_array_elements(p_calculation->'legs') loop
   if coalesce((leg->>'new_eligible_km')::numeric,0)<=0 then continue;end if;
   recorded_mode:=regexp_replace(lower(btrim(a.travel_mode)),'[ -]+','_','g');rate:=a.rate_per_km;recorded_allowed:=a.payable_km_allowed;
   if nullif(leg->>'persisted_travel_leg_id','') is not null then
     select * into strict saved from public.fo_travel_legs where id=(leg->>'persisted_travel_leg_id')::uuid and attendance_id=a.id;
     if (leg->>'from_time')::timestamptz is distinct from saved.started_at or (leg->>'to_time')::timestamptz is distinct from saved.ended_at or saved.payable_km_allowed is false then raise exception 'km_recorded_leg_mode_unverified' using errcode='22023';end if;
     recorded_mode:=regexp_replace(lower(btrim(saved.travel_mode)),'[ -]+','_','g');rate:=saved.rate_per_km;recorded_allowed:=saved.payable_km_allowed;
   end if;
   if leg->>'from_time' is null or leg->>'to_time' is null or leg->>'source' is null or leg->>'leg_key' is null or leg->>'travel_mode' is null or leg->>'payable_km' is null or leg->>'rate_per_km' is null or leg->>'baseline_km' is null or (leg->>'baseline_km')::numeric<0 or leg->>'evidence_status' is distinct from 'supported' or leg->>'source' not in('GPS_BASED','GPS_ROUTE_SUPPORTED','GOOGLE_ROUTE_FALLBACK','FULL_DAY_GPS_NO_SITE')
      or leg->>'payable' is distinct from 'true' or leg->>'leg_key'!~'^[0-9a-f]{64}$'
      or recorded_mode not in('bike','own_vehicle','car') or recorded_mode is null or recorded_allowed is false
      or leg->>'travel_mode'<>recorded_mode or (leg->>'from_time')::timestamptz<a.login_time
      or (leg->>'to_time')::timestamptz>a.logout_time or (leg->>'to_time')::timestamptz<=(leg->>'from_time')::timestamptz then
     raise exception 'km_increment_evidence_invalid' using errcode='22023';end if;
   if rate is null or rate<=0 or (leg->>'rate_per_km')::numeric<>rate then raise exception 'km_rate_unverified' using errcode='22023';end if;
   included:=(leg->>'baseline_km')::numeric;
   select coalesce(sum(added_km),0) into previous from public.fo_km_incremental_credits where attendance_id=a.id and leg_key=leg->>'leg_key';
   select coalesce(sum(approved_additional_km),0) into supplemental from public.fo_october_km_recoveries where employee_code=upper(a.employee_code) and attendance_date=a.attendance_date and status='approved' and journey_start>=(leg->>'from_time')::timestamptz and journey_end<=(leg->>'to_time')::timestamptz;
   delta:=round(greatest(0,(leg->>'payable_km')::numeric-included-previous-supplemental),2);
   if delta is distinct from (leg->>'new_eligible_km')::numeric then raise exception 'km_increment_stale' using errcode='40001';end if;
   if exists(select 1 from public.fo_km_incremental_credits where attendance_id=a.id and leg_key<>leg->>'leg_key' and started_at<(leg->>'to_time')::timestamptz and ended_at>(leg->>'from_time')::timestamptz) then raise exception 'km_increment_overlap' using errcode='23505';end if;
   insert into public.fo_km_incremental_credits(attendance_id,employee_code,attendance_date,leg_key,input_digest,started_at,ended_at,baseline_km,added_km,rate,amount,applied_to_attendance,actor,trigger_source,evidence)
   values(a.id,upper(a.employee_code),a.attendance_date,leg->>'leg_key',p_calculation->>'inputDigest',(leg->>'from_time')::timestamptz,(leg->>'to_time')::timestamptz,included,delta,rate,round(delta*rate,2),canonical,p_admin,p_trigger,leg||jsonb_build_object('original_payable_km',original_km+total_km,'resulting_payable_km',original_km+total_km+delta,'original_claim_amount',original_amount+total_amount,'resulting_claim_amount',original_amount+total_amount+round(delta*rate,2),'before_state',public.fo_october_recovery_state(upper(a.employee_code),a.attendance_date),'canonical_after',jsonb_build_object('total_approved_km',a.total_approved_km+total_km+delta,'eligible_km',a.eligible_km+total_km+delta,'total_route_km',a.total_route_km+total_km+delta,'petrol_amount',a.petrol_amount+total_amount+round(delta*rate,2)))) returning id into credit_id;
   receipt:=coalesce(receipt,credit_id);total_km:=total_km+delta;total_amount:=total_amount+round(delta*rate,2);
 end loop;
 if receipt is null then raise exception 'km_no_supported_increment' using errcode='22023';end if;
 if canonical then
   -- All role/lease, global-gate, snapshot and evidence checks above must pass.
   -- This existing V2 marker is private to the guarded UPDATE, not an RPC input
   -- or a session-wide permission. Restore the caller context on every exit.
   previous_financial_write_context:=pg_catalog.current_setting('app.km_v2_authorized_financial_write',true);
   begin
   perform pg_catalog.set_config('app.km_v2_authorized_financial_write','true',true);
   update public.fo_attendance set total_approved_km=total_approved_km+total_km,eligible_km=eligible_km+total_km,
   total_route_km=total_route_km+total_km,petrol_amount=petrol_amount+total_amount,
   route_sync_status='canonical_v2_incremental_persisted',metadata=coalesce(metadata,'{}')||jsonb_build_object('effective_end_evidence',p_calculation->'effectiveEnd','shared_km_last_receipt',receipt,'km_recalculation_status',case when jsonb_array_length(coalesce(p_calculation->'unresolved','[]'))>0 then 'partial' else 'complete' end,'shared_km_final_leg',(select value from jsonb_array_elements(p_calculation->'legs') where value->>'type'='last_checkout_to_end_day' limit 1)),updated_at=now() where id=a.id;
   perform pg_catalog.set_config('app.km_v2_authorized_financial_write',coalesce(previous_financial_write_context,''),true);
   exception when others then
     perform pg_catalog.set_config('app.km_v2_authorized_financial_write',coalesce(previous_financial_write_context,''),true);
     raise;
   end;
 end if;
 return jsonb_build_object('receipt_id',receipt,'additionalKm',total_km,'additionalAmount',total_amount,
 'finalPayableKm',original_km+total_km,'applied_to_attendance',canonical,'settled_values_unchanged',true);
end $$;
-- Bidirectional overlap protection: a later P1 approval cannot repay a movement
-- already credited automatically, including non-canonical settled supplements.
create function public.fo_km_protect_cross_ledger_credit() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare credited numeric; canonical numeric;
begin
 if new.status<>'approved' then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended('october_recovery:'||new.employee_code||':'||new.attendance_date,0));
 if exists(select 1 from public.fo_km_incremental_credits where employee_code=new.employee_code and attendance_date=new.attendance_date and started_at<new.journey_end and ended_at>new.journey_start and (started_at<new.journey_start or ended_at>new.journey_end)) then raise exception 'km_cross_ledger_partial_overlap' using errcode='23505';end if;
 select coalesce(sum(added_km),0) into credited from public.fo_km_incremental_credits where employee_code=new.employee_code and attendance_date=new.attendance_date and started_at>=new.journey_start and ended_at<=new.journey_end;
 if credited=0 then return new;end if;
 select coalesce(sum(l.payable_km),0) into canonical from public.fo_travel_legs l join public.fo_attendance a on a.id=l.attendance_id where upper(a.employee_code)=new.employee_code and a.attendance_date=new.attendance_date and l.superseded_at is null and l.status in('completed','calculated') and l.started_at>=new.journey_start and l.ended_at<=new.journey_end;
 if new.verified_included_km is null or new.verified_included_km<credited+canonical then raise exception 'km_cross_ledger_already_credited' using errcode='22023';end if;
 return new;
end $$;
create trigger trg_cross_ledger_km_credit before insert or update of status,approved_additional_km,verified_included_km on public.fo_october_km_recoveries for each row execute function public.fo_km_protect_cross_ledger_credit();
revoke all on function public.fo_km_protect_cross_ledger_credit() from public,anon,authenticated,service_role;

-- Legacy recalculations must never absorb or overwrite an additive receipt.
-- A financial UPDATE requires an exact immutable receipt created in this same
-- transaction, and may never lower an already credited amount. Tracking updates
-- remain unaffected. Settled/P1 days still use ledger-only supplements.
create function public.fo_km_preserve_incremental_baseline() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare target jsonb;
begin
 if not exists(select 1 from public.fo_km_incremental_credits where attendance_id=old.id) then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then raise exception 'km_incremental_baseline_protected' using errcode='55000';end if;
 if (new.employee_code,new.attendance_date,new.travel_mode,new.rate_per_km,new.payable_km_allowed) is distinct from (old.employee_code,old.attendance_date,old.travel_mode,old.rate_per_km,old.payable_km_allowed) then raise exception 'km_incremental_identity_mode_protected' using errcode='55000';end if;
 if (new.total_approved_km,new.eligible_km,new.total_route_km,new.petrol_amount) is not distinct from (old.total_approved_km,old.eligible_km,old.total_route_km,old.petrol_amount) then return new;end if;
 target:=jsonb_build_object('total_approved_km',new.total_approved_km,'eligible_km',new.eligible_km,'total_route_km',new.total_route_km,'petrol_amount',new.petrol_amount);
 if new.total_approved_km<old.total_approved_km or new.petrol_amount<old.petrol_amount or not exists(select 1 from public.fo_km_incremental_credits where attendance_id=old.id and applied_to_attendance and transaction_id=txid_current() and evidence->'canonical_after'=target) then raise exception 'km_incremental_baseline_protected' using errcode='55000';end if;
 return new;
end $$;
create trigger trg_preserve_incremental_km_baseline before update or delete on public.fo_attendance for each row execute function public.fo_km_preserve_incremental_baseline();
revoke all on function public.fo_km_preserve_incremental_baseline() from public,anon,authenticated,service_role;

revoke all on function public.fo_enqueue_km_reconciliation(),public.rpc_claim_fo_km_reconciliation_v1(),public.rpc_finish_fo_km_reconciliation_v1(uuid,uuid,boolean,text),public.rpc_fo_km_reconciliation_state_v1(uuid),public.rpc_reconcile_fo_incremental_km_v1(uuid,jsonb,text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.rpc_claim_fo_km_reconciliation_v1(),public.rpc_finish_fo_km_reconciliation_v1(uuid,uuid,boolean,text),public.rpc_fo_km_reconciliation_state_v1(uuid),public.rpc_reconcile_fo_incremental_km_v1(uuid,jsonb,text,uuid,uuid) to service_role;
commit;
