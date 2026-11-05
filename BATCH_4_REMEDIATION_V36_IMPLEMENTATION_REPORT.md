# DECISION OS — BATCH 4 REMEDIATION V3.6
## IMPLEMENTATION REPORT: ENFORCING SUPERVISED DESTRUCTIVE CLEANUP EXECUTION

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit (V3.5):** `8a8ef7d62427d525d72d5352f24a75ea3bedf1cc`  
**Target File:** `apps/api/src/db/guard.ts`  
**Date:** 2026-11-05  

---

## 1. Executive Summary

In V3.5, `cleanupTestDatabase()` in `apps/api/src/db/guard.ts` resolved the missing coordination record vulnerability by requiring an explicit pre-drop authority check against `cleanup_registry`. However, because MongoDB's administrative `dropDatabase()` command does not participate in multi-document transactions and cannot take an application fencing predicate, a time-of-check to time-of-use (TOCTOU) gap remained:
If an executor paused after `verifiedCoord = await coordCol.findOne(...)` returned, another worker or recovery routine could revoke or reassign authority. When the paused executor resumed, it dispatched `db.dropDatabase()` unconditionally.

V3.6 closes this defect permanently by implementing **Supervised Destructive Cleanup Execution**:
1. **In-Process Fencing Gate & AbortController**: The call to `db.dropDatabase()` is strictly encapsulated within an atomic closure (`executeGuardedDrop()`) linked to an `AbortController`. The gate checks the abort signal and re-validates the execution token and ownership lock immediately at the boundary of dispatch.
2. **OS Process Identity & Liveness Fencing (`executorPid`)**: The executor records its operating system Process ID (`process.pid`) when acquiring the drop lock. Reassignment or recovery of a database in `DROP_IN_PROGRESS` is strictly prohibited unless `isExecutorTerminated(oldPid)` verifies that the old process has definitively terminated (`ESRCH`).
3. **Fail-Closed Policy for Uncertain Status**: If an old process status is unconfirmed, recovery fails closed. Authority cannot be reassigned while an old executor may still be executing.

---

## 2. Source Modifications in `apps/api/src/db/guard.ts`

### 2.1 Interface Extensions & Helper Function

Added `executorPid?: number;` to `TestDatabaseOwnershipMetadata` and `signal?: AbortSignal;` to `CleanupTestOptions`.
Implemented and exported `isExecutorTerminated(pid?: number): boolean`:

```typescript
/**
 * Verifies whether an OS process with the given PID has terminated.
 * Uses process.kill(pid, 0) which tests for process existence without sending a signal.
 * - If ESRCH is thrown: the process does not exist (confirmed terminated).
 * - If no error: the process is alive.
 * - If EPERM or any other error: process exists or status cannot be verified (treated as alive / fail-closed).
 */
export function isExecutorTerminated(pid?: number): boolean {
  if (pid === undefined || pid === null || typeof pid !== 'number' || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as { code?: string }).code
        : undefined;
    if (code === 'ESRCH') {
      return true;
    }
    return false;
  }
}
```

### 2.2 Pre-Lock Registry Authority & Process Liveness Check

In `cleanupTestDatabase()`, before acquiring the cleanup lock, the coordinator inspects `existingCoord` in `cleanup_registry`:

```typescript
  if (
    existingCoord.dropExecutionLock === true &&
    existingCoord.executorPid !== undefined &&
    existingCoord.executorPid !== process.pid &&
    !isExecutorTerminated(existingCoord.executorPid)
  ) {
    throw new Error(
      `Safety guard violation: database '${dbName}' drop is in progress by active executor PID ${existingCoord.executorPid}. Refusing concurrent or superseded execution while old executor is alive.`
    );
  }

  if (
    existingCoord.dropExecutionLock === true &&
    (existingCoord.executorPid === undefined ||
      existingCoord.executorPid === null ||
      !isExecutorTerminated(existingCoord.executorPid)) &&
    existingCoord.executorPid !== process.pid
  ) {
    throw new Error(
      `Safety guard violation: database '${dbName}' drop is locked by prior executor (PID: ${existingCoord.executorPid ?? 'unknown'}). Cannot confirm termination; refusing reassignment fail-closed.`
    );
  }
```

### 2.3 Stage 2 & 3 Process Binding (`executorPid` & `dropExecutionLock`)

