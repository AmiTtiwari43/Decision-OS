# DECISION OS — BATCH 4 TARGETED REMEDIATION v2: IMPLEMENTATION REPORT

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Starting Commit:** `f8fedf03f0b99da7c8a9c8d49b581daf39fc55c9`  
**Scope:** Backend reliability, replica-set multi-document transaction integrity, recovery fencing protocol, contribution projection binding, cryptographic audit chain CAS atomicity, durable notification outbox, and test database isolation.

---

## 1. Executive Summary

This implementation report documents the complete remediation of all six correctness and reliability defects (R1 through R6) identified in Decision OS Batch 4. 

All non-transactional standalone fallback branches have been removed from the mutation paths, establishing fail-closed enforcement of MongoDB replica-set transactions. Fencing queries have been made strictly monotonic and bound to database-backed leases and active worker claims. The expert contribution projection now binds revisions, target versions, and operations atomically. Audit event insertion and authoritative head advancement participate in atomic CAS transactions. The notification outbox now features claim generation fencing and persistent, database-backed consumer deduplication. Every test file now targets run-scoped, worker-isolated replica-set databases.

---

## 2. Detailed Remediation By Phase

### Phase 1 — Recovery Transaction Enforcement (Finding R1)
- **Problem:** Mutation paths in `recoveryWorker.service.ts` (`executeCompensatingRollback`), `operationJournal.repository.ts` (`claimJournalOperation`), and `decision.service.ts` (`resolveQuarantine`) contained `if (isReplicaSetSupported()) ... else ...` fallback branches that performed multi-document operations outside transactions on standalone MongoDB.
- **Implementation:**
  - Removed all non-transactional fallback branches across all mutation services.
  - Enforced `assertReplicaSetSupported()` within `runInTransaction()`. Standalone MongoDB topologies fail closed immediately with an informative error.
  - Ensured MongoDB client sessions are passed through every write in multi-document transactions (e.g., decision mutation, audit append, outbox creation, journal update).
- **Files Modified:**
  - `apps/api/src/services/recoveryWorker.service.ts`
  - `apps/api/src/repositories/operationJournal.repository.ts`
  - `apps/api/src/services/decision.service.ts`
  - `apps/api/src/services/contribution.service.ts`

### Phase 2 — Recovery Fencing and Lease Safety (Finding R2)
- **Problem:** Recovery queries accepted permissive `$or` branches (`recoveryFencingToken <= fencingToken`, `recoveryOwner: null`), allowing stale workers with expired leases or superseded tokens to write to decisions.
- **Implementation:**
  - Replaced permissive queries with strict invariant predicates:
    - Exact monotonic equality: `recoveryFencingToken: fencingToken`
    - Authoritative worker ownership: `recoveryOwner: workerId`
    - Valid unexpired database lease: `recoveryLeaseExpiresAt: { $gt: new Date() }`
    - Non-quarantined status: `auditIntegrityStatus: { $ne: 'quarantined' }`
  - Added atomic `matchedCount === 1` assertions that throw `ConcurrencyFencingError` on any CAS mismatch.
  - Bound decision lease atomically inside the journal claim transaction in `operationJournalRepository.claimJournalOperation`.
  - Wrapped `markQuarantined` in a session transaction recording a cryptographically chained `decision.quarantined` audit event.
- **Files Modified:**
  - `apps/api/src/services/recoveryWorker.service.ts`
  - `apps/api/src/repositories/operationJournal.repository.ts`
  - `apps/api/src/models/audit.types.ts`

### Phase 3 — Contribution Projection and Lifecycle (Finding R3)
- **Problem:** Expert score adoptions relied only on `status: 'submitted'` without binding to expected contribution revision, target decision version, or recovery operation generation.
- **Implementation:**
  - Extended `DecisionContributionSchema` with audit and concurrency fields:
    - `adoptedOperationId: string`
    - `adoptedDecisionVersion: number`
    - `adoptedFencingToken: number`
    - `adoptedRevision: number`
  - Updated `contributionRepository.markAdopted` with strict CAS predicates:
    - Checks `_id`, `decisionId`, `status: 'submitted'`, and `revision: expectedRevision`.
  - Updated `executeCompensatingRollback` to reset adopted contributions on failure back to `submitted` state within the same transaction.
  - Updated `reconcileOperation` Step 3 to atomically project expert score adoptions with revision and version checks.
- **Files Modified:**
  - `apps/api/src/models/contribution.model.ts`
  - `apps/api/src/models/contribution.types.ts`
  - `apps/api/src/repositories/contribution.repository.ts`
  - `apps/api/src/services/contribution.service.ts`
  - `apps/api/src/services/recoveryWorker.service.ts`

