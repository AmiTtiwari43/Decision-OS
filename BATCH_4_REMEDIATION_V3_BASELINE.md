# DECISION OS — BATCH 4 REMEDIATION V3 BASELINE

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline HEAD Commit:** `fccb54b` (`fix(batch4): complete test-first remediation v2 across R1-R6 invariants`)  
**Audit Date:** 2026-11-05  
**Harness / Environment:** Node.js v24+, TypeScript 6.0, Mongoose 9.11, MongoDB 8.3 Replica Set `rs0` (:27018) & Standalone (:27017)

---

## 1. Executive Summary & Defect Inventory

Prior to commencing any source code remediation for Batch 4 V3, an exhaustive inspection of production files, callers, and test suites was conducted. An adversarial baseline reproduction suite (`apps/api/tests/batch4_v3_reproduction.test.ts`) was authored and executed against commit `fccb54b`.

All six target defects have been reproduced and confirmed.

| Defect # | Component / Domain | Exact Production File & Target Method | Severity | Baseline Status |
| :--- | :--- | :--- | :---: | :---: |
| **D1** | Contribution Recovery Fencing | `apps/api/src/services/recoveryWorker.service.ts`<br>`RecoveryWorkerService.reconcileOperation()` (EVALUATED stage) | **CRITICAL** | **CONFIRMED** |
| **D2** | Consistent Lease & Quarantine Fencing | `apps/api/src/repositories/operationJournal.repository.ts`<br>`renewOperationLease()`, `claimJournalOperation()`, `transitionJournalState()` | **HIGH** | **CONFIRMED** |
| **D3** | Durable Consumer Lifecycle & Side Effect Safety | `apps/api/src/services/outbox.service.ts`<br>`OutboxService.deduplicateConsumerEvent()` | **CRITICAL** | **CONFIRMED** |
| **D4** | Atomic Test Database Ownership | `apps/api/src/db/guard.ts`<br>`claimTestDatabaseOwnership()` | **HIGH** | **CONFIRMED** |
| **D5** | Deterministic Concurrency & Standalone Testing | `apps/api/tests/batch4_r1_transactions.test.ts`<br>`batch4_r2_fencing.test.ts`, `recoveryConcurrency.test.ts` | **MEDIUM** | **CONFIRMED** |
| **D6** | Ownership-Fenced Test Cleanup | `apps/api/src/db/guard.ts`<br>`assertCanCleanupTestDatabase()`, `cleanupTestDatabase()` | **HIGH** | **CONFIRMED** |

---

## 2. Comprehensive Defect Analysis

### Defect 1: Recovery Contribution Projection Not Protected by Active Recovery Fencing Generation

- **Exact Production Method & File:**  
  `apps/api/src/services/recoveryWorker.service.ts` — `RecoveryWorkerService.reconcileOperation()` (`currentState === 'EVALUATED'`, lines 378–427).
- **Current Behavior:**  
  In the `EVALUATED` recovery stage, when `journal.action === 'contribution.adopted'`, `DecisionContributionModel.updateOne()` is executed outside of a MongoDB transaction session. The write filter checks only:
  ```typescript
  {
    _id: targetContrib._id,
    decisionId: new mongoose.Types.ObjectId(decisionId),
    status: 'submitted',
    revision: expectedRev,
  }
  ```
  It does not pass a transaction `session`, does not assert that the Decision document remains leased to this worker, and does not check whether this worker's `fencingToken` has been superseded by a takeover.
- **Reproducible Failure Sequence:**  
  1. Worker A claims operation `op-1` with generation 1 (`fencingToken = 1`).
  2. Worker A pauses before the contribution projection write.
  3. Worker A's lease expires; Worker B takes over the operation with generation 2 (`fencingToken = 2`).
  4. Worker A resumes and executes `DecisionContributionModel.updateOne()`.
  5. The contribution is adopted and stamped with Worker A's obsolete `fencingToken = 1`.
  6. Worker B later finds the contribution in `status: 'adopted'` with a mismatched token, leading to race conditions or desynchronization.
- **Expected Invariant:**  
  1. The contribution update must occur inside the same MongoDB multi-document ACID transaction as the associated recovery state transition.
  2. The transaction must use the same session for Decision fencing validation, contribution projection, and journal state transition.
  3. The write must fail closed if the recovery worker's generation has been superseded, the lease has expired, or the decision is quarantined.
  4. A stale worker must not be able to adopt a contribution, even if its revision and status are unchanged.
- **Reproduction Test:**  
  `apps/api/tests/batch4_v3_reproduction.test.ts` — `"demonstrates that stale Worker A can adopt a contribution after Worker B takeover"`.
- **Verdict:** **CONFIRMED**.

---

