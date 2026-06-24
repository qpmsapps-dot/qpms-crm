-- Mobile_FO_V2 schema migration 2.0
-- 010: Transaction-safe administrative employee-code repair.
-- Updates text-code references only. Does not delete business history.
-- No cascade delete and no frontend execution grant.

create or replace function public.admin_repair_employee_code(
  p_profile_id uuid,
  p_old_employee_code text,
  p_new_employee_code text,
  p_reason text,
  p_actor_auth_user_id uuid,
  p_actor_profile_id uuid,
  p_actor_employee_code text,
  p_actor_role text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_old_code text := upper(btrim(coalesce(p_old_employee_code, '')));
  v_new_code text := upper(btrim(coalesce(p_new_employee_code, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_count bigint := 0;
  v_counts jsonb := '{}'::jsonb;
  v_table text;
  v_column text;
begin
  if p_profile_id is null then
    raise exception 'profile id is required';
  end if;
  if v_old_code = '' then
    raise exception 'old employee code is required';
  end if;
  if v_new_code = '' then
    raise exception 'new employee code is required';
  end if;
  if v_reason = '' then
    raise exception 'reason is required';
  end if;
  if v_old_code = v_new_code then
    raise exception 'old and new employee codes must be different';
  end if;

  select *
  into v_profile
  from public.profiles
  where id = p_profile_id
  for update;

  if not found then
    raise exception 'profile not found';
  end if;
  if upper(btrim(coalesce(v_profile.employee_code, ''))) <> v_old_code then
    raise exception 'profile employee code does not match old employee code';
  end if;
  if exists (
    select 1
    from public.profiles
    where id <> p_profile_id
      and upper(btrim(coalesce(employee_code, ''))) = v_new_code
  ) then
    raise exception 'new employee code is already used by another profile';
  end if;

  update public.profiles
  set
    employee_code = v_new_code,
    last_profile_sync_at = now()
  where id = p_profile_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts || jsonb_build_object('profiles.employee_code', v_count);

  for v_table, v_column in
    select target.table_name, target.column_name
    from (
      values
        ('employee_hierarchy', 'employee_code'),
        ('employee_hierarchy', 'manager_employee_code'),
        ('employee_hierarchy', 'managers_manager_employee_code'),
        ('employee_hierarchy', 'business_head_employee_code'),
        ('employee_hierarchy', 'gm_employee_code'),
        ('employee_hierarchy', 'coo_employee_code'),
        ('fo_attendance', 'employee_code'),
        ('fo_site_visits', 'employee_code'),
        ('fo_location_logs', 'employee_code'),
        ('fo_live_status', 'employee_code'),
        ('store_master', 'created_by_employee_code')
    ) as target(table_name, column_name)
  loop
    if to_regclass(format('public.%I', v_table)) is null then
      v_counts := v_counts || jsonb_build_object(
        format('%s.%s', v_table, v_column),
        jsonb_build_object('updated', 0, 'available', false, 'reason', 'table_missing')
      );
      continue;
    end if;

    if not exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = v_table
        and column_name = v_column
    ) then
      v_counts := v_counts || jsonb_build_object(
        format('%s.%s', v_table, v_column),
        jsonb_build_object('updated', 0, 'available', false, 'reason', 'column_missing')
      );
      continue;
    end if;

    execute format(
      'update public.%I set %I = $1 where upper(btrim(coalesce(%I, ''''))) = $2',
      v_table,
      v_column,
      v_column
    )
    using v_new_code, v_old_code;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object(
      format('%s.%s', v_table, v_column),
      jsonb_build_object('updated', v_count, 'available', true)
    );
  end loop;

  insert into public.user_management_audit_logs (
    action,
    target_profile_id,
    target_auth_user_id,
    target_employee_code,
    actor_auth_user_id,
    actor_profile_id,
    actor_employee_code,
    actor_role,
    old_data,
    new_data,
    reason,
    metadata
  ) values (
    'REPAIR_EMPLOYEE_CODE',
    v_profile.id,
    v_profile.auth_user_id,
    v_new_code,
    p_actor_auth_user_id,
    p_actor_profile_id,
    nullif(upper(btrim(coalesce(p_actor_employee_code, ''))), ''),
    nullif(btrim(coalesce(p_actor_role, '')), ''),
    jsonb_build_object('employee_code', v_old_code),
    jsonb_build_object('employee_code', v_new_code),
    v_reason,
    jsonb_build_object(
      'source', 'admin_repair_employee_code_rpc',
      'affected_counts', v_counts
    )
  );

  return jsonb_build_object(
    'profile_id', v_profile.id,
    'auth_user_id', v_profile.auth_user_id,
    'old_employee_code', v_old_code,
    'new_employee_code', v_new_code,
    'affected_counts', v_counts
  );
end;
$$;

comment on function public.admin_repair_employee_code(
  uuid,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  text
) is
  'Transaction-safe service-role employee-code repair across profile, hierarchy, and operational text-code references.';

revoke all on function public.admin_repair_employee_code(
  uuid,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  text
) from public, anon, authenticated;

grant execute on function public.admin_repair_employee_code(
  uuid,
  text,
  text,
  text,
  uuid,
  uuid,
  text,
  text
) to service_role;
