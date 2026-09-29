begin;

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
       not in ('FO', 'OPERATIONSMANAGER') then
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
begin
  select * into v_profile from public.profiles where id = p_actor_profile_id;
  if not found or v_profile.is_active is not true then
    raise exception using errcode = '42501', message = 'training_actor_inactive';
  end if;
  if regexp_replace(upper(coalesce(v_profile.role, '')), '[^A-Z0-9]+', '', 'g')
     not in ('FO', 'OPERATIONSMANAGER') then
    raise exception using errcode = '42501', message = 'training_create_role_forbidden';
  end if;
  if regexp_replace(upper(coalesce(v_profile.business, '')), '[^A-Z0-9]+', '', 'g')
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

create or replace function public.rpc_update_reliance_training_draft(
  p_session_id uuid,
  p_actor_profile_id uuid,
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
  v_session public.training_sessions%rowtype;
  v_category public.training_categories%rowtype;
  v_type public.training_types%rowtype;
begin
  perform public.training_assert_draft_editor(p_session_id, p_actor_profile_id);
  select * into v_session from public.training_sessions where id = p_session_id;
  select * into v_category from public.training_categories where id = p_category_id and is_active;
  if not found then raise exception using errcode = 'P0002', message = 'training_category_not_found'; end if;
  select * into v_type from public.training_types where id = p_training_type_id and is_active;
  if not found then raise exception using errcode = 'P0002', message = 'training_type_not_found'; end if;
  if p_training_date is null then raise exception using errcode = '22023', message = 'training_date_required'; end if;
  if btrim(coalesce(p_trainer_name, '')) = '' then raise exception using errcode = '22023', message = 'training_trainer_name_required'; end if;
  if p_remarks is not null and char_length(p_remarks) > 500 then raise exception using errcode = '22023', message = 'training_remarks_too_long'; end if;
  if v_session.category_id <> p_category_id and exists (
    select 1 from public.training_session_topics where training_session_id = p_session_id
  ) then
    raise exception using errcode = 'P0001', message = 'training_category_change_has_topics';
  end if;

  update public.training_sessions
  set category_id = v_category.id,
      training_type_id = v_type.id,
      training_date = p_training_date,
      trainer_name_snapshot = btrim(p_trainer_name),
      remarks = nullif(btrim(coalesce(p_remarks, '')), ''),
      require_attendee_snapshot = v_category.require_attendee,
      require_selected_topic_snapshot = v_category.require_selected_topic,
      topic_evidence_policy_snapshot = v_category.topic_evidence_policy,
      require_group_photo_snapshot = v_category.require_group_photo,
      require_attendance_sheet_snapshot = v_category.require_attendance_sheet,
      require_training_document_snapshot = v_category.require_training_document,
      max_group_photos_snapshot = v_category.max_group_photos
  where id = p_session_id;

  update public.fo_activity_submissions
  set remarks = p_remarks,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'training_category_code', v_category.code,
        'training_type_code', v_type.code
      )
  where id = p_session_id;

  insert into public.training_events(training_session_id, event_type, actor_profile_id, metadata)
  values (p_session_id, 'draft_updated', p_actor_profile_id, jsonb_build_object('fields', array['details']));
  return p_session_id;
end
$function$;