### Defect 2: Recovery Lease Validation Relies on Application Time & Incomplete Fencing Conditions

- **Exact Production Method & File:**  
  `apps/api/src/repositories/operationJournal.repository.ts` — `renewOperationLease()` (lines 203–247), `claimJournalOperation()` (lines 73–155), `transitionJournalState()` (lines 253–290).  
  `apps/api/src/services/recoveryWorker.service.ts` — `executeCompensatingRollback()` (lines 76–225).
- **Current Behavior:**  
  1. `renewOperationLease(operationId, workerId, fencingToken, leaseDurationMs, decisionId)` updates `OperationJournalModel`. If `decisionId` is supplied, it issues `DecisionModel.updateOne()`, but does **NOT** check `{ auditIntegrityStatus: { $ne: 'quarantined' } }`. Furthermore, it only checks `result.matchedCount === 0` from the journal update; if the Decision update fails or is quarantined, it still returns `true`.
  2. Lease expiration checks rely on application-server clock (`const now = new Date()`) rather than authoritative database server time (`$$NOW`).
  3. In `executeCompensatingRollback()`, the filter on `DecisionContributionModel.updateOne()` uses an `$or` clause matching `{ _id: journalDoc?.auditDraft?.entityId }` which could inadvertently unseat unrelated contributions.
- **Reproducible Failure Sequence:**  
  1. A decision is placed in `quarantined` state due to an integrity failure.
  2. Worker A holds an existing operation journal entry and calls `renewOperationLease(..., decisionId)`.
  3. `renewOperationLease` returns `true` despite the decision being quarantined, allowing the worker to continue attempting mutations against a quarantined decision.
- **Expected Invariant:**  
  1. A worker is valid only if operation ID, owner, fencing token, and lease validity all match.
  2. An expired lease cannot be renewed by its previous owner.
  3. Quarantine invalidates ordinary recovery operations. A successful journal write cannot be treated as proof that the decision write succeeded.
  4. All lease checks should leverage consistent server-side time semantics.
- **Reproduction Test:**  
  `apps/api/tests/batch4_v3_reproduction.test.ts` — `"demonstrates renewOperationLease returns true even when Decision is quarantined"`.
- **Verdict:** **CONFIRMED**.

---

### Defect 3: Consumer Deduplication Can Permanently Suppress External Side Effect After a Crash

- **Exact Production Method & File:**  
  `apps/api/src/services/outbox.service.ts` — `OutboxService.deduplicateConsumerEvent()` (lines 67–86).  
  `apps/api/src/models/outbox.model.ts` — `NotificationConsumerRecordSchema` (lines 83–107).
- **Current Behavior:**  
  `deduplicateConsumerEvent(consumerId, notificationId)` immediately inserts a record into `NotificationConsumerRecordModel` before the external side effect (e.g. sending an email, webhooks, CRM sync) has completed. If the application or worker crashes between record creation and side-effect completion, subsequent retries hit MongoDB error `11000` (duplicate key) and return `false` (duplicate delivery). The side effect is permanently dropped.
- **Reproducible Failure Sequence:**  
  1. Notification arrives for consumer `crm-sync`.
  2. `deduplicateConsumerEvent('crm-sync', 'notif-1')` returns `true`.
  3. Worker crashes before the external HTTP request or side effect can be executed.
  4. The queue or outbox retries delivery of `notif-1`.
  5. `deduplicateConsumerEvent('crm-sync', 'notif-1')` returns `false` (duplicate detected).
  6. The consumer discards the message without executing the side effect. Total side effects executed: 0.
