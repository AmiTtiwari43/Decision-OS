# DECISION OS — BATCH 4 REMEDIATION V3.3 BASELINE REPORT
**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit:** `32215c44cf126b8808199cb983532a4c6bd87049` (V3.2)  
**Previous Baseline:** `c4d656eeabb9e4e969735642377dca0e7df98639` (V3.1)  
**Audit Date:** 2026-11-05  
**Reviewer:** Independent Adversarial Auditor & Distributed Systems Specialist  

---

## 1. Baseline Verification & Working Tree Reconnaissance

### 1.1 Git Status & Commit Verification
- **Branch:** `fix/batch4-replica-set-transactional-recovery`
- **Current HEAD Commit SHA:** `32215c44cf126b8808199cb983532a4c6bd87049`
- **Commit Message:** `fix(batch4): close transaction, consumer idempotency and cleanup fencing gaps v3.2`
- **Working Tree:** Clean prior to V3.3 remediation.
- **Repository Remote:** `https://github.com/AmiTtiwari43/Decision-OS.git`

### 1.2 Infrastructure & Topology Reconnaissance
- **Replica Set:** MongoDB v8.3.7 running on port 27018 (`rs0`, single-node replica set, majority write concern). PID 20900.
- **Standalone Instance:** MongoDB v8.3.7 running on port 27017 (PID 5340). Standalone fails closed on multi-document transactions.
- **Runtime Environment:** Node.js v22.13.1, Mongoose v9.x, Vitest v4.1.12.

### 1.3 CI / GitHub Status Investigation
- **Commit Status Check:** Queried `https://api.github.com/repos/AmiTtiwari43/Decision-OS/commits/32215c44cf126b8808199cb983532a4c6bd87049/status`.
- **Status Context:** `Vercel` -> `state: "failure"`.
- **Root Cause Analysis of Vercel Check:**
  - Vercel GitHub App automatically attempts preview deployments on every push to the repository.
  - The repository is a monorepo containing `apps/api`, `apps/web`, and `packages/decision-engine`.
  - There is no `vercel.json` in the repository, and the root directory in the Vercel project settings is not configured to point to `apps/web` or run workspace pre-builds.
  - When Vercel executes its generic build command on the monorepo root, it fails to find an exported static output directory.
  - **Classification:** **Unrelated Preview/Deployment Configuration Failure.** All production backend and web code passes lint, typecheck, and local build cleanly.

---

## 2. Source Code Reconciliation & Known Defects in V3.2

Independent source inspection of `32215c44cf126b8808199cb983532a4c6bd87049` identified five specific reliability defects requiring remediation:

### 2.1 Finding F-V32-01: Dispatcher Ignores Rejected Acknowledgement
- **Target:** `apps/api/src/services/outbox.service.ts` > `dispatchPending()`
- **V3.2 Code State:**
  ```typescript
  await dispatcherFn(item);
  await outboxRepository.markDelivered(item.notificationId, workerId, claimGen);
  succeeded++;
  ```
- **Defect:** `markDelivered` returns `Promise<boolean>`. If Worker A's lease expires while `dispatcherFn` executes and Worker B takes over with a higher claim generation, `markDelivered` returns `false`. V3.2 unconditionally incremented `succeeded++`, falsely reporting successful delivery to callers when the acknowledgement was rejected by MongoDB.

### 2.2 Finding F-V32-02: Expired Consumer Lease Can Still Be Marked FAILED
- **Target:** `apps/api/src/services/outbox.service.ts` > `failConsumerProcessing()`
- **V3.2 Code State:** Query filter matched `{ consumerId, notificationId, processingOwner: workerId, claimGeneration, status: 'PROCESSING' }` without checking `$expr: { $gt: ['$leaseExpiresAt', '$$NOW'] }`.
- **Defect:** A worker whose lease expired could still mark the record `FAILED` before another worker reclaimed it, erasing the lease and clearing ownership without server-time lease validation.

### 2.3 Finding F-V32-03: Destination Idempotency Crash Window Unproven
- **Target:** `apps/api/src/services/outbox.service.ts` > `processConsumerEvent()`
- **Defect:** V3.2 tested destination deduplication using an in-memory Map after the consumer database record had already reached `COMPLETED`. It did not prove the crash window where:
  1. Destination executes external side effect.
  2. Process crashes before `completeConsumerProcessing()` persists `COMPLETED`.
  3. Lease expires.
  4. Another worker reclaims with higher generation.
  5. Destination receives the identical stable idempotency key and suppresses duplicate side effect execution.

### 2.4 Finding F-V32-04: Cleanup Generation Caller-Supplied, Not Atomically Advanced
- **Target:** `apps/api/src/db/guard.ts` > `cleanupTestDatabase()`
- **Defect:** Parameter `cleanupGeneration: number = 1` was written directly via `$set: { cleanupGeneration }` without atomic compare-and-set or server-side `$inc`. Callers could supply arbitrary numbers, and concurrent drops by the same worker were not serialized.

### 2.5 Finding F-V32-05: Unowned Empty Database Returns Early Without Verification
- **Target:** `apps/api/src/db/guard.ts` > `cleanupTestDatabase()`
- **Defect:** If `db.listCollections()` returned 0 collections, the method immediately returned without verifying whether the database was owned by the current run/worker or existed in an independent cleanup registry. An unowned empty database was falsely treated as cleaned up.

---

## 3. Baseline Reproduction Test Evidence

Implemented reproduction suite `apps/api/tests/batch4_v33_reproduction.test.ts` against the baseline.
- **REPRO-F-V32-01:** Verified `dispatchPending` returned `succeeded: 1` when `markDelivered` returned `false`.
- **REPRO-F-V32-02:** Verified `failConsumerProcessing` returned `true` and modified database records on an expired lease.
- **REPRO-F-V32-03:** Verified side effect duplication occurred when destination lacked durable persistence across crash windows.
- **REPRO-F-V32-04:** Verified arbitrary caller-supplied generations were written without server-side validation.
- **REPRO-F-V32-05:** Verified empty unowned databases returned cleanly without throwing safety guard violations.

All 5 defects were reproduced before applying production corrections.
