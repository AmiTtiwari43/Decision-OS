# DECISION OS — BATCH 2 REMEDIATION REPORT
## Authoritative Tie Classification and Remaining Audit Findings Remediation

**Remediation Date**: November 2, 2026  
**Auditor / Remediation Engineer**: Senior Fullstack Systems Architect & Application Security Engineer  
**Target Workspaces**: `@decision-os/web`, `@decision-os/api`, `@decision-os/decision-engine`  
**Pre-Remediation Verdict**: C. FAIL (Blocked by F-B2-01)  
**Status**: **ALL 5 FINDINGS RESOLVED (F-B2-01, F-B2-02, F-B2-03, F-B2-04, F-B2-05)**  

---

## 1. Executive Summary

An independent audit of **Batch 2: Authenticated Dashboard & Decision Hub** returned verdict `C (FAIL)` due to finding `F-B2-01` (Authoritative mathematical ties rendered as "Incomplete Evaluation / Draft" on decision cards and filtered as unscored drafts).

In addition, four secondary findings (`F-B2-02`, `F-B2-03`, `F-B2-04`, `F-B2-05`) were identified for remediation:
- **F-B2-02**: Documentation drift in `FRONTEND_BACKEND_INTEGRATION_MATRIX.md` referencing legacy route paths.
- **F-B2-03**: Potential state leakage between decisions in `AiAnalystModal` when switching decisions without unmounting.
- **F-B2-04**: Cryptographic token redemption UX in `PendingInvitationsView.tsx` lacking autofocus and token pre-population.
- **F-B2-05**: Cumulative load timeout in `ai.test.ts` during sequential test execution due to heavy bcrypt setup and default 10s hook timeout.

All 5 findings have been fully remediated, verified with new automated regression tests, and validated against canonical engine specifications. **Zero canonical engine calculations, algorithms, or golden fixtures (G1–G10) were altered.**

---

## 2. Findings, Root Causes & Exact Code Changes

### FIX 1 — F-B2-01: Correct Authoritative Tie Classification

- **Severity**: HIGH (Blocking Defect)
- **Files Modified / Created**:
  - `apps/web/src/utils/decisionStatus.ts` (Created)
  - `apps/web/src/components/DecisionCard.tsx` (Modified)
  - `apps/web/src/components/Dashboard.tsx` (Modified)
  - `apps/web/src/tests/dashboardIntegration.test.ts` (Modified)

#### Root Cause
Under the canonical decision engine specification (`CANONICAL_DECISION_ENGINE_V1_SPEC.md` Section 5.7 and `packages/decision-engine/src/scoring.ts` lines 163–166):
```ts
const isTie = topRankOptions.length > 1;
const decisionOutcome: 'decisive' | 'tie' = isTie ? 'tie' : 'decisive';
const winnerId = isTie ? null : presentationSorted[0]?.option.id ?? null;
const tiedWinnerIds = isTie ? topRankOptions.map(t => t.option.id) : [];
```
When two or more options tie for first place, the engine intentionally sets `winnerId: null`, sets `isTie: true`, populates `tiedWinnerIds`, and provides an authoritative MCDA `analysis` object.

In `DecisionCard.tsx`:
```tsx
const analysis = decision.analysis;
const winnerId = analysis?.winnerId;
const winnerOption = winnerId ? decision.options?.find((o) => o.id === winnerId) : null;
...
{winnerOption ? (
  ...
) : (
  <div className="flex items-center gap-2 text-slate-500 text-[11px] font-mono">
    <span className="w-2 h-2 rounded-full bg-slate-600" />
    <span>Incomplete Evaluation / Draft</span>
  </div>
)}
```
Because `winnerOption` is `null` in a tie, the card branched to the fallback `else` clause, displaying `Incomplete Evaluation / Draft` and omitting the `Authoritative` badge.

In `Dashboard.tsx`:
- The status filter `unscored` used `(d) => !d.analysis?.winnerId`, grouping valid ties with unscored drafts.
- Portfolio metrics counted evaluated decisions with `if (d.analysis?.winnerId) evaluatedCount++`, excluding ties from evaluated counts.
- `dashboardIntegration.test.ts` test 3 codified this defect with `expect(unscored).toHaveLength(2)`.

