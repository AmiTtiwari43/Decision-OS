# Decision OS — Phase 9 Specification: AI Analyst

## 1. Overview & Architectural Boundaries

Phase 9 introduces an **AI Analyst** subsystem for Decision OS.
The objective is to provide structured, evidence-aware advisory analysis that helps decision makers, editors, and collaborators explore decisions, synthesize perspectives, identify blind spots, and understand trade-offs.

### Core Non-Negotiable Invariants

1. **Strict Separation from Authoritative MCDA Math:**
   - Multi-Criteria Decision Analysis (MCDA) math is executed strictly and exclusively by the canonical decision engine (`packages/decision-engine`).
   - The AI Analyst is **advisory only**. AI output never directly updates authoritative criteria, weights, scores, rankings, ties, sensitivity tipping points, or Monte Carlo win probabilities.
   - When explaining results, the AI service obtains authoritative calculations directly from the backend's stored analysis snapshot (`decision.analysis`). It never performs independent numerical ranking or calculates alternative scores.
   - AI explanations are checked against the stored analysis; numerical claims that contradict the engine are flagged and reconciled with authoritative facts.
   - Golden fixtures G1–G10, `packages/decision-engine`, and `CANONICAL_DECISION_ENGINE_V1_SPEC.md` remain strictly intact and read-only.

2. **Server-Side Provider Abstraction (`AIProvider`):**
   - All AI interactions take place server-side behind a swappable `AIProvider` interface.
   - Credentials (API keys) reside exclusively in server environment variables and are never leaked to client bundles, API responses, or logs.
   - The system supports a deterministic `MockAIProvider` (for hermetic CI/testing/offline development) and concrete external HTTP providers (e.g. Gemini, OpenAI) using standard runtime `fetch` with strict request timeouts.

3. **Grounding & Prompt Injection Defense:**
   - All user-supplied text (decision descriptions, expert rationale, evidence excerpts) is treated as untrusted data.
   - Context is structurally encapsulated in demarcated boundaries (`<untrusted_data>`).
   - System prompts explicitly instruct models to analyze content as raw data and reject embedded attempts to override instructions, trigger tool actions, alter calculation results, or reveal internal state.
   - The model is instructed to acknowledge missing information rather than hallucinating facts or fabricating citations.

4. **Schema Validation & Bounded Retries:**
   - Every AI response is parsed and validated against a strict Zod schema (`aiAnalystOutputSchema`).
   - If an AI response fails JSON parsing or schema validation, the service performs at most one bounded retry with error guidance. If validation fails again, the request fails closed with a structured error.

5. **Explicit Human Action for Proposals:**
   - AI suggestions (such as missing criteria) are returned strictly as advisory proposals.
   - Applying a proposal to a decision requires an explicit human action by an authorized user (`owner` or `editor`) via `POST /api/decisions/:id/ai/proposals/apply`.
   - Adopting a criterion triggers standard decision validation and recalculation workflows.

6. **Authorization & Privacy Filtering:**
   - Access to AI analysis requires authentication and decision read authorization.
   - Unrelated users receive `404 Not Found` (enumeration defense).
   - Context assembly enforces least-privilege scoping: unsubmitted draft contributions of other collaborators are strictly excluded from the AI prompt context.

---

## 2. Capabilities & Output Structure

The AI Analyst supports bounded capabilities:

- `executive_summary`: High-level synthesis of the decision problem, alternatives, and stated constraints.
- `tradeoff_analysis`: Analysis of competing trade-offs citing authoritative scores, winner margins, and sensitivity tipping points.
- `evidence_gaps`: Identification of criteria or options that lack supporting citations or empirical backing.
- `expert_perspectives`: Synthesis of submitted expert contributions, highlighting consensus and divergence without inventing votes.
- `assumptions_questions`: Unstated assumptions and targeted follow-up questions to gather missing information.
- `suggest_criteria`: Advisory criteria proposals with suggested initial weights and rationale.
- `all`: Comprehensive analysis combining all capabilities.

### Output Schema (`AiAnalystOutput`)

```typescript
export interface AiCriterionProposal {
  id: string;
  name: string;
  description: string;
  suggestedWeight: number;
  direction: 'benefit' | 'cost';
  rationale: string;
}

export interface AiEvidenceGap {
  targetType: 'decision' | 'option' | 'criterion' | 'contribution';
  targetId: string;
  targetName: string;
  gapDescription: string;
  recommendation: string;
}

export interface AiExpertPerspectiveSummary {
  totalContributionsAnalyzed: number;
  consensusAreas: string[];
  divergenceAreas: string[];
  keyInsights: string[];
}

export interface AiAnalystOutput {
  executiveSummary: string;
  tradeoffAnalysis?: {
    winnerObservation?: string;
    keyTradeoffs: string[];
    sensitivityNotes: string[];
  };
  evidenceGaps: AiEvidenceGap[];
  expertSummary?: AiExpertPerspectiveSummary;
  assumptions: string[];
  followUpQuestions: string[];
  suggestedCriteria: AiCriterionProposal[];
}
```

---

## 3. Permission Matrix

| Role | Request AI Analysis (`/ai/analyze`) | Apply Criterion Proposal (`/ai/proposals/apply`) | Context Visibility |
| :--- | :---: | :---: | :--- |
| **Owner** | Yes (`200`) | Yes (`200`) | Full decision, all submitted contributions, own draft, all evidence |
| **Editor** | Yes (`200`) | Yes (`200`) | Full decision, all submitted contributions, own draft, all evidence |
| **Contributor** | Yes (`200`) | No (`403 Forbidden`) | Full decision, all submitted contributions, own draft only, all evidence |
| **Viewer** | Yes (`200`) | No (`403 Forbidden`) | Full decision, all submitted contributions, zero drafts, all evidence |
| **Unrelated User**| No (`404 Not Found`) | No (`404 Not Found`) | None (isolated) |
| **Unauthenticated**| No (`401 Unauthorized`) | No (`401 Unauthorized`) | None |

---

## 4. API Endpoints

### 1. Request AI Analysis
`POST /api/decisions/:id/ai/analyze`

- **Auth:** Bearer JWT required.
- **Permission:** Collaborator (`viewer`, `contributor`, `editor`, `owner`).
- **Body:**
  ```json
  {
    "capability": "all" // "all" | "executive_summary" | "tradeoff_analysis" | "evidence_gaps" | "expert_perspectives" | "assumptions_questions" | "suggest_criteria"
  }
  ```
- **Response:** `200 OK`
  ```json
  {
    "decisionId": "6512bd...",
    "analysisType": "all",
    "generatedAt": "2026-10-30T01:00:00.000Z",
    "provider": "mock",
    "model": "decision-analyst-v1",
    "isAiGenerated": true,
    "disclaimer": "This analysis was generated by an AI assistant for advisory purposes. It does not alter or replace authoritative MCDA engine calculations.",
    "output": { ... }
  }
  ```

### 2. Apply Advisory Proposal
`POST /api/decisions/:id/ai/proposals/apply`

- **Auth:** Bearer JWT required.
- **Permission:** Decision `owner`, `editor`, or `admin`. (`403 Forbidden` for `contributor` or `viewer`).
- **Body:**
  ```json
  {
    "type": "add_criterion",
    "criterion": {
      "id": "compliance",
      "name": "Regulatory Compliance",
      "weight": 20,
      "direction": "benefit"
    }
  }
  ```
- **Response:** `200 OK` with updated `DecisionDto`.

