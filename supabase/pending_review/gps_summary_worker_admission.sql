-- GPS summary worker admission: schema-only preparation.
-- Does not change the worker mode, admission list, ownership tokens or financial controls.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
ALTER TABLE qpms_workers.control
  DROP CONSTRAINT control_allowed_jobs_check,
  ADD CONSTRAINT control_allowed_jobs_check CHECK (
    cardinality(allowed_jobs) <= 3
    AND allowed_jobs <@ ARRAY['end_day_km','fo_stale_cleanup','gps_summary']::text[]
    AND array_position(allowed_jobs,NULL::text) IS NULL
  );
COMMIT;
