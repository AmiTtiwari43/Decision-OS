# DECISION OS — BATCH 4 REMEDIATION V3 DEFECT MATRIX

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Date:** 2026-11-05  
**Version:** V3 Closure  

---

## 1. Overview & Traceability Matrix

This defect matrix provides an exhaustive mapping of all six identified Batch 4 reliability defects to their root causes, remediated production files, architectural repairs, verification test suites, and regression prevention invariants.

| Defect ID | Defect Domain | Severity | Primary Production File(s) | Remediation Status | Verification Test Suite |
| :--- | :--- | :---: | :--- | :---: | :--- |
| **D1** | Recovery Contribution Projection Fencing | **CRITICAL** | `apps/api/src/services/recoveryWorker.service.ts` | **REMEDIATED** | `batch4_v3_remediation.test.ts` (Scenarios 1–5)<br>`batch4_v3_reproduction.test.ts` (Test 1) |
| **D2** | Consistent Server-Side Lease & Quarantine Fencing | **HIGH** | `apps/api/src/repositories/operationJournal.repository.ts`<br>`apps/api/src/services/recoveryWorker.service.ts` | **REMEDIATED** | `batch4_v3_remediation.test.ts` (Phase C tests)<br>`batch4_v3_reproduction.test.ts` (Test 2) |
| **D3** | Durable Consumer Lifecycle & Side Effect Safety | **CRITICAL** | `apps/api/src/models/outbox.model.ts`<br>`apps/api/src/models/outbox.types.ts`<br>`apps/api/src/services/outbox.service.ts` | **REMEDIATED** | `batch4_v3_remediation.test.ts` (Phase D tests)<br>`batch4_v3_reproduction.test.ts` (Test 3) |
| **D4** | Atomic Test Database Ownership | **HIGH** | `apps/api/src/db/guard.ts` | **REMEDIATED** | `batch4_v3_remediation.test.ts` (Phase E tests)<br>`batch4_v3_reproduction.test.ts` (Test 4) |
| **D5** | Deterministic Concurrency & Standalone Testing | **MEDIUM** | `apps/api/tests/batch4_r1_transactions.test.ts`<br>`apps/api/tests/batch4_r2_fencing.test.ts`<br>`apps/api/tests/recoveryConcurrency.test.ts` | **REMEDIATED** | `batch4_r1_transactions.test.ts`<br>`batch4_r2_fencing.test.ts`<br>`batch4_v3_reproduction.test.ts` (Test 5) |
| **D6** | Ownership-Fenced Test Cleanup | **HIGH** | `apps/api/src/db/guard.ts` | **REMEDIATED** | `batch4_v3_remediation.test.ts` (Phase F tests)<br>`batch4_v3_reproduction.test.ts` (Test 6) |

---

## 2. Detailed Defect-by-Defect Resolution

### Defect D1: Recovery Contribution Projection Not Protected by Active Recovery Fencing Generation

- **Root Cause:**  
  In `RecoveryWorkerService.reconcileOperation()` under the `EVALUATED` stage, the contribution status projection (`DecisionContributionModel.updateOne`) was performed:
  1. Without passing the active MongoDB ClientSession (outside the transaction).
  2. Without querying or enforcing the Decision's active `recoveryFencingToken`, `recoveryOwner`, or lease expiration.
  3. Without recording adoption idempotency on the contribution itself.
  Consequently, if Worker A paused before updating the contribution and Worker B took over the operation with a higher fencing generation, Worker A would awaken and overwrite the contribution with stale generation metadata.
- **Production Files Modified:**  
  - `apps/api/src/services/recoveryWorker.service.ts`:
    - Refactored `EVALUATED`, `COMMITTED`, `AUDITED`, and `COMPENSATING` stages to execute inside `runInTransaction(connection, async (session) => { ... })`.
    - Added atomic Decision lease validation filter matching:
      - `_id: decisionId`
      - `version: expectedDecisionVersion`
      - `pendingOperationId: operationId`
      - `recoveryFencingToken: fencingToken`
      - `recoveryOwner: workerId`
      - `auditIntegrityStatus: { $ne: 'quarantined' }`
      - `$expr: { $gt: ['$recoveryLeaseExpiresAt', '$$NOW'] }`
    - Added atomic contribution update predicate matching:
      - `_id: targetContrib._id`
      - `decisionId: decisionId`
      - `status: 'submitted'`
      - `revision: expectedRev`
    - Added idempotent adoption check: if `status === 'adopted'` and `adoptedOperationId === operationId`, projection is safely treated as idempotent success.
    - Propagated `session` across all writes: Decision verification, contribution adoption, operation journal transition, and outbox event creation.
