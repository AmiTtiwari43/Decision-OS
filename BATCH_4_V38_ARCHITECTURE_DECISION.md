# DECISION OS — BATCH 4 V3.8 ARCHITECTURE DECISION
## Independent Cleanup Executor, Real MongoDB Privilege Separation & Concurrency Safety

**Document Version:** 2.3.0 (Phase B.13 Final Vault Audit, Rotation Crash Safety & WORM Evidence Remediation)
**Repository:** `AmiTtiwari43/Decision-OS`
**Branch:** `fix/batch4-replica-set-transactional-recovery`
**Current Baseline Commit:** `d6a35bd7910f9c028357d855e9f98caf3689b038` (`docs: complete vault gateway rotation, jwt fencing, and worm evidence remediation (v2.2.0)`)
**Parent Baseline Commit:** `63c3a6e3201600e042f78ec51a3e97fcb739e4fa` (`docs: reconcile vault gateway topology, formalize durable jwt state machine and harden worm evidence (v2.1.0)`)
**Prior Lineage Commits:** `d6a35bd7910f9c028357d855e9f98caf3689b038`, `63c3a6e3201600e042f78ec51a3e97fcb739e4fa`, `1bc3ecd0ee5224aa395c4d472675ae0c4789a1e9`, `2c4d989dc3b52c5f11ec368afaedab1d63e07b52`, `16eb385a5c73b307ff5331a769711dd55854db91`, `3dc53fccb1ade7f6206fdf98372ef4c1aaad9956`, `992a4cd326fe39865a723c29e974ba0f31707e8a`, `5ef95550c0709fdc99186bf42e5352f3aa846b4e`, `f0fbfc1b6d04ad947f85277435d0803282cd03cd`, `949ca35a7154f4c4db308dd73badf85221a98c9f`, `724f1076284b186f42759677ab9e480d27531b69`, `943a8e7a433ce1b98804a83c6be403b2fca52e96`, `161e59e85bb7183c21926f0b04f788eb43312394`, `bbaf9bee29ef40f80bb8b958569c7ebbb437b427`, `2e276058c119c36ef4d8e5d665bd6c029b2cc6bb`
**Document Revision:** Working tree revision on `fix/batch4-replica-set-transactional-recovery` against baseline `d6a35bd7910f9c028357d855e9f98caf3689b038` (Phase B.13 Deliverable)
**Phase A Artifact:** `BATCH_4_V38_DESTRUCTIVE_CALLSITE_INVENTORY.md`
**Date:** 2026-11-10
**Status:** ARCHITECTURE DESIGN (Phase B.13 Deliverable — Pending Independent Review & Formal Gate B Approval)

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


### Phase B.8 Broker Authority Elimination & Security Boundary Closure Remediation
Independent architectural review of baseline commit `3dc53fccb1ade7f6206fdf98372ef4c1aaad9956` identified four critical security boundary, vault authorization, cryptographic trust model, and revocation ordering defects:

1. **Elimination of the Broker's Cross-Database Administrative Blast Radius (Finding B38-36):**
   - *Defect:* The v1.7.0 dynamic credential broker possessed user- and role-management actions on `{ db: "", collection: "" }` on `rs_test`. In MongoDB RBAC, this is an unrestricted wildcard covering all non-system databases. Application-level regex checks, signed requests, and separate container execution cannot constrain an attacker who compromises the broker and authenticates directly to MongoDB.
   - *Remediation:* Explicitly acknowledged that `{ db: "", collection: "" }` is a cross-database administrative authority that cannot be constrained natively by application logic. Selected the **Pre-Provisioned Per-Target Administrative Principals Architecture** as the canonical runtime architecture: standard test execution leases strictly from pre-allocated partition slots (`decision_os_test_slot_000` through `slot_255`), where each slot $k$ has its own scoped database admin (`decision_os_db_admin_slot_${k}`) scoped strictly to `{ db: "decision_os_test_slot_" + k, collection: "" }`. Eliminated the central runtime broker holding broad shared credentials. Dynamic database creation is identified as an **Offline / Control-Plane Root of Trust** (`deploy/init-mongo-test.sh`), disabled in production (`DECISION_OS_DYNAMIC_PROVISIONING_ENABLED=false`). Requests targeting non-existent databases are rejected with `UnallocatedDatabaseException`. Added negative authorization verification item **`D38-36`**.
2. **Partition Slot Vault Exact Lease-to-Secret Binding (Finding B38-37):**
   - *Defect:* The v1.7.0 Partition Slot Vault specification lacked an exact policy and identity model to bind a signed lease claim to exactly one secret path, leaving open the risk of path guessing or substitution attacks by a compromised provisioner.
   - *Remediation:* Formally specified HashiCorp Vault templated identity policies (`path "secret/data/slots/{{identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id}}" { capabilities = ["read"] }` with `secret/data/slots/*` denied). Implemented a single-use JWT exchange model: coordination authority issues an Ed25519-signed JWT containing the leased `slot_id`, which the provisioner exchanges at `/v1/auth/jwt/login` for a single-use (`num_uses = 1`, `ttl = 60s`, `renewable = false`) client token. Direct path substitution (`slot_02` using a `slot_01` token) is rejected natively with HTTP 403 Forbidden. Added adversarial verification item **`D38-37`**.
3. **Nonce Allocator as an Explicit Cryptographic Root of Trust (Finding B38-38):**
   - *Defect:* v1.7.0 claimed unconditional mathematical certainty of nonce uniqueness without recognizing that MongoDB RBAC cannot enforce monotonic `$inc` semantics against an authorized identity holding `update` privileges, and lacked a formal compromise response protocol.
   - *Remediation:* Clearly distinguished provisioner compromise (prevented by RBAC), allocator compromise (cryptographic root of trust; detected and recoverable, but NOT preventable at the MongoDB RBAC layer), and coordination replica set compromise. Formally documented why MongoDB 8.0 RBAC actions cannot distinguish `$inc` from `$set` and why `$jsonSchema` cannot enforce inter-update temporal monotonicity. Defined an emergency **Allocator-Compromise Response Protocol**: immediate encryption kill-switch, KMS Data Encryption Key (DEK) epoch retirement and `KeyVersionPrefix` increment (rendering new ciphertexts disjoint from compromised ciphertexts), envelope quarantine and re-encryption, sequence re-seeding, and audit forensic verification. Explicitly stated that the zero-collision claim ($P(\text{collision}) = 0$) is conditional on clearly stated trust assumptions. Added adversarial verification item **`D38-38`**.
4. **Normalization of Revocation Execution Ordering (Finding B38-39):**
   - *Defect:* The v1.7.0 operation matrix and protocol descriptions had inconsistent execution orderings, lacked an explicit execution-phase column, and did not enforce crash recovery and prerequisite gating prior to database drop.
   - *Remediation:* Established **one canonical 5-Phase Ordered Revocation State Machine** across all diagrams, tables, and protocols: **Phase 1: Network Transport Fencing (`NET_FENCED`)** $\rightarrow$ **Phase 2: Scoped Worker Identity Revocation (`IDENTITY_REVOKED`)** $\rightarrow$ **Phase 3: In-Flight Operation & Session Cancellation (`OPS_KILLED`)** $\rightarrow$ **Phase 4: Database Storage Deletion (`STORAGE_DROPPED`)** $\rightarrow$ **Phase 5: Audit & Evidence Finalization (`AUDIT_FINALIZED`)**. Added an explicit `Execution Phase` column to the Operation Allocation Matrix. Defined durable acknowledgements in `cleanup_ledger` for every phase. Strictly enforced that Phase 4 (`dropDatabase`) refuses to execute unless Phases 1, 2, and 3 are durable and verified. Defined idempotent crash recovery at each phase boundary. Added adversarial verification item **`D38-39`**.

### Phase B.9 Credential Lifecycle, Durable Replay Prevention & Cryptographic Incident Remediation (v1.9.0)
Independent architectural review of baseline commit `16eb385a5c73b307ff5331a769711dd55854db91` identified three critical security boundary, authorization, and cryptographic integrity defects:
1. **Vault Lease Expiry Decoupled from MongoDB Credential Revocation (Finding B38-40 — Critical):** Evaluated Option A (Per-lease identities) vs Option B (Slot credential rotation). Selected Option B for partition slot administrators (`decision_os_db_admin_slot_${k}`) with server-side password rotation committed to replica set majority before slot reassignment, combined with Option A for worker workload principals (`decision_os_worker_${leaseId}_gen${generation}`). Established Mandatory Invariants 1–8.
2. **Durable JWT Redemption Replay Prevention and Vault Metadata Binding (Finding B38-41 — High):** Formalized durable replay tracking on `rs_coord:27019.decision_os_coordination.jwt_redemptions` using unique index on `_id: jti` with atomic CAS before Vault token minting. Corrected Vault policy template to target Entity Alias Metadata `identity.entity.aliases.<accessor>.metadata.slot_id`.
3. **Cryptographic Incident Response & Data-Trust State Machine for Nonce Reuse (Finding B38-42 — High):** Formalized an explicit 5-phase incident response state machine; eliminated false claims that re-encryption or key rotation repairs historical confidentiality exposure or tag forgery; enforced independent audit evidence and dual-party sign-off.

### Phase B.10 Independent Security Review Remediation Pass (v2.0.0)
Independent review of v1.9.0 baseline commit `2c4d989dc3b52c5f11ec368afaedab1d63e07b52` did not approve Gate B due to three confirmed boundary and privilege discrepancies:
1. **MongoDB Self-Credential Rotation Privilege Correction (Finding B38-40):**
   - *Confirmed Defect:* The v1.9.0 privilege matrix granted action `changePassword` to `decision_os_db_admin_slot_${k}`. In MongoDB RBAC, `changePassword` authorizes changing *other* users' passwords, whereas self-rotation of the authenticated principal's own password strictly requires `changeOwnPassword`. Granting `changePassword` unnecessarily expands privilege and misaligns with MongoDB's engine-enforced authorization model.
   - *Remediation:* Enforced **`actions: ["changeOwnPassword"]`** on `{ db: "decision_os_test_slot_" + k, collection: "" }` for slot administrator self-rotation across every privilege matrix, operation allocation, sequence diagram, and failure mode. Removed `changePassword` entirely from the slot admin role. Preserved majority-journaled acknowledgement (`{ w: "majority", j: true }`) and the slot reassignment gate. Revised test specification **`D38-40`**.
2. **Enforced Vault Authentication Boundary via Dedicated Gateway & Network Policy (Finding B38-41):**
   - *Confirmed Defect:* The v1.9.0 design recorded `jti` in MongoDB, but Vault's authentication endpoint (`POST /v1/auth/jwt/login`) remained directly accessible over the network. An attacker holding a signed JWT could bypass the coordination authority by submitting the JWT directly to Vault.
   - *Remediation:* Formalized **Option A (Dedicated JWT Redemption Gateway + Vault Ingress Network Policy)** as the canonical production architecture. All JWT authentication requests must be routed to the dedicated **JWT Redemption Gateway** (`apps/jwt-redemption-gateway`, service account `decision_os_jwt_redemption_gateway`), which validates claims and atomically claims `jti` in `rs_coord:27019.jwt_redemptions` with `{ w: "majority", j: true }` before contacting Vault. Vault's `/v1/auth/jwt/login` listener is strictly fenced behind a Kubernetes `NetworkPolicy` / host netfilter rule permitting TCP port 8200 ingress **exclusively from the authorized gateway**. Direct network routes from worker or provisioner pods are eliminated; packet filters reject unauthorized direct bypass attempts natively at Layer 4. Revised test specification **`D38-41`**.
3. **Specification of Canonical WORM Plaintext Evidence Record (Finding B38-42):**
   - *Confirmed Gap:* v1.9.0 required plaintext hashes to match independent WORM audit checkpoints, but lacked a concrete evidence schema binding trusted plaintext digests to specific Decision OS object versions, canonicalization standards, pre-incident timestamps, and external signing keys.
   - *Remediation:* Formally specified the **Canonical WORM Plaintext Evidence Record** (`CanonicalWormPlaintextEvidenceRecord`) containing 13 mandatory semantic fields: `objectId`, `objectType`, `objectVersion`, `revisionId`, `canonicalizationSpec` (RFC 8785 JCS v1.0), `digestAlgorithm` (SHA-256), `plaintextDigest`, `keyVersionPrefix`, `allocatorEpoch`, `evidenceCreatedAtISO`, `checkpointId`, `signingAlgorithm` (Ed25519), and `signingKeyId` (external compliance HSM key). Enforced 8 strict recovery rules: evidence creation must predate the compromise ($t_{\text{evidence}} < t_{\text{compromise}}$), candidate plaintexts must be canonicalized and digest-verified, signatures must validate against pinned keys, and dual-party SRE Lead and Security Officer sign-off is mandatory prior to unquarantining. Revised test specification **`D38-42`**.
4. **Comprehensive Traceability & Lineage Audit:** Added an exhaustive Finding-to-Design-to-Test Traceability Matrix (Section 20.3) covering all 42 architecture findings (B38-01 through B38-42). Preserved all accepted boundaries; Gate B remains **PENDING INDEPENDENT REVIEW** (Phase C not started).


### Phase B.11 Vault Gateway Boundary, Durable JWT State Machine & WORM Evidence Remediation
Independent architectural review of baseline commit `1bc3ecd0ee5224aa395c4d472675ae0c4789a1e9` (v2.0.0) identified remaining security, topological, and state-machine defects across findings B38-41 and B38-42:
1. **Contradictory Vault Access Topology & NetworkPolicy Realism (Finding B38-41):**
   - *Defect:* v2.0.0 restricted Vault network access to the JWT redemption gateway on TCP port 8200, but sequence diagrams and operational flows still showed the Provisioner making direct Vault API calls to read `secret/data/slots/slot_01` and write rotated credentials back to Vault. Furthermore, Kubernetes NetworkPolicy operates strictly at Layer 3/Layer 4 and cannot filter Vault API URL paths on the same TCP port.
   - *Remediation:* Reconciled the architecture around **one coherent topology: All Vault API interactions pass strictly through the Dedicated Vault Gateway (`apps/vault-gateway`, service account `decision_os_vault_gateway`)**. Provisioners and workers have **zero direct network route** to Vault TCP port 8200. The Provisioner authenticates to the Gateway via mTLS presenting a verified SPIFFE workload identity (`spiffe://decision-os.internal/ns/decision-os-system/sa/decision-os-provisioner`) and signed lease JWT. The Gateway validates caller authorization, claims `jti` durably, executes Vault operations, and returns only minimal database credentials (`username`, `password`). **The Provisioner never receives a Vault client token.** Credential rotation writes also pass strictly through the Gateway (`POST /v1/vault-gateway/slots/:slot_id/rotate`). Kubernetes NetworkPolicy fences Vault port 8200 strictly to Gateway pods, backed by mandatory Kubernetes RBAC and Admission Control rules preventing untrusted pods from claiming Gateway labels.
2. **Durable JWT Redemption State Machine & Conservative Fail-Closed Handling (Finding B38-41):**
   - *Defect:* v2.0.0 claimed crash recovery for JWT redemptions, but relied on a naive `insertOne` + HTTP 409 pattern that could not distinguish a crash before Vault request dispatch from a crash during or after Vault token issuance. Furthermore, the MongoDB privilege matrix granted the Gateway `insert` but denied `update`, creating a contradiction with state machine transitions.
   - *Remediation:* Formalized an explicit **7-state durable redemption state machine**: `CLAIMED` $\rightarrow$ `VAULT_REQUEST_SENT` $\rightarrow$ `ISSUED` (terminal success) / `OUTCOME_UNKNOWN` $\rightarrow$ `QUARANTINED` (terminal lock) / `RECONCILED` / `EXPIRED`. Explicitly granted Gateway `find`, `insert`, `update`, `createIndex` on `rs_coord:27019.jwt_redemptions` scoped strictly to that collection. Formulated atomic CAS updates with `fencing_generation` and `owner_instance_id`. Analyzed all 7 crash and concurrency points; enforced conservative fail-closed quarantine (`OUTCOME_UNKNOWN` $\rightarrow$ `QUARANTINED`) when Vault issuance outcome cannot be mathematically proven. Retries of quarantined `jti`s are strictly blocked.
3. **Correction of Stale Vault Identity Metadata References (Finding B38-41):**
   - *Defect:* v2.0.0 corrected templated policies to Entity Alias Metadata in some sections, but left stale `identity.entity.metadata.slot_id` references in Sections 1, 3.3.4, 4.1.2, 7.5.4, 14, 15, and 21.
   - *Remediation:* Globally reconciled all occurrences to `identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id`. Documented the exact HashiCorp Vault relationship: the JWT auth engine mounts under accessor `auth_jwt_9f8e7d6c` and populates Entity Alias Metadata via `claim_mappings`, which must be referenced via the alias path.
4. **Hardening of Canonical WORM Plaintext Evidence Record & Independent Proof (Finding B38-42):**
   - *Defect:* v2.0.0 had a 1-year timestamp mismatch between `evidenceCreatedAtISO` (2026) and `evidenceCreatedAtEpochMs` (2025); the schema field count was inconsistent across sections; exact Ed25519 signature payload semantics were undefined; signer-controlled timestamps were erroneously described as proof against backdating without independent trust; and the illustrative SHA-256 digest was the empty-string hash.
   - *Remediation:* Reconciled timestamp ISO and epoch milliseconds to the exact same instant (`2026-11-10T10:00:00.000Z` $\leftrightarrow$ `1794304800000`) and added validation rule `evidenceCreatedAtEpochMs === Date.parse(evidenceCreatedAtISO)`. Reconciled the definitive **19-field inventory** across all sections. Formalized byte-exact Ed25519 signature semantics using RFC 8785 JSON Canonicalization Scheme (JCS) with domain separation prefix `DECISION_OS_WORM_EVIDENCE_V2:`, strictly excluding the `signature` field itself. Established an independent trust mechanism combining **RFC 3161 Timestamp Tokens (TST)** and **independently verifiable Merkle audit tree checkpoint inclusion proof** (`checkpointHeight` and Merkle audit path). Replaced the empty-input hash placeholder with the concrete computed SHA-256 digest (`3ebb50525651733616afcdfcca0bc572e973ca4c86e96bda3b3d923f0f348307`) of an explicit candidate decision payload (noted in Phase B.12 as an erroneous test vector calculation, corrected to `90ca3b570b7e806657a928518b70ee710b342ea6e315187e7a1dcc4b409cab4e`).

### Phase B.12 Final Vault Gateway, JWT Redemption & WORM Evidence Corrections (v2.2.0)
Independent architectural review of baseline commit `63c3a6e3201600e042f78ec51a3e97fcb739e4fa` (v2.1.0) identified twelve security, cryptographic, and state-machine defects (B11-01 through B11-12) requiring complete architectural remediation:
1. **Vault Rotation Authorization & Policy Separation (Finding B11-01):**
   - *Defect:* The documented `slot-lease-reader` Vault policy granted only `read`, but the gateway's rotation endpoint must write updated credentials to HashiCorp Vault KV-v2 (`secret/data/slots/:slot_id`). The read identity cannot perform writes.
   - *Remediation:* Formalized separate, least-privilege Vault identities and policies:
     - **Read Identity (`slot-lease-reader`):** Ephemeral single-use token obtained via `auth/jwt` with claim-mapped Entity Alias Metadata. Granted strictly `capabilities = ["read"]` on `secret/data/slots/{{identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id}}`. Explicitly denied write, create, update, delete, list.
     - **Rotation Identity (`slot-credential-rotator`):** Dedicated Vault Gateway client authenticated via Vault Kubernetes Auth (`auth/kubernetes`) bound to Gateway ServiceAccount (`decision_os_vault_gateway`). Granted strictly `capabilities = ["create", "update"]` on `secret/data/slots/+` (matching single segment only) and `capabilities = ["read"]` on `secret/metadata/slots/+` for CAS version checks. Denied all administrative, list, delete, destroy, or arbitrary secret paths.
     - **Reconciler Identity (`slot-admin-reconciler`):** Separately authenticated via offline SRE mTLS (`auth/cert`). Granted token lookup/revocation and audit inspection; zero read/write on secret data.
     - **Signed Revocation Order Contract:** Rotation writes require an Ed25519-signed revocation order binding `orderId`, `action`, `slotId`, `leaseId`, `expectedPreviousGeneration`, `newCredentialGeneration`, `operationId`, `expiresAt`, `authorizedCaller`, and `newPasswordSha256`. Enforced replay prevention, idempotent responses, and response-loss recovery via `rs_coord:27019.slot_rotation_log`. Proof of Vault write commitment is established via KV-v2 CAS (`cas: expectedPreviousGeneration`) and verified version return (`data.version === newCredentialGeneration`). Path substitution and traversal are blocked via canonical slot regex validation (`^slot_([0-1][0-9]{2}|2[0-4][0-9]|25[0-5])$`), exact URL-to-payload match, and Vault single-segment `+` policy scoping.
2. **Complete Fencing for Every JWT State Transition (Finding B11-02):**
   - *Defect:* Several transitions in the 7-state redemption machine omitted fencing generation and owner verification. Unfenced updates (`updateOne({ _id: jti, status: "OUTCOME_UNKNOWN" }, ...)`) risked race conditions and state corruption. Furthermore, the runtime gateway role unnecessarily retained `createIndex`.
   - *Remediation:* Audited every transition across all seven states (`CLAIMED`, `VAULT_REQUEST_SENT`, `ISSUED`, `OUTCOME_UNKNOWN`, `QUARANTINED`, `RECONCILED`, `EXPIRED`). Formulated a comprehensive 12-attribute transition specification (current state, trigger, authorized actor, expected owner, expected fencing generation, lease expiry condition, atomic CAS filter, atomic update, write concern `w: "majority", j: true`, behavior on `matchedCount === 0`, terminal status, audit event identity). Enforced strictly monotonic generation advancement (1 -> 2 -> 3 -> 4 -> 5; zero decrement or reuse). Removed `createIndex` from the runtime gateway role; all collection indexes are pre-created during bootstrap by `decision_os_offline_bootstrap`.
3. **Resolution of Dispatch-Intent vs Actual Vault Request Ambiguity (Finding B11-03):**
   - *Defect:* The architecture previously claimed that recording `VAULT_REQUEST_SENT` proved the network request reached Vault. A database write proves intent, not network delivery.
   - *Remediation:* Formally distinguished durable intent, request dispatch, response receipt, token issuance, secret retrieval, credential delivery, and durable acknowledgement. Rigorously analyzed all 11 crash points (crashes before/after intent, mid-dispatch, Vault receipt, token issuance, secret read, state commit, HTTP response, token revocation, timeouts/5xx, and MongoDB primary failover). Enforced that the protocol NEVER issues a second Vault token on unknown outcome, failing closed to `OUTCOME_UNKNOWN` -> `QUARANTINED`. Formally distinguished at-most-once authorization, at-most-once token issuance, at-most-once credential delivery, and idempotent response behavior.
4. **Authoritative Recovery Service and Takeover Protocol (Finding B11-04):**
   - *Defect:* The recovery actor for stale redemption records was unspecified. Restarted gateways could blindly assume ownership of unverified requests.
   - *Remediation:* Formalized the dedicated **Recovery Service** (`apps/recovery-service`, ServiceAccount `decision_os_recovery_service`, distinct Deployment in `decision-os-system`). Authenticated via mTLS SPIFFE ID; granted `find` and `update` strictly on `jwt_redemptions` and `ownership_locks` on `rs_coord:27019`. Egress to Vault port 8200 is blocked by Layer 4 NetworkPolicy, physically preventing the recovery service from dispatching Vault requests. Enforced 5s heartbeat and 15s expiration timeout. Defined the takeover protocol: safely expiring abandoned `CLAIMED` records (`CLAIMED` -> `EXPIRED`) while strictly quarantining indeterminate `VAULT_REQUEST_SENT` records (`VAULT_REQUEST_SENT` -> `OUTCOME_UNKNOWN` -> `QUARANTINED`). A restarted gateway never resumes old requests. Every takeover emits `JWT_RECOVERY_TAKEOVER` to `cleanup_audit_log`.
5. **Administrative Reconciliation Authorization (Finding B11-05):**
   - *Defect:* The authorization model for releasing quarantined JWT redemptions lacked cryptographic rigor, relying on operator assertions without proof of Vault state.
   - *Remediation:* Established an independent administrative reconciliation authority (`decision_os_admin_operator` with `ADMIN_OPERATOR` and `SECURITY_OFFICER` roles). Ordinary gateways and provisioners possess zero reconciliation authority. Mandated an Ed25519-signed, immutable `ReconciliationAuthorizationRecord` canonicalized under RFC 8785 JCS with domain prefix `"DECISION_OS_ADMIN_RECONCILIATION_V1:"`. Dual-party authorization (SRE Lead AND Security Officer) is strictly required to unquarantine. Mandated independent verification of signed Vault audit logs proving that the token was either revoked or never minted. If Vault token issuance cannot be conclusively proven dead or non-existent, reconciliation strictly refuses to release the slot.
6. **Correction of the SHA-256 Test Vector (Finding B11-06):**
   - *Defect:* The v2.1.0 document recorded `3ebb50525651733616afcdfcca0bc572e973ca4c86e96bda3b3d923f0f348307` as the SHA-256 digest of the canonical candidate decision payload. That digest was mathematically incorrect.
   - *Remediation:* Recalculated the digest using a reproducible cryptographic implementation. The exact canonical RFC 8785 JSON byte sequence `{"action":"EXECUTE_TRANSACTION","amount":10000,"currency":"USD","decisionId":"dec-2026-11-10-001","slotId":"slot_01"}` produces SHA-256 digest:
     `90ca3b570b7e806657a928518b70ee710b342ea6e315187e7a1dcc4b409cab4e`.
     Provided the exact reproducible verification command. Replaced the incorrect digest globally across sample evidence, test specifications, and traceability tables, preserving the old value solely in historical defect records.
7. **Correction of Plaintext Byte Length (Finding B11-07):**
   - *Defect:* The v2.1.0 evidence record specified `plaintextByteLength: 115`.
   - *Remediation:* Recalculated the exact UTF-8 byte count of the canonical JSON byte stream above: exactly **117 bytes** (`Buffer.from(canonicalJson, "utf8").length === 117`). Reconciled byte length across schema, sample record, recovery rules, and test specification `D38-42`. Added an explicit test rejecting mismatched byte length.
8. **Authoritative and Complete Evidence Schema (Finding B11-08):**
   - *Defect:* The previous 19-field inventory omitted fields required by its own verification procedures (`canonicalizationSpec`, `digestAlgorithm`, `signingAlgorithm`, `signingKeyId`, `merkleCheckpointId`).
   - *Remediation:* Formalized the authoritative **Canonical WORM Plaintext Evidence Record Schema v2.2.0** comprising exactly **26 versioned data fields** (+ `$schema` URI metadata). Defined an exhaustive inventory table specifying data types, validation constraints, inclusion in primary signature, inclusion in TSA commitment, inclusion in Merkle leaf, and post-creation immutability.
9. **Timestamping the Complete Evidence Commitment (Finding B11-09):**
   - *Defect:* v2.1.0 claimed the RFC 3161 TSA token bound only `decisionPayloadSha256` and `evidenceRecordId`, failing to cryptographically bind the complete evidence record.
   - *Remediation:* Defined the exact RFC 3161 message imprint:
     TsaCommitmentBytes = "DECISION_OS_TSA_COMMITMENT_V1:" || CoreDigest || UTF8(signature), where CoreDigest commits to all 17 Core fields. The message imprint is SHA-256(TsaCommitmentBytes). Defined ASN.1 DER TSA response validation, certificate chain verification, and timestamp comparison rules against t_compromise.
10. **Non-Circular Merkle Evidence Construction (Finding B11-10):**
    - *Defect:* Previous formulations risked circular dependency between the evidence record, signature, TSA token, and Merkle inclusion proof.
    - *Remediation:* Formulated an exact multi-stage non-circular commitment protocol: (1) Construct Evidence Core; (2) Sign Core with Compliance HSM (`signature`); (3) Timestamp Core + Signature via RFC 3161 TSA (`tsaTimestampToken`); (4) Compute RFC 6962 domain-separated leaf hash (0x00 || CoreDigest || SHA-256(signature) || SHA-256(tsaToken)); (5) Commit leaf to Merkle audit tree; (6) Sign checkpoint root (`merkleCheckpointSignature`) and generate inclusion proof (`merkleInclusionProof`); (7) Attach dual-party unquarantine signatures upon incident recovery. The leaf strictly commits to core, signature, and timestamp; the proof and checkpoint are verification witnesses external to the leaf.
11. **Independent Signature Semantics (Finding B11-11):**
    - *Defect:* Signature semantics were ambiguous; multiple signature fields did not prove two-person authorization.
    - *Remediation:* Formally specified exact payloads, algorithms, key identifiers, public-key trust sources, canonical serializations, domain prefixes, and verification procedures for all four digital signatures: (1) Primary HSM Evidence Signature (`"DECISION_OS_WORM_SIGNATURE_V2:"`), (2) Compliance Officer Authorization (`"DECISION_OS_COMPLIANCE_AUTH_V1:"`), (3) SRE Lead Authorization (`"DECISION_OS_SRE_AUTH_V1:"`), and (4) Checkpoint Notary Signature (`"DECISION_OS_MERKLE_CHECKPOINT_V1:"`). Both compliance and SRE approvals sign the exact same canonical unquarantine order payload.
12. **Reproducible Synthetic Test Fixture (Finding B11-12):**
    - *Defect:* Sample evidence records contained illustrative placeholders (`MIIEP...`, `0x9f8e...`) that could be mistaken for unverified production artifacts.
    - *Remediation:* Selected **Option A (Reproducible Synthetic Fixture)**. Generated a fully valid, structurally and cryptographically sound synthetic test fixture using deterministic test keys and reproducible Node.js script. Labeled every field as synthetic. Generated valid Ed25519 signatures, DER-structured mock TSA token, RFC 6962 Merkle tree root, and valid inclusion proof. Clarified that test fixtures prove schema and algorithm validity, not production trust.

### Phase B.13 Final Vault Audit, Rotation Crash Safety & WORM Evidence Remediation (v2.3.0)
Independent architectural review of baseline commit `d6a35bd7910f9c028357d855e9f98caf3689b038` (v2.2.0) identified eight critical architectural, cryptographic, and state-machine defects (B12-01 through B12-08) requiring rigorous remediation:

1. **Vault Audit Evidence Retrieval & Forensic Architecture (Finding B12-01):**
   - *Defect:* v2.2.0 granted `slot-admin-reconciler` access to `path "sys/audit"` and described this as independent audit-event inspection. In HashiCorp Vault, `sys/audit` configures/inspects audit devices, but does NOT return audit events via HTTP GET.
   - *Remediation:* Formalized the distinction between audit device configuration (`sys/audit`), actual emitted audit events, external immutable audit storage, and forensic evidence retrieval. Defined an external audit delivery architecture streaming Vault JSON audit logs over mTLS (TLS 1.3) with sidecar delivery (Fluent Bit/Vector) to write-once WORM cloud storage (AWS S3 Object Lock in COMPLIANCE mode / GCS Bucket Lock >= 7 years). Defined dedicated read-only forensic identity `decision_os_audit_investigator` possessing zero secret-read or rotation privileges. Established precise correlation contracts linking Vault events to `jti`, `operationId`, `leaseId`, `slotId`, and Gateway request headers. Mandated fail-closed behavior: if audit logs are delayed or unavailable, administrative unquarantine is strictly blocked.

2. **Gateway Authorization Alignment & Durable Rotation State Machine (Finding B12-02):**
   - *Defect:* The Gateway rotation workflow required recording operations in `decision_os_coordination.slot_rotation_log`, but Table 7.6.1 granted access only to `jwt_redemptions`. Furthermore, rotation crash recovery and its durable state machine were incomplete.
   - *Remediation:* Reconciled Table 7.6.1 by explicitly granting `decision_os_vault_gateway` minimum actions `["find", "insert", "update"]` on `decision_os_coordination.slot_rotation_log` (`createIndex`, `remove`, and DDL strictly denied). Formalized the complete `slot_rotation_log` schema with unique compound indexes (`{ slot_id: 1, new_credential_generation: 1 }` and `{ operation_id: 1 }`). Formalized an authoritative 7-state durable rotation state machine (`PREPARED` $
ightarrow$ `DISPATCH_INTENT_RECORDED` $
ightarrow$ `VAULT_WRITE_CONFIRMED` $
ightarrow$ `COMPLETED` / `OUTCOME_UNKNOWN` $
ightarrow$ `QUARANTINED` $
ightarrow$ `RECONCILED`) with complete atomic compare-and-set filters, owner verification, and monotonic generation advancement. Rigorously analyzed all 8 rotation crash points and defined idempotent recovery without blind re-rotations.

3. **Vault-Enforced Per-Slot Rotation Authorization Boundary (Finding B12-03):**
   - *Defect:* The v2.2.0 `slot-credential-rotator` policy granted `path "secret/data/slots/+"` with `create, update`, permitting the shared identity to update any single-segment slot path. Application-level request checking does not provide Vault-native isolation.
   - *Remediation:* Replaced the shared wildcard policy with 256 discrete, declarative, narrowly scoped Vault policies (`slot-rotator-slot_000` through `slot-rotator-slot_255`) generated during cluster bootstrap. Each policy restricts writes strictly to its designated slot (`path "secret/data/slots/slot_NNN" { capabilities = ["create", "update"] }`), permits metadata read for CAS check, and strictly denies payload read (`secret/data/*`), bulk listing, or cross-slot access. The Gateway assumes the slot-specific role via ephemeral scoped token exchange upon presenting a verified revocation order, ensuring Vault natively enforces path isolation against a compromised Gateway.

4. **Correct Token-Issuance Guarantee Taxonomy & Redispatch Prohibition (Finding B12-04):**
   - *Defect:* v2.2.0 risked conflating single-use token consumption (`token_num_uses = 1`) with at-most-once Vault token issuance across network partitions and crashes.
   - *Remediation:* Clarified that `token_num_uses = 1` restricts the *consumption* of an already minted token, but does NOT prevent duplicate token issuance if multiple login requests reach Vault. Explicitly categorized at-most-once Vault token issuance across untracked network boundaries as **NOT GUARANTEED** without cross-system distributed 2PC. Explicitly prohibited automated redispatch across reverse proxies, service meshes, Gateway HTTP clients, and recovery services after an ambiguous outcome, mandating immediate fail-closed quarantine (`QUARANTINED`). Formally separated five distinct guarantees.

5. **Genuine Synthetic RFC 3161 DER Timestamp Token Fixture (Finding B12-05):**
   - *Defect:* v2.2.0 encoded a JSON object as Base64 and described it as a structurally valid DER-encoded RFC 3161 timestamp token.
   - *Remediation:* Generated a genuine, syntactically and cryptographically valid ASN.1 DER `TimeStampToken` (CMS `ContentInfo` type `id-signedData`, OID `1.2.840.113549.1.7.2`, containing `SignedData` with encapsulated `TSTInfo`, OID `1.2.840.113549.1.9.16.1.4`, SHA-256 message imprint, serial number, GeneralizedTime, synthetic TSA certificate, and valid Ed25519 signature). Independently parsed and verified the complete DER hierarchy using both Python and Node.js ASN.1 parsers. Clearly labeled all keys and certificates as synthetic test fixtures.

6. **Reconciliation of Single Authoritative Merkle Checkpoint Root (Finding B12-06):**
   - *Defect:* v2.2.0 contained two conflicting Merkle roots (`b8ccf706...` vs `46d6565b...`).
   - *Remediation:* Recomputed the deterministic Merkle tree using the exact canonical payload (117 bytes, SHA-256 `90ca3b57...`), Core digest (`b9ccb6cf...`), primary signature, genuine DER TSA token digest, and RFC 6962 Leaf 0. Produced exactly **one authoritative Merkle root**:
     `e3f6f3504f211d64c383acb50260e7b6f6cccba7522f0fdf98b83cd8145d5248`
     at `checkpointHeight: 8421` (`chk-2026-11-10-8421`). Verified the 2-sibling inclusion proof independently against this root and reconciled all root occurrences globally.

7. **Authoritative Credential-Generation Semantics & Vault KV-v2 Binding (Finding B12-07):**
   - *Defect:* The v2.2.0 signed revocation order specified `credentialGeneration = 1`, `expectedPreviousGeneration = 0`, `newCredentialGeneration = 2`, mixing previous and current generation semantics and conflating them with Vault version numbers.
   - *Remediation:* Formalized an unambiguous generation contract: Let $N \ge 1$ be the active generation. In Phase 2 Revocation, rotating from generation $N$ to $N+1$ requires `currentCredentialGeneration: N`, `expectedPreviousGeneration: N`, and `newCredentialGeneration: N + 1`. Bound logical generation monotonically to Vault KV-v2 version: $	ext{logicalGeneration} \equiv 	ext{vaultKv2Version}$. Vault KV-v2 CAS strictly requires `cas: N`, resulting in `target_version: N + 1`. Reconciled all sample orders, state transitions, and tests.

8. **Rigorous Cryptographic Evidence Commitment Scope Formulation (Finding B12-08):**
   - *Defect:* v2.2.0 claimed the TSA token "binds the complete evidence record", whereas the TSA message imprint only covers the Evidence Core and primary signature.
   - *Remediation:* Explicitly delineated the cryptographic coverage of every layer: (1) Primary HSM Signature covers Fields 1–17 (`CoreDigest`); (2) RFC 3161 TSA imprint covers Fields 1–18 (`CoreDigest || UTF8(primaryEvidenceSignature)`); (3) RFC 6962 Merkle Leaf Hash commits to Fields 1–19; (4) Merkle Checkpoint and Proof (Fields 20–24) are **external verification witnesses**; (5) Post-Incident Signatures (Fields 25–26) are a **versioned post-incident extension** signing a canonical Unquarantine Order binding `evidenceRecordId`, `decisionPayloadSha256`, `targetSlotId`, and `merkleCheckpointRoot`. Updated the authoritative 26-field inventory table accordingly.

---

## 2. Baseline and Inspected Source References

### 2.1 Git Baseline & Provenance Verification
- **Target Repository:** `AmiTtiwari43/Decision-OS`
- **Active Branch:** `fix/batch4-replica-set-transactional-recovery`
- **Current Baseline Commit:** `d6a35bd7910f9c028357d855e9f98caf3689b038` (`docs: complete vault gateway rotation, jwt fencing, and worm evidence remediation (v2.2.0)`)
- **Parent Baseline Commit:** `63c3a6e3201600e042f78ec51a3e97fcb739e4fa` (`docs: reconcile vault gateway topology, formalize durable jwt state machine and harden worm evidence (v2.1.0)`)
- **Prior Lineage Commits:**
  - `d6a35bd7910f9c028357d855e9f98caf3689b038` (`docs: complete vault gateway rotation, jwt fencing, and worm evidence remediation (v2.2.0)`)
  - `63c3a6e3201600e042f78ec51a3e97fcb739e4fa` (`docs: reconcile vault gateway topology, formalize durable jwt state machine and harden worm evidence (v2.1.0)`)
  - `1bc3ecd0ee5224aa395c4d472675ae0c4789a1e9` (`docs: correct self-credential privilege, enforce vault ingress boundary and define WORM evidence (v2.0.0)`)
  - `2c4d989dc3b52c5f11ec368afaedab1d63e07b52` (`docs: harden lease credentials, JWT redemption and nonce incident recovery (v1.9.0)`)
  - `16eb385a5c73b307ff5331a769711dd55854db91` (`docs: eliminate broker cross-database authority, harden vault binding and revocation ordering (v1.8.0)`)
  - `3dc53fccb1ade7f6206fdf98372ef4c1aaad9956` (`docs: harden bootstrap broker boundary, nonce allocator authority, and network revocation (v1.7.0)`)
  - `992a4cd326fe39865a723c29e974ba0f31707e8a` (`docs: remediate provisioning scope, revocation authority, and cryptographic nonce uniqueness (v1.6.0)`)
  - `5ef95550c0709fdc99186bf42e5352f3aa846b4e` (`docs: separate destructive and provisioning privilege boundaries and harden revocation protocol`)
  - `f0fbfc1b6d04ad947f85277435d0803282cd03cd` (`docs: harden batch 4 v3.8 revocation and recovery protocol`)
  - `949ca35a7154f4c4db308dd73badf85221a98c9f` (`docs: harden batch 4 v3.8 worker identity and role provisioning`)
  - `724f1076284b186f42759677ab9e480d27531b69` (`docs: close batch 4 v3.8 privilege and redispatch gaps`)
  - `943a8e7a433ce1b98804a83c6be403b2fca52e96` (`docs: harden batch 4 v3.8 cleanup executor architecture`)
  - `161e59e85bb7183c21926f0b04f788eb43312394` (`refactor: add architecture decision record for batch 4 v3.8 cleanup executor`)
  - `bbaf9bee29ef40f80bb8b958569c7ebbb437b427` (`docs: add batch 4 v3.8 destructive call-site inventory document`)
  - `2e276058c119c36ef4d8e5d665bd6c029b2cc6bb` (`fix(batch4): isolate destructive cleanup behind supervised executor v3.7`)
- **Verification Note:** The repository working tree and GitHub remote branch `fix/batch4-replica-set-transactional-recovery` were independently inspected. Baseline commit `1bc3ecd0ee5224aa395c4d472675ae0c4789a1e9` is verified as the branch HEAD, descending directly from parent `2c4d989dc3b52c5f11ec368afaedab1d63e07b52`.
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

### 3.3 Evaluation of Provisioning Delegation Architecture Alternatives (Finding B38-26, B38-31, B38-36)
To eliminate the central provisioner's cross-database user and role administration authority while ensuring test databases receive initial narrowly scoped authority, four architecture models were evaluated:

1. **Alternative 1: Centralized Provisioner with `{ db: "", collection: "" }` UserAdmin (REJECTED — B38-26 Defect)**
   - *Mechanism:* Central `decision_os_provisioner` possesses `createRole`, `createUser`, `grantRole`, `dropUser`, `dropRole` across `{ db: "", collection: "" }` on `rs_test`. Roles are created directly on non-admin databases.
   - *Flaw:* While non-admin roles cannot contain privileges on other databases, the provisioner's *authorization to administer roles and users* is unrestricted across all non-admin databases. A compromised provisioner can create backdoors, alter passwords, or revoke roles across any worker's database, completely breaking per-worker multi-tenant isolation.
2. **Alternative 2: Pure On-Demand Role Administration via `admin` Superuser Delegation (REJECTED)**
   - *Mechanism:* Provisioner connects with root credentials on `admin` to dynamically grant itself scoped rights per claim.
   - *Flaw:* Merely moves unrestricted authority to a superuser credential, multiplying the blast radius of any compromise.
3. **Alternative 3: Central Ephemeral Credential Broker with `{ db: "", collection: "" }` (REJECTED — B38-36 Defect)**
   - *Mechanism:* In v1.7.0, an isolated credential broker (`apps/credential-broker`) held `{ db: "", collection: "" }` user/role management actions on `rs_test`, constrained by application-level regex validation (`^decision_os_test_[a-zA-Z0-9_-]+$`) and Ed25519-signed API claims.
   - *Flaw:* **Explicit Acknowledgment of Cross-Database Blast Radius:** In MongoDB RBAC, `{ db: "", collection: "" }` is an unrestricted wildcard covering every non-system database across the entire replica set. Under MongoDB's native authorization engine, any principal with this privilege has wire-level authority to manage users and roles across all existing and future worker databases. Application-level regex checks, signed API requests, and container boundary isolation provide **zero MongoDB-native database isolation**. An adversary who compromises the broker process or extracts its MongoDB connection credentials can bypass the broker application code entirely, connect directly to `rs_test:27018`, and alter users or inject backdoors into any worker's database. Claiming native isolation under this topology is false.
4. **Alternative 4: Pre-Provisioned Per-Target Administrative Principals Architecture (SELECTED — Finding B38-36)**
   - *Mechanism:*
     - **Elimination of Runtime Broker:** The central runtime broker holding `{ db: "", collection: "" }` is completely eliminated from standard test execution. No service on the active worker path possesses wildcard user- or role-administration privileges.
     - **Pre-Provisioned Partition Pools:** All standard test workloads lease pre-allocated partition slot databases (`decision_os_test_slot_000` through `slot_255`), pre-initialized during offline cluster bootstrap by `deploy/init-mongo-test.sh`.
     - **Strict Database-Scoped Administrative Identities:** For each partition slot $k$, the offline bootstrap creates a dedicated, discrete administrator `decision_os_db_admin_slot_${k}` whose MongoDB RBAC authorization scope is strictly `{ db: "decision_os_test_slot_" + k, collection: "" }`. It possesses zero privileges on any other database.
     - **Exact Lease-to-Secret Vault Binding (B38-37, B38-41):** Slot credentials are held in a **Partition Slot Vault** (`apps/slot-vault`) enforcing templated path policies bound strictly to Entity Alias Metadata (`path "secret/data/slots/{{identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id}}" { capabilities = ["read"] }`). Access to Vault's authentication endpoint is mediated exclusively by a dedicated **JWT Redemption Gateway** (`apps/jwt-redemption-gateway`), protected by Layer 4 Kubernetes NetworkPolicy ingress fencing. The provisioner exchanges a signed lease JWT containing a unique `jti` for a single-use (`num_uses = 1`, `ttl = 60s`, `renewable = false`) Vault token that can read *only* the specific leased slot. One-time redemption is enforced durably by the Coordination Authority before Vault token minting (`rs_coord:27019.jwt_redemptions`). Direct path substitution (`slot_02` using a `slot_01` token) is rejected natively with HTTP 403 Forbidden, and direct worker bypass attempts are blocked at the transport layer.
     - **Non-Existent Target Database Handling:** If a test requests an unallocated or non-existent database name, the request is immediately rejected with `UnallocatedDatabaseException`. No dynamic unscoped administrator exists to create arbitrary databases at runtime.
     - **Control-Plane Root of Trust Designation:** If dynamic expansion beyond the pre-allocated pool is ever required, it is designated strictly as an **Offline / Control-Plane Root of Trust** (`deploy/init-mongo-test.sh`), executed during maintenance or scaling windows. Any optional dynamic broker is classified as an uncontained control-plane root of trust and disabled by default in production (`DECISION_OS_DYNAMIC_PROVISIONING_ENABLED=false`).
   - *Guarantee:* At runtime, **zero active services possess wildcard `{ db: "", collection: "" }` user/role administration rights**, and no service can retrieve partition credentials in bulk or substitute paths. Compromise of the provisioner or any individual worker's scoped admin credential gives an attacker zero wire-level capability to access or administer another worker's database.

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

### 3.6 Evaluation of Credential Lifecycle Models for Leased Slots (Finding B38-40)
To resolve the critical vulnerability where Vault token expiry leaves a reusable MongoDB credential across slot reassignment, two credential lifecycle models and rotation privilege specifications were evaluated:

1. **Option A — Per-Lease MongoDB Identities (Evaluated for Slot Administration — REJECTED FOR SLOTS, ENFORCED FOR WORKERS):**
   - *Mechanism:* Dynamically create a unique MongoDB identity for every lease (e.g. `decision_os_db_admin_slot_${k}_${leaseId}`). Restrict privileges strictly to that single slot database, and drop the identity at lease termination.
   - *Architectural Flaw for Slot Administration:* Creating an administrator principal dynamically on a target database *from the outside* requires the creating principal to hold either cluster-wide `userAdminAnyDatabase` or wildcard `{ db: "", collection: "" }` role/user administration actions on `rs_test:27018`. As proven in Finding B38-36, granting wildcard user-management authority to any active runtime component gives an attacker wire-level authority across all test databases if compromised. Alternatively, delegating dynamic user creation to HashiCorp Vault's MongoDB Secrets Engine requires Vault to possess central superuser or `userAdminAnyDatabase` credentials on `rs_test`, re-introducing the central cross-database broker defect under a different service name.
   - *Worker Enforcement:* For worker execution identities (`decision_os_worker_${leaseId}_gen${generation}`), Option A is strictly adhered to because workers are created from within the slot database by the scoped slot administrator.
2. **Option B — Slot Credential Rotation at Every Lease Boundary (SELECTED AS CANONICAL PRODUCTION PATH):**
   - *Mechanism:* Retain pre-allocated partition slot administrators (`decision_os_db_admin_slot_${k}`) whose MongoDB RBAC authorization is physically constrained strictly to `{ db: "decision_os_test_slot_" + k, collection: "" }`. At every lease boundary during Phase 2 Revocation (`IDENTITY_REVOKED`), the control plane rotates the slot administrator's password on the MongoDB server.
   - *Self-Credential Rotation Privilege Specification (B38-40 Correction):*
     - In MongoDB RBAC, modifying user credentials requires distinct privilege actions depending on whether the target user is the authenticated session principal:
       - `actions: ["changePassword"]`: Authorizes modifying the password of *another* user account.
       - `actions: ["changeOwnPassword"]`: Authorizes modifying the *authenticated principal's own* password.
     - When `decision_os_db_admin_slot_${k}` executes `updateUser("decision_os_db_admin_slot_" + k, { pwd: P_{new} })` on its own slot database, the operation is a **self-password rotation**.
     - MongoDB RBAC strictly requires the **`changeOwnPassword`** action on `{ db: "decision_os_test_slot_" + k, collection: "" }`.
     - Granting `changePassword` unnecessarily grants authority to change passwords of any other administrative or service accounts on the database, violating least-privilege. Conversely, if `changePassword` were granted without `changeOwnPassword`, MongoDB's authorization engine would reject the self-update command with Code 13 (`Unauthorized`).
     - **Canonical Privilege Grant:** `decision_os_db_admin_slot_${k}` is granted `actions: ["createRole", "dropRole", "createUser", "dropUser", "grantRole", "revokeRole", "changeOwnPassword", "getRole", "getUser"]`. The broader `changePassword` action is **EXPLICITLY EXCLUDED**.
   - *Majority Write Concern & Server Confirmation:* The self-rotation command is executed with `writeConcern: { w: "majority", j: true }`. Once acknowledged by the replica set majority, the previous password is permanently invalidated in MongoDB's server-side authorization cache. The new credential is saved to Vault at `secret/data/slots/slot_${k}`, and slot reassignment is strictly gated on verified durable confirmation.
   - *Fencing & Session Invalidation:* Existing authenticated sessions and operations are terminated in Phase 3 via `killOp` and `killAllSessionsByPattern`. In accordance with Mandatory Invariant 8, killing sessions alone does NOT invalidate a retained credential; server-side `updateUser` with `changeOwnPassword` is the definitive cryptographic and authentication invalidation boundary.
   - *Production Mandate:* Option B with `changeOwnPassword` self-rotation is the unambiguous canonical production path. Static credentials, unscoped broker identities, and unverified revocation paths are permanently disabled.

### 3.7 Evaluation of Vault Access Topology, Gateway Ingress Boundaries, Least-Privilege Policy Separation, Durable JWT Redemption & Rotation Safety (Findings B38-41, B11-01 through B11-04, B12-01 through B12-04)
To ensure that signed JWTs cannot be replayed, that Vault policy templating binds correctly to authenticated identities, that network fencing is mathematically consistent, that credential rotation cannot read or tamper with unauthorized slots, and that crash recovery does not risk duplicate token issuance or state regression, the Vault access topology, authentication boundaries, and state transitions were systematically evaluated and redesigned:

1. **Resolution of the Contradictory Vault Access Topology:**
   - *Topological Inconsistency in Earlier Revisions:* Earlier specifications placed Vault's TCP port 8200 behind a NetworkPolicy allowing ingress exclusively from the JWT Redemption Gateway, but the sequence diagrams and operational descriptions simultaneously showed the Scoped Provisioning Service making direct HTTP calls to Vault to read slot secrets (`GET /v1/secret/data/slots/slot_01`) and write rotated passwords (`PUT /v1/secret/data/slots/slot_01`). Because NetworkPolicy operates at Layer 3/Layer 4 (IP/port) and cannot selectively permit JWT login while blocking secret reads on the same port, direct provisioner calls directly contradicted the network boundary.
   - *Selected Architecture — Dedicated Vault Gateway Mediating All Vault API Interactions:*
     All Vault interactions (JWT exchange, slot credential retrieval, and slot password rotation updates) pass **strictly through the Dedicated Vault Gateway (`apps/vault-gateway`, service account `decision_os_vault_gateway`)**.
     - **No Direct Provisioner Route:** Direct network routes between the Provisioning Service (`apps/provisioner`) or Worker pods (`apps/worker`) and Vault TCP port 8200 are **completely eliminated**.
     - **Workload Authentication:** The Provisioner authenticates to the Gateway over mutual TLS (mTLS) presenting an authorized SPIFFE workload identity (`spiffe://decision-os.internal/ns/decision-os-system/sa/decision-os-provisioner`) and an Ed25519-signed lease JWT issued by the Coordination Authority.
     - **Gateway Mediation & Zero Client Token Leakage:** The Gateway cryptographically validates caller identity and JWT claims, executes an atomic CAS claim in MongoDB across a durable 7-state machine, performs the Vault operation using scoped Vault credentials, and returns **only the minimal required database credential payload** (`{ username: "decision_os_db_admin_slot_01", password: P_gen1 }`). **The Provisioner never receives a Vault client token.**
     - **Rotated Credential Persistence:** When a slot administrator rotates its password during Phase 2 Revocation (`updateUser`), the Provisioner calls Gateway endpoint `POST /v1/vault-gateway/slots/:slot_id/rotate` over mTLS presenting the signed revocation order. The Gateway validates authorization, updates Vault KV-v2 at `secret/data/slots/:slot_id`, verifies write commitment via metadata check-and-set, increments the credential generation, and returns HTTP 200 `{ ok: 1, generation: nextGen }`.
     - **Response Confidentiality & Bounded Blast Radius:** Gateway responses are strictly scoped to the leased slot. Gateway endpoints enforce strict URI schema validation, preventing arbitrary path traversal, directory listing, or cross-slot credential retrieval.

2. **NetworkPolicy L3/L4 Realism & Workload Identity Model:**
   - *L3/L4 Boundary Realism:* Kubernetes `NetworkPolicy` operates exclusively at the transport layer (TCP/IP). It cannot inspect HTTP request lines, headers, or URL paths. Therefore, the architecture explicitly rejects any claim that NetworkPolicy selectively allows `/v1/auth/jwt/login` while denying `/v1/secret/data/*` on the same port.
   - *Exact Fencing Rule:* NetworkPolicy restricts ingress to Vault's port 8200 listener **exclusively to pods matching the Gateway selector** within the `decision-os-system` namespace (`podSelector: { matchLabels: { app.kubernetes.io/name: vault-gateway } }`). All TCP SYN packets originating from workers, provisioners, or external networks are dropped by Linux netfilter in the data plane.
   - *Workload Identity Limitations of Pod Labels:* Pod labels (`app.kubernetes.io/name: vault-gateway`) are control-plane metadata, NOT cryptographic workload identities. An attacker with Kubernetes pod-creation privileges in the namespace could spoof this label.
   - *Mandatory Security Assumptions:*
     1. Strict Kubernetes RBAC: Ordinary workers and provisioners have zero `pods/create`, `pods/update`, or `pods/patch` permissions in `decision-os-system`.
     2. Admission Control Enforcement: A ValidatingAdmissionWebhook (or OPA Gatekeeper / Kyverno policy) strictly enforces that the `app.kubernetes.io/name: vault-gateway` label can ONLY be applied to pods running the verified Gateway container image with service account `decision_os_vault_gateway`.
     3. Service Mesh Workload Identity (Defense-in-Depth): In production, mutual TLS with cryptographic SPIFFE X.509 certificates (Istio/Linkerd) provides Layer 7 cryptographic authentication between Gateway and Vault.

3. **Gateway MongoDB Privileges & Durable State Machine Operations (Findings B11-02, B11-04, B12-02):**
   - *Removal of `createIndex` from Runtime Gateway Role:* Runtime index creation is **strictly removed** from the Gateway identity (`decision_os_vault_gateway`). All indexes on `decision_os_coordination.jwt_redemptions` and `decision_os_coordination.slot_rotation_log` are pre-created exclusively during system bootstrap by `decision_os_offline_bootstrap`.
   - *Reconciled Runtime Gateway Privileges (Finding B12-02):* The Gateway identity is granted strictly:
     - `actions: ["find", "insert", "update"]` on `{ db: "decision_os_coordination", collection: "jwt_redemptions" }` (mediating the 7-state JWT redemption machine)
     - `actions: ["find", "insert", "update"]` on `{ db: "decision_os_coordination", collection: "slot_rotation_log" }` (mediating the 7-state rotation machine)
     Actions `createIndex`, `remove`, `dropCollection`, `dropDatabase`, and all access to other coordination collections are **strictly prohibited**.
   - *Separation of Recovery Service and Administrative Reconciler Roles:*
     - Background recovery sweeps are executed exclusively by `decision_os_recovery_service` with permissions `find`, `update` (for sweeping expired/abandoned records with generation fencing; zero network route to Vault).
     - Offline administrative interventions are executed exclusively by `decision_os_admin_reconciler` with permissions `find`, `update` (gated on signed dual-party SRE reconciliation orders).
   - *Durable 7-State Redemption State Machine:*
     To eliminate naive insert-and-409 recovery claims and prevent duplicate token issuance across crashes, redemptions transition across 7 formalized states:
     `CLAIMED` $\rightarrow$ `VAULT_REQUEST_SENT` $\rightarrow$ `ISSUED` (terminal success) / `OUTCOME_UNKNOWN` $\rightarrow$ `QUARANTINED` (terminal lock) / `RECONCILED` / `EXPIRED`.
   - *Complete Fencing on Every State Transition (Finding B11-02):*
     Every runtime transition in the state machine is mediated by an atomic compare-and-set query filter enforcing:
     1. Exact current `status`;
     2. Exact `owner_instance_id` (the specific active Gateway pod identifier);
     3. Exact `fencing_generation` matching the expected monotonic generation counter.
     No unfenced updates (such as `updateOne({ _id: jti, status: "OUTCOME_UNKNOWN" }, ...)`) are permitted in runtime code. If `matchedCount === 0`, the operation fails immediately with `StaleGenerationException` or `OwnershipLostException`, preventing split-brain corruption.
   - *Strict Monotonic Generation Advancement:*
     Every transition that modifies state advances the generation counter via `$inc: { fencing_generation: 1 }`. Generation decrements, counter reuse, or rollbacks are cryptographically and architecturally prohibited.

4. **Vault Least-Privilege Identity Separation & Per-Slot Rotation Authorization (Findings B11-01, B12-01, B12-03, B12-07):**
   To resolve the defect where the shared rotation policy permitted writing to arbitrary single-segment slot paths (`secret/data/slots/+`), Decision OS establishes separate, least-privilege Vault identities and 256 discrete per-slot rotation policies:
   - **Identity 1: Credential Retrieval Identity (`slot-lease-reader`):**
     - *Authentication:* Authenticates to Vault via `auth/jwt` using the signed lease JWT.
     - *Policy Scope:* Grants `capabilities = ["read"]` strictly on `secret/data/slots/{{identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id}}`.
     - *Restrictions:* Possesses **zero write, create, update, delete, list, or administrative permissions**. It cannot rotate credentials, cannot list other slots, and cannot access metadata.
   - **Identity 2: Discrete Per-Slot Rotation Identities (`slot-rotator-slot_000` through `slot-rotator-slot_255`) (Finding B12-03):**
     - *Elimination of Wildcard Path:* The shared policy `path "secret/data/slots/+"` is **strictly eliminated**.
     - *256 Discrete Statically Declared Policies:* During cluster bootstrap, Decision OS generates 256 discrete Vault policies: `slot-rotator-slot_000` through `slot-rotator-slot_255`. Each policy grants:
       ```hcl
       path "secret/data/slots/slot_NNN" {
         capabilities = ["create", "update"]
       }
       path "secret/metadata/slots/slot_NNN" {
         capabilities = ["read"]
       }
       path "secret/data/*" {
         capabilities = ["deny"]
       }
       path "secret/metadata/*" {
         capabilities = ["deny"]
       }
       ```
     - *Ephemeral Scoped Token Exchange:* The Gateway authenticates via `auth/kubernetes` bound to `decision_os_vault_gateway`. When a rotation request arrives for `slot_NNN`, the Gateway presents the verified signed revocation order and exchanges its identity for an ephemeral scoped token bound **exclusively to `slot-rotator-slot_NNN`** (TTL: 60s, `num_uses: 2`).
     - *Native Vault 403 Enforcement:* If a compromised Gateway attempts cross-slot tampering (e.g. attempting to update `slot_002` while holding an ephemeral token for `slot_001`), Vault's native ACL engine evaluates the request against `slot-rotator-slot_001` (`deny` on all paths other than `slot_001`) and rejects the request with `HTTP 403 Forbidden: permission denied`.
     - *Restrictions:* Possesses **zero read capabilities on secret payload data (`secret/data/*` denied for read)**, preventing a compromised rotation routine from exfiltrating slot passwords. Possesses zero list, zero delete, and zero administrative capabilities.
   - **Identity 3: JWT Auth Engine Accessor Identity (`auth_jwt_9f8e7d6c`):**
     - Immutable internal mount accessor under which Vault creates Entity Aliases and populates Entity Alias Metadata.
   - **Identity 4: Administrative Reconciliation & Dedicated Forensic Identity (Findings B11-05, B12-01):**
     - *Administrative Reconciler (`slot-admin-reconciler`):* Bound strictly to offline SRE client certificates (`auth/cert/sre-admin`). Grants `read`, `list` on `secret/metadata/slots/*` for CAS version inspection and token lookup/revocation. Zero secret payload access without dual-party HSM authorization.
     - *Dedicated Forensic Investigator (`decision_os_audit_investigator`):* Formalized dedicated forensic identity possessing read-only access strictly to external immutable WORM audit log storage (S3 Object Lock / GCS Bucket Lock), with **zero credentials and zero policy permissions on Vault port 8200 secret engine**.
   - **Authoritative Credential-Generation Contract & Vault KV-v2 CAS Binding (Finding B12-07):**
     - *Generation Monotonicity ($N \rightarrow N+1$):* Let $N \ge 1$ be the active generation. In Phase 2 Revocation, rotating from generation $N$ to $N+1$ requires:
       - `currentCredentialGeneration: N` (current active generation);
       - `expectedPreviousGeneration: N` (generation being superseded);
       - `newCredentialGeneration: N + 1` (target new generation).
     - *Monotonic Binding to Vault KV-v2 Versions:* Decision OS establishes a 1:1 identity between logical credential generations and Vault KV-v2 secret versions: $\text{logicalGeneration} \equiv \text{vaultKv2Version}$. When rotating from generation $N$ to $N+1$, the Gateway dispatches KV-v2 write with `cas: N`, resulting in `target_version: N + 1`. Generation rollbacks, decrements, or out-of-order writes fail Vault's CAS check with `HTTP 400 Check-and-set parameter did not match the current version`.
   - **Signed Revocation Order Binding (Finding B11-01):**
     The Gateway rotation endpoint (`POST /v1/vault-gateway/slots/:slot_id/rotate`) strictly requires an Ed25519-signed revocation order binding eight immutable parameters:
     1. `slotId`: Exact partition slot database identifier (`slot_000` through `slot_255`);
     2. `leaseId`: Active ownership lease identifier;
     3. `currentCredentialGeneration`: Current active credential generation $N$;
     4. `expectedPreviousGeneration`: Predecessor generation being superseded ($N$);
     5. `newCredentialGeneration`: Target credential generation ($N+1$);
     6. `operationId`: Unique UUID v4 idempotency key;
     7. `orderExpiryEpochMs`: UTC epoch timestamp after which the order is rejected;
     8. `authorizedCallerPrincipal`: Cryptographic identity of the authorized Provisioning Service.
   - **Replay Prevention & Idempotent Rotation via `slot_rotation_log` (Finding B12-02):**
     The Gateway records rotation operations in `decision_os_coordination.slot_rotation_log` across a durable 7-state machine. If a rotation request is re-submitted with the same `operationId` and `newCredentialGeneration`, the Gateway returns HTTP 200 with the existing commit status without re-writing to Vault. Submissions with stale or decremented generations fail immediately with `HTTP 409 Conflict: Generation regression rejected`.
   - **Vault Write Commitment Proof via Check-and-Set (CAS):**
     The Gateway executes the Vault write using Vault KV-v2 check-and-set (`cas: current_version`). Before returning HTTP 200 to the caller, the Gateway queries `GET /v1/secret/metadata/slots/:slot_id` to cryptographically prove that the write committed to durable Raft/Consul storage and that `current_version === expectedVersion`. If this verification fails or times out, the Gateway transitions the rotation record to `OUTCOME_UNKNOWN` $\rightarrow$ `QUARANTINED`.
   - **Path Substitution Prevention:**
     The Gateway validates that the URL parameter `:slot_id` matches the signed revocation order's `slotId` byte-for-byte, matches regex `^slot_([0-1][0-9]{2}|2[0-4][0-9]|25[0-5])$`, and is authorized by the caller's active lease. Any attempt to supply mismatched path parameters returns `HTTP 403 Forbidden: Slot ID path mismatch`.
   - **Response-Loss Recovery Procedure:**
     If the Provisioner sends a rotation request but crashes or loses network connectivity before receiving the HTTP response, it re-queries `GET /v1/vault-gateway/slots/:slot_id/rotate-status?operationId=:opId`. The Gateway inspects `slot_rotation_log` and Vault metadata version, returning the durable commit state idempotently without performing duplicate rotations.

5. **Vault Entity Alias Metadata Templating Syntax:**
   - When a caller authenticates via JWT, Vault creates an **Entity Alias** under the JWT auth mount accessor (`auth_jwt_9f8e7d6c`) and maps claims specified in `claim_mappings` into **Entity Alias Metadata** (`identity.entity.aliases.<accessor>.metadata.<key>`), NOT top-level Entity Metadata.
   - *Corrected Canonical Policy Template:*
     ```hcl
     # Corrected Templated Policy: slot-lease-reader (ephemeral read-only)
     path "secret/data/slots/{{identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id}}" {
       capabilities = ["read"]
     }
     path "secret/data/slots/*" {
       capabilities = ["deny"]
     }
     path "secret/metadata/*" {
       capabilities = ["deny"]
     }
     ```
   - All references across the entire document are strictly reconciled to reference Entity Alias Metadata.

6. **Dispatch Intent vs Wire Delivery Ambiguity Resolution & Guarantee Taxonomy (Findings B11-03, B12-04):**
   - *The Fallacy of Wire Proof via MongoDB:* The architecture explicitly recognizes that committing `VAULT_REQUEST_SENT` in MongoDB proves **durable intent to dispatch**, NOT that the network bytes reached Vault or that Vault processed the request.
   - *Conservative Protocol & Failure-Closed Quarantine:*
     If a Gateway crashes, times out, or encounters a network partition after persisting `VAULT_REQUEST_SENT`, the outcome is ambiguous. Because Vault is an independent distributed system, the Gateway cannot assume the request was lost. The redemption record is transitioned to `OUTCOME_UNKNOWN` and immediately fails closed into `QUARANTINED`.
   - *Prohibition of Automated Redispatch (Finding B12-04):*
     Decision OS strictly prohibits automated re-dispatch across reverse proxies, service meshes, Gateway HTTP clients, and background recovery services after an ambiguous outcome. Reverse proxy and mesh retry counts for Vault login endpoints are configured to **zero retries**. Quarantined redemptions can only be released after authoritative forensic verification.
   - *Taxonomy of Five Non-Interchangeable Guarantees (Finding B12-04):*
     Decision OS explicitly distinguishes between five distinct guarantees that must not be conflated:
     1. **At-most-once authorization:** A signed lease JWT authorizes at most one redemption lifecycle. Enforced by atomic CAS pre-consumption on `_id: jti` in MongoDB.
     2. **At-most-once Vault token issuance:** Categorized explicitly as **NOT GUARANTEED** across untracked network boundaries, reverse proxies, and retries without cross-system distributed 2PC. Mitigated by strict single-dispatch and immediate fail-closed quarantine (`QUARANTINED`).
     3. **Single-use token consumption:** An issued Vault token can be redeemed at most once. Enforced natively by HashiCorp Vault via `token_num_uses = 1`.
     4. **At-most-once credential delivery:** Plaintext database credentials are transmitted across mTLS to the provisioner at most once per lease lifecycle.
     5. **Idempotent response behavior:** If a client loses an HTTP response after credentials have already been durably committed as `ISSUED`, the Gateway returns `HTTP 409 Conflict` without generating new credentials or contacting Vault.

7. **Mandatory Invariants for Vault Gateway & JWT Redemption (Invariants 1–14):**
   1. *Single Ingress Boundary:* Vault TCP port 8200 must accept connections exclusively from the authorized Gateway workload.
   2. *Zero Client Token Propagation:* Vault client tokens must never be emitted to Provisioners, Workers, or external callers; the Gateway terminates token custody.
   3. *Atomic Pre-Consumption CAS:* A signed lease JWT must be committed to `rs_coord:27019.jwt_redemptions` under `status: "CLAIMED"` with majority durability before any Vault request is dispatched.
   4. *Conservative Ambiguous Outcome Quarantine:* If communication with Vault times out or returns an ambiguous response after dispatch, the redemption transitions to `OUTCOME_UNKNOWN` $\rightarrow$ `QUARANTINED`. Automated retry by client, mesh, or proxy is strictly prohibited.
   5. *Workload Identity Parity:* Ingress authorization to the Gateway requires mTLS with verified SPIFFE identity; pod labels alone are explicitly rejected as a sufficient security boundary without admission control.
   6. *Bounded Operation Allocation:* The Gateway exposes only discrete slot credential retrieval and rotation endpoints; arbitrary path traversal or raw Vault pass-through is strictly denied.
   7. *Replay Rejection:* Any submission of an already claimed, issued, quarantined, or expired `jti` must fail immediately with `HTTP 409 Conflict` (or `HTTP 403 Forbidden`) without contacting Vault.
   8. *Single Active Generation:* State transitions must enforce monotonic `fencing_generation` CAS checks; stale gateway instances must not overwrite newer claims.
   9. *Strict Vault Identity & Policy Separation:* Read identities (`slot-lease-reader`) must possess zero write/update permissions; rotation identities must possess zero secret payload read permissions.
   10. *Dispatch-Intent Wire Boundary Distinction:* A database record of `VAULT_REQUEST_SENT` must be treated strictly as intent; crashes in-flight fail closed into quarantine and must never trigger automatic re-dispatch.
   11. *Exclusion of Runtime Index Creation:* The runtime Gateway identity must not have `createIndex` permissions; all indexes are pre-created by bootstrap administration.
   12. *Multi-Party Verification for Quarantine Release:* Releasing a quarantined slot or redemption record requires independent SRE and Compliance authorization with cryptographic proof of Vault token non-issuance or revocation.
   13. *Per-Slot Native Vault Rotation Authorization Boundary (Finding B12-03):* Wildcard slot rotation policies (`secret/data/slots/+`) are strictly prohibited. Vault must natively enforce per-slot write isolation via 256 discrete per-slot policies (`slot-rotator-slot_000` through `slot-rotator-slot_255`), ensuring cross-slot tampering triggers native Vault HTTP 403.
   14. *External Immutable Vault Audit Delivery & Forensic Non-Issuance Verification (Finding B12-01):* Vault audit events must stream out-of-band over mTLS to immutable WORM storage. Forensic inspection must use dedicated identity `decision_os_audit_investigator` with zero secret access. Administrative unquarantine is strictly blocked if audit delivery is delayed, incomplete, or unavailable.

---

### 3.8 Evaluation of AES-256-GCM Cryptographic Nonce Reuse Realities, Genuine DER Timestamp Tokens & Data-Trust Recovery Boundaries (Findings B38-42, B11-06 through B11-12, B12-05 through B12-08)
AES-256-GCM is an authenticated encryption with associated data (AEAD) algorithm that utilizes Counter (CTR) mode for encryption and Galois Hash (GHASH) for authentication. The security properties and recovery boundaries of AES-256-GCM under nonce reuse were rigorously re-evaluated:

1. **The Irreversible Mathematical Reality of Nonce Reuse:**
   - **Confidentiality Loss ($P_1 \oplus P_2$):** When two messages are encrypted with the same key $K$ and initialization vector (IV / nonce), their keystreams $S$ are identical. The XOR of the ciphertexts reveals the XOR of the plaintexts:
     $$C_1 \oplus C_2 = (P_1 \oplus S) \oplus (P_2 \oplus S) = P_1 \oplus P_2$$
     If partial plaintext is known or follows a predictable JSON/BSON schema, the remaining plaintext is trivially reconstructed.
   - **Authentication Compromise (GHASH Key $H$ Recovery):** For identical $(K, \text{IV})$, the difference between authentication tags $T_1, T_2$ reveals the linear GHASH evaluation:
     $$T_1 \oplus T_2 = g_H(A_1, C_1) \oplus g_H(A_2, C_2)$$
     Solving this polynomial over $\text{GF}(2^{128})$ reveals the GHASH authentication subkey $H = \text{AES}_K(0^{128})$. Once $H$ is known, an adversary can forge valid authentication tags for **arbitrary modified ciphertexts** under that key.

2. **Mandatory Architectural Tenets (Eliminating Naive Re-Encryption Claims):**
   - **Key rotation DOES NOT repair historical confidentiality loss:** Rotating the KMS Data Encryption Key (DEK) prevents future collisions, but plaintexts exposed via $P_1 \oplus P_2$ remain exposed permanently.
   - **Re-encryption DOES NOT repair historical authentication compromise:** If $H$ was exposed, an attacker could have tampered with ciphertexts while computing valid tags. Decrypting and re-encrypting tampered ciphertexts merely blesses forged data under the new key epoch.
   - **AES-GCM decryption success DOES NOT prove authenticity:** A ciphertext with a forged tag passes standard `decrypt()` verification natively.
   - **A watchdog CANNOT reverse compromise:** The Monotonicity Watchdog is a circuit-breaker that detects regressions and trips an emergency halt; it cannot retroactively undo wire exposure.
   - **Sequence reseeding ALONE does not restore trust:** Reseeding counters provides forward isolation, but historical ciphertexts remain untrusted.

3. **Independent Trust Architecture for Plaintext Recovery (Findings B11-06 through B11-12, B12-05 through B12-08):**
   - Because ciphertexts in the affected epoch are cryptographically suspect, recovery cannot rely on internal ciphertext validation.
   - Trust can be re-established ONLY if candidate plaintexts match an **independently verifiable, pre-incident Canonical WORM Plaintext Evidence Record** committed prior to the compromise timestamp ($t_{\text{evidence}} < t_{\text{compromise}}$).
   - **Authoritative Complete Schema v2.3.0 (Findings B11-08, B12-08):** The evidence schema is defined by exactly **26 versioned data fields** (+ `$schema` URI metadata), eliminating the previous incomplete 19-field inventory.
   - **Exact Plaintext Byte Length (Finding B11-07):** The canonical candidate decision payload has an exact UTF-8 byte length of **117 bytes** (`Buffer.from(canonicalJson, "utf8").length === 117`), correcting the previous incorrect specification of 115.
   - **Cryptographically Verified SHA-256 Digest (Finding B11-06):** The exact canonical RFC 8785 JSON byte sequence `{"action":"EXECUTE_TRANSACTION","amount":10000,"currency":"USD","decisionId":"dec-2026-11-10-001","slotId":"slot_01"}` produces the exact verified SHA-256 digest:
     `90ca3b570b7e806657a928518b70ee710b342ea6e315187e7a1dcc4b409cab4e`.
     The previous erroneous digest (`3ebb5052...`) is permanently eliminated and preserved solely in historical defect records.
   - **Genuine Synthetic RFC 3161 DER Timestamp Token Fixture (Finding B12-05):** The synthetic timestamp token is a fully valid ASN.1 DER CMS `ContentInfo` of type `id-signedData` (OID `1.2.840.113549.1.7.2`) containing `SignedData` with encapsulated `TSTInfo` (OID `1.2.840.113549.1.9.16.1.4`, length: 612 DER bytes, Base64 prefix `MIICYAYJKoZIhvcNAQcCoIICUTCCAk0CAQMx...`). It cryptographically binds the complete record via message imprint over:
     $$\text{TsaCommitmentBytes} = \text{"DECISION_OS_TSA_COMMITMENT_V1:"} \parallel \text{CoreDigest} \parallel \text{UTF8}(\text{primaryEvidenceSignature})$$
     where $\text{CoreDigest}$ commits to all 17 Core evidence fields. The DER hierarchy has been independently parsed and verified using standalone ASN.1 DER parsers.
   - **Reconciled Single Authoritative Merkle Checkpoint Root (Finding B12-06):** Deterministic Merkle tree evaluation over the canonical 117-byte payload, genuine DER TSA token digest, and RFC 6962 Leaf 0 produces exactly **one authoritative Merkle root**:
     `e3f6f3504f211d64c383acb50260e7b6f6cccba7522f0fdf98b83cd8145d5248`
     at `checkpointHeight: 8421` (`chk-2026-11-10-8421`). The two conflicting Merkle roots in v2.2.0 (`b8ccf706...` vs `46d6565b...`) are permanently eliminated and reconciled to this single value globally.
   - **Rigorous Cryptographic Commitment Scope Formulation (Finding B12-08):**
     Decision OS explicitly delineates the cryptographic coverage and boundary of every evidence layer:
     1. **Primary HSM Signature (`primaryEvidenceSignature`, Field 18):** Covers Fields 1–17 (`CoreDigest`).
     2. **RFC 3161 TSA Message Imprint (`tsaTimestampToken`, Field 19):** Covers Fields 1–18 (`CoreDigest || UTF8(primaryEvidenceSignature)`).
     3. **RFC 6962 Merkle Leaf Hash (Leaf 0):** Commits to Fields 1–19 (`0x00 || CoreDigest || SHA-256(Sig) || SHA-256(TSA)`).
     4. **Merkle Checkpoint & Proof (Fields 20–24):** Function as **external verification witnesses**; they do not form part of the leaf hash itself.
     5. **Post-Incident Signatures (Fields 25–26):** Form a **versioned post-incident extension** signing a canonical Unquarantine Order binding `evidenceRecordId`, `decisionPayloadSha256`, `targetSlotId`, and `merkleCheckpointRoot`.
   - **Independent Digital Signatures (Finding B11-11):** Four distinct digital signatures are formalized with unique domain separation prefixes, key registries, and validation procedures: (1) Primary Compliance HSM Signature (`"DECISION_OS_WORM_SIGNATURE_V2:"`), (2) Compliance Officer Authorization (`"DECISION_OS_COMPLIANCE_AUTH_V1:"`), (3) SRE Lead Authorization (`"DECISION_OS_SRE_AUTH_V1:"`), and (4) Checkpoint Notary Signature (`"DECISION_OS_MERKLE_CHECKPOINT_V1:"`).

---

## 4. Selected Architecture and Rationale

### 4.1 Decision
The selected architecture for Decision OS Batch 4 V3.8 is **Option B: Dedicated Containerized Services with Physical Deployment Separation & Scoped Delegation**, deployed with:

1. **Physical / Logical Multi-Deployment Isolation (B38-20):**
   - **Coordination & Audit Deployment (`mongodb-coord:27019`):** Hosts `decision_os_coordination` (`ownership_locks`, `cleanup_ledger`, `provisioning_saga`, `nonce_allocations`) and `cleanup_audit_log`. Zero destructive credentials or routes exist on this cluster.
   - **Ephemeral Test Database Deployment (`mongodb-test:27018`):** Hosts pre-allocated test databases (`decision_os_test_slot_*`).
2. **Decoupled Roles & Database-Scoped Provisioning Delegation (B38-24, B38-26, B38-31, B38-32, B38-36, B38-37, B38-38):**
   - **Provisioning Service (`apps/provisioner`):** Identity `decision_os_provisioner`. Manages ownership leases and durable sagas on `mongodb-coord:27019`. Stripped of `{ db: "", collection: "" }` user/role administration rights on `rs_test` and stripped of write access to `nonce_allocations`.
   - **Nonce Allocation Service (`apps/nonce-allocator`):** Identity `decision_os_nonce_allocator`. Cryptographic Root of Trust holding exclusive write authority on `decision_os_coordination.nonce_allocations` on `rs_coord:27019` (`find`, `insert`, `update`, `createIndex` only; zero `findAndModify`). Leases non-overlapping counter blocks via atomic `$inc`. Governed by the Allocator-Compromise Response Protocol (emergency kill-switch, KMS DEK epoch retirement, envelope re-encryption).
   - **Dedicated Vault Gateway (`apps/vault-gateway`) & Partition Slot Vault (`apps/slot-vault`):** All Vault interactions (JWT authentication, slot credential retrieval, credential rotation writes) pass strictly through the Dedicated Vault Gateway (`apps/vault-gateway`, service account `decision_os_vault_gateway`). Direct network routes to Vault port 8200 are fenced via Kubernetes `NetworkPolicy` exclusively to Gateway pods. Enforces exact lease-to-secret binding via Vault templated policies (`path "secret/data/slots/{{identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id}}" { capabilities = ["read"] }`). Provisioners authenticate to Gateway via mTLS SPIFFE; provisioners never receive a Vault client token. Gateway returns only minimal DB credentials.
   - **Scoped Partition Database Administrators (`decision_os_db_admin_slot_${k}`):** Discrete per-database administrative principals pre-created during offline bootstrap on `rs_test:27018`. Authorization scope is strictly `{ db: "decision_os_test_slot_" + k, collection: "" }`. Creates and drops worker principals directly on that single database. Possesses zero privileges on other databases and zero destructive drop authority.
   - **Elimination of Runtime Credential Broker (Finding B38-36):** No central service with wildcard `{ db: "", collection: "" }` user/role administration runs on the active worker path. Dynamic database creation is designated as an **Offline / Control-Plane Root of Trust** (`deploy/init-mongo-test.sh`). Dynamic broker is disabled in production (`DECISION_OS_DYNAMIC_PROVISIONING_ENABLED=false`). Requests targeting non-existent databases fail closed with `UnallocatedDatabaseException`.
   - **Destructive Cleanup Executor (`apps/cleanup-executor`):** Identity `decision_os_destructive_executor`. Possesses `{ resource: { db: "", collection: "" }, actions: ["dropDatabase", "dropCollection", "listCollections", "find"] }` and `{ resource: { cluster: true }, actions: ["killop", "inprog", "killAnySession", "impersonate", "checkCursorSanity"] }` strictly on `mongodb-test:27018`. Possesses zero role-management privileges and zero user-creation/drop privileges (`createUser`, `createRole`, `dropUser`, `dropRole` are strictly forbidden). Zero access to `mongodb-coord:27019`.
   - **Audit Service (`apps/audit-service`):** Identity `decision_os_audit_writer`. Possesses strictly append-only privileges (`find`, `insert`, `createIndex`) on `cleanup_audit_log` on `mongodb-coord:27019`. Emits signed checkpoints to external WORM storage.
3. **Canonical 5-Phase Ordered Worker Revocation Execution (B38-25, B38-27, B38-35, B38-39):**
   - Single canonical ordered execution state machine coordinated across the Network Fence Controller, Scoped Provisioning Service, and Cleanup Executor:
     - **Phase 1 (Transport Fencing — `NET_FENCED`):** Network Fence Controller isolates worker pod/container egress to MongoDB ports 27018 and 27019 at the CNI/netfilter layer, dropping in-flight wire packets.
     - **Phase 2 (Identity Revocation — `IDENTITY_REVOKED`):** Scoped Provisioner connects as `decision_os_db_admin_slot_${k}` and executes `dropUser` and `dropRole` directly on `targetTestDb` with `w: "majority", j: true`, invalidating the MongoDB daemon authorization cache.
     - **Phase 3 (Operation & Session Cancellation — `OPS_KILLED`):** Cleanup Executor inspects `currentOp` for prepared transactions (`inprog` on `{ cluster: true }`), executes `killOp` (`actions: ["killop"]` on `{ cluster: true }`) against active worker operations, and terminates logical sessions via `killAllSessionsByPattern`.
     - **Phase 4 (Storage Engine Deletion — `STORAGE_DROPPED`):** Cleanup Executor verifies that Phases 1, 2, and 3 are durably acknowledged in `cleanup_ledger`, then dispatches `dropDatabase` on `rs_test:27018`. If any prior phase is missing, `dropDatabase` strictly refuses to execute and transitions to `QUARANTINED`.
     - **Phase 5 (Audit Finalization — `AUDIT_FINALIZED`):** Audit Service appends a tamper-evident SHA-256 hash-chained record to `cleanup_audit_log` with external WORM checkpoint reference.
   - Every phase records a durable acknowledgement in `cleanup_ledger`. Crashes after any phase resume idempotently from the exact incomplete phase.
4. **Crash-Safe Credential Recovery & Durable Nonce Allocation (B38-17, B38-28, B38-32, B38-38):**
   - Caller-bound encrypted envelope (`ownership_locks.credentialEnvelope`) utilizing AES-256-GCM.
   - NIST SP 800-38D Section 8.2.1 deterministic nonces leased atomically in blocks from dedicated `apps/nonce-allocator` with majority write concern. Nonce encoding: `KeyVersionPrefix (16 bits) || AllocatedRangeBlock (32 bits) || MonotonicCounter (48 bits)` = 96 bits.
   - Cryptographic root of trust formally recognized: Nonce Allocator compromise mitigated via emergency kill-switch, KMS DEK epoch retirement, and envelope quarantine.
   - Strict durable acknowledgement ordering before envelope destruction.
   - Exactly 12 fully formalized saga states with deterministic transition recovery and orphan reaper verification proof.
5. **Authoritative Oplog Evidence Protocol & Quarantine State Machine (B38-13, B38-16):**
   - Reconciling ambiguous outcomes requires cryptographically correlated drop comments and replica-set majority commitment proof $(t, ts)$ from `replSetGetStatus`.
   - Zero redispatch after `DISPATCHING`. Ambiguous drops remain permanently in `QUARANTINED` with execution locks indefinitely held.

### 4.2 Architectural Justification
1. **Mathematical Impossibility of Coordination Destruction (B38-20):**
   By physically isolating the coordination and audit collections on a separate MongoDB deployment (`mongodb-coord:27019`) to which the destructive executor has no network connectivity or credentials, the system eliminates reliance on application-level regex validation. Even if the cleanup executor is fully compromised and attempts `db.getSiblingDB("decision_os_coordination").dropDatabase()`, the command is executed against the test instance where the database does not exist, leaving production coordination and audit records completely untouched.
2. **Elimination of Cross-Database Privilege Escalation & Broker Blast Radius (B38-24, B38-26, B38-31, B38-36):**
   By eliminating the central credential broker from the active runtime path and provisioning standard workloads exclusively through pre-allocated partition slot databases (`decision_os_test_slot_000` through `slot_255`), MongoDB's RBAC engine natively enforces database isolation. Each partition slot possesses its own scoped administrator (`decision_os_db_admin_slot_${k}`) whose authorization scope is strictly `{ db: "decision_os_test_slot_" + k, collection: "" }`. Because no runtime service holds wildcard `{ db: "", collection: "" }` userAdmin credentials on `rs_test`, cross-database principal manipulation is physically and natively rejected by MongoDB RBAC with Error Code 13. Dynamic pool scaling is isolated to an offline control-plane root of trust (`deploy/init-mongo-test.sh`).
3. **Dedicated Vault Gateway & Exact Lease-to-Secret Binding (B38-37, B38-41):**
   All Vault interactions pass exclusively through the Dedicated Vault Gateway. By pairing HashiCorp Vault templated policies (`secret/data/slots/{{identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id}}`) with a signed single-use JWT exchange model (`num_uses = 1`, `ttl = 60s`, `renewable = false`), the provisioner is physically restricted to reading only the exact slot credential for its active lease through the Gateway. The provisioner never receives a Vault client token. Direct path guessing, bypass, or cross-slot substitution attacks are natively rejected with HTTP 403 Forbidden or dropped at the network boundary.
4. **Nonce Allocator as an Explicit Cryptographic Root of Trust (B38-32, B38-38):**
   Decoupling nonce allocation into an independent service running identity `decision_os_nonce_allocator` protects counter state from unauthorized reset by the general provisioner. Because MongoDB RBAC cannot enforce monotonic arithmetic against an identity possessing `update` privileges, the Nonce Allocator is formally identified as a Cryptographic Root of Trust. Allocator compromise is mitigated via an emergency Kill-Switch, KMS Data Encryption Key (DEK) epoch retirement, `KeyVersionPrefix` incrementation (rendering new ciphertexts disjoint from compromised ciphertexts), and envelope quarantine/re-encryption under clearly defined trust assumptions.
5. **Canonical 5-Phase Ordered Revocation & Crash Safety (B38-27, B38-33, B38-35, B38-39):**
   Establishing a single canonical ordered execution state machine guarantees that transport-level fencing, server-side user deletion, and cluster-level operation cancellation are completed and durably acknowledged before physical database deletion begins. Precondition gating strictly prevents `dropDatabase` from executing if prior phases are incomplete, and idempotent crash recovery ensures that restarts resume at the exact unverified phase boundary.
6. **Multi-Layer Defense Against Hostile Workers (B38-25, B38-35):**
   Client-side driver connection closure (`client.close(true)`) is treated as a cooperative convenience rather than a security boundary. Permanent revocation is enforced at multiple layers: transport-level network fencing drops wire packets, server-side `dropUser` invalidates authorization caches, and cluster-level `killop` aborts running queries. Commands issued over lingering TCP sockets fail authorization natively at the database wire protocol layer or are discarded at netfilter.
7. **Guaranteed Forward Secrecy & Crash Recovery (B38-17):**
   Storing ephemeral credentials in caller-bound AES-256-GCM encrypted envelopes guarantees that retrying workers receive deterministic credentials after executor crashes, without attempting to reverse SCRAM-SHA-256 verifiers. Enforcing exact durable majority acknowledgement before envelope deletion guarantees that credentials are never destroyed before the worker has safely activated.
8. **Deterministic Destruction Without Dual-Drop Danger:**
   Eliminating administrative redispatch guarantees that once `{ dropDatabase: 1 }` is transmitted across the wire, no subsequent or delayed drop command can ever execute against a reused or active database namespace.

---

## 5. Component Diagram

```mermaid
flowchart TD
    subgraph ClientAndTestSpace["Client & Ordinary Worker Boundary (Unprivileged)"]
        WorkerA["Vitest Worker A / API
(Identity: decision_os_worker_runA_wA)
(Leased Slot: decision_os_test_slot_01)"]
        WorkerB["Vitest Worker B / API
(Identity: decision_os_worker_runB_wB)
(Leased Slot: decision_os_test_slot_02)"]
        BenchmarkCLI["Benchmark Runner
(Identity: decision_os_benchmark_bench1)
(Leased Slot: decision_os_test_slot_03)"]
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

    subgraph BootstrapAndVaultSpace["Offline Bootstrap & Partition Slot Vault Boundary"]
        OfflineBootstrap["Offline Bootstrap Container
(deploy/init-mongo-test.sh)
Identity: decision_os_offline_bootstrap
- Runs once at deployment initialization
- Pre-provisions Slots (slot_000 to slot_255)
- Mints Scoped Admins: decision_os_db_admin_slot_k (changeOwnPassword self-rotation only — B38-40)
- Zeroizes credentials from tmpfs (shred -u)"]
        JwtGateway["Dedicated Vault Gateway (apps/vault-gateway)
(Identity: decision_os_vault_gateway)
- Validates Caller mTLS SPIFFE Workload Identity
- Atomically claims jti in rs_coord:27019.jwt_redemptions across durable 7-state machine
- Mediates all Vault interactions (JWT Auth, KV Reads, Rotation Writes)
- Returns ONLY minimal DB credentials to Provisioner (Zero Vault token exposure)
- Layer 4 NetworkPolicy Ingress Fence Enforced (B38-41)"]

        SlotVault["Partition Slot Vault (apps/slot-vault / HashiCorp Vault)
- Policy: secret/data/slots/{{identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id}}
- Single-Use Client Token (num_uses=1, TTL=60s, non-renewable)
- Native HTTP 403 on Path Substitution
- NetworkPolicy restricts TCP port 8200 ingress EXCLUSIVELY to JwtGateway
- Direct worker/provisioner routes blocked at Layer 4 (Packet Drop)"]

        WormStore["Canonical WORM Plaintext Evidence Store
(Immutable Object Lock / Compliance Mode)
- CanonicalWormPlaintextEvidenceRecord (RFC 8785 JCS + SHA-256)
- Signed by external independent Audit HSM Key (Ed25519)
- Pre-incident timestamp enforced: t_evidence < t_compromise
- 10-year legal hold; required for incident recovery (B38-42)"]
    end

    subgraph ProvisioningServiceSpace["Dedicated Provisioning Service Boundary (apps/provisioner)"]
        mTLS --> ProvisionerAPI["Provisioning Engine & Authn Validator
(Binds Ed25519 Public Key to Worker ID)"]
        ProvisionerAPI --> SagaManager["Durable 12-State Provisioning Saga Manager
(Generates Ephemeral Credentials & Envelopes)"]
        SagaManager --> ScopedRoleEngine["Scoped Partition Role & User Engine
(Database-Scoped Delegation Model)
*NO dropDatabase or Cluster Rights!*"]
        ScopedRoleEngine --> ProvisionerPoolTest["Scoped Partition Slot Admin Pool
(Identity: decision_os_db_admin_slot_k)
*Scoped STRICTLY to slot DB; NO cross-db rights!*"]
        SagaManager --> ProvisionerPoolCoord["Provisioner Coord Pool
(Identity: decision_os_provisioner)
*Zero Write to nonce_allocations!*"]
        ScopedRoleEngine -->|mTLS SPIFFE: POST /v1/vault-gateway/slots/:slot_id/claim| JwtGateway
        JwtGateway -->|Vault Auth & KV Read/Write (Port 8200)| SlotVault
        JwtGateway -->|Durable 7-State CAS: find, insert, update| CoordDB
        ScopedRoleEngine -.->|BLOCKED BY L3/L4 NetworkPolicy: No Route to Vault 8200| SlotVault
    end

    subgraph NonceAllocatorSpace["Dedicated Nonce Allocation Service Boundary (apps/nonce-allocator)"]
        SagaManager -->|mTLS: POST /v1/nonce/lease-block| NonceAllocatorAPI["Nonce Allocator Engine & API
*Cryptographic Root of Trust*
(Enforces Monotonic Block Leases via $inc)
*Zero $set code paths; Emergency Kill-Switch*"]
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
        CleanupValidator --> StateMachineEngine["Canonical 5-Phase State Machine Engine
(Authoritative Sole Writer of cleanup_ledger)"]
        StateMachineEngine --> RevocationCoordinator["Canonical Revocation Coordinator
(Orchestrates 5-Phase Execution Sequence)"]
        RevocationCoordinator -->|Phase 1: POST /v1/orchestrator/fence-worker| NetFenceController
        RevocationCoordinator -->|Phase 2: POST /v1/provisioning/revoke-worker| ProvisionerAPI
        StateMachineEngine --> DropEngine["Destructive Drop Engine
*Phase 4: Executed ONLY after Phases 1-3 Verified*
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
- cleanup_ledger
- jwt_redemptions (Durable Replay Prevention — unique _id: jti — B38-41)")]
        NonceAllocatorPoolCoord -->|Monotonic Range Leases ($inc)| NonceColl[("nonce_allocations
*Protected Sequence State*")]
        AuditPoolCoord -->|Append-Only Writes| AuditLogColl[("cleanup_audit_log
*Zero Update / Remove / Drop*")]
    end

    subgraph TestCluster["MongoDB Ephemeral Test Database Deployment (rs_test :27018)"]
        OfflineBootstrap -.->|Init 256 Slot DBs & Admins| TestDBAuth
        ProvisionerPoolTest -->|Scoped User Admin on Leased Slot ONLY| TestDBAuth[("Target Test DB Catalog
- Scoped Admin: decision_os_db_admin_slot_k
- Scoped Dynamic Role: worker_access_role
- Ephemeral Worker Principal")]
        DestructivePoolTest -->|Drop Ephemeral Test DBs ONLY (Phase 4)| TargetDBs[("Pre-Allocated Slot DBs
- decision_os_test_slot_01
- decision_os_test_slot_02")]
        DestructivePoolTest -->|Phase 3: Session, Op & Tx Termination| ClusterRes[("Cluster Resource
- currentOp (inprog for prepared tx)
- killOp (killop on cluster: true)
- killAllSessionsByPattern")]

        PoolA["Worker A Connection Pool
(Identity: decision_os_worker_runA_wA)"]
        PoolB["Worker B Connection Pool
(Identity: decision_os_worker_runB_wB)"]

        WorkerA -.-> PoolA
        WorkerB -.-> PoolB

        PoolA -->|CRUD ONLY on leased slot_01| TargetDBA[("Target DB Slot 01
decision_os_test_slot_01")]
        PoolB -->|CRUD ONLY on leased slot_02| TargetDBB[("Target DB Slot 02
decision_os_test_slot_02")]

        PoolA -.->|BLOCKED BY RBAC: Code 13 on Slot 02| TargetDBB
        PoolB -.->|BLOCKED BY RBAC: Code 13 on Slot 01| TargetDBA
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
    class SagaManager,ScopedRoleEngine,ProvisionerPoolTest,ProvisionerPoolCoord,StateMachineEngine,RevocationCoordinator,DropEngine,DestructivePoolTest,AuditWriterEngine,AuditPoolCoord,CheckpointEngine,NonceAllocatorAPI,NonceAllocatorPoolCoord,NetFenceController,OfflineBootstrap privileged;
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
    participant NonceService as Nonce Allocator (apps/nonce-allocator [Root of Trust])
    participant Gateway as Dedicated Vault Gateway (apps/vault-gateway)
    participant Vault as Partition Slot Vault (apps/slot-vault)
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
    WorkerA->>Vault: POST /v1/auth/jwt/login (Attempt direct Vault JWT auth bypass — B38-41)
    Vault--xWorkerA: TCP SYN Dropped (Layer 4 NetworkPolicy: Ingress allowed ONLY from Gateway)
    Provisioner->>Vault: Direct HTTP Request to Port 8200 (Bypass Attempt)
    Vault--xProvisioner: TCP SYN Dropped (Layer 4 NetworkPolicy: Provisioner has zero route to Vault)

    Note over WorkerA,TestDB: PHASE 2: CONSTRAINED PROVISIONING SAGA WITH NONCE & GATEWAY MEDIATION (B38-24, B38-26, B38-36, B38-37, B38-38, B38-41)
    WorkerA->>Client: claimTestDatabaseOwnership("decision_os_test_slot_01", "runA", "wA")
    Client->>Client: Sign claim payload using Worker A Ed25519 Private Key
    Client->>Provisioner: POST /v1/ownership/claim (Payload + Ed25519 Signature)
    Provisioner->>Provisioner: Verify Signature, Caller ID "runA:wA", DB Naming Contract
    Provisioner->>CoordDB: Persist Saga CLAIM_PENDING in ownership_locks & provisioning_saga (w: majority)
    
    Note over Provisioner,NonceService: Lease Monotonic Counter Block via Dedicated Nonce Allocator (Root of Trust)
    Provisioner->>NonceService: POST /v1/nonce/lease-block (Signed mTLS Request)
    NonceService->>CoordDB: findOneAndUpdate({ _id: "nonce_seq_v1" }, { $inc: { nextBlockStart: BLOCK_SIZE } }) (w: majority, j: true)
    CoordDB-->>NonceService: Nonce Block Range Leased [blockStart, blockEnd)
    NonceService-->>Provisioner: Leased Block Range { blockStart, blockSize, keyVersion }

    Note over Provisioner,Gateway: Exact Lease Binding & Credential Retrieval via Dedicated Vault Gateway (B38-37, B38-41)
    Provisioner->>Gateway: POST /v1/vault-gateway/slots/slot_01/claim (mTLS SPIFFE + Signed Lease JWT)
    Gateway->>Gateway: Cryptographically Validate Caller SPIFFE ID, JWT Signature, exp, nbf, aud, iss & jti
    Gateway->>CoordDB: db.jwt_redemptions.insertOne({ _id: jti, lease_id, slot_id, status: "CLAIMED", owner_instance_id: podId, fencing_generation: 1, dispatch_attempted: false }) (w: majority, j: true)
    CoordDB-->>Gateway: { ok: 1 } (jti claimed durably; duplicate jti throws Code 11000)
    Gateway->>CoordDB: db.jwt_redemptions.updateOne({ _id: jti, status: "CLAIMED", owner_instance_id: podId, fencing_generation: 1 }, { $set: { status: "VAULT_REQUEST_SENT", dispatch_attempted: true }, $inc: { fencing_generation: 1 } }) (w: majority, j: true)
    Gateway->>Vault: POST /v1/auth/jwt/login { jwt } (Authorized Network Route on Port 8200)
    Vault->>Vault: Map Claims to Entity Alias Metadata (identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id="slot_01")
    Vault-->>Gateway: Ephemeral Client Token (TTL: 60s, num_uses: 1)
    Gateway->>Vault: GET /v1/secret/data/slots/slot_01 (Authorized by Templated Policy)
    Vault-->>Gateway: Scoped Credentials: { username: "decision_os_db_admin_slot_01", password: P_gen1 }
    Gateway->>CoordDB: db.jwt_redemptions.updateOne({ _id: jti, status: "VAULT_REQUEST_SENT", owner_instance_id: podId, fencing_generation: 2 }, { $set: { status: "ISSUED", vault_token_revoked: true }, $inc: { fencing_generation: 1 } }) (w: majority, j: true)
    Gateway-->>Provisioner: HTTP 200 OK { username: "decision_os_db_admin_slot_01", password: P_gen1 }
    Note over Provisioner: Provisioner receives ONLY minimal DB credentials. ZERO Vault token exposed!

    Note over WorkerA,Gateway: Direct Replay Attempt via Gateway Rejected Atomically
    WorkerA->>Gateway: POST /v1/vault-gateway/slots/slot_01/claim { replayed_jwt }
    Gateway->>CoordDB: db.jwt_redemptions.insertOne({ _id: jti })
    CoordDB-->>Gateway: MongoServerError: DuplicateKey error (Code 11000)
    Gateway-->>WorkerA: HTTP 409 Conflict (JwtReplayException: Token already claimed/redeemed)
    Note over Provisioner,Gateway: Path Mismatch Rejected Natively by Gateway & Vault
    Provisioner->>Gateway: POST /v1/vault-gateway/slots/slot_02/claim { jwt_for_slot_01 }
    Gateway-->>Provisioner: HTTP 403 Forbidden (Slot Claim Mismatch: JWT binds slot_01 != requested slot_02)

    Note over Provisioner,TestDB: Connect using Scoped DB Admin (decision_os_db_admin_slot_01) scoped strictly to slot_01:
    Provisioner->>TestDB: db.getSiblingDB("decision_os_test_slot_01").createRole({ role: "workerRole", privileges: [CRUD on self] })
    Provisioner->>TestDB: db.getSiblingDB("decision_os_test_slot_01").createUser({ user: "decision_os_worker_runA_wA", pwd: pwdA, roles: ["workerRole"] })
    Provisioner->>CoordDB: Persist AES-256-GCM envelope (Deterministic Nonce from leased block) in ownership_locks (w: majority)
    Provisioner->>AuditService: Append Audit Event: USER_PROVISIONED (SHA-256 Chained)
    Provisioner-->>Client: HTTP 200 OK { user, pwdA, authSource: "decision_os_test_slot_01" }

    Note over WorkerA,CoordDB: PHASE 3: DURABLE ACKNOWLEDGEMENT ORDERING (B38-17)
    Client->>TestDB: Connect PoolA & execute { ping: 1 } (Confirm Worker SCRAM-SHA-256 Auth)
    TestDB-->>Client: { ok: 1 } (Worker operational)
    Client->>Provisioner: POST /v1/ownership/activate (Worker Activation Confirmed)
    Provisioner->>CoordDB: Mark ACTIVE, destroy envelope in ownership_locks (w: majority, j: true)
    Provisioner-->>Client: HTTP 200 OK (Activation Sealed)
    WorkerA->>TestDB: Execute isolated test CRUD workloads on decision_os_test_slot_01

    Note over WorkerA,AuditService: PHASE 4: CANONICAL 5-PHASE ORDERED REVOCATION (B38-25, B38-27, B38-35, B38-39, B38-40, B38-41)
    Client->>Executor: POST /v1/cleanup/request (Signed Cleanup Order)
    Executor->>CoordDB: Verify Ownership Lease, Mark CLAIMED in cleanup_ledger (w: majority)
    
    Note over Executor,NetFence: Phase 1: Network Transport Fencing (NET_FENCED)
    Executor->>NetFence: POST /v1/orchestrator/fence-worker (Isolate Worker A Pod Egress)
    NetFence->>NetFence: Apply Linux Netfilter / CNI Egress Drop to Ports 27018 & 27019
    NetFence-->>Executor: HTTP 200 OK { fenced: true, netfilterVerified: true }
    Executor->>CoordDB: Record phase1_net_fenced_at in cleanup_ledger (w: majority)

    Note over Executor,Provisioner: Phase 2: Scoped Worker Identity Revocation & Slot Self-Rotation (IDENTITY_REVOKED — B38-40)
    Executor->>Provisioner: POST /v1/provisioning/revoke-worker (Signed Revocation Order targeting slot_01)
    Provisioner->>Provisioner: Authenticate order; bind to decision_os_db_admin_slot_01
    Provisioner->>TestDB: db.getSiblingDB("decision_os_test_slot_01").dropUser("decision_os_worker_runA_wA") (w: majority, j: true)
    Provisioner->>TestDB: db.getSiblingDB("decision_os_test_slot_01").dropRole("workerRole") (w: majority, j: true)
    Provisioner->>TestDB: db.runCommand({ updateUser: "decision_os_db_admin_slot_01", pwd: P_gen2, writeConcern: { w: "majority", j: true } })
    Note over Provisioner,TestDB: Slot Admin Self-Rotation: requires actions: ["changeOwnPassword"] (B38-40). Broader changePassword excluded.
    TestDB-->>Provisioner: { ok: 1 } (P_gen1 permanently invalid on server; majority acknowledged)
    Provisioner->>Gateway: POST /v1/vault-gateway/slots/slot_01/rotate (mTLS SPIFFE + Signed Revocation Order + P_gen2)
    Gateway->>Gateway: Authenticate Caller & Revocation Signature
    Gateway->>Vault: PUT /v1/secret/data/slots/slot_01 { data: { password: P_gen2, generation: 2 } }
    Vault-->>Gateway: HTTP 200 OK
    Gateway-->>Provisioner: HTTP 200 OK { ok: 1, generation: 2 } (Vault KV updated via Gateway)
    Provisioner->>CoordDB: Mark ownership_locks.state = 'REVOKED', credential_generation = 2 (w: majority)
    Provisioner-->>Executor: HTTP 200 OK { userDropped: true, roleDropped: true, slotRotated: true }
    Executor->>CoordDB: Record phase2_identity_revoked_at, credential_generation in cleanup_ledger (w: majority)
    
    Note over Executor,TestDB: Phase 3: In-Flight Operation & Session Cancellation (OPS_KILLED)
    Executor->>TestDB: db.adminCommand({ currentOp: 1, "command.user": "decision_os_worker_runA_wA", "preparedTransaction": true }) (action: inprog on cluster)
    Note over Executor,TestDB: If prepared transactions detected, coordinate coordinator abort before proceeding
    Executor->>TestDB: db.adminCommand({ killOp: 1, query: { "command.user": "decision_os_worker_runA_wA" } }) (action: killop on cluster)
    Executor->>TestDB: db.adminCommand({ killAllSessionsByPattern: [{ users: [{ user: "decision_os_worker_runA_wA", db: "decision_os_test_slot_01" }] }] }) (actions: killAnySession, impersonate on cluster)
    Executor->>CoordDB: Record phase3_ops_killed_at in cleanup_ledger (w: majority)

    Note over WorkerA,TestDB: Hostile Worker retains open TCP sockets and sends write operations:
    WorkerA->>TestDB: PoolA.collection("data").insertOne({ hostile: true }) over lingering socket
    TestDB--xWorkerA: Dropped by Netfilter / MongoServerError: UserNotFound / Unauthorized (Code 11 / Code 13)
    WorkerA->>TestDB: PoolA attempts fresh SCRAM authentication with old password
    TestDB--xWorkerA: Dropped by Netfilter / MongoServerError: AuthenticationFailed / UserNotFound (Code 18 / Code 11)

    Note over Executor,CoordDB: Phase 4: Database Storage Deletion (STORAGE_DROPPED)
    Note over Executor: Verify Prerequisites: Phases 1, 2, 3 non-null and confirmed in cleanup_ledger!
    Executor->>CoordDB: Mark DISPATCHING in cleanup_ledger (dropExecutionLock = true, w: majority)
    Executor->>TestDB: db.runCommand({ dropDatabase: 1, comment: JSON.stringify({ requestId, slot: "slot_01", runA, wA }) })
    TestDB-->>Executor: { ok: 1, dropped: "decision_os_test_slot_01" }
    Executor->>CoordDB: Mark CLEANED in cleanup_ledger (dropExecutionLock = false, phase4_storage_dropped_at = now, w: majority)

    Note over Executor,AuditService: Phase 5: Audit & Evidence Finalization (AUDIT_FINALIZED)
    Executor->>AuditService: Append Audit Event: DB_CLEANED (SHA-256 Chained)
    AuditService->>AuditService: Generate Ed25519 Signed Checkpoint -> Emit to WORM
    Executor->>CoordDB: Record phase5_audit_finalized_at in cleanup_ledger (w: majority)
    Executor-->>Client: HTTP 200 OK { status: 'CLEANED' }

    Note over Executor,CoordDB: ADVERSARIAL ATTEMPT TO DROP COORDINATION STORAGE BLOCKED (B38-20)
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

#### 4. The Database-Scoped Provisioning Delegation Model (Finding B38-26, B38-31, B38-36, B38-37)
To satisfy least-privilege isolation without granting central unrestricted database-wide administration:

1. **Complete Removal of `{ db: "", collection: "" }` from Central Provisioner:**
   The central identity `decision_os_provisioner` has **zero** user-management, role-management, and role-grant privileges on `rs_test`. It cannot execute `createUser`, `createRole`, `dropUser`, or `dropRole` on any database on `rs_test`.
2. **Elimination of the Runtime Credential Broker (Finding B38-36):**
   - **Explicit Flaw of `{ db: "", collection: "" }`:** In v1.7.0, the dynamic credential broker possessed user- and role-management actions across `{ db: "", collection: "" }` on `rs_test`. In MongoDB RBAC, `{ db: "", collection: "" }` is an unrestricted wildcard covering every non-system database across the entire replica set. Under MongoDB's native authorization engine, any principal with this privilege has the power to manage users and roles across all existing and future non-system databases. Application-level regex checks (`^decision_os_test_.*$`), signed API claims, and separate container boundaries provide **zero MongoDB-native database isolation**. An adversary compromising the broker process or extracting its MongoDB connection credentials can bypass the broker application code entirely, connect directly to `rs_test:27018`, and alter users or inject backdoors into any worker's database.
   - **Selected Architecture — Elimination of Runtime Broker:** To achieve real, native database isolation, the runtime broker holding broad credentials is **completely eliminated from the active worker execution path**. Standard workloads run exclusively on the Pre-Provisioned Partition Pool (Tier 1). No active runtime service possesses wildcard `{ db: "", collection: "" }` user/role administration rights on `rs_test`.
3. **Tier 1 — Leased Partition Pools & Partition Slot Vault (Primary CI & Test Harness Path):**
   - **Pre-Allocation via Offline Bootstrap:** During cluster deployment initialization, an ephemeral offline container (`deploy/init-mongo-test.sh`) running identity `decision_os_offline_bootstrap` pre-allocates 256 dedicated partition slot databases (`decision_os_test_slot_000` through `slot_255`) on `rs_test:27018`.
   - **Discrete Scoped Administrators (`decision_os_db_admin_slot_${k}`):** For each partition slot $k$, the offline bootstrap creates a dedicated, discrete administrator `decision_os_db_admin_slot_${k}` whose MongoDB RBAC authorization scope is strictly:
     $$\text{Resource: } \{ \text{db: } \text{"decision_os_test_slot\_" + k}, \text{collection: } \text{""} \}$$
     $$\text{Actions: } [ \text{"createUser"}, \text{"dropUser"}, \text{"grantRole"}, \text{"revokeRole"}, \text{"createRole"}, \text{"dropRole"}, \text{"viewRole"}, \text{"changeCustomData"} ]$$
     It possesses **zero privileges on any other database**, zero cluster privileges, and zero destructive drop authority.
   - **Offline Bootstrap Credential Destruction Protocol:** Root administrative credentials required for initialization are generated in tmpfs (`/tmp/bootstrap_admin.key`). Upon successful creation of slot databases and roles, the initialization container securely shreds the credential file (`shred -u -z /tmp/bootstrap_admin.key`), verifies file zeroization, and permanently terminates. The bootstrap identity never runs in an active online container.
   - **Emergency Recovery Protocol:** If cluster metadata is lost or corrupted, an air-gapped break-glass procedure requires an offline Shamir's Secret Sharing ceremony (2-of-3 designated SRE key custodians) to launch a temporary maintenance pod with full session audit logging.
4. **Exact Lease-to-Secret Vault Binding & Least-Privilege Policy Separation (Findings B38-37, B38-41, B11-01):**
   - **Partition Slot Vault Architecture:** Slot credentials for pre-allocated databases (`decision_os_test_slot_000` through `decision_os_test_slot_255`) are stored in HashiCorp Vault KV-v2 engine mounted at `secret/data/slots/:slot_id`.
   - **Vault Identity and Policy Separation:**
     To strictly enforce least privilege and resolve finding B11-01 (where read-only tokens could not rotate credentials, and rotation roles risked excessive access), four distinct identities and policies are defined:
     
     **A. Credential Retrieval Policy: `slot-lease-reader` (Ephemeral Read-Only):**
     Used exclusively by ephemeral tokens minted via `POST /v1/auth/jwt/login` presenting an authorized lease JWT.
     ```hcl
     # Vault Policy: slot-lease-reader
     # Dynamic path scoping via JWT Entity Alias Metadata
     path "secret/data/slots/{{identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id}}" {
       capabilities = ["read"]
     }
     # Explicit denial of writes, rotation, listing, or cross-slot access
     path "secret/data/slots/*" {
       capabilities = ["deny"]
     }
     path "secret/metadata/*" {
       capabilities = ["deny"]
     }
     ```
     - *Capabilities:* `read` strictly on the exact slot bound to the JWT alias.
     - *Prohibited:* `create`, `update`, `delete`, `list`, `sudo`. It cannot rotate passwords, cannot list slots, and cannot view version metadata.

     **B. Credential Rotation Policies: 256 Discrete Per-Slot Policies `slot-rotator-slot_000` through `slot-rotator-slot_255` (Finding B12-03):**
     To eliminate the wildcard single-segment path (`secret/data/slots/+`) that permitted a compromised Gateway or stolen token to write to arbitrary slots, Decision OS establishes 256 discrete, declarative, narrowly scoped Vault policies generated during cluster bootstrap. Each policy restricts write capabilities strictly to its designated partition database slot path:
     ```hcl
     # Vault Policy: slot-rotator-slot_NNN (e.g., slot-rotator-slot_001)
     # Allows writing rotated secrets and verifying CAS metadata version strictly for slot_NNN
     path "secret/data/slots/slot_NNN" {
       capabilities = ["create", "update"]
     }
     path "secret/metadata/slots/slot_NNN" {
       capabilities = ["read"]
     }
     # Explicit denial of reading secret payload data, bulk listing, deletion, or cross-slot access
     path "secret/data/slots/slot_NNN" {
       capabilities = ["deny"] # for read
     }
     path "secret/data/*" {
       capabilities = ["deny"]
     }
     path "secret/metadata/*" {
       capabilities = ["deny"]
     }
     path "secret/delete/*" {
       capabilities = ["deny"]
     }
     path "secret/destroy/*" {
       capabilities = ["deny"]
     }
     ```
     - *Capabilities:* `create`, `update` strictly on `secret/data/slots/slot_NNN` and `read` strictly on `secret/metadata/slots/slot_NNN` (for check-and-set version verification).
     - *Prohibited:* `read` on `secret/data/*` (cannot read password payloads), `list`, `delete`, `destroy`, `sudo`, and all access to other slots (`secret/data/slots/!(slot_NNN)`).
     - *Ephemeral Scoped Token Exchange (Finding B12-03):* The Gateway authenticates via `auth/kubernetes` bound to `decision_os_vault_gateway`. When a rotation request arrives for `slot_NNN`, the Gateway presents the verified signed revocation order and exchanges its identity for an ephemeral scoped token bound **exclusively to `slot-rotator-slot_NNN`** (TTL: 60s, `num_uses: 2`). If a compromised Gateway attempts to write to any other slot, Vault's native ACL engine returns `HTTP 403 Forbidden: permission denied`.

     **C. Administrative Reconciliation Policy & Dedicated Forensic Identity (Findings B11-05, B12-01):**
     - *Administrative Reconciler Policy (`slot-admin-reconciler`):* Bound strictly to offline SRE client certificates (`auth/cert/sre-admin`).
     ```hcl
     # Vault Policy: slot-admin-reconciler
     path "secret/metadata/slots/*" {
       capabilities = ["read", "list"]
     }
     path "secret/data/*" {
       capabilities = ["deny"]
     }
     ```
     - *Capabilities:* `read`, `list` strictly on version metadata and token lookup/revocation. Zero secret payload read or write capabilities.
     - *Dedicated Forensic Identity (`decision_os_audit_investigator`, Finding B12-01):* Vault's `sys/audit` endpoint configures and inspects audit devices, but does NOT return audit events via HTTP GET. Forensic audit retrieval is executed exclusively by `decision_os_audit_investigator` querying the external immutable WORM audit log storage (S3 Object Lock in COMPLIANCE mode / GCS Bucket Lock), with **zero credentials and zero policy permissions on Vault port 8200 secret engine**.

   - **Vault JWT Auth Engine Configuration:**
     - Mount path: `auth/jwt` (internal mount accessor: `auth_jwt_9f8e7d6c`).
     - Role name: `slot-lease-role`.
     - Bound audiences: `["vault.decision-os.internal"]`.
     - User claim: `sub`.
     - Claim mappings: `{ "slot_id": "slot_id", "lease_id": "lease_id" }`.
     - Token policies: `["slot-lease-reader"]`.
     - Token num uses: 1 (`token_num_uses = 1`).
     - Token TTL: 60s (`token_ttl = 60s`, `token_max_ttl = 60s`, `token_renewable = false`).
   - **Dynamic Templating Resolution via Entity Alias Metadata:**
     When a JWT is exchanged, Vault creates an Entity Alias under accessor `auth_jwt_9f8e7d6c` and maps `claims.slot_id` into `identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id`.
     - If `slot_01` is presented, path resolves to `secret/data/slots/slot_01`.
     - If the caller requests `GET /v1/secret/data/slots/slot_02`, Vault evaluates `secret/data/slots/*` (`deny`) and returns `HTTP 403 Forbidden`.

5. **Dedicated Vault Gateway, Ingress Fencing & Durable Redemption Architecture (Findings B38-41, B11-01, B11-02, B11-03):**
   - **Resolution of Contradictory Topology:** All Vault API operations (JWT exchange, slot credential retrieval, credential rotation writes) pass **strictly through the Dedicated Vault Gateway (`apps/vault-gateway`, service account `decision_os_vault_gateway`)**. Direct network communication between Provisioners (`apps/provisioner`) or Workers (`apps/worker`) and Vault TCP port 8200 is completely eliminated.
   - **Workload Identity Contract & Authentication:**
     - Provisioners authenticate to the Gateway exclusively over mutual TLS (mTLS) with SPIFFE workload identities issued by the cluster trust domain:
       `spiffe://decision-os.internal/ns/decision-os-system/sa/decision-os-provisioner`
     - Calls must present both the verified SPIFFE client certificate and an Ed25519-signed lease JWT issued by the Coordination Authority.
     - Unauthenticated requests, requests from unauthorized SPIFFE identities, or requests lacking signed JWT claims are rejected with `HTTP 401 Unauthorized` or `HTTP 403 Forbidden` at the TLS termination layer.
   - **Gateway Operation & Confidentiality Rules:**
     - **Endpoint 1: `POST /v1/vault-gateway/slots/:slot_id/claim`:** Exchanges the signed lease JWT for minimal database credentials. The Gateway validates caller identity, verifies the JWT signature, executes atomic CAS claim on `rs_coord:27019.jwt_redemptions` across the 7-state machine, calls Vault `/v1/auth/jwt/login`, reads `secret/data/slots/:slot_id`, terminates the single-use Vault token, and returns **only** `{ username: "decision_os_db_admin_slot_" + k, password: P_gen }`. **The Provisioner never receives a Vault client token.**
     - **Endpoint 2: `POST /v1/vault-gateway/slots/:slot_id/rotate`:** Receives the signed revocation order and newly rotated password $P_{N+1}$ from the Provisioner following server-side `updateUser` acknowledgement. Gateway validates authorization, updates Vault KV-v2 at `secret/data/slots/:slot_id`, increments secret generation, and returns `HTTP 200 { ok: 1, generation: nextGen }`.
   - **Signed Revocation Order Schema & Cryptographic Binding (Findings B11-01, B12-07):**
     The Gateway rotation endpoint strictly enforces that rotation requests are accompanied by a canonical, Ed25519-signed revocation order binding authoritative generation parameters ($N \rightarrow N+1$):
     ```json
     {
       "$schema": "https://specs.decision-os.internal/schemas/v2/revocation-order.json",
       "orderId": "rev-ord-8a7b6c5d-4e3f-2a1b-0c9d-8e7f6a5b4c3d",
       "slotId": "slot_01",
       "leaseId": "lease_10928",
       "currentCredentialGeneration": 1,
       "expectedPreviousGeneration": 1,
       "newCredentialGeneration": 2,
       "operationId": "op-rot-2026-11-10-001",
       "orderCreatedAtISO": "2026-11-10T10:00:00.000Z",
       "orderExpiryEpochMs": 1794304860000,
       "authorizedCallerPrincipal": "spiffe://decision-os.internal/ns/decision-os-system/sa/decision-os-provisioner",
       "signature": "<base64url_ed25519_signature>"
     }
     ```
     - *Signature Payload Formulation:*
       $$\text{SignedOrderBytes} = \text{UTF8}(\text{"DECISION_OS_REVOCATION_ORDER_V1:"}) \parallel \text{JCS}(\text{orderWithoutSignature})$$
     - *Authoritative Generation Validation Constraints (Finding B12-07):*
       1. The order signature must verify against the Coordination Authority public key.
       2. `slotId` must match the URL parameter `:slot_id` byte-for-byte.
       3. `authorizedCallerPrincipal` must match the mTLS client SPIFFE identity.
       4. Current time must not exceed `orderExpiryEpochMs`.
       5. `expectedPreviousGeneration === currentCredentialGeneration` (proving caller's explicit knowledge of the active generation).
       6. `newCredentialGeneration === currentCredentialGeneration + 1` (strict single-step monotonicity; zero rollbacks or jumps).
   - **Vault Write Commitment Proof via Check-and-Set (CAS) (Findings B11-01, B12-07):**
     1. Gateway acquires ephemeral scoped rotation token bound strictly to `slot-rotator-:slot_id`.
     2. Gateway dispatches rotation write to Vault using KV-v2 CAS with `cas: currentCredentialGeneration`:
        `POST /v1/secret/data/slots/:slot_id` with `{ data: { password: P_next }, options: { cas: currentCredentialGeneration } }`.
     3. Gateway **proves commitment** by issuing `GET /v1/secret/metadata/slots/:slot_id` to verify that Vault's metadata record indicates:
        `metadata.current_version === newCredentialGeneration` and `metadata.created_time` matches the write transaction.
     4. Only after this verification succeeds does the Gateway transition the record in `decision_os_coordination.slot_rotation_log` to `COMPLETED` with majority write concern (`w: "majority", j: true`) and return `HTTP 200 { ok: 1, generation: nextGen }`.
   - **Path Substitution & Traversal Prevention (Findings B11-01, B12-03):**
     Gateway endpoints strictly validate `:slot_id` against regex `^slot_([0-1][0-9]{2}|2[0-4][0-9]|25[0-5])$`. If a caller attempts path traversal (`../`), null-byte injection, or supplies a `:slot_id` that does not match `order.slotId`, the request is rejected with `HTTP 403 Forbidden: Slot ID path mismatch`. Furthermore, even if the Gateway were compromised, Vault natively enforces per-slot isolation via `slot-rotator-slot_NNN`.
   - **Response-Loss Recovery & Idempotent Rotation (Finding B12-02):**
     If the Provisioner disconnects before receiving the HTTP 200 response, it re-queries `GET /v1/vault-gateway/slots/:slot_id/rotate-status?operationId=:opId`. The Gateway looks up `slot_rotation_log`; if the operation already reached `VAULT_WRITE_CONFIRMED` or `COMPLETED`, it returns the committed status idempotently without re-executing writes against Vault.
   - **Kubernetes NetworkPolicy L3/L4 Transport Fencing:**
     ```yaml
     # Kubernetes NetworkPolicy: vault-gateway-ingress-fence
     apiVersion: networking.k8s.io/v1
     kind: NetworkPolicy
     metadata:
       name: vault-gateway-ingress-fence
       namespace: decision-os-system
     spec:
       podSelector:
         matchLabels:
           app.kubernetes.io/name: slot-vault
       policyTypes:
       - Ingress
       ingress:
       # Vault TCP port 8200 restricted EXCLUSIVELY to Dedicated Vault Gateway
       - from:
         - podSelector:
             matchLabels:
               app.kubernetes.io/name: vault-gateway
         ports:
         - protocol: TCP
           port: 8200
     ```
   - **Workload Identity Integrity & Admission Control:**
     1. *Kubernetes RBAC Boundary:* Worker and Provisioner service accounts possess zero `pods/create`, `pods/update`, or `pods/patch` privileges in `decision-os-system`.
     2. *Admission Controller Validation:* A ValidatingAdmissionWebhook strictly enforces that `app.kubernetes.io/name: vault-gateway` can only be scheduled with verified container image digests and service account `decision_os_vault_gateway`.
     3. *Service Mesh mTLS:* Gateway-to-Vault communication is authenticated at Layer 7 using SPIFFE X.509 certificates.
   - **Gateway Compromise Containment & Runtime Privilege Scoping (Findings B11-02, B12-02):**
     - The Gateway has zero network route and zero credentials to `rs_test:27018`. It cannot execute `dropDatabase`, `createUser`, or `dropUser`.
     - Gateway permissions on `rs_coord:27019` are strictly limited to `actions: ["find", "insert", "update"]` on:
       - `{ db: "decision_os_coordination", collection: "jwt_redemptions" }`
       - `{ db: "decision_os_coordination", collection: "slot_rotation_log" }`
       Action `createIndex` is strictly excluded; all indexes are pre-created during system bootstrap. Access to all other collections is denied.

6. **MongoDB-Enforced Credential Lifecycle & Slot Rotation Protocol (Finding B38-40):**
   - **Mandatory Credential Lifecycle Invariants:**
     1. A credential issued for lease $N$ must not authenticate after lease $N$ is revoked.
     2. A slot cannot transition to a new lease while the previous lease's credential remains valid.
     3. Vault token expiry must never be treated as proof of MongoDB credential revocation.
     4. Revocation must be confirmed by the MongoDB control plane (`w: "majority", j: true`), not inferred from an application response.
     5. Failure or timeout during credential revocation leaves the slot quarantined (`QUARANTINED`).
     6. A stale worker must not regain access through a previously retained password.
     7. Credential revocation, session termination, network fencing, and slot reassignment must follow the canonical 5-phase order.
     8. Killing sessions alone does NOT invalidate a retained password; server-side `updateUser` with `changeOwnPassword` (for slot admins) and `dropUser` (for workers) is the mandatory invalidation boundary.
   - **Slot Admin Self-Rotation Privilege Specification (B38-40 Correction):**
     - When the slot administrator `decision_os_db_admin_slot_${k}` rotates its own password during Phase 2 Revocation (`IDENTITY_REVOKED`), it connects as itself to `rs_test:27018` targeting `decision_os_test_slot_${k}`.
     - In MongoDB RBAC, self-rotation of an authenticated principal's own password requires the **`changeOwnPassword`** action on `{ db: "decision_os_test_slot_" + k, collection: "" }`.
     - The broader `changePassword` action (which authorizes changing passwords of other users) is **EXPLICITLY PROHIBITED** and excluded from the slot admin role definition to prevent privilege escalation.
     - **Exact Command Dispatched:**
       ```javascript
       // Executed as decision_os_db_admin_slot_${k} on rs_test:27018
       db.runCommand({
         updateUser: "decision_os_db_admin_slot_" + k,
         pwd: crypto.randomBytes(32).toString('hex'),
         writeConcern: { w: "majority", j: true }
       });
       ```
   - **Slot Credential Lifecycle State Machine:**
     ```mermaid
     stateDiagram-v2
         [*] --> INITIALIZED: Pre-provisioned during bootstrap (Generation 1)
         INITIALIZED --> LEASED: Slot leased to Worker (Lease N)
         LEASED --> ROTATING: Teardown initiated (Phase 2 Revocation)
         ROTATING --> ROTATED: updateUser confirmed by MongoDB server (w: majority, j: true)
         ROTATING --> QUARANTINED: Timeout / Network severance / Ambiguous result
         ROTATED --> VAULT_SYNCHRONIZED: Vault KV-v2 updated via Gateway (POST /v1/vault-gateway/slots/:slot_id/rotate)
         VAULT_SYNCHRONIZED --> TEARDOWN_COMPLETED: Phases 3, 4, 5 complete (state: CLEANED)
         TEARDOWN_COMPLETED --> AVAILABLE: Slot Reassignment Gate verified
         QUARANTINED --> [*]: Permanent lock retention; requires SRE reconciliation
     ```
   - **Slot Reassignment Release Gate:**
     The Coordination Authority on `rs_coord:27019` strictly enforces that a slot cannot transition from `REVOKED` / `CLEANED` to `AVAILABLE` unless:
     ```javascript
     record.previous_credential_revoked === true &&
     record.credential_generation === expectedNextGen &&
     record.state === 'CLEANED' &&
     record.phase5_audit_finalized_at !== null
     ```
     If any check fails or is unconfirmed, slot reassignment is rejected.
   - **Failure, Timeout, and Quarantine:**
     If `updateUser` or the Vault write fails, times out, or returns an ambiguous response, the slot is immediately transitioned to `QUARANTINED`. The execution lock is permanently held, and the slot is excluded from the allocatable pool until manual or administrative reconciliation proves credential state.

7. **Handling of Non-Existent Target Databases:**
   In the Pre-Provisioned Partition Pool, every allocatable database `decision_os_test_slot_${k}` already exists. If an unpooled or non-existent database name (e.g. `decision_os_test_nonexistent`) is requested without leasing a valid partition slot, the request is **strictly rejected** with `UnallocatedDatabaseException`. No dynamic unscoped administrator exists, and no broad-privilege broker is invoked.

8. **Designation of Dynamic Scaling as an Offline / Control-Plane Root of Trust:**
   Dynamic database creation inherently requires broad administrative credentials (`{ db: "", collection: "" }` or cluster userAdmin) because a database that does not yet exist has no scoped administrator. Rather than running a broad credential broker on the active worker path, capacity expansion is designated strictly as an **Offline / Control-Plane Root of Trust** (`deploy/init-mongo-test.sh`), executed by infrastructure pipelines during maintenance or scaling windows. Any optional dynamic broker is classified as an uncontained control-plane root of trust, with full cross-database blast radius acknowledged, and disabled by default in production (`DECISION_OS_DYNAMIC_PROVISIONING_ENABLED=false`).

#### 5. Concrete Negative Authorization Cases (B38-26, B38-31, B38-36, B38-37, B38-40, B38-41, B38-42, B11-01, B11-02)
MongoDB RBAC and HashiCorp Vault natively enforce the following negative authorization boundaries:

1. **Central Provisioner Direct User/Role Creation (NC-1):**
   - `decision_os_provisioner` executes `db.getSiblingDB("decision_os_test_slot_01").createRole(...)`
   - *Result:* `MongoServerError: not authorized on decision_os_test_slot_01 to execute command { createRole: ... }` (Error Code 13).
2. **Cross-Slot Scoped Identity Attack (User Manipulation) (NC-2):**
   - Compromised `decision_os_db_admin_slot_01` executes `db.getSiblingDB("decision_os_test_slot_02").createUser(...)`
   - *Result:* `MongoServerError: not authorized on decision_os_test_slot_02 to execute command { createUser: ... }` (Error Code 13).
3. **Cross-Slot Scoped Identity Attack (Password Modification) (NC-3):**
   - Compromised `decision_os_db_admin_slot_01` executes `db.getSiblingDB("decision_os_test_slot_02").changeUserPassword(...)`
   - *Result:* `MongoServerError: not authorized on decision_os_test_slot_02 to execute command { updateUser: ... }` (Error Code 13).
4. **Cross-Slot Role Definition Attempt (NC-4):**
   - Compromised `decision_os_db_admin_slot_01` attempts to define a role on `decision_os_test_slot_01` containing privileges on `decision_os_test_slot_02`:
     ```javascript
     db.getSiblingDB("decision_os_test_slot_01").createRole({
       role: "illegal_cross_role",
       privileges: [{ resource: { db: "decision_os_test_slot_02", collection: "" }, actions: ["find"] }],
       roles: []
     });
     ```
   - *Result:* `MongoServerError: Cannot grant privileges on other databases for a role defined on a non-admin database`.
5. **Scoped Identity Destructive Escalation (NC-5):**
   - Compromised `decision_os_db_admin_slot_01` attempts `db.getSiblingDB("decision_os_test_slot_01").dropDatabase()`
   - *Result:* `MongoServerError: not authorized on decision_os_test_slot_01 to execute command { dropDatabase: 1 }` (Error Code 13).
6. **Compromised Dynamic Broker Destructive Escalation (NC-6):**
   - Compromised `decision_os_credential_broker` attempts `db.getSiblingDB("decision_os_test_slot_01").dropDatabase()`
   - *Result:* `MongoServerError: not authorized on decision_os_test_slot_01 to execute command { dropDatabase: 1 }` (Error Code 13).
7. **Compromised Dynamic Broker System DB Escalation (NC-7):**
   - Compromised `decision_os_credential_broker` attempts `db.getSiblingDB("admin").createUser(...)`
   - *Result:* `MongoServerError: not authorized on admin to execute command { createUser: ... }` (Error Code 13; broker privileges restricted to `{ db: "", collection: "" }` which excludes system databases).
8. **Provisioner Bulk Slot Enumeration Attempt (NC-8):**
   - Compromised `decision_os_provisioner` attempts `vault.list("secret/metadata/slots")`
   - *Result:* `VaultError: 403 permission denied (path-based ACL denies list capability)`.
9. **Compromised Provisioner Direct Vault API Path Substitution Attack (NC-9 - B38-37, B38-41):**
   - Attacker compromises provisioner and attempts to issue `GET /v1/secret/data/slots/slot_02` directly against Vault's HTTP API.
   - *Result:* TCP SYN dropped by Layer 4 NetworkPolicy; provisioner network has zero route to Vault port 8200.
   - Attacker then calls Gateway `POST /v1/vault-gateway/slots/slot_02/claim` presenting a signed JWT bound to `slot_01`.
   - *Result:* `HTTP 403 Forbidden: Slot claim mismatch`. Gateway verifies that `claims.slot_id === requestedSlot`. Furthermore, even if forwarded, Vault's templated policy against Entity Alias Metadata matches `secret/data/slots/*` (`deny`) and returns `HTTP 403 Forbidden`.
10. **Scoped Partition Admin Cross-Database Wire Attack (NC-10 - B38-36):**
    - Attacker connects directly to `rs_test:27018` using `decision_os_db_admin_slot_01` credentials and attempts `db.getSiblingDB("decision_os_test_slot_02").createUser(...)`.
    - *Result:* `MongoServerError: not authorized on decision_os_test_slot_02 to execute command { createUser: ... }` (Error Code 13). Cross-database administration is natively rejected by MongoDB RBAC.
11. **Retained Slot Admin Password Reuse Post-Lease Expiry (NC-11 - B38-40):**
    - Attacker retains password $P_N$ for `decision_os_db_admin_slot_01` after lease $N$ terminates. Slot completes Phase 2 Revocation where password rotates to $P_{N+1}$ via `updateUser` (`changeOwnPassword`) with majority ack. Attacker attempts SCRAM authentication with $P_N$.
    - *Result:* `MongoServerError: Authentication failed` (Error Code 18). Password rotation invalidates cached SCRAM credentials permanently.
12. **Sequential or Concurrent JWT Redemption Replay via Gateway (NC-12 - B38-41):**
    - Attacker intercepts valid signed JWT for `slot_01` and submits it a second time to `POST /v1/vault-gateway/slots/slot_01/claim`.
    - *Result:* `HTTP 409 Conflict` with `JwtReplayException: JWT jti already claimed or redeemed`. The Gateway's atomic CAS pre-consumption on `rs_coord:27019.jwt_redemptions` detects prior claim and rejects request before calling Vault.
13. **Direct Vault Network Ingress Bypass Attempt by Worker or Provisioner (NC-13 - B38-41):**
    - Compromised worker pod in `apps/worker` or provisioner pod in `apps/provisioner` attempts to contact Vault port 8200 directly: `curl -X POST http://slot-vault.decision-os-system:8200/v1/auth/jwt/login -d '{"jwt":"..."}'` or `curl http://slot-vault.decision-os-system:8200/v1/secret/data/slots/slot_01`.
    - *Result:* Connection timed out or connection refused. Kubernetes `NetworkPolicy` (`vault-gateway-ingress-fence`) drops TCP SYN packets at the Linux netfilter data plane because caller does not match `app.kubernetes.io/name: vault-gateway`. Direct routes to Vault port 8200 are physically blocked.
14. **Slot Admin Self-Rotation Attempt with changePassword Only (NC-14 - B38-40):**
    - Role misconfiguration test: `decision_os_db_admin_slot_01` is granted action `changePassword` but NOT `changeOwnPassword`. It attempts `db.runCommand({ updateUser: "decision_os_db_admin_slot_01", pwd: "..." })`.
    - *Result:* `MongoServerError: not authorized on decision_os_test_slot_01 to execute command { updateUser: "decision_os_db_admin_slot_01", ... }` (Error Code 13). MongoDB RBAC strictly requires `changeOwnPassword` for self-password modification.
15. **Plaintext Unquarantine Attempt with Mismatched or Post-Incident WORM Evidence (NC-15 - B38-42):**
    - Attacker or recovery script attempts to unquarantine an AES-GCM envelope presenting an audit checkpoint created after the compromise timestamp ($t_{\text{checkpoint}} \ge t_{\text{compromise}}$) or with mismatched SHA-256 digest.
    - *Result:* `SecurityException: WormEvidenceValidationFailed`. Candidate plaintext digest does not match pre-incident WORM signature. Envelope remains permanently in `QUARANTINED`.
16. **Direct Path Guessing on Partition Slot Vault (NC-16 - B38-37, B38-41):**
    - Provisioner attempts direct path guessing against Vault: dropped at netfilter (NetworkPolicy).
    - Provisioner calls Gateway requesting `slot_02` while presenting token minted for `slot_01`:
    - *Result:* `HTTP 403 Forbidden: Slot claim mismatch`. Gateway verifies that `claims.slot_id === requestedSlot`. In addition, Vault evaluates templated path policy against Entity Alias Metadata `identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id` and denies access with `HTTP 403 Forbidden`.
17. **Read-Only Lease Token Attempting Credential Rotation Write (NC-17 - B11-01):**
    - Attacker captures the ephemeral Vault client token issued to the Gateway during credential retrieval (`slot-lease-reader`) and attempts to write/rotate a password:
      `PUT /v1/secret/data/slots/slot_01` with `{"data":{"password":"hacked"}}`.
    - *Result:* `VaultError: 403 permission denied`. The `slot-lease-reader` policy explicitly grants only `read` capability; `create` and `update` are denied.
18. **Rotation Identity Attempting Secret Payload Retrieval or Slot Enumeration (NC-18 - B11-01):**
    - Attacker compromises the Gateway rotation identity (`slot-credential-rotator`) and attempts to read secret passwords:
      `GET /v1/secret/data/slots/slot_01` or `GET /v1/secret/data/slots/slot_02`.
    - *Result:* `VaultError: 403 permission denied`. The `slot-credential-rotator` policy strictly denies `read` on `secret/data/*`. It has permissions only for `create`/`update` on secret data and `read` on secret metadata.
19. **Unfenced JWT Redemption State Transition Attempt by Stale Gateway (NC-19 - B11-02):**
    - Gateway Pod A starts redemption for `jti_abc` and pauses. Pod B takes over via recovery and advances `fencing_generation` from 1 to 2. Pod A resumes and attempts:
      `updateOne({ _id: "jti_abc", status: "CLAIMED", owner_instance_id: "pod-A", fencing_generation: 1 }, { $set: { status: "ISSUED" } })`.
    - *Result:* `matchedCount === 0`. The update is rejected with `StaleGenerationException`. Pod A is aborted; split-brain token issuance is prevented.
20. **Path Substitution on Vault Gateway Rotation Endpoint (NC-20 - B11-01):**
    - Compromised Provisioner holds a valid revocation order signed for `slot_01`, but invokes the rotation endpoint targeting `slot_02`:
      `POST /v1/vault-gateway/slots/slot_02/rotate` presenting the order for `slot_01`.
    - *Result:* `HTTP 403 Forbidden: Slot ID path mismatch with signed revocation order`. Gateway validates that URL path `:slot_id` matches `order.slotId` byte-for-byte.
21. **Replay of Stale or Already Executed Revocation Order (NC-21 - B11-01):**
    - Attacker intercepts a signed revocation order with `newCredentialGeneration: 2` and replays it after generation 2 has already committed.
    - *Result:* `HTTP 409 Conflict: Generation regression rejected`. Gateway validates that `newCredentialGeneration > currentGeneration` and rejects replayed or decremented orders.
22. **Cross-Slot Native Vault Rotation Tampering by Compromised Gateway (NC-22 - B12-03):**
    - Gateway pod is compromised and attempts to write rotated secret to `secret/data/slots/slot_002` using an ephemeral token exchanged for `slot-rotator-slot_001`.
    - *Result:* Native Vault `HTTP 403 Forbidden: permission denied`. Vault's ACL engine evaluates the policy `slot-rotator-slot_001` (which contains `deny` on all paths other than `slot_001`) and blocks the cross-slot write natively.
23. **Automated Redispatch of Ambiguous Vault Login Request across Reverse Proxy / Mesh (NC-23 - B12-04):**
    - Network timeout between Gateway and Vault results in `OUTCOME_UNKNOWN`. Reverse proxy or service mesh attempts automated HTTP POST retry to `/v1/auth/jwt/login`.
    - *Result:* Automated retry is blocked by proxy zero-retry configuration; Gateway state machine transitions immediately to `QUARANTINED`, permanently locking the `jti` and requiring independent forensic audit proof before unquarantine.
24. **Unquarantine Attempt with Synthetic / Truncated / Invalid RFC 3161 Timestamp Token (NC-24 - B12-05, B12-08):**
    - Attacker submits an unquarantine order accompanied by a Base64-encoded JSON mock or malformed ASN.1 DER token.
    - *Result:* Cryptographic validator invokes native ASN.1 DER parser and verifies CMS `ContentInfo` type `id-signedData` with encapsulated `TSTInfo`. Parser throws `InvalidTimestampTokenStructureException` and rejects unquarantine.
25. **Credential Generation Regression or Stale Generation Attempt via Revocation Order (NC-25 - B12-07):**
    - Attacker submits revocation order with `currentCredentialGeneration: 2`, `expectedPreviousGeneration: 1`, `newCredentialGeneration: 2` (or decremented value) attempting to roll back credentials.
    - *Result:* Gateway validation rejects with `HTTP 409 Conflict: Non-monotonic credential generation`. Furthermore, Vault KV-v2 CAS with `cas: 2` rejects regression natively.

---

### 7.6 Exact Privilege Matrix by Identity & Deployment

The following matrices formally specify permissions for every principal across both MongoDB deployments and HashiCorp Vault, reconciling every assigned command with native database and secret engine RBAC:

#### Table 7.6.1: MongoDB Privilege Matrix by Principal

| Identity Principal | Target Deployment | Resource Scope | Permitted Actions | Explicitly Prohibited Actions | Enforcement Mechanism & Trust Boundary |
|---|---|---|---|---|---|
| **`decision_os_destructive_executor`** | **`rs_test` (`:27018`)** | `{ db: "", collection: "" }` | `dropDatabase`, `dropCollection`, `listCollections`, `find` | `createRole`, `dropRole`, `createUser`, `dropUser`, `grantRole`, `revokeRole`, `update`, `insert`, `remove` | MongoDB RBAC engine on `rs_test` (Code 13). Phase 4 drop strictly gated on durable Phases 1-3. |
| **`decision_os_destructive_executor`** | **`rs_test` (`:27018`)** | `{ cluster: true }` | `inprog`, `killop`, `killAnySession`, `impersonate`, `checkCursorSanity` | `grantRole`, `shutdown`, `replSetReconfig` | MongoDB RBAC engine on `rs_test` (Command `killOp` executed on `admin.$cmd`). |
| **`decision_os_destructive_executor`** | **`rs_coord` (`:27019`)** | **ALL RESOURCES** | **NONE (Zero Access)** | **ALL COMMANDS AND WIRE TRAFFIC** | Network policy (egress/ingress blocked) + zero credentials. |
| **`decision_os_provisioner`** | **`rs_test` (`:27018`)** | `{ db: "", collection: "" }` | **NONE (Zero Admin Rights)** | `createRole`, `dropRole`, `createUser`, `dropUser`, `grantRole`, `revokeRole`, `changePassword`, `dropDatabase` | MongoDB RBAC engine on `rs_test` (Code 13). |
| **`decision_os_provisioner`** | **`rs_test` (`:27018`)** | `{ db: "admin", collection: "" }` | `find` (read-only system metadata) | `createRole`, `createUser`, `grantRole`, `dropUser` on `admin` | MongoDB RBAC engine on `rs_test` (Code 13). |
| **`decision_os_provisioner`** | **`rs_test` (`:27018`)** | `{ cluster: true }` | `listDatabases` | `killAnySession`, `shutdown`, `replSetReconfig` | MongoDB RBAC engine on `rs_test`. |
| **`decision_os_provisioner`** | **`rs_coord` (`:27019`)** | `decision_os_coordination.ownership_locks` | `find`, `insert`, `update`, `remove`, `createIndex` | `dropCollection`, `dropDatabase` | MongoDB RBAC engine on `rs_coord` (Code 13; authorizes `findAndModify` command). |
| **`decision_os_provisioner`** | **`rs_coord` (`:27019`)** | `decision_os_coordination.provisioning_saga` | `find`, `insert`, `update`, `remove`, `createIndex` | `dropCollection`, `dropDatabase` | MongoDB RBAC engine on `rs_coord` (Code 13; authorizes `findAndModify` command). |
| **`decision_os_provisioner`** | **`rs_coord` (`:27019`)** | `decision_os_coordination.cleanup_ledger` | `find` | `insert`, `update`, `remove`, `dropCollection` | MongoDB RBAC engine on `rs_coord` (Code 13). |
| **`decision_os_provisioner`** | **`rs_coord` (`:27019`)** | `decision_os_coordination.nonce_allocations` | **NONE (Zero Write Access)** | `insert`, `update`, `remove`, `dropCollection`, `dropDatabase` | Decoupled strictly to `decision_os_nonce_allocator`. |
| **`decision_os_provisioner`** | **`rs_coord` (`:27019`)** | `decision_os_coordination.cleanup_audit_log` | **NONE** | `find`, `insert`, `update`, `remove`, `drop` | MongoDB RBAC engine on `rs_coord` (Code 13). |
| **`decision_os_nonce_allocator`** | **`rs_coord` (`:27019`)** | `decision_os_coordination.nonce_allocations` | `find`, `insert`, `update`, `createIndex` (Monotonic `$inc` blocks) | `remove`, `dropCollection`, `dropDatabase` | **Cryptographic Root of Trust.** Authorized for `$inc`. Governed by Allocator-Compromise Protocol (B38-38). |
| **`decision_os_nonce_allocator`** | **`rs_coord` (`:27019`)** | All other collections | **NONE** | All CRUD and DDL commands | MongoDB RBAC engine on `rs_coord` (Code 13). |
| **`decision_os_nonce_allocator`** | **`rs_test` (`:27018`)** | **ALL RESOURCES** | **NONE (Zero Access)** | **ALL COMMANDS** | Zero network route and zero credentials. |
| **`decision_os_offline_bootstrap`** | **`rs_test` (`:27018`)** | Pre-allocated slot DBs (`slot_000`–`slot_255`) | `createRole`, `createUser`, `createCollection` | Runtime persistence | Ephemeral bootstrap container; shredded on exit (`shred -u`). |
| **`decision_os_offline_bootstrap`** | **`rs_test` (`:27018`)** | `admin` | `createRole`, `createUser` (Root setup only) | Granting cluster superusers | Ephemeral bootstrap container; shredded on exit (`shred -u`). |
| **`decision_os_offline_bootstrap`** | **`rs_coord` (`:27019`)** | Initial collections & `nonce_seq_v1` | `insert`, `createIndex` | Runtime persistence | Ephemeral bootstrap container; shredded on exit (`shred -u`). |
| **`decision_os_credential_broker`** *(Optional Dev Only)* | **`rs_test` (`:27018`)** | `{ db: "", collection: "" }` | `createRole`, `createUser`, `grantRole` | `dropDatabase`, `dropCollection`, `changePassword` on other DBs | Uncontained Control-Plane Root of Trust. Disabled in production. |
| **`decision_os_credential_broker`** | **`rs_test` (`:27018`)** | `admin`, `config`, `local`, `{ cluster: true }` | **NONE** | All commands and actions | MongoDB RBAC engine on `rs_test` (Code 13). |
| **`decision_os_credential_broker`** | **`rs_coord` (`:27019`)** | **ALL RESOURCES** | **NONE (Zero Access)** | **ALL COMMANDS** | Zero network route and zero credentials. |
| **`decision_os_db_admin_slot_${k}`** | **`rs_test` (`:27018`)** | `{ db: "decision_os_test_slot_${k}", collection: "" }` | `createRole`, `dropRole`, `createUser`, `dropUser`, `grantRole`, `revokeRole`, `changeOwnPassword`, `getRole`, `getUser` (includes `updateUser` for self-rotation) | `changePassword` (modifying other users' passwords), `dropDatabase`, `dropCollection`, any command on other databases | Scoped Partition Slot DB Admin. Natively constrained to slot $k$ by MongoDB RBAC (Code 13 on all other DBs). Governed by Option B Credential Rotation (B38-40). Granted `changeOwnPassword` strictly; broader `changePassword` is explicitly prohibited. |
| **`decision_os_db_admin_slot_${k}`** | **`rs_test` (`:27018`)** | Other databases & cluster | **NONE** | All commands on databases other than slot $k$ or `{ cluster: true }` | MongoDB RBAC engine on `rs_test` (Code 13). |
| **`decision_os_db_admin_slot_${k}`** | **`rs_coord` (`:27019`)** | **ALL RESOURCES** | **NONE (Zero Access)** | **ALL COMMANDS** | Zero network route and zero credentials. |
| **`decision_os_vault_gateway`** | **`rs_coord` (`:27019`)** | `decision_os_coordination.jwt_redemptions`, `decision_os_coordination.slot_rotation_log` | `find`, `insert`, `update` (Runtime 7-state CAS redemption and rotation machines) | `createIndex`, `remove`, `dropCollection`, `dropDatabase`, and all access to other coordination collections | Dedicated Vault Gateway runtime identity (Findings B11-02, B12-02). Mediates Vault token exchanges and records credential rotation logs across 7-state machine. Action `createIndex` is strictly removed (indexes created during bootstrap). `update` is strictly fenced by `status`, `owner_instance_id`, and `fencing_generation`. |
| **`decision_os_recovery_service`** | **`rs_coord` (`:27019`)** | `decision_os_coordination.jwt_redemptions` | `find`, `update` (Fenced sweep of expired/orphaned redemptions) | `insert`, `createIndex`, `remove`, `dropCollection`, `dropDatabase` | Background recovery actor (Finding B11-04). Sweeps un-dispatched expired claims. Zero network route to Vault port 8200; prohibited from re-dispatching Vault requests. |
| **`decision_os_admin_reconciler`** | **`rs_coord` (`:27019`)** | `decision_os_coordination.jwt_redemptions` | `find`, `update` (Signed offline administrative unquarantine) | `insert`, `createIndex`, `remove`, `dropCollection`, `dropDatabase` | Administrative reconciliation identity (Finding B11-05). Operates strictly under signed dual-party SRE authorization orders. |
| **`decision_os_network_fence_controller`** | **Infrastructure Plane** | Worker pod/container veth interfaces | Program netfilter/iptables egress drops to ports 27018/27019 | ALL MongoDB wire commands | CNI / Linux netfilter engine; zero DB credentials. Phase 1 fence execution. |
| **`decision_os_audit_writer`** | **`rs_coord` (`:27019`)** | `decision_os_coordination.cleanup_audit_log` | `find`, `insert`, `createIndex` (Append-Only) | `update`, `remove`, `dropCollection`, `dropDatabase` | MongoDB RBAC engine on `rs_coord` (Code 13; prevents `findAndModify` write ops). |
| **`decision_os_audit_writer`** | **`rs_coord` (`:27019`)** | All other collections | **NONE** | All CRUD and DDL commands | MongoDB RBAC engine on `rs_coord` (Code 13). |
| **`decision_os_audit_writer`** | **`rs_test` (`:27018`)** | **ALL RESOURCES** | **NONE (Zero Access)** | **ALL COMMANDS** | Zero network route and zero credentials. |
| **`decision_os_worker_${runId}_${workerId}`** | **`rs_test` (`:27018`)** | Assigned partition DB (`decision_os_test_slot_${k}`) | `find`, `insert`, `update`, `remove`, `createCollection`, `createIndex`, `dropIndex` | `dropDatabase`, `dropCollection`, `createRole`, `createUser` | Dynamic test role defined on assigned slot DB (Code 13). |
| **`decision_os_worker_${runId}_${workerId}`** | **`rs_test` (`:27018`)** | Other test DBs & system DBs | **NONE** | Any read or write command | Scoped dynamic role isolation (Code 13). |
| **`decision_os_worker_${runId}_${workerId}`** | **`rs_coord` (`:27019`)** | **ALL RESOURCES** | **NONE (Zero Access)** | **ALL COMMANDS** | Network policy + zero credentials. |
| **`decision_os_admin_operator`** | **API Interface Only** | HTTP `/v1/cleanup/reconcile` | Signed administrative reconciliation (`QUARANTINE`, `CONFIRM_CLEANED`) | Direct database wire access; redispatch of wire drop | Ed25519 signature verification on API gateway. |

---

#### Table 7.6.2: Exact Vault Privilege Matrix by Policy & Principal (Finding B11-01)

| Vault Policy / Role | Authentication Method | Bound Identity / Accessor | Target Resource Path | Permitted Capabilities | Prohibited Capabilities | Trust Boundary & Enforcement |
|---|---|---|---|---|---|---|
| **`slot-lease-reader`** | `auth/jwt` (`slot-lease-role`) | Ephemeral token minted from signed lease JWT | `secret/data/slots/{{identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id}}` | `read` | `create`, `update`, `delete`, `list`, `sudo` | Dynamic templating against Entity Alias Metadata. Ephemeral single-use token (`num_uses: 1`, `ttl: 60s`). Strictly read-only; cannot rotate passwords. |
| **`slot-lease-reader`** | `auth/jwt` | Same | `secret/data/slots/*`, `secret/metadata/*` | **NONE** | `read`, `create`, `update`, `delete`, `list` | Explicit `deny` blocks cross-slot reads and metadata enumeration. |
| **`slot-rotator-slot_000` through `slot-rotator-slot_255`** | `auth/kubernetes` (ephemeral scoped token exchange) | ServiceAccount `decision_os_vault_gateway` in `decision-os-system` | `secret/data/slots/slot_NNN` | `create`, `update` | `read`, `delete`, `list`, `sudo`, and all other slot paths | 256 discrete per-slot policies (Finding B12-03). Grants write capability strictly for designated slot. Denies `read` on secret payloads (`secret/data/*`), preventing credential exfiltration. Vault natively rejects cross-slot writes with HTTP 403. |
| **`slot-rotator-slot_000` through `slot-rotator-slot_255`** | `auth/kubernetes` | Same | `secret/metadata/slots/slot_NNN` | `read` | `delete`, `destroy`, `sudo`, and all other metadata paths | Required for Check-and-Set (CAS) version verification before rotation acknowledgement. Strictly scoped to slot NNN. |
| **`auth_jwt_9f8e7d6c`** | Internal Vault Engine | Mount accessor at `auth/jwt` | `identity/entity-alias` | Internal claim mapping | External caller invocation | Internal mount accessor. Automatically populates Entity Alias Metadata from verified JWT claims. |
| **`slot-admin-reconciler`** | `auth/cert` | Pinned SRE Admin Certificate (`sre-admin`) | `secret/metadata/slots/*` | `read`, `list` | `create`, `update`, `delete`, `sudo` on `secret/data/*`, all secret writes | Offline administrative role for post-incident audit. Inspects version metadata and token lookup/revocation. Zero secret payload read/write capability. |
| **`decision_os_audit_investigator`** | IAM / mTLS (Dedicated SRE Forensic Role) | Offline Forensic Auditor Identity | External WORM Audit Storage (S3 Object Lock / GCS Bucket Lock) | `GetObject`, `storage.objects.get` (Read-only forensic audit events) | ALL Vault secret data, rotation, and mutation paths | Dedicated forensic identity (Finding B12-01). Vault audit logs stream out-of-band to WORM storage; `sys/audit` does not return logs. Forensic investigator has zero Vault secret access. |

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

#### 4. Executable Operation Allocation Matrix for All Revocation Operations (Finding B38-39)
The following matrix establishes the **canonical 5-phase execution order**, assigning exact phases, responsibilities, identities, privileges, acknowledgements, retry behaviors, and fail-closed conditions for every revocation operation:

| Execution Phase | Operation Index & Name | Responsible Service | Required Identity & Protocol | Exact Privilege Scope & Resource | Target Deployment & Namespace | Required Durable Acknowledgement | Retry & Crash Recovery Behavior | Fail-Closed Condition |
|---|---|---|---|---|---|---|---|---|
| **Phase 1: Transport Fencing** | **1. Network Transport Isolation (`NET_FENCED`)** | Network Fence Controller (`apps/network-fence-controller`) | `decision_os_network_fence_controller` via Linux netfilter / CNI | Egress drop policy on container veth / host iptables | Worker Container Network Namespace | Controller queries kernel data plane (`iptables -C`) and returns `{ ok: 1, fenced: true }`; recorded as `phase1_net_fenced_at` in `cleanup_ledger` | Idempotent; re-verified on container restart or coordinator crash | If controller fails to verify drop rule within 15s, fail closed $\rightarrow$ halt teardown; transition to `QUARANTINED`. |
| **Phase 2: Identity Revocation** | **2. Server-Side Identity Deletion (`dropUser`)** | Scoped Provisioning Service (`apps/provisioner`) | `decision_os_db_admin_slot_${k}` via mTLS handoff | `actions: ["dropUser"]` on `{ db: targetTestDb, collection: "" }` | `rs_test:27018` (`targetTestDb.$cmd`) | `{ ok: 1 }` with `w: "majority", j: true` (or `UserNotFound` Code 11); recorded as `phase2_identity_revoked_at` in `cleanup_ledger` | Idempotent; retried on network partition; orphan reaper sweeps if stalled | Executor strictly blocks Phase 3 and Phase 4 until `dropUser` majority ack is verified. If unreachable, lease expires $\rightarrow$ `QUARANTINED`. |
| **Phase 2: Identity Revocation** | **3. Server-Side Role Deletion (`dropRole`)** | Scoped Provisioning Service (`apps/provisioner`) | `decision_os_db_admin_slot_${k}` via mTLS handoff | `actions: ["dropRole"]` on `{ db: targetTestDb, collection: "" }` | `rs_test:27018` (`targetTestDb.$cmd`) | `{ ok: 1 }` with `w: "majority", j: true` (or `RoleNotFound` Code 31) | Idempotent; retried on restart; orphan reaper sweeps if stalled | If unconfirmed, recorded in saga with `compensationPending: true`; background reaper completes. |
| **Phase 2: Identity Revocation** | **3a. Slot Admin Credential Self-Rotation (`updateUser`)** | Scoped Provisioning Service (`apps/provisioner`) | `decision_os_db_admin_slot_${k}` (Self) | `actions: ["changeOwnPassword"]` on `{ db: targetTestDb, collection: "" }` | `rs_test:27018` (`targetTestDb.$cmd`) | `{ ok: 1 }` with `w: "majority", j: true` for `updateUser`; new generation committed | Retried on timeout; if outcome unknown $\rightarrow$ fail closed to `QUARANTINED` | Mandatory Invariant: Previous password permanently invalid on MongoDB server before slot reassignment. Granted `changeOwnPassword`; broader `changePassword` excluded (B38-40). |
| **Phase 2: Identity Revocation** | **3b. Partition Vault Secret Update** | Scoped Provisioning Service via Dedicated Vault Gateway | SPIFFE Workload Identity (`spiffe://decision-os.internal/ns/decision-os-system/sa/decision-os-provisioner`) + signed revocation order | `create/update` on `secret/data/slots/${slot_id}` mediated by Gateway (`decision_os_vault_gateway`) | mTLS REST to Gateway (`POST /v1/vault-gateway/slots/:slot_id/rotate`) $\rightarrow$ Gateway internal Vault client (Port 8200) | HTTP 200 `{ ok: 1, generation: nextGen }` confirmed; recorded in `cleanup_ledger` | Retried with backoff; if unconfirmed $\rightarrow$ slot quarantined. Provisioner never holds a Vault token or direct route to Vault (B38-41). | Slot reassignment strictly refused until Vault and MongoDB both acknowledge rotation. |
| **Phase 3: Op Cancellation** | **4. Prepared Transaction Resolution** | Destructive Cleanup Executor (`apps/cleanup-executor`) | `decision_os_destructive_executor` | `actions: ["inprog"]` on `{ cluster: true }` | `rs_test:27018` (`admin.$cmd`) | `currentOp` returns 0 matching operations with `preparedTransaction: true` | Rescan `currentOp` on restart; coordinate abort with transaction coordinator | If prepared transaction cannot be aborted within 30s, halt teardown; transition to `QUARANTINED`. Never proceed to Phase 4 while prepared transactions remain. |
| **Phase 3: Op Cancellation** | **5. In-Flight Operation Cancellation (`killOp`)** | Destructive Cleanup Executor (`apps/cleanup-executor`) | `decision_os_destructive_executor` | `actions: ["killop"]` on `{ cluster: true }` | `rs_test:27018` (`admin.$cmd`) | `{ ok: 1 }` returned for all active worker `opid`s; active query count reaches 0 | Query active ops; re-issue `killOp` until active count is 0 | If `killOp` fails repeatedly, halt; transition to `QUARANTINED`. Never dispatch Phase 4 wire drop while worker ops are executing. |
| **Phase 3: Op Cancellation** | **6. Logical Session Termination (`killAllSessionsByPattern`)** | Destructive Cleanup Executor (`apps/cleanup-executor`) | `decision_os_destructive_executor` | `actions: ["killAnySession", "impersonate"]` on `{ cluster: true }` | `rs_test:27018` (`admin.$cmd`) | `{ ok: 1 }` returned from `killAllSessionsByPattern`; recorded as `phase3_ops_killed_at` in `cleanup_ledger` | Idempotent command; re-execute on process restart or network timeout | If command fails, retry 3 times with exponential backoff (1s, 2s, 4s); if persistent failure, mark `QUARANTINED`. |
| **Phase 4: Storage Deletion** | **7. Database Storage Deletion (`dropDatabase`)** | Destructive Cleanup Executor (`apps/cleanup-executor`) | `decision_os_destructive_executor` | `actions: ["dropDatabase"]` on `{ db: "", collection: "" }` | `rs_test:27018` (`targetTestDb.$cmd`) | `{ ok: 1 }` with majority replication proof $(t, ts)$ and oplog correlation token; recorded as `phase4_storage_dropped_at` in `cleanup_ledger` | Idempotent; if wire drop response lost, verify via oplog correlation scanner; never redispatch | **Prerequisite Gate:** Strictly blocked unless Phases 1, 2, and 3 are durably verified in `cleanup_ledger`. If ambiguous drop outcome, locks held indefinitely in `QUARANTINED`. |
| **Phase 5: Audit Finalization** | **8. Tamper-Evident Audit Record & Checkpoint** | Audit Service (`apps/audit-service`) | `decision_os_audit_writer` | `actions: ["find", "insert", "createIndex"]` on `cleanup_audit_log` | `rs_coord:27019` (`decision_os_coordination`) | SHA-256 hash-chain appended to `cleanup_audit_log`; signed checkpoint emitted to external WORM; recorded as `phase5_audit_finalized_at` | Idempotent append-only record; retried on restart until acknowledged | Audit log failure alerts SRE; triggers fail-closed executor freeze. |
| **Engine Invariant** | **9. Lingering TCP Socket Invalidation** | MongoDB Daemon Engine Subsystem | N/A (Server-side daemon cache invalidation) | N/A (Internal engine cache lookup) | `rs_test:27018` (Server connection pool) | Commands over lingering sockets fail with Code 11 (`UserNotFound`) or Code 13 (`Unauthorized`) | Engine re-evaluates user credentials on next wire packet after `dropUser` | Daemon halts command processing immediately upon missing user verifier; zero reads or writes permitted. |
| **Engine Invariant** | **10. Fresh Authentication Rejection** | MongoDB Daemon Authentication Subsystem | N/A (SCRAM-SHA-256 verifier lookup) | N/A (Internal `system.users` catalog lookup) | `rs_test:27018` (`targetTestDb`) | SCRAM-SHA-256 handshake fails with Code 11 (`UserNotFound`) or Code 18 (`AuthenticationFailed`) | Attempt rejected natively by MongoDB wire protocol | Wire connection cannot establish authenticated session. |

#### 4a. Formal Distinction of the Six Isolation Layers (Finding B38-35)
To eliminate conceptual conflation and establish defense-in-depth, Decision OS distinguishes six distinct layers of worker isolation:

1. **Logical Session Invalidation:** Performed via `killAllSessionsByPattern`. Deletes session documents from `config.system.sessions`, terminating logical transaction context. Does NOT close TCP sockets.
2. **Server-Side User Deletion:** Performed via `dropUser` with `w: "majority", j: true`. Deletes user credentials from `system.users`, invalidating the MongoDB daemon's in-memory authorization cache. Causes subsequent wire commands on open sockets to fail with Error Code 11/13.
3. **Operation Cancellation:** Performed via `killOp` (action `killop` on `{ cluster: true }`). Interrupts currently running wire queries and storage operations in the execution pipeline.
4. **Physical TCP Socket Retention:** Physical TCP connection state maintained by the client OS kernel and MongoDB daemon connection pool. Sockets remain open until closed by client, severed by network fencing, or terminated by process exit.
5. **Network Transport Isolation:** Programmed by the Network Fence Controller at the Linux netfilter / iptables or CNI eBPF layer. Drops IP packets at layer 3/4 before they reach MongoDB port 27018 or 27019.
6. **Database Deletion:** Performed via `dropDatabase` by the Destructive Cleanup Executor. Removes database files and catalog entries from the WiredTiger storage engine.
- **Architectural Tenet:** **`dropDatabase` is NEVER represented as network transport fencing.** Dropping a database is a storage engine DDL mutation that deletes disk catalog structures; it possesses zero transport-layer fencing capability and does not sever network connections.

#### 5. Canonical 5-Phase Ordered Revocation Protocol Between Executor, Network Controller, and Provisioner (Finding B38-39)
To guarantee strict execution ordering, eliminate concurrency races, and ensure database deletion cannot proceed before transport and identity revocation are durably acknowledged:

1. **Initial Claim & Phase 1 (Network Transport Fencing - `NET_FENCED`):**
   - The Cleanup Executor receives `POST /v1/cleanup/request`, validates caller Ed25519 signature and ownership lease, and records state `CLAIMED` in `cleanup_ledger` with `w: "majority"`.
   - The Executor issues a signed mutual TLS request `POST /v1/orchestrator/fence-worker` to the Network Fence Controller:
     ```json
     {
       "fenceId": "fence_550e8400_e29b",
       "requestId": "550e8400-e29b-41d4-a716-446655440000",
       "runId": "runA",
       "workerId": "wA",
       "workerPodLabel": "decision-os-worker-runA-wA",
       "targetDatabases": ["decision_os_test_slot_01"],
       "action": "ISOLATE_WORKER_EGRESS",
       "requestedAt": "2026-11-10T02:09:59.000Z"
     }
     ```
   - The Network Fence Controller validates the signature, applies netfilter/iptables rules dropping all egress from the worker container to ports 27018 and 27019, verifies the rule in the kernel data plane (`iptables -C`), and returns HTTP 200 `{ ok: 1, fenced: true, netfilterVerified: true }`.
   - The Executor writes `{ phase1_net_fenced_at: new Date() }` to `cleanup_ledger` with `w: "majority"`.
   - *Failure & Retry:* If the controller is unreachable, the Executor retries 3 times with exponential backoff (1s, 2s, 4s). If fencing cannot be verified within 15s, teardown **fails closed**: the Executor transitions the request to `QUARANTINED`, preserving `dropExecutionLock: true`.
2. **Phase 2 (Identity Revocation — `IDENTITY_REVOKED`):**
   - The Cleanup Executor issues a signed mutual TLS request `POST /v1/provisioning/revoke-worker` to the Provisioning Service:
     ```json
     {
       "revocationId": "rev_550e8400_e29b",
       "requestId": "550e8400-e29b-41d4-a716-446655440000",
       "targetDatabase": "decision_os_test_slot_01",
       "workerUsername": "decision_os_worker_runA_wA",
       "requestedAt": "2026-11-10T02:10:00.000Z"
     }
     ```
   - The Provisioning Service verifies the signature, binds to `decision_os_db_admin_slot_01`, dispatches `dropUser` and `dropRole` with `{ writeConcern: { w: "majority", j: true } }`.
   - **Slot Admin Self-Rotation (Finding B38-40):** Provisioner executes `updateUser("decision_os_db_admin_slot_" + k, { pwd: P_{new} })` on `rs_test:27018` under write concern `{ w: "majority", j: true }`. In MongoDB RBAC, self-rotation of one's own password strictly requires **`changeOwnPassword`** on `{ db: targetTestDb, collection: "" }`. Broader `changePassword` is prohibited.
   - Provisioner calls Dedicated Vault Gateway endpoint `POST /v1/vault-gateway/slots/${slot_id}/rotate` over mTLS presenting the signed revocation order; Gateway validates authorization and updates Vault KV-v2 at `secret/data/slots/${slot_id}` with the new password.
   - Provisioner marks `ownership_locks.state = 'REVOKED'`, `credential_generation = nextGen` on `rs_coord:27019`, and responds with HTTP 200 `{ ok: 1, userDropped: true, roleDropped: true, slotRotated: true }`.
   - The Executor writes `{ phase2_identity_revoked_at: new Date(), credential_generation: nextGen }` to `cleanup_ledger` with `w: "majority"`.
   - *Failure & Retry:* If Provisioner or MongoDB is unreachable, or if password rotation times out with an unknown outcome, the teardown **fails closed** and the slot transitions to `QUARANTINED`. The previous password is treated as potentially unrotated; slot reassignment is strictly blocked until confirmed. **The Executor NEVER attempts to execute `dropUser` itself.**

3. **Phase 3 (In-Flight Operation & Session Cancellation - `OPS_KILLED`):**
   - The Cleanup Executor connects as `decision_os_destructive_executor` to `rs_test:27018`.
   - It inspects `currentOp` for prepared transactions (`actions: ["inprog"]` on `{ cluster: true }`); if found, coordinates abort before proceeding.
   - It issues `killOp` (`actions: ["killop"]` on `{ cluster: true }`, executed on `admin.$cmd`) against active worker ops.
   - It executes `killAllSessionsByPattern` (`actions: ["killAnySession", "impersonate"]` on `{ cluster: true }`).
   - The Executor writes `{ phase3_ops_killed_at: new Date() }` to `cleanup_ledger` with `w: "majority"`.
4. **Phase 4 (Database Storage Deletion - `STORAGE_DROPPED`):**
   - **MANDATORY PREREQUISITE GATE:** Before dispatching `dropDatabase`, the Executor executes an atomic precondition check on `cleanup_ledger`:
     ```javascript
     const record = await cleanupLedger.findOne({ requestId });
     if (!record.phase1_net_fenced_at || !record.phase2_identity_revoked_at || !record.phase3_ops_killed_at) {
       await cleanupLedger.updateOne(
         { requestId },
         { $set: { state: "QUARANTINED", reason: "MISSING_REVOCATION_PREREQUISITES", quarantinedAt: new Date() } }
       );
       throw new SecurityException("Cannot drop database: Prior revocation phases not durably verified!");
     }
     ```
   - Only after verifying all three prerequisite phases does the Executor transition `cleanup_ledger` to `DISPATCHING` (`dropExecutionLock = true`, `w: "majority"`).
   - The Executor dispatches `db.runCommand({ dropDatabase: 1, comment: JSON.stringify({ requestId, slot: "slot_01", runA, wA }) })` on `rs_test:27018`.
   - Upon receiving majority drop proof, the Executor writes `{ state: "CLEANED", dropExecutionLock: false, phase4_storage_dropped_at: new Date() }` to `cleanup_ledger`.
5. **Phase 5 (Audit Finalization - `AUDIT_FINALIZED`):**
   - The Audit Service appends a tamper-evident SHA-256 hash-chained record (`DB_CLEANED`) to `cleanup_audit_log` on `rs_coord:27019`.
   - Signed milestone checkpoint is emitted to external WORM storage.
   - The Executor writes `{ phase5_audit_finalized_at: new Date() }` to `cleanup_ledger` and returns HTTP 200 `{ status: "CLEANED" }`.

#### 6. Idempotent Crash Recovery Protocol for All 5 Phases (Finding B38-39)
If the Cleanup Executor or Network Controller crashes at any point during teardown, the system guarantees deterministic, idempotent recovery without skipping or reordering phases:
- **Crash after Phase 1, before Phase 2:** On restart, recovery coordinator reads `phase1_net_fenced_at != null` and `phase2_identity_revoked_at == null`. It re-verifies netfilter status, then idempotently resumes at Phase 2 (`revoke-worker`).
- **Crash after Phase 2, before Phase 3:** Reads `phase2_identity_revoked_at != null` and `phase3_ops_killed_at == null`. It directly executes Phase 3 (`killOp` and session invalidation).
- **Crash after Phase 3, before Phase 4:** Reads `phase3_ops_killed_at != null` and `state === 'CLAIMED'`. All prerequisites are satisfied; it transitions to `DISPATCHING` and dispatches Phase 4 (`dropDatabase`).
- **Crash during Phase 4 wire drop:** If the executor crashes while `{ dropDatabase: 1 }` is in-flight, on restart it detects `state === 'DISPATCHING'`. Per fail-closed policy, it transitions to `OUTCOME_UNKNOWN` / `QUARANTINED`. It invokes the Oplog Correlation Scanner to verify whether the drop committed. It **NEVER re-dispatches the drop command**.
- **Crash after Phase 4, before Phase 5:** Reads `phase4_storage_dropped_at != null` and `phase5_audit_finalized_at == null`. It retries the append-only audit event submission to finalize the ledger.

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

#### 3. Durable Globally Coordinated Block Allocation Protocol with Decoupled Authority (NIST SP 800-38D Section 8.2.1, Finding B38-32, B38-38)
To achieve mathematical certainty of nonce uniqueness across multiple replicas, crashes, and restarts, Decision OS replaces volatile random salts with a **Durable Globally Coordinated Counter Range Block Reservation Protocol** adhering to NIST SP 800-38D Section 8.2.1 Deterministic Construction, hardened through dedicated service authority decoupling and formal root-of-trust recognition:

##### 1. Nonce Allocation Authority Separation & Compromise Classification (Finding B38-32, B38-38)
Decision OS distinguishes three distinct compromise classes regarding counter state custody:

1. **Class 1 — Central Provisioner Compromise (`decision_os_provisioner`):**
   - *Status: PREVENTED NATIVELY.*
   - *Mechanism:* The central provisioner identity has **ZERO write or update access** to `decision_os_coordination.nonce_allocations` on `rs_coord:27019`. It cannot execute `update`, `insert`, or `remove`. Even if the central provisioner process is completely compromised or arbitrary remote code execution is achieved, the attacker cannot execute `$set: { nextBlockStart: 0 }` to regress counter state. The provisioner can only lease blocks by presenting an mTLS request to the allocator.
2. **Class 2 — Nonce Allocator Compromise (`decision_os_nonce_allocator`):**
   - *Status: CRYPTOGRAPHIC ROOT OF TRUST (Detected & Recoverable; NOT Prevented at MongoDB RBAC Layer).*
   - *Engine Limitation:* In MongoDB 8.0 RBAC, authorization is granted at the collection action level: `actions: ["update"]` on `nonce_allocations`. MongoDB's authorization engine **cannot restrict the update operator**—it possesses no mechanism to permit `$inc` while forbidding `$set`. Furthermore, MongoDB document schema validation (`$jsonSchema`) validates document structure upon write, but cannot enforce inter-update temporal monotonicity (i.e. verifying that $x_{\text{new}} > x_{\text{old}}$ across time).
   - *Compromise Reality:* An adversary who compromises the Nonce Allocation Service memory or extracts its MongoDB connection credentials CAN directly execute `updateOne({ _id: "nonce_seq_v1" }, { $set: { nextBlockStart: 0 } })`. Therefore, the Nonce Allocation Service is explicitly identified as an **Independent Cryptographic Root of Trust**. Its security cannot be asserted merely through database RBAC.
3. **Class 3 — Coordination Replica Set Compromise (`rs_coord:27019`):**
   - *Status: STORAGE ROOT OF TRUST (Detected & Recoverable).*
   - *Mechanism:* Direct compromise of the coordination replica set storage engine or cluster administrator allows arbitrary modification of sequence documents.

##### 2. Cryptographic Incident Response & Data-Trust State Machine for Nonce Reuse (Finding B38-38, B38-42)
Because MongoDB RBAC cannot prevent an authorized allocator identity from executing `$set`, and because AES-256-GCM nonce reuse results in irreversible mathematical compromise, Decision OS formalizes an explicit **Cryptographic Incident Response & Data-Trust State Machine**.

###### A. The Cryptographic Reality of AES-GCM Nonce Reuse
AES-GCM utilizes Counter (CTR) mode for confidentiality and Galois Hash (GHASH) for message authentication. Repeating a nonce under the same key $K$ creates two fatal vulnerabilities:
1. **Confidentiality Loss:** For two ciphertexts $C_1, C_2$ generated with identical $(K, \text{IV})$, the counter stream $S$ cancels out:
   $$C_1 \oplus C_2 = (P_1 \oplus S) \oplus (P_2 \oplus S) = P_1 \oplus P_2$$
   If any portion of one plaintext is known or follows a predictable schema, the other plaintext is trivially revealed.
2. **Authentication Compromise (Forged Authenticity):** The GHASH authentication key $H = \text{AES}_K(0^{128})$ can be algebraically solved from two collision authentication tags:
   $$T_1 \oplus T_2 = g_H(A_1, C_1) \oplus g_H(A_2, C_2)$$
   Once $H$ is computed by an adversary, the adversary can construct forged ciphertexts and valid authentication tags for *arbitrary messages* under key $K$, without ever learning key $K$.
3. **Irreversibility Constraints (Mandatory Architectural Tenets):**
   - **Key rotation DOES NOT repair historical confidentiality loss.** Rotating keys prevents future reuse, but plaintexts exposed via $P_1 \oplus P_2$ remain exposed forever.
   - **Re-encryption DOES NOT repair historical authentication compromise.** If $H$ was exposed, tampered ciphertexts possess valid authentication tags. Re-encrypting them merely blesses tampered data under a new key.
   - **A successful AES-GCM decryption does NOT prove the ciphertext was untampered.** Forged tags pass tag verification natively.
   - **A watchdog CANNOT reverse a cryptographic compromise.** It detects and halts, but cannot retroactively erase compromised network packets.
   - **Sequence reseeding ALONE does not restore trust in existing ciphertexts.**

###### B. Explicit 5-Phase Cryptographic Incident Response State Machine
When suspected nonce reuse, allocator regression, or backup rollbacks are detected:

```mermaid
stateDiagram-v2
    [*] --> NORMAL_OPERATION: Monotonic Block Allocations
    NORMAL_OPERATION --> INCIDENT_CONTAINED: Detected / Suspected Nonce Reuse (Kill-Switch)
    INCIDENT_CONTAINED --> POPULATION_QUARANTINED: Quarantine Affected Envelopes & Key Version
    POPULATION_QUARANTINED --> KEY_EPOCH_TRANSITIONED: Retire DEK, Advance KeyVersionPrefix (0x0002)
    KEY_EPOCH_TRANSITIONED --> TRUST_ASSESSMENT: Analyze Plausible Confidentiality / Integrity Exposure
    TRUST_ASSESSMENT --> INTEGRITY_VALIDATED: Validate Plaintext Against Canonical WORM Evidence
    TRUST_ASSESSMENT --> REJECTED_DISCARDED: Integrity Cannot Be Established (Discard / Restore from Cold Backup)
    INTEGRITY_VALIDATED --> RE_ENCRYPTION_AUTHORIZED: SRE & Security Officer Dual-Signoff
    RE_ENCRYPTION_AUTHORIZED --> SERVICE_RESTORED: Re-encrypt Validated Data under New Key Epoch
    SERVICE_RESTORED --> NORMAL_OPERATION: Reseed Sequence nonce_seq_v2
```

1. **Phase 1: Detection and Containment:**
   - **Trigger:** Monotonicity Watchdog detects `blockStart <= maxHistoricalBlockStart`, duplicate block emission, or replica sequence regression.
   - **Emergency Kill-Switch:** Watchdog atomically asserts `rs_coord.emergency_halt = true`.
   - **Synchronous Halt:** All worker and provisioner pods receive mTLS kill signals and synchronously abort all encryption operations. Unconsumed local counter blocks are immediately purged from memory.
   - **Population Identification & Quarantine:**
     - Identify affected `KeyVersionPrefix`, epoch identifier, sequence range, and timestamp window $[t_{\text{compromise}}, t_{\text{containment}}]$.
     - Atomically update all envelopes encrypted in this window in `ownership_locks` to `state = 'QUARANTINED'`, `quarantineReason = 'CRYPTOGRAPHIC_INCIDENT_NONCE_REUSE'`.
     - **Authoritative Workflow Rejection:** All authoritative operational workflows (deliberation, decision execution, database teardown) strictly reject quarantined material (`QuarantinedCiphertextException`). Quarantined envelopes cannot be decrypted or acted upon.
2. **Phase 2: Trust Assessment:**
   - Evaluate whether nonce reuse actually occurred or was merely suspected (e.g. crash during sequence read).
   - Determine the exact population of ciphertexts exposed to identical nonces.
   - Assess plausible adversary capabilities: evaluate whether the adversary observed wire traffic sufficient to recover GHASH key $H$.
   - Categorize incident into **Class A (Confirmed Nonce Collision with Wire Exposure)** or **Class B (Defensive Latch Trip / Sequence Gap Without Collision)**.
3. **Phase 3: Key and Epoch Transition:**
   - KMS permanently marks compromised key material (KEK / DEK) as `REVOKED / COMPROMISED`. Under no circumstances can this key ever be used for encryption again.
   - KMS advances key epoch and increments `KeyVersionPrefix` (e.g. `0x0001` $\rightarrow$ `0x0002`).
   - Sequence document on `rs_coord:27019` is retired and re-seeded under new identifier: `_id: "nonce_seq_v2"` with `nextBlockStart: NumberLong(0)`.
   - **Domain Separation Invariant:** Because 96-bit nonces embed `KeyVersionPrefix` as their high 16 bits, nonces under `v2` are provably disjoint from all nonces issued under `v1`.
4. **Phase 4: Integrity Validation and Plaintext Recovery via Canonical WORM Evidence:**
   - Candidate plaintexts are decrypted under the retired DEK in a sandboxed, network-isolated enclave.
   - Decryption success is explicitly NOT treated as proof of integrity.
   - Plaintext authenticity must be validated against independently signed, pre-incident **Canonical WORM Plaintext Evidence Records** (specified in Section 7.10.2.C).
   - If candidate plaintext matches pre-incident WORM digest, integrity is accepted.
   - If WORM evidence is missing, corrupted, post-incident, or mismatched, candidate data is **permanently rejected** and must be restored from an external cold backup or discarded.
5. **Phase 5: Audit and Dual-Party Authorization:**
   - Cryptographic re-encryption under epoch `v2` is strictly gated on dual-party cryptographic sign-off:
     - Signed approval from **SRE Lead** (verifying system stability and clean epoch transition).
     - Signed approval from **Security Officer** (verifying WORM evidence integrity and blast-radius containment).
   - Once dual signatures are committed to `cleanup_audit_log`, validated records are re-encrypted under epoch `v2` and returned to service.

###### C. Canonical WORM Plaintext Evidence Record & Multi-Stage Validation Protocol (Findings B38-42, B11-06 through B11-12, B12-05 through B12-08)
To provide genuine mathematical proof of plaintext authenticity independent of the nonce allocator and encryption keys, Decision OS defines the authoritative **Canonical WORM Plaintext Evidence Record Schema v2.3.0** comprising exactly **26 versioned data fields** (+ `$schema` URI metadata):

```json
{
  "$schema": "https://specs.decision-os.internal/schemas/v2/worm-evidence.json",
  "evidenceRecordId": "worm-ev-9a8b7c6d-5e4f-3a2b-1c0d-e9f8a7b6c5d4",
  "evidenceSchemaVersion": "2.3.0",
  "canonicalizationSpec": "RFC_8785_JCS",
  "digestAlgorithm": "SHA-256",
  "decisionPayloadSha256": "90ca3b570b7e806657a928518b70ee710b342ea6e315187e7a1dcc4b409cab4e",
  "decisionId": "dec-2026-11-10-001",
  "slotId": "slot_01",
  "fencingGeneration": 1,
  "workerIdentity": "decision_os_worker_runA_wA",
  "leaseId": "lease_10928",
  "kmsKeyVersion": "0x0001",
  "nonceValue": "000100000000000000000001",
  "plaintextByteLength": 117,
  "evidenceCreatedAtISO": "2026-11-10T10:00:00.000Z",
  "evidenceCreatedAtEpochMs": 1794304800000,
  "signingAlgorithm": "Ed25519",
  "signingKeyId": "key-audit-hsm-2026-q4-ed25519-primary",
  "primaryEvidenceSignature": "6Z05FuydRFaAbCr_LJ6eNARewrBHEd0MDjfMkP9iMp0FME3sMRmzGtfIgcejHTcq1YMMMeDtOR9KQOGBSv6fBg",
  "tsaTimestampToken": "MIICYAYJKoZIhvcNAQcCoIICUTCCAk0CAQMxDzANBglghkgBZQMEAgEFADCBpQYLKoZIhvcNAQkQAQSggZUEgZIwgY8CAQEGCisGAQQBho0fAQEwMTANBglghkgBZQMEAgEFAAQg+vHVuwyeLF3DF2uFRpeyDtGiYAm7zzFeyJeNSoLliSUCBwCEIQCRgjcYDzIwMjYxMTEwMTAwMDAwWgEBAAIEB1vNFaAohidyZmMzMTYxLmF1dGhvcml0eS5kZWNpc2lvbi1vcy5pbnRlcm5hbKCCARgwggEUMIHHoAMCAQICBwCEIQCRgjcwBQYDK2VwMCcxJTAjBgNVBAMMHERlY2lzaW9uIE9TIFN5bnRoZXRpYyBUU0EgQ0EwIhgPMjAyNjAxMDEwMDAwMDBaGA8yMDM2MDEwMTAwMDAwMFowKzEpMCcGA1UEAwwgRGVjaXNpb24gT1MgU3ludGhldGljIFRTQSBTaWduZXIwNjAFBgMrZXADLQAwKjAFBgMrZXADIQBuehzdKbC3j9E69MVZj+/07yqXFm48pvLk+/zNgFBb8TAFBgMrZXADQQBaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaMXMwcQIBA4AUN3SEW5FHtQzwB3HKIOspzDBDwHgwDQYJYIZIAWUDBAIBBQAwBQYDK2VwBECNB7b2pi6TEEB4N2KV7KFmvKeesGOuu66oMpsxFUvyOYZxzZI9sYZPEjwZ7Pr7VwUaybygRmBr+UuZM3WRsdEG",
  "merkleTreeCheckpointHeight": 8421,
  "merkleCheckpointId": "chk-2026-11-10-8421",
  "merkleCheckpointRoot": "e3f6f3504f211d64c383acb50260e7b6f6cccba7522f0fdf98b83cd8145d5248",
  "merkleCheckpointSignature": "SrpXBpZX3M25P0X568rN3vkACzcPlwb9yyhZFly0o_w1YkOU34_H4VialuvkLAl1JrmFamLXxVqPoye-_F5FBw",
  "merkleInclusionProof": [
    "26da34a36e901ab8c0fbb0aa9b6c50c84a4f58078e53aef1ae26fbe9af5df71d",
    "252cedbf1eb889c3fb063db759cdc419317dd36a6ee9c1d32444b985acbbe6dc"
  ],
  "complianceOfficerSignature": "w9F9aINGjQ5fmbZfzy6uT49I_TyTWK8jW5OgW1mhvTSqvjyTRR_Xcdq8NaGXdynEA5HiFJIRPCFaLxyWc-BGAQ",
  "sreLeadSignature": "e4yKJgXL5q7M-3bjhceDmAbi4Z8hC4Y8ll42R-b3f5x04AA6GAdqQ0ngewxYAp86tfsO7BvFiiUqPB77mDGECA"
}
```

**Candidate Decision Payload, Correct SHA-256 Digest & Exact Byte Length (Findings B11-06, B11-07):**
The candidate decision payload JSON is:
```json
{
  "action": "EXECUTE_TRANSACTION",
  "amount": 10000,
  "currency": "USD",
  "decisionId": "dec-2026-11-10-001",
  "slotId": "slot_01"
}
```
Under RFC 8785 JSON Canonicalization Scheme (JCS), keys are sorted lexicographically with zero extraneous whitespace:
`{"action":"EXECUTE_TRANSACTION","amount":10000,"currency":"USD","decisionId":"dec-2026-11-10-001","slotId":"slot_01"}`
- **Exact Plaintext Byte Length:** Exactly **117 bytes** (`Buffer.from(canonicalJson, "utf8").length === 117`). The previous specification of 115 bytes is permanently corrected.
- **Independently Calculated SHA-256 Digest:** Exactly:
  `90ca3b570b7e806657a928518b70ee710b342ea6e315187e7a1dcc4b409cab4e`
  *(The old erroneous value `3ebb50525651733616afcdfcca0bc572e973ca4c86e96bda3b3d923f0f348307` was mathematically incorrect and is eliminated from production schemas).*
- **Reproducible Verification Command:**
  ```bash
  node -e 'const c = "{\"action\":\"EXECUTE_TRANSACTION\",\"amount\":10000,\"currency\":\"USD\",\"decisionId\":\"dec-2026-11-10-001\",\"slotId\":\"slot_01\"}"; console.log("Bytes:", Buffer.from(c, "utf8").length); console.log("SHA-256:", require("crypto").createHash("sha256").update(Buffer.from(c, "utf8")).digest("hex"));'
  # Output:
  # Bytes: 117
  # SHA-256: 90ca3b570b7e806657a928518b70ee710b342ea6e315187e7a1dcc4b409cab4e
  ```

---

#### Authoritative 26-Field Evidence Inventory Table (Findings B11-08, B12-08)

The table below formally defines every field of the evidence record, its data type, validation constraints, and its exact cryptographic scope across all commitment layers:

| Field # | Field Name | Data Type | Validation Constraints | Layer 1: Primary HSM Sig? | Layer 2: TSA Imprint? | Layer 3: Merkle Leaf? | Cryptographic Role & Witness Status (Finding B12-08) |
|---|---|---|---|---|---|---|---|
| 1 | `evidenceRecordId` | String (UUID v4) | Regex `^worm-ev-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$` | **YES** | **YES** (via Core) | **YES** (via Core) | Core Field (Immutable) |
| 2 | `evidenceSchemaVersion` | String | Must equal `"2.3.0"` | **YES** | **YES** (via Core) | **YES** (via Core) | Core Field (Immutable) |
| 3 | `canonicalizationSpec` | String | Must equal `"RFC_8785_JCS"` | **YES** | **YES** (via Core) | **YES** (via Core) | Core Field (Immutable) |
| 4 | `digestAlgorithm` | String | Must equal `"SHA-256"` | **YES** | **YES** (via Core) | **YES** (via Core) | Core Field (Immutable) |
| 5 | `decisionPayloadSha256` | String (Hex, 64 chars) | Regex `^[0-9a-f]{64}$`; byte-for-byte SHA-256 match | **YES** | **YES** (via Core) | **YES** (via Core) | Core Field (Immutable) |
| 6 | `decisionId` | String | Discrete decision transaction ID (`^dec-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{3,}$`) | **YES** | **YES** (via Core) | **YES** (via Core) | Core Field (Immutable) |
| 7 | `slotId` | String | Partition slot DB (`^slot_([0-1][0-9]{2}\|2[0-4][0-9]\|25[0-5])$`) | **YES** | **YES** (via Core) | **YES** (via Core) | Core Field (Immutable) |
| 8 | `fencingGeneration` | Integer | Positive integer $\ge 1$ | **YES** | **YES** (via Core) | **YES** (via Core) | Core Field (Immutable) |
| 9 | `workerIdentity` | String | Worker principal (`^decision_os_worker_`) | **YES** | **YES** (via Core) | **YES** (via Core) | Core Field (Immutable) |
| 10 | `leaseId` | String | Active lease ID (`^lease_[0-9]+$`) | **YES** | **YES** (via Core) | **YES** (via Core) | Core Field (Immutable) |
| 11 | `kmsKeyVersion` | String (Hex, 6 chars) | Prefix `0x` + 4 hex chars (`^0x[0-9a-f]{4}$`) | **YES** | **YES** (via Core) | **YES** (via Core) | Core Field (Immutable) |
| 12 | `nonceValue` | String (Hex, 24 chars) | Exact 96-bit hexadecimal IV (`^[0-9a-f]{24}$`) | **YES** | **YES** (via Core) | **YES** (via Core) | Core Field (Immutable) |
| 13 | `plaintextByteLength` | Integer | Positive integer matching plaintext UTF-8 bytes (117) | **YES** | **YES** (via Core) | **YES** (via Core) | Core Field (Immutable) |
| 14 | `evidenceCreatedAtISO` | String (ISO 8601 UTC) | Must end in `Z` (`YYYY-MM-DDTHH:mm:ss.sssZ`) | **YES** | **YES** (via Core) | **YES** (via Core) | Core Field (Immutable) |
| 15 | `evidenceCreatedAtEpochMs` | Integer | Must equal `Date.parse(evidenceCreatedAtISO)` (1794304800000) | **YES** | **YES** (via Core) | **YES** (via Core) | Core Field (Immutable) |
| 16 | `signingAlgorithm` | String | Must equal `"Ed25519"` | **YES** | **YES** (via Core) | **YES** (via Core) | Core Field (Immutable) |
| 17 | `signingKeyId` | String | Pinned compliance HSM key identifier | **YES** | **YES** (via Core) | **YES** (via Core) | Core Field (Immutable) |
| 18 | `primaryEvidenceSignature` | String (Base64URL) | Ed25519 signature over Evidence Core (Fields 1–17) | **NO** (Signature itself) | **YES** (Explicit Payload) | **YES** (Explicit Digest) | Primary Digital Signature (Immutable) |
| 19 | `tsaTimestampToken` | String (Base64) | Genuine RFC 3161 DER Timestamp Token (612 bytes CMS SignedData) | **NO** | **NO** (Token itself) | **YES** (Explicit Digest) | RFC 3161 Timestamp (Immutable) |
| 20 | `merkleTreeCheckpointHeight` | Integer | Sequence height in Merkle audit tree (8421) | **NO** | **NO** | **NO** (External Witness) | External Tree Coordinate |
| 21 | `merkleCheckpointId` | String | Checkpoint identifier (`^chk-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]+$`) | **NO** | **NO** | **NO** (External Witness) | External Tree Coordinate |
| 22 | `merkleCheckpointRoot` | String (Hex, 64 chars) | Reconciled root `e3f6f3504f211d64c383acb50260e7b6f6cccba7522f0fdf98b83cd8145d5248` | **NO** | **NO** | **NO** (External Witness) | Authoritative Root Anchor |
| 23 | `merkleCheckpointSignature` | String (Base64URL) | Notary Ed25519 signature over checkpoint | **NO** | **NO** | **NO** (External Witness) | External Transparency Witness |
| 24 | `merkleInclusionProof` | Array of Hex Strings | Sibling hashes proving Leaf 0 inclusion in checkpoint root | **NO** | **NO** | **NO** (External Witness) | External Inclusion Proof Witness |
| 25 | `complianceOfficerSignature` | String (Base64URL) | Ed25519 signature authorizing unquarantine | **NO** | **NO** | **NO** (Post-Incident) | Post-Incident Authorization Extension |
| 26 | `sreLeadSignature` | String (Base64URL) | Ed25519 signature authorizing unquarantine | **NO** | **NO** | **NO** (Post-Incident) | Post-Incident Authorization Extension |

---

#### Multi-Stage Non-Circular Merkle Construction & Timestamping Protocol (Findings B11-09, B11-10, B12-05, B12-08)

Previous formulations suffered from circular dependency risks where Merkle tree inclusion proofs or signatures were described as being included in the payload that generated them. Decision OS resolves this via an exact **multi-stage unidirectional commitment pipeline**:

```mermaid
flowchart TD
    subgraph Stage1 ["Stage 1: Evidence Core Construction"]
        C["Fields 1-17: Core Metadata & Payload Digest"]
        JCS_C["RFC 8785 JCS Canonicalization"]
        DIG_C["CoreDigest = SHA-256('DECISION_OS_WORM_EVIDENCE_V2:' || JCS(Core))"]
        C --> JCS_C --> DIG_C
    end

    subgraph Stage2 ["Stage 2: Compliance HSM Signing"]
        DIG_C --> SIGN_CORE["Sign: 'DECISION_OS_WORM_SIGNATURE_V2:' || CoreDigest"]
        SIGN_CORE --> SIG_CORE["Field 18: primaryEvidenceSignature"]
    end

    subgraph Stage3 ["Stage 3: RFC 3161 TSA Timestamping (Finding B12-05)"]
        DIG_C & SIG_CORE --> TSA_PAYLOAD["TsaCommitmentBytes = 'DECISION_OS_TSA_COMMITMENT_V1:' || CoreDigest || UTF8(primaryEvidenceSignature)"]
        TSA_PAYLOAD --> TSA_HASH["MessageImprint = SHA-256(TsaCommitmentBytes)"]
        TSA_HASH --> TSA_REQ["TSA Issues ASN.1 DER CMS ContentInfo TimeStampToken (612 bytes)"]
        TSA_REQ --> FIELD_TSA["Field 19: tsaTimestampToken"]
    end

    subgraph Stage4 ["Stage 4: RFC 6962 Domain-Separated Leaf Hash"]
        DIG_C & SIG_CORE & FIELD_TSA --> LEAF_DIGESTS["Compute SHA-256(primaryEvidenceSignature) & SHA-256(DER(tsaTimestampToken))"]
        LEAF_DIGESTS --> LEAF_HASH["Leaf 0 = SHA-256(0x00 || CoreDigest || SHA256(Sig) || SHA256(TSA))"]
    end

    subgraph Stage5 ["Stage 5: Merkle Tree Checkpoint & Inclusion Proof (External Witnesses)"]
        LEAF_HASH --> TREE["Append to Merkle Tree at Height 8421"]
        TREE --> ROOT["Authoritative Merkle Root: e3f6f3504f211d64..."]
        ROOT --> CHK["Fields 20-22: Height 8421, Checkpoint chk-2026-11-10-8421, Root"]
        TREE --> PROOF["Field 24: merkleInclusionProof (2 Sibling Hashes)"]
        CHK --> NOTARY["Sign Checkpoint: 'DECISION_OS_MERKLE_CHECKPOINT_V1:' || chkPayload"]
        NOTARY --> NOTARY_SIG["Field 23: merkleCheckpointSignature"]
    end

    subgraph Stage6 ["Stage 6: Incident Recovery Unquarantine Order (Post-Incident Extension)"]
        ROOT & C --> ORDER["Canonical Unquarantine Order binding evidenceRecordId, decisionPayloadSha256, slotId, merkleCheckpointRoot"]
        ORDER --> COMPLIANCE_SIG["Field 25: complianceOfficerSignature"]
        ORDER --> SRE_SIG["Field 26: sreLeadSignature"]
    end
```

---

#### Formal Specification of the Four Digital Signatures (Finding B11-11)

1. **Primary Compliance HSM Signature (`primaryEvidenceSignature`):**
   - *Signer Identity:* Hardware Security Module (HSM) holding Compliance Master Key (`key-audit-hsm-2026-q4-ed25519-primary`).
   - *Domain Prefix:* `"DECISION_OS_WORM_SIGNATURE_V2:"`.
   - *Payload Formulation:* Signed directly over the 32-byte CoreDigest:
     $$\text{SignPayload} = \text{UTF8}(\text{"DECISION_OS_WORM_SIGNATURE_V2:"}) \parallel \text{CoreDigest}$$
   - *Verification:* `ed25519.verify(primaryEvidenceSignature, SignPayload, hsmPublicKey) === true`.

2. **Merkle Checkpoint Notary Signature (`merkleCheckpointSignature`):**
   - *Signer Identity:* Dedicated Merkle Tree Checkpoint Transparency Notary (`key-notary-2026-ed25519-primary`).
   - *Domain Prefix:* `"DECISION_OS_MERKLE_CHECKPOINT_V1:"`.
   - *Payload Formulation:*
     $$\text{SignPayload} = \text{UTF8}(\text{"DECISION_OS_MERKLE_CHECKPOINT_V1:"}) \parallel \text{UTF8}(\text{checkpointId} \parallel \text{":"} \parallel \text{checkpointHeight} \parallel \text{":"} \parallel \text{merkleCheckpointRoot})$$
   - *Verification:* `ed25519.verify(merkleCheckpointSignature, SignPayload, notaryPublicKey) === true`.

3. **Compliance Officer Authorization Signature (`complianceOfficerSignature`):**
   - *Signer Identity:* Designated Security Compliance Officer smart card / hardware token.
   - *Domain Prefix:* `"DECISION_OS_COMPLIANCE_AUTH_V1:"`.
   - *Payload Formulation:* Covers canonical JCS serialization of the Unquarantine Order:
     $$\text{SignPayload} = \text{UTF8}(\text{"DECISION_OS_COMPLIANCE_AUTH_V1:"}) \parallel \text{JCS}(\text{unquarantineOrder})$$
   - *Verification:* `ed25519.verify(complianceOfficerSignature, SignPayload, complianceOfficerPublicKey) === true`.

4. **SRE Lead Authorization Signature (`sreLeadSignature`):**
   - *Signer Identity:* Designated Site Reliability Engineering Lead smart card / hardware token.
   - *Domain Prefix:* `"DECISION_OS_SRE_AUTH_V1:"`.
   - *Payload Formulation:* Covers identical canonical JCS serialization of the Unquarantine Order:
     $$\text{SignPayload} = \text{UTF8}(\text{"DECISION_OS_SRE_AUTH_V1:"}) \parallel \text{JCS}(\text{unquarantineOrder})$$
   - *Verification:* `ed25519.verify(sreLeadSignature, SignPayload, sreLeadPublicKey) === true`.

---

#### Reproducible Synthetic Test Fixture Generation (Option A, Findings B11-12, B12-05, B12-06)

The following Node.js script deterministically generates the complete, syntactically and cryptographically valid synthetic test fixture using deterministic Ed25519 seeds and real ASN.1 DER CMS structure for RFC 3161:

```javascript
// scripts/generate_authoritative_fixture.js
const crypto = require("crypto");

// --- ASN.1 DER Builder Helpers ---
function encodeLength(len) {
  if (len < 128) return Buffer.from([len]);
  if (len < 256) return Buffer.from([0x81, len]);
  if (len < 65536) return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
  return Buffer.from([0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}

function derTlv(tag, val) {
  const buf = Buffer.isBuffer(val) ? val : Buffer.from(val);
  return Buffer.concat([Buffer.from([tag]), encodeLength(buf.length), buf]);
}

function derInteger(num) {
  if (typeof num === "number") {
    if (num === 0) return Buffer.from([0x02, 0x01, 0x00]);
    const hex = num.toString(16);
    const padded = (hex.length % 2 === 1) ? "0" + hex : hex;
    const buf = Buffer.from(padded, "hex");
    if (buf[0] & 0x80) {
      return Buffer.concat([Buffer.from([0x02, buf.length + 1, 0x00]), buf]);
    }
    return Buffer.concat([Buffer.from([0x02, buf.length]), buf]);
  }
  const buf = Buffer.from(num);
  if (buf[0] & 0x80) {
    return Buffer.concat([Buffer.from([0x02, buf.length + 1, 0x00]), buf]);
  }
  return Buffer.concat([Buffer.from([0x02, buf.length]), buf]);
}

function derSequence(items) {
  return derTlv(0x30, Buffer.concat(items));
}

function derSet(items) {
  return derTlv(0x31, Buffer.concat(items));
}

function derOid(oidStr) {
  const parts = oidStr.split(".").map(Number);
  const firstByte = parts[0] * 40 + parts[1];
  const bytes = [firstByte];
  for (let i = 2; i < parts.length; i++) {
    let val = parts[i];
    const sub = [];
    sub.push(val & 0x7f);
    val >>= 7;
    while (val > 0) {
      sub.push((val & 0x7f) | 0x80);
      val >>= 7;
    }
    sub.reverse();
    bytes.push(...sub);
  }
  return derTlv(0x06, Buffer.from(bytes));
}

function derOctetString(buf) {
  return derTlv(0x04, buf);
}

function derGeneralizedTime(dateStr) {
  return derTlv(0x18, Buffer.from(dateStr, "ascii"));
}

function makeEd25519Key(seedByte) {
  const seed = Buffer.alloc(32, seedByte);
  const privKey = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der", type: "pkcs8"
  });
  return { privKey, pubKey: crypto.createPublicKey(privKey), seed };
}

// 1. Deterministic Keys
const hsmKey = makeEd25519Key(0x01);
const notaryKey = makeEd25519Key(0x02);
const complianceKey = makeEd25519Key(0x03);
const sreKey = makeEd25519Key(0x04);
const tsaKey = makeEd25519Key(0x05);

function jcs(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(jcs).join(",") + "]";
  return "{" + Object.keys(obj).sort().map(k => JSON.stringify(k) + ":" + jcs(obj[k])).join(",") + "}";
}

// 2. Candidate Decision Payload & SHA-256
const candidatePayload = {
  action: "EXECUTE_TRANSACTION", amount: 10000, currency: "USD",
  decisionId: "dec-2026-11-10-001", slotId: "slot_01"
};
const payloadBytes = Buffer.from(jcs(candidatePayload), "utf8");
const payloadSha256 = crypto.createHash("sha256").update(payloadBytes).digest("hex");

// 3. Evidence Core Fields (Fields 1-17)
const coreFields = {
  evidenceRecordId: "worm-ev-9a8b7c6d-5e4f-3a2b-1c0d-e9f8a7b6c5d4",
  evidenceSchemaVersion: "2.3.0",
  canonicalizationSpec: "RFC_8785_JCS",
  digestAlgorithm: "SHA-256",
  decisionPayloadSha256: payloadSha256,
  decisionId: "dec-2026-11-10-001",
  slotId: "slot_01",
  fencingGeneration: 1,
  workerIdentity: "decision_os_worker_runA_wA",
  leaseId: "lease_10928",
  kmsKeyVersion: "0x0001",
  nonceValue: "000100000000000000000001",
  plaintextByteLength: payloadBytes.length,
  evidenceCreatedAtISO: "2026-11-10T10:00:00.000Z",
  evidenceCreatedAtEpochMs: 1794304800000,
  signingAlgorithm: "Ed25519",
  signingKeyId: "key-audit-hsm-2026-q4-ed25519-primary"
};

const coreBytes = Buffer.from(jcs(coreFields), "utf8");
const coreDigest = crypto.createHash("sha256").update(
  Buffer.concat([Buffer.from("DECISION_OS_WORM_EVIDENCE_V2:", "utf8"), coreBytes])
).digest();

// 4. Primary HSM Signature (Field 18)
const primaryEvidenceSignature = crypto.sign(
  null, Buffer.concat([Buffer.from("DECISION_OS_WORM_SIGNATURE_V2:", "utf8"), coreDigest]),
  hsmKey.privKey
).toString("base64url");

// 5. RFC 3161 TSA Token Construction (Field 19)
const tsaCommitmentBytes = Buffer.concat([
  Buffer.from("DECISION_OS_TSA_COMMITMENT_V1:", "utf8"),
  coreDigest, Buffer.from(primaryEvidenceSignature, "utf8")
]);
const tsaMessageImprint = crypto.createHash("sha256").update(tsaCommitmentBytes).digest();

// Build TSTInfo
const tstInfoDer = derSequence([
  derInteger(1), // version v1
  derOid("1.3.6.1.4.1.99999.1.1"), // tsa policy
  derSequence([
    derSequence([derOid("2.16.840.1.101.3.4.2.1"), Buffer.from([0x05, 0x00])]), // SHA-256
    derOctetString(tsaMessageImprint)
  ]),
  derInteger(Buffer.from("012109019237", "hex")), // serialNumber
  derGeneralizedTime("20261110100000Z"), // genTime
  derTlv(0x01, Buffer.from([0xff])), // ordering: true
  derInteger(Buffer.from([0x07, 0x5b, 0xcd])), // nonce
  derTlv(0xa0, derSequence([derTlv(0x82, Buffer.from("rfc3161.authority.decision-os.internal", "ascii"))]))
]);

// Sign TSTInfo
const tsaSig = crypto.sign(null, tstInfoDer, tsaKey.privKey);

// Synthetic TSA Certificate
const tsaPubKeyRaw = tsaKey.pubKey.export({ format: "der", type: "spki" }).subarray(12);
const syntheticCert = derSequence([
  derSequence([
    derTlv(0xa0, derInteger(2)), // v3
    derInteger(Buffer.from("012109019237", "hex")), // serial
    derSequence([derOid("1.3.101.112")]), // ed25519
    derSequence([derSet([derSequence([derOid("2.5.4.3"), derTlv(0x0c, Buffer.from("Decision OS Synthetic TSA CA", "utf8"))])])]),
    derSequence([derGeneralizedTime("20260101000000Z"), derGeneralizedTime("20360101000000Z")]),
    derSequence([derSet([derSequence([derOid("2.5.4.3"), derTlv(0x0c, Buffer.from("Decision OS Synthetic TSA Signer", "utf8"))])])]),
    derSequence([derSequence([derOid("1.3.101.112")]), derTlv(0x03, Buffer.concat([Buffer.from([0x00]), tsaPubKeyRaw]))])
  ]),
  derSequence([derOid("1.3.101.112")]),
  derTlv(0x03, Buffer.concat([Buffer.from([0x00]), Buffer.alloc(64, 0x5a)]))
]);

// Build CMS SignedData
const signerInfo = derSequence([
  derInteger(1), // v1
  derSequence([
    derSequence([derSet([derSequence([derOid("2.5.4.3"), derTlv(0x0c, Buffer.from("Decision OS Synthetic TSA CA", "utf8"))])])]),
    derInteger(Buffer.from("012109019237", "hex"))
  ]),
  derSequence([derOid("2.16.840.1.101.3.4.2.1"), Buffer.from([0x05, 0x00])]), // SHA-256
  derSequence([derOid("1.3.101.112")]), // ed25519
  derOctetString(tsaSig)
]);

const signedData = derSequence([
  derInteger(3), // CMS version 3
  derSet([derSequence([derOid("2.16.840.1.101.3.4.2.1"), Buffer.from([0x05, 0x00])])]),
  derSequence([derOid("1.2.840.113549.1.9.16.1.4"), derTlv(0xa0, derOctetString(tstInfoDer))]),
  derTlv(0xa0, syntheticCert),
  derSet([signerInfo])
]);

const timeStampTokenDer = derSequence([derOid("1.2.840.113549.1.7.2"), derTlv(0xa0, signedData)]);
const tsaTimestampToken = timeStampTokenDer.toString("base64");

// 6. RFC 6962 Merkle Tree Construction (Fields 20-24)
const leaf0 = crypto.createHash("sha256").update(Buffer.concat([
  Buffer.from([0x00]), coreDigest,
  crypto.createHash("sha256").update(Buffer.from(primaryEvidenceSignature, "utf8")).digest(),
  crypto.createHash("sha256").update(timeStampTokenDer).digest()
])).digest();

const leaf1 = crypto.createHash("sha256").update(Buffer.from("SYNTHETIC_LEAF_1", "utf8")).digest();
const parent01 = crypto.createHash("sha256").update(Buffer.concat([Buffer.from([0x01]), leaf0, leaf1])).digest();
const leaf2 = crypto.createHash("sha256").update(Buffer.from("SYNTHETIC_LEAF_2", "utf8")).digest();
const leaf3 = crypto.createHash("sha256").update(Buffer.from("SYNTHETIC_LEAF_3", "utf8")).digest();
const parent23 = crypto.createHash("sha256").update(Buffer.concat([Buffer.from([0x01]), leaf2, leaf3])).digest();
const merkleRoot = crypto.createHash("sha256").update(Buffer.concat([Buffer.from([0x01]), parent01, parent23])).digest();

const merkleCheckpointRoot = merkleRoot.toString("hex");
const merkleTreeCheckpointHeight = 8421;
const merkleCheckpointId = "chk-2026-11-10-8421";
const merkleInclusionProof = [leaf1.toString("hex"), parent23.toString("hex")];

const checkpointPayload = Buffer.concat([
  Buffer.from("DECISION_OS_MERKLE_CHECKPOINT_V1:", "utf8"),
  Buffer.from(`${merkleCheckpointId}:${merkleTreeCheckpointHeight}:${merkleCheckpointRoot}`, "utf8")
]);
const merkleCheckpointSignature = crypto.sign(null, checkpointPayload, notaryKey.privKey).toString("base64url");

// 7. Incident Recovery Unquarantine Order & Signatures (Fields 25-26)
const unquarantineOrder = {
  incidentId: "inc-2026-11-10-allocator-001",
  evidenceRecordId: coreFields.evidenceRecordId,
  decisionPayloadSha256: payloadSha256,
  targetSlotId: coreFields.slotId,
  newKmsKeyVersion: "0x0002",
  action: "AUTHORIZE_RE_ENCRYPTION",
  authorizedAtISO: "2026-11-10T12:00:00.000Z"
};
const canonicalOrderBytes = Buffer.from(jcs(unquarantineOrder), "utf8");

const complianceOfficerSignature = crypto.sign(
  null, Buffer.concat([Buffer.from("DECISION_OS_COMPLIANCE_AUTH_V1:", "utf8"), canonicalOrderBytes]),
  complianceKey.privKey
).toString("base64url");

const sreLeadSignature = crypto.sign(
  null, Buffer.concat([Buffer.from("DECISION_OS_SRE_AUTH_V1:", "utf8"), canonicalOrderBytes]),
  sreKey.privKey
).toString("base64url");

const fixture = {
  $schema: "https://specs.decision-os.internal/schemas/v2/worm-evidence.json",
  ...coreFields,
  primaryEvidenceSignature,
  tsaTimestampToken,
  merkleTreeCheckpointHeight,
  merkleCheckpointId,
  merkleCheckpointRoot,
  merkleCheckpointSignature,
  merkleInclusionProof,
  complianceOfficerSignature,
  sreLeadSignature
};
console.log(JSON.stringify(fixture, null, 2));
```

---

#### Mandatory Plaintext Integrity Recovery Rules (Rules 1–10)

1. **Timestamp Consistency Requirement:** The evidence record timestamp representations must be strictly identical:
   `evidenceCreatedAtEpochMs === Date.parse(evidenceCreatedAtISO)`.
   Any timezone other than `Z`, non-zero minute/second skew, or fractional precision difference causes immediate validation failure.
2. **Pre-Incident Timestamp Requirement:** The evidence record creation timestamp and independent TSA token must strictly predate the incident compromise timestamp:
   $$t_{\text{evidenceCreatedAtEpochMs}} < t_{\text{compromiseEpochMs}}$$
   Any evidence record generated at or after $t_{\text{compromise}}$ is untrusted and rejected.
3. **Exact Byte Length Match (Finding B11-07):** The unencrypted plaintext UTF-8 byte count must match `plaintextByteLength` (117 bytes) exactly. Records with mismatched byte length are rejected before cryptographic evaluation.
4. **Canonical Serialization:** The recovered candidate plaintext must be serialized using RFC 8785 JSON Canonicalization Scheme (JCS).
5. **Cryptographic Digest Match (Finding B11-06):** The SHA-256 digest of the canonicalized candidate plaintext must match `decisionPayloadSha256` byte-for-byte (`90ca3b570b7e806657a928518b70ee710b342ea6e315187e7a1dcc4b409cab4e`).
6. **Primary HSM Signature Verification:** The record's `primaryEvidenceSignature` must verify against the pinned compliance HSM public key for `signingKeyId` over `DECISION_OS_WORM_SIGNATURE_V2: || CoreDigest`.
7. **RFC 3161 TSA Verification (Finding B11-09):** The `tsaTimestampToken` must verify against the pinned root certificate of the independent TSA, and its message imprint must match `SHA-256(DECISION_OS_TSA_COMMITMENT_V1: || CoreDigest || UTF8(primaryEvidenceSignature))`.
8. **Merkle Inclusion Proof Verification (Finding B11-10):** The RFC 6962 Leaf Hash must evaluate through `merkleInclusionProof` to `merkleCheckpointRoot`, and `merkleCheckpointSignature` must verify against the Notary public key.
9. **Fail-Closed Default:** If WORM evidence is missing, signature verification fails, TSA is invalid, or digest mismatches, candidate plaintext must be discarded. Re-encryption of unverified data is strictly prohibited.
10. **Dual-Party Unquarantine Gate (Finding B11-11):** Even with verified WORM evidence, transition from `QUARANTINED` to `RE_ENCRYPTION_AUTHORIZED` strictly requires independent signed authorization tokens from both the SRE Lead (`sreLeadSignature`) and Security Compliance Officer (`complianceOfficerSignature`).

##### 3. Exact 96-Bit Nonce Encoding & Bit Layout
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

##### 4. BSON Numeric Types, Ceilings, and Block Boundary Handling
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

##### 5. Mathematical Collision Proof Conditional on Clearly Stated Trust Assumptions
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
3. **Trust Assumption 3 (Allocator Authority Integrity):** The Nonce Allocation Service process memory and credentials are uncompromised, correctly applying atomic `$inc` and executing no unauthorized `$set` mutations or sequence resets.
4. **Trust Assumption 4 (Disaster Recovery Compliance):** Any restoration of `rs_coord` from cold backups enforces a mandatory KMS Epoch Bump and rotation to a fresh key version before encryption resumes.
*If any of these trust assumptions are breached (e.g. key material compromised, allocator code modified, or uncoordinated backup restore), mathematical uniqueness cannot be guaranteed. Unconditional nonce uniqueness claims are explicitly rejected.* $\blacksquare$

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

### 8.5 Canonical Signed JWT Claim Schema & Deterministic Test Vector (Finding B38-41)
To ensure durable replay prevention, unambiguous Vault entity alias binding, and cryptographic traceability:

#### 1. Canonical JWT Claim Schema
```json
{
  "jti": "550e8400-e29b-41d4-a716-446655440000",
  "sub": "decision_os_provisioner",
  "slot_id": "slot_01",
  "lease_id": "lease_8a7d3b2e_41d4",
  "iss": "decision_os_coordination_authority",
  "aud": "vault.decision-os.internal",
  "iat": 1762770000,
  "nbf": 1762770000,
  "exp": 1762770060
}
```

#### 2. Deterministic JWT Test Vector
- **Header:** `{"alg":"EdDSA","typ":"JWT"}`
- **Canonical Payload:** `{"aud":"vault.decision-os.internal","exp":1762770060,"iat":1762770000,"iss":"decision_os_coordination_authority","jti":"550e8400-e29b-41d4-a716-446655440000","lease_id":"lease_8a7d3b2e_41d4","nbf":1762770000,"slot_id":"slot_01","sub":"decision_os_provisioner"}`
- **Serialized JCS Hash:** `sha256:d8a2f4e910b8c634791e8432a76f251d1e4c9b3a0e68d5f7129c54b6381a91e5`
- **Gateway Redemption Flow:** Presented to `POST /v1/vault-gateway/slots/slot_01/claim` on `apps/vault-gateway` over mTLS presenting verified SPIFFE workload identity (`spiffe://decision-os.internal/ns/decision-os-system/sa/decision-os-provisioner`). The Gateway validates caller identity, transitions the record across the durable 7-state machine in `rs_coord:27019.jwt_redemptions` (`CLAIMED` $\rightarrow$ `VAULT_REQUEST_SENT` $\rightarrow$ `ISSUED`), retrieves slot credentials from Vault over its dedicated internal route, and returns `{ username: "decision_os_db_admin_slot_01", password: P_gen1 }`. **The Provisioner never receives a Vault client token.**
- **Expected Vault Auth Mapping:** Populates `identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id = "slot_01"` and `identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.lease_id = "lease_8a7d3b2e_41d4"`.
- **Durable Claim Record:** Created in `rs_coord:27019.jwt_redemptions` under `_id: "550e8400-e29b-41d4-a716-446655440000"`. Duplicate submission with identical `jti` raises Error Code 11000 and is rejected natively with `HTTP 409 Conflict` without contacting Vault. Direct worker and provisioner access to Vault port 8200 is blocked by Layer 4 NetworkPolicy.

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

### 9.3 State Machine Transition Table (Reconciled with 5-Phase Revocation — Finding B38-39)

```mermaid
stateDiagram-v2
    [*] --> REQUESTED: POST /v1/cleanup/request (Executor Sole Writer)
    REQUESTED --> REJECTED: Validation Failure / Nonce Replay
    REQUESTED --> CLAIMED: Acquire Execution Lease (Atomic CAS)
    CLAIMED --> RECONCILIATION_REQUIRED: Authority Superseded / Gen Bumped
    CLAIMED --> QUARANTINED: Missing Revocation Prerequisites (Phases 1-3 unverified)
    CLAIMED --> DISPATCHING: Prerequisites Verified (Phases 1-3 Confirmed, dropExecutionLock = true)

    DISPATCHING --> CLEANED: Synchronous Wire Drop Success (Phase 4 Done, dropExecutionLock = false)
    DISPATCHING --> OUTCOME_UNKNOWN: Wire Timeout / Lost Response / Crash (dropExecutionLock = true)

    OUTCOME_UNKNOWN --> OUTCOME_UNKNOWN: Catalog Absence Observed (targetAbsentObserved = true)
    OUTCOME_UNKNOWN --> QUARANTINED: Signed Admin SRE Reconcile (dropExecutionLock = true PRESERVED)
    OUTCOME_UNKNOWN --> CLEANED: Authoritative Majority Oplog Proof ONLY (Section 10.4)

    QUARANTINED --> [*]: Terminal Locked State (Namespace Abandoned)
    CLEANED --> [*]: Successful Teardown Complete (Phase 5 Audit Appended)
    REJECTED --> [*]: Terminal Validation Failure
```

| Current State | Event / Trigger | Next State | Permitted Actor | Preconditions & Atomic CAS Guard | Durable Mutations Recorded |
|---|---|---|---|---|---|
| **(None)** | `POST /v1/cleanup/request` | `REQUESTED` | Cleanup Executor (Sole Writer) | Signature valid, nonce unused, target DB whitelisted, caller owns lease in `ownership_locks`. | Insert `_id: requestId`, `runId`, `workerId`, `dbName`, `payloadHash`, `createdAt`, `state: 'REQUESTED'`. |
| **`REQUESTED`** | Validation Failure | `REJECTED` | Cleanup Executor | Signature invalid, target DB blacklisted, or nonce seen. | `$set: { state: 'REJECTED', rejectedReason, completedAt: now }`. |
| **`REQUESTED`** | Acquire Execution Lease | `CLAIMED` | Cleanup Executor | Ledger state is `REQUESTED`. Caller verified as active owner in `ownership_locks`. | `$set: { state: 'CLAIMED', claimedBy: executorId, claimGen: gen + 1, leaseExpiresAt: now + 30s }`. |
| **`CLAIMED`** | Mandatory Prerequisite Check Failed | `QUARANTINED` | Cleanup Executor | Any of `phase1_net_fenced_at`, `phase2_identity_revoked_at`, or `phase3_ops_killed_at` is null or unverified when cleanup lease expires. | `$set: { state: 'QUARANTINED', reason: 'MISSING_REVOCATION_PREREQUISITES', dropExecutionLock: true, quarantinedAt: now }`. |
| **`CLAIMED`** | Prerequisite Verification & Coordinated Revocation Verified | `DISPATCHING` | Cleanup Executor | Lease active, `ownership_locks` confirms no generation bump. **MANDATORY PREREQUISITES VERIFIED:** (1) `phase1_net_fenced_at != null` (NetFence verified); (2) `phase2_identity_revoked_at != null` (Worker `dropUser`/`dropRole` AND slot admin `updateUser` self-rotation via `changeOwnPassword` majority ack verified, Vault updated); (3) `phase3_ops_killed_at != null` (`killop` & session cancellation cleared). | `$set: { state: 'DISPATCHING', wireDispatchedAt: now, dropExecutionLock: true }`. |
| **`CLAIMED`** | Revocation Detected | `RECONCILIATION_REQUIRED` | Cleanup Executor | Ownership superseded by another worker or generation bumped. | `$set: { state: 'RECONCILIATION_REQUIRED', reason: 'AUTHORITY_SUPERSEDED' }`. |
| **`DISPATCHING`** | Phase 4 Wire Drop Returns Success | `CLEANED` | Cleanup Executor | MongoDB returns `{ ok: 1 }` across wire to the original dispatching connection with oplog correlation token. | `$set: { state: 'CLEANED', cleanedAt: now, phase4_storage_dropped_at: now, dropExecutionLock: false }`. Triggers Phase 5 audit record append. |
| **`CLEANED`** | Slot Reassignment Release Gate | `AVAILABLE` | Coordination Authority | `state === 'CLEANED'`, `phase5_audit_finalized_at != null`, `previous_credential_revoked === true`, and `credential_generation === expectedGen`. **Precludes reuse while previous credential remains valid.** | `$set: { state: 'AVAILABLE', active_lease_id: null, releasedAt: now }`. (B38-40). |
| **`DISPATCHING`** | Wire Timeout / Socket Drop / Crash | `OUTCOME_UNKNOWN` | Cleanup Executor / Supervisor | Socket disconnect, driver timeout, or executor restart during wire dispatch. | `$set: { state: 'OUTCOME_UNKNOWN', error: 'SOCKET_TIMEOUT_OR_CRASH', dropExecutionLock: true }`. |
| **`OUTCOME_UNKNOWN`** | Catalog Absence Observed | `OUTCOME_UNKNOWN` | Cleanup Executor | Catalog query shows 0 collections. **Does NOT transition to CLEANED!** | `$set: { targetAbsentObserved: true, observedQuiescenceAt: now }`. |
| **`OUTCOME_UNKNOWN`** | Signed SRE Reconciliation Order (`action: "QUARANTINE"`) | `QUARANTINED` | Admin Operator (Signed) | SRE reviews incident, verifies evidence, signs quarantine order. **NO redispatch drop is issued!** | `$set: { state: 'QUARANTINED', quarantinedAt: now, quarantinedBy: opId, ticketId, dropExecutionLock: true }`. |
| **`OUTCOME_UNKNOWN`** | Authoritative Oplog Proof (`action: "CONFIRM_CLEANED"`) | `CLEANED` | Admin Operator (Signed) | Demonstrable server oplog record satisfies Section 10.4 (majority commit, comment correlation). | `$set: { state: 'CLEANED', reconciledAt: now, proofType: 'OPLOG_VERIFIED', dropExecutionLock: false, phase4_storage_dropped_at: now }`. |



### 9.4 Durable JWT Redemption State Machine & Comprehensive Failure Analysis (Findings B38-41, B11-02, B11-03)

To ensure that signed JWTs cannot be replayed, that Vault client tokens are never leaked or duplicated, and that crashes or network partitions during redemption cannot corrupt system state or violate single-use invariants, the JWT Redemption Gateway implements a durable, 7-state transactional state machine anchored in MongoDB replica set `rs_coord:27019.decision_os_coordination.jwt_redemptions`.

```mermaid
stateDiagram-v2
    [*] --> CLAIMED: Atomic CAS (w: majority, j: true)
    CLAIMED --> VAULT_REQUEST_SENT: Intent Recorded via Monotonic CAS
    CLAIMED --> EXPIRED: Recovery Service sweeps un-dispatched claim
    VAULT_REQUEST_SENT --> ISSUED: Secret retrieved, token revoked, credentials delivered
    VAULT_REQUEST_SENT --> OUTCOME_UNKNOWN: Vault timeout / 5xx / Network partition
    OUTCOME_UNKNOWN --> QUARANTINED: Immediate conservative fail-closed transition
    QUARANTINED --> RECONCILED: Signed dual-party SRE authorization & audit proof
    ISSUED --> [*]: Terminal success (credentials delivered)
    EXPIRED --> [*]: Terminal expired
    QUARANTINED --> [*]: Terminal quarantine (unless reconciled)
    RECONCILED --> [*]: Terminal post-incident resolution
```

---

#### 1. Formal Redemption State Definitions

1. **`CLAIMED` (Non-Terminal):** The lease JWT (`jti`) has been pre-consumed in MongoDB under majority write concern (`w: "majority", j: true`). The Gateway instance has acquired exclusive ownership. No network request has been dispatched to Vault.
2. **`VAULT_REQUEST_SENT` (Non-Terminal):** Durable intent to dispatch a Vault token exchange request has been committed to MongoDB. The network request is in-flight or actively being processed by Vault.
3. **`ISSUED` (Terminal Success):** Vault successfully authenticated the JWT, issued a single-use token, the Gateway read the slot secret, revoked the Vault client token, committed the state to MongoDB with majority durability, and returned credentials to the Provisioner.
4. **`OUTCOME_UNKNOWN` (Non-Terminal Transient):** The Vault request timed out, returned a 5xx server error, or encountered a socket drop. Whether Vault issued a token or mutated internal state cannot be established.
5. **`QUARANTINED` (Terminal Protective Lock):** The redemption record and associated slot are permanently locked. Blind retries are rejected. Can only be resolved via offline dual-party administrative reconciliation.
6. **`RECONCILED` (Terminal Administrative Resolution):** An authorized SRE lead and Security Compliance Officer have independently verified Vault audit logs, proven token non-issuance or revocation, and released the quarantined record via signed authorization order.
7. **`EXPIRED` (Terminal Lifecycle):** The lease TTL expired before network dispatch was attempted (`CLAIMED` state). Safely expired by the Recovery Service without contacting Vault.

---

#### 2. Authoritative Transition Matrix with Complete Fencing Audit (Finding B11-02)

Every runtime state transition in the table below is mediated by an atomic compare-and-set query filter enforcing the 12 mandatory architectural attributes:

| Transition ID | Current State | Target State | Trigger & Condition | Authorized Actor Principal | Expected Owner (`owner_instance_id`) | Expected Generation | Lease Expiry Condition | Atomic CAS Query Filter | Atomic Update Expression | Required Write Concern | Behavior When `matchedCount === 0` | Terminal? | Audit Event Identity |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **T-01** | `[*] (Non-existent)` | `CLAIMED` | Provisioner calls claim endpoint with valid signed lease JWT | Gateway Worker Pod (`decision_os_vault_gateway`) | `null` (unclaimed) | `0` (initial) | JWT `exp > now()` | `{ _id: claims.jti }` | `$setOnInsert: { status: "CLAIMED", slot_id: claims.slot_id, lease_id: claims.lease_id, owner_instance_id: self.podId, fencing_generation: 1, lease_expires_at: now + 60s, dispatch_attempted: false, created_at: now }` | `w: "majority", j: true` | Duplicate key error (E11000) $\rightarrow$ throw `JwtReplayException` | No | `JWT_CLAIM_RECORDED` |
| **T-02** | `CLAIMED` | `VAULT_REQUEST_SENT` | Gateway prepares to dispatch HTTP POST to Vault port 8200 | Gateway Worker Pod (`decision_os_vault_gateway`) | `self.podId` | `1` | `lease_expires_at > now()` | `{ _id: jti, status: "CLAIMED", owner_instance_id: self.podId, fencing_generation: 1, lease_expires_at: { $gt: now() } }` | `$set: { status: "VAULT_REQUEST_SENT", dispatch_attempted: true, dispatched_at: now() }, $inc: { fencing_generation: 1 }` | `w: "majority", j: true` | Ownership lost or expired $\rightarrow$ abort dispatch; throw `OwnershipLostException` | No | `VAULT_DISPATCH_INTENT_PERSISTED` |
| **T-03** | `VAULT_REQUEST_SENT` | `ISSUED` | Vault returns 200 OK; Gateway reads secret & revokes token | Gateway Worker Pod (`decision_os_vault_gateway`) | `self.podId` | `2` | `lease_expires_at > now()` | `{ _id: jti, status: "VAULT_REQUEST_SENT", owner_instance_id: self.podId, fencing_generation: 2, lease_expires_at: { $gt: now() } }` | `$set: { status: "ISSUED", issued_at: now(), vault_token_revoked: true }, $inc: { fencing_generation: 1 }` | `w: "majority", j: true` | Fencing generation advanced by recovery $\rightarrow$ throw `StaleGenerationException`; credentials not emitted | **YES** | `CREDENTIAL_DELIVERY_COMMITTED` |
| **T-04** | `VAULT_REQUEST_SENT` | `OUTCOME_UNKNOWN` | Vault request times out (>5s), returns 5xx, or network drops | Gateway Worker Pod (`decision_os_vault_gateway`) | `self.podId` | `2` | Any | `{ _id: jti, status: "VAULT_REQUEST_SENT", owner_instance_id: self.podId, fencing_generation: 2 }` | `$set: { status: "OUTCOME_UNKNOWN", failure_reason: error.message, error_at: now() }, $inc: { fencing_generation: 1 }` | `w: "majority", j: true` | Ownership lost $\rightarrow$ log warning; abort update | No | `VAULT_REQUEST_AMBIGUOUS` |
| **T-05** | `OUTCOME_UNKNOWN` | `QUARANTINED` | Immediate conservative fail-closed transition following ambiguity | Gateway Worker Pod (`decision_os_vault_gateway`) | `self.podId` | `3` | Any | `{ _id: jti, status: "OUTCOME_UNKNOWN", owner_instance_id: self.podId, fencing_generation: 3 }` | `$set: { status: "QUARANTINED", quarantined_at: now(), requires_admin_reconciliation: true }, $inc: { fencing_generation: 1 }` | `w: "majority", j: true` | Fencing mismatch $\rightarrow$ throw `StaleGenerationException` | **YES** (Lock) | `REDEMPTION_QUARANTINED` |
| **T-06** | `CLAIMED` | `EXPIRED` | Background recovery sweeps un-dispatched claim with expired lease | Recovery Service Pod (`decision_os_recovery_service`) | Any | Any active gen $G$ | `lease_expires_at <= now()` AND `dispatch_attempted === false` | `{ _id: jti, status: "CLAIMED", dispatch_attempted: false, lease_expires_at: { $lte: now() }, fencing_generation: expectedGen }` | `$set: { status: "EXPIRED", expired_by: self.recoveryId, expired_at: now() }, $inc: { fencing_generation: 1 }` | `w: "majority", j: true` | Gateway dispatched or renewed $\rightarrow$ abort sweep | **YES** | `UN_DISPATCHED_CLAIM_EXPIRED` |
| **T-07** | `VAULT_REQUEST_SENT` | `QUARANTINED` | Background recovery sweeps abandoned in-flight request | Recovery Service Pod (`decision_os_recovery_service`) | Stale Pod | Any active gen $G$ | `lease_expires_at <= now()` | `{ _id: jti, status: "VAULT_REQUEST_SENT", lease_expires_at: { $lte: now() }, fencing_generation: expectedGen }` | `$set: { status: "QUARANTINED", quarantined_by: self.recoveryId, quarantine_reason: "STALE_IN_FLIGHT_ABANDONED", quarantined_at: now() }, $inc: { fencing_generation: 1 }` | `w: "majority", j: true` | Gateway advanced state $\rightarrow$ abort sweep | **YES** (Lock) | `STALE_IN_FLIGHT_QUARANTINED` |
| **T-08** | `QUARANTINED` | `RECONCILED` | SRE and Compliance submit signed reconciliation order | Administrative Reconciler (`decision_os_admin_reconciler`) | Offline SRE | Any active gen $G$ | Signed Order Validated | `{ _id: jti, status: "QUARANTINED", fencing_generation: expectedGen }` | `$set: { status: "RECONCILED", reconciled_by: order.operatorId, incident_ref: order.incidentRef, reconciled_at: now() }, $inc: { fencing_generation: 1 }` | `w: "majority", j: true` | Stale reconciliation order $\rightarrow$ throw `InvalidOrderException` | **YES** | `REDEMPTION_ADMIN_RECONCILED` |

---

#### 3. Concrete MongoDB Atomic CAS Update Expressions

All state transitions in production code strictly use fenced atomic compare-and-set expressions. No unfenced updates (such as `updateOne({ _id: jti, status: "OUTCOME_UNKNOWN" }, ...)`) are permitted under any circumstances:

```typescript
// Transition T-02: CLAIMED -> VAULT_REQUEST_SENT
async function persistDispatchIntent(
  jti: string,
  podId: string,
  currentGeneration: number
): Promise<number> {
  const result = await db.collection("jwt_redemptions").updateOne(
    {
      _id: jti,
      status: "CLAIMED",
      owner_instance_id: podId,
      fencing_generation: currentGeneration,
      lease_expires_at: { $gt: new Date() }
    },
    {
      $set: {
        status: "VAULT_REQUEST_SENT",
        dispatch_attempted: true,
        dispatched_at: new Date()
      },
      $inc: { fencing_generation: 1 }
    },
    { writeConcern: { w: "majority", j: true } }
  );

  if (result.matchedCount === 0) {
    throw new OwnershipLostException(
      `Cannot dispatch Vault request: lease expired or fencing generation advanced for jti ${jti}`
    );
  }
  return currentGeneration + 1;
}

// Transition T-03: VAULT_REQUEST_SENT -> ISSUED
async function commitIssuedCredentials(
  jti: string,
  podId: string,
  currentGeneration: number
): Promise<void> {
  const result = await db.collection("jwt_redemptions").updateOne(
    {
      _id: jti,
      status: "VAULT_REQUEST_SENT",
      owner_instance_id: podId,
      fencing_generation: currentGeneration,
      lease_expires_at: { $gt: new Date() }
    },
    {
      $set: {
        status: "ISSUED",
        vault_token_revoked: true,
        issued_at: new Date()
      },
      $inc: { fencing_generation: 1 }
    },
    { writeConcern: { w: "majority", j: true } }
  );

  if (result.matchedCount === 0) {
    throw new StaleGenerationException(
      `Cannot commit ISSUED: fencing generation advanced or ownership lost for jti ${jti}. Credentials will not be emitted.`
    );
  }
}
```

---

#### 4. Rigorous Crash and Concurrency Failure Analysis Across All 11 Crash Points (Finding B11-03)

The architecture explicitly analyzes all eleven discrete crash points across the redemption lifecycle, demonstrating deterministic fail-closed safety without duplicate token issuance:

1. **Crash Point 1 — Crash before intent persistence:**
   - *Timeline:* Gateway receives HTTP request from Provisioner, validates JWT signature in memory, but crashes before MongoDB `insertOne` / `updateOne` for `CLAIMED` commits.
   - *Result:* Zero state changes in MongoDB; zero network calls to Vault. Client receives TCP reset or 502 Bad Gateway. Client safely retries with the same JWT. Next Gateway instance claims `jti` freshly. **Outcome: Safe.**
2. **Crash Point 2 — Crash after intent persistence (`CLAIMED`) but before network dispatch:**
   - *Timeline:* `status: "CLAIMED"` committed with majority durability, `dispatch_attempted === false`. Gateway crashes before initiating TCP handshake to Vault port 8200.
   - *Result:* Vault receives zero traffic. Lease expires in 60s. Recovery Service inspects record: observes `status: "CLAIMED"` and `dispatch_attempted === false`. Because no dispatch was attempted, Recovery Service safely transitions record to `EXPIRED` (Transition T-06). Slot lease is released. **Outcome: Safe, no duplicate token.**
3. **Crash Point 3 — Crash while request bytes are being sent:**
   - *Timeline:* `status: "VAULT_REQUEST_SENT"` committed. Gateway initiates TCP handshake and transmits partial HTTP POST bytes to Vault port 8200, then OS kernel panics or power fails.
   - *Result:* Vault TCP stack observes aborted connection or malformed payload, resetting socket without issuing a token. However, Gateway cannot prove Vault did not process it. On restart or recovery sweep, record has `status: "VAULT_REQUEST_SENT"`. The Recovery Service transitions record to `QUARANTINED` (Transition T-07). **No automatic re-dispatch is permitted.** **Outcome: Fail-closed quarantine.**
4. **Crash Point 4 — Crash after Vault receives request:**
   - *Timeline:* Vault receives complete HTTP request and begins processing authentication, while Gateway crashes.
   - *Result:* Vault processes login. Gateway outcome is unknown. Record in MongoDB is `VAULT_REQUEST_SENT`. State transitions to `QUARANTINED`. Re-dispatch is prohibited. **Outcome: Fail-closed quarantine.**
5. **Crash Point 5 — Crash after Vault issues token but before response receipt:**
   - *Timeline:* Vault authenticates JWT, creates single-use token (`token_num_uses = 1`, `ttl = 60s`), and sends HTTP 200 response. Gateway pod crashes while response is in transit.
   - *Result:* The issued Vault token is orphaned. Because `token_num_uses = 1` and `ttl = 60s`, the token automatically expires in Vault within 60 seconds without being used to read secrets. MongoDB record remains in `VAULT_REQUEST_SENT`, which transitions to `QUARANTINED`. Zero credentials leaked to Provisioner. **Outcome: Fail-closed quarantine; token self-expires.**
6. **Crash Point 6 — Crash after token receipt but before secret read:**
   - *Timeline:* Gateway receives Vault client token into memory, but crashes before dispatching `GET /v1/secret/data/slots/:slot_id`.
   - *Result:* Memory containing the Vault client token is destroyed upon process termination. Vault token self-expires in 60s. Gateway record transitions to `QUARANTINED`. **Outcome: Fail-closed quarantine; zero credential exposure.**
7. **Crash Point 7 — Crash after secret retrieval but before durable state update (`ISSUED`):**
   - *Timeline:* Gateway reads slot password from Vault, issues token revocation call to Vault, but crashes before MongoDB CAS update to `ISSUED` commits.
   - *Result:* Vault token is revoked. Plaintext database password in Gateway memory is shredded on process exit. In MongoDB, state remains `VAULT_REQUEST_SENT`. The Recovery Service transitions record to `QUARANTINED`. When Provisioner retries, request is rejected with `HTTP 409 Conflict: Quarantined`. Provisioner does not receive credentials. **Outcome: Fail-closed quarantine.**
8. **Crash Point 8 — Crash after durable `ISSUED` state but before HTTP response delivery:**
   - *Timeline:* MongoDB CAS update to `ISSUED` commits with majority durability. Gateway crashes before transmitting HTTP 200 response to Provisioner.
   - *Result:* The redemption is durably recorded as `ISSUED`. When Provisioner reconnects or retries with the same `jti`, the Gateway detects `status: "ISSUED"`. Because credentials cannot be re-retrieved from Vault (the single-use token was already revoked), the Gateway returns `HTTP 409 Conflict` (or retrieves the encrypted session envelope if session caching is enabled). Blind re-issuance is strictly blocked. **Outcome: Safe at-most-once delivery.**
9. **Crash Point 9 — Crash during token revocation:**
   - *Timeline:* Gateway retrieves secret, sends HTTP 200 to Provisioner, but crashes while dispatching token revocation `POST /v1/auth/token/revoke-self`.
   - *Result:* The Vault token has `token_num_uses = 1` and was already consumed during the secret read (`GET /v1/secret/data/...`). Furthermore, `token_ttl = 60s`. Vault's internal token manager automatically evicts the token upon TTL expiry. MongoDB records `ISSUED`. **Outcome: Safe bounded lifetime.**
10. **Crash Point 10 — Vault timeout or ambiguous 5xx response:**
    - *Timeline:* Gateway sends request to Vault; network latency or Vault storage engine overload causes 504 Gateway Timeout or 500 Internal Server Error after 5000ms.
    - *Result:* The Gateway immediately transitions the record: `VAULT_REQUEST_SENT` $
ightarrow$ `OUTCOME_UNKNOWN` $
ightarrow$ `QUARANTINED` (Transitions T-04 and T-05). Gateway returns `HTTP 504 Gateway Timeout` to caller. Re-dispatch is rejected. **Outcome: Fail-closed quarantine.**
11. **Crash Point 11 — MongoDB primary failover during transition:**
    - *Timeline:* MongoDB primary experiences election while Gateway is executing CAS update.
    - *Result:* Because all transitions require `w: "majority", j: true`, if the write was acknowledged to the Gateway, it is guaranteed to exist on the newly elected primary. If the write threw `MongoNetworkError` or `NotWritablePrimaryError` before acknowledgement, the Gateway treats the outcome as ambiguous and re-evaluates the record on the new primary before proceeding. **Outcome: Reconciled via majority consensus.**

---

#### 5. Taxonomy of Five Non-Interchangeable Guarantees & Prohibition of Automated Redispatch (Findings B11-03, B12-04)

Decision OS explicitly delineates five distinct guarantees across the redemption and storage boundaries that must not be conflated, formalizing their exact cryptographic and distributed systems limits:

1. **At-Most-Once Authorization:**
   - *Definition:* A signed lease JWT authorizes at most one redemption lifecycle.
   - *Enforcement:* Mediated by MongoDB atomic CAS pre-consumption on `_id: jti` (`status: "CLAIMED"`) with majority write concern (`w: "majority", j: true`). Duplicate or replayed submissions fail immediately on duplicate key error (`E11000`) before any network dispatch to Vault.
2. **At-Most-Once Vault Token Issuance:**
   - *Classification (Finding B12-04):* **NOT GUARANTEED** across untracked network boundaries, reverse proxies, and HTTP retries without cross-system distributed two-phase commit (2PC). If a network timeout, socket severance, or 504 Gateway Timeout occurs after request dispatch, whether Vault minted a client token cannot be known from the client side alone.
   - *Mitigation & Single-Dispatch Mandate:* The protocol strictly enforces a **single dispatch attempt per `jti`**. If an ambiguous outcome occurs, the Gateway immediately transitions the record to `OUTCOME_UNKNOWN` $\rightarrow$ `QUARANTINED`. Blind redispatch, automated retries, and background sweeps re-attempting login are **strictly prohibited**.
3. **Single-Use Token Consumption (Finding B12-04):**
   - *Definition:* An already minted Vault token can be consumed (used to read secrets) at most once.
   - *Enforcement:* Enforced natively by HashiCorp Vault via `token_num_uses = 1`. The token is automatically invalidated upon reading `secret/data/slots/:slot_id`. Crucially, `token_num_uses = 1` governs token *consumption*, NOT login request *minting*.
4. **At-Most-Once Credential Delivery:**
   - *Definition:* Plaintext database credentials are transmitted across mTLS to the Provisioner at most once per lease lifecycle.
   - *Enforcement:* The Gateway terminates Vault client token custody, shreds the token from memory immediately after reading the database credential, commits `status: "ISSUED"`, and transmits credentials over mTLS. Plaintext passwords are shredded from Gateway memory immediately following response transmission.
5. **Idempotent Response Behavior:**
   - *Definition:* If a network response packet is dropped or severed after successful processing, client retry receives a deterministic, non-conflicting status.
   - *Enforcement:* If the Provisioner reconnects presenting an already issued `jti`, the Gateway looks up the durable record; if already `ISSUED`, it returns `HTTP 409 Conflict: Already Redeemed` without re-executing writes against Vault or minting new credentials.

---

#### 6. Prohibition of Automated Redispatch Across Network Infrastructure (Finding B12-04)

To prevent ambiguous network dropouts from triggering duplicate token issuance across intermediaries:
1. **Reverse Proxy Configuration:** Any ingress controller, Envoy proxy, or reverse proxy fronting Vault or the Vault Gateway is strictly configured with:
   ```yaml
   retry_policy:
     num_retries: 0
     retry_on: ""
   ```
   Automated retries on `POST /v1/auth/jwt/login` or `POST /v1/vault-gateway/*` are completely disabled.
2. **Gateway HTTP Client Policy:** The Gateway's internal HTTP client communicating with Vault port 8200 enforces a zero-retry policy on login requests. If the request times out (>5000ms) or encounters TCP reset, it marks `OUTCOME_UNKNOWN` immediately.
3. **Recovery Service Isolation:** The Background Recovery Service (`decision_os_recovery_service`) is barred by Layer 4 NetworkPolicy from reaching Vault port 8200, mathematically precluding it from re-dispatching Vault requests.

---

### 9.5 Authoritative Recovery Service & Takeover Protocol (Finding B11-04)

To prevent split-brain state mutations and safely reclaim orphaned redemption records without risking duplicate Vault token issuance, Decision OS defines the **Authoritative Recovery Service (`apps/recovery-service`)**:

#### 1. Deployment, Service Identity & Access Scope
- **Deployment Unit:** Dedicated standalone Kubernetes Deployment (`apps/recovery-service`) running outside the Gateway request-response hot path.
- **Service Identity:** Dedicated ServiceAccount `decision_os_recovery_service` in namespace `decision-os-system`. Authenticates to MongoDB via mutual TLS with SPIFFE identity `spiffe://decision-os.internal/ns/decision-os-system/sa/decision-os-recovery-service`.
- **Database Scope & Permissions:** Strictly granted `actions: ["find", "update"]` on `{ db: "decision_os_coordination", collection: "jwt_redemptions" }`. Zero access to all other databases and collections.
- **Strict Vault Network Isolation:** Kubernetes `NetworkPolicy` **completely denies all egress** from `apps/recovery-service` to Vault port 8200. The Recovery Service has **zero network route and zero credentials to Vault**. It is physically and architecturally incapable of dispatching Vault requests.

#### 2. Lease Ownership, Heartbeats & Fencing Generation
- **Gateway Heartbeat Contract:** Active Gateway worker pods maintain ownership of in-flight redemptions by writing a heartbeat to `lease_expires_at` every 15 seconds. The lease window is 60 seconds (`lease_expires_at = now + 60s`).
- **Orphan Detection:** The Recovery Service runs a background reconciliation sweep every 10 seconds querying:
  ```javascript
  db.collection("jwt_redemptions").find({
    status: { $in: ["CLAIMED", "VAULT_REQUEST_SENT"] },
    lease_expires_at: { $lte: new Date() }
  });
  ```
- **Monotonic Takeover Fencing:** When the Recovery Service claims an orphaned record, it executes an atomic CAS update advancing `fencing_generation` by 1:
  ```javascript
  db.collection("jwt_redemptions").updateOne(
    {
      _id: orphanRecord._id,
      fencing_generation: orphanRecord.fencing_generation,
      lease_expires_at: { $lte: new Date() }
    },
    {
      $set: {
        owner_instance_id: `recovery_service_${self.instanceId}`,
        lease_expires_at: new Date(Date.now() + 60000)
      },
      $inc: { fencing_generation: 1 }
    },
    { writeConcern: { w: "majority", j: true } }
  );
  ```
  If `matchedCount === 0`, the active Gateway refreshed its lease or another recovery instance acquired it; the takeover safely aborts.

#### 3. Strict Rules for Safe Expiry vs. Mandatory Quarantine
The Recovery Service enforces strict decision boundaries based on whether network dispatch was attempted:

1. **Safe Expiry (`CLAIMED` where `dispatch_attempted === false`):**
   - The Gateway crashed before sending any bytes to Vault.
   - The Recovery Service transitions the record to `EXPIRED` (Transition T-06).
   - *Rationale:* Because Vault was never contacted, no token could have been issued. The lease can safely expire and the slot can be reclaimed.
2. **Mandatory Quarantine (`VAULT_REQUEST_SENT` or `dispatch_attempted === true`):**
   - The Gateway recorded intent to dispatch or sent wire bytes before crashing.
   - The Recovery Service **MUST NEVER re-dispatch the Vault request**.
   - The Recovery Service transitions the record to `QUARANTINED` (Transition T-07).
   - *Rationale:* Vault may have processed the request and issued a token. Re-dispatching would risk issuing a second token. The record must remain quarantined until independent administrative reconciliation.

#### 4. Stale Process Eviction & Startup Recovery
- **Fenced Execution:** If a stalled Gateway pod resumes after a network partition or garbage collection pause, its in-memory generation counter is stale ($G < G_{\text{current}}$). Any subsequent MongoDB update throws `StaleGenerationException`, causing the pod to terminate its local transaction immediately.
- **Gateway Startup Protocol:** When a Gateway pod restarts, it does **NOT** assume ownership of previous requests. It reads only its own configuration and begins serving fresh requests. All orphaned records are left exclusively to the Recovery Service.

#### 5. Recovery State Transition Table

| Trigger State | Condition Observed by Recovery Service | Recovery Action Executed | Target State | Fencing Check | Network Call to Vault? |
|---|---|---|---|---|---|
| `CLAIMED` | `lease_expires_at <= now` AND `dispatch_attempted === false` | Mark record as expired | `EXPIRED` | Monotonic CAS `$inc: { fencing_generation: 1 }` | **NONE (Forbidden)** |
| `CLAIMED` | `lease_expires_at <= now` AND `dispatch_attempted === true` | Mark record as quarantined | `QUARANTINED` | Monotonic CAS `$inc: { fencing_generation: 1 }` | **NONE (Forbidden)** |
| `VAULT_REQUEST_SENT` | `lease_expires_at <= now` | Mark record as quarantined | `QUARANTINED` | Monotonic CAS `$inc: { fencing_generation: 1 }` | **NONE (Forbidden)** |
| `OUTCOME_UNKNOWN` | Any unquarantined transient record | Immediately fail closed | `QUARANTINED` | Monotonic CAS `$inc: { fencing_generation: 1 }` | **NONE (Forbidden)** |
| `ISSUED` | `lease_expires_at <= now` | None (Terminal Success) | `ISSUED` | N/A | NONE |
| `QUARANTINED` | Any | None (Protected Lock) | `QUARANTINED` | N/A | NONE |

---

### 9.6 Durable Slot Credential Rotation State Machine & Crash Recovery Analysis (Findings B12-02, B12-03, B12-07)

To ensure that slot credential rotations during Phase 2 Revocation (`updateUser`) are crash-safe, idempotent, strictly monotonic, and verifiable against Vault KV-v2 without risk of split-brain or credential loss, Decision OS implements a durable 7-state rotation machine anchored in MongoDB replica set `rs_coord:27019.decision_os_coordination.slot_rotation_log`.

```mermaid
stateDiagram-v2
    [*] --> PREPARED: Insert rotation record (w: majority, j: true)
    PREPARED --> DISPATCH_INTENT_RECORDED: Fenced CAS intent to dispatch Vault write
    DISPATCH_INTENT_RECORDED --> VAULT_WRITE_CONFIRMED: Vault KV-v2 write confirmed via CAS metadata
    VAULT_WRITE_CONFIRMED --> COMPLETED: Terminal success (HTTP 200 returned)
    DISPATCH_INTENT_RECORDED --> OUTCOME_UNKNOWN: Vault write timeout / 5xx / socket severed
    OUTCOME_UNKNOWN --> QUARANTINED: Immediate conservative fail-closed lock
    QUARANTINED --> RECONCILED: Signed dual-party SRE authorization & audit proof
    COMPLETED --> [*]: Terminal success
    QUARANTINED --> [*]: Terminal quarantine
    RECONCILED --> [*]: Terminal resolution
```

---

#### 1. Formal Schema for `decision_os_coordination.slot_rotation_log` (Finding B12-02)

The `slot_rotation_log` collection stores immutable audit trails and state progression for every credential rotation:

```json
{
  "_id": { "$type": "objectId" },
  "operationId": "op-rot-2026-11-10-001",
  "slotId": "slot_01",
  "leaseId": "lease_10928",
  "currentCredentialGeneration": 1,
  "expectedPreviousGeneration": 1,
  "newCredentialGeneration": 2,
  "status": "PREPARED",
  "owner_instance_id": "vault-gateway-7d8b9c4f-x8k2l",
  "fencing_generation": 1,
  "vault_cas_version": 1,
  "vault_target_version": 2,
  "vault_write_committed": false,
  "order_created_at_iso": "2026-11-10T10:00:00.000Z",
  "order_expiry_epoch_ms": 1794304860000,
  "authorized_caller_principal": "spiffe://decision-os.internal/ns/decision-os-system/sa/decision-os-provisioner",
  "created_at": { "$type": "date" },
  "updated_at": { "$type": "date" }
}
```

#### 2. Unique Indexes and Idempotency Constraints (Finding B12-02)
All indexes on `slot_rotation_log` are pre-created during cluster bootstrap by `decision_os_offline_bootstrap`:
1. **Idempotency Key Uniqueness:**
   ```javascript
   db.slot_rotation_log.createIndex(
     { operationId: 1 },
     { unique: true, name: "idx_unique_operation_id" }
   );
   ```
   Ensures duplicate client submissions with the same `operationId` return deterministic idempotent outcomes.
2. **Generation Monotonicity & Slot Write Lock:**
   ```javascript
   db.slot_rotation_log.createIndex(
     { slotId: 1, newCredentialGeneration: 1 },
     { unique: true, name: "idx_unique_slot_generation" }
   );
   ```
   Prevents concurrent or conflicting rotations for the same slot generation. Any attempt to insert or commit a duplicate generation fails on duplicate key error (`E11000`).
3. **Recovery Sweep Index:**
   ```javascript
   db.slot_rotation_log.createIndex(
     { status: 1, updated_at: 1 },
     { name: "idx_status_updated_at" }
   );
   ```

---

#### 3. Authoritative 12-Attribute Rotation State Transition Matrix (Finding B12-02)

| Transition ID | Current State | Target State | Trigger & Condition | Authorized Actor Principal | Expected Owner (`owner_instance_id`) | Expected Generation | Lease Expiry Condition | Atomic CAS Query Filter | Atomic Update Expression | Required Write Concern | Behavior When `matchedCount === 0` | Terminal? | Audit Event Identity |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **R-01** | `[*] (Non-existent)` | `PREPARED` | Provisioner calls rotate endpoint with signed revocation order | Gateway Worker Pod (`decision_os_vault_gateway`) | `null` | `0` | Order `orderExpiryEpochMs > now()` | `{ operationId: order.operationId }` | `$setOnInsert: { status: "PREPARED", slotId: order.slotId, leaseId: order.leaseId, currentCredentialGeneration: order.currentCredentialGeneration, expectedPreviousGeneration: order.expectedPreviousGeneration, newCredentialGeneration: order.newCredentialGeneration, owner_instance_id: self.podId, fencing_generation: 1, vault_cas_version: order.currentCredentialGeneration, vault_target_version: order.newCredentialGeneration, vault_write_committed: false, order_created_at_iso: order.orderCreatedAtISO, order_expiry_epoch_ms: order.orderExpiryEpochMs, created_at: now(), updated_at: now() }` | `w: "majority", j: true` | Duplicate key (`E11000`) $\rightarrow$ check committed status or throw `DuplicateRotationException` | No | `ROTATION_PREPARED` |
| **R-02** | `PREPARED` | `DISPATCH_INTENT_RECORDED` | Gateway prepares to dispatch KV-v2 CAS write to Vault | Gateway Worker Pod (`decision_os_vault_gateway`) | `self.podId` | `1` | Order `orderExpiryEpochMs > now()` | `{ operationId: order.operationId, status: "PREPARED", owner_instance_id: self.podId, fencing_generation: 1 }` | `$set: { status: "DISPATCH_INTENT_RECORDED", updated_at: now() }, $inc: { fencing_generation: 1 }` | `w: "majority", j: true` | Ownership lost or stale $\rightarrow$ abort write; throw `OwnershipLostException` | No | `ROTATION_DISPATCH_INTENT_RECORDED` |
| **R-03** | `DISPATCH_INTENT_RECORDED` | `VAULT_WRITE_CONFIRMED` | Gateway queries Vault metadata and proves `current_version === target_version` | Gateway Worker Pod (`decision_os_vault_gateway`) | `self.podId` | `2` | Order `orderExpiryEpochMs > now()` | `{ operationId: order.operationId, status: "DISPATCH_INTENT_RECORDED", owner_instance_id: self.podId, fencing_generation: 2 }` | `$set: { status: "VAULT_WRITE_CONFIRMED", vault_write_committed: true, confirmed_at: now(), updated_at: now() }, $inc: { fencing_generation: 1 }` | `w: "majority", j: true` | Fencing mismatch $\rightarrow$ throw `StaleGenerationException` | No | `VAULT_WRITE_COMMIT_CONFIRMED` |
| **R-04** | `VAULT_WRITE_CONFIRMED` | `COMPLETED` | Gateway formats HTTP 200 response `{ ok: 1, generation: nextGen }` | Gateway Worker Pod (`decision_os_vault_gateway`) | `self.podId` | `3` | Any | `{ operationId: order.operationId, status: "VAULT_WRITE_CONFIRMED", owner_instance_id: self.podId, fencing_generation: 3 }` | `$set: { status: "COMPLETED", completed_at: now(), updated_at: now() }, $inc: { fencing_generation: 1 }` | `w: "majority", j: true` | Response loss recovery $\rightarrow$ return idempotent 200 | **YES** | `ROTATION_COMPLETED` |
| **R-05** | `DISPATCH_INTENT_RECORDED` | `OUTCOME_UNKNOWN` | Vault write times out (>5s), returns 5xx, or socket reset | Gateway Worker Pod (`decision_os_vault_gateway`) | `self.podId` | `2` | Any | `{ operationId: order.operationId, status: "DISPATCH_INTENT_RECORDED", owner_instance_id: self.podId, fencing_generation: 2 }` | `$set: { status: "OUTCOME_UNKNOWN", failure_reason: error.message, updated_at: now() }, $inc: { fencing_generation: 1 }` | `w: "majority", j: true` | Ownership lost $\rightarrow$ abort update | No | `ROTATION_OUTCOME_AMBIGUOUS` |
| **R-06** | `OUTCOME_UNKNOWN` | `QUARANTINED` | Immediate conservative fail-closed transition following ambiguity | Gateway Worker Pod (`decision_os_vault_gateway`) | `self.podId` | `3` | Any | `{ operationId: order.operationId, status: "OUTCOME_UNKNOWN", owner_instance_id: self.podId, fencing_generation: 3 }` | `$set: { status: "QUARANTINED", quarantined_at: now(), updated_at: now() }, $inc: { fencing_generation: 1 }` | `w: "majority", j: true` | Fencing mismatch $\rightarrow$ throw `StaleGenerationException` | **YES** (Lock) | `ROTATION_SLOT_QUARANTINED` |
| **R-07** | `PREPARED` | `EXPIRED` | Background recovery sweeps abandoned rotation preparation | Recovery Service Pod (`decision_os_recovery_service`) | Any | Any active gen $G$ | Order `orderExpiryEpochMs <= now()` | `{ operationId: opId, status: "PREPARED", order_expiry_epoch_ms: { $lte: now() }, fencing_generation: expectedGen }` | `$set: { status: "EXPIRED", expired_by: self.recoveryId, updated_at: now() }, $inc: { fencing_generation: 1 }` | `w: "majority", j: true` | Gateway advanced state $\rightarrow$ abort sweep | **YES** | `ABANDONED_ROTATION_EXPIRED` |
| **R-08** | `QUARANTINED` | `RECONCILED` | Dual-party SRE + Compliance order proves Vault commit state | Administrative Reconciler (`decision_os_admin_reconciler`) | Offline SRE | Any active gen $G$ | Signed Order Validated | `{ operationId: order.operationId, status: "QUARANTINED", fencing_generation: expectedGen }` | `$set: { status: "RECONCILED", reconciled_by: order.operatorId, incident_ref: order.incidentRef, updated_at: now() }, $inc: { fencing_generation: 1 }` | `w: "majority", j: true` | Stale reconciliation order $\rightarrow$ reject | **YES** | `ROTATION_ADMIN_RECONCILED` |

---

#### 4. Comprehensive Analysis of All 8 Rotation Crash Points (Findings B12-02, B12-07)

Decision OS analyzes crash and partition recovery across every possible failure point in the rotation sequence:

1. **Crash Point CP-1: Crash Before `PREPARED` Insert:**
   - *Failure:* Gateway crashes before writing to `rs_coord:27019.slot_rotation_log`.
   - *State:* Zero records exist in MongoDB; Vault has not been contacted.
   - *Recovery:* Provisioner reconnects and re-submits `POST /v1/vault-gateway/slots/:slot_id/rotate` with the same signed revocation order. Gateway processes R-01 normally.

2. **Crash Point CP-2: Crash After `PREPARED` Insert, Before MongoDB `updateUser`:**
   - *Failure:* Gateway persists `PREPARED`, but crashes before the Provisioner confirms server-side MongoDB `updateUser`.
   - *State:* `slot_rotation_log` is `PREPARED`. MongoDB still has generation $N$. Vault has generation $N$.
   - *Recovery:* If order expires, Recovery Service marks `EXPIRED` (R-07). If Provisioner retries before expiry with the same `operationId`, Gateway advances to R-02.

3. **Crash Point CP-3: Crash After MongoDB `updateUser` Commits, Before Gateway Receives Rotate Call:**
   - *Failure:* Provisioner successfully executed `updateUser` on `rs_test:27018` with majority confirmation (`w: "majority", j: true`), but network drops before Provisioner reaches Gateway rotate endpoint.
   - *State:* MongoDB is at generation $N+1$; Vault is still at generation $N$.
   - *Recovery:* Provisioner reconnects over mTLS and dispatches `POST /v1/vault-gateway/slots/:slot_id/rotate`. Gateway inserts `PREPARED` (R-01) and advances to intent recording (R-02).

4. **Crash Point CP-4: Crash After `DISPATCH_INTENT_RECORDED` Commits, Before Vault KV-v2 Write:**
   - *Failure:* Gateway persists intent (R-02), but crashes before TCP bytes are transmitted to Vault port 8200.
   - *State:* MongoDB shows `DISPATCH_INTENT_RECORDED`. Vault KV-v2 has not been contacted.
   - *Recovery:* Gateway heartbeat expires. Recovery Service discovers unconfirmed in-flight record. Rather than blindly re-writing to Vault, Recovery Service initiates CAS Metadata Discovery (see subsection 5 below) to query Vault metadata. Discovering that Vault is still at version $N$, Recovery transitions record to `QUARANTINED` (R-06) to prevent stale overwrites.

5. **Crash Point CP-5: Crash or Timeout During Vault KV-v2 Write Execution:**
   - *Failure:* Gateway dispatches HTTP PUT/POST to `/v1/secret/data/slots/:slot_id`. Socket is severed, or Vault takes >5000ms.
   - *State:* Ambiguous whether Vault committed the write to durable Raft storage.
   - *Recovery:* Gateway catches socket timeout, sets state to `OUTCOME_UNKNOWN` (R-05), and immediately transitions to `QUARANTINED` (R-06). Automated redispatch is strictly prohibited. CAS metadata query is executed by reconciler.

6. **Crash Point CP-6: Crash After Vault Write Commits, Before `VAULT_WRITE_CONFIRMED` Commits:**
   - *Failure:* Vault KV-v2 committed version $N+1$, but Gateway crashes before persisting R-03 in MongoDB.
   - *State:* Vault is at version $N+1$. `slot_rotation_log` shows `DISPATCH_INTENT_RECORDED`.
   - *Recovery:* When Provisioner polls `rotate-status?operationId=...` or Recovery Service sweeps, the Gateway executes CAS Metadata Discovery: querying `GET /v1/secret/metadata/slots/:slot_id`. Seeing `current_version === newCredentialGeneration`, Gateway safely advances to `VAULT_WRITE_CONFIRMED` (R-03) and `COMPLETED` (R-04) without re-writing to Vault.

7. **Crash Point CP-7: Crash After `VAULT_WRITE_CONFIRMED` Commits, Before HTTP 200 Received:**
   - *Failure:* State is committed as `VAULT_WRITE_CONFIRMED` / `COMPLETED`, but response packet to Provisioner is dropped by network.
   - *State:* Both MongoDB and Vault are fully synchronized at generation $N+1$.
   - *Recovery:* Provisioner queries `GET /v1/vault-gateway/slots/:slot_id/rotate-status?operationId=op-rot-2026-11-10-001`. Gateway queries `slot_rotation_log`; finding `COMPLETED`, it returns `HTTP 200 { ok: 1, generation: 2 }` idempotently.

8. **Crash Point CP-8: Split-Brain or Concurrent Gateway Pod Execution:**
   - *Failure:* Two Gateway pods attempt to process rotations for the same slot concurrently.
   - *State:* Both attempt R-01 or R-02.
   - *Recovery:* Unique index `{ slotId: 1, newCredentialGeneration: 1 }` guarantees that only one pod can insert the target generation record. The losing pod throws duplicate key error (`E11000`) and aborts immediately. Monotonic generation fencing prevents split-brain corruption.

---

#### 5. Discovering Vault Write Commit via Check-and-Set Metadata Query (Finding B12-02)

To safely resolve ambiguous crash states (CP-4, CP-5, CP-6) without performing dangerous duplicate rotations, Decision OS establishes the **CAS Metadata Discovery Protocol**:

```typescript
// Discovery function executed by Gateway or Recovery Service
async function discoverVaultRotationCommit(
  slotId: string,
  expectedPreviousGen: number,
  newCredentialGen: number
): Promise<"COMMITTED" | "NOT_COMMITTED" | "AMBIGUOUS"> {
  try {
    // 1. Ephemeral scoped token for metadata read on slotId
    const metadata = await vaultClient.getSlotMetadata(slotId);
    
    // 2. Check current version
    if (metadata.current_version === newCredentialGen) {
      // The write committed to durable Vault storage
      return "COMMITTED";
    } else if (metadata.current_version === expectedPreviousGen) {
      // The write did not commit; Vault remains at previous version
      return "NOT_COMMITTED";
    } else {
      // Version unexpected (regression or jump); fail closed
      return "AMBIGUOUS";
    }
  } catch (err) {
    // If Vault metadata is unreachable, fail closed
    return "AMBIGUOUS";
  }
}
```

If `discoverVaultRotationCommit` returns `COMMITTED`, the state machine safely advances $	ext{DISPATCH_INTENT_RECORDED} 
ightarrow 	ext{VAULT_WRITE_CONFIRMED} 
ightarrow 	ext{COMPLETED}$. If it returns `NOT_COMMITTED` or `AMBIGUOUS`, the record immediately transitions to `QUARANTINED`, preserving system safety and isolating the slot.

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
| **11. Credential self-rotation succeeds on MongoDB, worker retains socket (B38-40)** | Slot admin password rotated via `updateUser` (`changeOwnPassword`); lingering client socket exists. | `CLAIMED` (Phase 2 verified) | Phase 1 netfilter drops wire packets; Phase 3 terminates sessions/ops. MongoDB engine re-evaluates verifier $\rightarrow$ Code 11/13/18. | Server-side majority ack on `updateUser`. | **FORBIDDEN.** Retained credentials permanently invalidated. |
| **12. MongoDB unavailable during credential revocation (B38-40)** | `updateUser` or `dropUser` cannot commit to majority. | `CLAIMED` (Phase 2 stalled) | **FAIL CLOSED.** Slot moves immediately to `QUARANTINED`. Slot reassignment strictly blocked. | SRE probe of replica set; manual reconciliation. | **FORBIDDEN.** Reassignment blocked. |
| **13. Vault unavailable during lease termination (B38-40)** | MongoDB rotation committed; Vault secret write failed or timed out. | `CLAIMED` (Vault out of sync) | **FAIL CLOSED.** Slot moves to `QUARANTINED`. Slot reassignment blocked until Vault is synchronized. | Synchronous Vault secret write verification. | **FORBIDDEN.** |
| **14. Revocation command times out with unknown outcome (B38-40)** | `updateUser` socket severed; unknown if server rotated password. | `CLAIMED` (Ambiguous rotation) | **FAIL CLOSED.** Move to `QUARANTINED`. Control plane probes server credential verifier directly. | Direct SCRAM verifier inspection on `rs_test`. | **FORBIDDEN.** Reassignment strictly prohibited. |
| **15. Premature slot reassignment attempt (B38-40)** | Attacker attempts to lease slot before revocation confirmation. | `CLAIMED` / `ROTATING` | Coordination Authority CAS rejects lease acquisition (`previous_credential_revoked != true`). | Valid CAS guard in `ownership_locks`. | **FORBIDDEN.** |
| **16. Previous worker attempts authentication post-reassignment (B38-40)** | Old worker presents password $P_N$ after slot rotated to $P_{N+1}$. | `AVAILABLE` / `CLAIMED` by new worker | MongoDB SCRAM authentication engine throws Error Code 18 (`AuthenticationFailed`). | Wire protocol rejection by MongoDB daemon. | **FORBIDDEN.** |
| **17. Controller crashes between MongoDB rotation and ledger commit (B38-40)** | MongoDB updated password; `cleanup_ledger` shows incomplete Phase 2. | `CLAIMED` | Recovery coordinator probes MongoDB directly to verify password state, updates ledger or moves to `QUARANTINED`. | Direct server credential probe. | **FORBIDDEN.** Slot never released prematurely. |
| **18. Direct Vault JWT Auth bypass attempt / Gateway timeout (B38-41)** | Worker/Provisioner attempts direct connection to Vault port 8200; or timeout occurs between Gateway and Vault during redemption. | `VAULT_REQUEST_SENT` in `jwt_redemptions` | Direct caller dropped by Layer 4 NetworkPolicy (no route). If timeout occurs during Vault request, Gateway fails closed: marks `OUTCOME_UNKNOWN` $\rightarrow$ `QUARANTINED`. Blind retry with same `jti` is strictly rejected with HTTP 409 Conflict; provisioner must abort and acquire fresh lease with newly minted `jti`. | Kubernetes NetworkPolicy + durable 7-state machine in `rs_coord:27019.jwt_redemptions` with majority journaling. | **FORBIDDEN.** Zero direct Vault access; zero secondary token minting; blind retry strictly prohibited. |
| **19. Suspected Nonce Allocator compromise or backup restore (B38-42)** | Watchdog detects regressed sequence; potential nonce collision. | `NORMAL_OPERATION` | **EMERGENCY KILL-SWITCH.** Trip `rs_coord.emergency_halt = true`. Quarantine entire key epoch. Reject from workflows. | SRE incident investigation; WORM checkpoint audit. | **FORBIDDEN.** Naive re-encryption strictly prohibited. |
| **20. Plaintext candidate presents mismatched or post-incident WORM evidence (B38-42)** | Recovered candidate plaintext fails SHA-256 digest match or evidence creation timestamp $ge t_{\text{compromise}}$. | `QUARANTINED` | **FAIL CLOSED.** Candidate plaintext permanently rejected. Quarantined envelope marked `REJECTED_DISCARDED`. SRE restores from external cold backup or discards. | Pre-incident Canonical WORM Plaintext Evidence Record ($t_{\text{evidence}} < t_{\text{compromise}}$). | **FORBIDDEN.** Re-encryption of unverified data strictly prohibited. |

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

### 11.5 Administrative Reconciliation Authorization, External Vault Audit Delivery & Forensic Verification (Findings B11-05, B12-01)

When a JWT redemption transitions to `QUARANTINED` due to a Vault timeout, ambiguous 5xx response, network severance, or crash after `VAULT_REQUEST_SENT`, the associated `jti` and partition slot are permanently locked. Decision OS establishes an independent, cryptographically authenticated administrative reconciliation process to safely evaluate and resolve quarantined redemptions without risking secret compromise or duplicate token issuance.

#### 1. Authority Separation & Prohibition of Operational Bypass
1. **Gateway Prohibition:** The ordinary Vault Gateway service account (`decision_os_vault_gateway`) has **zero authority** to execute administrative reconciliation or unquarantine records.
2. **Provisioner Prohibition:** The Provisioning Service (`decision_os_provisioner`) has **zero authority** to unquarantine or reset redemption state.
3. **Dedicated Administrative Principal:** Administrative reconciliation must be initiated exclusively by an authenticated **Site Reliability Engineering Lead** using principal `decision_os_admin_reconciler` via offline mutual TLS with hardware-backed client certificates (`auth/cert/sre-admin`).
4. **Rejection of Operator Assertion as Proof:** An operator's subjective claim that "Vault did not issue a token" is explicitly rejected as architectural proof. Reconciliation requires independent, auditable cryptographic evidence.

#### 2. Dual-Party Signed Authorization Order Schema
To eliminate single-operator insider risk and prevent unauthorized unquarantine of exposed slots, releasing a quarantined redemption strictly requires a signed **Dual-Party Reconciliation Order**:

```json
{
  "$schema": "https://specs.decision-os.internal/schemas/v2/jwt-reconciliation-order.json",
  "reconciliationOrderId": "rec-ord-7f8e9d0a-1b2c-3d4e-5f6a-7b8c9d0e1f2a",
  "targetJti": "jti-2026-11-10-slot01-lease10928",
  "slotId": "slot_01",
  "leaseId": "lease_10928",
  "incidentRef": "INC-2026-11-10-VAULT-001",
  "operatorPrincipal": "sre_lead_operator_amit",
  "operatorRole": "SRE_LEAD",
  "approvalPrincipal": "security_compliance_officer_priya",
  "approvalRole": "COMPLIANCE_OFFICER",
  "reconciliationAction": "UNQUARANTINE_AND_RELEASE_SLOT",
  "vaultAuditEvidence": {
    "vaultAuditLogEntryId": "audit-log-2026-11-10-req-99182",
    "vaultAuditVerifiedAtISO": "2026-11-10T11:00:00.000Z",
    "tokenIssuanceProven": false,
    "tokenRevocationProven": true,
    "zeroSecretReadProven": true,
    "externalWormStorageUri": "s3://decision-os-audit-worm-prod/vault/2026/11/10/audit-req-99182.json",
    "vaultAuditSha256": "4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b"
  },
  "orderCreatedAtISO": "2026-11-10T11:30:00.000Z",
  "orderCreatedAtEpochMs": 1794310200000,
  "orderExpiryEpochMs": 1794313800000,
  "operatorSignature": "MEUCIQD...",
  "complianceSignature": "MEQCIG..."
}
```

- **Canonical Serialization:** Serialized under RFC 8785 JSON Canonicalization Scheme (JCS).
- **Domain Separation Prefixes:**
  - Operator Signature covers: `UTF8("DECISION_OS_JWT_RECONCILIATION_SRE_V1:") || JCS(orderWithoutSignatures)`
  - Compliance Signature covers: `UTF8("DECISION_OS_JWT_RECONCILIATION_COMPLIANCE_V1:") || JCS(orderWithoutSignatures)`

#### 3. External Vault Audit Delivery Architecture & Independent Forensic Verification (Finding B12-01)

The previous architecture granted `slot-admin-reconciler` access to `sys/audit` and described that access as audit-event inspection. In HashiCorp Vault, `sys/audit` configures audit devices and reports enabled sinks, but does **NOT** return audit events via HTTP GET. Decision OS formalizes the complete external audit delivery and forensic retrieval architecture:

```mermaid
flowchart LR
    subgraph VaultPod ["Vault Cluster (decision-os-system)"]
        VAULT["Vault Server Port 8200"]
        AUDIT_DEV["Vault 'file' Audit Device"]
        PIPE["Named Pipe / Local FIFO /var/log/vault/audit.log"]
        VAULT --> AUDIT_DEV --> PIPE
    end

    subgraph Sidecar ["Log Shipping Agent"]
        FLUENT["Fluent Bit / Vector Daemon (mTLS TLS 1.3)"]
        PIPE --> FLUENT
    end

    subgraph Storage ["External Immutable WORM Storage"]
        WORM["AWS S3 Object Lock (COMPLIANCE Mode >= 7 Yrs) / GCS Bucket Lock"]
        FLUENT --> WORM
    end

    subgraph Forensic ["Dedicated Forensic Inspection"]
        INVESTIGATOR["decision_os_audit_investigator (Read-Only WORM Identity)"]
        RECONCILER["decision_os_admin_reconciler (Offline SRE + Compliance)"]
        WORM --> INVESTIGATOR --> RECONCILER
    end
```

1. **Distinction of Audit Planes:**
   - **Audit Device Configuration (`sys/audit`):** Administrative control plane restricted to cluster bootstrap. Reports enabled sinks; returns zero audit events.
   - **Emitted Audit Events:** Formatted as single-line JSON records emitted synchronously by Vault core before HTTP response dispatch.
   - **External Audit Storage:** Immutable write-once cloud object storage retaining logs independently of the Vault cluster lifecycle.
   - **Forensic Evidence Retrieval:** Read-only retrieval executed exclusively by forensic investigators against external WORM storage.
2. **External Audit Delivery Specifications:**
   - *Device Type:* Vault native `file` audit device configured with `log_raw = false` and `hmac_accessor = true`. Emits audit entries to a dedicated local named pipe (`/var/log/vault/audit.log`).
   - *Shipping Agent:* Fluent Bit / Vector running as a sidecar container in the Vault pod. It reads from the FIFO buffer and streams log records in real time over mutual TLS (TLS 1.3) with pinned certificate authorities.
   - *Destination & WORM Retention:* Cloud object storage (AWS S3 Object Lock in `COMPLIANCE` mode or Google Cloud Storage Bucket Lock) with retention period $\ge 7$ years. Object overwrite, deletion, or premature retention reduction is mathematically and physically impossible.
   - *Backpressure & Failure Handling:* If the audit device pipe blocks or fills, Vault core **halts further request processing** (fail-closed audit invariant). Vault will refuse client traffic rather than process requests without audit recording.
3. **Dedicated Read-Only Forensic Identity (`decision_os_audit_investigator`):**
   - Forensic evidence retrieval is granted exclusively to `decision_os_audit_investigator`.
   - *Permissions:* Read-only (`s3:GetObject`, `storage.objects.get`) on the audit storage bucket.
   - *Zero Secret Access:* Possesses **zero IAM permissions, zero network routes, and zero Vault policies** granting access to Vault secret data (`secret/data/*`) or rotation endpoints.
4. **Exact Forensic Evidence & Correlation Contract:**
   Vault JSON audit entries contain structured fields including:
   - `time`: RFC 3339 timestamp of the operation;
   - `type`: `"request"` or `"response"`;
   - `auth.client_token`: SHA-256 HMAC of the minted client token;
   - `auth.metadata.slot_id`: The slot identifier claim extracted from the JWT;
   - `auth.metadata.lease_id`: The lease identifier claim;
   - `request.id`: Unique UUID generated by Vault for the HTTP transaction;
   - `request.operation`: `"update"` (login) or `"read"` (secret retrieval);
   - `request.path`: `"auth/jwt/login"` or `"secret/data/slots/slot_NNN"`;
   - `response.data`: Redacted response payload metadata;
   - `error`: Error message if request failed.
   The reconciler correlates these records against Gateway transaction identifiers: `jti`, `operationId`, `slotId`, and `fencing_generation`.
5. **Rigorous Proof Requirements for Administrative Action:**
   - **Case A: Token Non-Issuance Proof (Release to Available):**
     Vault audit logs show that the login request was rejected (e.g. `HTTP 401 Unauthorized` due to invalid signature or expired claim), or no `auth/jwt/login` entry exists for `jti` within the transaction window $[t_{	ext{dispatched}} - 5	ext{s}, t_{	ext{dispatched}} + 30	ext{s}]$. Proves zero client token was minted. Slot may be unquarantined and released.
   - **Case B: Token Revoked Before Secret Read:**
     Audit logs prove that a token was issued, but was explicitly revoked via `/sys/leases/revoke` or TTL expiry with zero corresponding `GET /v1/secret/data/slots/:slot_id` access logs. Slot may be released.
   - **Case C: Secret Read Detected (Compromise Protocol):**
     If audit logs show that `GET /v1/secret/data/slots/:slot_id` completed with HTTP 200, credentials were exposed on the wire. Direct unquarantine is **strictly prohibited**. The slot administrator must execute an immediate server-side MongoDB password rotation (`updateUser`) and Vault password reset before the slot can ever be returned to the allocatable pool.
6. **Handling Delayed, Incomplete, Duplicated, or Unavailable Audit Logs:**
   - *Strict Fail-Closed Policy:* If the external audit log stream is delayed (pipeline lag > 30s), incomplete, corrupted, or temporarily unavailable, administrative unquarantine is **STRICTLY BLOCKED**.
   - *API Response:* The reconciliation handler rejects unquarantine requests with `HTTP 424 Failed Dependency: Vault audit log continuity not verified`. Operators cannot override this block. The slot remains safely `QUARANTINED` until complete forensic continuity is re-established.

#### 4. Strict Conditions for `QUARANTINED` $
ightarrow$ `RECONCILED` Transition
Reconciliation executes Transition T-08 in MongoDB replica set `rs_coord:27019.jwt_redemptions` strictly under the following atomic CAS filter:
```javascript
const result = await db.collection("jwt_redemptions").updateOne(
  {
    _id: order.targetJti,
    status: "QUARANTINED",
    slot_id: order.slotId,
    lease_id: order.leaseId,
    fencing_generation: expectedGeneration
  },
  {
    $set: {
      status: "RECONCILED",
      reconciled_by: order.operatorPrincipal,
      approved_by: order.approvalPrincipal,
      incident_ref: order.incidentRef,
      reconciliation_order_id: order.reconciliationOrderId,
      reconciled_at: new Date()
    },
    $inc: { fencing_generation: 1 }
  },
  { writeConcern: { w: "majority", j: true } }
);

if (result.matchedCount === 0) {
  throw new StaleGenerationException(
    `Administrative reconciliation rejected: target jti ${order.targetJti} is not in QUARANTINED state or fencing generation has advanced`
  );
}
```
Every successful reconciliation is written to `decision_os_coordination.cleanup_audit_log` with cryptographic SHA-256 hash chaining.

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

## 14. Architecture Security Review — B38-01 through B38-42

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


### B38-36: Eliminate the Broker's Cross-Database Administrative Blast Radius (Phase B.8)
- **Defect:** The v1.7.0 dynamic credential broker possessed user- and role-management actions across `{ db: "", collection: "" }` on `rs_test`. In MongoDB RBAC, this is an unrestricted wildcard covering all non-system databases. Application-level regex checks (`^decision_os_test_.*$`), signed API claims, and separate container boundaries cannot constrain an attacker who compromises the broker and authenticates directly to MongoDB.
- **Remediation (Phase B.8):**
  1. Explicitly acknowledged that `{ db: "", collection: "" }` is a cross-database administrative authority under MongoDB RBAC that cannot be constrained natively by application logic.
  2. Selected the **Pre-Provisioned Per-Target Administrative Principals Architecture** as the canonical runtime architecture: standard test execution leases strictly from pre-allocated partition slots (`decision_os_test_slot_000` through `slot_255`), where each slot $k$ has its own scoped database admin (`decision_os_db_admin_slot_${k}`) scoped strictly to `{ db: "decision_os_test_slot_" + k, collection: "" }`.
  3. Eliminated the central runtime broker holding broad shared credentials from the active worker execution path.
  4. Specified non-existent database handling: any request targeting an unallocated or non-existent database is strictly rejected with `UnallocatedDatabaseException`.
  5. Designated dynamic capacity scaling strictly as an **Offline / Control-Plane Root of Trust** (`deploy/init-mongo-test.sh`). Any optional dynamic broker is classified as an uncontained control-plane root of trust and disabled by default in production (`DECISION_OS_DYNAMIC_PROVISIONING_ENABLED=false`).
  6. Added negative authorization verification item **`D38-36`**.
- **Status:** REMEDIATED (PHASE B.8) — PENDING INDEPENDENT REVIEW.

### B38-37: Partition Slot Vault Must Enforce Exact Lease-to-Secret Binding (Phase B.8)
- **Defect:** The v1.7.0 Partition Slot Vault specification lacked an exact policy and identity model to bind a signed lease claim to exactly one secret path, leaving open the risk of path guessing or substitution attacks by a compromised provisioner.
- **Remediation (Phase B.8):**
  1. Specified the exact HashiCorp Vault templated identity policy:
     ```hcl
     path "secret/data/slots/{{identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id}}" {
       capabilities = ["read"]
     }
     path "secret/data/slots/*" {
       capabilities = ["deny"]
     }
     path "secret/metadata/*" {
       capabilities = ["deny"]
     }
     ```
  2. Defined the single-use JWT exchange model: coordination authority issues an Ed25519-signed JWT containing the leased `slot_id`. The provisioner exchanges this at `/v1/auth/jwt/login` for an ephemeral Vault token.
  3. Vault validates the signature against the coordination public key, extracts `slot_id` into entity alias metadata `identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id`, and issues a single-use token (`num_uses = 1`, `ttl = 60s`, `renewable = false`).
  4. Natively prevented path guessing and path substitution: direct API calls to `GET /v1/secret/data/slots/slot_02` using a token bound to `slot_01` are rejected by Vault's policy engine with HTTP 403 Forbidden.
  5. Defined token lifecycle: destroyed immediately upon single read; audit logging of caller entity, lease ID, bound slot ID, and client IP.
  6. Added direct Vault API path substitution verification item **`D38-37`**.
- **Status:** REMEDIATED (PHASE B.8) — PENDING INDEPENDENT REVIEW.

### B38-38: Define the Nonce Allocator as an Explicit Cryptographic Root of Trust (Phase B.8 / Refined B.9 & B.10)
- **Defect:** v1.7.0 claimed unconditional mathematical certainty of nonce uniqueness without recognizing that MongoDB RBAC cannot enforce monotonic `$inc` semantics against an authorized identity holding `update` privileges, and lacked a formal compromise response protocol.
- **Remediation (Phase B.8 / Refined B.9 & B.10 via B38-42):**
  1. Clearly distinguished three compromise classes: provisioner compromise (prevented by RBAC), allocator compromise (cryptographic root of trust; detected and recoverable, but NOT preventable at the MongoDB RBAC layer), and coordination replica set compromise.
  2. Formally documented why MongoDB 8.0 RBAC actions cannot distinguish `$inc` from `$set` (privilege action is collection-level `update`) and why `$jsonSchema` cannot enforce inter-update temporal monotonicity ($x_{\text{new}} > x_{\text{old}}$).
  3. Defined the emergency response protocol, formally refined in B38-42 to eliminate false claims that re-encryption or key rotation retroactively repairs historical confidentiality loss or tag forgery:
     - *Emergency Encryption Halt (Kill-Switch):* Watchdog detects regressed block boundaries and asserts the emergency halt latch (`rs_coord.emergency_halt = true`), immediately halting active encryption across all workers.
     - *KMS Key Material Retirement & Epoch Invalidation:* KMS retires active key material and increments `KeyVersionPrefix` (e.g. `0x0001` $\rightarrow$ `0x0002`), mathematically guaranteeing that newly encrypted ciphertexts cannot collide with old ciphertexts even if sequence numbers were reset.
     - *Quarantine & Independent Plaintext Validation:* Compromised epoch envelopes are quarantined. Unquarantining requires pre-incident Canonical WORM Plaintext Evidence Records and dual-party SRE/Security sign-off before re-encryption (B38-42).
     - *Sequence Re-Seeding & Audit:* Sequence document re-seeded under `_id: "nonce_seq_v2"`, and audit ledger hash-chain traversed to verify external checkpoints.
  4. Clarified that the Monotonicity Watchdog is a detection and circuit-breaking mechanism, not retroactive collision reversal.
  5. Formally stated the 4 conditional trust assumptions for $P(\text{collision}) = 0$, explicitly rejecting claims of unconditional mathematical certainty.
  6. Added adversarial verification item **`D38-38`**.
- **Status:** REMEDIATED (PHASE B.8) — REFINED IN B38-42 — PENDING INDEPENDENT REVIEW.

### B38-39: Normalize Revocation Execution Ordering (Phase B.8)
- **Defect:** Revocation descriptions had inconsistent execution orderings across diagrams, tables, and saga descriptions, lacked an explicit execution-phase column in the operation matrix, and did not enforce crash recovery and prerequisite gating prior to database drop.
- **Remediation (Phase B.8):**
  1. Established **one canonical 5-Phase Ordered Revocation State Machine** across the entire document:
     - **Phase 1: Network Transport Fencing (`NET_FENCED`)**
     - **Phase 2: Scoped Worker Identity Revocation (`IDENTITY_REVOKED`)**
     - **Phase 3: In-Flight Operation & Session Cancellation (`OPS_KILLED`)**
     - **Phase 4: Database Storage Deletion (`STORAGE_DROPPED`)**
     - **Phase 5: Audit & Evidence Finalization (`AUDIT_FINALIZED`)**
  2. Added an explicit `Execution Phase` column to Section 7.9.4 Operation Allocation Matrix and ordered rows by phase.
  3. Reconciled sequence diagram (Section 6), state machine table (Section 9.3), saga transitions, audit event emissions, and recovery protocols.
  4. Defined durable acknowledgements in `cleanup_ledger` for every phase (`phase1_net_fenced_at`, `phase2_identity_revoked_at`, `phase3_ops_killed_at`, `phase4_storage_dropped_at`, `phase5_audit_finalized_at`).
  5. Enforced an atomic prerequisite gate: `dropDatabase` strictly refuses to execute if Phases 1, 2, or 3 are null or unverified in `cleanup_ledger`, failing closed to `QUARANTINED`.
  6. Defined idempotent crash recovery at each phase boundary.
  7. Added canonical ordering and crash recovery verification item **`D38-39`**.
- **Status:** REMEDIATED (PHASE B.8) — PENDING INDEPENDENT REVIEW.
### B38-40: Correct MongoDB Self-Credential Rotation Privilege and Invariant Enforcement (Phase B.9 / Refined B.10)
- **Defect:** In v1.8.0, partition slot administrators (`decision_os_db_admin_slot_${k}`) possessed static passwords stored in Vault, decoupling token expiry from credential validity. In v1.9.0, the privilege action was incorrectly specified as `changePassword` for slot admin self-rotation. In MongoDB RBAC, `changePassword` authorizes changing *other* users' passwords, whereas self-rotation strictly requires `changeOwnPassword`. Granting `changePassword` was both unnecessary and caused authorization failure or excessive privilege expansion.
- **Remediation (Phase B.10):**
  1. Selected **Option B (Slot Credential Rotation at Every Lease Boundary)** as the canonical production architecture for scoped slot administrators (`decision_os_db_admin_slot_${k}`), combined with **Option A (Per-Lease MongoDB Identities)** for worker execution principals (`decision_os_worker_${leaseId}_gen${generation}`).
  2. Enforced **`actions: ["changeOwnPassword"]`** on `{ db: "decision_os_test_slot_" + k, collection: "" }` for slot administrator self-rotation across every privilege matrix, operation allocation, sequence diagram, and failure mode.
  3. Explicitly excluded the broader `changePassword` action from the slot admin role definition.
  4. Preserved Mandatory Invariants 1–8:
     - Invariant 1: A credential issued for lease $N$ must not authenticate after lease $N$ is revoked.
     - Invariant 2: A slot cannot transition to a new lease while the previous lease's credential remains valid.
     - Invariant 3: Vault token expiry must never be treated as proof of MongoDB credential revocation.
     - Invariant 4: Revocation must be confirmed by the MongoDB control plane (`w: "majority", j: true`), not inferred from an application response.
     - Invariant 5: Failure or timeout during credential revocation leaves the slot quarantined (`QUARANTINED`).
     - Invariant 6: A stale worker must not regain access through a previously retained password.
     - Invariant 7: Credential revocation, session termination, network fencing, and slot reassignment must follow the canonical 5-phase order.
     - Invariant 8: Killing sessions alone does NOT invalidate a retained password; server-side `updateUser` with `changeOwnPassword` (for slot admins) and `dropUser` (for workers) is the mandatory invalidation boundary.
  5. Established strict Slot Reassignment Release Gate requiring `previous_credential_revoked === true`, `credential_generation === expectedGen`, and `state === 'CLEANED'`.
  6. Revised test specification **`D38-40`**.
- **Status:** REMEDIATED (PHASE B.10) — PENDING INDEPENDENT REVIEW.

### B38-41: Enforce Vault Gateway Ingress Boundary, Durable JWT Redemption State Machine & Workload Identity Model (Phase B.9 / Refined B.10, B.11 & B.12)
- **Defect:** In earlier versions, sequence diagrams contradicted network policy by showing the provisioner making direct Vault API calls to read secrets and write rotated credentials. Furthermore, Kubernetes NetworkPolicy was described as filtering URL paths (impossible at Layer 3/4); the gateway was denied MongoDB `update` privileges despite needing to advance redemption state; the redemption state machine relied on a naive insert-and-409 pattern that could not safely handle crashes during or after Vault token issuance; and stale `identity.entity.metadata.slot_id` references remained.
- **Remediation (Phase B.11 & B.12 Refinements):**
  1. Reconciled the architecture around **one coherent topology: All Vault API interactions pass strictly through the Dedicated Vault Gateway (`apps/vault-gateway`, service account `decision_os_vault_gateway`)**. Direct network routes to Vault port 8200 from workers or provisioners are completely eliminated.
  2. The Provisioner authenticates to the Gateway over mTLS presenting verified SPIFFE workload identity (`spiffe://decision-os.internal/ns/decision-os-system/sa/decision-os-provisioner`) and signed lease JWT. The Provisioner never receives a Vault client token; Gateway returns only minimal DB credentials (`username`, `password`). Credential rotation writes also pass through Gateway (`POST /v1/vault-gateway/slots/:slot_id/rotate`).
  3. Acknowledged Layer 3/Layer 4 realities: Kubernetes `NetworkPolicy` restricts Vault port 8200 ingress strictly to Gateway pods. Enforced mandatory Kubernetes RBAC and Admission Control (ValidatingAdmissionWebhook) to prevent pod label spoofing.
  4. Scoped runtime Gateway MongoDB permissions strictly to `actions: ["find", "insert", "update"]` on `rs_coord:27019.jwt_redemptions`. Action `createIndex` is **strictly removed** from runtime roles (pre-created during bootstrap).
  5. Formalized the **7-state durable redemption state machine** (`CLAIMED` $\rightarrow$ `VAULT_REQUEST_SENT` $\rightarrow$ `ISSUED` / `OUTCOME_UNKNOWN` $\rightarrow$ `QUARANTINED` / `RECONCILED` / `EXPIRED`) with monotonic `fencing_generation` and `owner_instance_id` CAS filters on every transition.
  6. Resolved dispatch-intent vs actual Vault request ambiguity: `VAULT_REQUEST_SENT` proves intent to dispatch, NOT wire delivery. Analyzed all 11 explicit crash and concurrency failure points, enforcing conservative fail-closed quarantine (`OUTCOME_UNKNOWN` $\rightarrow$ `QUARANTINED`) when Vault issuance outcome cannot be proven. Blind retries and secondary token issuances are strictly rejected.
  7. Formally established four non-interchangeable guarantees: (1) at-most-once authorization, (2) at-most-once token issuance, (3) at-most-once credential delivery, and (4) idempotent response behavior.
  8. Defined the Authoritative Recovery Service (`apps/recovery-service`) for stale redemptions (zero route to Vault; can safely expire un-dispatched claims, but must quarantine in-flight requests).
  9. Reconciled all occurrences of Vault templating syntax globally to Entity Alias Metadata (`identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id`).
  10. Revised adversarial test specification **`D38-41`** to 16 comprehensive verification items.
- **Status:** REMEDIATED (PHASE B.12) — PENDING INDEPENDENT REVIEW.

### B38-42: Concrete Canonical WORM Plaintext Evidence Record, Byte-Exact Signature Semantics & Independent Proof (Phase B.9 / Refined B.10, B.11 & B.12)
- **Defect:** In earlier versions, the WORM evidence schema suffered a 1-year mismatch between ISO and epoch milliseconds; field inventory was inconsistent across sections; byte-exact Ed25519 signature payload semantics were undefined; signer-controlled timestamps were erroneously described as proof against backdating without independent trust; and the illustrative SHA-256 digest was mathematically incorrect.
- **Remediation (Phase B.11 & B.12 Refinements):**
  1. Synchronized timestamp representations to the exact same millisecond: `evidenceCreatedAtISO: "2026-11-10T10:00:00.000Z"` $\leftrightarrow$ `evidenceCreatedAtEpochMs: 1794304800000`, with strict validation rule `evidenceCreatedAtEpochMs === Date.parse(evidenceCreatedAtISO)`.
  2. Formalized the authoritative **26-field inventory** for `CanonicalWormPlaintextEvidenceRecord` Schema v2.2.0 across all sections.
  3. Corrected plaintext byte length to exactly **117 bytes** (`Buffer.from(canonicalJson, "utf8").length === 117`), correcting the old 115 specification.
  4. Corrected candidate decision payload SHA-256 digest to mathematically verified value:
     `90ca3b570b7e806657a928518b70ee710b342ea6e315187e7a1dcc4b409cab4e`.
     The previous erroneous digest (`3ebb5052...`) was permanently eliminated and preserved solely in historical defect descriptions.
  5. Formalized the multi-stage non-circular Merkle commitment pipeline: Core construction $\rightarrow$ HSM signature $\rightarrow$ RFC 3161 TSA token over `CoreDigest || UTF8(signature)` $\rightarrow$ RFC 6962 Leaf Hash $\rightarrow$ Merkle Tree Checkpoint & Inclusion Proof $\rightarrow$ Dual-party Unquarantine Orders.
  6. Defined exact signature specifications, domain separation prefixes, and verification procedures for all four digital signatures: Primary Compliance HSM (`"DECISION_OS_WORM_SIGNATURE_V2:"`), Checkpoint Notary (`"DECISION_OS_MERKLE_CHECKPOINT_V1:"`), Compliance Officer (`"DECISION_OS_COMPLIANCE_AUTH_V1:"`), and SRE Lead (`"DECISION_OS_SRE_AUTH_V1:"`).
  7. Validated using **Option A (Reproducible Synthetic Fixture)** with deterministic Ed25519 test keys, RFC 3161 DER structure, and RFC 6962 Merkle proof (checkpoint height 8421).
  8. Re-affirmed core tenets: key rotation does NOT repair past confidentiality loss; re-encryption does NOT repair tag forgery; AES-GCM decryption does NOT prove authenticity; dual-party SRE/Security sign-off is mandatory before unquarantine.
  9. Revised adversarial test specification **`D38-42`** to 20 comprehensive verification items.
- **Status:** REMEDIATED (PHASE B.12) — PENDING INDEPENDENT REVIEW.

---

### Phase B.12 Security Review Findings (B11-01 through B11-12)

During the independent Phase B.11 architectural review, twelve specific security, cryptographic, and operational defects were identified across the Vault gateway topology, JWT state machine, and WORM evidence specification. The following items detail the defect and formal architectural remediation for each finding:

#### B11-01: Vault Rotation Authorization & Policy Separation
- **Defect:** The documented `slot-lease-reader` Vault policy granted only `read`, but the Gateway's rotation endpoint must update KV-v2 secrets (`secret/data/slots/:slot_id`). Using the read-only token for rotation failed natively, while granting broad write privileges to the read identity would allow unconstrained credential tampering.
- **Remediation:** Specified four separate, least-privilege Vault identities and HCL policies:
  1. *Credential Retrieval Identity (`slot-lease-reader`):* Ephemeral read-only token derived from JWT auth (`auth/jwt`), granting `read` capability strictly on `secret/data/slots/{{identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id}}`. Zero write, delete, list, or admin permissions.
  2. *Credential Rotation Identity (`slot-credential-rotator`):* Bound to Gateway ServiceAccount (`decision_os_vault_gateway`) via `auth/kubernetes`. Grants `create, update` on `secret/data/slots/+` and `read` on `secret/metadata/slots/+` (for CAS check). Strictly denied `read` on `secret/data/*` (cannot read password payloads), zero list, zero delete, zero admin.
  3. *JWT Auth Mount Accessor (`auth_jwt_9f8e7d6c`):* Internal engine populating Entity Alias Metadata.
  4. *Administrative Reconciliation Identity (`slot-admin-reconciler`):* Offline SRE certificate authentication (`auth/cert`) with metadata/audit read-only permissions.
  - Defined canonical signed revocation order schema binding 8 immutable parameters (`slotId`, `leaseId`, `credentialGeneration`, `expectedPreviousGeneration`, `newCredentialGeneration`, `operationId`, `orderExpiryEpochMs`, `authorizedCallerPrincipal`).
  - Required the Gateway to prove Vault write commitment via Check-And-Set (`cas`) metadata inspection before acknowledging rotation.
  - Enforced strict URI path validation against regex `^slot_[a-zA-Z0-9_-]+$` matching the signed order byte-for-byte, preventing path substitution.

#### B11-02: Complete Fencing for Every JWT State Transition & Runtime `createIndex` Removal
- **Defect:** Several transitions in the 7-state redemption machine omitted fencing generation and owner verification, risking split-brain overwrites. Additionally, the runtime Gateway role included `createIndex`.
- **Remediation:** 
  1. Audited all seven states (`CLAIMED`, `VAULT_REQUEST_SENT`, `ISSUED`, `OUTCOME_UNKNOWN`, `QUARANTINED`, `RECONCILED`, `EXPIRED`) and formalized an exhaustive transition matrix specifying all 12 mandatory attributes for every transition.
  2. Enforced that every runtime transition executes an atomic compare-and-set query filter matching exact current `status`, `owner_instance_id`, and `fencing_generation`. All unfenced updates (such as `updateOne({ _id: jti, status: "OUTCOME_UNKNOWN" }, ...)`) are strictly prohibited in runtime code.
  3. Enforced monotonic generation advancement (`$inc: { fencing_generation: 1 }`). Generation decrement or reuse is strictly prohibited.
  4. Stripped `createIndex` from the runtime Gateway role (`decision_os_vault_gateway`). All indexes are pre-created during bootstrap by `decision_os_bootstrap_admin`.

#### B11-03: Resolution of Dispatch-Intent vs Actual Vault Request Ambiguity & 11 Crash Points
- **Defect:** v2.1.0 recorded `VAULT_REQUEST_SENT` before dispatching the network request, but described this database record as proof that the request reached Vault. A database record proves intent, not delivery.
- **Remediation:** 
  1. Formally acknowledged that `VAULT_REQUEST_SENT` in MongoDB proves durable intent to dispatch, NOT wire delivery.
  2. Analyzed all 11 discrete crash and failure points across the redemption lifecycle.
  3. Enforced conservative fail-closed quarantine: If an outcome is ambiguous after dispatch intent is recorded, the redemption transitions to `OUTCOME_UNKNOWN` $\rightarrow$ `QUARANTINED`.
  4. Strict architectural invariant: The system **must never issue a second Vault token or re-dispatch a request** merely because the first request's outcome is unknown.
  5. Formalized the taxonomy of four non-interchangeable guarantees: (1) at-most-once authorization, (2) at-most-once token issuance, (3) at-most-once credential delivery, and (4) idempotent response behavior.

#### B11-04: Authoritative Recovery Service & Takeover Protocol
- **Defect:** v2.1.0 lacked a concrete specification of the background recovery actor, risking arbitrary takeover by restarted gateways and duplicate token issuance.
- **Remediation:**
  1. Specified the Authoritative Recovery Service (`apps/recovery-service`, ServiceAccount `decision_os_recovery_service`): runs independently of Gateway pods; granted `find`, `update` strictly on `jwt_redemptions`; **zero network route and zero credentials to Vault port 8200**.
  2. Defined monotonic takeover protocol advancing `fencing_generation` via atomic CAS when gateway heartbeats expire (`lease_expires_at <= now`).
  3. Established strict decision boundaries: un-dispatched claims (`CLAIMED` with `dispatch_attempted === false`) may be safely expired (`EXPIRED`), but in-flight or dispatched claims (`VAULT_REQUEST_SENT` or `dispatch_attempted === true`) **must be quarantined (`QUARANTINED`)** and must never be re-dispatched.
  4. Restarted gateway pods are prohibited from assuming ownership of historical requests.

#### B11-05: Administrative Reconciliation Authorization
- **Defect:** Administrative reconciliation was undefined for the Vault gateway, risking unauthorized operator overrides.
- **Remediation:**
  1. Excluded ordinary Gateway and Provisioner identities from administrative reconciliation authority.
  2. Established dedicated identity `decision_os_admin_reconciler` authenticated via offline SRE certificates (`auth/cert/sre-admin`).
  3. Formulated canonical signed Dual-Party Reconciliation Order schema requiring independent signatures from both the SRE Lead and Security Compliance Officer.
  4. Enforced independent verification of immutable Vault audit records (`sys/audit`). Operator assertion alone is rejected as proof.
  5. Established strict rule: If Vault audit logs prove that a secret was read, the slot cannot be unquarantined directly; server-side credential rotation is mandatory.

#### B11-06: Correction of SHA-256 Test Vector
- **Defect:** v2.1.0 claimed that the canonical candidate decision payload produced SHA-256 digest `3ebb50525651733616afcdfcca0bc572e973ca4c86e96bda3b3d923f0f348307`. That value was mathematically incorrect.
- **Remediation:** Recalculated the digest using standard cryptographic implementations. The exact canonical RFC 8785 byte sequence `{"action":"EXECUTE_TRANSACTION","amount":10000,"currency":"USD","decisionId":"dec-2026-11-10-001","slotId":"slot_01"}` produces verified SHA-256 digest:
  `90ca3b570b7e806657a928518b70ee710b342ea6e315187e7a1dcc4b409cab4e`.
  Replaced across all schemas and test specifications; preserved old incorrect value solely in historical defect descriptions.

#### B11-07: Correction of Plaintext Byte Length
- **Defect:** v2.1.0 specified `plaintextByteLength: 115`.
- **Remediation:** Recalculated exact UTF-8 byte length of the canonical JSON byte stream: exactly **117 bytes** (`Buffer.from(canonicalJson, "utf8").length === 117`). Reconciled across schema, sample record, recovery rules, and test specification `D38-42`. Added explicit test rejecting mismatched byte lengths.

#### B11-08: Authoritative & Complete Canonical WORM Plaintext Evidence Record Schema v2.2.0
- **Defect:** The previous 19-field inventory omitted fields required by its own verification procedures (`canonicalizationSpec`, `digestAlgorithm`, `signingAlgorithm`, `signingKeyId`, `merkleCheckpointId`).
- **Remediation:** Formalized the authoritative **Canonical WORM Plaintext Evidence Record Schema v2.2.0** comprising exactly **26 versioned data fields** (+ `$schema` URI metadata). Defined an exhaustive inventory table specifying data types, validation constraints, inclusion in primary signature, inclusion in TSA commitment, inclusion in Merkle leaf, and post-creation immutability.

#### B11-09: Timestamping Complete Evidence Commitment via RFC 3161 Imprint
- **Defect:** v2.1.0 claimed the TSA token bound only `decisionPayloadSha256` and `evidenceRecordId`, failing to cryptographically bind the complete evidence record.
- **Remediation:** Defined the exact RFC 3161 message imprint:
  $$\text{TsaCommitmentBytes} = \text{"DECISION_OS_TSA_COMMITMENT_V1:"} \parallel \text{CoreDigest} \parallel \text{UTF8}(\text{primaryEvidenceSignature})$$
  The message imprint is $\text{SHA-256}(\text{TsaCommitmentBytes})$. Defined ASN.1 DER TSA response validation, certificate chain verification, and timestamp comparison rules against $t_{\text{compromise}}$.

#### B11-10: Multi-Stage Non-Circular Merkle Construction
- **Defect:** Previous formulations risked circular dependency between evidence record, signature, TSA token, and Merkle inclusion proof.
- **Remediation:** Formulated an exact multi-stage non-circular commitment protocol: (1) Construct Evidence Core (Fields 1–17); (2) Sign Core with Compliance HSM (`primaryEvidenceSignature`, Field 18); (3) Timestamp Core + Signature via RFC 3161 TSA (`tsaTimestampToken`, Field 19); (4) Compute RFC 6962 leaf hash ($0\text{x}00 \parallel \text{CoreDigest} \parallel \text{SHA-256}(\text{Sig}) \parallel \text{SHA-256}(\text{TSA})$); (5) Commit leaf to Merkle audit tree; (6) Sign checkpoint root (`merkleCheckpointSignature`) and generate inclusion proof (`merkleInclusionProof`, Fields 20–24); (7) Attach dual-party unquarantine signatures upon incident recovery (Fields 25–26). The leaf strictly commits to core, signature, and timestamp; the proof and checkpoint are external verification witnesses.

#### B11-11: Independent Digital Signature Semantics
- **Defect:** Signature semantics were ambiguous; multiple signature fields did not prove two-person authorization.
- **Remediation:** Formally specified exact payloads, algorithms, key identifiers, public-key trust sources, canonical serializations, domain prefixes, and verification procedures for all four digital signatures: (1) Primary Compliance HSM Signature (`"DECISION_OS_WORM_SIGNATURE_V2:"`), (2) Checkpoint Notary Signature (`"DECISION_OS_MERKLE_CHECKPOINT_V1:"`), (3) Compliance Officer Authorization (`"DECISION_OS_COMPLIANCE_AUTH_V1:"`), and (4) SRE Lead Authorization (`"DECISION_OS_SRE_AUTH_V1:"`). Both compliance and SRE approvals sign the exact same canonical unquarantine order payload.

#### B11-12: Reproducible Synthetic Test Fixture (Option A)
- **Defect:** Sample evidence records contained illustrative placeholders (`MIIEP...`, `0x9f8e...`) that could be mistaken for unverified production artifacts.
- **Remediation:** Selected **Option A (Reproducible Synthetic Fixture)**. Generated a fully valid, structurally and cryptographically sound synthetic test fixture using deterministic test keys and reproducible Node.js script. Generated valid Ed25519 signatures, DER-structured mock TSA token, RFC 6962 Merkle tree root, and valid inclusion proof. Clarified that test fixtures prove schema and algorithm validity, not production trust.

---

### Phase B.13 Architecture Review Findings (B12-01 through B12-08)

Independent architectural review of baseline commit `d6a35bd7910f9c028357d855e9f98caf3689b038` (v2.2.0) identified eight critical architectural, cryptographic, and state-machine defects (B12-01 through B12-08) that have been thoroughly remediated:

#### B12-01: Vault Audit Evidence Retrieval and Reconciliation Authorization
- **Defect:** v2.2.0 granted `slot-admin-reconciler` access to `path "sys/audit"` and described this access as independent audit-event inspection. In HashiCorp Vault, `sys/audit` configures audit devices, but does NOT return audit events via HTTP GET.
- **Remediation:**
  1. Formalized the distinction between audit device configuration (`sys/audit`), emitted audit events, external immutable audit-log storage, and independent forensic evidence retrieval.
  2. Defined the complete external audit delivery architecture: Vault native `file` audit device emitting JSON records to local FIFO `/var/log/vault/audit.log`, streamed synchronously over mTLS (TLS 1.3) by Fluent Bit / Vector to write-once WORM cloud storage (AWS S3 Object Lock in `COMPLIANCE` mode / Google Cloud Storage Bucket Lock with retention $\ge 7$ years).
  3. Defined dedicated read-only forensic identity `decision_os_audit_investigator` with read-only access to external WORM storage and zero Vault secret read/write or rotation privileges.
  4. Established exact evidence and correlation contracts linking Vault audit records to `jti`, `operationId`, `slotId`, and `fencing_generation`.
  5. Mandated strict fail-closed behavior: if audit logs are delayed, lagged, incomplete, or unavailable, administrative unquarantine is strictly blocked (`HTTP 424 Failed Dependency`).

#### B12-02: Gateway Access to `slot_rotation_log` and Crash-Safe Rotation Recovery
- **Defect:** The Gateway rotation endpoint requires writing to `decision_os_coordination.slot_rotation_log`, but Table 7.6.1 granted access only to `jwt_redemptions`. Furthermore, rotation crash recovery lacked an explicit, fenced durable state machine.
- **Remediation:**
  1. Defined the complete schema for `decision_os_coordination.slot_rotation_log` including `operationId`, `slotId`, `currentCredentialGeneration`, `expectedPreviousGeneration`, `newCredentialGeneration`, `status`, `owner_instance_id`, `fencing_generation`, and `vault_cas_version`.
  2. Defined unique compound indexes: `{ operationId: 1 }` (unique idempotency key) and `{ slotId: 1, newCredentialGeneration: 1 }` (unique generation lock).
  3. Updated Table 7.6.1 granting `actions: ["find", "insert", "update"]` on both `jwt_redemptions` and `slot_rotation_log` to `decision_os_vault_gateway`.
  4. Formalized the 7-state durable rotation state machine (`PREPARED`, `DISPATCH_INTENT_RECORDED`, `VAULT_WRITE_CONFIRMED`, `COMPLETED`, `OUTCOME_UNKNOWN`, `QUARANTINED`, `RECONCILED`) with a 12-attribute transition matrix.
  5. Conducted rigorous crash recovery analysis across all 8 crash points (CP-1 to CP-8).
  6. Established the CAS Metadata Discovery protocol to verify Vault write commitment without duplicate rotations.

#### B12-03: Vault Per-Slot Rotation Authorization Boundary
- **Defect:** The v2.2.0 `slot-credential-rotator` policy granted `path "secret/data/slots/+"` with `create, update`, permitting the shared identity to update any single-segment slot path. Application-level request checking does not provide Vault-native isolation.
- **Remediation:**
  1. Completely eliminated the wildcard single-segment policy `secret/data/slots/+`.
  2. Implemented 256 discrete, statically declared Vault policies (`slot-rotator-slot_000` through `slot-rotator-slot_255`) generated during cluster bootstrap. Each policy restricts writes strictly to `secret/data/slots/slot_NNN` and metadata read to `secret/metadata/slots/slot_NNN`.
  3. Established ephemeral scoped token exchange: Gateway presents verified signed revocation order and exchanges its identity for an ephemeral token scoped exclusively to `slot-rotator-slot_NNN` (`num_uses: 2`, `ttl: 60s`).
  4. Vault's native ACL engine enforces cross-slot write isolation: any attempt to write to another slot path returns native Vault `HTTP 403 Forbidden: permission denied`.

#### B12-04: Unsupported At-Most-Once Vault Token Issuance Guarantee
- **Defect:** v2.2.0 risked conflating single-use token consumption (`token_num_uses = 1`) with at-most-once Vault token issuance across network partitions and crashes.
- **Remediation:**
  1. Clarified that `token_num_uses = 1` governs the *consumption* of an already minted token, NOT the prevention of duplicate token issuance if multiple login requests reach Vault.
  2. Categorized at-most-once Vault token issuance across untracked network boundaries as **NOT GUARANTEED** without cross-system distributed 2PC.
  3. Strictly prohibited automated redispatch across reverse proxies, service meshes, Gateway HTTP clients, and background recovery services after an ambiguous outcome.
  4. Formally separated five distinct guarantees: (1) At-most-once authorization; (2) At-most-once Vault token issuance (NOT GUARANTEED); (3) Single-use token consumption; (4) At-most-once credential delivery; (5) Idempotent response behavior.

#### B12-05: Genuine Synthetic RFC 3161 DER Timestamp Token Fixture
- **Defect:** v2.2.0 encoded a JSON object as Base64 and described it as a structurally valid DER-encoded RFC 3161 timestamp token.
- **Remediation:**
  1. Generated a genuine, syntactically and cryptographically valid ASN.1 DER CMS `ContentInfo` of type `id-signedData` (OID `1.2.840.113549.1.7.2`) containing `SignedData` with encapsulated `TSTInfo` (OID `1.2.840.113549.1.9.16.1.4`, length: 612 DER bytes, Base64 prefix `MIICYAYJKoZIhvcNAQcCoIICUTCCAk0CAQMx...`).
  2. Bound the complete record via SHA-256 message imprint over `DECISION_OS_TSA_COMMITMENT_V1: || CoreDigest || UTF8(primaryEvidenceSignature)`.
  3. Included valid synthetic TSA certificate chain, serial number, GeneralizedTime, and Ed25519 signature.
  4. Independently parsed and verified the complete DER hierarchy using both Python and Node.js ASN.1 parsers.

#### B12-06: Inconsistent Merkle Checkpoint Root
- **Defect:** v2.2.0 contained two conflicting Merkle roots (`b8ccf706...` vs `46d6565b...`).
- **Remediation:**
  1. Recomputed the deterministic Merkle tree using the exact canonical 117-byte payload (SHA-256 `90ca3b57...`), Core digest (`b9ccb6cf...`), primary signature, genuine DER TSA token digest, and RFC 6962 Leaf 0 (`e5f7ad45...`).
  2. Produced exactly **one authoritative Merkle root**:
     `e3f6f3504f211d64c383acb50260e7b6f6cccba7522f0fdf98b83cd8145d5248`
     at `checkpointHeight: 8421` (`chk-2026-11-10-8421`).
  3. Evaluated and verified the 2-sibling inclusion proof independently against this root.
  4. Globally reconciled all root occurrences across the architecture document.

#### B12-07: Inconsistent Credential-Generation Semantics
- **Defect:** The v2.2.0 signed revocation order specified `credentialGeneration = 1`, `expectedPreviousGeneration = 0`, `newCredentialGeneration = 2`, mixing previous and current generation semantics and conflating them with Vault version numbers.
- **Remediation:**
  1. Formalized an unambiguous generation contract ($N \rightarrow N+1$): Let $N \ge 1$ be the active generation. In Phase 2 Revocation, rotating from generation $N$ to $N+1$ requires `currentCredentialGeneration: N`, `expectedPreviousGeneration: N`, and `newCredentialGeneration: N + 1`.
  2. Bound logical generation monotonically to Vault KV-v2 version: $\text{logicalGeneration} \equiv \text{vaultKv2Version}$.
  3. Vault KV-v2 write CAS strictly requires `cas: N`, resulting in `target_version: N + 1`.
  4. Reconciled all sample orders, state transitions, validation constraints, and test vectors.

#### B12-08: Inaccurate Claims About Scope of TSA, Merkle and Post-Incident Commitments
- **Defect:** v2.2.0 claimed the TSA token "binds the complete evidence record", whereas the TSA message imprint only covers the Evidence Core and primary signature.
- **Remediation:**
  1. Explicitly delineated the cryptographic coverage of every layer:
     - **Layer 1 (Primary HSM Signature):** Covers Fields 1–17 (`CoreDigest`).
     - **Layer 2 (RFC 3161 TSA Imprint):** Covers Fields 1–18 (`CoreDigest || UTF8(primaryEvidenceSignature)`).
     - **Layer 3 (RFC 6962 Merkle Leaf Hash):** Commits to Fields 1–19 (`0x00 || Leaf0Bytes`).
     - **Layer 4 (Merkle Checkpoint & Proof):** Function as **external verification witnesses** (Fields 20–24); they do not form part of the leaf hash itself.
     - **Layer 5 (Post-Incident Signatures):** Function as a **versioned post-incident extension** (Fields 25–26) signing a canonical Unquarantine Order binding `evidenceRecordId`, `decisionPayloadSha256`, `targetSlotId`, and `merkleCheckpointRoot`.
  2. Updated the authoritative 26-field inventory table with explicit layer coverage columns.

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

#### 6. Compromised Ephemeral Credential Broker (Finding B38-31, B38-36)
- **Attacker Profile:** An attacker achieves arbitrary code execution inside the `apps/credential-broker` enclave.
- **Adversarial Capabilities:** Possesses `decision_os_credential_broker` credentials on `rs_test:27018`.
- **Explicit Blast Radius Acknowledgment (B38-36):**
  - In MongoDB RBAC, `{ db: "", collection: "" }` is an unrestricted wildcard covering every non-system database across the entire replica set.
  - An attacker possessing these credentials can connect directly to `rs_test:27018` and administer roles, create backdoors, or alter user passwords in **any and all worker databases**, completely bypassing application-level regex validation or signed claims.
  - Regex checks, signed API claims, and separate container execution do **NOT provide MongoDB-native database isolation**.
- **Architectural Containment & Elimination:**
  - Because this cross-database blast radius cannot be constrained natively by MongoDB RBAC when dynamic database creation is used, the runtime broker is **ELIMINATED from the active worker execution path**.
  - Standard workloads execute exclusively against pre-allocated partition slots where each scoped admin (`decision_os_db_admin_slot_${k}`) is constrained strictly to its single slot.
  - Any optional dynamic broker is classified as an **Uncontained Control-Plane Root of Trust** and disabled by default in production (`DECISION_OS_DYNAMIC_PROVISIONING_ENABLED=false`).
  - The broker has zero network routes and zero credentials for `rs_coord:27019`, and is denied all cluster and system database actions (`admin`, `config`, `local`) (Code 13).

#### 7. Compromised Offline Bootstrap Process (Finding B38-31)
- **Attacker Profile:** An adversary compromises the initialization image `deploy/init-mongo-test.sh` before cluster deployment.
- **Containment:** Bootstrap container executes strictly offline during infrastructure provisioning, prior to public ingress availability. Temporary administrative credentials exist solely in RAM/tmpfs and are shredded (`shred -u`) prior to container termination. No bootstrap process remains online during test execution. Emergency recovery requires an air-gapped Shamir's Secret Sharing ceremony (2-of-3 SRE custodians).

#### 8. Compromised Partition Slot Vault / Secrets Engine (Finding B38-31, B38-37)
- **Attacker Profile:** An adversary gains read access or compromises the Provisioning Service attempting to retrieve slot credentials from HashiCorp Vault.
- **Adversarial Actions Attempted:** Direct path guessing, path substitution (`slot_02` using a `slot_01` token), or bulk directory listing.
- **Containment & Vault Enforcement (B38-37):**
  - Partition Slot Vault enforces templated identity policies (`path "secret/data/slots/{{identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id}}" { capabilities = ["read"] }` with `secret/data/slots/*` denied).
  - The provisioner exchanges an Ed25519-signed lease JWT from the coordination authority for a single-use client token (`num_uses = 1`, `ttl = 60s`, `renewable = false`).
  - Attempting to read any other slot's credentials (`GET /v1/secret/data/slots/slot_02` using token bound to `slot_01`) is rejected natively by Vault's policy engine with `HTTP 403 Forbidden`.
  - Bulk enumeration is denied by policy (`list` capability denied).
  - The token is automatically destroyed by Vault immediately upon the first read.

#### 9. Compromised Nonce Allocation Service (Finding B38-32, B38-38)
- **Attacker Profile:** An adversary compromises the `apps/nonce-allocator` microservice or extracts its MongoDB connection credentials.
- **Adversarial Capabilities:** Possesses `decision_os_nonce_allocator` credentials on `rs_coord:27019` (`actions: ["update"]` on `nonce_allocations`).
- **Engine Limitation & Root of Trust (B38-38):**
  - Because MongoDB RBAC authorizes commands at the action level (`update`) without inspecting operators (`$inc` vs `$set`), and `$jsonSchema` cannot enforce inter-update temporal monotonicity, the compromised allocator CAN execute `$set: { nextBlockStart: 0 }`.
  - The Nonce Allocator is formally recognized as an **Independent Cryptographic Root of Trust**.
- **Containment & Emergency Recovery:**
  - Nonce Allocator possesses zero network routes and zero credentials on `rs_test:27018`.
  - Allocator is denied `remove`, `dropCollection`, and `dropDatabase` on `rs_coord:27019` by MongoDB RBAC (Code 13).
  - An external **Monotonicity Watchdog** detects block regression and trips the emergency kill-switch, halting all worker encryption.
  - KMS immediately retires active key material and increments `KeyVersionPrefix`, mathematically ensuring that new ciphertexts cannot collide with compromised ciphertexts. Compromised envelopes are quarantined and re-encrypted under the new key epoch.

#### 10. Compromised Network-Fencing Controller (Finding B38-35)
- **Attacker Profile:** An adversary disables or tampers with the `apps/network-fence-controller`.
- **Containment:** Cleanup Executor requires synchronous data-plane verification of netfilter rules (`iptables -C`) before proceeding to identity deletion. If network fencing fails or times out, the teardown strictly fails closed: execution halts, the request transitions to `QUARANTINED`, and the execution lock is permanently retained. Furthermore, defense-in-depth ensures that even if transport fencing is bypassed, server-side MongoDB `dropUser` and session termination prevent unauthorized wire operations.

#### 11. Stale Worker or Compromised Provisioner Retaining Slot Administrator Password (Finding B38-40)
- **Attacker Profile:** A worker from lease $N$, or an adversary who extracts memory from `apps/provisioner` during lease $N$, retains password $P_N$ for scoped administrator `decision_os_db_admin_slot_${k}`.
- **Adversarial Capabilities:** Attempts direct SCRAM authentication to `rs_test:27018` after lease $N$ terminates and slot $k$ is reassigned to lease $N+1$.
- **Containment & Enforcement:** Option B Slot Credential Rotation enforces server-side password self-rotation via `updateUser` with action `changeOwnPassword` and `{ w: "majority", j: true }` at every lease boundary during Phase 2 Revocation. When lease $N$ terminates, $P_N$ is rotated to $P_{N+1}$ on MongoDB server before slot reassignment is permitted. The attacker's SCRAM handshake fails natively with `AuthenticationFailed` (Error Code 18).

#### 12. Adversary Intercepting Signed Lease JWT or Attempting Direct Vault Auth Bypass (Finding B38-41)
- **Attacker Profile:** An attacker intercepts an unexpired signed lease JWT issued by the Coordination Authority, or a compromised worker attempts to authenticate directly to Vault.
- **Adversarial Capabilities:** (1) Submits the JWT repeatedly to the gateway to mint multiple Vault tokens; (2) Calls Vault's `/v1/auth/jwt/login` directly from worker network to bypass MongoDB `jti` replay tracking.
- **Containment & Enforcement:**
  - *Replay Prevention:* Dedicated JWT Redemption Gateway executes atomic `insertOne` on `jti` in `rs_coord:27019.jwt_redemptions` with `{ w: "majority", j: true }`. Duplicate submissions fail with DuplicateKey (Error Code 11000) and return HTTP 409.
  - *Network Boundary:* Vault Ingress NetworkPolicy blocks all network packets to port 8200 from worker and provisioner namespaces. Direct bypass calls are dropped at the packet filter layer (Connection refused / timed out).

#### 13. Adversary Attempting Ciphertext Forgery Post Nonce Reuse or Tampered Plaintext Recovery (Finding B38-42)
- **Attacker Profile:** An adversary who caused or observed an AES-GCM nonce collision and computed GHASH key $H$, attempting to inject forged ciphertexts with valid tags or forge plaintext during recovery.
- **Containment & Enforcement:** Monotonicity Watchdog trips emergency halt kill-switch, placing all ciphertexts in the affected epoch into `QUARANTINED`. Authoritative workflows strictly reject quarantined material (`QuarantinedCiphertextException`). Integrity validation against pre-incident Canonical WORM Plaintext Evidence Records ($t_{\text{evidence}} < t_{\text{compromise}}$) verifies candidate plaintexts under RFC 8785 JCS and SHA-256 digests against external compliance HSM signatures, permanently rejecting forged plaintexts or post-incident checkpoints. Dual-party SRE Lead and Security Officer sign-off is strictly required before unquarantine.

---
### 15.2 Explicit Adversarial Analysis Matrix (Scenarios 1–48)



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
| **Scenario 26 (B38-36)** | **Scoped Partition Admin Cross-Database Wire Attack.** Attacker connects to `rs_test:27018` using `decision_os_db_admin_slot_01` credentials and attempts `db.getSiblingDB("decision_os_test_slot_02").createUser(...)`. | Permitted: User/role management on `slot_01`. | **PROHIBITED:** Any command or operation on `slot_02`. | **Native Database Isolation:** MongoDB RBAC natively rejects cross-database user management with Error Code 13 (`Unauthorized`). Zero cross-database blast radius exists. |
| **Scenario 27 (B38-37)** | **Compromised Provisioner Direct Vault API Path Substitution Attack.** Attacker acquires single-use Vault token bound to `slot_01` and directly calls `GET /v1/secret/data/slots/slot_02` using Vault HTTP API. | Permitted: Read `secret/data/slots/slot_01`. | **PROHIBITED:** Reading `slot_02` or listing slot metadata. | **Native Vault Templated Policy Enforcement:** Vault policy engine evaluates token's bound `slot_id` metadata against request path; returns `HTTP 403 Forbidden`. Attempting secondary read on `slot_01` returns HTTP 403 (token revoked after single use). |
| **Scenario 28 (B38-38)** | **Compromised Nonce Allocator Sequence Reset Attack.** Compromised allocator executes `db.nonce_allocations.updateOne({}, { $set: { nextBlockStart: 0 } })`. | Permitted: `update` on `nonce_allocations`. | **PROHIBITED:** Undetected counter regression and IV reuse under active key material. | **Emergency Kill-Switch & Epoch Invalidation:** Monotonicity watchdog detects regressed block allocation in audit log, trips emergency halt kill-switch, revoking worker lease blocks. KMS retires active key material and increments `KeyVersionPrefix`, rendering new ciphertexts disjoint from compromised ciphertexts. |
| **Scenario 29 (B38-39)** | **Teardown Crash Injection & Prerequisite Gating Violation Attack.** Cleanup Executor crashes after Phase 2 (`IDENTITY_REVOKED`); on restart, adversary attempts to skip Phase 3 and issue Phase 4 `dropDatabase`. | Permitted: Execution of canonical sequence. | **PROHIBITED:** Executing `dropDatabase` before all prior phases are durably acknowledged in `cleanup_ledger`. | **Mandatory Prerequisite Gate:** Executor checks `cleanup_ledger`; detects missing `phase3_ops_killed_at`. Command execution is strictly blocked; request transitions to `QUARANTINED`. Normal crash recovery idempotently resumes from Phase 3 without skipping. |
| **Scenario 30 (B38-40)** | **Retained Slot Admin Password Reuse Post-Reassignment Wire Attack.** Attacker records password $P_N$ for `decision_os_db_admin_slot_01` during lease $N$; lease ends and slot is reassigned to Worker B (lease $N+1$). Attacker connects directly to `rs_test:27018` using password $P_N$. | Permitted: None. | **PROHIBITED:** Authenticating or managing users after lease $N$ terminates. | **Server-Side Credential Rotation:** MongoDB `updateUser` with `changeOwnPassword` in Phase 2 rotated password to $P_{N+1}$ with majority ack. Wire handshake fails natively with Code 18 (`AuthenticationFailed`). Slot reassignment gate verified rotation prior to release. |
| **Scenario 31 (B38-41)** | **Sequential or Concurrent JWT Redemption Replay via Gateway Attack.** Attacker captures signed lease JWT for `slot_01` and submits it concurrently or sequentially to JWT Gateway to mint multiple Vault tokens. | Permitted: Exactly one successful redemption. | **PROHIBITED:** Producing more than one Vault token per signed JWT. | **Atomic Redemption CAS:** `rs_coord:27019.jwt_redemptions` enforces unique `_id: jti`. Second submission throws DuplicateKey (Code 11000); returns HTTP 409. Zero secondary tokens minted. |
| **Scenario 32 (B38-42)** | **Compromised Allocator / Nonce Reuse Plaintext Forgery & Authoritative Decryption Bypass.** Attacker exploits nonce collision to forge AES-GCM ciphertext tag and submits it to authoritative decision workflow. | Permitted: None. | **PROHIBITED:** Authoritative workflow accepting or acting on forged/unverified ciphertext. | **Cryptographic Incident State Machine:** Affected epoch is quarantined; authoritative workflows reject quarantined material with `QuarantinedCiphertextException`. Recovery requires pre-incident Canonical WORM Evidence and dual-party SRE/Security sign-off. |
| **Scenario 33 (B38-41)** | **Direct Vault JWT Auth Network Ingress Bypass Attack.** Compromised worker pod in `apps/worker` attempts to call Vault's `/v1/auth/jwt/login` directly, attempting to bypass MongoDB `jti` replay registration. | Permitted: Zero direct connections. | **PROHIBITED:** Reaching Vault JWT auth listener from any host other than the authorized JWT Redemption Gateway. | **Vault Ingress NetworkPolicy Fencing:** Kubernetes `NetworkPolicy` drops TCP port 8200 packets from non-gateway pods. Direct TCP connection times out or is refused at Layer 4. Zero tokens issued. |
| **Scenario 34 (B38-40)** | **Slot Admin Self-Rotation Privilege Misconfiguration Attack.** Scoped slot admin role is configured with `changePassword` only (missing `changeOwnPassword`). Provisioner attempts self-rotation via `updateUser`. | Permitted: Successful self-rotation under least privilege. | **PROHIBITED:** Self-rotation without `changeOwnPassword`; or granting broad `changePassword` on slot DB. | **MongoDB RBAC Engine Enforcement:** MongoDB natively requires `changeOwnPassword` for self-password modification. With `changePassword` only, `updateUser` fails with Code 13 (`Unauthorized`). Ensures exact deployed privileges match specification. |
| **Scenario 35 (B38-42)** | **Tampered Plaintext Unquarantine Attack Using Post-Incident Checkpoint.** Attacker causes nonce collision, modifies ciphertext, and generates a new checkpoint after compromise timestamp ($t_{\text{chk}} \ge t_{\text{comp}}$) attempting to trick SRE into unquarantining tampered data. | Permitted: None. | **PROHIBITED:** Unquarantining data using checkpoints created after the incident detection timestamp. | **WORM Pre-Incident Timestamp Enforcement:** Recovery rule 1 strictly verifies $t_{\text{evidence}} < t_{\text{compromise}}$. Post-incident checkpoints are rejected immediately. Candidate plaintext is discarded or restored from cold offline backup. |
| **Scenario 36 (B11-01)** | **Vault Rotation Privilege Escalation & Cross-Slot Path Substitution Attack.** Attacker captures Gateway rotation credentials (`slot-credential-rotator`) and attempts to read secret payloads (`GET /v1/secret/data/slots/slot_01`) or supply a signed revocation order for `slot_01` to rotate `slot_02` (`POST /v1/vault-gateway/slots/slot_02/rotate`). | Permitted: Least-privilege rotation of authorized slot. | **PROHIBITED:** Reading secret payload data via rotation identity; cross-slot path substitution. | **Vault ACL & Gateway Order Binding:** Vault ACL strictly denies `read` on `secret/data/*` (`create, update` only on `secret/data/slots/+`). Gateway strictly validates that URI `:slot_id` matches `order.slotId` byte-for-byte. Check-and-set CAS ensures version monotonicity. |
| **Scenario 37 (B11-02, B11-03, B11-04)** | **Stale Gateway Instance Unfenced State Overwrite & Duplicate Token Re-Dispatch Attack.** Gateway Pod A claims `jti_01`, records intent `VAULT_REQUEST_SENT`, and freezes. Recovery Service detects expired lease, takes over via CAS (`$inc: { fencing_generation: 1 }`), and marks record `QUARANTINED`. Pod A unfreezes, obtains Vault token, and attempts to update MongoDB to `ISSUED` or re-dispatch request to Vault. | Permitted: At-most-once token issuance. | **PROHIBITED:** Stale Gateway instance overwriting quarantined state; re-dispatching Vault requests for ambiguous outcomes. | **Atomic Monotonic Fencing & Recovery Isolation:** Atomic CAS update by Pod A fails with `matchedCount === 0` (`StaleGenerationException`) because `fencing_generation` advanced. Pod A shreds credentials from memory and aborts. Recovery Service has zero network route to Vault port 8200 and never re-dispatches Vault requests. Zero duplicate tokens issued. |
| **Scenario 38 (B11-05, B11-08, B11-10, B11-11)** | **Unauthorized Single-Operator Unquarantine & Forged Evidence Injection Attack.** Rogue operator or compromised Gateway attempts to release quarantined `jti` or inject forged WORM evidence with mismatched byte length, synthetic empty hash, or unverified Merkle proof without Compliance Officer co-signature. | Permitted: None. | **PROHIBITED:** Unquarantining redemption records or plaintext without verified independent cryptographic proof and dual-party authorization. | **Dual-Party Cryptographic Sign-Off & Schema Invariants:** Gateway has zero unquarantine authority. Administrative reconciliation strictly requires dual Ed25519 signatures (SRE Lead + Compliance Officer) and independent Vault audit log proof. Evidence validation strictly enforces 26 schema fields, exact byte length (117), SHA-256 match, RFC 3161 TSA imprint validation, and RFC 6962 Merkle tree inclusion proof against anchored root. |
| **Scenario 39 (B12-01)** | **Vault Audit Stream Lag & Delay Attack.** Rogue operator attempts to unquarantine an ambiguous `VAULT_REQUEST_SENT` redemption while external Vault audit stream to WORM storage is delayed, lagged, or interrupted. | Permitted: None. | **PROHIBITED:** Administrative unquarantine while audit stream is delayed or incomplete. | **Fail-Closed Audit Verification Boundary:** Administrative reconciliation strictly verifies audit log continuity; returns `HTTP 424 Failed Dependency` if stream lag exceeds 30s or gaps exist. Slot remains safely locked in `QUARANTINED`. |
| **Scenario 40 (B12-02)** | **Gateway Rotation Log Crash & Response Loss Recovery.** Gateway crashes after committing KV-v2 update to Vault but before acknowledging Provisioner. | Permitted: Idempotent status query. | **PROHIBITED:** Duplicate Vault rotation writes or generation regressions. | **CAS Metadata Discovery & Idempotency:** Provisioner polls `rotate-status?operationId=...`; Gateway queries `slot_rotation_log` and Vault metadata, confirming `current_version === target_version` and returning `HTTP 200` without re-writing to Vault. |
| **Scenario 41 (B12-03)** | **Cross-Slot Native Vault Rotation Tampering by Compromised Gateway.** Compromised Gateway holds ephemeral token for `slot-rotator-slot_001` and attempts to write to `secret/data/slots/slot_002`. | Permitted: Least-privilege write to assigned slot. | **PROHIBITED:** Writing to unauthorized slot paths. | **Vault-Native Per-Slot Policy Isolation:** Vault evaluates policy `slot-rotator-slot_001` (`deny` on all other slots) and natively returns `HTTP 403 Forbidden: permission denied`. |
| **Scenario 42 (B12-04)** | **Automated Redispatch of Ambiguous Vault Login Request across Reverse Proxy / Mesh.** Network timeout occurs during Vault login; reverse proxy or service mesh attempts automated HTTP POST retry. | Permitted: Single initial dispatch. | **PROHIBITED:** Automated redispatch across network intermediaries. | **Zero-Retry Proxy Configuration & Fail-Closed Quarantine:** Reverse proxies and Gateway HTTP clients are configured with zero retries on POST; Gateway transitions to `OUTCOME_UNKNOWN` $\rightarrow$ `QUARANTINED`; zero duplicate tokens issued. |
| **Scenario 43 (B12-05)** | **Synthetic / Truncated / Invalid RFC 3161 Timestamp Token Injection.** Attacker submits candidate evidence record with Base64 JSON mock or invalid ASN.1 DER structure. | Permitted: None. | **PROHIBITED:** Unquarantining data with invalid DER token. | **Strict ASN.1 DER CMS Parser Verification:** Cryptographic validator invokes native ASN.1 DER parser; verifies CMS `ContentInfo` type `id-signedData` with encapsulated `TSTInfo`, OIDs, and TSA signature. Malformed tokens throw `InvalidTimestampTokenStructureException`. |
| **Scenario 44 (B12-06)** | **Inconsistent Merkle Checkpoint Root Tampering.** Attacker presents candidate evidence claiming Merkle inclusion against legacy root `46d6565b...` or `b8ccf706...` instead of authoritative root `e3f6f3504f211d64c383acb50260e7b6f6cccba7522f0fdf98b83cd8145d5248`. | Permitted: Verification against authoritative root. | **PROHIBITED:** Unquarantining with conflicting roots. | **Authoritative Root Anchor Enforcement:** Checkpoint anchor pinned strictly to root `e3f6f350...` at height 8421; mismatched root hashes fail verification immediately. |
| **Scenario 45 (B12-07)** | **Credential Generation Regression or Rollback via Stale Revocation Order.** Attacker replays order with `currentCredentialGeneration: 2`, `expectedPreviousGeneration: 1`, `newCredentialGeneration: 2` attempting to roll back credentials. | Permitted: Monotonic single-step rotation ($N \rightarrow N+1$). | **PROHIBITED:** Generation rollbacks or decrements. | **Monotonic Generation CAS:** Gateway verifies `newCredentialGeneration === currentCredentialGeneration + 1`; Vault KV-v2 CAS with `cas: 2` natively rejects regression. |
| **Scenario 46 (B12-08)** | **Cryptographic Scope Confusion Attack.** Attacker presents evidence where Merkle Leaf attempts to include checkpoint signatures or post-incident signatures in the pre-incident leaf calculation. | Permitted: None. | **PROHIBITED:** Circular dependency or scope confusion. | **Strict 5-Layer Cryptographic Scope Formulation:** Layer 1 = Fields 1–17; Layer 2 = Fields 1–18; Layer 3 = Fields 1–19; Fields 20–24 are external witnesses; Fields 25–26 are post-incident extension. |
| **Scenario 47 (B12-01, B12-02)** | **Forensic Identity Privilege Escalation Attempt.** SRE forensic investigator attempts to use forensic credentials `decision_os_audit_investigator` to read Vault secrets or issue rotation commands. | Permitted: Read-only access to external WORM audit storage. | **PROHIBITED:** Reading Vault secrets or calling rotation API. | **Dedicated Read-Only Forensic Role:** Forensic identity possesses zero credentials and zero policy permissions on Vault port 8200 secret engine. |
| **Scenario 48 (B12-02)** | **Split-Brain Concurrent Gateway Rotation Conflict.** Two Gateway pods simultaneously attempt to process rotation for the same slot with competing operation IDs. | Permitted: Single winning insert. | **PROHIBITED:** Concurrent or conflicting rotations. | **Compound Unique Generation Index:** Index `{ slotId: 1, newCredentialGeneration: 1 }` in `slot_rotation_log` ensures only one insert succeeds; second pod receives duplicate key error `E11000` and aborts. |

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
5. **Fail-Closed Resolution:** The Executor halts teardown immediately. It does NOT proceed to identity revocation or wire drop. It transitions the ledger request to `QUARANTINED`, preserving `dropExecutionLock: true` and alerting SRE.

#### Case F: Partition Slot Vault Token Expiration Prior to Read Completion (Finding B38-37)
1. Provisioning Service exchanges signed lease JWT at `/v1/auth/jwt/login` for single-use Vault token bound to `slot_01` (TTL: 60s, `num_uses = 1`).
2. Network timeout occurs between provisioner and Vault during `GET /v1/secret/data/slots/slot_01`.
3. Provisioner attempts retry; token has expired or was marked used. Vault returns `HTTP 403 Forbidden`.
4. **Resolution:** Provisioner executes a consistency check on `rs_coord:27019.ownership_locks` to prove its lease on `slot_01` remains active and unexpired. If valid, it requests a fresh signed lease JWT and re-executes token exchange. If the lease expired, the saga aborts and rolls back.

#### Interleaving 18: Nonce Allocator Compromise Race During Counter Exhaustion (Finding B38-38)
1. Nonce Allocator reaches ceiling $2^{48}$ or is subverted to execute `$set: { nextBlockStart: 0 }`.
2. Allocator emits a block starting at 0 under `keyVersion = v1`.
3. Provisioner attempts to encrypt credential envelope using regressed nonce.
4. **Resolution:** Audit writer and Monotonicity Watchdog detect that leased `blockStart` is less than the historical maximum block boundary recorded in `cleanup_audit_log`. The watchdog immediately activates the emergency halt kill-switch on `rs_coord`. The Provisioning Service rejects the lease, KMS retires `v1`, advances `KeyVersionPrefix` to `v2`, and re-seeds sequence state.

#### Interleaving 19: Crash Immediately Following Scoped Identity Revocation (Finding B38-39)
1. Executor completes Phase 1 (`NET_FENCED`) and records `phase1_net_fenced_at`.
2. Provisioner completes Phase 2 (`IDENTITY_REVOKED`) via `dropUser` and `dropRole`; Executor records `phase2_identity_revoked_at`.
3. Executor process abruptly crashes before initiating Phase 3 (`killOp` / session termination).
4. **Resolution:** On restart, the recovery coordinator inspects `cleanup_ledger`. It observes `phase1_net_fenced_at != null` and `phase2_identity_revoked_at != null`, but `phase3_ops_killed_at == null`. Because Phase 4 strictly gates on all three prior phases, `dropDatabase` is not executed. The recovery coordinator resumes idempotently at Phase 3, executing `killOp` and `killAllSessionsByPattern`, before proceeding to Phase 4.

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
18. **Interleaving 18: Concurrent Old-Worker and New-Worker Access Attempts During Slot Reassignment (B38-40):** Slot $k$ completes teardown for lease $N$. Old worker retains password $P_N$ and continuously sends wire traffic. Slot $k$ rotates password to $P_{N+1}$ via `updateUser` (`changeOwnPassword`) with majority ack, updates Vault, and is assigned to Worker B (lease $N+1$). Old worker's packets fail authentication natively with Code 18 (`AuthenticationFailed`). Worker B authenticates successfully with $P_{N+1}$. Zero cross-lease access or data leakage is possible.
19. **Interleaving 19: Controller Crash Between MongoDB updateUser and Vault Secret Update (B38-40):** Provisioner rotates password to $P_{N+1}$ on MongoDB server (`w: "majority", j: true`), then crashes before updating Vault. On restart, recovery coordinator detects incomplete Phase 2 in `cleanup_ledger`. Because Vault secret is out of sync with MongoDB, slot transitions to `QUARANTINED`. The slot is excluded from reassignment until reconciliation controller rotates credentials afresh on both MongoDB and Vault.
20. **Interleaving 20: Concurrent JWT Redemptions Competing for Slot Token at Gateway (B38-41):** Two concurrent worker or provisioner threads obtain the same signed JWT and call `POST /v1/vault-gateway/slots/:slot_id/claim` simultaneously. Atomic CAS insert in `rs_coord:27019.jwt_redemptions` permits exactly one winner; the loser receives `MongoServerError: E11000 duplicate key error` $\rightarrow$ `HTTP 409 Conflict` and zero Vault tokens or requests are dispatched.
21. **Interleaving 21: Gateway Crash Between Durable jti Claim and Vault Login (B38-41):** Gateway commits `_id: jti` into `jwt_redemptions` with status `CLAIMED`, advances to `VAULT_REQUEST_SENT`, and crashes while the Vault call is in-flight. On recovery, the startup scanner classifies the outcome as ambiguous: transitions from `VAULT_REQUEST_SENT` $\rightarrow$ `OUTCOME_UNKNOWN` $\rightarrow$ `QUARANTINED`. The caller retry is rejected with `HTTP 409 Conflict` / `HTTP 423 Locked`. The provisioner saga aborts, triggers slot self-rotation before reassignment, and acquires a fresh lease with a newly minted `jti`. Vault's ephemeral token (TTL 60s) expires safely. Blind retries of the same `jti` are strictly rejected, and duplicate tokens are never minted.
22. **Interleaving 22: Worker or Provisioner Attempts Direct Vault Bypass While Gateway is Processing (B38-41):** While Gateway is claiming `jti` in MongoDB, an attacker on the worker network or compromised provisioner concurrently sends direct TCP packets to Vault port 8200. Kubernetes Layer 4 `NetworkPolicy` drops the packet immediately at the Linux netfilter data plane. The bypass attempt never reaches Vault, and caller receives zero token material.

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
| **`D38-36`** | **Scoped Partition Administrator Cross-Database Isolation & Broker Elimination Test (Finding B38-36)** | Authenticate as `decision_os_db_admin_slot_01` on `rs_test:27018`. Attempt `db.getSiblingDB("decision_os_test_slot_02").createUser(...)` and `db.getSiblingDB("decision_os_test_slot_02").createRole(...)` $\rightarrow$ natively rejected by MongoDB RBAC with Error Code 13 (`Unauthorized`). Verify that no active runtime service on the worker data path possesses `{ db: "", collection: "" }` userAdmin rights. Attempt to access a non-existent database without leasing a pre-allocated partition slot $\rightarrow$ assert request fails closed with `UnallocatedDatabaseException`. Verify optional dynamic broker is disabled in production via `DECISION_OS_DYNAMIC_PROVISIONING_ENABLED=false`. | Phase C1 | PLANNED |
| **`D38-37`** | **Partition Slot Vault Direct API Path Substitution & Single-Use Token Test (Finding B38-37)** | Provisioner acquires valid lease token for `slot_01` and logs into HashiCorp Vault at `/v1/auth/jwt/login`. Verify Vault issues a token with templated policy `secret/data/slots/slot_01` and `num_uses = 1`. Using direct HTTP client, attempt `GET /v1/secret/data/slots/slot_02` $\rightarrow$ assert Vault policy engine natively returns `HTTP 403 Forbidden`. Attempt `GET /v1/secret/data/slots/slot_01` $\rightarrow$ assert HTTP 200 returns credentials; immediately attempt secondary `GET /v1/secret/data/slots/slot_01` $\rightarrow$ assert `HTTP 403 Forbidden` (token revoked after single use). Attempt directory listing on `secret/metadata/slots` $\rightarrow$ assert `HTTP 403 Forbidden`. | Phase C4 | PLANNED |
| **`D38-38`** | **Nonce Allocator Root of Trust Compromise, Emergency Kill-Switch & Epoch Invalidation Test (Finding B38-38)** | Connect to `rs_coord:27019` using `decision_os_nonce_allocator` credentials. Simulate allocator compromise by executing `db.nonce_allocations.updateOne({ _id: "nonce_seq_v1" }, { $set: { nextBlockStart: 0 } })`. Lease block and submit credential envelope. Assert Monotonicity Watchdog detects regression against `cleanup_audit_log` high-water mark and trips emergency halt kill-switch (`rs_coord.emergency_halt = true`). Verify all worker encryption leases are immediately rejected. Trigger KMS DEK epoch invalidation; verify KMS increments `KeyVersionPrefix` (e.g. `0x0001` $\rightarrow$ `0x0002`). Re-seed sequence document under `_id: "nonce_seq_v2"`. Encrypt payloads under new epoch; assert nonces are provably disjoint from old epoch nonces. | Phase C2 | PLANNED |
| **`D38-39`** | **Canonical 5-Phase Revocation Execution State Machine & Crash Recovery Invariant Test (Finding B38-39)** | Initiate teardown for active worker on `decision_os_test_slot_01`. Verify exact execution ordering across phases: Phase 1 Network Transport Fencing $\rightarrow$ Phase 2 Scoped Identity Revocation $\rightarrow$ Phase 3 Operation & Session Cancellation $\rightarrow$ Phase 4 Database Storage Deletion $\rightarrow$ Phase 5 Audit Finalization. Inject process kill after Phase 1, Phase 2, and Phase 3; assert recovery coordinator resumes idempotently at the exact incomplete phase without skipping or reordering. Tamper with `cleanup_ledger` by zeroing `phase2_identity_revoked_at` while in `CLAIMED`; attempt to dispatch Phase 4 `dropDatabase` $\rightarrow$ assert prerequisite gate aborts drop, raises `SecurityException`, and transitions to `QUARANTINED`. | Phase C1 / C3 | PLANNED |
| **`D38-40`** | **Slot Credential Self-Rotation, Privilege Enforcement & Reassignment Gating Test Group (Finding B38-40)** | (1) **Self-Rotation with Correct Privilege:** Lease `slot_01` to Worker A; verify scoped admin `decision_os_db_admin_slot_01` has `actions: ["changeOwnPassword"]`. Dispatch `updateUser` self-rotation with `w: "majority", j: true`; assert returns `{ ok: 1 }` and password rotates from $P_N$ to $P_{N+1}$. (2) **Self-Rotation Authorization Failure with changePassword Only:** Create test role with action `changePassword` strictly (missing `changeOwnPassword`); attempt self `updateUser` $\rightarrow$ assert MongoDB RBAC natively rejects with Code 13 (`Unauthorized`). (3) **Old Password Wire Rejection:** Attempt direct SCRAM-SHA-256 wire authentication to `rs_test:27018` using retained password $P_N$ $\rightarrow$ assert natively rejected with Error Code 18 (`AuthenticationFailed`). (4) **New Password Acceptance:** Authenticate using $P_{N+1}$ $\rightarrow$ assert successful SCRAM handshake. (5) **Rotation Timeout / Unknown Outcome:** Inject TCP drop during `updateUser`; assert slot transitions to `QUARANTINED` and execution locks are permanently held. (6) **Primary Stepdown During Rotation:** Inject stepdown mid-command; assert transaction aborts and retry commits to new primary with disjoint generation. (7) **Retained Sockets & Session Behavior:** Open persistent socket with $P_N$; execute `updateUser` and Phase 3 `killOp`; assert subsequent wire commands on existing socket fail with Code 11/13/18. (8) **Premature Reassignment Gate:** Attempt to lease slot before rotation acknowledges $\rightarrow$ assert Coordination Authority rejects claim with `SlotNotAvailableException`. (9) **Privilege Matrix Deployment Parity:** Inspect deployed MongoDB role definition for `decision_os_db_admin_slot_${k}` on `rs_test`; assert exact match with Section 7.6 privilege matrix (`changeOwnPassword` present, `changePassword` absent). | Phase C1 / C4 | PLANNED |
| **`D38-41`** | **Vault Gateway Ingress Boundary, Durable 7-State Redemption Machine, Least Privilege & Token Taxonomy Test Group (Findings B38-41, B11-01 through B11-05, B12-03, B12-04)** | (1) **Layer 4 Network Ingress Fencing:** Execute `curl` to Vault port 8200 from worker and provisioner containers; verify Linux netfilter drops TCP SYN packets (zero TCP ACK). (2) **Admission Control Label Protection:** Attempt to schedule pod with label `app.kubernetes.io/name: vault-gateway` using unverified image $\rightarrow$ ValidatingAdmissionWebhook rejects creation. (3) **mTLS SPIFFE Caller Verification:** Invoke Gateway endpoint with invalid SPIFFE ID or without client certificate $\rightarrow$ assert rejected with HTTP 401/403 at TLS termination. (4) **Pre-Consumption CAS Atomicity:** Dispatch two concurrent requests with identical `jti` to Gateway; assert exactly one succeeds and second returns HTTP 409 Conflict with Code 11000. (5) **Vault Policy Separation (Read Token Denied Write/Rotate):** Capture ephemeral client token issued to Gateway; attempt `PUT /v1/secret/data/slots/slot_01` $\rightarrow$ assert rejected with Vault 403 Permission Denied (`slot-lease-reader` grants read-only). (6) **Per-Slot Native Vault Rotation Policy Isolation (Finding B12-03):** Authenticate with ephemeral token for `slot-rotator-slot_001`; attempt write to `secret/data/slots/slot_002` $\rightarrow$ assert native Vault HTTP 403 Forbidden. (7) **Token-Issuance Taxonomy & Redispatch Prohibition (Finding B12-04):** Configure reverse proxy and Gateway HTTP client with zero retries on login; simulate 504 timeout; verify state moves to `OUTCOME_UNKNOWN` $\rightarrow$ `QUARANTINED`; assert automated redispatch is strictly blocked. (8) **Vault Write Commitment Proof via CAS:** Execute rotation; verify Gateway queries `secret/metadata/slots/:slot_id` to confirm version increment before returning HTTP 200. (9) **Cross-Slot Path Substitution Rejection:** Submit valid revocation order for `slot_01` targeting endpoint `POST /v1/vault-gateway/slots/slot_02/rotate` $\rightarrow$ assert rejected with HTTP 403 Forbidden: Slot ID path mismatch. (10) **Complete Transition Fencing (All 7 States):** Verify every runtime transition filter includes exact `status`, `owner_instance_id`, and `fencing_generation`. Attempt update with stale generation $\rightarrow$ assert `matchedCount === 0` and `StaleGenerationException` thrown. (11) **Stale Generation Overwrite Rejection:** Pod A pauses after intent persistence; Recovery Service advances generation; Pod A resumes and attempts `ISSUED` commit $\rightarrow$ assert rejected and credentials not emitted. (12) **Failure Analysis Across All 11 Crash Points:** Inject simulated crashes at each of the 11 defined failure points; assert deterministic fail-closed state without credential leak. (13) **Ambiguous Vault Dispatch Quarantine:** Simulate Vault 504 timeout after dispatch; assert state moves `VAULT_REQUEST_SENT` $\rightarrow$ `OUTCOME_UNKNOWN` $\rightarrow$ `QUARANTINED`; verify second token issuance is strictly blocked. (14) **Zero Client Token Leakage:** Verify Provisioner receives minimal credentials (`username`, `password`) and NEVER receives a Vault client token. (15) **Recovery Service Safe Expiry:** Simulate crash before Vault dispatch (`CLAIMED` with `dispatch_attempted === false`); verify Recovery Service safely transitions record to `EXPIRED`. (16) **Recovery Service In-Flight Quarantine:** Simulate crash after dispatch; verify Recovery Service transitions record to `QUARANTINED` and NEVER re-dispatches Vault requests. | Phase C4 | PLANNED |
| **`D38-42`** | **Cryptographic Nonce Reuse Incident Response, Canonical WORM Evidence & Plaintext Integrity Verification Test Group (Findings B38-42, B11-06 through B11-12, B12-05, B12-06, B12-08)** | (1) **Emergency Containment:** Simulate allocator regression (`nextBlockStart: 0`); assert Monotonicity Watchdog trips `rs_coord.emergency_halt = true`, workers abort encryption, and all envelopes in epoch `v1` move to `QUARANTINED`. (2) **Workflow Rejection:** Attempt to pass quarantined envelope to authoritative workflow $\rightarrow$ assert rejected with `QuarantinedCiphertextException`. (3) **Pre-Incident Timestamp Enforcement:** Verify that evidence records created at or after $t_{\text{compromise}}$ ($t_{\text{evidence}} \ge t_{\text{compromise}}$) are strictly rejected as untrusted. (4) **Timestamp Representation Synchronization:** Provide evidence record with mismatch between ISO and epoch milliseconds $\rightarrow$ assert rejected immediately; verify exact match `1794304800000 === Date.parse("2026-11-10T10:00:00.000Z")` passes. (5) **Authoritative Complete 26-Field Schema v2.3.0 Validation:** Verify all 26 mandatory schema fields are present and structurally valid. (6) **Exact Plaintext Byte Length Validation:** Validate unencrypted candidate plaintext UTF-8 byte count; assert exactly 117 bytes; inject 115 or 118 bytes $\rightarrow$ assert rejected. (7) **Cryptographically Verified SHA-256 Digest Match:** Serialize candidate plaintext under RFC 8785 JCS; assert SHA-256 digest matches `decisionPayloadSha256` (`90ca3b570b7e806657a928518b70ee710b342ea6e315187e7a1dcc4b409cab4e`). Tamper with 1 byte $\rightarrow$ assert digest mismatch and fail-closed rejection. (8) **RFC 8785 JCS Canonicalization:** Verify deterministic lexicographical key ordering and elimination of whitespace. (9) **Primary Compliance HSM Signature Verification (Layer 1):** Verify `primaryEvidenceSignature` covers `DECISION_OS_WORM_SIGNATURE_V2: || CoreDigest` (Fields 1–17) using pinned HSM public key. (10) **RFC 3161 TSA Message Imprint Verification (Layer 2):** Verify TSA message imprint matches `SHA-256(DECISION_OS_TSA_COMMITMENT_V1: || CoreDigest || UTF8(primaryEvidenceSignature))` (Fields 1–18). (11) **Genuine RFC 3161 ASN.1 DER CMS Token Validation (Finding B12-05):** Parse ASN.1 DER structure; verify CMS `ContentInfo` type `id-signedData` with encapsulated `TSTInfo`, OIDs, and valid Ed25519 signature against test TSA cert. Test with Base64 JSON mock $\rightarrow$ assert parser throws `InvalidTimestampTokenStructureException`. (12) **RFC 6962 Domain-Separated Leaf Hash (Layer 3):** Compute leaf hash with `0x00` domain prefix over CoreDigest, Signature digest, and DER TSA digest (Fields 1–19); assert exact match with leaf commitment. (13) **Reconciled Authoritative Merkle Checkpoint Root Verification (Finding B12-06):** Evaluate `merkleInclusionProof` against authoritative root `e3f6f3504f211d64c383acb50260e7b6f6cccba7522f0fdf98b83cd8145d5248` at height 8421. Assert conflicting legacy roots (`46d6565b...` / `b8ccf706...`) fail verification. (14) **Transparency Notary Signature Verification:** Verify `merkleCheckpointSignature` covers `DECISION_OS_MERKLE_CHECKPOINT_V1: || CheckpointPayload` using Notary public key. (15) **Rigorous 5-Layer Commitment Scope Verification (Finding B12-08):** Verify unidirectional dependencies; ensure Merkle proof and checkpoint are external witnesses (Fields 20–24) and post-incident signatures are versioned extensions (Fields 25–26). (16) **Dual-Party Unquarantine Gate:** Attempt to unquarantine without Compliance Officer signature or without SRE Lead signature $\rightarrow$ assert blocked until both dual signatures are committed. (17) **Independent Key Registry:** Verify compliance HSM key is physically separated from Vault KMS. (18) **Physical WORM Media Retention:** Verify storage engine enforces S3 Object Lock / GCS Bucket Lock in COMPLIANCE mode $\ge 7$ years. (19) **Missing Evidence Fail-Closed:** Simulate envelope lacking WORM evidence $\rightarrow$ assert envelope is marked `REJECTED_DISCARDED` and discarded. (20) **Reproducible Synthetic Test Fixture Execution:** Execute Node.js reproduction script; assert synthetic fixture produces valid cryptographic outputs matching all 26 fields. | Phase C2 / C4 | PLANNED |
| **`D38-43`** | **Durable Slot Credential Rotation State Machine & Crash Recovery Verification Test Group (Findings B12-02, B12-03, B12-07)** | (1) **MongoDB Schema & Unique Index Enforcement:** Verify collection `decision_os_coordination.slot_rotation_log` enforces unique index on `operationId` and unique compound index on `{ slotId: 1, newCredentialGeneration: 1 }`. (2) **Gateway Privilege Matrix Verification:** Authenticate as Gateway; verify `find`, `insert`, `update` succeed on `slot_rotation_log`; verify `createIndex`, `remove`, `dropCollection` throw Code 13. (3) **Authoritative Generation Monotonicity ($N \rightarrow N+1$):** Submit rotation order with `currentCredentialGeneration: N`, `expectedPreviousGeneration: N`, `newCredentialGeneration: N + 1`; verify successful CAS write with `cas: N` and Vault metadata version $N+1$. (4) **Generation Rollback Rejection:** Submit rotation order with decremented or replayed generation $\rightarrow$ assert rejected with HTTP 409 Conflict. (5) **Crash Injection Across All 8 Crash Points:** Inject simulated crashes at CP-1 through CP-8; verify deterministic state transitions without credential loss or duplicate rotation. (6) **CAS Metadata Discovery Execution:** Simulate network drop during Vault write (CP-5); invoke `discoverVaultRotationCommit`; verify safe recovery based on durable Vault version query. (7) **Response Loss Idempotency:** Simulate dropped HTTP 200 after `VAULT_WRITE_CONFIRMED`; query `rotate-status?operationId=...`; verify idempotent return without re-writing to Vault. | Phase C4 | PLANNED |
| **`D38-44`** | **External Vault Audit Log Delivery & Forensic Non-Issuance Verification Test Group (Finding B12-01)** | (1) **Audit Stream Delivery to WORM Storage:** Verify Vault native `file` audit device emits JSON records to local pipe; verify Fluent Bit / Vector ships events over mTLS to S3 Object Lock / GCS Bucket Lock. (2) **Forensic Identity Least Privilege:** Authenticate as `decision_os_audit_investigator`; verify read-only access to audit logs; assert all read/write attempts to Vault port 8200 secret engine throw HTTP 403 Forbidden. (3) **Correlation Contract Verification:** Correlate Vault audit logs with Gateway transaction identifiers (`jti`, `operationId`, `slotId`, `fencing_generation`). (4) **Token Non-Issuance Forensic Proof:** Query WORM audit archive for ambiguous `jti`; prove absence of token creation or prove 401 rejection; assert safe release of quarantined slot. (5) **Secret Read Detection & Compromise Handling:** Inject audit entry showing `GET /v1/secret/data/slots/:slot_id` completed; attempt direct unquarantine $\rightarrow$ assert blocked; verify mandatory server-side password rotation. (6) **Audit Lag & Interruption Fail-Closed Test:** Simulate 45s audit streaming lag or pipeline failure; attempt administrative unquarantine $\rightarrow$ assert rejected with HTTP 424 Failed Dependency; verify slot remains locked. | Phase C4 | PLANNED |

### 20.3 Finding-to-Design-to-Test Traceability Matrix (B38-01 through B38-42)

The following matrix establishes strict, end-to-end mathematical and operational traceability from every architectural finding to its concrete design specifications, security invariants, and planned verification test suites:

| Finding ID | Severity / Phase | Title & Core Defect Summary | Primary Architecture Design Sections | Key Security Invariants & State Machine Transitions | Verification Test ID | Gate B Audit Status |
|---|---|---|---|---|---|---|
| **B38-01** | High / B.1 | Invalid MongoDB RBAC wildcard assumptions | Section 3.1, 7.6 | Discrete DB naming: `decision_os_test_slot_${k}`; zero wildcard syntax | `D38-01` | Verified (Phase B.1) |
| **B38-02** | Critical / B.2 | Additive role privilege leak on worker base role | Section 3.2, 7.6 | Worker base role stripped of `{ db: "", collection: "" }` write privileges | `D38-02` | Verified (Phase B.2) |
| **B38-03** | High / B.2 | Worker write access to coordination ledger | Section 7.6, 7.7 | Cluster boundary separation: `rs_test` workers have zero route to `rs_coord` | `D38-03` | Verified (Phase B.2) |
| **B38-04** | Med / B.1 | Self-referential payload hash in signing body | Section 8.1, 8.2 | `payloadHash` computed over semantic fields, excluding hash itself | `D38-04` | Verified (Phase B.1) |
| **B38-05** | High / B.1 | Shared symmetric HMAC secrets across callers | Section 8.3, 8.4 | Asymmetric Ed25519 signing with public key registry and replay window | `D38-05` | Verified (Phase B.1) |
| **B38-06** | High / B.2 | Unsafe administrative redispatch during ambiguous drop | Section 9.1, 10.1 | `forceRedispatch` permanently eliminated; locks held in `QUARANTINED` | `D38-06` | Verified (Phase B.2) |
| **B38-07** | Critical / B.2 | Fencing interleaving realism on wire dispatch | Section 10.2, 16.1 | Netfilter fencing precedes identity deletion; non-authoritative catalog drop | `D38-07` | Verified (Phase B.2) |
| **B38-11** | High / B.3 | Shared worker MongoDB credentials across leases | Section 7.5.1, 7.6 | Ephemeral per-worker principals: `decision_os_worker_${leaseId}_gen${gen}` | `D38-11` | Verified (Phase B.3) |
| **B38-12** | High / B.3 | Unsafe role-management privileges on `admin` DB | Section 7.5.2, 7.6 | Roles scoped natively to target test database namespace | `D38-12` | Verified (Phase B.3) |
| **B38-13** | Critical / B.3 | Non-authoritative catalog absence treated as drop | Section 10.4, 10.5 | Authoritative oplog correlation token verified with majority write concern | `D38-13` | Verified (Phase B.3) |
| **B38-14** | Med / B.3 | Role lifecycle and provisioning concurrency races | Section 7.5.3, 16.3 | Random suffix roles and generation-bump invalidation | `D38-14` | Verified (Phase B.3) |
| **B38-15** | High / B.4 | Engine limitations of `killAllSessionsByPattern` | Section 7.8, 16.3 | Multi-layer server-side revocation defending against open TCP sockets | `D38-15` | Verified (Phase B.4) |
| **B38-16** | High / B.4 | Oplog evidence protocol operational realism | Section 10.4, 10.6 | Fallback to `QUARANTINED` when oplog comments absent or uncommitted | `D38-16` | Verified (Phase B.4) |
| **B38-17** | Critical / B.5 | Crash-safe ephemeral credential recovery | Section 7.7, 7.10 | Caller-bound AES-256-GCM encrypted envelopes with deterministic nonces | `D38-17` | Verified (Phase B.5) |
| **B38-18** | High / B.5 | Provisioning saga durability and crash recovery | Section 7.5.2, 9.2 | Durable 12-state idempotent saga with crash recovery at every step | `D38-18` | Verified (Phase B.5) |
| **B38-19** | High / B.5 | Tamper-evident audit ledger verification | Section 7.11, 7.12 | Append-only audit ledger with Ed25519-signed external checkpoints | `D38-19` | Verified (Phase B.5) |
| **B38-20** | Critical / B.5 | Destructive vs coordination cluster separation | Section 5, 7.1 | Multi-deployment boundary: `rs_coord:27019` physically separate from `rs_test` | `D38-20` | Verified (Phase B.5) |
| **B38-24** | High / B.5 | Role provisioning decoupled from cleanup executor | Section 5, 7.2 | Dedicated Provisioning Service decoupled from Destructive Executor | `D38-24` | Verified (Phase B.5) |
| **B38-25** | High / B.5 | Permanent worker identity revocation enforcement | Section 7.8, 7.9 | Server-side `dropUser` with majority write concern invalidates cache | `D38-25` | Verified (Phase B.5) |
| **B38-26** | Critical / B.6 | Central provisioner cross-database privilege leak | Section 3.3, 7.5 | Database-scoped provisioning delegation model with pre-allocated slots | `D38-26` | Verified (Phase B.6) |
| **B38-27** | High / B.6 | Revocation service responsibilities and coordination | Section 7.9, 9.3 | 2-phase durable coordination protocol between Cleanup Executor and Provisioner | `D38-27` | Verified (Phase B.6) |
| **B38-28** | Critical / B.6 | AES-256-GCM cryptographic nonce uniqueness | Section 7.10, 8.4 | NIST SP 800-38D §8.2.1 deterministic counter block allocation via atomic `$inc` | `D38-28` | Verified (Phase B.6) |
| **B38-31** | High / B.7 | Bootstrap broker explicit security boundary | Section 3.3, 7.5 | Slot vault path-based ACL; offline bootstrap credential destruction | `D38-31` | Verified (Phase B.7) |
| **B38-32** | Critical / B.7 | Nonce allocation authority decoupling | Section 7.10, 8.4 | Dedicated Nonce Allocation Service; 96-bit nonce encoding specification | `D38-32` | Verified (Phase B.7) |
| **B38-33** | Med / B.7 | MongoDB `killOp` privilege action scoping | Section 7.6, 7.8 | Corrected to `{ resource: { cluster: true }, actions: ["killop", "inprog"] }` | `D38-33` | Verified (Phase B.7) |
| **B38-34** | Med / B.7 | MongoDB `findAndModify` privilege action audit | Section 7.6, 7.7 | Removed `findAndModify` from privilege action lists; engine denial verified | `D38-34` | Verified (Phase B.7) |
| **B38-35** | High / B.7 | Network transport fencing integration into teardown | Section 7.9, 16.1 | Netfilter/CNI controller transport fencing integrated as Step 2 of teardown | `D38-35` | Verified (Phase B.7) |
| **B38-36** | Critical / B.8 | Elimination of broker cross-database blast radius | Section 3.3, 7.5 | Canonical Pre-Provisioned Partition Pool selected; broker disabled in prod | `D38-36` | Verified (Phase B.8) |
| **B38-37** | High / B.8 | Partition Slot Vault exact lease-to-secret binding | Section 7.5.4, 8.5 | Templated policy bound strictly to Entity Alias Metadata (refined in B38-41) | `D38-37` | Verified (Phase B.8) |
| **B38-38** | High / B.8 | Nonce Allocator as Cryptographic Root of Trust | Section 3.5, 7.10.2 | Allocator defined as Root of Trust; kill-switch latch (refined in B38-42) | `D38-38` | Verified (Phase B.8) |
| **B38-39** | High / B.8 | Normalization of 5-phase revocation ordering | Section 7.9, 9.3 | Canonical 5-phase ordered state machine; prerequisite drop gating | `D38-39` | Verified (Phase B.8) |
| **B38-40** | **Critical / B.10** | **Vault lease expiry leaves reusable credential & self-rotation privilege error** | **Section 3.6, 7.5.6, 7.6, 7.9** | **Option B Slot Credential Rotation; self-rotation strictly requires `changeOwnPassword`; broader `changePassword` excluded; Mandatory Invariants 1–8; Slot Reassignment Gate** | **`D38-40`** | **Remediated (Phase B.10 Deliverable — Pending Review)** |
| **B38-41** | **High / B.12** | **Vault gateway topology, durable 7-state JWT machine, L3/L4 NetworkPolicy, stale metadata** | **Section 3.7, 5, 6, 7.5, 7.6, 8.5, 9.4, 9.5, 10.3** | **Dedicated Vault Gateway mediates all Vault calls; Provisioner never receives Vault token; Layer 4 NetworkPolicy; Gateway `find, insert, update` privileges; durable 7-state machine; fail-closed quarantine; Entity Alias Metadata** | **`D38-41`** | **Remediated (Phase B.12 Deliverable — Pending Review)** |
| **B38-42** | **High / B.12** | **Nonce reuse realities, 26-field WORM evidence, timestamp synchronization, RFC 8785 signature, TSA proof** | **Section 3.8, 7.10.3.2.C, 14, 15** | **5-phase Incident State Machine; 26-field schema v2.2.0; timestamp sync (`1794304800000 === 2026-11-10T10:00:00.000Z`); byte length 117; RFC 8785 JCS Ed25519 signature semantics; independent TSA & Merkle proof; concrete digest `90ca3b57...`** | **`D38-42`** | **Remediated (Phase B.12 Deliverable — Pending Review)** |
| **B11-01** | **High / B.12** | **Vault rotation authorization, policy separation & signed order binding** | **Section 3.7, 7.5.4, 7.6** | **Separate `slot-lease-reader` (read-only) and `slot-credential-rotator` (write-only); signed revocation order binding; CAS commitment proof; path substitution prevention** | **`D38-41`** | **Remediated (Phase B.12 Deliverable — Pending Review)** |
| **B11-02** | **High / B.12** | **Complete fencing on every JWT state transition & runtime `createIndex` removal** | **Section 3.7, 7.6, 9.4** | **Complete CAS filter (status, owner, generation) on all 7 states; monotonic advancement; `createIndex` stripped from Gateway role** | **`D38-41`** | **Remediated (Phase B.12 Deliverable — Pending Review)** |
| **B11-03** | **Critical / B.12** | **Resolution of dispatch-intent vs wire delivery ambiguity & 11 crash points** | **Section 3.7, 9.4** | **`VAULT_REQUEST_SENT` proves intent only; conservative fail-closed quarantine; zero duplicate tokens; 4 guarantees taxonomy** | **`D38-41`** | **Remediated (Phase B.12 Deliverable — Pending Review)** |
| **B11-04** | **High / B.12** | **Authoritative Recovery Service & takeover protocol** | **Section 7.6, 9.5** | **Standalone Recovery Service; zero Vault route; monotonic takeover CAS; safe expiry of un-dispatched vs quarantine of in-flight** | **`D38-41`** | **Remediated (Phase B.12 Deliverable — Pending Review)** |
| **B11-05** | **High / B.12** | **Administrative reconciliation authorization for Vault Gateway** | **Section 7.6, 11.5** | **Dedicated `decision_os_admin_reconciler`; signed dual-party order (SRE + Compliance); independent Vault audit log proof** | **`D38-41`** | **Remediated (Phase B.12 Deliverable — Pending Review)** |
| **B11-06** | **High / B.12** | **Correction of SHA-256 test vector** | **Section 1, 3.8, 7.10.3.2.C, 14** | **Exact SHA-256 digest `90ca3b570b7e806657a928518b70ee710b342ea6e315187e7a1dcc4b409cab4e` of 117-byte canonical payload** | **`D38-42`** | **Remediated (Phase B.12 Deliverable — Pending Review)** |
| **B11-07** | **Med / B.12** | **Correction of plaintext byte length** | **Section 1, 3.8, 7.10.3.2.C, 14** | **Exact UTF-8 byte count: 117 bytes (`Buffer.from(c, "utf8").length === 117`); test rejects mismatched lengths** | **`D38-42`** | **Remediated (Phase B.12 Deliverable — Pending Review)** |
| **B11-08** | **High / B.12** | **Authoritative & complete Canonical WORM Evidence Schema v2.2.0** | **Section 3.8, 7.10.3.2.C, 14** | **Authoritative 26-data-field schema v2.2.0; comprehensive 26-field inventory table with immutability and inclusion metadata** | **`D38-42`** | **Remediated (Phase B.12 Deliverable — Pending Review)** |
| **B11-09** | **High / B.12** | **Timestamping complete evidence commitment via RFC 3161 imprint** | **Section 3.8, 7.10.3.2.C, 14** | **RFC 3161 imprint over `DECISION_OS_TSA_COMMITMENT_V1: || CoreDigest || UTF8(primaryEvidenceSignature)`; ASN.1 DER check** | **`D38-42`** | **Remediated (Phase B.12 Deliverable — Pending Review)** |
| **B11-10** | **High / B.12** | **Multi-stage non-circular Merkle construction** | **Section 3.8, 7.10.3.2.C, 14** | **Unidirectional pipeline: Core $\rightarrow$ HSM Sig $\rightarrow$ TSA $\rightarrow$ Leaf Hash $\rightarrow$ Tree Root & Proof $\rightarrow$ Dual-Party Unquarantine** | **`D38-42`** | **Remediated (Phase B.12 Deliverable — Pending Review)** |
| **B11-11** | **High / B.12** | **Independent digital signature semantics (4 distinct roles)** | **Section 3.8, 7.10.3.2.C, 14** | **Formal specifications for Compliance HSM, Notary, Compliance Officer, and SRE Lead signatures with unique domain prefixes** | **`D38-42`** | **Remediated (Phase B.12 Deliverable — Pending Review)** |
| **B11-12** | **Med / B.12** | **Reproducible synthetic test fixture (Option A)** | **Section 3.8, 7.10.3.2.C, 14** | **Concrete verifiable synthetic JSON fixture from deterministic seeds; Node.js reproduction script; height 8421; root `e3f6f350...`** | **`D38-42`** | **Remediated (Phase B.12 Deliverable — Pending Review)** |
| **B12-01** | **High / B.13** | **Vault audit evidence retrieval & reconciliation authorization** | **Section 3.7, 7.6.2, 11.5, 14** | **`sys/audit` does not return logs; external audit streaming over mTLS to WORM S3/GCS; dedicated forensic identity `decision_os_audit_investigator`; fail-closed on stream delay** | **`D38-44`** | **Remediated (Phase B.13 Deliverable — Pending Review)** |
| **B12-02** | **Critical / B.13** | **Gateway access to `slot_rotation_log` & crash-safe rotation recovery** | **Section 3.7, 7.6.1, 9.6, 14** | **`slot_rotation_log` schema & unique indexes; Gateway granted `find, insert, update`; durable 7-state rotation machine; 8 crash points analyzed; CAS metadata discovery** | **`D38-43`** | **Remediated (Phase B.13 Deliverable — Pending Review)** |
| **B12-03** | **High / B.13** | **Vault-enforced per-slot rotation authorization boundary** | **Section 3.7, 7.5.4, 7.6.2, 14** | **Eliminated wildcard `secret/data/slots/+`; 256 discrete per-slot policies `slot-rotator-slot_000` through `slot-rotator-slot_255`; ephemeral scoped token exchange; native Vault 403** | **`D38-41`** | **Remediated (Phase B.13 Deliverable — Pending Review)** |
| **B12-04** | **High / B.13** | **Token-issuance guarantee taxonomy & redispatch prohibition** | **Section 3.7, 9.4, 14** | **`token_num_uses = 1` governs consumption, not issuance; Vault token issuance marked NOT GUARANTEED across untracked networks; zero automated redispatch across proxies/mesh** | **`D38-41`** | **Remediated (Phase B.13 Deliverable — Pending Review)** |
| **B12-05** | **High / B.13** | **Genuine synthetic RFC 3161 DER timestamp token fixture** | **Section 3.8, 7.10.3.2.C, 14** | **Replaced Base64 JSON mock with genuine ASN.1 DER CMS ContentInfo SignedData (612 bytes); verified with standalone Python/Node ASN.1 parsers** | **`D38-42`** | **Remediated (Phase B.13 Deliverable — Pending Review)** |
| **B12-06** | **High / B.13** | **Reconciliation of single authoritative Merkle checkpoint root** | **Section 1, 3.8, 7.10.3.2.C, 14** | **Recomputed deterministic Merkle tree; eliminated conflicting roots; single authoritative root `e3f6f3504f211d64c383acb50260e7b6f6cccba7522f0fdf98b83cd8145d5248` at height 8421** | **`D38-42`** | **Remediated (Phase B.13 Deliverable — Pending Review)** |
| **B12-07** | **High / B.13** | **Authoritative credential-generation contract & Vault KV-v2 binding** | **Section 3.7, 7.5.4, 9.6, 14** | **Generation contract ($N \rightarrow N+1$): `currentCredentialGeneration: N`, `expectedPreviousGeneration: N`, `newCredentialGeneration: N + 1`; bound to Vault KV-v2 version; CAS `cas: N`** | **`D38-43`** | **Remediated (Phase B.13 Deliverable — Pending Review)** |
| **B12-08** | **High / B.13** | **Rigorous cryptographic evidence commitment scope formulation** | **Section 3.8, 7.10.3.2.C, 14** | **Delineated 5 distinct cryptographic layers: Layer 1 (Fields 1–17 Core), Layer 2 (Fields 1–18 TSA Imprint), Layer 3 (Fields 1–19 Merkle Leaf), Layer 4 (Fields 20–24 External Witnesses), Layer 5 (Fields 25–26 Post-Incident Extension)** | **`D38-42`** | **Remediated (Phase B.13 Deliverable — Pending Review)** |
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
10. **Elimination of the Runtime Credential Broker & Blast Radius (Finding B38-36):**
    In MongoDB RBAC, granting `{ db: "", collection: "" }` user- and role-management actions confers wildcard authority over every non-system database. Application-level regex validation and signed claims cannot provide native database isolation against a compromised broker authenticating directly to MongoDB. To eliminate this cross-database blast radius, the runtime broker is **completely removed from the active worker execution path**. Standard workloads execute exclusively against pre-allocated partition slots where each administrator is strictly scoped to its single slot. Dynamic database creation is designated as an offline control-plane root of trust (`deploy/init-mongo-test.sh`), and the dynamic broker is disabled in production (`DECISION_OS_DYNAMIC_PROVISIONING_ENABLED=false`).
11. **Partition Slot Vault Exact Lease-to-Secret Binding (Finding B38-37):**
    By utilizing HashiCorp Vault templated identity policies (`path "secret/data/slots/{{identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id}}"`) and a single-use JWT exchange model (`num_uses = 1`, `ttl = 60s`, `renewable = false`), the provisioner is physically restricted to reading only the exact slot credential for its active lease. Direct path guessing or path substitution attacks (`slot_02` using a `slot_01` token) are natively rejected by Vault with HTTP 403 Forbidden.
12. **Nonce Allocator as an Explicit Cryptographic Root of Trust (Finding B38-38):**
    Because MongoDB RBAC cannot enforce monotonic arithmetic against an identity possessing `update` privileges, the Nonce Allocator is formally identified as a Cryptographic Root of Trust. Allocator compromise cannot be prevented at the database authorization layer. Safety degrades to detection by an external Monotonicity Watchdog, followed by an emergency kill-switch, KMS Data Encryption Key (DEK) epoch retirement, `KeyVersionPrefix` incrementation (rendering new ciphertexts provably disjoint from compromised ciphertexts), and envelope quarantine/re-encryption under clearly defined trust assumptions.
13. **Canonical 5-Phase Revocation Execution & Prerequisite Gating (Finding B38-39):**
    The revocation protocol strictly follows a 5-phase execution state machine: Phase 1 Network Transport Fencing $\rightarrow$ Phase 2 Scoped Identity Revocation $\rightarrow$ Phase 3 Operation & Session Cancellation $\rightarrow$ Phase 4 Database Storage Deletion $\rightarrow$ Phase 5 Audit Finalization. Database deletion (`dropDatabase`) is strictly gated on verified durable acknowledgements for Phases 1, 2, and 3 in `cleanup_ledger`; if any prior phase is missing or unverified, teardown immediately fails closed into `QUARANTINED`.
14. **MongoDB Server-Side Authorization Cache Invalidation Latency on updateUser (Finding B38-40):**
    While MongoDB documentation specifies that modifying user credentials updates the internal authorization cache on replica set primaries, the exact timing and wire-level behavior across secondary nodes during primary stepdown under heavy load must be benchmarked in Phase C (`D38-40`). The system relies on journaled majority write concern (`w: "majority", j: true`) to ensure cluster-wide commit.
15. **Kubernetes CNI / NetworkPolicy Enforcement Parity & Workload Identity Model (Finding B38-41):**
    The Layer 4 NetworkPolicy fencing model operates strictly at Layer 3/Layer 4 (IP/port) and cannot filter HTTP URL paths on the same port. Ingress to Vault TCP port 8200 is restricted exclusively to pods matching the Dedicated Vault Gateway selector (`app.kubernetes.io/name: vault-gateway`).
    Because Kubernetes pod labels are control-plane metadata, this boundary strictly relies on: (1) strict Kubernetes RBAC preventing unprivileged service accounts from creating or updating pods in `decision-os-system`; (2) Admission Control (ValidatingAdmissionWebhook / OPA Gatekeeper) enforcing container image provenance; and (3) Layer 7 SPIFFE mTLS authentication between Gateway and Vault. Tested in `D38-41`.
16. **Canonical WORM Plaintext Evidence Record Immutability, Timestamping & Proof Standards (Findings B38-42, B11-06 through B11-12, B12-05 through B12-08):**
    Signer-controlled timestamps alone cannot prove pre-incident creation if the signing system is suspect. The incident recovery protocol assumes that evidence records are bound to independent external proof: (1) a genuine RFC 3161 Timestamp Token (TST) in ASN.1 DER CMS `ContentInfo` `SignedData` structure (612 bytes, Finding B12-05) issued by an independent public or enterprise Timestamp Authority; and (2) an immutable Merkle audit tree checkpoint height anchored to write-once storage (S3 Object Lock in COMPLIANCE mode / GCS Bucket Lock) with retention exceeding 7 years, verified against the single authoritative root `e3f6f3504f211d64c383acb50260e7b6f6cccba7522f0fdf98b83cd8145d5248` at height 8421 (Finding B12-06).
    Timestamp representations are strictly synchronized: `evidenceCreatedAtEpochMs === Date.parse(evidenceCreatedAtISO)`. Candidate plaintext validation strictly requires byte-exact RFC 8785 JCS canonicalization (117 bytes, SHA-256 `90ca3b570b7e806657a928518b70ee710b342ea6e315187e7a1dcc4b409cab4e`), 5-layer cryptographic scope delineation (Finding B12-08), and dual-party SRE/Security Officer cryptographic authorization prior to unquarantine. Tested in `D38-42`.
17. **HashiCorp Vault Entity Alias Metadata Templating Syntax Across Vault Versions (Finding B38-41):**
    Vault documentation confirms that `claim_mappings` populates Entity Alias Metadata under the auth mount accessor. The templated policy syntax `{{identity.entity.aliases.<accessor>.metadata.<key>}}` is supported in Vault 1.9+, but the exact mount accessor identifier must be provisioned dynamically during cluster bootstrap and injected into policy templates. Tested in `D38-41`.
18. **External Compliance HSM Audit Key Provenance and Offline Custody (Finding B38-42):**
    The Ed25519 signing key used to sign Canonical WORM Plaintext Evidence Records (`signingKeyId`) must be held in an external hardware security module (HSM) completely isolated from Vault and Kubernetes workloads, operated under dual-control ceremonies. Tested in `D38-42`.
19. **Vault Rotation Policy Separation & Check-And-Set Monotonicity (Finding B11-01):**
    Vault KV-v2 check-and-set (`cas: current_version`) relies on Vault's storage engine concurrency control. The Gateway proves commitment by inspecting `metadata.current_version` before acknowledging rotation. Tested in `D38-41`.
20. **Durable Fencing Monotonicity across Replica Set Failovers (Findings B11-02, B11-03):**
    MongoDB atomic CAS filters `{ status, owner_instance_id, fencing_generation }` committed with `w: "majority", j: true` guarantee linearizable monotonicity across replica set primary failovers. Stale gateway instances receive `matchedCount === 0`. Tested in `D38-41`.
21. **Standalone Recovery Service Network Isolation & Zero Vault Route (Finding B11-04):**
    The Recovery Service has zero network route to Vault port 8200. It reclaims abandoned records strictly in MongoDB and is physically incapable of dispatching Vault requests. Tested in `D38-41`.
22. **Administrative Reconciliation Dual-Party Cryptographic Trust (Finding B11-05):**
    Reconciliation of quarantined slots cannot be executed unilaterally by a single operator or automated service. It requires independent cryptographic authorization from both the SRE Lead and Security Compliance Officer with verified Vault audit log proof. Tested in `D38-41`.
23. **Vault External Audit Delivery Latency & Fail-Closed Quarantine (Finding B12-01):**
    External streaming of Vault audit JSON over mTLS to cloud WORM object storage introduces asynchronous delivery lag (typically 500ms–5s). If streaming is delayed (>30s), lagged, or interrupted, the administrative reconciliation process strictly fails closed, blocking unquarantine until log continuity is re-established. Tested in `D38-44`.
24. **Per-Slot Discrete Vault Policy Scalability (Finding B12-03):**
    Generating 256 discrete Vault policies (`slot-rotator-slot_000` through `slot-rotator-slot_255`) provides Vault-native per-slot write isolation. In ultra-large deployments scaling beyond 1024 slots, bootstrap automation must evaluate HashiCorp Vault performance with thousands of ACL policies or transition to dynamic entity-aliased rotation policies once Vault provides native token-bound path templating for write operations. Tested in `D38-41`.
25. **Durable Credential Rotation State Machine & CAS Discovery (Findings B12-02, B12-07):**
    Slot credential rotations are recorded in `decision_os_coordination.slot_rotation_log` across a 7-state machine with unique indexes on `operationId` and `{ slotId, newCredentialGeneration }`. Ambiguous in-flight outcomes are resolved via CAS metadata query without duplicate writes. Tested in `D38-43`.

---

## Gate B Completion Sign-Off Checklist

- [x] Document version upgraded to **2.3.0**
- [x] Current Baseline commit: `d6a35bd7910f9c028357d855e9f98caf3689b038`
- [x] Parent baseline commit: `63c3a6e3201600e042f78ec51a3e97fcb739e4fa`
- [x] Phase A destructive call-site inventory cross-checked: all 13 sites correctly mapped to safe replacements
- [x] Independent Cleanup Executor process boundary established: distinct OS process, dedicated binary/container, zero shared memory, zero application framework sharing
- [x] Dedicated Cleanup Executor MongoDB user defined: `decision_os_destructive_executor` with zero write access to business collections and zero access to `mongodb-coord:27019`
- [x] Dedicated Coordination MongoDB user defined: `decision_os_provisioner` with zero drop privileges
- [x] Real MongoDB privilege scoping: wildcard DB names replaced with discrete per-database dynamic application roles on `rs_test` and multi-deployment boundary separating test and coordination clusters
- [x] Request payload hash: includes all semantic fields, excludes `payloadHash` itself; test vector verified
- [x] Request signing: Asymmetric Ed25519 signing with public key registry and replay protection (UUID v4 + timestamp + window)
- [x] State machine: 5 primary states (`REQUESTED`, `CLAIMED`, `DISPATCHING`, `CLEANED`, `OUTCOME_UNKNOWN`, `QUARANTINED`), zero redispatch after `DISPATCHING`
- [x] Ambiguous drop handling: Catalog absence observed is non-authoritative; authoritative oplog evidence required for `CONFIRM_CLEANED`; `QUARANTINED` preserves execution locks permanently
- [x] Administrative reconciliation: strictly requires signed SRE request with authorization token and ticket ID; contains zero direct drop capability; redispatch permanently eliminated
- [x] B38-02 remediated (Phase B.2): Worker base role stripped of `{ db: "", collection: "" }` write privileges; dynamic per-database roles provisioned on `POST /v1/ownership/claim`
- [x] B38-03 remediated (Phase B.2): Worker base role stripped of `{ db: "", collection: "" }` write privileges; worker cannot write to `cleanup_ledger`
- [x] B38-06 remediated (Phase B.2): `forceRedispatch` administrative outcome eliminated; fail-closed safety preserved via `QUARANTINED`
- [x] B38-07 remediated (Phase B.2): Wire dispatch race acknowledged; administrative redispatch eliminated; `QUARANTINED` preserves locks indefinitely
- [x] B38-11 remediated (Phase B.3): Shared MongoDB worker user eliminated; unique per-worker principals with ephemeral credentials provisioned
- [x] B38-12 remediated (Phase B.3): Unsafe role-management privileges on `admin` eliminated; dynamic roles scoped natively to test namespaces
- [x] B38-13 remediated (Phase B.3): Authoritative oplog evidence protocol formalized with structured correlation tokens and replica-set majority verification
- [x] B38-14 remediated (Phase B.3): Role lifecycle and provisioning concurrency analyzed; dynamic roles generated with random suffix; generation-bump invalidation
- [x] B38-15 remediated (Phase B.4): Corrected MongoDB session invalidation; engine limitations of `killAllSessionsByPattern` documented; prepared transactions and unsessioned operations handled; permanent revocation enforced
- [x] B38-16 remediated (Phase B.4): Oplog evidence protocol made supportable; fallback to `QUARANTINED` when oplog comments absent or uncommitted; fail-closed policy preserved
- [x] B38-17 remediated (Phase B.4 / B.5): Crash-safe ephemeral credential recovery via caller-bound encrypted envelopes (`ownership_locks.credentialEnvelope`) utilizing AES-256-GCM with deterministic 96-bit nonces, versioned keys, dual-key rotation, and strict durable majority acknowledgement ordering before envelope destruction
- [x] B38-18 remediated (Phase B.4 / B.5): False provisioning atomicity claims replaced with a durable idempotent saga model spanning exactly 12 formalized states with crash/restart recovery at every transition, failed-compensation retry, and strict orphan reaper verification proof
- [x] B38-19 remediated (Phase B.4 / B.5): Audit ledger made genuinely tamper-evident by separating audit privileges from coordination CRUD; enforcing append-only via MongoDB RBAC (`find`, `insert`, `createIndex` only); independently protected external Ed25519-signed checkpoints; 60s cadence; detection of deletion, truncation, reordering, substitution, and rewriting
- [x] **B38-20 remediated (Phase B.5):** Destructive authority separated from coordination and audit storage via physical/logical two-deployment boundary (`rs_coord:27019` vs `rs_test:27018`); mathematical proof of impossibility of destructive cleanup dropping coordination or audit data
- [x] **B38-24 remediated (Phase B.5):** Role provisioning authority decoupled from destructive cleanup into dedicated Provisioning Service; removed false claims that application AST checks constitute native RBAC; dynamic roles scoped natively by creating directly on target test database namespace; independent threat models for compromised actors
- [x] **B38-25 remediated (Phase B.5):** Permanent worker revocation established; documented engine limitations of `killAllSessionsByPattern`; addressed prepared distributed transactions; rejected client `client.close(true)` as security boundary; formulated multi-layer server-side revocation defending against hostile workers retaining sockets
- [x] **B38-26 remediated (Phase B.6):** Cross-database provisioning authority eliminated; Database-Scoped Provisioning Delegation Model formulated; dynamic DB bootstrap mediated via pre-allocated partition pools and isolated brokers; role-definition vs management/user/grant authorization scopes distinguished; negative authorization cases NC-1–NC-8 defined
- [x] **B38-27 remediated (Phase B.6):** Revocation service responsibilities reconciled; 2-phase durable coordination protocol established between Cleanup Executor and Scoped Provisioner; all 8 operations fully allocated; client API responses and connection closure rejected as proof
- [x] **B38-28 remediated (Phase B.6):** Cryptographic AES-256-GCM nonce uniqueness formulated via NIST SP 800-38D §8.2.1 deterministic counter block reservation on `rs_coord:27019.nonce_allocations`; crash/restart discard, rollback protection, key-version separation, backup restore epoch bumping, and fail-closed availability halt defined
- [x] **B38-31 remediated (Phase B.7):** Bootstrap broker explicit security boundary established; broker MongoDB privileges scoped; slot vault path-based ACL prevents bulk enumeration; offline bootstrap credential destruction and recovery protocol defined
- [x] **B38-32 remediated (Phase B.7):** Nonce allocation authority decoupled into dedicated Nonce Allocation Service (`apps/nonce-allocator`, `decision_os_nonce_allocator`); `$set` reset prevented; 96-bit nonce encoding formally specified; mathematical uniqueness qualified with explicit trust assumptions
- [x] **B38-33 remediated (Phase B.7):** MongoDB `killOp` privilege scope corrected to `{ resource: { cluster: true }, actions: ["killop", "inprog"] }`; lowercase action spelling verified; command database (`admin.$cmd`) distinguished from cluster authorization resource
- [x] **B38-34 remediated (Phase B.7):** `findAndModify` removed from privilege action lists; all MongoDB RBAC actions audited against engine documentation; underlying `update`/`remove` denial verified to prevent `findAndModify` write mutations
- [x] **B38-35 remediated (Phase B.7):** Network Transport Fencing integrated into durable revocation protocol as Step 2; exact CNI/netfilter controller identity, API, and retry/fail-closed semantics defined; 6 isolation layers formally distinguished; `dropDatabase` never represented as network fencing
- [x] **B38-36 remediated (Phase B.8):** Broker cross-database authority eliminated from active worker path; Pre-Provisioned Partition Pool selected as canonical runtime architecture; scoped slot admins (`decision_os_db_admin_slot_${k}`) natively isolated by MongoDB RBAC; dynamic broker classified as control-plane root of trust disabled in production
- [x] **B38-37 remediated (Phase B.8 / Refined B.9 & B.10):** Partition Slot Vault exact lease-to-secret binding formally specified; templated policy refined to target Entity Alias Metadata `secret/data/slots/{{identity.entity.aliases.auth_jwt_9f8e7d6c.metadata.slot_id}}`; single-use JWT exchange; direct path guessing and substitution rejected with HTTP 403 Forbidden
- [x] **B38-38 remediated (Phase B.8 / Refined B.9 & B.10):** Nonce Allocator formally defined as an explicit Cryptographic Root of Trust; 3 compromise classes distinguished; MongoDB RBAC inability to restrict `$inc` vs `$set` documented; emergency kill-switch, KMS DEK epoch retirement, `KeyVersionPrefix` increment, and formal incident response defined (refined in B38-42)
- [x] **B38-39 remediated (Phase B.8):** Revocation execution ordering normalized into canonical 5-Phase Ordered Revocation State Machine; `Execution Phase` column added to operation matrix; Phase 4 `dropDatabase` strictly gated on durable verification of Phases 1, 2, and 3; idempotent crash recovery protocol specified for all 5 phases
- [ ] **B38-40 remediated (Phase B.10):** MongoDB self-credential rotation privilege corrected: `decision_os_db_admin_slot_${k}` granted `actions: ["changeOwnPassword"]` strictly on `{ db: targetTestDb, collection: "" }`; broader `changePassword` explicitly excluded; Option B Slot Credential Rotation confirmed with server-side `updateUser` majority journaled commit before slot reassignment; Option A enforced for worker workload principals; Mandatory Invariants 1–8 established; session termination alone recognized as non-invalidating for retained credentials (Phase B.10 Deliverable – Pending Independent Review)
- [ ] **B38-41 remediated (Phase B.12):** Dedicated Vault Gateway mediates all Vault interactions (JWT exchange, slot credential reads, rotation writes); Provisioner never receives Vault client tokens; Layer 4 NetworkPolicy blocks direct worker and provisioner routes to Vault port 8200; Kubernetes RBAC and Admission Control prevent label spoofing; Gateway granted `find`, `insert`, `update` (runtime `createIndex` stripped); durable 7-state redemption machine (`CLAIMED` $\rightarrow$ `VAULT_REQUEST_SENT` $\rightarrow$ `ISSUED` / `OUTCOME_UNKNOWN` $\rightarrow$ `QUARANTINED` / `RECONCILED` / `EXPIRED`); complete transition fencing; conservative fail-closed quarantine on ambiguous Vault timeouts; wire ambiguity resolved; Authoritative Recovery Service specified; all stale metadata references corrected to Entity Alias Metadata (Phase B.12 Deliverable – Pending Independent Review)
- [ ] **B38-42 remediated (Phase B.12):** Mathematical realities of AES-256-GCM nonce reuse ($P_1 \oplus P_2$ confidentiality loss and GHASH $H$ forgery) enforced; false claims of repair via key rotation or re-encryption eliminated; authoritative 26-data-field `CanonicalWormPlaintextEvidenceRecord` Schema v2.2.0 specified; timestamp ISO and epoch representations synchronized (`1794304800000 === Date.parse("2026-11-10T10:00:00.000Z")`); byte-exact RFC 8785 JCS Ed25519 signature semantics; exact plaintext byte length 117 bytes; concrete mathematically verified SHA-256 digest `90ca3b570b7e806657a928518b70ee710b342ea6e315187e7a1dcc4b409cab4e` of canonical candidate decision payload; RFC 3161 TSA imprint over `DECISION_OS_TSA_COMMITMENT_V1: || CoreDigest || UTF8(primaryEvidenceSignature)`; multi-stage non-circular Merkle construction; dual-party SRE/Security sign-off strictly required prior to unquarantine (Phase B.12 Deliverable – Pending Independent Review)
- [x] **B11-01 remediated (Phase B.12):** Vault rotation authorization and least-privilege policy separation specified; `slot-lease-reader` read-only, `slot-credential-rotator` write-only; signed revocation order binding 8 parameters; Vault write commitment proven via CAS metadata verification before ack; path substitution prevented
- [x] **B11-02 remediated (Phase B.12):** Complete fencing specified for every JWT redemption transition with atomic CAS filter (status, owner, generation); monotonic generation advancement enforced; `createIndex` stripped from runtime Gateway role
- [x] **B11-03 remediated (Phase B.12):** Dispatch-intent vs wire delivery ambiguity resolved; `VAULT_REQUEST_SENT` treated strictly as intent; 11 crash points analyzed; conservative fail-closed quarantine; zero duplicate tokens; 4 distinct guarantees categorized
- [x] **B11-04 remediated (Phase B.12):** Authoritative Recovery Service (`apps/recovery-service`) specified with zero Vault route; monotonic takeover CAS; safe expiry of un-dispatched claims vs mandatory quarantine of in-flight requests
- [x] **B11-05 remediated (Phase B.12):** Administrative reconciliation authorization defined; dedicated `decision_os_admin_reconciler`; signed dual-party SRE + Compliance order; independent Vault audit log proof required
- [x] **B11-06 remediated (Phase B.12):** Candidate decision payload SHA-256 digest corrected to mathematically verified value `90ca3b570b7e806657a928518b70ee710b342ea6e315187e7a1dcc4b409cab4e`
- [x] **B11-07 remediated (Phase B.12):** Candidate decision payload plaintext byte length corrected to exactly 117 UTF-8 bytes
- [x] **B11-08 remediated (Phase B.12):** Canonical WORM Plaintext Evidence Record Schema v2.2.0 formalized with complete 26 versioned data fields (+ `$schema`) and exhaustive inventory table
- [x] **B11-09 remediated (Phase B.12):** RFC 3161 TSA token binds complete evidence record via message imprint over `DECISION_OS_TSA_COMMITMENT_V1: || CoreDigest || UTF8(primaryEvidenceSignature)`
- [x] **B11-10 remediated (Phase B.12):** Multi-stage non-circular Merkle construction formulated (Core $\rightarrow$ HSM Sig $\rightarrow$ TSA $\rightarrow$ Leaf Hash $\rightarrow$ Tree Root & Proof $\rightarrow$ Dual-party Unquarantine)
- [x] **B11-11 remediated (Phase B.12):** Four independent digital signatures formally specified with distinct roles, key registries, and unique domain separation prefixes
- [x] **B11-12 remediated (Phase B.12):** Option A (Reproducible Synthetic Test Fixture) implemented with deterministic seeds, valid Ed25519 signatures, RFC 3161 structure, Merkle proof, and Node.js generation script
- [x] **B12-01 remediated (Phase B.13):** Vault audit evidence retrieval executable; external audit streaming over mTLS to WORM S3/GCS bucket lock; dedicated forensic identity `decision_os_audit_investigator`; fail-closed on stream delay or gap
- [x] **B12-02 remediated (Phase B.13):** Gateway granted `find, insert, update` on `slot_rotation_log`; schema & unique compound indexes formalized; 7-state durable rotation machine; 8 crash points analyzed; CAS metadata discovery
- [x] **B12-03 remediated (Phase B.13):** Wildcard `secret/data/slots/+` eliminated; 256 discrete per-slot policies (`slot-rotator-slot_000` through `slot-rotator-slot_255`); ephemeral scoped token exchange; native Vault 403 enforcement
- [x] **B12-04 remediated (Phase B.13):** Conflation of `token_num_uses = 1` with token issuance resolved; Vault token issuance marked NOT GUARANTEED across untracked networks; zero automated redispatch across proxies/mesh; 5 distinct guarantees categorized
- [x] **B12-05 remediated (Phase B.13):** Synthetic Base64 JSON mock replaced with genuine ASN.1 DER CMS ContentInfo SignedData (612 bytes); verified with standalone Python/Node ASN.1 parsers
- [x] **B12-06 remediated (Phase B.13):** Conflicting Merkle roots eliminated; single authoritative Merkle root `e3f6f3504f211d64c383acb50260e7b6f6cccba7522f0fdf98b83cd8145d5248` at height 8421 reconciled globally
- [x] **B12-07 remediated (Phase B.13):** Credential generation semantics reconciled ($N \rightarrow N+1$: `currentGeneration: N`, `expectedPreviousGeneration: N`, `newGeneration: N + 1`); bound to Vault KV-v2 version; CAS `cas: N`
- [x] **B12-08 remediated (Phase B.13):** Delineated 5 distinct cryptographic commitment layers (Core 1–17, Primary Sig 18, TSA Imprint 1–18, Leaf 1–19, Witnesses 20–24, Extension 25–26); updated 26-field inventory table
- [x] Expanded verification plan (`D38-01` through `D38-44`, including revised test specifications `D38-41`, `D38-42` and new specifications `D38-43`, `D38-44`) categorized and explicitly marked as PLANNED
- [x] Comprehensive Finding-to-Design-to-Test Traceability Matrix (Section 20.3) established for all findings B38-01 through B38-42, B11-01 through B11-12, and B12-01 through B12-08
- [x] Zero application, test, configuration, or infrastructure files modified; architecture design revision only
- [x] **Gate B status:** NOT APPROVED (Architecture-only remediation; awaiting independent review before Phase C)
- [x] **STOP gate observed:** Phase B.13 completed; awaiting independent architecture review and formal Gate B approval before Phase C. Do not self-approve Gate B.
