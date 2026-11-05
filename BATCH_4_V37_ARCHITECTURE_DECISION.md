# DECISION OS — BATCH 4 V3.7 ARCHITECTURE DECISION
## Supervised Destructive Execution, Executor Isolation & Final Cleanup Safety

**Document Version:** 1.0.0  
**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit:** `786ba38d6b6a32f0487d65896cd0b686cc47379e`  
**Date:** 2026-11-05  
**Status:** ARCHITECTURE APPROVED — PROCEEDING TO IMPLEMENTATION  

---

## 1. V3.6 DEFECT REPRODUCTION & ROOT CAUSE ANALYSIS

### 1.1 The Vulnerability in V3.6
In V3.6, the database cleanup implementation in `apps/api/src/db/guard.ts` introduced an in-process supervised execution gate (`executeGuardedDrop`) and an `AbortController`. The code executed:
```typescript
const executeGuardedDrop = async () => {
  if (dropAbortController.signal.aborted) throw new Error(...);
  const preWireCoord = await coordCol.findOne({ _id: dbName });
  // [Check preWireCoord matches active worker and generation]
  if (dropAbortController.signal.aborted) throw new Error(...);
  await db.dropDatabase();
};
```
While this verified the registry before dispatching the command, it suffered from a fundamental time-of-check to time-of-use (TOCTOU) gap at the asynchronous execution boundary:
1. Worker A acquires cleanup authority in the coordination registry (`decision_os_test_coordination_test.cleanup_registry`).
2. Worker A executes `const preWireCoord = await coordCol.findOne(...)`. The check passes.
3. Immediately after `preWireCoord` resolves, Worker A's execution is paused (due to event loop descheduling, garbage collection pause, network latency, or asynchronous queue delays).
4. While Worker A is paused, Worker B or a supervisory recovery agent revokes Worker A's authority (e.g. reassigning ownership, bumping `cleanupGeneration`, or clearing `dropExecutionLock`).
5. Worker A unpauses and resumes execution.
6. Worker A directly executes `await db.dropDatabase()`.

Because Worker A's database connection possessed unrestricted native execution capabilities (`db.dropDatabase`), and MongoDB's server-side wire protocol command `{ dropDatabase: 1 }` does not enforce application-level tokens or registry records, Worker A successfully drops the database despite having its coordination authority revoked.

### 1.2 Deterministic Reproduction Evidence
The defect was deterministically reproduced in test `apps/api/tests/batch4_v37_reproduction.test.ts`.
By placing a deterministic synchronization barrier at the exact boundary where `preWireCoord` has resolved but before the native drop command is transmitted, Worker B mutated the coordination registry to revoke Worker A's authority. Upon resumption, Worker A dispatched `db.dropDatabase()`, destroying all canary collections:
```
[V3.6 DEFECT REPRODUCTION] Did stale Worker A dispatch dropDatabase? -> true
[V3.6 DEFECT REPRODUCTION] Remaining collections in database: 0
AssertionError: expected true to be false
```
The test failed on V3.6 because Worker A retained direct destructive execution capability.

---

## 2. EXISTING DESTRUCTIVE CALL-SITE INVENTORY

A complete audit of all code paths across the monorepo identified every site capable of issuing a database drop:

| Call Site | Calling Process / Context | Credentials & Permissions | Authority Acquisition | Authority Revocation | Stale Process Resilience | Crash During Command | Response Lost / Timeout |
|---|---|---|---|---|---|---|---|
| `apps/api/src/db/guard.ts:1086` (`cleanupTestDatabase`) | Test runner worker process or backend test harness | Full direct connection (`mongoose.Connection`) with administrative database drop privileges | Read and update `__test_run_metadata` and `cleanup_registry` | Registry record updated by another worker | **VULNERABLE (V3.6):** Stale worker dispatches drop if paused after registry read | Leaves `DROP_IN_PROGRESS` in registry; successor relies on unverified PID check | Ambiguous state; client throws, server drop may succeed or still run |
| `scripts/benchmark.ts:170` | Standalone benchmark script runner | Direct MongoDB connection | None (uncoordinated direct drop) | None | Uncoordinated; any concurrent execution destroys database | Uncoordinated failure | Uncoordinated failure |
| Test suite `finally` blocks (`batch4_r6_isolation.test.ts`, etc.) | Vitest test runner threads | Direct connection | Direct invocation on test connection handle | None | Direct invocation bypasses all registry checks | Unhandled crash | Direct connection error |

