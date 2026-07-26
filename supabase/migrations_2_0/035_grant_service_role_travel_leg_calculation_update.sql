-- Allow canonical backend recalculation to persist computed values on existing
-- travel-leg snapshots. RLS and authenticated client privileges are unchanged.
grant update (
  calculated_km,
  payable_km,
  payable_amount,
  fare_amount,
  status,
  updated_at
) on table public.fo_travel_legs to service_role;
