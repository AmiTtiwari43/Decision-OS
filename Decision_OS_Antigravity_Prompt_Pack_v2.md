# Decision OS — Antigravity Prompt Pack v2
**Verified phases · Regular commits · Evidence-based reports**

A note on "bugless": no prompt can guarantee zero bugs. What this pack does is make bugs unlikely to survive: a single verify gate before every commit, tests written before or with code, a locked engine spec (`CANONICAL_DECISION_ENGINE_V1_SPEC.md`), an adversarial self-review before each report, and a rule that "PASS" requires pasted command output. You still review each phase report yourself. That review is the final gate.

---

## 0. What changed from v1

| Problem in v1 | Fix in v2 |
|---|---|
| No commit rules | Branch per phase, checkpoint commits, tag on completion, hooks, no `--no-verify` |
| Engine spec left normalization/ties/missing values "to be decided" | Authoritative `CANONICAL_DECISION_ENGINE_V1_SPEC.md` locked with exact dual-precision formulas, Hare-Niemeyer Largest Remainder normalization, tie policies, analytical tipping-point math, and G1–G10 golden fixtures |
| "Run tests" with no defined gate | Explicit verification sequencing: pre-Phase 1 verified via existing `npm test`, `npm run lint`, `npm run build`; Phase 1 establishes the repository-level `npm run verify` gate (typecheck + lint + test + build) that must be green before every commit thereafter |
| "Report PASS" could be claimed from inspection | Report requires raw command output per criterion |
| Pre-approval gaps made the agent stop on routine choices | Pre-approved dependency list and decision defaults |
| No self-review | Mandatory adversarial review step before reporting |
| Monorepo move (`apps/web`) was implicit | Isolated as its own commit in Phase 1 with before/after verification |
| Test DB guard missing | Tests refuse to run against a non-test database |
| No hand-verified math examples; locked criteria unspecified | Locked-criteria rule written in plain math; 10 golden fixtures (G1–G10) locked in `CANONICAL_DECISION_ENGINE_V1_SPEC.md` that the agent cannot edit |
| Unclear reproducibility guarantees | Authoritative contract: *Same engine version, seed, inputs, and deterministic execution path produce identical results.* |

---

## 1. Setup order

1. Create the files in Part A (they live in the repo permanently). Note that `CANONICAL_DECISION_ENGINE_V1_SPEC.md` is already present, verified, and locked as the sole mathematical authority.
2. Open a fresh Antigravity session, paste the **Orientation Prompt** (Part B). It reads only and changes nothing.
3. Run phases one at a time with the **Phase Launcher** (Part C). Each phase spec is in Part D.
4. After each phase: read the report, run the verification gate (`npm test`/`lint`/`build` pre-Phase 1; `npm run verify` Phase 1+) yourself, skim `git log`, then tell the agent to proceed or merge.
5. Use the Bugfix, Resume and Review prompts (Part E) when needed.

Antigravity tips: use Planning mode for phases so the agent produces a plan before editing; keep terminal commands on "request review" for the first two phases until you trust the flow; if your version supports workflows (`.agent/workflows`), save the Phase Launcher there as a slash command. Check your installed version for exact folder names.

---

# PART A — PERSISTENT FILES

## A1. `AGENTS.md` (repo root)

```markdown
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
```

## A2. `docs/ENGINEERING_PROTOCOL.md`