- **Verification Test Evidence:**  
  - `apps/api/tests/batch4_v3_remediation.test.ts`:
    - `Scenario 1: Worker A (gen 1) paused -> Worker B takes over (gen 2) -> Worker A projection aborts, Worker B completes` (PASSED).
    - `Scenario 2: Contribution rejection between Worker A pause and resume -> Worker A aborts` (PASSED).
    - `Scenario 3: Contribution withdrawal and resubmission (rev increment) -> Worker A aborts` (PASSED).
    - `Scenario 4: Compensation restores contribution to submitted -> stale worker projection aborts` (PASSED).
    - `Scenario 5: Quarantine occurs before projection -> Worker A projection aborts` (PASSED).
    - `Scenario 6: Idempotent recovery when contribution already adopted by same operation -> succeeds` (PASSED).
- **Regressions Prevented:**  
  Prevents phantom adoption, stale split-brain writes, overwriting newly submitted contribution revisions, and adopting contributions into quarantined decisions.

---

### Defect D2: Recovery Lease Validation Relies on Application Time & Incomplete Fencing Conditions

- **Root Cause:**  
  1. Lease validity across `operationJournal.repository.ts` relied on Node.js process wall-clock time (`new Date()`), introducing vulnerability to clock drift, NTP skew, and leap seconds across distributed nodes.
  2. `renewOperationLease()` executed `OperationJournalModel.updateOne()` and conditionally `DecisionModel.updateOne()`, but:
     - It did not enforce `{ auditIntegrityStatus: { $ne: 'quarantined' } }` on the Decision.
     - It ignored whether `DecisionModel.updateOne()` matched, returning `true` whenever the journal matched, even if the Decision lease renewal had failed or the Decision was quarantined.
  3. `transitionJournalState()` did not enforce active unexpired lease.
  4. `executeCompensatingRollback()` used a permissive `$or: [{ _id: ... }, { decisionId: ... }]` filter on contribution rollback.
- **Production Files Modified:**  
  - `apps/api/src/repositories/operationJournal.repository.ts`:
    - Replaced all application-time comparisons with MongoDB server-side aggregation variable `$$NOW` via `$expr: { $gt: ['$leaseExpiresAt', '$$NOW'] }` for active leases and `$expr: { $lt: ['$leaseExpiresAt', '$$NOW'] }` for expired leases.
    - Updated `renewOperationLease()` to execute in an atomic transaction verifying both `OperationJournalModel` and `DecisionModel`.
    - Added `{ auditIntegrityStatus: { $ne: 'quarantined' } }` to the Decision renewal predicate.
    - Enforced that both writes must match exactly (`journalResult.matchedCount === 1` and `decResult.matchedCount === 1`); otherwise, returns `false`.
    - Updated `transitionJournalState()` to enforce active lease condition `$expr: { $gt: ['$leaseExpiresAt', '$$NOW'] }`.
  - `apps/api/src/services/recoveryWorker.service.ts`:
    - Hardened `executeCompensatingRollback()`: replaced permissive `$or` with strict target match `{ _id: targetEntityId, decisionId, adoptedOperationId: operationId, status: 'adopted' }`.
    - Enforced Decision unexpired lease and non-quarantined status in rollback.
- **Verification Test Evidence:**  
  - `apps/api/tests/batch4_v3_remediation.test.ts`:
    - `renewOperationLease fails when Decision is quarantined even if Journal lease is valid` (PASSED).
    - `renewOperationLease fails when lease is expired using server time $$NOW` (PASSED).
    - `transitionJournalState fails when lease is expired` (PASSED).
  - `apps/api/tests/batch4_v3_reproduction.test.ts`:
    - `Defect 2: renewOperationLease returns true even when Decision is quarantined` (PASSED - verified fails closed).
- **Regressions Prevented:**  
  Prevents zombie workers from perpetuating leases against compromised or quarantined decisions, eliminates NTP skew vulnerabilities, and prevents compensating rollback from rolling back unrelated contributions.

---

### Defect D3: Consumer Deduplication Can Permanently Suppress External Side Effect After a Crash

- **Root Cause:**  
  `OutboxService.deduplicateConsumerEvent()` inserted a record into `NotificationConsumerRecordModel` before the external side effect (e.g. webhook delivery, external email, notification dispatcher) executed. If the process crashed immediately after the DB insert:
  1. The external side effect was never performed.
  2. Upon restart/retry, the duplicate key error (`code: 11000`) caused the service to return `false` (duplicate), permanently dropping the side effect.
  3. No state machine existed to track pending, processing, completed, or failed attempts.
