-- Backfill claim_type for consolidated travel claim reporting.
-- Safe and additive: existing non-null claim_type values are preserved.

alter table public.fo_travel_expense_claims
  drop constraint if exists fo_travel_expense_claims_claim_type_check;

alter table public.fo_travel_expense_claims
  add constraint fo_travel_expense_claims_claim_type_check
  check (claim_type in ('travel', 'transport', 'parking', 'other'));

update public.fo_travel_expense_claims
set claim_type = case
  when lower(coalesce(remarks, '')) like '%parking%' then 'parking'
  else 'transport'
end
where claim_type is null;

comment on column public.fo_travel_expense_claims.claim_type is
  'Travel claim category. Consolidated reports treat parking as parking and travel/transport/other/null as other transport, with remarks fallback for legacy null rows.';
