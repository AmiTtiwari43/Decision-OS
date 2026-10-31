# Decision OS — Phase 11 Specification: Disagreement Intelligence

## 1. Overview & Objective

Phase 11 introduces **Disagreement Intelligence** to Decision OS.
The objective is to make Decision OS capable of identifying, categorizing, and explaining disagreements among participants in a decision deliberation.

### Core Non-Negotiable Invariants

1. **Strict Authoritative MCDA Engine Separation:**
   - Disagreement intelligence never mutates authoritative criteria, weights, scores, or rankings.
   - All dispersion calculations (range, standard deviation, median, confidence-weighted mean) and counterfactual expert scenario evaluations (Min, Median, Max) are executed deterministically in `packages/decision-engine`.
   - Golden fixtures G1–G10, `CANONICAL_DECISION_ENGINE_V1_SPEC.md`, and Phase 0 historical characterization baselines F1–F3 remain strictly read-only and intact.

2. **Decision-Criticality Defined Precisely Before Coding:**
   - High dispersion alone does **NOT** imply that a disagreement is decision-critical.
   - A disagreement is defined as **`decision-critical`** if and only if:
     1. Re-running the deterministic decision engine on the expert scenarios (Min, Median, or Max scores) changes the winning option ($W' \neq W$) or results in a tie ($\text{isTie} = \text{true}$); OR
     2. The observed expert score range $R_k = \max s_{ik} - \min s_{ik}$ meets or exceeds the analytical option-score sensitivity tipping delta $\Delta s_k = \frac{100 \cdot \Delta}{w_k}$ for that criterion.
   - All explanations must explicitly present numerical proof (scores, lead margin, and required tipping threshold).

3. **Disagreement Taxonomy:**
   - **`score`**: Participants assign materially different utility scores to the same criterion/option.
   - **`priority`**: Participants advocate for different winning alternatives (`preferredOptionId`).
   - **`evidence`**: Participants cite conflicting evidence records or exhibit citations gaps.
   - **`assumption`**: Contradictory predictions or significant confidence divergences ($|c_i - c_j| \ge 0.3$).
   - **`interpretation`**: Divergent qualitative reasoning on the same criterion or evidence.

4. **Human Resolution Lifecycle:**
   - Disagreements carry a governance state: `open` (unresolved), `acknowledged` (deliberated, noted), or `resolved` (consensus or explicit owner decision reached).
   - Resolving a disagreement is a governance action with a documented `resolutionExplanation`. It does **NOT** mutate original expert contributions or source evidence.

5. **AI Neutrality & Advisory Role:**
   - AI Analyst assistance (reusing Phase 9 `AIProvider`) provides neutral, evidence-grounded syntheses of why participants differ and proposes clarification questions.
   - AI never chooses a "winner", never assigns expert credibility/reputation, and never modifies MCDA calculations.

---

## 2. Mathematical Formulations & Definitions

### A. Numerical Dispersion per Criterion $k$
For submitted contributions $i \in \{1, \dots, N\}$ on criterion $k$ with scores $s_{ik} \in [0, 100]$ and self-reported confidence $c_i \in [0, 1]$:

1. **Score Range:**
   $$R_k = \max_{i} s_{ik} - \min_{i} s_{ik}$$
   - $R_k = 0$ if $N = 1$.
   - $R_k = \text{null}$ if $N = 0$.

2. **Sample Standard Deviation ($s_k$):**
   $$\bar{s}_k = \frac{1}{N} \sum_{i=1}^N s_{ik}$$
   $$s_k = \sqrt{\frac{1}{N - 1} \sum_{i=1}^N (s_{ik} - \bar{s}_k)^2} \quad (\text{for } N \ge 2)$$
   - $s_k = 0$ if $N = 1$.
   - $s_k = \text{null}$ if $N = 0$.

3. **Confidence-Weighted Mean ($s_k^{\text{conf}}$):**
   $$s_k^{\text{conf}} = \frac{\sum_{i=1}^N c_i \cdot s_{ik}}{\sum_{i=1}^N c_i} \quad \left(\text{if } \sum c_i > 0, \text{ else } \bar{s}_k\right)$$

4. **Median Score ($\tilde{s}_k$):**
   Sorted values $s_{(1)} \le s_{(2)} \le \dots \le s_{(N)}$.
   $$\tilde{s}_k = \begin{cases} s_{\left(\frac{N+1}{2}\right)} & \text{if } N \text{ is odd} \\ \frac{1}{2}\left(s_{\left(\frac{N}{2}\right)} + s_{\left(\frac{N}{2} + 1\right)}\right) & \text{if } N \text{ is even} \end{cases}$$

### B. Decision-Critical Tipping Evaluation
Let Winner $W$ have score $S_W$, and Runner-Up $U$ have score $S_U$. Lead is $\Delta = S_W - S_U \ge 0$.
Criterion $k$ has normalized weight $w_k > 0$.
The analytical score delta needed to flip the winner on criterion $k$ is:
$$\Delta s_k = \frac{100 \cdot \Delta}{w_k}$$

Three deterministic counterfactual scenarios are evaluated through `evaluateDecision`:
1. **$S_{\min}$ (Pessimistic Scenario):** Substitutes $\min_i s_{ik}$ into the leader/evaluations. Checks if evaluated winner $W_{\min} \neq W$ or $\text{isTie} = \text{true}$.
2. **$S_{\text{median}}$ (Central Scenario):** Substitutes $\tilde{s}_k$ into the evaluations. Checks if evaluated winner $W_{\text{median}} \neq W$.
3. **$S_{\max}$ (Optimistic Scenario):** Substitutes $\max_i s_{ik}$ into the challenger option. Checks if evaluated winner $W_{\max} \neq W$.

$$\text{isDecisionCritical} = (W_{\min} \neq W) \lor (W_{\text{median}} \neq W) \lor (W_{\max} \neq W) \lor (R_k \ge \Delta s_k \land \Delta s_k \le 100)$$

---

## 3. Data Model

### Collection: `decision_disagreements`
- `_id`: ObjectId
- `decisionId`: ObjectId (indexed)
- `disagreementId`: string (stable identifier, e.g. `disag_crit_<id>` or `disag_prio_<id>`)
- `category`: `'score' | 'priority' | 'evidence' | 'assumption' | 'interpretation'`
- `criterionId`: string (optional)
- `optionId`: string (optional)
- `status`: `'open' | 'acknowledged' | 'resolved'` (default `'open'`)
- `resolutionExplanation`: string (optional)
- `resolvedById`: ObjectId (ref: User, optional)
- `resolvedByName`: string (optional)
- `resolvedAt`: Date (optional)
- `createdAt`: Date
- `updatedAt`: Date

Compound index: `{ decisionId: 1, disagreementId: 1 }` (unique).

---

## 4. API Endpoints

### 1. `GET /api/decisions/:id/disagreements`
- **Auth:** Bearer JWT required.
- **Permission:** Collaborator (`viewer`, `contributor`, `editor`, `owner`).
- **Response:**
  - `decisionId`: string
  - `hasSufficientData`: boolean ($N \ge 2$)
  - `totalContributors`: number
  - `decisionCriticalCount`: number
  - `disagreements`: Array of structured disagreement items (both score, priority, evidence, assumption).
  - `summary`: string

### 2. `PATCH /api/decisions/:id/disagreements/:disagreementId/resolution`
- **Auth:** Bearer JWT required.
- **Permission:** Decision `owner` or `editor`.
- **Body:**
  - `status`: `'open' | 'acknowledged' | 'resolved'`
  - `resolutionExplanation`: string (optional)
- **Response:** Updated disagreement record.

### 3. `POST /api/decisions/:id/disagreements/ai-explain`
- **Auth:** Bearer JWT required.
- **Permission:** Collaborator (`viewer`, `contributor`, `editor`, `owner`).
- **Body:**
  - `disagreementId`: string
- **Response:**
  - Advisory neutral explanation of underlying reasons.
  - Identification of underlying assumptions.
  - 2-3 targeted clarification questions.

