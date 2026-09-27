-- Add explicit State-to-Branch-Head routing for new-business opportunities.
-- Profile State, Business, role and hierarchy data are intentionally unchanged.
begin;

create table public.new_business_branch_head_state_scope (
  id uuid primary key default gen_random_uuid(),
  branch_head_profile_id uuid not null,
  state text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint new_business_branch_head_state_scope_profile_fkey
    foreign key (branch_head_profile_id) references public.profiles(id) on delete restrict,
  constraint new_business_branch_head_state_scope_state_check
    check (state in ('TN', 'KL', 'KA', 'TG', 'AP-1', 'AP-2')),
  constraint new_business_branch_head_state_scope_profile_state_key
    unique (branch_head_profile_id, state)
);

create unique index new_business_branch_head_state_scope_one_active_per_state
  on public.new_business_branch_head_state_scope(state)
  where is_active is true;

create index new_business_branch_head_state_scope_profile_idx
  on public.new_business_branch_head_state_scope(branch_head_profile_id, is_active);

comment on table public.new_business_branch_head_state_scope is
  'Explicit State-only Branch Head routing for new-business opportunities. This does not replace operational profile State or Business mappings.';
comment on column public.new_business_branch_head_state_scope.state is
  'Canonical new-business opportunity State. Business must not participate in Branch Head resolution.';

create function public.touch_new_business_branch_head_state_scope_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  new.updated_at := now();
  return new;
end
$function$;

create trigger touch_new_business_branch_head_state_scope_updated_at
before update on public.new_business_branch_head_state_scope
for each row execute function public.touch_new_business_branch_head_state_scope_updated_at();

alter table public.new_business_branch_head_state_scope enable row level security;
revoke all on table public.new_business_branch_head_state_scope from public, anon, authenticated;
grant select, insert, update, delete on table public.new_business_branch_head_state_scope to service_role;
revoke all on function public.touch_new_business_branch_head_state_scope_updated_at() from public, anon, authenticated;
grant execute on function public.touch_new_business_branch_head_state_scope_updated_at() to service_role;

-- Seed only management-confirmed new-business routing. Resolve profile IDs from
-- immutable employee codes and fail the whole transaction unless every target is
-- exactly one active Branch Head.
do $seed$
declare
  v_mapping record;
  v_profile public.profiles%rowtype;
  v_profile_count integer;
begin
  for v_mapping in
    select *
    from (values
      ('TN', 'QPMSTN3082'),
      ('TG', 'QPMSTSC16952'),
      ('KL', 'QPMSKL3762'),
      ('KA', 'QPMSKL0318'),
      ('AP-1', 'QPMSAPC16980'),
      ('AP-2', 'QPMSAPC16980')
    ) as confirmed_mapping(state, employee_code)
  loop
    select count(*) into v_profile_count
    from public.profiles p
    where upper(btrim(p.employee_code)) = upper(v_mapping.employee_code);

    if v_profile_count <> 1 then
      raise exception 'Expected exactly one profile for confirmed Branch Head employee code %, found %',
        v_mapping.employee_code, v_profile_count;
    end if;

    select * into strict v_profile
    from public.profiles p
    where upper(btrim(p.employee_code)) = upper(v_mapping.employee_code);

    if v_profile.role <> 'Branch Head'
       or v_profile.is_active is not true
       or lower(coalesce(v_profile.status, 'active')) <> 'active' then
      raise exception 'Confirmed new-business Branch Head % is not an active Branch Head',
        v_mapping.employee_code;
    end if;

    insert into public.new_business_branch_head_state_scope(
      branch_head_profile_id,
      state,
      is_active
    ) values (
      v_profile.id,
      v_mapping.state,
      true
    )
    on conflict on constraint new_business_branch_head_state_scope_profile_state_key
    do update set is_active = true, updated_at = now();
  end loop;
end
$seed$;

-- Migration 108 already normalized canonical and legacy BD roles inside this
-- RPC. Rewrite only the two legacy profile-State predicates so every other
-- authorization, locking, workflow and notification rule remains unchanged.
do $routing$
declare
  v_function oid;
  v_definition text;
  v_rewritten text;
  v_old_predicate constant text :=
    'public.opportunity_state_key(p.state) = public.opportunity_state_key(v_lead.state)';
  v_new_predicate constant text :=
    'exists (select 1 from public.new_business_branch_head_state_scope scope where scope.branch_head_profile_id = p.id and scope.is_active is true and public.opportunity_state_key(scope.state) = public.opportunity_state_key(v_lead.state))';
  v_occurrences integer;
begin
  v_function := to_regprocedure('public.rpc_submit_bd_meeting_mom(uuid,uuid,jsonb)');
  if v_function is null then
    raise exception 'Required opportunity workflow function is missing: public.rpc_submit_bd_meeting_mom(uuid,uuid,jsonb)';
  end if;

  v_definition := pg_get_functiondef(v_function);
  v_occurrences := (
    length(v_definition) - length(replace(v_definition, v_old_predicate, ''))
  ) / length(v_old_predicate);

  if v_occurrences <> 2 then
    raise exception 'Expected two legacy Branch Head State predicates, found %', v_occurrences;
  end if;

  v_rewritten := replace(v_definition, v_old_predicate, v_new_predicate);
  execute v_rewritten;
end
$routing$;

comment on function public.rpc_submit_bd_meeting_mom(uuid,uuid,jsonb) is
  'Service-role-only BD meeting MOM submission with fail-closed explicit new-business State-to-Branch-Head routing.';

revoke all on function public.rpc_submit_bd_meeting_mom(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.rpc_submit_bd_meeting_mom(uuid,uuid,jsonb) to service_role;

commit;
