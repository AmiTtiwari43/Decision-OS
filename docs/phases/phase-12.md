# Decision OS — Phase 12 Specification: Expert Calibration

## 1. Overview & Objective

Phase 12 introduces **Expert Calibration** to Decision OS.
The objective is to establish an empirical, mathematically grounded calibration system that measures how well experts' predictions align with subsequently observed, verifiable real-world outcomes.

### Core Non-Negotiable Invariants

1. **Strict Authoritative MCDA Engine Separation:**
   - Expert calibration is a completely separate analytical subsystem.
   - Calibration metrics, Brier scores, and accuracy ratings **NEVER** modify canonical decision scores, criterion weights, locked criteria, option rankings, or Monte Carlo win probabilities.
   - `CANONICAL_DECISION_ENGINE_V1_SPEC.md` and golden fixtures G1–G10 remain strictly read-only and intact.

2. **Separation of Performance Dimensions:**
   The system explicitly distinguishes and isolates the following dimensions (they are never blended into a single composite score):
   - **Predictive Calibration:** Brier score, calibration bins, expected calibration error (ECE) evaluated on verified prospective forecasts.
   - **Domain Expertise:** Domain-specific breakdown (e.g. engineering, finance, security, operations, legal); accuracy in one domain does not generalize to another.
   - **Experience / Participation:** Total contributions and predictions submitted.
   - **Evidence Quality:** Verified citations and empirical backing provided.
   - **Recency:** Timestamp of recent forecasts and outcome verifications.
   - **Popularity / Social Consensus:** Proportion of peers recommending the same alternative (strictly labeled: *"Social consensus signal (display-only, not an accuracy or calibration metric)"*).

3. **Strict Prospective Forecasting Contract:**
   - A prediction submitted after the outcome is known must **NOT** count as a valid prospective forecast.
   - Predictions require `submittedAt < outcomeDate`. If an outcome occurred before prediction submission, the record is flagged as `invalidated` and excluded from calibration.
   - Predictions awaiting an outcome are never treated as incorrect.

4. **Outcome Verification Governance:**
   - Outcomes cannot be self-verified by standard contributors. Only decision owners or editors can verify outcomes with documented evidence sources.
   - Disputed outcomes are immediately excluded from calibration calculations until resolved by human review.

5. **Minimum Sample Size Safeguard:**
   - Statistical calibration requires a minimum sample of $N \ge 3$ verified eligible predictions before aggregate performance metrics are published.
   - When $N < 3$, the system explicitly surfaces an *"Insufficient Sample Size"* warning and hides definitive calibration ratings.

---

## 2. Mathematical Formulations & Definitions

### A. Brier Score ($BS$)
For a set of $N$ eligible binary predictions with predicted probabilities $p_i \in [0.0, 1.0]$ and verified binary outcomes $o_i \in \{0, 1\}$ (where $1$ denotes the event occurred and $0$ denotes it did not):

$$BS = \frac{1}{N}\sum_{i=1}^{N}(p_i - o_i)^2$$

- **Range:** $[0.0, 1.0]$. Lower values indicate superior probabilistic calibration and accuracy.
- **Reference Baselines:**
  - Perfect forecast: $BS = 0.0$.
  - Uninformative 50/50 guessing ($p = 0.5$): $BS = 0.25$.
  - Worst possible forecast (100% confidence on wrong outcome): $BS = 1.0$.

### B. Brier Skill Score ($BSS$)
Measures relative skill compared to a reference climatological base-rate forecast $\bar{o} = \frac{1}{N}\sum o_i$:

$$BS_{\text{ref}} = \frac{1}{N}\sum_{i=1}^N (\bar{o} - o_i)^2 = \bar{o}(1 - \bar{o})$$

$$BSS = \begin{cases} 1 - \frac{BS}{BS_{\text{ref}}} & \text{if } BS_{\text{ref}} > 10^{-6} \\ \text{null} & \text{if } BS_{\text{ref}} \le 10^{-6} \text{ (all outcomes identical)} \end{cases}$$

- $BSS > 0$: Predictor outperforms base-rate reference.
- $BSS = 0$: Predictor performs equal to base-rate reference.
- $BSS < 0$: Predictor performs worse than base-rate reference.

### C. Calibration Bins & Expected Calibration Error ($ECE$)
Predictions are partitioned into $B = 5$ standard probability intervals:
$b_1 = [0.0, 0.2)$, $b_2 = [0.2, 0.4)$, $b_3 = [0.4, 0.6)$, $b_4 = [0.6, 0.8)$, $b_5 = [0.8, 1.0]$.

