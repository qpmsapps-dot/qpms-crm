# Training PR #126: remaining release checklist
27 November 2026. Candidate 65b5d3ce. **NO-GO until the unchecked items below are completed and separately approved.**

Use the already verified 27-employee inventory and resolved profile/Auth IDs. Do not repeat the inventory audit. The earlier resolved CSV remains the approval artifact; it did not include names, and historical UUID parity was not certified.

## Owner: database and Storage recovery
- [ ] Open the correct Supabase production project (ubawkjdbtickdlrgkulz), Database > Backups. Record the latest successful backup timestamp/status and project-specific retention. If PITR is already enabled, record its actual earliest/latest recovery points. Do not buy/enable an upgrade or click Restore.
- [ ] Confirm the available restore procedure, authorized recovery operator and acceptable data-loss/downtime window. Keep a screenshot or export of this evidence.
- [ ] Separately confirm a recoverable backup of the private training-evidence **file bytes**, including paths, sizes/checksums, backup location/date, retention and recovery procedure. Database object metadata is insufficient. Last measured catalog snapshot was 27 objects / 59,248,559 bytes; this is historical reconciliation evidence, not proof of a backup or today's object inventory.
- [ ] If no verified current DB recovery point and matching independent Storage backup cover the approved loss window, arrange an additional pre-migration backup under separate authorization. Until you confirm otherwise, treat this as required. A second full DB backup is not automatically necessary if an existing verified PITR/recovery point meets the approved window, but Storage recoverability still needs independent evidence.

Provider guidance: https://supabase.com/docs/guides/platform/backups . Published daily retention is Pro 7 days, Team 14, Enterprise up to 30; the project's actual plan/PITR retention is **not verified** here. DB backup does not include Storage object contents.

## Owner: authenticated HK smoke check (read-only)
Web:
1. Sign into your existing approved myQPMS account in your normal browser. Open Reliance Retail > Training, or /reliance-retail/training. For an existing HK-MIS account, use its current HK Training workspace; do not grant a new role.
2. Select HK and a date range containing an existing authorized submitted report (for the earlier snapshot, 1 September–27 November 2026 covers the observed sessions). Apply only your currently authorized region/store scope.
3. Record the report ID, store, date, trainer, topics, remarks and totals. Open its detail drawer and an existing photograph/completion document. Verify the evidence belongs to that report and another unauthorized scope is not exposed.
4. Download the existing filtered report; compare it with the visible records. Record PASS/FAIL and any exact error. Do not upload, edit, delete or submit.

Mobile:
1. Use the already installed approved app and your existing FO sign-in. Record app version.
2. Open an **existing submitted** Training report through the current report/history or relevant historical visit entry. Select that report in Training reports. Do not select Create new Training, start attendance, check in or resume an editable draft for this smoke test.
3. Verify store/date/trainer/topics/remarks and existing photographs/completion proof. Confirm the submitted record is view-only.
4. If existing submitted history is unavailable, stop that check and report unavailable; do not create operational context. Opening a draft can trigger saves/synchronization and is not part of this read-only test.

Record the same checks before migration, during old-backend/new-DB transition, and after automatic rollout. No new production submission is authorized.

## Coordinated change window — separate approvals required
- [ ] Release owner approves exact candidate, existing resolved HK roster and recovery evidence; verify current baseline has not drifted at the authorized window.
- [ ] Complete isolated old-deployed-backend (696a9792) / proposed-DB transition acceptance. Existing source review and native fixtures support compatibility; a complete deployed-backend integration run and authenticated production transition acceptance remain unverified.
- [ ] DBA receives explicit production SQL approval and applies only the reviewed migration transaction, stop-on-error. No historical replay or pin bypass.
- [ ] Before merge: verify exact approved HK backfill recipients, zero MEPC grants, Web gate false/backdate zero, preserved historical rows/evidence/policies and HK read-only smoke checks.
- [ ] Obtain separate merge/deployment approval for PR #126. Railway services track main; treat merge as automatic deployment admission. Do not deploy the new backend before its database contract.
- [ ] Verify both Railway deployed SHAs, successful health and repeated authenticated HK checks. Keep MEPC permissions/Web admission disabled.
- [ ] If transaction fails before COMMIT: rollback and stop. After COMMIT, the existing compensating SQL only disables Web/backdating; it is not a complete HK rollback. Retain a compatible backend and all data. Any corrective release or coordinated DB/Storage restore requires separate approval and a named operator.

Phase 3 UI development is on a separate local branch and is excluded from PR #126's approved candidate. No migration, merge, live permission change, deployment or APK release is authorized by this checklist.