#### Exact Code Changes
1. **Created `apps/web/src/utils/decisionStatus.ts`**:
   Implemented `getDecisionEvaluationStatus(decision: DecisionDto): 'decisive' | 'tie' | 'stale' | 'draft'`:
   - Inspects the actual `analysis` object, not `winnerId`.
   - Identifies stale/invalidated evaluations (`decision.isStale`, `decision.status === 'stale'`, or winner IDs pointing to non-existent options) and classifies them as `'stale'`.
   - If `!analysis`, classifies as `'draft'`.
   - If `analysis.isTie || analysis.decisionOutcome === 'tie'`, classifies as `'tie'` (authoritative evaluation with mathematical tie).
   - If `analysis.winnerId && !analysis.isTie`, verifies `winnerOption` exists in `decision.options` and classifies as `'decisive'`.
   - If non-tie analysis lacks `winnerId` or has orphan options, classifies as `'draft'` / `'stale'`.
2. **Updated `apps/web/src/components/DecisionCard.tsx`**:
   - Gated `isAuthoritative` on `evaluationStatus === 'decisive' || evaluationStatus === 'tie'`.
   - Gated `isStale` on `evaluationStatus === 'stale'`.
   - Rendered the `Authoritative` badge (`<ShieldCheck />`) for both decisive evaluations and ties.
   - Rendered `Evaluation Stale` badge (`<AlertCircle />`) for stale evaluations.
   - In outcome pill:
     - `evaluationStatus === 'decisive'`: renders unique winner name and point lead (`Lead: AWS (+4.2 pt lead)`).
     - `evaluationStatus === 'tie'`: renders `Mathematical Tie Detected` (`text-amber-300 font-semibold font-mono`).
     - `evaluationStatus === 'stale'`: renders `Stale Evaluation · Recalculation Required`.
     - `evaluationStatus === 'draft'`: renders `Incomplete Evaluation / Draft`.
3. **Updated `apps/web/src/components/Dashboard.tsx`**:
   - Extended `StatusFilter` to `'all' | 'decisive' | 'tie' | 'unscored' | 'stale'`.
   - In `metrics`: incremented `evaluatedCount` for both `decisive` and `tie` statuses independently of `winnerId`.
   - In `filteredDecisions`:
     - `decisive`: `getDecisionEvaluationStatus(d) === 'decisive'`
     - `tie`: `getDecisionEvaluationStatus(d) === 'tie'`
     - `unscored`: `getDecisionEvaluationStatus(d) === 'draft'`
     - `stale`: `getDecisionEvaluationStatus(d) === 'stale'`
   - Added conditional `Stale` button to status filter bar when stale items exist in workspace.
4. **Updated `apps/web/src/tests/dashboardIntegration.test.ts`**:
   - Corrected test 3: `expect(unscored).toHaveLength(1)` (only `dec-3`), `expect(ties).toHaveLength(1)` (`dec-2` with `winnerId: null`).
   - Added tests 9, 10, 11 testing decisive, tie, draft, stale, metrics calculation, and filter partitioning.

---

### FIX 2 — F-B2-02: Correct API Documentation Drift

- **Severity**: MEDIUM
- **Files Modified**:
  - `FRONTEND_BACKEND_INTEGRATION_MATRIX.md` (root and `Decision-OS-main`)

#### Root Cause
Documentation referenced pre-implementation conceptual paths:
- Workspace analytics: `GET /api/workspace/analytics`
- Pending invitations: `GET /api/user/invitations`

The actual registered Fastify routes in `apps/api`:
- Workspace analytics: `GET /api/analytics/overview` (`apps/api/src/routes/analytics.ts:75`)
- Pending invitations: `GET /api/invitations/pending` (`apps/api/src/routes/sharing.ts:371`)

The frontend client SDK (`apps/web/src/api/client.ts`) correctly used `/api/analytics/overview` and `/api/invitations/pending`. Documentation lagged behind the registered contracts.

#### Exact Code Changes
Updated `FRONTEND_BACKEND_INTEGRATION_MATRIX.md` to reflect verified registered routes:
- Replaced all occurrences of `GET /api/workspace/analytics` with `GET /api/analytics/overview`.
- Replaced all occurrences of `GET /api/user/invitations` with `GET /api/invitations/pending`.

---

### FIX 3 — F-B2-03: Isolate AI Modal State

- **Severity**: MEDIUM
- **Files Modified**:
  - `apps/web/src/components/Dashboard.tsx`
  - `apps/web/src/components/AiAnalystModal.tsx`
  - `apps/web/src/tests/dashboardIntegration.test.ts`

