# Reliance Retail Cleaning delivery implementation

Source only. No production SQL, grants, deployment, APK build or distribution.

## Baseline and isolation

Implemented in `feat/retail-cleaning-delivery-20261103`, isolated from the dirty root. Started at PR #59 head `5ca17e6240418957cb796ca6373c3dbc527ae682`. During implementation its identical functional contents landed on main through PR #60/backend and #61/UI (`9ba0579ceb9ba09dea8f37298fd13b50b9952766`); only the inherited UI verification workflow differed. The original 192 tracked root modifications were preserved.

## Contract

`GET /api/client-deep-cleaning/schedules` and `/schedules/:id` use `contract_version: retail-cleaning.v1`. The existing list URL is retained; there is no alternate schedule table/feed. Rows contain both `id` and `schedule_id`, `retail_store_id`, canonical `store_code`, `store_name`, geographic `state`/`geographic_state`, `reporting_state`, `zone_id`, `scheduled_date`, actual `status`, `activity`, `notes`, optional `city`/`latitude`/`longitude`, `assigned_fo_profile_id`, `assignment_status`, `completed_at`, `not_done_reason`, historical `executor_profile_id`, and server `permitted_actions`.

List filters: either `month=YYYY-MM` or `from/to=YYYY-MM-DD`, inclusive, maximum 93 days. Default today through 30 days ahead in IST. `status` supports Planned, legacy Scheduled (matches Planned/Scheduled), Completed, Not Done (also accepts NotDone input), Cancelled. Pagination is one-based `page`, `limit` 1–100, with `pagination.total`. Detail is identity/scope bound and not restricted to the default date window. Invalid filters return 400, denied identities 403, hidden details 404, stale/duplicate conflicting completion 409, absent/incompatible database RPC 503. No fallback to the old state-wide RPC.

The list includes view/execute/export capabilities; mutation capabilities are false for IFMS viewers. An individual FO row needs `execute` to become actionable. Future work remains visible but cannot start before its scheduled IST date. Android refuses a response without the contract marker. Both old ad-hoc submissions and original photo tables/paths remain readable through existing authorized flows.

`POST /submissions` accepts either the existing ad-hoc payload or `{schedule_id}`. Scheduled draft creation derives store/date/identity from the database; caller actor/store/date cannot replace them. Existing `/submissions/:id/submit` accepts `{outcome: Completed|Not Done, not_done_reason}`; default Completed preserves existing caller behavior. Draft replay returns the same actor-owned draft. Finalization locks the schedule and draft, verifies current execution ownership, date, source store, private physical evidence and pairing, then finalizes the schedule and submission in one transaction. Repeating the same completion is idempotent; a conflicting outcome/executor is rejected.

`GET /schedules/export` additionally requires `deep_cleaning.export`; its store set is independently restricted to export-authorized grants. The web viewer downloads only those paginated rows, not the broader view list.

## Scope and ownership

* TN and PY remain distinct geographic states. Reporting maps both to TN. Current `retail_unified_owner(store,now())` determines primary TN/PY zone ownership, including Zone 4 PY stores. Future/expired ownership cannot grant access now.
* KA/KN, KL, TG, AP-1, AP-2 execution requires an explicit schedule assignment or canonical store assignment AND a matching active Reliance FO profile. No state-wide FO fallback. AP is never expanded to AP-1/AP-2.
* Generic IFMS viewing reuses `resolveCurrentUserAccess`, exact Reliance client `369d2d5f-396f-49f9-a47d-bfbc8f7cb922`, Retail vertical `8bbf5511-1e15-4da4-895e-8546cd14a799`, module `deep_cleaning`, and existing view/export permission codes. Active/expiry checks remain in the canonical resolver. State AND any narrower store scopes must match within a grant. Unsupported narrower scope types fail closed. Grants can be unioned; designation/profile state never supplies a grant. TN viewer scope alone does not infer geographic PY access.
* The already authorized, exact verified initial Retail administrator retains its existing authority. No other Admin/supervisor designation creates access.
* Assignment Pending is computed for unmapped work; status remains Planned. Later effective assignment makes pending work visible after refresh. Reassignment before completion creates a new actor-owned draft; earlier evidence remains with its original author. Completed work uses the recorded executor, never current store ownership.
* Legacy global records now require the same verified viewer scope, canonical store codes and explicit legacy client identity. Ambiguous legacy client rows are omitted. Raw unrelated profiles/site visits are not returned. Photos are signed for five minutes only after scoped submission linkage. The web page cannot bypass a denied API with direct database listing.

