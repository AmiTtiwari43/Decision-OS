# DECISION OS — BATCH 4 REMEDIATION V3.6
## WRITE-PATH & DESTRUCTIVE AUTHORITY AUDIT

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit (V3.5):** `8a8ef7d62427d525d72d5352f24a75ea3bedf1cc`  
**Date:** 2026-11-05  

---

## 1. Executive Summary

This write-path audit examines the destructive cleanup lifecycle in `apps/api/src/db/guard.ts` under distributed-systems stress, partial failures, concurrency races, network partitions, and process crashes.

The audit explicitly answers all 12 critical questions governing destructive operations on MongoDB replica sets.

---

## 2. Comprehensive Answers to the 12 Critical Write-Path Invariants

### Q1: What prevents a paused worker from completing `dropDatabase()` after authority is revoked?
**Answer:** The **Supervised In-Process Execution Gate** (`executeGuardedDrop()`).
In V3.6, the native invocation of `db.dropDatabase()` is strictly encapsulated within `executeGuardedDrop()`.
When a worker resumes from an event-loop pause, GC stall, or userland yield:
1. It synchronously evaluates `dropAbortController.signal.aborted`.
2. It executes a pre-wire re-verification of the coordination record in `cleanup_registry` immediately prior to issuing the wire command.
3. If authority was revoked, if `dropExecutionToken` does not match, or if `cleanupOwner` or `cleanupGeneration` changed, the gate trips `dropAbortController.abort()`, throws a `Safety guard violation`, and halts execution without issuing `db.dropDatabase()`.

### Q2: What prevents two workers from executing `dropDatabase()` concurrently on the same database?
**Answer:** **Atomic CAS Locks across Two Independent Document Stores.**
Both `__test_run_metadata` in the target database and `cleanup_registry` in the durable coordination database require an atomic transition:
- In `__test_run_metadata`: `{ lifecycleState: 'CLEANUP_LOCKED', dropInProgress: { $ne: true } }` $\rightarrow$ `{ lifecycleState: 'DROP_IN_PROGRESS', dropInProgress: true, dropExecutionLock: true }`.
- In `cleanup_registry`: `{ dropExecutionLock: { $ne: true } }` $\rightarrow$ `{ dropExecutionLock: true, dropExecutionToken: uniqueToken, executorPid: process.pid }`.
MongoDB enforces single-document atomicity with primary write-concern. Only one worker can successfully match `{ dropExecutionLock: { $ne: true } }`. The losing worker fails `findOneAndUpdate`, is diagnosed as concurrent, and is rejected fail-closed.

### Q3: What prevents an old process that was killed or stopped from executing a delayed drop?
**Answer:** **OS Process Termination Proof (`isExecutorTerminated`) & Revoked Execution Tokens.**
If an old process is stopped or paused:
- A new worker cannot take over or reassign authority as long as the old process PID exists on the host (`isExecutorTerminated(pid)` returns `false`).
- If the old process was killed (`SIGKILL` / `ESRCH`), the process no longer exists and can never execute code.
- If the old process resumed before dying, its execution token no longer matches the registry, triggering immediate abort at the execution gate before `db.dropDatabase()` is called.

### Q4: How does the system distinguish between a worker crash and a network timeout?
**Answer:** **Safe Idempotent Reconciliation without Assumption.**
The system never assumes a timeout means the process or command succeeded or failed:
- If a timeout occurs during `dropDatabase()`, the target database may or may not have been dropped.
- The recovery routine inspects the physical database state via `db.listCollections().toArray()`.
- If `collections.length === 0`: the drop succeeded on the cluster; recovery safely advances the registry to `CLEANED`.
- If `collections.length > 0`: the drop did not complete; recovery checks `isExecutorTerminated(executorPid)` and ownership metadata before permitting a serialized retry.

### Q5: How does the system handle an orphaned lock when the holding worker dies without cleanup?
**Answer:** **Liveness Fencing & Confirmed Process Termination Recovery.**
When a worker dies while holding `dropExecutionLock: true`:
- The lock document retains `executorPid: deadPid`.
- Any subsequent worker or recovery routine calling `cleanupTestDatabase()` inspects `existingCoord.executorPid`.
- It executes `isExecutorTerminated(deadPid)` via `process.kill(deadPid, 0)`.
- If `ESRCH` is confirmed (the dead PID does not exist on the OS), the lock is classified as orphaned by a dead process.
- The recovery worker is then permitted to claim the cleanup lock, increment `cleanupGeneration`, mint a fresh `dropExecutionToken`, and complete cleanup.
- If the PID status cannot be confirmed (e.g. cross-host without cluster-wide supervisor), the protocol fails closed and requires manual operator intervention.

