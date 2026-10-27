# Decision OS — System Architecture

## Target Monorepo Architecture

```text
apps/
  web/                         # Frontend React 19 SPA
  api/                         # Fastify + TypeScript HTTP Service

packages/
  decision-engine/             # Pure TypeScript Canonical Decision Engine (MCDA)
```

## Architectural Boundaries

1. **Deterministic MCDA Engine**:
   - `packages/decision-engine` is completely decoupled from UI, HTTP, database, and DOM.
   - Authoritative for all weighting, scoring, ranking, tie-breaking, sensitivity tipping points, and Monte Carlo simulations.
   - Governed strictly by `CANONICAL_DECISION_ENGINE_V1_SPEC.md`.

2. **Frontend (`apps/web`)**:
   - High-fidelity decision-support workspace.
   - Optimistic client-side evaluation during interactive deliberation.
   - Preserves dark-mode aesthetic, custom charts, torque balance scale, and verified decision briefing pass.

3. **Backend API (`apps/api`)**:
   - Fastify HTTP service.
   - Responsible for authoritative server-side analysis, validation, persistence (Phase 2+), and future collaboration.

## Pre-approved dependencies (no further justification needed)
- Frontend: existing stack only (`react`, `framer-motion`, `lucide-react`, `tailwindcss`, `vite`, `oxlint`, `vitest`).
- API: `fastify`, `@fastify/cors`, `zod`, `pino` (via Fastify), `dotenv` or `node --env-file`.
- Dev: `typescript`, `vitest`, `supertest`, `eslint` + `typescript-eslint` or `oxlint`, `tsx`, `fast-check`.
- Phase 2: `mongodb` (native driver).
- Phase 5: `argon2` or `bcrypt`, `@fastify/cookie` or `@fastify/jwt`.
Anything else needs a written justification in the plan and the report.
Always install with the package manager and read the real installed version; never assume APIs from memory.
