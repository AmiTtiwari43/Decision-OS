# DECISION OS — BATCH 4 V3.8 ARCHITECTURE DECISION
## Independent Cleanup Executor, Real MongoDB Privilege Separation & Concurrency Safety

**Document Version:** 1.4.0 (Phase B.4 Session Invalidation, Evidence Integrity & Provisioning Recovery)
**Repository:** `AmiTtiwari43/Decision-OS`
**Branch:** `fix/batch4-replica-set-transactional-recovery`
**Current Baseline Commit:** `949ca35a7154f4c4db308dd73badf85221a98c9f` (`docs: harden batch 4 v3.8 worker identity and role provisioning`)
**Prior Lineage Commits:** `724f1076284b186f42759677ab9e480d27531b69`, `943a8e7a433ce1b98804a83c6be403b2fca52e96`, `161e59e85bb7183c21926f0b04f788eb43312394`, `bbaf9bee29ef40f80bb8b958569c7ebbb437b427`, `2e276058c119c36ef4d8e5d665bd6c029b2cc6bb`
**Document Revision:** Working tree revision on `fix/batch4-replica-set-transactional-recovery` against baseline `949ca35a7154f4c4db308dd73badf85221a98c9f` (Phase B.4 Deliverable)
**Phase A Artifact:** `BATCH_4_V38_DESTRUCTIVE_CALLSITE_INVENTORY.md`
**Date:** 2026-11-06
**Status:** ARCHITECTURE DESIGN (Phase B.4 Deliverable — Pending Independent Review & Formal Gate B Approval)

---

## 1. Executive Summary

During Batch 4 V3.7, destructive database teardown operations were centralized behind an in-process `SupervisedCleanupExecutor` in `apps/api/src/db/guard.ts`. While V3.7 introduced coordination fencing concepts, the Phase A architectural audit (`BATCH_4_V38_DESTRUCTIVE_CALLSITE_INVENTORY.md`) and subsequent Phase B.1 and Phase B.2 security inquests revealed critical architectural defects:

1. **Absence of Real Process Isolation:** The V3.7 executor ran inside the exact same Node.js OS process and memory space as ordinary API workers and Vitest test runners.
2. **Absence of Native MongoDB Privilege Separation:** Ordinary workers and the cleanup executor shared identical MongoDB connection credentials; protection was simulated via JavaScript monkey-patching with backdoors (`isVerifiedCleanupLocked` and `activeSupervisedDropContext`).
3. **Invalid Privilege Scoping Assumptions (B38-01):** MongoDB RBAC does not support database-name wildcards (`decision_os_test_*`). Passing wildcard strings treats them literally as database names.
4. **Self-Referential Request Signing (B38-04):** The payload hash previously included `payloadHash` within the hashed body.
5. **Shared Secrets and Undecided Key Infrastructure (B38-05):** Symmetric shared HMAC secrets allowed any holder to impersonate other callers.
6. **Fencing Interleaving Realism (B38-07):** Application-level ledger CAS was erroneously claimed to atomically fence MongoDB server-side DDL commands.

### Phase B.2 Critical Security Remediation
Independent architectural review of baseline commit `943a8e7a433ce1b98804a83c6be403b2fca52e96` identified two structural privilege and recovery flaws:
1. **Additive Role Privilege Flaw (Finding 1 — B38-02, B38-03):** MongoDB role privileges are strictly additive. Granting broad `{ db: "", collection: "" }` write privileges inadvertently authorized workers to write to coordination collections, because MongoDB has no `deny` rules. Remediation eliminated broad grants in favor of exact per-database dynamic application roles.
2. **Administrative Redispatch Contradicts Fail-Closed Policy (Finding 2 — B38-06, B38-07):** Allowing `forceRedispatch` on ambiguous drop outcomes compromised fail-closed safety. Remediation removed all redispatch paths once `DISPATCHING` is entered, introducing the terminal state `QUARANTINED`.

### Phase B.3 Identity Isolation & Privilege Provisioning Remediation
Following the Phase B.2 baseline (`724f1076284b186f42759677ab9e480d27531b69`), multi-tenant and privilege-boundary inquest identified four security defects:
1. **Shared MongoDB Worker User Defeats Per-Worker Isolation (Finding B38-11):** Provisioning dynamic roles onto a shared user leaked permissions across concurrent workers. Remediated via unique per-worker MongoDB principals (`decision_os_worker_${runId}_${workerId}`) with ephemeral credentials.
2. **Unsafe MongoDB Role-Management Privileges (Finding B38-12):** Direct CRUD on `admin.system.*` and `userAdmin` on `admin` eliminated in favor of supported commands scoped to test namespaces with SHA-256 audit logging.
3. **Authoritative Oplog Evidence Is Underspecified (Finding B38-13):** Premature `CONFIRM_CLEANED` without correlation comments or majority commitment addressed via structured correlation tokens and fail-closed quarantine.
4. **Role Lifecycle and Provisioning Concurrency (Finding B38-14):** Analyzed concurrent claims and connection reuse across teardown, requiring post-revocation session and connection termination.

### Phase B.4 Session Invalidation, Evidence Integrity & Provisioning Recovery Remediation
Independent architectural review of baseline commit `949ca35a7154f4c4db308dd73badf85221a98c9f` identified five critical technical and authorization defects:

1. **Incorrect MongoDB Session Invalidation (Finding B38-15):**
   The architecture relied on `killAllUserConnections`, which does not exist in MongoDB. Furthermore, claiming that session termination physically closes TCP sockets is factually incorrect.
   **Remediation:** Replaced non-existent commands with supported MongoDB administrative commands: `killAllSessionsByPattern` and `killSessions`. Scoped `killAnySession` and required `impersonate` privilege strictly to the `{ cluster: true }` resource. Clearly distinguished logical session termination, operation cancellation (`killOp`), cursor closure, TCP socket retention, client driver-pool invalidation, and prevention of fresh authentication via `dropUser`. Formulated a fail-closed revocation protocol and documented limitations regarding prepared distributed transactions.
2. **Technically Unsupportable Oplog Evidence Protocol (Finding B38-16):**
   Section 10.4 referenced non-existent response paths (`optimesAndLocations.majorityCommitPoint`) and erroneously claimed that querying `local.oplog.rs` with `readConcern: "majority"` ensures majority read protection.
   **Remediation:** Reworked Section 10.4 using exact MongoDB 8.0 replica-set behavior: extracting `optimes.lastCommittedOpTime.ts` and `optimes.lastCommittedOpTime.t` from `replSetGetStatus` on the active primary. Explicitly acknowledged that the `local` database does not support read concern and silently ignores it. Formulated lexicographical OpTime comparison $(t, ts)$. Formally treated command-comment preservation in `local.oplog.rs` as unverified until demonstrated on live replica set `rs0`. Removed automatic `CONFIRM_CLEANED`; ambiguous drops remain permanently `QUARANTINED` unless live evidence is conclusively proven.
3. **Crash-Unsafe Ephemeral Credential Recovery (Finding B38-17):**
   The v1.3.0 architecture claimed idempotent credential redelivery upon worker retry, but held generated passwords only in volatile process memory while passwords in MongoDB are stored as one-way SCRAM verifiers. If the executor crashed after user creation but before response delivery, retries could not redeliver the plaintext password.
   **Remediation:** Designed a crash-safe credential recovery protocol utilizing a **Caller-Bound Encrypted Credential Envelope** stored durably in `ownership_locks.credentialEnvelope` (AES-256-GCM encrypted under an executor envelope key with AAD binding to request ID, database name, and caller public key fingerprint). Provided fallback to controlled password rotation via `updateUser` before activation. Enforced forward secrecy by zeroizing the envelope upon successful worker activation.
4. **False Provisioning Atomicity Claims (Finding B38-18):**
   The architecture described separate `createRole` and `createUser` commands while claiming overall lifecycle atomicity. MongoDB administrative commands cannot participate in multi-document transactions.
   **Remediation:** Replaced false atomicity claims with a **Durable Idempotent Provisioning Saga** defining explicit durable states (`CLAIM_PENDING`, `ROLE_CREATED`, `USER_CREATED`, `ROLE_ASSIGNED`, `CREDENTIAL_ENCRYPTED`, `CREDENTIAL_DELIVERED`, `ACTIVATED`, `ROLLING_BACK`, `ROLLED_BACK`, `ORPHAN_RECOVERY`). Defined crash/restart recovery at every transition, durable compensation for failed rollbacks, guarantees that partially provisioned identities possess zero unintended privileges, and strict 4-point verification proof before the orphan reaper deletes any user or role.
5. **Genuinely Tamper-Evident Audit Ledger (Finding B38-19):**
   The executor previously held `update`, `remove`, and `findAndModify` permissions across all coordination collections, including `cleanup_audit_log`, defeating claims of immutability.
   **Remediation:** Separated audit log permissions from coordination CRUD. Scoped the executor's privileges on `decision_os_coordination.cleanup_audit_log` strictly to append-only actions: `find`, `insert`, `createIndex` (zero update or remove). Established independently protected chain-head checkpoint storage. Defined cryptographic detection mechanisms for deletion, truncation, reordering, payload substitution, and full-chain rewriting, with fail-closed executor freezing and alerting upon verification failure. Discontinued inaccurate "immutable" claims in favor of verified append-only and tamper-evident semantics.

---

## 2. Baseline and Inspected Source References

### 2.1 Git Baseline & Provenance Verification
- **Target Repository:** `AmiTtiwari43/Decision-OS`
- **Active Branch:** `fix/batch4-replica-set-transactional-recovery`
- **Current Baseline Commit:** `949ca35a7154f4c4db308dd73badf85221a98c9f` (`docs: harden batch 4 v3.8 worker identity and role provisioning`)
- **Prior Lineage Commits:**
  - `724f1076284b186f42759677ab9e480d27531b69` (`docs: close batch 4 v3.8 privilege and redispatch gaps`)
  - `943a8e7a433ce1b98804a83c6be403b2fca52e96` (`docs: harden batch 4 v3.8 cleanup executor architecture`)
  - `161e59e85bb7183c21926f0b04f788eb43312394` (`refactor: add architecture decision record for batch 4 v3.8 cleanup executor`)
  - `bbaf9bee29ef40f80bb8b958569c7ebbb437b427` (`docs: add batch 4 v3.8 destructive call-site inventory document`)
  - `2e276058c119c36ef4d8e5d665bd6c029b2cc6bb` (`fix(batch4): isolate destructive cleanup behind supervised executor v3.7`)
- **Document Revision:** Working tree revision on `fix/batch4-replica-set-transactional-recovery` against baseline `949ca35a7154f4c4db308dd73badf85221a98c9f` (Phase B.4 Deliverable)
- **Target Database Engine:** MongoDB 8.0 (Replica Set `rs0`, as specified in `docker-compose.yml:3`).

### 2.2 Inspected Source Files & Line Ranges
The Phase A inventory (`BATCH_4_V38_DESTRUCTIVE_CALLSITE_INVENTORY.md`) was verified against the codebase at the baseline commit:

| Component / File Path | Inspected Line Range | Inspected Subject & Mechanism | Inventory ID |
|---|---|---|---|
| `apps/api/src/db/guard.ts` | Lines 90–165 | `getTestDatabaseUri()` canonical database naming logic, lifecycle state definitions, ownership interface | Baseline Naming Contract |
| `apps/api/src/db/guard.ts` | Lines 244–321 | `stripDirectDestructiveCapability()`, `rawNativeDrop` binding (line 251), `activeSupervisedDropContext` bypass (line 258), `isVerifiedCleanupLocked` local query bypass (line 307), `connection.dropDatabase` monkey-patch (line 318) | CS-01, CS-02, CS-03, CS-04 |
| `apps/api/src/db/guard.ts` | Lines 327–450 | `validateTestIdentity()`, `claimTestDatabaseOwnership()`, `ownership_lock` insertion and direct client updates on `cleanup_registry` | Baseline Ownership Registration |
| `apps/api/src/db/guard.ts` | Lines 750–850 | `SupervisedCleanupExecutor` in-memory state (`completedRequests`, `inFlightByRequestId`), duplicate request handling, collection inspection | Defect 2 (In-process executor) |
| `apps/api/src/db/guard.ts` | Lines 1270–1385 | `executeGuardedDrop()`, pre-wire coordination verification, `simulateLostResponse` hook, `activeSupervisedDropContext` assignment, native `await db.dropDatabase()` dispatch (line 1376) | CS-05 |
| `apps/api/src/db/guard.ts` | Lines 1414–1436 | `getSupervisedCleanupExecutor()`, `cleanupTestDatabase()` module wrapper | Worker delegation API |
| `apps/api/src/db/guard.ts` | Lines 1442–1506 | `reconcileTestDatabaseCleanup()`, `admin_token_` string prefix check, direct native call `await client.db(dbName).dropDatabase()` (line 1487) | CS-06 |
| `scripts/benchmark.ts` | Lines 160–185 | Benchmark database initialization, uncoordinated direct drop `await mongoose.connection.db.dropDatabase()` (line 170) | CS-07 |
| `apps/api/tests/batch4_r6_isolation.test.ts` | Lines 50–65 | Test 3 teardown `finally` block, direct drop calls `await connA.dropDatabase()` (line 56), `await connB.dropDatabase()` (line 57) | CS-08, CS-09 |
| `apps/api/tests/batch4_r6_isolation.test.ts` | Lines 85–110 | Test 5 teardown `finally` block, direct drop call `await conn.dropDatabase()` (line 106) | CS-10 |
| Historical test suites | CS-11 to CS-17 | Direct client drops in teardowns across `batch4_v37`, `batch4_v36`, `batch4_v35`, `batch4_v34`, `batch4_v33`, and `batch4_v32` | CS-11 to CS-17 |

---

## 3. Compare Architecture Alternatives

To eliminate in-process vulnerability and achieve verifiable privilege separation, three architectural alternatives were evaluated:

### Option A — Dedicated OS Process (Local Daemon / Child Process)
A separately launched Node.js daemon running on the host OS, communicating with the API/test workers via Unix Domain Sockets (UDS) or a localhost TCP port. It possesses its own process memory, lifecycle, MongoDB connection pool, and privileged credentials loaded from a protected environment file.

### Option B — Dedicated Containerized Service (Microservice) — SELECTED
An independently packaged and deployed container (`apps/cleanup-executor`), isolated in its own Linux namespaces (mount, pid, net, ipc) and cgroups. In production and staging, it runs as an independent Kubernetes Pod / Docker container. Privileged MongoDB credentials are provisioned exclusively to this container via Kubernetes Secrets or Docker Secret mounts. It exposes an authenticated mTLS / HTTP REST API protected by network policies.

### Option C — External Job / Queue Worker (Asynchronous Ledger Consumer)
An asynchronous worker process that pulls cleanup jobs from a durable MongoDB collection or an external message broker (RabbitMQ/Redis). Workers write a cleanup request document to the queue and await processing. The worker independently claims the job, executes the drop, and updates the document status.

### 3.1 Architecture Comparison Matrix

| Evaluation Dimension | Option A: Dedicated OS Process | Option B: Dedicated Containerized Service | Option C: External Job/Queue Worker |
|---|---|---|---|
| **1. Process & Memory Isolation** | **Moderate.** Separate OS PID and V8 heap; memory cannot be accessed via JS runtime. However, co-located processes on the same host can inspect `/proc` if running under the same UID. | **Strong Container Boundary.** Isolated Linux namespaces (PID, mount, IPC, net) and cgroups. Ordinary worker containers have no shared memory or filesystem mount access. | **Strong.** Operates in an independent worker container; completely decoupled execution context. |
| **2. Credential Isolation** | **Moderate.** Privileged credentials stored in an OS environment variable or root-owned file. Risk of leakage if child process inherits parent environment or runs as same user. | **Strong.** Secrets injected directly into the executor container filesystem (`/var/run/secrets/cleanup-executor`). Unprivileged worker containers cannot access the secret volume. | **Strong.** Queue worker possesses privileged MongoDB credentials; API workers only possess queue insertion credentials. |
| **3. Failure Domains & Restart** | **Coupled to Host.** If host OS runs low on memory or parent crashes, child process management requires custom process supervision (PM2/systemd) to prevent orphan/zombie processes. | **Isolated & Supervised.** Container runtime (Kubelet/Docker) manages restarts, liveness/readiness probes, and crash loops without affecting API worker containers. | **Decoupled.** Crashing the worker or API has zero effect on the queue; jobs remain buffered. Queue broker crash, however, halts all teardowns. |
| **4. Authentication & Authorization** | **Local IPC / UDS.** Relies on file permissions on socket file or localhost loopback token. Token management in local files is vulnerable to local file read flaws. | **mTLS / Signed HTTP.** Mutual TLS or cryptographic Ed25519 signatures over HTTP REST interface. Network policy strictly limits ingress to authorized caller categories. | **Queue-Level Authorization.** Workers authorized to write to queue; worker verifies signature in job payload. Synchronous acknowledgement requires bi-directional stream. |
| **5. Durable Request Handling** | **Requires Local Ledger.** Must persist state to database; if relying on local process queue, crash loses in-flight tracking. | **Native Durable Ledger.** Interacts directly with MongoDB coordination ledger (`cleanup_ledger`) using transactional fencing and atomic CAS transitions. | **Native Queue Durability.** Job is durably stored in queue broker or MongoDB collection ledger. |
| **6. Crash Recovery & Ambiguity** | **Moderate.** On restart, daemon reads database state; lacks standardized orchestration signals for graceful shutdown. | **Superior.** Container lifecycle hooks (`preStop`, `SIGTERM`) allow graceful draining of in-flight drops. Unacknowledged drops enter `OUTCOME_UNKNOWN` with durable fencing; zero redispatch. | **Complex.** If worker crashes mid-drop, queue visibility timeout may cause a second worker to attempt re-dispatch before first drop completes on server. |
| **7. Operational Complexity** | **High in Production.** Difficult to monitor, scale, and log separately from main application in containerized environments (Kubernetes). | **Low to Moderate.** Standard cloud-native pattern. Managed via standard Helm charts, Kubernetes Deployments, and Docker Compose for local dev. | **High.** Requires provisioning, clustering, and monitoring an external message broker (RabbitMQ/Redis) or building complex polling on MongoDB collections. |
| **8. Testability (Vitest Teardown)** | **Fast & Synchronous.** Fast IPC allows test runners (`afterEach`) to block synchronously until drop completes with minimal latency. | **Fast & Deterministic.** HTTP REST endpoint provides synchronous, deterministic completion responses to test workers without polling. | **Poor for Tests.** Asynchronous queue requires test runners to poll for job completion or listen on change streams, adding latency and flakes to CI suites. |
| **9. Local Development Experience** | **Simplest.** Can be started via `npm run dev:cleanup-daemon` or spawned by test runner. | **Standardized.** Spins up seamlessly in `docker-compose.yml` alongside MongoDB. For containerless local dev, can run via weaker development process profile. | **Heavy.** Requires spinning up Redis/RabbitMQ locally or running multiple background workers for simple unit test suites. |
| **10. Credential Rotation** | **Manual restart.** Requires restarting host process and updating configuration files on host. | **Seamless.** Secrets rotated via Kubernetes Secret updates or container redeployment with zero downtime. | **Seamless.** Secrets rotated in queue worker deployment independently of API. |
| **11. Risk of Accidental Destructive Access** | **Residual Risk.** If environment variables leak or parent process fails to strip credentials before spawning child, worker could access secret. | **Minimal.** Workers do not possess, inherit, or share credentials. Ingress strictly filtered by network policies, Ed25519 signatures, and RBAC denial. | **Low.** Workers cannot drop databases, but rogue worker could spam queue if permissions are not strictly scoped. |

---

## 4. Selected Architecture and Rationale

### 4.1 Decision
The selected architecture for Decision OS Batch 4 V3.8 is **Option B: Dedicated Containerized Cleanup Service (`apps/cleanup-executor`)**, deployed with:
1. **Per-Worker Distinct MongoDB Principals:** Every independently trusted worker process receives a dedicated MongoDB username (`decision_os_worker_${runId}_${workerId}`) and ephemeral in-memory credentials, completely eliminating shared accounts.
2. **Exact Per-Database Application Roles:** Eliminating broad `{ db: "", collection: "" }` write grants. Each worker is assigned a dynamic role strictly scoped to its single assigned test database (`decision_os_test_${runId}_${workerId}`).
3. **Granular Non-Superuser Role Provisioning:** The Cleanup Executor utilizes non-superuser MongoDB role and user commands (`createRole`, `createUser`, `dropRole`, `dropUser`), eliminating direct modification of `system.roles`/`system.users` and avoiding `userAdmin` on `admin`.
4. **Authoritative Majority Oplog Evidence Protocol:** Reconciling ambiguous outcomes requires cryptographically correlated drop comments and replica-set majority commitment proof, preventing rollback hazards and false drop confirmations.
5. **Strict Fail-Closed Quarantine State Machine:** Zero redispatch after `DISPATCHING`. Ambiguous or unproven drops remain permanently in `QUARANTINED` with execution locks indefinitely held.