#### Root Cause
In `Dashboard.tsx`, feature dialogs (including `AiAnalystModal`) were rendered inside `<Suspense>` without a React `key` prop tied to `decision._id`. When switching between decisions without unmounting, React reused the existing component instance. Additionally, `AiAnalystModal` checked `if (isOpen && decision?._id && !analysis)` before fetching; because `analysis` was already populated with Decision A's data, it never fetched for Decision B.

#### Exact Code Changes
1. In `apps/web/src/components/Dashboard.tsx`: Assigned stable decision-specific keys at all modal component boundaries:
   - `<AiAnalystModal key={`ai-${activeFeatureModal.decision._id}`} ... />`
   - `<ShareModal key={`share-${activeFeatureModal.decision._id}`} ... />`
   - `<ContributionsModal key={`contributions-${activeFeatureModal.decision._id}`} ... />`
   - `<EvidenceModal key={`evidence-${activeFeatureModal.decision._id}`} ... />`
   - `<AnalyticsModal key={`analytics-${activeFeatureModal.decision._id}`} ... />`
   - `<DisagreementsModal key={`disagreements-${activeFeatureModal.decision._id}`} ... />`
   - `<ExpertCalibrationModal key={`calibration-${activeFeatureModal.decision._id}`} ... />`
   - `<AuditExportModal key={`audit-${activeFeatureModal.decision._id}`} ... />`
2. In `apps/web/src/components/AiAnalystModal.tsx`: Added an explicit state-reset effect:
   ```tsx
   useEffect(() => {
     setAnalysis(null);
     setError(null);
     setIsUnavailable(false);
     setAdoptSuccess(null);
     setAdoptingCriterionId(null);
   }, [decision?._id]);
   ```
3. In `apps/web/src/tests/dashboardIntegration.test.ts`: Added test 12 verifying decision boundary key isolation between decisions.

---

### FIX 4 — F-B2-04: Invitation Redeem UX

- **Severity**: LOW
- **Files Modified**:
  - `apps/web/src/components/PendingInvitationsView.tsx`

#### Root Cause
Clicking "Redeem" on an invitation card only scrolled to the top of the window (`window.scrollTo({ top: 0, behavior: 'smooth' })`), leaving the user to locate and manually click into the token redemption input.

#### Exact Code Changes
1. Added `tokenInputRef = useRef<HTMLInputElement>(null)`.
2. Attached `ref={tokenInputRef}` to the token redemption input.
3. Implemented `handleRedeemClick(inv)`:
   - If `(inv as any).token` is provided by the payload/flow, pre-populates `manualToken`.
   - Scrolls the token redemption card smoothly into view: `tokenInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })`.
   - Automatically focuses `tokenInputRef.current`.
   - Does not expose raw tokens in plaintext on cards.
   - Preserves secure acceptance workflow (`apiClient.acceptInvitation({ token })`).
   - Retained clear notice that invitation decline is intentionally unsupported by API v1 design.

---

### FIX 5 — F-B2-05: Test Infrastructure & Cumulative Load Timeout in `ai.test.ts`

- **Severity**: INFORMATIONAL
- **Files Modified / Created**:
  - `apps/api/vitest.config.ts` (Created)
  - `apps/api/tests/ai.test.ts` (Modified)

#### Root Cause Analysis
- **Hook Setup**: `ai.test.ts` contains 25 tests. In `beforeEach`, it executed 6 sequential registrations via `POST /api/auth/register` (each performing a CPU-bound bcrypt hash with 10 salt rounds), followed by decision creation, 4 invitations, 4 invitation acceptances, evidence attachment, and contribution submission (16 API requests and 6 bcrypt computations per test = 150 bcrypt hashes and 400 DB queries).
- **Resource Contention**: During sequential execution of all 24 API test files, cumulative Node.js process load, V8 memory pressure, and Windows disk I/O caused `beforeEach` to occasionally take ~10.1s against Vitest's default 10,000ms hook timeout.
- **Timeout Configuration**: The default 10,000ms hook timeout provided inadequate headroom for heavy cryptographic setup under cumulative test load.

#### Exact Code Changes
1. Created `apps/api/vitest.config.ts`:
   ```ts
   import { defineConfig } from 'vitest/config';

   export default defineConfig({
     test: {
       hookTimeout: 30000,
       testTimeout: 30000,
     },
   });
   ```
