# Decision OS - Consolidated Development Guidelines & Engineering Protocols

> **Document Status**: Authoritative  
> **Applicability**: All engineers, contributors, and AI coding agents  
> **Consolidation Sources**: `AGENTS.md`, `docs/ENGINEERING_PROTOCOL.md`, `docs/PRODUCT_RULES.md`, `docs/PRODUCT_CONTEXT.md`, `DECISIONS.md`, `Decision_OS_Antigravity_Prompt_Pack_v2.md`, `docs/BUILD_PLAN.md`, `docs/IMPLEMENTATION_STATUS.md`.

---

## 1. Product Context & Core Vision

### 1.1 Tagline & Positioning
> **"Make decisions you can explain."**

Decision OS transforms subjective, multi-variable dilemmas into structured, deterministic Multi-Criteria Decision Analysis (MCDA) models with live sensitivity analysis and defensible decision briefings.

### 1.2 Target Personas
- **Professionals & Leaders**: Evaluating competing job offers, compensation packages, and team expansions.
- **Founders & Executives**: Evaluating company relocation, capital allocation, and strategic partnerships.
- **Engineering Leaders & CTOs**: Selecting foundational tech stacks, cloud providers, and architectural paradigms.

### 1.3 The Core Problem Space
When evaluated without structure, decision makers suffer from four cognitive failure modes:
1. **Intuitive Bias & Single-Metric Anchoring**: Fixating on easily quantifiable metrics (e.g., base salary) while ignoring promotional velocity or culture.
2. **Analysis Paralysis & Scattered Notes**: Fragmented notes and pros/cons lists leading to stalled action.
3. **Black-Box AI Fallacy**: Generic LLMs hallucinate subjective weights, lack deterministic reproducibility, and strip away user agency.
4. **Stakeholder Communication Breakdown**: Inability to defend decisions mathematically to peers, boards, or managers.

---

## 2. Source of Truth & Hierarchy of Authority

When implementing features, refactoring, or resolving ambiguities, follow this strict descending order of precedence:

1. **Explicit Phase Specification / User Instruction**
2. **Canonical Engine Specification (`CANONICAL_DECISION_ENGINE_V1_SPEC.md`)**: The sole mathematical authority for Decision Engine v1 formulas, tie-breaking, normalization, and golden fixtures.
3. **Architecture Specification (`ARCHITECTURE_SPECIFICATION.md`)**: The authoritative definition of database topologies, leases, outbox patterns, and concurrency guards.
4. **Product Specification (`PROJECT_SPECIFICATION.md`)** and **Product Rules** (Section 3 below).
5. **Engineering Protocols & Quality Contracts** (Section 4 below).
6. **Existing Tests and Fixtures** (including locked Phase 0 baselines F1–F3 and golden fixtures G1–G10).
7. **Existing Implementation Code**.

> [!IMPORTANT]
> The finalized `CANONICAL_DECISION_ENGINE_V1_SPEC.md` is the only authority for Decision Engine v1 mathematics and behavior. If any conflict arises, **STOP** and report the conflict. Never pick silently.

---

## 3. Product & Mathematical Rules (Non-Negotiables)

1. **Sole Mathematical Authority**: `CANONICAL_DECISION_ENGINE_V1_SPEC.md` governs all calculations.
2. **User Agency**: The best decision depends on what matters to the decision maker. Never prescribe what "should" matter.
3. **Utility Bounded**: Every option score represents utility in $[0.0, 100.0]$. Higher is always better.
4. **Benefit Criteria Only**: Engine v1 supports benefit criteria only. Cost dimensions must be normalized upstream.
5. **Weight Normalization**: All criteria weights are non-negative and normalized to strictly sum to $100.0\%$ via Hare-Niemeyer Largest Remainder method.
6. **Locked Criteria**: User-locked criteria weights are immutable constraints and must be strictly preserved during normalization.
7. **Rank vs Presentation**: Decision rank is mathematically distinct from presentation order.
8. **Genuine Ties**: Ties ($|\Delta| < 10^{-9}$) produce shared ranks, `isTie: true`, and `winnerId: null`. A winner is never silently chosen.
9. **No Silent Fallbacks**: Missing scores invalidate evaluation; silent default fallbacks are strictly prohibited.
10. **Closed-Form Sensitivity**: Sensitivity tipping points are calculated in closed analytical form respecting locked constraints.
11. **Deterministic PRNG**: Monte Carlo evaluates options using Mulberry32 seeded PRNG and Box-Muller Gaussian perturbations.
12. **Precise Terminology**: Monte Carlo output is strictly "win probability under the specified uncertainty model", never "accuracy" or "accuracy percentage".
13. **Immutability of History**: Preserved historical decisions are immutable and never silently recalculated.
14. **No LLM Math**: No LLM ever calculates or alters authoritative calculations. AI output is schema-validated and advisory only.
15. **Backend Authority**: Backend is authoritative once it exists. Never trust client-supplied winner, score, ranking, normalized weights, or sensitivity calculations.
16. **Metadata Attribution**: Every authoritative result records the engine version, seed, inputs used, and evaluation timestamp.
17. **Test Fixture Protection**: Golden fixtures G1–G10 are read-only and strictly protected. Tests cannot be weakened or deleted.