```markdown
# Engineering Protocol

## Verify gate sequencing

### Before Phase 1
The current repository does not yet possess the root `npm run verify` script. It is verified using currently available commands:
  - `npm test`
  - `npm run lint`
  - `npm run build`
Note: The known pre-existing lint warning in `src/components/MonteCarloTester.tsx` may remain unless explicitly addressed. Do not claim `npm run verify` was executed before it exists.

### During Phase 1
Phase 1 must establish the repository-level verification gate:
  `npm run verify`
with the required checks defined by the Phase 1 specification:
  1. typecheck (`tsc --noEmit`)
  2. lint
  3. unit + integration tests
  4. production build
Exit code must be 0 across all workspaces. If a workspace has no lint/test yet, add a minimal real one; do not stub.

### After the verify gate exists (Phase 1+)
Every relevant Phase 1+ checkpoint and commit must execute and pass `npm run verify` (exit code 0).

## Branching and tags
- Start of phase: `git switch -c phase-N-<slug>` from the latest main (or the previous
  phase's merged state). Confirm clean working tree first.
- End of phase (after user approval only): the USER merges. The agent only creates the tag
  `phase-N-complete` on the final verified commit when told to.

## Commit cadence
Commit whenever one logical unit is complete and the verification gate is green. Typical units:
  1. plan document
  2. test scaffolding / failing tests (allowed red ONLY as `test:` commit with note)
  3. each module or endpoint with its tests
  4. each refactor (separate from behavior changes)
  5. documentation updates
  6. final report file
Rules: ≤ ~400 changed lines per commit where practical; never mix refactor and feature;
never commit generated artifacts, node_modules, .env, build output.

## Commit message format (Conventional Commits)
  type(scope): imperative summary (≤ 72 chars)

  Why: one or two lines of reason
  Verified: verification gate green (or the exact command run)

Types: feat, fix, test, refactor, docs, chore, build, ci, wip.
Examples:
  feat(engine): add weight normalization with validation
  test(api): cover analyze rejecting client-supplied winner
  chore(repo): add verify script and .githooks pre-commit

## Hooks (no new dependency)
`.githooks/pre-commit` runs typecheck + lint on the repo. Enable with
`git config core.hooksPath .githooks`. Full verification gate runs before commits.

## Safety
- Run `git status`, `git branch --show-current`, `git log --oneline -10` before touching anything.
- Unknown uncommitted changes → STOP and report. Do not stash, reset or overwrite.
- Secrets: `.env` is gitignored; `.env.example` lists variables with no real values.
  Before each commit, check `git diff --cached` for keys, tokens, connection strings.

## Evidence rule for reports
For every acceptance criterion: the exact command, and the last ~15 lines of real output
(or the specific test names that passed). "Looks correct" is not evidence.

## Adversarial review (mandatory before the report)
After implementation, re-read your own diff (`git diff main...HEAD`) as a hostile reviewer:
  - What input would break this? (empty, huge, negative, NaN, duplicate IDs, unicode)
  - What happens on failure paths (DB down, bad JSON, timeout)?
  - Any duplicated math, leaked secret, missing authorization check, silent catch?
  - Any claim in the docs the code does not actually satisfy?
Fix findings, add tests for them, re-run verification gate. List what you found in the report.
```

## A3. Canonical Decision Engine Specification (`CANONICAL_DECISION_ENGINE_V1_SPEC.md`)

The authoritative contract for Decision Engine v1 is located in the repository at:
`CANONICAL_DECISION_ENGINE_V1_SPEC.md`

All engine mathematics, formulas, validation rules, normalization logic, tie policies, tipping-point formulas, Monte Carlo models, and golden fixtures MUST be read directly from `CANONICAL_DECISION_ENGINE_V1_SPEC.md`.

To prevent two competing sources of truth, mathematical specifications and golden fixtures are NOT duplicated in this prompt pack.

### Key Architectural Invariants
1. **Mathematical Authority**:
   - `CANONICAL_DECISION_ENGINE_V1_SPEC.md` is the sole source of truth for Decision Engine v1 mathematics and behavior (implemented in `packages/decision-engine`).
   - Dual-precision architecture: full IEEE 754 float64 arithmetic internally; single-decimal fixed rounding for display only. Order is determined strictly by unrounded scores.
2. **Score Range & Directionality**:
   - Utility scores $s_{ij} \in [0.0, 100.0]$ (where $100.0 = \text{maximum utility}, 0.0 = \text{minimum utility}$). Benefit direction is standard; cost dimensions must be normalized into $[0.0, 100.0]$ utility scores upstream before passing into Engine v1.
3. **Weight Normalization**:
   - Largest Remainder Method (Hare-Niemeyer) ensures integer-constrained percentage weights sum strictly to 100.0% while eliminating array-order bias. User-locked weights ($S_L$) are preserved inviolate.
4. **Deterministic Tie Handling**:
   - Scores within $10^{-9}$ are considered ties. Tied options receive identical ranks (Standard Competition Ranking 1224 Ranking); presentation order is determined deterministically via Tiers 2–5 (Tier 2 Locked criteria, Tier 3 Dominant criterion, Tier 4 Unweighted average, Tier 5 Option ID ASCII); `tiedWinnerIds` lists all co-winners (`isTie: true`, `winnerId: null`). Winner is never silently chosen.
5. **Exact Analytical Tipping Points**:
   - Closed-form derivative equations solve exact breakeven weights $w_k^*$ under locked constraints without iterative numerical drift.
6. **Seeded Monte Carlo & Reproducibility Contract**:
   - Mulberry32 32-bit unsigned PRNG.
   - Authoritative reproducibility contract:
     > Same engine version, seed, inputs, and deterministic execution path produce identical results.
   - Output label is strictly: `"win probability under the specified uncertainty model"`, NEVER `"accuracy"`.
