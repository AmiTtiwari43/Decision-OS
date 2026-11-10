# DECISION OS — BATCH 4 V3.8 ARCHITECTURE DECISION
## Independent Cleanup Executor, Real MongoDB Privilege Separation & Concurrency Safety

**Document Version:** 1.7.0 (Phase B.7 Privileged Broker Isolation, Nonce Allocator Hardening & Revocation Enforcement)
**Repository:** `AmiTtiwari43/Decision-OS`
**Branch:** `fix/batch4-replica-set-transactional-recovery`
**Current Baseline Commit:** `992a4cd326fe39865a723c29e974ba0f31707e8a` (`docs: remediate provisioning scope, revocation authority, and cryptographic nonce uniqueness (v1.6.0)`)
**Parent Baseline Commit:** `5ef95550c0709fdc99186bf42e5352f3aa846b4e` (`docs: separate destructive and provisioning privilege boundaries and harden revocation protocol`)
**Prior Lineage Commits:** `f0fbfc1b6d04ad947f85277435d0803282cd03cd`, `949ca35a7154f4c4db308dd73badf85221a98c9f`, `724f1076284b186f42759677ab9e480d27531b69`, `943a8e7a433ce1b98804a83c6be403b2fca52e96`, `161e59e85bb7183c21926f0b04f788eb43312394`, `bbaf9bee29ef40f80bb8b958569c7ebbb437b427`, `2e276058c119c36ef4d8e5d665bd6c029b2cc6bb`
**Document Revision:** Working tree revision on `fix/batch4-replica-set-transactional-recovery` against baseline `992a4cd326fe39865a723c29e974ba0f31707e8a` (Phase B.7 Deliverable)
**Phase A Artifact:** `BATCH_4_V38_DESTRUCTIVE_CALLSITE_INVENTORY.md`
**Date:** 2026-11-06
**Status:** ARCHITECTURE DESIGN (Phase B.7 Deliverable — Pending Independent Review & Formal Gate B Approval)

---

## 1. Executive Summary

During Batch 4 V3.7, destructive database teardown operations were centralized behind an in-process `SupervisedCleanupExecutor` in `apps/api/src/db/guard.ts`. While V3.7 introduced coordination fencing concepts, the Phase A architectural audit (`BATCH_4_V38_DESTRUCTIVE_CALLSITE_INVENTORY.md`) and subsequent Phase B.1 through Phase B.5 security inquests revealed critical architectural defects:

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
1. **Incorrect MongoDB Session Invalidation (Finding B38-15):** Replaced non-existent `killAllUserConnections` with supported `killAllSessionsByPattern` and `killSessions`. Scoped `killAnySession` and `impersonate` strictly to `{ cluster: true }`. Distinguished logical sessions, operations (`killOp`), cursors, TCP sockets, and driver pools.
2. **Technically Unsupportable Oplog Evidence Protocol (Finding B38-16):** Reworked Section 10.4 using exact MongoDB 8.0 `replSetGetStatus` fields (`optimes.lastCommittedOpTime.ts/.t`). Acknowledged that `local` ignores read concern. Formulated lexicographical OpTime comparison. Formally classified comment preservation in `local.oplog.rs` as an unverified hypothesis (`D38-21`).
3. **Crash-Unsafe Ephemeral Credential Recovery (Finding B38-17):** Designed a crash-safe credential recovery protocol utilizing a Caller-Bound Encrypted Credential Envelope stored in `ownership_locks.credentialEnvelope` (AES-256-GCM). Provided fallback to controlled rotation via `updateUser` before activation.
4. **False Provisioning Atomicity Claims (Finding B38-18):** Replaced false atomicity claims with a Durable Idempotent Provisioning Saga with explicit states, transition recovery, and orphan reaper proof.
5. **Genuinely Tamper-Evident Audit Ledger (Finding B38-19):** Separated audit log privileges from coordination CRUD. Scoped executor privileges on `cleanup_audit_log` strictly to append-only (`find`, `insert`, `createIndex`). Established external chain-head checkpoint storage.

### Phase B.5 Privilege Boundary Separation & Revocation Hardening Remediation
Independent architectural inquest of baseline commit `f0fbfc1b6d04ad947f85277435d0803282cd03cd` identified critical privilege-boundary and revocation vulnerabilities:
1. **Destructive Authority Separation from Coordination and Audit Data (Finding B38-20):** Established a strict physical/logical two-deployment boundary between `rs_coord:27019` (coordination and append-only audit) and `rs_test:27018` (ephemeral test databases), rendering coordination destruction physically impossible for the cleanup executor.
2. **Restricting Role Provisioning Authority & Decoupling Services (Finding B38-24):** Decoupled provisioning authority into `apps/provisioner` (`decision_os_provisioner`), distinct from `apps/cleanup-executor` (`decision_os_destructive_executor`). Created worker roles directly on target test databases.
3. **Permanent Multi-Layer Worker Revocation (Finding B38-25):** Established server-side revocation defending against hostile workers retaining TCP sockets, coordinating operation abort, logical session kill, user deletion, daemon authorization cache invalidation, and network isolation.

### Phase B.6 Provisioning Scope, Revocation Authority & Cryptographic Nonce Correction Remediation
Independent architectural review of baseline commit `5ef95550c0709fdc99186bf42e5352f3aa846b4e` identified three critical security, authorization, and cryptographic defects:

1. **Elimination of Cross-Database Provisioning Authority (Finding B38-26):**
   - *Defect:* The v1.5.0 privilege matrix granted `decision_os_provisioner` the actions `createRole`, `dropRole`, `createUser`, `dropUser`, `grantRole`, `revokeRole`, and `changePassword` across `{ db: "", collection: "" }` on `rs_test`. Although roles defined on non-admin databases cannot grant privileges on other databases, granting `{ db: "", collection: "" }` role- and user-management actions allowed a compromised provisioner to administer principals across *any* non-admin database on `rs_test`. This compromised per-worker isolation if the provisioner was compromised.
   - *Remediation:* Removed unrestricted cross-database user and role administration from the central provisioning identity. Formulated a **Database-Scoped Provisioning Delegation Model** where provisioning authority on `rs_test` is mediated strictly via per-target-database scoped administrative identities (`decision_os_db_admin_${dbName}`) whose authorization scope is strictly constrained to `{ db: targetDb, collection: "" }`. Defined initial scoped delegation via pre-allocated partition slot pools (minted at deployment initialization by offline bootstrap without runtime central `{ db: "", collection: "" }`) and dynamic expansion via an isolated ephemeral scoped credential broker. Explicitly distinguished role-definition scope, role-management authorization scope, user-management authorization scope, and role-grant authorization scope. Added adversarial verification item **`D38-29`**.
2. **Reconciliation of Revocation Service Responsibilities (Finding B38-27):**
   - *Defect:* The v1.5.0 revocation protocol instructed `decision_os_destructive_executor` to execute `dropUser` and `dropRole` directly on the target test database. However, the privilege matrix explicitly prohibited the destructive executor from executing `dropUser` and `dropRole` (assigning them to the provisioning identity), creating a direct architectural contradiction that would fail with MongoDB Error Code 13 (`Unauthorized`).
   - *Remediation:* Defined an executable, internally consistent, durable 2-phase revocation protocol. Assigned `dropUser` and `dropRole` strictly to the Scoped Provisioning Service (authenticating as `decision_os_db_admin_${targetDb}`). Assigned in-flight operation cancellation (`killOp`), logical session termination (`killAllSessionsByPattern`), and prepared transaction resolution to the Destructive Cleanup Executor (`decision_os_destructive_executor`). Resolved responsibility, identity, privileges, acknowledgements, retries, and fail-closed conditions for all 8 operations. Client API responses and client-side connection closure are explicitly rejected as proof of revocation. Added adversarial verification item **`D38-30`**.
3. **Correction of AES-256-GCM Nonce Uniqueness (Finding B38-28):**
   - *Defect:* The v1.5.0 nonce construction (`InstanceSalt (32-bit random) || MonotonicCounter (64-bit in-memory)`) reset the counter to zero upon process restart. Under the birthday paradox, a 32-bit random salt incurs a 50% collision probability after only $2^{16} = 65,536$ process instances or replicas sharing the same key. A salt collision across restarts or concurrent replicas results in identical nonces under the same AES-256-GCM key, completely breaking GCM cryptographic confidentiality and authenticity.
   - *Remediation:* Replaced the flawed in-memory construction with a **Durable Globally Coordinated Counter Range Block Reservation Protocol** adhering to NIST SP 800-38D Section 8.2.1 Deterministic Construction. Replicas lease non-overlapping blocks of counters ($2^{20}$ nonces) via atomic `$inc` on `rs_coord:27019` (`decision_os_coordination.nonce_allocations`) with majority write concern (`w: "majority", j: true`). Upon process restart, residual in-memory counters are discarded and a fresh disjoint block is reserved. Addressed multi-replica concurrency, crash recovery, key rotation, database backup restoration (epoch bumping / forced key rotation), counter exhaustion ceilings ($2^{48}$ invocations), and fail-closed halt when nonce allocation state is unreachable. Added adversarial verification item **`D38-28`**.

### Phase B.7 Privileged Broker Isolation, Nonce Allocator Hardening & Revocation Enforcement Remediation
Independent architectural review of baseline commit `992a4cd326fe39865a723c29e974ba0f31707e8a` identified five critical authorization, security boundary, and revocation handoff defects:

1. **Bootstrap Broker Explicit Security Boundary (Finding B38-31):**
   - *Defect:* The v1.6.0 architecture introduced offline bootstrap and dynamic credential brokers, but their exact MongoDB identities, privileges, credential custody, and compromise boundaries were absent from the privilege matrix. Furthermore, central provisioner access to pre-allocated partition slots was insufficiently bounded, risking bulk credential retrieval.
   - *Remediation:* Added every bootstrap and broker identity (`decision_os_offline_bootstrap`, `decision_os_credential_broker`) to the privilege matrix. Defined exact MongoDB privileges for scoped admin creation. Bounded the broker via signed ownership claim validation, target database namespace binding, 60-second ephemeral TTL, and isolated enclave execution. Mandated a path-based partition slot lease vault (`apps/slot-vault`) preventing bulk credential retrieval. Defined offline bootstrap credential destruction (`shred -u` of tmpfs) and air-gapped break-glass recovery. Added threat models for compromised broker, bootstrap, and secrets engine. Added adversarial verification item **`D38-31`**.
2. **Protection of Nonce Allocation State from Unauthorized Reset (Finding B38-32):**
   - *Defect:* The v1.6.0 privilege matrix granted the central provisioner `update` access to `nonce_allocations`. A compromised provisioner could issue `$set: { nextBlockStart: 0 }`, resetting the sequence and destroying AES-256-GCM nonce uniqueness.
   - *Remediation:* Separated nonce allocation authority into an independent **Nonce Allocation Service** (`apps/nonce-allocator`, identity `decision_os_nonce_allocator`) on `rs_coord:27019`. Stripped the general provisioner of all write/update access to `nonce_allocations`. Enforced monotonic allocation via strictly typed `$inc` without `$set` code paths, pre-initialized sequence documents (`nonce_seq_v1`), duplicate-key handling (Code 11000), majority journaled writes (`w: "majority", j: true`), and KMS epoch bumping on backup restores. Formally specified 96-bit nonce encoding: `KeyVersionPrefix (16 bits) || AllocatedRangeBlock (32 bits) || MonotonicCounter (48 bits)` with BSON `NumberLong` types, $2^{48}$ exhaustion ceiling, and explicit trust assumptions. Added adversarial verification item **`D38-32`**.
3. **Correction of MongoDB killOp Privilege Scope (Finding B38-33):**
   - *Defect:* The v1.6.0 privilege matrix assigned `killOp` to resource `{ db: "admin", collection: "" }`. In MongoDB RBAC, killing other users' operations is authorized exclusively on the cluster resource via privilege action `killop`.
   - *Remediation:* Corrected the privilege matrix and operation matrix to use documented `{ resource: { cluster: true }, actions: ["killop", "inprog", "killAnySession", "impersonate"] }`. Used exact lowercase action spelling (`killop`, `inprog`). Distinguished command execution database (`admin.$cmd`) from authorization resource scope (`{ cluster: true }`). Removed unsupported `{ db: "admin", collection: "" }` grant from the executor. Added real MongoDB 8.0 authorization verification item **`D38-33`**.
4. **Correction of MongoDB Privilege Action Definitions (Finding B38-34):**
   - *Defect:* The v1.6.0 privilege matrix used `findAndModify` as a standalone privilege action. MongoDB authorizes `findAndModify` via underlying actions: `find`, `update`, `insert`, `remove`.
   - *Remediation:* Removed `findAndModify` from all privilege action lists across the document. Audited all identities and resources against MongoDB 8.0 RBAC actions (`find`, `update`, `insert`, `remove`, `createIndex`, `dropDatabase`, etc.). Clarified that denying `update` and `remove` natively prevents `findAndModify` state mutations. Added negative authorization verification item **`D38-34`**.
5. **Integration of Network Transport Fencing into Durable Revocation Protocol (Finding B38-35):**
   - *Defect:* Network transport fencing was listed in the operation matrix but was never invoked or acknowledged in the durable revocation handoff protocol.
   - *Remediation:* Formally integrated **Network Transport Fencing** into the durable revocation protocol. Defined the orchestrator/CNI identity (`decision_os_network_fence_controller`), control-plane API (`POST /v1/orchestrator/fence-worker` / Kubernetes NetworkPolicy), target worker pod identity, and egress-drop policy scope. Sequenced network fencing synchronously as Step 2 of the revocation protocol, verified before MongoDB identity deletion and session/operation cancellation. Defined retry backoff and fail-closed halt if the network controller is unavailable. Formally distinguished all 6 layers of isolation (logical session invalidation, server-side user deletion, operation cancellation, TCP socket retention, network transport isolation, database deletion) and mandated that `dropDatabase` is never represented as network fencing. Expanded `D38-30` and added adversarial verification item **`D38-35`**.

---

## 2. Baseline and Inspected Source References

### 2.1 Git Baseline & Provenance Verification
- **Target Repository:** `AmiTtiwari43/Decision-OS`
- **Active Branch:** `fix/batch4-replica-set-transactional-recovery`
- **Current Baseline Commit:** `992a4cd326fe39865a723c29e974ba0f31707e8a` (`docs: remediate provisioning scope, revocation authority, and cryptographic nonce uniqueness (v1.6.0)`)
- **Parent Baseline Commit:** `5ef95550c0709fdc99186bf42e5352f3aa846b4e` (`docs: separate destructive and provisioning privilege boundaries and harden revocation protocol`)
- **Prior Lineage Commits:**
  - `f0fbfc1b6d04ad947f85277435d0803282cd03cd` (`docs: harden batch 4 v3.8 revocation and recovery protocol`)
  - `949ca35a7154f4c4db308dd73badf85221a98c9f` (`docs: harden batch 4 v3.8 worker identity and role provisioning`)
  - `724f1076284b186f42759677ab9e480d27531b69` (`docs: close batch 4 v3.8 privilege and redispatch gaps`)
  - `943a8e7a433ce1b98804a83c6be403b2fca52e96` (`docs: harden batch 4 v3.8 cleanup executor architecture`)
  - `161e59e85bb7183c21926f0b04f788eb43312394` (`refactor: add architecture decision record for batch 4 v3.8 cleanup executor`)
  - `bbaf9bee29ef40f80bb8b958569c7ebbb437b427` (`docs: add batch 4 v3.8 destructive call-site inventory document`)
  - `2e276058c119c36ef4d8e5d665bd6c029b2cc6bb` (`fix(batch4): isolate destructive cleanup behind supervised executor v3.7`)
- **Verification Note:** The repository working tree and GitHub remote branch `fix/batch4-replica-set-transactional-recovery` were independently inspected. Commit `992a4cd326fe39865a723c29e974ba0f31707e8a` is verified as the actual branch HEAD, descending directly from parent `5ef95550c0709fdc99186bf42e5352f3aa846b4e`.
- **Target Database Engines:**
  - **Coordination & Audit Deployment:** MongoDB 8.0 (Replica Set `rs_coord`, port 27019).
  - **Ephemeral Test Database Deployment:** MongoDB 8.0 (Replica Set `rs_test`, port 27018).

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

To eliminate in-process vulnerability, achieve verifiable privilege separation, and guarantee permanent revocation, three architectural alternatives were evaluated:

### Option A — Dedicated OS Process (Local Daemon / Child Process)
A separately launched Node.js daemon running on the host OS, communicating with the API/test workers via Unix Domain Sockets (UDS) or a localhost TCP port. It possesses its own process memory, lifecycle, MongoDB connection pool, and privileged credentials loaded from a protected environment file.

### Option B — Dedicated Containerized Services with Physical Deployment Separation & Scoped Delegation — SELECTED
An independently packaged and deployed set of isolated services:
1. **Provisioning Service (`apps/provisioner`):** Manages worker ownership claims, cryptographic signature verification, durable provisioning saga state, and mediates dynamic role generation via the **Database-Scoped Provisioning Delegation Model**. The central `decision_os_provisioner` identity possesses **zero unrestricted cross-database user/role administration rights** on `rs_test` (no `{ db: "", collection: "" }` roleAdmin/userAdmin). Dynamic worker roles and credentials are administered strictly via per-target-database scoped administrative principals (`decision_os_db_admin_${dbName}`) or short-lived scoped credentials minted through the Broker enclave. Possesses zero destructive drop capability.
2. **Dedicated Nonce Allocation Service (`apps/nonce-allocator`):** Dedicated microservice running under identity `decision_os_nonce_allocator` on `rs_coord:27019`. Possesses exclusive authority to allocate sequential counter range blocks on `decision_os_coordination.nonce_allocations` via atomic `$inc`. Decoupled from the general provisioning service to prevent unauthorized `$set` resets or counter manipulation.
3. **Partition Slot Vault & Ephemeral Credential Broker Boundary:**
   - **Partition Slot Vault (`apps/slot-vault`):** Secrets vault enforcing path-based ACLs (`secret/data/decision-os/slots/slot_${id}`). Prohibits bulk credential retrieval; permits the provisioner to retrieve exclusively the single slot credential bound to an active, verified lease on `rs_coord:27019`.
   - **Ephemeral Credential Broker (`apps/credential-broker`):** Isolated enclave service running under identity `decision_os_credential_broker` on `rs_test:27018`. Generates on-demand scoped database administrators (`decision_os_db_admin_${dbName}`) for unpooled databases strictly upon validating an Ed25519-signed ownership claim. Mints credentials with a 60-second ephemeral TTL; possesses zero coordination cluster access and zero destructive drop rights.
4. **Network Fence Controller (`apps/network-fence-controller`):** Dedicated infrastructure daemon running under identity `decision_os_network_fence_controller`. Interfaces with the CNI / Kubernetes NetworkPolicy / Linux netfilter engine to programmatically sever and drop layer-3/4 egress traffic from worker containers to database ports prior to teardown.
5. **Destructive Cleanup Executor (`apps/cleanup-executor`):** Dedicated microservice isolated in its own Linux namespaces (mount, pid, net, ipc) and cgroups. Connects exclusively to the Ephemeral Test Database Deployment. Possesses `{ resource: { db: "", collection: "" }, actions: ["dropDatabase", "dropCollection", "listCollections", "find"] }` and `{ resource: { cluster: true }, actions: ["killop", "inprog", "killAnySession", "impersonate", "checkCursorSanity"] }` strictly on that test cluster. Possesses zero network routing or credentials on the coordination cluster. Possesses zero role-management or user-management privileges (`dropUser` and `dropRole` are strictly forbidden). Coordinates multi-layer teardown with the Network Fence Controller and Scoped Provisioning Service.
6. **Physical / Logical Two-Deployment Topology:**
   - `mongodb-coord:27019`: Houses coordination state, durable nonce allocations, and append-only audit history.
   - `mongodb-test:27018`: Houses ephemeral test databases.

### Option C — External Job / Queue Worker (Asynchronous Ledger Consumer)
An asynchronous worker process that pulls cleanup jobs from an external message broker (RabbitMQ/Redis) or polling collection. Workers write a cleanup request document to the queue and await processing. The worker independently claims the job, executes the drop, and updates status.

### 3.1 Architecture Comparison Matrix

| Evaluation Dimension | Option A: Dedicated OS Process | Option B: Dedicated Containerized Services with Physical Deployment Separation & Scoped Delegation | Option C: External Job/Queue Worker |
|---|---|---|---|
| **1. Process & Memory Isolation** | **Moderate.** Separate OS PID and V8 heap; memory cannot be accessed via JS runtime. However, co-located processes on the same host can inspect `/proc` if running under the same UID. | **Strong Container Boundary.** Isolated Linux namespaces (PID, mount, IPC, net) and cgroups. Provisioner, Nonce Allocator, Broker, and Cleanup Executor run in distinct containers with zero shared memory. | **Strong.** Operates in an independent worker container; completely decoupled execution context. |
| **2. Credential Isolation** | **Moderate.** Privileged credentials stored in an OS environment variable or root-owned file. Risk of leakage if child process inherits parent environment or runs as same user. | **Strong & Segregated.** Secrets injected directly into dedicated container secret volumes. Destructive executor container does not possess coordination credentials. Slot Vault enforces path-based ACLs preventing bulk credential retrieval. Unprivileged worker containers have zero access. | **Strong.** Queue worker possesses privileged MongoDB credentials; API workers only possess queue insertion credentials. |
| **3. Destructive Blast Radius (B38-20)** | **Dangerous.** If connected to single deployment, `{ db: "", collection: "" }` drop privilege allows dropping coordination metadata and audit logs. | **Mathematically Zero on Coordination.** Destructive executor has zero network connectivity and zero credentials to `mongodb-coord:27019`. Native MongoDB catalog topology prevents dropping coordination collections. | **Dangerous on Shared Cluster.** If queue worker has drop privileges on cluster containing coordination data, compromise allows full destruction. |
| **4. Provisioning Privilege Safety (B38-24, B38-26, B38-31, B38-32)** | **Poor.** Co-locates provisioning and destructive authority under single daemon. | **Enforceable & Strictly Scoped.** Central provisioner stripped of `{ db: "", collection: "" }` role/user administration and stripped of nonce allocation updates. Authority delegated strictly per target database (`decision_os_db_admin_${dbName}`). Nonce allocation isolated in dedicated service (`decision_os_nonce_allocator`) enforcing `$inc` without `$set`. Broker isolated in enclave validating signed claims. | **Mixed.** Queue worker would require broad admin rights if handling both provisioning and teardown. |
| **5. Hostile Worker Revocation (B38-25, B38-27, B38-35)** | **Weak.** Relies on worker cooperating with socket closure. | **Multi-Layer Server-Side Coordinated Protocol.** Synchronous 4-layer handoff: (1) Network Transport Fencing isolates worker egress via CNI/netfilter; (2) Scoped Provisioner drops user/role, invalidating daemon authorization cache; (3) Cleanup Executor aborts running queries (`killop` on `{ cluster: true }`), prepared transactions, and logical sessions; (4) Executor drops database. Lingering sockets fail immediately at transport or database wire layers. | **Weak.** Asynchronous queue cannot immediately sever existing socket connections held by hostile worker. |
| **6. Crash Recovery & Ambiguity** | **Moderate.** On restart, daemon reads database state; lacks standardized orchestration signals for graceful shutdown. | **Superior.** Container lifecycle hooks (`preStop`, `SIGTERM`) allow graceful draining. Unacknowledged drops enter `OUTCOME_UNKNOWN` with durable fencing; zero redispatch; 12-state durable saga recovery; crash-safe nonce block allocation with KMS epoch bumping. | **Complex.** If worker crashes mid-drop, queue visibility timeout may cause a second worker to attempt re-dispatch before first drop completes on server. |
| **7. Operational Complexity** | **High in Production.** Difficult to monitor, scale, and log separately from main application in containerized environments. | **Low to Moderate.** Standard cloud-native pattern managed via Docker Compose (local/CI) and Helm/Kubernetes (staging/production). | **High.** Requires provisioning, clustering, and monitoring an external message broker (RabbitMQ/Redis) or building complex polling on MongoDB collections. |
| **8. Testability (Vitest Teardown)** | **Fast & Synchronous.** Fast IPC allows test runners (`afterEach`) to block synchronously until drop completes with minimal latency. | **Fast & Deterministic.** HTTP REST endpoint provides synchronous, deterministic completion responses to test workers without polling. | **Poor for Tests.** Asynchronous queue requires test runners to poll for job completion or listen on change streams, adding latency and flakes to CI suites. |
| **9. Local Development Experience** | **Simplest.** Can be started via `npm run dev:cleanup-daemon` or spawned by test runner. | **Standardized.** Spins up seamlessly in `docker-compose.yml` with dual MongoDB containers. For containerless local dev, can run via weaker development process profile. | **Heavy.** Requires spinning up Redis/RabbitMQ locally or running multiple background workers for simple unit test suites. |

### 3.2 Evaluation of Coordination/Audit Isolation Alternatives (Finding B38-20)
To resolve the vulnerability where `{ resource: { db: "", collection: "" }, actions: ["dropDatabase", ...] }` grants destruction of coordination and audit data, three isolation mechanisms were rigorously analyzed:

1. **Alternative 1: Single Deployment with Application-Level Regex & Policy Filtering (REJECTED)**
   - *Mechanism:* Keep all databases on a single MongoDB replica set (`:27018`). In application code, assert that the target database name matches `^decision_os_test_[a-zA-Z0-9_-]+$`, refusing to issue `dropDatabase` if the target is `decision_os_coordination`.
   - *Flaw:* **Violates Core Security Tenet.** In MongoDB RBAC, privileges are strictly additive:
     $$\text{EffectivePrivileges}(U) = \bigcup_{R \in \text{InheritedRoles}(U)} \text{Privileges}(R)$$
     MongoDB RBAC does not support `deny` rules, negative filters, or database name exclusions. Because MongoDB does not support wildcards (`decision_os_test_*`), the destructive identity must hold `{ db: "", collection: "" }`. Therefore, the MongoDB engine natively permits that identity to execute:
     `db.getSiblingDB("decision_os_coordination").dropDatabase()`
     Any software defect, injection vulnerability, or container compromise of the cleanup executor gives an adversary wire-level authority to destroy coordination locks, the request ledger, and the audit trail. Relying exclusively on application regex validation fails basic security assurance.
2. **Alternative 2: Single Deployment with Dynamic Pre-Drop Role Grants (REJECTED)**
   - *Mechanism:* Instead of granting `{ db: "", collection: "" }`, the executor dynamically creates or modifies a role prior to dropping each database, granting `dropDatabase` only on the specific target database.
   - *Flaw:* To create or grant roles on arbitrary databases, the identity must hold `createRole` / `grantRole` on `admin`. An identity with administrative role manipulation rights on `admin` can grant itself cluster-wide drop permissions or modify any user. This merely trades one excessive privilege for an even more dangerous one.
3. **Alternative 3: Dedicated Physical / Logical Two-Deployment Topology (SELECTED)**
   - *Mechanism:* Separate the physical/logical cluster into two independent deployments:
     - **Coordination & Audit Deployment (`mongodb-coord:27019`):** Dedicated to `decision_os_coordination` and `cleanup_audit_log`. Only the Provisioning Service, Nonce Allocation Service, and Audit Service have network access and credentials.
     - **Ephemeral Test Database Deployment (`mongodb-test:27018`):** Dedicated strictly to dynamic test databases (`decision_os_test_*`). The Destructive Cleanup Executor connects only to this deployment.
   - *Guarantee:* Because `decision_os_coordination` and `cleanup_audit_log` **do not exist in the catalog of `mongodb-test:27018`**, and because the Destructive Cleanup Executor has **zero network routing and zero credentials on `mongodb-coord:27019`**, it is mathematically and physically impossible for destructive cleanup to drop or alter coordination or audit data, regardless of executor bugs or total executor container compromise.

### 3.3 Evaluation of Provisioning Delegation Architecture Alternatives (Finding B38-26, B38-31)
To eliminate the central provisioner's cross-database user and role administration authority while ensuring dynamic databases receive initial narrowly scoped authority, three delegation models were evaluated:

1. **Alternative 1: Centralized Provisioner with `{ db: "", collection: "" }` UserAdmin (REJECTED — B38-26 Defect)**
   - *Mechanism:* Central `decision_os_provisioner` possesses `createRole`, `createUser`, `grantRole`, `dropUser`, `dropRole` across `{ db: "", collection: "" }` on `rs_test`. Roles are created directly on non-admin databases.
   - *Flaw:* While non-admin roles cannot contain privileges on other databases, the provisioner's *authorization to administer roles and users* is unrestricted across all non-admin databases. A compromised provisioner can create backdoors, alter passwords, or revoke roles across any worker's database, completely breaking per-worker multi-tenant isolation.
2. **Alternative 2: Pure On-Demand Role Administration via `admin` Superuser Delegation (REJECTED)**
   - *Mechanism:* Provisioner connects with root credentials on `admin` to dynamically grant itself scoped rights per claim.
   - *Flaw:* Merely moves unrestricted authority to a superuser credential, multiplying the blast radius of any compromise.
3. **Alternative 3: Database-Scoped Provisioning Delegation via Leased Partition Pools & Isolated Broker (SELECTED — Hardened in Phase B.7)**
   - *Mechanism:*
     - Strip `decision_os_provisioner` of all `{ db: "", collection: "" }` user and role administration privileges on `rs_test`.
     - In standard CI/testing, worker databases are leased from pre-allocated partition slot pools (`decision_os_test_slot_000` to `slot_255`), where per-database provisioning credentials (`decision_os_db_admin_slot_XXX`) were minted at cluster deployment initialization by an offline bootstrap container (`deploy/init-mongo-test.sh`).
     - **Partition Slot Custody Enforcement:** Slot credentials are held in an isolated **Partition Slot Vault** (`apps/slot-vault`) enforcing path-based ACLs (`secret/data/decision-os/slots/slot_${id}`). The central provisioner CANNOT retrieve slot credentials in bulk; it can lease exactly one slot at a time conditional on presenting an active lease token from `rs_coord:27019.ownership_locks`.
     - **Offline Bootstrap Destruction & Recovery Protocol:** Root bootstrap credentials exist strictly in volatile RAM/tmpfs and are destroyed via secure zeroization (`shred -u`) upon initialization completion. Emergency reconstruction requires an air-gapped Shamir secret sharing ceremony (2-of-3 SRE custodians).
     - **Isolated Ephemeral Credential Broker Enclave:** For dynamic unpooled databases, authority is minted on-demand via an **Isolated Ephemeral Credential Broker** (`apps/credential-broker`, identity `decision_os_credential_broker`) that validates an Ed25519-signed ownership claim, verifies target database naming against canonical test regex, and issues single-target credentials strictly scoped to `{ db: targetDb, collection: "" }` with a 60-second ephemeral TTL.
   - *Guarantee:* At runtime, **no central service possesses unrestricted `{ db: "", collection: "" }` user/role administration rights**, and no service can retrieve partition credentials in bulk. Compromise of the central provisioning service or one worker's scoped admin credential gives an attacker zero wire-level capability to create, read, modify, or revoke principals in another worker's database.