## Android integration

The four existing local `lib/deep_cleaning` files are now tracked source. A Reliance FO launcher in HomeShell probes the authenticated contract before opening Assigned Schedules. Existing bottom navigation and attendance/travel/check-in logic are unchanged. The screen has month/status filters, pagination, loading/empty/error/retry states and refresh. Failed refresh removes previously actionable rows. Server actions control Planned/future/finalized work. Instructions, store, geography, date, assignment and status are shown.

Photo retries renew the same server-issued upload intent, first check whether a previous PUT/confirmation succeeded, and retain pair metadata. Submitted evidence stays immutable through the existing service. New code does not add push dispatch or a durable offline completion queue. Connectivity is required; failed work can be retried while the form remains open. Device/process death can lose local unsent file selection; existing uploaded drafts remain server-side. No notification delivery is claimed.

## Conditional database change and blockers

`supabase/proposals/retail_cleaning_delivery_v1.sql` is a conditional, guarded proposal, not an automatic migration. It adds nullable linkage/outcome fields on the existing dedicated submissions table, actor-specific draft uniqueness, one submitted completion per schedule, and three service-role-only functions. It creates no schedule table, permission foundation, user grant, RLS policy or public storage bucket.

Owner-level installed definitions remain unavailable. Run `supabase/verification/retail_cleaning_delivery_read_only.sql` and compare constraints, triggers, function definitions, grants and storage policies with the actual installation before adapting/applying the proposal in staging. Review local untracked 213/214; do not run them. A pre-existing globally unique schedule draft index from 214 conflicts with reassignment drafts and requires a separately reviewed conditional alteration. Existing submitted duplicate links must be reviewed, never deleted to force indexes. Source tests use a synthetic schema and the repository's actual ownership resolver; they do not establish installed production compatibility.

The database proposal deliberately refuses execution without an explicit session review marker. That marker is an installation guard, not a business approval step. CRM schedule save remains immediate and unchanged.

## Validation and release sequence

Local verification: focused backend/access/security tests, real disposable PostgreSQL (including two-connection completion replay), desktop/mobile synthetic browser checks, scoped ESLint, production Vite build, Flutter analyzer and mobile contract/photo/role/auth tests. Evidence screenshots are in `tmp/cleaning-delivery-screenshots/`. No authenticated staging/device acceptance or GitHub run for this new local branch is claimed.

1. Review installed definitions using the read-only verification; reconcile triggers, immutable history and any 214 index differences.
2. In a separately authorized disposable/staging database, review and install the adapted proposal; verify RPC ACLs, private evidence RLS and unchanged existing functions.
3. Deploy the backend/frontend only to approved staging. Use verified existing test identities/grants, never inferred supervisor access. Without a compatible RPC the new feed returns 503.
4. Test each TN zone/PY Zone4, each other state, unassigned work then assignment, stale assignments, cancellation/date changes, duplicate saves, completion retries, old legacy ad-hoc clients, scoped IFMS view/export and all denied mutations.
5. With separate authorization, prepare a test APK using existing signing/config/version procedures. No APK was built here. Complete actual camera/gallery/device, process-death/offline, private-photo and old installed APK acceptance.
6. Require CI and staging acceptance before any production release request. No merge/deploy authorization is implied by this source implementation.

GO for source review and isolated test provisioning. NO-GO for connected staging acceptance/backend production deployment/APK distribution until installed database review, explicit test grants and authenticated/device acceptance are complete. Missing other-state FO mappings are not a deployment prerequisite: those schedules remain safely Assignment Pending and viewer-visible.
