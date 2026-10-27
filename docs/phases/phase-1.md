# Phase 1 — Backend Foundation (+ Monorepo Layout)

## Precondition
Phase 0 audit is complete (locked in `PHASE_0_REPORT.md`), and the canonical Decision Engine v1 specification is finalized and locked in `CANONICAL_DECISION_ENGINE_V1_SPEC.md`.

## Objective
Establish target layout `apps/web`, `apps/api`, `packages/decision-engine`, pure TypeScript MCDA engine based exclusively on `CANONICAL_DECISION_ENGINE_V1_SPEC.md`, Fastify API foundation, and root `npm run verify` gate.

## Steps
1. Move the frontend into `apps/web` in ONE commit that only moves files and fixes paths (`git mv`). Verify: frontend starts, build passes, tests pass.
2. Create npm workspaces and the root verify script (`npm run verify`) covering all workspaces: typecheck (`tsc --noEmit`), lint, unit + integration tests, production build.
3. Create `packages/decision-engine` as a pure TypeScript package implementing `CANONICAL_DECISION_ENGINE_V1_SPEC.md` and golden fixtures G1–G10.
4. Create `apps/api`: bootstrap (`buildApp` separate from `listen`), env validation with Zod, Pino logging with request IDs, centralized error handler, CORS, `GET /health`.
5. Tests with Fastify inject: health OK, 404 JSON, invalid env fails fast, thrown error handled JSON, validation error shape.

## Out of Scope
MongoDB, decision endpoints, authentication, authorization, sharing, experts, evidence, AI, realtime collaboration, Redis, advanced scaling.

## Acceptance Criteria
1. Backend starts (`/health` responds 200 `{ status: "ok", service, version }`).
2. Invalid env fails clearly.
3. Error handling tested.
4. Engine package coverage $\ge 95\%$.
5. Frontend starts and builds from `apps/web`.
6. `npm run verify` green across all workspaces.
7. No future-phase code.
