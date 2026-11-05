# DECISION OS — BATCH 4 REMEDIATION V3.5
## DEFECT REPRODUCTION EVIDENCE REPORT (R1 & R2)

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit (V3.4):** `00417e0d46e79496268dc786475d3641687167e3`  
**Test File:** `apps/api/tests/batch4_v35_reproduction.test.ts`  
**Date:** 2026-11-05  

---

## 1. Defect R1: Check-Then-Act Destructive Execution Race

### 1.1 Defect Mechanism
In `apps/api/src/db/guard.ts` (lines 758–773 in V3.4):
```typescript
if (coordCol) {
  const latestCoord = await coordCol.findOne({
    _id: dbName as unknown as import('mongodb').ObjectId,
  });
  if (
    latestCoord &&
    (latestCoord.runId !== cleanRun ||
      latestCoord.cleanupOwner !== cleanWorker ||
      (latestCoord.cleanupGeneration !== undefined && latestCoord.cleanupGeneration > activeGeneration) ||
      latestCoord.lifecycleState === 'CLEANED')
  ) {
    throw new Error(
      `Safety guard violation: database '${dbName}' cleanup authority superseded before drop (stale generation ${activeGeneration}).`
    );
  }
}

// Execute dropDatabase
await db.dropDatabase();
```

Because `coordCol.findOne(...)` and `db.dropDatabase()` are two completely separate asynchronous operations:
1. Worker A queries `latestCoord`. The record is found and matches `cleanWorker` and `activeGeneration`.
2. Worker A experiences an execution delay (e.g. GC pause, network latency, event loop starvation).
3. Concurrently, a second worker or administrator modifies or supersedes the coordination record (e.g. assigns a higher generation or reassigns ownership).
4. Worker A resumes. Since Worker A already completed line 772, it proceeds unconditionally to call `db.dropDatabase()`.
5. Worker A executes a destructive drop after its authority was superseded.

### 1.2 Reproduction Test Result
In `apps/api/tests/batch4_v35_reproduction.test.ts`:
```bash
npm --workspace=apps/api test tests/batch4_v35_reproduction.test.ts
```
Output:
```
stdout | tests/batch4_v35_reproduction.test.ts > REPRO-R1: Worker A reads coordination registry, then pauses. Supersession happens, but Worker A still drops
[V3.4 REPRO R1] Did Worker A issue dropDatabase after authority supersession? -> true
```
**Conclusion:** Defect R1 is empirically confirmed. A read immediately before a destructive operation does not constitute atomic serialization against concurrent authority changes.

---

## 2. Defect R2: Missing Coordination Record Fails Open

### 2.1 Defect Mechanism
In lines 758–773 in V3.4:
```typescript
if (coordCol) {
  const latestCoord = await coordCol.findOne({
    _id: dbName as unknown as import('mongodb').ObjectId,
  });
  if (
    latestCoord &&
    (...)
  ) {
    throw new Error(...);
  }
}
```

Notice the predicate `if (latestCoord && ...)`:
- If the coordination record was missing, deleted, or uninitialized, `latestCoord` is `null`.
- The condition `latestCoord && ...` evaluates to `false`.
- The code does not throw an error; it falls through and calls `await db.dropDatabase()`.
- An unverified database whose independent registry entry was deleted or never persisted is destroyed unconditionally.

### 2.2 Reproduction Test Result
In `apps/api/tests/batch4_v35_reproduction.test.ts`:
Output:
```
stdout | tests/batch4_v35_reproduction.test.ts > REPRO-R2: Missing coordination record should fail closed, but in V3.4 it proceeds to drop
[V3.4 REPRO R2] Was drop executed despite missing coordination record? -> true
```
**Conclusion:** Defect R2 is empirically confirmed. When coordination metadata is absent, V3.4 fails open rather than failing closed.

---

## 3. Mandatory Remediation Goals for V3.5
1. Eliminate the check-then-act race by designing a protocol where **authority changes** and **destructive execution** are **mutually exclusive**.
2. Enforce strict **fail-closed** behavior whenever coordination state is missing, malformed, or unverified.
3. Guarantee that a stale executor cannot issue a delayed destructive command after losing authority.
