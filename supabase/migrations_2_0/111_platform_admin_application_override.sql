-- Central application-level Platform Admin override for service-role-only
-- opportunity RPCs. Role/ownership gates may be bypassed by a real active
-- Platform Admin; stage, payload, idempotency and transaction checks remain.
begin;

create or replace function public.is_platform_admin_role(p_role text)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $function$
  select upper(regexp_replace(coalesce(p_role, ''), '[^A-Za-z0-9]', '', 'g')) in (
    'ADMIN', 'QPMSADMIN', 'DEVELOPER', 'DEV', 'ITADMIN', 'MANAGEMENTITADMIN'
  );
$function$;

create or replace function public.is_platform_admin_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = p_profile_id
      and p.is_active is true
      and lower(coalesce(p.status, 'active')) = 'active'
      and public.is_platform_admin_role(p.role)
  );
$function$;

revoke all on function public.is_platform_admin_role(text) from public, anon, authenticated;
revoke all on function public.is_platform_admin_profile(uuid) from public, anon, authenticated;
grant execute on function public.is_platform_admin_role(text) to service_role;
grant execute on function public.is_platform_admin_profile(uuid) to service_role;

-- The existing Pre-Sales call-update RPC contains an operator-precedence defect:
-- the final JSON text extraction is parsed after string concatenation and fails
-- at runtime. Repair only that expression so Admin testing reaches the same
-- validated transaction path as normal Pre-Sales actors.
do $call_update_rewrite$
declare
  v_function oid;
  v_definition text;
  v_rewritten text;
begin
  v_function := to_regprocedure('public.rpc_add_pre_sales_call_update(uuid,jsonb,jsonb)');
  if v_function is null then raise exception 'Missing rpc_add_pre_sales_call_update'; end if;
  v_definition := pg_get_functiondef(v_function);
  v_rewritten := replace(v_definition,
    'coalesce(p_payload->>''feedback_label'', p_payload->>''feedback_type'') || '': '' || p_payload->>''notes''',
    'coalesce(p_payload->>''feedback_label'', p_payload->>''feedback_type'') || '': '' || (p_payload->>''notes'')');
  if v_rewritten = v_definition
     or position('(p_payload->>''notes'')' in v_rewritten) = 0 then
    raise exception 'Runtime repair failed for rpc_add_pre_sales_call_update';
  end if;
  execute v_rewritten;
end
$call_update_rewrite$;

-- The established Site Visit approval engine consumes a normalized role key.
-- Keep its existing role matrix intact while routing every approved Platform
-- Admin alias through the already-supported ADMIN path.
do $site_workflow_role_rewrite$
declare
  v_function oid;
  v_definition text;
  v_rewritten text;
begin
  v_function := to_regprocedure('public.normalize_site_workflow_role(text)');
  if v_function is null then raise exception 'Missing normalize_site_workflow_role'; end if;
  v_definition := pg_get_functiondef(v_function);
  v_rewritten := replace(v_definition,
    'when ''QPMSADMIN'' then ''ADMIN''',
    'when ''QPMSADMIN'' then ''ADMIN''
    when ''DEVELOPER'' then ''ADMIN''
    when ''DEV'' then ''ADMIN''
    when ''ITADMIN'' then ''ADMIN''
    when ''MANAGEMENTITADMIN'' then ''ADMIN''');
  if v_rewritten = v_definition
     or position('when ''MANAGEMENTITADMIN'' then ''ADMIN''' in v_rewritten) = 0 then
    raise exception 'Platform Admin rewrite failed for normalize_site_workflow_role';
  end if;
  execute v_rewritten;
end
$site_workflow_role_rewrite$;

do $rewrite$
declare
  v_function oid;
  v_definition text;
  v_rewritten text;