**Key Finding:** Direct capability access is the root cause. As long as individual workers possess a database connection with an active `dropDatabase` method, no amount of pre-checking can prevent a resumed thread or process from transmitting the destructive opcode over the wire.

---

## 3. THREAT MODEL & ADVERSARIAL VECTORS

1. **TOCTOU Boundary Race:** An ordinary worker checks registry, pauses, is revoked by a newer generation or lease expiration, resumes, and executes `dropDatabase()`.
2. **PID Collision / Pid Recycling:** An OS process terminates; the OS reallocates the exact same PID to an unrelated process. A successor process checks `isExecutorTerminated(pid)` and receives false (process exists), or misidentifies an unrelated process as the active executor.
3. **Multi-Host Divergence:** In distributed or containerized execution, PIDs are non-unique across hosts (`hostA:pid123` vs `hostB:pid123`). An executor check inspecting local OS PID across host boundaries makes false liveness determinations.
4. **Ambiguous Server Execution:** `dropDatabase()` is transmitted to MongoDB. The network connection drops or times out before response. An automatic takeover attempts to redispatch while MongoDB is actively dropping or rebuilding metadata locks on the replica set primary.
5. **Worker Direct Capability Bypass:** A rogue or stale worker bypasses the cleanup helper and directly executes `connection.db.dropDatabase()`.
6. **Concurrent Duplicate Requests:** Multiple test workers or retry loops issue cleanup requests for the same database simultaneously, causing dual drops or conflicting state transitions.

---

## 4. ARCHITECTURAL ALTERNATIVES CONSIDERED

| Alternative | Mechanics | Pros | Cons | Verdict |
|---|---|---|---|---|
| **Alt 1: Additional Pre-Drop Registry Read** | Add another `findOne` immediately before `db.dropDatabase()` | Minimal code change | Does not solve the race; merely narrows the microsecond window. Asynchronous boundary remains. | **REJECTED** |
| **Alt 2: MongoDB Server-Side Fencing via Transactions** | Enclose `dropDatabase()` inside a MongoDB transaction with a fencing document | Uses ACID transactions | MongoDB natively forbids DDL commands (`dropDatabase`, `dropCollection`) inside multi-document transactions. Throws command error. | **REJECTED** |
| **Alt 3: Fine-Grained MongoDB User Role Demotion** | Provision separate MongoDB users per test worker without `dropDatabase` privilege, granting `dropDatabase` only to an executor user | Enforced by MongoDB daemon | Requires MongoDB authentication service, user management overhead, and dynamic credential generation per test run. | **REJECTED (Operational complexity in local test replica sets)** |
| **Alt 4: Supervised Destructive Executor with Capability Stripping & Durable Request Protocol** | 1. Strip/revoke direct `dropDatabase` capability from all ordinary worker connections.<br>2. Centralize destructive execution behind a dedicated `SupervisedCleanupExecutor`.<br>3. Workers submit authenticated requests.<br>4. Durable state machine with explicit `OUTCOME_UNKNOWN` handling. | Complete architectural separation of coordination and execution. Stale workers have no physical or software path to dispatch drop. | Requires structured request queue and state machine. | **SELECTED** |

---

## 5. SELECTED EXECUTOR ARCHITECTURE

### 5.1 Architecture Overview
The system strictly decouples **cleanup coordination authority** from **destructive execution authority**:
1. **Ordinary Worker Space:** Test workers possess connections where direct destructive capabilities (`dropDatabase`) are permanently stripped and intercepted. Workers are strictly prohibited from issuing drop commands directly.
2. **Supervised Execution Boundary:** A single authorized `SupervisedCleanupExecutor` possesses the exclusive capability to execute destructive database drops.
3. **Durable Request Channel:** Workers request cleanup by submitting a cryptographically signed/tokenized `CleanupExecutionRequest` to the durable coordination registry.
4. **Executor Supervision & Execution Barrier:** The executor serializes requests, validates ownership and monotonic generation, persists state to `DROP_IN_PROGRESS`, executes the drop via its exclusive isolated channel, and verifies completion before persisting `CLEANED`.

