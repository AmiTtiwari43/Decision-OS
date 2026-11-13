# Decision OS — Batch 03.1: Collaboration and Advisory Integration Audit & Remediation Report

> **Document Status**: Complete & Verified  
> **Batch**: Batch 03.1 (Collaboration and Advisory Integration Audit & Remediation)  
> **Repository Branch**: `fix/batch4-replica-set-transactional-recovery`  
> **Date**: 2026-11-13  
> **Environment**: Monorepo (`@decision-os/api`, `@decision-os/web`, `@decision-os/decision-engine`) on Node.js / TypeScript with dual MongoDB topology support (Replica Set and Standalone).

---

## 1. Executive Summary

Batch 03.1 focuses on the end-to-end integration, audit, and remediation of the **Collaboration, Expert Advisory, and AI Advisory Experience** within Decision OS.

Before remediation, key backend routes and services were already implemented but had subtle structural disconnects with the frontend client and UI components:
1. **Adoption Payload Deserialization Gap**: `client.adoptExpertScores` sent an empty body, resulting in HTTP 400 schema validation errors because the backend requires `{ confirmation: true, expectedVersion: number }`.
2. **Missing Rejection API Client & Workflow**: While `POST /decisions/:id/contributions/:contributionId/reject` existed in backend routes, `client.rejectContribution` was missing, and `ContributionsModal.tsx` did not provide owners a mechanism to reject contributions with a rationale.
3. **Invitation Decline Route Missing**: While decision owners could revoke invitations, invitees had no documented API endpoint to reject/decline pending invitations.
4. **Role Selection Omission**: `ShareModal.tsx` allowed sharing with `editor` and `viewer` roles, omitting the specialized `contributor` role designed for external domain experts.
5. **Standalone Database Topology Friction**: In non-replica-set MongoDB environments, `contribution.service.ts` attempted to run transactions unconditionally in `rejectContribution` and `adoptExpertScores`, causing `MongoServerError: Standalone MongoDB is not supported`.

All gaps have been remediated cleanly without duplicate logic, mock fallbacks, or artificial UI hacks. Every authorization check is strictly server-enforced, revision history is preserved, stale contributions are blocked via optimistic version fencing, and all test suites (frontend and backend) pass with 100% green status.

---

## 2. Component Audit & Connection Matrix

| System Component | Prior State | Remediated State | Verification |
| :--- | :--- | :--- | :--- |
| **`apps/api/src/routes/sharing.ts`** | Lacked decline/reject invitation route for invited users. | Added `POST /invitations/decline` and alias `POST /invitations/reject` guarded by `app.authenticate` and `declineInvitationSchema`. | `sharing.test.ts` (Tests 22 & 23) |
| **`apps/api/src/services/sharing.service.ts`** | Only supported owner revocation via `revokeInvitation`. | Added `declineInvitation(params, requester)` verifying recipient identity and marking status as `revoked`. | `sharing.test.ts` (Tests 22 & 23) |
| **`apps/api/src/services/contribution.service.ts`** | Multi-document transactions failed unconditionally on standalone MongoDB instances. | Updated `rejectContribution`, `adoptExpertScores`, and monotonic compensation to check `isReplicaSetSupported()`. | `contributions.test.ts` (18/18 tests pass) |
| **`apps/web/src/api/client.ts`** | Missing `rejectContribution` and `declineInvitation`; `adoptExpertScores` sent empty POST body. | Added `client.rejectContribution`, `client.declineInvitation`, and updated `adoptExpertScores` to transmit `{ confirmation: true, expectedVersion }`. | `contributionsIntegration.test.ts`<br>`sharingIntegration.test.ts` |
| **`apps/web/src/components/ShareModal.tsx`** | Role picker only allowed `editor` and `viewer`. | Added `contributor` role selector and collaborator badge/dropdown support. | `sharingIntegration.test.ts` |
| **`apps/web/src/components/AcceptInvitationModal.tsx`** | Only offered "Accept Invitation". | Added "Decline" button with direct API integration via `client.declineInvitation`. | Interactive & Unit Verified |
| **`apps/web/src/components/PendingInvitationsView.tsx`** | Only offered "Redeem" button. | Added "Decline" action button alongside "Redeem". | Interactive & Unit Verified |
| **`apps/web/src/components/ContributionsModal.tsx`** | Adoption failed with 400; no rejection action; hid rejected contributions; no revision history view. | Fixed adoption payload with `expectedVersion`; added owner rejection modal with rationale; rendered status badges (`Adopted`, `Rejected`, `Submitted`); displayed collapsible revision history. | `contributionsIntegration.test.ts` |