---

## 4. Engineering Protocols & Verification Gates

### 4.1 Verification Gate Sequence
The repository-level verification gate is:
```bash
npm run verify
```
This runs:
1. Typecheck (`tsc --noEmit`) across all workspaces
2. Linter (`eslint`) across all workspaces
3. Unit + Integration tests (`vitest run`) across all workspaces
4. Production build (`npm run build`) across all workspaces

> [!NOTE]
> Every checkpoint and commit must execute and pass `npm run verify` with exit code 0.

### 4.2 Branching and Git Conventions
- **Feature Branches**: `git switch -c <branch-name>` from latest main. Always ensure clean working tree first.
- **Commit Cadence**: Commit whenever one logical unit is complete and `npm run verify` is green:
  - Plan document
  - Test scaffolding / failing tests (`test:` commit)
  - Module/endpoint implementation with passing tests (`feat:` or `fix:`)
  - Refactoring without behavior changes (`refactor:`)
  - Documentation updates (`docs:`)
- **Size Rule**: $\le 400$ changed lines per commit where practical. Never mix refactor and feature.
- **Commit Message Format (Conventional Commits)**:
  ```text
  type(scope): imperative summary (<= 72 chars)

  Why: one or two lines of reason
  Verified: verification gate green (or exact command output)
  ```
