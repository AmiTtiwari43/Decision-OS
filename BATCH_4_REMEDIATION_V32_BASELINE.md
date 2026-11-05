# DECISION OS — BATCH 4 REMEDIATION V3.2
## BASELINE RECONNAISSANCE & DEFECT REPRODUCTION REPORT

**Execution Date:** 2026-11-05  
**Starting Commit SHA:** `c4d656eeabb9e4e969735642377dca0e7df98639`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Previous Baseline:** V3.1 Remediation Commit  
**Status:** ALL REMAINING DEFECTS REPRODUCED & CONFIRMED ON ACTUAL REPLICA-SET INFRASTRUCTURE

---

### 1. ENVIRONMENT & TOPOLOGY VERIFICATION

The reproduction and verification environment was inspected directly via OS process and network introspection:

| Component | Verified Version / Topology | Verification Command / Evidence |
|---|---|---|
| **OS** | Windows 11 Enterprise (amd64) | `[System.Environment]::OSVersion` |
| **Node.js** | `v22.13.1` | `node -v` |
| **npm** | `11.6.4` | `npm -v` |
| **MongoDB Replica Set** | `v8.3.7` (Replica set `rs0` on port 27018) | `mongod --replSet rs0 --port 27018` |
| **MongoDB Standalone** | `v8.3.7` (Standalone on port 27017) | `mongod` default service on port 27017 |
| **Mongoose** | `^9.11.4` | `apps/api/package.json` |
| **Test Runner** | Vitest `v4.1.12` | `npx vitest --version` |

---

### 2. BASELINE SOURCE INSPECTION & DEFECT ANALYSIS

#### 2.1 Defect D2: Transaction Failure Permits Partial Commit When Caller Catches Error
- **Location:** `apps/api/src/repositories/operationJournal.repository.ts` -> `renewOperationLease()`
- **V3.1 Behavior:**
  When a caller provides an active `ClientSession` to `renewOperationLease()`, the method executes:
  1. `OperationJournalModel.findOneAndUpdate(..., { session: sess, updatePipeline: true })`
  2. If `decisionId` is supplied, `DecisionModel.updateOne(..., { session: sess })`
  3. If `decRes.matchedCount === 0`, it throws `new ConcurrencyFencingError(...)`.
- **Defect Root Cause:**
  A thrown JavaScript exception inside an application helper **does NOT abort a MongoDB transaction**. In V3.1, `session.abortTransaction()` was never called inside `renewOperationLease()`. If the calling code catches `ConcurrencyFencingError` and proceeds to call `session.commitTransaction()`, MongoDB commits the staged `OperationJournalModel` write.
- **Observed Reproduction:**
  Reproduction test `REPRO D2-1` executed in `tests/batch4_v32_reproduction.test.ts`:
  - Created a journal record and a quarantined Decision.
  - Started a MongoDB session and transaction.
  - Called `renewOperationLease(..., session)` which staged the journal update and threw `ConcurrencyFencingError`.
  - Caught the error and executed `session.commitTransaction()`.
  - **Result:** `commitTransaction()` **succeeded**. The persisted `OperationJournal` lease was updated to `+30,000ms`, while the Decision remained quarantined with its original lease timestamp. Dual-document atomicity was broken.

#### 2.2 Defect D3: Permissive Outbox Acknowledgements & Missing Destination Idempotency Contract
- **Locations:**
  - `apps/api/src/repositories/outbox.repository.ts` -> `markDelivered()`, `markFailed()`
  - `apps/api/src/services/outbox.service.ts` -> `processConsumerEvent()`, `deduplicateConsumerEvent()`
- **V3.1 Behavior & Root Causes:**
  1. **Permissive Signatures:** `markDelivered(notificationId, workerId?, claimGeneration?)` and `markFailed(notificationId, error, workerId?, claimGeneration?)` made `workerId` and `claimGeneration` optional. When omitted, the query updated `{ notificationId, status: 'CLAIMED' }` without checking ownership, allowing stale dispatchers to acknowledge or fail events owned by another worker.
  2. **Unsafe Legacy Fallback:** `deduplicateConsumerEvent` retained a legacy wrapper that invoked `processConsumerEvent(consumerId, notificationId, 'default-worker', sideEffectFn)`, hardcoding a fake `'default-worker'` identity.
  3. **Bare String Callback Contract:** `processConsumerEvent` passed only a bare `idempotencyKey` string to `sideEffectFn(idempotencyKey)` without a typed request object (`idempotencyKey`, `consumerId`, `notificationId`, `claimGeneration`, `workerId`, `payload`).
  4. **Destination Idempotency Crash Window:** If an external side effect succeeds but the worker crashes before MongoDB marks `COMPLETED`, a subsequent reclaim will re-execute the side effect. Unless the destination adapter enforces idempotency with duplicate suppression, the side effect is executed multiple times.