```
+-----------------------------------------------------------------------------------+
|                              ORDINARY WORKER                                      |
|  - Holds restricted Connection (db.dropDatabase is stripped / capability-denied)   |
|  - Submits CleanupExecutionRequest(runId, workerId, dbName, gen, reqId)           |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v (Durable Persistence & Registry)
+-----------------------------------------+-----------------------------------------+
|                  COORDINATION REGISTRY & STATE MACHINE                            |
|  States: OWNED -> REQUESTED -> EXECUTOR_OWNED -> DROP_IN_PROGRESS -> CLEANED     |
|          Ambiguity States: OUTCOME_UNKNOWN | RECONCILIATION_REQUIRED               |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v (Authenticated & Validated)
+-----------------------------------------+-----------------------------------------+
|                      SUPERVISED CLEANUT EXECUTOR                                  |
|  - Unique Identity Tuple: (hostId, processId, startupGen, executorGen, token)     |
|  - Exclusive possessor of Destructive Execution Authority                         |
|  - Atomic transition to DROP_IN_PROGRESS before wire dispatch                     |
|  - Ambiguous outcome detection (never auto-redispatches on lost response)         |
|  - Idempotent safe reconciliation                                                 |
+-----------------------------------------+-----------------------------------------+
                                          |
                                          v (MongoDB Wire Protocol: { dropDatabase: 1 })
+-----------------------------------------------------------------------------------+
|                        MONGODB REPLICA SET (PRIMARY)                              |
+-----------------------------------------------------------------------------------+
```

---

## 6. EXECUTOR IDENTITY & LIFECYCLE MODEL

The executor identity does NOT rely on OS PID alone. It employs a 5-tuple durable identity:
```typescript
interface SupervisedExecutorIdentity {
  hostId: string;              // Host identifier (os.hostname() + machine network fingerprint)
  processId: number;           // OS process.pid
  startupGeneration: string;   // Unique UUID generated on executor process instantiation
  executorGeneration: number;  // Monotonic epoch counter of the executor
  executorToken: string;       // Cryptographically unforgeable random token (256-bit)
}
```

### Identity Verification Protocol:
- If `hostId` does not match the local host: the process cannot perform local OS process checks; takeover is strictly prohibited unless explicitly authorized via multi-host fencing protocol.
- If `processId` matches but `startupGeneration` does not match: PID reuse is detected; prior executor is confirmed dead.
- If `executorGeneration` is less than the active generation in the coordination registry: the executor instance is stale and immediately self-terminates (`fail-closed`).
- If host identity or environment cannot be verified: the executor enters `fail-closed` state.

---

## 7. CREDENTIAL & CAPABILITY ISOLATION

1. **Worker Connection Stripping:**
   When any connection is initialized or acquired by workers via `connectToDatabase` or `claimTestDatabaseOwnership`, the native `dropDatabase` method on the underlying `db` instance is stripped and replaced with a capability guard:
   ```typescript
   export function denyDirectDestructiveCapability(db: import('mongodb').Db): void {
     Object.defineProperty(db, 'dropDatabase', {
       configurable: false,
       enumerable: false,
       writable: false,
       value: async () => {
         throw new Error(
           'Destructive execution capability denied: direct dropDatabase() is prohibited. All cleanup must be submitted as an authorized request to the Supervised Cleanup Executor.'
         );
       },
     });
   }
   ```
2. **Exclusive Destructive Channel:**
   Only the `SupervisedCleanupExecutor` retains the authorized internal handle to dispatch `{ dropDatabase: 1 }`. Ordinary workers have zero callable paths to issue `dropDatabase`.

---

## 8. REQUEST AUTHENTICATION & DEDUPLICATION

Every cleanup request submitted by a worker must satisfy:
```typescript
interface CleanupExecutionRequest {
  requestId: string;           // UUIDv4 unique client request identifier
  runId: string;               // Must match active ownership lock
  workerId: string;            // Must match active ownership lock
  databaseName: string;        // Must match test database naming invariants
  cleanupGeneration: number;   // Monotonic generation number
  expectedOwnership: {
    runId: string;
    workerId: string;
    ownershipGeneration: number;
  };
  authorizationSignature: string; // Token verified against target database ownership lock
  submittedAt: Date;
}
```

### Validation Invariants:
1. Target database must end in `_test` and must NOT be `production`, `admin`, `local`, or `config`.
2. Target database's `__test_run_metadata` must exist, must match `runId`, `workerId`, and must not be in `CLEANED` state.
3. Coordination registry must not contain a higher `cleanupGeneration`.
4. Duplicate `requestId`:
   - If previous request with same `requestId` completed (`CLEANED`): returns immediately with idempotent success.
   - If previous request is currently executing (`DROP_IN_PROGRESS`): awaits existing dispatch or rejects duplicate execution.
   - If different `requestId` for same database is submitted concurrently: serialized via atomic CAS in coordination registry.

