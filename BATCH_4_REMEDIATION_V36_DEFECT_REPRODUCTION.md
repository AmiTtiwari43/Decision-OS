# DECISION OS — BATCH 4 REMEDIATION V3.6
## DEFECT REPRODUCTION REPORT: STALE-EXECUTOR DESTRUCTIVE-ACTION RACE

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit (V3.5):** `8a8ef7d62427d525d72d5352f24a75ea3bedf1cc`  
**Reproduction Test File:** `apps/api/tests/batch4_v36_reproduction.test.ts`  
**Date:** 2026-11-05  

---

## 1. Executive Summary

In V3.5 (`8a8ef7d62427d525d72d5352f24a75ea3bedf1cc`), `apps/api/src/db/guard.ts` introduced a coordination lock, ownership token validation, and a pre-drop check (`verifiedCoord = await coordCol.findOne(...)`).

However, the destructive execution flow retains a fundamental check-then-act timing gap:
1. Executor A acquires the drop execution token and enters `DROP_IN_PROGRESS`.
2. Executor A performs the final read of `cleanup_registry` and verifies `dropExecutionToken === currentDropToken`.
3. The read returns successfully from MongoDB.
4. **Pause Window**: Executor A experiences a process pause, event-loop starvation, GC stall, or network latency prior to dispatching `db.dropDatabase()`.
5. During this pause window, Worker B or a recovery routine modifies the coordination record, revoking Executor A's authority or assigning authority to Worker B.
6. Executor A resumes. Because Executor A has already passed the application-level check, it proceeds to invoke `await db.dropDatabase()`.
7. MongoDB's native wire protocol for `dropDatabase` does not accept application fencing tokens.
8. As a result, Executor A destroys the database despite having had its authority revoked.

This report documents the empirical reproduction of this defect against the clean V3.5 baseline using a real MongoDB replica set.

---

## 2. Source Code Path & The Unguarded Gap

The vulnerable execution sequence in `apps/api/src/db/guard.ts` (lines 938–966 of commit `8a8ef7d62427d525d72d5352f24a75ea3bedf1cc`):

```typescript
// Stage 3.5: Final pre-drop verification of registry authority
const verifiedCoord = await coordCol.findOne({ _id: dbName as unknown as import('mongodb').ObjectId });
if (!verifiedCoord) {
  throw new Error(
    `[DB Guard] Cleanup pre-drop authority check failed: coordination record for '${dbName}' not found.`
  );
}

if (
  verifiedCoord.dropExecutionToken !== currentDropToken ||
  verifiedCoord.cleanupOwner !== effectiveWorkerId ||
  verifiedCoord.cleanupGeneration !== effectiveGen ||
  verifiedCoord.dropExecutionLock !== true
) {
  throw new Error(
    `[DB Guard] Cleanup pre-drop authority check failed: token or generation mismatch for '${dbName}'.`
  );
}

// =========================================================================
// [UNGUARDED EXECUTION GAP]
// The check above has returned. No thread preemption or event-loop pause
// can be caught by 'verifiedCoord'. If the worker pauses here and authority
// is reassigned, the call below will execute regardless!
// =========================================================================

if (testHooks?.overrideDropDatabase) {
  await testHooks.overrideDropDatabase(() => db.dropDatabase());
} else {
  await db.dropDatabase();
}
```

Because MongoDB's `dropDatabase` command is an un-fenced administrative operation on the server, any process that reaches line 965 will drop the database regardless of what changes occurred in `cleanup_registry` after line 959.

---

## 3. Empirical Test Reproduction (`REPRO-V36-01`)

The reproduction test `apps/api/tests/batch4_v36_reproduction.test.ts` was executed against the V3.5 baseline without any modifications to production code.

### 3.1 Test Interleaving Sequence

