# DECISION OS — BATCH 3: DYNAMIC CRITERIA & ALTERNATIVES MANAGEMENT
## Formal Implementation Plan

**Workspace:** Decision OS Monorepo (`apps/api`, `apps/web`, `packages/decision-engine`)  
**Phase:** Batch 3 — Dynamic Criteria & Alternatives Management  
**Authority:** `CANONICAL_DECISION_ENGINE_V1_SPEC.md`, `AGENTS.md`  
**Status:** In Progress — Pre-Implementation Gate  

---

### 1. Executive Summary & Objectives

Batch 1 (Authentication & Authorization) and Batch 2 (Dashboard & Decision Hub) established secure user sessions, tenant isolation, and portfolio management with an independent audit rating of **A — PASS**.

Batch 3 transitions Decision OS from a template-demonstration workspace into a fully functional, user-defined Multi-Criteria Decision Analysis (MCDA) builder. Users will be able to:
1. Dynamically create, edit, rename, and remove alternatives (options) with unique identifiers and validation.
2. Dynamically create, edit, rename, and remove evaluation criteria (benefit-only per specification v1.0).
3. Calibrate criteria weights using the canonical Hare-Niemeyer (Largest Remainder) normalization algorithm with locked constraints and deterministic ASCII ID tie-breaking.
4. Enter and edit utility scores ($[0.0, 100.0]$) in a strict criteria-by-alternative scoring matrix ($1\text{ row per criterion} \times 1\text{ column per alternative}$), strictly rejecting missing scores and preventing silent zero imputation.
5. Execute explicit authoritative backend calculations (`POST /api/decisions/:id/analyze`) powered solely by `@decision-os/decision-engine` v1.0.0.
6. Enforce explicit stale-evaluation detection and invalidation so outdated winners are never presented as current authoritative results.
7. Support optimistic concurrency (`expectedVersion`), atomic persistence, and conflict recovery.

---

### 2. Architecture & Data Flow

```mermaid
flowchart TD
    subgraph Frontend["apps/web"]
        UI[Interactive Workspace Modal]
        AM[Alternatives Manager]
        CM[Criteria Manager]
        WM[Weight Configurator & Sliders]
        SM[Scoring Matrix (Rows: Criteria, Cols: Alternatives)]
        Hook[useDecisionModel Hook]
        StatusUtil[decisionStatus.ts Engine Status]
        APIClient[DecisionApiClient]
    end

    subgraph Backend["apps/api"]
        DecRoutes[Decision Routes /decisions]
        DecService[Decision Service]
        AuthService[Authorization Service]
        DecRepo[Decision Repository]
    end

    subgraph Engine["packages/decision-engine"]
        CanonicalEngine[evaluateDecision / normalizeWeights]
        GoldenFixtures[(G1-G10 Read-Only)]
    end

    subgraph Database[(MongoDB)]
        DecisionsColl[decisions Collection]
        AuditColl[audit_events Collection]
    end

    AM -->|add/edit/remove option| Hook
    CM -->|add/edit/remove criterion| Hook
    WM -->|adjust weights / lock| Hook
    SM -->|enter scores [0..100]| Hook
    Hook -->|normalizeWeights preview| CanonicalEngine
    Hook -->|set isDirty = true| StatusUtil
    UI -->|Run Authoritative Calculation| Hook

    Hook -->|PUT /api/decisions/:id with expectedVersion| APIClient
    Hook -->|POST /api/decisions/:id/analyze| APIClient
    APIClient --> DecRoutes
    DecRoutes --> DecService
    DecService --> AuthService
    DecService -->|Run Canonical Engine| CanonicalEngine
    DecService --> DecRepo
    DecRepo --> DecisionsColl
    DecService --> AuditColl
    DecRoutes -->|authoritative EngineResult| APIClient
    APIClient -->|update serverDecision, isDirty=false| Hook
```

---

### 3. Component & Phase Breakdown

#### Phase 1: Alternatives Management
- **Hook State (`useDecisionModel.ts`)**:
  - `addAlternative(name, tagline?, description?, color?)`:
    - Generates stable unique ID `opt-${Date.now()}-${random}`.
    - Validates non-empty name (trimmed) and detects duplicate names across active options.
    - Adds option to `dataset.options`, activates ID in `activeOptionIds`.
    - Initializes empty score entries in `scores[optionId] = {}`.
    - Sets `isDirty = true` and marks any previous evaluation as stale.
  - `renameAlternative(optionId, newName)`:
    - Validates non-empty, checks duplicate names, updates option in place, sets `isDirty = true`.
  - `updateAlternative(optionId, updates)`:
    - Updates name, tagline, description, color. Sets `isDirty = true`.
  - `removeAlternative(optionId)`:
    - Verifies permissions (owner or editor; rejected for viewer).
    - Removes option from `dataset.options` and `activeOptionIds`.
    - Removes corresponding scores from all criteria.
    - Sets `isDirty = true` and invalidates previous calculation.