For each bin $b$ with $N_b > 0$ predictions:
- **Mean Predicted Probability:** $\bar{p}_b = \frac{1}{N_b}\sum_{i \in b} p_i$
- **Observed Event Frequency:** $\bar{o}_b = \frac{1}{N_b}\sum_{i \in b} o_i$
- **Calibration Gap:** $|\bar{p}_b - \bar{o}_b|$

The aggregate **Expected Calibration Error ($ECE$)** is:
$$ECE = \sum_{b=1}^{B}\frac{N_b}{N}|\bar{p}_b - \bar{o}_b|$$

---

## 3. Data Model

### Collection: `expert_predictions`
- `_id`: ObjectId
- `decisionId`: ObjectId (ref: Decision, indexed)
- `contributorId`: ObjectId (ref: User, indexed)
- `contributorName`: string
- `predictionId`: string (stable identifier, unique with decisionId)
- `statement`: string (prediction claim, max 2000 chars)
- `probability`: number ($0.0 \le p \le 1.0$)
- `domain`: string (e.g. `'engineering' | 'finance' | 'security' | 'operations' | 'legal' | 'general'`)
- `targetDate`: Date (forecast target date)
- `evidenceReferences`: string[]
- `status`: `'submitted' | 'awaiting_outcome' | 'outcome_recorded' | 'verified' | 'disputed' | 'invalidated'`
- `submittedAt`: Date (immutable timestamp)
- `outcome`: (optional sub-document)
  - `outcomeId`: string
  - `observedOutcome`: number ($0$ or $1$)
  - `verificationStatus`: `'unverified' | 'verified' | 'disputed'`
  - `verificationSource`: string (URL, document citation, benchmark log)
  - `outcomeDate`: Date (real-world event occurrence timestamp)
  - `verifiedById`: ObjectId (ref: User)
  - `verifiedByName`: string
  - `verifiedAt`: Date
  - `disputeReason`: string (optional)
  - `disputedById`: ObjectId (ref: User, optional)
  - `disputedAt`: Date (optional)
- `createdAt`: Date
- `updatedAt`: Date

Compound index: `{ decisionId: 1, predictionId: 1 }` (unique).
Index: `{ contributorId: 1, status: 1 }`.

---

## 4. API Endpoints

### 1. `GET /api/decisions/:id/predictions`
- **Auth:** Bearer JWT required.
- **Permission:** Collaborator (`viewer`, `contributor`, `editor`, `owner`).
- **Query Params:** `contributorId`, `status`, `domain`.
- **Response:** Array of prediction records with outcome verification status.

### 2. `POST /api/decisions/:id/predictions`
- **Auth:** Bearer JWT required.
- **Permission:** `contributor`, `editor`, or `owner`.
- **Body:**
  - `statement`: string (non-empty)
  - `probability`: number ($0.0 \le p \le 1.0$)
  - `targetDate`: ISO date string (must be future date)
  - `domain`: string (optional, default `'general'`)
  - `evidenceReferences`: string[] (optional)
- **Response:** Created prediction record.

### 3. `POST /api/decisions/:id/predictions/:predictionId/outcome`
- **Auth:** Bearer JWT required.
- **Permission:** Decision `editor` or `owner`.
- **Body:**
  - `observedOutcome`: number ($0$ or $1$)
  - `outcomeDate`: ISO date string (must be $\ge$ `submittedAt`)
  - `verificationSource`: string (non-empty citation or URL)
  - `verificationStatus`: `'verified' | 'unverified'`
- **Response:** Updated prediction record with outcome.

### 4. `PATCH /api/decisions/:id/predictions/:predictionId/dispute`
- **Auth:** Bearer JWT required.
- **Permission:** Collaborator.
- **Body:**
  - `disputeReason`: string (non-empty explanation)
- **Response:** Disputed prediction record (status updated to `'disputed'`, removed from calibration scoring).

### 5. `GET /api/decisions/:id/calibration`
- **Auth:** Bearer JWT required.
- **Permission:** Collaborator.
- **Response:**
  - Decision-level calibration summary.
  - Per-expert calibration metrics (Brier score, ECE, calibration bins, domain breakdown, experience, evidence count, popularity indicator).
  - Explicit sample size indicators ($N < 3$ flagged as insufficient).
  - Formula definitions and methodology version (`1.0.0`).