1. **Setup**: Create an isolated test database `decision_os_v36_repro` on replica set `rs0` (`mongodb://127.0.0.1:27018`).
2. **Claim Ownership**: Worker A claims ownership via `claimTestDatabaseOwnership(conn, runId, 'w36A')`.
3. **Insert Data**: Populate `test_items` with a canary document `{ item: 'repro_evidence_v36' }`.
4. **Initiate Cleanup**: Invoke production `cleanupTestDatabase(conn, runId, 'w36A')`.
5. **Simulate Pause**: Using the `overrideDropDatabase` test hook (which is invoked strictly *after* the `verifiedCoord` check passes), capture the callback and pause Worker A.
6. **Intervening Revocation**: While Worker A is paused, an external actor (simulating Worker B or recovery) directly revokes Worker A in `cleanup_registry`:
   ```typescript
   await coordCol.updateOne(
     { _id: dbName },
     {
       $set: {
         cleanupOwner: 'w36B',
         cleanupGeneration: 999,
         dropExecutionToken: 'revoked_by_worker_B',
         dropExecutionLock: false,
       },
     }
   );
   ```
7. **Resume Worker A**: Worker A resumes and executes `invokeDrop()` (calling `db.dropDatabase()`).
8. **Observe Outcome**: Worker A's drop operation succeeds on the MongoDB cluster, and `colsAfter.length === 0`.

### 3.2 Vitest Reproduction Output

```
 RUN  v2.1.9 c:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/apps/api

stdout | tests/batch4_v36_reproduction.test.ts > DECISION OS — BATCH 4 V3.6 DEFECT REPRODUCTION > REPRO-V36-01: In V3.5, Worker A executes dropDatabase() after passing final check, even if authority was revoked during pause
[V3.5 REPRO GAP] Did Worker A issue dropDatabase() after its authority was revoked? -> true

 ✓ tests/batch4_v36_reproduction.test.ts (1 test) 449ms
   ✓ DECISION OS — BATCH 4 V3.6 DEFECT REPRODUCTION > REPRO-V36-01: In V3.5, Worker A executes dropDatabase() after passing final check, even if authority was revoked during pause 448ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  21:54:12
   Duration  940ms
```

### 3.3 Confirmation Verdict

- **Result:** Defect reproduced empirically.
- **Evidence:** `Did Worker A issue dropDatabase() after its authority was revoked? -> true`.
- **Conclusion:** The V3.5 check-then-act sequence fails to prevent stale destructive execution when authority revocation or supersession occurs between the validation read and the execution of `db.dropDatabase()`.

---

## 4. Root Cause Analysis

1. **Protocol Asymmetry**:
   In-database operations (like CRUD or document updates) can be conditionally fenced inside a transaction or via an atomic query filter like `{ _id: dbName, dropExecutionToken: token }`. But administrative drop commands (`db.dropDatabase()`) cannot be executed within a multi-document transaction and do not accept a conditional predicate filter.
2. **Lacking Execution Supervision**:
   Once authority is granted to an executor, the coordination registry in V3.5 assumed that authority could be reassigned merely by writing a new owner or token to `cleanup_registry`. If the prior executor was still alive and paused, reassigning authority created two concurrent entities capable of issuing drops or conflicting operations.
3. **Absence of OS / In-Process Fencing Barriers**:
   The executor lacked a cooperative in-process abort barrier (such as an `AbortController` coupled to authority state) and the recovery engine lacked an OS process termination check (`isProcessTerminated(pid)`) before allowing any recovery or reassignment.

---

## 5. Remediation Objectives for V3.6

1. **Supervised Destructive Cleanup Execution**:
   Tie drop execution to a supervised lifecycle where the supervisor manages an `AbortController` and monitors the active executor PID.
2. **Cooperative In-Process Fencing Gate**:
   Immediately wrap the invocation of `db.dropDatabase()` in a pre-wire fencing gate that listens for revocation/abort signals and validates authority synchronously at the boundary of dispatch.
3. **Confirmed OS Process Termination Before Reassignment**:
   In multi-process environments, strictly prohibit reassignment of `DROP_IN_PROGRESS` databases to any new worker unless the previous executor process is confirmed dead (`ESRCH` via `process.kill(pid, 0)`).
4. **Strict Fail-Closed Recovery**:
   If process status is uncertain, recovery must refuse to reassign authority, remaining fail-closed.
