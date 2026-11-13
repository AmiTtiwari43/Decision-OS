# Decision OS — Batch 03.2: AI Advisory and Explainable Ranking Audit & Closure Report

> **Document Status**: Complete & Verified  
> **Batch**: Batch 03.2 (AI Advisory and Explainable Ranking)  
> **Repository Branch**: `fix/batch4-replica-set-transactional-recovery`  
> **Date**: 2026-11-13  
> **Environment**: Monorepo (`@decision-os/api`, `@decision-os/web`, `@decision-os/decision-engine`) on Node.js / TypeScript.

---

## 1. Executive Summary

Batch 03.2 delivers an evidence-aware, explainable **AI Advisory Subsystem** that provides rich, contextual decision intelligence without compromising the sole mathematical authority of the canonical MCDA engine.

Key architectural achievements in this batch:
1. **Mathematical Authority Preserved**: The canonical MCDA engine remains the sole mathematical authority for utility scores, rankings, weights, and sensitivity tipping points. No LLM ever calculates alternative scores or changes weights silently.
2. **Deterministic Recommendation Prioritization**: Built the **Multi-Factor Deterministic Advisory Ranking (MDAR v1)** service (`apps/api/src/services/ai/suggestion-ranking.service.ts`), which transparently scores and orders advisory proposals using criterion relevance, verified empirical grounding, sensitivity tipping points, heuristic confidence, and missing information deductions.
3. **Comprehensive Explainability**: Every suggestion exposes its rank, priority score, transparent methodology formula, score breakdown, influencing criteria, supporting empirical evidence, assumptions made, missing information, what could change the recommendation, and potential limitations.
4. **Human Authority Boundaries**: AI suggestions are strictly advisory (`isAiGenerated: true`). Incorporating a proposal (adding a suggested criterion or alternative option) requires an explicit, authenticated user action (`POST /decisions/:id/ai/proposals/apply`). Viewers and contributors are blocked with `HTTP 403 Forbidden`; only owners and editors can mutate the model.
5. **End-to-End Resilience**: Tested for provider offline (503), timeout (504), schema retry failure (502), empty suggestions, duplicate proposals, malformed evidence, and unsupported decision contexts.
6. **Frontend Integration**: Updated `AiAnalystModal.tsx` with a dedicated **Ranked Advice** tab, collapsible explainability cards, interactive proposal adoption for both criteria and options, risk matrices, and transparent disclaimers.

---

## 2. Component Implementation & Verification Matrix

| System Component | Prior State | Remediated State in Batch 03.2 | Verification Suite |
| :--- | :--- | :--- | :--- |
| **`apps/api/src/models/ai.types.ts`** | Lacked alternative options, expert recommendations, and ranked suggestions. | Added `AiAlternativeProposal`, `AiExpertRecommendation`, `AiRiskItem`, `AiSuggestionScoreBreakdown`, `AiRankedSuggestion`, and `ApplyProposalOptionInput`. | `tsc --noEmit`<br>`aiAdvisoryRanking.test.ts` |
| **`apps/api/src/models/ai.schema.ts`** | Only supported `add_criterion` proposals and basic output fields. | Added Zod validation for `suggestedAlternatives`, `expertRecommendations`, `tradeoffAnalysis.risks`, `rankedSuggestions`, and discriminated union for `applyProposalSchema`. | `aiAdvisoryRanking.test.ts` |
| **`apps/api/src/services/ai/suggestion-ranking.service.ts`** | Did not exist. Recommendations were unranked or heuristic text. | NEW: Implemented MDAR v1 deterministic scoring, tie-breaking, and complete explainability generation. | `aiAdvisoryRanking.test.ts` (16/16 tests pass) |
| **`apps/api/src/services/ai/ai.service.ts`** | Only parsed raw LLM JSON; lacked option proposals. | Integrated deterministic suggestion ranking pass; added `add_option` proposal handler with stale analysis invalidation and audit logging. | `ai.test.ts` (25/25)<br>`aiAdvisoryRanking.test.ts` (16/16) |
| **`apps/api/src/services/ai/providers/mock.provider.ts`** | Returned basic criteria proposals only. | Enriched with alternative options, expert recommendations, risk items, and adversarial triggers (`__TEST_TRIGGER_EMPTY_SUGGESTIONS__`, etc.). | `aiAdvisoryRanking.test.ts` |
| **`apps/web/src/api/types.ts`** | Mirrored legacy AI output without ranking metadata. | Mirrored all new proposal types, ranked suggestions, score breakdown, and explainability fields. | `tsc -b` (0 errors) |
| **`apps/web/src/components/AiAnalystModal.tsx`** | Lacked ranked suggestions tab, explainability breakdown, and alternative option adoption. | Added Ranked Advice tab, rank pills, category badges, expandable explainability drawers, and `handleAdoptOption` workflow. | `aiAdvisoryModal.test.tsx` (6/6 tests pass) |
| **`apps/web/src/components/ShowcaseSection.tsx`** | AI tab had static callouts without ranked suggestions. | Added explainable recommendation ranking showcase card (MDAR v1) with Rule #14 guarantee. | `batch03Showcase.test.tsx` (10/10 tests pass) |
| **`docs/AI_ADVISORY_EXPLAINABLE_RANKING.md`** | Did not exist. | NEW: Complete architectural specification documenting advisory vs authoritative distinction, MDAR v1 math, and authorization guardrails. | Verified Documentation |

