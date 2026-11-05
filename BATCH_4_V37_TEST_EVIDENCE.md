# DECISION OS — BATCH 4 V3.7 TEST EVIDENCE
## Comprehensive Test Execution Logs, Exit Codes & Adversarial Verification

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit:** `786ba38d6b6a32f0487d65896cd0b686cc47379e`  
**Date:** 2026-11-05  
**Status:** ALL TESTS PASSED — 0 FAILURES — 100% PASS RATE  

---

## 1. Summary of Test Execution Across All Workspaces

| Test Suite / Scope | Command | Files Passed | Tests Passed | Tests Failed | Duration | Exit Code |
|---|---|---|---|---|---|---|
| **API Workspace (Full)** | `npm run test:api` | 51 / 51 | 643 / 643 | 0 | 624.31s | 0 |
| **Decision Engine** | `npm run test:engine` | 11 / 11 | 85 / 85 | 0 | 3.94s | 0 |
| **Web Frontend** | `npm run test:web` | 18 / 18 | 166 / 166 | 0 | 6.21s | 0 |
| **V3.7 Adversarial Suite** | `npx vitest run apps/api/tests/batch4_v37_supervised_cleanup.test.ts` | 1 / 1 | 24 / 24 | 0 | 6.82s | 0 |
| **V3.7 Reproduction** | `npx vitest run apps/api/tests/batch4_v37_reproduction.test.ts` | 1 / 1 | 2 / 2 | 0 | 0.69s | 0 |
| **Typecheck** | `npm run typecheck` | All workspaces | Clean | 0 | 5.12s | 0 |
| **Lint** | `npm run lint` | All workspaces | Clean (0 errs, 0 api warns) | 0 | 0.41s | 0 |
| **Build** | `npm run build` | All workspaces | Clean | 0 | 6.35s | 0 |

---

## 2. V3.7 Supervised Cleanup Adversarial Suite (D37-01 to D37-24)

Command:
```bash
npx vitest run apps/api/tests/batch4_v37_supervised_cleanup.test.ts
```

Output:
```
 RUN  v4.1.12 C:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main

 ✓ apps/api/tests/batch4_v37_supervised_cleanup.test.ts (24 tests) 6816ms
     ✓ D37-01: Authorized cleanup request is accepted and completes cleanly  355ms
     ✓ D37-02: Duplicate request ID completes idempotently without second dispatch  344ms
     ✓ D37-03: Cleanup request with wrong run ID is rejected fail-closed  318ms
     ✓ D37-04: Cleanup request with wrong worker ID is rejected fail-closed  331ms
     ✓ D37-05: Stale cleanup generation is rejected fail-closed  593ms
     ✓ D37-06: Missing coordination registry record fails closed without dispatch  582ms
     ✓ D37-07: Cleanup request on production database is rejected fail-closed  298ms
     ✓ D37-08: Two workers submitting simultaneously: exactly one authorized execution  357ms
     ✓ D37-09: Worker losing lease before submission is rejected immediately  370ms
     ✓ D37-10/D37-16: Stale worker/executor loses authority during boundary pause; drop blocked  348ms
     ✓ D37-11: Direct dropDatabase() on worker handle is capability-denied  319ms
     ✓ D37-12: Pre-dispatch crash recovers cleanly on retry with same identity  456ms
     ✓ D37-13: Crash after dispatch leaves lock intact; foreign worker cannot claim  367ms
     ✓ D37-14: Lost MongoDB response transitions to OUTCOME_UNKNOWN without false success  313ms
     ✓ D37-15: Executor restart with OUTCOME_UNKNOWN requires reconciliation before redispatch  337ms
     ✓ D37-16: Old executor attempts to resume after replacement; second command blocked  326ms
     ✓ D37-17: Expired executor lease cannot acquire drop lock while old process is alive  341ms
     ✓ D37-18: Host identity mismatch is rejected fail-closed  322ms
     ✓ D37-19: Cross-host takeover is rejected fail-closed  378ms
     ✓ D37-20: Repeated cleanup on CLEANED database returns idempotently without error  355ms
     ✓ D37-21: Registry changes during lock transition aborts request safely  550ms
     ✓ D37-22: Concurrent cleanup requests serialize cleanly  359ms
     ✓ D37-23: Crash during completion persistence recovers via 0 collections check  329ms
     ✓ D37-24: Administrative reconciliation safely reconciles and audits cleanup  499ms

 Test Files  1 passed (1)
      Tests  24 passed (24)
   Duration  6.82s
```

---

## 3. Full API Test Suite Execution Output

Command:
```bash
npm run test:api
```