### Phase 4 — Cryptographic Audit Chain Atomicity (Finding R4)
- **Problem:** `auditService.recordEvent` executed head advancement and event creation without guaranteeing that head CAS failure aborts the event insertion. Without an explicit session, writes could partially persist.
- **Implementation:**
  - Wrapped standalone `recordEvent` calls in `runInTransaction()`, ensuring event creation and `DecisionModel.updateOne` always participate in the same ACID session.
  - Enforced strict CAS condition on `DecisionModel.updateOne`:
    - Sequence 1 matches genesis or uninitialized head.
    - Subsequent sequences strictly match `auditHead.sequenceNumber === sequenceNumber - 1` and `auditHead.eventHash === previousEventHash`.
  - Added assertion `headUpdateRes.matchedCount === 1`; throws `ConcurrencyFencingError` on mismatch, aborting the transaction and leaving 0 uncommitted events.
  - Added chain verification check in `verifyChainIntegrity` comparing the decision's authoritative `auditHead` against the tip of the event chain.
- **Files Modified:**
  - `apps/api/src/services/audit.service.ts`

### Phase 5 — Durable Notification Outbox (Finding R5)
- **Problem:** Consumer deduplication was stored in an in-memory `Set<string>`, which did not survive process restarts. Dispatcher acknowledgments did not check claim generations.
- **Implementation:**
  - Added `claimGeneration: { type: Number, default: 0 }` to `NotificationOutboxSchema`.
  - Incremented `claimGeneration` monotonically during `outboxRepository.claimPending`.
  - Fenced `markDelivered` and `markFailed` on `dispatchOwner`, `claimGeneration`, and unexpired `leaseExpiresAt`.
  - Created `NotificationConsumerRecordSchema` and `NotificationConsumerRecordModel` with a unique compound index `{ consumerId: 1, notificationId: 1 }`.
  - Replaced in-memory Set with durable MongoDB upsert handling duplicate key errors (code 11000) for cross-process, restart-safe deduplication.
- **Files Modified:**
  - `apps/api/src/models/outbox.model.ts`
  - `apps/api/src/models/outbox.types.ts`
  - `apps/api/src/repositories/outbox.repository.ts`
  - `apps/api/src/services/outbox.service.ts`

### Phase 6 — Test Database Isolation and Cleanup (Finding R6)
- **Problem:** Tests defaulted to standalone MongoDB on port `27017` when `TEST_MONGODB_URI` was unset, causing false positives and concurrency collisions between test runs.
- **Implementation:**
  - Updated `apps/api/src/db/guard.ts`:
    - Defaulted `getTestDatabaseUri()` to replica set on port 27018 with `replicaSet=rs0&directConnection=true`.
    - Integrated deterministic `runId` and worker `poolId` into database names (`_test_<runId>_w<workerId>`).
    - Added atomic ownership locks (`claimTestDatabaseOwnership`) and safety assertions (`assertCanCleanupTestDatabase`, `cleanupTestDatabase`) preventing dropping foreign databases.
  - Updated all test suites across `apps/api` to use `getTestDatabaseUri()`.
- **Files Modified:**
  - `apps/api/src/db/guard.ts`
  - All test files in `apps/api/tests/`

---

## 3. Invariants & Correctness Guarantees

| Invariant | Guarantee | Enforcement Mechanism |
| :--- | :--- | :--- |
| **I1: ACID Atomicity** | Every multi-document mutation commits entirely or aborts with 0 partial writes. | MongoDB Replica Set transactions via `runInTransaction()`. Standalone fails closed. |
| **I2: Monotonic Fencing** | Stale recovery workers cannot overwrite decision or journal state. | Exact generation equality, database lease check (`leaseExpiresAt > now`), and active worker check on every write. |
| **I3: Contribution Revision Safety** | Stale recovery cannot adopt rejected, withdrawn, or resubmitted contributions. | Multi-field CAS binding checking `status: 'submitted'` and `revision: expectedRevision`. |
| **I4: Audit Chain Integrity** | Monotonic sequence numbers with SHA-256 hash chaining; zero partial events. | Audit-head CAS with `matchedCount === 1` check inside same transaction session. |
| **I5: Outbox Deduplication** | Exactly-once business side effects across consumer restarts. | Durable MongoDB unique compound index `{ consumerId: 1, notificationId: 1 }`. |
| **I6: Test Isolation** | No cross-worker data pollution or database collisions. | Run-scoped and worker-scoped database URIs with atomic ownership metadata locking. |