7. **Golden Fixtures (G1–G10)**:
   - Mandatory test fixtures G1 through G10 are defined exclusively in `CANONICAL_DECISION_ENGINE_V1_SPEC.md` (Section 6).
   - Fixtures cover: G1 Basic Weighted Decision, G2 Multi-Option Ranking, G3 Proportional Normalization + Largest Remainder (Hare-Niemeyer), G4 Locked Criteria Constraints, G5 All-Zero Raw Weights, G6 Missing Score Rejection, G7 Invalid Score Rejection, G8 Exact-Score Tie Behavior, G9 Sensitivity / Tipping-Point with Locked Criteria, and G10 Deterministic Monte Carlo Reproducibility.
   - Fixtures are read-only and must be implemented verbatim in `packages/decision-engine/tests/fixtures/golden.json`.
8. **Historical Characterization Baselines (F1–F3)**:
   - F1–F3 are historical characterization baselines of the prototype frontend documented in `PHASE_0_REPORT.md` and tested in `src/utils/characterization.test.ts`.
   - They describe historical legacy behavior, are permanently locked, do NOT define the canonical Engine v1 contract, and must not override `CANONICAL_DECISION_ENGINE_V1_SPEC.md`. Intentional differences between historical behavior and Engine v1 are expected where documented in `CANONICAL_DECISION_ENGINE_V1_SPEC.md`.

## A4. `docs/PRODUCT_RULES.md`, `docs/PRODUCT_CONTEXT.md`, `docs/ARCHITECTURE.md`
Keep your v1 versions of these three. They are good. Apply these edits:

- `ARCHITECTURE.md`: add "Pre-approved dependencies" below.
- `PRODUCT_CONTEXT.md`: delete the example score line "PostgreSQL = 84.2" unless it comes from a real fixture, so the agent does not treat it as a test oracle.
- `PRODUCT_RULES.md`: add Rule 16, "Every authoritative result records the engine version and inputs used."

```markdown
## Pre-approved dependencies (no further justification needed)
Frontend: existing stack only.
API: fastify, @fastify/cors, zod, pino (via Fastify), dotenv or node --env-file, mongodb
     (native driver) or mongoose (choose ONE in Phase 2 and record why).
Dev: typescript, vitest, supertest, eslint + typescript-eslint, prettier, tsx, fast-check.
Phase 5: argon2 or bcrypt (choose one), @fastify/cookie or @fastify/jwt (choose one).
Anything else needs a written justification in the plan and the report.
Always install with the package manager and read the real installed version; never assume
APIs from memory. Check the installed package's docs/types for the version you got.
```

## A5. `docs/IMPLEMENTATION_STATUS.md`
Use your v1 template, plus these fields at the top: `Last verified commit:` and `Last green verify:`.

---

# PART B — ORIENTATION PROMPT (run once, read-only)

```text
Read these files completely: AGENTS.md, CANONICAL_DECISION_ENGINE_V1_SPEC.md, PROJECT_SPECIFICATION.md,
README.md, docs/PRODUCT_CONTEXT.md, docs/PRODUCT_RULES.md, docs/ARCHITECTURE.md,
docs/ENGINEERING_PROTOCOL.md, docs/BUILD_PLAN.md, docs/IMPLEMENTATION_STATUS.md.

Do NOT modify any file and do NOT run any install or build.

Then reply with:
1. The product in 3 sentences.
2. The 10 rules you consider most likely to be violated by accident, in your own words.
3. The commit cadence and branch naming you will follow.
4. Anything contradictory, ambiguous or missing in these documents (be specific, quote the line).
5. Questions you need answered before Phase 0.
Stop after that.
```

---

# PART C — PHASE LAUNCHER (reuse for every phase)

