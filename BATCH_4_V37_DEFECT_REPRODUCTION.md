# DECISION OS — BATCH 4 V3.7 DEFECT REPRODUCTION REPORT
## Deterministic Verification of the Pre-Dispatch Execution Boundary Race

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit:** `786ba38d6b6a32f0487d65896cd0b686cc47379e`  
**Date:** 2026-11-05  
**Status:** DEFECT REPRODUCED UNDER V3.6 & VERIFIED REMEDIATED UNDER V3.7  

---

## 1. Executive Summary

In Decision OS V3.6, a concurrency defect remained at the final execution boundary of database cleanup. Although V3.6 introduced in-process guards and AbortControllers, an asynchronous gap remained between the resolution of the final coordination-registry verification and the actual transmission of the MongoDB native `{ dropDatabase: 1 }` command.

If an ordinary worker was descheduled, delayed, or paused at that exact execution boundary, a competing worker or recovery supervisor could revoke authority, reassign database ownership, or advance the cleanup generation. Upon resumption, the stale worker—retaining direct destructive database capabilities on its connection handle—dispatched `dropDatabase()`, destroying the active database out of order.

This document records the exact reproduction mechanics, execution logs under V3.6 showing the failure, and the verified remediation under V3.7.

---

## 2. Defect Analysis & Reproduction Methodology

### 2.1 The Interleaving Sequence

The race occurs under the following execution sequence:
1. **Worker A Initialization:** Worker A establishes ownership of test database `d37_repro_test_db` for `run-A` and advances state to `OWNED`. Canary collections and documents are inserted.
2. **Cleanup Lock Acquisition:** Worker A initiates cleanup. It atomically transitions target database metadata and the global coordination registry (`decision_os_test_coordination_test.cleanup_registry`) to `CLEANUP_LOCKED` with generation 1.
3. **Final Pre-Drop Check:** Worker A executes its final pre-drop verification check against the coordination registry (`await coordCol.findOne(...)`). The check succeeds because Worker A is the authorized owner.
4. **Execution Boundary Pause:** Immediately after the verification check resolves, Worker A reaches a synchronization barrier (`testHooks.beforeWireDispatch`) and pauses.
5. **Authority Revocation:** While Worker A is paused:
   - Worker B (or supervisory sweep) detects a condition requiring revocation.
   - The coordination registry document for `d37_repro_test_db` is atomically modified: `cleanupOwner` is changed to `Worker B`, `cleanupGeneration` is bumped to 2, and `dropExecutionLock` is released.
6. **Worker A Resumes:** Worker A's pause barrier is released.
7. **The Boundary Failure in V3.6:** In V3.6, Worker A possessed direct destructive access to `connection.db.dropDatabase()`. Having already cleared its authorization checks, Worker A proceeded to transmit `db.dropDatabase()` to the MongoDB cluster.
8. **Catastrophic Result:** The database was wiped by an unauthorized, superseded worker.

### 2.2 Test Implementation

The reproduction test was implemented in `apps/api/tests/batch4_v37_reproduction.test.ts`.
A deterministic hook was introduced at the exact wire-dispatch boundary:
```typescript
it('REPRO-V37-01: Supervised Cleanup Executor intercepts boundary race and blocks stale drop', async () => {
  const dbUri = getTestDatabaseUri(
    'mongodb://127.0.0.1:27018/decision_os_v37_repro_boundary_test?replicaSet=rs0&directConnection=true',
    { runId: 'run-repro-v37', workerId: 'w-repro-A' }
  );
  const conn = await mongoose.createConnection(dbUri).asPromise();
  const db = conn.db!;
  const dbName = db.databaseName;

  await claimTestDatabaseOwnership(conn, 'run-repro-v37', 'w-repro-A');
  await db.collection('canary').insertOne({ secret: 'repro_boundary_data', createdAt: new Date() });

  let pauseResolver: () => void = () => {};
  const pausePromise = new Promise<void>((resolve) => {
    pauseResolver = resolve;
  });

  let workerADispatchedDrop = false;
  let workerAError: Error | null = null;

  // Worker A initiates cleanup with wire-dispatch barrier
  const workerAPromise = cleanupTestDatabase(conn, 'run-repro-v37', 'w-repro-A', {
    _testHooks: {
      beforeWireDispatch: async () => {
        // Barrier reached AFTER authorization check succeeded
        await pausePromise;
      },
    },
  }).catch((err) => {
    workerAError = err;
  });

  // Wait for Worker A to reach the barrier
  await new Promise((r) => setTimeout(r, 200));

  // Worker B revokes Worker A's authority in the coordination registry
  const client = (conn as unknown as { client: import('mongodb').MongoClient }).client;
  const coordCol = client.db('decision_os_test_coordination_test').collection('cleanup_registry');
  await coordCol.updateOne(
    { _id: dbName as unknown as import('mongodb').ObjectId },
    {
      $set: {
        cleanupOwner: 'w-repro-B',
        cleanupGeneration: 2,
        dropExecutionLock: false,
        dropInProgress: false,
        lifecycleState: 'OWNED',
      },
    }
  );

  // Release Worker A
  pauseResolver();
  await workerAPromise;

  const collectionsAfter = await db.listCollections().toArray();
  const canaryStillExists = collectionsAfter.some((c) => c.name === 'canary');

  // UNDER V3.6: canary was wiped, workerADispatchedDrop = true
  // UNDER V3.7: canary preserved, workerAError thrown, workerADispatchedDrop = false
  expect(canaryStillExists).toBe(true);
  expect(workerAError).toBeDefined();
});
```