- **Production Files Modified:**  
  - `apps/api/src/models/outbox.types.ts`:
    - Extended `INotificationConsumerRecord` to include:
      - `status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'`
      - `idempotencyKey?: string`
      - `processingOwner?: string`
      - `leaseExpiresAt?: Date`
      - `claimGeneration: number`
      - `attemptCount: number`
      - `lastError?: string`
      - `completedAt?: Date`
      - `processedAt: Date`
  - `apps/api/src/models/outbox.model.ts`:
    - Updated Mongoose schema with lifecycle fields and compound index `{ consumerId: 1, notificationId: 1 }`.
  - `apps/api/src/services/outbox.service.ts`:
    - Implemented atomic `claimConsumerProcessing()`:
      - Atomically inserts a `PENDING` record, or reclaims an existing record if `status === 'FAILED'` or lease is expired (`leaseExpiresAt < $$NOW`).
      - Increments `claimGeneration` and `attemptCount`, and sets `processingOwner` and `leaseExpiresAt`.
    - Implemented `completeConsumerProcessing()`:
      - Transitions status to `COMPLETED` conditional on `processingOwner` and `claimGeneration`.
    - Implemented `failConsumerProcessing()`:
      - Sets status to `FAILED` and records `lastError`.
    - Implemented `processConsumerEvent<T>()`:
      - Orchestrates the full lifecycle: claim -> execute handler -> complete.
      - Enforces bounded retries (e.g. `maxRetries: 3`). When attempts exceed limit, marks status as `FAILED` with `MAX_RETRIES_EXCEEDED`.
    - Preserved backwards-compatible `deduplicateConsumerEvent()` setting `status: 'COMPLETED'` on creation.
- **Verification Test Evidence:**  
  - `apps/api/tests/batch4_v3_remediation.test.ts`:
    - `allows safe retry when process crashes before side effect` (PASSED).
    - `detects duplicate delivery when notification is already COMPLETED` (PASSED).
    - `handles race between two consumers: exactly one claimant wins` (PASSED).
    - `allows takeover of expired processing lease by a new worker` (PASSED).
    - `rejects completion by stale worker whose generation was superseded` (PASSED).
    - `enforces bounded retries and marks MAX_RETRIES_EXCEEDED when retry limit is exceeded` (PASSED).
- **Regressions Prevented:**  
  Eliminates silent side-effect drop on worker crash, prevents duplicate side-effect execution under active leases, and guarantees graceful dead-lettering for poison messages.

---

### Defect D4: Atomic Test Database Ownership

- **Root Cause:**  
  `claimTestDatabaseOwnership(connection, runId, workerId)` in `apps/api/src/db/guard.ts` performed:
  1. `metaCol.findOne({ _id: 'ownership' })`.
  2. If found with different credentials, throw.
  3. `metaCol.updateOne({ _id: 'ownership' }, { $set: { runId, workerId } }, { upsert: true })`.
  Two concurrent test runners starting simultaneously would both execute `findOne()` before either wrote, observing no ownership record, and both would proceed to claim the same test database, corrupting each other's test isolation.
- **Production Files Modified:**  
  - `apps/api/src/db/guard.ts`:
    - Replaced read-then-upsert with atomic `metaCol.insertOne({ _id: 'ownership_lock', runId, workerId, claimedAt: new Date() })`.
    - Handled MongoDB duplicate key error (`code: 11000`):
      - Re-queried existing lock document.
      - If `existing.runId === runId && existing.workerId === workerId`, treated as an idempotent re-claim by the same worker.
      - If `existing.runId !== runId || existing.workerId !== workerId`, threw fatal error: `Test database '${dbName}' is already owned by run '${existing.runId}' (worker '${existing.workerId}'). Access denied.`
    - Guaranteed that a losing claimant cannot alter or overwrite the winning ownership record.
- **Verification Test Evidence:**  
  - `apps/api/tests/batch4_v3_remediation.test.ts`:
    - `Phase E: Atomic test database ownership claim - concurrent claims result in exactly one winner` (PASSED).
    - `Phase E: Losing claimant cannot overwrite winner's ownership lock` (PASSED).
    - `Phase E: Idempotent re-claim by same runId and workerId succeeds` (PASSED).
  - `apps/api/tests/batch4_v3_reproduction.test.ts`:
    - `Defect 4: Concurrent claimTestDatabaseOwnership race allows split ownership` (PASSED - verified atomic lock rejection).
- **Regressions Prevented:**  
  Prevents test database crosstalk, test flakiness, and data collisions between concurrent test processes in CI/CD.

---

### Defect D5: Deterministic Concurrency & Standalone Testing

- **Root Cause:**  
  1. In `apps/api/tests/batch4_r1_transactions.test.ts`, the test checked `if (!standaloneConnected) return;`. When a standalone MongoDB instance was offline or unreachable, the test silently passed without validating fail-closed behavior on non-replica-set deployments.
  2. In `apps/api/tests/batch4_r2_fencing.test.ts` and `apps/api/tests/recoveryConcurrency.test.ts`, tests relied on wall-clock `setTimeout(..., 1100)` sleeps to wait for leases to expire. Under high CPU load or CI slowdowns, this led to race conditions, slow execution, and flakiness.