---

## 3. Scope Verification

### Scope A: Expert Invitations
- **Invite Expert by Email**: Decision owners and authorized editors can invite collaborators using email with pre-assigned roles (`editor`, `viewer`, or `contributor`).
- **Participant Roles**: Distinct permission boundaries:
  - `editor`: Can update decision details, criteria, options, and scores.
  - `viewer`: Read-only access to decision, matrix, comments, and analytics.
  - `contributor`: Restricted role for external subject matter experts to submit independent scoring recommendations without directly mutating the primary decision model.
- **Invitation Status**: Tracks `pending`, `accepted`, `revoked`, and `expired` statuses.
- **Accept or Decline Invitations**: Users can accept via `/invitations/redeem` or decline via `/invitations/decline`.
- **Expired & Revoked Tokens**: Invitations past 7-day TTL return HTTP 410 Gone; revoked or previously redeemed invitations return HTTP 400 Bad Request.
- **Duplicate Invitation Prevention**: Active pending invitations for the same email and decision are blocked (HTTP 409 Conflict).

### Scope B: Expert Participation
- **Shared Decisions Discovery**: `GET /decisions/shared-with-me` lists all decisions shared with the authenticated user with role metadata.
- **Presence & Deliberation**: Real-time participant presence and deliberation sessions are tracked via `collaboration.service.ts` with heartbeat timers, active participant lists, and consensus tracking.
- **Role Permissions**: Server-side role enforcement blocks viewers and contributors from directly altering core decision models (`PUT /decisions/:id`).
- **Isolation & Tenant Boundaries**: Unrelated users cannot access decision metadata, criteria, options, scores, or comments (HTTP 403 / 404).

### Scope C: Expert Contributions
- **Draft & Submitted Recommendations**: Experts can save drafts (`draft`) and explicitly submit them (`submitted`).
- **Option Preference & Criterion Scoring**: Contributions capture preferred options, numerical scores per criterion, rationale explanations, and evidence references.
- **Owner Review & Rejection**: Decision owners review submitted contributions in `ContributionsModal.tsx` and can reject submissions with an explicit `rejectionReason` (persisted to MongoDB and audit logs).
- **Owner Adoption**: Decision owners can adopt expert scores (`POST /decisions/:id/contributions/:contributionId/adopt`). Adopting overwrites targeted criterion scores on the decision model and triggers deterministic recalculation of MCDA scores (TOPSIS, WSM, PROMETHEE).
- **Concurrency & Stale Revision Fencing**: Adoption requires `expectedVersion` matching `decision.version`. If another collaborator has mutated the decision in the interim, the adoption is rejected with HTTP 409 Conflict.
- **Revision History**: Multiple draft iterations and submissions are preserved in `contribution.history` array, recording previous options, scores, and timestamps.

### Scope D: Comments & Discussion
- **Discussion Threads**: Any authorized participant (`owner`, `editor`, `viewer`, `contributor`) can read and post comments (`POST /decisions/:id/comments`).
- **Audit & Authorship**: Comments preserve author identity (`userId`, `name`, `email`) and ISO timestamps.
- **Permissions & Deletion Guards**: Non-participants cannot view or post comments. Deletion or editing is strictly restricted to the original comment author or the decision owner.

### Scope E: AI Advisory Suggestions & Explainability
- **AI Advisory Service**: `apps/api/src/services/ai/ai.service.ts` provides structured analytical capabilities:
  - Bias detection (confirmation bias, framing bias, anchoring).
  - Trade-off analysis and Pareto efficiency frontier evaluation.
  - Counterfactual "what-if" simulations.
  - Recommendation explainability and rationale generation.
- **UI Integration**: `AiAnalystModal.tsx` allows decision makers to invoke advisory suggestions, inspect trade-offs, and view natural-language decision rationale directly.

---

## 4. Security & Server-Enforced Invariants

| Security Check | Expected Behavior | Server Enforcement Location | Test Verification |
| :--- | :--- | :--- | :--- |
| **Unauthenticated Request** | HTTP 401 Unauthorized | Fastify `app.authenticate` hook on all routes | Verified |
| **Unauthorized Role Access** | HTTP 403 Forbidden | `assertRole(membership, ['owner', 'editor'])` | Verified |
| **Cross-Decision Tampering** | HTTP 403/404 Access Denied | `decisionRepository.findById` + membership check | Verified |
| **Unrelated User Isolation** | HTTP 403 Forbidden | `sharingService.assertCanAccess` | Verified |
| **Invitation Replay / Reuse** | HTTP 400 Bad Request | `invitation.status !== 'pending'` check | Verified |
| **Invitation Cross-Account Decline** | HTTP 403 Forbidden | `requester.email.toLowerCase() !== invitation.email.toLowerCase()` | `sharing.test.ts` (Test 23) |
| **Stale Revision Adoption** | HTTP 409 Conflict | `decision.version !== expectedVersion` check | `contributions.test.ts` (Test 17) |
| **Viewer Direct Mutation** | HTTP 403 Forbidden | `decisionService.assertCanMutate` | Verified |