- **UI (`AlternativesManager.tsx`)**:
  - Clean card/pill list of all alternatives with color swatches and taglines.
  - Inline / modal creation form with real-time validation and duplicate warnings.
  - Inline renaming and metadata editor.
  - Confirmation dialog before destructive removal.
  - Permission-aware: editing controls disabled in viewer mode.

#### Phase 2: Criteria Management
- **Hook State (`useDecisionModel.ts`)**:
  - `addCriterion(name, category?, weight?, shortName?, description?)`:
    - Generates stable unique ID `crit-${Date.now()}-${random}`.
    - Validates non-empty name and detects duplicate criterion names.
    - Direction strictly fixed to `'benefit'` (per specification Section 5.1).
    - Computes initial raw weight, appends to `dataset.criteria`.
    - Normalizes weights via canonical `normalizeWeights`.
    - Sets `isDirty = true` and invalidates previous calculation.
  - `renameCriterion(criterionId, newName)`:
    - Validates non-empty, updates name, sets `isDirty = true`.
  - `updateCriterion(criterionId, updates)`:
    - Updates name, shortName, description, category. Sets `isDirty = true`.
  - `removeCriterion(criterionId)`:
    - Verifies permissions.
    - Removes criterion from `dataset.criteria`.
    - Cleans up scores across all options for this criterion.
    - Removes criterion from `lockedIds` if locked.
    - Re-normalizes remaining criteria weights via canonical engine.
    - Sets `isDirty = true` and invalidates previous calculation.
  - `toggleLock(criterionId)`:
    - Locks/unlocks criterion.
    - Checks that sum of locked weights does not exceed 100%.
    - Re-normalizes unlocked criteria using remaining weight target.
- **UI (`CriteriaManager.tsx`)**:
  - List of criteria with categories, names, current weights, and lock badges.
  - Inline add and edit forms with validation.
  - Confirmation dialog before removing a criterion.
  - Benefit-only indicator (no cost direction option in v1.0).

#### Phase 3: Weight Management
- **Canonical Normalization**:
  - Direct invocation of `normalizeWeights` from `@decision-os/decision-engine`.
  - Input weights $r_i \ge 0.0$.
  - Largest Remainder Method (Hare-Niemeyer):
    - Locked weights allocated first up to 1 decimal place.
    - Remaining $100.0 - \sum w_{\text{locked}}$ distributed proportionally or equally.
    - Residual discrepancy $K$ distributed by descending remainder, with ties broken by criterion ID ascending ASCII.
    - Normalized weights sum strictly to $100.0\%$.
- **UI & Controls (`WeightSlider.tsx` / Weight Editor)**:
  - Interactive slider + numeric input with 0.1% display.
  - Visual lock toggle button per criterion.
  - Total allocation progress bar (100.0% verified indicator).
  - Explicit notification if all criteria locked or locked sum reaches 100%.

#### Phase 4: Score Matrix
- **Matrix Layout**:
  - **One row per criterion.**
  - **One column per alternative.**
  - Criterion header shows name, category, and normalized weight percentage.
  - Alternative header shows name, color indicator, and tagline.
- **Score Cell Rules**:
  - Value range: $[0.0, 100.0]$, finite numbers only.
  - Empty cells explicitly represented as `undefined` (missing), never silently coerced to 0.
  - Missing cells visually distinct: dashed amber border, "—" placeholder, missing badge.
  - Invalid cells (<0, >100, NaN): red border, error tooltip.
  - Valid cells: clean font-mono score.
- **Accessibility & Keyboard Navigation**:
  - Tab / Shift-Tab sequence across cells.
  - Arrow key navigation (Up, Down, Left, Right) between matrix cells.
  - Cell aria-labels specifying criterion and alternative names.
- **Incomplete Data Counter**:
  - Header badge: e.g. "Score Completeness: 12 / 12 (100%)" or "Score Completeness: 10 / 12 (2 missing)".

