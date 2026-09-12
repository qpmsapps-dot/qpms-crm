begin;

-- NIMS production routing is explicit. User accounts remain active so historical
-- references and controlled test access are preserved.
do $$
declare
  v_nims_client_id constant uuid := 'bfb5d707-1a4e-451d-af1f-11b7c0aeeb66';
  v_expected record;
begin
  if not exists (
    select 1 from public.hospital_clients
    where id = v_nims_client_id
      and client_code = 'NIMS_HYDERABAD'
      and is_active = true
  ) then
    raise exception 'Canonical active NIMS client does not match migration 071 prerequisites.';
  end if;

  for v_expected in
    select * from (values
      ('34b2efc3-0a28-44fc-85d4-88115227dbed'::uuid, 'CHITTALA RAMU', 'housekeeping_supervisor'),
      ('67756352-98cb-4b60-955d-d0aa9abd384b'::uuid, 'VENKATA SESHA SAYI LAKKANIGE', 'housekeeping_supervisor'),
      ('40ec4df4-9bec-4b3a-8c6e-41559bfcea5d'::uuid, 'PRAVEEN KUMAR MARNENI', 'housekeeping_supervisor'),
      ('f3ba0678-468a-4b7a-bd65-8605a6c96015'::uuid, 'V MAHARUDHRA SASTHRI', 'housekeeping_supervisor'),
      ('1c538cd0-4ba8-406f-b916-1003b6ad6339'::uuid, 'CHIMALADINNE SHIVA KUMAR', 'housekeeping_supervisor'),
      ('04806a4d-6a8e-4018-86dd-b3ec1d924658'::uuid, 'ARRA RAVI', 'housekeeping_supervisor'),
      ('acad77d9-16d2-47fc-b1b8-91f16580f21b'::uuid, 'KHAJIPURAM SRINIVAS', 'housekeeping_supervisor'),
      ('f2e46f67-98b6-41bb-9c72-a6f0a6c707d7'::uuid, 'VANGURU LENIN', 'housekeeping_supervisor'),
      ('cf391383-37d7-4346-aa58-1fcdac7f77e1'::uuid, 'ANJANEYA REDDY VENNA', 'housekeeping_supervisor'),
      ('597d69ce-cf2f-441d-ad28-fd2aee8d366a'::uuid, 'MR MUDITHAPALLY SRINIVAS', 'housekeeping_supervisor'),
      ('ecea828c-c419-47b1-a962-e7c0e5fff19e'::uuid, 'Koduri Kishore Kumar', 'operations_executive'),
      ('db983e24-31fc-4c77-baf4-95068643476f'::uuid, 'Alli Chandrika', 'facility_manager')
    ) as expected(id, display_name, role_code)
  loop
    if not exists (
      select 1
      from public.hospital_ticket_users u
      where u.id = v_expected.id
        and u.client_id = v_nims_client_id
        and u.display_name = v_expected.display_name
        and u.role_code = v_expected.role_code
        and u.profile_type = 'internal'
        and u.is_active = true
    ) then
      raise exception 'NIMS routing prerequisite failed for % (%).', v_expected.display_name, v_expected.id;
    end if;
  end loop;

  if exists (
    select 1
    from public.hospital_ticket_users u
    where u.client_id = v_nims_client_id
      and u.role_code = 'project_head'
      and u.is_active = true
      and coalesce((u.metadata->>'test_user')::boolean, false) = false
      and coalesce((u.metadata->>'do_not_use_for_real_staff')::boolean, false) = false
  ) then
    raise exception 'A real NIMS Project Head now exists; configure and verify that user before applying migration 071.';
  end if;
end $$;

-- Clear eligibility for every NIMS operational recipient, then explicitly
-- enable only the management-confirmed production pool.
update public.hospital_ticket_users
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'production_routing_eligible', false,
  'production_routing_source', 'migration_071_nims_verified_escalation_routing'
)
where client_id = 'bfb5d707-1a4e-451d-af1f-11b7c0aeeb66'::uuid
  and role_code in ('housekeeping_supervisor', 'operations_executive', 'facility_manager', 'project_head');

