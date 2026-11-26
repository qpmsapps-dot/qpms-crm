-- Run in an isolated PostgreSQL test database after the proposed migration.
-- Tests constraint expression independently without modifying worker control.
DO $test$
DECLARE candidate text[]; accepted boolean;
BEGIN
 FOREACH candidate SLICE 1 IN ARRAY ARRAY[
 ARRAY['end_day_km','fo_stale_cleanup','gps_summary'],
 ARRAY['end_day_km','fo_stale_cleanup','unknown_worker'],
 ARRAY['end_day_km','fo_stale_cleanup',NULL]
 ] LOOP
  accepted := cardinality(candidate)<=3 AND candidate <@ ARRAY['end_day_km','fo_stale_cleanup','gps_summary']::text[] AND array_position(candidate,NULL::text) IS NULL;
  IF accepted IS DISTINCT FROM (candidate[3]='gps_summary' AND candidate[3] IS NOT NULL) THEN
   RAISE EXCEPTION 'Unexpected admission result: %',candidate;
  END IF;
 END LOOP;
END $test$;
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='qpms_workers.control'::regclass AND conname='control_allowed_jobs_check';
-- Integration acceptance still required: closed/drained admission audit, claim/release,
-- financial gate unchanged, GPS queue drain, no unintended reimbursement changes.
