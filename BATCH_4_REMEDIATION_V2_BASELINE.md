# DECISION OS — BATCH 4 TARGETED REMEDIATION v2: BASELINE INSPECTION REPORT

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Starting Commit:** `f8fedf03f0b99da7c8a9c8d49b581daf39fc55c9`  
**Date:** 2026-11-05  

---

## 1. Environment & Database Topology Inspection

- **Operating System:** Windows 11 (pwsh environment)
- **Local MongoDB Services Detected:**
  - `mongod.exe` on port `27017` (PID 5340): Standalone MongoDB service (`decision_os`)
  - `mongod.exe` on port `27018` (PID 18192): MongoDB Single-Node Replica Set `rs0` (`--replSet rs0 --port 27018`)
- **Docker Daemon:** Docker Desktop daemon not running locally (`npipe:////./pipe/dockerDesktopLinuxEngine` unavailable). However, native replica set `rs0` is active and healthy on port `27018`, supporting multi-document ACID transactions with snapshot isolation.

---

## 2. Baseline Test Execution Results

### Command Executed:
```bash
npm run test
```
(Invoking `npm run test --workspaces --if-present` across `@decision-os/api`, `@decision-os/web`, and `@decision-os/decision-engine`)

### Baseline Metrics:
| Workspace | Total Test Files | Passed Files | Failed Files | Total Tests | Passed Tests | Failed Tests |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `@decision-os/api` | 29 | 27 | 2 | 401 | 396 | 5 |
| `@decision-os/web` | 18 | 18 | 0 | 166 | 166 | 0 |
| `@decision-os/decision-engine` | 11 | 11 | 0 | 85 | 85 | 0 |
| **Monorepo Total** | **58** | **56** | **2** | **652** | **647** | **5** |

### Failing Test Names in `@decision-os/api`:
1. `tests/collaborationDeliberation.test.ts > Batch 4 Phase 1 — Collaboration, Deliberation & Adoption Lifecycle > Adoption Execution & Engine Recalculation > successfully adopts contribution, updates scores, runs engine, increments version, and audits`
   - **Error:** `AssertionError: expected 500 to be 200`
2. `tests/collaborationDeliberation.test.ts > Batch 4 Phase 1 — Collaboration, Deliberation & Adoption Lifecycle > Adoption Execution & Engine Recalculation > allows partial criterion adoption using selectedCriterionIds`
   - **Error:** `AssertionError: expected 500 to be 200`
3. `tests/collaborationDeliberation.test.ts > Batch 4 Phase 1 — Collaboration, Deliberation & Adoption Lifecycle > Idempotent Adoption Replay > returns original decision with X-Decision-Idempotent-Replay header when re-requesting completed adoption`
   - **Error:** `AssertionError: expected 500 to be 200`
4. `tests/collaborationDeliberation.test.ts > Batch 4 Phase 1 — Collaboration, Deliberation & Adoption Lifecycle > Monotonic Compensation on Calculation Failure > monotonically compensates state (incrementing version) if calculation throws an error`
   - **Error:** `AssertionError: expected 1 to be 3`
5. `tests/contributions.test.ts > Phase 7 — Expert Contributions & Deliberation Lifecycle > Canonical MCDA Engine Protection & Score Adoption > allows owner to explicitly adopt expert scores into decision model, updating MCDA deterministically`
   - **Error:** `AssertionError: expected 500 to be 200`

### Root Cause Analysis of Baseline Test Failures:
- When running `npm run test`, `TEST_MONGODB_URI` was unset in environment.
- Multiple test files (e.g. `collaborationDeliberation.test.ts`, `contributions.test.ts`) defaulted to `'mongodb://127.0.0.1:27017/decision_os_test'`, which targets the **standalone** MongoDB instance.
- In `contribution.service.ts`, `adoptExpertScores` requires a multi-document ACID transaction via `runInTransaction()`.
- `runInTransaction()` asserts replica set support via `assertReplicaSetSupported()`. Against standalone MongoDB, it threw an unhandled configuration error, resulting in HTTP 500.
- When explicitly targeted to the replica set (`mongodb://127.0.0.1:27018/decision_os_test?replicaSet=rs0&directConnection=true`), both test files passed 100% (15/15 and 18/18).
- Furthermore, `recoveryWorker.service.ts`, `operationJournal.repository.ts`, and `decision.service.ts` contained prohibited non-transactional fallback branches (`if (isReplicaSetSupported()) ... else executeWithoutTransaction()`), masking missing transaction guarantees under standalone execution.

---

## 3. Inventory of Key Operation Call Sites

1. **`runInTransaction`**:
   - `apps/api/src/db/connection.ts` (Definition)
   - `apps/api/src/repositories/operationJournal.repository.ts` (line 147, `claimJournalOperation` fallback wrapper)
   - `apps/api/src/services/contribution.service.ts` (line 587, line 634: `adoptExpertScores` transaction & compensation)
   - `apps/api/src/services/decision.service.ts` (line 608: `resolveQuarantine` transaction)
   - `apps/api/src/services/recoveryWorker.service.ts` (line 196: `executeCompensatingRollback` transaction)
   - Test suites: `batch4_adversarial_regression.test.ts` (lines 5, 443, 581)

2. **`claimJournalOperation`**:
   - `apps/api/src/repositories/operationJournal.repository.ts` (Definition)
   - `apps/api/src/services/recoveryWorker.service.ts` (line 553)
   - Test suites: `batch4_adversarial_regression.test.ts` (lines 177, 257, 267), `recoveryConcurrency.test.ts` (lines 176, 177, 205, 211, 218, 240, 263)

