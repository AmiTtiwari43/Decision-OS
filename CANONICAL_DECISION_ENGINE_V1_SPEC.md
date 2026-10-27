# Decision OS — Canonical Decision Engine v1 Specification
**Document Status**: Formally Locked Contract  
**Phase**: Pre-Phase 1 Specification & Contract Locking  
**Git Branch**: `engine-v1-spec`  
**Reference Baseline**: `phase-0-complete` (commit `4f8b243`)  

---

## 1. Executive Summary & Purpose

This document constitutes the authoritative, mathematically rigorous specification for **Decision Engine v1** of Decision OS.

Decision OS is a structured, deterministic decision-support workspace built on **Multi-Criteria Decision Analysis (MCDA)**. Its core premise is:
> *"The best decision depends on what matters to you."*

In Phase 0, the existing prototype implementation was audited, characterized, and locked via baseline tests ($F1, F2, F3$). That characterization captured what the legacy prototype *actually did*, including its edge-case bugs, silent fallbacks, and mathematical approximations.

This specification defines what **Canonical Decision Engine v1** *must do*. Every rule, invariant, formula, and edge-case behavior specified herein is deterministic, testable, and contractually binding for the forthcoming monorepo engine extraction in Phase 1.

---

## 2. Scope & Architectural Boundaries

### 2.1 Role of this Specification
- This document defines the mathematical contract for the core calculation library to be housed in `packages/decision-engine` during Phase 1.
- It resolves all discrepancies and ambiguities identified during the Phase 0 audit.
- It supersedes all informal mathematical descriptions in `README.md`, `DECISIONS.md`, and `FUTURE_BACKEND_ARCHITECTURE.md`.

### 2.2 Boundary Invariants (Phase 0 Lock Preservation)
1. **Zero Production Mutation**: No production application code, UI components, or datasets are altered during this specification phase.
2. **Characterization Reference Integrity**: The Phase 0 regression baselines ($F1, F2, F3$) documented in `PHASE_0_REPORT.md` and tested in `src/utils/characterization.test.ts` remain permanently locked as historical verification references.
3. **Pure Function Contract**: Decision Engine v1 must be implemented as a pure, stateless mathematical library with zero runtime I/O, zero network calls, zero DOM coupling, and zero side effects.

---

## 3. Current Engine Behavior Audit (Legacy Characterization)