```text
Execute Phase <N> — <name> exactly as specified in docs/phases/phase-<N>.md.

Before anything else:
1. Read AGENTS.md, docs/ENGINEERING_PROTOCOL.md, docs/IMPLEMENTATION_STATUS.md,
   and the phase spec. Read CANONICAL_DECISION_ENGINE_V1_SPEC.md, PRODUCT_RULES.md and ARCHITECTURE.md as relevant.
2. Run: git status, git branch --show-current, git log --oneline -10.
   If there are uncommitted changes you did not make → STOP and report.
3. Create branch phase-<N>-<slug>.
4. Run verification baseline: before Phase 1, run npm test, npm run lint, npm run build; in Phase 1+, run npm run verify.
   Classify any failures as pre-existing / environment / caused by you. Commit nothing yet.
5. Write docs/plans/phase-<N>-<slug>.md (objective, current vs desired state, files affected,
   steps, tests, risks, assumptions, acceptance criteria). Commit it:
   docs(plan): phase <N> plan
6. Show me the plan summary and WAIT for my approval ONLY IF the plan contains an open
   question or an assumption that affects data model, API, security or math. Otherwise continue.

Implementation rules:
- Small steps. After each logical unit: tests → verification gate green → commit (Conventional Commits).
- Tests are written with or before the code they cover.
- Stay inside this phase's scope. Anything out of scope that looks useful goes into
  "Suggestions" in the report; do not build it.
- Follow the adversarial review step in docs/ENGINEERING_PROTOCOL.md before reporting.

Finish:
- Update docs (IMPLEMENTATION_STATUS.md and any affected architecture/API/engine doc). Commit.
- Save the report as docs/reports/phase-<N>-report.md and commit it.
- Print the report in the chat using the format below, then STOP.
- Do not merge, do not tag, do not start the next phase.

REPORT FORMAT
PHASE REPORT — Phase <N>: <name>
Status: COMPLETE | INCOMPLETE | BLOCKED
Branch / last commit: <name> / <hash>
Commits made: <git log --oneline for the phase>
Implemented: <bullets>
Files changed: <git diff --stat main...HEAD>
Acceptance criteria:
  1. PASS|FAIL — command run — key output lines
  2. ...
Verify gate: verification command output tail (npm test / lint / build before Phase 1; npm run verify in Phase 1+)
Tests: counts passed/failed, coverage for the engine package if touched
Adversarial review findings: <what you found and fixed, or "none" with what you checked>
Pre-existing issues (not caused by this phase):
Known limitations:
Unverified items (be explicit):
Suggestions for later (not built):
Open questions for the user:
Next phase: <name>
```

---

# PART D — PHASE SPECS (save each as `docs/phases/phase-N.md`)

## `docs/BUILD_PLAN.md`

```markdown
Phases run in order. Never skip, never merge phases, never start a phase without the user's go-ahead.
0 Audit and cleanup · 1 Backend foundation · 2 MongoDB persistence · 3 Decision API + server MCDA ·
4 Frontend integration · 5 Authentication · 6 Sharing · 7 Expert contributions · 8 Evidence ·
9 AI analyst · 10 Advanced analytics · 11 Disagreement intelligence · 12 Expert calibration ·
13 Audit/history/export · 14 Realtime · 15 Performance/scale
Each phase ends in a verified, committed, working state.
```

## Phase 0 — Audit, cleanup, engine extraction prep

```markdown
STATUS: COMPLETE & LOCKED (Reference: PHASE_0_REPORT.md, git tag phase-0-complete at commit 4f8b243).

OBJECTIVE
Understand the existing frontend, make it verifiable, document it. No backend yet.

STEPS
1. Inspect: package files, source tree, routing, components, hooks, state, data files, charts,
   styling, config, tests, assets. Trace the real data flow; do not trust file names.
2. Verify existing tooling: npm test, npm run lint, npm run build. Note pre-existing lint warning in
   src/components/MonteCarloTester.tsx.
3. Map existing functionality: decision creation, criteria, weights, options, scores, winner
   calculation, sensitivity, Monte Carlo, scenarios, history, charts, UI state, hardcoded data.
4. Extract existing frontend characterization baselines into pure characterization tests:
   fixtures F1–F3 (see PHASE_0_REPORT.md and src/utils/characterization.test.ts) preserve legacy prototype
   behavior. F1–F3 are locked historical references and do not override canonical Engine v1.
5. Canonical Decision Engine v1 contract is formally documented and locked in CANONICAL_DECISION_ENGINE_V1_SPEC.md
   (including G1–G10 golden fixtures and reproducibility contract).
6. Classify code: KEEP / KEEP+REFACTOR / TEMPORARILY KEEP / REMOVE. Remove only code proven
   unused (show the evidence: no imports, no routes, no references). One removal topic per commit.
7. Isolate and list every hardcoded decision, criteria, weight, option, score, winner, statistic
   and fake API response (file + line). Do not replace them yet.
8. Verify: app starts (run it and report the URL/port), UI unchanged, tests pass.

OUT OF SCOPE: backend, MongoDB, auth, AI, experts, realtime, UI redesign, math changes.

DELIVERABLES: PHASE_0_REPORT.md, CANONICAL_DECISION_ENGINE_V1_SPEC.md, characterization test suite.

ACCEPTANCE
1. App starts. 2. UI visually unchanged. 3. Baseline tests pass. 4. Characterization tests F1–F3 pass.
5. Canonical Decision Engine v1 contract locked. 6. Removed code justified.
7. Hardcoded data fully listed. 8. No backend/DB/auth/AI/expert/realtime code added.
```

## Phase 1 — Backend foundation (+ monorepo layout)

