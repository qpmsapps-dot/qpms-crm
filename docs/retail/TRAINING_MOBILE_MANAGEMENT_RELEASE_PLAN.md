# Management Training mobile release candidate checklist

27 November 2026. Preparation only; no APK build, installation, distribution, production SQL, permission activation, merge or deployment is authorized.

## APK identity prerequisite

- User-confirmed historical local audit: version **1.0.27**, build **27**, application ID **in.co.qpms.myqpms_fo_v2**. This is not independent confirmation of the currently distributed APK.
- Before a separately approved build/release, the release owner must provide the canonical distribution artifact or authorized MDM/device inventory. Record distribution channel/date, artifact SHA-256, package, versionName, numeric versionCode and signing-certificate SHA-256.
- Use read-only `apkanalyzer manifest application-id`, `apkanalyzer manifest version-name`, `apkanalyzer manifest version-code` and `apksigner verify --print-certs` on that supplied APK, or authorized `adb shell dumpsys package in.co.qpms.myqpms_fo_v2` plus the managed artifact's signer evidence. Do not install an APK to establish the baseline.
- Compare against the existing trusted signer and all supported installed versionCodes. Select a strictly greater versionCode only after verification. Preserve package/signing configuration and local SQLite/offline data. Repository pubspec, a historical artifact name or version 27 alone does not establish a safe upgrade baseline.

## Coordinated dependency and rollout sequence

1. Complete the already documented owner backup/recovery and authenticated HK acceptance checklist for PR #126. Reuse the approved inventory; do not repeat the entire production audit.
2. Obtain separate approval for PR #126's migration/merge/deployment sequence. Keep category grants and Web admission at their approved disabled state; no automatic MEPC assignments.
3. After the dependency is integrated, retarget/rebase PR #129 onto the approved updated main, renew exact integrity pins and verify all CI checks. A stacked green PR is not permission to merge it first.
4. Obtain separate approval for the additive `20261127120000_training_mobile_management_provenance.sql` migration. Verify exact installed V2 editor baseline, backups and recovery first. Apply once, transactionally, with **mobile_management_enabled=false** and **web_enabled=false**. Verify original HK draft/evidence/submission behavior before any app rollout.
5. After separate merge approval, allow the normal Railway deployment workflow to publish the reviewed backend/Web candidate. Do not manually deploy. Verify health, commit provenance, disabled gates and read-only HK smoke results. Old mobile/FO/HK clients continue through the unchanged FO contract; the new editor executes the preserved V2 implementation first.
6. Obtain explicit APK build authorization only after distributed-version and signer verification. Build from the reviewed immutable candidate, without changing the signer or package. An APK build approval would not authorize installation, distribution or gate activation.
7. Use an isolated staging environment and synthetic authorized identities for physical-device testing: MIS direct entry/no FO modules; OM preserved workspace; today/IST boundary; trainer/uploader distinction; explicit region/zone/store/business boundaries; camera/gallery permission denial/retry; JPEG/PNG/PDF validation; lost creation and upload/submit responses; app restart; read-only submitted reports; HK-only/MEPC-only/both/no-category FO cases; Branch Head reporting-only.
8. Production acceptance and any mobile-management/Web gate activation, individual FO MEPC permissions, APK installation or distribution each need separate approval. Until then both gates remain disabled and no production test submissions are permitted.

## Compensating rollback

Use the separately approved [mobile gate rollback](../../supabase/proposals/training_mobile_management_rollback.sql): disable mobile-management admission first, then revert only the newly deployed application candidate through the approved release process. Do not delete sessions, events, evidence, entitlements or historical policy snapshots, and do not replay PR #126's migration. Leave the preserved editor wrapper/provenance in place while records exist. Web/HK rollback decisions remain separately governed by PR #126's approved procedure.

Release is **NO-GO** until dependency/migration approvals, recovery/HK acceptance, distributed APK version/signer evidence and physical-device acceptance are complete. This does not block isolated development or draft PR review.