- **Production Files Modified:**  
  - `apps/api/tests/batch4_r1_transactions.test.ts`:
    - Replaced silent conditional bypass with explicit assertion:
      `expect(standaloneConnected, 'Expected standalone MongoDB on :27017 to be connected').toBe(true);`
    - Ensures that standalone transaction rejection tests always execute and cannot silently pass if the standalone service is down.
  - `apps/api/tests/batch4_r2_fencing.test.ts`:
    - Replaced all `await new Promise(r => setTimeout(r, ...))` sleeps with deterministic database updates backdating `leaseExpiresAt` in MongoDB:
      `await journalRepo.getCollection().updateOne({ operationId }, { $set: { leaseExpiresAt: new Date(Date.now() - 5000) } });`
  - `apps/api/tests/recoveryConcurrency.test.ts`:
    - Replaced wall-clock sleeps with deterministic lease expiration updates.
- **Verification Test Evidence:**  
  - `apps/api/tests/batch4_r1_transactions.test.ts`: Executed and verified (all tests pass with standalone instance confirmed connected).
  - `apps/api/tests/batch4_r2_fencing.test.ts`: Executed and verified (10 tests pass deterministically in < 1 second).
  - `apps/api/tests/recoveryConcurrency.test.ts`: Executed and verified (10 tests pass deterministically without timing flakiness).
- **Regressions Prevented:**  
  Eliminates CI timing flakiness, guarantees high test execution speed, and eliminates false-positive test passes on missing infrastructure.

---

### Defect D6: Ownership-Fenced Test Cleanup

- **Root Cause:**  
  `assertCanCleanupTestDatabase(connection)` only checked whether the database name contained `_test`, `_it_`, or `decision_os_test_`. It did not verify whether the active process actually owned the database, nor did it verify `runId` or `workerId`. Furthermore, `cleanupTestDatabase(connection)` dropped databases unconditionally without checking for reserved system databases (`admin`, `local`, `config`, `production`).
- **Production Files Modified:**  
  - `apps/api/src/db/guard.ts`:
    - Updated `assertCanCleanupTestDatabase(connection, expectedRunId?, expectedWorkerId?)`:
      - Validates that database name does not match reserved production or system names (`admin`, `config`, `local`, `decision_os`, `production`).
      - Requires database name to contain a valid test indicator.
      - Inspects the `__test_metadata` collection:
        - If ownership lock does not exist, throws: `Cannot clean up test database: no ownership lock found`.
        - If `expectedRunId` or `expectedWorkerId` are provided, enforces exact match against locked `runId` and `workerId`. Throws if mismatched: `Test database cleanup denied: owned by run ...`.
    - Updated `cleanupTestDatabase(connection, runId?, workerId?)` to enforce ownership validation before dropping or clearing collections.
- **Verification Test Evidence:**  
  - `apps/api/tests/batch4_v3_remediation.test.ts`:
    - `Phase F: assertCanCleanupTestDatabase rejects cleanup when ownership lock is missing` (PASSED).
    - `Phase F: assertCanCleanupTestDatabase rejects cleanup when workerId or runId mismatch` (PASSED).
    - `Phase F: assertCanCleanupTestDatabase strictly rejects reserved database names` (PASSED).
  - `apps/api/tests/batch4_v3_reproduction.test.ts`:
    - `Defect 6: assertCanCleanupTestDatabase permits deletion without verifying worker ownership` (PASSED - verified ownership-fenced enforcement).
- **Regressions Prevented:**  
  Prevents accidental deletion of production databases, rogue test workers destroying active test databases of other workers, and unowned database purges.

---

## 3. Summary of Remediated Invariants

1. **Transactional Integrity:** Every state transition in the recovery lifecycle (EVALUATED, COMMITTED, AUDITED, COMPENSATING) is executed inside a MongoDB multi-document ACID transaction.
2. **Atomic Recovery Fencing:** No contribution projection or rollback write can succeed unless the Decision's active lease, generation fencing token, worker identity, and non-quarantined status are confirmed within the same transaction.
3. **Server-Side Authoritative Time:** All recovery lease validations and renewals employ MongoDB server-side `$$NOW` via `$expr`, eliminating host clock drift vulnerabilities.
4. **Durable At-Least-Once Consumer Processing:** Side effects are preceded by an atomic `PROCESSING` lease claim, bound by `claimGeneration` and retry counts, guaranteeing retriability after a crash and eliminating permanent suppression.
5. **Atomic Isolated Test Harness:** Database claims use atomic insertion locks with worker-fenced cleanup validation, preventing test concurrency interference.
