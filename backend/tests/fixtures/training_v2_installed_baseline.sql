-- Read-only production function definitions captured 2026-11-26; no records or credentials.
CREATE OR REPLACE FUNCTION public.rpc_update_reliance_training_draft(p_session_id uuid, p_actor_profile_id uuid, p_category_id uuid, p_training_type_id uuid, p_training_date date, p_trainer_name text, p_remarks text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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


CREATE OR REPLACE FUNCTION public.rpc_add_reliance_training_attendee(p_session_id uuid, p_actor_profile_id uuid, p_attendee_profile_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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


CREATE OR REPLACE FUNCTION public.rpc_remove_reliance_training_attendee(p_session_id uuid, p_actor_profile_id uuid, p_attendee_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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


CREATE OR REPLACE FUNCTION public.rpc_set_reliance_training_topics(p_session_id uuid, p_actor_profile_id uuid, p_topic_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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


CREATE OR REPLACE FUNCTION public.rpc_create_reliance_training_session(p_actor_profile_id uuid, p_attendance_id uuid, p_site_visit_id uuid, p_category_id uuid, p_training_type_id uuid, p_training_date date, p_trainer_name text, p_remarks text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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


CREATE OR REPLACE FUNCTION public.rpc_update_reliance_training_topic(p_session_id uuid, p_actor_profile_id uuid, p_session_topic_id uuid, p_is_covered boolean, p_remarks text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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


CREATE OR REPLACE FUNCTION public.rpc_complete_reliance_training_evidence(p_session_id uuid, p_actor_profile_id uuid, p_evidence_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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


CREATE OR REPLACE FUNCTION public.rpc_submit_reliance_training_session(p_session_id uuid, p_actor_profile_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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

  if v_topic_count < 1 then
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
  if exists (
    select 1 from public.training_session_topics st
    where st.training_session_id = p_session_id
      and not exists (
        select 1 from public.training_evidence e
        where e.training_session_id = p_session_id
          and e.training_session_topic_id = st.id
          and e.evidence_type = 'topic_photo'
          and e.metadata ->> 'upload_status' = 'uploaded'
          and e.mime_type in ('image/jpeg','image/png') and e.file_size>0
          and e.uploaded_by=v_session.trainer_profile_id
          and coalesce(e.metadata->>'verified_sha256','') ~ '^[a-f0-9]{64}$'
          and exists(select 1 from storage.buckets b where b.id='training-evidence' and b.public=false)
          and exists(select 1 from storage.objects o where o.bucket_id=e.storage_bucket and o.name=e.storage_path
            and (o.metadata->>'size')::bigint=e.file_size and o.metadata->>'mimetype'=e.mime_type)
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

  insert into public.training_events(training_session_id,event_type,actor_profile_id,metadata)
  values(p_session_id,'draft_updated',p_actor_profile_id,jsonb_build_object('policy','topic_photo_v4','attendees_optional',true));
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


CREATE OR REPLACE FUNCTION public.rpc_delete_reliance_training_evidence(p_session_id uuid, p_actor_profile_id uuid, p_evidence_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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


CREATE OR REPLACE FUNCTION public.rpc_cancel_reliance_training_session(p_session_id uuid, p_actor_profile_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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


CREATE OR REPLACE FUNCTION public.training_session_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  if not public.training_category_allowed_v4(new.trainer_profile_id,new.category_id) then
    raise exception using errcode='42501',message='training_category_forbidden';
  end if;
  perform public.training_assert_active_context(new.trainer_profile_id, new.attendance_id, new.site_visit_id);
  if tg_op = 'INSERT' then
    if new.retail_store_id is null or not public.training_retail_store_allowed(new.trainer_profile_id, new.retail_store_id, new.category_id) then
      raise exception using errcode = '42501', message = 'training_store_scope_forbidden';
    end if;
    new.training_date := (clock_timestamp() at time zone 'Asia/Kolkata')::date;
  else
    if old.status <> 'draft' then raise exception using errcode = 'P0001', message = 'training_session_immutable'; end if;
    new.training_date := old.training_date;
    if new.category_id is distinct from old.category_id then
      raise exception using errcode='42501',message='training_category_change_forbidden';
    end if;
    if new.attendance_id is distinct from old.attendance_id or new.site_visit_id is distinct from old.site_visit_id
       or new.trainer_profile_id is distinct from old.trainer_profile_id or new.store_id is distinct from old.store_id
       or new.retail_store_id is distinct from old.retail_store_id then
      raise exception using errcode = '42501', message = 'training_session_context_immutable';
    end if;
    if new.retail_store_id is not null and not public.training_retail_store_allowed(new.trainer_profile_id, new.retail_store_id, new.category_id) then
      raise exception using errcode = '42501', message = 'training_store_scope_forbidden';
    end if;
  end if;
  -- Explicit mobile policy applies to new and edited drafts; terminal rows stay immutable.
  new.require_attendee_snapshot := false;
  new.require_selected_topic_snapshot := true;
  new.topic_evidence_policy_snapshot := 'required';
  new.require_group_photo_snapshot := false;
  new.require_attendance_sheet_snapshot := false;
  new.require_training_document_snapshot := false;
  return new;
end; $function$;


CREATE OR REPLACE FUNCTION public.training_child_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare sid uuid; actor uuid;
begin
  if tg_op = 'DELETE' then sid := old.training_session_id; else sid := new.training_session_id; end if;
  if tg_op = 'UPDATE' and new.training_session_id is distinct from old.training_session_id then
    raise exception using errcode = '42501', message = 'training_session_context_immutable';
  end if;
  select trainer_profile_id into actor from public.training_sessions where id = sid;
  perform public.training_assert_draft_editor(sid, actor);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $function$;


CREATE OR REPLACE FUNCTION public.training_legacy_write_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare code text; p public.profiles%rowtype; training_write boolean;
begin
  training_write := new.activity_type = 'training';
  if tg_op = 'UPDATE' then training_write := training_write or old.activity_type = 'training'; end if;
  if tg_table_name = 'fo_activity_uploads' then
    training_write := training_write or exists(select 1 from public.training_sessions where id = new.submission_id);
  end if;
  if not training_write then return new; end if;
  code := upper(btrim(coalesce(nullif(new.employee_code,''),new.fo_user_id,'')));
  if coalesce(auth.role(),'') = 'authenticated' then
    select * into p from public.profiles where auth_user_id = auth.uid();
  else
    select * into p from public.profiles where upper(btrim(coalesce(nullif(employee_code,''),username,''))) = code limit 1;
  end if;
  if not found then return new; end if;
  if regexp_replace(upper(coalesce(p.business,'')), '[^A-Z0-9]+','','g') not in ('RELIANCE','RELIANCERETAIL')
     and not exists (
       select 1 from public.fo_site_visits v left join public.store_master s on s.id = v.store_id
       where v.id = new.site_visit_id and (v.retail_store_id is not null
         or regexp_replace(upper(coalesce(s.business,'')), '[^A-Z0-9]+','','g') in ('RELIANCE','RELIANCERETAIL')
         or regexp_replace(upper(coalesce(s.client_name,'')), '[^A-Z0-9]+','','g') in ('RELIANCE','RELIANCERETAIL'))
     ) then return new; end if;
  if tg_table_name = 'fo_activity_uploads' or coalesce(auth.role(),'') = 'authenticated'
     or coalesce(new.metadata ->> 'training_schema','') <> 'structured_v1' then
    raise exception using errcode = '42501', message = 'training_legacy_read_only';
  end if;
  perform public.training_assert_active_context(p.id,new.attendance_id,new.site_visit_id);
  return new;
end; $function$;


CREATE OR REPLACE FUNCTION public.training_assert_active_context(p_actor_profile_id uuid, p_attendance_id uuid, p_site_visit_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare p public.profiles%rowtype; a public.fo_attendance%rowtype; v public.fo_site_visits%rowtype; code text;
begin
  select * into p from public.profiles where id = p_actor_profile_id;
  if not public.training_retail_actor_v4(p_actor_profile_id)
     or public.training_role_v4(p.role) not in ('FO','KAM','OPERATIONSMANAGER','BRANCHHEAD') then
    raise exception using errcode = '42501', message = 'training_mutation_forbidden';
  end if;
  code := upper(btrim(coalesce(nullif(p.employee_code,''),p.username,'')));
  if code = '' then raise exception using errcode = '42501', message = 'training_actor_identity_incomplete'; end if;
  -- SHARE locks serialize accepted mutations against concurrent Check-Out/End Day UPDATEs.
  select * into a from public.fo_attendance where id = p_attendance_id for share;
  if not found then raise exception using errcode = 'P0002', message = 'training_attendance_not_found'; end if;
  if code not in (upper(coalesce(a.employee_code,'')),upper(coalesce(a.fo_user_id,'')),upper(coalesce(a.username,''))) then
    raise exception using errcode = '42501', message = 'training_attendance_forbidden';
  end if;
  if a.logout_time is not null or lower(coalesce(a.status,'')) <> 'active' then
    raise exception using errcode = 'P0001', message = 'training_attendance_not_active';
  end if;
  select * into v from public.fo_site_visits where id = p_site_visit_id for share;
  if not found then raise exception using errcode = 'P0002', message = 'training_site_visit_not_found'; end if;
  if v.attendance_id is distinct from a.id or code not in (upper(coalesce(v.employee_code,'')),upper(coalesce(v.fo_user_id,''))) then
    raise exception using errcode = '42501', message = 'training_site_visit_forbidden';
  end if;
  if v.check_in_time is null or v.check_out_time is not null or v.checkout_time is not null then
    raise exception using errcode = 'P0001', message = 'training_site_visit_not_active';
  end if;
end; $function$;


CREATE OR REPLACE FUNCTION public.rpc_create_reliance_training_session_v3(p_actor_profile_id uuid, p_attendance_id uuid, p_site_visit_id uuid, p_category_id uuid, p_training_type_id uuid, p_training_date date, p_trainer_name text, p_retail_store_id uuid, p_remarks text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_profile public.profiles%rowtype;
  v_attendance public.fo_attendance%rowtype;
  v_visit public.fo_site_visits%rowtype;
  v_store public.reliance_retail_store_master%rowtype;
  v_category public.training_categories%rowtype;
  v_type public.training_types%rowtype;
  v_client public.access_clients%rowtype;
  v_session_id uuid := gen_random_uuid();
  v_employee_code text;
begin
  perform public.training_assert_active_context(p_actor_profile_id, p_attendance_id, p_site_visit_id);
  select * into v_profile from public.profiles where id = p_actor_profile_id;
  select * into v_attendance from public.fo_attendance where id = p_attendance_id;
  select * into v_visit from public.fo_site_visits where id = p_site_visit_id;
  v_employee_code := btrim(coalesce(nullif(v_profile.employee_code,''), v_profile.username));
  if not public.training_retail_store_allowed(p_actor_profile_id, p_retail_store_id, p_category_id) then
    raise exception using errcode = '42501', message = 'training_store_scope_forbidden';
  end if;
  select * into v_store from public.reliance_retail_store_master where id = p_retail_store_id for share;
  select * into v_client from public.access_clients
    where id = '369d2d5f-396f-49f9-a47d-bfbc8f7cb922'::uuid and code = 'reliance_retail' and active is true;
  select * into v_category from public.training_categories where id = p_category_id and is_active is true;
  select * into v_type from public.training_types where id = p_training_type_id and is_active is true;
  if v_client.id is null or v_category.id is null or v_type.id is null then
    raise exception using errcode = 'P0002', message = 'training_master_data_not_found';
  end if;
  if p_training_date is null or btrim(coalesce(p_trainer_name, '')) = '' then
    raise exception using errcode = '22023', message = 'training_required_field_missing';
  end if;
  if p_remarks is not null and char_length(p_remarks) > 500 then
    raise exception using errcode = '22023', message = 'training_remarks_too_long';
  end if;
  insert into public.fo_activity_submissions (
    id, fo_user_id, employee_code, attendance_id, site_visit_id, retail_store_id,
    store_code, activity_type, status, remarks, submitted_at, metadata
  ) values (
    v_session_id, v_employee_code, v_employee_code, v_attendance.id, v_visit.id, v_store.id,
    v_store.store_code, 'training', 'draft', p_remarks, now(),
    jsonb_build_object('training_schema','structured_v1','training_source','reliance_retail_master','structured_status','draft')
  );
  insert into public.training_sessions (
    id, category_id, training_type_id, trainer_profile_id, trainer_name_snapshot,
    training_date, remarks, status, attendance_id, site_visit_id, retail_store_id,
    access_client_id, access_client_code, business_code_snapshot, business_name_snapshot,
    state_snapshot, store_code_snapshot, store_name_snapshot, require_attendee_snapshot,
    require_selected_topic_snapshot, topic_evidence_policy_snapshot, require_group_photo_snapshot,
    require_attendance_sheet_snapshot, require_training_document_snapshot, max_group_photos_snapshot
  ) values (
    v_session_id, v_category.id, v_type.id, v_profile.id, btrim(p_trainer_name),
    (clock_timestamp() at time zone 'Asia/Kolkata')::date, nullif(btrim(coalesce(p_remarks,'')),''), 'draft', v_attendance.id, v_visit.id, v_store.id,
    v_client.id, v_client.code, 'reliance_retail', v_client.name, v_store.state, v_store.store_code,
    v_store.store_name, case when v_category.code = 'hk' then false else v_category.require_attendee end, v_category.require_selected_topic,
    v_category.topic_evidence_policy, v_category.require_group_photo, v_category.require_attendance_sheet,
    v_category.require_training_document, v_category.max_group_photos
  );
  insert into public.training_events(training_session_id, event_type, actor_profile_id, metadata)
  values (
    v_session_id, 'session_created', v_profile.id,
    jsonb_build_object('category_code', v_category.code, 'training_type_code', v_type.code,
      'store_source', 'RELIANCE_RETAIL')
  );
  return v_session_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.rpc_submit_reliance_training_session_v2(p_session_id uuid, p_actor_profile_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare s public.training_sessions%rowtype;
begin
  select * into s from public.training_sessions where id = p_session_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'training_session_not_found'; end if;
  if s.trainer_profile_id is distinct from p_actor_profile_id then raise exception using errcode = '42501', message = 'training_not_session_creator'; end if;
  -- Retry is a read, including after closure; it must not append a second submitted event.
  if s.status = 'submitted' then return s.id; end if;
  return public.rpc_submit_reliance_training_session(p_session_id,p_actor_profile_id);
end; $function$;


CREATE OR REPLACE FUNCTION public.training_assert_draft_editor(p_session_id uuid, p_actor_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_profile public.profiles%rowtype;
  v_session public.training_sessions%rowtype;
  v_envelope public.fo_activity_submissions%rowtype;
  v_store public.store_master%rowtype;
  v_retail_store public.reliance_retail_store_master%rowtype;
begin
  select * into v_profile from public.profiles where id = p_actor_profile_id;
  if not public.training_retail_actor_v4(p_actor_profile_id) then
    raise exception using errcode = '42501', message = 'training_mutation_forbidden';
  end if;
  select * into v_session from public.training_sessions where id = p_session_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'training_session_not_found'; end if;
  if not public.training_category_allowed_v4(p_actor_profile_id,v_session.category_id) then
    raise exception using errcode='42501',message='training_category_forbidden';
  end if;
  if v_session.trainer_profile_id is distinct from p_actor_profile_id then
    raise exception using errcode='42501',message='training_not_session_creator';
  end if;
  if v_session.status <> 'draft' then raise exception using errcode = 'P0001', message = 'training_session_immutable'; end if;
  if v_session.access_client_id <> '369d2d5f-396f-49f9-a47d-bfbc8f7cb922'::uuid
     or v_session.access_client_code <> 'reliance_retail' then
    raise exception using errcode = '42501', message = 'training_non_reliance_session';
  end if;
  select * into v_envelope from public.fo_activity_submissions where id = p_session_id for update;
  if not found or v_envelope.activity_type <> 'training' then
    raise exception using errcode = 'P0001', message = 'training_envelope_invalid';
  end if;
  if upper(btrim(coalesce(v_envelope.employee_code, v_envelope.fo_user_id, '')))
     <> upper(btrim(coalesce(v_profile.employee_code, v_profile.username, ''))) then
    raise exception using errcode = '42501', message = 'training_not_session_creator';
  end if;
  perform public.training_assert_active_context(p_actor_profile_id, v_session.attendance_id, v_session.site_visit_id);
  if v_session.retail_store_id is not null then
    select * into v_retail_store from public.reliance_retail_store_master where id = v_session.retail_store_id;
    if not public.training_retail_store_allowed(p_actor_profile_id, v_session.retail_store_id, v_session.category_id) then
      raise exception using errcode = '42501', message = 'training_store_scope_forbidden';
    end if;
  else
    select * into v_store from public.store_master where id = v_session.store_id;
    if not found or not (
      regexp_replace(upper(coalesce(v_store.business, '')), '[^A-Z0-9]+', '', 'g') in ('RELIANCE','RELIANCERETAIL')
      or regexp_replace(upper(coalesce(v_store.client_name, '')), '[^A-Z0-9]+', '', 'g') in ('RELIANCE','RELIANCERETAIL')
    ) then
      raise exception using errcode = '42501', message = 'training_non_reliance_store';
    end if;
  end if;
end;
$function$;


CREATE OR REPLACE FUNCTION public.rpc_create_reliance_training_session_v2(p_actor_profile_id uuid, p_attendance_id uuid, p_site_visit_id uuid, p_category_id uuid, p_training_type_id uuid, p_training_date date, p_trainer_name text, p_remarks text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_profile public.profiles%rowtype;
  v_attendance public.fo_attendance%rowtype;
  v_visit public.fo_site_visits%rowtype;
  v_store public.reliance_retail_store_master%rowtype;
  v_category public.training_categories%rowtype;
  v_type public.training_types%rowtype;
  v_client public.access_clients%rowtype;
  v_session_id uuid := gen_random_uuid();
  v_employee_code text;
begin
  select * into v_visit from public.fo_site_visits where id = p_site_visit_id for share;
  if not found then raise exception using errcode = 'P0002', message = 'training_site_visit_not_found'; end if;
  if v_visit.retail_store_id is null then
    return public.rpc_create_reliance_training_session(p_actor_profile_id, p_attendance_id, p_site_visit_id,
      p_category_id, p_training_type_id, p_training_date, p_trainer_name, p_remarks);
  end if;
  select * into v_profile from public.profiles where id = p_actor_profile_id;
  if not found or v_profile.is_active is not true
     or regexp_replace(upper(coalesce(v_profile.role, '')), '[^A-Z0-9]+', '', 'g') not in ('FO','OPERATIONSMANAGER')
     or regexp_replace(upper(coalesce(v_profile.business, '')), '[^A-Z0-9]+', '', 'g') not in ('RELIANCE','RELIANCERETAIL') then
    raise exception using errcode = '42501', message = 'training_actor_business_forbidden';
  end if;
  v_employee_code := btrim(coalesce(nullif(v_profile.employee_code, ''), v_profile.username, ''));
  if v_employee_code = '' then
    raise exception using errcode = '42501', message = 'training_actor_identity_incomplete';
  end if;
  select * into v_attendance from public.fo_attendance where id = p_attendance_id for share;
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
  if v_visit.attendance_id is distinct from v_attendance.id then
    raise exception using errcode = 'P0001', message = 'training_visit_attendance_mismatch';
  end if;
  if v_visit.check_out_time is not null or v_visit.checkout_time is not null then
    raise exception using errcode = 'P0001', message = 'training_visit_not_active';
  end if;
  if upper(v_employee_code) not in (upper(btrim(coalesce(v_visit.employee_code, ''))), upper(btrim(coalesce(v_visit.fo_user_id, '')))) then
    raise exception using errcode = '42501', message = 'training_site_visit_forbidden';
  end if;
  if v_visit.store_source <> 'RELIANCE_RETAIL' or v_visit.store_id is not null or v_visit.site_id is not null then
    raise exception using errcode = 'P0001', message = 'training_retail_visit_identity_invalid';
  end if;
  select * into v_store from public.reliance_retail_store_master where id = v_visit.retail_store_id for share;
  if not found or v_store.status <> 'Active' or v_store.assigned_fo_profile_id <> v_profile.id then
    raise exception using errcode = '42501', message = 'training_non_reliance_store';
  end if;
  if btrim(coalesce(v_profile.state, '')) <> '' and upper(btrim(v_profile.state)) <> upper(btrim(v_store.state)) then
    raise exception using errcode = '42501', message = 'training_cross_state_forbidden';
  end if;
  select * into v_client from public.access_clients
    where id = '369d2d5f-396f-49f9-a47d-bfbc8f7cb922'::uuid and code = 'reliance_retail' and active is true;
  select * into v_category from public.training_categories where id = p_category_id and is_active is true;
  select * into v_type from public.training_types where id = p_training_type_id and is_active is true;
  if v_client.id is null or v_category.id is null or v_type.id is null then
    raise exception using errcode = 'P0002', message = 'training_master_data_not_found';
  end if;
  if p_training_date is null or btrim(coalesce(p_trainer_name, '')) = '' then
    raise exception using errcode = '22023', message = 'training_required_field_missing';
  end if;
  if p_remarks is not null and char_length(p_remarks) > 500 then
    raise exception using errcode = '22023', message = 'training_remarks_too_long';
  end if;
  insert into public.fo_activity_submissions (
    id, fo_user_id, employee_code, attendance_id, site_visit_id, retail_store_id,
    store_code, activity_type, status, remarks, submitted_at, metadata
  ) values (
    v_session_id, v_employee_code, v_employee_code, v_attendance.id, v_visit.id, v_store.id,
    v_store.store_code, 'training', 'draft', p_remarks, now(),
    jsonb_build_object('training_schema','structured_v1','training_source','reliance_retail_master','structured_status','draft')
  );
  insert into public.training_sessions (
    id, category_id, training_type_id, trainer_profile_id, trainer_name_snapshot,
    training_date, remarks, status, attendance_id, site_visit_id, retail_store_id,
    access_client_id, access_client_code, business_code_snapshot, business_name_snapshot,
    state_snapshot, store_code_snapshot, store_name_snapshot, require_attendee_snapshot,
    require_selected_topic_snapshot, topic_evidence_policy_snapshot, require_group_photo_snapshot,
    require_attendance_sheet_snapshot, require_training_document_snapshot, max_group_photos_snapshot
  ) values (
    v_session_id, v_category.id, v_type.id, v_profile.id, btrim(p_trainer_name),
    p_training_date, nullif(btrim(coalesce(p_remarks,'')),''), 'draft', v_attendance.id, v_visit.id, v_store.id,
    v_client.id, v_client.code, 'reliance_retail', v_client.name, v_store.state, v_store.store_code,
    v_store.store_name, v_category.require_attendee, v_category.require_selected_topic,
    v_category.topic_evidence_policy, v_category.require_group_photo, v_category.require_attendance_sheet,
    v_category.require_training_document, v_category.max_group_photos
  );
  insert into public.training_events(training_session_id, event_type, actor_profile_id, metadata)
  values (
    v_session_id, 'session_created', v_profile.id,
    jsonb_build_object('category_code', v_category.code, 'training_type_code', v_type.code,
      'store_source', 'RELIANCE_RETAIL')
  );
  return v_session_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.training_role_v4(p_role text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 SELECT CASE regexp_replace(upper(coalesce(p_role,'')),'[^A-Z0-9]','','g')
 WHEN 'FIELDOFFICER' THEN 'FO' WHEN 'KEYACCOUNTMANAGER' THEN 'KAM'
 WHEN 'OM' THEN 'OPERATIONSMANAGER' WHEN 'OPERATIONMANAGER' THEN 'OPERATIONSMANAGER'
 WHEN 'OPSMANAGER' THEN 'OPERATIONSMANAGER' WHEN 'BH' THEN 'BRANCHHEAD'
 ELSE regexp_replace(upper(coalesce(p_role,'')),'[^A-Z0-9]','','g') END;
$function$;


CREATE OR REPLACE FUNCTION public.training_retail_actor_v4(p_actor_profile_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_actor_profile_id AND p.is_active IS TRUE
 AND regexp_replace(upper(coalesce(p.status,'Active')),'[^A-Z0-9]','','g')='ACTIVE'
 AND p.auth_user_id IS NOT NULL AND (regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]','','g') IN ('RELIANCE','RELIANCERETAIL')
 OR EXISTS(SELECT 1 FROM public.access_user_assignments a JOIN public.access_roles r ON r.id=a.role_id AND r.active
 WHERE a.profile_id=p.id AND a.auth_user_id=p.auth_user_id AND a.client_id='369d2d5f-396f-49f9-a47d-bfbc8f7cb922'::uuid
 AND a.active AND a.verification_status='verified' AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now())
 AND public.training_role_v4(r.code)=public.training_role_v4(p.role))));
$function$;


CREATE OR REPLACE FUNCTION public.training_category_allowed_v4(p_actor_profile_id uuid, p_category_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT public.training_retail_actor_v4(p_actor_profile_id) AND EXISTS(SELECT 1 FROM public.profiles p CROSS JOIN public.training_categories c
 WHERE p.id=p_actor_profile_id AND c.id=p_category_id AND c.is_active AND
 ((c.code='hk' AND public.training_role_v4(p.role)='FO') OR
 (c.code='technical_mep' AND public.training_role_v4(p.role) IN ('KAM','OPERATIONSMANAGER','BRANCHHEAD'))));
$function$;


CREATE OR REPLACE FUNCTION public.retail_mis_allowed(p_actor uuid, p_module text, p_state text, p_write boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select (p_module='oos' and public.retail_oos_operator_allowed(p_actor,(case when p_module='oos' then public.retail_oos_state(p_state) else p_state end))) or exists(select 1 from public.retail_mis_assignments a join public.profiles p on p.id=a.profile_id
 where a.profile_id=p_actor and a.active and p.is_active is true and upper(coalesce(p.status,'Active'))='ACTIVE'
 and p.auth_user_id=a.auth_user_id and p.employee_code=a.employee_code and p.role=a.role
 and ((case when p_module='oos' then public.retail_oos_state(p_state) else p_state end) is null or ((case when p_module='oos' then public.retail_oos_state(p_state) else p_state end) in ('AP-1','AP-2','KA','KL','TG','TN','PY') and (a.role='CENTRAL_MIS' or (case when p_module='oos' then public.retail_oos_state(p_state) else p_state end)=any(a.states))))
 and case a.role when 'CENTRAL_MIS' then p_module=any(array['dashboard','stores','attendance-hk','attendance-mepc','cleaning','pest','training-hk','training-mepc','fault','maintenance','thermography','oos','imports'])
 when 'MIS_HK' then p_module=any(array['stores','attendance-hk','cleaning','pest','training-hk'])
 when 'MIS_MEPC' then p_module=any(array['stores','attendance-mepc','fault','maintenance','thermography']) when 'MIS_OOS' then p_module='oos' else false end);
$function$;


CREATE OR REPLACE FUNCTION public.training_retail_store_allowed(p_actor_profile_id uuid, p_store_id uuid, p_category_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 WITH aliases(raw,canonical) AS (VALUES
  ('TN','TN'),('TAMILNADU','TN'),('PY','PY'),('PUDUCHERRY','PY'),('PONDICHERRY','PY'),
  ('AP','AP'),('ANDHRAPRADESH','AP'),('AP1','AP1'),('ANDHRAPRADESH1','AP1'),
  ('AP2','AP2'),('ANDHRAPRADESH2','AP2'),('KA','KA'),('KN','KA'),('KARNATAKA','KA'),
  ('KL','KL'),('KERALA','KL'),('TG','TG'),('TS','TG'),('TELANGANA','TG')
 )
 SELECT EXISTS (
  SELECT 1 FROM public.profiles p
  JOIN public.reliance_retail_store_master s ON s.id=p_store_id AND s.status='Active'
  JOIN public.training_categories c ON c.id=p_category_id AND c.is_active
  JOIN aliases actor_state ON actor_state.raw=regexp_replace(upper(coalesce(p.state,'')),'[^A-Z0-9]+','','g')
  JOIN aliases store_state ON store_state.raw=regexp_replace(upper(coalesce(s.state,'')),'[^A-Z0-9]+','','g')
  WHERE p.id=p_actor_profile_id AND p.is_active IS TRUE
   AND regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]+','','g') IN ('RELIANCE','RELIANCERETAIL')
   AND nullif(btrim(p.state),'') IS NOT NULL
   AND (
    (regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]+','','g') IN ('FO','FIELDOFFICER')
     AND upper(coalesce(nullif(btrim(p.status),''),'Active'))='ACTIVE'
     AND c.code IN ('hk','technical_mep')
     AND (actor_state.canonical=store_state.canonical
      OR (actor_state.canonical='AP' AND store_state.canonical IN ('AP1','AP2'))))
   )
 );
$function$;


CREATE OR REPLACE FUNCTION public.training_authorized_zones_v4(p_actor_profile_id uuid)
 RETURNS SETOF reliance_retail_zones
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 SELECT DISTINCT z.* FROM public.reliance_retail_zones z JOIN public.reliance_retail_zone_fo_assignments a ON a.zone_id=z.id
 JOIN public.profiles f ON f.id=a.fo_profile_id JOIN public.profiles p ON p.id=p_actor_profile_id
 WHERE public.training_retail_actor_v4(p.id) AND public.training_role_v4(p.role) IN ('FO','KAM','OPERATIONSMANAGER','BRANCHHEAD')
 AND regexp_replace(upper(coalesce(p.state,'')),'[^A-Z0-9]','','g') IN ('TN','PY','TAMILNADU','PUDUCHERRY','PONDICHERRY')
 AND regexp_replace(upper(coalesce(f.state,'')),'[^A-Z0-9]','','g') IN ('TN','PY','TAMILNADU','PUDUCHERRY','PONDICHERRY')
 AND regexp_replace(upper(coalesce(z.state,'')),'[^A-Z0-9]','','g') IN ('TN','PY','TAMILNADU','PUDUCHERRY','PONDICHERRY')
 AND z.status='Active' AND a.status='Active' AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now())
 AND f.is_active AND (f.id=p.id OR (public.training_role_v4(p.role)<>'FO' AND public.training_role_v4(f.role)='FO'
 AND public.training_retail_actor_v4(f.id) AND EXISTS(SELECT 1 FROM public.employee_hierarchy h WHERE h.is_active
 AND upper(btrim(h.employee_code))=upper(btrim(coalesce(nullif(f.employee_code,''),f.username)))
 AND upper(btrim(coalesce(nullif(p.employee_code,''),p.username))) IN
 (upper(btrim(h.manager_employee_code)),upper(btrim(h.managers_manager_employee_code)),upper(btrim(h.business_head_employee_code))))));
$function$;


CREATE OR REPLACE FUNCTION public.rpc_create_reliance_training_session_v4(p_actor_profile_id uuid, p_attendance_id uuid, p_site_visit_id uuid, p_category_id uuid, p_training_type_id uuid, p_training_date date, p_trainer_name text, p_retail_store_id uuid, p_creation_key text, p_remarks text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE sid uuid; existing public.training_sessions%rowtype;
BEGIN
 IF length(btrim(coalesce(p_creation_key,''))) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'training_creation_key_required'; END IF;
 IF NOT public.training_category_allowed_v4(p_actor_profile_id,p_category_id) THEN RAISE EXCEPTION USING errcode='42501',message='training_category_forbidden'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_profile_id::text||':'||p_creation_key,0));
 SELECT * INTO existing FROM public.training_sessions WHERE trainer_profile_id=p_actor_profile_id AND mobile_creation_key=p_creation_key;
 IF FOUND THEN
  IF existing.attendance_id IS DISTINCT FROM p_attendance_id OR existing.site_visit_id IS DISTINCT FROM p_site_visit_id
   OR existing.category_id IS DISTINCT FROM p_category_id OR existing.retail_store_id IS DISTINCT FROM p_retail_store_id
   OR existing.training_type_id IS DISTINCT FROM p_training_type_id THEN RAISE EXCEPTION 'training_creation_key_conflict'; END IF;
  RETURN existing.id;
 END IF;
 sid:=public.rpc_create_reliance_training_session_v3(p_actor_profile_id,p_attendance_id,p_site_visit_id,p_category_id,p_training_type_id,p_training_date,p_trainer_name,p_retail_store_id,p_remarks);
 UPDATE public.training_sessions SET mobile_creation_key=p_creation_key WHERE id=sid;
 UPDATE public.fo_activity_submissions SET metadata=metadata||jsonb_build_object('training_mobile_policy','topic_photo_v4') WHERE id=sid;
 RETURN sid;
END; $function$;


CREATE OR REPLACE FUNCTION qpms_training_reports.allowed(p_actor uuid, p_auth uuid, p_category text, p_state text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
 select p_category in ('hk','technical_mep') and p_state in ('AP-1','AP-2','KA','KL','TG','TN','PY') and (exists(select 1 from public.profiles p where p.id=p_actor and p.auth_user_id=p_auth
 and p.id='d40c2b3f-87f1-4c34-8798-cf9b0d9ca784'::uuid and p.auth_user_id='79cd196c-c6f3-404a-b22a-d4683afefa3f'::uuid
 and p.employee_code='QPMSADMIN' and p.is_active is true and upper(coalesce(p.status,''))='ACTIVE'
 and regexp_replace(upper(coalesce(p.role,'')),'[^A-Z0-9]','','g') in ('ADMIN','QPMSADMIN')) or exists(
  select 1 from public.retail_mis_assignments a join public.profiles p on p.id=a.profile_id
  where a.active and p.is_active is true and upper(coalesce(p.status,''))='ACTIVE'
   and a.profile_id=p_actor and a.auth_user_id=p_auth and p.auth_user_id=p_auth
   and a.employee_code=p.employee_code and a.role=p.role
   and (a.role='CENTRAL_MIS' or p_state=any(a.states))
   and (a.role='CENTRAL_MIS' or (a.role='MIS_HK' and p_category='hk') or (a.role='MIS_MEPC' and p_category='technical_mep'))
 ) )
$function$;


CREATE OR REPLACE FUNCTION public.rpc_retail_mis_training_v4(p_actor uuid, p_auth uuid, p_category text, p_from date, p_to date, p_state text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'qpms_training_reports'
AS $function$
declare stores jsonb; sessions jsonb; evidence jsonb;
begin
 if p_state is not null then p_state:=case regexp_replace(upper(btrim(p_state)),'[^A-Z0-9-]','','g') when 'KN' then 'KA' when 'KARNATAKA' then 'KA' when 'TAMILNADU' then 'TN' when 'PUDUCHERRY' then 'PY' else upper(btrim(p_state)) end;end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>366 or p_category not in ('hk','technical_mep') or p_category is null then raise exception using errcode='22023',message='Valid category and reporting dates required';end if;
 if p_state is not null and not qpms_training_reports.allowed(p_actor,p_auth,p_category,p_state) then raise exception using errcode='42501',message='Training state outside active MIS assignment';end if;
 if not exists(select 1 from unnest(array['AP-1','AP-2','KA','KL','TG','TN','PY']) s where qpms_training_reports.allowed(p_actor,p_auth,p_category,s)) then raise exception using errcode='42501',message='Verified category/module/state assignment required';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'store_code',m.store_code,'store_name',m.store_name,'state',m.state)),'[]') into stores
 from public.reliance_retail_store_master m where qpms_training_reports.allowed(p_actor,p_auth,p_category,m.state) and (p_state is null or m.state=p_state)
 and (select count(*) from public.reliance_retail_store_master x where upper(btrim(x.store_code))=upper(btrim(m.store_code)))=1;
 select coalesce(jsonb_agg(to_jsonb(t)||jsonb_build_object(
  'source_kind','existing_fo_training','training_class',case p_category when 'hk' then 'HK' else 'MEPC' end,
  'state',m.state,'reporting_state',case m.state when 'PY' then 'TN' else m.state end,
  'store_code',m.store_code,'store_name',m.store_name,
  'submitted_by_employee_code',coalesce(nullif(btrim(a.employee_code),''),nullif(btrim(a.fo_user_id),'')),
  'topic_names',coalesce((
   select jsonb_agg(topic.module_name order by topic.sort_order,topic.module_name,topic.id)
   from public.training_session_topics st join public.training_topics topic on topic.id=st.topic_id
   where st.training_session_id=t.id and topic.category_id=t.category_id
  ),'[]'::jsonb)
 )),'[]') into sessions
 from public.training_sessions t join public.training_categories c on c.id=t.category_id
 left join public.fo_activity_submissions a on a.id=t.id
 join public.reliance_retail_store_master m on (t.retail_store_id=m.id or (t.retail_store_id is null and upper(btrim(t.store_code_snapshot))=upper(btrim(m.store_code))))
 where m.id in (select (x->>'id')::uuid from jsonb_array_elements(stores) x)
 and upper(btrim(t.store_code_snapshot))=upper(btrim(m.store_code))
 and (t.state_snapshot is null or (case upper(t.state_snapshot) when 'KN' then 'KA' else upper(t.state_snapshot) end)=m.state)
 and t.access_client_code='reliance_retail' and c.code=p_category and t.training_date between p_from and p_to
 and t.status in ('submitted','completed');
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',e.id,'record_id',e.training_session_id,'status','uploaded','existing',true,
  'mime_type',e.mime_type,'topic_name',topic.module_name
 )),'[]') into evidence
 from public.training_evidence e
 left join public.training_session_topics st on st.id=e.training_session_topic_id and st.training_session_id=e.training_session_id
 left join public.training_topics topic on topic.id=st.topic_id
 where e.training_session_id in (select (x->>'id')::uuid from jsonb_array_elements(sessions) x)
 and e.metadata->>'upload_status'='uploaded' and e.storage_bucket='training-evidence'
 and exists(select 1 from storage.buckets b where b.id='training-evidence' and b.public=false)
 and exists(select 1 from storage.objects o where o.bucket_id=e.storage_bucket and o.name=e.storage_path)
 and e.storage_path like 'training/'||e.training_session_id::text||'/'||e.id::text||'/%';
 return jsonb_build_object('stores',stores,'rows',sessions,'evidence',evidence,'read_only',true,'from',p_from,'to',p_to,'category',p_category,'counts',jsonb_build_object('completed_sessions',jsonb_array_length(sessions)));
end $function$;


CREATE OR REPLACE FUNCTION public.rpc_retail_mis_training_evidence_v4(p_actor uuid, p_auth uuid, p_category text, p_session uuid, p_evidence uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'qpms_training_reports'
AS $function$
declare meta jsonb;
begin
 select jsonb_build_object('bucket',e.storage_bucket,'path',e.storage_path) into meta
 from public.training_evidence e join public.training_sessions t on t.id=e.training_session_id
 join public.training_categories c on c.id=t.category_id
 join public.reliance_retail_store_master m on (t.retail_store_id=m.id or (t.retail_store_id is null and upper(btrim(t.store_code_snapshot))=upper(btrim(m.store_code))))
 where e.id=p_evidence and t.id=p_session and c.code=p_category and t.access_client_code='reliance_retail'
 and t.status in ('submitted','completed') and e.metadata->>'upload_status'='uploaded'
 and upper(btrim(t.store_code_snapshot))=upper(btrim(m.store_code))
 and (t.state_snapshot is null or (case upper(t.state_snapshot) when 'KN' then 'KA' else upper(t.state_snapshot) end)=m.state)
 and (select count(*) from public.reliance_retail_store_master x where upper(btrim(x.store_code))=upper(btrim(m.store_code)))=1
 and qpms_training_reports.allowed(p_actor,p_auth,p_category,m.state)
 and e.storage_bucket='training-evidence' and e.storage_path like 'training/'||t.id::text||'/'||e.id::text||'/%'
 and exists(select 1 from storage.buckets b where b.id='training-evidence' and b.public=false)
 and exists(select 1 from storage.objects o where o.bucket_id=e.storage_bucket and o.name=e.storage_path);
 if meta is null then raise exception using errcode='42501',message='Private Training evidence outside verified scope';end if;
 return meta;
end $function$;


CREATE OR REPLACE FUNCTION public.retail_role_states(p_actor uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
SELECT COALESCE(ARRAY(
 SELECT DISTINCT allowed.state
 FROM public.profiles p
 JOIN public.access_user_assignments a ON a.profile_id=p.id AND a.auth_user_id=p.auth_user_id
 JOIN public.access_roles r ON r.id=a.role_id
 JOIN public.access_modules m ON m.id=a.module_id AND m.code='fo_operations'
 JOIN public.access_clients c ON c.id=a.client_id AND c.code='reliance_retail'
 JOIN public.access_user_scopes s ON s.user_assignment_id=a.id AND s.scope_type='state' AND s.allowed=true
 CROSS JOIN LATERAL unnest(
  CASE upper(btrim(s.scope_code))
   WHEN 'AP' THEN ARRAY['AP-1','AP-2']
   WHEN 'TN' THEN ARRAY['TN','PY']
   WHEN 'KA' THEN ARRAY['KA']
   WHEN 'KN' THEN ARRAY['KA']
   WHEN 'KL' THEN ARRAY['KL']
   WHEN 'TG' THEN ARRAY['TG']
   ELSE ARRAY[]::text[]
  END
 ) AS allowed(state)
 WHERE p.id=p_actor
   AND p.auth_user_id IS NOT NULL
   AND nullif(btrim(p.employee_code),'') IS NOT NULL
   AND p.is_active=true AND p.web_access_enabled=true
   AND upper(coalesce(p.status,'Active'))='ACTIVE'
   AND regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]','','g') IN ('RELIANCE','RELIANCERETAIL')
   AND ((p.role='South Head' AND r.code='gm')
     OR (p.role='Branch Head' AND r.code='branch_head'
       AND CASE upper(btrim(p.state))
         WHEN 'KN' THEN 'KA' ELSE upper(btrim(p.state)) END
         = CASE upper(btrim(s.scope_code))
         WHEN 'KN' THEN 'KA' ELSE upper(btrim(s.scope_code)) END))
   AND a.active=true AND a.verification_status='verified'
   AND (a.effective_from IS NULL OR a.effective_from<=now())
   AND (a.effective_to IS NULL OR a.effective_to>now())
   AND (s.effective_from IS NULL OR s.effective_from<=now())
   AND (s.effective_to IS NULL OR s.effective_to>now())
),ARRAY[]::text[]);
$function$;
