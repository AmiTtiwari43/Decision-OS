# DECISION OS — BATCH 4 REMEDIATION V3.5
## PROTOCOL DESIGN SPECIFICATION: ATOMIC DESTRUCTIVE-ACTION AUTHORITY & MUTUAL EXCLUSION

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit (V3.4):** `00417e0d46e79496268dc786475d3641687167e3`  
**Date:** 2026-11-05  

---

## 1. The Core Distributed Problem

In MongoDB, `db.dropDatabase()` is an administrative collection/database removal command executed outside multi-document ACID transactions (DDL commands cannot run inside MongoDB transactions). Furthermore, the MongoDB server does not accept an application-level fencing token or generation parameter as part of `dropDatabase()`.

Therefore, the sequence:
1. Application CAS on lock document
2. `await db.dropDatabase()`

is inherently **non-atomic at the database server level**.

If Worker A performs step 1, verifies authority, and is paused (e.g. by a JVM/V8 GC pause, event loop starvation, OS thread preemption, or network partition), the MongoDB server will still process `db.dropDatabase()` if Worker A wakes up and issues the command.

If another worker (Worker B) was allowed to revoke Worker A's authority, claim the database, and insert new data while Worker A was paused, Worker A's delayed `dropDatabase()` would destroy Worker B's active database.

---

## 2. Evaluation of Architectural Options

### 2.1 Option 1: Dedicated Coordination Lock with Mutual Exclusion
- **Mechanism:**
  The independent coordination registry (`decision_os_test_coordination_test.cleanup_registry`) maintains an explicit, atomic destructive-execution lock:
  - `dropExecutionLock: boolean`
  - `dropExecutionToken: string` (UUID generated per execution attempt)
  - `lifecycleState: 'DROP_IN_PROGRESS'`
  - `dropStartedAt: Date`
- **Safety Properties:**
  Authority changes (revocation, reassignment, or new ownership claims) and destructive execution are made **mutually exclusive**. While `dropExecutionLock: true` is held, no external worker or API method is permitted to claim, reassign, or alter the target database record.
- **Liveness Properties:**
  Crashed executors can be recovered by the *same* authorized worker/run via idempotent retry. If the executor permanently dies, the database remains locked until recovered; no other worker is affected because test databases are strictly isolated per worker/run.
- **Stale-Process Behavior:**
  Because authority cannot be reassigned while `dropExecutionLock` is held, a paused worker cannot destroy a reassigned database upon resuming.
- **Failure Windows:**
  - Crash before drop: Recoverable by same worker.
  - Crash during drop: Handled via Stage 0 empty-collection reconciliation.
- **Complexity:** Low to Moderate. Directly fits within existing `guard.ts` architecture.

### 2.2 Option 2: Dedicated Cleanup Executor Daemon
- **Mechanism:**
  Workers do not execute `dropDatabase()`. Instead, workers write a durable cleanup request to a coordination queue. A single dedicated cleanup daemon process processes requests sequentially and executes `dropDatabase()`.
- **Safety Properties:**
  Centralized execution eliminates multi-worker drop concurrency.
- **Liveness Properties:**
  Single point of failure; requires separate daemon process, health checking, and IPC queue.
- **Failure Windows:**
  Daemon crash requires leader election or restart logic; worker test completion is blocked if daemon stalls.
- **Complexity:** Very High. Requires significant architectural restructuring beyond the scope of Batch 4.

### 2.3 Option 3: Database-Level Isolation and Disposal
- **Mechanism:**
  Every test database is uniquely named with timestamp, random salt, runId, and workerId. Test databases are never recycled or reassigned to another worker. If a test finishes, it drops its own unique database. If a drop fails or crashes, no other worker ever attempts to use that database name.
- **Safety Properties:**
  Zero cross-worker data contamination risk because databases are never shared or reassigned.
- **Liveness Properties:**
  High. Workers never contend for the same database.
- **Failure Windows:**
  Orphaned databases if workers crash permanently (mitigated by bulk drop scripts targeting expired prefixes).
- **Complexity:** Low.

---

## 3. Chosen Architecture: Combined Option 1 & Option 3

The Decision OS V3.5 protocol synthesizes **Option 1 (Atomic Coordination Lock & Mutual Exclusion)** with **Option 3 (Isolated Database Lifecycle)**:

### 3.1 Mutual Exclusion Against Revocation & Reassignment
The fundamental answer to the Critical Safety Question:
> **If Worker A is paused after its final authorization and Worker B attempts to revoke or reassign A, the protocol strictly prevents Worker B from revoking or reassigning authority while Worker A's destructive execution is in flight.**

Any attempt by a foreign worker or new run to claim ownership (`claimTestDatabaseOwnership`), take over cleanup (`cleanupTestDatabase`), or supersede the record while `dropExecutionLock: true` or `lifecycleState: 'DROP_IN_PROGRESS'` is **STRICTLY REJECTED**.

### 3.2 Atomic CAS Authorization in Coordination Registry
In Stage 3, destructive execution authority is acquired through an atomic `findOneAndUpdate` on `coordCol`:
```typescript
const coordDropLock = await coordCol.findOneAndUpdate(
  {
    _id: dbName as unknown as import('mongodb').ObjectId,
    runId: cleanRun,
    cleanupOwner: cleanWorker,
    cleanupGeneration: activeGeneration,
    lifecycleState: { $in: ['CLEANUP_LOCKED', 'DROP_IN_PROGRESS'] },
    $or: [
      { dropExecutionLock: { $ne: true } },
      ...(isRetry ? [{ dropExecutionLock: true, cleanupOwner: cleanWorker }] : []),
    ],
  },
  {
    $set: {
      lifecycleState: 'DROP_IN_PROGRESS',
      dropInProgress: true,
      dropExecutionLock: true,
      dropExecutionToken: currentExecutionToken,
      dropStartedAt: new Date(),
    },
  },
  { returnDocument: 'after' }
);
```

### 3.3 Fail-Closed Enforcement (Eliminating Defect R2)
If `coordDropLock` is `null`:
- Either the coordination record is missing (Defect R2 resolved).
- Or `runId` does not match.
- Or `cleanupOwner` does not match.
- Or `cleanupGeneration` was superseded.
- Or another executor currently holds `dropExecutionLock`.
- Or the database was already `CLEANED`.

In **ALL** of these cases, the function **FAILS CLOSED IMMEDIATELY** with:
`Safety guard violation: database '${dbName}' destructive drop authority not acquired from coordination registry. Refusing drop.`
It **NEVER** falls through to `db.dropDatabase()`.

### 3.4 In-Process Token & Abort Fencing
Worker A generates a unique `dropExecutionToken` (UUID).
Immediately prior to invoking `db.dropDatabase()`, Worker A verifies that its in-memory `dropExecutionToken` matches the atomic token recorded in `coordDropLock`.
If any administrative or recovery action has superseded the token, Worker A halts immediately.
Furthermore, if Worker B attempts to take over or modify the record, the registry rejects Worker B, guaranteeing that Worker A's execution window remains mutually exclusive.