update public.hospital_ticket_users
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'production_routing_eligible', true,
  'production_routing_verified', true,
  'production_routing_source', 'management_confirmed_migration_071'
)
where client_id = 'bfb5d707-1a4e-451d-af1f-11b7c0aeeb66'::uuid
  and id in (
    '34b2efc3-0a28-44fc-85d4-88115227dbed'::uuid,
    '67756352-98cb-4b60-955d-d0aa9abd384b'::uuid,
    '40ec4df4-9bec-4b3a-8c6e-41559bfcea5d'::uuid,
    'f3ba0678-468a-4b7a-bd65-8605a6c96015'::uuid,
    '1c538cd0-4ba8-406f-b916-1003b6ad6339'::uuid,
    '04806a4d-6a8e-4018-86dd-b3ec1d924658'::uuid,
    'acad77d9-16d2-47fc-b1b8-91f16580f21b'::uuid,
    'f2e46f67-98b6-41bb-9c72-a6f0a6c707d7'::uuid,
    'cf391383-37d7-4346-aa58-1fcdac7f77e1'::uuid,
    '597d69ce-cf2f-441d-ad28-fd2aee8d366a'::uuid,
    'ecea828c-c419-47b1-a962-e7c0e5fff19e'::uuid,
    'db983e24-31fc-4c77-baf4-95068643476f'::uuid
  );

-- Preserve controlled test logins, but make their routing purpose explicit.
update public.hospital_ticket_users
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'test_user', true,
  'do_not_use_for_real_staff', true,
  'production_routing_eligible', false,
  'production_routing_source', 'migration_071_test_exclusion'
)
where client_id = 'bfb5d707-1a4e-451d-af1f-11b7c0aeeb66'::uuid
  and id in (
    '84ef6e42-caa2-426b-af88-a5096a7fc2a2'::uuid,
    'e2407733-42ce-49a5-bb85-5f2db2696639'::uuid,
    'e2e8522f-6d84-43f3-80c0-eeb137a41eec'::uuid,
    '5d956b83-4d41-4474-ac7d-d6b86682f582'::uuid,
    '42713526-f625-404f-8c92-da9062c706ab'::uuid
  );

create index if not exists idx_hospital_ticket_users_production_routing
  on public.hospital_ticket_users(client_id, role_code, is_active)
  where metadata @> '{"production_routing_eligible": true}'::jsonb;

create or replace function public.hospital_ticket_is_production_routing_eligible(
  p_user public.hospital_ticket_users
)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(p_user.is_active, false)
    and p_user.profile_type = 'internal'
    and coalesce((p_user.metadata->>'test_user')::boolean, false) = false
    and coalesce((p_user.metadata->>'demo')::boolean, false) = false
    and coalesce((p_user.metadata->>'do_not_use_for_real_staff')::boolean, false) = false
    and (
      p_user.client_id <> 'bfb5d707-1a4e-451d-af1f-11b7c0aeeb66'::uuid
      or coalesce((p_user.metadata->>'production_routing_eligible')::boolean, false) = true
    )
$$;

create or replace function public.hospital_ticket_is_on_duty_supervisor(
  p_user public.hospital_ticket_users
)
returns boolean
language sql
stable
set search_path = public
as $$
  select public.hospital_ticket_is_production_routing_eligible(p_user)
    and p_user.role_code = 'housekeeping_supervisor'
    and coalesce(p_user.duty_status, 'off_duty') = 'on_duty'
$$;

create or replace function public.hospital_ticket_on_duty_supervisors(
  p_client_id uuid,
  p_block_id uuid,
  p_location_id uuid
)
returns setof public.hospital_ticket_users
language sql
stable
security definer
set search_path = public
as $$
  select distinct u.*
  from public.hospital_ticket_users u
  join public.hospital_ticket_user_scopes s on s.hospital_ticket_user_id = u.id
  where u.client_id = p_client_id
    and public.hospital_ticket_is_on_duty_supervisor(u)
    and s.client_id = p_client_id
    and s.can_update
    and (
      s.scope_type = 'client'
      or (s.scope_type = 'block' and s.block_id = p_block_id)
      or (s.scope_type = 'location' and s.location_id = p_location_id)
    )
  order by u.display_name, u.id
