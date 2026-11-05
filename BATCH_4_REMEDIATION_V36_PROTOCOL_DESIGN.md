# DECISION OS — BATCH 4 REMEDIATION V3.6
## PROTOCOL DESIGN SPECIFICATION: SUPERVISED DESTRUCTIVE CLEANUP EXECUTION

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit (V3.5):** `8a8ef7d62427d525d72d5352f24a75ea3bedf1cc`  
**Date:** 2026-11-05  

---

## 1. Threat Model & Operational Distinctions

When designing a robust distributed protocol for destructive operations on MongoDB (specifically `db.dropDatabase()`), we must delineate the boundaries of authority and execution:

### 1.1 Category A: Cooperative Application Workers
- **Definition:** Application processes and workers that adhere to the Decision OS runtime protocols, execute code through `apps/api/src/db/guard.ts`, respect coordination leases, and respond to coordination signals.
- **Protocol Guarantee:** For cooperative workers, all transitions between `OWNED`, `CLEANUP_LOCKED`, `DROP_IN_PROGRESS`, and `CLEANED` occur via atomic CAS updates in `cleanup_registry` and `__test_db_metadata`.
- **In-Process Fencing Guarantee:** An in-process executor that is cooperative cannot execute `db.dropDatabase()` if its supervision lease has expired, its abort signal has fired, or its coordination authority was revoked.

### 1.2 Category B: Uncooperative or Privileged Actors
- **Definition:** External entities, direct database clients (e.g. `mongosh`, compass), administrative scripts, or compromised worker processes operating outside the application guard functions.
- **System Boundary Reality:** No application-level protocol can prevent a process that executes `mongoClient.db(name).dropDatabase()` directly via the native driver from dropping a database if that process holds administrative credentials on the MongoDB server. MongoDB's native wire protocol does not support row-level permissions, transactional fencing, or conditional tokens on `dropDatabase`.
- **Engineering Principle:** The application protocol must guarantee absolute safety against all concurrency races, process stalls, GC pauses, and recovery retries among all application workers and processes. Any claim to fence an out-of-band privileged attacker who runs arbitrary un-instrumented code against MongoDB without cluster-level RBAC is mathematically and architecturally false.

---

## 2. Evaluation of Implementation Approaches

We rigorously analyze the four potential design approaches:

### Approach 1: Short Lease with Quiet Period
- **Mechanism:** The executor obtains a short-lived lease in the registry (e.g. 5 seconds). If a timeout occurs, a second worker waits a "quiet period" (e.g. 10 seconds) before taking over.
- **Flaw Analysis:** **Expiring leases do not prove process termination.** If Worker A enters a stop-the-world garbage collection pause, an OS paging stall, or CPU starvation lasting 15 seconds, its lease expires, Worker B assumes Worker A is dead, and Worker B initiates cleanup or reclaims the database. When Worker A wakes up, it still executes its pending drop command.
- **Verdict: REJECTED as a standalone safety mechanism.** Leases can serve as liveness indicators to trigger recovery health checks, but can never be used to declare an unconfirmed process safe to supersede.

### Approach 2: Process Isolation / Dedicated Destructive Executor
- **Mechanism:** Destructive cleanup operations are supervised. If delegated to a child process or worker thread, the supervisory coordinator tracks the operating system Process ID (`executorPid`).
- **Safety Rule:** Authority over a database in `DROP_IN_PROGRESS` can **NEVER** be reassigned to another worker or process while the previous executor process is alive. The supervisor must prove termination via OS signal checks (`kill(pid, 0)` failing with `ESRCH`) or explicitly issue `SIGKILL` and await exit before any reassignment or recovery can occur.
- **Verdict: ACCEPTED as the multi-process invariant.**

### Approach 3: In-Process Abort / Cancellation Controller & Revocation Listener
- **Mechanism:** Within an application worker process, the destructive drop command is wrapped in an atomic execution gate tied to an `AbortController`. The coordinator maintains a revocation listener on the coordination document. If authority is revoked or superseded, the coordinator calls `abort()` on the controller. The execution gate checks `signal.aborted` synchronously immediately prior to dispatching `db.dropDatabase()`.
- **Effectiveness:** Eliminates the check-then-act gap within cooperative processes. If Worker A's authority is revoked while paused in userland or awaiting microtasks, Worker A's abort signal is tripped, blocking the destructive call upon resume.
- **Verdict: ACCEPTED as the in-process invariant.**

### Approach 4: Two-Phase Destructive Cleanup (Tombstoning)
- **Mechanism:** Rather than directly dropping the database, Worker A renames or moves collections to a tombstone prefix within a transaction or controlled namespace, then drops empty or tombstoned artifacts.
- **Evaluation:** In MongoDB replica sets, collection renames across databases or under certain sharding/replica configurations can cause lock contention or require admin privileges. While tombstoning is useful for soft-deletes, `cleanupTestDatabase` exists specifically to tear down ephemeral test databases and release namespace metadata.
- **Verdict: COMPLEMENTARY.** We enforce that if a database has already been completely emptied (`collections.length === 0`), recovery can safely finalize the state without risking data loss.

---

## 3. Selected Architecture: Supervised Destructive Execution Protocol

To achieve provable safety against stale-executor destructive actions, V3.6 implements a **Unified Supervised Destructive Execution Architecture** combining Approaches 2, 3, and fail-closed recovery.