### 4.2 Architectural Justification
1. **Elimination of Shared-User Privilege Leaks:** Because MongoDB role privileges are strictly additive across a single authentication principal, sharing a user account (`decision_os_app_worker`) destroys multi-worker isolation. Assigning unique credentials per worker enforces native MongoDB engine isolation across concurrent test executions.
2. **Elimination of Cluster-Superuser Escalation:** Direct writes to `admin.system.*` and built-in `userAdmin` grants on `admin` represent cluster superuser powers. Restricting the executor to supported commands for dynamic roles scoped exclusively to test namespaces guarantees least privilege.
3. **Deterministic Destruction Without Dual-Drop Danger:** Eliminating administrative redispatch guarantees that once `{ dropDatabase: 1 }` is transmitted across the wire, no subsequent or delayed drop command can ever execute against a reused or active database namespace.
4. **Physical & Credential Segregation:** The privileged MongoDB user (`decision_os_cleanup_executor`) is provisioned **only** within the cleanup executor container filesystem (`/var/run/secrets/cleanup-executor`). API workers receive unprivileged ephemeral identities that are denied `dropDatabase` and `dropCollection` natively by the MongoDB engine.
5. **Container Security Boundaries:** The executor runs with a read-only root filesystem (`read_only: true`), dropped Linux capabilities (`cap_drop: [ALL]`), no privilege escalation (`allowPrivilegeEscalation: false`), and an unprivileged system user (`UID 10001`).

---

## 5. Component Diagram

```mermaid
flowchart TD
    subgraph ClientAndTestSpace["Client & Ordinary Worker Boundary (Unprivileged)"]
        WorkerA["Vitest Worker A / API
(Identity: decision_os_worker_runA_wA)
(DB: decision_os_test_runA_wA)"]
        WorkerB["Vitest Worker B / API
(Identity: decision_os_worker_runB_wB)
(DB: decision_os_test_runB_wB)"]
        BenchmarkCLI["Benchmark Runner
(Identity: decision_os_benchmark_bench1)
(DB: decision_os_benchmark_bench1_test)"]
        ClientProxy["CleanupExecutorClient
(apps/api/src/db/cleanup-client.ts)"]

        WorkerA --> ClientProxy
        WorkerB --> ClientProxy
        BenchmarkCLI --> ClientProxy
    end

    subgraph SecurityBoundary["Network & Cryptographic Transport Boundary"]
        mTLS["mTLS / Authenticated HTTP REST (Port 8088)
- Ed25519 Asymmetric Signatures
- RFC 8785 JSON Canonicalization
- Replay Protection (Nonce + Timestamp)"]
        ClientProxy -->|POST /v1/ownership/claim
POST /v1/cleanup/request
POST /v1/cleanup/reconcile| mTLS
    end

    subgraph ExecutorSpace["Dedicated Cleanup Executor Boundary (Privileged Container)"]
        mTLS --> RequestValidator["Request Validator & Authn Engine
(Binds Ed25519 Public Key to Worker ID)"]
        RequestValidator --> RoleProvisioner["Role & User Provisioning Saga Manager
(Non-Superuser: createUser, createRole, grantRole,
Scoped ONLY to Test DB Namespaces)"]
        RequestValidator --> StateEngine["Durable State Machine Engine
(Authoritative Sole Writer of cleanup_ledger,
provisioning_saga, and QUARANTINED State)"]
        RoleProvisioner --> StateEngine
        StateEngine --> ExecutionBoundary["Destructive Execution Boundary
(apps/cleanup-executor/src/executor.ts)
*ONLY Production Allowlisted Drop Site*
*Dispatches { dropDatabase: 1, comment: ... }*"]
        ExecutionBoundary --> PrivPool["Privileged MongoDB Connection Pool
(Identity: decision_os_cleanup_executor)"]
    end

    subgraph DatabaseBoundary["MongoDB Test & Coordination Deployment (rs0 :27018)"]
        PrivPool -->|1. Scoped User & Role Management| AdminDB[("admin Database
- Non-Superuser Role Admin
- Ephemeral User Lifecycles")]
        PrivPool -->|2. Cluster Session Invalidation| ClusterRes[("Cluster Resource { cluster: true }
- killAllSessionsByPattern
- killAnySession & impersonate")]
        PrivPool -->|3. Coordination State & Append-Only Audit| CoordDB[("Coordination Database
(decision_os_coordination)
- ownership_locks
- cleanup_ledger
- provisioning_saga
- cleanup_audit_log (Append-Only)")]
        PrivPool -->|4. Correlated { dropDatabase: 1, comment }| TargetDBs[("Test Databases
- decision_os_test_runA_wA
- decision_os_test_runB_wB")]

        PoolA["Worker A Connection Pool
(Identity: decision_os_worker_runA_wA)"]
        PoolB["Worker B Connection Pool
(Identity: decision_os_worker_runB_wB)"]

        WorkerA -.-> PoolA
        WorkerB -.-> PoolB

        PoolA -->|CRUD ONLY on assigned DB| TargetDBA[("Target DB A
decision_os_test_runA_wA")]
        PoolB -->|CRUD ONLY on assigned DB| TargetDBB[("Target DB B
decision_os_test_runB_wB")]

        PoolA -.->|BLOCKED BY RBAC: Code 13 Unauthorized on DB B| TargetDBB
        PoolB -.->|BLOCKED BY RBAC: Code 13 Unauthorized on DB A| TargetDBA
        PoolA -.->|BLOCKED BY RBAC: Code 13 on coordination writes| CoordDB
        PoolB -.->|BLOCKED BY RBAC: Code 13 on dropDatabase| TargetDBs
    end

    classDef unprivileged fill:#f9d5e5,stroke:#eeac99,stroke-width:2px;
    classDef boundary fill:#eeeeee,stroke:#cccccc,stroke-width:2px;
    classDef privileged fill:#d5e8d4,stroke:#82b366,stroke-width:2px;
    classDef database fill:#dae8fc,stroke:#6c8ebf,stroke-width:2px;

    class WorkerA,WorkerB,BenchmarkCLI,ClientProxy,PoolA,PoolB unprivileged;
    class mTLS,RequestValidator,SecurityBoundary boundary;
    class RoleProvisioner,StateEngine,ExecutionBoundary,PrivPool privileged;
    class AdminDB,CoordDB,TargetDBs,TargetDBA,TargetDBB database;
```

---

## 6. Trust Boundaries and Credential-Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    participant WorkerA as Worker A (runA:wA)
    participant WorkerB as Worker B (runB:wB)
    participant Client as CleanupExecutorClient
    participant Executor as Cleanup Executor Service (apps/cleanup-executor)
    participant AdminDB as MongoDB: admin (Auth/RBAC)
    participant CoordDB as MongoDB: decision_os_coordination
    participant DBA as MongoDB: Target DB A (decision_os_test_runA_wA)
    participant DBB as MongoDB: Target DB B (decision_os_test_runB_wB)

    Note over WorkerA,DBB: PHASE 1: DIRECT ATTACK BLOCKED BY MONGODB RBAC
    WorkerA->>DBA: db.runCommand({ dropDatabase: 1 })
    DBA-->>WorkerA: MongoServerError: not authorized to execute { dropDatabase: 1 } (Code 13)
    WorkerA->>CoordDB: db.collection('ownership_locks').insertOne({...})
    CoordDB-->>WorkerA: MongoServerError: not authorized on collection ownership_locks (Code 13)

    Note over WorkerA,DBA: PHASE 2: DISCRETE IDENTITY & EPHEMERAL CREDENTIAL SAGA PROVISIONING
    WorkerA->>Client: claimTestDatabaseOwnership("decision_os_test_runA_wA", "runA", "wA")
    Client->>Client: Sign claim payload using Worker A Ed25519 Private Key
    Client->>Executor: POST /v1/ownership/claim (Payload + Ed25519 Signature)
    Executor->>Executor: Verify Signature, Caller ID "runA:wA", DB Naming Contract
    Executor->>CoordDB: Record Saga CLAIM_PENDING in ownership_locks
    Executor->>AdminDB: db.createRole({ role: "decision_os_role_runA_wA", privileges: [CRUD on DBA] })
    Executor->>AdminDB: Generate 32-byte secret; db.createUser({ user: "decision_os_worker_runA_wA", pwd: pwdA, roles: [...] })
    Executor->>CoordDB: Persist caller-bound encrypted credential envelope in ownership_locks.credentialEnvelope
    Executor->>CoordDB: Append audit log: USER_CREATED, ROLE_PROVISIONED (Append-Only)
    Executor-->>Client: HTTP 200 OK { user: "decision_os_worker_runA_wA", pwd: pwdA, db: "decision_os_test_runA_wA" }
    Client->>WorkerA: Initialize dedicated connection pool PoolA
    WorkerA->>Executor: POST /v1/ownership/activate (Signed activation handshake)
    Executor->>CoordDB: Zeroize envelope ($unset: { credentialEnvelope: 1 }), mark ACTIVATED

    Note over WorkerB,DBB: PHASE 3: WORKER B PROVISIONED INDEPENDENTLY
    WorkerB->>Executor: POST /v1/ownership/claim ("decision_os_test_runB_wB", "runB", "wB")
    Executor->>AdminDB: db.createRole("decision_os_role_runB_wB"), db.createUser("decision_os_worker_runB_wB", pwdB)
    Executor->>CoordDB: Store encrypted envelope for Worker B
    Executor-->>WorkerB: Deliver Credentials for PoolB
    WorkerB->>Executor: POST /v1/ownership/activate (Zeroize Worker B envelope)

    Note over WorkerA,DBB: PHASE 4: CROSS-WORKER ADVERSARIAL ISOLATION (B38-11)
    WorkerA->>DBB: PoolA.db("decision_os_test_runB_wB").collection("data").insertOne({ hacked: true })
    DBB-->>WorkerA: MongoServerError: not authorized on decision_os_test_runB_wB (Code 13)
    WorkerB->>DBA: PoolB.db("decision_os_test_runA_wA").collection("data").find()
    DBA-->>WorkerB: MongoServerError: not authorized on decision_os_test_runA_wA (Code 13)

    Note over WorkerA,DBA: PHASE 5: AUTHORIZED DESTRUCTIVE CLEANUP & CONNECTION INVALIDATION (B38-15)
    WorkerA->>Client: cleanupTestDatabase("decision_os_test_runA_wA", "runA", "wA")
    Client->>Executor: POST /v1/cleanup/request (Signed with Worker A Ed25519 Key)
    Executor->>Executor: Verify Signature, Nonce, Active Lease, Mark DISPATCHING
    Executor->>DBA: db.runCommand({ dropDatabase: 1, comment: JSON.stringify({ requestId, runA, wA }) })
    DBA-->>Executor: { ok: 1, dropped: "decision_os_test_runA_wA" }
    Executor->>CoordDB: Mark CLEANED in cleanup_ledger
    Executor->>AdminDB: db.adminCommand({ killAllSessionsByPattern: [{ users: [{ user: "decision_os_worker_runA_wA", db: "admin" }] }] })
    Executor->>AdminDB: db.dropUser("decision_os_worker_runA_wA"), db.dropRole("decision_os_role_runA_wA")
    Executor-->>Client: HTTP 200 OK { status: 'CLEANED' }
    Client->>WorkerA: Force worker connection pool invalidation (PoolA.close())
```

---

## 7. MongoDB Privilege Matrix

### 7.1 Mathematical Flaw of Additive Roles in MongoDB (B38-02, B38-03)
MongoDB 8.0 RBAC enforces privileges through **strict additive set union**:
$$\text{EffectivePrivileges}(U) = \bigcup_{R \in \text{InheritedRoles}(U)} \text{Privileges}(R)$$

MongoDB custom roles and built-in roles:
1. **Do not support `deny` rules.**
2. **Do not support privilege subtraction or negative filters.**
3. **Do not evaluate role precedence or specificity overrides.**

In the v1.1.0 design, `decision_os_worker_role` granted `{ db: "", collection: "" }` with actions `find, insert, update, remove, createCollection, createIndex, dropIndex`, and then attempted to make coordination collections read-only by adding `{ db: "decision_os_coordination", collection: "ownership_locks" }` with `actions: ["find"]`. Because `{ db: "", collection: "" }` authorized writes across all non-system databases, adding `find` merely performed a union, leaving workers with full wire write capabilities on coordination metadata.

### 7.2 Flaw of Shared MongoDB Worker User (Finding B38-11)
Section 3.3 attempted to solve role scoping by dynamically granting roles to a shared user:
`db.grantRolesToUser("decision_os_app_worker", ["decision_os_test_runA_w0_role"])`

**The Vulnerability:**
In MongoDB, privileges are associated with the **authenticated MongoDB user**, not the application-layer process or Ed25519 signing key. When multiple test workers authenticate as `decision_os_app_worker`:
$$\text{Privileges}(\text{decision\_os\_app\_worker}) = \text{BaseRole} \cup \text{Role}_{\text{Run A}} \cup \text{Role}_{\text{Run B}} \cup \dots$$

1. If Worker A is running tests against `decision_os_test_runA_w0`, and Worker B is running tests against `decision_os_test_runB_w0`, both connect as `decision_os_app_worker`.
2. Once the executor grants `Role_B` to `decision_os_app_worker`, Worker A immediately inherits write access to `decision_os_test_runB_w0` over its existing connection.
3. MongoDB does not inspect application-level tokens or Ed25519 signatures during wire CRUD commands.
4. **Conclusion:** A shared MongoDB authentication user completely defeats database-level isolation between concurrent workers. Each worker must have an independent, distinct MongoDB authentication principal.

### 7.3 Flaw of Unsafe Role-Management Privileges (Finding B38-12)
Section 3.2 authorized either direct modification of internal MongoDB collections (`admin.system.roles`, `admin.system.users`) or granting built-in `userAdmin` on `admin` to the cleanup executor.

**The Vulnerabilities:**
1. **Direct System Collection Manipulation:** Direct insert, update, or delete operations on `admin.system.roles` and `admin.system.users` bypass MongoDB's internal authorization consistency checks, risk internal metadata corruption, and are rejected or restricted by modern MongoDB storage engines.
2. **Superuser Escalation via `userAdmin` on `admin`:** The built-in `userAdmin` role on the `admin` database can create any role with arbitrary privileges and grant any role (including `root`) to itself or any user. Granting `userAdmin` on `admin` violates least privilege and effectively awards the cleanup executor cluster superuser control.

### 7.4 Granular Non-Superuser Role & User Provisioning Architecture (Finding B38-12, B38-15, B38-19)
Decision OS eliminates direct access to system collections and strips built-in `userAdmin`. Role and user management is performed exclusively through supported MongoDB administrative commands scoped strictly to test namespaces:

1. **Supported MongoDB Commands Used:**
   - `createRole` / `dropRole`
   - `grantRolesToUser` / `revokeRolesFromUser`
   - `createUser` / `dropUser` / `updateUser`
   - `killAllSessionsByPattern` / `killSessions`
2. **Exact Privileges of `decision_os_cleanup_executor_role`:**
   ```javascript
   db.getSiblingDB("admin").createRole({
     role: "decision_os_cleanup_executor_role",
     privileges: [
       // 1. Destructive drop capabilities strictly for test databases
       // NOTE: Broad { db: "", collection: "" } is mandated because MongoDB RBAC does not support database wildcards.
       // This makes the Dedicated Isolated Test Deployment a mandatory hard security boundary!
       {
         resource: { db: "", collection: "" },
         actions: [ "dropDatabase", "dropCollection", "listCollections", "find" ]
       },
       // 2. Authoritative management of coordination state collections
       {
         resource: { db: "decision_os_coordination", collection: "ownership_locks" },
         actions: [ "find", "insert", "update", "remove", "findAndModify", "createIndex" ]
       },
       {
         resource: { db: "decision_os_coordination", collection: "cleanup_ledger" },
         actions: [ "find", "insert", "update", "remove", "findAndModify", "createIndex" ]
       },
       {
         resource: { db: "decision_os_coordination", collection: "provisioning_saga" },
         actions: [ "find", "insert", "update", "remove", "findAndModify", "createIndex" ]
       },
       // 3. Append-only tamper-evident audit ledger (NO update, remove, or findAndModify!)
       {
         resource: { db: "decision_os_coordination", collection: "cleanup_audit_log" },
         actions: [ "find", "insert", "createIndex" ]
       },
       // 4. Cluster monitoring and session termination strictly on { cluster: true }
       {
         resource: { cluster: true },
         actions: [
           "listDatabases",
           "inprog",
           "checkCursorSanity",
           "killAnySession",
           "impersonate"
         ]
       },
       // 5. Granular role and user management on admin (NO system collection CRUD)
       {
         resource: { db: "admin", collection: "" },
         actions: [
           "createRole",
           "dropRole",
           "grantRole",
           "revokeRole",
           "createUser",
           "dropUser",
           "changePassword",
           "killAnyCursor"
         ]
       }
     ],
     roles: [] // NO built-in superuser roles (userAdmin, dbAdminAnyDatabase, root)!
   });
   ```
3. **Application-Level Provisioning Guardrails:**
   Inside `apps/cleanup-executor/src/provisioner.ts`, a strict guard enforces that the executor can **only**:
   - Create roles whose names match `^decision_os_role_[a-zA-Z0-9_-]+$`.
   - Grant privileges strictly matching `{ resource: { db: targetTestDb, collection: "" }, actions: [ "find", "insert", "update", "remove", "createCollection", "createIndex", "dropIndex" ] }`.
   - Create users whose usernames match `^decision_os_worker_[a-zA-Z0-9_-]+$` or `^decision_os_benchmark_[a-zA-Z0-9_-]+$`.
   - Refuse any request attempting to grant cluster actions, system database privileges (`admin`, `config`, `local`), or built-in roles (`root`, `clusterAdmin`).
4. **Tamper-Evident Audit Logging (Append-Only Boundary):**
   Every invocation of `createUser`, `createRole`, `grantRolesToUser`, `revokeRolesFromUser`, `dropRole`, `dropUser`, and `killAllSessionsByPattern` generates a structured JSON audit event appended to `decision_os_coordination.cleanup_audit_log` with SHA-256 hash chaining:
   $$\text{AuditHash} = \text{SHA256}(\text{PrevHash} + \text{Action} + \text{TargetUser} + \text{TargetRole} + \text{CallerId} + \text{Timestamp})$$
   Because MongoDB RBAC restricts the executor to `find`, `insert`, and `createIndex` on `cleanup_audit_log`, ordinary executor code paths and compromised workers are natively prevented from updating, modifying, or truncating historical audit entries.
5. **Failure Recovery for Role Provisioning:**
   - Multi-command provisioning failure and rollback are managed via the **Durable Provisioning Saga** (formalized in Section 9.1).
   - If user creation or credential encryption fails, compensating transactions (`dropRole`, release lock) are executed. If compensation encounters a network timeout, state is persisted as `ROLLBACK_PENDING`, and the background orphan reaper retries compensation until verified complete.

### 7.5 Complete Executor Privilege Scope Review & Hard Boundary Analysis

A rigorous security review of the complete executor privilege specification identified the precise structural boundaries between database-engine RBAC and application controls:

#### 1. Identification of Privileges Scoped to `{ db: "", collection: "" }`
The executor role contains **exactly one** privilege block scoped to `{ db: "", collection: "" }`:
```javascript
{
  resource: { db: "", collection: "" },
  actions: [ "dropDatabase", "dropCollection", "listCollections", "find" ]
}
```
In MongoDB RBAC, `{ db: "", collection: "" }` applies to **all non-system databases across the entire MongoDB instance**.

#### 2. Why the Dedicated Isolated Test Deployment is a Mandatory Hard Security Boundary
MongoDB RBAC does not support database name wildcard expressions (such as `decision_os_test_*`). If an administrator attempts to create a role with `{ db: "decision_os_test_*", collection: "" }`, MongoDB treats `"decision_os_test_*"` as a literal database name.
Consequently, to allow the Cleanup Executor to drop dynamically named test databases (`decision_os_test_${runId}_${workerId}`), the executor must possess `{ db: "", collection: "" }` with `dropDatabase`.

**CRITICAL ARCHITECTURAL CONSEQUENCE:**
Because `{ db: "", collection: "" }` is cluster-wide on the target `mongod` instance:
- MongoDB's native engine **cannot differentiate between test databases and production databases residing on the same instance**.
- If the cleanup executor were connected to a shared database cluster containing production or staging data, a single bug in application-level regex validation or an identity spoofing flaw could issue `dropDatabase` against a production namespace, and MongoDB RBAC would authorize it!
- **Conclusion:** The **Dedicated Isolated Test MongoDB Deployment (`mongodb-test:27018`) is a MANDATORY HARD SECURITY BOUNDARY**. Test databases and production databases must never share a MongoDB daemon, storage engine, or network namespace.

#### 3. Separation of MongoDB-Native Authorization from Application-Level Policy Guards
To ensure transparent security assurance, guarantees are partitioned into what MongoDB RBAC enforces versus what application guards enforce:

| Enforcement Layer | Security Capability | Concrete Mechanism | Bypass Risk / Failure Mode |
|---|---|---|---|
| **MongoDB-Native RBAC** | Unprivileged workers cannot drop databases | `decision_os_worker_base_role` and dynamic roles lack `dropDatabase` and `dropCollection`. | None at application level. Native wire reject (Code 13). |
| **MongoDB-Native RBAC** | Unprivileged workers cannot tamper with coordination metadata | Worker roles have `find` only on coordination collections; zero insert/update/delete. | None. Direct wire writes rejected (Code 13). |
| **MongoDB-Native RBAC** | Cross-worker test database isolation | Dynamic roles granted exclusively to unique per-worker principals. | None. Worker A accessing DB B rejected (Code 13). |
| **MongoDB-Native RBAC** | Append-only audit log protection | Executor possesses `find, insert, createIndex` on `cleanup_audit_log`; zero update/remove. | None. Even compromised executor cannot delete/update audit entries. |
| **MongoDB-Native RBAC** | Session invalidation capability | `killAnySession` and `impersonate` scoped to `{ cluster: true }`. | None. Allowed only for privileged executor. |
| **Application-Level Guard** | Test database naming enforcement | `assertValidTestDatabase(name)` regex check in `apps/cleanup-executor/src/executor.ts`. | Protects against dropping non-test DBs on the test instance. |
| **Application-Level Guard** | Dynamic role privilege scoping | `provisioner.ts` restricts `createRole` to CRUD on designated test DB; blocks cluster/admin grants. | Prevents executor bugs from creating superuser roles on test instance. |
| **Application-Level Guard** | Ephemeral user username validation | `provisioner.ts` validates usernames conform to `decision_os_worker_*`. | Prevents creating arbitrary administrative accounts. |

#### 4. Privileges Permitting Role Management Outside Test Namespace
The executor role possesses `createRole`, `dropRole`, `grantRole`, `revokeRole`, `createUser`, `dropUser`, and `changePassword` on `{ db: "admin", collection: "" }`. In MongoDB RBAC, having `createRole` on `admin` permits creating custom roles that grant privileges on any database.
- **MongoDB-Engine Boundary:** The executor role does not possess built-in roles (`root`, `userAdminAnyDatabase`), preventing it from granting existing superuser roles.
- **Application Policy Boundary:** The provisioner engine explicitly validates the role definition AST before dispatching `createRole`:
  - Target role name must match `^decision_os_role_[a-zA-Z0-9_-]+$`.
  - Target resource must match `{ resource: { db: targetTestDb, collection: "" } }` where `targetTestDb` passes canonical test naming.
  - Any request attempting to grant cluster actions or system DB actions throws an immediate validation exception (`DISALLOWED_PRIVILEGE_REQUEST`).

#### 5. Prevention of Accidental Connection to Staging or Production
To physically prevent the Cleanup Executor from accidentally pointing to staging or production environments, five independent fail-closed assertions are evaluated at process startup:
1. **Hardcoded URI Host Allowlist:** `apps/cleanup-executor` startup routine validates that `MONGO_URI` resolves to an allowlisted test database hostname (`mongodb-test`, `127.0.0.1:27018`, `localhost:27018`). Connection attempts to production DNS names (`*.prod.internal`, `*.staging.internal`) halt immediately with `FATAL_PRODUCTION_HOST_REJECTED`.
2. **Cluster Topology Metadata Inspection:** On connection establishment, the executor executes `db.adminCommand({ getCmdLineOpts: 1 })` and inspects cluster tags. If any replica set member or configuration contains tags indicating `environment: production` or `environment: staging`, the executor exits with status code 101.
3. **Environment Variable Interlocks:** Startup checks assert `NODE_ENV === 'test'` and `DECISION_OS_ALLOW_TEST_CLEANUP === 'true'`. If `NODE_ENV === 'production'`, startup is aborted.
4. **Physical Absence of Production Databases:** Startup routine executes `db.adminCommand({ listDatabases: 1 })`. If any production database name (e.g. `decision_os`, `decision_os_production`, `decision_os_analytics`) is present, startup immediately terminates.
5. **Network Container Egress Policy:** In Kubernetes and Docker Compose, the Cleanup Executor container is assigned to the `test-isolated-net` network with zero egress routing to staging or production subnets.

### 7.6 Per-Worker Discrete MongoDB Principal & Ephemeral Credential Model (Finding B38-11, B38-15, B38-17)

#### 1. Unique Principal Naming Standard
Every test worker and benchmark runner receives a dedicated MongoDB username:
- **Test Worker:** `decision_os_worker_${runId}_${workerId}` (e.g. `decision_os_worker_run_alpha_w0`, `decision_os_worker_iso_race_wA`)
- **Benchmark Process:** `decision_os_benchmark_${runId}` (e.g. `decision_os_benchmark_run_20261106_01`)
- **API Service (Staging/Production):** Long-lived static service principal `decision_os_api_service`, provisioned via Terraform/Secret, strictly scoped to production databases and denied all test provisioning or drop capabilities.

#### 2. Ephemeral Credential Generation & Secure Delivery
- **Secret Generation:** When `POST /v1/ownership/claim` is called, the executor generates an ephemeral 32-byte cryptographically secure random password via `crypto.randomBytes(32).toString('base64url')`.
- **In-Memory Transport:** Credentials are returned exclusively over the established mTLS / TLS encrypted HTTP session in the response body:
  ```json
  {
    "status": "CLAIMED",
    "databaseName": "decision_os_test_run_alpha_w0",
    "mongoCredentials": {
      "username": "decision_os_worker_run_alpha_w0",
      "password": "SECURE_EPHEMERAL_TOKEN_BASE64",
      "authSource": "admin",
      "connectionUri": "mongodb://decision_os_worker_run_alpha_w0:TOKEN@mongodb-test:27018/decision_os_test_run_alpha_w0?authSource=admin"
    },
    "leaseExpiresAt": "2026-11-06T01:31:00.000Z"
  }
  ```
- **Volatile Storage:** Test workers store credentials exclusively in V8 memory within the driver client pool. Credentials are never written to disk, environment files, or logs.

#### 3. Base Role and Scoped Dynamic Role Definitions
```javascript
// Base role for all ephemeral workers: ZERO write permissions on all databases!
db.getSiblingDB("admin").createRole({
  role: "decision_os_worker_base_role",
  privileges: [
    {
      resource: { db: "decision_os_coordination", collection: "ownership_locks" },
      actions: [ "find" ]
    },
    {
      resource: { db: "decision_os_coordination", collection: "cleanup_ledger" },
      actions: [ "find" ]
    }
  ],
  roles: []
});

