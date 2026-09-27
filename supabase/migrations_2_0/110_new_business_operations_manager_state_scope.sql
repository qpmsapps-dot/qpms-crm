-- Add explicit State eligibility for Operations Managers in new-business Site Surveys.
-- Normal Operations profile State, Business and hierarchy behavior remains unchanged.
begin;

create table public.new_business_operations_manager_state_scope (
  id uuid primary key default gen_random_uuid(),
  operations_manager_profile_id uuid not null,
  state text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint new_business_operations_manager_state_scope_profile_fkey
    foreign key (operations_manager_profile_id) references public.profiles(id) on delete restrict,
  constraint new_business_operations_manager_state_scope_state_check
    check (state in ('TN', 'KL', 'KA', 'TG', 'AP-1', 'AP-2')),
  constraint new_business_operations_manager_state_scope_profile_state_key
    unique (operations_manager_profile_id, state)
);

create index new_business_operations_manager_state_scope_state_active_idx
  on public.new_business_operations_manager_state_scope(state, is_active);

create index new_business_operations_manager_state_scope_profile_active_idx
  on public.new_business_operations_manager_state_scope(operations_manager_profile_id, is_active);

comment on table public.new_business_operations_manager_state_scope is
  'Explicit State eligibility for Operations Managers assigned to new-business Site Surveys. Scope never replaces hierarchy or explicit assignment.';
comment on column public.new_business_operations_manager_state_scope.state is
  'Canonical new-business opportunity State. Business is intentionally excluded from Operations Manager eligibility.';

create function public.touch_new_business_operations_manager_state_scope_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  new.updated_at := now();
  return new;
end
$function$;

create trigger touch_new_business_operations_manager_state_scope_updated_at
before update on public.new_business_operations_manager_state_scope
for each row execute function public.touch_new_business_operations_manager_state_scope_updated_at();

alter table public.new_business_operations_manager_state_scope enable row level security;
revoke all on table public.new_business_operations_manager_state_scope from public, anon, authenticated;
grant select, insert, update, delete on table public.new_business_operations_manager_state_scope to service_role;
revoke all on function public.touch_new_business_operations_manager_state_scope_updated_at() from public, anon, authenticated;
grant execute on function public.touch_new_business_operations_manager_state_scope_updated_at() to service_role;

-- Seed only confirmed, currently operational TN, TG and KA mappings. Resolve
-- immutable employee codes transactionally; KL and AP-1/AP-2 remain unseeded.
do $seed$
declare
  v_mapping record;
  v_profile public.profiles%rowtype;
  v_profile_count integer;
begin
  for v_mapping in
    select *
    from (values
      ('TN', 'QPMSTN10098'),
      ('TN', 'QPMSTN12728'),
      ('TN', 'QPMSTN15552'),
      ('TN', 'QPMSTN16099'),
      ('TN', 'QPMSTNC16974'),
      ('TG', 'QPMSTS1891'),
      ('TG', 'QPMSTS4053'),
      ('KA', 'QPMSKA3846')
    ) as confirmed_mapping(state, employee_code)
  loop
    select count(*) into v_profile_count
    from public.profiles p
    where upper(btrim(p.employee_code)) = upper(v_mapping.employee_code);

    if v_profile_count <> 1 then
      raise exception 'Expected exactly one profile for confirmed Operations Manager employee code %, found %',
        v_mapping.employee_code, v_profile_count;
    end if;

    select * into strict v_profile
    from public.profiles p
    where upper(btrim(p.employee_code)) = upper(v_mapping.employee_code);

    if v_profile.role <> 'Operations Manager'
       or v_profile.is_active is not true
       or lower(coalesce(v_profile.status, 'active')) <> 'active' then
      raise exception 'Confirmed new-business Operations Manager % is not an active Operations Manager',
        v_mapping.employee_code;
    end if;

    if v_profile.auth_user_id is null then
      raise exception 'Confirmed new-business Operations Manager % has no auth mapping',
        v_mapping.employee_code;
    end if;

    insert into public.new_business_operations_manager_state_scope(
      operations_manager_profile_id,
      state,
      is_active
    ) values (
      v_profile.id,
      v_mapping.state,
      true
    )
    on conflict on constraint new_business_operations_manager_state_scope_profile_state_key
    do update set is_active = true, updated_at = now();
  end loop;