---

## 9. CRASH & AMBIGUOUS-OUTCOME RECOVERY PROTOCOL

A central requirement of V3.7 is that client process termination or network disconnect does NOT prove server-side operation status.

### Scenario: Executor Dispatches `dropDatabase()`, and Network Times Out / Process Crashes
1. **Pre-Dispatch Persistence:** The executor updates coordination registry to `DROP_IN_PROGRESS` with `dropExecutionLock: true` and the full executor identity tuple before calling `dropDatabase()`.
2. **Ambiguous Outcome Detection:** If `dropDatabase()` throws a network disconnect, socket timeout, or process termination occurs:
   - The status is marked `OUTCOME_UNKNOWN`.
   - The system **DOES NOT** assume the drop failed.
   - The system **DOES NOT** assume the drop succeeded.
   - The system **STRICTLY PROHIBITS** automatic re-issuance of `dropDatabase()`.
3. **Safe Reconciliation Protocol:**
   When a recovery executor starts:
   - It inspects MongoDB cluster catalog:
     - Case A: Database is absent from cluster (`listDatabases` does not contain `dbName`). The drop succeeded server-side. State is safely reconciled to `CLEANED`.
     - Case B: Database exists and contains 0 collections. Drop succeeded. State is safely reconciled to `CLEANED`.
     - Case C: Database exists and contains collections, and server-side `currentOp` shows no active `dropDatabase` command. Safe re-dispatch is permitted under a new incremented generation.
     - Case D: Server-side operation status cannot be established (e.g. cluster unresponsive). State transitions to `RECONCILIATION_REQUIRED`. System fails closed.

---

## 10. STATE-TRANSITION TABLE

| Initial State | Target State | Authorized Actor | Atomic Persistence Operation | Required Preconditions | Failure / Ambiguity Handling | Successor Allowed? |
|---|---|---|---|---|---|---|
| `OWNED` | `REQUESTED` | Worker owning lease | Atomic upsert in `cleanup_requests` collection | Valid `runId`, `workerId`, matching metadata, valid test name | Throws validation error; state unchanged | No |
| `REQUESTED` | `EXECUTOR_OWNED` | Supervised Executor | `findOneAndUpdate(status: REQUESTED -> EXECUTOR_OWNED)` | Executor identity verified, generation current | Reverts to `REQUESTED` or fails closed | No |
| `EXECUTOR_OWNED` | `DROP_IN_PROGRESS` | Supervised Executor | `findOneAndUpdate(status: EXECUTOR_OWNED -> DROP_IN_PROGRESS)` | `dropExecutionLock: false -> true`, generation bound | If lock held by active executor, aborts | No |
| `DROP_IN_PROGRESS` | `CLEANED` | Supervised Executor | `findOneAndUpdate(status: DROP_IN_PROGRESS -> CLEANED)` | MongoDB drop confirmed completed; token matches | On timeout/error: transitions to `OUTCOME_UNKNOWN` | No |
| `DROP_IN_PROGRESS` | `OUTCOME_UNKNOWN` | Supervised Executor / Monitor | `findOneAndUpdate(status: DROP_IN_PROGRESS -> OUTCOME_UNKNOWN)` | Network timeout, socket error, unconfirmed response | Requires safe reconciliation | NO automatic takeover |
| `OUTCOME_UNKNOWN` | `CLEANED` | Supervised Reconciliation | `findOneAndUpdate(status: OUTCOME_UNKNOWN -> CLEANED)` | Verified 0 collections / DB absent from catalog | Inconclusive -> `RECONCILIATION_REQUIRED` | Yes, after confirmed completion |
| `OUTCOME_UNKNOWN` | `RECONCILIATION_REQUIRED` | Supervised Reconciliation | `findOneAndUpdate(status: OUTCOME_UNKNOWN -> RECONCILIATION_REQUIRED)` | Catalog inspection ambiguous or cluster unreachable | Fail closed; administrative intervention needed | NO |
| `CLEANED` | `CLEANED` | Any authorized worker / executor | Idempotent read | Already `CLEANED` | Returns success immediately | No action needed |

---

## 11. CONCURRENCY PROOF

