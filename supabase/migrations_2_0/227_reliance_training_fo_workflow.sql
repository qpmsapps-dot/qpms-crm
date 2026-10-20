-- Local preparation only. Dependencies: 115, 116, 117, 211, 212, 215.
-- No attendance, GPS, KM, financial, submitted-report or attachment backfill.
begin;

create or replace function public.training_assert_active_context(p_actor_profile_id uuid, p_attendance_id uuid, p_site_visit_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.profiles%rowtype; a public.fo_attendance%rowtype; v public.fo_site_visits%rowtype; code text;
begin
  select * into p from public.profiles where id = p_actor_profile_id;
  if not found or p.is_active is not true
     or regexp_replace(upper(coalesce(p.role,'')), '[^A-Z0-9]+','','g') not in ('FO','FIELDOFFICER')
     or regexp_replace(upper(coalesce(p.business,'')), '[^A-Z0-9]+','','g') not in ('RELIANCE','RELIANCERETAIL') then
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
end; $$;

create or replace function public.training_retail_store_allowed(p_actor_profile_id uuid, p_store_id uuid, p_category_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p
    join public.reliance_retail_store_master s on s.id = p_store_id and s.status = 'Active'
    join public.training_categories c on c.id = p_category_id and c.is_active
    where p.id = p_actor_profile_id and p.is_active is true
      and regexp_replace(upper(coalesce(p.business,'')), '[^A-Z0-9]+','','g') in ('RELIANCE','RELIANCERETAIL')
      and nullif(btrim(p.state),'') is not null and upper(btrim(p.state)) = upper(btrim(s.state))
      and ((s.zone_id is not null and exists (
        select 1 from public.reliance_retail_zones z where z.id = s.zone_id and z.status = 'Active'
          and upper(btrim(z.state)) = upper(btrim(p.state))))
        or (s.zone_id is null and s.metadata ->> 'operational_model' = 'SUPERVISOR_ONLY' and c.code = 'technical_mep'))
  );
$$;

-- Policy-only adjustment. Retain all attendee rows and all submitted/cancelled snapshots.
update public.training_categories set require_attendee = false where code = 'hk';
update public.training_sessions s set require_attendee_snapshot = false
from public.training_categories c where c.id = s.category_id and c.code = 'hk' and s.status = 'draft' and s.require_attendee_snapshot;

create or replace function public.rpc_create_reliance_training_session_v3(
  p_actor_profile_id uuid, p_attendance_id uuid, p_site_visit_id uuid,
  p_category_id uuid, p_training_type_id uuid, p_training_date date,
  p_trainer_name text, p_retail_store_id uuid, p_remarks text default null
)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
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
$$;

create or replace function public.training_assert_draft_editor(
  p_session_id uuid,
  p_actor_profile_id uuid
)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_profile public.profiles%rowtype;
  v_session public.training_sessions%rowtype;
  v_envelope public.fo_activity_submissions%rowtype;
  v_store public.store_master%rowtype;
  v_retail_store public.reliance_retail_store_master%rowtype;
begin
  select * into v_profile from public.profiles where id = p_actor_profile_id;
  if not found or v_profile.is_active is not true
     or regexp_replace(upper(coalesce(v_profile.role, '')), '[^A-Z0-9]+', '', 'g')
        not in ('FO','FIELDOFFICER') then
    raise exception using errcode = '42501', message = 'training_mutation_forbidden';
  end if;
  select * into v_session from public.training_sessions where id = p_session_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'training_session_not_found'; end if;
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
$$;


-- Preserve dates on every existing RPC update, and normalize HK snapshots even for old clients.
create or replace function public.training_session_write_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.training_assert_active_context(new.trainer_profile_id, new.attendance_id, new.site_visit_id);
  if tg_op = 'INSERT' then
    if new.retail_store_id is null or not public.training_retail_store_allowed(new.trainer_profile_id, new.retail_store_id, new.category_id) then
      raise exception using errcode = '42501', message = 'training_store_scope_forbidden';
    end if;
    new.training_date := (clock_timestamp() at time zone 'Asia/Kolkata')::date;
  else
    if old.status <> 'draft' then raise exception using errcode = 'P0001', message = 'training_session_immutable'; end if;
    new.training_date := old.training_date;
    if new.attendance_id is distinct from old.attendance_id or new.site_visit_id is distinct from old.site_visit_id
       or new.trainer_profile_id is distinct from old.trainer_profile_id or new.store_id is distinct from old.store_id
       or new.retail_store_id is distinct from old.retail_store_id then
      raise exception using errcode = '42501', message = 'training_session_context_immutable';
    end if;
    if new.retail_store_id is not null and not public.training_retail_store_allowed(new.trainer_profile_id, new.retail_store_id, new.category_id) then
      raise exception using errcode = '42501', message = 'training_store_scope_forbidden';
    end if;
  end if;
  if exists(select 1 from public.training_categories where id = new.category_id and code = 'hk') then new.require_attendee_snapshot := false; end if;
  return new;
end; $$;
create trigger trg_training_fo_session_write before insert or update on public.training_sessions
for each row execute function public.training_session_write_guard();

-- Includes initial pending-evidence INSERT, which previously bypassed the RPC editor guard.
create or replace function public.training_child_write_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
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
end; $$;
create trigger trg_training_fo_evidence_write before insert or update or delete on public.training_evidence
for each row execute function public.training_child_write_guard();
create trigger trg_training_fo_attendee_write before insert or update or delete on public.training_session_attendees
for each row execute function public.training_child_write_guard();
create trigger trg_training_fo_topic_write before insert or update or delete on public.training_session_topics
for each row execute function public.training_child_write_guard();

-- Legacy Reliance training remains readable. New writes must use structured APIs.
create or replace function public.training_legacy_write_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
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
end; $$;
create trigger trg_training_legacy_submission_write before insert or update on public.fo_activity_submissions
for each row execute function public.training_legacy_write_guard();
create trigger trg_training_legacy_upload_write before insert or update on public.fo_activity_uploads
for each row execute function public.training_legacy_write_guard();

create or replace function public.rpc_submit_reliance_training_session_v2(p_session_id uuid,p_actor_profile_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare s public.training_sessions%rowtype;
begin
  select * into s from public.training_sessions where id = p_session_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'training_session_not_found'; end if;
  if s.trainer_profile_id is distinct from p_actor_profile_id then raise exception using errcode = '42501', message = 'training_not_session_creator'; end if;
  -- Retry is a read, including after closure; it must not append a second submitted event.
  if s.status = 'submitted' then return s.id; end if;
  return public.rpc_submit_reliance_training_session(p_session_id,p_actor_profile_id);
end; $$;

revoke all on function public.training_assert_active_context(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.training_retail_store_allowed(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.training_session_write_guard() from public,anon,authenticated;
revoke all on function public.training_child_write_guard() from public,anon,authenticated;
revoke all on function public.training_legacy_write_guard() from public,anon,authenticated;
revoke all on function public.rpc_create_reliance_training_session_v3(uuid,uuid,uuid,uuid,uuid,date,text,uuid,text) from public,anon,authenticated;
revoke all on function public.rpc_submit_reliance_training_session_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.training_assert_active_context(uuid,uuid,uuid) to service_role;
grant execute on function public.training_retail_store_allowed(uuid,uuid,uuid) to service_role;
grant execute on function public.rpc_create_reliance_training_session_v3(uuid,uuid,uuid,uuid,uuid,date,text,uuid,text) to service_role;
grant execute on function public.rpc_submit_reliance_training_session_v2(uuid,uuid) to service_role;
-- Retire checked-in-store creation entrypoints; retain existing read APIs and draft RPCs.
revoke execute on function public.rpc_create_reliance_training_session(uuid,uuid,uuid,uuid,uuid,date,text,text) from service_role;
revoke execute on function public.rpc_create_reliance_training_session_v2(uuid,uuid,uuid,uuid,uuid,date,text,text) from service_role;
commit;
