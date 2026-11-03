# Deep Cleaning image configuration - no APK build

Verified read-only on 2026-11-03. No production migration, configuration change, test photo upload, deployment or APK build was performed. Evidence: `docs/evidence/retail-cleaning-upload-read-only-20261103.json`.

## Exact variables

| Exact name | Where | Purpose | Verified status | Classification | Safe verification |
|---|---|---|---|---|---|
| `SUPABASE_URL` | Railway **backend** variables | Supabase project base URL for backend auth/database/Storage | PRESENT in deployed runtime, same project `ubawkjdbtickdlrgkulz`; local backend also present | Client-safe URL | `/health`: `supabase.urlPresent`, `projectRef`; never print all variables |
| `SUPABASE_ANON_KEY` | Railway **backend** variables | Existing JWT/auth client; needed alongside service client | PRESENT in deployed runtime; **missing in local root backend `.env`** | Public anon/publishable key, not a service key | `/health`: `supabase.anonKeyPresent` |
| `SUPABASE_SERVICE_ROLE_KEY` | Railway **backend only** | Trusted API database access, private upload/read signing, Storage object verification | PRESENT in deployed runtime and local backend; local key successfully read bucket/schema/object metadata | **SECRET** | `/health`: `supabase.serviceRoleKeyPresent`, `serviceRoleClientConfigured`; never reveal the value |
| `SUPABASE_URL` | Android **Dart defines** | Supabase login/session project, same project as backend | Final intended Android build configuration CANNOT BE VERIFIED; no APK built | Client-safe URL | Local checker below; project base URL only, no `/rest/v1` |
| `SUPABASE_ANON_KEY` | Android **Dart defines** | Public Supabase client for login/session | Final intended Android build configuration CANNOT BE VERIFIED | Client-safe public anon/publishable key; **never service-role/secret key** | Local checker verifies role/project without printing it |
| `BACKEND_API_URL` | Android **Dart defines** | Base for `/api/client-deep-cleaning/*`, including authenticated intent/confirmation/submission | Intended future defines CANNOT BE VERIFIED. Existing production API origin responds `/health` and `/ready` 200 | Client-safe URL | Use `https://myqpms-crm-back-end-production.up.railway.app`; `/ready` confirms readiness, not authenticated photo acceptance |

No additional environment variable is required for authenticated photo PUTs. The app obtains a user's access token from `SupabaseService.currentAccessToken`; the backend creates a short-lived signed upload URL, used as a capability. These tokens/URLs are sensitive runtime values, not static environment variables. They must not be logged or committed.

No bucket variable is read: `CLIENT_DEEP_CLEANING_BUCKET` is a **source constant**, not an environment name, fixed to `client-deep-cleaning-uploads`. Do not add `DEEP_CLEANING_BUCKET`, `UPLOAD_TOKEN`, provider credentials or a new storage service. No Cloudinary, S3 or separate image-hosting provider is used by this flow. `GOOGLE_MAPS_API_KEY` exists for other mobile features but is not a Deep Cleaning image-upload requirement; leave its existing setup unchanged.