begin
  v_function := to_regprocedure('public.rpc_schedule_pre_sales_meeting_handoff(uuid,uuid,uuid,jsonb,text)');
  if v_function is null then raise exception 'Missing rpc_schedule_pre_sales_meeting_handoff'; end if;
  v_definition := pg_get_functiondef(v_function);
  v_rewritten := replace(v_definition,
    'and role in (''Pre-Sales'', ''Pre-Sales Executive'', ''Pre-Sales Manager'');',
    'and (role in (''Pre-Sales'', ''Pre-Sales Executive'', ''Pre-Sales Manager'') or public.is_platform_admin_role(role));');
  v_rewritten := replace(v_rewritten,
    'if v_lead.pre_sales_owner_profile_id is distinct from p_actor_profile_id
     and coalesce(v_lead.created_by_user_id, '''') not in (
       p_actor_profile_id::text, coalesce(v_actor.auth_user_id::text, '''')
     ) then',
    'if not public.is_platform_admin_role(v_actor.role) and (
       v_lead.pre_sales_owner_profile_id is distinct from p_actor_profile_id
       and coalesce(v_lead.created_by_user_id, '''') not in (
         p_actor_profile_id::text, coalesce(v_actor.auth_user_id::text, '''')
       )
     ) then');
  if v_rewritten = v_definition
     or position('or public.is_platform_admin_role(role)' in v_rewritten) = 0
     or position('if not public.is_platform_admin_role(v_actor.role) and (' in v_rewritten) = 0 then
    raise exception 'Admin rewrite failed for rpc_schedule_pre_sales_meeting_handoff';
  end if;
  execute v_rewritten;

  v_function := to_regprocedure('public.rpc_decide_pre_sales_handoff(uuid,uuid,text,text)');
  if v_function is null then raise exception 'Missing rpc_decide_pre_sales_handoff'; end if;
  v_definition := pg_get_functiondef(v_function);
  v_rewritten := replace(v_definition,
    'if not found or not public.is_business_development_role(v_actor.role) then',
    'if not found or (not public.is_business_development_role(v_actor.role) and not public.is_platform_admin_role(v_actor.role)) then');
  v_rewritten := replace(v_rewritten,
    'if v_handoff.to_profile_id <> p_actor_profile_id then',
    'if v_handoff.to_profile_id <> p_actor_profile_id and not public.is_platform_admin_role(v_actor.role) then');
  if v_rewritten = v_definition
     or position('not public.is_platform_admin_role(v_actor.role)) then' in v_rewritten) = 0
     or position('and not public.is_platform_admin_role(v_actor.role) then' in v_rewritten) = 0 then
    raise exception 'Admin rewrite failed for rpc_decide_pre_sales_handoff';
  end if;
  execute v_rewritten;

  v_function := to_regprocedure('public.rpc_submit_bd_meeting_mom(uuid,uuid,jsonb)');
  if v_function is null then raise exception 'Missing rpc_submit_bd_meeting_mom'; end if;
  v_definition := pg_get_functiondef(v_function);
  v_rewritten := replace(v_definition,
    'and public.is_business_development_role(role);',
    'and (public.is_business_development_role(role) or public.is_platform_admin_role(role));');
  v_rewritten := replace(v_rewritten,
    'where meeting_id = v_meeting.id and handoff_status = ''accepted'' and to_profile_id = p_actor_profile_id',
    'where meeting_id = v_meeting.id and handoff_status = ''accepted''
      and (to_profile_id = p_actor_profile_id or public.is_platform_admin_role(v_actor.role))');
  if v_rewritten = v_definition
     or position('or public.is_platform_admin_role(role)' in v_rewritten) = 0
     or position('to_profile_id = p_actor_profile_id or public.is_platform_admin_role(v_actor.role)' in v_rewritten) = 0 then
    raise exception 'Admin rewrite failed for rpc_submit_bd_meeting_mom';
  end if;
  execute v_rewritten;

  v_function := to_regprocedure('public.rpc_prepare_opportunity_proposal(uuid,uuid,jsonb,text)');
  if v_function is null then raise exception 'Missing rpc_prepare_opportunity_proposal'; end if;
  v_definition := pg_get_functiondef(v_function);
  v_rewritten := replace(v_definition,
    'where id = p_actor_profile_id and public.is_business_development_role(role)',
    'where id = p_actor_profile_id and (public.is_business_development_role(role) or public.is_platform_admin_role(role))');
  v_rewritten := replace(v_rewritten,
    'where lead_id = p_lead_id and to_profile_id = p_actor_profile_id and handoff_status = ''accepted''',
    'where lead_id = p_lead_id and handoff_status = ''accepted''
    and (to_profile_id = p_actor_profile_id or public.is_platform_admin_role(v_actor.role))');
  if v_rewritten = v_definition
     or position('or public.is_platform_admin_role(role)' in v_rewritten) = 0
     or position('to_profile_id = p_actor_profile_id or public.is_platform_admin_role(v_actor.role)' in v_rewritten) = 0 then
    raise exception 'Admin rewrite failed for rpc_prepare_opportunity_proposal';
  end if;
  execute v_rewritten;

  v_function := to_regprocedure('public.rpc_send_opportunity_proposal(uuid,uuid,text)');
  if v_function is null then raise exception 'Missing rpc_send_opportunity_proposal'; end if;
  v_definition := pg_get_functiondef(v_function);
  v_rewritten := replace(v_definition,
    'where id = p_actor_profile_id and public.is_business_development_role(role)',
    'where id = p_actor_profile_id and (public.is_business_development_role(role) or public.is_platform_admin_role(role))');
  v_rewritten := replace(v_rewritten,
    'and h.to_profile_id = v_actor.id and h.handoff_status = ''accepted''',
    'and h.handoff_status = ''accepted''
      and (h.to_profile_id = v_actor.id or public.is_platform_admin_role(v_actor.role))');
  if v_rewritten = v_definition
     or position('or public.is_platform_admin_role(role)' in v_rewritten) = 0
     or position('h.to_profile_id = v_actor.id or public.is_platform_admin_role(v_actor.role)' in v_rewritten) = 0 then
    raise exception 'Admin rewrite failed for rpc_send_opportunity_proposal';
  end if;
  execute v_rewritten;

  v_function := to_regprocedure('public.rpc_record_proposal_outcome(uuid,uuid,text,text,text)');
  if v_function is null then raise exception 'Missing rpc_record_proposal_outcome'; end if;
  v_definition := pg_get_functiondef(v_function);
  v_rewritten := replace(v_definition,
    'and public.is_business_development_role(role)',
    'and (public.is_business_development_role(role) or public.is_platform_admin_role(role))');
  v_rewritten := replace(v_rewritten,
    'where h.lead_id = v_proposal.lead_id and h.to_profile_id = v_actor.id
      and h.handoff_status = ''accepted''',
    'where h.lead_id = v_proposal.lead_id and h.handoff_status = ''accepted''
      and (h.to_profile_id = v_actor.id or public.is_platform_admin_role(v_actor.role))');
  v_rewritten := replace(v_rewritten,
    'update public.site_visits set current_stage = v_outcome, pending_with = null,',
    'update public.site_visits set current_stage = v_outcome, pending_with = ''Completed'',');
  if v_rewritten = v_definition
     or position('or public.is_platform_admin_role(role)' in v_rewritten) = 0
     or position('h.to_profile_id = v_actor.id or public.is_platform_admin_role(v_actor.role)' in v_rewritten) = 0
     or position('pending_with = ''Completed''' in v_rewritten) = 0 then
    raise exception 'Admin rewrite failed for rpc_record_proposal_outcome';
  end if;
  execute v_rewritten;
end
$rewrite$;

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
  v_actor public.profiles%rowtype;
  v_branch public.profiles%rowtype;
  v_manager public.profiles%rowtype;
  v_visit public.site_visits%rowtype;
  v_workflow public.workflow_instances%rowtype;
  v_admin_override boolean := false;
begin
  select * into v_actor from public.profiles where id = p_branch_head_profile_id
    and is_active is true and lower(coalesce(status, 'active')) = 'active';
  if not found or (v_actor.role <> 'Branch Head' and not public.is_platform_admin_role(v_actor.role)) then
    raise exception using errcode = '42501', message = 'branch_head_not_authorized';
  end if;
  v_admin_override := public.is_platform_admin_role(v_actor.role);

  select * into v_visit from public.site_visits where id = p_site_visit_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'site_survey_not_found'; end if;
  if not v_admin_override and v_visit.branch_head_profile_id is distinct from v_actor.id then
    raise exception using errcode = '42501', message = 'site_survey_not_assigned_to_branch_head';
  end if;
  if v_visit.assigned_operations_manager_profile_id is not null then
    raise exception using errcode = '40001', message = 'operations_manager_already_assigned';
  end if;

  select * into v_branch from public.profiles where id = v_visit.branch_head_profile_id
    and role = 'Branch Head' and is_active is true
    and lower(coalesce(status, 'active')) = 'active';
  if not found then raise exception using errcode = '42501', message = 'branch_head_not_authorized'; end if;

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
    select 1 from public.new_business_operations_manager_state_scope scope
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
    assigned_by_profile_id = v_actor.id, assigned_at = now(),
    routing_status = 'operations_manager_assigned', status = 'Operations Manager Assigned',
    pending_with = 'Operations Manager', updated_at = now()
  where id = v_visit.id returning * into v_visit;
  select * into v_workflow from public.workflow_instances where site_visit_id = v_visit.id for update;
  update public.workflow_assignments set status = 'Completed', completed_at = now()
  where workflow_instance_id = v_workflow.id and stage_code = 'bd_survey' and status = 'Pending';
  insert into public.workflow_assignments(workflow_instance_id, stage_code, assigned_role, assigned_profile_id, status, metadata)
  values (v_workflow.id, 'bd_survey', 'Operations Manager', v_manager.id, 'Pending',
    jsonb_build_object('assigned_by_profile_id', v_actor.id, 'admin_override', v_admin_override));
  update public.workflow_status set pending_role = 'Operations Manager', status = 'Assigned', updated_at = now()
  where workflow_instance_id = v_workflow.id;
  insert into public.workflow_events(workflow_instance_id, lead_id, site_visit_id, assessment_id, from_stage, to_stage, action, actor_profile_id, actor_auth_user_id, actor_employee_code, actor_name, actor_role, metadata)
  values (v_workflow.id, v_workflow.lead_id, v_visit.id, v_workflow.assessment_id, 'bd_survey', 'bd_survey', 'ASSIGN_OPERATIONS_MANAGER',
    v_actor.id, v_actor.auth_user_id, v_actor.employee_code, coalesce(v_actor.full_name, v_actor.employee_code), v_actor.role,
    jsonb_build_object('assigned_operations_manager_profile_id', v_manager.id, 'routed_branch_head_profile_id', v_branch.id, 'admin_override', v_admin_override));
  return jsonb_build_object('site_visit', to_jsonb(v_visit), 'operations_manager',
    jsonb_build_object('id', v_manager.id, 'employee_code', v_manager.employee_code, 'full_name', v_manager.full_name));
end
$function$;

revoke all on function public.rpc_assign_site_survey_operations_manager(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.rpc_assign_site_survey_operations_manager(uuid,uuid,uuid) to service_role;

comment on function public.is_platform_admin_profile(uuid) is
  'Service-role-only application Platform Admin predicate. Domain stage and data validation remain mandatory.';
comment on function public.rpc_assign_site_survey_operations_manager(uuid,uuid,uuid) is
  'Service-role-only Branch Head or Platform Admin assignment; routed Branch Head hierarchy and explicit new-business State scope remain mandatory.';

commit;
