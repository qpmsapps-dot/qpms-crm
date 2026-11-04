-- Scoped October release hardening. Existing ledger/view installations are retained.
-- No attendance, travel leg, GPS, petrol or financial claim is updated.
BEGIN;
GRANT SELECT ON public.fo_oct2026_claim_adjustments TO service_role;
CREATE INDEX IF NOT EXISTS fo_missing_km_admin_decisions_attendance_idx
 ON public.fo_missing_km_admin_decisions(attendance_id);
CREATE OR REPLACE FUNCTION public.validate_fo_october_admin_decision()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE r public.fo_missing_km_reviews%ROWTYPE; a public.fo_attendance%ROWTYPE;
BEGIN
 SELECT * INTO r FROM public.fo_missing_km_reviews WHERE id=NEW.review_id FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Review not found' USING ERRCODE='23503'; END IF;
 SELECT * INTO a FROM public.fo_attendance WHERE id=r.attendance_id FOR SHARE;
 IF NOT FOUND OR a.attendance_date<DATE '2026-10-01' OR a.attendance_date>=DATE '2026-11-01'
  OR NEW.attendance_id<>r.attendance_id OR NEW.employee_code<>r.employee_code THEN
  RAISE EXCEPTION 'October decision source mismatch' USING ERRCODE='23514';
 END IF;
 IF r.status NOT IN ('pending','clarification_required') THEN
  RAISE EXCEPTION 'Review already resolved' USING ERRCODE='23514';
 END IF;
 IF length(btrim(NEW.justification))<20 OR length(NEW.justification)>2000
  OR length(btrim(NEW.evidence_reference))<5 OR length(NEW.evidence_reference)>500 THEN
  RAISE EXCEPTION 'Decision evidence required' USING ERRCODE='23514';
 END IF;
 IF NEW.decision='approved_for_reconciliation' AND (
  NEW.approved_additional_km>r.suggested_missing_km OR NEW.verified_already_included_km IS NULL
  OR NEW.verified_already_included_km<0 OR NEW.verified_already_included_km>coalesce(a.eligible_km,0)) THEN
  RAISE EXCEPTION 'Decision KM inconsistent with evidence' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.validate_fo_october_admin_decision() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.validate_fo_october_admin_decision() TO service_role;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.fo_missing_km_admin_decisions'::regclass AND tgname='validate_fo_october_admin_decision') THEN
  CREATE TRIGGER validate_fo_october_admin_decision BEFORE INSERT ON public.fo_missing_km_admin_decisions
  FOR EACH ROW EXECUTE FUNCTION public.validate_fo_october_admin_decision();
 END IF;
END $$;
COMMIT;