// Dynamic role created per test database:
db.getSiblingDB("admin").createRole({
  role: "decision_os_role_decision_os_test_run_alpha_w0",
  privileges: [
    {
      resource: { db: "decision_os_test_run_alpha_w0", collection: "" },
      actions: [
        "find",
        "insert",
        "update",
        "remove",
        "createCollection",
        "createIndex",
        "dropIndex"
      ]
    }
  ],
  roles: []
});

// User created with ONLY its dedicated dynamic role:
db.getSiblingDB("admin").createUser({
  user: "decision_os_worker_run_alpha_w0",
  pwd: "SECURE_EPHEMERAL_TOKEN_BASE64",
  roles: [
    { role: "decision_os_worker_base_role", db: "admin" },
    { role: "decision_os_role_decision_os_test_run_alpha_w0", db: "admin" }
  ]
});
```

#### 4. Cryptographic Identity Binding
When Worker `run_alpha:w0` requests ownership, the executor:
1. Validates the Ed25519 signature of the request payload against the registered public key for `run_alpha:w0`.
2. Computes the required username `decision_os_worker_run_alpha_w0`.
3. Verifies that the requested database conforms to `decision_os_test_run_alpha_w0`.
4. Binds the public key fingerprint, username, and database name in `ownership_locks`:
   ```json
   {
     "databaseName": "decision_os_test_run_alpha_w0",
     "runId": "run_alpha",
     "workerId": "w0",
     "callerPublicKeyFingerprint": "ea4a6c63e29c...",
     "mongoUsername": "decision_os_worker_run_alpha_w0",
     "dynamicRole": "decision_os_role_decision_os_test_run_alpha_w0",
     "leaseExpiresAt": "2026-11-06T01:31:00.000Z",
     "generation": 1
   }
   ```
5. Any subsequent cleanup or heartbeat request for `decision_os_test_run_alpha_w0` must be signed by the private key corresponding to `callerPublicKeyFingerprint`.

#### 5. Cross-Worker Credential Isolation & Leakage Prevention
- Worker A cannot obtain Worker B's credentials: Worker B's credentials exist only in Worker B's process memory.
- Worker A cannot read credentials from MongoDB: MongoDB RBAC strictly denies `decision_os_worker_base_role` any read or find privileges on `admin.system.users` or `admin.system.roles`. Any attempt results in Error Code 13.
- In containerized CI/production environments, Linux cgroups and namespaces prevent inspecting `/proc` or memory of adjacent worker containers.

#### 6. MongoDB Session Invalidation & Connection Revocation Protocol (Finding B38-15)
The v1.3.0 architecture erroneously relied on `killAllUserConnections`, which is not an established MongoDB command, and claimed that killing sessions physically severs TCP sockets. The real MongoDB 8.0 connection and session lifecycle requires distinct technical layers:

##### a. Distinction Between Logical Sessions, Operations, Cursors, and TCP Sockets
To establish an authoritative security model, the architecture distinguishes six independent layers of state:
1. **Logical Session Termination (`killAllSessionsByPattern`):** Terminates server-side logical session state records (`lsid`) tracked in the `config.system.sessions` collection.
2. **In-Progress Operation Cancellation (`killOp`):** As part of session termination, MongoDB actively signals and aborts in-progress operations attached to the killed logical session.
3. **Cursor Closure:** All open client cursors associated with the terminated sessions are immediately pinned and reaped on the server.
4. **TCP Connection Sockets (Driver Connection Pool):** **Session termination DOES NOT physically close TCP network sockets.** The client driver maintains open TCP connections in its connection pool. MongoDB leaves the physical sockets connected at the transport layer.
5. **Client Driver-Pool Invalidation:** Complete physical socket closure requires the client process (or Vitest worker thread) to explicitly shut down or reset its driver connection pool via `await client.close(true)`.
6. **Fresh Authentication Prevention:** Dropping the user principal via `db.dropUser()` ensures that even if open sockets remain or reconnection attempts occur, subsequent authentication handshakes fail with MongoDB Error Code 11 (`UserNotFound`) or Error Code 18 (`AuthenticationFailed`).

##### b. Supported Command Syntax & Privilege Placement
In MongoDB 8.0, session invalidation by user pattern requires the `killAllSessionsByPattern` administrative command executed on the `admin` database:
```javascript
db.adminCommand({
  killAllSessionsByPattern: [
    {
      users: [
        { user: "decision_os_worker_run_alpha_w0", db: "admin" }
      ]
    }
  ]
});
```
- **Privilege Scoping:** To terminate sessions belonging to another user, MongoDB RBAC strictly requires the **`killAnySession`** and **`impersonate`** actions scoped to the **`{ cluster: true }`** resource. Placing these privileges on `{ db: "admin", collection: "" }` is invalid and causes MongoDB to reject the command with Error Code 13.

##### c. Fail-Closed Session Revocation Protocol
Whenever dynamic credentials are revoked (on teardown completion, lease expiry, or quarantine transition), the Cleanup Executor executes a deterministic 5-step revocation sequence:
1. **Step 1 — Kill Server Sessions & In-Flight Operations:** Dispatch `killAllSessionsByPattern` targeting the specific worker principal on authentication database `admin`. This cancels in-progress queries and closes open cursors.
2. **Step 2 — Immediate Role Revocation:** Dispatch `revokeRolesFromUser` to strip dynamic test database permissions from the worker identity.
3. **Step 3 — Drop User Identity:** Dispatch `dropUser` to delete the worker identity from `admin.system.users`. Any subsequent authentication attempt immediately fails with `UserNotFound` (Code 11).
4. **Step 4 — Client-Side Connection Pool Invalidation:** The `CleanupExecutorClient` in the worker process listens for teardown completion and immediately issues `await client.close({ force: true })`, terminating local TCP client sockets and clearing connection pools.
5. **Step 5 — Wire-Level Fail-Closed Boundary:** If a rogue worker thread or corrupted client process attempts to issue commands over lingering cached TCP sockets without re-authenticating, MongoDB's wire protocol verifies the session and authorization cache. Because the user has been dropped and the session killed:
   - Queries with a killed session ID fail with `NoSuchSession` (Code 261).
   - Queries attempting execution fail with `Unauthorized` (Code 13) or `UserNotFound` (Code 11).
   - Any driver reconnect attempt fails with `AuthenticationFailed` (Code 18).

##### d. Limitations Involving Prepared Transactions
MongoDB documentation explicitly establishes that **`killAllSessionsByPattern` will ignore and fail to kill sessions that have transactions in a `prepared` state** (part of two-phase commit consensus).
- **Test Worker Restriction:** Unprivileged worker identities are restricted to standard single-shard test databases and lack privileges to prepare distributed transactions.
- **Fail-Closed Handling:** If the executor inspects `currentOp` and detects a prepared transaction associated with an orphaned or expired worker, the executor will NOT attempt blind drop. It records an alert, explicitly coordinates with transaction coordinator controls to abort the transaction, and transitions the database to `QUARANTINED`.

---

#### 7. Crash-Safe Ephemeral Credential Recovery Architecture (Finding B38-17)

The v1.3.0 architecture claimed idempotent credential redelivery upon retry, but stored generated passwords only in volatile process memory. This produced a critical failure sequence:

##### a. Analysis of the Target Crash Sequence
1. Worker calls `POST /v1/ownership/claim` with `requestId: "550e8400..."`, `databaseName: "decision_os_test_runA_w0"`.
2. Executor validates signature and creates dynamic role `decision_os_role_runA_w0` in MongoDB.
3. Executor generates ephemeral password $P$ (32 cryptographically secure random bytes).
4. Executor executes `createUser` in MongoDB with password $P$ and dynamic role. MongoDB hashes and salts $P$ into SCRAM-SHA-256 verifier records in `admin.system.users`.
5. **CRASH:** The executor container abruptly crashes (OOM, hypervisor preemption, network partition) before transmitting the HTTP 200 response to the worker.
6. The executor container restarts and recovers coordination state.
7. Worker client times out and retries `POST /v1/ownership/claim` with the same `requestId` and matching payload hash.

##### b. The Cryptographic Reality of MongoDB SCRAM Verifiers
In MongoDB, `admin.system.users` stores SCRAM-SHA-256 credentials:
$$\text{StoredKey} = \text{HMacSHA256}(\text{ClientKey}, \text{AuthMessage}), \quad \text{ServerKey} = \text{HMacSHA256}(\text{SaltedPassword}, \text{"Server Key"})$$
The plaintext password $P$ **cannot be derived, recovered, or reverse-engineered from MongoDB's stored SCRAM verifier**. Claiming that a restarted executor can retrieve the original password from MongoDB is mathematically impossible.

##### c. Evaluation of Recovery Alternatives
Three architectural recovery strategies were evaluated:
1. **Option 1: Caller-Bound Encrypted Credential Envelope with Protected Durable Storage (SELECTED):**
   When the executor generates password $P$, it immediately encrypts $P$ into an authenticated ciphertext envelope using AES-256-GCM. The envelope is durably persisted inside the `ownership_locks` document (`credentialEnvelope`). Upon executor crash and worker retry, the restarted executor verifies caller identity, decrypts the envelope, and safely redelivers the exact credentials.
2. **Option 2: Password Rotation and Controlled Re-Issuance:**
   If the envelope is unavailable or corrupted, upon retried claim before activation, the executor issues `db.updateUser({ user: username, pwd: newPassword })`, generating a fresh password. However, if the worker *had* received the original response before a network timeout, rotating the password breaks active connections. Thus, rotation is reserved as a fallback for explicit re-issuance requests.
3. **Option 3: Fail-Closed Abandonment and Rollback:**
   If the retried request presents mismatched signatures, invalid generations, or expired leases, the claim is rejected with HTTP 409/403. The partial provisioning is rolled back, the user and role are dropped, and the caller must initiate a fresh claim.

##### d. Detailed Specification of the Selected Envelope Recovery Design
1. **Encryption & Key Ownership:**
   - Ephemeral passwords are encrypted using **AES-256-GCM** with a 96-bit random IV and 128-bit authentication tag.
   - The master envelope encryption key (`ENVELOPE_KEY`) is a 256-bit symmetric key mounted exclusively into the Cleanup Executor container via secret volume (`/var/run/secrets/cleanup-executor/envelope-key`). Worker containers have zero access to this key.
2. **Caller Cryptographic Binding (AAD):**
   - The GCM Additional Authenticated Data (AAD) binds the ciphertext to the exact request and caller context:
     $$\text{AAD} = \text{UTF8}(\text{requestId} + \text{"\|"} + \text{databaseName} + \text{"\|"} + \text{runId} + \text{"\|"} + \text{workerId} + \text{"\|"} + \text{callerPublicKeyFingerprint})$$
   - Any tampering with the lease document or attempt to use the envelope for another database/caller causes GCM authentication failure.
3. **Durable Storage in Coordination Schema:**
   The `ownership_locks` document stores the envelope during provisioning:
   ```json
   {
     "databaseName": "decision_os_test_runA_w0",
     "runId": "runA",
     "workerId": "w0",
     "callerPublicKeyFingerprint": "ea4a6c63e29c...",
     "mongoUsername": "decision_os_worker_runA_w0",
     "credentialEnvelope": {
       "format": "AES-256-GCM",
       "iv": "dGVzdEl2MTIzNDU2",
       "tag": "dGVzdFRhZzEyMzQ1Ng==",
       "ciphertext": "Y3J5cHRvQ2lwaGVydGV4dERhdGE=",
       "encryptedAt": "2026-11-06T01:00:00.000Z"
     },
     "leaseExpiresAt": "2026-11-06T01:01:00.000Z",
     "generation": 1,
     "status": "PROVISIONED_PENDING_ACTIVATION"
   }
   ```
4. **Idempotency & Restart Recovery Protocol:**
   - When a worker retries `POST /v1/ownership/claim` with the same `requestId`:
     1. Executor verifies Ed25519 signature against registered `callerPublicKeyFingerprint`.
     2. Executor reads `ownership_locks` for `databaseName`.
     3. Executor verifies `status === 'PROVISIONED_PENDING_ACTIVATION'` and `generation === 1`.
     4. Executor decrypts `credentialEnvelope` using `ENVELOPE_KEY` and validates AAD.
     5. Executor returns HTTP 200 OK with the decrypted password.
5. **Forward Secrecy & Credential Destruction:**
   - Plaintext passwords and encrypted envelopes must not persist indefinitely in coordination storage.
   - As soon as the worker successfully connects and performs its first action (or calls `POST /v1/ownership/activate` or sends its first lease heartbeat), the executor permanently destroys the envelope:
     ```javascript
     await db.collection("ownership_locks").updateOne(
       { databaseName, generation },
       {
         $unset: { credentialEnvelope: 1 },
         $set: { status: "ACTIVATED", activatedAt: new Date() }
       }
     );
     ```
   - Once activated, the envelope is deleted. If the worker crashes later, it must request controlled password rotation via signed administrative re-issuance.
6. **Partial-Failure & Expiry Handling:**
   - If the worker crashes and never retries, the 60-second lease expires (`leaseExpiresAt < now`).
   - The background lease reaper detects the expired unactivated lease, drops the user `decision_os_worker_runA_w0`, drops the dynamic role, and deletes the `ownership_locks` document, securely destroying the envelope and cleaning all residual state.

---

## 8. Request Protocol & Deterministic Test Vector

### 8.1 Fixing Hash & Signature Construction (B38-04)
To eliminate self-referential hashing, the protocol strictly separates the **Canonical Request Payload** from derived cryptographic fields (`payloadHash`, `signature`).

#### 1. Canonical Request Payload Schema
```typescript
interface CanonicalPayload {
  databaseName: string;
  expectedGeneration?: number;
  expiresAt: string; // ISO-8601 UTC
  requestId: string; // UUIDv4
  runId: string;
  workerId: string;
}
```

#### 2. RFC 8785 JSON Canonicalization Scheme (JCS)
The `CanonicalPayload` object is serialized strictly according to RFC 8785:
- Object property keys are sorted lexicographically by UTF-16 code units.
- No whitespace is permitted between tokens (`:`, `,`).
- Strings are encoded in UTF-8 without unnecessary escapes.
- Numbers are formatted per IEEE 754 rules.

#### 3. Payload Hash Definition
$$\text{payloadHash} = \text{"sha256:"} + \text{hex}(\text{SHA256}(\text{UTF8}(\text{RFC8785}(\text{CanonicalPayload}))))$$

#### 4. Canonical Signing String (Exact Byte Sequence)
$$\text{CanonicalSigningString} = \text{METHOD} + \text{"\n"} + \text{PATH} + \text{"\n"} + \text{REQUEST\_ID} + \text{"\n"} + \text{TIMESTAMP} + \text{"\n"} + \text{NONCE} + \text{"\n"} + \text{CALLER\_ID} + \text{"\n"} + \text{KEY\_ID} + \text{"\n"} + \text{PAYLOAD\_HASH}$$

$$\text{Signature} = \text{Ed25519\_Sign}(\text{PrivateKey}_{\text{caller}}, \text{UTF8}(\text{CanonicalSigningString}))$$

### 8.2 Deterministic Cryptographic Test Vector
```json
// 1. Canonical Payload (RFC 8785 Canonical JSON representation):
{"databaseName":"decision_os_test_run_alpha_w0","expectedGeneration":1,"expiresAt":"2026-11-06T01:00:00.000Z","requestId":"550e8400-e29b-41d4-a716-446655440000","runId":"run_alpha","workerId":"w0"}

