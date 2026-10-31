# Reliance Retail MIS operating guide

Use your existing authorized account. Available stores, states and actions follow its existing permissions. Read-only previews do not save operational records. Production authenticated acceptance remains **PENDING**; local workflow tests are not production sign-off.

| Page | Daily use |
| --- | --- |
| Dashboard | Select the reporting month and state. Open the relevant module for details. Unavailable totals are not zero. |
| Attendance | Select Month-to-Date or Daily View, cutoff date and state. Review HK/MEPC credits and approved AOP coverage. Missing coverage or AOP leaves percentages N/A. Export the filtered report. Upload Day Attendance is available only under existing upload permission; importing requires its separate confirmation. |
| Deep Cleaning | Select period, store and status; use **Schedule Deep Cleaning** to submit a schedule request. Follow the approval steps below. Review submitted work and **View evidence**; export matching schedules and submissions. |
| HK & MEPC Training | Filter completed sessions by date, class, state, store, Zone or FO. Open a session to review attendees, topics and available evidence. Training submission remains in the existing authorized FO workflow. |
| CM/PM | Select month, CM or PM, and a permitted store; choose **Record CM Call** or **Record PM Call**, then **Confirm save**. Refresh and confirm the completed row. Export monthly state/store reports. |
| Thermography | Select store and scheduled date, choose **Schedule Thermography**, then confirm. On or after the scheduled date, use **Record completion** and confirm. After client approval, use **Record client approval** and confirm. Review due dates and overdue/late status. |
| Fault Tracker | Use the existing Fault Tracker; filter state, store, stage and date, then export scoped tickets. The last production read-only reconciliation found 680 eligible tickets in the latest 2,979-ticket import. Additional user scope can reduce that number. Source tickets are retained. |

## Deep Cleaning: request to reporting

1. Choose **Schedule Deep Cleaning**, a permitted active store, date and approval reference/reason. **Submit schedule request** saves a proposal, not an active schedule.
2. An existing independent reviewer opens **Store Master → Unified Management → AOP & Approvals**, reviews the `DC_SCHEDULE` request and records the approval reference. The proposer cannot approve their own request.
3. An authorized Admin applies the approved request through the existing workflow. If the operational apply gate is closed, stop and request the established authorization. Do not change permissions or gates to complete a demo.
4. The assigned FO uses the existing Deep Cleaning submission flow to select the store/date, record the work, upload at least one before image and one after image, and submit. No new desktop completion or upload shortcut is introduced.
5. Refresh the Deep Cleaning report for that period. A submitted completion for the same store/date is matched to its schedule. View its evidence. **Remaining = Scheduled − Completed**, excluding cancelled schedules; overdue pending work is not automatically marked Not Completed.

## Date rules and successful saves

- CM is open on days 1–15; PM on day 16 through month-end, using the server's India date. Previous months are locked. A store/kind/month can have only one completed call; completion is immutable.
- Thermography progresses **Scheduled → Completed → Client Approved**. Approval is due 10 calendar days after the actual completion date. The due date is on time; overdue begins the following day. Late approval stays marked late.
- Confirmations send authenticated backend requests. Success is shown only after the request succeeds; a schedule-request receipt still requires independent approval/application. If Save fails, retain the error and do not assume the record was saved. Refresh and verify the row/status; do not reimport source data.
- Private evidence links remain permission-checked and temporary. Missing evidence is shown as missing. Admin source reconciliation is collapsed and hidden from normal MIS pages.

## Verification boundary

CM/PM and Thermography persistence, date locks, duplicate prevention, actor/state restrictions and audit history are verified in disposable PostgreSQL. The Deep Cleaning proposal/apply/report-matching subtest passed in isolated PostgreSQL without rewriting submissions. The broader legacy Unified suite did not pass: its original 854-row source workbook is unavailable and dependent tests failed. FO submission/evidence validation and schedule/report matching have focused service tests. No production write, account creation, permission change or release acceptance is implied. Production Admin/restricted-role/hierarchy/evidence checks remain **PENDING**.
