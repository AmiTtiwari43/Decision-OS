# DECISION OS — BATCH 4 REMEDIATION V3.4 IMPLEMENTATION REPORT
**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit:** `19ab21c33e6c1286445c12e584db1fc97e890398`  
**Target File:** `apps/api/src/db/guard.ts`  
**Auditor:** Principal Backend & Distributed Systems Reliability Auditor  

---

## 1. Architectural Design: 4-Stage Coherent Cleanup Lifecycle

To resolve the pre-drop crash recovery defect without weakening ownership checks, cleanup-generation fencing, or database isolation, we established a strict 4-stage lifecycle across the target database and the independent coordination registry (`decision_os_test_coordination_test.cleanup_registry`):

| Stage | State Name | Persisted Fields | Coordination Registry State | Description |
| :---: | :--- | :--- | :--- | :--- |
| **1** | `OWNED` | `lifecycleState: 'OWNED'`, `cleanupInProgress: false`, `dropInProgress: false` | `lifecycleState: 'OWNED'` | Active database owned by test run and worker. |
| **2** | `CLEANUP_LOCKED` | `lifecycleState: 'CLEANUP_LOCKED'`, `cleanupOwner: cleanWorker`, `cleanupInProgress: true`, `dropInProgress: false`, `cleanupGeneration: G+1` | `lifecycleState: 'CLEANUP_LOCKED'` | Cleanup authority claimed. Database still intact. Drop not started. |
| **3** | `DROP_IN_PROGRESS` | `lifecycleState: 'DROP_IN_PROGRESS'`, `dropInProgress: true`, `dropStartedAt: Date` | `lifecycleState: 'DROP_IN_PROGRESS'` | Drop authority claimed. Destructive command issued. |
| **4** | `CLEANED` | *All collections deleted* | `lifecycleState: 'CLEANED'`, `cleanupInProgress: false`, `dropInProgress: false`, `cleanedAt: Date` | Database dropped. Record durably finalized in coordination registry. |

---

## 2. Detailed Implementation Changes in `apps/api/src/db/guard.ts`

### 2.1 Formal Lifecycle State Type Definition
```typescript
export type TestDatabaseLifecycleState =
  | 'OWNED'
  | 'CLEANUP_LOCKED'
  | 'DROP_IN_PROGRESS'
  | 'CLEANED';
```

### 2.2 Test Injection Hooks & Options
Defined `CleanupTestInjectionHooks` and `CleanupTestOptions` to enable deterministic failure injection without production bypasses:
```typescript
export interface CleanupTestInjectionHooks {
  beforeLockAcquisition?: () => Promise<void> | void;
  afterLockAcquired?: (metadata: TestDatabaseOwnershipMetadata) => Promise<void> | void;
  afterRegistrySync?: (metadata: TestDatabaseOwnershipMetadata) => Promise<void> | void;
  beforeDropDatabase?: (metadata: TestDatabaseOwnershipMetadata) => Promise<void> | void;
  overrideDropDatabase?: (originalDrop: () => Promise<unknown>) => Promise<unknown>;
  afterDropBeforeCleaned?: () => Promise<void> | void;
  simulateRegistryError?: boolean;
}

export interface CleanupTestOptions {
  expectedGeneration?: number;
  _testHooks?: CleanupTestInjectionHooks;
}
```

### 2.3 Stage 2: Atomic `CLEANUP_LOCKED` Acquisition
In `cleanupTestDatabase()`:
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
      dropInProgress: false, // Critical fix: NOT true during initial acquisition
    },
    $inc: {
      cleanupGeneration: 1,
    },
  },
  { returnDocument: 'after' }
);
```

### 2.4 Idempotent Retry Recognition
If `cleanupLock` is null:
```typescript
if (
  (existing.lifecycleState === 'CLEANUP_LOCKED' ||
    existing.lifecycleState === 'DROP_IN_PROGRESS') &&
  existing.cleanupOwner === cleanWorker
) {
  // Valid idempotent retry by the same crash-recovery cleanup owner
  activeGeneration = existing.cleanupGeneration || 1;
  isRetry = true;
} else {
  throw new Error(
    `Safety guard violation: database '${dbName}' cleanup lock acquisition failed (already in progress or ownership lost).`
  );
}
```

### 2.5 Stage 3: Drop Serialization & Monotonic Fencing
Before invoking `db.dropDatabase()`:
```typescript
const dropFilter: import('mongodb').Filter<import('mongodb').Document> = {
  _id: 'ownership_lock',
  runId: cleanRun,
  cleanupOwner: cleanWorker,
  cleanupGeneration: activeGeneration,
  $or: [
    { lifecycleState: 'CLEANUP_LOCKED', dropInProgress: { $ne: true } },
    ...(isRetry ? [{ lifecycleState: 'DROP_IN_PROGRESS', cleanupOwner: cleanWorker }] : []),
  ],
};

const dropLock = await metaCol.findOneAndUpdate(
  dropFilter,
  {
    $set: {
      lifecycleState: 'DROP_IN_PROGRESS',
      dropInProgress: true,
      dropStartedAt: new Date(),
      ...(isRetry ? { dropRetriedAt: new Date() } : {}),
    },
  },
  { returnDocument: 'after' }
);

if (!dropLock) {
  throw new Error(
    `Safety guard violation: database '${dbName}' drop is already in progress concurrently by worker '${cleanWorker}'.`
  );
}
```

### 2.6 Pre-Drop Stale Process Fencing Check
To guarantee Property F ("Destructive-operation safety"), immediately before calling `db.dropDatabase()`:
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
```
If a stalled process loses its authority or generation while paused, it detects the change in the coordination registry and aborts immediately without calling `db.dropDatabase()`.

### 2.7 Stage 4: Post-Drop Recovery on Empty Database
When `collections.length === 0`:
```typescript
if (
  regDoc &&
  regDoc.runId === cleanRun &&
  (regDoc.workerId === cleanWorker || regDoc.cleanupOwner === cleanWorker) &&
  (regDoc.lifecycleState === 'CLEANUP_LOCKED' ||
    regDoc.lifecycleState === 'DROP_IN_PROGRESS' ||
    regDoc.lifecycleState === 'CLEANED')
) {
  if (expectedGen !== undefined && regDoc.cleanupGeneration !== undefined && regDoc.cleanupGeneration !== expectedGen) {
    throw new Error(
      `Safety guard violation: database '${dbName}' cleanup generation ${expectedGen} is superseded by newer generation ${regDoc.cleanupGeneration}.`
    );
  }
  if (regDoc.lifecycleState !== 'CLEANED') {
    await coordCol.updateOne(
      {
        _id: dbName as unknown as import('mongodb').ObjectId,
        runId: cleanRun,
        cleanupGeneration: regDoc.cleanupGeneration,
        lifecycleState: { $in: ['CLEANUP_LOCKED', 'DROP_IN_PROGRESS'] },
      },
      {
        $set: {
          lifecycleState: 'CLEANED',
          cleanedAt: new Date(),
          cleanupInProgress: false,
          dropInProgress: false,
        },
      }
    );
  }
  return;
}
```
