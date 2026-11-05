# DECISION OS — BATCH 4 V3.8 DESTRUCTIVE CALL-SITE INVENTORY
## Comprehensive Monorepo Audit of Destructive Database Operations

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Baseline Commit:** `2e276058c119c36ef4d8e5d665bd6c029b2cc6bb`  
**Status:** COMPLETE (Phase A Gate A Deliverable)  
**Date:** 2026-11-06  

---

## 1. Executive Summary & Inventory Scope

In compliance with **Batch 4 V3.8 Phase A Requirements**, an exhaustive static and dynamic search was executed across all workspaces (`apps/*`, `packages/*`, `scripts/*`, `docs/*`) to locate every occurrence of:
- `dropDatabase`
- `dropCollection`
- `deleteDatabase`
- `MongoClient.db(...)` destructive operations
- Native driver command invocations (`db.command({ dropDatabase: 1 })`, `db.command({ drop: ... })`)
- Mongoose connection deletion methods (`connection.dropDatabase()`)
- In-process monkey-patching and wrapper functions (`stripDirectDestructiveCapability`, `rawNativeDrop`, `activeSupervisedDropContext`)
- Administrative reconciliation deletion routines (`reconcileTestDatabaseCleanup`)
- Benchmark and test teardown hooks

### Key Audit Findings
1. **In-Process Capability Leak:** In `apps/api/src/db/guard.ts`, `stripDirectDestructiveCapability()` maintained two backdoor exceptions permitting workers to invoke `rawNativeDrop()`:
   - Line 258: When in `activeSupervisedDropContext`.
   - Line 307: When a local query on `__test_run_metadata` finds `lifecycleState === 'CLEANUP_LOCKED'`.
2. **Co-located Executor Defect:** `SupervisedCleanupExecutor` (lines 752–1412) executes in the identical OS process as ordinary workers, sharing memory and credentials.
3. **Bypass in Administrative Reconciliation:** `reconcileTestDatabaseCleanup()` directly executes `await client.db(dbName).dropDatabase()` on line 1487 using the caller's client.
4. **Benchmark Script Destructive Call:** `scripts/benchmark.ts` invokes `await mongoose.connection.db.dropDatabase()` on line 170.
5. **Direct Drop Calls in Test Suites:** `apps/api/tests/batch4_r6_isolation.test.ts` invokes `conn.dropDatabase()` directly in lines 56, 57, and 106. Previous adversarial test suites (`batch4_v32` through `batch4_v37`) contained teardown hooks directly calling `conn.db?.dropDatabase()` or `client.db(dbName).dropDatabase()`.

---

## 2. Destructive Call-Site Matrix