3. **`renewOperationLease`**:
   - `apps/api/src/repositories/operationJournal.repository.ts` (Definition)
   - `apps/api/src/services/recoveryWorker.service.ts` (lines 57, 563)
   - Test suites: `batch4_adversarial_regression.test.ts` (line 218), `recoveryConcurrency.test.ts` (line 332)

4. **`transitionJournalState`**:
   - `apps/api/src/repositories/operationJournal.repository.ts` (Definition)
   - `apps/api/src/services/recoveryWorker.service.ts` (lines 308, 383, 447, 497, 526)
   - Test suites: `batch4_adversarial_regression.test.ts` (line 280), `recoveryConcurrency.test.ts` (line 284)

5. **`executeCompensatingRollback`**:
   - `apps/api/src/services/recoveryWorker.service.ts` (Definition, line 85)
   - `apps/api/src/services/recoveryWorker.service.ts` (lines 280, 483, 508)
   - Test suites: `batch4_adversarial_regression.test.ts` (line 5), `recoveryConcurrency.test.ts` (line 424)

6. **`reconcileOperation`**:
   - `apps/api/src/services/recoveryWorker.service.ts` (Definition, line 214)
   - Test suites: `recoveryConcurrency.test.ts` (lines 438, 477)

7. **`markAdopted`**:
   - `apps/api/src/repositories/contribution.repository.ts` (Definition)
   - `apps/api/src/services/contribution.service.ts` (line 649)
   - Test suites: `batch4_adversarial_regression.test.ts` (line 320)

8. **`reject`** / **`rejectContribution`**:
   - `apps/api/src/repositories/contribution.repository.ts` (Definition: `reject`)
   - `apps/api/src/services/contribution.service.ts` (Definition: `rejectContribution`)
   - `apps/api/src/routes/contributions.ts` (line 336)
   - Test suites: `batch4_adversarial_regression.test.ts` (line 297), `collaborationDeliberation.test.ts` (line 120)

9. **`recordEvent`**:
   - `apps/api/src/services/audit.service.ts` (Definition)
   - `apps/api/src/services/contribution.service.ts` (lines 600, 663)
   - `apps/api/src/services/decision.service.ts` (lines 570, 617)
   - `apps/api/src/services/recoveryWorker.service.ts` (lines 173, 432, 470, 532)
   - Test suites: `batch4_adversarial_regression.test.ts`, `recoveryConcurrency.test.ts`, `audit.test.ts`, `performanceRegression.test.ts`, `reproduction.test.ts`

10. **`createNotification`**:
    - `apps/api/src/repositories/outbox.repository.ts` (Definition)
    - `apps/api/src/services/outbox.service.ts` (Definition)
    - `apps/api/src/services/contribution.service.ts` (line 691)
    - `apps/api/src/services/decision.service.ts` (line 590)
    - Test suites: `batch4_adversarial_regression.test.ts` (line 582)

11. **`claimPending`**:
    - `apps/api/src/repositories/outbox.repository.ts` (Definition)
    - `apps/api/src/services/outbox.service.ts` (line 38)
    - Test suites: `batch4_adversarial_regression.test.ts`

12. **`markDelivered`**:
    - `apps/api/src/repositories/outbox.repository.ts` (Definition)
    - `apps/api/src/services/outbox.service.ts` (line 45)

13. **`markFailed`**:
    - `apps/api/src/repositories/outbox.repository.ts` (Definition)
    - `apps/api/src/services/outbox.service.ts` (line 49)

14. **`markQuarantined`**:
    - `apps/api/src/services/recoveryWorker.service.ts` (Definition: line 518; Call sites: lines 242, 272, 285, 502)

15. **`resolveQuarantine`**:
    - `apps/api/src/services/decision.service.ts` (Definition: line 515)
    - `apps/api/src/routes/decisions.ts` (line 263)
    - Test suites: `batch4_adversarial_regression.test.ts` (line 551)

---

## 4. Summary of Identified Defects to Remediate

1. **R1: Standalone Transaction Fallbacks** — Prohibited fallback branches in `recoveryWorker.service.ts`, `operationJournal.repository.ts`, and `decision.service.ts` allow multi-document operations to proceed without transaction guarantees on standalone instances. Must fail closed.
2. **R2: Recovery Fencing & Lease Safety** — Fencing conditions in `bindDecisionLease` allow loose or permissive queries (`recoveryFencingToken <= fencingToken`, null owner races). Must require strict fencing token monotonic equality, database time, and complete atomic lease verification on all protected writes.
3. **R3: Contribution Projection Lifecycle** — `markAdopted` and recovery projection rely only on `status: 'submitted'` without binding to expected contribution revision, decision version, or fencing generation.
4. **R4: Audit Chain Atomicity** — Audit event creation and `Decision.auditHead` advancement do not check compare-and-set result (`matchedCount`), allowing head update failures to silently pass or detach from inserted events.
5. **R5: Durable Outbox Deduplication & Claim Fencing** — Outbox consumer deduplication uses in-memory `Set` that loses state on restart; outbox dispatch leases lack fencing generation checks on acknowledgment/failure.
6. **R6: Test Database Isolation** — Test database naming and cleanup patterns risk collisions across concurrent test runs and do not enforce strict ownership lock.
