# Decision OS — Phase 10 Specification: Advanced Analytics

## 1. Overview & Objective

Phase 10 implements an **Advanced Analytics Layer** for Decision OS.
The objective is to provide decision-makers, stakeholders, and organizational leaders with empirical, transparent, and reproducible insights into:
- Decision performance and workspace activity patterns.
- Criterion-level and option-level performance trade-offs.
- Multi-parameter counterfactuals and option-score sensitivity.
- Uncertainty analysis via seeded Gaussian Monte Carlo robustness simulations.
- Empirical evidence coverage and missing-evidence gap discovery.
- Deliberation participation and expert consensus patterns.

### Core Non-Negotiable Invariants

1. **Authoritative MCDA Mathematics:**
   - All MCDA calculations (normalization, scoring, ranking, ties, sensitivity tipping points, counterfactuals, and Monte Carlo) are executed exclusively by the canonical engine (`packages/decision-engine`).
   - Analytics computations do **NOT** alter decision inputs, weights, scores, or stored analysis snapshots. Analytics queries are strictly read-only and side-effect free.
   - Golden fixtures G1–G10, `CANONICAL_DECISION_ENGINE_V1_SPEC.md`, and historical characterization baselines F1–F3 remain strictly intact and read-only.

2. **Metric Definitions & Honesty:**
   - **No universal decision-quality score**: Decision OS rejects single composite "decision quality" scores that arbitrary weight factors. Quality is dimensional.
   - **No prediction accuracy label for Monte Carlo**: Monte Carlo win probability is explicitly labeled: *"win probability under the specified uncertainty model"*, NEVER "prediction accuracy" or "X% accurate".
   - **Evidence Quantity != Credibility**: Evidence coverage metrics measure the empirical presence of citations/excerpts across options and criteria. Higher count does not imply veracity or credibility.
   - **Expert Signals Kept Separate**: In accordance with the product rules, expert participation is strictly descriptive (submission counts, status, round lock). No expert reputation, calibration, or accuracy scoring is introduced in this phase.

3. **Performance & Scalability:**
   - Server-side MongoDB aggregation pipelines (`$match`, `$group`, `$facet`, `$sort`, `$project`) compute portfolio metrics in the database.
   - Collections are never loaded wholesale into Node.js application memory.
   - Safe pagination, bounded simulation limits (max 10,000 iterations), and date-range constraints prevent memory or CPU exhaustion.

4. **Authentication & Authorization Scoping:**
   - Every analytics endpoint requires authentication (`Bearer <jwt>`).
   - Decision-level analytics (`/api/decisions/:id/analytics`) enforces decision read authorization. Unrelated users receive `404 Not Found` (enumeration defense).
   - Workspace-level analytics (`/api/analytics/overview`) is strictly scoped to decisions owned by or shared with the authenticated user (cross-user data isolation).

---

## 2. Mathematical Formulations & Definitions

### A. Option-Score Sensitivity Calculus
- **Concept:** For a given criterion $k \in C$ with normalized weight $w_k > 0$, what raw score change $\Delta s_k$ on Leader $A$ or Challenger $B$ would bring the two options to breakeven?
- **Formula:**
  Let $\Delta = \text{Score}(A) - \text{Score}(B) \ge 0$ be the point lead.
  $$\Delta s_k = \frac{100 \cdot \Delta}{w_k}$$
  - **Leader reduction threshold:** $s_{Ak}^* = s_{Ak} - \Delta s_k$. If $s_{Ak}^* \ge 0$, Leader losing $\Delta s_k$ points in criterion $k$ causes Challenger to tie/overtake.
  - **Challenger increase threshold:** $s_{Bk}^* = s_{Bk} + \Delta s_k$. If $s_{Bk}^* \le 100$, Challenger gaining $\Delta s_k$ points in criterion $k$ causes Challenger to tie/overtake.
  - **Feasibility:** Feasible if $w_k > 0$ and at least one threshold is within $[0, 100]$. Unreachable if $w_k = 0$ or both thresholds fall outside $[0, 100]$.

### B. Multi-Parameter Counterfactual (Smallest Combined Weight Change)
- **Concept:** What is the minimal total weight shift vector $\boldsymbol{\delta} = (\delta_1, \dots, \delta_n)$ across criteria that causes Challenger $B$ to tie or overtake Leader $A$, respecting locked criteria and the $[0, 100]$ non-negativity budget constraint?
- **Mathematical Program:**
  $$\min_{\boldsymbol{\delta}} \frac{1}{2} \sum_{i=1}^n |\delta_i| \quad \text{subject to:}$$
  $$\sum_{i=1}^n \delta_i = 0$$
  $$\delta_l = 0 \quad \forall l \in L \text{ (locked criteria)}$$
  $$w_i + \delta_i \ge 0 \quad \forall i \in C$$
  $$\sum_{i=1}^n \frac{w_i + \delta_i}{100}(s_{Bi} - s_{Ai}) \ge 0$$
