# Reliance Retail workflow audit matrix

**Correction notice:** this is the original 130-action baseline audit at `212171ff`. The Fault Tracker browser-only Save, estimated weekly KPI and missing legacy FO linkage findings are superseded locally by [Critical workflow corrections](MIS_OPERATING_GUIDE.md#critical-workflow-corrections-after-the-baseline-audit). Production installation and authenticated acceptance remain pending. No new Training authoring permissions are granted.

Audit date: 31 October 2026. Application source baseline: `0a9da9135357aa28eb83a3bf55d0ce5d3ea5e9b2`. Documentation changes do not deploy this candidate or change any business rule.

## Evidence and status rules

- **IMPLEMENTED** = the committed code has the described path; local tests or snapshot rendering are identified separately. It is not a production-persistence PASS.
- **PARTIAL** = a visible/implemented portion exists but an essential path, integration, role mapping or persistence guarantee is incomplete.
- **MISSING** = no supported action was found. For read-only reports, this can be by design.
- **NOT VERIFIED IN PRODUCTION** applies to **every authenticated action in every table below**, including actions marked IMPLEMENTED. No authenticated Admin/MIS/FO save/read, private-evidence or negative-scope acceptance was executed in this audit.
- Existing catalog/private-bucket PASS and the previously verified active/auth-linked QPMSADMIN Admin profile are retained evidence, not new browser acceptance. No database audit, upload, import, approval, save, permission change or deployment was executed for this documentation task.
- Ten actual screens were captured at `http://127.0.0.1:4188`: local **read-only production-data snapshot**, no writes; all ten rendered without page exceptions or React error boundaries. See [capture manifest](screenshots/20261031/manifest.json). These are not live production session screenshots. The snapshot itself is dated; its values are not a current database recount.

## Role and account-configuration matrix

`State grant` means existing permitted viewer/editor/reviewer state scope, independently enforced by the relevant database function. `Own` means existing authenticated FO ownership/employee/Zone rules; not all-state access. A role name alone does not install capabilities, open an apply gate or confer storage access.

| Role/configuration | Dashboard / Attendance read | Attendance upload | Cleaning / Training reporting | Cleaning schedule request | CM/PM / Thermography | Existing Fault Tracker | OOS mutation | Structured Training authoring |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| QPMSADMIN, observed role Admin | Implemented existing all-state scope | Implemented Admin only | Implemented within existing employee/store envelope | Implemented request; different reviewer; Admin apply gate | Implemented active Admin | Implemented scoped read/import; UI update persistence PARTIAL | Implemented Admin + scope/freeze/independence | MISSING for Admin: FO-only mutations |
| Retail HK MIS designation on role MIS | State-scoped, needs valid business/state/grants | Denied | HK reporting route recognized; Training still checks employee/store envelope | State editor/reviewer; never self-review | State viewer for reports; editor/reviewer for writes | MIS state-restricted path; no import rights | Denied without separately recognized OOS role | Denied |
| Standalone role HK MIS | Retail reporting paths recognized | Denied | Recognized for cleaning/Training | State editor/reviewer | As above | PARTIAL: `/fault-tracker` role allow-list does not recognize pure HK MIS; alias route can differ | Denied | Denied |
| Retail MEPC responsibility, role MIS + Technical MIS designation | State-scoped | Denied | Technical MIS alone does NOT admit the cleaning/Training web routes | Denied by cleaning page access without existing HK capability | State viewer/editor scope | Backend recognizes technical designation and frontend role MIS; Store scope still intersects | Navigation can show OOS, but Technical MIS alone is denied by mutation helper | Denied |
| Literal role MEPC MIS | No automatic alias found | Denied | MISSING alias; do not equate it to Technical MIS | Not granted by name | Not granted by name | Not granted by name | Not granted by name | Denied |
| Standalone role Technical MIS / Tech MIS | Recognized Retail dashboard/operations roles | Denied | Not admitted to HK-only cleaning/Training web routes | Not admitted by cleaning page | State-scoped operations | PARTIAL: backend accepts technical role but primary `/fault-tracker` frontend allow-list does not | Backend denies unless OOS MIS/Admin also recognized | Denied |
| Active Reliance Retail FO | Seven-module web workspace not generally admitted; separate FO-self read is a different capability | Denied | Own submitted Training/cleaning APIs under their existing rules; not broad report access | No general MIS scheduling right | Denied general MIS operations | Not a general FO entitlement | Denied | Implemented for own active authorized Retail context |
| Existing COO / MD / management | Not blanket access: web, Retail service and SQL mappings differ; inspect account-specific scope | No blanket entitlement from management title | Not blanket access | Not blanket access | Service capability alone does not bypass SQL scope | Explicit COO/operations-lead/branch-head read-all roles exist; source Store filter still applies | Independent reviewer/Admin rules still apply | Denied unless actual FO-authoring rules pass |
| KAM / generic Retail MIS | Existing Retail dashboard/operations scope; valid state required for Attendance | Denied | No automatic HK reporting right | No automatic HK scheduling right | Existing state grants required | Generic role MIS state scope; KAM not automatically in Fault allow-list | Denied absent OOS role | Denied |

Account status: QPMSADMIN configuration was verified previously; **its current signed-in acceptance is NOT VERIFIED IN PRODUCTION**. HK/Technical MIS accounts/grants were not created or verified by this task. Existing FO/management account readiness and device-delivered flows are also NOT VERIFIED IN PRODUCTION. Use existing authorized account provisioning; do not broaden unrelated permissions. The proposed production-only Admin pilot is a separate **unapproved proposal**, not an active access restriction.

## 1. Dashboard — IMPLEMENTED reporting

Frontend: `src/pages/reliance-retail/RetailDashboard.jsx`, `IfmsDashboardParts.jsx`, `ifmsDashboardModel.js`.
Backend: `GET /api/reliance-retail/module-reports/dashboard` → `retailModuleDashboard`.
Data: Unified scoped snapshot, approved Attendance/AOP, cleaning schedules/submissions, completed Training, `rpc_retail_operations_snapshot`; no Dashboard table.

| Audited action | Status | Actual behavior / limitation |
| --- | --- | --- |
| 1 Open | IMPLEMENTED | Retail Dashboard at `/reliance-retail`; actual snapshot screen captured. |
| 2 Role access | IMPLEMENTED | Frontend Retail role/business checks; backend capability and database state/store scope; no general FO admission. |
| 3 New record | MISSING | Intentionally read-only; create through the appropriate module. |
| 4 Required fields | IMPLEMENTED | Valid reporting month; optional reporting/global/card state; server bounds monthly period. |
| 5 Save/Submit | MISSING | No operational Save. GET aggregates source records; export does not persist work. |
| 6 Approval | MISSING | No Dashboard approval; source workflows retain their own approval. |
| 7 Open/update existing | PARTIAL | View Details opens module report; no direct Dashboard edit. |
| 8 Status changes | MISSING | Source status changes appear after refresh; not set here. |
| 9 Reporting | IMPLEMENTED | Attendance credits/percentage; CM/PM applicable/completed/remaining; Thermography statuses; cleaning scheduled/completed/remaining; HK/MEPC completed sessions. Unavailable remains unavailable. |
| 10 Filters/export | IMPLEMENTED | Month/global and per-card state; Export summary. No separate Fault KPI card. |
| 11 Edit/delete | MISSING | By design; no Dashboard data mutation. |
| 12 Unauthorized attempt | IMPLEMENTED | Route/capability denial or unauthorized source unavailable; signed-in negative tests NOT VERIFIED IN PRODUCTION. |
| 13 History | PARTIAL | Reads source truth and update timestamp; no Dashboard event ledger. |

## 2. Attendance — IMPLEMENTED, Admin-only import

Frontend: `RetailAttendance.jsx`, `retailAttendanceExport.js`. Backend router: `retailAttendanceRoutes.js`; service: `retailAttendanceService.js`, streaming/preview-audit helpers. APIs under `/api/reliance-retail/attendance`: GET `summary`, `employees`, `history`; POST `preview`, `commit`.
Persistence: `retail_attendance_uploads`, versioned `retail_employee_daily_attendance`; existing `retail_attendance_aop_versions` and Store Master are reporting inputs. Sources are retained in upload audit history.

| Audited action | Status | Actual behavior / limitation |
| --- | --- | --- |
| 1 Open | IMPLEMENTED | Retail Attendance; daily/MTD page captured. |
| 2 Role access | IMPLEMENTED | Active Retail report profile/state; existing global Retail Admin mapping uploads/corrects; `RETAIL_ATTENDANCE_ENABLED` gate retained. |
| 3 New record | IMPLEMENTED | Upload Day Attendance; approved workbook followed by confirmation. Not an ordinary MIS write permission. |
| 4 Required fields | IMPLEMENTED | `.xlsx` ≤15 MB, EP No, EP Name, Site Code, Att. Date, Att. Status, Class; recognized code/date/class/status. Correction adds explicit reason and replacement consent. |
| 5 Save/Submit | IMPLEMENTED | Preview validates and retains source/audit; commit persists valid rows. Rejected/excluded rows do not receive HK/MEPC credit. Identical import replay avoids duplication. |
| 6 Approval | PARTIAL | Explicit Admin import/correction confirmation; not a separate independent attendance maker/checker workflow. |
| 7 Open/update existing | IMPLEMENTED | State/store/employee/date drill-down; replacement supersedes the employee/day source versions, preserving previous rows. |
| 8 Status changes | IMPLEMENTED | Source validation/commit/replacement history; attendance credits are source statuses, not a manual attendance lifecycle editor. |
| 9 Reporting | IMPLEMENTED | Bounded store batches, decimal AOP, HK/MEPC split, configured subtotal and N/A incomplete percentages; missing upload is not absence. |
| 10 Filters/export | IMPLEMENTED | Daily/MTD, month, cutoff, state; Total, Export, Store export; authorized source/exception export. |
| 11 Edit/delete | PARTIAL | Controlled versioned replacement exists; no ordinary direct row edit/hard delete. |
| 12 Unauthorized attempt | IMPLEMENTED | No/invalid authentication 401; non-Admin import 403, invalid state denied; scope/gate errors retained. |
| 13 History | IMPLEMENTED | Filename/checksum/raw source, validation, import and superseded correction versions; preview itself is audited. |

## 3. Deep Cleaning — PARTIAL end-to-end FO integration

Frontend: `RetailScopedDeepCleaning.jsx`, `RetailCleaningSchedule.jsx`. Request: `/api/reliance-retail/unified-master/propose`, kind `DC_SCHEDULE`; review `/decide`, application `/apply` through restricted RPCs. Report/evidence: `/api/reliance-retail/module-reports/deep-cleaning[/:id/evidence]`.
Persistence: `retail_provisional_proposals`, `client_deep_cleaning_schedules`, `reliance_retail_management_audit`; dedicated completion/evidence tables `client_deep_cleaning_submissions`, `client_deep_cleaning_uploads`; bucket `client-deep-cleaning-uploads`. Dedicated FO backend routes start `/api/client-deep-cleaning/submissions` and include draft update, upload-url, uploads/complete, submit, view/delete draft evidence.

| Audited action | Status | Actual behavior / limitation |
| --- | --- | --- |
| 1 Open | IMPLEMENTED | Retail Deep Cleaning; Schedule Deep Cleaning at top-right. |
| 2 Role access | IMPLEMENTED | Admin/HK capability plus active profile/scoped Unified snapshot; schedule options require active store and existing editor/reviewer state permission. |
| 3 New record | IMPLEMENTED | Submit schedule request creates a proposal, not an operational schedule. |
| 4 Required fields | IMPLEMENTED | Store, scheduled date, 3–2,000-character reason/reference. Dedicated completion API requires store code/date; vendor/remarks optional; completed before/after image uploads required for final submit. |
| 5 Save/Submit | PARTIAL | Proposal→independent review→gated apply actually inserts schedule in isolated SQL test. Dedicated completion API persists separately. Committed mobile form calls legacy `createActivitySubmission`/`createActivityUpload`, not the dedicated endpoints; bridge into this report is unverified. |
| 6 Approval | IMPLEMENTED | Different permitted reviewer; no self-approval. Admin apply requires existing `RETAIL_STORE_IMPORT_WRITES_ENABLED` gate. |
| 7 Open/update existing | PARTIAL | Reports/evidence open existing records; no reschedule/cancel/Not Completed editing in this report. Legacy direct schedule service is not the approved path. |
| 8 Status changes | PARTIAL | Planned/Scheduled displayed Scheduled; submitted dedicated same-store/date match displays Completed; existing explicit Not Done/Cancelled respected. No ordinary desktop terminal-status editor. |
| 9 Reporting | IMPLEMENTED | Scheduled minus Completed = Remaining, cancelled excluded; dates/status/search; unresolved identity excluded. No proven legacy-mobile-to-dedicated-report bridge. |
| 10 Filters/export | IMPLEMENTED | From/To/state/store/status/search, separate schedule/work pagination, Export cleaning report; temporary evidence view after scope/path validation. |
| 11 Edit/delete | PARTIAL | Dedicated FO own draft update/upload removal; submitted work locked. No ordinary schedule/report hard delete. |
| 12 Unauthorized attempt | IMPLEMENTED | Existing auth/state/ownership checks; evidence signer rechecks permitted submission and fixed bucket/path. End-user production access NOT VERIFIED IN PRODUCTION. |
| 13 History | IMPLEMENTED | Proposal decisions, schedule source reference and management audit; retained dedicated upload/submission evidence. Device path integration remains PARTIAL. |

## 4. Training — IMPLEMENTED reporting, PARTIAL Admin/MEPC-MIS operations

Frontend report: `RetailTraining.jsx`; structured mobile UI `Mobile_FO_V2/lib/training/screens/*`; backend `trainingRoutes.js`, `trainingService.js`, `trainingAccessService.js`, evidence service; report `/api/reliance-retail/module-reports/training`.
Persistence: `fo_activity_submissions` employee envelope, `training_sessions`, `training_session_attendees`, `training_session_topics`, `training_evidence`, `training_events`, master categories/types/topics; bucket `training-evidence`. `/api/training/sessions` create/read; `/:id` detail/draft patch; attendee/topic/evidence subroutes; `/:id/submit`, `/:id/cancel`.

| Audited action | Status | Actual behavior / limitation |
| --- | --- | --- |
| 1 Open | IMPLEMENTED | Retail Training report; FO Add Training Proof launches structured flow in committed source. Device/live delivery not verified. |
| 2 Role access | PARTIAL | Admin/HK report routes and hierarchy/store envelope exist. Technical MIS alone is not admitted by the web Training route; literal MEPC MIS alias missing. |
| 3 New record | PARTIAL | Active authorized Reliance FO can author; Admin/MIS cannot mutate structured sessions. No new Admin authoring was added. |
| 4 Required fields | IMPLEMENTED | Existing attendance/visit context, category, type, active authorized Retail store and trainer name; create uses server India date; attendees/topics/evidence validated under session policy; remarks optional. |
| 5 Save/Submit | IMPLEMENTED | Save Draft/create/patch persist through Training RPCs; submit validates evidence and records session/events. Visible mobile navigation alone is not production proof. |
| 6 Approval | MISSING | No separate independent MIS training-approval stage found. Client Approved is a Thermography status, not Training. |
| 7 Open/update existing | IMPLEMENTED | Report details/evidence/history; owner-authorized draft mutation. Admin report detail does not grant write rights. |
| 8 Status changes | IMPLEMENTED | Draft→submitted and supported owner cancel path; submitted/cancelled mobile screens read-only. No arbitrary backwards status edit. |
| 9 Reporting | IMPLEMENTED | Submitted/completed HK and MEPC sessions counted separately; distinct verified stores separate from session count; bounded reads beyond UI page size. |
| 10 Filters/export | IMPLEMENTED | Date/class/state/Zone/FO/store/search; View Training evidence; Export Training review includes all filtered rows. |
| 11 Edit/delete | PARTIAL | Own draft attendee/evidence removal and topic edits; submitted audit retained; no general session hard-delete UI. |
| 12 Unauthorized attempt | IMPLEMENTED | FO-only mutation/business/active/context checks; employee hierarchy/store scope and evidence authorization. Runtime end-user checks remain unverified. |
| 13 History | IMPLEMENTED | Session events, evidence metadata and employee submission envelope retained. |

## 5. CM/PM — IMPLEMENTED

Frontend `RetailOperations.jsx` kind maintenance; GET/POST `/api/reliance-retail/operations/maintenance`; `retailOperationsService.js` and `retailOperations.js`; SQL `rpc_retail_maintenance_complete`, `rpc_retail_operations_snapshot`.
Tables: `retail_maintenance_calls`, `reliance_retail_management_audit`; scoped existing Store Master and Retail access grants.

| Audited action | Status | Actual behavior / limitation |
| --- | --- | --- |
| 1 Open | IMPLEMENTED | Retail CM/PM; Record CM/PM Call focuses form. |
| 2 Role access | IMPLEMENTED | Active allowed Retail/Admin role and SQL state view/edit scope; UI filters do not confer write scope. |
| 3 New record | IMPLEMENTED | One completed call per permitted active store/kind/month, confirmed before POST. |
| 4 Required fields | IMPLEMENTED | Valid reporting month, CM/PM kind, permitted store and generated request ID; actual date/user from server, not form. |
| 5 Save/Submit | IMPLEMENTED | Record CM/PM Call→Record CM Call/Record PM Call→Confirm save; SQL insert/audit; failure not shown as success. |
| 6 Approval | MISSING | No separate commercial/reviewer stage for maintenance; existing authorization is required. |
| 7 Open/update existing | PARTIAL | Completion/date and history readable; completion is not editable. |
| 8 Status changes | IMPLEMENTED | Pending→Completed. CM days 1–15; PM 16–last day. Current kind defaults from authoritative server date; selecting another kind does not reopen its window. |
| 9 Reporting | IMPLEMENTED | Applicable/completed/pending state and store totals; Dashboard uses actual source. |
| 10 Filters/export | IMPLEMENTED | Month/state/store/search/Call; Export Excel: state, both-kind details and audit. |
| 11 Edit/delete | MISSING | Intentionally immutable; old months locked, duplicates rejected; retry request replay does not add a second record. |
| 12 Unauthorized attempt | IMPLEMENTED | Existing JWT/profile checks, SQL scope, date and uniqueness checks; service/direct table grants not broadened. |
| 13 History | IMPLEMENTED | Actual actor/date/time and immutable audit; isolated PostgreSQL validated persistence, locks and concurrency. |

## 6. Thermography — IMPLEMENTED

Frontend `RetailOperations.jsx` kind thermography, shape guard `retailOperationsReport.js`; GET/POST `/api/reliance-retail/operations/thermography`; SQL `rpc_retail_thermography_command`, snapshot RPC.
Tables: `retail_thermography_inspections`, management audit. No inspection temperature/Normal-Abnormal result schema is implied by the three workflow statuses.

| Audited action | Status | Actual behavior / limitation |
| --- | --- | --- |
| 1 Open | IMPLEMENTED | Retail Thermography; Schedule Thermography focuses form. Module-switch crash fixed in baseline. |
| 2 Role access | IMPLEMENTED | Active authorized role and state scope; only permitted stores can save. |
| 3 New record | IMPLEMENTED | Save scheduled inspection after store/date and confirmation. |
| 4 Required fields | IMPLEMENTED | Store/date/request ID for schedule; existing ID/current revision/request ID for completion/approval. Actual dates/users are server values. |
| 5 Save/Submit | IMPLEMENTED | Confirmation POST persists restricted RPC result; reload reads stored source. Empty valid report is zero; incomplete report is unavailable, not invented zero. |
| 6 Approval | IMPLEMENTED | Record client approval records actual approval; no separate maker/checker commercial-review requirement was added here. |
| 7 Open/update existing | IMPLEMENTED | Record completion / Record client approval on permitted current row; stale revision refused. |
| 8 Status changes | IMPLEMENTED | Scheduled→Completed→Client Approved only; no pre-scheduled completion; due=completion+10 calendar days; overdue after due date; late approval retained. |
| 9 Reporting | IMPLEMENTED | Scheduled-month state totals, current awaiting/approved/overdue and late-history values; Dashboard status KPIs. |
| 10 Filters/export | IMPLEMENTED | Month/state/store/search; Export Excel with state/details/audit, View history. |
| 11 Edit/delete | MISSING | No ordinary reschedule, delete or backward transition; preserves history. |
| 12 Unauthorized attempt | IMPLEMENTED | Existing state/role checks and service-only RPC; no direct authorizing browser state. Production authenticated denial remains unverified. |
| 13 History | IMPLEMENTED | Actual actors/timestamps, revision and before/after audit; isolated PostgreSQL deadline/forward-state tests passed previously. |

## 7. Existing IFMS Fault Tracker — PARTIAL update persistence

Frontend `src/pages/FaultTracker.jsx`; `/fault-tracker` retained. APIs `/api/fault-tracker/tickets`, `/imports`, `/import`; Store scope helper `faultTrackerStoreScope.js`; export `faultTrackerExport.js`. Tables: `fault_tracker_import_batches`, `fault_tracker_tickets`, existing Store Master. This is NOT `retail_service_orders` fault registration.

| Audited action | Status | Actual behavior / limitation |
| --- | --- | --- |
| 1 Open | IMPLEMENTED | Retail Fault Tracker navigates to existing global route; Management View/MIS view retained. |
| 2 Role access | PARTIAL | Existing Admin, management read-all, MIS/project coordinator state and Technical responsibility checks. Pure HK/Technical MIS frontend/backend aliases can disagree; role MIS plus designation differs from pure specialist role. |
| 3 New record | IMPLEMENTED | Permitted Admin Import Excel parses and POSTs an import batch/tickets. No single manual-ticket creator in this imported tracker. No import executed. |
| 4 Required fields | PARTIAL | Import requires file/recognized parsed source columns; read filters optional. Update drawer has IFMS Stage and Remarks, but its Save is local-only. |
| 5 Save/Submit | PARTIAL | Import has backend persistence; `saveUpdate()` calls only `setTickets`/closes drawer, with no authenticated update request. A visible changed row is not saved database state. |
| 6 Approval | MISSING | No separate imported-ticket approval workflow found. Admin source reconciliation is not approval. |
| 7 Open/update existing | PARTIAL | Detailed View and filters work; Update opens drawer, but changes can be lost on refresh. |
| 8 Status changes | PARTIAL | Existing stage selector updates browser state; no verified server forward-only ticket-update transition in this UI. Do not confuse OOS/service-fault lifecycle with imported IFMS stages. |
| 9 Reporting | PARTIAL | Scope/filter counts implemented: unique active Store Master codes intersect existing user/state/store grants; last snapshot 680/2,979. Completed This Week is a fixed `round(total×0.11)` heuristic, not recorded weekly completion. Score is rounded closed-share; average age is imported-row average. Do not certify the heuristic as actual work. |
| 10 Filters/export | IMPLEMENTED | Management state/month summaries; detailed state/supervisor/stage/ageing/ticket/store/date/search; scoped export. No unscoped export source substituted. |
| 11 Edit/delete | PARTIAL | Local edit UI exists; persistent edit absent from this handler. No ordinary source-row hard delete; excluded tickets retained. |
| 12 Unauthorized attempt | IMPLEMENTED | API auth/role/state plus Store Master intersection; explicit module grants narrow when present. Excluded detail lookup cannot recover a ticket. End-user live denial not verified. |
| 13 History | PARTIAL | Import batch/time/source retained; local drawer's lastUpdatedBy is not persisted immutable ticket-update history. |

## 8. OOS Tracker — PARTIAL (legacy path; V2 postponed)

Frontend `RetailOperationalTrackers.jsx` → `RetailServiceTrackers.jsx`; backend `retailServiceTrackerRoutes.js`, `retailQuotationImport.js`, `retailOosAccess.js`; `/api/reliance-retail/service-trackers`, `/quotation/preview`, `/quotation/import`, `/quotation/rework`, `/command`.
Tables: `retail_service_orders`, `retail_service_order_stores`, `retail_service_events` and immutable quotation evidence; RPC snapshot/import/command. Separate advanced rework RPC/capability is NOT authorized by this audit.

| Audited action | Status | Actual behavior / limitation |
| --- | --- | --- |
| 1 Open | IMPLEMENTED | Retail tools→OOS Tracker; existing Store Service Trackers interface. |
| 2 Role access | PARTIAL | Navigation admits technical/OOS responsibilities, but mutations require Admin or OOS MIS plus existing state grants; Technical MIS alone fails backend operation check. |
| 3 New record | IMPLEMENTED | Download quotation template→Preview quotation→Save quotation groups; no new OOS V2 screen built. |
| 4 Required fields | IMPLEMENTED | Quotation sheet: Quotation Number, Store Code, Description, Quantity, Unit Rate; allowed same-state stores, valid values, file bounds. Stage required fields documented in user manual. |
| 5 Save/Submit | IMPLEMENTED | Existing grouped import/replay and restricted command persist service orders/events; receipt is not financial payment execution. Current freeze/capability still governs saves. |
| 6 Approval | IMPLEMENTED | Commercial confirmation requires independent authorized reviewer distinct from persisted creator. |
| 7 Open/update existing | PARTIAL | Details/history and next-stage actions; revised single quotation pre-PO path exists. Advanced-stage rework requires separate postponed V2 capability. |
| 8 Status changes | IMPLEMENTED | QUOTED→PO_RECORDED→COMMERCIALLY_CONFIRMED→FUND_RECORDED→PAYMENT_RECORDED→DELIVERED, required references and revisions. Display labels differ from codes. |
| 9 Reporting | IMPLEMENTED | Filtered stage counts, details, quotation items and related history. No money is transferred. |
| 10 Filters/export | IMPLEMENTED | Status/state/store/Zone/FO; Export tracker and history and template; original workbook bytes not exposed as general read data. |
| 11 Edit/delete | PARTIAL | Existing rework version history; no ordinary delete/backwards arbitrary-stage editor; multi-revised quotations may require separate uploads. |
| 12 Unauthorized attempt | IMPLEMENTED | Existing real JWT parent, OOS role helper, state RPC scope and freeze; out-of-scope/capability errors do not authorize a bypass. |
| 13 History | IMPLEMENTED | Immutable source/version evidence, events, revisions and rework count. Production action results NOT VERIFIED IN PRODUCTION. |

## 9. Manpower Vacancy — MISSING operational workflow

Frontend `RetailComingSoon.jsx`; route `/reliance-retail/manpower`. No dedicated vacancy backend/table found.

| Audited action | Status | Actual behavior / limitation |
| --- | --- | --- |
| 1 Open | IMPLEMENTED | Existing navigation displays Under Development; actual screen captured. |
| 2 Role access | IMPLEMENTED | Admin/HK web route gate; does not grant vacancy data rights. |
| 3 New record | MISSING | No vacancy form/table/API. |
| 4 Required fields | MISSING | No operational form. |
| 5 Save/Submit | MISSING | No persistent action. |
| 6 Approval | MISSING | No approval workflow. |
| 7 Open/update existing | MISSING | No vacancy record list/editor. |
| 8 Status changes | MISSING | No vacancy lifecycle. |
| 9 Reporting | MISSING | AOP/attendance do not constitute a vacancy module. |
| 10 Filters/export | MISSING | No vacancy report/export. |
| 11 Edit/delete | MISSING | No supported operations. |
| 12 Unauthorized attempt | PARTIAL | Web route gate only; there is no vacancy API to certify. |
| 13 History | MISSING | No vacancy audit/history implementation. |

## 10. Reliance Retail Store Master — IMPLEMENTED reviewed core; PARTIAL legacy controls

Frontend `RetailStoreMaster.jsx`, `RetailUnifiedMaster.jsx`, review/identity/Zone/import components; main APIs `/api/reliance-retail/unified-master/*`, separate provisional/saved-review/zone mapping/import and existing management routes. Tables include existing Store Master, zones, effective-dated FO assignments/store-zone history, `retail_attendance_aop_versions`, provisional files/rows/proposals/events/access and management audit; restricted Unified/identity/apply RPCs preserve source-bound approvals.

| Audited action | Status | Actual behavior / limitation |
| --- | --- | --- |
| 1 Open | IMPLEMENTED | Retail tools→Reliance Retail Store Master→Unified Management; separate from platform master. |
| 2 Role access | PARTIAL | Retail web master navigation broad; data/actions still require actual state viewer/editor/reviewer/Admin rules. Legacy direct management mappings are narrower/different. |
| 3 New record | IMPLEMENTED | Add Store→Save pending Store creates a pending source identity, not automatically active/attendance-matchable. Existing source upload/staging paths distinct from activation. |
| 4 Required fields | IMPLEMENTED | Pending Store Code/geography; change kind/target/state/proposed values/reason; AOP explicit components/total/effective dates/calculation+approval refs; identity source/revision/evidence and explicit status per installed contract. |
| 5 Save/Submit | IMPLEMENTED | Proposal persistence, independent decide, gated apply; staging/review/activation are separate receipts, not interchangeable. No master/AOP mutation executed here. |
| 6 Approval | IMPLEMENTED | Independent reviewer, no self-review, Admin apply; new identities retain their dedicated source-bound identity gates. |
| 7 Open/update existing | PARTIAL | Unified reviewed edit/Zone/FO/AOP/schedule proposals and dated history exist. Outer legacy Stores Add/Edit can be visible but direct writes are blocked once Unified capability is installed. |
| 8 Status changes | IMPLEMENTED | Pending proposal→approved/rejected→applied where permitted; operating identity status is separately reviewed. Pending is not automatically active. |
| 9 Reporting | IMPLEMENTED | Unified master/readiness, dated ownership, source versus operational counts, approved AOP, activities and related history; unknown ownership remains unknown. |
| 10 Filters/export | IMPLEMENTED | Date/geography/Zone/FO/store/search/activity status; existing review/source/attendance exports and batch tools. Export is not activation authority. |
| 11 Edit/delete | PARTIAL | Reviewed changes/withdrawal where implemented; no ordinary destructive source/master deletion shortcut. Applied history/source retained. |
| 12 Unauthorized attempt | IMPLEMENTED | Restricted RPC caller/actor/state checks, baseline/revision drift guards, separate apply gates; old direct writes refused. |
| 13 History | IMPLEMENTED | Immutable source hash/row evidence, proposal maker/checker, apply receipt, effective-dated mappings and management audit. |

## Missing/partial feature register and immediate capability summary

| Finding | Classification | Operating consequence |
| --- | --- | --- |
| Imported Fault Tracker drawer Save has no persistence call | PARTIAL; persisted ticket-update action MISSING in this UI | Do not treat local update as saved/audited. Reporting/import scope remains intact. |
| Imported Fault Tracker Completed This Week | PARTIAL; real weekly completion source MISSING for this KPI | Current calculation is rounded 11% of scoped total. Do not present it as observed weekly completion. No metric was changed by this audit. |
| FO cleaning capture uses legacy activity tables; report uses dedicated client tables | PARTIAL | Backend dedicated completion/evidence validation exists, but device→schedule/report completion is NOT VERIFIED IN PRODUCTION and bridge not established in committed mobile source. |
| Training Admin/MIS authoring | MISSING by current FO-only rule | Do not expose fake Save or expand role permissions. FO authoring remains its existing path. |
| Technical/MEPC MIS Training route and specialist-role Fault aliases | PARTIAL / MISSING literal MEPC MIS alias | Configure actual supported identity/role/business/state; do not promise all seven modules to every MIS role. |
| Management role mapping | PARTIAL | Existing management title does not guarantee agreement between web/service/SQL scope. Verify actual account. |
| Manpower Vacancy | MISSING | Under Development only. |
| OOS advanced-stage rework | PARTIAL | Separate V2 capability postponed; legacy path remains subject to runtime guards. |
| Legacy direct master/schedule UI/services | PARTIAL | Use reviewed Unified proposal path, not direct-write shortcuts. |
| Cleaning/Thermography reschedule/delete; CM/PM edit/backdate/delete | MISSING or intentionally restricted | Do not infer these capabilities from a status/table. Preserve immutable history. |
| Candidate live authenticated acceptance and ordinary end-user negative evidence tests | NOT VERIFIED IN PRODUCTION | Local snapshot, SQL catalog and service credentials do not certify sign-in/save/evidence behavior. |
| Full legacy Unified workbook suite | PARTIAL validation evidence | Original 854-row workbook absent in prior run; specific schedule SQL subtest passed, full dependent suite did not. |

**QPMSADMIN now:** existing live authorized functions and read-only preview can be used under their existing controls. Candidate seven-module code is prepared but not released. Admin can use candidate reports/exports and prepared authorized Attendance/scheduling/operations paths only when actually running under approved release/access controls. No claim of live candidate saves is made. Training authoring and imported Fault persistent editing are not supplied by the candidate.

**MIS now:** no accounts/permissions were created. A supported configured role/business/state and viewer/editor/reviewer grant are prerequisites. Reporting does not grant upload/approve/apply rights. **FO now:** existing own-context mobile Training/legacy cleaning paths and separate self-service are distinct from the MIS workspace; new dedicated cleaning integration/device delivery remains unverified.

## Source and evidence map

All paths below are repository-relative and were inspected, not assumed from screenshots:

- UI/auth: `src/components/Sidebar.jsx`, `src/utils/authRoles.js`, `src/pages/reliance-retail/*`, `src/pages/FaultTracker.jsx`.
- Report/write/auth services: `backend/routes/relianceRetailManagementRoutes.js`, `retailAttendanceRoutes.js`, `retailUnifiedRoutes.js`, `retailOperationsRoutes.js`, `retailServiceTrackerRoutes.js`, `clientDeepCleaningRoutes.js`, `trainingRoutes.js`; corresponding services; Fault middleware/routes in `backend/server.js`.
- Database contracts: `supabase/migrations_2_0/232_reliance_retail_uploaded_attendance.sql`, `supabase/proposals/retail_unified_apply_and_record.sql`, `retail_operations_workflows.sql`, `retail_service_trackers.sql`, existing Training migrations/RPCs. These files were read; nothing was installed.
- Critical mobile source: `Mobile_FO_V2/lib/tasks/tasks_screen.dart`, `visits/visits_screen.dart`, `services/supabase_service.dart`, `training/screens/*` and `training/data/training_api.dart`. No APK/device test or mobile change occurred.
- Local evidence retained from prior work: scoped route/authorization, Attendance batching/AOP, cleaning evidence/matching, operations SQL locks/deadlines and Thermography report-shape/navigation tests. Existing mandatory authenticated acceptance contract still applies; the separate Admin-only release amendment remains a draft.

Screenshots show screen availability only; see [staff manual](USER_OPERATING_MANUAL.md) for button-by-button instructions. Do not classify a visible control as successful persistence.
