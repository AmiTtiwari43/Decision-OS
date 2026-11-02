# Decision OS — Frontend–Backend Integration Matrix

**Document Version**: 1.0.0  
**Phase**: Phase 2 — Repository Audit & Integration Matrix  
**Status**: Verified against backend routes (`apps/api`), schemas, API client (`apps/web/src/api`), and frontend components (`apps/web/src/components`).

---

## 1. Executive Summary

A comprehensive audit of both the backend (`apps/api`, `packages/decision-engine`) and frontend (`apps/web`) codebases was performed.

### Key Audit Findings:
1. **Backend Completeness**:
   - The backend exposes 12 domain route modules (`auth`, `decisions`, `sharing`, `contributions`, `evidence`, `ai`, `analytics`, `disagreements`, `calibration`, `audit`, `collaboration`, `health`).
   - All 48 documented API endpoints exist, are enforced with Fastify schemas and MongoDB/Mongoose models, and pass all 23 test suites (309 tests).
2. **API Client Completeness**:
   - `apps/web/src/api/client.ts` implements fully typed, sanitized, and error-handled SDK methods for every backend route.
3. **Frontend Presentation & Accessibility Gap**:
   - Despite having modal components built for deep features (`AiAnalystModal`, `AnalyticsModal`, `AuditExportModal`, `ContributionsModal`, `DisagreementsModal`, `EvidenceModal`, `ExpertCalibrationModal`, `ShareModal`, `WorkspaceAnalyticsModal`), the application behaves like a static marketing landing page.
   - **No Authenticated Dashboard**: When a user registers or logs in, the page remains on the static marketing landing page. There is no dashboard to browse, search, create, or manage decisions.
   - **Session Loss on Refresh**: `AuthContext.tsx` holds the JWT token in memory only. Refreshing the browser logs the user out immediately.
   - **Inability to Manage Criteria and Alternatives**: The decision workspace (`useDecisionModel.ts` and `InteractiveModal.tsx`) lacks functions and UI controls to add, delete, or rename criteria and options (alternatives). Users can only tweak weights and edit scores in pre-existing templates.
   - **Static / Hardcoded Elements**:
     - `DecisionDemo.tsx` instantiates an isolated in-memory model that cannot be saved to the backend.
     - `MonteCarloTester.tsx` uses in-browser uniform `Math.random()` rather than canonical engine or backend analytics.
     - `DecisionHistoryTimeline.tsx` contains hardcoded static walkthrough cards.
     - `CaseStudies.tsx` contains static marketing cards with no action to load or clone them into user decisions.
     - `DecisionTicket.tsx` defaults to `DEC-LOCAL-PREVIEW` unless `decisionId` is supplied in the URL query.
   - **Missing UI Entry Points**:
     - No notification badge or UI to accept pending invitations (`GET /api/invitations/pending`).
     - No explicit button to request an authoritative calculation (`POST /api/decisions/:id/analyze`).
     - Modals can only be opened after deeply opening `InteractiveModal` and selecting a saved decision.

---

## 2. Capability Matrix

