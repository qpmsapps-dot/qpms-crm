-- Separate approval required. Refuse to erase any authorization/audit/credit evidence.
begin;set local lock_timeout='5s';
lock table public.fo_km_scope_authorizations,public.fo_km_scope_executions,public.fo_km_scope_audit,public.fo_km_scope_control in access exclusive mode;
do $$begin if exists(select 1 from public.fo_km_scope_authorizations) or exists(select 1 from public.fo_km_scope_executions) or exists(select 1 from public.fo_km_scope_audit) or exists(select 1 from public.fo_km_scope_control where not emergency_pause) then raise exception 'km240_rollback_preserve_scope_history';end if;end $$;
drop trigger zz_km_scope_financial_guard on public.fo_attendance;
drop trigger km_scope_ledger_guard on public.fo_km_incremental_credits;
drop trigger km_scope_authorization_audit on public.fo_km_scope_authorizations;
drop trigger km_scope_control_audit on public.fo_km_scope_control;
drop function public.rpc_reconcile_fo_scoped_km_v1(uuid,jsonb,uuid,text);
drop function public.fo_km_scope_financial_guard();
drop function public.fo_km_scope_ledger_guard();
drop function public.fo_km_scope_audit_change();
create or replace function public.rpc_reconcile_fo_incremental_km_v1(p_attendance_id uuid,p_calculation jsonb,p_trigger text,p_admin uuid,p_lease uuid) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
drop function public.fo_reconcile_km_239_core(uuid,jsonb,text,uuid,uuid);
drop table public.fo_km_scope_executions;
drop table public.fo_km_scope_authorizations;
drop table public.fo_km_scope_audit;
drop table public.fo_km_scope_control;
commit;
