# DECISION OS — BATCH 4 REMEDIATION V3.6
## RISK REGISTER, ARCHITECTURAL BOUNDARIES & OPERATIONAL RUNBOOK

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit (V3.5):** `8a8ef7d62427d525d72d5352f24a75ea3bedf1cc`  
**Date:** 2026-11-05  

---

## 1. Executive Summary

This Risk Register catalogues all known residual operational risks, architectural boundaries, failure modes, and required maintenance invariants for Decision OS Batch 4 under version V3.6.

It provides explicit guidelines for operations, infrastructure management, and production maintenance.

---

## 2. Risk Matrix & Mitigations

| Risk ID | Title / Threat Description | Severity | Likelihood | Mitigation / Protocol Defense | Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **RISK-01** | Privileged out-of-band actor running `dropDatabase()` via raw driver or mongosh shell. | High | Low | Cluster-level MongoDB RBAC. Application roles must restrict `dropDatabase` privilege exclusively to designated worker service accounts. | **Documented Boundary** |
| **RISK-02** | Cross-host PID ambiguity when running distributed workers across multiple compute instances. | Medium | Low | Fail-closed policy. If `executorPid` cannot be verified via local OS `process.kill(pid, 0)` on the same host, recovery refuses automatic reassignment and alerts operator. | **Mitigated Fail-Closed** |
| **RISK-03** | Worker crash during native drop command leaving target database empty. | Low | Medium | Stage 0 Empty Database Reconciliation. If collections length is 0, subsequent recovery verifies ownership in registry and finalizes state to `CLEANED` without redundant drop. | **Mitigated Idempotently** |
| **RISK-04** | Transient network partition between worker and coordination database during cleanup sync. | Medium | Low | Strict fail-closed abort. `cleanupTestDatabase` aborts immediately before issuing destructive command if `cleanup_registry` is unreachable. | **Mitigated Fail-Closed** |
| **RISK-05** | Accidental deployment against MongoDB standalone instance lacking multi-document transactions. | High | Low | Connection guard assertion `assertReplicaSetConnection()`. All writes require replica set topology and fail closed immediately on standalone. | **Mitigated at Connection** |

---

## 3. Operational Invariants & Runbook Guidelines

### 3.1 MongoDB Deployment Requirement
- **Requirement:** Decision OS MUST run against a MongoDB Replica Set (minimum 3 nodes: Primary-Secondary-Secondary or Primary-Secondary-Arbiter).
- **Reason:** Multi-document ACID transactions and monotonic primary write concern are strictly required for state transitions and outbox dispatch. Standalone deployments are rejected fail-closed at connection startup.

### 3.2 Ephemeral Test Database Namespaces
- **Requirement:** All test database names MUST end with `_test` or match `/_test(?:_[a-zA-Z0-9_-]+)+$/`.
- **Reason:** `apps/api/src/db/guard.ts` rejects any destructive operation against reserved names (`production`, `admin`, `local`, `config`) or names lacking the designated test suffix.

### 3.3 Worker Supervision & Clean Exit
- **Requirement:** In containerized or CI/CD test runners, worker processes should be terminated using standard process management (SIGTERM followed by SIGKILL).
- **Reason:** The OS process termination check `isExecutorTerminated(pid)` relies on the kernel freeing the PID. Clean container or runner termination allows subsequent recovery routines to prove process exit without human intervention.

### 3.4 Canonical Decision Engine Protection
- **Requirement:** `packages/decision-engine` MUST remain a pure mathematical library with 0 database dependencies and 0 side effects.
- **Reason:** Monorepo architecture isolates MCDA computation from transactional persistence and transport concerns.
