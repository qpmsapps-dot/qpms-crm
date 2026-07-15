-- Parking ticket claim foundation.
-- Additive only: current mobile writes remain valid when they omit the new columns.

alter table public.fo_travel_expense_claims
  add column if not exists claim_type text,
  add column if not exists reviewed_by_auth_user_id uuid,
  add column if not exists reviewed_by_employee_code text,
  add column if not exists reviewed_by_name text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_remarks text,
  add column if not exists submitted_at timestamptz,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- Only classify the established parking signature. Other historical claims stay
-- null so this migration does not infer a type from incomplete legacy data.
update public.fo_travel_expense_claims
set claim_type = 'parking'
where claim_type is null
  and travel_mode = 'other'
  and remarks ilike 'Parking Claim%';

-- Preserve the original creation time as the historical submission time.
update public.fo_travel_expense_claims
set submitted_at = created_at
where submitted_at is null;

alter table public.fo_travel_expense_claims
  alter column submitted_at set default now();

-- Nullable by design: omitted claim_type values from existing app versions pass
-- this constraint, while explicit future values remain consistent.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fo_travel_expense_claims_claim_type_check'
      and conrelid = 'public.fo_travel_expense_claims'::regclass
  ) then
    alter table public.fo_travel_expense_claims
      add constraint fo_travel_expense_claims_claim_type_check
      check (claim_type in ('travel', 'parking', 'other'));
  end if;
end $$;

create index if not exists idx_fo_travel_expense_claims_claim_type
  on public.fo_travel_expense_claims(claim_type);

create index if not exists idx_fo_travel_expense_claims_site_visit_id
  on public.fo_travel_expense_claims(site_visit_id);

create index if not exists idx_fo_travel_expense_claims_status
  on public.fo_travel_expense_claims(status);

create index if not exists idx_fo_travel_expense_claims_submitted_at
  on public.fo_travel_expense_claims(submitted_at desc);

create index if not exists idx_fo_travel_expense_claims_type_status
  on public.fo_travel_expense_claims(claim_type, status);

create index if not exists idx_fo_travel_expense_claims_employee_submitted
  on public.fo_travel_expense_claims(employee_code, submitted_at desc);

create or replace function public.travel_claim_current_employee_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.employee_code
  from public.profiles p
  where p.auth_user_id = auth.uid()
    and coalesce(p.is_active, true) = true
    and p.employee_code is not null
  limit 1
$$;

revoke all on function public.travel_claim_current_employee_code() from public;
grant execute on function public.travel_claim_current_employee_code() to authenticated;

alter table public.fo_travel_expense_claims enable row level security;

-- Replace migration 014's FO-only policies. In particular, removing its update
-- policy ensures normal users do not retain broad update access to review fields.
drop policy if exists "FO can view own travel expense claims"
  on public.fo_travel_expense_claims;
drop policy if exists "FO can create own travel expense claims"
  on public.fo_travel_expense_claims;
drop policy if exists "FO can update own submitted travel expense claims"
  on public.fo_travel_expense_claims;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fo_travel_expense_claims'
      and policyname = 'travel_claims_select_own_active_profile'
  ) then
    create policy travel_claims_select_own_active_profile
    on public.fo_travel_expense_claims
    for select
    to authenticated
    using (
      employee_code = public.travel_claim_current_employee_code()
      or (
        employee_code is null
        and fo_user_id = public.travel_claim_current_employee_code()
      )
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fo_travel_expense_claims'
      and policyname = 'travel_claims_insert_own_active_profile'
  ) then
    create policy travel_claims_insert_own_active_profile
    on public.fo_travel_expense_claims
    for insert
    to authenticated
    with check (
      (
        employee_code = public.travel_claim_current_employee_code()
        or (
          employee_code is null
          and fo_user_id = public.travel_claim_current_employee_code()
        )
      )
      and coalesce(status, 'submitted') = 'submitted'
    );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fo_travel_expense_claims'
      and policyname = 'travel_claims_admin_manage'
  ) then
    create policy travel_claims_admin_manage
    on public.fo_travel_expense_claims
    for all
    to authenticated
    using (public.is_qpms_admin())
    with check (public.is_qpms_admin());
  end if;
end $$;

-- Any active authenticated user/profile can create and view their own submitted
-- parking/travel claims based on employee_code ownership. Admin/QPMS Admin/
-- Developer/reviewer roles can manage and review claims through the existing
-- admin helper. Migration 016 owns the private travel-claim-proofs bucket; this
-- migration does not make the claim table or proof bucket public.
