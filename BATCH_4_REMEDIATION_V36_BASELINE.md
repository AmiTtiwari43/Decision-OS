# DECISION OS — BATCH 4 REMEDIATION V3.6
## BASELINE VERIFICATION & PRE-REMEDIATION AUDIT

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Mandatory Baseline Commit (V3.5):** `8a8ef7d62427d525d72d5352f24a75ea3bedf1cc`  
**Parent Commit (V3.4):** `00417e0d46e79496268dc786475d3641687167e3`  
**Date:** 2026-11-05  

---

## 1. Mandatory Baseline Verification

Before modifying any source files for V3.6, the Git repository, working tree, and commit lineage were rigorously verified:

- **Repository:** `AmiTtiwari43/Decision-OS`
- **Current Branch:** `fix/batch4-replica-set-transactional-recovery`
- **Current HEAD SHA:** `8a8ef7d62427d525d72d5352f24a75ea3bedf1cc`
- **Working Tree Status:** Clean (0 uncommitted changes prior to test reproduction)
- **Parent Commit SHA:** `00417e0d46e79496268dc786475d3641687167e3`
- **Files Modified in V3.5:**
  - `apps/api/src/db/guard.ts`
  - `apps/api/tests/batch4_v34_cleanup_recovery.test.ts`
  - `apps/api/tests/batch4_v35_cleanup_fencing.test.ts`
  - `apps/api/tests/batch4_v35_reproduction.test.ts`
  - Root markdown reports (V3.5 suite)
- **Canonical Decision Engine:** `packages/decision-engine` has exactly **0 bytes diff** against baseline (completely untouched).

---

## 2. Infrastructure & Topology Verification

- **MongoDB 3-Node Replica Set (`rs0`):**
  - URI: `mongodb://127.0.0.1:27018/?replicaSet=rs0&directConnection=true`
  - Status: Healthy, active PID 20900.
  - Multi-document transactions: Verified active.
- **MongoDB Standalone Instance:**
  - URI: `mongodb://127.0.0.1:27017`
  - Status: Active PID 5340.
  - Verified to **fail closed** on non-replica set connections.

---

## 3. Inventory of Destructive Operation Paths

- **Production Source Code:**
  The **only** call to `db.dropDatabase()` in production code is in `apps/api/src/db/guard.ts#cleanupTestDatabase()` (line 965).
- **Test Code teardown helpers:**
  Direct teardown invocations exist in test `finally` / `afterAll` blocks across test files to ensure isolated test databases do not leak on test runners.
- **The Call Chain to `db.dropDatabase()`:**
  ```
  cleanupTestDatabase(connection, runId, workerId, options)
    ├── [Stage 0] Empty collection recovery
    ├── [Stage 1] assertCanCleanupTestDatabase
    ├── [Pre-Lock Registry Check] coordCol.findOne
    ├── [Stage 2] metaCol.findOneAndUpdate (OWNED -> CLEANUP_LOCKED, gen++)
    │     └── coordCol.findOneAndUpdate (CLEANUP_LOCKED, gen)
    ├── [Stage 3] metaCol.findOneAndUpdate (CLEANUP_LOCKED -> DROP_IN_PROGRESS)
    │     └── coordCol.findOneAndUpdate (atomic dropExecutionLock: true, dropExecutionToken)
    ├── [Pre-Drop Read] coordCol.findOne (verifiedCoord check)
    └── [UNGUARDED EXECUTION GAP] <--- Preemption / pause window here!
          └── db.dropDatabase()
                └── [Stage 4] coordCol.updateOne (CLEANED)
  ```

---

## 4. The Exact V3.5 Limitation

In V3.5, `cleanupTestDatabase()` executes `verifiedCoord = await coordCol.findOne(...)` at line 938 and validates that `verifiedCoord.dropExecutionToken === currentDropToken`.
However, once `findOne()` returns, Worker A has exited the check.
If Worker A is paused between the return of `findOne()` and the execution of `db.dropDatabase()`, and Worker B or a recovery script modifies `coordCol` during that pause, Worker A upon resuming calls `await db.dropDatabase()`.
The MongoDB driver issues the `dropDatabase` command without any application fencing token, destroying the database after authority was revoked.
