# Phase 4 — Frontend/Backend Integration

## Precondition
Phase 3 Decision API and authoritative server-side MCDA engine are complete and verified (commit `a6f18e9`), with all endpoints passing integration and unit tests against MongoDB. Root verification gate `npm run verify` passing across all workspaces.

## Objective
Connect the existing Decision OS frontend in `apps/web` to the verified decision API in `apps/api` without redesigning the product, duplicating business logic, or weakening server-side authority.

## Data Flow Architecture
The authoritative data flow implemented in Phase 4 is:
`User Input → Frontend Validation → Decision API (Fastify) → Server Validation (Mongoose/Zod) → Canonical Decision Engine v1 (pure TS) → MongoDB → API Response → UI`

All calculations displayed as authoritative results originate exclusively from the server-persisted `analysis` snapshot computed by `packages/decision-engine`.

## Key Deliverables

### 1. API Client Module (`apps/web/src/api/`)
- **Centralized Client**: `DecisionApiClient` with standardized methods:
  - `POST /api/decisions` (`createDecision`)
  - `GET /api/decisions` (`listDecisions` with pagination & search)
  - `GET /api/decisions/:id` (`getDecision`)
  - `PUT /api/decisions/:id` (`updateDecision`)
  - `DELETE /api/decisions/:id` (`deleteDecision`)
  - `POST /api/decisions/:id/analyze` (`analyzeDecision`)
- **Anti-Forgery Sanitization**: `sanitizePayload` defensively deletes client-computed fields (`winner`, `winnerId`, `finalScore`, `analysis`, `engineVersion`, `calculationVersion`) before transmission.
- **Error Handling**: `ApiClientError` capturing `statusCode`, `error`, `message`, `requestId`, `missingPairs`, and `isNetworkError`.
- **Environment Configuration**: `resolveApiUrl()` with support for `VITE_API_URL` (defaulting safely to `http://localhost:3000`).

### 2. State Management & Hooks (`apps/web/src/hooks/useDecisionModel.ts`)
- Preserves all existing reactive capabilities for weight calibration and scenario switching.
- Introduces explicit persistence modes:
  - `template`: Static baseline template demonstration.
  - `draft`: Unsaved changes / custom decision in progress (displays optimistic local preview clearly labelled as "Unsaved Preview").
  - `saved`: Persisted record backed by MongoDB `_id`, displaying server-verified authoritative results.
- Concurrency & Race-Condition Guards:
  - In-flight request locking prevents duplicate submissions.
  - Request sequence counters discard stale asynchronous responses.
- Input Preservation:
  - Form state (`dataset`, `weights`, `criteria`, `options`, `scores`) is never erased upon API failure.

### 3. Canonical Engine Result Mapping (`apps/web/src/utils/engineMapper.ts`)
- Maps `EngineResult` from `packages/decision-engine` directly into frontend display structures.
- Supports mathematical ties (`isTie: true`), decisive victories, sensitivity tipping points, and criteria contributions without duplicating MCDA formulas.

### 4. UI Enhancements & Preservation
- **Interactive Workspace (`InteractiveModal.tsx`)**:
  - Live status pills: "Server-Verified (v1.0.0)" vs "Unsaved Preview (Draft)" vs "Template Demonstration".
  - MongoDB Persisted Decisions browser ("Saved Records" dropdown).
  - Custom decision creation workflow ("New Decision").
  - Interactive Option Scoring Matrix (0–100 sliders/inputs per criterion).
  - Prominent error banner with actionable retry for network or server validation failures.
- **URL Direct Retrieval**:
  - Visiting `/?decisionId=<id>` automatically retrieves and renders the persisted decision.
- **Official Briefing Pass (`DecisionTicket.tsx`)**:
  - Displays real MongoDB decision ID and canonical engine verification status.

## Configuration & CORS
- **Development**:
  - Backend `apps/api/.env.example`: `CORS_ORIGIN=http://localhost:5173`
  - Frontend `apps/web/.env.example`: `VITE_API_URL=http://localhost:3000`
- **Production**:
  - Configure `CORS_ORIGIN` in `apps/api` with the production frontend domain (e.g., `https://decision-os.app`).
  - Configure `VITE_API_URL` in `apps/web` with the production API URL (e.g., `https://api.decision-os.app`).
  - CORS remains strictly origin-validated and never allows `*`.

## Scope Boundaries (Phase 4 Constraints)
- No authentication or user sessions (reserved for Phase 5).
- Decisions remain public/unscoped until Phase 5.
- No collaborative sharing or RBAC (Phase 6).
- No expert contribution workflows (Phase 7).
- No external evidence records (Phase 8).
- No LLM advisor integrations (Phase 9).
