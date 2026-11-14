# Decision OS — Comprehensive Features Reference & Manual Verification Guide

> **Document Status**: Certified System Manual & Verification Standard  
> **Release Target**: Decision OS Presentation & Enterprise Release (v1.0.0-final)  
> **Repository Path**: `c:\Users\tiwar\Downloads\Decision-OS-main\Decision-OS-main`  
> **Canonical Engine**: `@decision-os/decision-engine` (Pure TypeScript, Mathematical Spec Hash: `sha256-238175f214c7ec8d135e5c5f399435998c0ca8b63fdf644538859fbf78f0d87b`)  
> **Automated Suite Parity**: Validates all 17 presentation requirements, 35 browser E2E scenarios, and 893 automated tests.

---

## 1. Executive Overview & System Architecture

**Decision OS** is an enterprise-grade multi-criteria decision infrastructure platform designed to replace ungrounded intuition, messy spreadsheets, and black-box generative AI prompts with **deterministic, mathematically explainable Multi-Criteria Decision Analysis (MCDA)**.

### Architectural Tenets
1. **Deterministic Mathematical Authority**: Evaluation scores are computed purely via Weighted Linear Combination (WLC) in TypeScript. Mathematical calculations are strictly isolated from language models.
2. **Incomplete & Synthetic Data Safeguards**: Decisions cannot evaluate missing data. Synthetic demo values are permanently tagged with coordinate provenance and blocked from authoritative certification by server-side HTTP 422 guards.
3. **Strict Separation of Concerns (Rule #14 & Rule #15)**:
   - **Rule #14 (Human Authority Boundary)**: AI advisory intelligence can explain, stress-test, and suggest, but is architecturally forbidden from mutating authoritative weights, criteria, or scores without explicit human confirmation.
   - **Rule #15 (Non-Fabrication Invariant)**: External citations and empirical references are presented with authentic provenance and marked as `Unverified Citation` rather than fabricating third-party validation.
4. **Tamper-Evident Cryptographic Ledger**: Every state mutation is recorded in an append-only (WORM) audit log linked via a SHA-256 hash chain ($H_n = \text{SHA-256}(H_{n-1} + \text{Payload})$).
5. **Dual-Topology Database Resiliency**: Full multi-document ACID transaction rollback on MongoDB Replica Sets, combined with a durable outbox self-healing protocol on Standalone MongoDB nodes.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            DECISION OS ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  Frontend (React 19 + Vite + Tailwind CSS + Lucide + Framer Motion)         │
│  Port: 5173                                                                 │
│  ├── Interactive Decision Studio (MCDA Matrix, Weight Sliders, Locks)        │
│  ├── Sensitivity & Tipping Point Analyzer (Analytical Breakeven Calculus)   │
│  ├── Monte Carlo Stochastic Simulation Engine (5,000 Iterations)            │
│  ├── Collaboration Hub (RBAC, Token Invitations, Deliberation Threads)      │
│  ├── Expert Contribution Review & Variance Adoption Drawer                  │
│  ├── AI Advisory Analyst (Rule #14 Boundary, MDAR v1 Ranking)               │
│  ├── Empirical Evidence Ledger & Missing Coverage Diagnostics               │
│  ├── Expert Calibration & Prospective Forecast Intelligence (Brier/ECE/BSS) │
│  └── Boardroom Export Center (11-Component JSON, Sanitized CSV, HTML Brief)  │
├─────────────────────────────────────────────────────────────────────────────┤
│  Backend API (Fastify 5 + TypeScript + Zod Validation + JWT Auth)            │
│  Port: 3000 (/api)                                                          │
│  ├── Route Layer: RBAC Guard, Fastify JWT Auth, Zod Validation Middleware   │
│  ├── Decision Service: State Lifecycle, Hare-Niemeyer Normalizer, Locks     │
│  ├── Synthetic Provenance Guard: Cell-level flags, HTTP 422 Engine Blocker  │
│  ├── Audit Service: SHA-256 Hash Chaining, WORM Middleware, Verification   │
│  ├── Export Service: RFC 4180 CSV Sanitizer, JSON Package, HTML Generator   │
│  └── Dual Outbox Engine: Standalone Durable Queue & Replica Set Rollback    │
├─────────────────────────────────────────────────────────────────────────────┤
│  Pure Mathematical Engine (@decision-os/decision-engine)                    │
│  ├── Weighted Linear Combination (WSM) Utility Calculation                  │
│  ├── Closed-Form Analytical Sensitivity & Tipping Point Calculus            │
│  ├── Hare-Niemeyer Largest-Remainder Normalization with Lock Invariance     │
│  └── Deterministic Suggestion Ranking (MDAR v1 Algorithm)                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  Data Layer (MongoDB Dual Topology)                                         │
│  ├── Standalone Port: 27017 (Standard Local Dev / Durable Outbox Mode)      │
│  └── Replica Set Port: 27018 (Production / ACID Multi-Doc Transactions)    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Environment Setup & Pre-Flight Checklist

### 2.1 Starting the Services

Open a terminal at the repository root (`Decision-OS-main/Decision-OS-main`):

```bash
# 1. Install dependencies (if not already done)
npm install

# 2. Start both Backend API (:3000) and Web Frontend (:5173) in development mode
npm run dev
```

Both services will start concurrently:
- **Web Application**: [http://localhost:5173](http://localhost:5173)
- **API Server**: [http://localhost:3000/api](http://localhost:3000/api)
- **API Health Check**: [http://localhost:3000/api/health](http://localhost:3000/api/health)

### 2.2 Certified Demo Accounts & Credentials

The platform includes pre-seeded demonstration accounts. In the Web UI, you can populate the presenter credentials with a single click using the **`⚡ Fill Presentation Demo Credentials`** button on the Sign In modal.

| Persona / Role | Email | Password | Role Purpose |
| :--- | :--- | :--- | :--- |
| **Lead Presenter (Owner)** | `lead@decision-os.org`<br>*(or `demo.presenter@decision-os.org`)* | `DecisionOS@2026`<br>*(or `DemoPass123!`)* | Primary presenter account with complete administrative control. |
| **Domain Expert (Contributor)** | `expert.sarah@decision-os.org` | `DemoPass123!` | External cloud architect submitting independent evaluations. |
| **Board Observer (Viewer)** | `board.observer@decision-os.org` | `DemoPass123!` | Read-only governance auditor reviewing cryptographic proofs. |

### 2.3 Automated Sanity Commands

Before conducting manual walkthroughs, run these automated verification commands:

```bash
# Reset & seed canonical demo dataset safely (non-destructive to real accounts)
npm run demo:reset

# Programmatically verify all 17 presentation lifecycle steps
npm run demo:verify
```

---

## 3. Comprehensive Features Directory

### Feature 1: Deterministic Multi-Criteria Decision Studio
- **Mathematical Specification**: Evaluates option scores using Weighted Linear Combination:
  $$\text{Score}(o_j) = \sum_{i=1}^{n} w_i \cdot s_{ij}$$
  Where $w_i \in [0, 1]$ represents the normalized criterion weight such that $\sum_{i=1}^n w_i = 1.0$, and $s_{ij} \in [0, 100]$ represents the raw score of alternative $j$ on criterion $i$.
- **Zero Rounding Perturbation**: Pure TypeScript calculation eliminates floating-point drift.
- **Explainability Lead Margin**: Authoritative calculations output rank, weighted scores, and exact winning delta margin:
  $$\Delta = \text{Score}_{\text{winner}} - \text{Score}_{\text{runner-up}}$$

### Feature 2: Hare-Niemeyer Weight Normalization & Lock Invariance
- **Formula**: Real-time slider adjustments use largest-remainder integer normalization:
  $$\text{weight}_i = \left\lfloor \frac{w'_i}{\sum w'} \times 100 \right\rfloor + r_i$$
- **Locked Invariance**: When a criterion is locked (e.g., Technical Architecture locked at 60%), adjusting other unlocked sliders scales *strictly* within the remaining pool (40%), guaranteeing that the locked criterion never drifts by even 0.01%.

### Feature 3: Incomplete-Score Protection
- **Integrity Rule**: If any cell in the active evaluation matrix is empty, non-numeric, or null, authoritative ranking is immediately halted.
- **UI Indication**: The studio displays an amber warning banner: *"Incomplete Scores: All candidate options must be scored across every criterion before authoritative ranking can be computed."* Winner badges and export certifications are disabled.

### Feature 4: Synthetic Demo-Fill & Cell-Level Provenance Tracking
- **Purpose**: Allows users and evaluators to quickly explore calculations using realistic dummy values.
- **Safety Safeguard**: When synthetic values are populated:
  1. A persistent high-contrast amber/yellow banner appears: *"Synthetic Demo Values Present"*.
  2. The cell coordinates are stored in MongoDB with `{ isSynthetic: true }`.
  3. Every synthetic cell displays a distinctive visual marker.
  4. The platform prevents synthetic values from being represented as real empirical evidence.

### Feature 5: Authoritative Analysis Safeguards (HTTP 422 Block)
- **API Guard**: When a client requests official evaluation certification or tries to lock an authoritative decision containing synthetic coordinates, the API rejects the request with **HTTP 422 Unprocessable Entity**:
  ```json
  {
    "statusCode": 422,
    "error": "Unprocessable Entity",
    "message": "Authoritative calculation blocked: Decision contains synthetic scores that must be evaluated with real evidence.",
    "code": "SYNTHETIC_SCORE_BLOCKED",
    "syntheticCoordinates": [{ "optionId": "opt-beta", "criterionId": "crit-cost" }]
  }
  ```
- **Provenance Eviction**: Replacing a synthetic score with a user-entered score immediately evicts the coordinate from the provenance ledger. When all coordinates are replaced, the synthetic banner automatically vanishes.

### Feature 6: Closed-Form Analytical Sensitivity & Tipping Points
- **Calculus Foundation**: Computes the exact weight threshold $w_k^*$ where the ranking between Option Alpha ($A$) and Option Beta ($B$) flips, without brute-force iterative steps:
  $$w_k^* = \frac{\sum_{i \neq k} w_i (s_{Bi} - s_{Ai}) - \Delta_{\text{current}}}{s_{Ak} - s_{Bk} - \sum_{i \neq k} \frac{w_i}{1 - w_k}(s_{Ak} - s_{Bk})}$$
- **Canonical Dataset Demonstration**:
  - Baseline: Technical Architecture 60%, Cost Efficiency 40%. Winner: Option Alpha (82.0 vs 78.0, +4.0 margin).
  - Breakeven Parity: At exactly 50.0% Cost Efficiency, both options tie at 80.0 pts.
  - Decision Flip: Above 50.0% (e.g., 51.0% Cost Efficiency), Option Beta decisively takes the lead (80.2 vs 79.8).

### Feature 7: Monte Carlo Stochastic Robustness Simulation
- **Capability**: Runs 5,000 randomized Monte Carlo iterations perturbing criteria weights and scores across Gaussian confidence intervals.
- **Outputs**:
  - Probability of Option Alpha winning vs Option Beta.
  - 95% Confidence Interval distribution curves.
  - Risk boundary analysis revealing vulnerability to estimation errors.

### Feature 8: Granular Role-Based Access Control (RBAC) & IDOR Defense
- **Role Hierarchy**:
  - **Owner**: Full lifecycle control, editing, inviting, deleting, contribution adoption, and audit export.
  - **Editor**: Can update framing, weights, options, criteria, and scores. Cannot delete decisions or revoke invitations.
  - **Contributor**: Can view decision, participate in threaded deliberation, and submit private expert scoring proposals. Cannot modify the authoritative model directly.
  - **Viewer**: Read-only access to decision parameters, calculations, and public audit history.
- **IDOR Defense**: Accessing an unshared decision returns **HTTP 404 (Not Found)** rather than HTTP 403, preventing resource enumeration.

### Feature 9: Cryptographic Token Collaborator Invitations
- **Implementation**: Invitations generate cryptographically secure 256-bit random tokens stored as SHA-256 hashes in MongoDB.
- **Security Guardrails**:
  - Expired tokens are rejected with HTTP 401.
  - Tokens cannot be redeemed more than once.
  - Duplicate invitations for the same email are idempotently deduplicated (HTTP 409).

### Feature 10: Multi-Stakeholder Independent Expert Contributions
- **Workflow**: Invited domain experts (`contributor` role) access a specialized independent scoring sandbox.
- **Isolation**: Contributor inputs do not alter the authoritative model. Contributors specify utility scores, confidence ratings (1–5 stars), and detailed technical rationales.

### Feature 11: Owner Review Drawer & Variance Adoption
- **Comparative Review**: The decision Owner inspects expert submissions via an interactive visual comparison drawer.
- **Features**:
  - Side-by-side variance delta computation ($|s_{\text{owner}} - s_{\text{expert}}|$).
  - Selective adoption: The owner can adopt the entire scoring matrix or adopt scores for specific criteria only.
  - Optimistic concurrency control: Updates are version-fenced (`version: n + 1`).

### Feature 12: Threaded Deliberation & Contextual Discussion
- **Structure**: 1-level threaded deliberation attached to decisions, options, criteria, or matrix coordinates.
- **Moderation & Tombstones**: Comments support author attribution, resolved/unresolved toggles, and deletion tombstones (*"This comment was deleted by a moderator"*), preserving thread context.

### Feature 13: Expert Prediction Calibration & Brier Score Intelligence
- **Empirical Calibration**: Tracks prospective expert forecasts against real-world observed outcomes over time.
- **Statistical Metrics**:
  - **Brier Score**: Quadratic probabilistic error (0.0 = perfect calibration, 0.25 = uninformative guessing).
  - **Expected Calibration Error (ECE)**: Weighted difference between stated probabilities and actual observed frequencies across confidence bins.
  - **Brier Skill Score (BSS)**: Skill relative to empirical sample climatological base rates.
  - **Reliability Diagram Bins**: Tabulation across 10 probability intervals ($0.0-0.1, \dots, 0.9-1.0$).
  - **Dimension Separation**: Keeps calibration accuracy segregated by domain (e.g., Engineering vs Finance vs Security).

### Feature 14: AI Advisory Analyst with Non-Authoritative Boundary (Rule #14)
- **Role**: AI provides heuristic review, bias detection (anchoring, loss aversion, halo effect), trade-off synthesis, and criteria/alternative proposals.
- **Rule #14 Enforcement**: AI suggestions are strictly advisory. The AI cannot mutate authoritative scores or weights. Adopting an AI proposal requires explicit human clicks that route through standard validation.

### Feature 15: Deterministic Suggestion Ranking (MDAR v1 Algorithm)
- **Algorithm**: Ranks advisory recommendations deterministically:
  $$S = 0.40 \cdot \text{Impact} + 0.25 \cdot \text{Feasibility} + 0.20 \cdot \text{Evidence} + 0.15 \cdot \text{Alignment}$$
- **Tie-Breaking**: Deterministic lexicographic sort by criterion ID and category.

### Feature 16: Empirical Evidence & Provenance Ledger (Rule #15)
- **Grounding**: Attach empirical URLs, benchmark PDFs, document citations, and verbatim excerpts to options, criteria, or decisions.
- **Rule #15 Enforcement**: Citations provide human context and are labeled `Unverified Citation`. They never artificially fabricate verified third-party endorsements or alter mathematical weights.
- **Coverage Diagnostics**: Automatically flags options or criteria lacking empirical evidence citations.

### Feature 17: Append-Only Immutable Cryptographic Audit Trail (SHA-256)
- **WORM Ledger**: Mongoose schema middleware intercepts and rejects all update and delete queries on `AuditEventModel`.
- **SHA-256 Hash Chaining**: Every event embeds the previous hash:
  $$\text{Hash}_n = \text{SHA-256}(\text{Hash}_{n-1} \parallel \text{Sequence} \parallel \text{Action} \parallel \text{Timestamp} \parallel \text{ActorId} \parallel \text{Payload})$$
- **Tamper Simulation**: Built-in demonstration feature allowing testers to simulate out-of-band database tampering and observe instant cryptographic verification failure with compromised event ID identification.

### Feature 18: Decision State Version History & Granular Diffs
- **Snapshots**: Historical milestone states are captured with engine versions and specification hashes.
- **Diff Engine**: Inspects exact attribute additions, removals, and numeric score shifts between any two versions.

### Feature 19: Boardroom Export Center (11-Component Multi-Format Bundle)
- **Export Formats**:
  1. **Full JSON Package**: Machine-readable specification with complete mathematical evaluation results, provenance tags, and verified cryptographic audit proof.
  2. **Spreadsheet CSV Matrix**: RFC 4180-compliant CSV with criteria weights, scores, and sensitivity tipping points. Protected against formula injection attacks by escaping leading `=`, `+`, `-`, `@`, `|`.
  3. **Executive HTML Briefing**: Standalone executive briefing formatted for printing or browser presentation with rankings, methodology documentation, and signature blocks.

### Feature 20: Dual-Topology Database Resiliency
- **Standalone Mode (Port 27017)**: Employs a Durable Outbox Pattern with automatic self-healing crash recovery across crash boundaries A through E.
- **Replica Set Mode (Port 27018)**: Executes multi-document ACID transactions with automatic rollback on validation failure.

---

## 4. Step-by-Step Manual Verification Procedures

Follow these 20 procedures to manually verify every feature in Decision OS from end to end.

---

### Procedure 1: User Authentication, Session Persistence & Quick-Fill
**Objective**: Verify secure authentication, session restoration, and demo persona quick-fill.

1. Navigate to [http://localhost:5173](http://localhost:5173).
2. Click **"Sign In"** in the top navigation bar.
3. Observe the **"⚡ Fill Presentation Demo Credentials"** button. Click it.
   - *Expected*: Email field populates with `lead@decision-os.org` and password with `DecisionOS@2026`.
4. Click **"Sign In to Decision OS"**.
   - *Expected*: Modal closes; navigation bar updates to show user avatar and *"Alex Rivera"* (Lead Architect).
5. Open browser DevTools $\to$ Application $\to$ Local Storage $\to$ `http://localhost:5173`.
   - *Expected*: `decision_os_token` contains a valid JWT string.
6. Refresh the browser page (`F5`).
   - *Expected*: Session persists seamlessly without prompting for login.
7. Click the user profile pill $\to$ **"Sign Out"**.
   - *Expected*: Session token is cleared from localStorage; UI returns to unauthenticated state.
8. Re-authenticate using the demo credentials to prepare for subsequent tests.

---

### Procedure 2: Decision Creation from Template & Custom Framing
**Objective**: Verify creating a structured decision model.

1. On the Dashboard, click **"+ New Decision"**.
2. In the modal, select the **"Enterprise Cloud Provider Decision"** template (or click "Start from Scratch").
3. Input the following framing parameters:
   - **Title**: `Enterprise Cloud Provider Decision`
   - **Question**: `Which cloud provider provides the optimal architecture and cost balance?`
   - **Context**: `Evaluating primary cloud hosting infrastructure for 2027 enterprise migration.`
4. Click **"Create Decision Studio"**.
   - *Expected*: The interactive Decision Studio loads. The URL changes to `http://localhost:5173/?decisionId=<id>`.

---

### Procedure 3: Criteria Management, Normalization & Weight Locks
**Objective**: Verify the Hare-Niemeyer discrete normalization algorithm and locked criteria invariance.

1. In the studio, inspect the **Criteria & Weights** section.
2. Ensure two criteria exist:
   - **Technical Architecture** (Direction: `benefit`)
   - **Cost Efficiency** (Direction: `benefit`)
3. Adjust the **Cost Efficiency** slider.
   - *Expected*: The weights automatically balance so that their sum equals exactly 100%.
4. Set **Technical Architecture** to `60%` and click the **Lock** icon next to it.
   - *Expected*: The lock icon turns green/active; the slider indicates it is locked at 60%.
5. Attempt to drag the **Cost Efficiency** slider or add a third criterion (e.g., `Security Compliance`).
   - *Expected*: Technical Architecture remains locked at exactly 60.0%. Any remaining criteria balance strictly within the remaining 40.0% pool.
6. Delete the temporary third criterion and leave Technical Architecture (60%, locked) and Cost Efficiency (40%, unlocked).

---

### Procedure 4: Alternatives Configuration
**Objective**: Verify candidate option creation with custom branding and descriptions.

1. In the **Alternatives / Candidates** section, verify or create:
   - **Option Alpha (Specialized)**:
     - Badge: `Top Tier Architecture`
     - Color: `#38BDF8` (Sky Blue)
     - Description: `Premium developer velocity and Kubernetes runtime.`
   - **Option Beta (Cost-Optimized)**:
     - Badge: `Frugal Infrastructure`
     - Color: `#B8FF5A` (Signal Neon)
     - Description: `40% lower compute and committed-use discounts.`
2. Verify both options appear in the Score Matrix.

---

### Procedure 5: Incomplete-Score Protection
**Objective**: Verify that missing matrix values prevent premature or misleading ranking.

1. In the **Score Matrix**, leave the Cost Efficiency score for Option Beta blank (or clear the cell).
2. Observe the **Results & Ranking** panel at the top right.
   - *Expected*: Evaluation is halted.
   - *Expected*: The panel displays an amber notice: *"Incomplete Scores: All candidate options must be scored across every criterion before authoritative ranking can be computed."*
   - *Expected*: No winning option or utility score is declared.

---

### Procedure 6: Synthetic Demo-Fill & Provenance Warning
**Objective**: Verify synthetic demo score population, visual warning banners, and database provenance persistence.

1. In the Score Matrix toolbar, click **"⚡ Demo Fill (Synthetic)"**.
2. A confirmation modal appears explaining that synthetic scores are for demonstration only. Click **"Fill Synthetic Scores"**.
   - *Expected*: Cells populate with sample numbers.
   - *Expected*: A prominent yellow/amber banner appears above the studio: *"Synthetic Demo Values Present — Cannot be certified for authoritative boardroom sign-off"*.
   - *Expected*: Synthetic cells carry purple/amber coordinate badges (`DEMO`).
3. Open browser DevTools $\to$ Network tab. Inspect the response payload of `PUT /api/decisions/:id/scores`.
   - *Expected*: The scores payload contains `provenance: { isSynthetic: true }` associated with the cell coordinates.

---

### Procedure 7: Authoritative Analysis Safeguard (HTTP 422 Block)
**Objective**: Verify that the backend API strictly enforces synthetic score boundaries.

1. With synthetic scores populated, click the **"Certify & Lock Decision"** button (or trigger authoritative export).
2. Observe the application response:
   - *Expected*: An error modal/toast appears indicating that authoritative certification is blocked while synthetic coordinates are present.
3. Open DevTools $\to$ Network tab. Observe the failed request:
   - *Status*: `422 Unprocessable Entity`
   - *Response Body*: Contains `code: "SYNTHETIC_SCORE_BLOCKED"` and lists the un-replaced coordinates.

---

### Procedure 8: Real Score Replacement & Provenance Eviction
**Objective**: Enter canonical human scores and verify that synthetic provenance is completely evicted.

1. Manually type the canonical evaluation scores into the matrix:
   - **Option Alpha (Specialized)**:
     - Technical Architecture: `90.0`
     - Cost Efficiency: `70.0`
   - **Option Beta (Cost-Optimized)**:
     - Technical Architecture: `70.0`
     - Cost Efficiency: `90.0`
2. Observe the interface immediately upon typing the final score:
   - *Expected*: The yellow synthetic warning banner immediately disappears.
   - *Expected*: The `DEMO` badges vanish from all cells.
   - *Expected*: The authoritative ranking panel activates.

---

### Procedure 9: Canonical MCDA Ranking & Explainability Calculation
**Objective**: Verify the exact mathematical calculations of the canonical presentation dataset.

1. Inspect the **Rankings & Outcomes** card:
   - *Expected Winner*: **Option Alpha (Specialized)** with **82.00 pts**
     $$\text{Score} = (90 \times 0.60) + (70 \times 0.40) = 54.0 + 28.0 = 82.0\text{ pts}$$
   - *Expected Runner-Up*: **Option Beta (Cost-Optimized)** with **78.00 pts**
     $$\text{Score} = (70 \times 0.60) + (90 \times 0.40) = 42.0 + 36.0 = 78.0\text{ pts}$$
   - *Expected Lead Margin*: **+4.00 pts**
   - *Status*: `Decisive Win`

---

### Procedure 10: Closed-Form Analytical Sensitivity & Tipping Points
**Objective**: Verify analytical sensitivity calculus and tipping point thresholds.

1. In the studio toolbar, click **"Sensitivity Analysis"** (or open the Sensitivity tab).
2. Locate the tipping point card for **Cost Efficiency**:
   - *Expected Finding*: The tipping point is displayed at **50.0%**.
   - *Expected Description*: *"At 50.0% Cost Efficiency (+10.0% increase), Option Alpha and Option Beta reach exact breakeven parity at 80.0 pts. Above 50.0%, Option Beta becomes the #1 choice."*
3. Test Breakeven Parity:
   - Unlock Technical Architecture and set Cost Efficiency to `50.0%` (Technical Architecture adjusts to `50.0%`).
   - *Expected*: Both options score exactly `80.00 pts`. The outcome badge displays **"Tie / Parity"** with a lead margin of `0.00 pts`.
4. Test Decisive Flip:
   - Increase Cost Efficiency to `51.0%` (Technical Architecture adjusts to `49.0%`).
   - *Expected*: Option Beta flips to #1 with `80.20 pts` vs Option Alpha #2 with `79.80 pts` (+0.40 lead margin).
5. Return weights to baseline: Technical Architecture `60.0%` (locked) and Cost Efficiency `40.0%`.

---

### Procedure 11: Monte Carlo Probabilistic Simulation
**Objective**: Verify stochastic robustness testing across 5,000 iterations.

1. In the studio, click the **"Monte Carlo"** simulation button.
2. In the modal, leave the default parameters (5,000 iterations, standard error $\pm 5\%$).
3. Click **"Run 5,000 Iteration Simulation"**.
   - *Expected*: Simulation completes in under 1 second.
   - *Expected*: Visual histogram renders showing score distribution curves.
   - *Expected*: Option Alpha win probability reflects its baseline dominance (~85–90% win rate under moderate variance).
   - *Expected*: 95% Confidence Interval values are displayed for both options.

---

### Procedure 12: Collaborator Invitation & RBAC Enforcement
**Objective**: Verify inviting an external expert with the `contributor` role.

1. In the studio header, click **"Share / Invite"**.
2. In the Share modal, enter:
   - **Email**: `expert.sarah@decision-os.org`
   - **Role**: `Contributor`
3. Click **"Send Invitation"**.
   - *Expected*: An invitation is generated and added to the active collaborators list with status `Pending`.
   - *Expected*: A secure invitation link is displayed (containing token).
4. Copy the invitation URL or open an Incognito browser window.
5. In the Incognito window, sign in as `expert.sarah@decision-os.org` (`DemoPass123!`).
6. Navigate to the decision URL.
   - *Expected*: Sarah can view the decision and access the deliberation/contribution panels.
   - *Expected*: Sarah *cannot* delete the decision or change the authoritative locked criteria.

---

### Procedure 13: Independent Expert Contribution Submission
**Objective**: Verify a contributor submitting independent scores without altering the authoritative model.

1. In the Incognito window (as `expert.sarah@decision-os.org`), click **"Submit Expert Contribution"**.
2. In the contribution form, enter Sarah's assessment:
   - Technical Architecture: Option Alpha = `95`, Option Beta = `65`
   - Cost Efficiency: Option Alpha = `60`, Option Beta = `95`
   - Confidence Level: `5 Stars` (High Confidence)
   - Rationale: *"Extensive containerized microservice benchmarks demonstrate Alpha has superior developer velocity despite higher unit costs."*
3. Click **"Submit Recommendation Draft"**.
   - *Expected*: Sarah receives confirmation: *"Contribution submitted successfully. Awaiting owner review."*
4. Switch back to the primary browser window (as Alex Rivera, Owner).
   - *Expected*: The authoritative scores and rankings remain completely unchanged at 82.0 vs 78.0.

---

### Procedure 14: Owner Review Drawer & Contribution Adoption
**Objective**: Verify the decision owner reviewing variance and selectively adopting expert recommendations.

1. In the primary window (as Alex Rivera, Owner), notice the notification badge on **"Contributions (1)"**. Click it.
2. The **Contribution Review Drawer** opens showing Sarah Chen's submission.
3. Observe the side-by-side variance matrix:
   - Option Alpha Tech: Owner `90` vs Expert `95` ($\Delta = +5$)
   - Option Beta Cost: Owner `90` vs Expert `95` ($\Delta = +5$)
4. Click **"Selective Adoption"** $\to$ select **Technical Architecture** only $\to$ click **"Adopt Selected Scores"**.
   - *Expected*: The authoritative model updates Technical Architecture scores (Alpha = `95`, Beta = `70`).
   - *Expected*: Decision version advances from `v1` to `v2`.
   - *Expected*: An audit log record is created: `CONTRIBUTION_ADOPTED`.
5. Restore canonical scores (`90`, `70` / `70`, `90`) to return to baseline.

---

### Procedure 15: Threaded Deliberation with Cell References
**Objective**: Verify threaded stakeholder comments and contextual cell references.

1. In the studio matrix, click the **Chat/Comment** icon on cell `(Option Alpha, Technical Architecture)`.
2. The **Deliberation Drawer** opens, filtered to that cell coordinate.
3. Type: *"Benchmark verified on AWS EKS runtime under sustained 50k rps load."*
4. Click **"Post Deliberation Comment"**.
   - *Expected*: The comment appears with Alex Rivera's avatar, timestamp, and a coordinate link.
5. In the Incognito window (as Sarah Chen), open the Deliberation drawer.
   - *Expected*: The comment is immediately visible.
   - *Expected*: Sarah can reply to the thread. Post reply: *"Confirmed. Matches our internal benchmarks."*

---

### Procedure 16: Expert Prediction Calibration (Brier Score Intelligence)
**Objective**: Verify prospective empirical forecast tracking and Brier error metrics.

1. In the studio toolbar, click **"Expert Calibration"**.
2. In the modal, observe the **Calibration & Dimensions** tab:
   - **Brier Score KPI Card**: Displays probabilistic error (lower is better).
   - **ECE Card**: Expected Calibration Error.
   - **Brier Skill Score (BSS)**: Skill relative to sample base rate.
   - **Reliability Diagram Table**: Shows calibration across standard probability bins ($0-10\%, 10-20\%, \dots$).
   - **Domain Performance Breakdown**: Shows accuracy segregated by Engineering, Finance, and Security.
3. Switch to the **Forecasts & Outcomes** tab.
4. Click **"Submit Prospective Forecast"** and enter:
   - Statement: `Option Alpha will maintain < 5ms latency during Black Friday traffic.`
   - Probability: `85%`
   - Target Date: Select a future date.
   - Domain: `Engineering`
5. Click **"Submit Prospective Forecast"**.
   - *Expected*: The forecast is logged with status `awaiting_outcome`.
6. Click **"Record Verified Outcome"** on a pending forecast:
   - Observed Outcome: `1 — Event Occurred as Predicted`
   - Verification Source: `Datadog Production Metrics Report #892`
   - Click **"Confirm Outcome"**.
   - *Expected*: Status updates to `verified`; Brier metrics update.

---

### Procedure 17: AI Advisory Analyst & Explainable Ranking (MDAR v1)
**Objective**: Verify AI advisory analysis, Rule #14 non-authoritative boundary, and MDAR v1 ranking transparency.

1. In the studio toolbar, click **"AI Advisory Analyst"**.
2. Select **"Comprehensive Advisory Review"** and click **"Generate Advisory Insights"**.
3. Inspect the advisory output:
   - **Executive Advisory Summary**: Synthesizes the decision trade-offs without mutating numbers.
   - **Cognitive Bias Alerts**: Flags potential anchoring or confirmation biases.
   - **Trade-off Analysis**: Summarizes benefits vs operational risks.
4. Inspect the **Ranked Advisory Proposals**:
   - Observe the score badge on each suggestion (e.g., `87.5 pts`).
   - Click **"View Ranking Breakdown (MDAR v1)"**:
     - *Expected*: Displays transparent formula components:
       $$\text{Score} = (0.40 \times \text{Impact}) + (0.25 \times \text{Feasibility}) + (0.20 \times \text{Evidence}) + (0.15 \times \text{Alignment})$$
5. In the **Suggested Criteria Proposals** section:
   - Notice the proposal: `Security & Compliance` (Suggested weight: 15%).
   - Notice the note: *"Requires human confirmation to adopt"*.
   - Click **"Adopt Criterion"**.
     - *Expected*: The criterion is added to the decision model with user confirmation. The AI itself did not modify the model automatically.
   - Delete the added criterion to return to the 2-criteria canonical baseline.

---

### Procedure 18: Empirical Evidence Ledger & Missing Gaps Diagnostics
**Objective**: Verify empirical citations, Rule #15 Non-Fabrication Invariant, and gap diagnostics.

1. In the studio toolbar, click **"Evidence & Provenance"**.
2. In the **Coverage & Gaps** tab:
   - Observe the status for each option and criterion.
   - Notice whether any candidate is marked with an amber warning: *"Missing empirical evidence (0 citations)"*.
3. Switch to the **Attach Supporting Material** tab:
   - Target: `Option Alpha (Specialized)`
   - Evidence Type: `Web URL / Link`
   - Title: `Independent Kubernetes Cloud Performance Benchmark 2026`
   - Source URL: `https://benchmarks.example.org/k8s-cloud-report-2026.pdf`
   - Source Excerpt: `"Option Alpha sustained 54,200 requests/sec with p99 latency under 4.2ms across all geographic regions."`
   - Relevance: `"Supports the 90.0 technical score entered for Alpha."`
4. Click **"Attach Evidence"**.
   - *Expected*: Record is saved and appears in the **Browse Evidence** tab.
   - *Expected*: The citation badge reads **"Unverified Citation"** (Rule #15 compliance: external claims are acknowledged as human-supplied references without fabricating automated verification).

---

### Procedure 19: Cryptographic Audit Trail Chaining & Tamper Simulation
**Objective**: Verify the SHA-256 hash-chained immutable audit log and live tamper detection.

1. In the studio toolbar, click **"Audit & History"**.
2. Inspect the **Audit Timeline**:
   - Observe the sequence numbers (`#001`, `#002`, `#003`, etc.).
   - Every mutation (decision created, weights adjusted, scores entered, evidence attached) is displayed with an actor, timestamp, and SHA-256 event hash.
3. Inspect the **SHA-256 Hash Chain Integrity** card:
   - *Expected*: Badge displays a green checkmark: **"Chain Verified (100% Intact)"**.
   - Displays total events checked and the current cryptographic head hash.
4. Click **"Re-verify Now"**.
   - *Expected*: System re-computes hashes from Genesis to Head; re-confirms chain integrity.
5. In the presentation showcase (or via developer tools), trigger the **Tamper Demonstration**:
   - The system simulates an unauthorized mutation to event `#002`.
   - Click **"Verify Chain Integrity"**.
   - *Expected*: The badge turns red: **"Chain Integrity Violation"**.
   - *Expected*: Diagnostics display: *"Compromised Event ID: #002 — Cryptographic hash linkage mismatch detected."*
6. Refresh or reset to restore verified chain status.

---

### Procedure 20: Boardroom Export Center (JSON, CSV, HTML Bundle)
**Objective**: Verify the multi-format export center and formula injection sanitization.

1. In the **Audit & History** modal, switch to the **"Export Center"** tab.
2. Review the **11 Guaranteed Export Components Checklist**:
   - `01` Decision Metadata
   - `02` Alternatives Configuration
   - `03` Criteria, Directions & Weights
   - `04` Raw Score Matrix
   - `05` Final MCDA Rankings & Margins
   - `06` Sensitivity Tipping Points
   - `07` Expert Contributions
   - `08` Advisory Suggestions (Labeled Non-Authoritative)
   - `09` Evidence References & Coverage Gaps
   - `10` Chronological Audit History
   - `11` Cryptographic SHA-256 Hash Verification Proof
3. Test **Download JSON**:
   - Click **"Download JSON"**.
   - *Expected*: File `enterprise-cloud-provider-decision-export.json` downloads.
   - Open file: verify valid JSON containing all 11 components and `integrityVerification.isValid: true`.
4. Test **Download CSV**:
   - Click **"Download CSV"**.
   - *Expected*: File `enterprise-cloud-provider-decision-matrix.csv` downloads.
   - Open file: verify RFC 4180 compliance. Inspect cells for formula injection protection (no dangerous unescaped leading `=`).
5. Test **Download Printable Briefing (HTML)**:
   - Click **"Download HTML"**.
   - *Expected*: File `enterprise-cloud-provider-decision-briefing.html` downloads.
   - Open in browser: verify standalone boardroom briefing with executive styling, winner callout, sensitivity analysis, and formal sign-off signature blocks.

---

## 5. Troubleshooting & Diagnostic Commands

| Issue | Root Cause | Resolution |
| :--- | :--- | :--- |
| **Port 3000 already in use** | Stray Fastify or node process from a previous session | Run `Get-Process node \| Stop-Process -Force` in PowerShell, then re-run `npm run dev`. |
| **MongoDB connection refused** | Local MongoDB service is stopped | Start the MongoDB service via Windows Services (`net start MongoDB`) or run `mongod --dbpath <path> --port 27017`. |
| **HTTP 422 on Authoritative Calculation** | Decision still contains synthetic coordinates | Click on any cell marked with `DEMO`, re-type real human scores, or click "Reset to Canonical Dataset". |
| **Invitation Link Not Working** | Token expired or already redeemed | Re-send the invitation from the Share modal to generate a fresh 256-bit token. |
| **Theme styling looks mixed** | Stale browser cache | Hard-refresh the browser with `Ctrl + F5` or open in an Incognito window. |
| **Need clean presentation slate** | Testing from scratch | Run `npm run demo:reset` to restore all demo accounts and canonical decisions to pristine state. |

---

*Certified for the Decision OS Release Freeze by the Engineering Team.*