end
$seed$;

create or replace function public.rpc_assign_site_survey_operations_manager(
  p_site_visit_id uuid,
  p_branch_head_profile_id uuid,
  p_operations_manager_profile_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_branch public.profiles%rowtype;
  v_manager public.profiles%rowtype;
  v_visit public.site_visits%rowtype;
  v_workflow public.workflow_instances%rowtype;
begin
  select * into v_branch from public.profiles where id = p_branch_head_profile_id and role = 'Branch Head'
    and is_active is true and lower(coalesce(status, 'active')) = 'active';
  if not found then raise exception using errcode = '42501', message = 'branch_head_not_authorized'; end if;

  select * into v_visit from public.site_visits where id = p_site_visit_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'site_survey_not_found'; end if;
  if v_visit.branch_head_profile_id is distinct from p_branch_head_profile_id then
    raise exception using errcode = '42501', message = 'site_survey_not_assigned_to_branch_head';
  end if;
  if v_visit.assigned_operations_manager_profile_id is not null then
    raise exception using errcode = '40001', message = 'operations_manager_already_assigned';
  end if;

  select * into v_manager from public.profiles where id = p_operations_manager_profile_id;
  if not found or v_manager.role is distinct from 'Operations Manager' then
    raise exception using errcode = '22023', message = 'operations_manager_not_eligible';
  end if;
  if v_manager.is_active is not true or lower(coalesce(v_manager.status, 'active')) <> 'active' then
    raise exception using errcode = '22023', message = 'operations_manager_not_active';
  end if;
  if v_manager.auth_user_id is null then
    raise exception using errcode = '22023', message = 'operations_manager_auth_mapping_missing';
  end if;
  if not exists (
    select 1
    from public.new_business_operations_manager_state_scope scope
    where scope.operations_manager_profile_id = v_manager.id
      and scope.is_active is true
      and public.opportunity_state_key(scope.state) = public.opportunity_state_key(v_visit.owner_state)
  ) then
    raise exception using errcode = '42501', message = 'operations_manager_state_scope_missing';
  end if;
  if not exists (
    select 1 from public.employee_hierarchy eh
    where eh.employee_code = v_manager.employee_code
      and eh.manager_employee_code = v_branch.employee_code
      and eh.is_active is true
  ) then
    raise exception using errcode = '42501', message = 'operations_manager_not_direct_report';
  end if;

  update public.site_visits set assigned_profile_id = v_manager.id,
    assigned_operations_manager_profile_id = v_manager.id,
    assigned_by_profile_id = v_branch.id, assigned_at = now(),
    routing_status = 'operations_manager_assigned', status = 'Operations Manager Assigned',
    pending_with = 'Operations Manager', updated_at = now()
  where id = v_visit.id returning * into v_visit;
  select * into v_workflow from public.workflow_instances where site_visit_id = v_visit.id for update;
  update public.workflow_assignments set status = 'Completed', completed_at = now()
  where workflow_instance_id = v_workflow.id and stage_code = 'bd_survey' and status = 'Pending';
  insert into public.workflow_assignments(workflow_instance_id, stage_code, assigned_role, assigned_profile_id, status, metadata)
  values (v_workflow.id, 'bd_survey', 'Operations Manager', v_manager.id, 'Pending', jsonb_build_object('assigned_by_profile_id', v_branch.id));
  update public.workflow_status set pending_role = 'Operations Manager', status = 'Assigned', updated_at = now()
  where workflow_instance_id = v_workflow.id;
  insert into public.workflow_events(workflow_instance_id, lead_id, site_visit_id, assessment_id, from_stage, to_stage, action, actor_profile_id, actor_auth_user_id, actor_employee_code, actor_name, actor_role, metadata)
  values (v_workflow.id, v_workflow.lead_id, v_visit.id, v_workflow.assessment_id, 'bd_survey', 'bd_survey', 'ASSIGN_OPERATIONS_MANAGER',
    v_branch.id, v_branch.auth_user_id, v_branch.employee_code, coalesce(v_branch.full_name, v_branch.employee_code), v_branch.role,
    jsonb_build_object('assigned_operations_manager_profile_id', v_manager.id));
  return jsonb_build_object('site_visit', to_jsonb(v_visit), 'operations_manager', jsonb_build_object('id', v_manager.id, 'employee_code', v_manager.employee_code, 'full_name', v_manager.full_name));
end
$function$;

comment on function public.rpc_assign_site_survey_operations_manager(uuid,uuid,uuid) is
  'Service-role-only Branch Head assignment requiring explicit new-business State scope, active auth-mapped profile and direct hierarchy.';
revoke all on function public.rpc_assign_site_survey_operations_manager(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.rpc_assign_site_survey_operations_manager(uuid,uuid,uuid) to service_role;

-- Add safe operational context to recipient-scoped Site Survey notifications.
-- opportunity_notify remains best effort, so notification failure cannot roll
-- back routing or assignment.
create or replace function public.opportunity_site_visit_notification_trigger()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_mom public.lead_mom%rowtype;
  v_branch_name text;
  v_requirement text;
  v_date text;
  v_site text;
begin
  if new.source_lead_mom_id is not null then
    select * into v_mom from public.lead_mom where id = new.source_lead_mom_id;
  end if;
  v_requirement := left(nullif(btrim(coalesce(v_mom.requirement_discussed, v_mom.scope_summary, '')), ''), 240);
  v_date := case when new.scheduled_visit_date is null then null else to_char(new.scheduled_visit_date, 'DD Mon YYYY') end;
  v_site := coalesce(nullif(btrim(new.site_location), ''), nullif(btrim(new.site_name), ''));

  if tg_op = 'INSERT' and new.branch_head_profile_id is not null then
    perform public.opportunity_notify(
      new.lead_id, new.branch_head_profile_id, 'site_survey_routed',
      'Site Survey request',
      concat_ws(' | ',
        'Client: ' || coalesce(nullif(btrim(new.client_name), ''), 'Not recorded'),
        'State: ' || coalesce(nullif(btrim(new.owner_state), ''), 'Not recorded'),
        case when v_site is not null then 'Site: ' || v_site end,
        case when v_date is not null then 'Preferred date: ' || v_date end,
        case when v_requirement is not null then 'Requirement: ' || v_requirement end
      ),
      '/site-survey-requests', 'site-survey:branch:' || new.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'site_visit_id', new.id,
        'client', nullif(btrim(new.client_name), ''),
        'state', nullif(btrim(new.owner_state), ''),
        'site', v_site,
        'preferred_survey_date', new.scheduled_visit_date,
        'requirement_summary', v_requirement
      ))
    );
  end if;

  if new.assigned_operations_manager_profile_id is not null
     and (tg_op = 'INSERT' or new.assigned_operations_manager_profile_id is distinct from old.assigned_operations_manager_profile_id) then
    select coalesce(nullif(btrim(p.full_name), ''), p.employee_code)
      into v_branch_name from public.profiles p where p.id = new.branch_head_profile_id;
    perform public.opportunity_notify(
      new.lead_id, new.assigned_operations_manager_profile_id, 'site_survey_assigned',
      'Site Survey assigned',
      concat_ws(' | ',
        'Client: ' || coalesce(nullif(btrim(new.client_name), ''), 'Not recorded'),
        'State: ' || coalesce(nullif(btrim(new.owner_state), ''), 'Not recorded'),
        case when v_site is not null then 'Site: ' || v_site end,
        case when v_date is not null then 'Scheduled date: ' || v_date end,
        case when v_branch_name is not null then 'Branch Head: ' || v_branch_name end,
        case when v_requirement is not null then 'Requirement: ' || v_requirement end
      ),
      '/site-survey-requests', 'site-survey:operations-manager:' || new.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'site_visit_id', new.id,
        'client', nullif(btrim(new.client_name), ''),
        'state', nullif(btrim(new.owner_state), ''),
        'site', v_site,
        'scheduled_survey_date', new.scheduled_visit_date,
        'branch_head', v_branch_name,
        'requirement_summary', v_requirement
      ))
    );
  end if;
  return new;
exception when others then
  -- Context lookup and notification delivery are best effort. They must never
  -- roll back the authoritative Site Survey routing or OM assignment.
  raise warning 'Opportunity Site Survey notification skipped: %', sqlerrm;
  return new;
end
$function$;

revoke all on function public.opportunity_site_visit_notification_trigger() from public, anon, authenticated;
grant execute on function public.opportunity_site_visit_notification_trigger() to service_role;

commit;
