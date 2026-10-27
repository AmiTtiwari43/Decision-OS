# Phase 1 Implementation Plan — Backend Foundation

## Objective
Establish the target monorepo architecture (`apps/web`, `apps/api`, `packages/decision-engine`), implement the canonical Decision Engine v1 pure package based exclusively on `CANONICAL_DECISION_ENGINE_V1_SPEC.md`, build the Fastify API foundation, and enforce the root `npm run verify` gate.

## Execution Units
1. **Frontend relocation**: Completed (`apps/web`, commit `47a45dd`).
2. **Persistent docs & rules**: `AGENTS.md`, `docs/ENGINEERING_PROTOCOL.md`, etc.
3. **Decision engine package**: `packages/decision-engine` with validation, Hare-Niemeyer normalization, dual-precision scoring, SCR tie ranking, closed-form sensitivity, Mulberry32 Gaussian Monte Carlo, and G1–G10 golden fixtures.
4. **Fastify API foundation**: `apps/api` with `buildApp()`, Zod env validation, error handler, CORS, `/health`, and Fastify inject tests.
5. **Monorepo verify gate**: `npm run verify` running typecheck, lint, test, build across all workspaces with pre-commit hook.
6. **Adversarial review & reporting**: Verification against 17 stress vectors and final report generation.
