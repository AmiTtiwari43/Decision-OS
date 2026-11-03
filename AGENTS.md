# Decision OS - Agent Rules

You are the software engineering agent for Decision OS, a transparent decision-support platform.
Tagline: **"Make decisions you can explain."**

All comprehensive engineering rules, protocols, prompt packs, and mathematical constraints have been consolidated into **[`DEVELOPMENT_GUIDELINES.md`](./DEVELOPMENT_GUIDELINES.md)**. You must read and strictly adhere to them.

---

## 1. Hierarchy of Authority (Highest First)
1. Current phase / batch task specification + explicit user instruction
2. Canonical engine specification: **[`CANONICAL_DECISION_ENGINE_V1_SPEC.md`](./CANONICAL_DECISION_ENGINE_V1_SPEC.md)**
3. Consolidated development guidelines: **[`DEVELOPMENT_GUIDELINES.md`](./DEVELOPMENT_GUIDELINES.md)**
4. Consolidated architecture & concurrency specification: **[`ARCHITECTURE_SPECIFICATION.md`](./ARCHITECTURE_SPECIFICATION.md)**
5. Product specification: **[`PROJECT_SPECIFICATION.md`](./PROJECT_SPECIFICATION.md)**
6. Historical audits & locked characterization baselines: **[`AUDIT_AND_REMEDIATION_HISTORY.md`](./AUDIT_AND_REMEDIATION_HISTORY.md)**
7. Existing tests and golden fixtures (G1–G10)
8. Existing implementation

> [!IMPORTANT]
> `CANONICAL_DECISION_ENGINE_V1_SPEC.md` is the sole mathematical authority for Decision Engine v1 formulas and behavior. If any conflict arises, STOP and report the conflict immediately.

---

## 2. Core Non-Negotiables
- **Verification Gate**: Every checkpoint and commit must execute and pass `npm run verify` (typecheck + lint + test + build across all workspaces).
- **No LLM Math**: LLMs are advisory only. No LLM ever calculates or alters authoritative calculations.
- **Backend Authority**: Backend validates and computes all authoritative scores, rankings, weights, and sensitivity points.
- **Engine Isolation**: All MCDA math lives exclusively in `packages/decision-engine`. Never duplicate formulas.
- **Protected Fixtures**: Golden fixtures G1–G10 and tests cannot be weakened or deleted.
- **Dual-Topology Guarantees**: Follow the architecture specifications in `ARCHITECTURE_SPECIFICATION.md` for MongoDB Replica Sets (Topology A) and Standalone Outbox (Topology B).
- **Adversarial Self-Review**: Mandatory self-review of your git diff before completing any task.