2. In `apps/api/tests/ai.test.ts`:
   - Added `{ timeout: 30000 }` to `describe('Phase 9 — AI Analyst Subsystem', { timeout: 30000 }, () => { ... })`.
   - Specified `30000` ms hook timeout on `beforeEach(async () => { ... }, 30000)`.

---

## 3. Automated Tests Added & Updated

### Updates to `apps/web/src/tests/dashboardIntegration.test.ts`

| Test # | Title | Purpose | Status |
| :--- | :--- | :--- | :--- |
| **Test 3** | `filters decisions by authoritative evaluation outcome` | Updated assertion: verifies ties are classified as `tie` (not `unscored`), and `unscored` only contains decisions with `analysis: null`. | **PASS** |
| **Test 9** | `authoritative evaluation classification handles decisive, tie, draft, and stale states` | Validates decisive winners, mathematical ties with `winnerId: null`, un-evaluated drafts, explicit stale flags, phantom winner IDs, and invalid non-ties. | **PASS** |
| **Test 10** | `computes portfolio metrics counting evaluated decisions independently of winnerId` | Verifies `evaluatedCount` includes both decisive decisions and ties (independent of `winnerId`). | **PASS** |
| **Test 11** | `status filters partition portfolio correctly across decisive, tie, draft, and stale` | Verifies clean partitioning across all 4 evaluation states without overlap. | **PASS** |
| **Test 12** | `verifies AI modal state isolation keying prevents state leakage between decisions` | Verifies distinct stable React keys (`ai-dec-1` vs `ai-dec-2`) at the modal boundary. | **PASS** |

---

## 4. Verification Execution Results

| Verification Gate | Command | Execution Result | Notes |
| :--- | :--- | :--- | :--- |
| **Decision Engine Tests** | `npm run test:engine` | **PASS (85/85 tests, 11 files in 3.86s)** | Golden fixtures G1–G10 100% intact. Zero mathematical modifications. |
| **Frontend Tests** | `npm run test:web` | **PASS (128/128 tests, 16 files in 7.21s)** | All 12 Batch 2 dashboard integration tests pass. |
| **API Backend Tests** | `npm run test:api` | **PASS (325/325 tests, 24 files in 297.14s)** | `ai.test.ts` passes cleanly with 30s hook timeout. |
| **TypeScript Typecheck** | `npm run typecheck` | **PASS (0 errors across monorepo)** | `@decision-os/api`, `@decision-os/web`, `@decision-os/decision-engine`. |
| **Linter (`oxlint`)** | `npm run lint` | **PASS (0 errors across monorepo)** | Fast refresh component export warning eliminated via `decisionStatus.ts`. |
| **Production Build** | `npm run build:web` | **PASS (built cleanly via Vite in 2.90s)** | Vendor chunking and lazy-loaded modal dialogs intact. |
| **Engine Build** | `npm run build:engine` | **PASS (built cleanly via tsc)** | Zero errors. |
| **API Build** | `npm run build:api` | **PASS (built cleanly via tsc)** | Zero errors. |
| **Independent Lifecycle Audit** | `npx tsx scripts/independent_audit_lifecycle.ts` | **PASS (15/15 checks passed, 100%)** | Session preservation, token restoration, secret validation intact. |

---

## 5. Remaining Issues

None. All 5 audit findings (`F-B2-01`, `F-B2-02`, `F-B2-03`, `F-B2-04`, `F-B2-05`) have been completely remediated and verified.

---

## 6. Definition of Done Checklist

- [x] Mathematical ties are correctly represented as completed authoritative evaluations (`Mathematical Tie Detected`, `Authoritative` badge).
- [x] Dashboard filters and metrics classify ties correctly (`statusFilter === 'tie'`, `evaluatedCount` counts ties independently of `winnerId`).
- [x] AI modal state is isolated between decisions (stable decision keys at modal boundary + explicit state reset on ID change).
- [x] Documentation in `FRONTEND_BACKEND_INTEGRATION_MATRIX.md` matches actual registered backend routes (`/api/analytics/overview`, `/api/invitations/pending`).
- [x] Test infrastructure in `apps/api` upgraded with 30s hook timeout, eliminating cumulative-load flakiness in `ai.test.ts`.
- [x] All regression tests pass (`test:web`, `test:engine`, `test:api`, `typecheck`, `lint`, `build`).
- [x] No canonical engine calculations or golden fixtures have been modified.
- [x] Batch 3 has not been started.