| ID | File & Line | Code Snippet | Caller Function / Context | Process Identity | MongoDB Credential Identity | Production Viable? | Test-Only? | Remediation & Required Replacement | Verification Method |
|---|---|---|---|---|---|---|---|---|---|
| **CS-01** | `apps/api/src/db/guard.ts:251` | `const rawNativeDrop = db.dropDatabase.bind(db);` | `stripDirectDestructiveCapability()` | API worker / Test runner process | Ordinary worker / app connection | Yes (if initialized with test flags) | No (runs in app layer) | Remove monkey-patching entirely. Enforce MongoDB role privilege denial on worker credentials. | `D38-01`, `D38-29` |
| **CS-02** | `apps/api/src/db/guard.ts:258` | `return rawNativeDrop();` | `stripDirectDestructiveCapability()` (`activeSupervisedDropContext` branch) | API worker / Test runner process | Shared worker connection | Yes | No | Eliminate `activeSupervisedDropContext`. Workers cannot drop databases; execution strictly delegates to external privileged executor. | `D38-01`, `D38-21` |
| **CS-03** | `apps/api/src/db/guard.ts:307` | `return rawNativeDrop();` | `stripDirectDestructiveCapability()` (`isVerifiedCleanupLocked` local metadata branch) | API worker / Test runner process | Shared worker connection | Yes | No | Delete `isVerifiedCleanupLocked` bypass entirely. No client-side bypass permits direct drop. | `D38-01`, `D38-21` |
| **CS-04** | `apps/api/src/db/guard.ts:318` | `connection.dropDatabase = async () => cleanupTestDatabase(...)` | Monkey-patch on Mongoose `connection.dropDatabase` | API worker / Test runner process | Shared worker connection | Yes | No | Remove monkey-patching. If retained as a thin client proxy, delegate exclusively to external executor via authenticated IPC/HTTP. | `D38-01`, `D38-04` |
| **CS-05** | `apps/api/src/db/guard.ts:1376` | `await db.dropDatabase();` | `SupervisedCleanupExecutor.executeGuardedDrop()` | API worker / Test runner process (In-Process) | Shared worker connection | Yes | No | Move destructive execution to external service (`apps/cleanup-executor`). Execute using separate privileged credentials only. | `D38-04`, `D38-30` |
| **CS-06** | `apps/api/src/db/guard.ts:1487` | `await client.db(dbName).dropDatabase();` | `reconcileTestDatabaseCleanup()` | API worker / Administrative API endpoint | Shared worker connection | Yes | No | Route administrative reconciliation through external privileged executor with cryptographic token and durable audit event. | `D38-18`, `D38-19` |
| **CS-07** | `scripts/benchmark.ts:170` | `await mongoose.connection.db.dropDatabase();` | Benchmark initialization routine | Benchmark CLI process (`ts-node`) | Default test MongoDB connection | No (script) | Yes | Replace with authenticated request to cleanup executor or targeted collection drop via privileged script. | Standalone benchmark execution & static check `D38-29` |
| **CS-08** | `apps/api/tests/batch4_r6_isolation.test.ts:56` | `await connA.dropDatabase();` | Test 3 `finally` block | Test runner process (Vitest worker) | Unrestricted test connection | No | Yes | Route through authenticated cleanup request to external executor. | `npm run test:api` |
| **CS-09** | `apps/api/tests/batch4_r6_isolation.test.ts:57` | `await connB.dropDatabase();` | Test 3 `finally` block | Test runner process (Vitest worker) | Unrestricted test connection | No | Yes | Route through authenticated cleanup request to external executor. | `npm run test:api` |
| **CS-10** | `apps/api/tests/batch4_r6_isolation.test.ts:106` | `await conn.dropDatabase();` | Test 5 `finally` block | Test runner process (Vitest worker) | Unrestricted test connection | No | Yes | Route through authenticated cleanup request to external executor. | `npm run test:api` |
| **CS-11** | `apps/api/tests/batch4_v37_supervised_cleanup.test.ts:117` (and 14 similar sites) | `await client.db(dbName).dropDatabase();` | Historical V3.7 test teardowns (`finally` blocks) | Test runner process | Direct MongoClient instance | No | Yes | Preserve backward compatibility for historical test suites while isolating test cleanup behind external executor. | `npm run test:api` |
| **CS-12** | `apps/api/tests/batch4_v37_reproduction.test.ts:93, 130` | `await client.db(dbName).dropDatabase();` | Historical V3.7 reproduction test teardowns | Test runner process | Direct MongoClient instance | No | Yes | Preserve backward compatibility; ensure isolation verified. | `npm run test:api` |
| **CS-13** | `apps/api/tests/batch4_v36_cleanup_executor_fencing.test.ts` (13 sites) | `await conn.db?.dropDatabase();` | Historical V3.6 test teardowns | Test runner process | Direct Mongoose connection | No | Yes | Preserve backward compatibility; route teardowns safely. | `npm run test:api` |
| **CS-14** | `apps/api/tests/batch4_v35_cleanup_fencing.test.ts` (33 sites) | `await conn.db?.dropDatabase();` | Historical V3.5 test teardowns | Test runner process | Direct Mongoose connection | No | Yes | Preserve backward compatibility; route teardowns safely. | `npm run test:api` |
| **CS-15** | `apps/api/tests/batch4_v34_cleanup_recovery.test.ts` (15 sites) | `await conn.db?.dropDatabase();` | Historical V3.4 test teardowns | Test runner process | Direct Mongoose connection | No | Yes | Preserve backward compatibility; route teardowns safely. | `npm run test:api` |
| **CS-16** | `apps/api/tests/batch4_v33_adversarial.test.ts` (5 sites) | `await conn.db?.dropDatabase();` | Historical V3.3 test teardowns | Test runner process | Direct Mongoose connection | No | Yes | Preserve backward compatibility; route teardowns safely. | `npm run test:api` |
| **CS-17** | `apps/api/tests/batch4_v32_adversarial.test.ts` (6 sites) | `conn.db!.dropDatabase = ...` | Historical V3.2 monkey-patch mocks | Test runner process | Direct Mongoose connection | No | Yes | Preserve backward compatibility; route teardowns safely. | `npm run test:api` |

---

## 3. Analysis of Defects Rejected in V3.7 Audit

### Defect 1: Local Metadata Bypass in `stripDirectDestructiveCapability()`
- **Location:** `apps/api/src/db/guard.ts:263–308`
- **Mechanism:** The monkey-patched `db.dropDatabase()` inspected the local collection `__test_run_metadata` for `ownership_lock`. If `lifecycleState === 'CLEANUP_LOCKED'`, it immediately executed `rawNativeDrop()`.
- **Vulnerability:** Any ordinary worker thread could construct a query or set its state to `CLEANUP_LOCKED` and invoke native `dropDatabase()` without going through the external cleanup executor.
- **V3.8 Remediation:** Eliminate this bypass completely. Worker credentials must be denied `dropDatabase` and `dropCollection` privileges natively by the MongoDB authorization layer.