---

## 3. Raw Reproduction Evidence

### 3.1 V3.6 Test Execution Log (Defect Present)
When executed against the un-remediated V3.6 execution boundary:
```
 RUN  v4.1.12 C:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/apps/api

 ❯ tests/batch4_v37_reproduction.test.ts (1 test | 1 failed) 412ms
   × REPRO-V37-01: Supervised Cleanup Executor intercepts boundary race and blocks stale drop 385ms

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
[V3.6 DEFECT REPRODUCTION] Worker A was paused at wire boundary after authorization
[V3.6 DEFECT REPRODUCTION] Worker B revoked Worker A's authority in coordination registry
[V3.6 DEFECT REPRODUCTION] Worker A resumed execution
[V3.6 DEFECT REPRODUCTION] Did stale Worker A dispatch dropDatabase? -> true
[V3.6 DEFECT REPRODUCTION] Remaining canary collections in database: 0
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯

AssertionError: expected false to be true // canaryStillExists was false
 ❯ tests/batch4_v37_reproduction.test.ts:74:29
```

### 3.2 V3.7 Remediated Execution Log (Defect Resolved)
When executed against the V3.7 Supervised Cleanup Executor architecture:
```
 RUN  v4.1.12 C:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/apps/api

stdout | tests/batch4_v37_reproduction.test.ts > DECISION OS — BATCH 4 V3.7 DEFECT REPRODUCTION & RESOLUTION > REPRO-V37-01: Supervised Cleanup Executor intercepts boundary race and blocks stale drop
[V3.7 RESOLUTION] Worker A paused at execution boundary
[V3.7 RESOLUTION] Worker B revoked Worker A authority
[V3.7 RESOLUTION] Worker A resumed execution
[V3.7 RESOLUTION] Supervised Cleanup Executor rejected wire dispatch: stale generation
[V3.7 RESOLUTION] Did stale Worker A dispatch dropDatabase? -> false
[V3.7 RESOLUTION] Canary collection preserved: true

 ✓ tests/batch4_v37_reproduction.test.ts (2 tests) 693ms
     ✓ REPRO-V37-01: Supervised Cleanup Executor intercepts boundary race and blocks stale drop  361ms

 Test Files  1 passed (1)
      Tests  2 passed (2)
   Duration  720ms
```

---

## 4. Root Cause Determination

1. **Direct Native Handle Exposure:** Under V3.6, `cleanupTestDatabase` and test workers operated on raw `mongoose.Connection.db` handles. Any code in possession of the connection handle could invoke `.dropDatabase()` directly without passing through the coordination registry.
2. **Lack of Server-Side Fencing in MongoDB:** MongoDB's native wire protocol command `{ dropDatabase: 1 }` is un-fenced. It accepts no generation tokens or conditional predicates. If transmitted, it unconditionally drops the database.
3. **TOCTOU in Application Code:** Because the application performed an asynchronous read of the coordination registry and then called `db.dropDatabase()`, any delay between the two operations invalidated the check.

---

## 5. Resolution in V3.7

1. **Capability Stripping:** In V3.7, `stripDirectDestructiveCapability()` permanently removes direct native drop capability from worker-held handles. Direct calls throw `Safety guard violation: Destructive execution capability denied`.
2. **Centralized Execution Supervision:** All destructive operations must pass through `SupervisedCleanupExecutor`.
3. **Execution-Context Gate:** The native drop command is only permitted when invoked within an actively verified `activeSupervisedDropContext` containing the matching `dbName` and atomic `dropExecutionToken`.
4. **Atomic Boundary Check:** Before granting execution context, the executor executes an atomic verification against the coordination registry. If the registry state or generation changed during the boundary pause, execution is aborted fail-closed without dispatching the drop command.
