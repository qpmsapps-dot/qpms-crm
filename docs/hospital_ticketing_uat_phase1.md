# Hospital Ticketing Phase 1 UAT

Phase 1 uses one canonical `hospital_tickets` record through the shared backend. Local demo identities remain isolated and are enabled only with `HOSPITAL_DEMO_MODE=true`.

## Required compile-time configuration

Both applications must receive the same production-mode Supabase project and backend host. Never commit real keys.

```powershell
flutter build apk --debug --dart-define=SUPABASE_URL=<SUPABASE_PROJECT_URL> --dart-define=SUPABASE_ANON_KEY=<SUPABASE_ANON_KEY> --dart-define=BACKEND_API_URL=<QPMS_BACKEND_URL> --dart-define=HOSPITAL_DEMO_MODE=false
```

For the client release APK, run the same command with `--release`. For `Mobile_FO_V2`, also supply its existing non-hospital build defines where required. Missing Supabase or backend values are treated as configuration errors; demo mode defaults to false.

## Forward migration (later, after review)

This repository keeps the 2.0 migration stream outside the Supabase CLI default migration folder. After review, apply the exact file through the controlled database connection:

```powershell
psql $env:SUPABASE_DB_URL -v ON_ERROR_STOP=1 -f supabase/migrations_2_0/023_hospital_ticket_uat_readiness.sql
```

Review the target hostname and a migration dry-run/staging execution before approving that command. It must not be run directly against production as the first validation.

## Controlled UAT account provisioning (later, after migration)

Dry-run is the default and performs no writes:

```powershell
node backend/scripts/provisionHospitalUatUsers.js
```

Apply requires a secure temporary password and an explicit confirmation guard:

```powershell
$env:HOSPITAL_UAT_TEMP_PASSWORD='<SECURE_TEMPORARY_PASSWORD>'
$env:HOSPITAL_UAT_PROVISION_CONFIRM='true'
node backend/scripts/provisionHospitalUatUsers.js --apply
```

The script refuses production execution unless the separate production confirmation guard is also provided. It never prints the password, token, anon key, or service-role key.

## Non-secret UAT login matrix

| App | Identifier | Role | Scope | Provisioning status |
|---|---|---|---|---|
| Client | doctor.blocka@qpmsdemo.com | Doctor | Block A | Proposed; not provisioned |
| Client | management.blockb@qpmsdemo.com | Hospital Management | Block B | Proposed; not provisioned |
| myQPMS | sup.blocka@qpmsdemo.com | Housekeeping Supervisor | Block A | Proposed; not provisioned |
| myQPMS | sup.blockb@qpmsdemo.com | Housekeeping Supervisor | Block B | Proposed; not provisioned |
| myQPMS | ops.exec@qpmsdemo.com | Operations Executive | UAT hospital | Proposed; not provisioned |
| myQPMS | facility.manager@qpmsdemo.com | Facility Manager | UAT hospital | Proposed; not provisioned |

Temporary polling is a UAT visibility aid, not a substitute for production FCM. Client ticket details and the visible myQPMS hospital module refresh every 20 seconds and stop when disposed, backgrounded, logged out, or the session expires.
