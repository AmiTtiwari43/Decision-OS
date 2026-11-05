# DECISION OS — BATCH 4 REMEDIATION V3.5
## WRITE-PATH MUTATION AUDIT & INVARIANT CONFORMANCE

**Repository:** `AmiTtiwari43/Decision-OS`  
**Branch:** `fix/batch4-replica-set-transactional-recovery`  
**Target File:** `apps/api/src/db/guard.ts`  
**Remediation Version:** V3.5  
**Date:** 2026-11-05  

---

## 1. Line-by-Line Write Mutation & Authority Audit (14 Inquiries)

### 1. Can a worker issue `dropDatabase()` after its authority has been revoked?
- **Classification:** **VERIFIED**
- **File Reference:** `apps/api/src/db/guard.ts` (lines 940–961)
- **Mechanism:** Immediately prior to invoking `db.dropDatabase()`, `cleanupTestDatabase()` performs an atomic read of `coordCol` and validates that `verifiedCoord.dropExecutionToken === currentDropToken`, `verifiedCoord.cleanupOwner === cleanWorker`, `verifiedCoord.cleanupGeneration <= activeGeneration`, and `verifiedCoord.dropExecutionLock === true`. If any condition fails, it throws:
  `Safety guard violation: database '${dbName}' cleanup authority superseded before drop (revoked or stale generation ${activeGeneration} or token mismatch).`
  and aborts before `db.dropDatabase()` can be reached.
- **Test ID:** `tests/batch4_v35_cleanup_fencing.test.ts` > `D35-08`, `tests/batch4_v35_reproduction.test.ts` > `REPRO-R1`.

---

### 2. Can a paused process resume and issue a stale destructive command?
- **Classification:** **VERIFIED**
- **File Reference:** `apps/api/src/db/guard.ts` (lines 940–961) & `claimTestDatabaseOwnership` (lines 240–252)
- **Mechanism:** Dual-layer defense:
  1. While Worker A is paused during `DROP_IN_PROGRESS`, `dropExecutionLock: true` prevents any other worker from claiming or reassigning the database.
  2. If an administrative intervention or restart supersedes Worker A's token or generation, Worker A's pre-drop check detects the mismatch upon resuming and halts immediately before issuing `db.dropDatabase()`.
- **Test ID:** `tests/batch4_v35_cleanup_fencing.test.ts` > `D35-08`, `D35-17`.

---

### 3. Can two processes issue concurrent destructive commands?
- **Classification:** **VERIFIED**
- **File Reference:** `apps/api/src/db/guard.ts` (lines 790–820 and 840–880)
- **Mechanism:** Both the target database lock (`metaCol.findOneAndUpdate` with `dropInProgress: { $ne: true }`) and the coordination registry lock (`coordCol.findOneAndUpdate` with `dropExecutionLock: { $ne: true }`) are strict atomic Compare-And-Swap mutations. Exactly one concurrent caller acquires both locks; the second is serialized and safely rejected.
- **Test ID:** `tests/batch4_v35_cleanup_fencing.test.ts` > `D35-10`, `tests/batch4_v34_cleanup_recovery.test.ts` > `D34-05`.

---

### 4. Can an expired lease be mistaken for proof that a process has stopped?
- **Classification:** **VERIFIED**
- **File Reference:** `apps/api/src/db/guard.ts` (lines 780–860)
- **Mechanism:** Destructive drop authority **does not rely on time-based or expiring leases**. Destructive execution authority is held via durable state `DROP_IN_PROGRESS` and `dropExecutionLock: true` alongside monotonic generation fencing. No process is assumed dead based on an elapsed timestamp.
- **Test ID:** `tests/batch4_v35_cleanup_fencing.test.ts` > `D35-09`.

---

### 5. Can a missing coordination record permit cleanup?
- **Classification:** **VERIFIED**
- **File Reference:** `apps/api/src/db/guard.ts` (lines 530–545, 615–625, 815–820, 945–950)
- **Mechanism:** In all lifecycle stages (Stage 0 empty database check, pre-lock validation, Stage 2 coordination sync, Stage 3 atomic authority acquisition, and pre-drop verification), a missing coordination record triggers an immediate, explicit error:
  `Safety guard violation: database '${dbName}' has no coordination record in registry. Refusing cleanup.`
  The fail-open condition in V3.4 (`if (latestCoord && ...)`) was completely eliminated.
- **Test ID:** `tests/batch4_v35_cleanup_fencing.test.ts` > `D35-01`, `tests/batch4_v35_reproduction.test.ts` > `REPRO-R2`.

---

### 6. Can registry unavailability permit cleanup?
- **Classification:** **VERIFIED**
- **File Reference:** `apps/api/src/db/guard.ts` (lines 525–528, 608–612, 783–787)
- **Mechanism:** If `coordCol` is unavailable (e.g. database handle absent or connection lost), the system fails closed immediately:
  `Safety guard violation: coordination registry unavailable. Refusing cleanup.`
- **Test ID:** `tests/batch4_v35_cleanup_fencing.test.ts` > `D35-15`, `D35-16`.

---