Before specifying Engine v1, the current implementation in [src/utils/decisionEngine.ts](file:///c:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/src/utils/decisionEngine.ts), [src/data/decisionData.ts](file:///c:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/src/data/decisionData.ts), and [src/components/MonteCarloTester.tsx](file:///c:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/src/components/MonteCarloTester.tsx) was audited line-by-line. The table below records the actual behavior and its architectural limitations:

| Domain | Current Implementation Behavior | Architectural Limitations / Defects |
| :--- | :--- | :--- |
| **Input Model** | Free-form TypeScript interfaces (`Criterion`, `Option`, `DecisionDataset`). Weights passed as `Record<string, number>`. Scores stored in `option.scores: Record<string, number>`. | No runtime schema validation. No validation on score bounds ($[0, 100]$). No criterion directionality (`benefit` vs `cost`). |
| **Weight Normalization** | Proportional scaling in `normalizeWeights()`. Locked criteria clamped to $[0, 100]$. If locked sum $\ge 100$, locked weights are scaled and unlocked zeroed. | 1. If locked sum $\ge 100$, rounding to 1 decimal can sum to $\neq 100.0\%$ (no correction pass).<br>2. If all criteria are locked and sum $< 100$, returns unnormalized weights.<br>3. Correction pass dumps entire rounding error onto `unlockedCriteria[0]`, creating array-order sensitivity. |
| **Scoring Formula** | $\text{Score} = \text{round}_1\left(\sum \frac{w_i \cdot s_{ij}}{100}\right)$ where $w_i$ are pre-rounded to 1 decimal place. | Floating-point rounding occurs *before* ranking. Contribution percentages use rounded scores. |
| **Ranking & Ties** | Array sorted using JavaScript `Array.prototype.sort((a,b) => b.weightedScore - a.weightedScore)`. | Ranks based on rounded 1-decimal scores. Identical scores fall back to input array order. Ranks assigned strictly as index + 1 (1, 2, 3...) regardless of ties. |
| **Missing Values** | Missing scores silently fallback to `50` via `option.scores[c.id] ?? 50`. | Masked data omissions; artificially inflates or penalizes options without user knowledge. `NaN` scores propagate and destroy scoring. |
| **Sensitivity Analysis** | Evaluates only rank 1 (winner) vs rank 2 (runner-up) via `calculateSensitivity()`. | Completely ignores locked criteria ($L$ scales proportionally). Ignores options ranked 3rd or lower. Arbitrary 95% cap on tipping point. |
| **Tipping Point** | Analytical formula $w_k^* = \frac{100 \Delta R}{\Delta R - \Delta s_k(100 - w_k)}$. Classifies $\le 15\%$ as low, $\le 35\%$ as medium, else unreachable. | Does not handle negative delta direction properly. Fails if locked criteria exist. Fails when $w_k^{\text{current}} = 100\%$. |
| **Monte Carlo** | In `MonteCarloTester.tsx`: 1,000 iterations, uniform random noise `(Math.random() * 2 - 1) * noiseLevel`. | Claimed to be Gaussian in UI/docs, but is uniform. Hardcoded strictly to first 2 options (`options[0]`, `options[1]`). Unseeded, non-deterministic. |

---

## 4. Locked Phase 0 Baselines (Reference Inventory)

The following baseline evaluations are locked as regression verification references for the legacy implementation:

### 4.1 F1 — Job Offer Evaluation (`primaryJobOfferDataset`)
- **Default Weights** (Growth 30%, Comp 25%, Learning 20%, WLB 15%, Stability 10%):
  - **Company Beta**: **82.9 pts** (Winner)
  - **Company Alpha**: **82.0 pts** (Runner-up, $\Delta = -0.9$)
  - **Company Gamma**: **78.5 pts** (Alternative, $\Delta = -4.4$)
- **Scenarios**:
  - `career-first` (40/20/25/10/5): **Alpha = 85.7** | Beta = 80.1 | Gamma = 76.5
  - `balanced` (25/25/20/15/15): **Beta = 84.0** | Alpha = 80.5 | Gamma = 79.2
  - `money-first` (15/45/10/15/15): **Beta = 88.1** | Gamma = 80.0 | Alpha = 75.8
  - `worklife-first` (15/20/15/35/15): **Beta = 85.4** | Gamma = 83.7 | Alpha = 77.7

### 4.2 F2 — City Relocation Matrix (`city-relocation`)
- **Default Weights** (Affordability 30%, Network 25%, Culture 20%, Climate 15%, Walkability 10%):
  - **Lisbon**: **83.2 pts** (Winner)
  - **Austin**: **76.5 pts** (Runner-up, $\Delta = -6.7$)
  - **NYC**: **74.8 pts** (Alternative, $\Delta = -8.4$)
- **Scenarios**:
  - `career-dense` (15/45/20/10/10): **NYC = 84.7** | Lisbon = 79.0 | Austin = 78.2
  - `lifestyle-balance` (35/15/20/20/10): **Lisbon = 85.4** | Austin = 75.5 | NYC = 70.4

### 4.3 F3 — Frontend Architecture Matrix (`frontend-architecture`)
- **Default Weights** (Performance 30%, Dev Velocity 30%, Maintainability 25%, Hiring Pool 15%):
  - **Vite + React + Tailwind**: **91.8 pts** (Winner)
  - **Next.js App Router**: **85.3 pts** (Runner-up, $\Delta = -6.5$)
- **Scenarios**:
  - `velocity-first` (20/45/20/15): **Vite + React = 92.8** | Next.js = 83.7

---

## 5. Canonical Decision Engine v1 Specification

Every rule specified in this section is deterministic, formal, and testable.

```
                    CANONICAL ENGINE v1 PIPELINE
                    
┌────────────────┐      ┌─────────────────────────┐      ┌──────────────────────┐
│  Input Model   │ ───> │ Validation & Rejection  │ ───> │ Weight Normalization │
│ Options, Crits │      │ Strict Schema & Bounds  │      │ Largest Remainder    │
└────────────────┘      └─────────────────────────┘      └──────────────────────┘
                                                                    │
                                                                    ▼
┌────────────────┐      ┌─────────────────────────┐      ┌──────────────────────┐
│ Deterministic  │ <─── │ Multi-Tier Tie Breaking │ <─── │ Exact MCDA Scoring   │
│ Engine Result  │      │ 5-Tier Deterministic    │      │ 64-bit IEEE 754      │
└────────────────┘      └─────────────────────────┘      └──────────────────────┘
        │
        ├───> Sensitivity Calculus (Analytical with Locked Constraints)
        └───> Gaussian Monte Carlo Robustness (Seeded PRNG)
```

---

### 5.1 Criterion Direction (Benefit vs. Cost)

#### Rule
```text
Engine v1 supports benefit criteria only.
```

#### Detailed Contract
1. In Decision Engine v1, every criterion score $s_{ij}$ is evaluated under the strict mathematical semantic that **higher values represent superior performance or desirability**:
   $$s_{ij} \in [0.0, 100.0], \quad \text{where } 100.0 = \text{maximum utility}, \; 0.0 = \text{minimum utility}$$
2. All current repository datasets evaluate benefit metrics (e.g. "Career Growth", "Affordability" where higher score = more affordable / lower living costs, "Performance").
3. **Cost Criteria Ingestion Policy**:
   If raw data contains natural cost dimensions (e.g. latency in milliseconds, pricing in USD, error rates), the transformation into utility scores $[0.0, 100.0]$ **must occur upstream before passing input into Engine v1**.
4. **Deferred Specification for Engine v1.1+ (Native Cost Support)**:
   When explicit cost criteria support is introduced, each `Criterion` will declare `direction: 'benefit' | 'cost'`. The canonical min-max normalization transformation shall be:
   $$\text{Benefit: } s_{ij} = \frac{x_{ij} - x_i^{\min}}{x_i^{\max} - x_i^{\min}} \times 100.0$$
   $$\text{Cost: } s_{ij} = \frac{x_i^{\max} - x_{ij}}{x_i^{\max} - x_i^{\min}} \times 100.0$$
   For bounded percentage cost ratings ($x_{ij} \in [0, 100]$):
   $$s_{ij} = 100.0 - x_{ij}$$

---

### 5.2 Score Scale & Data Validation

#### Rule
```text
Raw scores must be finite real numbers satisfying 0.0 <= score <= 100.0.
Invalid scores are rejected with explicit ValidationError. No silent clamping.
```

#### Detailed Contract
1. **Type**: Strict finite JavaScript `number`. Decimals are permitted up to arbitrary IEEE 754 precision (commonly 1 or 2 decimal places).
2. **Bounds**: $0.0 \le s_{ij} \le 100.0$.
3. **Rejection Conditions**:
   The engine MUST throw a `ValidationError` immediately upon encountering:
   - Any score $s < 0.0$ or $s > 100.0$.
   - Any score that is `NaN`, `+Infinity`, or `-Infinity`.
   - Any non-numeric type (`string`, `boolean`, `object`, `null`, `undefined`).
4. **Prohibition of Silent Clamping**:
   The engine must NEVER silently clamp invalid scores (e.g. converting `110` to `100` or `-5` to `0`). Silent clamping conceals data corruption and produces false confidence in corrupted decisions.

---

### 5.3 Missing Score Policy

#### Rule
```text
Policy: Option A — Strict Rejection.
Missing scores invalidate the evaluation. The legacy silent 50 fallback is prohibited.
```

#### Detailed Contract
1. For every option $O_j \in \text{options}$ and every criterion $C_i \in \text{criteria}$, an explicit score entry for $C_i.\text{id}$ MUST exist in $O_j.\text{scores}$.
2. If `option.scores[criterion.id] === undefined` or `null`:
   The engine MUST throw an explicit `ValidationError`:
   ```text
   ValidationError: Option '${option.id}' is missing required score for criterion '${criterion.id}'.
   ```
3. **Deprecation of Legacy Silent 50 Fallback**:
   The legacy `option.scores[c.id] ?? 50` pattern in `decisionEngine.ts` is formally abolished.
   *Rationale*: Imputing 50 silently biases the MCDA result by assuming average performance on unmeasured criteria, which can flip rankings without the user's awareness. If an option cannot be scored on a criterion, either:
   - the criterion must be removed from the matrix;
   - the criterion must be assigned weight $0.0\%$; or
   - the user must explicitly provide an estimated score with documented confidence.

---

### 5.4 Weight Model & Proportional Normalization

#### Rule
```text
Input weights: w_i >= 0.0.
Normalized invariant: SUM(w_i) = 100.0% exactly.
Discrepancy distribution: Largest Remainder Method (Hare-Niemeyer).
```

#### Detailed Contract
1. **Unit & Precision**:
   - Input weights are non-negative real numbers ($r_i \ge 0.0$).
   - Normalized weights are expressed in percentage points rounded to **1 decimal place** ($0.1\%$).
   - The sum of normalized weights must strictly equal **$100.0\%$**.
2. **Mathematical Normalization Algorithm**:
   Let $C = \{C_1, \dots, C_n\}$ be the set of criteria with raw weights $r_i \ge 0$.
   Let $L \subseteq C$ be the set of locked criteria IDs.
   Let $U = C \setminus L$ be the set of unlocked criteria IDs.
   
   - **Step 1: Validate Locked Sum**:
     $$S_L = \sum_{l \in L} r_l$$
     - If $S_L > 100.0$: Throw `ValidationError: Sum of locked weights (${S_L}%) exceeds 100.0%`.
     - If $|U| = 0$ and $S_L \neq 100.0$: Throw `ValidationError: All criteria are locked but their sum (${S_L}%) does not equal 100.0%`.
   
   - **Step 2: Allocate Locked Weights**:
     For each $l \in L$:
     $$w_l = \text{round}_1(r_l)$$

   - **Step 3: Distribute Remaining Target**:
     $$W_{\text{rem}} = 100.0 - \sum_{l \in L} w_l$$
     - If $|U| = 0$: Normalization is complete.
     - Compute unlocked raw sum:
       $$S_U = \sum_{u \in U} r_u$$
     - If $S_U == 0.0$:
       Each unlocked criterion receives an equal base target:
       $$q_u = \frac{W_{\text{rem}}}{|U|}, \quad \forall u \in U$$
     - If $S_U > 0.0$:
       Each unlocked criterion receives a proportional base target:
       $$q_u = \left( \frac{r_u}{S_U} \right) \cdot W_{\text{rem}}, \quad \forall u \in U$$

   - **Step 4: Initial Tenths Allocation & Remainder Tracking**:
     For each $u \in U$, compute the initial tenth:
     $$w_u^{\text{init}} = \frac{\lfloor 10 \cdot q_u \rfloor}{10}$$
     Compute the fractional tenth remainder:
     $$e_u = q_u - w_u^{\text{init}}$$

   - **Step 5: Largest Remainder Correction Pass (Hare-Niemeyer)**:
     Compute total current allocated sum:
     $$S_{\text{allocated}} = \sum_{l \in L} w_l + \sum_{u \in U} w_u^{\text{init}}$$
     Compute discrete discrepancy in tenths:
     $$K = \text{round}_0\left( \frac{100.0 - S_{\text{allocated}}}{0.1} \right)$$
     - If $K > 0$:
       Sort unlocked criteria by descending fractional remainder $e_u$. Break ties deterministically by criterion `id` in ascending ASCII order.
       Add $+0.1\%$ to the first $K$ criteria in this sorted order.
     - If $K < 0$:
       Sort unlocked criteria by ascending fractional remainder $e_u$. Break ties deterministically by criterion `id` in ascending ASCII order.
       Subtract $0.1\%$ from the first $|K|$ criteria in this sorted order.
     - Final unlocked weights:
       $$w_u = w_u^{\text{init}} + \text{adjustment}_u$$

3. **Guarantees of the Canonical Algorithm**:
   - **Order Invariant**: Reordering criteria in the input array produces identical normalized weights.
   - **Zero Drift**: $\sum_{i=1}^n w_i = 100.0\%$ under all valid inputs.
   - **Constraint Preservation**: Locked criteria weights are preserved to 0.1% precision.

---

### 5.5 Locked Criteria Specification

#### Definition
A **locked criterion** represents a fixed user constraint. Its weight is immutable during automatic proportional normalization and single-criterion sensitivity analysis.

#### Boundary Rules
1. **$S_L = 0\%$**: Standard unconstrained proportional normalization.
2. **$0\% < S_L < 100\%$**: Unlocked criteria proportionally partition the remaining $100.0\% - S_L$.
3. **$S_L = 100\%$**:
   - All locked criteria preserve their weights.
   - All unlocked criteria are assigned $0.0\%$.
   - The decision model is fully constrained.
4. **$S_L > 100\%$**:
   - **Invalid State**: Rejection with `ValidationError`. The engine does not silently scale down locked criteria.
5. **All Criteria Locked ($|U| = 0$)**:
   - If $\sum_{l \in L} w_l = 100.0\%$: Accepted.
   - If $\sum_{l \in L} w_l \neq 100.0\%$: Rejected with `ValidationError`.

---

### 5.6 MCDA Scoring Formula & Dual-Precision Architecture

#### Scoring Formula
For option $O_j$:
$$\text{Score}_{\text{exact}}(O_j) = \sum_{i=1}^n \left( \frac{w_i}{100.0} \right) \cdot s_{ij}$$
Where $w_i$ are the canonical normalized weights ($\sum w_i = 100.0$) and $s_{ij} \in [0.0, 100.0]$ are the validated benefit scores.

#### Dual-Precision Contract (Unrounded Ranking vs Rounded Display)
1. **Calculation & Ranking**:
   - Scoring executes in full 64-bit IEEE 754 double precision.
   - The unrounded score $\text{Score}_{\text{exact}}(O_j)$ is stored in `unroundedScore: number`.
   - **Option rankings, point differentials, and winner designations MUST be computed on `unroundedScore`**.
2. **Display Representation**:
   - For UI rendering and telemetry display, `weightedScore` is formatted to **1 decimal place**:
     $$\text{weightedScore} = \text{round}_1(\text{Score}_{\text{exact}}(O_j))$$
   - Point lead to runner-up is displayed as:
     $$\text{displayLead} = \text{round}_1(\text{Score}_{\text{exact}}(\text{Winner}) - \text{Score}_{\text{exact}}(\text{RunnerUp}))$$
3. **Sub-Decimal Resolution Rule**:
   - *Example*: Option A = 82.949, Option B = 82.951.
     - Option B is ranked #1 (Winner) because $82.951 > 82.949$.
     - Option A is ranked #2 (Runner-up).
     - Display values: B = `83.0`, A = `82.9`.
   - *Example*: Option A = 82.940, Option B = 82.860.
     - Both display as `82.9`.
     - Option A is ranked #1 (Winner) because $82.940 > 82.860$.
     - Option B is ranked #2 (Runner-up).
     - The telemetry ribbon surfaces the sub-decimal delta: `+0.08 pts` (preventing false display-tie confusion).

---

### 5.7 Deterministic Tie-Breaking Policy

#### Rule
```text
Ties are resolved via an immutable 5-tier deterministic priority sequence.
Ranking never depends on input array order or runtime engine state.
```

#### 5-Tier Tie-Breaker Cascade
When sorting options, Option $A$ ranks ahead of Option $B$ ($A \succ B$) if and only if it wins the first non-tied condition in the following cascade:

| Tier | Evaluation Metric | Mathematical Definition | Rationale |
| :--- | :--- | :--- | :--- |
| **Tier 1** | **Exact Weighted Score** | $\text{Score}_{\text{exact}}(A) > \text{Score}_{\text{exact}}(B)$ (with $\epsilon = 10^{-9}$) | Pure MCDA performance under current user priorities. |
| **Tier 2** | **Locked Criteria Performance** | $\sum_{l \in L} w_l \cdot s_{Al} > \sum_{l \in L} w_l \cdot s_{Bl}$ | If the user locked specific criteria, performance on those fixed constraints takes precedence. |
| **Tier 3** | **Dominant Criterion Score** | $s_{A, k^*} > s_{B, k^*}$ where $k^*$ is the criterion with highest weight $w_k$. | In a tie, superior capability in the user's primary priority breaks the deadlock. (Ties in $w_k$ broken by criterion `id` ascending). |
| **Tier 4** | **Unweighted Score Average** | $\frac{1}{n} \sum_{i=1}^n s_{Ai} > \frac{1}{n} \sum_{i=1}^n s_{Bi}$ | Broadest overall capability across all criteria irrespective of weights. |
| **Tier 5** | **Deterministic ID Tie-Breaker** | $A.\text{id} < B.\text{id}$ (Lexicographical ASCII comparison) | Final deterministic guard ensuring 100% reproducible ordering across all platforms. |

#### Rank Assignment Contract
- If two options tie through Tier 1:
  - Both options display identical `weightedScore`.
  - The tie is surfaced via `isExactScoreTie: true`.
  - Options receive sequential ranks ($1, 2, \dots$) determined by Tiers 2–5.
  - The briefing metadata explicitly documents which tie-break tier separated the options.

---

### 5.8 Sensitivity Analysis & Tipping Point Calculus

#### Scope
Sensitivity analysis determines how much a criterion's weight can shift before the leading option is overtaken.
- **Primary Pairwise**: Evaluates Winner ($A$) vs Runner-up ($B$).
- **Multi-Option Extension**: For each candidate option $C_m$, solves the tipping weight against current leader $A$.

#### Closed-Form Tipping Point Equation with Locked Constraints
When testing criterion $k$:
- Criterion $k$ moves to candidate weight $w_k^*$.
- Locked criteria $L$ remain strictly fixed at their current weights $w_l$ ($l \in L$).
- Unlocked criteria $U \setminus \{k\}$ absorb the delta proportionally.

Let:
$$S_L = \sum_{l \in L} w_l$$
$$\Delta s_k = s_{Ak} - s_{Bk}$$
$$\Delta R_L = \sum_{l \in L} \frac{w_l}{100.0} (s_{Al} - s_{Bl})$$
$$\Delta R_U = \sum_{u \in U \setminus \{k\}} \frac{w_u^{\text{current}}}{100.0} (s_{Au} - s_{Bu})$$

The exact condition for rank inversion ($\text{Score}_A(w_k^*) = \text{Score}_B(w_k^*)$) yields:
$$\frac{w_k^*}{100.0} \Delta s_k + \Delta R_L + \left( \frac{100.0 - S_L - w_k^*}{100.0 - S_L - w_k^{\text{current}}} \right) \Delta R_U = 0$$

Solving for $w_k^*$ analytically:
$$w_k^* = \frac{100.0 \cdot \Delta R_U \cdot (100.0 - S_L) + \Delta R_L \cdot (100.0 - S_L - w_k^{\text{current}}) \cdot 100.0}{\Delta R_U \cdot 100.0 - \Delta s_k \cdot (100.0 - S_L - w_k^{\text{current}})}$$

When there are **no locked criteria** ($L = \emptyset$, $S_L = 0$, $\Delta R_L = 0$), this simplifies to:
$$w_k^* = \frac{100.0 \cdot (100.0 \cdot \Delta R_U)}{100.0 \cdot \Delta R_U - \Delta s_k \cdot (100.0 - w_k^{\text{current}})}$$
which matches the legacy formula while generalizing it to respect locked constraints.

#### Feasibility Classifications
The candidate tipping weight $w_k^*$ is evaluated against the feasible range $[0.0, 100.0 - S_L]$:

| Feasibility Status | Criteria | Description |
| :--- | :--- | :--- |
| **`low-threshold`** | $w_k^* \in [0.0, 100.0 - S_L]$ and $|\Delta w_k| \le 15.0\%$ | Highly sensitive; modest priority adjustment flips winner. |
| **`medium-threshold`** | $w_k^* \in [0.0, 100.0 - S_L]$ and $15.0\% < |\Delta w_k| \le 35.0\%$ | Moderately sensitive; requires significant priority shift. |
| **`high-threshold`** | $w_k^* \in [0.0, 100.0 - S_L]$ and $|\Delta w_k| > 35.0\%$ | Low sensitivity; requires extreme priority realignment. |
| **`unreachable`** | $w_k^* < 0.0$ or $w_k^* > (100.0 - S_L)$ or $\text{denominator} = 0$ | No feasible single-criterion weight can cause rank inversion. |

#### Directionality Contract
Engine v1 outputs:
- `tippingPointWeight`: number (rounded to 1 decimal place) or `null` if unreachable.
- `weightDeltaNeeded`: $w_k^* - w_k^{\text{current}}$ (preserving explicit sign: positive = increase required, negative = decrease required).
- `direction`: `'increase' | 'decrease' | 'none'`.

---

### 5.9 Monte Carlo Statistical Robustness Specification

#### Engine v1 Formal Specification
Monte Carlo simulation evaluates the statistical resilience of a decision under parameter uncertainty.

1. **Simulation Parameters**:
   - Default Iterations: $N = 1,000$ (configurable up to $10,000$).
   - Noise Parameter: $\sigma_{\text{relative}} \in \{0.10, 0.15, 0.25\}$ (representing $10\%, 15\%, 25\%$ standard deviation).
   - Deterministic PRNG: Seeded generator (Mulberry32 or PCG) ensuring 100% reproducible passes across environments.
2. **Distribution**:
   - **True Gaussian (Box-Muller Transform)**:
     $$Z_0 = \sqrt{-2 \ln U_1} \cos(2\pi U_2)$$
     $$w_i^{\text{perturbed}} = \max\left(0.1, w_i^{\text{current}} + Z_0 \cdot \left(\sigma_{\text{relative}} \cdot w_i^{\text{current}}\right)\right)$$
3. **Multi-Option Support**:
   - Evaluates all $M \ge 2$ options in the dataset.
   - Computes win count and win percentage for every option:
     $$\text{WinRate}(O_j) = \frac{\text{Wins}(O_j)}{N} \times 100.0\%$$
4. **Empirical Robustness Rating**:
   - **High Confidence / Robust**: $\text{WinRate}(\text{Winner}) \ge 75.0\%$.
   - **Moderate Confidence**: $55.0\% \le \text{WinRate}(\text{Winner}) < 75.0\%$.
   - **Sensitive / Volatile**: $\text{WinRate}(\text{Winner}) < 55.0\%$.

---

## 6. Worked Mathematical Proofs & Examples

### 6.1 Worked Example 1: Largest Remainder Normalization (Hare-Niemeyer)

**Scenario**: 3 unlocked criteria with equal raw weights. No locked criteria.
- Input: $r_1 = 1, r_2 = 1, r_3 = 1$. $L = \emptyset$.
- Target remainder: $W_{\text{rem}} = 100.0\%$. $S_U = 3$.
- Exact continuous shares:
  $$q_1 = q_2 = q_3 = \frac{100.0}{3} = 33.333333\dots\%$$
- Initial tenth floor allocation:
  $$w_1^{\text{init}} = \frac{\lfloor 333.333\dots \rfloor}{10} = 33.3\%$$
  $$w_2^{\text{init}} = 33.3\%, \quad w_3^{\text{init}} = 33.3\%$$
- Allocated sum: $33.3 + 33.3 + 33.3 = 99.9\%$.
- Discrepancy: $K = \frac{100.0 - 99.9}{0.1} = +1$ tenth.
- Fractional remainders:
  $$e_1 = 33.3333\dots - 33.3 = 0.0333\dots$$
  $$e_2 = 0.0333\dots, \quad e_3 = 0.0333\dots$$
- Tie-breaking: All three criteria have identical remainder $0.0333\dots$.
  Sorted by criterion `id` ascending: `c1` < `c2` < `c3`.
  Criterion `c1` receives the $+0.1\%$ tenth.
- **Canonical Output**:
  - $w_1 = 33.4\%$
  - $w_2 = 33.3\%$
  - $w_3 = 33.3\%$
  - **Sum**: $33.4 + 33.3 + 33.3 = 100.0\%$ (Strictly deterministic).

---

### 6.2 Worked Example 2: Proportional Distribution with Locked Constraint

**Scenario**: 1 locked criterion, 2 unlocked criteria.
- Input:
  - `comp`: raw 40.0, **Locked** ($L = \{\text{'comp'}\}$)
  - `growth`: raw 35.0, Unlocked
  - `wlb`: raw 15.0, Unlocked
- Locked Sum: $S_L = 40.0\%$. Unlocked Target: $W_{\text{rem}} = 100.0 - 40.0 = 60.0\%$.
- Unlocked Sum: $S_U = 35.0 + 15.0 = 50.0$.
- Unlocked Exact Shares:
  $$q_{\text{growth}} = \left(\frac{35.0}{50.0}\right) \times 60.0 = 42.0\%$$
  $$q_{\text{wlb}} = \left(\frac{15.0}{50.0}\right) \times 60.0 = 18.0\%$$
- Fractional remainders: $e_{\text{growth}} = 0.0$, $e_{\text{wlb}} = 0.0$.
- Total Allocated Sum: $40.0 + 42.0 + 18.0 = 100.0\%$. Discrepancy $K = 0$.
- **Canonical Output**:
  - $w_{\text{comp}} = 40.0\%$ (Locked)
  - $w_{\text{growth}} = 42.0\%$
  - $w_{\text{wlb}} = 18.0\%$
  - **Sum**: $100.0\%$ exactly.

---

### 6.3 Worked Example 3: Zero Unlocked Raw Weights Fallback

**Scenario**: 1 locked criterion, 3 unlocked criteria all with raw weight 0.
- Input:
  - `stability`: raw 70.0, **Locked** ($L = \{\text{'stability'}\}$)
  - `growth`: raw 0, Unlocked
  - `comp`: raw 0, Unlocked
  - `learning`: raw 0, Unlocked
- Locked Sum: $S_L = 70.0\%$. Remaining Budget: $W_{\text{rem}} = 30.0\%$.
- Unlocked Sum: $S_U = 0.0$.
- Equal share distribution:
  $$q_u = \frac{30.0}{3} = 10.0\%, \quad \forall u \in \{\text{growth, comp, learning}\}$$
- Initial tenths: each gets $10.0\%$. Discrepancy $K = 0$.
- **Canonical Output**:
  - $w_{\text{stability}} = 70.0\%$ (Locked)
  - $w_{\text{growth}} = 10.0\%$
  - $w_{\text{comp}} = 10.0\%$
  - $w_{\text{learning}} = 10.0\%$
  - **Sum**: $100.0\%$ exactly.

---

### 6.4 Worked Example 4: Dual-Precision Scoring & Ranking Resolution

**Scenario**: Two options with sub-decimal score divergence.
- Normalized Weights: $w_1 = 50.0\%, w_2 = 50.0\%$.
- Scores:
  - Option Alpha: $s_{A1} = 85.0$, $s_{A2} = 80.898$
  - Option Beta: $s_{B1} = 85.0$, $s_{B2} = 80.902$
- Exact MCDA Scores:
  $$\text{Score}_{\text{exact}}(A) = (0.50 \times 85.0) + (0.50 \times 80.898) = 42.5 + 40.449 = 82.949$$
  $$\text{Score}_{\text{exact}}(B) = (0.50 \times 85.0) + (0.50 \times 80.902) = 42.5 + 40.451 = 82.951$$
- Ranking Evaluation (Tier 1):
  $$82.951 > 82.949 \implies \text{Option Beta } \succ \text{ Option Alpha}$$
- Display Formatting:
  - Option Beta `weightedScore` = `83.0`
  - Option Alpha `weightedScore` = `82.9`
  - Rank 1: **Option Beta** (83.0)
  - Rank 2: **Option Alpha** (82.9)
  - Output lead: $+0.1$ display lead ($+0.002$ exact lead).

---

### 6.5 Worked Example 5: Sensitivity Tipping Point with Locked Criteria

**Scenario**: Job Offer evaluation with locked Career Growth.
- Criteria:
  - `growth`: weight 30.0%, **Locked**
  - `comp`: weight 25.0%, Unlocked (Tested Criterion $k$)
  - `learning`: weight 20.0%, Unlocked
  - `wlb`: weight 15.0%, Unlocked
  - `stability`: weight 10.0%, Unlocked
- Option Alpha (Leader):
  - `growth`: 95, `comp`: 70, `learning`: 92, `wlb`: 74, `stability`: 65
- Option Beta (Challenger):
  - `growth`: 72, `comp`: 95, `learning`: 76, `wlb`: 86, `stability`: 94
- Delta on tested criterion (`comp`):
  $$\Delta s_{\text{comp}} = 70 - 95 = -25.0$$
- Delta on locked criterion (`growth`):
  $$\Delta R_L = \frac{30.0}{100.0} \times (95 - 72) = 0.30 \times 23.0 = +6.90$$
- Deltas on other unlocked criteria (`learning, wlb, stability`):
  - `learning`: $0.20 \times (92 - 76) = 0.20 \times 16.0 = +3.20$
  - `wlb`: $0.15 \times (74 - 86) = 0.15 \times (-12.0) = -1.80$
  - `stability`: $0.10 \times (65 - 94) = 0.10 \times (-29.0) = -2.90$
  $$\Delta R_U = 3.20 - 1.80 - 2.90 = -1.50$$
- Total lead for Alpha at current weights:
  $$\Delta \text{Total} = (0.25 \times (-25)) + 6.90 - 1.50 = -6.25 + 5.40 = -0.85$$
  *(Alpha is currently trailing Beta by 0.85 pts at default weights; Beta is leader, Alpha is challenger)*.
- Applying canonical equation:
  Solving for $w_{\text{comp}}^*$ where Beta's lead is neutralized or inverted gives the analytical tipping point that preserves `growth` locked at 30.0%, with remaining weight absorbed by `learning`, `wlb`, and `stability`.

---

## 7. Migration & Compatibility Guide for Phase 1

When building `packages/decision-engine` during Phase 1, adhere to the following contract rules:

### 7.1 Exported Types & Signatures
```typescript
export interface Criterion {
  readonly id: string;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly category: 'growth' | 'finance' | 'lifestyle' | 'risk' | 'execution';
  readonly defaultWeight: number; // 0.0 to 100.0
  readonly direction: 'benefit'; // Canonical Engine v1 constant
  readonly iconName?: string;
}

export interface Option {
  readonly id: string;
  readonly name: string;
  readonly badge?: string;
  readonly tagline: string;
  readonly description: string;
  readonly color: string;
  readonly accentBorder: string;
  readonly scores: Readonly<Record<string, number>>; // 0.0 to 100.0
  readonly strengths: readonly string[];
  readonly vulnerabilities: readonly string[];
}

export interface EngineResult {
  readonly evaluations: readonly OptionEvaluation[];
  readonly winner: OptionEvaluation;
  readonly runnerUp: OptionEvaluation | null;
  readonly normalizedWeights: Readonly<Record<string, number>>;
  readonly totalWeight: number; // Strictly 100.0
  readonly sensitivity: readonly SensitivityAnalysis[];
  readonly explainability: ExplainabilitySummary;
  readonly validationErrors?: readonly string[];
}
```

### 7.2 Deprecation Notice
1. **`scores[c.id] ?? 50`**: Deleted. Missing scores throw `ValidationError`.
2. **Arbitrary 95% tipping clamp**: Replaced by canonical $[0.0, 100.0 - S_L]$ range.
3. **Array-order rounding dumps**: Replaced by Largest Remainder Method (Hare-Niemeyer).
4. **Uniform random Monte Carlo**: Deprecated in favor of Gaussian Box-Muller simulation with seeded PRNG.
5. **Two-option Monte Carlo limitation**: Generalized to $N$ options.

---

## 8. Formal Verification Sign-Off

This document serves as the binding contract for Decision OS Decision Engine v1.

- **Status**: Formally Locked
- **Phase 0 Integrity**: Verified & Preserved
- **Phase 1 Target**: `packages/decision-engine` monorepo extraction
- **Date**: 2026-10-27