create or replace function public.rpc_add_reliance_training_attendee(
  p_session_id uuid,
  p_actor_profile_id uuid,
  p_attendee_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_session public.training_sessions%rowtype;
  v_attendee public.profiles%rowtype;
  v_id uuid;
  v_employee_code text;
begin
  perform public.training_assert_draft_editor(p_session_id, p_actor_profile_id);
  select * into v_session from public.training_sessions where id = p_session_id;
  select * into v_attendee from public.profiles where id = p_attendee_profile_id and is_active is true;
  if not found then raise exception using errcode = 'P0002', message = 'training_attendee_not_found'; end if;
  if regexp_replace(upper(coalesce(v_attendee.business, '')), '[^A-Z0-9]+', '', 'g')
     not in ('RELIANCE', 'RELIANCERETAIL') then
    raise exception using errcode = '42501', message = 'training_attendee_cross_business';
  end if;
  if btrim(coalesce(v_session.state_snapshot, '')) <> ''
     and upper(btrim(coalesce(v_attendee.state, ''))) <> upper(btrim(v_session.state_snapshot)) then
    raise exception using errcode = '42501', message = 'training_attendee_cross_state';
  end if;
  v_employee_code := btrim(coalesce(v_attendee.employee_code, v_attendee.username, ''));
  if v_employee_code = '' then raise exception using errcode = '22023', message = 'training_attendee_identity_incomplete'; end if;

  insert into public.training_session_attendees(
    training_session_id, profile_id, employee_code, employee_name, designation_snapshot, added_by
  ) values (
    p_session_id,
    v_attendee.id,
    v_employee_code,
    btrim(coalesce(v_attendee.full_name, v_attendee.display_name, v_employee_code)),
    nullif(btrim(coalesce(v_attendee.designation, '')), ''),
    p_actor_profile_id
  ) returning id into v_id;

  insert into public.training_events(training_session_id, event_type, actor_profile_id, metadata)
  values (p_session_id, 'attendee_added', p_actor_profile_id, jsonb_build_object('attendee_id', v_id));
  return v_id;
end
$function$;

create or replace function public.rpc_remove_reliance_training_attendee(
  p_session_id uuid,
  p_actor_profile_id uuid,
  p_attendee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_deleted uuid;
begin
  perform public.training_assert_draft_editor(p_session_id, p_actor_profile_id);
  delete from public.training_session_attendees
  where id = p_attendee_id and training_session_id = p_session_id
  returning id into v_deleted;
  if v_deleted is null then raise exception using errcode = 'P0002', message = 'training_attendee_not_found'; end if;
  insert into public.training_events(training_session_id, event_type, actor_profile_id, metadata)
  values (p_session_id, 'attendee_removed', p_actor_profile_id, jsonb_build_object('attendee_id', v_deleted));
  return v_deleted;
end
$function$;

create or replace function public.rpc_set_reliance_training_topics(
  p_session_id uuid,
  p_actor_profile_id uuid,
  p_topic_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_session public.training_sessions%rowtype;
  v_ids uuid[] := coalesce(p_topic_ids, array[]::uuid[]);
  v_count integer;
begin
  perform public.training_assert_draft_editor(p_session_id, p_actor_profile_id);
  select * into v_session from public.training_sessions where id = p_session_id;
  if cardinality(v_ids) <> (
    select count(distinct u.value)
    from unnest(v_ids) as u(value)
  ) then
    raise exception using errcode = 'P0001', message = 'training_duplicate_topic_ids';
  end if;
  select count(*) into v_count
  from public.training_topics
  where id = any(v_ids) and category_id = v_session.category_id and is_active is true;
  if v_count <> cardinality(v_ids) then
    raise exception using errcode = '22023', message = 'training_topic_category_mismatch';
  end if;
  if exists (
    select 1
    from public.training_session_topics st
    join public.training_evidence e on e.training_session_topic_id = st.id
    where st.training_session_id = p_session_id
      and not (st.topic_id = any(v_ids))
  ) then
    raise exception using errcode = 'P0001', message = 'training_topic_has_evidence';
  end if;

  delete from public.training_session_topics
  where training_session_id = p_session_id and not (topic_id = any(v_ids));

  insert into public.training_session_topics(training_session_id, topic_id)
  select p_session_id, u.value from unnest(v_ids) as u(value)
  on conflict (training_session_id, topic_id) do nothing;

  insert into public.training_events(training_session_id, event_type, actor_profile_id, metadata)
  values (p_session_id, 'topics_updated', p_actor_profile_id, jsonb_build_object('topic_count', cardinality(v_ids)));
  return cardinality(v_ids);
end
$function$;

create or replace function public.rpc_update_reliance_training_topic(
  p_session_id uuid,
  p_actor_profile_id uuid,
  p_session_topic_id uuid,
  p_is_covered boolean,
  p_remarks text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_id uuid;
begin
  perform public.training_assert_draft_editor(p_session_id, p_actor_profile_id);
  if p_remarks is not null and char_length(p_remarks) > 1000 then
    raise exception using errcode = '22023', message = 'training_topic_remarks_too_long';
  end if;
  update public.training_session_topics
  set is_covered = coalesce(p_is_covered, false),
      remarks = nullif(btrim(coalesce(p_remarks, '')), ''),
      completed_at = case when coalesce(p_is_covered, false) then now() else null end,
      completed_by = case when coalesce(p_is_covered, false) then p_actor_profile_id else null end
  where id = p_session_topic_id and training_session_id = p_session_id
  returning id into v_id;
  if v_id is null then raise exception using errcode = 'P0002', message = 'training_session_topic_not_found'; end if;
  insert into public.training_events(training_session_id, event_type, actor_profile_id, metadata)
  values (
    p_session_id,
    case when coalesce(p_is_covered, false) then 'topic_covered' else 'draft_updated' end,
    p_actor_profile_id,
    jsonb_build_object('session_topic_id', v_id, 'is_covered', coalesce(p_is_covered, false))
  );
  return v_id;
end
$function$;

create or replace function public.rpc_complete_reliance_training_evidence(
  p_session_id uuid,
  p_actor_profile_id uuid,
  p_evidence_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_evidence public.training_evidence%rowtype;
begin
  perform public.training_assert_draft_editor(p_session_id, p_actor_profile_id);
  select * into v_evidence
  from public.training_evidence
  where id = p_evidence_id and training_session_id = p_session_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'training_evidence_not_found'; end if;
  if v_evidence.storage_bucket <> 'training-evidence'
     or v_evidence.storage_path not like 'training/' || p_session_id::text || '/' || p_evidence_id::text || '/%' then
    raise exception using errcode = '42501', message = 'training_evidence_path_forbidden';
  end if;
  if v_evidence.evidence_type = 'topic_photo' and v_evidence.training_session_topic_id is null then
    raise exception using errcode = '22023', message = 'training_topic_photo_topic_required';
  end if;
  if v_evidence.evidence_type <> 'topic_photo' and v_evidence.training_session_topic_id is not null then
    raise exception using errcode = '22023', message = 'training_supporting_evidence_topic_forbidden';
  end if;
  if v_evidence.training_session_topic_id is not null and not exists (
    select 1 from public.training_session_topics
    where id = v_evidence.training_session_topic_id and training_session_id = p_session_id
  ) then
    raise exception using errcode = '22023', message = 'training_evidence_topic_mismatch';
  end if;
  if coalesce(v_evidence.metadata ->> 'upload_status', '') = 'uploaded' then return v_evidence.id; end if;

  update public.training_evidence
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'upload_status', 'uploaded',
    'completed_at', now()
  )
  where id = v_evidence.id;
  insert into public.training_events(training_session_id, event_type, actor_profile_id, metadata)
  values (p_session_id, 'evidence_uploaded', p_actor_profile_id, jsonb_build_object('evidence_id', v_evidence.id, 'evidence_type', v_evidence.evidence_type));
  return v_evidence.id;
end
$function$;

create or replace function public.rpc_delete_reliance_training_evidence(
  p_session_id uuid,
  p_actor_profile_id uuid,
  p_evidence_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_deleted uuid;
begin
  perform public.training_assert_draft_editor(p_session_id, p_actor_profile_id);
  delete from public.training_evidence
  where id = p_evidence_id and training_session_id = p_session_id
  returning id into v_deleted;
  if v_deleted is null then raise exception using errcode = 'P0002', message = 'training_evidence_not_found'; end if;
  insert into public.training_events(training_session_id, event_type, actor_profile_id, metadata)
  values (p_session_id, 'evidence_deleted', p_actor_profile_id, jsonb_build_object('evidence_id', v_deleted));
  return v_deleted;
end
$function$;

create or replace function public.rpc_submit_reliance_training_session(
  p_session_id uuid,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_session public.training_sessions%rowtype;
  v_category_code text;
  v_type_code text;
  v_attendee_count integer;
  v_topic_count integer;
  v_covered_count integer;
  v_evidence_count integer;
begin
  perform public.training_assert_draft_editor(p_session_id, p_actor_profile_id);
  select * into v_session
  from public.training_sessions
  where id = p_session_id;

  select c.code, tt.code
  into v_category_code, v_type_code
  from public.training_categories c
  join public.training_types tt on tt.id = v_session.training_type_id and tt.is_active
  where c.id = v_session.category_id and c.is_active;
  if not found then raise exception using errcode = 'P0001', message = 'training_master_inactive'; end if;

  select count(*) into v_attendee_count from public.training_session_attendees where training_session_id = p_session_id;
  select count(*), count(*) filter (where is_covered)
  into v_topic_count, v_covered_count
  from public.training_session_topics where training_session_id = p_session_id;
  select count(*) into v_evidence_count
  from public.training_evidence
  where training_session_id = p_session_id and metadata ->> 'upload_status' = 'uploaded';

  if v_session.require_attendee_snapshot and v_attendee_count < 1 then
    raise exception using errcode = 'P0001', message = 'training_attendee_required';
  end if;
  if v_session.require_selected_topic_snapshot and v_topic_count < 1 then
    raise exception using errcode = 'P0001', message = 'training_topic_required';
  end if;
  if exists (
    select 1 from public.training_session_topics st
    join public.training_topics t on t.id = st.topic_id
    where st.training_session_id = p_session_id
      and (t.category_id <> v_session.category_id or t.is_active is not true)
  ) then
    raise exception using errcode = 'P0001', message = 'training_topic_relation_invalid';
  end if;
  if exists (
    select 1 from public.training_evidence e
    where e.training_session_id = p_session_id
      and coalesce(e.metadata ->> 'upload_status', '') <> 'uploaded'
  ) then
    raise exception using errcode = 'P0001', message = 'training_evidence_upload_incomplete';
  end if;
  if exists (
    select 1 from public.training_evidence e
    where e.training_session_id = p_session_id
      and (
        e.storage_bucket <> 'training-evidence'
        or e.storage_path not like 'training/' || p_session_id::text || '/' || e.id::text || '/%'
        or (e.evidence_type = 'topic_photo' and e.training_session_topic_id is null)
        or (e.evidence_type <> 'topic_photo' and e.training_session_topic_id is not null)
        or (
          e.training_session_topic_id is not null
          and not exists (
            select 1 from public.training_session_topics st
            where st.id = e.training_session_topic_id and st.training_session_id = p_session_id
          )
        )
      )
  ) then
    raise exception using errcode = 'P0001', message = 'training_evidence_relation_invalid';
  end if;
  if v_session.topic_evidence_policy_snapshot = 'required' and exists (
    select 1 from public.training_session_topics st
    where st.training_session_id = p_session_id
      and not exists (
        select 1 from public.training_evidence e
        where e.training_session_id = p_session_id
          and e.training_session_topic_id = st.id
          and e.evidence_type = 'topic_photo'
          and e.metadata ->> 'upload_status' = 'uploaded'
      )
  ) then
    raise exception using errcode = 'P0001', message = 'training_topic_evidence_required';
  end if;
  if v_session.topic_evidence_policy_snapshot = 'at_least_one' and not exists (
    select 1 from public.training_evidence e
    where e.training_session_id = p_session_id
      and e.evidence_type = 'topic_photo'
      and e.training_session_topic_id is not null
      and e.metadata ->> 'upload_status' = 'uploaded'
  ) then
    raise exception using errcode = 'P0001', message = 'training_topic_evidence_at_least_one';
  end if;
  if v_session.require_group_photo_snapshot and not exists (
    select 1 from public.training_evidence where training_session_id = p_session_id and evidence_type = 'group_photo' and metadata ->> 'upload_status' = 'uploaded'
  ) then raise exception using errcode = 'P0001', message = 'training_group_photo_required'; end if;
  if v_session.require_attendance_sheet_snapshot and not exists (
    select 1 from public.training_evidence where training_session_id = p_session_id and evidence_type = 'attendance_sheet' and metadata ->> 'upload_status' = 'uploaded'
  ) then raise exception using errcode = 'P0001', message = 'training_attendance_sheet_required'; end if;
  if v_session.require_training_document_snapshot and not exists (
    select 1 from public.training_evidence where training_session_id = p_session_id and evidence_type = 'training_document' and metadata ->> 'upload_status' = 'uploaded'
  ) then raise exception using errcode = 'P0001', message = 'training_document_required'; end if;

  update public.training_sessions
  set status = 'submitted', submitted_at = now(), submitted_by = p_actor_profile_id
  where id = p_session_id;
  update public.fo_activity_submissions
  set status = 'submitted',
      submitted_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'structured_status', 'submitted',
        'training_schema', 'structured_v1',
        'training_source', 'reliance_structured',
        'training_category_code', v_category_code,
        'training_type_code', v_type_code,
        'training_attendees_count', v_attendee_count,
        'training_topics_count', v_topic_count,
        'training_topics_completed_count', v_covered_count,
        'training_evidence_count', v_evidence_count
      )
  where id = p_session_id;
  insert into public.training_events(training_session_id, event_type, actor_profile_id, metadata)
  values (p_session_id, 'submitted', p_actor_profile_id, jsonb_build_object(
    'attendee_count', v_attendee_count,
    'topic_count', v_topic_count,
    'evidence_count', v_evidence_count
  ));
  return p_session_id;
end
$function$;

create or replace function public.rpc_cancel_reliance_training_session(
  p_session_id uuid,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  perform public.training_assert_draft_editor(p_session_id, p_actor_profile_id);
  update public.training_sessions
  set status = 'cancelled', cancelled_at = now(), cancelled_by = p_actor_profile_id
  where id = p_session_id;
  -- Legacy generic activities do not define a cancelled status contract. Keep
  -- the envelope as draft and expose cancellation through compatibility metadata.
  update public.fo_activity_submissions
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'structured_status', 'cancelled',
    'training_cancelled', true
  )
  where id = p_session_id;
  insert into public.training_events(training_session_id, event_type, actor_profile_id, metadata)
  values (p_session_id, 'cancelled', p_actor_profile_id, '{}'::jsonb);
  return p_session_id;
end
$function$;

revoke all on function public.training_assert_draft_editor(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_create_reliance_training_session(uuid, uuid, uuid, uuid, uuid, date, text, text) from public, anon, authenticated;
revoke all on function public.rpc_update_reliance_training_draft(uuid, uuid, uuid, uuid, date, text, text) from public, anon, authenticated;
revoke all on function public.rpc_add_reliance_training_attendee(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_remove_reliance_training_attendee(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_set_reliance_training_topics(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.rpc_update_reliance_training_topic(uuid, uuid, uuid, boolean, text) from public, anon, authenticated;
revoke all on function public.rpc_complete_reliance_training_evidence(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_delete_reliance_training_evidence(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_submit_reliance_training_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.rpc_cancel_reliance_training_session(uuid, uuid) from public, anon, authenticated;

grant execute on function public.training_assert_draft_editor(uuid, uuid) to service_role;
grant execute on function public.rpc_create_reliance_training_session(uuid, uuid, uuid, uuid, uuid, date, text, text) to service_role;
grant execute on function public.rpc_update_reliance_training_draft(uuid, uuid, uuid, uuid, date, text, text) to service_role;
grant execute on function public.rpc_add_reliance_training_attendee(uuid, uuid, uuid) to service_role;
grant execute on function public.rpc_remove_reliance_training_attendee(uuid, uuid, uuid) to service_role;
grant execute on function public.rpc_set_reliance_training_topics(uuid, uuid, uuid[]) to service_role;
grant execute on function public.rpc_update_reliance_training_topic(uuid, uuid, uuid, boolean, text) to service_role;
grant execute on function public.rpc_complete_reliance_training_evidence(uuid, uuid, uuid) to service_role;
grant execute on function public.rpc_delete_reliance_training_evidence(uuid, uuid, uuid) to service_role;
grant execute on function public.rpc_submit_reliance_training_session(uuid, uuid) to service_role;
grant execute on function public.rpc_cancel_reliance_training_session(uuid, uuid) to service_role;

comment on function public.rpc_create_reliance_training_session(uuid, uuid, uuid, uuid, uuid, date, text, text) is
  'Backend-only atomic creator for a generic Training envelope and structured Reliance Training session.';
comment on function public.rpc_submit_reliance_training_session(uuid, uuid) is
  'Backend-only concurrency-safe structured Training submission with server-side invariant validation.';

commit;
