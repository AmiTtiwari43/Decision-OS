# DECISION OS — BATCH 4 REMEDIATION V3.5
## OPERATIONAL RISK REGISTER & BOUNDARY SPECIFICATION

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit (V3.4):** `00417e0d46e79496268dc786475d3641687167e3`  
**Date:** 2026-11-05  

---

## 1. Operational Risk Register

| Risk ID | Description | Severity | Likelihood | Mitigation Strategy | Residual Risk |
| :--- | :--- | :---: | :---: | :--- | :---: |
| **RSK-35-01** | **Process pause right before `dropDatabase()` followed by takeover**<br>Worker A pauses after final authority read; Worker B attempts to take over and insert new data. | Critical | Very Low | Protocol enforces mutual exclusion: Worker B cannot claim or reassign the database while `dropExecutionLock: true` is held. Resuming Worker A validates its token and halts if superseded. | Negligible |
| **RSK-35-02** | **Missing coordination registry record**<br>Database exists but coordination record is deleted or absent. | High | Low | System strictly fails closed at Stage 0, pre-lock check, Stage 2 sync, and pre-drop verification. Drop is refused unconditionally. | Negligible |
| **RSK-35-03** | **Concurrent cleanup calls by the same worker**<br>Two asynchronous threads in the same process call `cleanupTestDatabase`. | Medium | Medium | Stage 3 atomic Compare-And-Swap on target database (`dropInProgress`) and coordination registry (`dropExecutionLock`) serializes callers; exactly one acquires authority. | Negligible |
| **RSK-35-04** | **Crash during `dropDatabase()` execution**<br>Network drop or process death occurs while MongoDB is dropping the database. | Medium | Low | Stage 0 verifies empty collection count on retry, checks coordination registry for `DROP_IN_PROGRESS` or `CLEANUP_LOCKED`, and finalizes to `CLEANED`. | Negligible |
| **RSK-35-05** | **Process restart with old executor resuming later**<br>Executor instance 1 pauses, instance 2 restarts and completes cleanup, instance 1 resumes. | High | Low | Instance 2 invalidates token or sets `CLEANED`. Resuming Instance 1 validates token in `coordCol` and halts before destructive drop. | Negligible |
| **RSK-35-06** | **Standalone MongoDB deployment in production**<br>Attempting to run multi-document transactional recovery against standalone instance. | Critical | Low | System strictly checks topology and fails closed (verified in `D5-T1`). Standalone fallback is completely prohibited. | Negligible |
| **RSK-35-07** | **Accidental production or reserved database cleanup**<br>Cleanup called targeting `production`, `admin`, `config`, or non-test database. | Critical | Very Low | Mandatory prefix validation (`getTestDatabaseUri`), reserved name rejection, and ownership lock checks prevent targeting non-test databases. | Negligible |

---

## 2. Operational Boundaries & Guidelines

### 2.1 Replica Set Requirement
- Decision OS requires a MongoDB 3-node replica set with WiredTiger storage engine supporting multi-document transactions.
- Standalone deployments fail closed for all transactional recovery and cleanup operations.

### 2.2 Mutual Exclusion Invariant
- A test database under active cleanup (`DROP_IN_PROGRESS` / `dropExecutionLock: true`) is strictly immutable to re-assignment, re-claiming, or cross-worker adoption.
- No time-based lease expiry can automatically revoke or reassign destructive drop authority while a process may still be active.

### 2.3 Fail-Closed Coordination State
- Every test database lifecycle transition requires an active, verified coordination document in `decision_os_test_coordination_test.cleanup_registry`.
- If the coordination database is unreachable or the document is missing, operations fail closed immediately.