- **Expected Invariant:**  
  1. Durable consumer processing lifecycle supporting states: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`.
  2. Atomic claim with lease expiration and generation fencing.
  3. Side effects executed during active lease; completion marked ONLY upon side-effect success.
  4. Crashes prior to completion permit safe retry (at-least-once delivery).
- **Reproduction Test:**  
  `apps/api/tests/batch4_v3_reproduction.test.ts` — `"demonstrates deduplicateConsumerEvent permanently drops side effect if crash occurs before execution"`.
- **Verdict:** **CONFIRMED**.

---

### Defect 4: Test Database Ownership Acquisition Is a Read-Then-Upsert Race

- **Exact Production Method & File:**  
  `apps/api/src/db/guard.ts` — `claimTestDatabaseOwnership()` (lines 137–168).
- **Current Behavior:**  
  `claimTestDatabaseOwnership` queries `metaCol.findOne({ _id: 'ownership_lock' })`. If not found, it performs an upsert:
  ```typescript
  await metaCol.updateOne(
    { _id: 'ownership_lock' },
    { $set: { runId, workerId, claimedAt: new Date() } },
    { upsert: true }
  );
  ```
  Two concurrent test runners or parallel vitest workers reading simultaneously both see `null` and both proceed to write. The second write silently overwrites the first without an atomic conflict.
- **Reproducible Failure Sequence:**  
  1. Process 1 and Process 2 concurrently start and point to the same database.
  2. Both execute `findOne()`, both receive `null`.
  3. Process 1 writes `runId: 'run-1'`.
  4. Process 2 writes `runId: 'run-2'` with `upsert: true`.
  5. Process 2 succeeds silently, corrupting Process 1's ownership metadata.
- **Expected Invariant:**  
  1. Atomic ownership protocol.
  2. Claim must be executed as an atomic conditional write (e.g. `findOneAndUpdate` or conditional `updateOne` with filter requiring absence of lock or exact matching `runId` and `workerId`).
  3. Exactly one claimant must succeed. The loser must throw an isolation error without altering the winner's record.
- **Reproduction Test:**  
  `apps/api/tests/batch4_v3_reproduction.test.ts` — `"demonstrates two concurrent claimants can overwrite ownership without atomic conflict"`.
- **Verdict:** **CONFIRMED**.

---

### Defect 5: Concurrency Tests Rely on Timing-Based Sleeps & Standalone Tests Silently Pass When Standalone MongoDB Is Unavailable

- **Exact Production Method & File:**  
  `apps/api/tests/batch4_r1_transactions.test.ts` (lines 49–129).  
  `apps/api/tests/batch4_r2_fencing.test.ts` (line 140).  
  `apps/api/tests/recoveryConcurrency.test.ts` (lines 214, 242, 266, 348, etc.).
- **Current Behavior:**  
  1. In `batch4_r1_transactions.test.ts`, tests guard with `if (!standaloneConnected) return;`. In Vitest, returning from a test without asserting counts as passing (`✓`). When standalone MongoDB is absent, 7 standalone fail-closed tests pass silently without exercising any code.
  2. In `batch4_r2_fencing.test.ts` and `recoveryConcurrency.test.ts`, tests wait for lease expiration using arbitrary sleeps (`await new Promise((resolve) => setTimeout(resolve, 80));`).
- **Reproducible Failure Sequence:**  
  1. Standalone port 27017 is stopped.
  2. `npm test` is run.
  3. `batch4_r1_transactions.test.ts` passes 10/10 tests, claiming standalone rejection was verified when it was never executed.
  4. Concurrency tests run on loaded CI systems where 80ms sleep is insufficient or flake-prone.
- **Expected Invariant:**  
  1. Missing standalone prerequisites must either explicitly fail the suite or be clearly registered as skipped (`it.skip`), never counted as passing verification.
  2. Lease expiration tests must be deterministic (e.g. setting database `leaseExpiresAt` to a past timestamp or using deterministic synchronization barriers).
- **Reproduction Test:**  
  `apps/api/tests/batch4_v3_reproduction.test.ts` — `"demonstrates that if (!connected) return silently marks tests passed in Vitest"`.
- **Verdict:** **CONFIRMED**.

---

### Defect 6: Test Cleanup Paths Do Not Consistently Enforce Ownership-Fenced Deletion

- **Exact Production Method & File:**  
  `apps/api/src/db/guard.ts` — `assertCanCleanupTestDatabase()` (lines 174–205), `cleanupTestDatabase()` (lines 210–219).
- **Current Behavior:**  
  `assertCanCleanupTestDatabase(connection, expectedRunId)` checks only `lock.runId !== expectedRunId`. It completely ignores `workerId`. Parallel workers sharing a `runId` can drop or mutate each other's databases. Furthermore, the check and the drop are separate non-atomic steps.
- **Reproducible Failure Sequence:**  
  1. Database is owned by `{ runId: 'run-1', workerId: 'worker-1' }`.
  2. Worker 2 calls `cleanupTestDatabase(connection, 'run-1')`.
  3. The cleanup succeeds and drops Worker 1's active database.
- **Expected Invariant:**  
  1. Test cleanup must be worker-isolated and require exact ownership identity matching (`runId` AND `workerId`).
  2. Non-test databases and missing ownership locks must always fail closed.
  3. Destructive operations must be gated by verified ownership validation.
- **Reproduction Test:**  
  `apps/api/tests/batch4_v3_reproduction.test.ts` — `"demonstrates assertCanCleanupTestDatabase allows Worker 2 to clean Worker 1 database"`.
- **Verdict:** **CONFIRMED**.

---

## 3. Baseline Sign-Off

The baseline defect reproduction suite has been executed and confirmed against commit `fccb54b`. All six defects are clearly defined with unambiguous invariants. Proceeding to Phase B (Contribution Recovery Fencing).
