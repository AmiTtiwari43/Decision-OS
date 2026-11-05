# DECISION OS — BATCH 4 V3.7 SECURITY REVIEW
## Threat Model, Capability Isolation & Multi-Layer Destructive Execution Defense

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit:** `786ba38d6b6a32f0487d65896cd0b686cc47379e`  
**Date:** 2026-11-05  
**Auditor:** Concurrency & Concurrency-Safety Architecture Review  
**Status:** PASSED — SECURE FAIL-CLOSED DESIGN  

---

## 1. Threat Model & Adversarial Assets

In the Decision OS environment, test runs and workers execute concurrently on shared or local MongoDB replica sets. The critical asset under defense is:
- **Database Isolation & Data Integrity:** Ensuring that test execution in one run cannot destroy, truncate, or mutate databases owned by other runs, background workers, or production services.
- **Destructive Execution Capability:** Ensuring that the privilege to execute database-level drops (`dropDatabase`) is strictly isolated and guarded against stale, superseded, or unauthorized invocation.

---

## 2. Capability Isolation Analysis

### 2.1 The Principle of Least Privilege
Ordinary cleanup workers operate under restricted capabilities. In earlier versions (V3.1–V3.6), workers were given a direct connection handle with administrative DDL privileges and were trusted to verify their lease before invoking `dropDatabase()`.

In V3.7, this trust model is completely inverted:
- **Workers do not possess destructive capability:** `stripDirectDestructiveCapability()` intercepts both `db.dropDatabase` and `connection.dropDatabase`.
- **Capability is granted only dynamically to the Supervised Executor:** The native drop command checks `activeSupervisedDropContext`. Unless the caller is inside the supervised execution function with a matching database name and cryptographic drop token, execution throws immediately.

### 2.2 Proof of Non-Bypassability
Can an unauthorized worker bypass this check?
1. **Direct `connection.db.dropDatabase()` call:** Intercepted at line 252 of `guard.ts`. Throws `Safety guard violation: Destructive execution capability denied: direct dropDatabase() is prohibited`. (Verified by test `D37-11`).
2. **Direct `connection.dropDatabase()` call:** Intercepted at line 292 of `guard.ts`. Redirected to `cleanupTestDatabase()`, which enforces the full validation pipeline.
3. **Attempt to forge `activeSupervisedDropContext`:** `activeSupervisedDropContext` is a module-scoped, non-exported variable within `guard.ts`. It cannot be set from external consumer code.
4. **Targeting Production / Reserved Databases:** Lines 369 and 828 of `guard.ts` enforce an absolute blacklist (`production`, `admin`, `local`, `config`) and require a valid test database suffix. (Verified by test `D37-07`).

---

## 3. Defense Against Hostile Interleavings

### 3.1 Asynchronous Execution Boundary TOCTOU
- **Attack:** Worker A passes authorization check, pauses due to event-loop stall, Worker B revokes authority, Worker A resumes and drops database.
- **Defense in V3.7:** Immediately before wire dispatch, the executor performs an atomic verification against `cleanup_registry` (`guard.ts:1277-1300`). If `cleanupGeneration`, `cleanupOwner`, or `dropExecutionLock` do not match, dispatch is aborted fail-closed. (Verified by tests `REPRO-V37-01` and `D37-10`).

### 3.2 PID Recycling & Collision
- **Attack:** An executor process terminates, the OS assigns the exact same PID to a new unrelated process, causing `isExecutorTerminated(pid)` to falsely claim the executor is alive, or allowing an unrelated process to claim authority.
- **Defense in V3.7:** Identity does not rely on PID alone. The 5-tuple identity binds `hostId`, `processId`, `startupGeneration`, `executorGeneration`, and `executorToken`. An identical PID on a recycled process will have a different `startupGeneration` and `executorToken`, preventing false ownership matches. (Verified by test `D37-16`).

### 3.3 Multi-Host Split-Brain
- **Attack:** Workers across different hosts or Kubernetes pods attempt concurrent cleanup. PIDs collide across container namespaces (`pid 1` in pod A vs `pid 1` in pod B).
- **Defense in V3.7:** `hostId` is verified on every coordination check. Cross-host takeovers without multi-host fencing proofs are rejected fail-closed (`guard.ts:904`). (Verified by test `D37-19`).

---

## 4. Replay & Duplicate Attack Resistance

- **Attack:** A worker retransmits a cleanup request with the same `requestId`.
- **Defense in V3.7:** The executor maintains in-flight request tracking (`inFlightByRequestId`). Duplicate requests return the active in-flight promise without issuing a second command to MongoDB. (Verified by test `D37-02`).

---

## 5. Security Audit Conclusion

The V3.7 Supervised Destructive Executor provides complete capability isolation, eliminating all direct paths to `dropDatabase()` from worker contexts. All failure modes fail closed without data loss or isolation leakage.