// 2. Computed Payload Hash:
sha256:b636eacd006fce715be26299455a4601191ac55421fed9c7d762725bfeffebc0

// 3. Request Metadata & Headers:
METHOD: POST
PATH: /v1/cleanup/request
REQUEST_ID: 550e8400-e29b-41d4-a716-446655440000
TIMESTAMP: 2026-11-06T00:55:00.000Z
NONCE: a1b2c3d4e5f60718293a4b5c6d7e8f90
CALLER_ID: run_alpha:w0
KEY_ID: worker_key_run_alpha_w0_v1

// 4. Exact Canonical Signing String (8 lines joined by \n):
POST
/v1/cleanup/request
550e8400-e29b-41d4-a716-446655440000
2026-11-06T00:55:00.000Z
a1b2c3d4e5f60718293a4b5c6d7e8f90
run_alpha:w0
worker_key_run_alpha_w0_v1
sha256:b636eacd006fce715be26299455a4601191ac55421fed9c7d762725bfeffebc0

// 5. Ed25519 Key Pair (Seed: 32 bytes of 0x07):
Raw Public Key (hex): ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c
Signature (hex): 901bf025bd0d7f8561ad9ea77e3a4d03bca463a75f14c8e7aff792119f64ccc9bb125b4f5304beebacb2163468eff4029ba2369f998a475cf17dfbd6946c4c0c
Signature (base64): kBvwJb0Nf4VhrZ6nfjpNA7ykY6dfFMjnr/eSEZ9kzMm7EltPUwS+66yyFjRo7/QCm6I2n5mKR1zxffvWlGxMDA==
Verification Result: TRUE
```

### 8.3 Cryptographic Identity & Key Management (B38-05)
A uniform standard of **Asymmetric Ed25519 Signing** is selected for both Production and CI/Local environments. Shared HMAC symmetric secrets are rejected.

| Principal Identity | Key Generation & Ownership | Private Key Storage | Public Key Registration | Compromise Containment Boundary |
|---|---|---|---|---|
| **`API_SERVICE`** | Generated per deployment via KMS. | Kubernetes Secret volume mount (`/var/run/secrets/api-key`). | Pre-registered in executor key ring via ConfigMap/Secret. | Can only request cleanup of databases it legitimately owns in `ownership_locks`. |
| **`TEST_WORKER`** | Generated dynamically per test run/worker pool by test harness. | In-memory V8 heap of worker thread; never written to disk. | Registered with executor via signed registration handshake at test start. | Can only request cleanup of databases matching its assigned `runId` and `workerId`. |
| **`BENCHMARK_RUNNER`** | Generated per benchmark invocation. | Benchmark CLI runtime memory. | Registered via CLI startup handshake with benchmark token. | Scoped strictly to `decision_os_benchmark_*_test` databases. |
| **`ADMIN_OPERATOR`** | SRE individual hardware token / offline key pair. | Hardware Security Module (HSM) / secure workstation. | Explicitly loaded into executor admin key store. | Can perform administrative quarantine / confirmation; actions bound by mandatory narrative reasons and audit log. Cannot issue redispatch drops. |
| **`EXECUTOR`** | Generated per executor instance. | Container secret volume mount. | Published to workers for response signing / mTLS. | Signs completion responses and audit ledger records. |

### 8.4 Canonical Database Naming Contract
Reconciling `getTestDatabaseUri()` from `apps/api/src/db/guard.ts`, the canonical naming contract is formalized as:
$$\text{Canonical Regex: } \wedge(?:\text{decision\_os\_test}|\text{decision\_os\_test\_}[a\text{-}zA\text{-}Z0\text{-}9\_\-]+|\text{decision\_os\_benchmark\_}[a\text{-}zA\text{-}9\_\-]+ \text{\_test})\$$

- **Default Test Database:** `decision_os_test`
- **Run & Worker Scoped:** `decision_os_test_${runId}_w${workerId}` (e.g. `decision_os_test_run_alpha_w0`, `decision_os_test_iso_race_wA`)
- **Benchmark Database:** `decision_os_benchmark_${runId}_test`
- **Historical Test Database:** `decision_os_test_*_test`
- **Strict Blacklist:** Rejection of `production`, `admin`, `config`, `local`, `system`, or unadorned `decision_os`.

---

## 9. Durable Request Lifecycle & Ownership Management

### 9.1 Durable Idempotent Provisioning Saga Architecture (Finding B38-18)

The v1.3.0 architecture claimed that creating dynamic roles, creating worker users, assigning privileges, and generating credentials constituted an "atomic" operation. This was a false claim.

#### 1. Distinguishing MongoDB Command Atomicity from Multi-Command Workflows
In MongoDB 8.0:
- Single-document writes and standalone administrative DDL commands (`createRole`, `createUser`, `grantRolesToUser`, `dropRole`, `dropUser`) are internally atomic at the command level.
- **MongoDB administrative commands CANNOT participate in multi-document transactions.** It is impossible to wrap `createRole` and `createUser` in a MongoDB multi-document ACID transaction.
- Provisioning dynamic roles and worker credentials across MongoDB administrative catalogs, coordination storage, and HTTP network transports is fundamentally a **multi-command distributed workflow**.
- To guarantee transactional recovery without false atomicity claims, Decision OS formalizes role and user provisioning as a **Durable Idempotent Saga** managed by the Cleanup Executor.

#### 2. Durable Saga State Model
The provisioning workflow is persisted in `decision_os_coordination.provisioning_saga` (with correlation pointers in `ownership_locks`):

```mermaid
stateDiagram-v2
    [*] --> CLAIM_PENDING: POST /v1/ownership/claim (Validate signature & namespace)
    CLAIM_PENDING --> ROLE_CREATING: Acquire lease in ownership_locks
    ROLE_CREATING --> ROLE_CREATED: db.createRole (Dynamic test DB role)
    ROLE_CREATED --> USER_CREATING: Generate ephemeral secret
    USER_CREATING --> USER_CREATED: db.createUser (With base unprivileged role)
    USER_CREATED --> ROLE_ASSIGNED: db.grantRolesToUser (Attach dynamic role)
    ROLE_ASSIGNED --> CREDENTIAL_ENCRYPTED: Encrypt & store envelope in ownership_locks
    CREDENTIAL_ENCRYPTED --> CREDENTIAL_DELIVERED: Transmit HTTP 200 with credentials
    CREDENTIAL_DELIVERED --> ACTIVATED: POST /v1/ownership/activate (Zeroize envelope)

    ROLE_CREATING --> ROLLING_BACK: Role creation fails
    ROLE_CREATED --> ROLLING_BACK: User creation fails
    USER_CREATED --> ROLLING_BACK: Role assignment fails
    CREDENTIAL_ENCRYPTED --> ROLLING_BACK: Lease expires before activation / Worker crash
    ROLLING_BACK --> ROLLED_BACK: Compensating dropUser, dropRole, lease delete
    ROLLING_BACK --> ORPHAN_RECOVERY: Compensation fails (Network/Primary timeout)
    ORPHAN_RECOVERY --> ROLLED_BACK: Orphan reaper proves saga identity & cleans up

    ACTIVATED --> [*]: Active Test Execution Underway
    ROLLED_BACK --> [*]: Clean Terminal Rollback
```

#### 3. Durable Saga State Definitions & Mutations

| Saga State | Operation / Action | Preconditions | Durable Mutation Recorded | Compensating Action on Failure |
|---|---|---|---|---|
| **`CLAIM_PENDING`** | Validate request signature, nonce, canonical DB naming. | Database unclaimed or lease expired; valid Ed25519 signature. | Insert `_id: sagaId, requestId, runId, workerId, databaseName, state: 'CLAIM_PENDING'`. | Abort with HTTP 400/409; zero DB changes. |
| **`ROLE_CREATING`** | Acquire lease lock in `ownership_locks`. | Atomic insert on `ownership_locks` with unique index on `databaseName`. | `$set: { state: 'ROLE_CREATING', leaseExpiresAt: now + 60s }`. | Release lease lock. |
| **`ROLE_CREATED`** | Dispatch `db.createRole({ role: dynamicRole, privileges: [CRUD on targetTestDb] })`. | `admin` DB reachable; role does not exist. | `$set: { state: 'ROLE_CREATED', dynamicRoleName }`. | Transition to `ROLLING_BACK` $\rightarrow$ release lease lock. |
| **`USER_CREATING`** | Generate 32-byte secret $P$. Dispatch `db.createUser({ user, pwd: P, roles: [baseRole] })`. | Role created; user does not exist. | `$set: { state: 'USER_CREATING', mongoUsername }`. | Transition to `ROLLING_BACK` $\rightarrow$ `dropRole`. |
| **`USER_CREATED`** | User principal exists in `admin.system.users` with base role only. | User creation returned `{ ok: 1 }`. | `$set: { state: 'USER_CREATED' }`. | Transition to `ROLLING_BACK` $\rightarrow$ `dropUser`, `dropRole`. |
| **`ROLE_ASSIGNED`** | Dispatch `db.grantRolesToUser(user, [dynamicRole])`. | User and role exist. | `$set: { state: 'ROLE_ASSIGNED' }`. | Transition to `ROLLING_BACK` $\rightarrow$ `dropUser`, `dropRole`. |
| **`CREDENTIAL_ENCRYPTED`** | Encrypt $P$ under `ENVELOPE_KEY` with AAD; write to `ownership_locks.credentialEnvelope`. | AES-256-GCM encryption succeeds; AAD bound. | `$set: { state: 'CREDENTIAL_ENCRYPTED', credentialEnvelope }`. | Transition to `ROLLING_BACK` $\rightarrow$ `dropUser`, `dropRole`. |
| **`CREDENTIAL_DELIVERED`** | Deliver HTTP 200 OK with credentials over mTLS. | Envelope persisted durably. | `$set: { state: 'CREDENTIAL_DELIVERED' }`. | Worker retry redelivers via envelope; lease TTL reaps if abandoned. |
| **`ACTIVATED`** | Worker calls `/v1/ownership/activate` or sends first heartbeat ping. | Signature valid; generation matches. | `$unset: { credentialEnvelope: 1 }, $set: { state: 'ACTIVATED' }`. | None (Active test phase). |
| **`ROLLING_BACK`** | Execute compensating `dropUser`, `dropRole`, delete `ownership_locks`. | Error caught or unactivated lease expired. | `$set: { state: 'ROLLING_BACK', rollbackReason }`. | If compensation fails, mark `compensationPending: true` $\rightarrow$ `ORPHAN_RECOVERY`. |
| **`ROLLED_BACK`** | Compensations verified complete. | User, role, and lease confirmed deleted. | `$set: { state: 'ROLLED_BACK', completedAt: now }`. | Terminal clean state. |
| **`ORPHAN_RECOVERY`** | Background reaper sweeps stalled rollbacks. | Saga in `ROLLING_BACK` or lease expired with `compensationPending: true`. | `$set: { state: 'ORPHAN_RECOVERY', reaperClaimedAt: now }`. | Retries compensation with exponential backoff until verified deleted. |

#### 4. Recovery After Executor Crash at Every Transition
The executor evaluates the saga state table upon recovery or worker retry:
1. **Crash during `ROLE_CREATING`:** Role does not exist in MongoDB. Restarted executor finds `ROLE_CREATING` with expired lease. Compensation releases lock in `ownership_locks` and marks saga `ROLLED_BACK`.
2. **Crash between `ROLE_CREATED` and `USER_CREATING`:** Role exists in MongoDB, user does not. Restarted executor detects `ROLE_CREATED`. Retrying worker resumes saga (proceeds to create user), or if expired, compensation issues `dropRole` and marks `ROLLED_BACK`.
3. **Crash between `USER_CREATED` and `ROLE_ASSIGNED`:** User exists with ONLY base role (zero write permissions, zero test DB permissions). Restarted executor detects `USER_CREATED`. Retrying worker finishes role assignment, or compensation issues `dropUser` followed by `dropRole`.
4. **Crash between `ROLE_ASSIGNED` and `CREDENTIAL_ENCRYPTED`:** User and role exist, but password envelope was not saved. Plaintext password is lost in volatile memory. Restarted executor detects missing envelope. **Recovery Action:** Executor issues `updateUser({ user, pwd: newPassword })`, generates a new envelope, persists it, and delivers to caller.
5. **Crash after `CREDENTIAL_ENCRYPTED`, before HTTP delivery:** User, role, and encrypted envelope exist. Restarted executor receives retried claim with matching `requestId`. Executor decrypts envelope using `ENVELOPE_KEY`, validates AAD, and delivers credentials without modifying MongoDB.
6. **Crash after `CREDENTIAL_DELIVERED`, before `ACTIVATED`:** Worker has credentials. If worker connects, it sends activation handshake; executor zeroizes envelope and transitions to `ACTIVATED`. If worker crashed and never connects, the 60-second lease expires; lease reaper moves saga to `ROLLING_BACK` and cleans up.
7. **Crash during `ROLLING_BACK`:** Partial compensation executed (e.g. user dropped, role remains). On restart, orphan reaper detects `state: 'ROLLING_BACK'` and `compensationPending: true`. Reaper re-executes `dropUser` (no-op if already gone) and `dropRole`, verifying both are deleted before marking `ROLLED_BACK`.

#### 5. Failed Compensation Handling in Rollback
If a compensating command (`dropRole` or `dropUser`) fails due to transient network partition, driver timeout, or primary stepdown:
- The executor catches the error, records `compensationPending: true` with the failed target resource name in the saga document, and logs a high-severity warning.
- The background orphan reaper scans `provisioning_saga` every 30 seconds for records where `compensationPending === true`.
- The reaper applies an exponential backoff schedule (5s, 10s, 20s, up to 60s) to re-issue `dropRole` and `dropUser`.
- The saga cannot transition to `ROLLED_BACK` until MongoDB confirms with `{ ok: 1 }` (or `RoleNotFound` / `UserNotFound`) that the target resources no longer exist.

#### 6. Prevention of Duplicate Users, Roles, or Credentials
- **Deterministic Naming:** All dynamic entity names are derived strictly from canonical request identifiers:
  $$\text{dynamicRole} = \text{"decision\_os\_role\_"} + \text{runId} + \text{"\_"} + \text{workerId}$$
  $$\text{mongoUsername} = \text{"decision\_os\_worker\_"} + \text{runId} + \text{"\_"} + \text{workerId}$$
- **MongoDB Unique Constraints:** MongoDB natively rejects `createRole` or `createUser` if the role or username already exists in `admin`.
- **Saga Idempotency Checks:** Before dispatching `createRole`, the executor queries `db.getRole(dynamicRole)`. If it already exists and belongs to the same saga generation, it reuses the role rather than failing.

#### 7. Guarantee That Partially Provisioned Identities Possess Zero Unintended Privileges
To eliminate race conditions where a worker authenticates before provisioning finishes:
- **Least-Privilege Sequential Construction:** When `createUser` is called, the user is created with **`roles: ["decision_os_worker_base_role"]` ONLY**.
- `decision_os_worker_base_role` contains **zero write actions across all databases** and **zero read actions on test databases**.
- Even if a worker process attempts to authenticate immediately after user creation, it has zero ability to read or write test data.
- The dynamic role granting CRUD on the specific test database is attached in the subsequent `grantRolesToUser` step. If that step fails, the user is immediately dropped before elevated permissions are granted.

#### 8. Proof Required for Orphan Reaper Deletion
To prevent an orphan reaper from erroneously deleting an active role or user belonging to a concurrent test run, the reaper must verify a **strict 4-point proof** before issuing any `dropRole` or `dropUser`:
1. **Saga State Proof:** The saga document in `decision_os_coordination.provisioning_saga` must be in state `ROLLING_BACK` or `CLAIM_PENDING` with an expired lease (`leaseExpiresAt < now`).
2. **Lease Alignment Proof:** The `ownership_locks` document for `databaseName` must either be absent or contain a lease generation strictly less than or equal to the saga generation. If a newer generation has claimed the database, the reaper aborts.
3. **Role Privilege Verification Proof:** The reaper queries `db.getSiblingDB("admin").getRole(roleName, { showPrivileges: true })`. The reaper programmatically asserts that the role grants privileges **exclusively** on `{ resource: { db: targetTestDb, collection: "" } }` and contains zero grants on system or coordination databases. If any privilege extends beyond `targetTestDb`, the reaper refuses to delete it and raises an immediate security alarm (`UNPROVEN_ORPHAN_ABORT`).
4. **User Principal Verification Proof:** The reaper queries `db.getSiblingDB("admin").getUser(userName)`. The reaper asserts that the user is authenticated on `admin`, and that its assigned roles match **only** `decision_os_worker_base_role` and the specific dynamic role.

### 9.2 Authoritative Request Ledger Management (B38-03)
Ordinary workers are denied `insert`, `update`, and `remove` on `decision_os_coordination.cleanup_ledger`. The executor is the **authoritative sole writer**:
1. Worker calls `POST /v1/cleanup/request`.
2. Executor validates signature, payload hash, and active ownership lease.
3. Executor creates the `REQUESTED` record atomically (`findOneAndUpdate` with `$setOnInsert`).
4. Duplicate request handling:
   - Matching `requestId` + matching `payloadHash`: Returns idempotent status (`IN_PROGRESS`, `CLEANED`, or `QUARANTINED`).
   - Matching `requestId` + conflicting `payloadHash`: Returns HTTP 409 `IDEMPOTENCY_PAYLOAD_MISMATCH`.
5. Status Retrieval: Workers query status via `GET /v1/cleanup/request/:requestId` with signed read authorization.

### 9.3 State Machine Transition Table

```mermaid
stateDiagram-v2
    [*] --> REQUESTED: POST /v1/cleanup/request (Executor Sole Writer)
    REQUESTED --> REJECTED: Validation Failure / Nonce Replay
    REQUESTED --> CLAIMED: Acquire Execution Lease (Atomic CAS)
    CLAIMED --> RECONCILIATION_REQUIRED: Authority Superseded / Gen Bumped
    CLAIMED --> DISPATCHING: Pre-Wire Verification (dropExecutionLock = true)

    DISPATCHING --> CLEANED: Synchronous Wire Drop Success (dropExecutionLock = false)
    DISPATCHING --> OUTCOME_UNKNOWN: Wire Timeout / Lost Response / Crash (dropExecutionLock = true)

    OUTCOME_UNKNOWN --> OUTCOME_UNKNOWN: Catalog Absence Observed (targetAbsentObserved = true)
    OUTCOME_UNKNOWN --> QUARANTINED: Signed Admin SRE Reconcile (dropExecutionLock = true PRESERVED)
    OUTCOME_UNKNOWN --> CLEANED: Authoritative Majority Oplog Proof ONLY (Section 10.4)

    QUARANTINED --> [*]: Terminal Locked State (Namespace Abandoned)
    CLEANED --> [*]: Successful Teardown Complete
    REJECTED --> [*]: Terminal Validation Failure