```markdown
PRECONDITION: Phase 0 audit is complete (locked in PHASE_0_REPORT.md), and the canonical Decision Engine v1 specification is finalized and locked in CANONICAL_DECISION_ENGINE_V1_SPEC.md (including reproducibility wording). Phase 1 reads CANONICAL_DECISION_ENGINE_V1_SPEC.md as the sole mathematical authority.

OBJECTIVE
Clean Fastify + TypeScript API and the target layout apps/web, apps/api, packages/decision-engine.

STEPS
1. Move the frontend into apps/web in ONE commit that only moves files and fixes paths
   (git mv, so history follows). Verify: frontend starts, build passes, tests pass.
   Commit: refactor(repo): move frontend to apps/web
2. Create npm workspaces and the root `verify` script (`npm run verify`) covering all workspaces:
   typecheck (`tsc --noEmit`), lint, unit + integration tests, production build.
3. Create packages/decision-engine as a pure TypeScript package (no React, Fastify, Mongo, env, DOM)
   implementing CANONICAL_DECISION_ENGINE_V1_SPEC.md and the full required test list, including every golden fixture
   in the canonical spec (G1–G10) and characterization regression fixtures F1–F3 (from PHASE_0_REPORT.md).
   Frontend and API import it.
   Frontend must still show the same results as the characterization tests, or the discrepancy
   must be an approved change. Commit per module.
4. Create apps/api: bootstrap (buildApp separate from listen so tests need no port), env validation
   with zod (fail fast with a clear message listing bad variables), pino logging with request IDs,
   centralized error handler (consistent JSON error shape, no stack traces in production, validation
   errors → 400/422), CORS for local dev origins from env, GET /health → {status:"ok", service, version}.
   No database status in /health.
5. Tests with Fastify inject: health OK; unknown route → 404 JSON; invalid env fails with
   readable error; thrown error → handled JSON; validation error shape.

OUT OF SCOPE: MongoDB, decision endpoints, auth, AI, experts, realtime.

ACCEPTANCE
1. Backend starts (run it, curl /health, show output). 2. Invalid env fails clearly (show output).
3. Error handling tested. 4. Engine package coverage ≥ 95% (show report). 5. Frontend starts and
builds from apps/web. 6. `npm run verify` green across all workspaces. 7. No future-phase code.
```

## Phase 2 — MongoDB persistence

```markdown
OBJECTIVE
Persist a Decision document in a real MongoDB.

DECISIONS TO MAKE IN THE PLAN (record the reasoning): native driver vs Mongoose (pick one).

DATA
Decision { _id, title, description, criteria[{id,name,weight,direction}], options[{id,name}],
scores {optionId → {criterionId → number}}, analysis (nullable: last authoritative result with
engineVersion + inputs used), calculationVersion, createdAt, updatedAt }
Base field shapes on the existing frontend model and the spec; justify any difference.
Drafts may have incomplete scores. Analysis requires completeness (Phase 3).

IMPLEMENT
Config, connection with timeout and graceful failure, repository layer (create, findById, list,
update, delete), schema validation reusing the same zod/domain types as the engine, indexes only
where needed (createdAt), connection closed cleanly on shutdown.

TESTING
Real MongoDB via a local container or a dedicated test database. Tests must REFUSE to run unless
the database name ends with `_test` (assert at startup). Each test cleans its own data.
Cover: create/retrieve, update, delete, invalid rejection, required fields, timestamps behavior
(updatedAt changes, createdAt does not), invalid ObjectId, connection failure handling.
No in-memory fakes standing in for the database.

OUT OF SCOPE: HTTP endpoints for decisions, auth, AI, experts, realtime.

ACCEPTANCE
1. A real document is created and read back (show the query output). 2. All repository tests pass
against real Mongo. 3. Test-DB guard proven (show it refusing a non-test DB name).
4. App starts and fails clearly when Mongo is unreachable. 5. No secrets committed
(show `git diff main...HEAD | grep -i` for typical patterns with no hits). 6. verify green.
```

## Phase 3 — Decision API + authoritative analysis

