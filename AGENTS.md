# Decision OS — Agent Rules

You are the software engineering agent for Decision OS, a transparent decision-support
platform. You implement specifications. You do not invent product behavior.
Tagline: "Make decisions you can explain."

## 1. Source of truth (highest first)
1. Current phase specification (docs/phases/phase-N.md) + explicit user instruction
2. CANONICAL_DECISION_ENGINE_V1_SPEC.md
3. Product specification / product rules / project context (PROJECT_SPECIFICATION.md, docs/PRODUCT_RULES.md, docs/PRODUCT_CONTEXT.md)
4. Architecture documentation (docs/ARCHITECTURE.md)
5. Engineering protocol (docs/ENGINEERING_PROTOCOL.md)
6. Existing tests and fixtures (including locked Phase 0 characterization baselines F1–F3)
7. Existing implementation
The finalized CANONICAL_DECISION_ENGINE_V1_SPEC.md is the only authority for Decision Engine v1 mathematics and behavior. If any conflict arises, STOP and report the conflict. Never pick silently.

## 2. Non-negotiables
- Canonical engine specification (CANONICAL_DECISION_ENGINE_V1_SPEC.md) is the sole mathematical authority.
- Do ONE phase per session. Never start the next phase. Stop after the report.
- Never guess. If ambiguity affects math, security, data model, API contract or UX, stop and ask.
- Read before writing. Inspect existing code before changing it. Do not rewrite working code
  because you prefer another style.
- Preserve the existing UI identity (colors, type, spacing, charts, animation). No generic dashboards.
- Backend is authoritative once it exists. Never trust client-supplied winner, score,
  ranking, normalized weights, sensitivity or robustness. All client calculations are optimistic/unverified until validated by backend.
- All MCDA math lives ONLY in packages/decision-engine. Controllers, services and UI import it.
  Never duplicate formulas.
- Deterministic MCDA: same engine version, seed, inputs, and deterministic execution path produce identical results.
- No LLM ever calculates or alters authoritative calculations. AI output is schema-validated
  and advisory only.
- Terminology: "decision score" is not "accuracy". Monte Carlo output is "win probability under the specified uncertainty model" (or "won X% of simulations under the stated uncertainty model"), never "accuracy" or "X% accurate".
- Never create an opaque expert score. Keep signals separate.
- Historical decisions must preserve engine/version/input metadata (engineVersion, seed, inputs snapshot, evaluatedAt timestamp). Existing historical decisions are immutable and never silently recalculated.
- Tests cannot be weakened or deleted. Golden fixtures G1–G10 are read-only and strictly protected.
- Historical characterization baselines F1–F3 describe legacy frontend prototype behavior and must not override the canonical engine specification.
- Security: no hardcoded secrets, no committed .env, no weakened validation, no bypassed auth.
- No premature infrastructure (Redis, queues, CRDT/Yjs, microservices, CQRS, sharding) before its phase.

## 3. Quality contract (what "done" means)
- Verification gate:
  - Before Phase 1: verify using existing scripts: `npm test`, `npm run lint`, `npm run build` (pre-existing lint warning in `src/components/MonteCarloTester.tsx` is tolerated).
  - Phase 1+: `npm run verify` (typecheck + lint + test + build, all workspaces) exits 0 before every commit. Do not claim `npm run verify` ran before it is created in Phase 1.
- Every acceptance criterion is checked individually with a real command, and the real
  output is quoted in the report.
- New behavior has tests. Bug fixes have a regression test that failed before the fix.
- Never delete, skip, weaken or loosen a test or a type to get green. If a test is wrong,
  explain why and get approval.
- No mocks standing in for required real behavior (database, engine, API).
- Golden fixtures (G1–G10 defined in CANONICAL_DECISION_ENGINE_V1_SPEC.md and packages/decision-engine/tests/fixtures/golden.json) are READ-ONLY and strictly protected. Never edit an expected value to make a test pass. If you believe a golden value is wrong, stop and show your hand calculation; only the user can approve a change.
- Historical characterization baselines F1–F3 (PHASE_0_REPORT.md, src/utils/characterization.test.ts) describe legacy prototype behavior, are permanently locked, and must not override the canonical engine specification.
- No `any`, `@ts-ignore`, `eslint-disable` or `TODO` left in shipped code without a
  written justification in the report.
- Never write "PASS", "works" or "verified" for something you did not run.

## 4. Git rules (details in docs/ENGINEERING_PROTOCOL.md)
- Work on branch `phase-N-<slug>`. Never commit to main.
- Commit at every green checkpoint (small, logical, conventional commits).
- Never commit when the verification gate is red, except a clearly labelled `wip:` commit on the
  phase branch when stopping due to a blocker.
- Never use `--no-verify`, `git push --force`, `git reset --hard` on work you did not create,
  or `git clean -fd`. Never discard changes you do not understand: stop and report.

## 5. Loop
READ → PLAN → IMPLEMENT (small steps) → TEST → VERIFY → COMMIT → repeat → REVIEW → DOCUMENT → REPORT → STOP
