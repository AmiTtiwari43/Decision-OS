# DECISION OS — BATCH 4 REMEDIATION V3.4 BASELINE REPORT
**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit:** `19ab21c33e6c1286445c12e584db1fc97e890398`  
**Previous Baseline:** V3.3  
**Audit Date:** 2026-11-05  
**Auditor:** Principal Backend, MongoDB Distributed Systems & Reliability Auditor  

---

## 1. Executive Summary

This baseline report captures the state of the repository, source implementations, call graphs, and exact database state transitions prior to the V3.4 remediation.

V3.3 resolved dispatcher acknowledgement classification, consumer failure lease fencing, durable destination idempotency with crash window proof, server-side atomic generation advancement, and empty test database guard bypasses. However, an independent audit of the test database cleanup recovery path identified a critical flaw in pre-drop crash recovery:
The initial lock acquisition in `cleanupTestDatabase()` set `dropInProgress: true` simultaneously with `lifecycleState: 'CLEANUP_LOCKED'`. If a process crashed before `db.dropDatabase()` executed, a subsequent recovery attempt queried `dropInProgress: { $ne: true }`, which rejected the actual state created by the initial production path.

---

## 2. Baseline Git Verification

- **Branch:** `fix/batch4-replica-set-transactional-recovery`
- **HEAD Commit SHA:** `19ab21c33e6c1286445c12e584db1fc97e890398`
- **Commit Message:** `fix(batch4): close v3.2 dispatcher, consumer and cleanup reliability gaps`
- **Working Tree:** Verified clean before V3.4 modifications.
- **Canonical Decision Engine:** Verified byte-for-byte identical to baseline (`git diff packages/decision-engine` returned 0 bytes).

---

## 3. Pre-Remediation Source Analysis (`apps/api/src/db/guard.ts`)

### 3.1 Initial Atomic Lock Acquisition (V3.3)
Lines 507–528 in `apps/api/src/db/guard.ts`:
```typescript
const cleanupLock = await metaCol.findOneAndUpdate(
  {
    _id: 'ownership_lock',
    runId: cleanRun,
    workerId: cleanWorker,
    lifecycleState: 'OWNED',
    cleanupInProgress: { $ne: true },
  },
  {
    $set: {
      lifecycleState: 'CLEANUP_LOCKED',
      cleanupInProgress: true,
      cleanupOwner: cleanWorker,
      cleanupStartedAt: new Date(),
      dropInProgress: true, // <-- CRITICAL DEFECT: set prematurely during lock acquisition
    },
    $inc: {
      cleanupGeneration: 1,
    },
  },
  { returnDocument: 'after' }
);
```

### 3.2 Pre-Drop Crash Window
Between lines 528 (lock acquired) and line 653 (`await db.dropDatabase()`):
- Target database persists with `__test_run_metadata` containing:
  - `lifecycleState: 'CLEANUP_LOCKED'`
  - `cleanupOwner: cleanWorker`
  - `cleanupInProgress: true`
  - `cleanupGeneration: 1`
  - `dropInProgress: true`
- Database collections remain intact (`collections.length > 0`).

### 3.3 Retry Recovery Path Rejection
Lines 572–593 in `apps/api/src/db/guard.ts`:
```typescript
if (
  existing.lifecycleState === 'CLEANUP_LOCKED' &&
  existing.cleanupOwner === cleanWorker
) {
  const dropLock = await metaCol.findOneAndUpdate(
    {
      _id: 'ownership_lock',
      runId: cleanRun,
      cleanupOwner: cleanWorker,
      lifecycleState: 'CLEANUP_LOCKED',
      dropInProgress: { $ne: true }, // <-- FAILS: matches 0 documents because dropInProgress === true
    },
    {
      $set: {
        dropInProgress: true,
        dropRetriedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (!dropLock) {
    throw new Error(
      `Safety guard violation: database '${dbName}' drop is already in progress concurrently by worker '${cleanWorker}'.`
    );
  }
  ...
}
```

Because `dropInProgress` was set to `true` during the initial transition from `OWNED`, any crash before `dropDatabase()` left the document with `dropInProgress: true`. The recovery predicate `dropInProgress: { $ne: true }` unconditionally failed, throwing a safety guard violation and permanently blocking retry recovery.

---

## 4. Call Graph & Affected Callers

`cleanupTestDatabase()` is invoked across:
1. `apps/api/tests/batch4_v34_cleanup_recovery.test.ts`
2. `apps/api/tests/batch4_v34_reproduction.test.ts`
3. `apps/api/tests/batch4_v33_adversarial.test.ts` (D33-19 to D33-28)
4. `apps/api/tests/batch4_v33_reproduction.test.ts` (REPRO-F-V32-04)
5. `apps/api/tests/batch4_v32_adversarial.test.ts` (D6-T1 to D6-T9)
6. `apps/api/tests/batch4_v31_remediation.test.ts`
7. `apps/api/tests/batch4_r6_isolation.test.ts`
8. `apps/api/tests/dbGuard.test.ts`
9. Global test setup and teardown fixtures throughout `apps/api/tests`.

---

## 5. Scope & Invariants

1. **Pure MCDA Invariance:** `packages/decision-engine` remains 100% untouched (0 diff). Golden test fixtures G1–G10 must pass with zero numerical deviation.
2. **MongoDB Replica Set ACID Transactions:** Multi-document transactional recovery must use MongoDB replica set `rs0` on port 27018 with write concern `majority`.
3. **Fail-Closed Standalone Guard:** Standalone MongoDB on port 27017 must fail closed immediately for recovery transactions.
4. **Deterministic Testing:** Zero arbitrary sleeps. All failure injections must use deterministic hooks.