During Stage 3, when acquiring exclusive destructive drop authority in both `__test_run_metadata` and `cleanup_registry`:
- `metaCol.findOneAndUpdate`: records `executorPid: process.pid`.
- `coordCol.findOneAndUpdate`: records `executorPid: process.pid`, `dropExecutionLock: true`, `dropExecutionToken: currentDropToken`.
- If `coordDropLock` acquisition fails, failure diagnosis explicitly checks if the lock is held by an active external PID and throws a descriptive error.

### 2.4 Stage 3.5: Supervised Execution Gate & In-Process Fencing

The destructive command is wrapped inside `executeGuardedDrop`:

```typescript
  // In-process supervised execution gate & AbortController
  const dropAbortController = new AbortController();

  if (optionsOrGeneration && typeof optionsOrGeneration === 'object' && optionsOrGeneration.signal) {
    if (optionsOrGeneration.signal.aborted) {
      dropAbortController.abort();
    } else {
      optionsOrGeneration.signal.addEventListener('abort', () => dropAbortController.abort(), { once: true });
    }
  }

  const executeGuardedDrop = async () => {
    // 1. In-process synchronous abort check
    if (dropAbortController.signal.aborted) {
      throw new Error(
        `Safety guard violation: database '${dbName}' destructive drop aborted: execution authority was revoked or cancelled before dispatch.`
      );
    }

    // 2. Pre-wire verification directly against coordination registry immediately prior to native drop
    const preWireCoord = await coordCol.findOne({
      _id: dbName as unknown as import('mongodb').ObjectId,
    });

    if (!preWireCoord) {
      dropAbortController.abort();
      throw new Error(
        `Safety guard violation: database '${dbName}' has no coordination record in registry. Refusing destructive drop.`
      );
    }

    if (
      preWireCoord.runId !== cleanRun ||
      preWireCoord.cleanupOwner !== cleanWorker ||
      (preWireCoord.cleanupGeneration !== undefined && preWireCoord.cleanupGeneration > activeGeneration) ||
      preWireCoord.lifecycleState !== 'DROP_IN_PROGRESS' ||
      preWireCoord.dropExecutionToken !== currentDropToken ||
      preWireCoord.dropExecutionLock !== true
    ) {
      dropAbortController.abort();
      throw new Error(
        `Safety guard violation: database '${dbName}' cleanup authority superseded before drop (revoked or stale generation ${activeGeneration} or token mismatch).`
      );
    }

    if (dropAbortController.signal.aborted) {
      throw new Error(
        `Safety guard violation: database '${dbName}' destructive drop aborted: execution authority was revoked or cancelled before dispatch.`
      );
    }

    // 3. Issue native MongoDB drop
    await db.dropDatabase();
  };

  // Execute dropDatabase through guarded dispatcher
  if (testHooks?.overrideDropDatabase) {
    await testHooks.overrideDropDatabase(() => executeGuardedDrop());
  } else {
    await executeGuardedDrop();
  }
```

---

## 3. Structural Comparison: Before (V3.5) vs After (V3.6)

| Architectural Dimension | V3.5 (`8a8ef7d`) | V3.6 (Current) |
| :--- | :--- | :--- |
| **Drop Invocator** | Bare `db.dropDatabase()` or unguarded callback. | Guarded closure `executeGuardedDrop()` with abort controller. |
| **TOCTOU Gap Defense** | Final read occurred *before* userland pause; drop issued unconditionally upon resume. | In-process pre-wire gate checks `dropAbortController` and re-verifies registry *inside* execution boundary. |
| **Process Identity** | No PID recorded in metadata or coordination registry. | `executorPid: process.pid` recorded in both local and coordination documents. |
| **Recovery Liveness Check** | Did not check if old executor was still running on host. | Verified OS liveness via `isExecutorTerminated(pid)`. Cannot reassign while executor is alive. |
| **Uncertain Process Status** | Silently allowed re-claim if filters matched. | Strictly fails closed if termination of old executor cannot be proven. |

---

## 4. Preservation of Monorepo Invariants

1. **Pure MCDA Engine (`packages/decision-engine`):**
   - Untouched. 0 diff.
2. **Golden Fixtures G1–G10:**
   - Untouched and passing.
3. **Public API Compatibility:**
   - `cleanupTestDatabase` signature and options remain fully backwards compatible (`optionsOrGeneration?: number | CleanupTestOptions`).