---

## 3. Test Suite Verification Results

### 3.1 Backend Test Suites (`apps/api`)
```
 RUN  v4.1.12 apps/api

 ✓ tests/aiAdvisoryRanking.test.ts (16 tests) 40579ms
     ✓ generates structured advisory suggestions with explainable ranking metadata
     ✓ identifies missing evidence and links to empirical gaps
     ✓ produces identical scores and ranking order across 50 consecutive runs on identical inputs
     ✓ breaks ties deterministically by evidence count, low missing info, and alphabetical id
     ✓ increases evidence grounding factor when verified empirical evidence matches proposal target
     ✓ handles empty suggestions gracefully without throwing
     ✓ deduplicates duplicate proposal IDs deterministically
     ✓ safely handles malformed evidence objects with undefined or null fields
     ✓ handles unsupported decision context (0 criteria, 0 options) without crashing
     ✓ verifies AI analysis never mutates authoritative decision criteria, weights, or scores
     ✓ blocks viewers from applying an alternative option proposal with 403 Forbidden
     ✓ blocks contributors from applying an alternative option proposal with 403 Forbidden
     ✓ allows decision editor to explicitly adopt an alternative option proposal
     ✓ allows decision owner to explicitly adopt an alternative option proposal
     ✓ rejects duplicate option IDs with 400 Bad Request
     ✓ blocks unrelated users from applying proposals with 404 Not Found enumeration defense

 ✓ tests/ai.test.ts (25 tests) 81020ms
     ✓ rejects unauthenticated requests to AI analyze endpoint with 401
     ✓ rejects unrelated users with 404 Not Found (enumeration defense)
     ✓ allows read-only viewer to request advisory AI analysis
     ✓ allows contributor, editor, and owner to request AI analysis
     ✓ filters context so unsubmitted drafts of other contributors are NEVER fed into AI prompt
     ✓ includes a contributor own draft in their own AI analysis context
     ✓ safely handles provider timeout (504 Gateway Timeout)
     ✓ safely handles provider unavailable configuration (503 Service Unavailable)
     ✓ safely handles provider rate limits (429 Too Many Requests)
     ✓ handles invalid non-JSON output with bounded retry, failing with 502 Bad Gateway if still invalid
     ✓ handles schema violation output with bounded retry, succeeding if retry satisfies schema
     ✓ neutralizes prompt injection attempts embedded in decision description or evidence
     ✓ guarantees that AI analysis does NOT mutate authoritative MCDA inputs, scores, or rankings
     ✓ blocks viewers from applying criterion proposals with 403 Forbidden
     ✓ blocks contributors from applying criterion proposals with 403 Forbidden
     ✓ allows editor to explicitly apply a suggested criterion proposal
     ✓ allows owner to explicitly apply a suggested criterion proposal
     ✓ rejects applying duplicate criterion IDs with 400 Bad Request
     ✓ rejects invalid or malformed proposal payloads with 400 Bad Request
     ✓ rejects invalid decision IDs with 400 Bad Request
     ✓ guarantees response transparency metadata (isAiGenerated, disclaimer, provider, model)
     ✓ neutralizes prompt injection embedded inside expert contribution rationale
     ✓ rejects oversized input payloads with 400 Bad Request
     ✓ verifies secrets, tokens, password hashes, and database URIs are never exposed in AI responses
     ✓ safely handles adversarial HTML and script tags in context without corruption

 Total Backend AI Tests: 41 passed (41/41)
```

### 3.2 Frontend Test Suites (`apps/web`)
```
 RUN  v4.1.12 apps/web

 Test Files  24 passed (24)
      Tests  253 passed (253)
   Duration  14.66s
```

### 3.3 Quality Gates & Build
- **Backend Typecheck (`npm run typecheck` in `apps/api`)**: Passed with 0 errors.
- **Frontend Typecheck (`npm run typecheck` in `apps/web`)**: Passed with 0 errors.
- **Backend Build (`npm run build` in `apps/api`)**: Passed (`tsc` succeeded).
- **Frontend Build (`npm run build` in `apps/web`)**: Passed (`vite build` succeeded in 3.45s).