### Q6: What prevents a worker from dropping a database that has already been reassigned?
**Answer:** **Generation Fencing & Token Affinity.**
Reassigning a database requires advancing `cleanupGeneration` via atomic `$inc: { cleanupGeneration: 1 }` and minting a new cryptographically random `dropExecutionToken`. The old worker's tokens are invalidated. When the old worker enters `executeGuardedDrop()`, `preWireCoord.dropExecutionToken !== currentDropToken` and `preWireCoord.cleanupGeneration > activeGeneration`, causing immediate abort.

### Q7: What prevents a stale generation worker from executing a destructive command?
**Answer:** **Monotonic Generation Guards in Filter Predicates.**
Every phase (Stage 2 lock, Stage 3 drop lock, and Stage 3.5 pre-wire gate) explicitly queries `cleanupGeneration: activeGeneration`. If a newer generation exists in either `__test_run_metadata` or `cleanup_registry`, the atomic update or verification check fails with `cleanup authority superseded before drop (stale generation X, active Y)`.

### Q8: What happens if the coordination registry itself is partitioned or unavailable during cleanup?
**Answer:** **Strict Immediate Fail-Closed Refusal.**
Both `assertCanCleanupTestDatabase()` and `cleanupTestDatabase()` require active connectivity to `cleanup_registry`:
- If `!coordCol` or if the coordination database query fails/times out, the method immediately throws `Safety guard violation: coordination registry unavailable. Refusing cleanup.`
- The target database is never modified, dropped, or unlocked when the registry is unreachable.

### Q9: What happens if a worker dies after `dropDatabase()` succeeds but before the registry is updated?
**Answer:** **Zero-Collection Fast-Path Reconciliation (Stage 0).**
If `db.dropDatabase()` succeeds on MongoDB, all collections in the target database are deleted.
When recovery or a subsequent test run calls `cleanupTestDatabase()`:
1. Stage 0 executes `await db.listCollections().toArray()`.
2. Seeing `collections.length === 0`, it verifies that the caller owns the database in `cleanup_registry` and was in `CLEANUP_LOCKED` or `DROP_IN_PROGRESS`.
3. It updates `cleanup_registry` to `lifecycleState: 'CLEANED'`, sets `dropExecutionLock: false`, and returns successfully.
No redundant or conflicting drop is dispatched.

### Q10: How does the protocol handle rapid worker restarts with the same worker identity?
**Answer:** **In-Process vs Inter-Process Distinctions & OS PID Checks.**
- If a worker restarts in a new OS process, `process.pid` changes.
- If the previous process holding `dropExecutionLock: true` has terminated, `isExecutorTerminated(oldPid)` returns `true`, allowing the restarted worker to recover cleanly.
- If the old process is still alive (e.g. hung in background), the new process detects that `executorPid !== process.pid && !isExecutorTerminated(oldPid)` and refuses to proceed, preventing split-brain execution between two processes sharing the same worker identity.

### Q11: What guarantees that a database dropped outside the protocol is detected and handled safely?
**Answer:** **Empty Database Registry Verification (Stage 0).**
If an actor drops a database directly via an external shell:
- An unauthorized caller attempting to call `cleanupTestDatabase()` on the empty database cannot bypass ownership checks: Stage 0 queries `cleanup_registry`.
- If the database has no verified record or is owned by a different run, Stage 0 throws:
  `Safety guard violation: database '${dbName}' has no collections and no verified cleanup lock in registry. Refusing cleanup.`
- A non-owned empty database cannot be falsely claimed or sanitized.

### Q12: What are the absolute limits of application-level fencing for destructive operations on MongoDB?
**Answer:** **Application Boundary vs Database Engine Reality.**
- **Within Application Scope:** For all cooperative processes running application code, the protocol provides mathematical and deterministic safety against TOCTOU races, concurrency stalls, GC pauses, and recovery retries.
- **Outside Application Scope (Absolute Limits):** MongoDB does not provide row-level locking, user-space token predicates, or transactional boundaries for administrative commands like `db.dropDatabase()`. Therefore, if an uncooperative, privileged actor or external process holding admin credentials sends the wire command `{"dropDatabase": 1}` directly to `mongod` over a raw TCP socket, MongoDB will execute the drop regardless of what is recorded in any application collection. Claiming that application-level code can fence an external root administrator issuing direct database engine commands is physically impossible. Fencing is absolute within the cooperative application boundary and fails closed at all borders.