$$;

create or replace function public.hospital_pick_ticket_owner(p_client_id uuid, p_role text)
returns public.hospital_ticket_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.hospital_ticket_users%rowtype;
  v_candidate_count integer;
begin
  if p_client_id = 'bfb5d707-1a4e-451d-af1f-11b7c0aeeb66'::uuid then
    select count(*)
      into v_candidate_count
    from public.hospital_ticket_users u
    where u.client_id = p_client_id
      and u.role_code = p_role
      and public.hospital_ticket_is_production_routing_eligible(u)
      and exists (
        select 1
        from public.hospital_ticket_user_scopes s
        where s.hospital_ticket_user_id = u.id
          and s.client_id = p_client_id
          and s.scope_type = 'client'
          and s.can_update = true
      );

    if v_candidate_count <> 1 then
      return null;
    end if;

    select * into v_user
    from public.hospital_ticket_users u
    where u.client_id = p_client_id
      and u.role_code = p_role
      and public.hospital_ticket_is_production_routing_eligible(u)
      and exists (
        select 1
        from public.hospital_ticket_user_scopes s
        where s.hospital_ticket_user_id = u.id
          and s.client_id = p_client_id
          and s.scope_type = 'client'
          and s.can_update = true
      );
    return v_user;
  end if;

  select * into v_user
  from public.hospital_ticket_users u
  where u.client_id = p_client_id
    and u.profile_type = 'internal'
    and u.role_code = p_role
    and public.hospital_ticket_is_production_routing_eligible(u)
  order by u.created_at
  limit 1;
  return v_user;
end $$;

create or replace function public.hospital_ticket_pick_operations_owner(p_client_id uuid)
returns public.hospital_ticket_users
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.hospital_pick_ticket_owner(p_client_id, 'operations_executive');
end $$;

-- This legacy alert trigger remains part of ticket creation/reopen handling.
-- Filter its recipients through the same production-routing decision.
create or replace function public.hospital_ticket_assignment_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' and new.supervisor_user_id is null then
    insert into public.hospital_ticket_events(ticket_id,event_type,to_status,actor_name,actor_role,remarks,event_data)
    values (
      new.id,'ticket_unassigned',new.status_code,'QPMS Assignment Engine','system',
      'No verified active Supervisor routing rule matched this ticket.',
      jsonb_build_object('reason',coalesce(new.metadata->>'assignment_failure_reason','no_verified_active_shift_assignment'))
    ) on conflict do nothing;
    insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body)
    select new.id,u.id,'assignment_alert','Unassigned housekeeping ticket',new.ticket_no||' requires a verified Supervisor mapping.'
    from public.hospital_ticket_users u
    where u.client_id = new.client_id
      and u.role_code in ('operations_executive','facility_manager')
      and public.hospital_ticket_is_production_routing_eligible(u);
  elsif tg_op = 'UPDATE' and old.status_code = 'resolved_awaiting_confirmation' and new.status_code = 'reopened' then
    perform public.hospital_record_assignment_history(
      new.id, old.current_assignee_user_id, new.supervisor_user_id,
      new.metadata->>'assignment_type',
      nullif(new.metadata->>'routing_assignment_id','')::uuid,
      nullif(new.metadata->>'routing_shift_id','')::uuid,
      coalesce(new.metadata->>'routing_reason','reopened_routing'),
      null, case when new.supervisor_user_id is null then 'unassigned' else 'automatic' end,
      old.status_code, new.status_code, coalesce(new.metadata,'{}'::jsonb)
    );
    insert into public.hospital_ticket_events(ticket_id,event_type,from_status,to_status,actor_name,actor_role,remarks,event_data)
    values (
      new.id,
      case when new.supervisor_user_id is null then 'reopened_unassigned' else 'reopened_sla_restarted' end,
      old.status_code,new.status_code,'QPMS SLA Engine','system',
      case when new.supervisor_user_id is null then 'Ticket reopened but no verified active Supervisor routing rule matched.'
        else 'Supervisor SLA restarted for 20 minutes after client requested rework.' end,
      jsonb_build_object('sla_cycle',new.reopen_count,'supervisor_due_at',new.supervisor_sla_due_at,'routing_reason',new.metadata->>'routing_reason')
    ) on conflict do nothing;
    if new.supervisor_user_id is not null then
      insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body)
      values(new.id,new.supervisor_user_id,'ticket_reopened','Client requested rework',new.ticket_no||' has a new 20-minute Supervisor SLA.');
    else
      insert into public.hospital_ticket_notifications(ticket_id,recipient_user_id,notification_type,title,body)
      select new.id,u.id,'assignment_alert','Reopened ticket is unassigned',new.ticket_no||' requires a verified Supervisor mapping.'
      from public.hospital_ticket_users u
      where u.client_id = new.client_id
        and u.role_code in ('operations_executive','facility_manager')
        and public.hospital_ticket_is_production_routing_eligible(u);
    end if;
  end if;
  return null;