Summary:
```
> decision-os-monorepo@1.0.0 test:api
> npm run test --workspace=@decision-os/api

> @decision-os/api@1.0.0 test
> vitest run --fileParallelism=false

 RUN  v4.1.12 C:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/apps/api

 ✓ tests/batch4_v33_adversarial.test.ts (28 tests) 6878ms
 ✓ tests/batch4_v34_cleanup_recovery.test.ts (18 tests) 4687ms
 ✓ tests/batch4_v33_reproduction.test.ts (5 tests) 3095ms
 ✓ tests/evidence.test.ts (30 tests) 92112ms
 ✓ tests/ai.test.ts (25 tests) 86879ms
 ✓ tests/audit.test.ts (27 tests) 54101ms
 ✓ tests/batch4_adversarial_regression.test.ts (12 tests) 24849ms
 ✓ tests/calibration.test.ts (18 tests) 34510ms
 ✓ tests/collaboration.test.ts (20 tests) 31405ms
 ✓ tests/contributions.test.ts (20 tests) 27104ms
 ✓ tests/batch4_v35_cleanup_fencing.test.ts (24 tests) 7102ms
 ✓ tests/batch4_v37_supervised_cleanup.test.ts (24 tests) 6914ms
 ✓ tests/batch4_v36_cleanup_executor_fencing.test.ts (16 tests) 5122ms
 ✓ tests/batch4_r4_audit.test.ts (11 tests) 3301ms
 ✓ tests/batch4_r3_contribution.test.ts (9 tests) 4263ms
 ✓ tests/batch4_r5_outbox.test.ts (7 tests) 1997ms
 ✓ tests/batch4_v3_remediation.test.ts (16 tests) 3036ms
 ✓ tests/batch4_r6_isolation.test.ts (8 tests) 2653ms
 ✓ tests/batch4_r2_fencing.test.ts (5 tests) 866ms
 ✓ tests/batch4_v3_reproduction.test.ts (6 tests) 901ms
 ✓ tests/batch4_v31_reproduction.test.ts (5 tests) 755ms
 ✓ tests/batch4_v37_reproduction.test.ts (2 tests) 693ms
 ✓ tests/batch4_v32_reproduction.test.ts (4 tests) 758ms
 ✓ tests/batch4_r1_transactions.test.ts (10 tests) 584ms
 ✓ tests/batch4_v35_reproduction.test.ts (2 tests) 603ms
 ✓ tests/batch4_v34_reproduction.test.ts (1 test) 500ms
 ✓ tests/batch4_v36_reproduction.test.ts (1 test) 416ms
 ✓ tests/integration/connection.test.ts (4 tests) 144ms
 ✓ tests/models.test.ts (20 tests) 26ms
 ✓ tests/env.test.ts (13 tests) 29ms
 ✓ tests/dbGuard.test.ts (12 tests) 21ms

 Test Files  51 passed (51)
      Tests  643 passed (643)
   Duration  624.31s
```

---

## 4. Decision Engine Suite Execution Output

Command:
```bash
npm run test:engine
```

Output:
```
> @decision-os/decision-engine@1.0.0 test
> vitest run

 RUN  v4.1.12 C:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/packages/decision-engine

 ✓ tests/golden.test.ts (10 tests) 92ms
 ✓ tests/disagreement.test.ts (12 tests) 110ms
 ✓ tests/characterization-compat.test.ts (8 tests) 48ms
 ✓ tests/validation.test.ts (13 tests) 70ms
 ✓ tests/sensitivity.test.ts (3 tests) 38ms
 ✓ tests/normalization.test.ts (7 tests) 43ms
 ✓ tests/counterfactual.test.ts (9 tests) 1954ms
 ✓ tests/ties.test.ts (3 tests) 38ms
 ✓ tests/metadata.test.ts (4 tests) 22ms
 ✓ tests/calibration.test.ts (13 tests) 14ms
 ✓ tests/monteCarlo.test.ts (3 tests) 12ms

 Test Files  11 passed (11)
      Tests  85 passed (85)
   Duration  3.94s
```

---

## 5. Web Frontend Suite Execution Output

Command:
```bash
npm run test:web
```

Output:
```
> @decision-os/web@0.0.0 test
> vitest run

 RUN  v4.1.12 C:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/apps/web

 ✓ src/tests/evidenceIntegration.test.ts (5 tests) 96ms
 ✓ src/tests/dashboardIntegration.test.ts (14 tests) 158ms
 ✓ src/tests/batch3Integration.test.ts (20 tests) 138ms
 ✓ src/tests/calibrationIntegration.test.ts (5 tests) 76ms
 ✓ src/tests/disagreementsIntegration.test.ts (7 tests) 89ms
 ✓ src/tests/batch3Remediation.test.ts (16 tests) 113ms
 ✓ src/tests/authIntegration.test.ts (15 tests) 92ms
 ✓ src/api/client.test.ts (14 tests) 111ms
 ✓ src/tests/decisionIntegration.test.ts (8 tests) 84ms
 ✓ src/tests/contributionsIntegration.test.ts (7 tests) 65ms
 ✓ src/tests/collaborationIntegration.test.ts (8 tests) 74ms
 ✓ src/tests/aiIntegration.test.ts (5 tests) 71ms
 ✓ src/tests/analyticsIntegration.test.ts (5 tests) 69ms
 ✓ src/tests/auditExportIntegration.test.ts (5 tests) 68ms
 ✓ src/tests/sharingIntegration.test.ts (7 tests) 69ms
 ✓ src/utils/characterization.test.ts (16 tests) 39ms
 ✓ src/utils/decisionEngine.test.ts (6 tests) 14ms
 ✓ src/utils/engineMapper.test.ts (3 tests) 11ms

 Test Files  18 passed (18)
      Tests  166 passed (166)
   Duration  6.21s
```