Existing web configuration is separate: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_URL`, consumed by `src/lib/supabase.js` and `src/services/api.js`. All three are present in the root's local web configuration. Railway frontend build settings cannot be inspected with the current Railway session. No new web variable is introduced here. A backend secret must never receive a `VITE_` prefix.

## Where to configure, step by step

1. Open the existing Supabase project `ubawkjdbtickdlrgkulz`. In its project connection/API settings, obtain the project base URL and **public anon** key. Retain the existing backend service-role key only in secure backend settings. Do not send any key in chat, SQL output, issue/PR bodies or screenshots.
2. Open Railway production and select the **backend service whose public domain is `myqpms-crm-back-end-production.up.railway.app`**, then Variables. Verify the three backend names above. Runtime diagnostics already report all three present, so this audit does not establish that any production value needs changing. Direct Railway variable inspection returned `Not Authorized`; values were not exposed. Changing Railway variables can trigger a deployment: do not save/apply production changes under this source-only authorization.
3. If a local backend will be used, add the same public `SUPABASE_ANON_KEY` to its private `.env` (currently missing there). This is separate from production and Android configuration. Do not copy the service key into Android or web config.
4. Prepare a private Android JSON outside the repository, for example `%USERPROFILE%\.config\myqpms\android.dart-defines.json`. Copy the **structure** of `Mobile_FO_V2/config/deep_cleaning.dart-defines.example.json`, replacing the public-key placeholder locally. It has exactly the three Android names above. Use the approved target backend/project consistently; staging must use matching staging credentials/endpoint, not production credentials against an unrelated backend.
5. Run the read-only configuration checker; this command does **not** build anything:

   ```powershell
   node scripts/checkRetailCleaningConfiguration.mjs --mobile-config "$env:USERPROFILE\.config\myqpms\android.dart-defines.json"
   ```

   It prints presence/error names only and rejects service-role keys, backend secret variables, insecure URLs and mismatched legacy JWT project references. It does not prove key validity or an authenticated upload. A plain `.env` file is not consumed by Flutter's `String.fromEnvironment`; the private file must later be supplied through `--dart-define-from-file` when a build is separately authorized. Do not run any APK build now.
6. In Supabase Storage, inspect the existing `client-deep-cleaning-uploads` bucket. Keep **Private**. The live bucket currently has **no bucket-level MIME/size restrictions**. Backend controls enforce **1..5,242,880 bytes (5 MiB)**, JPEG/PNG/WebP before/after images, and JPEG/PNG/WebP/PDF supporting files. Storage-level restrictions to the same values are recommended for defense in depth and orphan-object cost control; they are bucket settings, not environment variables. No bucket settings or RLS were changed. Review historical file types before any separately authorized restriction change.

## Actual upload/linkage flow

* Android `DeepCleaningService` calls the backend with the current user's bearer JWT, never the service key.
* A scheduled draft is derived atomically from the canonical schedule: schedule ID -> canonical store ID/code/date -> current authorized FO -> actor-owned submission. Caller-supplied actors or store/date replacements cannot authorize it. Historical ad-hoc drafts remain supported.
* The app creates one stable `request_id` per selected local file. `/submissions/:id/upload-url` claims an intent in the existing upload table through a service-only RPC, scoped by submission/request ID. Lost responses and concurrent replays return the same row. Legacy requests without request IDs keep their existing endpoint contract. Retry by `upload_id` renews the same owned intent.
* The generated path remains `deep-cleaning/reliance-retail/<store-code>/<submission-id>/<request-or-upload-id>.<ext>` in the existing private bucket. Schedule linkage remains on the parent submission and executor snapshot, not inferred from a filename.
* Android PUTs bytes to the signed URL. The installed Supabase Storage SDK documents a two-hour upload capability; this is not a custom environment variable. No upsert permission is requested. A retry first checks whether the previous PUT/confirmation already succeeded.
* `/uploads/complete` verifies the issued owner/submission/type/path/size and actual Storage object. Missing, zero, oversized, nonmatching size and available conflicting MIME metadata are rejected. Concurrent confirmation can return the already uploaded row.
* Restored drafts expose incomplete uploads with the existing authorized Remove action. Cancelling a failed local file removes its known server intent, or refreshes the draft to expose an intent whose response was lost. Completion stays disabled until pending evidence is resolved; no historical file is silently deleted.
* The conditional finalizer locks ownership/schedule/draft, verifies store/date/FO, exact private prefix and physical evidence, rejects pending uploads and incomplete before/after pairs, and commits completion/linkage atomically. New RPCs are service-role-only. Old evidence paths, old submissions and historical executor attribution are not rewritten.
* Private view URLs require authorized evidence ownership and expire after ten minutes in the dedicated FO service. A signed URL is not proof of a broader state grant.

## Database reconciliation result

Fresh production REST metadata confirms the existing three canonical tables and their actual columns. `client_deep_cleaning_submissions` has **none** of `schedule_id`, `final_outcome`, `not_done_reason`. Neither the new delivery/submission/upload-intent RPCs nor local migration 214's finalizer are exposed in the service-role schema. Exposure is not proof of full catalog/ACL state. Existing data: **3** dedicated submissions (1 submitted, 2 drafts), **8** uploaded JPEG records; all eight physical object sizes match. Image contents were not downloaded.

`213` is a local table foundation using incompatible `Scheduled`/mandatory-assignee assumptions. Do not apply it over the live canonical schedule table. `214` assumes one draft per schedule and a Scheduled-only finalizer; it would prevent safe reassignment drafts. It must not be applied blindly.

The revised `supabase/proposals/retail_cleaning_delivery_v1.sql` is additive and conditional: three nullable linkage/outcome columns, actor-specific draft uniqueness, one submitted completion per schedule, request-id uniqueness in existing upload metadata, service-only ownership/read/finalization/intent functions. It creates no foundation table, migrates no old evidence, grants no new user scope and changes no RLS policy. It rejects an incompatible existing single-schedule draft index/FK rather than dropping one.

Owner-level PostgreSQL definitions, indexes, constraints, triggers, RLS and Storage grants remain **UNVERIFIED**: no usable owner SQL channel is available, and Railway access is not authorized. The prepared `supabase/verification/retail_cleaning_delivery_read_only.sql` is the remaining read-only check. The proposal refuses installation without an explicit review marker. No production SQL was executed. This is a concrete installation blocker; exposed columns alone cannot certify trigger/permission compatibility.

## Acceptance boundary

Automated synthetic tests cover file types/limits, physical metadata checks, authenticated contracts, request replay, concurrent intent creation, incomplete evidence denial, store/FO/schedule binding, atomic completion and legacy behavior. The branch can be reviewed and CI can run without private production credentials. Nothing in CI builds/distributes an APK or uploads production photographs.

Remaining gates are owner catalog reconciliation, reviewed staging installation of the additive proposal, confirmed private Android defines, and separately authorized authenticated end-to-end upload/device acceptance. Environment variables alone do not install the missing database linkage. **Stop before APK build.**