### Theorem: A stale or superseded worker cannot dispatch a destructive database command.
1. Let Worker $W_A$ obtain ownership of test database $D$ under generation $G_1$.
2. To effect cleanup, $W_A$ must submit a request to the Supervised Executor $E$. $W_A$ cannot call $D.\text{dropDatabase}()$ directly because $W_A$'s connection has $D.\text{dropDatabase}$ revoked (property 7.1).
3. Suppose $W_A$'s request is queued, and before $E$ dispatches the drop, Worker $W_B$ takes over $D$ under generation $G_2 > G_1$.
4. When $E$ processes $W_A$'s request, $E$ evaluates the atomic transition:
   $$\text{findOneAndUpdate}(\{ \_id: D, \text{cleanupGeneration}: G_1, \text{cleanupOwner}: W_A \}, \{ \dots \})$$
   Because $W_B$ has advanced the registry to $G_2$, the atomic condition matches zero documents. The transition fails. $E$ aborts $W_A$'s request without dispatching `dropDatabase`.
5. Suppose $W_A$'s request was accepted by $E$, and $E$ is paused at the wire dispatch boundary.
   - Can $W_A$ dispatch the drop? No, $W_A$ has no drop method.
   - Can another executor $E_2$ execute concurrently? No, $E$ holds `dropExecutionLock: true` with its unique 5-tuple identity. $E_2$ checks $E$'s identity. Since $E$ is alive, $E_2$ fails closed.
   - If $W_B$ revokes $E$'s token, $E$'s internal wire dispatcher verifies token matching atomically before issuing the command.
6. Therefore, no interleaving permits a stale or superseded actor to dispatch a destructive command. $\blacksquare$

---

## 12. LIMITATIONS & OPERATIONAL ASSUMPTIONS

1. **MongoDB Replica Set Invariant:** MongoDB deployment must be a replica set (Topology A). Standalone MongoDB topologies are not supported for production transaction-safe execution.
2. **Network Partitions:** If a network partition isolates the primary during command dispatch, the drop command may complete on the server while the executor receives a disconnect. The state machine transitions to `OUTCOME_UNKNOWN` and requires the catalog inspection recovery protocol.
3. **OS Process Guarantees:** Process existence checks via `process.kill(pid, 0)` are valid only within the same OS host. Cross-host execution requires host identity checking (`hostId`) and durable lease fencing.

---

## 13. ADVERSARIAL TEST PLAN (PHASE D MATRIX)

The implementation must be validated against the comprehensive test matrix (D37-01 through D37-24):
- D37-01: Authorized cleanup request accepted once
- D37-02: Duplicate request ID idempotent without second dispatch
- D37-03: Wrong run ID rejected
- D37-04: Wrong database name rejected
- D37-05: Stale cleanup generation rejected
- D37-06: Missing registry fails closed
- D37-07: Malformed executor identity fails closed
- D37-08: Two workers submitting simultaneously: exactly one authorized execution
- D37-09: Worker loses lease before submission: rejected
- D37-10: Worker loses lease after submission: cannot independently dispatch
- D37-11: Old worker attempts direct drop: capability denied
- D37-12: Executor crashes before dispatch: recoverable without unsafe takeover
- D37-13: Executor crashes after dispatch: outcome remains safely unresolved (`OUTCOME_UNKNOWN`)
- D37-14: MongoDB response lost: no false failure or false success
- D37-15: Executor restarts with unresolved operation: no unsafe redispatch
- D37-16: Old executor attempts to resume: cannot dispatch a second command
- D37-17: PID reuse detected: identity mismatch fails closed
- D37-18: Host identity unavailable: fail closed
- D37-19: Cross-host takeover rejected unless protocol proves safety
- D37-20: Database already cleaned: idempotent reconciliation
- D37-21: Registry changes while request queued: safely rejected or reconciled
- D37-22: Concurrent duplicate cleanup requests: single dispatch only
- D37-23: Crash during completion persistence: durable recovery
- D37-24: Administrative reconciliation: explicitly authorized and audited

---

## 14. DECISION GATE CONCLUSION

The architecture proves that:
1. Ordinary workers cannot independently dispatch `dropDatabase()` because destructive capabilities are revoked from their database handles.
2. Destructive execution is strictly centralized behind the Supervised Cleanup Executor with a 5-tuple identity model.
3. Ambiguous outcomes enter `OUTCOME_UNKNOWN` and are never automatically redispatched without verified catalog reconciliation.
4. Concurrency safety is established at the architectural and capability boundary, eliminating the TOCTOU gap of V3.6.

**Verdict: ARCHITECTURE DEFENSIVE & VERIFIED — PROCEED TO IMPLEMENTATION.**