- **Exact Algorithm:**
  For each unlocked criterion $i$, let $g_i = s_{Bi} - s_{Ai}$ be the challenger advantage.
  If $\max_{i \in U} g_i \le 0$, Challenger cannot overtake regardless of weight distribution (unreachable).
  Otherwise, weight is shifted from criteria where Leader has advantage ($g_j < 0$) to criteria where Challenger has advantage ($g_i > 0$), prioritized by highest gradient difference $g_i - g_j$, until $\sum \frac{w_i + \delta_i}{100}(s_{Bi} - s_{Ai}) = 0$.

### C. Seeded Gaussian Monte Carlo Uncertainty Model
- **PRNG:** Mulberry32 32-bit deterministic generator with user-configurable or default seed `42`.
- **Perturbation:** Box-Muller transform producing standard normal variate $Z \sim \mathcal{N}(0, 1)$.
  $$w_i' = \max(0, w_i + Z \cdot (\sigma_{\text{rel}} \cdot w_i))$$
  Locked criteria remain frozen ($w_l' = w_l$).
- **Renormalization:** Largest-remainder Hare-Niemeyer normalization to strictly $100.0\%$.
- **Robustness Rating:**
  - `robust`: Winner win probability $\ge 75\%$.
  - `moderate`: Winner win probability $55\% \le P < 75\%$.
  - `sensitive`: Winner win probability $< 55\%$.

---

## 3. Metric Catalog & Data Dictionary

| Metric Name | Type | Data Source | Formula / Logic | Missing Data Handling |
| :--- | :---: | :---: | :--- | :--- |
| `statusDistribution` | Descriptive | `decisions` | Count by `analysis.decisionOutcome` ('decisive', 'tie', 'unscored') | Missing analysis treated as 'unscored' |
| `roundLockDistribution`| Descriptive | `decisions` | Count by `isContributionRoundLocked` (true vs false) | Defaults to false |
| `averagePointLead` | Descriptive | `decisions.analysis` | Average of `pointLead` for decisive decisions | Returns `null` if 0 decisive decisions |
| `completionRate` | Descriptive | `decisions` | $\frac{\text{decisive} + \text{tie}}{\text{totalDecisions}} \times 100$ | Returns $0\%$ if totalDecisions = 0 |
| `activityTrends` | Time-Series | `decisions.createdAt` | Monthly counts grouped by ISO `%Y-%m` | Empty array if no records |
| `evidenceCoverageRate`| Descriptive | `decision_evidence` | $\frac{\text{decisions with } \ge 1 \text{ evidence}}{\text{totalDecisions}} \times 100$ | Returns $0\%$ if totalDecisions = 0 |
| `sourceTypeBreakdown` | Descriptive | `decision_evidence` | Counts by `type` ('url', 'document', 'excerpt') | Zero counts represented explicitly |
| `missingEvidenceTargets`| Diagnostic | `decisions` + `evidence` | Options/criteria with 0 attached evidence records | Empty list if all covered |
| `scoreSpreadByCriterion`| Descriptive | `decision_contributions` | Min, max, average, and range of expert scores per criterion | Returns `null` for criteria with no scores |
| `winProbability` | Inferential | Monte Carlo Simulation | $\frac{\text{iterations where option won}}{\text{total iterations}} \times 100$ | Labeled "win probability under specified model" |

---

## 4. API Specification

### 1. Decision-Level Analytics
`GET /api/decisions/:id/analytics`

- **Authentication:** Bearer JWT required.
- **Permission:** Collaborator (`viewer`, `contributor`, `editor`, `owner`).
- **Query Parameters:**
  - `includeMonteCarlo` (boolean, default: `true`)
  - `iterations` (integer, default: `1000`, min: `100`, max: `10000`)
  - `seed` (integer, default: `42`)
  - `sigmaRelative` (number, default: `0.15`, min: `0.01`, max: `0.50`)
- **Status Codes:**
  - `200 OK`: Structured analytics returned.
  - `400 Bad Request`: Malformed decision ID or query params.
  - `401 Unauthorized`: Missing or invalid token.
  - `404 Not Found`: Decision not found or user lacks access.

### 2. Workspace Portfolio Analytics
`GET /api/analytics/overview`

- **Authentication:** Bearer JWT required.
- **Permission:** Authenticated User.
- **Query Parameters:**
  - `startDate` (ISO 8601 date, optional)
  - `endDate` (ISO 8601 date, optional)
- **Status Codes:**
  - `200 OK`: Workspace analytics returned.
  - `400 Bad Request`: Invalid date format or date range (`startDate > endDate`).
  - `401 Unauthorized`: Missing or invalid token.

---

## 5. Security & Privacy Controls

1. **Enumeration Defense:** Accessing `/api/decisions/:id/analytics` for a non-existent ID or an ID not shared with the requester yields `404 DecisionNotFoundError`.
2. **Cross-Tenant Data Isolation:** Portfolio analytics filters decisions using `{ $in: userAccessibleDecisionIds }`, ensuring no other user's data leaks into aggregations.
3. **No Dynamic Injection:** Aggregation stages are strictly constructed using typed schema properties, preventing MongoDB operator injection.
4. **Draft Protection:** Unsubmitted draft contributions of other users are excluded from participation score spreads.

