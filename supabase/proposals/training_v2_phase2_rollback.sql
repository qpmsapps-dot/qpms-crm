-- Compensating rollback: retain entitlements, audits, new sessions and all evidence.
-- Run only under separate approval, with the compatible backend retained.
BEGIN;
UPDATE training_v2_private.release_policy SET web_enabled=false,web_backdate_days=0;
-- Keep FO entitlement enforcement: restoring role-derived MEPC grants is unsafe.
-- Do not restore NOT NULL attendance constraints while legitimate Web rows exist.
COMMIT;