- **Observed Reproduction:**
  - `REPRO D3-1`: `outboxRepository.markDelivered(notifId)` called without `workerId` or `claimGeneration` successfully transitioned the notification to `DELIVERED`, bypassing worker ownership fencing.
  - `REPRO D3-2`: `deduplicateConsumerEvent` completed a consumer record using hardcoded `'default-worker'`.

#### 2.3 Defect D6: Cleanup Ownership Lock Permits Same-Worker Re-Entry
- **Location:** `apps/api/src/db/guard.ts` -> `claimTestDatabaseOwnership()`
- **V3.1 Behavior:**
  When `metaCol.insertOne()` encounters duplicate key code 11000 on `_id: 'ownership_lock'`, it queries `metaCol.findOne()`.
  If `existing.runId === cleanRun && existing.workerId === cleanWorker`, it unconditionally returns `undefined` (success), without checking whether `existing.cleanupInProgress === true` or whether the state is `CLEANUP_LOCKED` / `CLEANED`.
- **Defect Root Cause:**
  During teardown or concurrent execution, a re-entrant claim by the same worker succeeds while cleanup has already locked the database. The caller proceeds to interact with a database that is actively being dropped.
- **Observed Reproduction:**
  - `REPRO D6-1`: Claimed ownership with `(run-d6-repro, worker-d6)`. Acquired cleanup lock setting `cleanupInProgress: true`. Called `claimTestDatabaseOwnership(conn, 'run-d6-repro', 'worker-d6')`.
  - **Result:** `claimTestDatabaseOwnership` returned cleanly without error (`reEntryError = null`), permitting re-entry into a locked-for-destruction database.

---

### 3. AFFECTED CALL GRAPH INVENTORY

| Subsystem | Target Functions | Affected Callers in Codebase |
|---|---|---|
| **D2: Recovery Renewal** | `OperationJournalRepository.renewOperationLease` | `apps/api/src/services/recoveryWorker.service.ts` (`startHeartbeat`)<br>`apps/api/tests/batch4_*.test.ts`<br>`apps/api/tests/recoveryConcurrency.test.ts` |
| **D3: Outbox Dispatch** | `OutboxRepository.markDelivered`<br>`OutboxRepository.markFailed` | `apps/api/src/services/outbox.service.ts` (`dispatchPending`)<br>`apps/api/tests/batch4_r5_outbox.test.ts` |
| **D3: Consumer Lifecycle** | `OutboxService.processConsumerEvent`<br>`OutboxService.deduplicateConsumerEvent` | `apps/api/tests/batch4_adversarial_regression.test.ts`<br>`apps/api/tests/batch4_r5_outbox.test.ts`<br>`apps/api/tests/batch4_v31_remediation.test.ts` |
| **D6: Database Guard** | `claimTestDatabaseOwnership`<br>`cleanupTestDatabase`<br>`assertCanCleanupTestDatabase` | `apps/api/tests/batch4_r6_isolation.test.ts`<br>`apps/api/tests/batch4_v3_remediation.test.ts`<br>`apps/api/tests/batch4_v31_remediation.test.ts`<br>Integration test teardowns |

---

### 4. REPRODUCTION TEST SUITE EXECUTION SUMMARY

```
 RUN  v4.1.12 C:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/apps/api

 stdout | tests/batch4_v32_reproduction.test.ts > REPRO D2-1
 REPRO D2-1 Result: {
   commitSucceeded: true,
   journalPersistedExpires: 1793880677537,
   initialJournalExpires: 1793880657421,
   decisionExpires: 1793880657421
 }

 stdout | tests/batch4_v32_reproduction.test.ts > REPRO D6-1
 REPRO D6-1 Result: reEntryError = NONE (ALLOWED RE-ENTRY!)

 ✓ tests/batch4_v32_reproduction.test.ts (4 tests) 2582ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

Baseline confirmation is complete. We now proceed to Phase B remediation.
