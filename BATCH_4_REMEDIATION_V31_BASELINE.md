# DECISION OS — BATCH 4 REMEDIATION V3.1 BASELINE REPORT

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline HEAD Commit:** `35e4eb8` (`fix(batch4): eliminate recovery fencing and durable consumer defects v3`)  
**Audit Date:** 2026-11-05  
**Node.js Version:** `v22.13.1`  
**npm Version:** `11.6.4`  
**MongoDB Versions & Topology:**  
- **Primary Cluster:** MongoDB 8.3.7.0 Replica Set `rs0` (`127.0.0.1:27018`, Primary `myState: 1`)
- **Standalone Node:** MongoDB 8.3.7.0 Standalone (`127.0.0.1:27017`, `setName: undefined`)  
**Initial Monorepo Test Baseline:** 66 test files passed, 724 tests passed (0 failed). API workspace: 37 test files, 473 tests passed.

---

## 1. Executive Summary & Defect Inventory

Prior to modifying production code for Batch 4 V3.1, a rigorous baseline inspection and adversarial reproduction suite (`apps/api/tests/batch4_v31_reproduction.test.ts`) was executed directly against commit `35e4eb8`.

All targeted defects were reproduced and confirmed:

| Defect ID | Defect Domain | Target File & Method | Baseline Vulnerability | Status |
| :--- | :--- | :--- | :--- | :---: |
| **D2** | Database-Time Leases & Session Contract | `apps/api/src/repositories/operationJournal.repository.ts`<br>`renewOperationLease()`, `claimJournalOperation()`, `transitionJournalState()` | 1. Lease expiry values (`leaseExpiresAt`, `recoveryLeaseExpiresAt`, `heartbeatAt`) are computed in application server memory via `Date.now()`, exposing leases to host clock drift.<br>2. When called with an external `session`, if Decision renewal fails, `renewOperationLease()` returns `false` without throwing, allowing the caller to commit partial journal renewal. | **CONFIRMED** |
| **D3** | Consumer Deduplication & Side Effect Idempotency | `apps/api/src/services/outbox.service.ts`<br>`deduplicateConsumerEvent()` | `deduplicateConsumerEvent()` inserts a record with `status: 'COMPLETED'` before the side effect executes. A crash after registration but before side effect causes all subsequent deliveries to be dropped as duplicates. | **CONFIRMED** |
| **D6** | Mandatory Identity & Fenced Cleanup Protocol | `apps/api/src/db/guard.ts`<br>`assertCanCleanupTestDatabase()`, `cleanupTestDatabase()` | 1. `workerId` parameter is optional; omitted workerId bypasses worker checks.<br>2. Stored records without `workerId` bypass worker verification.<br>3. Non-atomic check-then-drop gap leaves destructive cleanup exposed to concurrency races. | **CONFIRMED** |

---

## 2. Reproduction Test Evidence

The baseline reproduction suite (`apps/api/tests/batch4_v31_reproduction.test.ts`) verified the exact failure modes:

1. **D2-1: Host Clock Derivation in Lease Renewal**
   - **Method:** `OperationJournalRepository.renewOperationLease()`.
   - **Simulation:** Host clock skewed by +1 hour (`Date.now() + 3,600,000ms`).
   - **Observed Behavior:** The stored `leaseExpiresAt` in MongoDB was stamped 1 hour in the future relative to true cluster time (`drift > 1,800,000ms`).
   - **Conclusion:** Confirms that lease expiry calculations depend on the application host clock rather than MongoDB server-derived time.

2. **D2-2: Partial Commit Under Caller-Supplied Transaction Session**
   - **Method:** `OperationJournalRepository.renewOperationLease(..., session)`.
   - **Simulation:** Caller opens transaction session. Journal is active; Decision is quarantined.
   - **Observed Behavior:** `renewOperationLease` returns `false`, but the journal lease update was already executed in `session`. Caller committed `session`; the journal lease update was persisted while the Decision lease remained un-renewed.
   - **Conclusion:** Confirms that returning `false` on partial writes within a caller-supplied session violates transactional atomicity.

3. **D3-1: Permanent Side Effect Drop on Worker Crash**
   - **Method:** `OutboxService.deduplicateConsumerEvent()`.
   - **Simulation:** Worker calls `deduplicateConsumerEvent()`, receives `true`, but crashes before executing the external webhook/email.
   - **Observed Behavior:** On worker restart/message redelivery, `deduplicateConsumerEvent()` returns `false` (duplicate detected). Total side effects executed: 0.
   - **Conclusion:** Confirms that marking `COMPLETED` prior to side effect execution permanently suppresses external delivery after a crash.

4. **D6-1: Omitted WorkerId Bypasses Cleanup Authorization**
   - **Method:** `assertCanCleanupTestDatabase(connection, runId, undefined)`.
   - **Observed Behavior:** Database was owned by `worker-locked-to-1`. Passing `undefined` as `expectedWorkerId` bypassed lines 251-255 in `guard.ts` without throwing.
   - **Conclusion:** Confirms worker identity is not mandatory in the baseline.

5. **D6-2: Missing Stored WorkerId Bypasses Worker Validation**
   - **Method:** Stored lock missing `workerId`. Caller passes `expectedWorkerId: 'worker-strictly-required'`.
   - **Observed Behavior:** `assertCanCleanupTestDatabase` evaluated `lock.workerId !== undefined` to false, allowing unauthorized cleanup.
   - **Conclusion:** Confirms stored locks without worker ID bypass isolation checks.
