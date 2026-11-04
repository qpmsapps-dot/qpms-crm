-- October missing-KM Admin decision ledger: migration for existing installation.
-- No payable KM or financial gate is modified.
BEGIN;
CREATE TABLE IF NOT EXISTS public.fo_missing_km_admin_decisions (
 review_id uuid PRIMARY KEY REFERENCES public.fo_missing_km_reviews(id) ON DELETE RESTRICT,
 attendance_id uuid NOT NULL REFERENCES public.fo_attendance(id),
 employee_code text NOT NULL,
 decision text NOT NULL CHECK (decision IN ('approved_for_reconciliation','rejected')),
 approved_additional_km numeric(12,2) NOT NULL DEFAULT 0 CHECK (approved_additional_km >= 0 AND approved_additional_km <= 500),
 verified_already_included_km numeric(12,2),
 justification text NOT NULL CHECK (length(justification) >= 20),
 evidence_reference text NOT NULL CHECK (length(evidence_reference) >= 5),
 approved_by uuid NOT NULL,
 decided_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT decision_km_consistency CHECK (
  (decision='rejected' AND approved_additional_km=0) OR
  (decision='approved_for_reconciliation' AND approved_additional_km>0 AND verified_already_included_km IS NOT NULL)
 )
);
ALTER TABLE public.fo_missing_km_admin_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fo_missing_km_admin_decisions FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON public.fo_missing_km_admin_decisions TO service_role;
-- The backend checks active Admin identity before invoking service-role operations.
-- The review ledger is append-only: duplicate review IDs are rejected by its PK.
COMMIT;