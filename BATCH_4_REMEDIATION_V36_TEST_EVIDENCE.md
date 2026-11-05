# DECISION OS — BATCH 4 REMEDIATION V3.6
## ADVERSARIAL TEST EVIDENCE REPORT

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Test Files:**
- `apps/api/tests/batch4_v36_reproduction.test.ts`
- `apps/api/tests/batch4_v36_cleanup_executor_fencing.test.ts`
**Environment:** MongoDB 3-Node Replica Set `rs0` on port 27018  
**Date:** 2026-11-05  

---

## 1. Executive Summary

This report documents the empirical adversarial testing executed against the Decision OS V3.6 implementation in `apps/api/src/db/guard.ts`. All tests were run against a real, multi-node MongoDB replica set with active replication and direct connection.

Every test verifies real production methods under adversarial conditions:
- Deliberate in-flight worker pauses immediately prior to native drop execution.
- Mid-operation simulated crashes, process exits, and unconfirmed PIDs.
- Real child processes spawned to verify OS process termination (`kill(pid, 0)` failing with `ESRCH`).
- Fail-closed behavior on missing or unconfirmed coordination records.

---

## 2. Reproduction and Resolution Verification (`REPRO-V36-01`)

### 2.1 Test Intent
Demonstrate that Worker A, paused after initial verification and immediately before dispatching the database drop command, is strictly prevented from executing `db.dropDatabase()` when Worker B or recovery revokes Worker A's authority in `cleanup_registry`.

### 2.2 Execution Trace
```
 RUN  v4.1.12 C:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main

stdout | apps/api/tests/batch4_v36_reproduction.test.ts > DECISION OS — BATCH 4 V3.6 DEFECT REPRODUCTION & RESOLUTION VERIFICATION > REPRO-V36-01: In V3.6, Worker A is blocked by supervised execution gate if authority was revoked during pause
[V3.6 RESOLUTION] Did Worker A issue dropDatabase() after its authority was revoked? -> false

 ✓ apps/api/tests/batch4_v36_reproduction.test.ts (1 test) 450ms
     ✓ REPRO-V36-01: In V3.6, Worker A is blocked by supervised execution gate if authority was revoked during pause  372ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  2.65s
```

### 2.3 Verification Evidence
1. `cleanupTestDatabase` threw: `Safety guard violation: database 'd36_rep_test_...' cleanup authority superseded before drop (revoked or stale generation 1 or token mismatch)`.
2. `dropExecutedByA` evaluated strictly to `false`.
3. Canary document `{ item: 'repro_evidence_v36' }` remained intact on the MongoDB cluster.

---

## 3. Dedicated Adversarial Fencing Suite (`D36-01` through `D36-16`)

File: `apps/api/tests/batch4_v36_cleanup_executor_fencing.test.ts`

### 3.1 Test Results Matrix