```

| Current State | Event / Trigger | Next State | Permitted Actor | Preconditions & Atomic CAS Guard | Durable Mutations Recorded |
|---|---|---|---|---|---|
| **(None)** | `POST /v1/cleanup/request` | `REQUESTED` | Cleanup Executor (Sole Writer) | Signature valid, nonce unused, target DB whitelisted, caller owns lease in `ownership_locks`. | Insert `_id: requestId`, `runId`, `workerId`, `dbName`, `payloadHash`, `createdAt`, `state: 'REQUESTED'`. |
| **`REQUESTED`** | Validation Failure | `REJECTED` | Cleanup Executor | Signature invalid, target DB blacklisted, or nonce seen. | `$set: { state: 'REJECTED', rejectedReason, completedAt: now }`. |
| **`REQUESTED`** | Acquire Execution Lease | `CLAIMED` | Cleanup Executor | Ledger state is `REQUESTED`. Caller verified as active owner in `ownership_locks`. | `$set: { state: 'CLAIMED', claimedBy: executorId, claimGen: gen + 1, leaseExpiresAt: now + 30s }`. |
| **`CLAIMED`** | Pre-Wire Verification | `DISPATCHING` | Cleanup Executor | Lease active, `ownership_locks` confirms no generation bump, collections present. | `$set: { state: 'DISPATCHING', wireDispatchedAt: now, dropExecutionLock: true }`. |
| **`CLAIMED`** | Revocation Detected | `RECONCILIATION_REQUIRED` | Cleanup Executor | Ownership superseded by another worker or generation bumped. | `$set: { state: 'RECONCILIATION_REQUIRED', reason: 'AUTHORITY_SUPERSEDED' }`. |
| **`DISPATCHING`** | Wire Drop Returns Success | `CLEANED` | Cleanup Executor | MongoDB returns `{ ok: 1 }` across wire to the original dispatching connection. | `$set: { state: 'CLEANED', cleanedAt: now, dropExecutionLock: false }`. Revokes dynamic test role, drops user, terminates connections. |
| **`DISPATCHING`** | Wire Timeout / Socket Drop / Crash | `OUTCOME_UNKNOWN` | Cleanup Executor / Supervisor | Socket disconnect, driver timeout, or executor restart during wire dispatch. | `$set: { state: 'OUTCOME_UNKNOWN', error: 'SOCKET_TIMEOUT_OR_CRASH', dropExecutionLock: true }`. |
| **`OUTCOME_UNKNOWN`** | Catalog Absence Observed | `OUTCOME_UNKNOWN` | Cleanup Executor | Catalog query shows 0 collections. **Does NOT transition to CLEANED!** | `$set: { targetAbsentObserved: true, observedQuiescenceAt: now }`. |
| **`OUTCOME_UNKNOWN`** | Signed SRE Reconciliation Order (`action: "QUARANTINE"`) | `QUARANTINED` | Admin Operator (Signed) | SRE reviews incident, verifies evidence, signs quarantine order. **NO redispatch drop is issued!** | `$set: { state: 'QUARANTINED', quarantinedAt: now, quarantinedBy: opId, ticketId, dropExecutionLock: true }`. |
| **`OUTCOME_UNKNOWN`** | Authoritative Oplog Proof (`action: "CONFIRM_CLEANED"`) | `CLEANED` | Admin Operator (Signed) | Demonstrable server oplog record satisfies Section 10.4 (majority commit, comment correlation). | `$set: { state: 'CLEANED', reconciledAt: now, proofType: 'OPLOG_VERIFIED', dropExecutionLock: false }`. |

---

## 10. Ambiguous Destructive Outcomes & Recovery Matrix

### 10.1 Addressing Ambiguous Outcomes (B38-06, B38-07)
A single point-in-time observation of `listDatabases()` or `currentOp()` **is not proof of command completion**. Catalog absence or quiescent `currentOp()` may occur while:
1. File unlinking is occurring asynchronously in background storage threads.
2. A replica set primary is stepping down or buffering commands.
3. A paused executor process (e.g. JVM/V8 GC pause, hypervisor CPU starvation) is holding a dispatched packet in OS socket send buffers.
4. A network routing partition delayed transmission, meaning the original `{ dropDatabase: 1 }` wire packet will arrive at the MongoDB daemon in the future.

### 10.2 Mandatory Fail-Closed Recovery Policy
1. If the executor dispatched `{ dropDatabase: 1 }` across the wire, but did not receive durable confirmation, the request **must transition to `OUTCOME_UNKNOWN`**.
2. **Strict Prohibition of Redispatch:** Re-issuing `{ dropDatabase: 1 }` for any request that reached `DISPATCHING` is **strictly prohibited across all execution paths**:
   - Client API retries are rejected with HTTP 409 / 504.
   - Restarted executors will not re-claim or re-dispatch.
   - Successor executors detecting expired leases are forbidden from dispatching.
   - Administrative reconciliation cannot issue another wire drop.
3. **Permanent Lock Retention:** The execution lock (`dropExecutionLock: true`) **must remain held** indefinitely while in `OUTCOME_UNKNOWN` and upon transition to `QUARANTINED`.
4. **No False Completion:** The state must **never be marked `CLEANED` solely because the database is observed absent**.
5. **Terminal Quarantine:** To resolve operational alerts and close tracking tickets without claiming cleanup succeeded, operators transition requests to `QUARANTINED`.

### 10.3 Ambiguous-Outcome Recovery Matrix

| Scenario / Failure Point | Physical Cluster State | Ledger State at Crash | Post-Restart Safe Action | Recovery Evidence Required | Redispatch Permitted? |
|---|---|---|---|---|---|
| **1. Crash before claiming** | Target database intact; no drop issued. | `REQUESTED` | Restarted executor finds unexpired request; acquires claim via atomic CAS. | Valid lease acquisition on ledger document. | No (Normal initial dispatch). |
| **2. Crash after claiming, before dispatch** | Target database intact; no drop issued. | `CLAIMED` (`wireDispatchedAt: null`) | Lease expires. Successor detects `wireDispatchedAt == null`; safe to re-claim and dispatch initial drop. | `wireDispatchedAt === null` verified in ledger. | No (Resumes initial dispatch after lease expiry). |
| **3. Crash immediately before wire dispatch** | Target database intact; command not sent. | `CLAIMED` (`wireDispatchedAt: null`) | Same as Scenario 2. Command was never written to socket. | `wireDispatchedAt === null`. | No (Initial dispatch only). |
| **4. Crash after dispatch, before response** | Command sent; MongoDB may be actively dropping or delayed. | `DISPATCHING` (`wireDispatchedAt: timestamp`) | **FAIL CLOSED.** State moved to `OUTCOME_UNKNOWN`. Lock preserved. Automatic reassignment forbidden. | SRE signs quarantine order (`action: 'QUARANTINE'`). | **ABSOLUTELY FORBIDDEN ACROSS ALL PATHS.** |
| **5. Drop completes on server, response lost** | Database dropped on server; client socket severed. | `DISPATCHING` | Transition to `OUTCOME_UNKNOWN`. Record `targetAbsentObserved: true`. Retain lock. | Signed quarantine order OR authoritative oplog verification (Section 10.4). | **ABSOLUTELY FORBIDDEN.** |
| **6. Executor receives `{ok:1}`, crashes before ledger update** | Database dropped on server; ledger shows `DISPATCHING`. | `DISPATCHING` | Startup scanner detects `wireDispatchedAt` set; transitions to `OUTCOME_UNKNOWN`. Lock preserved. | Signed quarantine order OR authoritative oplog verification (Section 10.4). | **ABSOLUTELY FORBIDDEN.** |
| **7. API loses connection after `CLEANED` recorded** | Database dropped; ledger shows `CLEANED`. | `CLEANED` | Client retries with same `requestId`. Executor finds `state === 'CLEANED'`, returns success immediately. | Ledger document shows `state === 'CLEANED'`. | **FORBIDDEN.** Returns cached completion. |
| **8. MongoDB primary failover during wire drop** | Target database state undetermined; stepdown in progress. | `DISPATCHING` | Move to `OUTCOME_UNKNOWN`. Maintain lock. Refuse re-drop on new primary. | SRE investigation; transition to `QUARANTINED`. | **ABSOLUTELY FORBIDDEN.** |
| **9. Database absent, prior completion unproven** | Database absent from catalog; crash was during dispatch. | `OUTCOME_UNKNOWN` | **CRITICAL CONSTRAINT:** Catalog absence is not proof. Record `targetAbsentObserved: true`. Move to `QUARANTINED`. | Signed SRE quarantine order. | **ABSOLUTELY FORBIDDEN.** |
| **10. Executor restarts with ambiguous requests** | Undetermined cluster state. | `DISPATCHING` / `OUTCOME_UNKNOWN` | Startup scanner loads all `DISPATCHING` records and flags them `OUTCOME_UNKNOWN`. Retains locks. | Startup audit log entry; SRE alert fired. | **ABSOLUTELY FORBIDDEN.** |

### 10.4 Authoritative MongoDB 8.0 Replica Set Oplog Drop Evidence Protocol (Finding B38-13, B38-16)

Section 4.2 allowed `CONFIRM_CLEANED` when oplog records prove completion. The v1.3.0 formulation contained technical errors: it referenced non-existent fields (`optimesAndLocations.majorityCommitPoint`), assumed that `readConcern: "majority"` applies to the `local` database, and assumed that DDL command comments are preserved in `local.oplog.rs`.
The evidence protocol is reworked using exact, empirically verifiable MongoDB 8.0 replica-set behavior:

#### 1. Expected Oplog Record Structure in MongoDB 8.0
In a replica set (`rs0`), database drop operations generate a command record in `local.oplog.rs`:
```javascript
{
  "op": "c",                         // Command operation
  "ns": "decision_os_test_run_alpha_w0.$cmd",
  "o": {
    "dropDatabase": 1,
    "comment": "{"requestId":"550e8400...","runId":"run_alpha","payloadHash":"sha256:...","wireDispatchedAt":"2026-11-06T00:55:00.000Z"}"
  },
  "ts": Timestamp(1762390500, 1),    // BSON Timestamp (seconds, increment)
  "t": NumberLong(2),                // Replica set election term
  "v": 2,                            // Oplog format version
  "wall": ISODate("2026-11-06T00:55:00.120Z"),
  "lsid": { "id": UUID("...") },
  "txnNumber": NumberLong(0)
}
```

#### 2. Cryptographic Command Correlation via `comment` (Hypothesis Under Test)
When the Cleanup Executor dispatches `{ dropDatabase: 1 }`, it embeds a structured correlation payload inside the command `comment` field:
```typescript
const correlationMetadata = {
  requestId: request.requestId,
  runId: request.runId,
  workerId: request.workerId,
  payloadHash: request.payloadHash,
  wireDispatchedAt: request.wireDispatchedAt.toISOString()
};