### 7. Can an executor crash leave a database eligible for unsafe reassignment?
- **Classification:** **VERIFIED**
- **File Reference:** `apps/api/src/db/guard.ts` (lines 240–252 & 330–345)
- **Mechanism:** `claimTestDatabaseOwnership` inspects both the coordination registry and the target database metadata. If `dropExecutionLock === true` or state is `DROP_IN_PROGRESS` / `CLEANUP_LOCKED`, any foreign claim attempt is strictly rejected with:
  `Test database safety guard violation: database '${dbName}' is locked for cleanup in coordination registry. Re-entry prohibited.`
- **Test ID:** `tests/batch4_v35_cleanup_fencing.test.ts` > `D35-09`, `D35-12`.

---

### 8. Can a retry increment or bypass cleanup generation?
- **Classification:** **VERIFIED**
- **File Reference:** `apps/api/src/db/guard.ts` (lines 695–705)
- **Mechanism:** When a retry occurs after a crash in `CLEANUP_LOCKED` or `DROP_IN_PROGRESS`, the retry branch recognizes `existing.cleanupOwner === cleanWorker` and retains the existing generation:
  `activeGeneration = existing.cleanupGeneration || 1; isRetry = true;`
  Generation increment (`$inc: { cleanupGeneration: 1 }`) only occurs during the initial atomic transition from `OWNED`.
- **Test ID:** `tests/batch4_v35_cleanup_fencing.test.ts` > `D35-24`, `tests/batch4_v34_cleanup_recovery.test.ts` > `D34-09`.

---

### 9. Can a different worker or run recover another worker's cleanup?
- **Classification:** **VERIFIED**
- **File Reference:** `apps/api/src/db/guard.ts` (lines 550–565, 625–645, 670–690)
- **Mechanism:** Cross-worker and cross-run isolation is enforced at every stage. If `runId` or `workerId` does not match the ownership document, the recovery attempt is rejected with explicit typed errors.
- **Test ID:** `tests/batch4_v35_cleanup_fencing.test.ts` > `D35-02`, `D35-03`, `D35-19`, `D35-20`.

---

### 10. Can a network timeout cause an unsafe duplicate destructive command?
- **Classification:** **VERIFIED**
- **File Reference:** `apps/api/src/db/guard.ts` (lines 522–599)
- **Mechanism:** If `db.dropDatabase()` succeeds on the server but returns a network timeout to the client, a subsequent retry detects that `db.listCollections()` returns 0 collections (Stage 0). Stage 0 verifies the coordination registry proof, transitions to `CLEANED`, and returns idempotently without re-issuing `dropDatabase()`.
- **Test ID:** `tests/batch4_v35_cleanup_fencing.test.ts` > `D35-14`, `tests/batch4_v34_cleanup_recovery.test.ts` > `D34-16`.

---

### 11. Can a process restart invalidate the fencing of a previous executor?
- **Classification:** **VERIFIED**
- **File Reference:** `apps/api/src/db/guard.ts` (lines 940–961)
- **Mechanism:** Each destructive execution attempt generates a unique UUID `dropExecutionToken`. If Executor Instance 2 completes cleanup or re-authorizes with a new token, Executor Instance 1's old token is invalidated. When Instance 1 resumes, its pre-drop token verification check fails and aborts before issuing `db.dropDatabase()`.
- **Test ID:** `tests/batch4_v35_cleanup_fencing.test.ts` > `D35-17`.

---

### 12. Is every `dropDatabase()` call reachable only through the authorized protocol?
- **Classification:** **VERIFIED**
- **File Reference:** Complete monorepo source audit
- **Mechanism:** A search across all packages confirms that the only `db.dropDatabase()` call in production code is in `apps/api/src/db/guard.ts#cleanupTestDatabase()` line 967. All calls are protected by test identity validation, reserved database protection, prefix validation, Stage 2 locks, Stage 3 atomic coordination locks, and pre-drop token verification.
- **Test ID:** `tests/batch4_v35_cleanup_fencing.test.ts` > `D35-21`, `D35-22`, `D35-23`.

---

### 13. Does the test suite prove the critical interleavings rather than merely test nearby states?
- **Classification:** **VERIFIED**
- **File Reference:** `apps/api/tests/batch4_v35_cleanup_fencing.test.ts` (lines 350–430 & 780–830)
- **Mechanism:** `D35-08` pauses Worker A inside `beforeDropDatabase` after acquiring authority, forces Worker B to attempt concurrent claims and cleanups, and verifies that Worker B is strictly rejected while Worker A safely drops upon resuming. `D35-17` tests executor restart and verifies that an old resumed process is blocked from dropping.
- **Test ID:** `tests/batch4_v35_cleanup_fencing.test.ts` > `D35-08`, `D35-17`.

---

### 14. Are all failure paths fail-closed?
- **Classification:** **VERIFIED**
- **File Reference:** `apps/api/src/db/guard.ts`
- **Mechanism:** Every failure path (missing records, registry unavailability, mismatched run/worker, superseded generation, token mismatch, or network errors) throws an explicit `Safety guard violation` error and terminates before any destructive drop command.
- **Test ID:** All 24 tests in `batch4_v35_cleanup_fencing.test.ts`.
