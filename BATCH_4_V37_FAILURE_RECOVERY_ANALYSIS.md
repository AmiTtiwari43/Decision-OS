# DECISION OS — BATCH 4 V3.7 FAILURE RECOVERY ANALYSIS
## Crash Windows, Ambiguous Outcomes, Network Partitions & Safe Reconciliation

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit:** `786ba38d6b6a32f0487d65896cd0b686cc47379e`  
**Date:** 2026-11-05  
**Scope:** Exhaustive Failure Recovery Analysis for Database Cleanup  

---

## 1. The Crash Window Spectrum

A robust distributed cleanup architecture must remain safe regardless of the exact microsecond in which a process crashes, the network disconnects, or the database server delays its response.

The lifecycle comprises 6 critical boundaries:

```
[Start] 
   |
(1) Pre-Lock: Before target DB CLEANUP_LOCKED
   |
(2) Pre-Registry: Between target DB lock and coordination registry sync
   |
(3) Pre-Dispatch: Between coordination drop lock and wire dispatch
   |
(4) In-Flight: While MongoDB is executing dropDatabase()
   |
(5) Post-Drop Pre-Cleaned: Database dropped, but before registry writes CLEANED
   |
(6) Post-Cleaned: Finalization complete
```

---

## 2. Failure Analysis by Boundary

### Window 1: Crash Pre-Lock
- **State:** Target database metadata remains `OWNED`. Global registry remains `OWNED`.
- **Impact:** Zero destructive operations dispatched.
- **Recovery:** Any subsequent cleanup attempt or retry finds the database in `OWNED` and cleanly proceeds through Stage 1. (Verified by test `D37-12`).

### Window 2: Crash Pre-Registry Sync
- **State:** Target database metadata is `CLEANUP_LOCKED`, but global registry is still `OWNED`.
- **Impact:** Database marked locked locally; global registry not yet updated.
- **Recovery:** On retry, `cleanupTestDatabase` detects `isRetry` from local metadata or recognizes `CLEANUP_LOCKED` state with same worker and updates registry to match. (Verified by test `D37-21`).

### Window 3: Crash Pre-Dispatch
- **State:** Target database metadata is `DROP_IN_PROGRESS`; coordination registry has `dropExecutionLock: true` and `dropInProgress: true`.
- **Impact:** Destruction has NOT occurred. Canary collections remain intact.
- **Recovery:** 
  - Foreign workers attempting to claim or drop are strictly rejected: `drop is in progress by active executor PID...`
  - The same worker/executor retrying checks database collections. If collections > 0, the drop command is safely retried under the verified execution context. (Verified by test `D37-12`).

### Window 4: In-Flight Crash / Network Partition / Lost Response
- **State:** The client transmitted `{ dropDatabase: 1 }`, but the TCP connection severed or the server did not respond before timeout.
- **The Ambiguity Hazard:** Did MongoDB execute the drop or not? Equating a network timeout with failure is dangerous (MongoDB may have dropped the database); equating it with success is equally dangerous (the database may still exist).
- **V3.7 Protocol:**
  1. The client catches the timeout/network error.
  2. The executor updates `cleanup_registry` to `lifecycleState: 'OUTCOME_UNKNOWN'`.
  3. Automatic takeover by another worker is prohibited.
  4. The recovery protocol executes an authoritative catalog query (`listDatabases` / `listCollections`):
     - If database is gone or has 0 collections: Safe idempotent transition to `CLEANED`.
     - If database still exists and has collections: Refuses automatic redispatch to prevent racing with an in-flight server-side lock. Transitions to `RECONCILIATION_REQUIRED`. (Verified by tests `D37-14`, `D37-15`).

### Window 5: Crash Post-Drop, Pre-Cleaned Finalization
- **State:** MongoDB completed `dropDatabase()`. Database has 0 collections or does not exist. Registry still records `DROP_IN_PROGRESS`.
- **Impact:** Data is gone, but registry is not finalized.
- **Recovery:** On subsequent execution, the executor inspects the cluster. Because `listCollections()` returns 0 collections, the executor finalizes the coordination registry to `CLEANED` without issuing a redundant drop command. (Verified by tests `D37-04`, `D37-23`).

### Window 6: Post-Cleaned Finalization
- **State:** Registry records `CLEANED`, `dropExecutionLock: false`.
- **Impact:** Entire workflow finished.
- **Recovery:** Any repeated cleanup call on the database returns immediately with 0 operations and exit code 0. (Verified by tests `D37-01`, `D37-20`).

---

## 3. Administrative Reconciliation Protocol (`guard.ts:1412-1476`)

When an ambiguous state cannot be safely resolved by automatic retries (e.g. database stuck in `OUTCOME_UNKNOWN` with residual collections), the system requires explicit, audited administrative intervention:
- Operator provides `operator`, `reason`, and a cryptographically valid `adminToken` starting with `admin_token_`.
- `reconcileTestDatabaseCleanup()` inspects cluster state, executes final cleanup if safe, and persists an immutable audit trail (`reconciledBy`, `reconciliationReason`, `reconciledAt`) into the coordination registry. (Verified by test `D37-24`).

---

## 4. Failure Recovery Conclusion

Every failure window across the entire destructive lifecycle is covered by an explicit, durable transition. At no point can a transient failure result in an unsafe automatic takeover or an unfenced database drop.
