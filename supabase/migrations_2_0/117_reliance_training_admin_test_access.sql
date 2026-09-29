begin;

-- Admin is a narrowly scoped structured-Training test actor. The session must
-- still be a Reliance session, belong to the actor, and remain a draft.
create or replace function public.training_assert_draft_editor(
  p_session_id uuid,
  p_actor_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_profile public.profiles%rowtype;
  v_session public.training_sessions%rowtype;
  v_envelope public.fo_activity_submissions%rowtype;
  v_store public.store_master%rowtype;
begin
  select * into v_profile
  from public.profiles
  where id = p_actor_profile_id;

  if not found
     or v_profile.is_active is not true
     or regexp_replace(upper(coalesce(v_profile.role, '')), '[^A-Z0-9]+', '', 'g')
       not in ('FO', 'OPERATIONSMANAGER', 'ADMIN') then
    raise exception using errcode = '42501', message = 'training_mutation_forbidden';
  end if;

  select * into v_session
  from public.training_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'training_session_not_found';
  end if;
  if v_session.status <> 'draft' then
    raise exception using errcode = 'P0001', message = 'training_session_immutable';
  end if;
  if v_session.access_client_id <> '369d2d5f-396f-49f9-a47d-bfbc8f7cb922'::uuid
     or v_session.access_client_code <> 'reliance_retail' then
    raise exception using errcode = '42501', message = 'training_non_reliance_session';
  end if;

  select * into v_envelope
  from public.fo_activity_submissions
  where id = p_session_id
  for update;

  if not found or v_envelope.activity_type <> 'training' then
    raise exception using errcode = 'P0001', message = 'training_envelope_invalid';
  end if;
  if upper(btrim(coalesce(v_envelope.employee_code, v_envelope.fo_user_id, '')))
     <> upper(btrim(coalesce(v_profile.employee_code, v_profile.username, ''))) then
    raise exception using errcode = '42501', message = 'training_not_session_creator';
  end if;

  select * into v_store
  from public.store_master
  where id = v_session.store_id;

  if not found
     or not (
       regexp_replace(upper(coalesce(v_store.business, '')), '[^A-Z0-9]+', '', 'g')
         in ('RELIANCE', 'RELIANCERETAIL')
       or regexp_replace(upper(coalesce(v_store.client_name, '')), '[^A-Z0-9]+', '', 'g')
         in ('RELIANCE', 'RELIANCERETAIL')
     ) then
    raise exception using errcode = '42501', message = 'training_non_reliance_store';
  end if;
end
$function$;

-- Creation continues to require the actor's own active attendance and visit.
-- Admin may use a verified Reliance store even when the global Admin profile is
-- not assigned a Reliance business label; FO and OM retain the original actor
-- business restriction.
create or replace function public.rpc_create_reliance_training_session(
  p_actor_profile_id uuid,
  p_attendance_id uuid,
  p_site_visit_id uuid,
  p_category_id uuid,
  p_training_type_id uuid,
  p_training_date date,
  p_trainer_name text,
  p_remarks text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_profile public.profiles%rowtype;
  v_attendance public.fo_attendance%rowtype;
  v_visit public.fo_site_visits%rowtype;
  v_store public.store_master%rowtype;
  v_category public.training_categories%rowtype;
  v_type public.training_types%rowtype;
  v_client public.access_clients%rowtype;
  v_session_id uuid := gen_random_uuid();
  v_employee_code text;
  v_actor_role text;
begin
  select * into v_profile from public.profiles where id = p_actor_profile_id;
  if not found or v_profile.is_active is not true then
    raise exception using errcode = '42501', message = 'training_actor_inactive';
  end if;
  v_actor_role := regexp_replace(upper(coalesce(v_profile.role, '')), '[^A-Z0-9]+', '', 'g');
  if v_actor_role not in ('FO', 'OPERATIONSMANAGER', 'ADMIN') then
    raise exception using errcode = '42501', message = 'training_create_role_forbidden';
  end if;
  if v_actor_role <> 'ADMIN'
     and regexp_replace(upper(coalesce(v_profile.business, '')), '[^A-Z0-9]+', '', 'g')
       not in ('RELIANCE', 'RELIANCERETAIL') then
    raise exception using errcode = '42501', message = 'training_actor_business_forbidden';
  end if;

  v_employee_code := btrim(coalesce(v_profile.employee_code, v_profile.username, ''));
  if v_employee_code = '' then
    raise exception using errcode = '42501', message = 'training_actor_identity_incomplete';
  end if;

  select * into v_attendance
  from public.fo_attendance
  where id = p_attendance_id
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'training_attendance_not_found';
  end if;
  if upper(v_employee_code) not in (
    upper(btrim(coalesce(v_attendance.employee_code, ''))),
    upper(btrim(coalesce(v_attendance.fo_user_id, ''))),
    upper(btrim(coalesce(v_attendance.username, '')))
  ) then
    raise exception using errcode = '42501', message = 'training_attendance_forbidden';
  end if;
  if v_attendance.logout_time is not null or lower(coalesce(v_attendance.status, '')) <> 'active' then
    raise exception using errcode = 'P0001', message = 'training_attendance_not_active';
  end if;

  select * into v_visit
  from public.fo_site_visits
  where id = p_site_visit_id
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'training_site_visit_not_found';
  end if;
  if v_visit.attendance_id is distinct from v_attendance.id then
    raise exception using errcode = 'P0001', message = 'training_visit_attendance_mismatch';
  end if;
  if upper(v_employee_code) not in (
    upper(btrim(coalesce(v_visit.employee_code, ''))),
    upper(btrim(coalesce(v_visit.fo_user_id, '')))
  ) then
    raise exception using errcode = '42501', message = 'training_site_visit_forbidden';
  end if;
  if v_visit.check_out_time is not null or v_visit.checkout_time is not null then
    raise exception using errcode = 'P0001', message = 'training_site_visit_not_active';
  end if;
  if v_visit.store_id is null then
    raise exception using errcode = 'P0001', message = 'training_site_visit_store_missing';
  end if;

  select * into v_store
  from public.store_master
  where id = v_visit.store_id
  for share;
  if not found or lower(coalesce(v_store.status, 'active')) <> 'active' then
    raise exception using errcode = 'P0002', message = 'training_store_not_found';
  end if;
  if not (
    regexp_replace(upper(coalesce(v_store.business, '')), '[^A-Z0-9]+', '', 'g')
      in ('RELIANCE', 'RELIANCERETAIL')
    or regexp_replace(upper(coalesce(v_store.client_name, '')), '[^A-Z0-9]+', '', 'g')
      in ('RELIANCE', 'RELIANCERETAIL')
  ) then
    raise exception using errcode = '42501', message = 'training_non_reliance_store';
  end if;
  if btrim(coalesce(v_profile.state, '')) <> ''
     and upper(btrim(v_profile.state)) <> upper(btrim(v_store.state)) then
    raise exception using errcode = '42501', message = 'training_cross_state_forbidden';
  end if;

  select * into v_client
  from public.access_clients
  where id = '369d2d5f-396f-49f9-a47d-bfbc8f7cb922'::uuid
    and code = 'reliance_retail'
    and active is true;
  if not found then
    raise exception using errcode = 'P0001', message = 'training_reliance_client_unavailable';
  end if;

  select * into v_category
  from public.training_categories
  where id = p_category_id and is_active is true;
  if not found then
    raise exception using errcode = 'P0002', message = 'training_category_not_found';
  end if;

  select * into v_type
  from public.training_types
  where id = p_training_type_id and is_active is true;
  if not found then
    raise exception using errcode = 'P0002', message = 'training_type_not_found';
  end if;

  if p_training_date is null then
    raise exception using errcode = '22023', message = 'training_date_required';
  end if;
  if btrim(coalesce(p_trainer_name, '')) = '' then
    raise exception using errcode = '22023', message = 'training_trainer_name_required';
  end if;
  if p_remarks is not null and char_length(p_remarks) > 500 then
    raise exception using errcode = '22023', message = 'training_remarks_too_long';
  end if;

  insert into public.fo_activity_submissions (
    id,
    fo_user_id,
    employee_code,
    attendance_id,
    site_visit_id,
    store_id,
    store_code,
    activity_type,
    status,
    remarks,
    submitted_at,
    metadata
  ) values (
    v_session_id,
    v_employee_code,
    v_employee_code,
    v_attendance.id,
    v_visit.id,
    v_store.id,
    v_store.store_code,
    'training',
    'draft',
    p_remarks,
    now(),
    jsonb_build_object(
      'training_schema', 'structured_v1',
      'training_source', 'reliance_structured',
      'training_category_code', v_category.code,
      'training_type_code', v_type.code,
      'structured_status', 'draft'
    )
  );

  insert into public.training_sessions (
    id,
    category_id,
    training_type_id,
    trainer_profile_id,
    trainer_name_snapshot,
    training_date,
    remarks,
    status,
    attendance_id,
    site_visit_id,
    store_id,
    access_client_id,
    access_client_code,
    business_code_snapshot,
    business_name_snapshot,
    state_snapshot,
    store_code_snapshot,
    store_name_snapshot,
    require_attendee_snapshot,
    require_selected_topic_snapshot,
    topic_evidence_policy_snapshot,
    require_group_photo_snapshot,
    require_attendance_sheet_snapshot,
    require_training_document_snapshot,
    max_group_photos_snapshot
  ) values (
    v_session_id,
    v_category.id,
    v_type.id,
    v_profile.id,
    btrim(p_trainer_name),
    p_training_date,
    nullif(btrim(coalesce(p_remarks, '')), ''),
    'draft',
    v_attendance.id,
    v_visit.id,
    v_store.id,
    v_client.id,
    v_client.code,
    'reliance_retail',
    v_client.name,
    v_store.state,
    v_store.store_code,
    v_store.store_name,
    v_category.require_attendee,
    v_category.require_selected_topic,
    v_category.topic_evidence_policy,
    v_category.require_group_photo,
    v_category.require_attendance_sheet,
    v_category.require_training_document,
    v_category.max_group_photos
  );

  insert into public.training_events(training_session_id, event_type, actor_profile_id, metadata)
  values (
    v_session_id,
    'session_created',
    v_profile.id,
    jsonb_build_object('category_code', v_category.code, 'training_type_code', v_type.code)
  );

  return v_session_id;
end
$function$;

revoke all on function public.training_assert_draft_editor(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_create_reliance_training_session(uuid, uuid, uuid, uuid, uuid, date, text, text) from public, anon, authenticated;

grant execute on function public.training_assert_draft_editor(uuid, uuid) to service_role;
grant execute on function public.rpc_create_reliance_training_session(uuid, uuid, uuid, uuid, uuid, date, text, text) to service_role;

comment on function public.rpc_create_reliance_training_session(uuid, uuid, uuid, uuid, uuid, date, text, text) is
  'Backend-only atomic Reliance Training creator for FO, Operations Manager, and Admin test actors.';

commit;