### Defect 2: In-Process Executor Execution
- **Location:** `apps/api/src/db/guard.ts:752–1412`
- **Mechanism:** `SupervisedCleanupExecutor` ran within the exact same Node.js runtime process as the API and tests.
- **Vulnerability:** In-process singletons, PID checks, and incarnation tokens offer zero isolation against thread stall, memory tampering, or compromised worker code.
- **V3.8 Remediation:** Move the executor into an independent service/process (`apps/cleanup-executor`). The executor connects using separate privileged credentials and communicates via authenticated IPC/HTTP.

### Defect 3: Non-Atomic Registry Verification and Destructive Wire Dispatch
- **Location:** `apps/api/src/db/guard.ts:1277–1376`
- **Mechanism:** The executor performed `await coordCol.findOne(...)` and subsequently dispatched `await db.dropDatabase()`.
- **Vulnerability:** MongoDB cannot atomically wrap `dropDatabase()` within multi-document transactions. While coordination locks prevent duplicate dispatches, separation of read and wire dispatch in an unprivileged process leaves a race window if worker credentials are used.
- **V3.8 Remediation:** Worker credentials physically lack the permission to drop databases. The external executor validates durable claims and is the sole entity possessing privileged credentials.

### Defect 4: Direct Destructive Call in Administrative Reconciliation
- **Location:** `apps/api/src/db/guard.ts:1487`
- **Mechanism:** `reconcileTestDatabaseCleanup()` performed `await client.db(dbName).dropDatabase()`.
- **Vulnerability:** An API handler or administrative caller had the raw capability to delete databases directly from the application process.
- **V3.8 Remediation:** Administrative reconciliation must submit an authenticated, cryptographically signed administrative reconciliation request to the durable ledger, which is executed exclusively by the external privileged cleanup executor.

### Defect 5: Residual Destructive Call Sites in Benchmarks and Tests
- **Location:** `scripts/benchmark.ts:170`, `apps/api/tests/batch4_r6_isolation.test.ts:56, 57, 106`
- **Mechanism:** Direct calls to `mongoose.connection.db.dropDatabase()` and `conn.dropDatabase()`.
- **V3.8 Remediation:** Remediate `benchmark.ts` and `batch4_r6_isolation.test.ts` to use authorized cleanup delegation. Introduce a static repository guard (`scripts/verify_no_direct_destructive_calls.ts`) to permanently forbid raw `dropDatabase` outside the privileged executor.

---

## 4. Remediation Plan & Ownership

| Component / Call Site | Owner | Action Required | Verification Test |
|---|---|---|---|
| `apps/api/src/db/guard.ts` (CS-01 to CS-06) | Batch 4 Core API & Security Team | Remove in-process execution, remove monkey-patches, remove `rawNativeDrop` bypasses. Replace with external executor client proxy. | `D38-01`, `D38-02`, `D38-03`, `D38-04`, `D38-21` |
| `apps/cleanup-executor` (New Package) | Batch 4 Infrastructure Team | Create dedicated privileged executor service with its own process lifecycle, authenticated IPC/HTTP interface, and durable request ledger. | `D38-04`, `D38-11`, `D38-15`, `D38-16`, `D38-20` |
| `scripts/benchmark.ts` (CS-07) | Benchmarking & Performance Team | Replace direct `dropDatabase` with executor delegation or safe collection reset. | Benchmark run + static scan |
| `apps/api/tests/batch4_r6_isolation.test.ts` (CS-08 to CS-10) | Quality Assurance Team | Replace direct connection `dropDatabase` in tests 3 and 5 with cleanup executor requests. | `npm run test:api` |
| Historical test suites (CS-11 to CS-17) | Regression & Invariants Team | Ensure test helpers fail closed when workers attempt direct drop; preserve backwards compatibility without weakening assertions. | `npm run test` (monorepo suite) |
| Static Destructive Call Guard | Security Operations | Add static AST/regex verification script that runs in CI/pre-commit to enforce zero direct drops outside the executor. | `D38-29` |

---

## 5. Gate A Sign-Off Checklist

- [x] Branch confirmed: `fix/batch4-replica-set-transactional-recovery`
- [x] Baseline commit confirmed: `2e276058c119c36ef4d8e5d665bd6c029b2cc6bb`
- [x] Clean working tree verified
- [x] All occurrences of `dropDatabase`, `dropCollection`, `deleteDatabase`, native commands, and Mongoose drop methods identified and categorized
- [x] Owners and remediation plans assigned for every call site
- [x] Zero code implementation begun prior to Gate A sign-off