```markdown
OBJECTIVE
Full decision CRUD and server-side MCDA.

ENDPOINTS (all under /api)
POST /decisions · GET /decisions · GET /decisions/:id · PUT /decisions/:id ·
DELETE /decisions/:id · POST /decisions/:id/analyze

CONTRACT (write docs/API.md first; commit; then implement)
- Request/response zod schemas, error codes, status codes (201 create, 200, 204 delete,
  400 malformed, 404 missing, 409 conflict if relevant, 422 incomplete for analysis).
- Pagination on GET /decisions (limit with max, cursor or page), stable sort.
- Client-supplied `winner`, `rank`, `finalScore`, `analysis`, `engineVersion` fields are IGNORED
  or rejected (document which). Never persisted as authoritative.
- Analyze: load → validate completeness → call packages/decision-engine → persist result
  (scores, contributions, ranking, winner, tiedWinnerIds, isTie, tipping points per criterion,
  engineVersion, inputs snapshot, analyzedAt) → return it.
- Editing criteria/weights/options/scores marks the stored analysis as stale (or clears it).
  Document the choice and test it.
- No MCDA math in controllers/services.

TESTS (API against real Mongo)
valid/invalid create · retrieve · 404 · invalid id format · update · delete · pagination ·
analyze valid · analyze incomplete → 422 with missing pairs · repeated analyze gives identical
output (same engine version, seed, inputs, and deterministic execution path produce identical results) ·
forged client winner/score ignored · stale-analysis behavior · body size limit · unknown fields handling.

OUT OF SCOPE: auth, sharing, experts, AI, realtime, Monte Carlo.

ACCEPTANCE
1. Every endpoint demonstrated with a real request and response (curl or test output).
2. Forged-winner test passes. 3. Determinism test passes. 4. API.md matches behavior.
5. verify green.
```

## Phase 4 — Frontend integration

```markdown
OBJECTIVE
Replace hardcoded decision data with the real API. Preserve the UI.

IMPLEMENT
- Typed API client (single module) using shared types from the engine/schema package.
- Operations: create, list, load, update, delete, analyze.
- Every network operation handles: loading, success, empty, validation error (field-level where
  possible), network error, server error. No silent failure and no fake success.
- Optimistic engine calculation (shared package) may display instantly, but is visibly distinct
  from the server-verified result (e.g. a "server-verified" indicator using existing styling).
  If the two differ, the server wins and the UI updates.
- Autosave behavior (if any) must not race: define and test the debounce/last-write behavior.
- Keep demo data only as an explicit "load example" action, if the audit says the UI relies on it.

TESTS
Component/unit tests for the API client and states; E2E with Playwright for the full flow against
the real API and test DB: create → save → reload page → reopen → edit → analyze → see server result;
plus API-down and validation-error cases. Take screenshots before/after to confirm the design is intact.

ACCEPTANCE
The 9 criteria from the user workflow, each shown by E2E output. verify green. Visual diff reviewed.
```

## Phase 5 — Authentication and ownership

```markdown
OBJECTIVE
Real users and decision ownership.

REQUIREMENTS
Register, login, logout, current-user endpoint. Passwords hashed (argon2 or bcrypt, per
pre-approved list, record choice). Auth via httpOnly, secure (in prod), sameSite cookies or JWT
(choose one, record why; if cookies, address CSRF explicitly). Rate-limit login and register.
Identity derived ONLY from the session; any client-supplied userId is ignored.
Every decision gets ownerId; every decision query is scoped to the owner. Return 404 (not 403)
for another user's decision to avoid leaking existence (document).
Migration: existing ownerless decisions: decide in the plan (assign, delete or block) and ask the user.

TESTS
register (duplicate email, weak password), login success/failure (generic error message),
logout invalidates, protected endpoint without auth → 401, expired session, cross-user read/update/
delete/analyze all blocked, own access works, passwords never in responses or logs.

FRONTEND
Login/register/logout and session-expiry handling in the existing visual style.

ACCEPTANCE
Each test category shown passing; manual two-user check described with evidence; verify green.
```

## Phase 6 — Sharing

```markdown
OBJECTIVE
Owner shares a decision with another user (role: viewer or editor). Server-side authorization on
every request. Permission model: owner > editor > viewer. Only the owner changes sharing.
Invite by email/username (decide in plan). Revoking works immediately.
No realtime.
TESTS: each role × each action matrix (read, edit, analyze, delete, share), revoked access,
non-shared user blocked, forged permission fields ignored.
ACCEPTANCE: the matrix test passes in full; verify green.
```

## Phase 7 — Expert contributions

```markdown
OBJECTIVE
Structured expert submissions: recommendation, per-criterion scores, reasoning, confidence (0–1),
evidence references (ids only for now), optional prediction (statement, target date, probability).
Experts are invited by the owner; submissions are stored separately from the owner's own scores.
Experts can revise until the owner locks the round; revisions keep history.
Owner sees and compares submissions side by side. No reputation score. No auto-merging of expert
scores into the owner's model; any adoption is an explicit owner action recorded in history.
The MCDA result is unchanged by submissions unless the owner explicitly adopts values.
TESTS: invite/permission, schema validation, revise/lock behavior, separation of owner vs expert data,
comparison endpoint correctness, MCDA unchanged by submissions.
```