| Test ID | Adversarial Scenario | Mechanism Under Test | Expected Outcome | Observed Result | Duration |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **D36-01** | Worker A paused; Worker B revokes authority. | In-process execution gate & `dropAbortController`. | Worker A's drop call is blocked; canary remains intact. | PASS | 370ms |
| **D36-02** | Crash before destructive command. | Pre-drop crash recovery with same identity. | Subsequent retry recovers cleanly and completes drop. | PASS | 424ms |
| **D36-03** | Crash during destructive command. | Lock persistence during active drop. | Foreign worker B cannot claim or cleanup target database. | PASS | 348ms |
| **D36-04** | Crash after drop before CLEANED finalization. | Empty database reconciliation (Stage 0). | Retry detects 0 collections and reconciles registry to CLEANED. | PASS | 355ms |
| **D36-05** | Old process resumes after new generation starts. | Token and generation mismatch check in execution gate. | Stale process drop is intercepted and blocked fail-closed. | PASS | 342ms |
| **D36-06** | Coordination record missing from registry. | Stage 1 pre-lock registry existence check. | Rejects cleanup fail-closed before any database modification. | PASS | 321ms |
| **D36-07** | Registry failure / network error during sync. | Error handling prior to drop lock acquisition. | Fails closed; canary data remains completely intact. | PASS | 306ms |
| **D36-08** | Duplicate concurrent cleanup requests. | Atomic CAS on `metaCol` and `coordCol`. | Exactly one worker acquires drop lock; second is rejected. | PASS | 421ms |
| **D36-09** | Same-worker concurrent cleanup requests. | Serialization across lifecycle states. | Serialized cleanly; exactly one drop executed. | PASS | 517ms |
| **D36-10** | Different-worker takeover during active cleanup. | Ownership lock verification in Stage 1 & 2. | Foreign worker is strictly rejected. | PASS | 306ms |
| **D36-11** | Unconfirmed or active prior executor PID. | `isExecutorTerminated(pid)` and fail-closed policy. | Takeover blocked fail-closed while executor may still run. | PASS | 390ms |
| **D36-12** | Confirmed old-process termination. | Real OS child process exit check (`ESRCH`). | Recovery permitted and completes successfully. | PASS | 541ms |
| **D36-13** | Stale generation cleanup request. | Monotonic cleanup generation comparison. | Stale request is rejected fail-closed. | PASS | 338ms |
| **D36-14** | Malformed or missing execution identity. | `validateTestIdentity` assertion. | Throws before any database connection or operation. | PASS | 215ms |
| **D36-15** | Non-test or reserved system database. | `isTestDatabaseName` assertion. | Drops blocked immediately on `production`, `admin`, etc. | PASS | 224ms |
| **D36-16** | Repeated cleanup after already CLEANED. | Idempotent registry terminal state handling. | Returns cleanly without error or redundant drop calls. | PASS | 310ms |

### 3.2 Vitest Execution Output

```
 RUN  v4.1.12 C:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main

 ✓ apps/api/tests/batch4_v36_cleanup_executor_fencing.test.ts (16 tests) 5208ms
     ✓ D36-01: In-process execution gate blocks stale drop when authority is revoked during pause  370ms
     ✓ D36-02: Pre-drop crash recovers cleanly on retry with same identity  424ms
     ✓ D36-03: Crash during drop leaves lock intact; foreign worker cannot claim or drop  348ms
     ✓ D36-04: Crash after drop before CLEANED finalization reconciles 0 collections idempotently  355ms
     ✓ D36-05: Old process resumes after new generation starts; stale drop is blocked  342ms
     ✓ D36-06: Missing coordination record fails closed; no drop dispatched  321ms
     ✓ D36-07: Registry error during sync fails closed before drop  306ms
     ✓ D36-08: Duplicate cleanup requests: exactly one acquires drop lock and completes  421ms
     ✓ D36-09: Same-worker concurrent cleanup attempts are safely serialized  517ms
     ✓ D36-10: Different worker cannot take over cleanup of active database  306ms
     ✓ D36-11: Active or unconfirmed prior executor PID blocks takeover fail-closed  390ms
     ✓ D36-12: Confirmed process termination allows safe recovery  541ms
     ✓ D36-13: Stale generation request is rejected fail-closed  338ms
     ✓ D36-14: Malformed or missing identity rejected before database access  215ms
     ✓ D36-15: Non-test or reserved databases rejected immediately  224ms
     ✓ D36-16: Repeated cleanup on already CLEANED database is idempotent and safe  310ms

 Test Files  1 passed (1)
      Tests  16 passed (16)
   Start at  22:04:24
   Duration  7.68s
```

---

## 4. Adversarial Findings & Conclusion

1. **Check-Then-Act Eliminated for Cooperative Processes:** The in-process execution gate completely prevents stale drops when authority is modified or revoked during pauses.
2. **True Child Process Termination Verified:** D36-12 demonstrated that a real OS child process exiting cleanly allows subsequent recovery, whereas an active or unconfirmed PID (D36-11) prevents unsafe takeover.
3. **Cluster Safety Preserved:** At no point during any test failure or simulated crash was production or non-test data destroyed.
