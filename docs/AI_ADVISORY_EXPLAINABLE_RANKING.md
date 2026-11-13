# Decision OS — AI Advisory & Explainable Ranking Specification

> **Status**: Canonical Specification & Implementation Guide  
> **Batch**: Batch 03.2 (AI Advisory and Explainable Ranking)  
> **Rule #14 Guarantee**: Canonical MCDA engine remains the sole mathematical authority for decision scores, rankings, weights, and sensitivity calculations.

---

## 1. Executive Summary & Core Invariant

Decision OS integrates Artificial Intelligence exclusively as an **advisory intelligence layer**, never as an authoritative decision engine.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DECISION OS ARCHITECTURE                        │
├───────────────────────────────────────────────────┬────────────────────┤
│           CANONICAL MCDA ENGINE (Sole Authority)   │ AI ADVISORY LAYER  │
│  • Computes Utility Scores (TOPSIS, WSM)          │ • Identifies Gaps  │
│  • Evaluates Normalized Weights                   │ • Proposes Criteria│
│  • Calculates Sensitivity Tipping Points          │ • Suggests Options │
│  • Simulates Monte Carlo Win Probabilities        │ • Evaluates Risks  │
│  • STRICTLY DETERMINISTIC MATHEMATICS              │ • Advisory Ranking │
└───────────────────────────────────────────────────┴────────────────────┘
                               ▲                               │
                               │ Human Explicit Action Only    │
                               │ (Owner / Editor Authorization)│
                               └───────────────────────────────┘
```

### The Non-Negotiable Invariants:
1. **Mathematical Isolation**: No Large Language Model (LLM) or external AI provider ever calculates option utility scores, modifies criterion weights, changes sensitivity numbers, or decides a winner.
2. **Deterministic Recommendation Prioritization**: When multiple advisory suggestions are available, they are prioritized using the transparent, deterministic **Multi-Factor Deterministic Advisory Ranking (MDAR v1)** algorithm.
3. **Non-Probabilistic Framing**: Advisory ranking scores represent heuristic multi-factor priority indices $[0, 100]$, never objective probabilities or statistical likelihoods.
4. **Human Authority Boundaries**: The AI cannot silently mutate any decision data. Any suggestion adopted into the model (such as an added criterion or alternative option) requires an explicit, authenticated, and authorized action (`POST /decisions/:id/ai/proposals/apply`) by an `owner` or `editor`.

---

## 2. Advisory Capabilities Matrix

The AI Advisory Analyst inspects the decision's untrusted context data and authoritative calculation facts to deliver six advisory dimensions:

| Advisory Dimension | Output Model | Architectural Function |
| :--- | :--- | :--- |
| **Decision Context Analysis** | `executiveSummary` | Synthesizes current problem statement, active options, criteria, and authoritative engine outcome. |
| **Potential Missing Criteria** | `suggestedCriteria: AiCriterionProposal[]` | Proposes blind-spot criteria (e.g. regulatory compliance, carbon impact) with directions and suggested weights. |
| **Potential Missing Evidence** | `evidenceGaps: AiEvidenceGap[]` | Flags options or criteria relying solely on unverified qualitative assertions without empirical backing. |
| **Risks & Trade-offs** | `tradeoffAnalysis.risks: AiRiskItem[]` | Maps operational and strategic risks, severity levels (`critical`, `high`, `medium`, `low`), and mitigations. |
| **Alternative Suggestions** | `suggestedAlternatives: AiAlternativeProposal[]` | Proposes unexplored decision alternatives (e.g. hybrid architecture) with trade-offs and advantages. |
| **Expert Input Recommendations** | `expertRecommendations: AiExpertRecommendation[]` | Recommends specific domain disciplines to invite into collaboration threads to resolve scoring disputes. |

---

## 3. Multi-Factor Deterministic Advisory Ranking (MDAR v1)

To prevent users from being flooded with unstructured recommendations, Decision OS ranks all advisory candidates using a transparent, multi-factor deterministic scoring model.

### 3.1 Scoring Formula

$$\text{Composite Score} = \max\left(0, \min\left(100, \text{round}\left(0.35 \cdot S_{\text{criteria}} + 0.25 \cdot S_{\text{evidence}} + 0.25 \cdot S_{\text{urgency}} + 0.15 \cdot S_{\text{confidence}} - P_{\text{missing}}, 1\right)\right)\right)$$

Where:
- **$S_{\text{criteria}} \in [0, 100]$ (Criterion Relevance)**:
  $$\min\left(100, \frac{\sum_{c \in \text{Targeted}} w_c}{\sum_{c \in \text{All}} w_c} \times 100\right)$$
  Measures the cumulative weight of criteria influenced by this suggestion. Defaults to $50$ for decision-wide recommendations.
- **$S_{\text{evidence}} \in [0, 100]$ (Evidence Grounding)**:
  $$40 + \min(60, \text{Count}(\text{Verified Evidence}) \times 20)$$
  Awards points when verified empirical citations in the decision repository substantiate the targeted criteria or options. Base score is $25$ if no evidence is attached.
- **$S_{\text{urgency}} \in [0, 100]$ (Sensitivity Urgency)**:
  Derived from authoritative engine tipping points (`decision.analysis.sensitivity`):
  - $\Delta \le 15\%$: $90$ (Critical tipping point: small weight shift alters the winner).
  - $\Delta \le 30\%$: $70$ (Moderate tipping point).
  - Stable / No tipping point: $40$.
- **$S_{\text{confidence}} \in [0, 100]$ (Stated Heuristic Confidence)**:
  $\min(100, \max(0, \text{Confidence} \times 100))$.
- **$P_{\text{missing}} \in [0, 25]$ (Missing Information Deduction)**:
  $\min(25, \text{Count}(\text{Missing Info Gaps}) \times 5)$.

### 3.2 Deterministic Tie-Breaking
When candidates share identical composite scores, ties are resolved deterministically in strict order:
1. Higher verified supporting evidence count (`supportingEvidence.length` descending).
2. Lower missing information count (`missingInformation.length` ascending).
3. Alphabetical comparison of candidate ID (`id.localeCompare` ascending).

---

## 4. Full Explainability Schema

Every ranked suggestion exposes comprehensive explainability metadata:

```typescript
export interface AiRankedSuggestion {
  id: string;
  rank: number;
  category: 'criterion' | 'alternative' | 'evidence' | 'expert' | 'risk_mitigation';
  title: string;
  explanation: string;
  relevantCriteria: Array<{ id: string; name: string }>;
  supportingEvidence: Array<{ id: string; title: string }>;
  confidence: number;
  uncertaintyLevel: 'low' | 'medium' | 'high';
  rankingScore: number;
  rankingMethodology: string;
  scoreBreakdown: AiSuggestionScoreBreakdown;
  missingInformation: string[];
  potentialBiasOrLimitations: string[];
  
