# DECISION OS — BATCH 4 REMEDIATION V3.5
## BASELINE VERIFICATION & PRE-REMEDIATION AUDIT

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit (V3.4):** `00417e0d46e79496268dc786475d3641687167e3`  
**Parent Commit (V3.3):** `19ab21c33e6c1286445c12e584db1fc97e890398`  
**Date:** 2026-11-05  
**Remediation Scope:** Atomic Destructive-Action Authority, Stale-Worker Fencing & Adversarial Verification in `apps/api/src/db/guard.ts`.  

---

## 1. Mandatory Baseline Verification

Before initiating any source modifications for V3.5, the Git repository, working tree, and commit lineage were rigorously verified:

- **Current Branch:** `fix/batch4-replica-set-transactional-recovery`
- **Current HEAD SHA:** `00417e0d46e79496268dc786475d3641687167e3`
- **Parent Commit SHA:** `19ab21c33e6c1286445c12e584db1fc97e890398`
- **Working Tree Status:** Clean (0 uncommitted changes prior to test reproduction)
- **Files Modified since V3.3:**
  - `apps/api/src/db/guard.ts`
  - `apps/api/tests/batch4_v32_adversarial.test.ts`
  - `apps/api/tests/batch4_v34_cleanup_recovery.test.ts`
  - `apps/api/tests/batch4_v34_reproduction.test.ts`
  - Root markdown reports (V3.4 suite)
- **Canonical Engine Status:** `packages/decision-engine` has exactly **0 bytes diff** against baseline (completely untouched).

---

## 2. Infrastructure & MongoDB Topology Verification

The automated test suites execute against live local MongoDB topologies:

1. **MongoDB 3-Node Replica Set (`rs0`):**
   - **Connection URI:** `mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true`
   - **Role:** Powers all multi-document ACID transactions, distributed leasing, coordination registry sync, and adversarial failure injection tests.
   - **Status:** Healthy, replica set active.

2. **MongoDB Standalone Instance:**
   - **Connection URI:** `mongodb://127.0.0.1:27017`
   - **Role:** Tested in `batch4_v32_adversarial.test.ts` (test `D5-T1`) to guarantee **fail-closed behavior** (strictly refuses to run multi-document transactional recovery against standalone instances lacking replica set support).
   - **Status:** Active on port 27017.

---

## 3. Inventory of Destructive Operation Paths

A monorepo-wide audit for `dropDatabase()` and destructive test cleanup paths reveals:

- **Production Source Code:**
  The **only** call to `db.dropDatabase()` in production code is in:
  `apps/api/src/db/guard.ts#cleanupTestDatabase()` (line 779).
- **Test Code teardown helpers:**
  Direct teardown invocations exist in test `finally` / `afterAll` blocks across test files to ensure isolated test databases do not leak on test runners.
- **Complete Call Graph to `db.dropDatabase()`:**
  ```
  Test Suite / Worker Teardown
    └── cleanupTestDatabase(connection, runId, workerId, options)
          ├── [Stage 0] Check collections.length === 0
          │     └── [Early exit / reconcile CLEANED if registry proof exists]
          ├── [Stage 1] assertCanCleanupTestDatabase(connection, runId, workerId)
          │     └── validateTestIdentity, prefix checks, ownership lock checks
          ├── [Stage 2] metaCol.findOneAndUpdate (OWNED -> CLEANUP_LOCKED, gen++)
          │     └── Sync CLEANUP_LOCKED to coordCol (cleanup_registry)
          ├── [Stage 3] metaCol.findOneAndUpdate (CLEANUP_LOCKED -> DROP_IN_PROGRESS)
          │     └── Sync DROP_IN_PROGRESS to coordCol
          ├── [Fencing Pre-Check] coordCol.findOne (V3.4 check-then-act)
          └── db.dropDatabase()
                └── [Stage 4] Mark CLEANED in coordCol
  ```

---

## 4. Identified Baseline Defects

1. **Defect R1 (Check-then-act race):**  
   The coordination registry check in lines 758–773 performs a `coordCol.findOne(...)`. If Worker A reads the record, confirms authority, and then pauses (e.g. event loop delay, thread preemption, GC pause), another process could modify or supersede the coordination record. When Worker A resumes, it calls `db.dropDatabase()` because the read check was not atomic with the drop.
2. **Defect R2 (Fail-open on missing coordination record):**  
   In lines 758–773, `if (latestCoord && ...)` only checks mismatch if `latestCoord` is non-null. If the coordination record was missing, deleted, or uninitialized, `latestCoord` is null, causing the guard to fall through and execute `db.dropDatabase()`. This is an unsafe fail-open vulnerability.