| Feature Domain | Backend Endpoint / Service | Frontend Page / Component | Current Status | Required Integration Action |
|:---|:---|:---|:---|:---|
| **Authentication** | `POST /api/auth/register`<br>`POST /api/auth/login`<br>`GET /api/auth/me` | `AuthModal.tsx`<br>`Navbar.tsx`<br>`AuthContext.tsx` | **Connected but incomplete** | 1. Add `localStorage` token persistence and automatic session restoration on mount.<br>2. Add auto-logout on 401 token invalidation.<br>3. Provide authenticated dashboard routing/view upon sign-in. |
| **Decisions Management** | `POST /api/decisions`<br>`GET /api/decisions`<br>`GET /api/decisions/:id`<br>`PUT /api/decisions/:id`<br>`DELETE /api/decisions/:id` | `InteractiveModal.tsx`<br>`useDecisionModel.ts`<br>`DecisionDemo.tsx`<br>*(Dashboard missing)* | **Connected but incomplete** | 1. Create `AuthenticatedDashboard` view showing user decisions list, search, filters, and management cards.<br>2. Implement `addOption`, `removeOption`, `updateOption`, `addCriterion`, `removeCriterion`, `updateCriterion` in `useDecisionModel` and UI.<br>3. Connect `DecisionDemo` to the shared model with a "Save to My Decisions" button. |
| **MCDA Authoritative Calculations** | `POST /api/decisions/:id/analyze` | `InteractiveModal.tsx`<br>`useDecisionModel.ts`<br>`DecisionTicket.tsx`<br>`ScoreCard.tsx` | **Connected but incomplete** | 1. Add explicit "Run Authoritative Calculation" button in workspace.<br>2. Visually flag stale client edits vs authoritative server evaluations.<br>3. Display tie detection alerts and breakeven sensitivity.<br>4. Connect `DecisionTicket` to live decision with server verification badge. |
| **Sharing & Invitations** | `POST /api/decisions/:id/invitations`<br>`GET /api/decisions/:id/invitations`<br>`DELETE /api/decisions/:id/invitations/:id`<br>`GET /api/decisions/:id/access`<br>`PATCH /api/decisions/:id/access/:userId`<br>`DELETE /api/decisions/:id/access/:userId`<br>`POST /api/invitations/accept`<br>`GET /api/invitations/:token`<br>`GET /api/invitations/pending` | `ShareModal.tsx`<br>`AcceptInvitationModal.tsx`<br>`Navbar.tsx` | **Connected but incomplete** | 1. Add pending invitations badge and notification banner in Navbar / Dashboard.<br>2. Allow opening `ShareModal` directly from Dashboard decision cards.<br>3. Support 1-click accept / decline of pending invitations. |
| **Expert Contributions** | `GET /api/decisions/:id/contributions`<br>`GET /api/decisions/:id/contributions/mine`<br>`PUT /api/decisions/:id/contributions/draft`<br>`POST /api/decisions/:id/contributions/submit`<br>`POST /api/decisions/:id/contributions/withdraw`<br>`POST /api/decisions/:id/contributions/lock`<br>`POST /api/decisions/:id/contributions/adopt` | `ContributionsModal.tsx` | **Connected and functional** | 1. Expose Contributions trigger directly on Dashboard cards for expert collaborators.<br>2. Ensure round lock status refreshes cleanly upon SSE collaboration events. |
| **Evidence & Provenance** | `GET /api/decisions/:id/evidence`<br>`POST /api/decisions/:id/evidence`<br>`GET /api/decisions/:id/evidence/:id`<br>`PATCH /api/decisions/:id/evidence/:id`<br>`DELETE /api/decisions/:id/evidence/:id` | `EvidenceModal.tsx` | **Connected and functional** | 1. Expose Evidence trigger on Dashboard decision cards.<br>2. Add evidence counter indicators next to criteria and option score cells in the scoring matrix. |
| **AI Analyst** | `POST /api/decisions/:id/ai/analyze`<br>`POST /api/decisions/:id/ai/proposals/apply` | `AiAnalystModal.tsx` | **Connected and functional** | 1. Expose AI Analyst trigger on Dashboard cards.<br>2. Clearly display advisory banner and distinguish AI suggestions from deterministic calculations.<br>3. Ensure applied criteria instantly trigger score matrix refresh. |
| **Advanced Decision Analytics** | `GET /api/decisions/:id/analytics` | `AnalyticsModal.tsx`<br>`MonteCarloTester.tsx` | **Connected but incomplete** | 1. Replace client-side uniform `Math.random()` in `MonteCarloTester.tsx` with canonical Monte Carlo engine or backend analytics data.<br>2. Expose Analytics trigger on Dashboard decision cards. |
| **Workspace Portfolio Analytics** | `GET /api/analytics/overview` | `WorkspaceAnalyticsModal.tsx`<br>`Navbar.tsx` | **Connected and functional** | 1. Expose Workspace Analytics button in Navbar and Dashboard.<br>2. Display portfolio KPI summary in the Authenticated Dashboard. |
| **Disagreement Intelligence** | `GET /api/decisions/:id/disagreements`<br>`PATCH /api/decisions/:id/disagreements/:key/resolution`<br>`POST /api/decisions/:id/disagreements/explain` | `DisagreementsModal.tsx` | **Connected and functional** | 1. Expose Disagreements trigger on Dashboard cards and workspace footer.<br>2. Show consensus badge on decision cards when contributions exist. |
| **Expert Calibration** | `GET /api/decisions/:id/predictions`<br>`POST /api/decisions/:id/predictions`<br>`POST /api/predictions/:id/outcome`<br>`POST /api/predictions/:id/dispute`<br>`GET /api/decisions/:id/calibration`<br>`GET /experts/:id/calibration` | `ExpertCalibrationModal.tsx` | **Connected and functional** | 1. Expose Calibration trigger on Dashboard cards and workspace footer.<br>2. Display Brier score and reliability indicators when predictions exist. |
| **Audit History & Verification** | `GET /api/decisions/:id/audit`<br>`POST /api/decisions/:id/audit/verify`<br>`GET /api/decisions/:id/snapshots`<br>`POST /api/decisions/:id/snapshots`<br>`GET /api/decisions/:id/snapshots/:id` | `AuditExportModal.tsx`<br>`DecisionHistoryTimeline.tsx` | **Connected but incomplete** | 1. Connect `DecisionHistoryTimeline` to display live audit events / snapshots when a decision is active.<br>2. Expose Audit & Snapshots trigger directly on Dashboard cards. |
| **Export Operations** | `GET /api/decisions/:id/export` | `AuditExportModal.tsx`<br>`DecisionTicket.tsx` | **Connected and functional** | 1. Expose 1-click export actions (JSON, Markdown, CSV) directly on Dashboard decision cards and in workspace. |
| **Real-Time Collaboration** | `GET /api/decisions/:id/collaboration/stream`<br>`POST /api/decisions/:id/collaboration/presence`<br>`GET /api/decisions/:id/collaboration/participants` | `RealtimePresenceBar.tsx`<br>`useRealtimeCollaboration.ts` | **Connected and functional** | 1. Displays participant presence, handles heartbeat, and prompts on concurrent conflict. |