## Phase 8 — Evidence and provenance

```markdown
OBJECTIVE
Evidence records with a type: user_assumption | expert_claim | external_evidence | ai_inference |
calculated_result | observed_outcome. Fields: claim, source (url or citation), author, createdAt,
retrievedAt, context excerpt, link to criterion/option/submission, verification status
(unverified | verified_by_user). ai_inference can never be "verified" without a human action and a
source. Calculated results link to the analysis snapshot, not free text.
TESTS: type rules, provenance required where specified, linking, AI-inference restrictions,
UI distinguishes claim vs calculated result.
```

## Phase 9 — AI analyst

```markdown
OBJECTIVE
AI as advisor behind a provider interface (one concrete provider, swappable).
Server-side only; keys from env; never in frontend code or logs.
Capabilities: suggest criteria, find missing criteria, summarize submissions, extract arguments,
detect contradictions, flag evidence gaps, explain results, generate questions.
Every output: zod-validated JSON; invalid output → rejected, one bounded retry, then a clear error.
AI suggestions are stored as proposals; applying one is an explicit human action that goes through
the normal validated update path and is recorded in history.
Treat all user/evidence text as untrusted (prompt-injection): AI output can never trigger tool
calls or writes. AI explanations may cite only numbers returned by the engine; verify numbers in
explanations against the stored analysis and strip or flag mismatches.
TESTS: use a fake provider ONLY for schema/failure/injection tests (this is the one place a fake is
allowed); plus one clearly marked optional live test gated by an env var. Include: invalid JSON,
schema violation, timeout, injection string in evidence, AI attempting to set a winner is ignored,
MCDA unchanged by any AI call.
```

## Phase 10 — Advanced analytics

```markdown
OBJECTIVE
Implement per CANONICAL_DECISION_ENGINE_V1_SPEC.md: tipping points for all criteria (already in v1 engine, surface in UI),
option-score sensitivity, multi-parameter counterfactual (smallest combined weight change that
changes the winner, defined and documented before coding), seeded Mulberry32 Monte Carlo, scenario comparison.
Monte Carlo runs in-process with a hard limit on simulations; no queue yet.
Reproducibility contract: Same engine version, seed, inputs, and deterministic execution path produce identical results.
Monte Carlo output is strictly labeled "win probability under the specified uncertainty model", NEVER "accuracy".
Every result shows its assumptions. Validate analytical tipping points against brute force on
≥ 5,000 random decisions; validate Monte Carlo on cases with known probabilities within a stated
tolerance. Spec update + engine version bump if any formula changes.
```

## Phase 11 — Disagreement intelligence

```markdown
OBJECTIVE
Per criterion: spread (define: standard deviation and range on the utility score scale [0.0, 100.0]), confidence-weighted
variant shown separately, evidence differences. Then answer: "does this disagreement change the
winner?" by re-running the deterministic engine on min/median/max expert scenarios and via tipping
points. Define "decision-critical" precisely in the spec before coding. Explanations must show numbers.
TESTS: constructed cases with known disagreement and known winner flips.
```

## Phase 12 — Expert calibration

```markdown
OBJECTIVE
Predictions linked to observed outcomes entered by an authorized user. Metrics only when outcomes
exist: Brier score for probabilistic predictions, absolute error for numeric ones, calibration bins
with minimum sample size shown. Signals kept separate: domain relevance, experience, evidence quality,
prediction accuracy (forecasting calibration on empirical outcomes, never applied to MCDA score or Monte Carlo win probabilities),
calibration, recency, popularity (display-only, labelled social signal).
Every metric view shows its formula, sample size and the records behind it. No seeded/fake history.
TESTS: metrics against hand-computed fixtures; metrics absent when no outcomes.
```

## Phase 13 — Audit, history, export

```markdown
OBJECTIVE
Append-only audit events for: decision/criteria/weights/options/scores changes, submissions, evidence,
analysis runs, AI proposals applied, sharing changes, final human decision (with rationale).
Immutable analysis snapshots: inputs + engineVersion + output + hash (SHA-256 over canonical JSON,
sorted keys, fixed number formatting). Replay endpoint re-runs the engine on a snapshot and confirms
the hash matches. Export report (PDF or HTML, choose in plan) with all sections.
Reproducibility contract: Same engine version, seed, inputs, and deterministic execution path produce identical results.
Snapshots must store engineVersion, seed, inputs snapshot, and calculation outputs.
Optional Ed25519 signing only if requested.
TESTS: hash stability, tamper detection, replay equality, audit completeness for each mutation type.
```

## Phase 14 — Realtime

