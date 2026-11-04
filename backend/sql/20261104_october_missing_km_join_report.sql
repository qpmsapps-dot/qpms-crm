-- October 2026 attendance/review/decision reporting view.
-- One row per attendance, prevents KM duplication from multiple reviews.
CREATE OR REPLACE VIEW public.fo_oct2026_missing_km_report AS
WITH reviews AS (
 SELECT m.attendance_id,
 count(*)::int AS review_cases,
 count(*) FILTER (WHERE m.status='pending')::int AS pending_cases,
 count(*) FILTER (WHERE m.status='clarification_required')::int AS clarification_cases,
 count(*) FILTER (WHERE m.status='approved')::int AS legacy_approved_cases,
 coalesce(sum(m.suggested_missing_km),0)::numeric(12,2) AS suggested_review_km,
 count(*) FILTER (WHERE d.decision='approved_for_reconciliation')::int AS admin_approved_cases,
 coalesce(sum(CASE WHEN d.decision='approved_for_reconciliation' THEN d.approved_additional_km ELSE 0 END),0)::numeric(12,2) AS admin_approved_km
 FROM public.fo_missing_km_reviews m
 LEFT JOIN public.fo_missing_km_admin_decisions d ON d.review_id=m.id
 GROUP BY m.attendance_id
)
SELECT a.id AS attendance_id,a.employee_code,a.attendance_date,
 coalesce(a.eligible_km,0)::numeric(12,2) AS original_payable_km,
 coalesce(a.petrol_amount,0)::numeric(12,2) AS original_petrol_amount,
 coalesce(r.review_cases,0) AS review_cases,
 coalesce(r.pending_cases,0) AS pending_cases,
 coalesce(r.clarification_cases,0) AS clarification_cases,
 coalesce(r.legacy_approved_cases,0) AS legacy_approved_cases,
 coalesce(r.suggested_review_km,0) AS suggested_review_km,
 coalesce(r.admin_approved_cases,0) AS admin_approved_cases,
 coalesce(r.admin_approved_km,0) AS admin_approved_km
FROM public.fo_attendance a LEFT JOIN reviews r ON r.attendance_id=a.id
WHERE a.attendance_date >= DATE '2026-10-01'
AND a.attendance_date < DATE '2026-11-01';
REVOKE ALL ON public.fo_oct2026_missing_km_report FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.fo_oct2026_missing_km_report TO service_role;