await testDb.command({
  dropDatabase: 1,
  comment: JSON.stringify(correlationMetadata)
});
```

> [!WARNING]
> **Unverified DDL Comment Preservation Risk (Finding B38-16):**
> MongoDB documentation describing comments in server logs, profiler output, and `currentOp` is **NOT sufficient proof** that DDL commands (such as `dropDatabase`) preserve the `comment` field in `local.oplog.rs`. In some storage engine versions, DDL command transformations strip or omit application comments.
> Therefore, **comment preservation in `local.oplog.rs` is formally classified as an UNVERIFIED ARCHITECTURAL HYPOTHESIS** until empirically proven on the actual target MongoDB 8.0 replica set deployment via verification test **`D38-21`**.
> If live testing demonstrates that MongoDB 8.0 strips `comment` from `dropDatabase` oplog records, automatic reconciliation via oplog correlation is technically impossible. In that event, `CONFIRM_CLEANED` is disabled entirely, and all ambiguous drops remain permanently `QUARANTINED`.

#### 3. Critical Reality: `local` Database Ignores Read Concern
MongoDB documentation explicitly dictates:
> *The `local` database does not support read concern. Queries against the `local` database silently ignore configured read concerns.*

**Architectural Consequence:**
- Querying `local.oplog.rs` with `readConcern: { level: "majority" }` **does NOT provide majority-read protection**. The MongoDB engine silently executes a local uncommitted read.
- Reading an entry from `local.oplog.rs` on a primary node does NOT guarantee that the entry has been replicated to a majority of nodes or that it will survive a replica set election.
- Therefore, majority durability **cannot be achieved via query read concern**. Durability must be established programmatically by comparing the oplog entry's OpTime against the cluster's majority commit point returned by administrative status commands.

#### 4. Primary Verification and Election Term Consistency
To prevent reading stale or rolled-back oplog records:
1. The executor must query `db.adminCommand({ hello: 1 })` on the target connection.
2. The node must confirm `isWritablePrimary === true`.
3. The current election term `topologyVersion` and `electionId` are recorded.
4. If a primary election or stepdown occurred during query execution, the read is aborted.

#### 5. Establishing Majority Commitment via `replSetGetStatus`
In MongoDB 8.0, the replica set's majority commit point is exposed in the `optimes` block of `replSetGetStatus`:
```javascript
const status = await adminDb.command({ replSetGetStatus: 1 });
const lastCommitted = status.optimes.lastCommittedOpTime;
// lastCommitted contains:
//   ts: Timestamp (seconds, increment)
//   t:  NumberLong (election term)
```
*(Note: Unsupported or non-standard paths such as `optimesAndLocations.majorityCommitPoint` are eliminated.)*

##### Lexicographical OpTime Comparison Logic:
In MongoDB replication, an OpTime is an ordered 2-tuple $(t, ts)$ where $t$ is the election term (`Long`) and $ts$ is the BSON Timestamp (`Timestamp`).
An oplog entry $E = (t_E, ts_E)$ is majority committed if and only if it lexicographically precedes or equals the cluster's `lastCommittedOpTime` $C = (t_C, ts_C)$:
$$\text{IsMajorityCommitted}(E, C) \iff (t_E < t_C) \lor (t_E == t_C \land ts_E \le ts_C)$$

- If $t_E > t_C$, the entry was generated in a term that has not reached majority consensus $\rightarrow$ **REJECT**.
- If $t_E == t_C$ and $ts_E > ts_C$, the entry is uncommitted in the current term and subject to rollback $\rightarrow$ **REJECT**.
- Only when $\text{IsMajorityCommitted}(E, C)$ evaluates to `true` has the drop achieved cluster-wide persistence.

#### 6. Oplog Retention and Rollover Detection
The `local.oplog.rs` collection is a capped collection with fixed disk allocation. Under high write throughput, older entries are evicted.
To prevent false negatives or confusing historical runs:
1. Before searching for drop evidence, the executor queries the oldest available record in `local.oplog.rs`:
   ```javascript
   const oldestRecord = await localDb.collection("oplog.rs").find().sort({ $natural: 1 }).limit(1).next();
   const oldestTs = oldestRecord ? oldestRecord.ts : null;
   ```
2. **Rollover Rule:** If `oldestTs` is null, or `oldestTs > wireDispatchedAt`, an oplog rollover occurred between dispatch and reconciliation. The conclusive evidence was evicted.
3. When oplog rollover is detected, **`CONFIRM_CLEANED` is STRICTLY FORBIDDEN**. The request must remain permanently in `QUARANTINED`.

#### 7. Mandatory Live Evidence Checklist
To authorize `CONFIRM_CLEANED`, all six evidence assertions must evaluate to `TRUE`:
1. **Target Namespace Match:** `ns === `${targetDatabaseName}.$cmd`` and `o.dropDatabase === 1`.
2. **Cryptographic Correlation Match:** `JSON.parse(o.comment).requestId === originalRequestId` and `JSON.parse(o.comment).payloadHash === originalPayloadHash`.
3. **Temporal Consistency:** The oplog entry's `wall` clock time satisfies:
   $$\text{wireDispatchedAt} - 1000\text{ms} \le \text{entry.wall} \le \text{reconcileRequestedAt}$$
4. **Majority Commitment Proven:** $\text{IsMajorityCommitted}(E, C) === \text{true}$ against `optimes.lastCommittedOpTime`.
5. **No Rollover:** `oldestOplogTs <= wireDispatchedAt`.
6. **Primary Stability:** Queried node confirmed active primary throughout evidence extraction.

#### 8. Insufficient Evidence Catalog (Immediate Rejection)
The following evidence is explicitly classified as **INSUFFICIENT** to authorize `CONFIRM_CLEANED`:
- Catalog absence (`listDatabases()` or `listCollections()` returning empty).
- `currentOp()` reporting no in-flight drop.
- An oplog `dropDatabase` record lacking the structured `comment` field.
- An oplog record with missing, malformed, or unparseable JSON `comment`.
- An oplog record with mismatched `requestId` or `payloadHash`.
- An oplog record where `wall < wireDispatchedAt`.
- An oplog record where $\text{IsMajorityCommitted}(E, C) === \text{false}$ (uncommitted / rollback hazard).
- An oplog where rollover occurred prior to `wireDispatchedAt`.

#### 9. Fail-Closed Protocol for Missing, Malformed, or Unproven Evidence
If any requirement of the evidence protocol fails:
- SRE request for `CONFIRM_CLEANED` is **rejected with HTTP 422 `UNPROVEN_DROP_COMPLETION`**.
- The request **must remain permanently in `QUARANTINED`**.
- The execution lock (`dropExecutionLock: true`) is **permanently retained**.
- The database namespace is marked permanently poisoned in `ownership_locks`.
- Automated tests continue unaffected by provisioning fresh UUID-based database names (`decision_os_test_${runId}_w${workerId}`). Storage reclamation for quarantined namespaces is deferred to offline maintenance.

---

## 11. Administrative Reconciliation Design

Administrative reconciliation is an emergency, cryptographically authorized protocol used to resolve databases stuck in `OUTCOME_UNKNOWN` or `RECONCILIATION_REQUIRED`. It operates under strict security boundaries and **cannot bypass the fail-closed policy**.

### 11.1 Authentication & Operator Identity
- **No String Tokens:** Legacy token checks (`admin_token_`) are completely eliminated.
- **Operator Identity:** Established via an independent **Administrative Key Pair** (`ADMIN_OPERATOR` role). Keys are held only by designated Site Reliability Engineers (SRE).
- **Mandatory Narrative Reason:** Every reconciliation request must provide a narrative explanation ($\ge 15$ characters) and an operational ticket ID (e.g. `OPS-8472`).
- **Complete Elimination of Wire Drops:** Administrative reconciliation **never issues a database drop command**. Every code path capable of redispatching a drop from reconciliation has been removed.

### 11.2 Reconciliation Request Schema
```json
{
  "reconciliationId": "771e8400-e29b-41d4-a716-446655449999",
  "targetDatabase": "decision_os_test_run_alpha_w0",
  "operatorId": "sre_operator_amit",
  "ticketId": "OPS-8472",
  "action": "QUARANTINE",
  "reason": "Replica set primary failover during wire drop severed socket; quarantining namespace per fail-closed policy",
  "evidence": {
    "verifiedCollectionsCount": 0,
    "currentOpConfirmedClean": true,
    "clusterCatalogAbsent": true,
    "authoritativeServerOplogVerified": false
  },
  "timestamp": "2026-11-06T01:10:00.000Z",
  "signature": "MEQCIA..."
}
```

### 11.3 Execution Flow & Supported Actions
1. **Verification of Authority:** The executor verifies the Ed25519 signature against the `ADMIN_OPERATOR` public key ring. Unprivileged worker keys calling `/v1/cleanup/reconcile` are rejected with HTTP 403 `FORBIDDEN_OPERATOR_ROLE`.
2. **Target Scope Check:** The target database must conform to the canonical test naming convention. Production databases are rejected by code and blocked natively by MongoDB RBAC.
3. **Execution by Action Type:**
   - **Action `QUARANTINE` (Standard Operational Remediation):**
     - Target request must be in `OUTCOME_UNKNOWN` or `RECONCILIATION_REQUIRED`.
     - Executor transitions ledger state to `QUARANTINED`.
     - Executor permanently marks the database namespace in `ownership_locks` as `QUARANTINED_BLOCKED`.
     - **Execution lock (`dropExecutionLock: true`) is permanently retained.**
     - De-provisions any residual dynamic worker roles associated with this database.
     - **NO wire drop command is dispatched.**
     - Resolves SRE operational alerts safely without falsely claiming that cleanup succeeded.
   - **Action `CONFIRM_CLEANED` (Authoritative Proof Required):**
     - Allowed **only** if the criteria of **Section 10.4 (Authoritative Oplog Drop Evidence Protocol)** are fully met:
       1. Server-side oplog entry matches correlation `comment` containing `requestId` and `payloadHash`.
       2. Timestamp $\ge \text{wireDispatchedAt}$ and $\le \text{reconcileRequestedAt}$.
       3. Record confirmed committed to replica-set majority via lexicographical OpTime comparison with `optimes.lastCommittedOpTime`.
       4. Oplog rollover verified not to have occurred.
     - If verifiable proof is absent or unconfirmed, the executor **rejects the request with HTTP 422 `UNPROVEN_DROP_COMPLETION`** and keeps the request in `QUARANTINED`.
     - If verified, transitions ledger state to `CLEANED` and releases execution lock.
4. **Tamper-Evident Audit Record:** The transition is appended to `decision_os_coordination.cleanup_audit_log` with an append-only enforced SHA-256 hash chain:
   $$\text{EntryHash} = \text{SHA256}(\text{PrevHash} + \text{ReconciliationID} + \text{OperatorID} + \text{TargetDB} + \text{Action} + \text{Timestamp})$$

### 11.4 Residual Operational Consequence
Under this fail-closed architecture, some ambiguous requests will remain in `QUARANTINED` indefinitely. The target database namespace cannot be claimed or reused. In automated test and CI environments, this has **zero operational impact** because subsequent test runs generate unique database names using fresh UUIDs (`decision_os_test_${runId}_w${workerId}`). **Safety (guaranteeing that no delayed or concurrent drop command destroys active data) takes absolute precedence over automatic database namespace recycling.**

---

## 12. Test and Benchmark Migration Matrix for CS-01–CS-17

Every destructive call site identified in Phase A (`BATCH_4_V38_DESTRUCTIVE_CALLSITE_INVENTORY.md`) is mapped to an explicit remediation plan:

| Call-Site ID | File & Line in Baseline | Current Baseline Code | Remediation & Replacement Mechanism | Verification Method |
|---|---|---|---|---|
| **CS-01** | `apps/api/src/db/guard.ts:251` | `const rawNativeDrop = db.dropDatabase.bind(db);` | **Delete monkey-patch.** Worker connections natively lack `dropDatabase` permission in MongoDB RBAC. Remove `rawNativeDrop` binding entirely. | Verification Test `D38-01`, Static Scan `D38-29` |
| **CS-02** | `apps/api/src/db/guard.ts:258` | `return rawNativeDrop();` in `activeSupervisedDropContext` | **Delete bypass.** Eliminate `activeSupervisedDropContext` entirely. In-process context can no longer unlock native drop. | Verification Test `D38-02`, Static Scan `D38-29` |
| **CS-03** | `apps/api/src/db/guard.ts:307` | `return rawNativeDrop();` in `isVerifiedCleanupLocked` | **Delete bypass.** Eliminate local metadata inspection bypass. No client-side bypass permits raw drop execution. | Verification Test `D38-03`, Static Scan `D38-29` |
| **CS-04** | `apps/api/src/db/guard.ts:318` | `connection.dropDatabase = async () => cleanupTestDatabase(...)` | **Replace monkey-patch with client proxy.** `cleanupTestDatabase()` delegates to `CleanupExecutorClient.requestCleanup()`, transmitting an Ed25519-signed request to `apps/cleanup-executor`. | Verification Test `D38-04`, Integration Test `npm run test:api` |
| **CS-05** | `apps/api/src/db/guard.ts:1376` | `await db.dropDatabase();` in `SupervisedCleanupExecutor` | **Move execution to external service.** Delete `SupervisedCleanupExecutor` from `guard.ts`. Move physical drop execution to `apps/cleanup-executor/src/executor.ts`. | Verification Test `D38-05`, Static Scan `D38-29` |
| **CS-06** | `apps/api/src/db/guard.ts:1487` | `await client.db(dbName).dropDatabase();` in `reconcileTestDatabaseCleanup` | **Route reconciliation through external executor.** Replace direct drop with `CleanupExecutorClient.submitReconciliation()` using admin key. Redispatch dropped. | Verification Test `D38-06`, Integration Test `D38-24` |
| **CS-07** | `scripts/benchmark.ts:170` | `await mongoose.connection.db.dropDatabase();` | **Safe benchmark isolation.** Generate unique test database `decision_os_benchmark_<runId>_test`, register ownership via `POST /v1/ownership/claim`, receive dedicated benchmark credentials, and invoke `CleanupExecutorClient.requestCleanup()`. | Benchmark CLI run, Static Scan `D38-29` |
| **CS-08** | `apps/api/tests/batch4_r6_isolation.test.ts:56` | `await connA.dropDatabase();` in Test 3 | **Route via cleanup client.** Replace with `await cleanupTestDatabase(connA, runA, 'A')`. Teardown failure fails test run visibly. | Integration Test `npm run test:api` |
| **CS-09** | `apps/api/tests/batch4_r6_isolation.test.ts:57` | `await connB.dropDatabase();` in Test 3 | **Route via cleanup client.** Replace with `await cleanupTestDatabase(connB, runB, 'B')`. Teardown failure fails test run visibly. | Integration Test `npm run test:api` |
| **CS-10** | `apps/api/tests/batch4_r6_isolation.test.ts:106` | `await conn.dropDatabase();` in Test 5 | **Route via cleanup client.** Replace with `await cleanupTestDatabase(conn, runA, '0')`. Fails closed if ownership mismatched. | Integration Test `npm run test:api` |
| **CS-11** | `apps/api/tests/batch4_v37_supervised_cleanup.test.ts` (12 sites) | `await client.db(dbName).dropDatabase();` in teardown hooks | **Centralized test teardown helper.** Replace direct client drops with `await cleanupTestDatabase(conn, runId, workerId)`. Preserves 100% test assertions. | Integration Test `npm run test:api` |
| **CS-12** | `apps/api/tests/batch4_v37_reproduction.test.ts:93, 130` | `await client.db(dbName).dropDatabase();` | **Centralized test teardown helper.** Replace with `await cleanupTestDatabase(...)`. | Integration Test `npm run test:api` |
| **CS-13** | `apps/api/tests/batch4_v36_cleanup_executor_fencing.test.ts` (13 sites) | `await conn.db?.dropDatabase();` | **Centralized test teardown helper.** Replace with `await cleanupTestDatabase(...)`. | Integration Test `npm run test:api` |
| **CS-14** | `apps/api/tests/batch4_v35_cleanup_fencing.test.ts` (33 sites) | `await conn.db?.dropDatabase();` | **Centralized test teardown helper.** Replace with `await cleanupTestDatabase(...)`. | Integration Test `npm run test:api` |
| **CS-15** | `apps/api/tests/batch4_v34_cleanup_recovery.test.ts` (15 sites) | `await conn.db?.dropDatabase();` | **Centralized test teardown helper.** Replace with `await cleanupTestDatabase(...)`. | Integration Test `npm run test:api` |
| **CS-16** | `apps/api/tests/batch4_v33_adversarial.test.ts` (5 sites) | `await conn.db?.dropDatabase();` | **Centralized test teardown helper.** Replace with `await cleanupTestDatabase(...)`. | Integration Test `npm run test:api` |
| **CS-17** | `apps/api/tests/batch4_v32_adversarial.test.ts` (6 sites) | `conn.db!.dropDatabase = ...` monkey-patch | **Update test mocks.** Migrate from mock monkey-patching to asserting denial at the client proxy and native driver layer. | Integration Test `npm run test:api` |

---

## 13. Static and Runtime Enforcement

### 13.1 Static Repository Guard (`scripts/verify_no_direct_destructive_calls.ts`)
A dedicated AST scanner built with TypeScript Compiler API (`typescript`) inspects all files across `apps/`, `packages/`, and `scripts/`.

#### Detection Rules
1. **Member Expressions:** Any invocation of `.dropDatabase()`, `.dropCollection()`, or `.drop()`.
2. **Command Literals:** Any raw command object `{ dropDatabase: ... }` or `{ drop: ... }`.
3. **Driver Bindings:** Method extractions such as `db.dropDatabase.bind(...)` or `const { dropDatabase } = db`.
4. **Mongoose Wrappers:** `connection.dropDatabase()`, `Model.collection.drop()`.

#### Strict Narrow Allowlist
The allowlist permits **exactly one production file and line range**:
- File: `apps/cleanup-executor/src/executor.ts`
- Scope: Inside `PrivilegedExecutionEngine.dispatchNativeDrop()`
- All other files across the repository must contain zero direct destructive calls.

### 13.2 Runtime Guard (Defense-in-Depth)
Even if a developer bypasses pre-commit hooks or uses dynamic string evaluation (e.g. `db['drop' + 'Database']()`), MongoDB's native RBAC engine enforces authorization on the wire:
- Connection authenticated as any `decision_os_worker_*` $
ightarrow$ Command rejected by MongoDB daemon with `MongoServerError: not authorized on <db> to execute command { dropDatabase: 1 }` (Code 13).

---

## 14. Architecture Security Review — B38-01 through B38-14

This section details the resolution of all security inquest findings across Phases B.1, B.2, and B.3:

### B38-01: Correct MongoDB Native Privilege Scoping
- **Defect:** Custom role used unsupported wildcard resource `{ db: "decision_os_test_*", collection: "" }`.
- **Resolution:** Adopted Dedicated Isolated Test MongoDB Deployment combined with dynamic per-database roles. Destructive blast radius physically and logically contained.
- **Status:** APPROVED & CLOSED.

### B38-02: Protect Ownership Metadata (Additive Privilege Remediation)
- **Defect:** Worker role granted `{ db: "", collection: "" }` alongside `find` on `ownership_locks`. Because MongoDB privileges are additive, workers retained full write capabilities on ownership metadata.
- **Remediation (Phase B.2):** Worker base role completely stripped of `{ db: "", collection: "" }`. Workers receive exact per-database roles provisioned dynamically by the Cleanup Executor upon `POST /v1/ownership/claim`. Zero write privileges on `ownership_locks`.
- **Status:** REMEDIATED (PHASE B.2) — PENDING INDEPENDENT REVIEW.

### B38-03: Protect the Cleanup Ledger (Additive Privilege Remediation)
- **Defect:** Worker role retained write capability on `cleanup_ledger` due to additive `{ db: "", collection: "" }` grant.
- **Remediation (Phase B.2):** Worker roles contain zero write actions on `decision_os_coordination.cleanup_ledger`. The Cleanup Executor is the authoritative sole writer of ledger state machine transitions. Worker writes fail with MongoDB Error 13.
- **Status:** REMEDIATED (PHASE B.2) — PENDING INDEPENDENT REVIEW.

### B38-04: Fix Request Hash & Signature Construction
- **Defect:** Circular hash definition `payloadHash = SHA256(CanonicalJSON(body))` where `body` contained `payloadHash`.
- **Resolution:** Formulated `CanonicalPayload` schema strictly excluding derived fields (`payloadHash`, `signature`). Applied RFC 8785 JCS, SHA-256 payload hashing, and bound canonical signing bytes to an 8-line string.
- **Status:** APPROVED & CLOSED.

### B38-05: Finalize Cryptographic Identity & Key Management
- **Defect:** Symmetric shared HMAC secrets allowed caller impersonation.
- **Resolution:** Selected **Asymmetric Ed25519 Signing** as uniform protocol across all environments. Every principal has a dedicated key pair; caller identity is bound to registered public keys.
- **Status:** APPROVED & CLOSED.

### B38-06: Correct Ambiguous Outcome Recovery (Fail-Closed Remediation)
- **Defect:** Section 11.3 allowed `forceRedispatch === true` if residual collections existed and `currentOp()` reported no active drop. This contradicted fail-closed principles.
- **Remediation (Phase B.2):** Complete removal of `forceRedispatch`. Strict prohibition of redispatch across all execution paths once `DISPATCHING` is reached. Introduction of terminal state `QUARANTINED`, permanently retaining the execution lock.
- **Status:** REMEDIATED (PHASE B.2) — PENDING INDEPENDENT REVIEW.

### B38-07: Correct Fencing and Wire-Dispatch Claims (Redispatch Elimination)
- **Defect:** Claimed monotonic generation and pre-wire CAS atomically fences MongoDB `dropDatabase`, and allowed Case D administrative redispatch.
- **Remediation (Phase B.2):** Documented that ledger CAS serializes the transition to `DISPATCHING`, but MongoDB does not enforce application tokens. Completely removed redispatch in Case D. Preserved execution lock on ambiguity.
- **Status:** REMEDIATED (PHASE B.2) — PENDING INDEPENDENT REVIEW.

### B38-08: Correct Local Containerless Security Claims
- **Defect:** Equated same-user child process to container isolation.
- **Resolution:** Explicitly labeled child process runner as **Development-Only Weaker Mode**. Required Docker Compose or container runtime in CI and production.
- **Status:** APPROVED & CLOSED.

### B38-09: Correct Network and Client Identity Policy
- **Defect:** Ingress policy restricted to API pods, omitting test runners and benchmark CLI.
- **Resolution:** Defined network identities for all 4 caller categories (`API_SERVICE`, `TEST_RUNNER`, `BENCHMARK_RUNNER`, `ADMIN_OPERATOR`). Emphasized that network reachability does not grant authorization.
- **Status:** APPROVED & CLOSED.

### B38-10: Correct Isolation and Security Claims
- **Defect:** Used absolute terms ("Absolute Credential Isolation", "zero shared memory").
- **Resolution:** Replaced absolute statements with precise boundary descriptions, acknowledging shared Linux kernel risks and container boundaries.
- **Status:** APPROVED & CLOSED.

### B38-11: Shared MongoDB User Defeats Per-Worker Isolation
- **Defect:** Section 3.3 granted dynamically provisioned test roles to a single shared MongoDB user `decision_os_app_worker`. Because MongoDB role privileges are cumulative and additive across all connections using that principal, all concurrent workers inherited each other's database privileges.
- **Remediation (Phase B.3):** Formulated discrete per-worker MongoDB principals (`decision_os_worker_${runId}_${workerId}`) and benchmark principals (`decision_os_benchmark_${runId}`). Provisioned with ephemeral in-memory credentials delivered over mTLS. Each dynamic role is granted exclusively to that worker's principal. Cross-database CRUD attempts fail natively with MongoDB Error Code 13.
- **Status:** REMEDIATED (PHASE B.3) — PENDING INDEPENDENT REVIEW.

### B38-12: Unsafe MongoDB Role-Management Privileges
- **Defect:** Section 3.2 allowed direct CRUD on internal collections `admin.system.roles` and `admin.system.users` or granted built-in `userAdmin` on `admin` to the cleanup executor, violating least privilege and effectively granting cluster-level superuser rights.
- **Remediation (Phase B.3):** Stripped all direct CRUD on system collections and removed `userAdmin` on `admin`. Established non-superuser role administration using supported MongoDB commands (`createRole`, `createUser`, `dropRole`, `dropUser`, `grantRolesToUser`, `revokeRolesFromUser`, `killAllSessionsByPattern`), restricted by executor application policy strictly to test database namespaces. Audit logging with SHA-256 hash chaining records every user/role mutation.
- **Status:** REMEDIATED (PHASE B.3) — PENDING INDEPENDENT REVIEW.

### B38-13: Authoritative Oplog Evidence Is Underspecified
- **Defect:** Section 4.2 / 9.3 allowed administrative `CONFIRM_CLEANED` based on underspecified "oplog proof", without defining correlation mechanisms, replica-set elections, majority commitment, or oplog rollover.
- **Remediation (Phase B.3):** Established Section 10.4 **Authoritative MongoDB 8.0 Replica Set Oplog Drop Evidence Protocol**. Mandatory embedded correlation `comment` in `{ dropDatabase: 1 }` matching request metadata. Majority commitment verification via lexicographical OpTime comparison. Handling of term changes/elections and capped collection rollover. If proof is missing or incomplete, `CONFIRM_CLEANED` is rejected with HTTP 422 and request remains permanently in `QUARANTINED`.
- **Status:** REMEDIATED (PHASE B.3) — PENDING INDEPENDENT REVIEW.

### B38-14: Role Lifecycle and Provisioning Concurrency
- **Defect:** Lacked concurrency analysis of simultaneous claims, partial provisioning failures, credential delivery timeouts, worker crashes, and active connection reuse across role revocation and quarantine.
- **Remediation (Phase B.3):** Analyzed 10 concurrent execution interleavings in Section 16.3. Defined retry idempotency, fail-closed rollbacks, and orphan lease reapers. Active connection invalidation enforced via session termination and worker connection pool shutdown.
- **Status:** REMEDIATED (PHASE B.3) — PENDING INDEPENDENT REVIEW.

### B38-15: Correct MongoDB Session Invalidation
- **Defect:** Section 7.5 and Section 16.3 cited `killAllUserConnections`, which does not exist in MongoDB, claimed that session termination closes TCP sockets, and misscoped `killAnySession` to `{ db: "admin", collection: "" }`.
- **Remediation (Phase B.4):** Replaced non-existent commands with supported MongoDB administrative command `killAllSessionsByPattern` targeting the specific worker user on authentication database `admin`. Corrected privilege placement by assigning `killAnySession` and `impersonate` to the `{ cluster: true }` resource. Explicitly separated logical session invalidation, in-flight operation abort (`killOp`), cursor closure, TCP transport retention, client driver-pool invalidation (`client.close(true)`), and fresh authentication prevention via `dropUser`. Documented that MongoDB ignores prepared transactions during session termination and formulated an abort procedure.
- **Status:** REMEDIATED (PHASE B.4) — PENDING INDEPENDENT REVIEW.

### B38-16: Make Oplog Evidence Protocol Technically Supportable
- **Defect:** Section 10.4 referenced unsupported response fields (`optimesAndLocations.majorityCommitPoint`), falsely asserted that `readConcern: "majority"` applies to the `local` database, assumed DDL command comments are preserved in `local.oplog.rs`, and failed to define lexicographical OpTime comparison.
- **Remediation (Phase B.4):** Reworked Section 10.4 using exact MongoDB 8.0 documented fields: `optimes.lastCommittedOpTime.ts` and `optimes.lastCommittedOpTime.t` from `replSetGetStatus` on the active primary. Explicitly acknowledged that the `local` database ignores read concern. Formulated strict lexicographical OpTime comparison $(t, ts)$. Formally treated comment preservation as an unverified hypothesis under test (verification item `D38-21`). Removed automatic `CONFIRM_CLEANED` unless live comment preservation is proven; unproven drops remain permanently `QUARANTINED`.
- **Status:** REMEDIATED (PHASE B.4) — PENDING INDEPENDENT REVIEW.

### B38-17: Define Crash-Safe Ephemeral Credential Recovery
- **Defect:** Idempotent claim redelivery was claimed, but generated passwords were held only in volatile executor memory, while MongoDB stores credentials as irreversible SCRAM-SHA-256 verifiers. If the executor crashed after user creation but before HTTP response delivery, retrying workers could not receive the password.
- **Remediation (Phase B.4):** Formulated a crash-safe credential recovery protocol utilizing a **Caller-Bound Encrypted Credential Envelope** (`ownership_locks.credentialEnvelope`). Encrypted with AES-256-GCM under an executor envelope key with AAD binding to request ID, database name, and caller public key fingerprint. Retrying callers verify identity and receive decrypted credentials. The envelope is zeroized upon worker activation for forward secrecy. Provided fallback to controlled rotation via `updateUser` before activation, or fail-closed saga rollback.
- **Status:** REMEDIATED (PHASE B.4) — PENDING INDEPENDENT REVIEW.

### B38-18: Replace False Provisioning Atomicity Claims
- **Defect:** The architecture described separate `createRole` and `createUser` commands while claiming overall lifecycle atomicity. In MongoDB, administrative commands cannot run within multi-document ACID transactions.
- **Remediation (Phase B.4):** Replaced false atomicity claims with a **Durable Idempotent Provisioning Saga** defining explicit states (`CLAIM_PENDING`, `ROLE_CREATED`, `USER_CREATED`, `ROLE_ASSIGNED`, `CREDENTIAL_ENCRYPTED`, `CREDENTIAL_DELIVERED`, `ACTIVATED`, `ROLLING_BACK`, `ROLLED_BACK`, `ORPHAN_RECOVERY`). Defined deterministic recovery at every transition, durable compensation for failed rollbacks, guarantees that partially provisioned identities possess zero unintended privileges, and strict 4-point verification proof before the orphan reaper deletes any user or role.
- **Status:** REMEDIATED (PHASE B.4) — PENDING INDEPENDENT REVIEW.

### B38-19: Make the Audit Ledger Genuinely Tamper-Evident
- **Defect:** The executor possessed `update`, `remove`, and `findAndModify` privileges across all coordination collections, including `cleanup_audit_log`, making claims of "immutable" audit logging unfounded.
- **Remediation (Phase B.4):** Separated audit log privileges from coordination CRUD. Scoped privileges on `cleanup_audit_log` strictly to append-only actions: `find`, `insert`, and `createIndex` (zero update, remove, or findAndModify). Implemented external chain-head checkpoint storage. Defined cryptographic detection for deletion, truncation, reordering, payload substitution, and full-chain rewriting. Configured fail-closed executor freezing upon verification failure. Discontinued inaccurate "immutable" claims in favor of verified append-only and tamper-evident semantics.
- **Status:** REMEDIATED (PHASE B.4) — PENDING INDEPENDENT REVIEW.

---

## 15. Threat Model & Required Adversarial Analysis

### 15.1 Compromised-Worker Attack Walkthrough
Assume an adversary gains arbitrary code execution inside a test runner thread (`Worker A`, holding `PrivateKey_A`, assigned database `decision_os_test_runA_wA`, MongoDB principal `decision_os_worker_runA_wA`):
1. **Direct Wire Drop:** Worker A issues `db.command({ dropDatabase: 1 })`. Rejection: MongoDB daemon rejects command with `MongoServerError: not authorized on <db> to execute command { dropDatabase: 1 }` (Code 13).
2. **Cross-Database Data Tampering:** Worker A attempts CRUD on Worker B's database (`decision_os_test_runB_wB`). Rejection: `decision_os_worker_runA_wA` has zero privileges on Worker B's DB; MongoDB throws Code 13.
3. **Tampering with Ownership Records:** Worker A attempts to overwrite `ownership_locks` to claim Worker B's database. Rejection: Worker has no write privileges on `decision_os_coordination`; MongoDB throws Code 13.
4. **Forging Ownership Claim via Executor:** Worker A calls `POST /v1/ownership/claim` targeting Worker B's database. Rejection: Executor verifies active ownership lease held by Worker B; rejects claim with HTTP 409 `OWNERSHIP_CONFLICT`.
5. **Forging Cleanup Request via Executor:** Worker A calls `POST /v1/cleanup/request` targeting Worker B's database. Rejection: Executor checks `ownership_locks`; caller A does not match owner B; rejected with HTTP 403 `CALLER_NOT_DATABASE_OWNER`.
6. **Attempting Administrative Reconciliation:** Worker A calls `POST /v1/cleanup/reconcile`. Rejection: Worker key A is not in `ADMIN_OPERATOR` key ring; rejected with HTTP 403 `FORBIDDEN_OPERATOR_ROLE`.
7. **Attempting Role Escalation:** Worker A attempts `db.grantRolesToUser(...)` or `db.createRole(...)`. Rejection: Worker possesses zero role-administration privileges on `admin`; MongoDB throws Code 13.

### 15.2 Explicit Adversarial Analysis Matrix (Scenarios 1–12)

| Scenario ID | Attack Vector / Adversarial Event | Permitted Action | Prohibited Action | Concrete Enforcement Mechanism |
|---|---|---|---|---|
| **Scenario 1** | **Worker attempts direct coordination writes through broad privileges.** Worker executes `db.getSiblingDB("decision_os_coordination").ownership_locks.insertOne({...})`. | Permitted: Read-only `find` query on coordination collections. | **PROHIBITED:** Any `insert`, `update`, `remove`, `findAndModify`, or index creation on coordination collections. | **MongoDB RBAC Engine:** `decision_os_worker_base_role` possesses zero write privileges. No `{ db: "", collection: "" }` write grant exists. Daemon throws Code 13. |
| **Scenario 2** | **Worker inherits write permissions through another role.** Adversary attempts to leverage role inheritance to gain elevated write access. | Permitted: Actions explicitly granted in the primary base role and dynamic test database role. | **PROHIBITED:** Inheriting built-in roles (`readWrite`, `dbAdmin`, `dbOwner`, `root`) or custom administrative roles. | **MongoDB RBAC Engine & Audit:** `roles: []` is enforced on all worker roles. Inspection asserts granted role list is strictly controlled. |
| **Scenario 3** | **Executor A pauses after entering `DISPATCHING`.** Executor A marks `DISPATCHING` in ledger, then suffers a 45-second stall before writing to wire socket. | Permitted: Executor A may attempt to write to socket when resumed, but must fail closed if lease expired. | **PROHIBITED:** Successor Executor B claiming request or issuing secondary drop command while A is in `DISPATCHING`. | **State Machine Transition Guard:** Once `DISPATCHING` is entered, state machine permanently locks it. Successor detects `state === 'DISPATCHING'` and refuses to claim or redispatch. |
| **Scenario 4** | **Executor A resumes after an operator observes no active `currentOp()`.** SRE queries `currentOp()`, sees no active drop, and attempts administrative action while Executor A wakes up. | Permitted: SRE may transition request to `QUARANTINED` to record the incident. | **PROHIBITED:** SRE or system issuing a second `{ dropDatabase: 1 }` command. | **Schema & Code Enforcement:** `forceRedispatch` is removed. Reconciliation handler contains no code path to execute a drop. If Executor A later delivers its drop, no concurrent drop was issued. |
| **Scenario 5** | **Delayed wire command arrives after operator observation.** TCP send buffer delays cause Executor A's drop packet to arrive 30s after SRE observed database quiescence. | Permitted: MongoDB processes or rejects the original delayed packet. | **PROHIBITED:** Reusing or assigning the database name to a new test run while drop outcome remains ambiguous. | **Permanent Execution Lock:** `dropExecutionLock: true` remains held in `QUARANTINED` state. Namespace marked poisoned in `ownership_locks`. New test runs blocked from claiming name. |
| **Scenario 6** | **Administrator attempts to redispatch an ambiguous request.** Operator submits `POST /v1/cleanup/reconcile` attempting to force a re-drop of residual collections. | Permitted: Transition request to `QUARANTINED` (locking namespace) or `CONFIRM_CLEANED` (with server oplog proof). | **PROHIBITED:** Submitting `forceRedispatch`, or requesting any secondary drop command. | **Reconciliation API Validation:** Schema validation rejects any payload containing `forceRedispatch` with HTTP 400. API provides no dispatch mechanism. |
| **Scenario 7** | **Executor restarts with an unresolved request.** Cleanup Executor crashes while a request is in `DISPATCHING`. On reboot, startup scanner encounters record. | Permitted: Startup scanner transitions expired `DISPATCHING` records to `OUTCOME_UNKNOWN` and raises an SRE alert. | **PROHIBITED:** Startup supervisor re-claiming request or re-issuing `{ dropDatabase: 1 }`. | **Crash Recovery Policy:** Startup scanner inspects `wireDispatchedAt`. Because `wireDispatchedAt !== null`, redispatch is strictly forbidden. State moves to `OUTCOME_UNKNOWN` with lock held. |
| **Scenario 8** | **Residual collections exist, but previous command's completion is unproven.** Target DB shows collections, but ledger shows `DISPATCHING` and socket was severed. | Permitted: Moving request to `QUARANTINED` and leaving database intact for forensic inspection. | **PROHIBITED:** Assuming that residual collections prove drop failed and issuing another drop. | **Fail-Closed Rule:** Residual collections do not guarantee that delayed command will not execute. Drop is strictly prohibited; namespace is quarantined. |
| **Scenario 9 (B38-11)** | **Worker A attempts cross-database CRUD on Worker B's database.** Worker A connects as `decision_os_worker_runA_wA` and queries `decision_os_test_runB_wB`. | Permitted: CRUD operations on `decision_os_test_runA_wA`. | **PROHIBITED:** Any read, write, or index operation on `decision_os_test_runB_wB`. | **MongoDB RBAC Engine:** Worker A's principal has no role granting access to DB B. MongoDB daemon throws Code 13 (`Unauthorized`). |
| **Scenario 10 (B38-12)** | **Cleanup Executor attempts to grant cluster superuser rights.** Provisioner bugs or attacker attempts to call `createRole` granting `root` or `clusterAdmin`. | Permitted: Creating dynamic roles strictly scoped to `decision_os_test_*` with CRUD actions. | **PROHIBITED:** Granting administrative actions, cluster resources, or system database privileges. | **Daemon RBAC & Application Guard:** Executor lacks `userAdmin` or `grantRole` on `root`; daemon rejects with Code 13. Application guard validates role structure. |
| **Scenario 11 (B38-13)** | **Admin attempts `CONFIRM_CLEANED` without verified majority oplog proof.** Operator submits reconciliation with unverified or pre-dispatch oplog timestamp. | Permitted: Submitting reconciliation with verified majority oplog proof or selecting `QUARANTINE`. | **PROHIBITED:** Marking `CLEANED` based on catalog absence, quiescent `currentOp`, or uncommitted oplog entries. | **Oplog Protocol Verification:** Section 10.4 asserts correlation `comment`, timestamp window, and majority commitment. Rejects unproven evidence with HTTP 422. |
| **Scenario 12 (B38-14, B38-15)** | **Quarantined worker attempts to execute commands using cached connections.** Quarantined worker issues writes over an already-open MongoDB connection. | Permitted: None. | **PROHIBITED:** Any subsequent operation by quarantined worker. | **Session Invalidation & Fail-Closed Revocation:** Executor executes `killAllSessionsByPattern`, revokes dynamic role, drops user, and signals worker client to close pool. Active operations are cancelled; subsequent commands fail with Code 11, 13, or socket errors. |

### 15.3 Required Adversarial Test Design for Two Workers (Finding B38-11 & D38-16)
To prove discrete identity isolation, the test suite implements a two-worker adversarial test:
1. **Setup:**
   - Worker A claims and owns `decision_os_test_run1_wA`, authenticates as `decision_os_worker_run1_wA`.
   - Worker B claims and owns `decision_os_test_run1_wB`, authenticates as `decision_os_worker_run1_wB`.
2. **Adversarial Invocations:**
   - Worker A attempts `find`, `insert`, `update`, `remove` on `decision_os_test_run1_wB`.
   - Worker B attempts `find`, `insert`, `update`, `remove` on `decision_os_test_run1_wA`.
   - Both Worker A and Worker B attempt writes to `decision_os_coordination.ownership_locks` and `cleanup_ledger`.
   - Both Worker A and Worker B attempt role administration: `createRole`, `createUser`, `grantRolesToUser`.
   - Worker A attempts to connect using Worker B's credentials or substitute tokens.
3. **Mandatory Acceptance Criteria:**
   - **Every unauthorized operation must fail with MongoDB authorization error Code 13 (`Unauthorized`) or Code 18 (`AuthenticationFailed`).**
   - No cross-database write or read succeeds.
   - Coordination collections remain untampered.

---

## 16. Failure Modes, Fencing Interleavings & Role Lifecycle Concurrency Analysis

### 16.1 Fencing Interleaving Analysis (B38-07)
Because MongoDB does not enforce application fencing tokens during `dropDatabase`, the architecture addresses four critical execution interleavings:

#### Case A: Executor A pauses before `DISPATCHING`
1. Executor A claims request (`CLAIMED`).
2. Executor A pauses (GC pause, thread stall).
3. Executor A's lease expires (30s).
4. Executor B claims request (`CLAIMED`, bumps generation to 2).
5. Executor A resumes and attempts to mark `DISPATCHING` with generation 1.
6. **Safety Outcome:** Executor A's atomic CAS (`findOneAndUpdate({ _id: reqId, claimGen: 1 }, ...)`) fails. Executor A aborts without issuing a wire drop. Safe.

#### Case B: Executor A pauses after `DISPATCHING`, before wire dispatch
1. Executor A atomically marks `DISPATCHING` in the ledger.
2. Executor A pauses before writing `{ dropDatabase: 1 }` to the socket.
3. Executor A's process is suspended or loses network.
4. Executor B starts up.
5. **Safety Outcome:** Executor B sees the request is in `DISPATCHING`. **Policy Rule: Executor B is STRICTLY PROHIBITED from claiming or dispatching.** Reassignment is forbidden. The request moves to `OUTCOME_UNKNOWN`. Executor B does not touch the database. Safe against dual dispatch.

#### Case C: Executor A sends native command; response is lost
1. Executor A transmits `{ dropDatabase: 1 }`. MongoDB begins execution.
2. Network connection severed; response lost.
3. Executor B starts after lease expires.
4. **Safety Outcome:** Ledger shows `DISPATCHING` or `OUTCOME_UNKNOWN`. Executor B **fails closed**. Automatic redispatch is prohibited. The database remains locked until signed SRE administrative quarantine occurs. Safe against premature re-drop.

#### Case D: Admin attempts reconciliation while earlier executor may still execute
1. Earlier executor dispatched command, response lost.
2. Administrator triggers `/v1/cleanup/reconcile`.
3. **Safety Outcome (Remediated Phase B.2):** SRE reconciliation **contains no drop capability**. Reconcile transitions request to terminal `QUARANTINED`, preserving `dropExecutionLock: true` and marking the namespace poisoned. Even if the earlier executor's delayed wire command arrives later or the server unlinks asynchronously, zero secondary drop commands are ever issued. Safe against dual drop and race conditions.

### 16.2 Explicit Statement of Residual Risks
1. **Quarantined Database Proliferation:** Under frequent network partitions or replica set failovers, ambiguous test databases remain in `QUARANTINED` status and are not automatically reclaimed. In test environments, this is mitigated by unique `runId` UUIDs. Periodic manual SRE maintenance during scheduled maintenance windows can purge confirmed quiescent test instances.
2. **Delayed Wire Packet Delivery:** If an executor process is paused after transmitting a wire packet into the TCP send buffer, network stack delays could cause the packet to arrive at MongoDB much later. Quarantining the namespace and permanently retaining the execution lock ensures that no active workload is provisioned into that namespace.
3. **Linux Kernel Integrity:** Container isolation relies on Linux cgroups and namespaces. A container breakout vulnerability in the host Linux kernel could allow an attacker in the API container to access the host or adjacent containers.

### 16.3 Role Lifecycle and Provisioning Concurrency Analysis (Finding B38-14)

#### 1. Interleaving 1: Two workers request ownership concurrently for different databases
- Worker A requests `decision_os_test_runA_w0`, Worker B requests `decision_os_test_runB_w0`.
- **Handling:** Handled via independent atomic inserts into `ownership_locks`. Two discrete dynamic roles (`decision_os_role_runA_w0` and `decision_os_role_runB_w0`) and two discrete users (`decision_os_worker_runA_w0` and `decision_os_worker_runB_w0`) are provisioned. Zero contention; full parallelism.

#### 2. Interleaving 2: Two workers request the same database
- Worker A and Worker B both call `POST /v1/ownership/claim` with `databaseName: "decision_os_test_shared"`.
- **Handling:** `ownership_locks` enforces a unique index on `databaseName`. Exactly one atomic insert succeeds. The winning worker receives credentials. The losing worker receives HTTP 409 `OWNERSHIP_CONFLICT`. Role and user are provisioned only for the winner.

#### 3. Interleaving 3: Role creation succeeds but user creation fails
- The executor executes `createRole` successfully, but subsequent `createUser` fails (e.g. password validation error or transient connection reset).
- **Handling (Rollback):** The executor catches the exception, immediately invokes `dropRole`, removes any partial entry from `ownership_locks`, and returns HTTP 500. No dangling user or active lease exists.

#### 4. Interleaving 4: User creation succeeds but role assignment fails
- In the durable provisioning saga, the user is created in MongoDB with `roles: ["decision_os_worker_base_role"]` (granting zero test DB access), and the dynamic test role is assigned in the subsequent saga step via `grantRolesToUser`.
- If `grantRolesToUser` fails (e.g. timeout or primary stepdown), the saga transitions to `ROLLING_BACK`. The executor executes compensating `dropUser` and `dropRole`. Because the user possessed only `decision_os_worker_base_role`, the partially provisioned identity had zero ability to read or write any test database.

#### 5. Interleaving 5: Role assignment succeeds but credential delivery fails (Finding B38-17)
- Role and user exist in MongoDB, and the password was encrypted into `ownership_locks.credentialEnvelope`, but the HTTP 200 response fails to reach the worker (client timeout, socket drop, or executor crash).
- **Handling (Encrypted Envelope Redelivery & Idempotency):** The worker retries `POST /v1/ownership/claim` with the same `requestId`. The executor validates the caller signature against `callerPublicKeyFingerprint`, verifies `status === 'PROVISIONED_PENDING_ACTIVATION'`, decrypts `credentialEnvelope` using `ENVELOPE_KEY`, validates AAD, and safely redelivers the exact credentials. If the worker crashed and never retries, the 60-second lease expires without heartbeats. The lease reaper detects the expired lease, drops the user and role, securely destroys the envelope, and releases the lock.

#### 6. Interleaving 6: Worker crashes before cleanup
- Worker claims the database, performs tests, and terminates abnormally before calling `cleanupTestDatabase`.
- **Handling (Lease Expiry Reaper):** The worker fails to send heartbeat pings. The lease expires after 60 seconds (`leaseExpiresAt < now`). The background reaper detects the expired lease, sets state to `ORPHANED_EXPIRED`, revokes the role, drops the worker user, and flags the database for supervised cleanup.

#### 7. Interleaving 7: Cleanup succeeds but role revocation fails
- Physical `{ dropDatabase: 1 }` succeeds, and `cleanup_ledger` records `CLEANED`. However, the subsequent `dropRole` or `dropUser` command encounters a transient MongoDB timeout.
- **Handling (Dangling Role Reaper):** The executor records `state: 'CLEANED'`, but flags `danglingRoleCleanupPending: true` in the ledger and audit log. The background orphan reaper sweeps `cleanup_ledger` every 30 seconds and retries dropping the orphaned role and user until confirmed deleted.

#### 8. Interleaving 8: A quarantined worker attempts to reconnect using cached credentials (Finding B38-15)
- A test run is quarantined due to an ambiguous drop, but a misconfigured or malicious worker process attempts to issue queries using previously delivered credentials.
- **Handling (Active Revocation & Session Kill):** When a request transitions to `QUARANTINED`, the executor immediately drops the user via `dropUser` and executes `db.adminCommand({ killAllSessionsByPattern: [{ users: [{ user: workerUsername, db: "admin" }] }] })`. Active queries are aborted, cursors are closed, and subsequent connection attempts fail with Code 11 (`UserNotFound`) or Code 18 (`AuthenticationFailed`).

#### 9. Interleaving 9: A role is revoked while a worker has an active connection (Finding B38-15)
- The worker has open TCP sockets in its driver connection pool when teardown begins.
- **Handling (Fail-Closed Multi-Layer Revocation):** Session termination alone does not physically sever TCP sockets in MongoDB. The executor executes `killAllSessionsByPattern` alongside `revokeRolesFromUser` and `dropUser`. On the server, MongoDB cancels active operations and invalidates cached authorization. Simultaneously, `CleanupExecutorClient` in the worker process invokes `await client.close(true)` to invalidate and shut down the local socket pool. Even if lingering sockets exist, any subsequent wire command fails with MongoDB Error Code 11 or Code 13 because the user principal no longer exists.

#### 10. Interleaving 10: An expired worker attempts to reuse a previous credential
- A slow worker attempts to issue an `insert` command after its 60-second lease expired and was reaped.
- **Handling:** Because the lease reaper executed `dropUser`, revoked roles, and executed `killAllSessionsByPattern`, the worker's commands fail with Code 11 (`UserNotFound`) or Code 13 (`Unauthorized`).

---

## 17. Deployment and Local-Development Plan

### 17.1 Production & CI Deployment (Container Isolated)
- **Deployment Spec:** Kubernetes Deployment (`apps/cleanup-executor`), distroless container image.
- **Container Security:** `readOnlyRootFilesystem: true`, `runAsNonRoot: true`, `runAsUser: 10001`, dropped capabilities `[ALL]`.
- **Network Ingress Policy:** Ingress on port 8088 allowed from API, test runners, benchmark runners, and admin bastion.
- **Network Egress Policy:** Egress strictly restricted to test MongoDB deployment port 27017/27018.

### 17.2 Local Development Profile: Development-Only Weaker Mode (B38-08)
For local developer laptop environments running without Docker:
- **Mode Classification:** Explicitly designated as **Development-Only Weaker Mode**.
- **Execution:** Helper script `scripts/start-local-cleanup-executor.ts` spawns `apps/cleanup-executor` as a child process via `child_process.spawn()`.
- **Credential Provisioning:** Credentials and keys passed via standard input pipe (stdin), avoiding command-line argument inspection.
- **Security Limitation Warning:**
  > [!WARNING]
  > **Development-Only Limitation:** The local child process runs under the same OS user as the test runner. It provides process separation and API contract compliance, but **does not provide kernel security boundary isolation**. A compromised test runner could inspect child memory via OS debugging APIs. This mode is strictly forbidden in CI and production.

---

## 18. Observability and Audit Requirements

### 18.1 Structured JSON Logging
All log events emitted by `apps/cleanup-executor` follow standard structured logging:
```json
{
  "timestamp": "2026-11-06T01:15:12.104Z",
  "level": "INFO",
  "service": "cleanup-executor",
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "runId": "run_alpha",
  "workerId": "w0",
  "databaseName": "decision_os_test_run_alpha_w0",
  "mongoUsername": "decision_os_worker_run_alpha_w0",
  "event": "STATE_TRANSITION",
  "fromState": "OUTCOME_UNKNOWN",
  "toState": "QUARANTINED",
  "operatorId": "sre_operator_amit",
  "ticketId": "OPS-8472",
  "executionLockRetained": true
}
```

### 18.2 Tamper-Evident Audit Ledger Architecture (Finding B38-19)

The v1.3.0 architecture described the audit log as "immutable", but granted the cleanup executor broad `update` and `remove` permissions across all coordination collections. If the executor or an administrative token was compromised, historical audit records could be rewritten or purged without detection. Decision OS establishes genuine tamper-evidence through collection-level RBAC separation, append-only boundaries, and externally anchored checkpoints:

#### 1. Separation of Audit Privileges from Coordination CRUD
MongoDB RBAC privileges are explicitly decoupled between coordination state and audit history:
- **Coordination State Collections (`ownership_locks`, `cleanup_ledger`, `provisioning_saga`):**
  Require full lifecycle CRUD:
  `actions: [ "find", "insert", "update", "remove", "findAndModify", "createIndex" ]`
- **Audit Log Collection (`decision_os_coordination.cleanup_audit_log`):**
  Strictly restricted to append-only operations:
  `actions: [ "find", "insert", "createIndex" ]`
  **Explicitly denied actions:** `update`, `remove`, `findAndModify`, `dropCollection`, `dropDatabase`.

#### 2. Native Append-Only Write Boundary Enforcement
Because the MongoDB daemon enforces authorization at the wire level:
- Any command attempting to modify or delete historical records (`db.cleanup_audit_log.updateOne()`, `deleteMany()`, `findAndModify()`) is rejected by the MongoDB storage engine with `MongoServerError: not authorized on decision_os_coordination.cleanup_audit_log` (Code 13).
- The application code inside `apps/cleanup-executor/src/audit.ts` exposes strictly an `appendAuditEvent(event)` method. No update, delete, or overwrite functions are compiled into the codebase.

#### 3. Cryptographic SHA-256 Hash Chaining
Every audit event is cryptographically linked to its immediate predecessor:
$$\text{EntryHash}_k = \text{SHA256}(\text{PrevHash}_{k-1} + \text{"\|"} + \text{SequenceNum}_k + \text{"\|"} + \text{RFC8785}(\text{AuditEventPayload}_k))$$

Each record contains:
```json
{
  "_id": "audit_seq_10842",
  "sequenceNumber": 10842,
  "prevHash": "3f8b7a2c...",
  "entryHash": "e91c4d7a...",
  "timestamp": "2026-11-06T01:15:12.104Z",
  "actor": "decision_os_cleanup_executor",
  "eventType": "STATE_TRANSITION",
  "payload": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "databaseName": "decision_os_test_run_alpha_w0",
    "fromState": "OUTCOME_UNKNOWN",
    "toState": "QUARANTINED"
  }
}
```

#### 4. Independently Protected Chain-Head Checkpoint Storage
To prevent full-chain rewriting (where an attacker with MongoDB superuser access purges the collection and inserts a forged replacement chain from a fake genesis block), the architecture anchors the chain head externally:
1. **Periodic Checkpoint Generation:** Every 60 seconds (or immediately upon entering critical terminal states `QUARANTINED` or `CLEANED`), the executor computes an **Audit Checkpoint**:
   $$\text{Checkpoint} = \{ \text{checkpointId}, \text{sequenceNumber}, \text{headHash}, \text{timestamp}, \text{executorSignature} \}$$
2. **External Anchoring:** The checkpoint is transmitted over an independent channel to an external, independently authenticated sink:
   - **Production:** Emitted to an append-only cloud storage sink with WORM (Write Once, Read Many) / Object Lock policies (e.g. AWS S3 Object Lock, GCP Cloud Storage Bucket Lock, or CloudWatch Logs).
   - **CI / Staging:** Written to a protected local volume (`/var/log/cleanup-executor/checkpoints.jsonl`) mounted with host-level root ownership and append-only filesystem attributes (`chattr +a`).

#### 5. Concrete Tamper Detection Mechanisms
An independent verification scanner sweeps the audit chain during startup and hourly health checks. It detects:
1. **Record Deletion:** If record $k$ is removed, the sequence numbers gap ($\text{seq}_{k+1} \ne \text{seq}_{k-1} + 1$) and the hash link fails ($\text{prevHash}_{k+1} \ne \text{entryHash}_{k-1}$).
2. **Chain Truncation:** If the tail of the collection is pruned, the latest collection record has a sequence number less than the externally anchored checkpoint sequence number, or its head hash does not match the external anchor.
3. **Record Reordering:** If records $j$ and $k$ are swapped, both subsequent `prevHash` values fail SHA-256 verification.
4. **Payload Substitution:** If any field in record $k$ is modified, $\text{SHA256}(\dots) \ne \text{entryHash}_k$.
5. **Full-Chain Rewriting:** Even if an attacker recalculates all hashes internally, the resulting head hash will mismatch the independently protected external checkpoint head hash.

#### 6. Failure Recovery and Alerting Protocol
If the verification scanner detects an audit chain mismatch:
1. **Critical Alarm:** Emit immediate high-priority alert: `CRITICAL_AUDIT_LEDGER_INTEGRITY_VIOLATION`.
2. **Fail-Closed Executor Freeze:** The Cleanup Executor enters a **HARD-FREEZE STATE**:
   - Rejects all incoming `POST /v1/ownership/claim` requests with HTTP 503 `SERVICE_FROZEN_AUDIT_VIOLATION`.
   - Rejects all `POST /v1/cleanup/request` calls.
   - Halts all role and user provisioning.
   - Retains all active execution locks indefinitely.
3. **Forensic Reconciliation:** Unfreezing the executor requires manual SRE intervention using an offline hardware token key to verify logs against external WORM storage and certify audit consistency.

#### 7. Termination of Misleading "Immutability" Claims
The term "immutable" is strictly discontinued when referring to database collections writable by privileged connections. The ledger is accurately documented as:
> **Cryptographically Tamper-Evident with MongoDB RBAC-Enforced Append-Only Write Boundary and Externally Anchored WORM Checkpoints.**

### 18.3 Metrics & Alerting
- Prometheus metrics: `cleanup_requests_total`, `cleanup_duration_seconds`, `cleanup_ambiguous_outcomes_total`, `cleanup_quarantined_total`, `cleanup_dangling_roles_reaped_total`.
- Alert: Any transition to `OUTCOME_UNKNOWN`, `RECONCILIATION_REQUIRED`, or `QUARANTINED` fires high-priority SRE alert.

---

## 19. Phased Implementation Sequence

```mermaid
flowchart LR
    PhaseC1["Phase C1:
Exact Scoped RBAC, Non-Superuser Provisioning & Discrete Principals"] --> PhaseC2["Phase C2:
apps/cleanup-executor Service & Ed25519 Cryptographic Engine"]
    PhaseC2 --> PhaseC3["Phase C3:
Oplog Evidence Protocol & Quarantine State Machine"]
    PhaseC3 --> PhaseC4["Phase C4:
CleanupExecutorClient in apps/api & Ephemeral Credential Integration"]
    PhaseC4 --> PhaseC5["Phase C5:
Remediate Call Sites (CS-01 to CS-17)"]
    PhaseC5 --> PhaseC6["Phase C6:
Static Guard Script & CI Negative Security Tests"]
    PhaseC6 --> PhaseC7["Phase C7:
Full Verification & Regression Testing (D38-01 to D38-24)"]
```

---

## 20. Verification Plan and Acceptance Criteria

All verification items are **PLANNED** for implementation and execution during Phase C / Phase D. None are marked completed prematurely:

| Test ID | Test Category | Description & Target Assertion | Target Phase | Status |
|---|---|---|---|---|
| **`D38-01`** | **Real MongoDB Authorization Test** | Authenticate as `decision_os_worker_base_role`. Assert `db.dropDatabase()` and `db.command({ dropDatabase: 1 })` throw Error Code 13 (`Unauthorized`). | Phase C1 | PLANNED |
| **`D38-02`** | **Real MongoDB Authorization Test (Finding 1)** | Authenticate as any worker principal. Assert direct write/update/delete on `decision_os_coordination.ownership_locks` throws Error Code 13. Verify no indirect inherited write privileges via `db.getUser()`. | Phase C1 | PLANNED |
| **`D38-03`** | **Real MongoDB Authorization Test (Finding 1)** | Authenticate as any worker principal. Assert direct insert/update/delete on `decision_os_coordination.cleanup_ledger` throws Error Code 13. | Phase C1 | PLANNED |
| **`D38-04`** | **Unit Test** | Execute RFC 8785 deterministic test vector. Verify canonical JSON, SHA-256 payload hash (`b636...`), and Ed25519 signature verification succeed with test vector constants. | Phase C2 | PLANNED |
| **`D38-05`** | **Mocked Integration Test** | Submit cleanup request signed with valid key for Caller A targeting database owned by Caller B. Verify HTTP 403 `CALLER_NOT_DATABASE_OWNER`. | Phase C2 | PLANNED |
| **`D38-06`** | **Multi-Process Adversarial Test (Finding 2)** | Simulate lost wire response via socket drop during drop command. Verify ledger records `OUTCOME_UNKNOWN` and automatic redispatch is rejected across API retries, restarts, and successors. | Phase C3 | PLANNED |
| **`D38-07`** | **Multi-Process Adversarial Test (Finding 2)** | Simulate paused executor after CAS to `DISPATCHING`. Verify successor executor refuses reassignment and does not issue secondary drop. | Phase C3 | PLANNED |
| **`D38-08`** | **Mocked Integration Test (Finding 2)** | Observe database absence after lost response. Verify state remains `OUTCOME_UNKNOWN` with `targetAbsentObserved: true`, refusing transition to `CLEANED` without authoritative server oplog proof. | Phase C3 | PLANNED |
| **`D38-09`** | **Mocked Integration Test (Finding 2)** | Submit administrative reconciliation with valid SRE signature and `action: 'QUARANTINE'`. Verify transition to `QUARANTINED`, retention of execution lock, and verification that zero wire drops are dispatched. Assert rejection if `forceRedispatch` is supplied. | Phase C3 | PLANNED |
| **`D38-10`** | **Operational / Manual Verification** | Verify test runner in CI verifies container isolation and refuses to start if containerless mode is attempted in CI environment. | Phase C4 | PLANNED |
| **`D38-11`** | **Unit / Static AST Test** | Introduce synthetic `db.dropDatabase()` call into application code. Verify `scripts/verify_no_direct_destructive_calls.ts` detects call and exits with status 1. | Phase C6 | PLANNED |
| **`D38-12`** | **Integration Test** | Execute benchmark script `scripts/benchmark.ts`. Verify isolated test database creation, ownership claim, dynamic role provisioning, dedicated benchmark credentials, and executor-mediated teardown without raw drop. | Phase C5 | PLANNED |
| **`D38-13`** | **Real MongoDB Authorization Test** | Connect as `decision_os_cleanup_executor`. Attempt `dropDatabase()` on `decision_os_production`. Assert rejection by naming guard and physical absence of DB on test deployment. | Phase C1 | PLANNED |
| **`D38-14`** | **Full Monorepo Regression** | Execute all 51 test suites across `@decision-os/api`, `@decision-os/decision-engine`, and `@decision-os/web`. Golden Fixtures G1–G10 pass 100%. | Phase C7 | PLANNED |
| **`D38-15`** | **Dynamic Role Lifecycle Test (Finding 1)** | Verify dynamic role creation on `POST /v1/ownership/claim`. Worker performs CRUD on assigned DB. Worker is blocked with Error 13 on other test DBs and coordination DB. Verify role revocation on cleanup completion. | Phase C1 / C3 | PLANNED |
| **`D38-16`** | **Two-Worker Adversarial Database Isolation Test (Finding B38-11)** | Worker A owns DB A (`decision_os_test_run1_wA`), Worker B owns DB B (`decision_os_test_run1_wB`). Authenticate with distinct identities. Worker A attempts CRUD on DB B $\rightarrow$ Error Code 13. Worker B attempts CRUD on DB A $\rightarrow$ Error Code 13. Both attempt writes to coordination collections $\rightarrow$ Error Code 13. Both attempt role escalation $\rightarrow$ Error Code 13. | Phase C1 | PLANNED |
| **`D38-17`** | **Scoped Role Provisioning & Non-Superuser Test (Finding B38-12)** | Connect as `decision_os_cleanup_executor`. Verify supported commands (`createRole`, `createUser`, `dropRole`, `dropUser`) succeed for test database roles. Attempt to grant `userAdmin`, `clusterAdmin`, or `root` $\rightarrow$ Error Code 13 or application guard rejection. Assert direct writes to `admin.system.roles` and `admin.system.users` throw Error Code 13. Verify SHA-256 hash chaining on `cleanup_audit_log`. | Phase C1 | PLANNED |
| **`D38-18`** | **MongoDB 8.0 Replica Set Oplog Evidence Protocol Test (Finding B38-13)** | Dispatch drop command with correlation `comment` on replica set `rs0`. Assert oplog entry contains matching `comment`, timestamp, and majority commit point. Simulate election rollback, pre-dispatch timestamps, missing comment, and rolled-over oplog. Assert `CONFIRM_CLEANED` is rejected with HTTP 422 and request remains `QUARANTINED`. | Phase C3 | PLANNED |
| **`D38-19`** | **Role Lifecycle & Concurrency Interleaving Integration Test (Finding B38-14)** | Execute automated integration tests simulating the 10 concurrency interleavings (concurrent claims, race on same DB, partial provisioning saga rollback, credential envelope delivery timeout, crash before cleanup lease expiry, dangling role reaper, post-quarantine credential invalidation, active socket severing via `killAllSessionsByPattern`). Assert 100% fail-closed behavior and zero cross-worker privilege leakage. | Phase C3 | PLANNED |
| **`D38-20`** | **Real MongoDB 8.0 Session Termination & Post-Revocation Test (Finding B38-15)** | Authenticate as `decision_os_cleanup_executor`. Execute `killAllSessionsByPattern` targeting worker principal on `admin` db using `{ cluster: true }` privileges. Assert logical session termination, active operation abort, cursor closure, TCP socket retention, worker client-pool shutdown (`client.close(true)`), and post-revocation connection denial (Code 11/13/18). Test prepared transaction limitation and abort handling. | Phase C1 / C3 | PLANNED |
| **`D38-21`** | **Live MongoDB 8.0 Oplog Evidence Protocol & Comment Preservation Test (Finding B38-16)** | Dispatch `{ dropDatabase: 1, comment: JSON.stringify(...) }` on replica set `rs0`. Empirically verify whether MongoDB 8.0 preserves the `comment` field in `local.oplog.rs`. Verify that `readConcern` is ignored on `local.oplog.rs`. Extract `optimes.lastCommittedOpTime.ts` and `.t` from `replSetGetStatus` on active primary. Assert lexicographical OpTime comparison $(t, ts)$, election safety, and rollover detection. If comments are not preserved, assert automatic reconciliation is disabled and requests remain `QUARANTINED`. | Phase C3 | PLANNED |
| **`D38-22`** | **Ephemeral Credential Envelope Recovery After Executor Crash (Finding B38-17)** | Worker claims DB; executor provisions role and user, generates password, and writes AES-256-GCM envelope to `ownership_locks.credentialEnvelope`. Simulate abrupt executor crash before HTTP response delivery. Restart executor. Worker retries `POST /v1/ownership/claim` with same `requestId`. Assert executor validates caller signature, decrypts envelope with `ENVELOPE_KEY`, validates AAD, and redelivers credentials without recovering plaintext from SCRAM verifier. Assert forward secrecy: envelope zeroized upon activation. | Phase C2 / C4 | PLANNED |
| **`D38-23`** | **Multi-Command Provisioning Saga Crash & Compensation Test (Finding B38-18)** | Execute automated tests simulating executor crash at each of the 8 saga transitions (`CLAIM_PENDING`, `ROLE_CREATED`, `USER_CREATED`, `ROLE_ASSIGNED`, `ACTIVATED`, `ROLLING_BACK`, `ORPHAN_RECOVERY`). Simulate network failure during compensating `dropRole` / `dropUser`; assert saga records `compensationPending: true` and orphan reaper retries with backoff. Assert partially provisioned identities have zero test DB privileges. Assert orphan reaper 4-point verification check before deleting any user or role. | Phase C1 / C3 | PLANNED |
| **`D38-24`** | **Adversarial Audit Mutation & External Checkpoint Test (Finding B38-19)** | Connect as `decision_os_cleanup_executor`. Attempt `updateOne`, `deleteMany`, `findAndModify`, or `drop` on `decision_os_coordination.cleanup_audit_log` $\rightarrow$ natively rejected by MongoDB RBAC with Error Code 13 (`Unauthorized`). Simulate adversarial tampering (deletion, truncation, reordering, substitution, rewriting) on historical records. Assert verification scanner detects tampering via SHA-256 recalculation and external checkpoint comparison, immediately firing critical alarm and entering executor hard freeze. | Phase C2 / C6 | PLANNED |

---

## 21. Open Questions, Unresolved Assumptions and Decisions Requiring Explicit Approval

### 21.1 Open Decisions Requiring Technical Alignment
1. **Test Runner Dynamic Key Registration Protocol:**
   - *Question:* Should test workers register their dynamic Ed25519 public keys with the executor via a signed registration API (`POST /v1/auth/register-worker`) during worker thread startup, or should key pairs be generated deterministically from the test run seed?
   - *Recommendation:* Signed registration API with a short-lived run token provisioned by the CI test runner.
2. **Lease Expiry Duration for Ownership Locks:**
   - *Question:* What is the optimal lease duration for `ownership_locks` during long-running integration tests?
   - *Recommendation:* 60-second lease with an automatic background heartbeat every 15 seconds, preventing premature expiration during long-running deliberation tests.
3. **Administrative Key Storage in Production:**
   - *Question:* Should administrative reconciliation keys be integrated with AWS KMS / HashiCorp Vault transit secrets engine, or managed via offline SRE key pairs?
   - *Recommendation:* HashiCorp Vault transit engine with multi-party audit logging for production deployments.

### 21.2 Explicit List of Unresolved Architectural Assumptions and Risks
1. **DDL Command Comment Preservation in `local.oplog.rs` (Assumption under test in D38-21):**
   MongoDB documentation explicitly guarantees comment preservation in server logs, profiler entries, and `currentOp`, but comment retention in `local.oplog.rs` for DDL commands (`dropDatabase`) is an unproven assumption in MongoDB 8.0. If live testing (`D38-21`) demonstrates that MongoDB 8.0 strips comments from drop records, automatic or administrative `CONFIRM_CLEANED` cannot be supported, and all ambiguous drops must remain permanently in `QUARANTINED`.
2. **Prepared Transactions Bypass Session Termination (Known MongoDB 8.0 Limitation):**
   MongoDB's `killAllSessionsByPattern` explicitly ignores sessions that currently have transactions in the `prepared` state. While unprivileged workers are barred from initiating distributed transactions, any unexpected prepared transaction requires coordinator abort handling rather than session kill.
3. **Physical TCP Socket Retention Post Session Invalidation:**
   Session termination invalidates logical sessions and server-side authorization caches, but does NOT physically sever client TCP network sockets. The system relies on worker-side client driver-pool invalidation (`client.close(true)`) and native MongoDB engine rejection (Error Code 11/13/18) if a rogue worker reuses cached sockets.
4. **Mandatory Hard Security Boundary of the Test MongoDB Deployment:**
   Because MongoDB RBAC does not support database wildcards, the cleanup executor must possess `{ db: "", collection: "" }` with `dropDatabase` to destroy dynamic test databases. This broad grant is safe **strictly because the deployment is physically and logically isolated** from staging and production (`mongodb-test:27018`). If the executor were misconfigured to connect to a production instance, application-level regex guards would be the only defense against production data loss.
5. **Accumulation of Quarantined Database Namespaces:**
   Because the fail-closed policy permanently retains execution locks for ambiguous drops with zero redispatch, frequent network partitions or replica set failovers could accumulate abandoned test databases. Automated tests avoid collision by using UUIDs, but physical storage cleanup requires scheduled offline maintenance.

---

## Gate B Completion Sign-Off Checklist

- [x] Baseline and commit verified: `fix/batch4-replica-set-transactional-recovery` at baseline commit `949ca35a7154f4c4db308dd73badf85221a98c9f`
- [x] Document version upgraded to 1.4.0 (Phase B.4 Session Invalidation, Evidence Integrity & Provisioning Recovery)
- [x] Phase A destructive inventory (`CS-01` to `CS-17`) thoroughly inspected and addressed
- [x] B38-01 resolved: MongoDB RBAC wildcards removed; Dedicated Isolated Test Deployment established
- [x] B38-02 remediated (Phase B.2): Worker role additive privilege defect corrected; exact per-database scoped roles eliminate coordination write access
- [x] B38-03 remediated (Phase B.2): Worker write access to `cleanup_ledger` blocked natively by MongoDB RBAC
- [x] B38-04 resolved: Self-referential hash eliminated; RFC 8785 JCS + deterministic test vector established
- [x] B38-05 resolved: Asymmetric Ed25519 standard selected; caller identities bound to registered public keys
- [x] B38-06 remediated (Phase B.2): Administrative `forceRedispatch` removed; point-in-time checks rejected as proof; terminal `QUARANTINED` state introduced
- [x] B38-07 remediated (Phase B.2): All redispatch paths prohibited after `DISPATCHING`; Case D updated
- [x] B38-08 resolved: Local containerless runner labeled as Development-Only Weaker Mode; disabled in CI
- [x] B38-09 resolved: Network identities defined for all 4 caller categories; network reachability decoupled from authn
- [x] B38-10 resolved: Absolute claims replaced with precise guarantees and explicit residual risks
- [ ] **B38-11 remediated (Phase B.3):** Shared MongoDB user defect eliminated; discrete per-worker principals, ephemeral in-memory credentials, and exact dynamic roles prevent cross-worker database leakage (Pending Independent Review)
- [ ] **B38-12 remediated (Phase B.3):** Direct system collection CRUD and `userAdmin` superuser grants eliminated; non-superuser role administration with application guardrails and SHA-256 audit logging established (Pending Independent Review)
- [ ] **B38-13 remediated (Phase B.3):** Authoritative MongoDB 8.0 replica-set oplog evidence protocol formulated with correlation comments, majority commitment checks, and fail-closed quarantine (Pending Independent Review)
- [ ] **B38-14 remediated (Phase B.3):** Role lifecycle and concurrency interleavings analyzed; active connection invalidation established (Pending Independent Review)
- [ ] **B38-15 remediated (Phase B.4):** Real MongoDB session invalidation (`killAllSessionsByPattern`, `killSessions`) on `{ cluster: true }` replaces unsupported `killAllUserConnections`; distinguishes logical sessions, operations, cursors, TCP sockets, and driver pools; addresses prepared transaction limitations (Pending Independent Review)
- [ ] **B38-16 remediated (Phase B.4):** Technically supportable MongoDB 8.0 replica-set oplog evidence protocol using `optimes.lastCommittedOpTime.ts/.t`; explicitly documents that `local` ignores read concerns; requires live proof of comment preservation before any automated confirmation (Pending Independent Review)
- [ ] **B38-17 remediated (Phase B.4):** Crash-safe ephemeral credential recovery via caller-bound encrypted envelopes (`ownership_locks.credentialEnvelope`), zeroized upon activation, with controlled rotation and fail-closed abandonment (Pending Independent Review)
- [ ] **B38-18 remediated (Phase B.4):** False provisioning atomicity claims replaced with a durable idempotent saga model spanning 8 distinct states with crash/restart recovery, failed-compensation retry, and strict orphan reaper verification proof (Pending Independent Review)
- [ ] **B38-19 remediated (Phase B.4):** Audit ledger made genuinely tamper-evident by separating audit privileges from coordination CRUD; enforcing append-only via MongoDB RBAC (`find`, `insert`, `createIndex` only); independently protected external checkpoints; detection of deletion, truncation, reordering, substitution, and rewriting (Pending Independent Review)
- [x] Expanded verification plan (`D38-01` to `D38-24`) categorized and explicitly marked as PLANNED
- [x] Zero application or test files modified; architecture design revision only
- [x] **STOP gate observed:** Phase B.4 completed; awaiting independent architecture review and formal Gate B approval before Phase C. Do not self-approve Gate B.
