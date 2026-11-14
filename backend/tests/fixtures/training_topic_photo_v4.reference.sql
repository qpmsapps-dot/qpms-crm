-- PREPARED ONLY: 202611060001. Do not install migration 231.
-- Apply only after disposable PostgreSQL and staging acceptance. No terminal rows are rewritten.
BEGIN;
DO $preflight$ BEGIN
IF md5(replace(pg_get_functiondef(to_regprocedure('public.training_assert_active_context(uuid,uuid,uuid)')),chr(13),'')) IS DISTINCT FROM 'e8fe3bd05f055313a9fda997a1006cf3' THEN RAISE EXCEPTION 'training_v4_installed_contract_drift: training_assert_active_context'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.training_retail_store_allowed(uuid,uuid,uuid)')),chr(13),'')) IS DISTINCT FROM '6907a8fedf8f6073302cda7b1f8c2267' THEN RAISE EXCEPTION 'training_v4_installed_contract_drift: training_retail_store_allowed'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.training_assert_draft_editor(uuid,uuid)')),chr(13),'')) IS DISTINCT FROM '3dc27024eafd4e1a5277ffb7ae8208c5' THEN RAISE EXCEPTION 'training_v4_installed_contract_drift: training_assert_draft_editor'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.training_session_write_guard()')),chr(13),'')) IS DISTINCT FROM '7f2009389d603a11e72eb97fda3deede' THEN RAISE EXCEPTION 'training_v4_installed_contract_drift: training_session_write_guard'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_submit_reliance_training_session(uuid,uuid)')),chr(13),'')) IS DISTINCT FROM '3b64b7c4a296e806cb57d8634f0d2b0c' THEN RAISE EXCEPTION 'training_v4_installed_contract_drift: rpc_submit_reliance_training_session'; END IF;
IF md5(replace(pg_get_functiondef(to_regprocedure('public.rpc_create_reliance_training_session_v3(uuid,uuid,uuid,uuid,uuid,date,text,uuid,text)')),chr(13),'')) IS DISTINCT FROM '1fc949edd5c3ab0da893b38bb0fdb594' THEN RAISE EXCEPTION 'training_v4_installed_contract_drift: rpc_create_reliance_training_session_v3'; END IF;
IF NOT EXISTS(SELECT 1 FROM storage.buckets WHERE id='training-evidence' AND public=false) THEN RAISE EXCEPTION 'training_private_bucket_required'; END IF;
END $preflight$;
CREATE OR REPLACE FUNCTION public.training_role_v4(p_role text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT CASE regexp_replace(upper(coalesce(p_role,'')),'[^A-Z0-9]','','g')
 WHEN 'FIELDOFFICER' THEN 'FO' WHEN 'KEYACCOUNTMANAGER' THEN 'KAM'
 WHEN 'OM' THEN 'OPERATIONSMANAGER' WHEN 'OPERATIONMANAGER' THEN 'OPERATIONSMANAGER'
 WHEN 'OPSMANAGER' THEN 'OPERATIONSMANAGER' WHEN 'BH' THEN 'BRANCHHEAD'
 ELSE regexp_replace(upper(coalesce(p_role,'')),'[^A-Z0-9]','','g') END;
$$;
CREATE OR REPLACE FUNCTION public.training_retail_actor_v4(p_actor_profile_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=p_actor_profile_id AND p.is_active IS TRUE
 AND regexp_replace(upper(coalesce(p.status,'Active')),'[^A-Z0-9]','','g')='ACTIVE'
 AND p.auth_user_id IS NOT NULL AND (regexp_replace(upper(coalesce(p.business,'')),'[^A-Z0-9]','','g') IN ('RELIANCE','RELIANCERETAIL')
 OR EXISTS(SELECT 1 FROM public.access_user_assignments a JOIN public.access_roles r ON r.id=a.role_id AND r.active
 WHERE a.profile_id=p.id AND a.auth_user_id=p.auth_user_id AND a.client_id='369d2d5f-396f-49f9-a47d-bfbc8f7cb922'::uuid
 AND a.active AND a.verification_status='verified' AND a.effective_from<=now() AND (a.effective_to IS NULL OR a.effective_to>now())
 AND public.training_role_v4(r.code)=public.training_role_v4(p.role))));
$$;
CREATE OR REPLACE FUNCTION public.training_category_allowed_v4(p_actor_profile_id uuid,p_category_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.training_retail_actor_v4(p_actor_profile_id) AND EXISTS(SELECT 1 FROM public.profiles p CROSS JOIN public.training_categories c
 WHERE p.id=p_actor_profile_id AND c.id=p_category_id AND c.is_active AND
 ((c.code='hk' AND public.training_role_v4(p.role)='FO') OR
 (c.code='technical_mep' AND public.training_role_v4(p.role) IN ('KAM','OPERATIONSMANAGER','BRANCHHEAD'))));
$$;
-- TN managers inherit ONLY active zones of active same-state Retail FOs in their recorded hierarchy.
CREATE OR REPLACE FUNCTION public.training_authorized_zones_v4(p_actor_profile_id uuid) RETURNS SETOF public.reliance_retail_zones
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
$$;

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

CREATE OR REPLACE FUNCTION public.training_retail_store_allowed(p_actor_profile_id uuid, p_store_id uuid, p_category_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare p public.profiles%rowtype;
 s public.reliance_retail_store_master%rowtype;
 c public.training_categories%rowtype;
 z public.reliance_retail_zones%rowtype;
 pgeo text;sgeo text;zgeo text;model text;
begin
 select * into p from public.profiles where id=p_actor_profile_id;
 select * into s from public.reliance_retail_store_master where id=p_store_id;
 select * into c from public.training_categories where id=p_category_id;
 if not public.training_category_allowed_v4(p_actor_profile_id,p_category_id)
 or s.id is null or s.status<>'Active' or c.id is null or c.is_active is not true
 then return false;end if;
 if (select count(*) from public.reliance_retail_store_master r where upper(btrim(r.store_code))=upper(btrim(s.store_code)))<>1 then return false;end if;
 pgeo:=regexp_replace(upper(coalesce(p.state,'')),'[^A-Z0-9]','','g');
 sgeo:=regexp_replace(upper(coalesce(s.state,'')),'[^A-Z0-9]','','g');
 pgeo:=case
  when pgeo in ('TN','PY','TAMILNADU','PUDUCHERRY','PONDICHERRY') then 'TN'
  when pgeo in ('KA','KN','KARNATAKA') then 'KA'
  when pgeo in ('KL','KERALA') then 'KL'
  when pgeo in ('TG','TELANGANA') then 'TG'
  when pgeo in ('AP1','ANDHRAPRADESH1') then 'AP1'
  when pgeo in ('AP2','ANDHRAPRADESH2') then 'AP2'
  else null end;
 sgeo:=case
  when sgeo in ('TN','PY','TAMILNADU','PUDUCHERRY','PONDICHERRY') then 'TN'
  when sgeo in ('KA','KN','KARNATAKA') then 'KA'
  when sgeo in ('KL','KERALA') then 'KL'
  when sgeo in ('TG','TELANGANA') then 'TG'
  when sgeo in ('AP1','ANDHRAPRADESH1') then 'AP1'
  when sgeo in ('AP2','ANDHRAPRADESH2') then 'AP2'
  else null end;
 if pgeo is null or sgeo is distinct from pgeo then return false;end if;
 model:=upper(coalesce(s.metadata->>'operational_model',''));
 if model='SUPERVISOR_ONLY' and c.code<>'technical_mep' then return false;end if;
 if pgeo<>'TN' then return true;end if;
 if s.zone_id is null then
  return model='SUPERVISOR_ONLY' and c.code='technical_mep';
 end if;
 select * into z from public.reliance_retail_zones where id=s.zone_id and status='Active';
 if z.id is null then return false;end if;
 zgeo:=regexp_replace(upper(coalesce(z.state,'')),'[^A-Z0-9]','','g');
 if zgeo not in ('TN','PY','TAMILNADU','PUDUCHERRY','PONDICHERRY') then return false;end if;
 return exists(select 1 from public.training_authorized_zones_v4(p.id) az where az.id=z.id);
end;
$function$;

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

ALTER TABLE public.training_sessions ADD COLUMN mobile_creation_key text;
CREATE UNIQUE INDEX training_mobile_creation_v4 ON public.training_sessions(trainer_profile_id,mobile_creation_key) WHERE mobile_creation_key IS NOT NULL;
CREATE OR REPLACE FUNCTION public.rpc_create_reliance_training_session_v4(p_actor_profile_id uuid,p_attendance_id uuid,p_site_visit_id uuid,p_category_id uuid,p_training_type_id uuid,p_training_date date,p_trainer_name text,p_retail_store_id uuid,p_creation_key text,p_remarks text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
END; $$;
CREATE UNIQUE INDEX training_evidence_upload_key_v4 ON public.training_evidence(training_session_id,(metadata->>'upload_key')) WHERE metadata->>'upload_key' IS NOT NULL;

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

UPDATE public.training_categories SET require_attendee=false,require_selected_topic=true,topic_evidence_policy='required',require_group_photo=false,require_attendance_sheet=false,require_training_document=false WHERE code IN ('hk','technical_mep');
-- No attendee insert/delete and no terminal-session protection changes.

REVOKE ALL ON FUNCTION public.training_role_v4(text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.training_role_v4(text) TO service_role;
REVOKE ALL ON FUNCTION public.training_retail_actor_v4(uuid) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.training_retail_actor_v4(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.training_category_allowed_v4(uuid,uuid) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.training_category_allowed_v4(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.training_authorized_zones_v4(uuid) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.training_authorized_zones_v4(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.rpc_create_reliance_training_session_v4(uuid,uuid,uuid,uuid,uuid,date,text,uuid,text,text) FROM PUBLIC,anon,authenticated; GRANT EXECUTE ON FUNCTION public.rpc_create_reliance_training_session_v4(uuid,uuid,uuid,uuid,uuid,date,text,uuid,text,text) TO service_role;
COMMIT;