end $$;

revoke all on function public.hospital_ticket_is_production_routing_eligible(public.hospital_ticket_users)
  from public, anon, authenticated;
revoke all on function public.hospital_ticket_is_on_duty_supervisor(public.hospital_ticket_users)
  from public, anon, authenticated;
revoke all on function public.hospital_ticket_on_duty_supervisors(uuid,uuid,uuid)
  from public, anon, authenticated;
revoke all on function public.hospital_pick_ticket_owner(uuid,text)
  from public, anon, authenticated;
revoke all on function public.hospital_ticket_pick_operations_owner(uuid)
  from public, anon, authenticated;
revoke all on function public.hospital_ticket_assignment_events()
  from public, anon, authenticated;

grant execute on function public.hospital_ticket_is_production_routing_eligible(public.hospital_ticket_users) to service_role;
grant execute on function public.hospital_ticket_is_on_duty_supervisor(public.hospital_ticket_users) to service_role;
grant execute on function public.hospital_ticket_on_duty_supervisors(uuid,uuid,uuid) to service_role;
grant execute on function public.hospital_pick_ticket_owner(uuid,text) to service_role;
grant execute on function public.hospital_ticket_pick_operations_owner(uuid) to service_role;
grant execute on function public.hospital_ticket_assignment_events() to service_role;

-- Guard the exact intended post-migration NIMS selection state.
do $$
declare
  v_owner public.hospital_ticket_users%rowtype;
begin
  v_owner := public.hospital_pick_ticket_owner(
    'bfb5d707-1a4e-451d-af1f-11b7c0aeeb66'::uuid,
    'operations_executive'
  );
  if v_owner.id is distinct from 'ecea828c-c419-47b1-a962-e7c0e5fff19e'::uuid then
    raise exception 'Migration 071 did not select the confirmed NIMS Operations Executive.';
  end if;

  v_owner := public.hospital_pick_ticket_owner(
    'bfb5d707-1a4e-451d-af1f-11b7c0aeeb66'::uuid,
    'facility_manager'
  );
  if v_owner.id is distinct from 'db983e24-31fc-4c77-baf4-95068643476f'::uuid then
    raise exception 'Migration 071 did not select the confirmed NIMS Facility Manager.';
  end if;

  v_owner := public.hospital_pick_ticket_owner(
    'bfb5d707-1a4e-451d-af1f-11b7c0aeeb66'::uuid,
    'project_head'
  );
  if v_owner.id is not null then
    raise exception 'Migration 071 must fail closed while no real NIMS Project Head is configured.';
  end if;

  if (
    select count(*)
    from public.hospital_ticket_users u
    where u.client_id = 'bfb5d707-1a4e-451d-af1f-11b7c0aeeb66'::uuid
      and u.role_code = 'housekeeping_supervisor'
      and public.hospital_ticket_is_production_routing_eligible(u)
  ) <> 10 then
    raise exception 'Migration 071 must configure exactly ten production-eligible NIMS Supervisors.';
  end if;
end $$;

commit;