#### Phase 5: Authoritative Calculation
- **Trigger**: "Run Authoritative Calculation" button.
- **Workflow**:
  1. Frontend validation:
     - Minimum 1 criterion and 1 alternative (recommended $\ge 2$ alternatives).
     - Check for missing scores. If any cell is missing, block calculation and highlight incomplete cells.
  2. Persistence gate:
     - Save current decision to MongoDB (`PUT /api/decisions/:id` with `expectedVersion` or `POST /api/decisions` if new).
  3. Execution:
     - Call `apiClient.analyzeDecision(decisionId)`.
     - Loading indicator: "Running Authoritative MCDA Calculation...".
  4. Authoritative Result Display:
     - Canonical Engine Version (`1.0.0`), `evaluatedAt`, `inputHash`, `calculationHash`.
     - Decisive Outcome: Unique Winner with point lead and percentage score.
     - Mathematical Tie Outcome: Tie banner listing all tied alternative names, epsilon ($10^{-9}$) note.
     - Full rankings table with dual-precision (unrounded score for ranking, one-decimal for display).
     - Sensitivity Tipping Points: showing minimum weight shift required to alter the winner.
     - `isAuthoritative` flagged true, `isDirty` cleared to false.

#### Phase 6: Stale Evaluation Handling
- **State Invalidation**:
  - Any user edit to alternatives, criteria, weights, or scores sets `isDirty = true`.
  - When `isDirty = true`, previous evaluation results are marked stale.
  - Outdated winner is removed from header/card and replaced with:
    `Recalculation Required — Inputs have been modified.`
  - `decisionStatus.ts` returns `'stale'` when options count, option IDs, criteria count, or criteria IDs deviate from `serverDecision.analysis`.
  - Updated `DecisionCard.tsx` displays "Evaluation Stale · Recalculation Required".
  - Recalculation restores `'decisive'` or `'tie'` authoritative state.

#### Phase 7: Persistence & Concurrency
- **Concurrency Control**:
  - `expectedVersion` sent on `updateDecision`.
  - Backend checks `expectedVersion === currentVersion`, throwing 409 Conflict (`DecisionConflictError`) if outdated.
  - Frontend intercepts 409 and prompts user to reload the fresh version, preventing silent overwrites.
  - In-flight guards (`saveStatus === 'in_flight'` and sequential request IDs) prevent duplicate concurrent submissions.
- **Error Resilience**:
  - Network timeouts (15s) and offline failures caught gracefully without resetting local user input.
  - Retry button available on error banners.

---

### 4. Implementation Schedule & Verification Steps

| Step | Scope | Target Files | Verification Method |
|------|-------|--------------|---------------------|
| **Step 1** | Plan & Core Hooks | `BATCH_3_IMPLEMENTATION_PLAN.md`, `apps/web/src/hooks/useDecisionModel.ts` | Unit tests for hook alternatives & criteria CRUD |
| **Step 2** | Canonical Weight Normalization | `apps/web/src/hooks/useDecisionModel.ts` | Test against Golden G3, G4, G5 tie-breaks |
| **Step 3** | Score Matrix (Rows: Criteria, Cols: Alternatives) | `apps/web/src/components/ScoreMatrix.tsx` | Visual inspection & keyboard navigation tests |
| **Step 4** | Alternatives & Criteria Management UI | `apps/web/src/components/AlternativesManager.tsx`, `apps/web/src/components/CriteriaManager.tsx` | Interactive modal tests for add/edit/delete/confirm |
| **Step 5** | Authoritative Calculation Workflow | `apps/web/src/components/InteractiveModal.tsx`, `apps/web/src/hooks/useDecisionModel.ts` | Integration test calling `analyzeDecision` with real backend |
| **Step 6** | Stale Evaluation & Status Sync | `apps/web/src/utils/decisionStatus.ts`, `apps/web/src/components/DecisionCard.tsx` | Status tests verifying stale flag on mutations |
| **Step 7** | Concurrency & Conflict Handling | `apps/web/src/hooks/useDecisionModel.ts`, `apps/web/src/components/InteractiveModal.tsx` | Concurrency conflict test (409 handling) |
| **Step 8** | Comprehensive Test Suite (20 Tests) | `apps/web/src/tests/batch3Integration.test.ts` | Full suite execution (all 20 test cases passing) |
| **Step 9** | Full Monorepo Verification | Monorepo root | `npm run verify` + lifecycle audit script |
| **Step 10** | Final Report | `BATCH_3_IMPLEMENTATION_REPORT.md` | Final documentation and sign-off |

---

### 5. Invariant & Boundary Guarantees
- **No Client Math Authority**: Frontend never claims to be the authoritative evaluation source; all persisted calculations come from the backend.
- **Golden Fixtures Protected**: Fixtures G1–G10 in `golden.json` are read-only and immutable.
- **Benefit-Only Criteria**: Direction is hardcoded to `'benefit'` in Engine v1.0.
- **No Silent Zero Coercion**: Missing scores remain strictly incomplete until explicitly provided.
- **Permission Enforcement**: Viewers cannot mutate options, criteria, weights, or trigger analysis.