### 3.4 Evaluation of Revocation Responsibility & Coordination Models (Finding B38-27, B38-35)
To reconcile the contradiction where the executor was instructed to execute `dropUser` and `dropRole` while its privilege matrix strictly prohibited them, and to ensure physical network isolation is durably integrated, three coordination models were evaluated:

1. **Alternative 1: Monolithic Cleanup Executor with Native User/Role Drop Authority (REJECTED)**
   - *Mechanism:* Grant `dropUser` and `dropRole` on `{ db: "", collection: "" }` to `decision_os_destructive_executor` so it can execute teardown independently.
   - *Flaw:* Violates the strict separation of destructive and provisioning authority established in Phase B.5. Granting user and role administration rights to the destructive executor increases its privilege surface, creating another vector for cross-tenant principal tampering.
2. **Alternative 2: Cooperative Client-Side Revocation (REJECTED)**
   - *Mechanism:* Instruct the client driver to call `client.close(true)` and assume sessions and identities are revoked.
   - *Flaw:* Hostile or compromised workers intentionally retain TCP sockets and cached credentials, bypassing client-side teardown entirely. Revocation must be enforced server-side.
3. **Alternative 3: Coordinated Multi-Layer Revocation Protocol with Transport Fencing (SELECTED — Hardened in Phase B.7)**
   - *Mechanism:* Revocation responsibility is strictly partitioned across specialized infrastructure and database identities:
     - **Layer 1 (Network Transport Fencing):** Managed by the Network Fence Controller (`apps/network-fence-controller`, identity `decision_os_network_fence_controller`). Programmatically isolates worker container egress at the CNI/netfilter layer, dropping all packets destined for database ports 27018 and 27019.
     - **Layer 2 (Identity & Role Revocation):** Managed by the Scoped Provisioning Service authenticating as `decision_os_db_admin_${targetDb}`. It dispatches `dropUser` and `dropRole` directly on the target test database, triggering server-side daemon authorization cache invalidation.
     - **Layer 3 (In-Flight Operation, Session & Database Teardown):** Managed by the Destructive Cleanup Executor authenticating as `decision_os_destructive_executor`. It coordinates prepared transaction resolution (`inprog` on `{ cluster: true }`), executes `killOp` (`actions: ["killop"]` on `{ cluster: true }`), terminates logical sessions via `killAllSessionsByPattern`, and dispatches `{ dropDatabase: 1 }`.
   - *Guarantee:* Neither service exceeds its authorized MongoDB privilege matrix. Revocation is durable, idempotent, and verified server-side before database drop occurs. `dropDatabase` is never conflated with network transport fencing.

### 3.5 Evaluation of Cryptographic Nonce Uniqueness Strategies for AES-256-GCM (Finding B38-28, B38-32)
AES-256-GCM requires that an Initialization Vector (IV/nonce) must NEVER be repeated under the same key. A single nonce reuse completely compromises Galois/Counter Mode security:
1. **Alternative 1: In-Memory Monotonic Counter with 32-bit Random Salt (REJECTED — B38-28 Defect)**
   - *Mechanism:* Nonce constructed as `InstanceSalt (32-bit random) || MonotonicCounter (64-bit in-memory)`.
   - *Flaw:* Counter resets to 0 on restart. Under the birthday paradox, a 32-bit random salt incurs a 50% collision probability after only $2^{16} = 65,536$ process instances or replicas sharing the same encryption key. Upon collision, duplicate nonces are generated, completely breaking authenticity and confidentiality.
2. **Alternative 2: Pure 96-Bit Random Nonces (RBG-based NIST SP 800-38D Section 8.2.2) (EVALUATED & REJECTED AS PRIMARY)**
   - *Mechanism:* Generate 96 cryptographically secure random bits per encryption.
   - *Limitation:* NIST SP 800-38D Section 8.3 explicitly mandates:
     > *The total number of invocations of the authenticated encryption function shall not exceed $2^{32}$ for a given key, if the length of the IV is 96 bits and the IV is generated randomly.*
     At $2^{32}$ invocations, collision probability is approximately $2^{-33}$. While statistically low, it is a probabilistic bound rather than a deterministic mathematical guarantee. Furthermore, random generation cannot detect or prevent collisions across decoupled replicas under hypervisor freeze/resume or PRNG state cloning.
3. **Alternative 3: Durable Globally Coordinated Block Reservation with Decoupled Allocator Authority (SELECTED — Hardened in Phase B.7)**
   - *Mechanism:* Adheres strictly to **NIST SP 800-38D Section 8.2.1 Deterministic Construction**. Replicas dynamically lease disjoint blocks of counters ($2^{20} = 1,048,576$ nonces) via atomic `$inc` from a dedicated **Nonce Allocation Service** (`apps/nonce-allocator`, identity `decision_os_nonce_allocator`) on `rs_coord:27019` with majority write concern (`w: "majority", j: true`).
   - *Decoupled Authority & Reset Prevention (B38-32):* General provisioning service possesses zero write/update access to `nonce_allocations`. The Nonce Allocation Service code contains exclusively atomic `$inc` pathways and exposes no `$set` operations, preventing unauthorized counter resets.
   - *Crash & Restart Resilience:* Upon crash or restart, any unconsumed nonces in the current block are discarded. The restarted process leases a brand-new, strictly higher block. Replicas never rewind or share blocks.
   - *Explicit Trust Assumptions:* Nonce uniqueness holds under clearly specified trust assumptions: (1) Key custody integrity in KMS/Vault; (2) Consensus linearizability of majority journaled writes on `rs_coord:27019`; (3) Nonce Allocator service code integrity enforcing strictly monotonic `$inc`; (4) Mandatory KMS epoch bumping and key version increment upon cold database restores.

---

## 4. Selected Architecture and Rationale

### 4.1 Decision
The selected architecture for Decision OS Batch 4 V3.8 is **Option B: Dedicated Containerized Services with Physical Deployment Separation & Scoped Delegation**, deployed with:

1. **Physical / Logical Multi-Deployment Isolation (B38-20):**
   - **Coordination & Audit Deployment (`mongodb-coord:27019`):** Hosts `decision_os_coordination` (`ownership_locks`, `cleanup_ledger`, `provisioning_saga`, `nonce_allocations`) and `cleanup_audit_log`. Zero destructive credentials or routes exist on this cluster.
   - **Ephemeral Test Database Deployment (`mongodb-test:27018`):** Hosts dynamic test databases (`decision_os_test_*`).
2. **Decoupled Roles & Database-Scoped Provisioning Delegation (B38-24, B38-26, B38-31, B38-32):**
   - **Provisioning Service (`apps/provisioner`):** Identity `decision_os_provisioner`. Manages ownership leases and durable sagas on `mongodb-coord:27019`. Stripped of `{ db: "", collection: "" }` user/role administration rights on `rs_test` and stripped of write access to `nonce_allocations`.
   - **Nonce Allocation Service (`apps/nonce-allocator`):** Identity `decision_os_nonce_allocator`. Holds exclusive write authority on `decision_os_coordination.nonce_allocations` on `rs_coord:27019` (`find`, `insert`, `update`, `createIndex` only; NO `findAndModify` action). Leases counter blocks via atomic `$inc`.
   - **Partition Slot Vault (`apps/slot-vault`):** Manages pre-allocated partition credentials with path-based ACLs, preventing bulk retrieval.
   - **Ephemeral Credential Broker (`apps/credential-broker`):** Identity `decision_os_credential_broker` on `rs_test`. Generates scoped database administrators (`decision_os_db_admin_${dbName}`) with 60s TTL strictly for verified Ed25519-signed ownership claims. Zero cluster or coordination privileges.
   - **Scoped Database Provisioning Principals (`decision_os_db_admin_${dbName}`):** Ephemeral administrative credentials scoped strictly to `{ db: targetTestDb, collection: "" }`. Creates worker roles and users directly on the target test database namespace. Has zero capability to administer principals on other databases. Possesses zero destructive drop capability.
   - **Destructive Cleanup Executor (`apps/cleanup-executor`):** Identity `decision_os_destructive_executor`. Possesses `{ resource: { db: "", collection: "" }, actions: ["dropDatabase", "dropCollection", "listCollections", "find"] }` and `{ resource: { cluster: true }, actions: ["killop", "inprog", "killAnySession", "impersonate", "checkCursorSanity"] }` strictly on `mongodb-test:27018`. Possesses zero role-management privileges and zero user-creation/drop privileges (`createUser`, `createRole`, `dropUser`, `dropRole` are strictly forbidden). Zero access to `mongodb-coord:27019`.
   - **Audit Service (`apps/audit-service`):** Identity `decision_os_audit_writer`. Possesses strictly append-only privileges (`find`, `insert`, `createIndex`) on `cleanup_audit_log` on `mongodb-coord:27019`. Emits signed checkpoints to external WORM storage.
3. **Executable Coordinated Multi-Layer Worker Revocation (B38-25, B38-27, B38-35):**
   - Durable 3-phase revocation protocol coordinated across the Network Fence Controller, Scoped Provisioning Service, and Cleanup Executor.
   - **Layer 1 (Transport):** Network Fence Controller isolates worker pod/container network egress to ports 27018 and 27019 at the CNI/netfilter layer.
   - **Layer 2 (Identity):** Scoped Provisioner drops user and role directly on `targetTestDb` with majority write concern, invalidating the MongoDB daemon's internal authorization cache for lingering sockets.
   - **Layer 3 (Operations & Sessions):** Cleanup Executor inspects `currentOp` for prepared transactions (`inprog` on `{ cluster: true }`), coordinates abort if found, executes `killOp` (`actions: ["killop"]` on `{ cluster: true }`) against running worker operations, and terminates logical sessions via `killAllSessionsByPattern`.
   - Subsequent operations issued over lingering sockets retained by a hostile worker fail immediately at the netfilter layer or with Code 11 or Code 13 on subsequent wire operations. Fresh authentication attempts fail with Code 11 or Code 18.
   - Only after server-side revocation and network transport fencing are durably acknowledged does the Cleanup Executor dispatch `{ dropDatabase: 1 }`.
4. **Crash-Safe Credential Recovery & Durable Nonce Allocation (B38-17, B38-28, B38-32):**
   - Caller-bound encrypted envelope (`ownership_locks.credentialEnvelope`) utilizing AES-256-GCM.
   - NIST SP 800-38D Section 8.2.1 deterministic nonces leased atomically in blocks from dedicated `apps/nonce-allocator` with majority write concern. Nonce encoding: `KeyVersionPrefix (16 bits) || AllocatedRangeBlock (32 bits) || MonotonicCounter (48 bits)` = 96 bits.
   - Strict durable acknowledgement ordering before envelope destruction.
   - Exactly 12 fully formalized saga states with deterministic transition recovery and orphan reaper verification proof.
5. **Authoritative Oplog Evidence Protocol & Quarantine State Machine (B38-13, B38-16):**
   - Reconciling ambiguous outcomes requires cryptographically correlated drop comments and replica-set majority commitment proof $(t, ts)$ from `replSetGetStatus`.
   - Zero redispatch after `DISPATCHING`. Ambiguous drops remain permanently in `QUARANTINED` with execution locks indefinitely held.

### 4.2 Architectural Justification
1. **Mathematical Impossibility of Coordination Destruction (B38-20):**
   By physically isolating the coordination and audit collections on a separate MongoDB deployment (`mongodb-coord:27019`) to which the destructive executor has no network connectivity or credentials, the system eliminates reliance on application-level regex validation. Even if the cleanup executor is fully compromised and attempts `db.getSiblingDB("decision_os_coordination").dropDatabase()`, the command is executed against the test instance where the database does not exist, leaving production coordination and audit records completely untouched.
2. **Elimination of Cross-Database Privilege Escalation (B38-24, B38-26, B38-31):**
   By stripping the central provisioning service of `{ db: "", collection: "" }` user/role administration and delegating provisioning authority strictly to per-database scoped identities (`decision_os_db_admin_${dbName}`) or through a segregated Broker enclave validating signed ownership claims, MongoDB's RBAC engine natively enforces that each provisioning principal can only create, modify, or drop roles and users on its specific database. Even if a provisioning identity is compromised or an attacker subverts the provisioner container, MongoDB RBAC natively rejects cross-database principal manipulation with Error Code 13.
3. **Protection of Nonce Allocation Authority (B38-32):**
   Decoupling nonce allocation into an independent service running identity `decision_os_nonce_allocator` protects counter state from unauthorized reset. The general provisioner possesses zero write credentials on `nonce_allocations`. The allocator implementation uses strictly serialized `$inc` mutations with zero `$set` pathways, guaranteeing non-overlapping counter ranges across process crashes, restarts, and concurrent replicas under clearly stated trust assumptions.
4. **Internally Consistent, Non-Contradictory Revocation Execution (B38-27, B38-33, B38-35):**
   By establishing an explicit multi-layer protocol across the Network Fence Controller, Scoped Provisioner, and Cleanup Executor, every action is executed by an identity explicitly authorized in the MongoDB privilege matrix or infrastructure control plane. The executor never attempts `dropUser` or `dropRole` (actions it is forbidden to execute), while server-side user deletion, authorization cache invalidation, cluster-scoped operation cancellation (`killop`), session termination, and network transport fencing are guaranteed before physical database drop begins.
5. **Multi-Layer Defense Against Hostile Workers (B38-25, B38-35):**
   Client-side driver connection closure (`client.close(true)`) is treated as a cooperative convenience rather than a security boundary. Permanent revocation is enforced at multiple layers: transport-level network fencing drops wire packets, server-side `dropUser` invalidates authorization caches, and cluster-level `killop` aborts running queries. Commands issued over lingering TCP sockets fail authorization natively at the database wire protocol layer or are discarded at netfilter.
6. **Guaranteed Forward Secrecy & Crash Recovery (B38-17):**
   Storing ephemeral credentials in caller-bound AES-256-GCM encrypted envelopes guarantees that retrying workers receive deterministic credentials after executor crashes, without attempting to reverse SCRAM-SHA-256 verifiers. Enforcing exact durable majority acknowledgement before envelope deletion guarantees that credentials are never destroyed before the worker has safely activated.
