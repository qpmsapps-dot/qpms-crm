-- Compensating rollback, separate approval required. Preserve every record.
BEGIN;
UPDATE training_v2_private.release_policy SET mobile_management_enabled=false WHERE singleton;
COMMIT;
-- Then revert only the mobile-management application candidate. Do not replay
-- the V2 migration or remove provenance/editor guards while sessions exist.
