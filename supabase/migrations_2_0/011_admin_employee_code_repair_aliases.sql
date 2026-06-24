-- Mobile_FO_V2 schema migration 2.0
-- 011: Expand administrative employee-code repair to confirmed identity aliases.
-- Mobile V2 writes employee_code into fo_user_id and username in operational tables.
-- No rows are deleted. No cascade delete is added.

create or replace function public.admin_employee_code_repair_capabilities()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'version', 2,
    'migration', '011_admin_employee_code_repair_aliases',
    'updates_confirmed_aliases', true
  )
$$;

revoke all on function public.admin_employee_code_repair_capabilities()
from public, anon, authenticated;

grant execute on function public.admin_employee_code_repair_capabilities()
to service_role;

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
    username = case
      when upper(btrim(coalesce(username, ''))) = v_old_code then v_new_code
      else username
    end,
    last_profile_sync_at = now()
  where id = p_profile_id;
  get diagnostics v_count = row_count;
  v_counts := v_counts
    || jsonb_build_object('profiles.employee_code', 1)
    || jsonb_build_object(
      'profiles.username',
      jsonb_build_object(
        'updated',
        case
          when upper(btrim(coalesce(v_profile.username, ''))) = v_old_code then 1
          else 0
        end,
        'available',
        true
      )
    );

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
        ('fo_attendance', 'fo_user_id'),
        ('fo_attendance', 'username'),
        ('fo_site_visits', 'employee_code'),
        ('fo_site_visits', 'fo_user_id'),
        ('fo_location_logs', 'employee_code'),
        ('fo_location_logs', 'fo_user_id'),
        ('fo_location_logs', 'username'),
        ('fo_live_status', 'employee_code'),
        ('fo_live_status', 'fo_user_id'),
        ('fo_live_status', 'username'),
        ('store_master', 'created_by_employee_code')
    ) as target(table_name, column_name)
  loop
    if to_regclass(format('public.%I', v_table)) is null then
      v_counts := v_counts || jsonb_build_object(
        format('%s.%s', v_table, v_column),
        jsonb_build_object(
          'updated', 0,
          'available', false,
          'reason', 'table_missing'
        )
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
        jsonb_build_object(
          'updated', 0,
          'available', false,
          'reason', 'column_missing'
        )
      );
      continue;
    end if;

    execute format(
      'update public.%I
       set %I = $1
       where upper(btrim(coalesce(%I, ''''))) = $2',
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
      'repair_version', 2,
      'migration', '011_admin_employee_code_repair_aliases',
      'affected_counts', v_counts
    )
  );

  return jsonb_build_object(
    'repair_version', 2,
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
  'Transaction-safe service-role employee-code repair including confirmed Mobile V2 fo_user_id and username aliases.';

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