---

## 3. Implementation Plan & Execution Phases

### Batch 1: Authentication & Session Persistence (Phase 3 & 7)
- Update `apps/web/src/context/AuthContext.tsx`:
  - Store token in `localStorage` upon login/register.
  - On mount, if token exists, initialize `apiClient.setToken(token)` and call `apiClient.getCurrentUser()`.
  - Handle session restoration, loading states, and automatic cleanup on 401 Unauthorized.
  - Expose `checkSession()` for manual or reactive re-validation.

### Batch 2: Authenticated Dashboard & Decision Hub (Phase 4 & 5)
- Create `apps/web/src/components/Dashboard.tsx`:
  - Portfolio summary cards: Total Decisions, Decisions Shared With Me, Pending Invitations count.
  - Search and filter bar (by title, status, role).
  - Decision cards grid / table:
    - Title, description, created/updated date.
    - Criteria count, options count.
    - Winning option with score and verification badge.
    - User role pill (Owner / Editor / Viewer).
    - Quick actions: Open in Workspace, Share, Analytics, Evidence, AI Analyst, Audit/Export, Delete.
  - Pending invitations banner with 1-click Accept / Decline.
  - Empty state with 1-click template starter buttons ("Job Offer", "Cloud Migration", "City Relocation").
  - "+ New Decision" creation modal / inline trigger.
- Update `apps/web/src/components/Navbar.tsx`:
  - Add "Dashboard" / "Overview" view toggle when authenticated.
  - Add Pending Invitations counter badge.

### Batch 3: Criteria & Alternatives Management in Decision Workspace (Phase 4 & 5)
- Update `apps/web/src/hooks/useDecisionModel.ts`:
  - Add `addOption(name: string, tagline?: string, color?: string)`
  - Add `removeOption(optionId: string)`
  - Add `updateOption(optionId: string, updates: Partial<Option>)`
  - Add `addCriterion(name: string, defaultWeight?: number)`
  - Add `removeCriterion(criterionId: string)`
  - Add `updateCriterion(criterionId: string, updates: Partial<Criterion>)`
  - Add `runAuthoritativeAnalysis()` to explicitly invoke `apiClient.analyzeDecision(decisionId)`.
- Update `apps/web/src/components/InteractiveModal.tsx`:
  - Add UI controls to add, edit, and delete options.
  - Add UI controls to add, edit, and delete criteria.
  - Add "Run Authoritative Calculation" button next to save.
  - Display tie detection warning and sensitivity breakeven point.

### Batch 4: Landing Page Integration & Mock Data Replacement (Phase 4)
- Update `apps/web/src/components/DecisionDemo.tsx`:
  - Connect to shared decision model.
  - Add "Save Demo to My Decisions" and "Open in Workspace" actions.
- Update `apps/web/src/components/MonteCarloTester.tsx`:
  - Replace in-browser uniform random math with canonical Monte Carlo engine or backend analytics.
- Update `apps/web/src/components/CaseStudies.tsx`:
  - Add "Load into Workspace" / "Clone Template" buttons to each case study card.
- Update `apps/web/src/components/DecisionHistoryTimeline.tsx`:
  - When a saved decision is active, load its real audit events / snapshots, with toggle to view illustrative walkthrough.
- Update `apps/web/src/components/DecisionTicket.tsx`:
  - Reflect real active decision ID, server verification status, and timestamp.

### Batch 5: End-to-End Workflow Verification & Regression Gate (Phase 8 & 10)
- Verify all 15 workflows end-to-end with real backend and MongoDB.
- Run `npm run verify` (typecheck + lint + test + build across monorepo).
- Verify database persistence after browser refresh.
- Generate `FRONTEND_BACKEND_INTEGRATION_REPORT.md`.