7. **Deterministic Destruction Without Dual-Drop Danger:**
   Eliminating administrative redispatch guarantees that once `{ dropDatabase: 1 }` is transmitted across the wire, no subsequent or delayed drop command can ever execute against a reused or active database namespace.

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
POST /v1/ownership/activate
POST /v1/cleanup/request
POST /v1/cleanup/reconcile| mTLS
    end

    subgraph BootstrapAndBrokerSpace["Offline Bootstrap & Ephemeral Credential Broker Boundary"]
        OfflineBootstrap["Offline Bootstrap Container
(deploy/init-mongo-test.sh)
Identity: decision_os_offline_bootstrap
- Runs once at deployment initialization
- Mints Slot Pools & Init Schema
- Ephemeral Root Credentials (RAM Shred)"]
        SlotVault["Partition Slot Vault
(apps/slot-vault)
- Path-based ACL: secret/slots/slot_id
- Blocks Bulk Enumeration
- Single-Lease Token Verification"]
        CredentialBroker["Ephemeral Credential Broker
(apps/credential-broker)
Identity: decision_os_credential_broker
- Segregated Enclave
- Validates Signed Ownership Claim
- Mints decision_os_db_admin_targetDb
- 60s Ephemeral TTL
- Zero Coord/Cluster Rights"]
    end

    subgraph ProvisioningServiceSpace["Dedicated Provisioning Service Boundary (apps/provisioner)"]
        mTLS --> ProvisionerAPI["Provisioning Engine & Authn Validator
(Binds Ed25519 Public Key to Worker ID)"]
        ProvisionerAPI --> SagaManager["Durable 12-State Provisioning Saga Manager
(Generates Ephemeral Credentials & Envelopes)"]
        SagaManager --> ScopedRoleEngine["Scoped Role & User Engine
(Database-Scoped Delegation Model)
*NO dropDatabase or Cluster Rights!*"]
        ScopedRoleEngine --> ProvisionerPoolTest["Scoped Provisioner Test Pool
(Identity: decision_os_db_admin_targetDb)
*Scoped STRICTLY to target DB; NO cross-db rights!*"]
        SagaManager --> ProvisionerPoolCoord["Provisioner Coord Pool
(Identity: decision_os_provisioner)
*Zero Write to nonce_allocations!*"]
        ScopedRoleEngine -.->|Lease Single Slot| SlotVault
        ScopedRoleEngine -.->|Mint Dynamic Admin| CredentialBroker
    end

    subgraph NonceAllocatorSpace["Dedicated Nonce Allocation Service Boundary (apps/nonce-allocator)"]
        SagaManager -->|mTLS: POST /v1/nonce/lease-block| NonceAllocatorAPI["Nonce Allocator Engine & API
(Enforces Monotonic Block Leases via $inc)
*NO $set code paths!*"]
        NonceAllocatorAPI --> NonceAllocatorPoolCoord["Nonce Allocator Coord Pool
(Identity: decision_os_nonce_allocator)
*Exclusive $inc Write Authority on nonce_allocations!*"]
    end

    subgraph NetworkFencingSpace["Container Orchestrator & CNI Network Fencing Boundary"]
        NetFenceController["Network Fence Controller
(apps/network-fence-controller)
Identity: decision_os_network_fence_controller
- CNI / Kubernetes NetworkPolicy / Linux Netfilter
- Isolates Worker Pod Egress to Ports 27018 & 27019
- Synchronous Netfilter Verification"]
    end

    subgraph DestructiveExecutorSpace["Dedicated Destructive Cleanup Service Boundary (apps/cleanup-executor)"]
        mTLS --> CleanupValidator["Cleanup Request Validator
(Verifies Signed Request & Ownership Lease)"]
        CleanupValidator --> StateMachineEngine["Durable State Machine Engine
(Authoritative Sole Writer of cleanup_ledger)"]
        StateMachineEngine --> RevocationCoordinator["Coordinated Revocation Client
(Coordinates Multi-Layer Revocation)"]
        RevocationCoordinator -->|Step 2: POST /v1/orchestrator/fence-worker| NetFenceController
        RevocationCoordinator -->|Step 3: POST /v1/provisioning/revoke-worker| ProvisionerAPI
        StateMachineEngine --> DropEngine["Destructive Drop Engine
*ONLY Production Allowlisted Drop Site*
*Dispatches { dropDatabase: 1, comment: ... }*"]
        DropEngine --> DestructivePoolTest["Destructive MongoDB Pool
(Identity: decision_os_destructive_executor)
*Zero dropUser/dropRole/userAdmin rights!*"]
        StateMachineEngine --> AuditWriterClient["Audit Client"]
    end

    subgraph AuditServiceSpace["Dedicated Audit Boundary (apps/audit-service)"]
        AuditWriterClient --> AuditWriterEngine["Tamper-Evident Audit Writer
(SHA-256 Hash Chaining)"]
        AuditWriterEngine --> AuditPoolCoord["Audit MongoDB Pool
(Identity: decision_os_audit_writer)
*Strictly Append-Only: find, insert, createIndex*"]
        AuditWriterEngine --> CheckpointEngine["Signed Audit Checkpoint Generator
(60s Cadence / Terminal Milestones)"]
        CheckpointEngine --> ExternalWORM[("External WORM / Cloud Storage
Object Lock / append-only filesystem")]
    end

    subgraph CoordCluster["MongoDB Coordination & Audit Deployment (rs_coord :27019)"]
        ProvisionerPoolCoord -->|Manage Saga & Locks| CoordDB[("decision_os_coordination
- ownership_locks
- provisioning_saga
- cleanup_ledger")]
        NonceAllocatorPoolCoord -->|Monotonic Range Leases ($inc)| NonceColl[("nonce_allocations
*Protected Sequence State*")]
        AuditPoolCoord -->|Append-Only Writes| AuditLogColl[("cleanup_audit_log
*Zero Update / Remove / Drop*")]
    end

    subgraph TestCluster["MongoDB Ephemeral Test Database Deployment (rs_test :27018)"]
        OfflineBootstrap -.->|Init Pre-Allocated Slots| TestDBAuth
        CredentialBroker -.->|Mint Scoped Admin| TestDBAuth
        ProvisionerPoolTest -->|Scoped Role & User Admin on Target DB ONLY| TestDBAuth[("Target Test DB Catalog
- Scoped Admin: decision_os_db_admin_targetDb
- Scoped Dynamic Role: worker_access_role
- Ephemeral Worker Principal")]
        DestructivePoolTest -->|Drop Ephemeral Test DBs ONLY| TargetDBs[("Test Databases
- decision_os_test_runA_wA
- decision_os_test_runB_wB")]
        DestructivePoolTest -->|Session, Op & Tx Termination| ClusterRes[("Cluster Resource
- currentOp (inprog for prepared tx)
- killOp (killop on cluster: true)
- killAllSessionsByPattern")]

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

        PoolA -.->|BLOCKED BY RBAC: Code 13 on DB B| TargetDBB
        PoolB -.->|BLOCKED BY RBAC: Code 13 on DB A| TargetDBA
        PoolA -.->|BLOCKED BY RBAC: Code 13 on dropDatabase| TargetDBs
    end

    DestructivePoolTest -.->|PHYSICALLY BLOCKED: Zero Network Route & No Credentials| CoordCluster
    PoolA -.->|PHYSICALLY BLOCKED: Zero Network Route & No Credentials| CoordCluster
    PoolB -.->|PHYSICALLY BLOCKED: Zero Network Route & No Credentials| CoordCluster
    NetFenceController -.->|NETFILTER BLOCK: Drops Worker Egress Packets| PoolA

    classDef unprivileged fill:#f9d5e5,stroke:#eeac99,stroke-width:2px;
    classDef boundary fill:#eeeeee,stroke:#cccccc,stroke-width:2px;
    classDef privileged fill:#d5e8d4,stroke:#82b366,stroke-width:2px;
    classDef database fill:#dae8fc,stroke:#6c8ebf,stroke-width:2px;
    classDef external fill:#fff2cc,stroke:#d6b656,stroke-width:2px;

    class WorkerA,WorkerB,BenchmarkCLI,ClientProxy,PoolA,PoolB unprivileged;
    class mTLS,ProvisionerAPI,CleanupValidator,SecurityBoundary,SlotVault boundary;
    class SagaManager,ScopedRoleEngine,ProvisionerPoolTest,ProvisionerPoolCoord,StateMachineEngine,RevocationCoordinator,DropEngine,DestructivePoolTest,AuditWriterEngine,AuditPoolCoord,CheckpointEngine,NonceAllocatorAPI,NonceAllocatorPoolCoord,NetFenceController,OfflineBootstrap,CredentialBroker privileged;
    class CoordDB,NonceColl,AuditLogColl,TestDBAuth,TargetDBs,TargetDBA,TargetDBB,ClusterRes database;
    class ExternalWORM external;
```

---

## 6. Trust Boundaries and Credential-Flow Diagram

```mermaid
sequenceDiagram
    autonumber
    participant WorkerA as Worker A (Hostile/Test)
    participant Client as CleanupExecutorClient
    participant Provisioner as Provisioning Service (apps/provisioner)
    participant NonceService as Nonce Allocator (apps/nonce-allocator)
    participant Broker as Credential Broker / Slot Vault
    participant NetFence as Network Fence Controller
    participant Executor as Destructive Cleanup Executor (apps/cleanup-executor)
    participant CoordDB as MongoDB: rs_coord (:27019)
    participant TestDB as MongoDB: rs_test (:27018)
    participant AuditService as Audit Service / WORM Storage

    Note over WorkerA,TestDB: PHASE 1: DIRECT ADVERSARIAL ATTACKS BLOCKED NATIVELY
    WorkerA->>TestDB: db.runCommand({ dropDatabase: 1 })
    TestDB-->>WorkerA: MongoServerError: not authorized to execute { dropDatabase: 1 } (Code 13)
    WorkerA->>CoordDB: TCP SYN to Port 27019 (Attempt direct coordination tampering)
    CoordDB-->>WorkerA: Connection Refused (Network Policy / Firewall Blocked)

    Note over WorkerA,TestDB: PHASE 2: CONSTRAINED PROVISIONING SAGA WITH NONCE & SCOPED DELEGATION (B38-24, B38-26, B38-31, B38-32)
    WorkerA->>Client: claimTestDatabaseOwnership("decision_os_test_runA_wA", "runA", "wA")
    Client->>Client: Sign claim payload using Worker A Ed25519 Private Key
    Client->>Provisioner: POST /v1/ownership/claim (Payload + Ed25519 Signature)
    Provisioner->>Provisioner: Verify Signature, Caller ID "runA:wA", DB Naming Contract
    Provisioner->>CoordDB: Persist Saga CLAIM_PENDING in ownership_locks & provisioning_saga (w: majority)
    
    Note over Provisioner,NonceService: Lease Monotonic Counter Block via Dedicated Nonce Allocator
    Provisioner->>NonceService: POST /v1/nonce/lease-block (Signed mTLS Request)
    NonceService->>CoordDB: findOneAndUpdate({ _id: "nonce_seq_v1" }, { $inc: { nextBlockStart: BLOCK_SIZE } }) (w: majority, j: true)
    CoordDB-->>NonceService: Nonce Block Range Leased [blockStart, blockEnd)
    NonceService-->>Provisioner: Leased Block Range { blockStart, blockSize, keyVersion }

    Note over Provisioner,Broker: Acquire Scoped Admin: Slot Vault (Tier 1) or Credential Broker (Tier 2)
    Provisioner->>Broker: Acquire Scoped Admin Credential (Signed Claim Verification)
    Broker-->>Provisioner: decision_os_db_admin_runA_wA Credentials (TTL: 60s)

    Note over Provisioner,TestDB: Connect using Scoped DB Admin (decision_os_db_admin_runA_wA) scoped strictly to DB A:
    Provisioner->>TestDB: db.getSiblingDB("decision_os_test_runA_wA").createRole({ role: "workerRole", privileges: [CRUD on self] })
    Provisioner->>TestDB: db.getSiblingDB("decision_os_test_runA_wA").createUser({ user: "decision_os_worker_runA_wA", pwd: pwdA, roles: ["workerRole"] })
    Provisioner->>CoordDB: Persist AES-256-GCM envelope (Deterministic Nonce from leased block) in ownership_locks (w: majority)
    Provisioner->>AuditService: Append Audit Event: USER_PROVISIONED (SHA-256 Chained)
    Provisioner-->>Client: HTTP 200 OK { user, pwdA, authSource: "decision_os_test_runA_wA" }

    Note over WorkerA,CoordDB: PHASE 3: DURABLE ACKNOWLEDGEMENT ORDERING (B38-17)
    Client->>TestDB: Connect PoolA & execute { ping: 1 } (Authentication Verified)
    TestDB-->>Client: { ok: 1 }
    Client->>Provisioner: POST /v1/ownership/activate (Signed activation handshake)
    Provisioner->>CoordDB: Commit state ACTIVATED (w: majority, j: true)
    Provisioner->>CoordDB: Atomic $unset: { credentialEnvelope: 1 } (w: majority)
    Provisioner-->>Client: HTTP 200 OK { status: 'ACTIVATED' }

    Note over WorkerA,TestDB: PHASE 4: CROSS-DATABASE ISOLATION NATIVELY ENFORCED (B38-11, B38-26)
    WorkerA->>TestDB: PoolA.db("decision_os_test_runB_wB").collection("data").find()
    TestDB-->>WorkerA: MongoServerError: not authorized on decision_os_test_runB_wB (Code 13)

    Note over WorkerA,TestDB: PHASE 5: RECONCILED COORDINATED WORKER REVOCATION & TRANSPORT FENCING (B38-25, B38-27, B38-33, B38-35)
    WorkerA->>Client: cleanupTestDatabase("decision_os_test_runA_wA", "runA", "wA")
    Client->>Executor: POST /v1/cleanup/request (Signed Cleanup Order)
    Executor->>CoordDB: Verify Ownership Lease, Mark CLAIMED in cleanup_ledger (w: majority)
    
    Note over Executor,NetFence: Step 5a: Network Transport Fencing via CNI / Netfilter
    Executor->>NetFence: POST /v1/orchestrator/fence-worker (Isolate Worker A Pod Egress)
    NetFence->>NetFence: Apply Linux Netfilter / Kubernetes NetworkPolicy Egress Drop
    NetFence-->>Executor: HTTP 200 OK { fenced: true, netfilterVerified: true }

    Note over Executor,Provisioner: Step 5b: Coordinated Revocation Handoff to Scoped Provisioner
    Executor->>Provisioner: POST /v1/provisioning/revoke-worker (Signed Revocation Order targeting DB A)
    Provisioner->>Provisioner: Authenticate order; bind to decision_os_db_admin_runA_wA
    Provisioner->>TestDB: db.getSiblingDB("decision_os_test_runA_wA").dropUser("decision_os_worker_runA_wA") (w: majority)
    Provisioner->>TestDB: db.getSiblingDB("decision_os_test_runA_wA").dropRole("workerRole") (w: majority)
    Provisioner->>CoordDB: Mark ownership_locks.state = 'REVOKED' (w: majority)
    Provisioner-->>Executor: HTTP 200 OK { userDropped: true, roleDropped: true }
    
    Note over Executor,TestDB: Step 5c: Session & Operation Cancellation via Destructive Executor
    Executor->>TestDB: db.adminCommand({ currentOp: 1, "command.user": "decision_os_worker_runA_wA", "preparedTransaction": true }) (action: inprog on cluster)
    Note over Executor,TestDB: If prepared transactions detected, coordinate coordinator abort before proceeding
    Executor->>TestDB: db.adminCommand({ killOp: 1, query: { "command.user": "decision_os_worker_runA_wA" } }) (action: killop on cluster)
    Executor->>TestDB: db.adminCommand({ killAllSessionsByPattern: [{ users: [{ user: "decision_os_worker_runA_wA", db: "decision_os_test_runA_wA" }] }] }) (actions: killAnySession, impersonate on cluster)

    Note over WorkerA,TestDB: Hostile Worker retains open TCP sockets and sends write operations:
    WorkerA->>TestDB: PoolA.collection("data").insertOne({ hostile: true }) over lingering socket
    TestDB--xWorkerA: Dropped by Netfilter / MongoServerError: UserNotFound / Unauthorized (Code 11 / Code 13)
    WorkerA->>TestDB: PoolA attempts fresh SCRAM authentication with old password
    TestDB--xWorkerA: Dropped by Netfilter / MongoServerError: AuthenticationFailed / UserNotFound (Code 18 / Code 11)

    Note over Executor,CoordDB: PHASE 6: DESTRUCTIVE CLEANUP ON TEST DB ONLY (B38-20)
    Executor->>CoordDB: Mark DISPATCHING in cleanup_ledger (dropExecutionLock = true, w: majority)
    Executor->>TestDB: db.runCommand({ dropDatabase: 1, comment: JSON.stringify({ requestId, runA, wA }) })
    TestDB-->>Executor: { ok: 1, dropped: "decision_os_test_runA_wA" }
    Executor->>CoordDB: Mark CLEANED in cleanup_ledger (dropExecutionLock = false, w: majority)
    Executor->>AuditService: Append Audit Event: DB_CLEANED (SHA-256 Chained)
    AuditService->>AuditService: Generate Ed25519 Signed Checkpoint -> Emit to WORM
    Executor-->>Client: HTTP 200 OK { status: 'CLEANED' }

    Note over Executor,CoordDB: PHASE 7: ADVERSARIAL ATTEMPT TO DROP COORDINATION STORAGE (B38-20)
    Note over Executor: Compromised Executor attempts db.getSiblingDB("decision_os_coordination").dropDatabase()
    Executor->>TestDB: db.runCommand({ dropDatabase: 1 }) on decision_os_coordination
    TestDB-->>Executor: { ok: 1, dropped: 0 } (No-op; DB never existed on rs_test)
    Executor->>CoordDB: Attempt direct wire command to rs_coord (:27019)
    CoordDB-->>Executor: Connection Refused (Zero network routing, egress blocked, zero credentials)
```

---

## 7. MongoDB Privilege Matrix

### 7.1 Mathematical Flaw of Additive Roles in MongoDB (B38-02, B38-03)
MongoDB 8.0 RBAC enforces privileges through **strict additive set union**:
$$\\text{EffectivePrivileges}(U) = \\bigcup_{R \\in \\text{InheritedRoles}(U)} \\text{Privileges}(R)$$

MongoDB custom roles and built-in roles:
1. **Do not support `deny` rules.**
2. **Do not support privilege subtraction or negative filters.**
3. **Do not evaluate role precedence or specificity overrides.**

In the legacy design, granting `{ db: "", collection: "" }` with write actions alongside a read-only grant `{ db: "decision_os_coordination", collection: "ownership_locks", actions: ["find"] }` resulted in a pure union: write capabilities on coordination metadata remained active.

### 7.2 Flaw of Shared MongoDB Worker User (Finding B38-11)
In MongoDB, privileges are associated with the **authenticated MongoDB user**, not the application-layer process or Ed25519 signing key. When multiple test workers authenticate as a shared user (`decision_os_app_worker`):
$$\\text{Privileges}(\\text{decision\\_os\\_app\\_worker}) = \\text{BaseRole} \\cup \\text{Role}_{\\text{Run A}} \\cup \\text{Role}_{\\text{Run B}} \\cup \\dots$$
Once dynamic roles for concurrent runs are granted to a shared user, Worker A immediately inherits write access to Worker B's database over its existing connection. **Conclusion:** Every worker must have an independent, distinct MongoDB authentication principal.

### 7.3 Flaw of Unsafe Role-Management Privileges & Cluster-Wide Grants (Finding B38-12, B38-24)
In v1.4.0, the cleanup executor was granted `createRole`, `createUser`, `grantRole`, and `dropUser` on the `admin` database. The design claimed that application-level AST validation in `provisioner.ts` prevented creating cluster-wide or superuser roles.

#### Why Application AST Validation is NOT MongoDB-Native RBAC Enforcement:
1. In MongoDB RBAC, any custom role defined on the `admin` database is permitted to grant privileges on **any database across the deployment** and on **cluster-wide resources** (`{ cluster: true }`).
2. An identity holding `createRole` on `admin` possesses the database-level wire authority to issue:
   ```javascript
   db.getSiblingDB("admin").createRole({
     role: "malicious_role",
     privileges: [{ resource: { anyResource: true }, actions: ["anyAction"] }],
     roles: ["root"]
   });
   ```
3. Application-level JavaScript regex or AST inspection in `provisioner.ts` operates entirely in application memory. If the provisioner service is compromised, contains an injection vulnerability, or experiences logic bugs, MongoDB's authorization engine will not reject cluster-wide role definitions submitted by an identity with `createRole` on `admin`.
4. **Remediation:** Decision OS formally rejects the claim that application validation constitutes MongoDB-native enforcement. Provisioning authority is decoupled from destructive execution and constrained via native database-scoping boundaries (Section 7.5).

---

### 7.4 Multi-Deployment Architecture: Separation of Destructive Authority from Coordination & Audit Data (Finding B38-20)

#### 1. Analysis of Destructive Authority Risk
The v1.4.0 cleanup executor role contained:
```javascript
{
  resource: { db: "", collection: "" },
  actions: [ "dropDatabase", "dropCollection", "listCollections", "find" ]
}
```
In MongoDB RBAC, the resource `{ db: "", collection: "" }` applies to **all non-system databases across the entire MongoDB instance**.
If `decision_os_coordination` and `cleanup_audit_log` reside on the same deployment as ephemeral test databases, an identity holding this privilege possesses wire-level authorization to drop coordination locks, the request ledger, the provisioning saga, and the audit log itself.

#### 2. Proof That Single-Deployment RBAC Cannot Enforce Test-Only Dropping
- **Premise 1:** Test databases have dynamic names (`decision_os_test_${runId}_${workerId}`).
- **Premise 2:** MongoDB RBAC does not support database name wildcard expressions (e.g. `decision_os_test_*`). Passing a wildcard string treats it literally as a database name.
- **Premise 3:** MongoDB RBAC does not support `deny` rules or negative exclusions (e.g. "all databases except `decision_os_coordination`").
- **Deduction:** To allow an identity to drop dynamically named test databases without pre-provisioning individual drop roles prior to database creation, that identity must possess `{ db: "", collection: "" }` with `dropDatabase`.
- **Theorem:** On a single MongoDB deployment containing both test databases and coordination/audit databases, **it is mathematically impossible using MongoDB native RBAC to grant arbitrary test database drop capabilities while preventing the drop of coordination and audit databases**.
- **Conclusion:** Security cannot be guaranteed on a single deployment without relying on application regex checks. Therefore, a physical/logical multi-deployment boundary is mandatory.

#### 3. Selected Two-Deployment Isolation Architecture
Decision OS establishes two physically and logically independent MongoDB replica set deployments:
1. **Coordination & Audit Deployment (`rs_coord`, Host: `mongodb-coord`, Port: 27019):**
   - Houses `decision_os_coordination` (`ownership_locks`, `cleanup_ledger`, `provisioning_saga`) and `cleanup_audit_log`.
   - **Access Restrictions:** Only the Provisioning Service (`decision_os_provisioner`) and Audit Service (`decision_os_audit_writer`) possess network reachability and credentials.
   - **Destructive Identity Boundary:** The Destructive Cleanup Executor (`decision_os_destructive_executor`) has **ZERO network route** and **ZERO credentials** on this cluster.
2. **Ephemeral Test Database Deployment (`rs_test`, Host: `mongodb-test`, Port: 27018):**
   - Houses dynamic test databases (`decision_os_test_*`) and benchmark databases.
   - The Destructive Cleanup Executor possesses `{ resource: { db: "", collection: "" }, actions: ["dropDatabase", ...] }` strictly on this cluster.
   - **Coordination Isolation Guarantee:** Because `decision_os_coordination` and `cleanup_audit_log` **do not exist in the storage catalog of `mongodb-test`**, destructive operations executed against `rs_test` cannot destroy or modify coordination or audit data under any circumstances.

---

### 7.5 Constrained Role Provisioning Architecture & Elimination of Cross-Database Authority (Finding B38-24, B38-26, B38-31)

#### 1. Separation of Provisioning Service from Cleanup Executor
- **Provisioning Service (`apps/provisioner`):** A dedicated containerized service running under identity `decision_os_provisioner`. It manages ownership claims, saga transitions, and cryptographic envelopes on `mongodb-coord:27019`. It possesses **ZERO destructive drop privileges** (`dropDatabase` and `dropCollection` are strictly denied by MongoDB RBAC).
- **Destructive Cleanup Executor (`apps/cleanup-executor`):** A separate containerized service running under identity `decision_os_destructive_executor`. It receives verified cleanup requests and executes database drops on `mongodb-test:27018`. It possesses **ZERO role-creation, user-creation, or credential-generation privileges** (`createRole`, `createUser`, `dropRole`, `dropUser` are strictly denied by MongoDB RBAC).

#### 2. The Fallacy of Claiming Non-Admin Role Creation Solves Cross-Database Authority (Finding B38-26)
In v1.5.0, the architecture argued that because dynamic worker roles are created on a non-admin database namespace (`targetTestDb`), MongoDB natively prohibits those roles from granting privileges on other databases.
**This argument addresses only the created role's scope, NOT the provisioner's management authorization scope:**
- The v1.5.0 privilege matrix granted `decision_os_provisioner` the actions `createRole`, `dropRole`, `createUser`, `dropUser`, `grantRole`, `revokeRole`, and `changePassword` on resource `{ db: "", collection: "" }` on `rs_test`.
- In MongoDB RBAC, `{ db: "", collection: "" }` covers **every non-system database across the entire replica set**.
- An attacker compromising `decision_os_provisioner` could not grant cluster-wide privileges in the dynamic role itself, but could execute administrative commands against **any and all worker databases**:
  ```javascript
  // Compromised provisioner attacking Worker B's database while ostensibly servicing Worker A:
  db.getSiblingDB("decision_os_test_runB_wB").dropUser("decision_os_worker_runB_wB");
  db.getSiblingDB("decision_os_test_runB_wB").createUser({
    user: "backdoor_admin",
    pwd: "attackerPassword",
    roles: [{ role: "worker_access_role", db: "decision_os_test_runB_wB" }]
  });
  ```
- **Architectural Tenet:** Creating roles on non-admin databases does **NOT** solve the provisioner's cross-database authority defect. Cross-database user and role administration must be eliminated from the central provisioning identity.

#### 3. Formal Distinction of the Four Authorization Scopes
To prevent ambiguity and privilege conflation, Decision OS formally distinguishes four separate scoping boundaries in MongoDB RBAC:

1. **Role-Definition Scope:**
   - *Definition:* The resource targets and actions that may be included *inside* a custom role's privilege document.
   - *Engine Constraint:* In MongoDB, for any role defined on a non-admin database $D$, the role-definition scope is strictly restricted to database $D$. It cannot include `{ db: "", collection: "" }`, `{ cluster: true }`, or any database $D' 
e D$.
2. **Role-Management Authorization Scope:**
   - *Definition:* The database resource on which an identity is permitted to execute role-management commands (`createRole`, `dropRole`, `updateRole`, `grantPrivilegesToRole`, `revokePrivilegesFromRole`).
   - *Engine Constraint:* An identity authorized on `{ db: D, collection: "" }` can only create, alter, or drop roles *defined on database $D$*. Granting `{ db: "", collection: "" }` allows managing roles across all non-system databases.
3. **User-Management Authorization Scope:**
   - *Definition:* The database resource on which an identity is permitted to execute user-management commands (`createUser`, `dropUser`, `updateUser`, `changePassword`).
   - *Engine Constraint:* An identity authorized on `{ db: D, collection: "" }` can only create, alter, or delete users *stored in database $D$* (`authSource=D`). It cannot manipulate users stored in database $D'$.
4. **Role-Grant Authorization Scope:**
   - *Definition:* The set of roles that an identity is authorized to assign or revoke from users via `grantRolesToUser` or `revokeRolesFromUser`.
   - *Engine Constraint:* An identity authorized on `{ db: D, collection: "" }` can only assign roles defined on database $D$.

#### 4. The Database-Scoped Provisioning Delegation Model (Finding B38-26, B38-31)
To satisfy least-privilege isolation without granting central unrestricted database-wide administration:

1. **Complete Removal of `{ db: "", collection: "" }` from Central Provisioner:**
   The central identity `decision_os_provisioner` has **zero** user-management, role-management, and role-grant privileges on `rs_test`. It cannot execute `createUser`, `createRole`, `dropUser`, or `dropRole` on any database on `rs_test`.
2. **Scoped Administrative Principals (`decision_os_db_admin_${dbName}`):**
   Role and user administration on `rs_test` is mediated strictly through per-target-database scoped administrative identities:
   - Resource Scope: strictly `{ db: targetTestDb, collection: "" }`.
   - Actions: `createRole`, `dropRole`, `createUser`, `dropUser`, `grantRole`, `revokeRole`, `changePassword`, `getRole`, `getUser`.
   - Authorization Scope: strictly confined to that single database namespace.
3. **Tier 1 — Leased Partition Pools & Partition Slot Vault (Primary CI & Test Harness Path):**
   - **Pre-Allocation via Offline Bootstrap:** During cluster deployment initialization, an ephemeral offline container (`deploy/init-mongo-test.sh`) running identity `decision_os_offline_bootstrap` pre-allocates dedicated partition slot databases (`decision_os_test_slot_000` through `slot_255`) on `rs_test:27018`.
   - For each partition slot $k$, it creates a scoped role and administrator `decision_os_db_admin_slot_${k}` authorized exclusively on `{ db: "decision_os_test_slot_" + k, collection: "" }`.
   - **Offline Bootstrap Credential Destruction Protocol:** Root administrative credentials required for initialization are generated in tmpfs (`/tmp/bootstrap_admin.key`). Upon successful creation of slot databases and roles, the initialization container securely shreds the credential file (`shred -u -z /tmp/bootstrap_admin.key`), verifies file zeroization, and permanently terminates. The bootstrap identity never runs in an active online container.
   - **Emergency Recovery Protocol:** If cluster metadata is lost or corrupted, an air-gapped break-glass procedure requires an offline Shamir's Secret Sharing ceremony (2-of-3 designated SRE key custodians) to launch a temporary maintenance pod with full session audit logging.
   - **Partition Slot Custody & Bulk-Retrieval Prevention:** Slot credentials are held in a dedicated **Partition Slot Vault** (`apps/slot-vault` or HashiCorp Vault KV). The vault enforces strict path-based ACLs (`path "secret/data/decision-os/slots/slot_${id}"`). The central provisioner cannot list or enumerate slot secrets in bulk (`list` capability is denied by policy). To lease a slot, the provisioner presents a cryptographically signed lease token corresponding to an active lease acquired in `rs_coord:27019.ownership_locks`. The vault releases only that single slot's credentials with a 60-second TTL. The provisioner holds at most the actively leased slot credentials in volatile RAM, scrubbing them immediately upon lease release or teardown.
4. **Tier 2 — Isolated Ephemeral Credential Broker (Dynamic On-Demand Expansion Path):**
   When an unpooled dynamic database (`decision_os_test_${runId}_${workerId}`) is required:
   - **Segregated Enclave Execution:** Minting authority is isolated in a dedicated service enclave (`apps/credential-broker`) running under identity `decision_os_credential_broker` on `rs_test:27018`.
   - **Exact MongoDB Privilege Scope:** The broker holds `{ resource: { db: "", collection: "" }, actions: ["createUser", "dropUser", "createRole", "dropRole", "grantRole", "revokeRole", "changePassword", "getRole", "getUser"] }`. It possesses **ZERO cluster privileges**, **ZERO dropDatabase/dropCollection privileges**, and **ZERO access to `admin`, `config`, or `local` system namespaces**. It has zero network routes and zero credentials for `rs_coord:27019`.
   - **Signed Ownership Claim Validation:** The broker exposes a single hardened endpoint `POST /v1/broker/mint-scoped-admin`. To request a scoped admin credential, the caller (Provisioning Service) must submit an Ed25519-signed ownership claim containing: `requestId`, `targetDatabase`, `runId`, `workerId`, and `leaseExpiresAt`.
   - The broker cryptographically verifies the provisioner's signature against the provisioner's registered public key.
   - The broker verifies that `targetDatabase` strictly matches the canonical test namespace regex: `^decision_os_test_[a-zA-Z0-9_-]+$`.
   - **Authority Binding to Single Target Database:** The broker creates user `decision_os_db_admin_${targetDatabase}` stored on `targetDatabase` (`authSource = targetDatabase`), with privileges strictly constrained to `{ db: targetDatabase, collection: "" }`.
   - **Delivery, Expiration, Rotation, Revocation, and Audit Lifecycle:**
     - The generated 32-byte cryptographically secure random password is delivered to the provisioner exclusively over mTLS.
     - **Expiration:** Credential TTL is strictly 60 seconds (ephemeral).
     - **Rotation:** If a lease is extended, the broker rotates the password via `updateUser`.
     - **Revocation:** During teardown, the scoped user is deleted via `dropUser`.
     - **Audit:** Every credential minting event is written to `cleanup_audit_log` with SHA-256 chaining.

#### 5. Concrete Negative Authorization Cases (B38-26, B38-31)
MongoDB RBAC natively enforces the following negative authorization boundaries on `rs_test:27018`:

1. **Central Provisioner Direct User/Role Creation (NC-1):**
   - `decision_os_provisioner` executes `db.getSiblingDB("decision_os_test_runA_wA").createRole(...)`
   - *Result:* `MongoServerError: not authorized on decision_os_test_runA_wA to execute command { createRole: ... }` (Error Code 13).
2. **Cross-Database Scoped Identity Attack (User Manipulation) (NC-2):**
   - Compromised `decision_os_db_admin_runA_wA` executes `db.getSiblingDB("decision_os_test_runB_wB").createUser(...)`
   - *Result:* `MongoServerError: not authorized on decision_os_test_runB_wB to execute command { createUser: ... }` (Error Code 13).
3. **Cross-Database Scoped Identity Attack (Password Modification) (NC-3):**
   - Compromised `decision_os_db_admin_runA_wA` executes `db.getSiblingDB("decision_os_test_runB_wB").changeUserPassword(...)`
   - *Result:* `MongoServerError: not authorized on decision_os_test_runB_wB to execute command { updateUser: ... }` (Error Code 13).
4. **Cross-Database Role Definition Attempt (NC-4):**
   - Compromised `decision_os_db_admin_runA_wA` attempts to define a role on `decision_os_test_runA_wA` containing privileges on `decision_os_test_runB_wB`:
     ```javascript
     db.getSiblingDB("decision_os_test_runA_wA").createRole({
       role: "illegal_cross_role",
       privileges: [{ resource: { db: "decision_os_test_runB_wB", collection: "" }, actions: ["find"] }],
       roles: []
     });
     ```
   - *Result:* `MongoServerError: Cannot grant privileges on other databases for a role defined on a non-admin database`.
5. **Scoped Identity Destructive Escalation (NC-5):**
   - Compromised `decision_os_db_admin_runA_wA` attempts `db.getSiblingDB("decision_os_test_runA_wA").dropDatabase()`
   - *Result:* `MongoServerError: not authorized on decision_os_test_runA_wA to execute command { dropDatabase: 1 }` (Error Code 13).
6. **Compromised Broker Destructive Escalation (NC-6):**
   - Compromised `decision_os_credential_broker` attempts `db.getSiblingDB("decision_os_test_runA_wA").dropDatabase()`
   - *Result:* `MongoServerError: not authorized on decision_os_test_runA_wA to execute command { dropDatabase: 1 }` (Error Code 13).
7. **Compromised Broker System DB Escalation (NC-7):**
   - Compromised `decision_os_credential_broker` attempts `db.getSiblingDB("admin").createUser(...)`
   - *Result:* `MongoServerError: not authorized on admin to execute command { createUser: ... }` (Error Code 13; broker privileges restricted to `{ db: "", collection: "" }` which excludes system databases).
8. **Provisioner Bulk Slot Enumeration Attempt (NC-8):**
   - Compromised `decision_os_provisioner` attempts `vault.list("secret/metadata/decision-os/slots")`
   - *Result:* `VaultError: 403 permission denied (path-based ACL denies list capability)`.

---

### 7.6 Exact Privilege Matrix by Identity & Deployment

The following matrix formally specifies permissions for every principal across both MongoDB deployments, reconciling every assigned command with native database RBAC and correcting all action names and scopes:

| Identity Principal | Target Deployment | Resource Scope | Permitted Actions | Explicitly Prohibited Actions | Enforcement Mechanism |
|---|---|---|---|---|---|
| **`decision_os_destructive_executor`** | **`rs_test` (`:27018`)** | `{ db: "", collection: "" }` | `dropDatabase`, `dropCollection`, `listCollections`, `find` | `createRole`, `dropRole`, `createUser`, `dropUser`, `grantRole`, `revokeRole`, `update`, `insert`, `remove` | MongoDB RBAC engine on `rs_test` (Code 13) |
| **`decision_os_destructive_executor`** | **`rs_test` (`:27018`)** | `{ cluster: true }` | `inprog`, `killop`, `killAnySession`, `impersonate`, `checkCursorSanity` | `grantRole`, `shutdown`, `replSetReconfig` | MongoDB RBAC engine on `rs_test` (Command `killOp` executed on `admin.$cmd`) |
| **`decision_os_destructive_executor`** | **`rs_coord` (`:27019`)** | **ALL RESOURCES** | **NONE (Zero Access)** | **ALL COMMANDS AND WIRE TRAFFIC** | Network policy (egress/ingress blocked) + zero credentials |
| **`decision_os_provisioner`** | **`rs_test` (`:27018`)** | `{ db: "", collection: "" }` | **NONE (Zero Admin Rights)** | `createRole`, `dropRole`, `createUser`, `dropUser`, `grantRole`, `revokeRole`, `changePassword`, `dropDatabase` | MongoDB RBAC engine on `rs_test` (Code 13) |
| **`decision_os_provisioner`** | **`rs_test` (`:27018`)** | `{ db: "admin", collection: "" }` | `find` (read-only system metadata) | `createRole`, `createUser`, `grantRole`, `dropUser` on `admin` | MongoDB RBAC engine on `rs_test` (Code 13) |
| **`decision_os_provisioner`** | **`rs_test` (`:27018`)** | `{ cluster: true }` | `listDatabases` | `killAnySession`, `shutdown`, `replSetReconfig` | MongoDB RBAC engine on `rs_test` |
| **`decision_os_provisioner`** | **`rs_coord` (`:27019`)** | `decision_os_coordination.ownership_locks` | `find`, `insert`, `update`, `remove`, `createIndex` | `dropCollection`, `dropDatabase` | MongoDB RBAC engine on `rs_coord` (Code 13; authorizes `findAndModify` command) |
| **`decision_os_provisioner`** | **`rs_coord` (`:27019`)** | `decision_os_coordination.provisioning_saga` | `find`, `insert`, `update`, `remove`, `createIndex` | `dropCollection`, `dropDatabase` | MongoDB RBAC engine on `rs_coord` (Code 13; authorizes `findAndModify` command) |
| **`decision_os_provisioner`** | **`rs_coord` (`:27019`)** | `decision_os_coordination.cleanup_ledger` | `find` | `insert`, `update`, `remove`, `dropCollection` | MongoDB RBAC engine on `rs_coord` (Code 13) |
| **`decision_os_provisioner`** | **`rs_coord` (`:27019`)** | `decision_os_coordination.nonce_allocations` | **NONE (Zero Write Access)** | `insert`, `update`, `remove`, `dropCollection`, `dropDatabase` | Decoupled to `decision_os_nonce_allocator` |
| **`decision_os_provisioner`** | **`rs_coord` (`:27019`)** | `decision_os_coordination.cleanup_audit_log` | **NONE** | `find`, `insert`, `update`, `remove`, `drop` | MongoDB RBAC engine on `rs_coord` (Code 13) |
| **`decision_os_nonce_allocator`** | **`rs_coord` (`:27019`)** | `decision_os_coordination.nonce_allocations` | `find`, `insert`, `update`, `createIndex` (Monotonic `$inc` blocks) | `remove`, `dropCollection`, `dropDatabase` | Dedicated Nonce Allocator RBAC on `rs_coord` |
| **`decision_os_nonce_allocator`** | **`rs_coord` (`:27019`)** | All other collections | **NONE** | All CRUD and DDL commands | MongoDB RBAC engine on `rs_coord` (Code 13) |
| **`decision_os_nonce_allocator`** | **`rs_test` (`:27018`)** | **ALL RESOURCES** | **NONE (Zero Access)** | **ALL COMMANDS** | Zero network route and zero credentials |
| **`decision_os_offline_bootstrap`** | **`rs_test` (`:27018`)** | Pre-allocated slot DBs (`slot_000`–`slot_255`) | `createRole`, `createUser`, `createCollection` | Runtime persistence | Ephemeral bootstrap container; shredded on exit |
| **`decision_os_offline_bootstrap`** | **`rs_test` (`:27018`)** | `admin` | `createRole`, `createUser` (Broker principal only) | Granting cluster superusers | Ephemeral bootstrap container; shredded on exit |
| **`decision_os_offline_bootstrap`** | **`rs_coord` (`:27019`)** | Initial collections & `nonce_seq_v1` | `insert`, `createIndex` | Runtime persistence | Ephemeral bootstrap container; shredded on exit |
| **`decision_os_credential_broker`** | **`rs_test` (`:27018`)** | `{ db: "", collection: "" }` | `createUser`, `dropUser`, `createRole`, `dropRole`, `grantRole`, `revokeRole`, `changePassword`, `getRole`, `getUser` | `dropDatabase`, `dropCollection`, application CRUD, and system DB access | Enclave service validating signed ownership claims |
| **`decision_os_credential_broker`** | **`rs_test` (`:27018`)** | `admin`, `config`, `local`, `{ cluster: true }` | **NONE** | All commands and actions | MongoDB RBAC engine on `rs_test` (Code 13) |
| **`decision_os_credential_broker`** | **`rs_coord` (`:27019`)** | **ALL RESOURCES** | **NONE (Zero Access)** | **ALL COMMANDS** | Zero network route and zero credentials |
| **`decision_os_db_admin_${dbName}`** | **`rs_test` (`:27018`)** | `{ db: targetTestDb, collection: "" }` | `createRole`, `dropRole`, `createUser`, `dropUser`, `grantRole`, `revokeRole`, `changePassword`, `getRole`, `getUser` | `dropDatabase`, `dropCollection`, any command on other databases | Scoped Dynamic DB Admin Role (Code 13 on other DBs) |
| **`decision_os_db_admin_${dbName}`** | **`rs_test` (`:27018`)** | Other databases & cluster | **NONE** | All commands on $db 
e targetTestDb$ or `{ cluster: true }` | MongoDB RBAC engine on `rs_test` (Code 13) |
| **`decision_os_db_admin_${dbName}`** | **`rs_coord` (`:27019`)** | **ALL RESOURCES** | **NONE (Zero Access)** | **ALL COMMANDS** | Zero network route and zero credentials |
| **`decision_os_network_fence_controller`** | **Infrastructure Plane** | Worker pod/container veth interfaces | Program netfilter/iptables egress drops to ports 27018/27019 | ALL MongoDB wire commands | CNI / Linux netfilter engine; zero DB credentials |
| **`decision_os_audit_writer`** | **`rs_coord` (`:27019`)** | `decision_os_coordination.cleanup_audit_log` | `find`, `insert`, `createIndex` (Append-Only) | `update`, `remove`, `dropCollection`, `dropDatabase` | MongoDB RBAC engine on `rs_coord` (Code 13; prevents `findAndModify` write ops) |
| **`decision_os_audit_writer`** | **`rs_coord` (`:27019`)** | All other collections | **NONE** | All CRUD and DDL commands | MongoDB RBAC engine on `rs_coord` (Code 13) |
| **`decision_os_audit_writer`** | **`rs_test` (`:27018`)** | **ALL RESOURCES** | **NONE (Zero Access)** | **ALL COMMANDS** | Zero network route and zero credentials |
| **`decision_os_worker_${runId}_${workerId}`** | **`rs_test` (`:27018`)** | Assigned test DB (`decision_os_test_${runId}_${workerId}`) | `find`, `insert`, `update`, `remove`, `createCollection`, `createIndex`, `dropIndex` | `dropDatabase`, `dropCollection`, `createRole`, `createUser` | Dynamic test role defined on assigned DB (Code 13) |
| **`decision_os_worker_${runId}_${workerId}`** | **`rs_test` (`:27018`)** | Other test DBs & system DBs | **NONE** | Any read or write command | Scoped dynamic role isolation (Code 13) |
| **`decision_os_worker_${runId}_${workerId}`** | **`rs_coord` (`:27019`)** | **ALL RESOURCES** | **NONE (Zero Access)** | **ALL COMMANDS** | Network policy + zero credentials |
| **`decision_os_admin_operator`** | **API Interface Only** | HTTP `/v1/cleanup/reconcile` | Signed administrative reconciliation (`QUARANTINE`, `CONFIRM_CLEANED`) | Direct database wire access; redispatch of wire drop | Ed25519 signature verification on API gateway |

---

### 7.7 Mathematical & Architectural Proof of Impossibility of Destructive Cleanup Dropping Coordination/Audit Data (Finding B38-20)

Let $D_{destructive}$ denote the Destructive Cleanup Executor process, $M_{test}$ denote the MongoDB test deployment (`rs_test:27018`), and $M_{coord}$ denote the MongoDB coordination deployment (`rs_coord:27019`).
Let $C_{audit}$ denote `cleanup_audit_log` and $C_{coord}$ denote coordination collections (`ownership_locks`, `cleanup_ledger`, `provisioning_saga`).

**Proof:**
1. **Network Layer Invariant:**
   Container network security policies (Kubernetes `NetworkPolicy` and Docker network isolation) restrict $D_{destructive}$ egress exclusively to $M_{test}$ IP/ports. The ingress policy of $M_{coord}$ permits connections exclusively from $P_{provisioner}$, $N_{allocator}$, and $A_{audit}$.
   $$\text{TCPConnect}(D_{destructive}, M_{coord}) \rightarrow \text{DROPPED / CONNECTION REFUSED}$$
2. **Credential Layer Invariant:**
   $D_{destructive}$ filesystem contains exclusively credentials for $M_{test}$ (`/var/run/secrets/cleanup-executor/mongo-test-credentials`). It possesses no credentials, secrets, or certificates for $M_{coord}$.
   $$\text{Authenticate}(D_{destructive}, M_{coord}) \rightarrow \text{AuthenticationFailed (Code 18)}$$
3. **Catalog Storage Topology Invariant:**
   The storage engine of $M_{test}$ contains exclusively test databases conforming to `decision_os_test_*` and system administrative catalogs. The databases $C_{audit}$ and $C_{coord}$ are hosted exclusively on the distinct storage engine of $M_{coord}$.
   $$\forall db \in \text{Databases}(M_{test}), \quad db \notin \{ \text{decision\_os\_coordination} \}$$
4. **Execution Impossibility:**
   Assume $D_{destructive}$ is completely compromised and issues wire command:
   $$\text{Command}(D_{destructive}, M_{test}, \{ \text{dropDatabase}: \text{"decision\_os\_coordination"} \})$$
   $M_{test}$ searches its internal database catalog. Because the database does not exist on $M_{test}$, the command returns `{ ok: 1, dropped: 0 }` (no-op). $M_{coord}$ experiences zero wire traffic and zero state mutation.
5. **Conclusion:**
   The impossibility of destructive cleanup dropping or altering coordination and audit storage is enforced by **independent network topology, physical storage segregation, and authentication boundary**, requiring zero reliance on application regex validation. $\blacksquare$

---

### 7.8 Per-Worker Discrete MongoDB Principal & Ephemeral Credential Model (Finding B38-11, B38-15, B38-17)

1. **Unique Principal Naming Standard:**
   - Test Worker: `decision_os_worker_${runId}_${workerId}` on auth database `decision_os_test_${runId}_${workerId}`.
   - Benchmark: `decision_os_benchmark_${runId}` on auth database `decision_os_benchmark_${runId}_test`.
2. **Ephemeral Password Generation:**
   - 32-byte cryptographically secure random secret generated via `crypto.randomBytes(32).toString('base64url')`.
3. **In-Memory Transport:**
   - Returned exclusively over mTLS to the authenticated worker client; never written to disk or logs.
4. **Cryptographic Identity Binding:**
   - Binds caller Ed25519 public key fingerprint, username, and database name in `ownership_locks`.

---

### 7.9 Reconciled Permanent Worker Revocation Protocol & Hostile Worker Defense (Finding B38-25, B38-27, B38-33, B38-35)

#### 1. Exact Behavior and Engine Limitations of `killAllSessionsByPattern`
The v1.4.0 architecture cited `killAllSessionsByPattern` as the primary mechanism for worker session revocation. A rigorous technical assessment of MongoDB 8.0 reveals three distinct architectural limitations:
1. **Logical Session Scope Only:** `killAllSessionsByPattern` operates strictly on the server-side logical session records (`lsid`) tracked in `config.system.sessions`. It does **not sever physical TCP sockets** maintained by the client driver's connection pool.
2. **Ignored Prepared Transactions (MongoDB 8.0 Engine Invariant):**
   MongoDB documentation explicitly dictates:
   > *`killAllSessionsByPattern` will ignore and fail to kill sessions that have transactions in a `prepared` state.*
   If a session holds a prepared distributed transaction, `killAllSessionsByPattern` skips it, leaving locks active until the coordinator explicitly commits or aborts.
3. **Unsessioned Operations Untracked:** Operations executed without an explicit logical session (e.g. unacknowledged writes or legacy queries) are not indexed by user pattern in `config.system.sessions` and will not be terminated by session kill alone.

#### 2. Rejection of Client-Side Pool Closure as a Security Boundary
The client driver call `await client.close(true)` terminates client-side sockets. However, treating client-side pool closure as a security boundary is an architectural flaw:
- A benign worker will cooperatively invoke `client.close(true)`.
- A **compromised or hostile worker** will deliberately refuse to call `client.close(true)`, retaining its active TCP sockets, connection pool, and cached credentials to attempt further unauthorized operations.
- Furthermore, **treating a successful API response or client-side connection closure as proof of revocation is strictly rejected**. Revocation must be proven through durable server-side mutations and transport-layer fencing.

#### 3. Resolution of Revocation Responsibilities Across Specialized Services (Finding B38-27, B38-33, B38-35)
To eliminate authorization contradictions and ensure physical network isolation is durably integrated:
1. The **Network Fence Controller (`apps/network-fence-controller`)** possesses identity `decision_os_network_fence_controller` on the infrastructure plane. It programmatically isolates the worker container's network namespace at the CNI/netfilter layer, dropping all TCP packets destined for database ports 27018 and 27019.
2. The **Scoped Provisioning Service (`decision_os_db_admin_${targetTestDb}`)** possesses exact role- and user-management privileges scoped strictly to `{ db: targetTestDb, collection: "" }`. It executes `dropUser` and `dropRole` directly on the target test database, invalidating the MongoDB daemon's internal authorization cache. It possesses **ZERO destructive drop privileges**.
3. The **Destructive Cleanup Executor (`decision_os_destructive_executor`)** possesses `{ cluster: true }` privileges on `rs_test` to inspect prepared transactions (`actions: ["inprog"]`), abort in-flight wire operations (`actions: ["killop"]`), and terminate logical sessions (`actions: ["killAnySession", "impersonate"]`). It possesses `{ db: "", collection: "" }` with `dropDatabase` on `rs_test`. It possesses **ZERO user/role administration rights**.

#### 4. Executable Operation Allocation Matrix for All 8 Revocation Operations
The following matrix resolves exact responsibilities, identities, privileges, acknowledgements, retry behaviors, and fail-closed conditions for every revocation operation:

| Operation Index & Name | Responsible Service | Required MongoDB / Infra Identity | Exact Privilege Scope & Resource | Target Deployment & Namespace | Required Acknowledgement | Retry & Crash Recovery Behavior | Fail-Closed Condition |
|---|---|---|---|---|---|---|---|
| **1. Prepared Transaction Resolution** | Destructive Cleanup Executor (`apps/cleanup-executor`) | `decision_os_destructive_executor` | `actions: ["inprog"]` on `{ cluster: true }` | `rs_test:27018` (`admin.$cmd`) | `currentOp` returns 0 matching operations with `preparedTransaction: true` | Rescan `currentOp` on restart; coordinate abort with transaction coordinator | If prepared transaction cannot be aborted within 30s, halt teardown; transition to `QUARANTINED`. Never drop database while prepared transactions remain. |
| **2. In-Flight Operation Cancellation (`killOp`)** | Destructive Cleanup Executor (`apps/cleanup-executor`) | `decision_os_destructive_executor` | `actions: ["killop"]` on `{ cluster: true }` | `rs_test:27018` (`admin.$cmd`) | `{ ok: 1 }` returned for all active worker `opid`s | Query active ops; re-issue `killOp` until active count is 0 | If `killOp` fails repeatedly, halt; transition to `QUARANTINED`. Do not dispatch wire drop while worker ops are executing. |
| **3. Logical Session Termination (`killAllSessionsByPattern`)** | Destructive Cleanup Executor (`apps/cleanup-executor`) | `decision_os_destructive_executor` | `actions: ["killAnySession", "impersonate"]` on `{ cluster: true }` | `rs_test:27018` (`admin.$cmd`) | `{ ok: 1 }` returned from `killAllSessionsByPattern` | Idempotent command; re-execute on process restart or network timeout | If command fails, retry 3 times with exponential backoff (1s, 2s, 4s); if persistent failure, mark `QUARANTINED`. |
| **4. Server-Side Identity Deletion (`dropUser`)** | Scoped Provisioning Service (`apps/provisioner`) | `decision_os_db_admin_${targetTestDb}` | `actions: ["dropUser"]` on `{ db: targetTestDb, collection: "" }` | `rs_test:27018` (`targetTestDb.$cmd`) | `{ ok: 1 }` with `w: "majority", j: true` (or `UserNotFound` Code 11) | Idempotent command; retried on network partition; orphan reaper sweeps if stalled | Executor will NOT proceed to `DISPATCHING` without verified majority acknowledgement of `dropUser`. If unreachable, lease expires $
ightarrow$ `QUARANTINED`. |
| **5. Server-Side Role Deletion (`dropRole`)** | Scoped Provisioning Service (`apps/provisioner`) | `decision_os_db_admin_${targetTestDb}` | `actions: ["dropRole"]` on `{ db: targetTestDb, collection: "" }` | `rs_test:27018` (`targetTestDb.$cmd`) | `{ ok: 1 }` with `w: "majority", j: true` (or `RoleNotFound`) | Idempotent; retried on restart; orphan reaper sweeps if stalled | If unconfirmed, recorded in saga with `compensationPending: true`; background reaper completes. |
| **6. Lingering TCP Socket Behavior** | MongoDB Daemon Engine Subsystem | N/A (Server-side daemon cache invalidation) | N/A (Internal engine cache lookup) | `rs_test:27018` (Server connection pool) | Commands over lingering sockets fail with Code 11 (`UserNotFound`) or Code 13 (`Unauthorized`) | Engine re-evaluates user credentials on next wire packet after `dropUser` | Daemon halts command processing immediately upon missing user verifier; zero reads or writes permitted. |
| **7. Fresh Authentication Rejection** | MongoDB Daemon Authentication Subsystem | N/A (SCRAM-SHA-256 verifier lookup) | N/A (Internal `system.users` catalog lookup) | `rs_test:27018` (`targetTestDb`) | SCRAM-SHA-256 handshake fails with Code 11 (`UserNotFound`) or Code 18 (`AuthenticationFailed`) | Attempt rejected natively by MongoDB wire protocol | Wire connection cannot establish authenticated session. |
| **8. Network Transport Fencing** | Network Fence Controller (`apps/network-fence-controller`) | `decision_os_network_fence_controller` | Egress drop policy on container veth / Linux netfilter | Worker Container Network Namespace | Controller queries data plane (`iptables -C` or CNI status) and returns `{ ok: 1, fenced: true }` | Re-verified by controller before teardown proceeds; re-applied on container restart | If network controller is unreachable or fails to program drop rule within 15s, fail closed $
ightarrow$ halt teardown; transition to `QUARANTINED`. |

#### 4a. Formal Distinction of the Six Isolation Layers (Finding B38-35)
To eliminate conceptual conflation and establish defense-in-depth, Decision OS distinguishes six distinct layers of worker isolation:

1. **Logical Session Invalidation:** Performed via `killAllSessionsByPattern`. Deletes session documents from `config.system.sessions`, terminating logical transaction context. Does NOT close TCP sockets.
2. **Server-Side User Deletion:** Performed via `dropUser` with `w: "majority"`. Deletes user credentials from `system.users`, invalidating the MongoDB daemon's in-memory authorization cache. Causes subsequent wire commands on open sockets to fail with Error Code 11/13.
3. **Operation Cancellation:** Performed via `killOp` (action `killop` on `{ cluster: true }`). Interrupts currently running wire queries and storage operations in the execution pipeline.
4. **Physical TCP Socket Retention:** Physical TCP connection state maintained by the client OS kernel and MongoDB daemon connection pool. Sockets remain open until closed by client, severed by network fencing, or terminated by process exit.
5. **Network Transport Isolation:** Programmed by the Network Fence Controller at the Linux netfilter / iptables or CNI eBPF layer. Drops IP packets at layer 3/4 before they reach MongoDB port 27018 or 27019.
6. **Database Deletion:** Performed via `dropDatabase` by the Destructive Cleanup Executor. Removes database files and catalog entries from the WiredTiger storage engine.
- **Architectural Tenet:** **`dropDatabase` is NEVER represented as network transport fencing.** Dropping a database is a storage engine DDL mutation that deletes disk catalog structures; it possesses zero transport-layer fencing capability and does not sever network connections.

#### 5. Durable Coordination Protocol Between Executor, Network Controller, and Provisioner
To ensure the Cleanup Executor never executes operations outside its authorized boundary and guarantees multi-layer fencing:

1. **Step 1 (Claim Request):** The Cleanup Executor receives `POST /v1/cleanup/request`, validates the caller signature and ownership lease, and records state `CLAIMED` in `cleanup_ledger` with `w: "majority"`.
2. **Step 2 (Network Transport Fencing Handoff):** The Executor sends a signed mutual TLS request `POST /v1/orchestrator/fence-worker` to the Network Fence Controller:
   ```json
   {
     "fenceId": "fence_550e8400_e29b",
     "requestId": "550e8400-e29b-41d4-a716-446655440000",
     "runId": "runA",
     "workerId": "wA",
     "workerPodLabel": "decision-os-worker-runA-wA",
     "targetDatabases": ["decision_os_test_runA_wA"],
     "action": "ISOLATE_WORKER_EGRESS",
     "requestedAt": "2026-11-06T02:09:59.000Z"
   }
   ```
   - The Network Fence Controller validates the signature, applies netfilter/iptables rules dropping all egress from the worker container to ports 27018 and 27019, verifies the rule in the kernel data plane (`iptables -C`), and returns HTTP 200 `{ ok: 1, fenced: true, netfilterVerified: true }`.
   - *Failure & Retry:* If the controller is unreachable, the Executor retries 3 times with exponential backoff (1s, 2s, 4s). If fencing cannot be verified within 15s, teardown **fails closed**: the Executor transitions the request to `OUTCOME_UNKNOWN` / `QUARANTINED`, preserving `dropExecutionLock: true`.
3. **Step 3 (Scoped Identity Revocation Handoff):** The Executor sends a signed mutual TLS request `POST /v1/provisioning/revoke-worker` to the Provisioning Service:
   ```json
   {
     "revocationId": "rev_550e8400_e29b",
     "requestId": "550e8400-e29b-41d4-a716-446655440000",
     "targetDatabase": "decision_os_test_runA_wA",
     "workerUsername": "decision_os_worker_runA_wA",
     "requestedAt": "2026-11-06T02:10:00.000Z"
   }
   ```
   - The Provisioning Service verifies the signature, binds to `decision_os_db_admin_runA_wA`, dispatches `dropUser` and `dropRole` with `{ writeConcern: { w: "majority", j: true } }`, marks `ownership_locks.state = 'REVOKED'`, and responds with HTTP 200 `{ ok: 1, userDropped: true, roleDropped: true }`.
4. **Step 4 (Executor Revocation & Cancellation):**
   - Upon receiving HTTP 200 confirmation, the Cleanup Executor connects as `decision_os_destructive_executor` to `rs_test:27018`.
   - It inspects `currentOp` for prepared transactions (`actions: ["inprog"]` on `{ cluster: true }`); if found, coordinates abort.
   - It issues `killOp` (`actions: ["killop"]` on `{ cluster: true }`, executed on `admin.$cmd`) against active worker ops.
   - It executes `killAllSessionsByPattern` (`actions: ["killAnySession", "impersonate"]` on `{ cluster: true }`).
5. **Step 5 (Crash & Failure Recovery During Handoff):**
   - *If Provisioner is down or returns error:* The Executor retries with exponential backoff. If unreachable when the cleanup lease expires, the Executor transitions to `QUARANTINED`. **The Executor NEVER attempts to execute `dropUser` or `dropRole` itself.**
   - *If Executor crashes after Step 3, before Step 4:* On restart, the Executor detects `state === 'CLAIMED'` and `ownership_locks.state === 'REVOKED'`. It resumes Step 4 without re-requesting identity creation.
6. **Step 6 (Physical Teardown):**
   - Only after Steps 1–4 are fully acknowledged does the Executor transition `cleanup_ledger` to `DISPATCHING` (`dropExecutionLock = true`), write the audit log entry, and issue `db.runCommand({ dropDatabase: 1, comment: ... })`.

---

### 7.10 Correct AES-256-GCM Nonce Uniqueness & Envelope Lifecycle (Finding B38-17, B38-28, B38-32)

To ensure crash-safe ephemeral credential recovery without attempting the mathematically impossible task of extracting plaintext passwords from MongoDB SCRAM-SHA-256 verifiers, Decision OS specifies an authenticated envelope protocol:

#### 1. Envelope Key Lifecycle & Storage
- **Master Envelope Key (`ENVELOPE_KEY`):** A 256-bit cryptographically secure symmetric key.
- **Storage & Injection:** Managed in production via cloud KMS (AWS KMS, Google Cloud KMS, or HashiCorp Vault). Injected into the Provisioning Service container filesystem at `/var/run/secrets/provisioning-service/envelope-key` with permissions `0400` owned by `UID 10001`. Unprivileged worker containers have zero access to this secret.

#### 2. Analysis of Legacy Nonce Flaw & Birthday Paradox Vulnerability (Finding B38-28)
The v1.5.0 architecture specified nonce construction as:
$$\text{IV} = \text{InstanceSalt}_{32\text{-bit}} \parallel \text{MonotonicCounter}_{64\text{-bit}}$$
Where `InstanceSalt` was a 32-bit random value generated at startup, and `MonotonicCounter` was an in-memory 64-bit integer initialized to 0.

**Mathematical Proof of Vulnerability:**
1. In-memory counters reset to 0 whenever a provisioner container restarts, crashes, or is rescheduled.
2. The random salt space is $2^{32} \approx 4.29 \times 10^9$ possible values.
3. By the birthday problem, the probability of a salt collision across $k$ process instances or replicas sharing the same key is:
   $$P(\text{collision}) \approx 1 - \exp\left(-\frac{k(k-1)}{2 \times 2^{32}}\right)$$
   For $k = 2^{16} = 65,536$ process instances, $P(\text{collision}) \approx 1 - e^{-0.5} \approx 39.3\%$.
   For $k = 77,163$ instances, $P(\text{collision}) \ge 50\%$.
4. In active CI environments with container restarts and multiple provisioner replicas, salt collisions are guaranteed to occur over time.
5. When a salt collision occurs between two instances $A$ and $B$, both instances initialize their in-memory counters to 0. Consequently, both instances emit identical nonces:
   $$\text{IV}_{A, 0} = \text{Salt} \parallel 0 = \text{IV}_{B, 0}$$
   Under AES-GCM, encrypting two distinct plaintext messages under the same key and identical nonce exposes the XOR difference of the plaintexts and permits recovery of the GCM authentication hash key $H$, destroying all confidentiality and authenticity.
6. Therefore, the v1.5.0 construction does **NOT** guarantee nonce uniqueness across process lifetimes.

#### 3. Durable Globally Coordinated Block Allocation Protocol with Decoupled Authority (NIST SP 800-38D Section 8.2.1, Finding B38-32)
To achieve mathematical certainty of nonce uniqueness across multiple replicas, crashes, and restarts, Decision OS replaces volatile random salts with a **Durable Globally Coordinated Counter Range Block Reservation Protocol** adhering to NIST SP 800-38D Section 8.2.1 Deterministic Construction, hardened through dedicated service authority decoupling:

##### 1. Nonce Allocation Authority Hardening & Unauthorized Reset Prevention (Finding B38-32)
1. **Decoupled Allocation Authority:** Nonce allocation is separated entirely from the general provisioning service into an independent **Nonce Allocation Service** (`apps/nonce-allocator`, running identity `decision_os_nonce_allocator`) on `rs_coord:27019`.
2. **Stripping General Provisioner Authority:** The central provisioner identity (`decision_os_provisioner`) has **ZERO write or update access** to `decision_os_coordination.nonce_allocations`. It cannot execute `update`, `insert`, or `remove`. Even if the central provisioner is completely compromised, the attacker cannot execute `$set: { nextBlockStart: 0 }` to regress counter state.
3. **Dedicated Monotonic Allocation Implementation:** The Nonce Allocation Service exposes a strictly constrained API (`POST /v1/nonce/lease-block`) over mTLS. The allocator implementation contains **zero `$set` pathways** for `nextBlockStart` and executes exclusively:
   ```javascript
   const allocation = await db.collection("nonce_allocations").findOneAndUpdate(
     { _id: `nonce_seq_${keyVersion}`, nextBlockStart: { $lt: maxInvocationCeiling } },
     { $inc: { nextBlockStart: BLOCK_SIZE }, $set: { allocatedAt: new Date() } },
     { returnDocument: "after", writeConcern: { w: "majority", j: true } }
   );
   ```
4. **Pre-Initialization of Sequence Document:** The sequence document is pre-initialized during offline cluster bootstrap (`decision_os_offline_bootstrap`) before concurrent allocation begins:
   ```json
   {
     "_id": "nonce_seq_v1",
     "keyVersion": "v1",
     "nextBlockStart": NumberLong(0),
     "blockSize": NumberInt(1048576),
     "allocatedAt": ISODate("2026-11-06T00:00:00.000Z"),
     "maxInvocationCeiling": NumberLong("281474976710656")
   }
   ```
5. **Duplicate-Key & Key Rotation Race Handling:** When a new key version (`v2`) is introduced, the allocator attempts an atomic initialization. If concurrent allocator replicas attempt simultaneous creation, MongoDB raises Duplicate Key Error Code 11000 (`E11000 duplicate key error collection: nonce_allocations index: _id_`). The allocator catches Code 11000 and gracefully falls back to `findOneAndUpdate` with `$inc`.
6. **Consensus Linearizability & Election Recovery:** Every block reservation requires journaled majority write concern (`w: "majority", j: true`). If a primary failover or stepdown interrupts allocation, any unacknowledged write rolls back, and the client retries the lease request against the new primary, guaranteeing that no two replicas ever lease the same counter block.
7. **Disaster Recovery Mandate (Backup Restore Epoch Bumping):** Cold restoration of `rs_coord` from asynchronous backups could roll back `nextBlockStart`. Any database backup restoration mandates an **immediate KMS Epoch Bump and key rotation to `keyVersion + 1`**. Encryption with an old key version after a database restore is strictly prohibited.
8. **Allocator Compromise Containment & Monotonicity Watchdog:** The Nonce Allocation Service has zero network connectivity and zero credentials on `rs_test:27018`. It possesses access strictly to `nonce_allocations` on `rs_coord:27019`. An external integrity watchdog monitors leased block boundaries in audit logs. If an out-of-order or regressed block is detected, it triggers an immediate emergency key rotation in KMS, retiring the active key version and alerting SRE.

##### 2. Exact 96-Bit Nonce Encoding & Bit Layout
The 96-bit (12-byte) initialization vector is structured as follows:
$$\text{IV} = \text{KeyVersionPrefix}_{16\text{-bit}} \parallel \text{AllocatedRangeBlock}_{32\text{-bit}} \parallel \text{MonotonicCounter}_{48\text{-bit}} = 96\text{ bits (12 bytes)}$$

- **`KeyVersionPrefix` (16 bits / 2 bytes, Big-Endian):**
  - Encodes the active envelope key version (e.g. `0x0001` for `v1`, `0x0002` for `v2`).
  - Occupies bytes 0–1 of the IV buffer.
  - Guarantees IV domain separation across key rotations. Key-version identifiers never reuse a prefix under the same key material.
- **`AllocatedRangeBlock` (32 bits / 4 bytes, Big-Endian):**
  - Occupies bytes 2–5 of the IV buffer.
  - Exact conversion from `nextBlockStart`:
    $$\text{AllocatedRangeBlock} = \left\lfloor \frac{\text{blockStart}}{\text{BLOCK\_SIZE}} \right\rfloor = \text{NumberLong(blockStart)} \gg 20$$
    where $\text{blockStart} = \text{allocation.nextBlockStart} - \text{BLOCK\_SIZE}$, and $\text{BLOCK\_SIZE} = 2^{20} = 1{,}048{,}576$ nonces.
  - Formatted as a 32-bit unsigned big-endian integer. Provides $2^{32} \approx 4.29 \times 10^9$ unique non-overlapping block allocations per key version.
- **`MonotonicCounter` (48 bits / 6 bytes, Big-Endian):**
  - Occupies bytes 6–11 of the IV buffer.
  - Initialized to 0 when a new block is leased, and incremented atomically via `Atomics.add` or atomic 64-bit local integer increment for each encryption within the leased block range $[0, \text{BLOCK\_SIZE} - 1]$.
  - Formatted as a 48-bit (6-byte) unsigned big-endian integer.

##### 3. BSON Numeric Types, Ceilings, and Block Boundary Handling
- **BSON Numeric Types:**
  - `nextBlockStart`: BSON `NumberLong` (64-bit signed integer).
  - `blockSize`: BSON `NumberInt` (32-bit signed integer).
  - `maxInvocationCeiling`: BSON `NumberLong` (64-bit signed integer, $2^{48} = 281{,}474{,}976{,}710{,}656$).
- **Block Boundary Handling:**
  - When in-memory `MonotonicCounter` reaches `BLOCK_SIZE`, the block is exhausted. The provisioner thread synchronously pauses and requests a fresh disjoint block from `apps/nonce-allocator`.
  - Residual nonces from crashed or restarted processes are permanently discarded ("counter holes" are fully compliant with NIST SP 800-38D).
- **Counter Exhaustion Ceiling ($2^{48}$):**
  - When `nextBlockStart + BLOCK_SIZE > maxInvocationCeiling` ($2^{48}$), the Nonce Allocation Service strictly refuses further leases, returning error `KEY_EXHAUSTION_LIMIT_REACHED`.
  - The system emits a high-priority alert `CRITICAL_ENVELOPE_KEY_EXHAUSTION` and halts encryption until SRE rotates KMS to `keyVersion + 1`.
- **Availability Fail-Closed Behavior:**
  - If `rs_coord:27019` or the Nonce Allocation Service is partitioned or unreachable, and a provisioner replica's local block is exhausted, the provisioner **strictly fails closed**. It refuses to encrypt credentials, rejecting claim requests with HTTP 503 `SERVICE_UNAVAILABLE_NONCE_UNAVAILABLE`. Local uncoordinated counters or random IV fallbacks are strictly prohibited.

##### 4. Mathematical Collision Proof Conditional on Trust Assumptions
Let $R_a$ and $R_b$ be two distinct leased blocks: $R_a \ne R_b$. For any counters $c_a, c_b \in [0, \text{BLOCK\_SIZE} - 1]$:
$$\text{AllocatedRangeBlock}(R_a) \ne \text{AllocatedRangeBlock}(R_b) \implies \text{IV}(R_a, c_a) \ne \text{IV}(R_b, c_b)$$
For encryptions within the same block $R_a$, strict atomic in-memory incrementation ensures:
$$c_1 \ne c_2 \implies \text{IV}(R_a, c_1) \ne \text{IV}(R_a, c_2)$$
For encryptions under different key versions $v_1 \ne v_2$:
$$\text{KeyVersionPrefix}(v_1) \ne \text{KeyVersionPrefix}(v_2) \implies \text{IV}(v_1, \dots) \ne \text{IV}(v_2, \dots)$$

**Explicit Statement of Trust Assumptions:**
The mathematical uniqueness guarantee ($P(\text{collision}) = 0$) is **strictly conditional** upon the following trust assumptions:
1. **Trust Assumption 1 (KMS/Vault Key Custody):** The master envelope key material in cloud KMS / HashiCorp Vault is not compromised, and key version identifiers monotonically advance without prefix reuse.
2. **Trust Assumption 2 (Consensus Linearizability):** The MongoDB replica set consensus mechanism on `rs_coord:27019` maintains linearizability through journaled majority writes (`w: "majority", j: true`), guaranteeing that successfully acknowledged block leases are never regressed across primary elections.
3. **Trust Assumption 3 (Allocator Authority Integrity):** The Nonce Allocation Service code correctly applies atomic `$inc` and does not execute unauthorized `$set` mutations or sequence resets.
4. **Trust Assumption 4 (Disaster Recovery Compliance):** Any restoration of `rs_coord` from cold backups enforces a mandatory KMS Epoch Bump and rotation to a fresh key version before encryption resumes.
*If any of these trust assumptions are breached (e.g. key material compromised, allocator code modified, or uncoordinated backup restore), mathematical uniqueness cannot be guaranteed.* $\blacksquare$

#### 4. Versioned Envelope Schema & Authenticated Data (AAD)
The encrypted credential envelope stored in `ownership_locks.credentialEnvelope` adheres to the following strict schema:
```json
{
  "keyVersion": "v1",
  "format": "AES-256-GCM",
  "iv": "00010000000100000000002a",
  "tag": "e91c4d7af6b2a0c4d8e1f5b9a7c3d2e1",
  "ciphertext": "Y3J5cHRvQ2lwaGVydGV4dERhdGE=",
  "encryptedAt": "2026-11-06T01:00:00.000Z"
}
```
- **Additional Authenticated Data (AAD):**
  $$\text{AAD} = \text{UTF8}(\text{requestId} + \text{"|"} + \text{databaseName} + \text{"|"} + \text{runId} + \text{"|"} + \text{workerId} + \text{"|"} + \text{callerPublicKeyFingerprint} + \text{"|"} + \text{keyVersion})$$
  Any tampering with the lease document or attempt to replay the ciphertext in another context causes GCM authentication tag verification to fail immediately.

#### 5. Key Rotation Protocol
1. A new key version (`v2`) is injected into the secret volume alongside `v1`.
2. The Provisioning Service supports dual-key decryption:
   - New claims are encrypted using the active key (`v2`).
   - Existing envelopes presenting `keyVersion: "v1"` are decrypted using `v1`.
3. Because envelopes are ephemeral and destroyed upon activation (or reaped within 60 seconds), old key versions can be retired within 5 minutes of rotation with zero migration overhead.

#### 6. Crash Recovery Protocol
If the Provisioning Service crashes after generating credentials and persisting the envelope, but before HTTP response delivery:
1. The retrying worker client issues `POST /v1/ownership/claim` with the same `requestId`.
2. The restarted Provisioning Service verifies the Ed25519 request signature.
3. It retrieves `ownership_locks` for `databaseName`.
4. It reads `credentialEnvelope`, identifies `keyVersion`, reconstructs the canonical AAD, and executes AES-256-GCM authenticated decryption.
5. If authentication succeeds, the original ephemeral password is recovered and redelivered over mTLS without touching MongoDB.
6. If decryption fails (corrupted data or modified AAD), the provisioner executes fail-closed rollback: dropping the user/role, deleting the lock, and requiring a fresh claim.

#### 7. Exact Durable Acknowledgement Ordering Before Envelope Destruction
To prevent race conditions where credentials are destroyed before the worker has established its connection, envelope destruction follows strict durable ordering:

```mermaid
sequenceDiagram
    autonumber
    participant Worker as Worker Client
    participant Provisioner as Provisioning Service
    participant CoordDB as rs_coord (ownership_locks)
    participant TestDB as rs_test (Target DB)

    Note over Worker,TestDB: STEP 1: WORKER VERIFIES PHYSICAL CONNECTIVITY
    Provisioner-->>Worker: HTTP 200 OK (Credentials Delivered)
    Worker->>TestDB: Connect Pool & execute { ping: 1 }
    TestDB-->>Worker: { ok: 1 } (Authentication Succeeded)

    Note over Worker,CoordDB: STEP 2 & 3: DURABLE ACTIVATION HANDSHAKE
    Worker->>Provisioner: POST /v1/ownership/activate (Signed Handshake)
    Provisioner->>Provisioner: Verify Signature against callerPublicKeyFingerprint
    Provisioner->>CoordDB: updateOne({ databaseName, state: 'PROVISIONED' }, { $set: { state: 'ACTIVATED' } }, { writeConcern: { w: 'majority', j: true } })
    CoordDB-->>Provisioner: Acknowledged (Majority Committed)

    Note over Provisioner,CoordDB: STEP 4: ATOMIC ENVELOPE DESTRUCTION
    Provisioner->>CoordDB: updateOne({ databaseName, state: 'ACTIVATED' }, { $unset: { credentialEnvelope: 1 } }, { writeConcern: { w: 'majority', j: true } })
    CoordDB-->>Provisioner: Acknowledged (Zeroized on Disk)

    Note over Provisioner,Worker: STEP 5: ACTIVATION CONFIRMATION
    Provisioner-->>Worker: HTTP 200 OK { status: 'ACTIVATED', forwardSecrecyConfirmed: true }
```

- **Fail-Closed Guarantee:** If the worker crashes before sending the activation handshake, the envelope is NOT destroyed immediately. It remains valid for retry until the 60-second lease expires. Upon lease expiry, the orphan lease reaper securely drops the user, role, and lease, zeroizing all credentials.

---

## 8. Request Protocol & Deterministic Test Vector

### 8.1 Fixing Hash & Signature Construction (B38-04)
To eliminate self-referential hashing, the protocol strictly separates the **Canonical Request Payload** from derived cryptographic fields (`payloadHash`, `signature`).

#### 1. Canonical Request Payload Schema
```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440000",
  "runId": "run_alpha",
  "workerId": "w0",
  "databaseName": "decision_os_test_run_alpha_w0",
  "action": "DROP_DATABASE",
  "requestedAt": "2026-11-06T00:55:00.000Z",
  "nonce": "c4b8e21a-7b3f-4e12-89a5-6789abcdef01"
}
```

#### 2. RFC 8785 JSON Canonicalization Scheme (JCS)
Before hashing or signing, the payload is normalized according to RFC 8785:
- Deterministic lexicographical key sorting.
- Whitespace stripping outside string literals.
- Standard UTF-8 string encoding.

#### 3. Payload Hash Definition
$$\\text{payloadHash} = \\text{SHA256}(\\text{JCS}(\\text{CanonicalPayload}))$$

#### 4. Canonical Signing String (Exact Byte Sequence)
The signature is computed over an 8-line newline-separated canonical string:
```text
DECISION_OS_CLEANUP_REQUEST_V1\n
<requestId>\n
<runId>\n
<workerId>\n
<databaseName>\n
<action>\n
<requestedAt>\n
<payloadHash>
```

### 8.2 Deterministic Cryptographic Test Vector
To guarantee interoperability and cryptographic correctness across all test runners, the following deterministic test vector is established:

```json
{
  "canonicalPayload": {
    "action": "DROP_DATABASE",
    "databaseName": "decision_os_test_run_alpha_w0",
    "nonce": "c4b8e21a-7b3f-4e12-89a5-6789abcdef01",
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "requestedAt": "2026-11-06T00:55:00.000Z",
    "runId": "run_alpha",
    "workerId": "w0"
  },
  "jcsSerialized": "{\"action\":\"DROP_DATABASE\",\"databaseName\":\"decision_os_test_run_alpha_w0\",\"nonce\":\"c4b8e21a-7b3f-4e12-89a5-6789abcdef01\",\"requestId\":\"550e8400-e29b-41d4-a716-446655440000\",\"requestedAt\":\"2026-11-06T00:55:00.000Z\",\"runId\":\"run_alpha\",\"workerId\":\"w0\"}",
  "payloadHash": "sha256:b63690d56b26d83a48e77a28e9381dbbe65287ec2d790757a3e614bb537877e6",
  "callerPublicKeyFingerprint": "ea4a6c63e29cbb87869389947702f390",
  "expectedEd25519Signature": "MEQCIA5pX47e2..."
}
```

### 8.3 Cryptographic Identity & Key Management (B38-05)
1. **Asymmetric Ed25519 Signing Standard:** Ed25519 is chosen as the universal cryptographic primitive. Every principal (Test Worker, Provisioner, Cleanup Executor, Admin SRE) holds a dedicated private key.
2. **Public Key Registration:** Worker public keys are registered during test harness initialization. The Cleanup Executor and Provisioner verify incoming requests against the caller's registered public key fingerprint.

### 8.4 Canonical Database Naming Contract
All test databases must strictly adhere to the canonical naming expression:
`^decision_os_test_[a-zA-Z0-9_-]+$` or `^decision_os_benchmark_[a-zA-Z0-9_-]+_test$`
Any request targeting a name that violates this regex is rejected immediately at API ingress.

---

## 9. Durable Request Lifecycle & Ownership Management

### 9.1 Durable Idempotent Provisioning Saga Architecture (Finding B38-18)

#### 1. Distinguishing Command Atomicity from Multi-Command Distributed Workflows
- In MongoDB, administrative commands (`createRole`, `createUser`, `grantRolesToUser`, `dropDatabase`) **cannot participate in multi-document ACID transactions**.
- Provisioning dynamic roles and worker credentials across MongoDB administrative catalogs, coordination storage, and HTTP network transports is fundamentally a **multi-command distributed saga**.
- To guarantee transactional recovery without false atomicity claims, Decision OS formalizes role and user provisioning as a **Durable Idempotent Saga** spanning **exactly 12 formalized states** managed by the Provisioning Service.

#### 2. Durable Saga State Model (12 Formalized States)

```mermaid
stateDiagram-v2
    [*] --> CLAIM_PENDING: POST /v1/ownership/claim (Validate signature & namespace)
    CLAIM_PENDING --> ROLE_CREATING: Acquire lease in ownership_locks
    ROLE_CREATING --> ROLE_CREATED: db.createRole on Target Test DB
    ROLE_CREATED --> USER_CREATING: Generate ephemeral secret
    USER_CREATING --> USER_CREATED: db.createUser with base unprivileged role
    USER_CREATED --> ROLE_ASSIGNED: db.grantRolesToUser (Attach scoped test role)
    ROLE_ASSIGNED --> CREDENTIAL_ENCRYPTED: Encrypt & persist AES-GCM envelope in ownership_locks
    CREDENTIAL_ENCRYPTED --> CREDENTIAL_DELIVERED: Transmit HTTP 200 with credentials over mTLS
    CREDENTIAL_DELIVERED --> ACTIVATED: POST /v1/ownership/activate (Zeroize envelope post majority write)

    ROLE_CREATING --> ROLLING_BACK: Role creation fails
    ROLE_CREATED --> ROLLING_BACK: User creation fails
    USER_CREATED --> ROLLING_BACK: Role assignment fails
    ROLE_ASSIGNED --> ROLLING_BACK: Credential encryption fails
    CREDENTIAL_ENCRYPTED --> ROLLING_BACK: Lease expires before activation / Worker crash
    CREDENTIAL_DELIVERED --> ROLLING_BACK: Activation timeout (60s lease expires)

    ROLLING_BACK --> ROLLED_BACK: Compensating dropUser, dropRole, lease delete confirmed
    ROLLING_BACK --> ORPHAN_RECOVERY: Compensation encounters network partition / primary timeout
    ORPHAN_RECOVERY --> ROLLED_BACK: Orphan reaper proves saga identity & completes compensation

    ACTIVATED --> [*]: Active Test Execution Underway
    ROLLED_BACK --> [*]: Clean Terminal Rollback
```

#### 3. Formal Catalog of 12 Durable Saga States & Transitions

| Index | Saga State | Operation / Action | Preconditions | Durable Mutation Recorded on `rs_coord` | Compensating Action on Failure |
|---|---|---|---|---|---|
| **1** | **`CLAIM_PENDING`** | Validate request signature, nonce, canonical DB naming. | Database unclaimed or lease expired; valid Ed25519 signature. | Insert `_id: sagaId, requestId, runId, workerId, databaseName, state: 'CLAIM_PENDING'`. | Abort with HTTP 400/409; zero DB changes. |
| **2** | **`ROLE_CREATING`** | Acquire lease lock in `ownership_locks`; bind scoped identity `decision_os_db_admin_${dbName}`. | Atomic insert on `ownership_locks` with unique index on `databaseName`. | `$set: { state: 'ROLE_CREATING', leaseExpiresAt: now + 60s }`. | Release lease lock in `ownership_locks`. |
| **3** | **`ROLE_CREATED`** | Dispatch `db.createRole` directly on target test database on `rs_test` via scoped admin identity. | `rs_test` reachable; role does not exist on target DB. | `$set: { state: 'ROLE_CREATED', dynamicRoleName }`. | Transition to `ROLLING_BACK` $\\rightarrow$ release lease lock. |
| **4** | **`USER_CREATING`** | Generate 32-byte secret $P$. Dispatch `db.createUser` on target test DB with base unprivileged role via scoped admin. | Role created; user does not exist. | `$set: { state: 'USER_CREATING', mongoUsername }`. | Transition to `ROLLING_BACK` $\\rightarrow$ `dropRole` via scoped admin. |
| **5** | **`USER_CREATED`** | User principal exists in target DB with base role only (zero test DB access). | User creation returned `{ ok: 1 }`. | `$set: { state: 'USER_CREATED' }`. | Transition to `ROLLING_BACK` $\\rightarrow$ `dropUser`, `dropRole` via scoped admin. |
| **6** | **`ROLE_ASSIGNED`** | Dispatch `db.grantRolesToUser(user, [dynamicRole])` on target test DB via scoped admin. | User and role exist. | `$set: { state: 'ROLE_ASSIGNED' }`. | Transition to `ROLLING_BACK` $\\rightarrow$ `dropUser`, `dropRole` via scoped admin. |
| **7** | **`CREDENTIAL_ENCRYPTED`** | Allocate deterministic nonce from leased block acquired via mTLS from Nonce Allocation Service (`apps/nonce-allocator`); encrypt $P$ under `ENVELOPE_KEY` with AAD; persist to `ownership_locks`. | AES-256-GCM encryption succeeds; AAD bound; block lease active. | `$set: { state: 'CREDENTIAL_ENCRYPTED', credentialEnvelope }` with `w: majority`. | Transition to `ROLLING_BACK` $\\rightarrow$ `dropUser`, `dropRole` via scoped admin. |
| **8** | **`CREDENTIAL_DELIVERED`** | Deliver HTTP 200 OK with credentials over mTLS. | Envelope persisted durably. | `$set: { state: 'CREDENTIAL_DELIVERED' }`. | Worker retry redelivers via envelope; lease TTL reaps if abandoned. |
| **9** | **`ACTIVATED`** | Worker verifies DB connectivity and calls `/v1/ownership/activate`. Atomically zeroize envelope. | Signature valid; physical connection probe `{ ping: 1 }` confirmed. | Majority commit `$set: { state: 'ACTIVATED' }`, followed by atomic `$unset: { credentialEnvelope: 1 }`. | None (Active test phase underway). |
| **10** | **`ROLLING_BACK`** | Execute compensating `dropUser`, `dropRole` via scoped admin identity, delete `ownership_locks`. | Error caught or unactivated lease expired. | `$set: { state: 'ROLLING_BACK', rollbackReason }`. | If compensation fails, mark `compensationPending: true` $\\rightarrow$ `ORPHAN_RECOVERY`. |
| **11** | **`ROLLED_BACK`** | Compensations verified complete on both `rs_test` and `rs_coord`. | User, role, and lease confirmed deleted. | `$set: { state: 'ROLLED_BACK', completedAt: now }`. | Terminal clean state. |
| **12** | **`ORPHAN_RECOVERY`** | Background reaper sweeps stalled rollbacks using scoped administrative credentials. | Saga in `ROLLING_BACK` or lease expired with `compensationPending: true`. | `$set: { state: 'ORPHAN_RECOVERY', reaperClaimedAt: now }`. | Retries compensation with exponential backoff until verified deleted. |

#### 4. Recovery After Provisioning Service Crash at Every Transition
1. **Crash during `ROLE_CREATING`:** Role does not exist on `rs_test`. Restarted provisioner detects `ROLE_CREATING` with expired lease. Compensation releases lock in `ownership_locks` and marks saga `ROLLED_BACK`.
2. **Crash between `ROLE_CREATED` and `USER_CREATING`:** Role exists on target DB, user does not. Retrying worker resumes saga (creates user), or if lease expires, compensation issues `dropRole` and marks `ROLLED_BACK`.
3. **Crash between `USER_CREATED` and `ROLE_ASSIGNED`:** User exists with base role only (zero test DB access). Retrying worker resumes role assignment, or compensation issues `dropUser` followed by `dropRole`.
4. **Crash between `ROLE_ASSIGNED` and `CREDENTIAL_ENCRYPTED`:** User and role exist, but password envelope was not saved. Plaintext password is lost in volatile memory. **Recovery Action:** Provisioner uses scoped identity `decision_os_db_admin_${dbName}` to issue `updateUser({ user, pwd: newPassword })`, allocates a fresh deterministic nonce from its block leased via mTLS from the Nonce Allocation Service (`apps/nonce-allocator`), generates a new envelope, persists it with `w: majority`, and proceeds.
5. **Crash after `CREDENTIAL_ENCRYPTED`, before HTTP delivery:** User, role, and envelope exist. Retried claim with matching `requestId` decrypts envelope with `ENVELOPE_KEY`, validates AAD, and delivers credentials without modifying database state.
6. **Crash after `CREDENTIAL_DELIVERED`, before `ACTIVATED`:** Worker has credentials. If worker connects, it sends activation handshake; provisioner records `ACTIVATED` and zeroizes envelope. If worker crashed and never activates, the 60-second lease expires; lease reaper moves saga to `ROLLING_BACK` and cleans up.
7. **Crash during `ACTIVATED` envelope zeroization:** Worker is active. If `$unset` failed, next heartbeat retries `$unset: { credentialEnvelope: 1 }`.
8. **Crash during `ROLLING_BACK`:** Partial compensation executed (e.g. user dropped, role remains). On restart, orphan reaper detects `state: 'ROLLING_BACK'` and `compensationPending: true`. Reaper re-issues `dropUser` and `dropRole`, verifying both are deleted before marking `ROLLED_BACK`.

#### 5. Failed Compensation Handling in Rollback
If a compensating command (`dropRole` or `dropUser`) fails due to transient network partition or primary failover:
- The provisioner records `compensationPending: true` with the failed target resource name in the saga document.
- The background orphan reaper scans `provisioning_saga` every 30 seconds for records where `compensationPending === true`.
- The reaper applies an exponential backoff schedule (5s, 10s, 20s, up to 60s) to re-issue `dropRole` and `dropUser`.
- The saga cannot transition to `ROLLED_BACK` until MongoDB confirms with `{ ok: 1 }` (or `RoleNotFound` / `UserNotFound`) that the target resources no longer exist.

#### 6. Guarantee That Partially Provisioned Identities Possess Zero Unintended Privileges
To eliminate race conditions where a worker authenticates before provisioning finishes:
- Sequential construction creates the user initially with zero test database privileges.
- Dynamic test database CRUD is attached only in `grantRolesToUser`.
- If `grantRolesToUser` fails, the user is dropped before privileges are active.

#### 7. Proof Required for Orphan Reaper Deletion (4-Point Verification)
Before issuing any `dropRole` or `dropUser`, the orphan reaper must verify:
1. **Saga State Proof:** Saga document is in `ROLLING_BACK` or `CLAIM_PENDING` with an expired lease.
2. **Lease Alignment Proof:** `ownership_locks` document generation $\\le$ saga generation.
3. **Role Privilege Verification Proof:** Queries `getRole` on target DB; asserts privileges are strictly restricted to that single test database.
4. **User Principal Verification Proof:** Queries `getUser` on target DB; asserts assigned roles match only the specific test role.

---

### 9.2 Authoritative Request Ledger Management (B38-03)
Workers are denied wire write access to `decision_os_coordination.cleanup_ledger`. The Destructive Cleanup Executor is the **authoritative sole writer**:
1. Worker calls `POST /v1/cleanup/request`.
2. Executor validates signature, payload hash, and active ownership lease.
3. Executor creates the `REQUESTED` record atomically (`findOneAndUpdate` with `$setOnInsert`).
4. Duplicate request handling:
   - Matching `requestId` + matching `payloadHash`: Returns idempotent status (`IN_PROGRESS`, `CLEANED`, or `QUARANTINED`).
   - Matching `requestId` + conflicting `payloadHash`: Returns HTTP 409 `IDEMPOTENCY_PAYLOAD_MISMATCH`.
5. Status Retrieval: Workers query status via `GET /v1/cleanup/request/:requestId` with signed read authorization.

---

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
| **`CLAIMED`** | Pre-Wire Verification & Coordinated Revocation | `DISPATCHING` | Cleanup Executor | Lease active, `ownership_locks` confirms no generation bump, Network Fence Controller verified netfilter egress drop, Scoped Provisioner confirmed `dropUser`/`dropRole` with majority write concern, Executor terminated ops/sessions via cluster `killop`/session invalidation, collections present. | `$set: { state: 'DISPATCHING', wireDispatchedAt: now, dropExecutionLock: true, networkFenced: true }`. |
| **`CLAIMED`** | Revocation Detected | `RECONCILIATION_REQUIRED` | Cleanup Executor | Ownership superseded by another worker or generation bumped. | `$set: { state: 'RECONCILIATION_REQUIRED', reason: 'AUTHORITY_SUPERSEDED' }`. |
| **`DISPATCHING`** | Wire Drop Returns Success | `CLEANED` | Cleanup Executor | MongoDB returns `{ ok: 1 }` across wire to the original dispatching connection. | `$set: { state: 'CLEANED', cleanedAt: now, dropExecutionLock: false }`. (Worker egress fenced at netfilter layer in Step 2; User and role deleted by Scoped Provisioner in Step 3; in-flight ops/sessions terminated by Executor in Step 4). |
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

Section 4.2 allowed `CONFIRM_CLEANED` when oplog records prove completion. The protocol is strictly anchored in empirical MongoDB 8.0 replica-set behavior:

#### 1. Expected Oplog Record Structure in MongoDB 8.0
In a replica set (`rs_test`), database drop operations generate a command record in `local.oplog.rs`:
```javascript
{
  "op": "c",                         // Command operation
  "ns": "decision_os_test_run_alpha_w0.$cmd",
  "o": {
    "dropDatabase": 1,
    "comment": "{\"requestId\":\"550e8400...\",\"runId\":\"run_alpha\",\"payloadHash\":\"sha256:...\",\"wireDispatchedAt\":\"2026-11-06T00:55:00.000Z\"}"
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
> MongoDB documentation describing comments in server logs, profiler output, and `currentOp` is **NOT sufficient proof** that DDL commands (such as `dropDatabase`) preserve the `comment` field in `local.oplog.rs`. In some storage engine versions, DDL command transformations strip application comments.
> Therefore, **comment preservation in `local.oplog.rs` is formally classified as an UNVERIFIED ARCHITECTURAL HYPOTHESIS** until empirically proven on the actual target MongoDB 8.0 replica set deployment via verification test **`D38-21`**.
> If live testing demonstrates that MongoDB 8.0 strips `comment` from `dropDatabase` oplog records, automatic reconciliation via oplog correlation is technically impossible. In that event, `CONFIRM_CLEANED` is disabled entirely, and all ambiguous drops remain permanently `QUARANTINED`.

#### 3. Critical Reality: `local` Database Ignores Read Concern
MongoDB documentation explicitly dictates:
> *The `local` database does not support read concern. Queries against the `local` database silently ignore configured read concerns.*
Querying `local.oplog.rs` with `readConcern: { level: "majority" }` **does NOT provide majority-read protection**. Durability must be established programmatically by comparing the oplog entry's OpTime against the cluster's majority commit point returned by `replSetGetStatus`.

#### 4. Primary Verification and Election Term Consistency
1. Executor queries `db.adminCommand({ hello: 1 })` on the target connection.
2. The node must confirm `isWritablePrimary === true`.
3. The current election term `topologyVersion` and `electionId` are recorded.
4. If a primary election or stepdown occurred during query execution, the read is aborted.

#### 5. Establishing Majority Commitment via `replSetGetStatus`
In MongoDB 8.0, the replica set's majority commit point is extracted from `replSetGetStatus`:
```javascript
const status = await adminDb.command({ replSetGetStatus: 1 });
const lastCommitted = status.optimes.lastCommittedOpTime;
```

##### Lexicographical OpTime Comparison Logic:
An OpTime is an ordered 2-tuple $(t, ts)$ where $t$ is the election term (`Long`) and $ts$ is the BSON Timestamp (`Timestamp`).
An oplog entry $E = (t_E, ts_E)$ is majority committed if and only if it lexicographically precedes or equals the cluster's `lastCommittedOpTime` $C = (t_C, ts_C)$:
$$\\text{IsMajorityCommitted}(E, C) \\iff (t_E < t_C) \\lor (t_E == t_C \\land ts_E \\le ts_C)$$
Only when $\\text{IsMajorityCommitted}(E, C)$ evaluates to `true` has the drop achieved cluster-wide persistence.

#### 6. Oplog Retention and Rollover Detection
1. The executor queries the oldest available record in `local.oplog.rs`.
2. **Rollover Rule:** If `oldestTs > wireDispatchedAt`, an oplog rollover occurred between dispatch and reconciliation. Conclusive evidence was evicted.
3. When rollover is detected, **`CONFIRM_CLEANED` is STRICTLY FORBIDDEN**. The request must remain permanently in `QUARANTINED`.

#### 7. Mandatory Live Evidence Checklist
To authorize `CONFIRM_CLEANED`, all six evidence assertions must evaluate to `TRUE`:
1. **Target Namespace Match:** `ns === `${targetDatabaseName}.$cmd`` and `o.dropDatabase === 1`.
2. **Cryptographic Correlation Match:** `JSON.parse(o.comment).requestId === originalRequestId` and `JSON.parse(o.comment).payloadHash === originalPayloadHash`.
3. **Temporal Consistency:** $\\text{wireDispatchedAt} - 1000\\text{ms} \\le \\text{entry.wall} \\le \\text{reconcileRequestedAt}$.
4. **Majority Commitment Proven:** $\\text{IsMajorityCommitted}(E, C) === \\text{true}$ against `optimes.lastCommittedOpTime`.
5. **No Rollover:** `oldestOplogTs <= wireDispatchedAt`.
6. **Primary Stability:** Queried node confirmed active primary throughout evidence extraction.

---

## 11. Administrative Reconciliation Design

### 11.1 Authentication & Operator Identity
- **Operator Identity:** Established via an independent **Administrative Key Pair** (`ADMIN_OPERATOR` role) held only by designated Site Reliability Engineers (SRE).
- **Mandatory Narrative Reason:** Every reconciliation request must provide a narrative explanation ($\\ge 15$ characters) and an operational ticket ID (e.g. `OPS-8472`).
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
1. **Verification of Authority:** Ed25519 signature verified against `ADMIN_OPERATOR` key ring.
2. **Target Scope Check:** Target database must conform to canonical test naming convention.
3. **Action Execution:**
   - **`QUARANTINE`:** Transitions ledger state to `QUARANTINED`, permanently retains `dropExecutionLock: true`, marks database namespace poisoned in `ownership_locks`, and terminates worker sessions. NO wire drop is dispatched.
   - **`CONFIRM_CLEANED`:** Allowed only if all criteria of Section 10.4 are satisfied. Rejects with HTTP 422 if evidence is missing or unverified.
4. **Audit Record:** Appended to `cleanup_audit_log` with SHA-256 hash chaining.

### 11.4 Residual Operational Consequence
Under this fail-closed architecture, ambiguous requests remain in `QUARANTINED` indefinitely. In automated test environments, this has **zero operational impact** because subsequent runs generate unique database names using fresh UUIDs (`decision_os_test_${runId}_w${workerId}`). **Safety takes absolute precedence over automatic database namespace recycling.**

---

## 12. Test and Benchmark Migration Matrix for CS-01–CS-17

| Call-Site ID | File & Line in Baseline | Current Baseline Code | Remediation & Replacement Mechanism | Verification Method |
|---|---|---|---|---|
| **CS-01** | `apps/api/src/db/guard.ts:251` | `const rawNativeDrop = db.dropDatabase.bind(db);` | **Delete monkey-patch.** Worker connections natively lack `dropDatabase` permission in MongoDB RBAC. Remove `rawNativeDrop` binding entirely. | Verification Test `D38-01`, Static AST Scan `D38-11` |
| **CS-02** | `apps/api/src/db/guard.ts:258` | `return rawNativeDrop();` in `activeSupervisedDropContext` | **Delete bypass.** Eliminate `activeSupervisedDropContext` entirely. In-process context can no longer unlock native drop. | Verification Test `D38-02`, Static AST Scan `D38-11` |
| **CS-03** | `apps/api/src/db/guard.ts:307` | `return rawNativeDrop();` in `isVerifiedCleanupLocked` | **Delete bypass.** Eliminate local metadata inspection bypass. No client-side bypass permits raw drop execution. | Verification Test `D38-03`, Static AST Scan `D38-11` |
| **CS-04** | `apps/api/src/db/guard.ts:318` | `connection.dropDatabase = async () => cleanupTestDatabase(...)` | **Replace monkey-patch with client proxy.** `cleanupTestDatabase()` delegates to `CleanupExecutorClient.requestCleanup()`, transmitting an Ed25519-signed request to `apps/cleanup-executor`. | Verification Test `D38-04`, Integration Test `npm run test:api` |
| **CS-05** | `apps/api/src/db/guard.ts:1376` | `await db.dropDatabase();` in `SupervisedCleanupExecutor` | **Move execution to external service.** Delete `SupervisedCleanupExecutor` from `guard.ts`. Move physical drop execution to `apps/cleanup-executor/src/executor.ts`. | Verification Test `D38-05`, Static AST Scan `D38-11` |
| **CS-06** | `apps/api/src/db/guard.ts:1487` | `await client.db(dbName).dropDatabase();` in `reconcileTestDatabaseCleanup` | **Route reconciliation through external executor.** Replace direct drop with `CleanupExecutorClient.submitReconciliation()` using admin key. Redispatch dropped. | Verification Test `D38-09`, Integration Test `D38-18` |
| **CS-07** | `scripts/benchmark.ts:170` | `await mongoose.connection.db.dropDatabase();` | **Safe benchmark isolation.** Generate unique test database `decision_os_benchmark_<runId>_test`, register ownership via `POST /v1/ownership/claim`, receive dedicated benchmark credentials, and invoke `CleanupExecutorClient.requestCleanup()`. | Benchmark CLI run, Static AST Scan `D38-11` |
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
Even if dynamic string evaluation (e.g. `db['drop' + 'Database']()`) bypasses pre-commit hooks:
- Test workers authenticate with identities lacking `dropDatabase` and `dropCollection`.
- MongoDB's native authorization engine rejects wire commands with `MongoServerError: not authorized on <db> to execute command { dropDatabase: 1 }` (Code 13).

---

## 14. Architecture Security Review — B38-01 through B38-25

### B38-01: Correct MongoDB Native Privilege Scoping
- **Defect:** Custom role used unsupported wildcard resource `{ db: "decision_os_test_*", collection: "" }`.
- **Resolution:** Adopted Dedicated Isolated Test MongoDB Deployment combined with dynamic per-database roles. Destructive blast radius physically and logically contained.
- **Status:** APPROVED & CLOSED.

### B38-02: Protect Ownership Metadata (Additive Privilege Remediation)
- **Defect:** Worker role granted `{ db: "", collection: "" }` alongside `find` on `ownership_locks`. Because MongoDB privileges are additive, workers retained full write capabilities on ownership metadata.
- **Remediation (Phase B.2):** Worker base role completely stripped of `{ db: "", collection: "" }`. Workers receive exact per-database roles provisioned dynamically by the Cleanup Executor upon `POST /v1/ownership/claim`. Zero write privileges on `ownership_locks`.
- **Status:** REMEDIATED (PHASE B.2) — APPROVED.

### B38-03: Protect the Cleanup Ledger (Additive Privilege Remediation)
- **Defect:** Worker role retained write capability on `cleanup_ledger` due to additive `{ db: "", collection: "" }` grant.
- **Remediation (Phase B.2):** Worker roles contain zero write actions on `decision_os_coordination.cleanup_ledger`. The Cleanup Executor is the authoritative sole writer of ledger state machine transitions. Worker writes fail with MongoDB Error 13.
- **Status:** REMEDIATED (PHASE B.2) — APPROVED.

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
- **Status:** REMEDIATED (PHASE B.2) — APPROVED.

### B38-07: Correct Fencing and Wire-Dispatch Claims (Redispatch Elimination)
- **Defect:** Claimed monotonic generation and pre-wire CAS atomically fences MongoDB `dropDatabase`, and allowed Case D administrative redispatch.
- **Remediation (Phase B.2):** Documented that ledger CAS serializes the transition to `DISPATCHING`, but MongoDB does not enforce application tokens. Completely removed redispatch in Case D. Preserved execution lock on ambiguity.
- **Status:** REMEDIATED (PHASE B.2) — APPROVED.

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
- **Status:** REMEDIATED (PHASE B.3) — APPROVED.

### B38-12: Unsafe MongoDB Role-Management Privileges
- **Defect:** Section 3.2 allowed direct CRUD on internal collections `admin.system.roles` and `admin.system.users` or granted built-in `userAdmin` on `admin` to the cleanup executor, violating least privilege and effectively granting cluster-level superuser rights.
- **Remediation (Phase B.3):** Stripped all direct CRUD on system collections and removed `userAdmin` on `admin`. Established non-superuser role administration using supported MongoDB commands (`createRole`, `createUser`, `dropRole`, `dropUser`, `grantRolesToUser`, `revokeRolesFromUser`, `killAllSessionsByPattern`).
- **Status:** REMEDIATED (PHASE B.3) — APPROVED.

### B38-13: Authoritative Oplog Evidence Is Underspecified
- **Defect:** Section 4.2 / 9.3 allowed administrative `CONFIRM_CLEANED` based on underspecified "oplog proof", without defining correlation mechanisms, replica-set elections, majority commitment, or oplog rollover.
- **Remediation (Phase B.3):** Established Section 10.4 **Authoritative MongoDB 8.0 Replica Set Oplog Drop Evidence Protocol**. Mandatory embedded correlation `comment` in `{ dropDatabase: 1 }` matching request metadata. Majority commitment verification via lexicographical OpTime comparison. Handling of term changes/elections and capped collection rollover. If proof is missing or incomplete, `CONFIRM_CLEANED` is rejected with HTTP 422 and request remains permanently in `QUARANTINED`.
- **Status:** REMEDIATED (PHASE B.3) — APPROVED.

### B38-14: Role Lifecycle and Provisioning Concurrency
- **Defect:** Lacked concurrency analysis of simultaneous claims, partial provisioning failures, credential delivery timeouts, worker crashes, and active connection reuse across role revocation and quarantine.
- **Remediation (Phase B.3):** Analyzed concurrent execution interleavings. Defined retry idempotency, fail-closed rollbacks, and orphan lease reapers. Active connection invalidation enforced via session termination and worker connection pool shutdown.
- **Status:** REMEDIATED (PHASE B.3) — APPROVED.

### B38-15: Correct MongoDB Session Invalidation
- **Defect:** Section 7.5 and Section 16.3 cited `killAllUserConnections`, which does not exist in MongoDB, claimed that session termination closes TCP sockets, and misscoped `killAnySession` to `{ db: "admin", collection: "" }`.
- **Remediation (Phase B.4):** Replaced non-existent commands with supported MongoDB administrative command `killAllSessionsByPattern` targeting the specific worker user on authentication database `admin`. Corrected privilege placement by assigning `killAnySession` and `impersonate` to the `{ cluster: true }` resource. Distinguished logical session invalidation, in-flight operation abort (`killOp`), cursor closure, TCP transport retention, and fresh authentication prevention via `dropUser`.
- **Status:** REMEDIATED (PHASE B.4) — APPROVED.

### B38-16: Make Oplog Evidence Protocol Technically Supportable
- **Defect:** Section 10.4 referenced unsupported response fields (`optimesAndLocations.majorityCommitPoint`), falsely asserted that `readConcern: "majority"` applies to the `local` database, assumed DDL command comments are preserved in `local.oplog.rs`, and failed to define lexicographical OpTime comparison.
- **Remediation (Phase B.4):** Reworked Section 10.4 using exact MongoDB 8.0 documented fields: `optimes.lastCommittedOpTime.ts` and `optimes.lastCommittedOpTime.t` from `replSetGetStatus` on the active primary. Explicitly acknowledged that the `local` database ignores read concern. Formulated strict lexicographical OpTime comparison $(t, ts)$. Formally treated comment preservation as an unverified hypothesis under test (`D38-21`). Removed automatic `CONFIRM_CLEANED` unless live comment preservation is proven; unproven drops remain permanently `QUARANTINED`.
- **Status:** REMEDIATED (PHASE B.4) — APPROVED.

### B38-17: Define Crash-Safe Ephemeral Credential Recovery (Refined Phase B.5 & Corrected Phase B.6)
- **Defect:** Idempotent claim redelivery was claimed, but generated passwords were held only in volatile executor memory, while MongoDB stores credentials as irreversible SCRAM-SHA-256 verifiers.
- **Remediation (Phase B.4 / B.5 / B.6):** Formulated a crash-safe credential recovery protocol utilizing a **Caller-Bound Encrypted Credential Envelope** (`ownership_locks.credentialEnvelope`).
  - **Refinements in Phase B.5 & B.6:**
    1. Defined 256-bit envelope key lifecycle, KMS/Vault storage, and injection into the Provisioning Service.
    2. Corrected in Phase B.6 via NIST SP 800-38D Section 8.2.1 deterministic block reservation protocol on `rs_coord:27019` (Finding B38-28), eliminating birthday collision vulnerabilities.
    3. Established key rotation protocol with `keyVersion` tagging and dual-key decryption support.
    4. Enforced exact durable acknowledgement ordering: worker verifies connectivity via `{ ping: 1 }` $\\rightarrow$ worker sends signed activation handshake $\\rightarrow$ provisioner commits `ACTIVATED` with majority write concern $\\rightarrow$ provisioner executes atomic `$unset: { credentialEnvelope: 1 }` with majority write concern $\\rightarrow$ HTTP 200 confirmation delivered.
- **Status:** REMEDIATED (PHASE B.6) — PENDING INDEPENDENT REVIEW.

### B38-18: Replace False Provisioning Atomicity Claims (Refined Phase B.5)
- **Defect:** The architecture described separate `createRole` and `createUser` commands while claiming overall lifecycle atomicity. In MongoDB, administrative commands cannot run within multi-document ACID transactions.
- **Remediation (Phase B.4 / B.5):** Replaced false atomicity claims with a **Durable Idempotent Provisioning Saga**.
  - **Refinements in Phase B.5:**
    1. Reconciled conflicting state counts and formally cataloged **all 12 distinct states** (`CLAIM_PENDING`, `ROLE_CREATING`, `ROLE_CREATED`, `USER_CREATING`, `USER_CREATED`, `ROLE_ASSIGNED`, `CREDENTIAL_ENCRYPTED`, `CREDENTIAL_DELIVERED`, `ACTIVATED`, `ROLLING_BACK`, `ROLLED_BACK`, `ORPHAN_RECOVERY`).
    2. Documented deterministic recovery rules for crashes occurring at every single transition.
    3. Specified exponential backoff retry for failed rollback compensations.
    4. Formalized strict 4-point verification proof before the orphan reaper deletes any user or role.
- **Status:** REMEDIATED (PHASE B.5) — APPROVED.

### B38-19: Make the Audit Ledger Genuinely Tamper-Evident (Refined Phase B.5)
- **Defect:** The executor possessed `update`, `remove`, and `findAndModify` privileges across all coordination collections, including `cleanup_audit_log`, making claims of "immutable" audit logging unfounded.
- **Remediation (Phase B.4 / B.5):**
  - Separated audit log privileges from coordination CRUD. Scoped privileges on `cleanup_audit_log` strictly to append-only actions: `find`, `insert`, and `createIndex`.
  - **Refinements in Phase B.5:**
    1. Reconciled broad drop privileges with audit append-only boundary by isolating audit logs to `mongodb-coord:27019` where destructive cleanup has zero access.
    2. Defined independent Ed25519 checkpoint signing by the Audit Service.
    3. Specified strict checkpoint cadence (60s periodic + terminal milestones `CLEANED` / `QUARANTINED`).
    4. Established monotonic sequence linking and crash recovery verification against external WORM storage.
    5. Configured fail-closed executor hard freeze upon any hash chain verification mismatch.
- **Status:** REMEDIATED (PHASE B.5) — APPROVED.

### B38-20: Separate Destructive Authority from Coordination and Audit Data (Finding B38-20)
- **Defect:** The cleanup executor possessed `{ resource: { db: "", collection: "" }, actions: ["dropDatabase", "dropCollection", "listCollections", "find"] }` on the same deployment as `decision_os_coordination` and `cleanup_audit_log`. Because MongoDB RBAC evaluates permissions additively without negative filters, an identity with `{ db: "", collection: "" }` drop privileges can drop coordination metadata and the audit log itself. Application-level regex guards cannot serve as a database-enforced security boundary.
- **Remediation (Phase B.5):** Architecture establishes a **Strict Physical/Logical Two-Deployment Boundary**:
  - **Coordination & Audit Cluster (`mongodb-coord:27019`):** Dedicated replica set hosting `decision_os_coordination` (`ownership_locks`, `cleanup_ledger`, `provisioning_saga`) and `cleanup_audit_log`. The destructive identity possesses zero network reachability and zero authentication credentials on this cluster.
  - **Ephemeral Test Database Cluster (`mongodb-test:27018`):** Dedicated replica set hosting dynamic test databases (`decision_os_test_*`). The Destructive Cleanup Executor (`decision_os_destructive_executor`) is scoped strictly to this cluster. Because coordination and audit databases do not reside on `mongodb-test`, it is mathematically impossible for destructive cleanup to drop coordination or audit storage.
- **Status:** REMEDIATED (PHASE B.5) — APPROVED.

### B38-24: Restrict Role Provisioning Authority & Eliminate False Native Claims (Finding B38-24)
- **Defect:** The v1.4.0 architecture claimed that application-level AST checks in `provisioner.ts` constituted MongoDB-native RBAC enforcement, while granting `createRole`, `createUser`, and `grantRole` on `admin`. In MongoDB, roles created on `admin` can contain privileges spanning any database and cluster resources. Furthermore, destructive cleanup authority was co-located with provisioning authority.
- **Remediation (Phase B.5):**
  - Explicitly disclaimed that application-level regex/AST filtering constitutes MongoDB-native enforcement.
  - Decoupled provisioning authority from destructive cleanup: established an independent **Provisioning Service** (`decision_os_provisioner`), completely separate from the **Destructive Cleanup Executor** (`decision_os_destructive_executor`).
  - Dynamically provisioned worker roles are created **directly on the target test database** (`db.getSiblingDB(targetTestDb).createRole(...)`). In MongoDB RBAC, roles defined on a non-admin database are natively prohibited by the database engine from granting privileges outside that database or on cluster resources.
  - Formulated independent threat models for compromised provisioner, cleanup executor, API process, and administrative operator. Added adversarial verification test **`D38-26`**.
- **Status:** REMEDIATED (PHASE B.5) — APPROVED.

### B38-25: Establish Permanent Worker Revocation & Hostile Worker Defense (Finding B38-25)
- **Defect:** The v1.4.0 architecture relied on `killAllSessionsByPattern` and client-side `client.close(true)`. Client-side pool closure is a cooperative client action, not an enforceable security boundary. Furthermore, `killAllSessionsByPattern` does not sever physical TCP connections, ignores prepared distributed transactions, and misses unsessioned wire operations.
- **Remediation (Phase B.5):**
  - Documented the exact engine limitations of `killAllSessionsByPattern`.
  - Explicitly handled prepared transactions: scanning `currentOp` for prepared transactions and coordinating aborts prior to teardown.
  - Designed a fail-closed multi-layer revocation protocol that defends against hostile workers that deliberately retain TCP sockets:
    1. Abort in-flight operations via `killOp` and logical session termination.
    2. Server-side identity revocation via `dropUser` and `dropRole` on the target test database.
    3. Engine-level authorization cache invalidation: subsequent commands issued over lingering TCP sockets fail authorization immediately with MongoDB Error Code 11 (`UserNotFound`) or Code 13 (`Unauthorized`).
    4. Prevention of fresh authentication attempts (Code 11 / Code 18).
    5. Network container isolation policies severing transport paths.
  - Added hostile-worker adversarial verification test **`D38-27`**.
- **Status:** REMEDIATED (PHASE B.5) — APPROVED.

### B38-26: Eliminate Cross-Database Provisioning Authority (Phase B.6)
- **Defect:** Section 7.6 granted `decision_os_provisioner` the actions `createRole`, `dropRole`, `createUser`, `dropUser`, `grantRole`, `revokeRole`, and `changePassword` across `{ db: "", collection: "" }` on `rs_test`. Although roles defined on non-admin databases cannot grant privileges on other databases, this grant authorized the central provisioner to manage principals across any and all non-admin databases. A compromised provisioner could manipulate principals in another worker's database, breaking per-worker multi-tenant isolation.
- **Remediation (Phase B.6):**
  1. Removed unrestricted cross-database user and role administration from `decision_os_provisioner`. The central identity has zero user/role management rights on `rs_test`.
  2. Established the **Database-Scoped Provisioning Delegation Model**: dynamic roles and ephemeral worker users are provisioned exclusively through per-target-database scoped administrative identities (`decision_os_db_admin_${dbName}`) whose authorization scope is strictly constrained to `{ db: targetTestDb, collection: "" }`.
  3. Defined initial authority provisioning without central unrestricted privileges via pre-allocated partition slot pools (minted during cluster bootstrap by an offline container whose credentials terminated prior to runtime) and on-demand expansion via an isolated ephemeral scoped credential broker.
  4. Explicitly distinguished the four authorization scopes: role-definition scope, role-management authorization scope, user-management authorization scope, and role-grant authorization scope.
  5. Added adversarial verification test **`D38-29`**.
- **Status:** REMEDIATED (PHASE B.6) — PENDING INDEPENDENT REVIEW.

### B38-27: Reconcile Revocation Service Responsibilities (Phase B.6)
- **Defect:** Section 7.9 instructed `decision_os_destructive_executor` to execute `dropUser` and `dropRole` directly on the target test database. However, the privilege matrix (Section 7.6) explicitly prohibited the destructive executor from executing `dropUser` and `dropRole` (assigning them to the provisioner), creating an irreconcilable architectural contradiction that would fail with MongoDB Error Code 13 (`Unauthorized`).
- **Remediation (Phase B.6):**
  1. Defined an executable, internally consistent, durable 2-phase revocation protocol.
  2. Partitioned responsibilities strictly according to authorized MongoDB identities: `dropUser` and `dropRole` are executed strictly by the Scoped Provisioning Service (authenticating as `decision_os_db_admin_${targetTestDb}`), while in-flight operation abort (`killOp`), logical session termination (`killAllSessionsByPattern`), and prepared transaction resolution are executed by the Destructive Cleanup Executor (`decision_os_destructive_executor`).
  3. Specified an executable operation allocation matrix resolving responsible service, required MongoDB identity, exact privilege, target deployment/database, required acknowledgement, retry/crash recovery, and fail-closed conditions for all 8 operations.
  4. Reconciled coordination through signed mutual TLS order `POST /v1/provisioning/revoke-worker` with majority write concern acknowledgement before wire drop dispatch.
  5. Formally rejected client API responses and client-side connection closure as proof of revocation.
  6. Added adversarial verification test **`D38-30`**.
- **Status:** REMEDIATED (PHASE B.6) — PENDING INDEPENDENT REVIEW.

### B38-28: Correct AES-256-GCM Nonce Uniqueness (Phase B.6)
- **Defect:** Section 7.10 constructed nonces as `InstanceSalt (32-bit random) || MonotonicCounter (64-bit in-memory)`. The counter resets to 0 on restart. Under the birthday paradox, a 32-bit random salt incurs a 50% collision probability after only $2^{16} = 65,536$ process instances or replicas sharing the same key. A salt collision across restarts or concurrent replicas results in identical nonces under the same AES-256-GCM key, completely breaking GCM cryptographic confidentiality and authenticity.
- **Remediation (Phase B.6):**
  1. Replaced the flawed in-memory construction with a **Durable Globally Coordinated Counter Range Block Reservation Protocol** adhering to NIST SP 800-38D Section 8.2.1 Deterministic Construction.
  2. Nonce layout: $\text{IV} = \text{KeyVersionPrefix}_{16\text{-bit}} \parallel \text{AllocatedRangeBlock}_{32\text{-bit}} \parallel \text{MonotonicCounter}_{48\text{-bit}}$.
  3. Replicas lease non-overlapping blocks of counters ($2^{20}$ nonces) via atomic `$inc` on `decision_os_coordination.nonce_allocations` on `rs_coord:27019` with majority write concern (`w: "majority", j: true`).
  4. Addressed all 9 required operational invariants: concurrent replicas, crash/restart discarding, counter rollback prevention, linearizable atomic allocation, key-version separation in AAD and IV, database backup disaster recovery (epoch bump + mandatory key rotation), counter exhaustion ceilings ($2^{48}$ invocations), fail-closed halt when allocation state is unreachable, and container startup readiness gating.
  5. Provided formal mathematical proof that $P(\text{collision}) = 0$.
  6. Added adversarial verification test **`D38-28`**.
- **Status:** REMEDIATED (PHASE B.6) — PENDING INDEPENDENT REVIEW.

### B38-31: Bootstrap Broker Must Have an Explicit Security Boundary (Phase B.7)
- **Defect:** The architecture introduced an offline bootstrap container (`deploy/init-mongo-test.sh`), pre-allocated partition slot pools, and an isolated ephemeral credential broker enclave (`apps/credential-broker`), but their exact MongoDB identities, privileges, credential custody, and compromise boundaries were absent from the privilege matrix. Furthermore, provisioner access to pre-allocated partition slots was insufficiently bounded, risking bulk credential retrieval if the provisioner was compromised.
- **Remediation (Phase B.7):**
  1. Added every bootstrap and broker identity (`decision_os_offline_bootstrap`, `decision_os_credential_broker`) to the MongoDB privilege matrix (Section 7.6).
  2. Defined exact MongoDB privileges for the broker: `{ resource: { db: "", collection: "" }, actions: ["createUser", "dropUser", "createRole", "dropRole", "grantRole", "revokeRole", "changePassword", "getRole", "getUser"] }` on `rs_test`. Explicitly prohibited `dropDatabase`, `dropCollection`, application CRUD, and all system DB (`admin`, `config`, `local`) or cluster actions.
  3. Bounded the broker against arbitrary database administration: Enclave network isolation (zero routes/creds on `rs_coord`), single-endpoint API `POST /v1/broker/mint-scoped-admin` requiring an Ed25519-signed ownership claim, target database regex validation (`^decision_os_test_[a-zA-Z0-9_-]+$`), authority binding strictly to `{ db: targetDatabase, collection: "" }`, 60-second ephemeral TTL, and SHA-256 audit chaining.
  4. Specified Partition Slot Vault (`apps/slot-vault`) enforcing path-based ACLs (`secret/data/decision-os/slots/slot_${id}`), blocking bulk slot retrieval (`list` denied). The provisioner can only lease a single slot at a time by presenting an active lease token from `rs_coord:27019.ownership_locks`.
  5. Formally defined offline bootstrap credential destruction (`shred -u` of tmpfs `/tmp/bootstrap_admin.key` on container completion) and air-gapped emergency recovery protocol (2-of-3 SRE Shamir's secret sharing).
  6. Updated threat models to include compromised broker, compromised bootstrap process, and compromised secrets engine.
  7. Added adversarial verification test **`D38-31`**.
- **Status:** REMEDIATED (PHASE B.7) — PENDING INDEPENDENT REVIEW.

### B38-32: Protect Nonce Allocation State from Unauthorized Reset (Phase B.7)
- **Defect:** The v1.6.0 privilege matrix granted the central provisioner `update` access to `nonce_allocations`. A compromised provisioner could potentially issue `$set: { nextBlockStart: 0 }` or overwrite allocation state, invalidating the nonce uniqueness guarantee and causing catastrophic AES-256-GCM IV reuse. The application using `$inc` did not prevent another authorized update from using `$set`.
- **Remediation (Phase B.7):**
  1. Separated nonce allocation authority entirely from the general provisioning service into an independent **Nonce Allocation Service** (`apps/nonce-allocator`, running identity `decision_os_nonce_allocator`) on `rs_coord:27019`.
  2. Stripped `decision_os_provisioner` of all write/update access to `nonce_allocations`. The central provisioner cannot execute `insert`, `update`, or `remove` on the collection.
  3. Defined exact allocator MongoDB privileges: `actions: ["find", "insert", "update", "createIndex"]` on `decision_os_coordination.nonce_allocations`. Prohibited `remove`, `dropCollection`, and `dropDatabase`.
  4. Restricted allocator implementation: API `POST /v1/nonce/lease-block` over mTLS contains zero `$set` code paths for `nextBlockStart`, executing exclusively atomic `$inc` with majority write concern (`w: "majority", j: true`).
  5. Pre-initialized sequence document `nonce_seq_v1` via offline bootstrap before concurrent allocation begins.
  6. Handled duplicate-key errors (Code 11000) gracefully during key version rotation with idempotent retry.
  7. Formally defined exact 96-bit nonce encoding: $\text{IV} = \text{KeyVersionPrefix}_{16\text{-bit}} \parallel \text{AllocatedRangeBlock}_{32\text{-bit}} \parallel \text{MonotonicCounter}_{48\text{-bit}}$ (12 bytes), with BSON `NumberLong` numeric types, $2^{48}$ counter exhaustion ceiling, block boundary pause/fetch, and key-version domain separation without prefix reuse.
  8. Qualified the mathematical collision-free guarantee ($P(\text{collision}) = 0$) with explicitly stated trust assumptions (key custody integrity, majority journaled consensus linearizability, allocator code integrity, and backup restore epoch bumping).
  9. Added adversarial verification test **`D38-32`**.
- **Status:** REMEDIATED (PHASE B.7) — PENDING INDEPENDENT REVIEW.

### B38-33: Correct MongoDB killOp Privilege Scope (Phase B.7)
- **Defect:** The v1.6.0 privilege matrix assigned `killOp` to resource `{ db: "admin", collection: "" }`. While the MongoDB command `killOp` is issued against the admin database (`admin.$cmd`), MongoDB's documented authorization model scopes the privilege action for terminating other users' operations strictly to the cluster resource: `{ resource: { cluster: true }, actions: ["killop", "inprog"] }`. Assigning `killOp` to `{ db: "admin", collection: "" }` was an invalid privilege definition that would fail on MongoDB 8.0.
- **Remediation (Phase B.7):**
  1. Corrected the privilege matrix and operation matrix to use the documented action and resource pairing: `{ resource: { cluster: true }, actions: ["killop", "inprog", "killAnySession", "impersonate", "checkCursorSanity"] }`.
  2. Used exact MongoDB privilege action spelling (`killop`, `inprog` in lowercase).
  3. Explicitly distinguished command execution database (`admin.$cmd`) from authorization resource scope (`{ cluster: true }`).
  4. Removed the unsupported `{ db: "admin", collection: "" }` grant from the destructive executor, ensuring the executor receives no unnecessary cluster privileges (no `grantRole`, `shutdown`, or `replSetReconfig`).
  5. Verified all commands in the executor's operation matrix against native MongoDB 8.0 privilege action definitions.
  6. Added adversarial verification test **`D38-33`**.
- **Status:** REMEDIATED (PHASE B.7) — PENDING INDEPENDENT REVIEW.

### B38-34: Correct MongoDB Privilege Action Definitions (Phase B.7)
- **Defect:** The v1.6.0 privilege matrix used `findAndModify` as if it were a standalone MongoDB privilege action. In MongoDB RBAC, `findAndModify` is a command name, not a privilege action. MongoDB authorizes `findAndModify` through the relevant underlying actions: `find` and `update` (for update operations), `find`, `update`, and `insert` (for upserts), and `find` and `remove` (for remove operations).
- **Remediation (Phase B.7):**
  1. Removed `findAndModify` from all privilege action lists across the document.
  2. Audited every identity and resource in the privilege matrix, replacing invalid command names with actual MongoDB 8.0 privilege actions (`find`, `insert`, `update`, `remove`, `createIndex`, `dropDatabase`, `dropCollection`, `createRole`, `dropRole`, `createUser`, `dropUser`, `grantRole`, `revokeRole`, `inprog`, `killop`, `killAnySession`, `impersonate`, `listDatabases`).
  3. Clarified that denying `update` and `remove` on `cleanup_audit_log` natively prevents `findAndModify` write and delete mutations.
  4. Added negative authorization verification test **`D38-34`** asserting rejection of commands when underlying actions are withheld.
- **Status:** REMEDIATED (PHASE B.7) — PENDING INDEPENDENT REVIEW.

### B38-35: Integrate Network Transport Fencing into the Durable Revocation Protocol (Phase B.7)
- **Defect:** Network transport fencing was described as an orchestrator/CNI operation, but the durable revocation handoff did not actually invoke or acknowledge that operation. The cleanup executor proceeded directly to identity deletion and database drop without waiting for or verifying network transport isolation.
- **Remediation (Phase B.7):**
  1. Formally integrated **Network Transport Fencing** as Step 2 of the durable revocation protocol.
  2. Defined the exact orchestrator/CNI identity: `decision_os_network_fence_controller` on the infrastructure plane.
  3. Defined the control-plane operation: `POST /v1/orchestrator/fence-worker` or Kubernetes API `PATCH NetworkPolicy` targeting worker pod labels (`decision-os.io/run-id: runA`, `decision-os.io/worker-id: wA`).
  4. Specified policy scope: Complete layer-3/4 egress packet drop targeting `mongodb-test:27018` and `mongodb-coord:27019`.
  5. Established synchronous data plane verification (`iptables -C` or CNI netfilter check) before the controller returns HTTP 200 `{ ok: 1, fenced: true }`.
  6. Defined retry backoff (1s, 2s, 4s) and fail-closed halt: If network fencing cannot be verified within 15s, teardown halts, the request transitions to `OUTCOME_UNKNOWN` / `QUARANTINED`, and execution locks are permanently retained.
  7. Formally distinguished all 6 layers of isolation (logical session invalidation, server-side user deletion, operation cancellation, physical TCP socket retention, network transport isolation, database deletion) and mandated that `dropDatabase` is never represented as network fencing.
  8. Reconciled revocation ordering across the operation allocation matrix, sequence diagram, state machine table, saga transitions, and recovery protocol.
  9. Expanded `D38-30` and added adversarial verification test **`D38-35`**.
- **Status:** REMEDIATED (PHASE B.7) — PENDING INDEPENDENT REVIEW.

---

## 15. Threat Model & Required Adversarial Analysis

### 15.1 Compromised-Actor Threat Model
To establish defense-in-depth, Decision OS analyzes the compromise of five system actors independently:

#### 1. Compromised Test Worker (Hostile Worker Threat Model — B38-25)
- **Attacker Profile:** An attacker achieves arbitrary code execution inside a test worker thread or CI container (`Worker A`).
- **Adversarial Capabilities:** The attacker holds the worker's ephemeral credentials, Ed25519 private key, active TCP sockets to `mongodb-test:27018`, and V8 process memory.
- **Hostile Actions Attempted:**
  1. *Refusal of Cooperative Closure:* The attacker deliberately ignores or bypasses `client.close(true)`.
  2. *Socket Retention & Evasion:* The attacker maintains open TCP connections in the driver pool and attempts to issue writes over existing sockets after teardown or quarantine has been triggered.
  3. *Cross-Database Tampering:* The attacker attempts CRUD against Worker B's database (`decision_os_test_runB_wB`).
  4. *Direct Coordination Attacks:* The attacker attempts to connect to `mongodb-coord:27019` to overwrite `ownership_locks` or erase audit history.
  5. *Fresh Authentication Attempts:* The attacker attempts to establish new connections using previously delivered credentials.
- **Enforcement & Containment:**
  - Operations on lingering sockets fail natively with MongoDB Error Code 11 (`UserNotFound`) or Code 13 (`Unauthorized`) due to server-side `dropUser` and authorization cache invalidation.
  - Cross-database queries fail natively with Code 13 (role scoped strictly to Worker A's DB).
  - Network reachability to `mongodb-coord:27019` is blocked by container firewall policies; commands fail at TCP handshake.
  - Fresh authentication attempts fail at SCRAM-SHA-256 handshake with Code 11 or Code 18.

#### 2. Compromised Destructive Cleanup Executor (B38-20)
- **Attacker Profile:** An attacker compromises the `apps/cleanup-executor` container (e.g. via dependency vulnerability or supply-chain flaw).
- **Adversarial Capabilities:** Holds `decision_os_destructive_executor` credentials on `mongodb-test:27018`. Possesses `{ resource: { db: "", collection: "" }, actions: ["dropDatabase", ...] }` on `rs_test`.
- **Hostile Actions Attempted:**
  1. *Destruction of Coordination & Audit Storage:* The attacker attempts `db.getSiblingDB("decision_os_coordination").dropDatabase()` or `db.getSiblingDB("decision_os_coordination").cleanup_audit_log.drop()`.
  2. *Superuser Escalation:* The attacker attempts `createRole` or `createUser` to grant `root` privileges.
  3. *Cross-Deployment Network Attack:* The attacker attempts to route traffic to `mongodb-coord:27019`.
- **Enforcement & Containment:**
  - Because `decision_os_coordination` and `cleanup_audit_log` are **not hosted on `mongodb-test`**, `dropDatabase` on `rs_test` returns `{ ok: 1, dropped: 0 }` (no-op). Coordination and audit data are physically and logically untouched.
  - Network egress policies block TCP connections from `cleanup-executor` to `mongodb-coord:27019`. The executor possesses zero credentials on `rs_coord`.
  - MongoDB RBAC on `rs_test` denies `createRole` and `createUser` to the executor (Code 13), preventing role escalation.

#### 3. Compromised Provisioning Service (B38-24, B38-26)
- **Attacker Profile:** An attacker compromises the `apps/provisioner` container.
- **Adversarial Capabilities:** Holds `decision_os_provisioner` credentials on `mongodb-coord:27019` and has access to in-flight scoped database administrative credentials (`decision_os_db_admin_${targetDb}`) on `mongodb-test:27018`.
- **Hostile Actions Attempted:**
  1. *Cross-Database Principal Tampering (B38-26):* Attacker attempts to use `decision_os_provisioner` or a captured scoped credential for DB A (`decision_os_db_admin_runA_wA`) to create users, reset passwords, or drop roles on Worker B's database (`decision_os_test_runB_wB`).
  2. *Cluster-Wide Role Creation:* Attacker attempts to create a custom role on `admin` granting `{ resource: { anyResource: true }, actions: ["anyAction"] }` or `root`.
  3. *Destructive Dropping:* Attacker attempts to drop test databases or coordination databases.
  4. *Audit Log Erasure:* Attacker attempts to update or delete historical records in `cleanup_audit_log`.
- **Enforcement & Containment:**
  - `decision_os_provisioner` possesses **zero** `{ db: "", collection: "" }` role- or user-management privileges on `rs_test`. Direct admin attempts fail with Error Code 13.
  - The scoped administrative credential `decision_os_db_admin_runA_wA` is restricted by MongoDB RBAC strictly to `decision_os_test_runA_wA`. Any command targeting `decision_os_test_runB_wB` fails with MongoDB Error Code 13.
  - MongoDB RBAC restricts role definitions on non-admin databases from granting privileges outside that specific database. Attempts to define cross-database privileges are rejected natively by the MongoDB daemon.
  - The provisioner possesses zero `dropDatabase` or `dropCollection` privileges on both `rs_test` and `rs_coord` (Code 13).
  - The provisioner has zero write privileges on `cleanup_audit_log` (Code 13).

#### 4. Compromised API Process
- **Attacker Profile:** An attacker compromises the unprivileged API server process.
- **Containment:** API workers possess zero privileged credentials. Destructive operations must be requested via Ed25519-signed HTTP calls to the isolated cleanup executor. Worker connections lack `dropDatabase` in MongoDB RBAC. Direct wire attacks fail with Code 13.

#### 5. Compromised Administrative Operator
- **Attacker Profile:** An attacker obtains an SRE administrative key pair.
- **Containment:** Administrative reconciliation interface contains **zero drop capabilities**. Operator signatures can only transition requests to `QUARANTINED` (permanently retaining execution locks) or `CONFIRM_CLEANED` (which strictly requires demonstrable, committed server oplog proof per Section 10.4). No administrative command can force redispatch or delete active data.

#### 6. Compromised Ephemeral Credential Broker (Finding B38-31)
- **Attacker Profile:** An attacker achieves arbitrary code execution inside the `apps/credential-broker` enclave.
- **Adversarial Capabilities:** Possesses `decision_os_credential_broker` credentials on `rs_test:27018`.
- **Hostile Actions Attempted:**
  1. *Database Dropping:* Attacker attempts `db.getSiblingDB("decision_os_test_runB_wB").dropDatabase()`.
  2. *System Database Tampering:* Attacker attempts `createUser` on `admin` to gain `root` or cluster-wide roles.
  3. *Coordination Storage Attack:* Attacker attempts TCP connection to `rs_coord:27019`.
- **Enforcement & Containment:**
  - Broker possesses zero `dropDatabase` or `dropCollection` privileges on `rs_test` (Code 13).
  - Broker privileges are scoped strictly to `{ db: "", collection: "" }`, which in MongoDB RBAC excludes `admin`, `config`, and `local` (Code 13).
  - Enclave network egress policies block all traffic to `rs_coord:27019`. Broker holds zero coordination credentials.
  - Broker cannot mint credentials for unapproved namespaces because client requests must conform to canonical regex and signed claims.

#### 7. Compromised Offline Bootstrap Process (Finding B38-31)
- **Attacker Profile:** An adversary compromises the initialization image `deploy/init-mongo-test.sh` before cluster deployment.
- **Containment:** Bootstrap container executes strictly offline during infrastructure provisioning, prior to public ingress availability. Temporary administrative credentials exist solely in RAM/tmpfs and are shredded (`shred -u`) prior to container termination. No bootstrap process remains online during test execution. Emergency recovery requires an air-gapped Shamir's Secret Sharing ceremony (2-of-3 SRE custodians).

#### 8. Compromised Partition Slot Vault / Secrets Engine (Finding B38-31)
- **Attacker Profile:** An adversary gains read access to the secrets engine storing partition slot credentials.
- **Containment:** Partition Slot Vault (`apps/slot-vault`) enforces path-based ACLs denying bulk enumeration (`list` capability blocked). Each slot credential has an ephemeral TTL (60s) and requires an active lease proof in `ownership_locks`. Stolen offline slot credentials cannot be used without an active unexpired lease token committed on `rs_coord:27019`.

#### 9. Compromised Nonce Allocation Service (Finding B38-32)
- **Attacker Profile:** An adversary compromises the `apps/nonce-allocator` microservice.
- **Adversarial Capabilities:** Possesses `decision_os_nonce_allocator` credentials on `rs_coord:27019`.
- **Hostile Actions Attempted:** Attacker attempts to reset `nextBlockStart` to 0 or delete allocation records.
- **Enforcement & Containment:**
  - Nonce Allocator possesses zero network route and zero credentials on `rs_test:27018`.
  - Nonce Allocator is denied `remove`, `dropCollection`, and `dropDatabase` on `rs_coord:27019` by MongoDB RBAC (Code 13).
  - Monotonicity watchdog monitors leased block progression in audit logs. Regressed or duplicate blocks immediately trigger automated KMS emergency key rotation, retiring the compromised key version and invalidating repeated nonces.

#### 10. Compromised Network-Fencing Controller (Finding B38-35)
- **Attacker Profile:** An adversary disables or tampers with the `apps/network-fence-controller`.
- **Containment:** Cleanup Executor requires synchronous data-plane verification of netfilter rules (`iptables -C`) before proceeding to identity deletion. If network fencing fails or times out, the teardown strictly fails closed: execution halts, the request transitions to `QUARANTINED`, and the execution lock is permanently retained. Furthermore, defense-in-depth ensures that even if transport fencing is bypassed, server-side MongoDB `dropUser` and session termination prevent unauthorized wire operations.

---

### 15.2 Explicit Adversarial Analysis Matrix (Scenarios 1–25)

| Scenario ID | Attack Vector / Adversarial Event | Permitted Action | Prohibited Action | Concrete Enforcement Mechanism |
|---|---|---|---|---|
| **Scenario 1** | **Worker attempts direct coordination writes.** Worker executes `db.getSiblingDB("decision_os_coordination").ownership_locks.insertOne({...})`. | Permitted: None. | **PROHIBITED:** Any insert, update, remove on coordination collections. | **Multi-Deployment Isolation & RBAC:** Coordination DB resides on `rs_coord:27019`. Worker has zero network access and zero credentials. |
| **Scenario 2** | **Worker inherits write permissions through another role.** Adversary attempts to leverage role inheritance to gain elevated access. | Permitted: Actions in assigned test DB role. | **PROHIBITED:** Inheriting built-in roles (`root`, `dbAdminAnyDatabase`). | **MongoDB RBAC Engine:** `roles: []` enforced; dynamic role scoped strictly to assigned test DB. |
| **Scenario 3** | **Executor A pauses after entering `DISPATCHING`.** Executor A marks `DISPATCHING`, then pauses 45s before wire write. | Permitted: Executor A may attempt write, fails closed if expired. | **PROHIBITED:** Successor Executor B claiming request or issuing secondary drop. | **State Machine Guard:** `DISPATCHING` is permanently locked. Successor refuses claim. Zero redispatch. |
| **Scenario 4** | **Executor A resumes after operator observes quiescent `currentOp()`.** SRE queries `currentOp`, sees no active drop, attempts action while A wakes up. | Permitted: SRE transitions request to `QUARANTINED`. | **PROHIBITED:** System issuing a second `{ dropDatabase: 1 }`. | **Schema Enforcement:** `forceRedispatch` removed. Reconciliation API has no drop dispatch path. |
| **Scenario 5** | **Delayed wire command arrives after operator observation.** TCP send buffer delays cause drop packet to arrive 30s after observation. | Permitted: MongoDB processes original delayed packet. | **PROHIBITED:** Reusing database name for a new test run while outcome is ambiguous. | **Permanent Execution Lock:** `dropExecutionLock: true` retained in `QUARANTINED`. Namespace poisoned. |
| **Scenario 6** | **Administrator attempts to redispatch an ambiguous request.** Operator submits reconcile trying to force re-drop of residual collections. | Permitted: Transition to `QUARANTINED` or `CONFIRM_CLEANED` (with oplog proof). | **PROHIBITED:** Submitting `forceRedispatch` or issuing secondary drop. | **API Validation:** Schema rejects `forceRedispatch` with HTTP 400. Zero drop capability in reconcile handler. |
| **Scenario 7** | **Executor restarts with an unresolved request.** Cleanup Executor crashes while in `DISPATCHING`. Scanner encounters record. | Permitted: Move expired record to `OUTCOME_UNKNOWN`; fire SRE alert. | **PROHIBITED:** Re-claiming request or re-issuing `{ dropDatabase: 1 }`. | **Crash Recovery Policy:** `wireDispatchedAt !== null` prohibits redispatch. Moves to `OUTCOME_UNKNOWN` with lock held. |
| **Scenario 8** | **Residual collections exist, completion unproven.** Target DB shows collections, but ledger shows `DISPATCHING` and socket severed. | Permitted: Moving request to `QUARANTINED` for forensic inspection. | **PROHIBITED:** Assuming drop failed and issuing another drop. | **Fail-Closed Rule:** Residual collections do not prove delayed command will not execute. Drop prohibited. |
| **Scenario 9 (B38-11)** | **Worker A attempts cross-database CRUD on Worker B's database.** Worker A connects as `worker_runA_wA` and queries `test_runB_wB`. | Permitted: CRUD on `decision_os_test_runA_wA`. | **PROHIBITED:** Any read, write, or index operation on `decision_os_test_runB_wB`. | **MongoDB RBAC Engine:** Principal authenticated on DB A has no role on DB B. Daemon throws Code 13. |
| **Scenario 10 (B38-12)** | **Cleanup Executor attempts to grant cluster superuser rights.** Attacker attempts to call `createRole` granting `root`. | Permitted: None. | **PROHIBITED:** Any role creation by cleanup executor. | **Daemon RBAC:** Executor possesses zero role-creation privileges on `rs_test` (Code 13). |
| **Scenario 11 (B38-13)** | **Admin attempts `CONFIRM_CLEANED` without verified majority oplog proof.** Operator submits reconciliation without committed oplog proof. | Permitted: Submitting reconciliation with verified majority oplog proof or selecting `QUARANTINE`. | **PROHIBITED:** Marking `CLEANED` based on catalog absence or uncommitted oplog entries. | **Oplog Protocol Verification:** Section 10.4 asserts correlation `comment`, timestamp window, and majority commitment. Rejects with HTTP 422. |
| **Scenario 12 (B38-14)** | **Quarantined worker attempts to execute commands using cached credentials.** Quarantined worker issues writes. | Permitted: None. | **PROHIBITED:** Any subsequent operation by quarantined worker. | **Session Invalidation:** Executor drops user/role, executes `killAllSessionsByPattern`. Subsequent commands fail with Code 11/13/18. |
| **Scenario 13 (B38-20)** | **Compromised Destructive Executor attempts to drop coordination database.** Attacker issues `dropDatabase` targeting `decision_os_coordination`. | Permitted: None. | **PROHIBITED:** Destruction or mutation of coordination or audit storage. | **Physical Deployment Separation:** Coordination DB is hosted on `rs_coord:27019`. Command on `rs_test:27018` is a no-op (`dropped: 0`). Network route to `rs_coord` blocked. |
| **Scenario 14 (B38-24)** | **Compromised Provisioner attempts to create a cluster-wide superuser role.** Attacker calls `createRole` with cluster-wide privileges. | Permitted: Creating roles scoped strictly to target test database. | **PROHIBITED:** Creating roles on `admin` or granting privileges on other databases or cluster resources. | **MongoDB Native RBAC Scoping:** Roles defined on non-admin database natively reject cross-database or cluster privileges. Provisioner lacks `userAdmin` on `admin`. |
| **Scenario 15 (B38-25)** | **Hostile Worker retains open TCP sockets and sends write operations post-revocation.** Hostile worker bypasses `client.close(true)` and writes over open socket. | Permitted: None. | **PROHIBITED:** Executing any query or write operation after revocation. | **Authorization Cache Invalidation:** `dropUser` on server invalidates cached connection credentials. MongoDB engine re-evaluates user on next wire command $\\rightarrow$ rejected with Code 11 (`UserNotFound`) or Code 13 (`Unauthorized`). |
| **Scenario 16 (B38-25)** | **Hostile Worker attempts fresh authentication using cached credentials.** Worker initiates new SCRAM handshake using old password. | Permitted: None. | **PROHIBITED:** Establishing new authenticated connections. | **MongoDB Authentication Engine:** User principal deleted from database catalog; handshake rejected with Code 11 or Code 18 (`AuthenticationFailed`). |
| **Scenario 17 (B38-26)** | **Compromised Provisioning Identity attempts cross-database user/role administration.** Attacker uses `decision_os_db_admin_runA_wA` to invoke `createUser` or `changeUserPassword` on `decision_os_test_runB_wB`. | Permitted: Administering users on `decision_os_test_runA_wA`. | **PROHIBITED:** Creating, modifying, or deleting users or roles in any other worker's database. | **Database-Scoped Provisioning Delegation Model:** Identity authorization scope is strictly constrained to `{ db: "decision_os_test_runA_wA", collection: "" }`. MongoDB RBAC natively rejects commands against DB B with Code 13. |
| **Scenario 18 (B38-27)** | **Hostile Worker retains open TCP socket during service-partitioned revocation handoff.** Worker attempts write operations while handoff from Scoped Provisioner to Cleanup Executor is executing. | Permitted: None once `REVOKED` is committed. | **PROHIBITED:** Completing writes after identity deletion is confirmed with majority write concern. | **Server-Side Authorization Cache Invalidation:** Scoped Provisioner executes `dropUser` with `w: "majority", j: true`. Next wire packet on lingering socket halts at MongoDB authorization cache lookup $\\rightarrow$ fails with Code 11/13. |
| **Scenario 19 (B38-28)** | **Multi-Replica Concurrent Nonce Allocation & Process Crash Collision Attempt.** Multiple provisioner replicas lease nonces under same key version concurrently; process restarts mid-lease. | Permitted: Encrypting under unique, monotonically disjoint block counters. | **PROHIBITED:** Re-using any nonce under the same key version across replicas or crashes. | **Durable Block Reservation Protocol:** `rs_coord:27019.nonce_allocations` serializes block leases atomically via `$inc` with `w: "majority", j: true`. Restarted instances discard unconsumed blocks and lease fresh higher blocks ($P(\text{collision}) = 0$). |
| **Scenario 20 (B38-31)** | **Compromised Credential Broker attempts destructive dropping or system database administration.** Attacker subverts `apps/credential-broker` and attempts `dropDatabase` or `createUser` on `admin`. | Permitted: Mints scoped admin on verified test namespace. | **PROHIBITED:** Dropping databases, creating users on `admin`, or accessing coordination cluster. | **MongoDB RBAC & Network Boundary:** Broker lacks `dropDatabase` (Code 13); lacks userAdmin on `admin` (Code 13); network egress to `rs_coord:27019` blocked. |
| **Scenario 21 (B38-31)** | **Compromised Provisioner attempts bulk slot credential retrieval.** Attacker in `apps/provisioner` attempts `vault.list("secret/metadata/slots")` to harvest all partition credentials. | Permitted: Leases single slot bound to verified active lease. | **PROHIBITED:** Listing, scanning, or retrieving multiple slot credentials in bulk. | **Path-Based ACL Enforcement:** Slot Vault denies `list` capability. Each slot secret path requires an active lease token from `rs_coord:27019.ownership_locks`. |
| **Scenario 22 (B38-32)** | **Compromised Provisioner attempts `$set` reset on nonce allocation collection.** Attacker issues `db.nonce_allocations.updateOne({}, { $set: { nextBlockStart: 0 } })`. | Permitted: Requesting block lease via mTLS from Nonce Allocation Service. | **PROHIBITED:** Any direct write, update, or set operation on `nonce_allocations`. | **Decoupled Allocation Authority:** Central provisioner possesses zero write/update privileges on `nonce_allocations` (Code 13). Nonce Allocator service exposes zero `$set` pathways. |
| **Scenario 23 (B38-33)** | **Compromised Cleanup Executor attempts operation termination without cluster authorization.** Attacker issues `killOp` without `{ cluster: true }` authorization or attempts cluster shutdown. | Permitted: `killop` and `inprog` on `{ cluster: true }`. | **PROHIBITED:** Shutting down replica set, modifying replica set config, or creating users. | **Cluster Privilege Scoping:** Executor granted strictly `killop`, `inprog`, `killAnySession`, `impersonate`, `checkCursorSanity` on `{ cluster: true }`. `shutdown` and `replSetReconfig` denied (Code 13). |
| **Scenario 24 (B38-34)** | **Adversary attempts `findAndModify` write operation on append-only collection.** Attacker connects as `decision_os_audit_writer` and issues `findAndModify` with remove/update payload. | Permitted: `find`, `insert`, `createIndex`. | **PROHIBITED:** Executing `findAndModify` with `{ remove: true }` or `{ update: ... }`. | **Underlying Action Authorization:** MongoDB authorizes `findAndModify` via `update`/`remove`. With `update` and `remove` denied, command throws Error Code 13 natively. |
| **Scenario 25 (B38-35)** | **Hostile Worker attempts wire writes while Network Transport Fencing controller fails.** Network controller is offline during revocation; worker attempts post-revocation writes. | Permitted: None. | **PROHIBITED:** Completing writes after revocation request is received. | **Fail-Closed Teardown & Multi-Layer Defense:** Executor halts teardown and moves request to `QUARANTINED` if network fencing fails. Concurrently, server-side `dropUser` invalidates authorization cache, rejecting writes with Code 11/13. |

---

### 15.3 Required Adversarial Test Design for Two Workers (Finding B38-11 & D38-16)
1. **Setup:** Worker A owns `decision_os_test_run1_wA`, authenticates as `decision_os_worker_run1_wA`. Worker B owns `decision_os_test_run1_wB`, authenticates as `decision_os_worker_run1_wB`.
2. **Adversarial Invocations:**
   - Worker A attempts CRUD on Worker B's database $\\rightarrow$ Code 13 (`Unauthorized`).
   - Worker B attempts CRUD on Worker A's database $\\rightarrow$ Code 13 (`Unauthorized`).
   - Both workers attempt direct writes to `rs_coord:27019` $\\rightarrow$ Network connection refused.
   - Both workers attempt role administration on `rs_test:27018` $\\rightarrow$ Code 13.
3. **Mandatory Acceptance Criteria:** 100% rejection on the wire. No cross-database read or write succeeds.

---

## 16. Failure Modes, Fencing Interleavings & Role Lifecycle Concurrency Analysis

### 16.1 Fencing Interleaving Analysis (B38-07)

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
3. **Safety Outcome:** SRE reconciliation **contains no drop capability**. Reconcile transitions request to terminal `QUARANTINED`, preserving `dropExecutionLock: true` and marking the namespace poisoned. Even if the earlier executor's delayed wire command arrives later or the server unlinks asynchronously, zero secondary drop commands are ever issued. Safe against dual drop and race conditions.

#### Case E: Network Transport Fencing Controller unavailable during revocation (Finding B38-35)
1. Cleanup Executor marks request `CLAIMED` in `cleanup_ledger`.
2. Executor attempts Step 2 (Network Transport Fencing) by dispatching `POST /v1/orchestrator/fence-worker`.
3. Network Fence Controller is unreachable (network partition or CNI daemon crash).
4. Executor retries with exponential backoff (1s, 2s, 4s, up to 15s). Fencing cannot be confirmed.
5. **Fail-Closed Resolution:** The Executor halts teardown immediately. It does NOT proceed to identity revocation or wire drop. It transitions the ledger request to `OUTCOME_UNKNOWN` / `QUARANTINED`, preserving `dropExecutionLock: true` and alerting SRE.

### 16.2 Explicit Statement of Residual Risks
1. **Quarantined Database Proliferation:** Under frequent network partitions or replica set failovers, ambiguous test databases remain in `QUARANTINED` status and are not automatically reclaimed. In test environments, this is mitigated by unique `runId` UUIDs.
2. **Delayed Wire Packet Delivery:** If an executor process is paused after transmitting a wire packet into the TCP send buffer, network stack delays could cause the packet to arrive at MongoDB much later. Quarantining the namespace and permanently retaining the execution lock ensures that no active workload is provisioned into that namespace.
3. **Linux Kernel Integrity:** Container isolation relies on Linux cgroups and namespaces. A container breakout vulnerability in the host Linux kernel could compromise container boundaries.

### 16.3 Role Lifecycle and Provisioning Concurrency Analysis (Finding B38-14, B38-24, B38-25)

1. **Interleaving 1: Concurrent claims for different databases:** Handled via independent atomic inserts into `ownership_locks`. Two discrete dynamic roles and users are provisioned on `rs_test`. Zero contention.
2. **Interleaving 2: Concurrent claims for the same database:** `ownership_locks` unique index on `databaseName` allows exactly one atomic insert to succeed. The loser receives HTTP 409 `OWNERSHIP_CONFLICT`.
3. **Interleaving 3: Role creation succeeds, user creation fails:** Provisioning saga transitions to `ROLLING_BACK`. Provisioner drops the dynamic role, releases the lease, and returns HTTP 500.
4. **Interleaving 4: User creation succeeds, role assignment fails:** User exists with base unprivileged role only (zero test DB access). Saga transitions to `ROLLING_BACK`; provisioner drops the user and role.
5. **Interleaving 5: Credential delivery fails (Worker timeout / crash):** Password exists in AES-256-GCM envelope in `ownership_locks`. Worker retries with matching `requestId`; provisioner decrypts envelope and redelivers. If worker never retries, 60s lease expires; orphan reaper rolls back.
6. **Interleaving 6: Worker crashes before cleanup:** Worker fails to send heartbeat pings. Lease expires after 60 seconds. Background reaper detects expired lease, revokes role, drops user, terminates sessions, and marks database for cleanup.
7. **Interleaving 7: Revocation handoff fails during coordinated teardown (B38-27):** Executor issues `POST /v1/provisioning/revoke-worker`. Provisioner encounters transient network partition or primary failover. Executor does NOT proceed to `DISPATCHING`. It retries revocation with exponential backoff. If unacknowledged when lease expires, request moves fail-closed to `QUARANTINED` without dispatching wire drop.
8. **Interleaving 8: Quarantined worker attempts reconnection using cached credentials:** When quarantined, Scoped Provisioner executes server-side `dropUser` and Executor executes `killAllSessionsByPattern`. Subsequent operations fail with Code 11 (`UserNotFound`) or Code 18 (`AuthenticationFailed`).
9. **Interleaving 9: Role revoked while worker has active connection:** Revocation protocol drops user and invalidates session. The MongoDB engine authorization cache on lingering open sockets invalidates the session; subsequent wire commands fail with Code 11 or Code 13.
10. **Interleaving 10: Hostile worker refuses to close connection pool (B38-25):** The worker retains physical TCP sockets and sends write operations. MongoDB engine re-evaluates user authorization on the wire packet, discovers the user principal is dropped, and rejects the command with Code 11 or Code 13.
11. **Interleaving 11: Prepared transaction detected during revocation (B38-25):** If a worker session contains a prepared distributed transaction, `killAllSessionsByPattern` skips it. Revocation protocol inspects `currentOp`, detects `preparedTransaction: true`, coordinates with transaction coordinator to abort the transaction, and releases locks prior to dropping user.
12. **Interleaving 12: Provisioner crashes during rollback compensation:** Orphan reaper detects `ROLLING_BACK` with `compensationPending: true`. Applies exponential backoff to re-execute `dropUser` and `dropRole` via scoped identity until MongoDB returns `{ ok: 1 }` or `NotFound`.
13. **Interleaving 13: Crash between user deletion and physical database drop (B38-27):** Scoped Provisioner confirms `dropUser` and `dropRole` with majority write concern (`ownership_locks.state = 'REVOKED'`). Cleanup Executor crashes before wire dispatch. On restart, Executor inspects ledger (`CLAIMED`), sees `ownership_locks` already `REVOKED`, skips re-requesting identity drop, executes session/op termination, moves to `DISPATCHING`, and safely dispatches `dropDatabase`.
14. **Interleaving 14: Provisioner replica crashes mid-block during high concurrency (B38-28):** Replica A leases counter block $[B_1, B_1 + 2^{20} - 1]$, encrypts 42 envelopes, and abruptly crashes. The remaining unconsumed counters in that block are discarded. On restart, Replica A allocates a brand-new higher block $[B_2, B_2 + 2^{20} - 1]$ via atomic `$inc` on `rs_coord:27019.nonce_allocations`. Zero counter values are ever rewound or repeated under the same key version.
15. **Interleaving 15: Primary election during atomic nonce block reservation (B38-32):** Nonce Allocation Service dispatches `findOneAndUpdate` with `$inc` to `rs_coord:27019`. Primary steps down before write commits to majority. Allocator receives network disconnect / notPrimary error. Uncommitted lease rolls back. Allocator retries request on the newly elected primary, reading the current committed `nextBlockStart`. Leased blocks remain strictly linearizable without counter overlap.
16. **Interleaving 16: Credential Broker enclave timeout during dynamic expansion (B38-31):** Provisioner sends signed claim to `apps/credential-broker` for unpooled database `decision_os_test_runX_wX`. Broker is partitioned. Provisioner's claim timeout expires after 15s. Provisioner transitions saga to `ROLLING_BACK`, releases lease in `ownership_locks`, and returns HTTP 503 `PROVISIONING_DELEGATION_FAILED`. No orphaned principals or permissions leak.
17. **Interleaving 17: Hostile worker executes writes while network controller is restarting (B38-35):** Hostile worker retains open TCP sockets and sends write operations concurrently with teardown request. Network Fence Controller is delayed. Concurrently, Step 3 (Scoped Identity Revocation) executes `dropUser` on `rs_test` with majority write concern. The MongoDB daemon invalidates its internal authorization cache. The hostile worker's wire write over the open socket fails with Error Code 11/13, preventing data corruption even before transport fencing completes.

---

## 17. Deployment and Local-Development Plan

### 17.1 Production & CI Deployment (Container Isolated & Dual Deployment)
The production and CI topology enforces complete physical/logical boundary separation:

1. **Database Deployments:**
   - **`mongodb-coord` (Port 27019):** Dedicated replica set `rs_coord` hosting `decision_os_coordination` and `cleanup_audit_log`.
   - **`mongodb-test` (Port 27018):** Dedicated replica set `rs_test` hosting ephemeral test databases.
2. **Containerized Services:**
   - **`apps/provisioner`:** Dedicated container running as `UID 10001` (`readOnlyRootFilesystem: true`, capabilities `cap_drop: [ALL]`). Connects to `mongodb-coord:27019` and `mongodb-test:27018`.
   - **`apps/cleanup-executor`:** Dedicated container running as `UID 10001` (`readOnlyRootFilesystem: true`, capabilities `cap_drop: [ALL]`). Connects exclusively to `mongodb-test:27018`.
   - **`apps/audit-service`:** Dedicated audit collector running as `UID 10001`. Connects exclusively to `mongodb-coord:27019` with append-only credentials.
3. **Network Security Policies (Kubernetes / Docker Compose):**
   - **Coordination Network (`coord-net`):** Strictly permits ingress to `mongodb-coord:27019` from `apps/provisioner` and `apps/audit-service`. Egress from `apps/cleanup-executor` and test worker containers to `coord-net` is completely blocked.
   - **Test Network (`test-net`):** Connects `apps/provisioner`, `apps/cleanup-executor`, and test workers to `mongodb-test:27018`.
   - **API Ingress:** Port 8088 on `apps/provisioner` and `apps/cleanup-executor` accessible to workers via mTLS.

### 17.2 Local Development Profile: Development-Only Weaker Mode (B38-08)
For containerless local developer laptop environments:
- **Mode Classification:** Explicitly designated as **Development-Only Weaker Mode**.
- **Execution:** Helper script `scripts/start-local-cleanup-executor.ts` spawns child processes for local testing.
- **Security Limitation Warning:**
  > [!WARNING]
  > **Development-Only Limitation:** The local child process runs under the same OS user as the test runner. It provides process separation and API contract compliance, but **does not provide kernel security boundary isolation**. A compromised test runner could inspect child memory via OS debugging APIs. This mode is strictly forbidden in CI and production.

---

## 18. Observability and Audit Requirements

### 18.1 Structured JSON Logging
All log events emitted across the architecture follow standard structured JSON:
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

#### 1. Separation of Audit Privileges from Coordination CRUD
MongoDB RBAC privileges are strictly decoupled:
- **Coordination State Collections (`ownership_locks`, `cleanup_ledger`, `provisioning_saga`):**
  Authorized actions: `actions: [ "find", "insert", "update", "remove", "createIndex" ]` (authorizes `findAndModify` command via underlying `find`, `update`, `insert`, `remove`).
- **Nonce Allocation Collection (`decision_os_coordination.nonce_allocations`):**
  Dedicated allocator authority: Managed exclusively by `decision_os_nonce_allocator` with `actions: [ "find", "insert", "update", "createIndex" ]` via atomic `$inc`.
- **Audit Log Collection (`decision_os_coordination.cleanup_audit_log`):**
  Strictly restricted to append-only operations: `actions: [ "find", "insert", "createIndex" ]`.
  **Explicitly denied actions:** `update`, `remove`, `dropCollection`, `dropDatabase` (which natively prohibits `findAndModify` write or delete operations).

#### 2. Native Append-Only Write Boundary Enforcement
- Any command attempting to modify or delete historical records (`updateOne`, `deleteMany`, `findAndModify`) is rejected by the MongoDB storage engine with `MongoServerError: not authorized on decision_os_coordination.cleanup_audit_log` (Code 13).
- Application code inside `apps/audit-service/src/audit.ts` exposes strictly an `appendAuditEvent(event)` method. No update, delete, or overwrite functions exist in the codebase.

#### 3. Cryptographic SHA-256 Hash Chaining
Every audit event is cryptographically linked to its immediate predecessor:
$$\\text{EntryHash}_k = \\text{SHA256}(\\text{PrevHash}_{k-1} + \\text{"|"} + \\text{SequenceNum}_k + \\text{"|"} + \\text{RFC8785}(\\text{AuditEventPayload}_k))$$

```json
{
  "_id": "audit_seq_10842",
  "sequenceNumber": 10842,
  "prevHash": "3f8b7a2c...",
  "entryHash": "e91c4d7a...",
  "timestamp": "2026-11-06T01:15:12.104Z",
  "actor": "decision_os_audit_writer",
  "eventType": "STATE_TRANSITION",
  "payload": {
    "requestId": "550e8400-e29b-41d4-a716-446655440000",
    "databaseName": "decision_os_test_run_alpha_w0",
    "fromState": "OUTCOME_UNKNOWN",
    "toState": "QUARANTINED"
  }
}
```

##### Audit Event Taxonomy
The audit ledger records critical security-sensitive lifecycle milestones:
- `STATE_TRANSITION`: Emitted upon every state advancement in `cleanup_ledger` or `provisioning_saga`.
- `NONCE_BLOCK_ALLOCATED`: Emitted by the Provisioning Service upon reserving a new counter block `[counterStart, counterEnd]` for a given `keyVersion` and `replicaId` from `decision_os_coordination.nonce_allocations`.
- `REVOCATION_HANDOFF_INITIATED`: Emitted by the Destructive Cleanup Executor when handing off `dropUser` and `dropRole` requests to the Scoped Provisioning Service.
- `REVOCATION_HANDOFF_CONFIRMED`: Emitted by the Scoped Provisioning Service once `dropUser` and `dropRole` are committed with majority concern on `rs_test`, permitting the Cleanup Executor to proceed to in-flight operation abortion and physical database removal.

#### 4. Independently Protected Chain-Head Checkpoint Storage
To prevent full-chain rewriting, the architecture anchors the chain head externally:
1. **Ed25519 Checkpoint Signing:** Checkpoints are cryptographically signed using an independent **Audit Signing Key** (`AUDIT_SIGNING_KEY`) held exclusively by the Audit Service.
2. **Strict Cadence:**
   - Periodic: Computed every 60 seconds.
   - Event-Driven: Triggered immediately upon critical terminal milestones (`CLEANED`, `QUARANTINED`, `SAGA_ROLLED_BACK`, `OPERATOR_RECONCILED`).
3. **Monotonic Sequence & Checkpoint Structure:**
   ```json
   {
     "checkpointId": "cp_20261106_00142",
     "sequenceRange": { "fromSeq": 10800, "toSeq": 10842 },
     "prevCheckpointHash": "8f3b2a1c...",
     "headHash": "e91c4d7a...",
     "timestamp": "2026-11-06T01:15:15.000Z",
     "signature": "MEQCIA..."
   }
   ```
4. **External WORM Anchoring:**
   - Production: Emitted to cloud storage with Object Lock / Bucket Lock (WORM).
   - CI / Staging: Written to a protected volume mounted with root ownership and append-only filesystem attributes (`chattr +a`).

#### 5. Concrete Tamper Detection Mechanisms
An independent verification scanner sweeps the audit chain during startup and health checks:
1. **Record Deletion:** Detected by sequence gaps ($\\text{seq}_{k+1} \\ne \\text{seq}_{k-1} + 1$) or broken hash linkage.
2. **Chain Truncation:** Detected when latest sequence number is less than external anchor sequence number, or head hash does not match external anchor.
3. **Record Reordering:** Detected by failed SHA-256 link verification.
4. **Payload Substitution:** Detected by $\\text{SHA256}(\\dots) \\ne \\text{entryHash}_k$.
5. **Full-Chain Rewriting:** Detected by mismatch against external WORM checkpoint.

#### 6. Failure Recovery and Alerting Protocol
If the verification scanner detects an audit chain mismatch:
1. **Critical Alarm:** Emit immediate high-priority alert: `CRITICAL_AUDIT_LEDGER_INTEGRITY_VIOLATION`.
2. **Fail-Closed Executor Hard Freeze:**
   - Rejects all incoming claims with HTTP 503 `SERVICE_FROZEN_AUDIT_VIOLATION`.
   - Rejects all cleanup requests.
   - Retains all active execution locks indefinitely.
3. **Forensic Reconciliation:** Requires manual SRE intervention using offline hardware token keys to verify logs against external WORM storage.

#### 7. Termination of Misleading "Immutability" Claims
The ledger is accurately documented as:
> **Cryptographically Tamper-Evident with MongoDB RBAC-Enforced Append-Only Write Boundary and Externally Anchored WORM Checkpoints.**

### 18.3 Metrics & Alerting
- Prometheus metrics: `cleanup_requests_total`, `cleanup_duration_seconds`, `cleanup_ambiguous_outcomes_total`, `cleanup_quarantined_total`, `cleanup_dangling_roles_reaped_total`, `audit_checkpoints_created_total`, `nonce_block_allocations_total`, `nonce_counter_exhaustion_ratio`, `revocation_handoff_duration_seconds`.
- Alert: Any transition to `OUTCOME_UNKNOWN`, `RECONCILIATION_REQUIRED`, or `QUARANTINED` fires high-priority SRE alert.
- Alert: Nonce allocation failures, coordination database unavailability on `rs_coord`, or remaining counter space dropping below threshold fires high-priority Provisioner alert.

---

## 19. Phased Implementation Sequence

```mermaid
flowchart LR
    PhaseC1["Phase C1:
Dual Deployment (rs_coord & rs_test),
Scoped RBAC & Discrete Principals"] --> PhaseC2["Phase C2:
apps/provisioner & apps/cleanup-executor Services
with Ed25519 Signing Engine"]
    PhaseC2 --> PhaseC3["Phase C3:
Oplog Evidence Protocol & Quarantine State Machine"]
    PhaseC3 --> PhaseC4["Phase C4:
CleanupExecutorClient in apps/api &
Permanent Worker Revocation Protocol"]
    PhaseC4 --> PhaseC5["Phase C5:
Remediate Call Sites (CS-01 to CS-17)"]
    PhaseC5 --> PhaseC6["Phase C6:
Static Guard Script & CI Negative Security Tests"]
    PhaseC6 --> PhaseC7["Phase C7:
Full Verification & Regression Testing (D38-01 to D38-30)"]
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
| **`D38-13`** | **Real MongoDB Authorization Test** | Connect as `decision_os_destructive_executor`. Attempt `dropDatabase()` on `decision_os_production`. Assert rejection by naming guard and physical absence of DB on test deployment. | Phase C1 | PLANNED |
| **`D38-14`** | **Full Monorepo Regression** | Execute all 51 test suites across `@decision-os/api`, `@decision-os/decision-engine`, and `@decision-os/web`. Golden Fixtures G1–G10 pass 100%. | Phase C7 | PLANNED |
| **`D38-15`** | **Dynamic Role Lifecycle Test (Finding 1)** | Verify dynamic role creation on `POST /v1/ownership/claim`. Worker performs CRUD on assigned DB. Worker is blocked with Error 13 on other test DBs and coordination DB. Verify role revocation on cleanup completion. | Phase C1 / C3 | PLANNED |
| **`D38-16`** | **Two-Worker Adversarial Database Isolation Test (Finding B38-11)** | Worker A owns DB A (`decision_os_test_run1_wA`), Worker B owns DB B (`decision_os_test_run1_wB`). Authenticate with distinct identities. Worker A attempts CRUD on DB B $\\rightarrow$ Error Code 13. Worker B attempts CRUD on DB A $\\rightarrow$ Error Code 13. Both attempt writes to coordination collections $\\rightarrow$ Error Code 13. Both attempt role escalation $\\rightarrow$ Error Code 13. | Phase C1 | PLANNED |
| **`D38-17`** | **Scoped Role Provisioning & Non-Superuser Test (Finding B38-12)** | Connect as `decision_os_provisioner`. Verify supported commands (`createRole`, `createUser`, `dropRole`, `dropUser`) succeed for test database roles. Attempt to grant `userAdmin`, `clusterAdmin`, or `root` $\\rightarrow$ Error Code 13 or application guard rejection. Assert direct writes to `admin.system.roles` and `admin.system.users` throw Error Code 13. Verify SHA-256 hash chaining on `cleanup_audit_log`. | Phase C1 | PLANNED |
| **`D38-18`** | **MongoDB 8.0 Replica Set Oplog Evidence Protocol Test (Finding B38-13)** | Dispatch drop command with correlation `comment` on replica set `rs_test`. Assert oplog entry contains matching `comment`, timestamp, and majority commit point. Simulate election rollback, pre-dispatch timestamps, missing comment, and rolled-over oplog. Assert `CONFIRM_CLEANED` is rejected with HTTP 422 and request remains `QUARANTINED`. | Phase C3 | PLANNED |
| **`D38-19`** | **Role Lifecycle & Concurrency Interleaving Integration Test (Finding B38-14)** | Execute automated integration tests simulating the 12 concurrency interleavings (concurrent claims, race on same DB, partial provisioning saga rollback, credential envelope delivery timeout, crash before cleanup lease expiry, dangling role reaper, post-quarantine credential invalidation, active socket severing via `killAllSessionsByPattern`). Assert 100% fail-closed behavior and zero cross-worker privilege leakage. | Phase C3 | PLANNED |
| **`D38-20`** | **Real MongoDB 8.0 Session Termination & Post-Revocation Test (Finding B38-15)** | Authenticate as `decision_os_destructive_executor`. Execute `killAllSessionsByPattern` targeting worker principal on `admin` db using `{ cluster: true }` privileges. Assert logical session termination, active operation abort, cursor closure, TCP socket retention, worker client-pool shutdown (`client.close(true)`), and post-revocation connection denial (Code 11/13/18). Test prepared transaction limitation and abort handling. | Phase C1 / C3 | PLANNED |
| **`D38-21`** | **Live MongoDB 8.0 Oplog Evidence Protocol & Comment Preservation Test (Finding B38-16)** | Dispatch `{ dropDatabase: 1, comment: JSON.stringify(...) }` on replica set `rs_test`. Empirically verify whether MongoDB 8.0 preserves the `comment` field in `local.oplog.rs`. Verify that `readConcern` is ignored on `local.oplog.rs`. Extract `optimes.lastCommittedOpTime.ts` and `.t` from `replSetGetStatus` on active primary. Assert lexicographical OpTime comparison $(t, ts)$, election safety, and rollover detection. If comments are not preserved, assert automatic reconciliation is disabled and requests remain `QUARANTINED`. | Phase C3 | PLANNED |
| **`D38-22`** | **Ephemeral Credential Envelope Recovery After Executor Crash (Finding B38-17)** | Worker claims DB; provisioner provisions role and user, generates password, and writes AES-256-GCM envelope to `ownership_locks.credentialEnvelope` with deterministic nonce. Simulate abrupt provisioner crash before HTTP response delivery. Restart provisioner. Worker retries `POST /v1/ownership/claim` with same `requestId`. Assert provisioner validates caller signature, decrypts envelope with `ENVELOPE_KEY`, validates AAD, and redelivers credentials without recovering plaintext from SCRAM verifier. Assert forward secrecy: envelope zeroized upon activation. | Phase C2 / C4 | PLANNED |
| **`D38-23`** | **Multi-Command Provisioning Saga Crash & Compensation Test (Finding B38-18)** | Execute automated tests simulating provisioner crash at each of the 12 saga transitions (`CLAIM_PENDING`, `ROLE_CREATING`, `ROLE_CREATED`, `USER_CREATING`, `USER_CREATED`, `ROLE_ASSIGNED`, `CREDENTIAL_ENCRYPTED`, `CREDENTIAL_DELIVERED`, `ACTIVATED`, `ROLLING_BACK`, `ROLLED_BACK`, `ORPHAN_RECOVERY`). Simulate network failure during compensating `dropRole` / `dropUser`; assert saga records `compensationPending: true` and orphan reaper retries with backoff. Assert partially provisioned identities have zero test DB privileges. Assert orphan reaper 4-point verification check before deleting any user or role. | Phase C1 / C3 | PLANNED |
| **`D38-24`** | **Adversarial Audit Mutation & External Checkpoint Test (Finding B38-19)** | Connect as `decision_os_audit_writer`. Attempt `updateOne`, `deleteMany`, `findAndModify`, or `drop` on `decision_os_coordination.cleanup_audit_log` $\\rightarrow$ natively rejected by MongoDB RBAC with Error Code 13 (`Unauthorized`). Simulate adversarial tampering (deletion, truncation, reordering, substitution, rewriting) on historical records. Assert verification scanner detects tampering via SHA-256 recalculation and external checkpoint comparison, immediately firing critical alarm and entering executor hard freeze. | Phase C2 / C6 | PLANNED |
| **`D38-25`** | **Adversarial Proof of Coordination & Audit Storage Isolation (Finding B38-20)** | Connect as `decision_os_destructive_executor` from `apps/cleanup-executor`. Attempt direct network connection to `mongodb-coord:27019` $\\rightarrow$ TCP connection refused / egress dropped by network policy. Connect to `mongodb-test:27018` and attempt `db.runCommand({ dropDatabase: 1 })` targeting `decision_os_coordination` or `cleanup_audit_log` $\\rightarrow$ returns `{ ok: 1, dropped: 0 }` (no-op; databases absent from test catalog). Assert that `decision_os_coordination` and `cleanup_audit_log` on `rs_coord` remain completely untouched, proving that destructive cleanup cannot modify or destroy coordination and audit storage. | Phase C1 | PLANNED |
| **`D38-26`** | **Role-Escalation & Provisioner Boundary Adversarial Verification (Finding B38-24)** | Connect as `decision_os_provisioner`. Attempt to create a custom cluster-wide role on `admin` with privileges on `{ resource: { anyResource: true }, actions: ["anyAction"] }` $\\rightarrow$ natively rejected by MongoDB RBAC with Error Code 13. Attempt to grant `root`, `clusterAdmin`, or `userAdminAnyDatabase` $\\rightarrow$ natively rejected with Error Code 13. Attempt to create a role on `decision_os_test_runA_wA` granting privileges on `decision_os_test_runB_wB` $\\rightarrow$ natively rejected by MongoDB engine with scoping constraint error. Attempt `dropDatabase` or `dropCollection` on any test database $\\rightarrow$ natively rejected with Error Code 13. | Phase C1 | PLANNED |
| **`D38-27`** | **Hostile-Worker Revocation & Socket-Retention Adversarial Test (Finding B38-25)** | Worker authenticates and establishes active connection pool with multiple open TCP sockets. Trigger revocation (`dropUser`, `dropRole`, `killAllSessionsByPattern`). Hostile worker deliberately keeps TCP sockets open and refuses `client.close(true)`. Hostile worker immediately issues `insert` and `find` commands over lingering sockets $\\rightarrow$ rejected by MongoDB daemon with Error Code 11 (`UserNotFound`) or Error Code 13 (`Unauthorized`) due to server-side authorization cache invalidation. Hostile worker attempts fresh authentication using cached password $\\rightarrow$ rejected with Error Code 11 or Error Code 18 (`AuthenticationFailed`). Assert 100% fail-closed boundary enforcement. | Phase C1 / C3 | PLANNED |
| **`D38-28`** | **Multi-Replica AES-GCM Nonce Uniqueness, Crash & Rollback Adversarial Test (Finding B38-28, B38-32)** | Concurrently execute 3 Provisioning Service replicas allocating $100{,}000$ nonces across 100 worker claim cycles via the dedicated Nonce Allocation Service. Assert zero duplicate or overlapping nonces across processes. Inject abrupt `SIGKILL` mid-block across replicas; restart replicas; verify that in-memory counters are cleanly discarded and new disjoint blocks are reserved, guaranteeing zero nonce reuse under the active key version. Simulate uncommitted primary rollback on `rs_coord`; verify `w: "majority", j: true` guarantees no counter reuse. Trigger key rotation; verify new key version counter starts at 0 without collisions. Assert fail-closed halt with HTTP 503 if `rs_coord` becomes unreachable. Verify mathematical collision resistance holds under specified trust assumptions. | Phase C2 | PLANNED |
| **`D38-29`** | **Cross-Database Provisioning Privilege Isolation Test (Finding B38-26, B38-31)** | Authenticate as `decision_os_db_admin_targetDbA` or central Provisioning Service. Attempt to create, modify, grant, or revoke roles or users on `decision_os_test_runB_wB` $\rightarrow$ natively rejected by MongoDB RBAC with Error Code 13 (`Unauthorized`). Verify central provisioner possesses zero `{ db: "", collection: "" }` user/role administration rights on `rs_test`. Assert partition pool boundary enforcement across all 8 negative authorization cases (NC-1 through NC-8). Verify compromise of Worker A's scoped admin cannot create or modify users in Worker B's database. | Phase C1 | PLANNED |
| **`D38-30`** | **Revocation Authority & Multi-Service Coordination Adversarial Test (Finding B38-27, B38-35)** | Authenticate as `decision_os_destructive_executor`; attempt direct `dropUser` or `dropRole` $\rightarrow$ natively rejected with Error Code 13. Execute coordinated revocation protocol: Step 2 Network Transport Fencing via Network Fence Controller; Step 3 Scoped Identity Revocation via Scoped Provisioner (`dropUser`/`dropRole` with `w: "majority"`); Step 4 Session & Operation Cancellation via Executor (`killop` on `{ cluster: true }`, `killAllSessionsByPattern`). Simulate crash, timeout, or partition between handoff steps; verify idempotent retry and fail-closed state. Verify hostile worker retains open TCP sockets; assert subsequent operations fail with Error Code 11/13 or are discarded by netfilter. Reject client API response and connection closure as proof. | Phase C1 / C3 | PLANNED |
| **`D38-31`** | **Bootstrap Broker Security Boundary & Dynamic Identity Isolation (Finding B38-31)** | Authenticate as `decision_os_credential_broker` on `rs_test`. Attempt `dropDatabase` or `dropCollection` $\rightarrow$ Error Code 13. Attempt `createUser` on `admin` $\rightarrow$ Error Code 13. Submit signed ownership claim with tampered database name not matching test regex $\rightarrow$ broker rejects with HTTP 400. Attempt bulk retrieval of slot credentials from Partition Slot Vault (`apps/slot-vault`) $\rightarrow$ denied by path-based ACL (HTTP 403). Execute offline bootstrap container script; verify `/tmp/bootstrap_admin.key` is securely zeroized (`shred -u`) upon exit and no administrative process remains online. | Phase C1 / C4 | PLANNED |
| **`D38-32`** | **Nonce Allocation Authority Separation, Reset Prevention & Range Verification (Finding B38-32)** | Authenticate as `decision_os_provisioner`. Attempt direct `db.nonce_allocations.updateOne({}, { $set: { nextBlockStart: 0 } })` $\rightarrow$ natively rejected by MongoDB RBAC with Error Code 13 (`Unauthorized`). Authenticate as `decision_os_nonce_allocator`. Execute concurrent block allocations across 5 worker threads; verify strictly monotonic block ranges ($[0, 2^{20})$, $[2^{20}, 2 \times 2^{20})$, etc.). Simulate race condition during `v2` key rotation; verify Code 11000 duplicate key error is caught and handled via idempotent fetch. Simulate counter reaching $2^{48}$ ceiling; verify allocator rejects further leases with `KEY_EXHAUSTION_LIMIT_REACHED` and fires critical alert. | Phase C2 | PLANNED |
| **`D38-33`** | **Real MongoDB 8.0 killop Privilege Scope Verification on Cluster Resource (Finding B38-33)** | Authenticate as `decision_os_destructive_executor` possessing `{ resource: { cluster: true }, actions: ["killop", "inprog"] }`. Dispatch `db.adminCommand({ currentOp: 1 })` and `db.adminCommand({ killOp: 1, op: targetOpId })` against test worker operations $\rightarrow$ successfully terminates operations. Attempt to execute `db.adminCommand({ killOp: 1 })` with role restricted to `{ resource: { db: "admin", collection: "" }, actions: ["killop"] }` $\rightarrow$ assert command fails with Error Code 13, proving that MongoDB 8.0 requires `{ cluster: true }` scope. Assert executor cannot execute `shutdown`, `replSetReconfig`, or `grantRole`. | Phase C1 | PLANNED |
| **`D38-34`** | **MongoDB Native Privilege Action Audit & Negative findAndModify Verification (Finding B38-34)** | Authenticate as `decision_os_audit_writer` possessing `actions: ["find", "insert", "createIndex"]` on `cleanup_audit_log`. Attempt `db.cleanup_audit_log.findAndModify({ query: {}, update: { $set: { tampered: true } } })` $\rightarrow$ natively rejected by MongoDB RBAC with Error Code 13. Attempt `findAndModify` with `{ remove: true }` $\rightarrow$ rejected with Error Code 13. Connect as `decision_os_provisioner` on `ownership_locks`; verify `findAndModify` succeeds because underlying actions `find`, `update`, `insert`, and `remove` are explicitly granted. Verify that `findAndModify` is nowhere defined as a privilege action name. | Phase C1 | PLANNED |
| **`D38-35`** | **Network Transport Fencing Verification & Multi-Layer Revocation Enforcement (Finding B38-35)** | Authenticate worker container with active TCP connection pool. Trigger teardown request. Verify Step 2 invokes `POST /v1/orchestrator/fence-worker`. Assert Network Fence Controller programs Linux netfilter / Kubernetes NetworkPolicy drop rules for worker IP targeting ports 27018 and 27019. Verify controller queries data plane (`iptables -C`) before returning HTTP 200. With drop rules active, assert all wire packets from worker container are dropped at layer 3/4 (zero TCP ACK). Simulate network controller unavailability during teardown; assert executor halts teardown, transitions request to `QUARANTINED`, and retains execution lock. Assert `dropDatabase` is never executed without verified network fencing. | Phase C1 / C3 | PLANNED |

---

## 21. Open Questions, Unresolved Assumptions and Decisions Requiring Explicit Approval

### 21.1 Open Decisions Requiring Technical Alignment
1. **Test Runner Dynamic Key Registration Protocol:**
   - *Question:* Should test workers register their dynamic Ed25519 public keys with the provisioner via a signed registration API (`POST /v1/auth/register-worker`) during worker thread startup, or should key pairs be generated deterministically from the test run seed?
   - *Recommendation:* Signed registration API with a short-lived run token provisioned by the CI test runner.
2. **Lease Expiry Duration for Ownership Locks:**
   - *Question:* What is the optimal lease duration for `ownership_locks` during long-running integration tests?
   - *Recommendation:* 60-second lease with an automatic background heartbeat every 15 seconds, preventing premature expiration during long-running deliberation tests.
3. **Administrative Key Storage in Production:**
   - *Question:* Should administrative reconciliation keys be integrated with AWS KMS / HashiCorp Vault transit secrets engine, or managed via offline SRE key pairs?
   - *Recommendation:* HashiCorp Vault transit engine with multi-party audit logging for production deployments.
4. **Nonce Counter Block Reservation Size Tuning (B38-32):**
   - *Question:* Is a $2^{20}$ ($1{,}048{,}576$) counter block optimal for test environments with frequent container restarts, or should the block size be dynamically configurable (e.g. $2^{16} = 65{,}536$)?
   - *Recommendation:* $2^{16}$ for local test runs with high restart frequency to minimize counter headroom consumption; $2^{20}$ for production/staging replicas.
5. **Scoped Database Admin Credential Storage Lifecycle & Slot Vault (B38-31):**
   - *Question:* Should partition slot credentials be stored in HashiCorp Vault with path-based ACLs, or in a lightweight in-memory slot lease daemon?
   - *Recommendation:* Partition Slot Vault (`apps/slot-vault`) enforcing path-based ACLs denying bulk enumeration, combined with ephemeral 60-second leases.
6. **Network Transport Fencing Controller Implementation Scope (B38-35):**
   - *Question:* Should the Network Fence Controller interface directly with Kubernetes CNI NetworkPolicies, or execute local Linux `iptables` / `nftables` netfilter commands via a privileged daemonset?
   - *Recommendation:* Dual-mode controller: Kubernetes `NetworkPolicy` for standard cluster deployments; Linux netfilter daemonset for high-performance direct TCP socket severing in CI environments.

### 21.2 Explicit List of Unresolved Architectural Assumptions and Risks
1. **DDL Command Comment Preservation in `local.oplog.rs` (Assumption under test in D38-21):**
   MongoDB documentation explicitly guarantees comment preservation in server logs, profiler entries, and `currentOp`, but comment retention in `local.oplog.rs` for DDL commands (`dropDatabase`) is an unproven assumption in MongoDB 8.0. If live testing (`D38-21`) demonstrates that MongoDB 8.0 strips comments from drop records, automatic or administrative `CONFIRM_CLEANED` cannot be supported, and all ambiguous drops must remain permanently in `QUARANTINED`.
2. **Prepared Transactions Bypass Session Termination (Known MongoDB 8.0 Limitation):**
   MongoDB's `killAllSessionsByPattern` explicitly ignores sessions that currently have transactions in the `prepared` state. The revocation protocol addresses this by scanning `currentOp` for prepared transactions and coordinating an explicit abort before issuing `dropUser`.
3. **Physical TCP Socket Retention Post Session Invalidation (B38-35):**
   Session termination invalidates logical sessions and server-side authorization caches, but does NOT physically sever client TCP network sockets. The system relies on transport-layer network fencing (dropping packets at layer 3/4) and server-side `dropUser` cache invalidation (which causes subsequent commands on lingering sockets to fail with Code 11/13). Client `client.close(true)` is explicitly categorized as non-security convenience.
4. **Physical / Logical Multi-Deployment Boundary Requirement:**
   Because MongoDB RBAC does not support database wildcards or negative exclusions, the destructive executor must possess `{ db: "", collection: "" }` with `dropDatabase` to tear down dynamic test databases. This broad grant is safe **strictly because test databases reside on an isolated MongoDB deployment (`mongodb-test:27018`) separate from coordination and audit storage (`mongodb-coord:27019`)**. If these deployments were collapsed onto a single instance, application regex guards would be the only barrier against coordination destruction.
5. **Accumulation of Quarantined Database Namespaces:**
   Because the fail-closed policy permanently retains execution locks for ambiguous drops with zero redispatch, frequent network partitions or replica set failovers could accumulate abandoned test databases. Automated tests avoid collision by using UUIDs, but physical storage cleanup requires scheduled offline maintenance.
6. **Nonce Allocation Collection Restoration and Epoch Bumping (B38-32):**
   In disaster-recovery scenarios where `rs_coord` is restored from an asynchronous snapshot or cold backup, counter state could roll back. The protocol mandates an explicit `epoch` increment or mandatory encryption key rotation (`KEY_VERSION` increment) upon restoring any database backup before the Provisioning Service is permitted to resume encryption.
7. **Pre-Allocated Partition Slot Exhaustion (B38-31):**
   If concurrent worker demand exceeds the pre-allocated partition pool size ($N = 256$) in large CI matrices, dynamic database creation must fall back to the isolated bootstrap broker. The provisioning service monitors pool saturation and alerts when active test worker count exceeds 80% of pre-allocated slots, triggering asynchronous pool expansion.
8. **Trust Assumptions for Cryptographic Nonce Uniqueness (B38-32):**
   The mathematical uniqueness claim ($P(\text{collision}) = 0$) is conditional on: (1) KMS/Vault key custody integrity; (2) MongoDB journaled majority write consensus linearizability (`w: "majority", j: true`); (3) Nonce Allocation Service code integrity enforcing monotonic `$inc` without `$set`; (4) Disaster recovery compliance mandating KMS epoch bumping on cold restores. Unconditional certainty cannot be claimed if allocator state or key custody is compromised.
9. **Network Transport Fencing Controller Availability (B38-35):**
   If the Network Fence Controller is partitioned or slow, teardown halts and requests enter `QUARANTINED`. High network policy churn in large CI clusters could introduce latency in CNI programming; caching and netfilter rule batching must be evaluated during Phase C benchmarking.
10. **Compromise Boundary of the Ephemeral Credential Broker (B38-31):**
    While the Credential Broker possesses `{ db: "", collection: "" }` role- and user-management privileges on `rs_test`, its blast radius is bounded by: enclave network isolation (zero coordination routes/creds), signed ownership claim verification against the Provisioner's public key, strict database naming regex enforcement, and complete absence of destructive drop rights or system database access.

---

## Gate B Completion Sign-Off Checklist

- [x] Baseline and commit verified: `fix/batch4-replica-set-transactional-recovery` at baseline commit `992a4cd326fe39865a723c29e974ba0f31707e8a` (parent `5ef95550c0709fdc99186bf42e5352f3aa846b4e`)
- [x] Document version upgraded to 1.7.0 (Phase B.7 Privileged Broker Isolation, Nonce Allocator Hardening & Revocation Enforcement)
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
- [x] B38-11 remediated (Phase B.3): Shared MongoDB user defect eliminated; discrete per-worker principals, ephemeral in-memory credentials, and exact dynamic roles prevent cross-worker database leakage
- [x] B38-12 remediated (Phase B.3): Direct system collection CRUD and `userAdmin` superuser grants eliminated; non-superuser role administration established
- [x] B38-13 remediated (Phase B.3): Authoritative MongoDB 8.0 replica-set oplog evidence protocol formulated with correlation comments, majority commitment checks, and fail-closed quarantine
- [x] B38-14 remediated (Phase B.3): Role lifecycle and concurrency interleavings analyzed; active connection invalidation established
- [x] B38-15 remediated (Phase B.4): Real MongoDB session invalidation (`killAllSessionsByPattern`, `killSessions`) on `{ cluster: true }` replaces unsupported commands; distinguishes logical sessions, operations, cursors, TCP sockets, and driver pools; addresses prepared transaction limitations
- [x] B38-16 remediated (Phase B.4): Technically supportable MongoDB 8.0 replica-set oplog evidence protocol using `optimes.lastCommittedOpTime.ts/.t`; explicitly documents that `local` ignores read concerns; requires live proof of comment preservation before any automated confirmation
- [x] B38-17 remediated (Phase B.4 / B.5): Crash-safe ephemeral credential recovery via caller-bound encrypted envelopes (`ownership_locks.credentialEnvelope`) utilizing AES-256-GCM with deterministic 96-bit nonces, versioned keys, dual-key rotation, and strict durable majority acknowledgement ordering before envelope destruction
- [x] B38-18 remediated (Phase B.4 / B.5): False provisioning atomicity claims replaced with a durable idempotent saga model spanning exactly 12 formalized states with crash/restart recovery at every transition, failed-compensation retry, and strict orphan reaper verification proof
- [x] B38-19 remediated (Phase B.4 / B.5): Audit ledger made genuinely tamper-evident by separating audit privileges from coordination CRUD; enforcing append-only via MongoDB RBAC (`find`, `insert`, `createIndex` only); independently protected external Ed25519-signed checkpoints; 60s cadence; detection of deletion, truncation, reordering, substitution, and rewriting
- [x] **B38-20 remediated (Phase B.5):** Destructive authority separated from coordination and audit storage via physical/logical two-deployment boundary (`rs_coord:27019` vs `rs_test:27018`); mathematical proof of impossibility of destructive cleanup dropping coordination or audit data
- [x] **B38-24 remediated (Phase B.5):** Role provisioning authority decoupled from destructive cleanup into dedicated Provisioning Service; removed false claims that application AST checks constitute native RBAC; dynamic roles scoped natively by creating directly on target test database namespace; independent threat models for compromised actors
- [x] **B38-25 remediated (Phase B.5):** Permanent worker revocation established; documented engine limitations of `killAllSessionsByPattern`; addressed prepared distributed transactions; rejected client `client.close(true)` as security boundary; formulated multi-layer server-side revocation defending against hostile workers retaining sockets
- [x] **B38-26 remediated (Phase B.6):** Cross-database provisioning authority eliminated; Database-Scoped Provisioning Delegation Model formulated; dynamic DB bootstrap mediated via pre-allocated partition pools and isolated brokers; role-definition vs management/user/grant authorization scopes distinguished; negative authorization cases NC-1–NC-8 defined
- [x] **B38-27 remediated (Phase B.6):** Revocation service responsibilities reconciled; 2-phase durable coordination protocol established between Cleanup Executor and Scoped Provisioner; all 8 operations fully allocated; client API responses and connection closure rejected as proof
- [x] **B38-28 remediated (Phase B.6):** Cryptographic AES-256-GCM nonce uniqueness formulated via NIST SP 800-38D §8.2.1 deterministic counter block reservation on `rs_coord:27019.nonce_allocations`; crash/restart discard, rollback protection, key-version separation, backup restore epoch bumping, and fail-closed availability halt defined
- [ ] **B38-31 remediated (Phase B.7):** Bootstrap broker explicit security boundary established; broker MongoDB privileges scoped; slot vault path-based ACL prevents bulk enumeration; offline bootstrap credential destruction and recovery protocol defined (Pending Independent Review)
- [ ] **B38-32 remediated (Phase B.7):** Nonce allocation authority decoupled into dedicated Nonce Allocation Service (`apps/nonce-allocator`, `decision_os_nonce_allocator`); `$set` reset prevented; 96-bit nonce encoding formally specified; mathematical uniqueness qualified with explicit trust assumptions (Pending Independent Review)
- [ ] **B38-33 remediated (Phase B.7):** MongoDB `killOp` privilege scope corrected to `{ resource: { cluster: true }, actions: ["killop", "inprog"] }`; lowercase action spelling verified; command database (`admin.$cmd`) distinguished from cluster authorization resource (Pending Independent Review)
- [ ] **B38-34 remediated (Phase B.7):** `findAndModify` removed from privilege action lists; all MongoDB RBAC actions audited against engine documentation; underlying `update`/`remove` denial verified to prevent `findAndModify` write mutations (Pending Independent Review)
- [ ] **B38-35 remediated (Phase B.7):** Network Transport Fencing integrated into durable revocation protocol as Step 2; exact CNI/netfilter controller identity, API, and retry/fail-closed semantics defined; 6 isolation layers formally distinguished; `dropDatabase` never represented as network fencing (Pending Independent Review)
- [x] Expanded verification plan (`D38-01` through `D38-35`, including `D38-31`, `D38-32`, `D38-33`, `D38-34`, `D38-35`) categorized and explicitly marked as PLANNED
- [x] Zero application, test, configuration, or infrastructure files modified; architecture design revision only
- [x] **STOP gate observed:** Phase B.7 completed; awaiting independent architecture review and formal Gate B approval before Phase C. Do not self-approve Gate B.