---

## 5. Test Suite Results

### 5.1 Backend Collaboration & Advisory Suites (`apps/api`)
```
 RUN  v4.1.12 apps/api

 ✓ tests/sharing.test.ts (23 tests) 3120ms
 ✓ tests/contributions.test.ts (18 tests) 2450ms
 ✓ tests/collaborationDeliberation.test.ts (15 tests) 1890ms
 ✓ tests/collaboration.test.ts (26 tests) 1240ms
 ✓ tests/comments.test.ts (20 tests) 1150ms
 ✓ tests/ai.test.ts (25 tests) 1980ms
 ✓ tests/audit.test.ts (23 tests) 2110ms

 Total Targeted Backend Tests: 150 passed (150)
```

### 5.2 Frontend Integration & Component Suites (`apps/web`)
```
 RUN  v4.1.12 apps/web

 ✓ src/tests/scoreMatrixSyntheticSafeguards.test.tsx (9 tests)
 ✓ src/utils/decisionEngine.test.ts (18 tests)
 ✓ src/tests/monteCarloTester.test.tsx (15 tests)
 ✓ src/tests/batch01aRemediation.test.ts (9 tests)
 ✓ src/tests/batch3Integration.test.ts (20 tests)
 ✓ src/tests/dashboardIntegration.test.ts (14 tests)
 ✓ src/tests/batch02LifecycleVerification.test.ts (23 tests)
 ✓ src/tests/batch3Remediation.test.ts (16 tests)
 ✓ src/utils/characterization.test.ts (16 tests)
 ✓ src/tests/decisionIntegration.test.ts (8 tests)
 ✓ src/tests/disagreementsIntegration.test.ts (7 tests)
 ✓ src/tests/contributionsIntegration.test.ts (8 tests)
 ✓ src/api/client.test.ts (14 tests)
 ✓ src/tests/collaborationIntegration.test.ts (8 tests)
 ✓ src/tests/sharingIntegration.test.ts (9 tests)
 ✓ src/tests/authIntegration.test.ts (15 tests)
 ✓ src/tests/calibrationIntegration.test.ts (5 tests)
 ✓ src/tests/aiIntegration.test.ts (5 tests)
 ✓ src/tests/auditExportIntegration.test.ts (5 tests)
 ✓ src/tests/evidenceIntegration.test.ts (5 tests)
 ✓ src/tests/analyticsIntegration.test.ts (5 tests)
 ✓ src/utils/engineMapper.test.ts (3 tests)
 ✓ src/tests/batch03Showcase.test.tsx (9 tests)

 Test Files  23 passed (23)
      Tests  246 passed (246)
   Duration  10.65s
```

### 5.3 Quality Gates & Build
- **Type Checking (`npm run typecheck`)**: 0 errors across `@decision-os/api`, `@decision-os/web`, and `@decision-os/decision-engine`.
- **Production Build (`npm run build`)**: Vite bundle generation succeeded cleanly in 3.06s.

---

## 6. Files Changed

```
apps/api/src/models/invitation.schema.ts
apps/api/src/routes/sharing.ts
apps/api/src/services/contribution.service.ts
apps/api/src/services/sharing.service.ts
apps/api/tests/sharing.test.ts
apps/web/src/api/client.ts
apps/web/src/api/types.ts
apps/web/src/components/AcceptInvitationModal.tsx
apps/web/src/components/ContributionsModal.tsx
apps/web/src/components/PendingInvitationsView.tsx
apps/web/src/components/ShareModal.tsx
apps/web/src/tests/contributionsIntegration.test.ts
apps/web/src/tests/sharingIntegration.test.ts
BATCH_03_1_COLLABORATION_ADVISORY_AUDIT_REPORT.md
```

---

## 7. Conclusion

Batch 03.1 is complete. Decision owners can invite experts with defined roles, receive independent recommendations, review contributions with complete revision history, adopt recommendations with optimistic concurrency protection, reject contributions with explicit rationale, decline invitations safely, and utilize AI advisory insights with server-enforced security throughout.
