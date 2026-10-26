-- PREPARED ONLY. Admin-only draft configuration; NO activation or ticket writes.
-- Requires 022/024/030/031/042 and existing user/contact extensions. Test first.
begin;
create function public.rpc_save_residential_ticketing_draft(
  p_actor uuid,p_client uuid,p_resource text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_client public.hospital_clients%rowtype;
  v_profile public.profiles%rowtype;
  v_id uuid := nullif(p_payload->>'id','')::uuid;
  v_result uuid;
  v_vertical uuid;
  v_access uuid;
  v_module uuid;
  v_block uuid := nullif(p_payload->>'block_id','')::uuid;
  v_floor uuid := nullif(p_payload->>'floor_id','')::uuid;
  v_location uuid := nullif(p_payload->>'location_id','')::uuid;
  v_code text := upper(btrim(p_payload->>'code'));
  v_name text := btrim(p_payload->>'name');
  v_phone text;
  v_user public.hospital_ticket_users%rowtype;
  v_scope text := p_payload->>'scope_type';
  v_rollout jsonb := '{"state":"draft","source_data_approved":false,"authorization_reviewed":false,"isolated_validation_passed":false,"phone_only_risk_accepted":false}';
begin
  if (select count(*) from public.profiles where auth_user_id=p_actor and is_active)<>1 then raise exception 'Administrator identity missing or ambiguous' using errcode='42501'; end if;
  select * into v_profile from public.profiles where auth_user_id=p_actor and is_active;
  if not found or v_profile.is_active is not true or lower(coalesce(v_profile.status,'active'))<>'active' or regexp_replace(upper(coalesce(v_profile.role,'')),'[^A-Z0-9]','','g') not in ('ADMIN','QPMSADMIN','DEVELOPER','DEV') then
    raise exception 'Administrator required' using errcode='42501';
  end if;
  if p_resource not in ('client','block','floor','location','category','staff','contact') or jsonb_typeof(p_payload)<>'object' then
    raise exception 'Invalid draft resource' using errcode='22023';
  end if;
  if p_payload ?| array['active','is_active','ticketing_rollout','enabled','phone_only_risk_accepted','activation_status'] then
    raise exception 'Activation is unavailable in draft management' using errcode='42501';
  end if;
  if p_resource in ('client','block','floor','location','category') and
    (v_code is null or v_code !~ '^[A-Z0-9][A-Z0-9_-]{0,59}$' or nullif(v_name,'') is null or length(v_name)>300) then
    raise exception 'Code and name required' using errcode='22023';
  end if;
  if p_resource='client' and p_client is null then
    perform pg_advisory_xact_lock(hashtextextended('residential_client:'||v_code,0));
    select id into v_vertical from public.access_business_verticals
      where id=nullif(p_payload->>'business_vertical_id','')::uuid
      and lower(code) in ('residential','apartment','apartment_residential');
    if v_vertical is null then raise exception 'Select an existing Residential business' using errcode='22023'; end if;
    if exists(select 1 from public.hospital_clients where upper(btrim(client_code))=v_code)
      or exists(select 1 from public.access_clients where upper(btrim(code))=v_code) then
      raise exception 'Client code already exists; select the existing record' using errcode='23505';
    end if;
    insert into public.hospital_clients(client_code,client_name,business_type,is_active,metadata)
      values(v_code,v_name,'residential',false,jsonb_build_object('source','residential_draft_management','ticketing_rollout',v_rollout)) returning id into p_client;
    insert into public.access_clients(business_vertical_id,code,name,client_type,active,metadata)
      values(v_vertical,v_code,v_name,'residential',false,jsonb_build_object('legacy_hospital_client_id',p_client::text,'ticketing_rollout',v_rollout)) returning id into v_access;
    select id into v_module from public.access_modules where lower(code)='client_ticketing';
    if v_module is null then raise exception 'Ticketing module prerequisite missing' using errcode='22023'; end if;
    insert into public.access_client_modules(client_id,module_id,enabled) values(v_access,v_module,false);
    insert into public.access_business_vertical_modules(business_vertical_id,module_id,enabled) values(v_vertical,v_module,false) on conflict do nothing;
    v_result:=p_client;
  else
    select * into v_client from public.hospital_clients where id=p_client for update;
    if not found or v_client.business_type<>'residential' or v_client.is_active
      or coalesce(v_client.metadata->'ticketing_rollout'->>'state','')<>'draft' then
      raise exception 'Only inactive Residential drafts may be changed; Hospital records are read-only' using errcode='42501';
    end if;
    if p_resource='client' then
      if v_code<>v_client.client_code then raise exception 'Client code is immutable' using errcode='22023'; end if;
      select id into v_access from public.access_clients where metadata->>'legacy_hospital_client_id'=p_client::text and not active;
      if v_access is null or (select count(*) from public.access_clients where metadata->>'legacy_hospital_client_id'=p_client::text)<>1 then
        raise exception 'Client mapping requires review' using errcode='22023';
      end if;
      update public.hospital_clients set client_name=v_name where id=p_client;
      update public.access_clients set name=v_name where id=v_access;
      v_result:=p_client;
    elsif p_resource='block' then
      if v_id is null then insert into public.hospital_blocks(client_id,block_code,block_name,is_active,verification_status)
        values(p_client,v_code,v_name,false,'draft') returning id into v_result;
      else update public.hospital_blocks set block_code=v_code,block_name=v_name where id=v_id and client_id=p_client and not is_active returning id into v_result; end if;
    elsif p_resource in ('floor','location') then
      if not exists(select 1 from public.hospital_blocks where id=v_block and client_id=p_client) then raise exception 'Invalid client block' using errcode='42501'; end if;
      if v_floor is not null and not exists(select 1 from public.hospital_floors where id=v_floor and client_id=p_client and block_id=v_block) then raise exception 'Invalid client floor' using errcode='42501'; end if;
      if p_resource='floor' then
        if v_id is null then insert into public.hospital_floors(client_id,block_id,floor_code,floor_name,is_active,verification_status,source)
          values(p_client,v_block,v_code,v_name,false,'draft','admin_draft') returning id into v_result;
        else update public.hospital_floors set floor_code=v_code,floor_name=v_name
          where id=v_id and client_id=p_client and block_id=v_block and not is_active returning id into v_result; end if;
      else
        if v_floor is null and nullif(btrim(p_payload->>'floor_name'),'') is null then raise exception 'Select a floor or provide its explicit source label' using errcode='22023'; end if;
        if coalesce(p_payload->>'location_type','') not in ('unit','common_area','facility','other') then raise exception 'Select a location type' using errcode='22023'; end if;
        select floor_name into v_name from public.hospital_floors where id=v_floor;
        v_name:=coalesce(v_name,btrim(p_payload->>'floor_name'));
        if v_id is null then insert into public.hospital_locations(client_id,block_id,floor_id,location_code,location_name,floor_name,is_active,verification_status,metadata)
          values(p_client,v_block,v_floor,v_code,btrim(p_payload->>'name'),v_name,false,'draft',jsonb_build_object('location_type',p_payload->>'location_type')) returning id into v_result;
        else update public.hospital_locations set location_code=v_code,location_name=btrim(p_payload->>'name'),floor_id=v_floor,floor_name=v_name,
          metadata=metadata||jsonb_build_object('location_type',p_payload->>'location_type')
          where id=v_id and client_id=p_client and block_id=v_block and not is_active returning id into v_result; end if;
      end if;
    elsif p_resource='category' then
      if coalesce(p_payload->>'priority','') not in ('low','medium','high','critical')
        or coalesce((p_payload->>'supervisor_sla_minutes')::int,0) not between 1 and 1440
        or coalesce((p_payload->>'operations_sla_minutes')::int,0) not between 1 and 1440 then raise exception 'Valid priority and SLA minutes required' using errcode='22023'; end if;
      if v_id is null then insert into public.hospital_ticket_categories(client_id,category_code,category_name,default_priority,supervisor_sla_minutes,operations_sla_minutes,is_active)
        values(p_client,v_code,v_name,p_payload->>'priority',(p_payload->>'supervisor_sla_minutes')::int,(p_payload->>'operations_sla_minutes')::int,false) returning id into v_result;
      else update public.hospital_ticket_categories set category_code=v_code,category_name=v_name,default_priority=p_payload->>'priority',
        supervisor_sla_minutes=(p_payload->>'supervisor_sla_minutes')::int,operations_sla_minutes=(p_payload->>'operations_sla_minutes')::int
        where id=v_id and client_id=p_client and not is_active returning id into v_result; end if;
    elsif p_resource='staff' then
      if coalesce(p_payload->>'scope_mode','replace') not in ('add','replace') then raise exception 'Invalid scope save mode' using errcode='22023'; end if;
      if coalesce(p_payload->>'role_code','') not in ('housekeeping_supervisor','operations_executive','facility_manager')
        or coalesce(v_scope,'') not in ('client','block','location') then raise exception 'Invalid staff role/scope' using errcode='22023'; end if;
      if (select count(*) from public.profiles where upper(employee_code)=upper(btrim(p_payload->>'employee_code')) and is_active)<>1 then raise exception 'Employee identity is missing or ambiguous' using errcode='22023'; end if;
      select * into v_profile from public.profiles where upper(employee_code)=upper(btrim(p_payload->>'employee_code')) and is_active;
      if not found or lower(coalesce(v_profile.status,''))<>'active' or v_profile.auth_user_id is null or nullif(v_profile.email,'') is null then raise exception 'Existing active employee with login and email required; no account is created' using errcode='22023'; end if;
      v_phone:=regexp_replace(coalesce(v_profile.mobile,''),'[^0-9]','','g');
      if length(v_phone)=12 and left(v_phone,2)='91' then v_phone:=right(v_phone,10); end if;
      if v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'Employee mobile requires verification' using errcode='22023'; end if;
      if v_scope='block' and not exists(select 1 from public.hospital_blocks where id=v_block and client_id=p_client) then raise exception 'Invalid scope block' using errcode='42501'; end if;
      if v_scope='location' and not exists(select 1 from public.hospital_locations where id=v_location and client_id=p_client) then raise exception 'Invalid scope location' using errcode='42501'; end if;
      select * into v_user from public.hospital_ticket_users where auth_user_id=v_profile.auth_user_id for update;
      if found then
        if v_user.client_id<>p_client or v_user.profile_type<>'internal' or v_user.is_active or (v_id is not null and v_id<>v_user.id) then raise exception 'Employee already mapped elsewhere, non-internal, or active; no cross-client reassignment' using errcode='42501'; end if;
        if p_payload->>'scope_mode'='add' and v_user.role_code<>p_payload->>'role_code' then raise exception 'Adding a scope cannot change the existing staff role' using errcode='22023'; end if;
        update public.hospital_ticket_users set role_code=p_payload->>'role_code' where id=v_user.id returning id into v_result;
      else
        if v_id is not null then raise exception 'Staff record not found' using errcode='22023'; end if;
        insert into public.hospital_ticket_users(auth_user_id,client_id,profile_type,role_code,display_name,email,employee_code,is_active,cug_number,metadata)
          values(v_profile.auth_user_id,p_client,'internal',p_payload->>'role_code',coalesce(nullif(v_profile.full_name,''),v_profile.employee_code),v_profile.email,v_profile.employee_code,false,v_phone,
            '{"configuration_state":"draft","production_routing_eligible":false,"production_routing_verified":false}') returning id into v_result;
      end if;
      if coalesce(p_payload->>'scope_mode','replace')='replace' then
        update public.hospital_ticket_user_scopes set can_view=false,can_update=false where hospital_ticket_user_id=v_result and client_id=p_client;
      end if;
      if v_scope='client' then v_block:=null;v_location:=null;elsif v_scope='block' then v_location:=null;else v_block:=null;end if;
      select id into v_access from public.hospital_ticket_user_scopes where hospital_ticket_user_id=v_result and client_id=p_client and scope_type=v_scope
        and block_id is not distinct from v_block and location_id is not distinct from v_location;
      if v_access is null then insert into public.hospital_ticket_user_scopes(hospital_ticket_user_id,client_id,scope_type,block_id,location_id,can_view,can_create,can_update)
        values(v_result,p_client,v_scope,v_block,v_location,true,false,true);
      else update public.hospital_ticket_user_scopes set can_view=true,can_update=true where id=v_access; end if;
    elsif p_resource='contact' then
      v_phone:=regexp_replace(coalesce(p_payload->>'mobile',''),'[^0-9]','','g');
      if length(v_phone)=12 and left(v_phone,2)='91' then v_phone:=right(v_phone,10); end if;
      if v_phone !~ '^[6-9][0-9]{9}$' or nullif(btrim(p_payload->>'full_name'),'') is null then raise exception 'Contact name and mobile required' using errcode='22023'; end if;
      if exists(select 1 from public.hospital_client_contacts where normalized_mobile=v_phone and id is distinct from v_id and (client_id=p_client or is_active)) then raise exception 'Mobile already registered; review identity instead of duplicating' using errcode='23505'; end if;
      if v_id is null then insert into public.hospital_client_contacts(client_id,full_name,mobile,normalized_mobile,email,designation,department,is_active)
        values(p_client,btrim(p_payload->>'full_name'),v_phone,v_phone,nullif(btrim(p_payload->>'email'),''),nullif(btrim(p_payload->>'designation'),''),nullif(btrim(p_payload->>'department'),''),false) returning id into v_result;
      else update public.hospital_client_contacts set full_name=btrim(p_payload->>'full_name'),mobile=v_phone,normalized_mobile=v_phone,email=nullif(btrim(p_payload->>'email'),''),
        designation=nullif(btrim(p_payload->>'designation'),''),department=nullif(btrim(p_payload->>'department'),'')
        where id=v_id and client_id=p_client and not is_active returning id into v_result; end if;
    end if;
  end if;
  if v_result is null then raise exception 'Draft record missing, active, or outside client scope' using errcode='42501'; end if;
  insert into public.access_audit_logs(actor_user_id,action,target_type,target_id,metadata)
    values(p_actor,'SAVE_TICKETING_DRAFT',p_resource,v_result,jsonb_build_object('client_id',p_client,'activation','disabled'));
  return jsonb_build_object('client_id',p_client,'id',v_result,'resource',p_resource,'active',false);
end $$;
revoke all on function public.rpc_save_residential_ticketing_draft(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.rpc_save_residential_ticketing_draft(uuid,uuid,text,jsonb) to service_role;
commit;
