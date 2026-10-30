# Additive OOS status-preserving rework

Prepared only; NOT installed in production. New version: 20261030160000. Do not rerun 20261030140000.

Owner installation procedure: run 01_PREFLIGHT_READ_ONLY.sql; confirm original_command_exact=true and no conflicting new version. Run 02_INSTALL_AND_RECORD.sql once. Run 03_POSTINSTALL_READ_ONLY.sql and retain output. Existing function must remain unchanged; service_role alone may execute the new function. Identical installer replay is a no-op; drift aborts.

The new RPC copies the reviewed command validation and permits only REWORK. The sole business-rule change removes the before-PO restriction. Existing state grants, revision locks, request-id replay, workbook hash checks, immutable events, source version evidence, store identity validation and original RPC remain intact. Status, PO, payment and delivery references remain unchanged. No migration-time data writes occur beyond its migration-ledger record. No canonical, attendance, Zone/FO, AOP, GPS/KM or financial tables are changed.

Backend uses this RPC for advanced reworks and reports capability unavailable if it is absent. Existing pre-PO workflow remains compatible. Multi-quotation revised uploads must be split into individual quotation workbooks; do not partially save a mixed batch. Read-only previews explain disposition and version.

Rollback, only with owner authorization: DROP FUNCTION public.rpc_retail_service_rework_v2(uuid,uuid,text,uuid,integer,jsonb); keep migration history and audit records, never delete committed reworks. The application then blocks advanced rework safely. Reinstallation after rollback requires a separately reviewed repair because the recorded migration is intentionally retained.
