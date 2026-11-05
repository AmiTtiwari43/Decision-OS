# DECISION OS — BATCH 4 REMEDIATION V3.4
## OPERATIONAL RISK REGISTER & BOUNDARY SPECIFICATION

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit (V3.3):** `19ab21c33e6c1286445c12e584db1fc97e890398`  
**Remediation Version:** V3.4  
**Date:** 2026-11-05  

---

## 1. Risk Register

| Risk ID | Description | Severity | Likelihood | Mitigation Strategy | Residual Risk |
| :--- | :--- | :---: | :---: | :--- | :---: |
| **RSK-34-01** | **Process crash during Stage 2 (`CLEANUP_LOCKED`)**<br>Process crashes after locking DB but before entering drop stage. | Medium | Low | Stage 2 sets `dropInProgress: false`. Retry recognizes `CLEANUP_LOCKED` and recovers seamlessly without generating duplicate locks. | Negligible |
| **RSK-34-02** | **Concurrent drop invocations by same worker**<br>Two asynchronous threads invoke cleanup concurrently. | High | Medium | Stage 3 atomic filter checks `dropInProgress: { $ne: true }`. Second caller is rejected with an explicit in-progress error. | Negligible |
| **RSK-34-03** | **Pre-drop takeover by newer worker/generation**<br>Worker 1 pauses (GC or network lag); Worker 2 supersedes generation. Worker 1 resumes and attempts drop. | Critical | Very Low | Invariant F pre-drop coordination lookup checks generation and owner immediately prior to calling `db.dropDatabase()`. Aborts if superseded. | Negligible |
| **RSK-34-04** | **Crash after `dropDatabase()` before coordination update**<br>Database is dropped on server, but client terminates before marking registry `CLEANED`. | Medium | Low | Stage 0 checks `listCollections()`. When count is 0, checks registry for `DROP_IN_PROGRESS` or `CLEANUP_LOCKED` and marks `CLEANED`. | Negligible |
| **RSK-34-05** | **Standalone MongoDB deployment in production**<br>Attempting to run multi-document transactional recovery against standalone instance. | Critical | Low | System strictly checks topology and fails closed (verified in `D5-T1`). Standalone fallback is completely prohibited. | Negligible |
| **RSK-34-06** | **Unowned or arbitrary database cleanup**<br>Accidental cleanup call targeting production or non-test database. | Critical | Very Low | Strict prefix and regex validation (`getTestDatabaseUri`), reserved database rejection (`admin`, `config`, `local`), and mandatory ownership metadata. | Negligible |

---

## 2. Operational Boundaries & Invariant Guidelines

### 2.1 Replica Set Topology Requirement
- Decision OS requires a MongoDB replica set (`rs0` or production equivalent) supporting the WiredTiger storage engine and multi-document transactions.
- Standalone deployments are strictly disallowed for transactional operations and will throw fatal guard exceptions upon connection initialization.

### 2.2 Time Source & Clock Skew Resilience
- All lease checks, coordination timestamps, and expiration comparisons use MongoDB server time (`$$NOW` or server-side queries) to eliminate risks stemming from application clock drift or unsynchronized host machines.

### 2.3 Coordination Registry Lifecycle
- The coordination collection (`cleanup_registry` in `decision_os_test_coordination_test`) retains lifecycle records.
- Records in `CLEANED` state serve as durable tombstones, preventing unauthorized re-creation or false-positive drop attempts on already-cleaned databases.

### 2.4 Monorepo & Engine Isolation
- The canonical decision engine (`packages/decision-engine`) contains zero database dependencies.
- It operates as a pure, deterministic MCDA calculation engine, strictly isolated from database lifecycle and recovery concerns.