  // Explainability Fields:
  whyThisRank: string;
  criteriaInfluence: string;
  evidenceSupport: string;
  assumptionsMade: string[];
  whatCouldChangeRecommendation: string;
  
  // Human Authority Action Payload:
  actionablePayload?: ApplyProposalPayload;
}
```

---

## 5. Human Authority Boundaries & Proposal Adoption

### 5.1 Authorization Guardrails
- **Viewer Role**: Read-only advisory access. Blocked with `HTTP 403 Forbidden` from applying any proposal.
- **Contributor Role**: Submits independent expert scoring. Blocked with `HTTP 403 Forbidden` from applying proposals.
- **Editor & Owner Roles**: Authorized to review advisory proposals and explicitly adopt them.
- **Unrelated Users**: Blocked with `HTTP 404 Not Found` (enumeration defense).

### 5.2 Supported Human Adoption Actions (`POST /decisions/:id/ai/proposals/apply`)

1. **`add_criterion`**:
   - Validates uniqueness of criterion ID.
   - Appends criterion to `decision.criteria`.
   - **Stale Analysis Policy**: Authoritative `decision.analysis` is set to `null` because options lack scores for the new criterion.
   - Records audit event `ai.proposal_applied`.

2. **`add_option`**:
   - Validates uniqueness of option ID.
   - Appends option to `decision.options`.
   - **Stale Analysis Policy**: Authoritative `decision.analysis` is set to `null` because the new option has no criteria scores.
   - Records audit event `ai.proposal_applied`.

---

## 6. Resilience & Failure Handling Matrix

| Failure Condition | System Behavior | HTTP Status | Frontend Experience |
| :--- | :--- | :--- | :--- |
| **Provider Offline / Unconfigured** | Catches connection/auth failures | `503 Service Unavailable` | Renders clean offline banner; MCDA engine and collaboration remain 100% usable. |
| **Gateway Timeout** | AbortController triggers after timeout | `504 Gateway Timeout` | Displays timeout notification with one-click retry. |
| **Invalid Schema / Non-JSON** | Bounded retry with diagnostic prompt | `502 Bad Gateway` (if retry fails) | Informative error banner with retry option. |
| **Empty Suggestions** | Deterministic ranker returns `[]` | `200 OK` | Renders "No actionable advisory suggestions generated". |
| **Duplicate Proposals** | Deduplicated by ID in ranker; checked in API | `400 Bad Request` on apply | UI disables already-present items with badge. |
| **Malformed Evidence Records** | Sanitizes null/undefined targets safely | Handled in-memory | Ranker executes without crash; defaults to zero evidence score. |
| **Zero Criteria / Zero Options** | Context prompt demarcates empty state | `200 OK` | Advisory executive summary guides user on model construction. |