```markdown
PRECONDITION: Phases 1–13 verified.
OBJECTIVE
Socket.IO rooms per decision, authenticated on connect and on join, events carry a version number;
clients ignore stale/duplicate events; reconnect triggers a refetch from the REST API; server state
is persisted before broadcast. Unauthorized users receive nothing. Conflicting edits: last-write
with version check returning 409, documented. No Redis, no CRDT.
TESTS: two authorized clients see updates, unauthorized client gets none, reconnect, duplicate and
out-of-order events, persistence failure does not broadcast.
```

## Phase 15 — Performance and scale

```markdown
Measure first (k6 or autocannon, plus profiling): API latency, DB latency, analysis and Monte Carlo
time, concurrency, memory, CPU, frontend bundle and render, AI latency, realtime load.
Write docs/performance/baseline.md. Add infrastructure (indexes, caching, queue, Redis) ONLY for
a measured problem, with: problem, evidence, proposed fix, expected gain, and a before/after
measurement. Nothing added speculatively.
```

---

# PART E — SUPPORT PROMPTS

## E1. Bugfix prompt

```text
Bugfix — do not rewrite anything, do not remove functionality, do not weaken validation or tests.

Issue:
Steps to reproduce:
Expected:
Actual:
Error / log output:
Environment (OS, Node, browser, branch):

Procedure:
1. git status / branch / log. Create branch fix/<short-slug> from the current branch.
2. Reproduce the bug and capture the REAL error. If you cannot reproduce it, stop and tell me what you tried.
3. Locate the layer (frontend / API / DB / engine / config / test / environment). Read the smallest relevant code path and recent commits touching it.
4. State the root cause with evidence (not a guess).
5. Write a regression test and show it FAILING for the right reason. Commit: test(<scope>): reproduce <bug>
6. Implement the smallest correct fix. Show the regression test PASSING.
7. Run the related suite, then the verification gate (npm test / lint / build before Phase 1; npm run verify in Phase 1+). Commit: fix(<scope>): <summary>
8. Ask: where else could the same root cause occur? Search for it, add tests if found.
9. Adversarial review of the diff.
Report: root cause, files changed, regression test name, commands and output, similar-issue search
result, remaining limitations. STOP.
```

## E2. Resume prompt

```text
Resume — the previous session crashed, timed out or lost context. Do not restart the phase.

1. Read AGENTS.md, docs/ENGINEERING_PROTOCOL.md, docs/IMPLEMENTATION_STATUS.md, the phase spec,
   the latest docs/plans file, and docs/reports if present.
2. Run git status, git branch --show-current, git log --oneline -20, git diff --stat.
   If there are uncommitted changes, inspect them. If you do not understand them, STOP and report.
3. Do not trust earlier claims of completion. Run the verification gate (npm test / lint / build before Phase 1; npm run verify in Phase 1+)
   and list what is actually implemented, partial, missing and broken, with evidence.
4. If the tree is dirty but green, commit it logically. If red, fix it or commit as `wip:` and say so.
5. Continue from exactly where the phase stopped. Do not recreate working code. Do not start the next phase.
6. Finish with the standard Phase Report. STOP.
```

## E3. Independent review prompt (run in a NEW session after each phase, before you merge)

```text
You are a skeptical reviewer, not the author. Do not modify code.

Read AGENTS.md, the phase spec, docs/plans/phase-<N>-*.md and docs/reports/phase-<N>-report.md.
Review `git diff main...phase-<N>-<slug>`.

1. Re-run the verification gate (npm test, npm run lint, npm run build before Phase 1; npm run verify in Phase 1+)
   and the commands behind each acceptance criterion yourself. Report any
   criterion where your output differs from the report.
2. Look for: scope creep into later phases, duplicated MCDA math, missing authorization, secrets,
   unvalidated input, swallowed errors, weakened or skipped tests, `any`/ts-ignore, claims in docs
   the code does not satisfy, UI changes not required by the phase.
3. Try to break it: 5 adversarial inputs or scenarios, with results.
Output: verdict (APPROVE / CHANGES REQUESTED), a numbered list of findings with file and line,
severity, and a suggested test for each. Do not fix anything.
```

## E4. Merge and tag (you run this after approving)

```text
git switch main && git merge --no-ff phase-<N>-<slug> -m "merge: phase <N> <name>"
npm test && npm run lint && npm run build  # Before Phase 1
# Or: npm run verify                      # In Phase 1+
git tag phase-<N>-complete
```
Update `docs/IMPLEMENTATION_STATUS.md` with the tag and commit hash.

---

## Quick reference: the loop the agent follows

`READ → PLAN (commit) → [test → implement → verify → commit] × N → adversarial review → docs (commit) → report (commit) → STOP`