```
       [Worker / Coordinator]
                 │
                 ▼
  [Stage 1: Ownership Assertion]
                 │
                 ▼
  [Stage 2: Transition to CLEANUP_LOCKED]
  - CAS in metaCol & coordCol
  - Generation incremented
                 │
                 ▼
  [Stage 3: Transition to DROP_IN_PROGRESS]
  - Mint unique dropExecutionToken (crypto UUID)
  - Record executorPid: process.pid
  - Set dropExecutionLock: true
                 │
                 ▼
  [Stage 3.5: Supervised Execution Gate]
  - Initialize AbortController
  - Pre-wire in-process revocation listener & fencing gate
  - Perform final synchronous authority check
                 │
      ┌──────────┴──────────┐
      ▼                     ▼
[Authority Valid]    [Revoked / Aborted]
      │                     │
      │                     └──► Throw StaleExecutorRevocationError
      │                          (Abort drop immediately, do NOT call dropDatabase)
      ▼
 [db.dropDatabase()]
      │
      ▼
  [Stage 4: Transition to CLEANED]
  - Set dropExecutionLock: false
  - Mark lifecycleState: 'CLEANED'
```

### 3.1 Protocol State Invariants

1. **Strict Monotonicity:**
   `OWNED` $\rightarrow$ `CLEANUP_LOCKED` $\rightarrow$ `DROP_IN_PROGRESS` $\rightarrow$ `CLEANED`.
2. **Execution Token Binding:**
   Every drop operation requires a freshly minted cryptographically random `dropExecutionToken`. The token must match in both `__test_db_metadata` and `cleanup_registry`.
3. **PID Affinity & Liveness Verification:**
   The active executor's OS Process ID (`executorPid`) is recorded in the coordination document during Stage 3.
   - If an executor fails or times out while `dropExecutionLock === true`:
     - Recovery from the **same** process is permitted (resuming its own drop).
     - Recovery or takeover from a **different** process is **STRICTLY FORBIDDEN** unless the supervisor verifies that `isExecutorTerminated(oldPid)` is true (OS confirmation that the PID does not exist).
     - If the status of `oldPid` cannot be definitively confirmed (e.g. cross-host or permission denial), the system **FAILS CLOSED** and refuses reassignment.
4. **Cooperative In-Process Fencing Barrier:**
   The invocation of `db.dropDatabase()` is strictly routed through a guarded closure:
   ```typescript
   if (abortController.signal.aborted) {
     throw new Error('[DB Guard] Cleanup aborted: destructive authority was revoked before dispatch.');
   }
   ```
5. **Post-Drop Finalization Safety:**
   If `db.dropDatabase()` succeeds on the cluster but the process crashes before Stage 4 (`CLEANED`), any subsequent recovery safely checks `listCollections()`. If `collections.length === 0`, it reconciles the registry to `CLEANED` without attempting a redundant drop.

---

## 4. Formal State Transition Table

| Current State | Target State | Required Authority / Conditions | Concurrency / Fencing Action |
| :--- | :--- | :--- | :--- |
| `OWNED` | `CLEANUP_LOCKED` | Worker matches `ownerWorkerId`, Run matches `ownerRunId`. | CAS atomically increments `cleanupGeneration`. |
| `CLEANUP_LOCKED` | `DROP_IN_PROGRESS` | Generation matches, `cleanupOwner` matches. | Atomic update mints `dropExecutionToken`, sets `dropExecutionLock: true`, sets `executorPid: process.pid`. |
| `DROP_IN_PROGRESS` | `DROP_DISPATCH` | In-process gate confirms `token`, `gen`, `owner`, and `abortSignal.aborted === false`. | Enters guarded execution closure. |
| `DROP_IN_PROGRESS` | `CLEANED` | `dropDatabase()` succeeded; `collections.length === 0`. | Sets `dropExecutionLock: false`, `lifecycleState: 'CLEANED'`. |
| `DROP_IN_PROGRESS` (Crash Recovery) | `DROP_IN_PROGRESS` (Same Worker) | `cleanupOwner === workerId`, `executorPid === process.pid`. | Allowed to resume/retry. |
| `DROP_IN_PROGRESS` (Takeover Request) | `REJECTED` (Fail Closed) | `executorPid` is still alive or status is unconfirmed. | Throws `ConflictingOwnershipError`. Cannot reassign active executor. |
| `DROP_IN_PROGRESS` (Confirmed Dead) | `CLEANUP_LOCKED` | `isExecutorTerminated(executorPid) === true`. | Allows recovery worker to claim cleanup lock and increment generation. |

---

## 5. Verification Matrix Against Attack Scenarios

1. **Preemption after final check:** In-process gate with `AbortController` and revocation hook intercepts resumed execution and aborts drop call.
2. **Worker crash during drop:** Database collections become 0; subsequent recovery verifies empty collections and idempotently transitions to `CLEANED`.
3. **Concurrent takeover attempt:** Worker B attempts to steal lock while Worker A is in `DROP_IN_PROGRESS`; Worker B is rejected because Worker A is still running.
4. **Registry missing / disconnected:** Fails closed immediately before any destructive action.
5. **Non-test database target:** Blocked by `isTestDatabaseName()` assertion; never reaches execution gate.