- **Allowed Types**: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`, `build`, `ci`.

### 4.3 Git Hooks
Enable pre-commit hooks via:
```bash
git config core.hooksPath .githooks
```
`.githooks/pre-commit` enforces typecheck and linting before git commit.

### 4.4 Evidence-Based Reporting Rule
For every acceptance criterion, verification requires raw command execution output (or specific test suite names). "Looks correct" or claims by inspection are not valid evidence.

### 4.5 Mandatory Adversarial Self-Review
Before finalizing any implementation, review the git diff (`git diff main...HEAD`) with adversarial scrutiny:
- What input breaks this? (empty arrays, boundary extremes, negative numbers, NaN, unicode, duplicate IDs)
- What happens on failure paths? (Database disconnect, JSON parse failure, timeout, split-brain)
- Is any math duplicated outside `packages/decision-engine`?
- Are secrets or environment credentials exposed?
- Are authorization checks (IDOR, role, tenant) enforced on all routes?

---

## 5. Architectural & Design Trade-offs

From `DECISIONS.md`, the key rationale governing the project:

### Trade-Off 1: Proportional Normalization vs Independent Free-Floating Sliders
- *Decision*: When adjusting criterion $k$, remaining criteria adjust proportionally to maintain $\sum w_i = 100\%$, while respecting locked criteria.
- *Rationale*: Independent sliders allow invalid states ($>100\%$ or $<100\%$) requiring confusing multi-step adjustments. Proportional normalization enforces economic reality: increasing one priority inherently de-prioritizes others.

### Trade-Off 2: Synchronous Pure-TypeScript Engine vs Backend-Only Calculations
- *Decision*: The core linear algebra MCDA math lives in `packages/decision-engine` in pure TypeScript with zero runtime dependencies.
- *Rationale*: Allows sub-millisecond execution for 60fps slider interactions on the frontend, while the exact same compiled package runs authoritatively on Fastify backend routes without formula duplication.

### Trade-Off 3: Explicit Tipping Point Calculation vs Discrete Interpolation
- *Decision*: Tipping points are calculated analytically via closed-form linear algebra rather than grid-stepping approximations.
- *Rationale*: Analytical calculation yields exact floating-point tipping thresholds in $O(n)$ time with zero rounding bias.

---

## 6. Phase Roadmap & Implementation Status

The project architecture has executed through 15 foundational phases and 4 comprehensive production-readiness batches:

| Phase / Batch | Scope | Status | Key Deliverable |
|:---|:---|:---:|:---|
| **Phase 0** | Baseline Audit & Verification Gate | **Locked** | Characterization baselines F1–F3 (`PHASE_0_REPORT.md`) |
| **Phase 1** | Backend Foundation & Monorepo Setup | **Complete** | Monorepo layout, Fastify API, `packages/decision-engine` |
| **Phase 2** | MongoDB Persistence Layer | **Complete** | Mongoose schemas, Decision models, connection pooling |
| **Phase 3** | Decision API & Server MCDA | **Complete** | REST endpoints for decision lifecycle & authoritative evaluation |
| **Phase 4** | Frontend Integration | **Complete** | React UI connected to backend API client |
| **Phase 5** | Authentication, Ownership & RBAC | **Complete** | JWT auth, bcrypt passwords, resource ownership guards |
| **Phase 6** | Sharing & Invitations | **Complete** | Token-based invite links, viewer/editor permissions |
| **Phase 7** | Expert Contributions | **Complete** | Structured collaborator score & weight submissions |
| **Phase 8** | Evidence & Provenance | **Complete** | Citation URLs, provenance tracking, attachment metadata |
| **Phase 9** | AI Decision Analyst | **Complete** | Advisory LLM integration with strict MCDA engine isolation |
| **Phase 10** | Advanced Analytics & Counterfactuals | **Complete** | Portfolio analytics, what-if counterfactual scoring |
| **Phase 11** | Disagreement Intelligence | **Complete** | Variance dispersion calculus, consensus scoring |
| **Phase 12** | Expert Calibration | **Complete** | Brier score calculation, prediction tracking |
| **Phase 13** | Immutable Audit Trail & Export | **Complete** | Cryptographic hash chaining, Merkle roots, PDF/JSON export |
| **Phase 14** | Real-Time Collaboration | **Complete** | Server-Sent Events (SSE), presence tracking, optimistic locking |
| **Phase 15** | Performance Optimization & Scale | **Complete** | Caching, compression, typed arrays, load benchmarks |
| **Batch 1** | Production Auth & Security Remediation | **Audited** | Auth hardening, token refresh, security audits |
| **Batch 2** | Authenticated Dashboard & Lifecycle | **Audited** | Decision dashboard, persistence, audit remediation |
| **Batch 3** | Dynamic Criteria & Alternatives | **Audited** | Dynamic entity mutation, validation matrices |
| **Batch 4** | Deliberation, Outbox & Concurrency | **v1.3 Certified** | Tiered dual-topology, lease fencing, failure recovery matrix |

---

## 7. AI Agent Prompts & Operational Workflows

For AI coding agents working on Decision OS, follow the standardized workflow prompts below:

### 7.1 Orientation Prompt
When starting a session or resuming work, run a read-only orientation check:
```text
Inspect the repository:
1. Run git status and git log -n 5 --oneline
2. Review CANONICAL_DECISION_ENGINE_V1_SPEC.md and ARCHITECTURE_SPECIFICATION.md
3. Confirm clean working tree and active branch
4. Read DEVELOPMENT_GUIDELINES.md before modifying any files
```

### 7.2 Phase / Batch Execution Prompt
When executing an assigned phase or batch:
```text
1. Read the phase specification and governing architecture documents.
2. Verify existing tests pass before touching code.
3. Write or update tests alongside implementation.
4. Run npm run verify to confirm all workspaces pass typecheck, lint, and test.
5. Perform an adversarial review of your git diff.
6. Commit changes using Conventional Commits with verification evidence.
```

### 7.3 Bugfix & Remediation Prompt
When resolving an audit finding or bug:
```text
1. Formulate a failing test replicating the bug/finding.
2. Inspect the atomicity boundary and governing invariant.
3. Apply the minimal correct fix without altering external contracts or weakening existing tests.
4. Verify tests pass and commit with type fix(<scope>): ...
```
