# AGENTS.md

Permanent instructions for AI coding agents working on the internal QPMS / myQPMS project.

## Project Context

- Product name: myQPMS
- Web dashboard: React
- Backend: Node/Express
- Mobile app: Flutter under `Mobile_FO_V2`
- Database/Auth: Supabase
- Hosting: Railway
- Main sensitive areas:
  - FO attendance
  - GPS tracking
  - KM calculation
  - Petrol conveyance
  - Site visits
  - Operations Command Center
  - User Management
  - Store Master

## Strict Rules

1. Do not build APK unless explicitly asked.
2. Do not run `flutter build apk` or any release/debug APK build command.
3. Do not change `Mobile_FO_V2` unless the task clearly says mobile.
4. Do not change `backend/server.js`, database schema, Supabase migrations, RLS policies, or API logic unless explicitly asked.
5. Do not touch Operations Command Center / `FOActivities.jsx` logic unless the task specifically mentions it.
6. For web-only tasks, change only React frontend files.
7. For UI-only tasks, do not change backend, database, Supabase, auth, GPS, KM, attendance, route, site visit, petrol, or payroll logic.
8. Keep all changes minimal and targeted.
9. Do not remove existing working logic.
10. Do not rename files, move folders, or restructure the project unless asked.
11. Before coding, inspect the relevant files and explain the current behavior.
12. After coding, always report:
    - Files changed
    - What changed
    - What was not touched
    - Tests/checks done
    - Risks or assumptions
13. If the task is unclear, ask before changing code.
14. For read-only audit tasks, do not modify files.
15. Do not commit or push unless explicitly asked.
