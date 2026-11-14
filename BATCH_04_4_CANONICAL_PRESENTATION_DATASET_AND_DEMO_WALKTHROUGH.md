# Decision OS — Batch 04.4: Canonical Presentation Dataset & Demo Walkthrough

> **Document Status**: Certified Authoritative Specification & Presentation Master  
> **Target Release**: Final College Presentation & Production Certification  
> **Canonical Engine**: `@decision-os/decision-engine` (v1.0.0, Pure TypeScript, Spec Hash `sha256-238175f214c7ec8d135e5c5f399435998c0ca8b63fdf644538859fbf78f0d87b`)  
> **Automated Verification**: `npm run demo:verify` (17/17 Requirements Verified)  
> **Environment Reset**: `npm run demo:reset` (Safe, Non-Destructive to Real User Data)  

---

## 1. Executive Summary & Presentation Objective

This document defines the complete, battle-tested presentation blueprint for the **Decision OS College Presentation**. It provides a foolproof, repeatable demonstration of how Decision OS replaces black-box intuition and ungrounded AI predictions with **deterministic, mathematically explainable Multi-Criteria Decision Analysis (MCDA)**.

### Core Value Pillars Demonstrated
1. **Mathematical Authority**: Pure linear algebra weighted sum model (WSM) with exact Hare-Niemeyer largest remainder normalization.
2. **Incomplete & Synthetic Data Safeguards**: Zero tolerance for silent defaults. Missing scores halt rankings; synthetic demo data is permanently tagged with provenance and blocked from authoritative certification.
3. **Rigorous Sensitivity Calculus**: Closed-form analytical tipping point discovery proving exact breakeven and flip boundaries.
4. **Structured Stakeholder Collaboration**: Role-gated domain expert recommendations (`contributor` role) with optimistic version-fenced adoption.
5. **Human Authority Boundaries (Rule #14)**: AI advisory intelligence suggests, explains, and prioritizes without ever mutating authoritative MCDA models.
6. **Immutable Cryptographic Audit**: SHA-256 hash chaining with monotonic sequence tracking, instant out-of-band tamper detection, and formula-injection-sanitized 11-component executive exports.

---

## 2. Canonical Presentation Dataset Specification

To eliminate conflicting numbers, fabricated benchmarks, and placeholder confusion, this exact dataset is hardcoded into the canonical verification test and available as a starter blueprint in the application:

### 2.1 Decision Metadata
- **Title**: `Enterprise Cloud Provider Decision`
- **Question**: `Which cloud provider provides the optimal architecture and cost balance?`
- **Context**: `Evaluating primary cloud hosting infrastructure for 2027 enterprise migration.`

### 2.2 Alternatives Configuration
| Alternative ID | Name | Badge | Color | Focus & Rationale |
| :--- | :--- | :--- | :--- | :--- |
| `opt-alpha` | **Option Alpha (Specialized)** | Top Tier Architecture | `#38BDF8` (Sky Blue) | Premium developer velocity, sub-millisecond cold starts, cutting-edge Kubernetes runtime. |
| `opt-beta` | **Option Beta (Cost-Optimized)** | Frugal Infrastructure | `#B8FF5A` (Signal Neon) | 40% lower compute and data egress costs, aggressive committed-use discounts. |

### 2.3 Criteria Configuration & Baseline Weights
| Criterion ID | Name | Short Name | Category | Direction | Baseline Weight | Lock Status | Description |
| :--- | :--- | :--- | :--- | :--- | :---: | :---: | :--- |
| `crit-tech` | **Technical Architecture** | Tech Arch | growth | benefit | **60.0%** | **Locked (60.0%)** | Developer experience, API maturity, and container runtime |
| `crit-cost` | **Cost Efficiency** | Cost Eff | finance | benefit | **40.0%** | **Unlocked (40.0%)** | Compute pricing and reserved instance discount structures |

### 2.4 Raw Utility Scores Matrix (0.0 – 100.0)
| Alternative / Criterion | `crit-tech` (Tech Architecture) | `crit-cost` (Cost Efficiency) | Raw Average |
| :--- | :---: | :---: | :---: |
| **Option Alpha (Specialized)** (`opt-alpha`) | **90.0** | **70.0** | **80.0** |
| **Option Beta (Cost-Optimized)** (`opt-beta`) | **70.0** | **90.0** | **80.0** |

### 2.5 Authoritative Baseline Calculations
$$\text{Score}(\text{opt-alpha}) = (90 \times 0.60) + (70 \times 0.40) = 54.0 + 28.0 = 82.0\text{ pts}$$
$$\text{Score}(\text{opt-beta}) = (70 \times 0.60) + (90 \times 0.40) = 42.0 + 36.0 = 78.0\text{ pts}$$

- **Rank #1 (Winner)**: **Option Alpha (Specialized)** — **82.0 pts**
- **Rank #2 (Runner-Up)**: **Option Beta (Cost-Optimized)** — **78.0 pts**
- **Margin of Victory (Lead)**: **+4.0 pts**
- **Outcome Status**: `decisive` (`isTie: false`)

### 2.6 Closed-Form Sensitivity Calculus
- **Target Criterion**: `crit-cost` (Cost Efficiency)
- **Current Baseline Weight**: **40.0%**
- **Tipping Point Weight**: **50.0%** (Required Delta: **+10.0%**)
- **Flipping Option**: `opt-beta` (Option Beta (Cost-Optimized))

#### Scenario A: Exact Breakeven Parity (50.0% / 50.0%)
$$\text{Score}(\text{opt-alpha}) = (90 \times 0.50) + (70 \times 0.50) = 45.0 + 35.0 = 80.0\text{ pts}$$
$$\text{Score}(\text{opt-beta}) = (70 \times 0.50) + (90 \times 0.50) = 35.0 + 45.0 = 80.0\text{ pts}$$
- **Result**: `Score(opt-alpha) = 80.0`, `Score(opt-beta) = 80.0`, `isTie: true`, `lead: 0.0 pts`. Neither option dominates.

#### Scenario B: Decisive Flip (> 50.0% Cost Efficiency, e.g. 51.0% Cost / 49.0% Tech)
$$\text{Score}(\text{opt-alpha}) = (90 \times 0.49) + (70 \times 0.51) = 44.1 + 35.7 = 79.8\text{ pts}$$
$$\text{Score}(\text{opt-beta}) = (70 \times 0.49) + (90 \times 0.51) = 34.3 + 45.9 = 80.2\text{ pts}$$
- **Result**: Option Beta wins with **80.2 pts** (#1 Winner) vs Option Alpha **79.8 pts** (#2 Runner-Up), lead = **+0.4 pts**.

---

## 3. Data Safety & Demo Account Architecture

To ensure live classroom and auditorium reliability without risking production databases or student privacy, the demo environment enforces strict data boundaries:

### 3.1 Non-Destructive Reset Guardrails
1. **Isolated Domain Scope**: Only test accounts ending with `@decision-os.org` or prefixed with `demo.` / `test_` are targeted by demo tooling.
2. **Real Account Immunity**: Real user accounts and non-demo decisions are strictly excluded from mutation or deletion.
3. **Mongoose Immutability Protection**: Audit events cannot be deleted or modified via ordinary API routes or Mongoose models; audit records are strictly append-only.
4. **Clean Slate vs Pre-Seeded**:
   - `npm run demo:reset`: Seeds the canonical decision and prepares all 3 stakeholder accounts.
   - `npm run demo:reset -- --clean-slate`: Empties demo decisions so the presenter can demonstrate live creation from zero.

### 3.2 Certified Demo Accounts
| Role | Email | Password | Display Name | Demo Function |
| :--- | :--- | :--- | :--- | :--- |
| **Lead Architect (Presenter)** | `lead@decision-os.org`<br>*(or `demo.presenter@decision-os.org`)* | `DecisionOS@2026`<br>*(or `DemoPass123!`)* | Alex Rivera | Decision Owner: creates decision, sets weights, invites experts, adopts scores, certifies export. |
| **Domain Expert** | `expert.sarah@decision-os.org` | `DemoPass123!` | Sarah Chen | External Contributor: receives invite, submits independent matrix recommendations and rationale. |
| **Board Observer** | `board.observer@decision-os.org` | `DemoPass123!` | Marcus Vance | Governance Officer (Viewer): verifies immutable audit trail, tamper detection, and exports. |

---

## 4. Full Step-by-Step Presentation Script (17 Requirements)

> **Audience**: Faculty Evaluation Committee, Engineering Department, and Student Peers.  
> **Presenter Setup**: Projector at 1920×1080, Chrome browser at 100% zoom, terminal open on standby.  
> **Time Allocation**: 10 to 12 minutes.

---

### Step 1: Demonstrate Creating a Decision
- **Action**: From the Workspace Dashboard (`http://localhost:5173`), click **"+ New Decision"**.
- **Alternative Action**: Select *"Enterprise Cloud Provider Decision"* from the starter blueprints, or click *"Custom Setup"* to build from zero.
- **Presenter Dialogue**:
  > *"Every mission-critical architecture decision starts with framing. In Decision OS, we reject vague gut feelings. We establish an explicit decision boundary: 'Enterprise Cloud Provider Decision', addressing the core executive question: 'Which cloud provider provides the optimal architecture and cost balance?'"*
- **Visual Outcome**: Decision workspace initializes with unique UUID/ObjectId, `version: 1`, and an empty scoring matrix ready for inputs.

---

### Step 2: Add Alternatives and Criteria
- **Action**: In the Decision Studio:
  - Add Alternative 1: **"Option Alpha (Specialized)"** (`#38BDF8`, Sky Blue).
  - Add Alternative 2: **"Option Beta (Cost-Optimized)"** (`#B8FF5A`, Signal Neon).
  - Define Criterion 1: **"Technical Architecture"** (`crit-tech`, 60.0% weight, Direction: `benefit`).
  - Define Criterion 2: **"Cost Efficiency"** (`crit-cost`, 40.0% weight, Direction: `benefit`).
- **Presenter Dialogue**:
  > *"We specify our two competing options—Option Alpha, our high-performance specialized provider, and Option Beta, our cost-optimized baseline. We configure two core criteria: Technical Architecture weighted at 60% and Cost Efficiency at 40%. Notice that our weights strictly total 100%."*
- **Visual Outcome**: Alternatives and criteria appear in the matrix. Proportional weight badges display 60% and 40%.

---

### Step 3: Demonstrate Incomplete-Score Protection
- **Action**: In the Scoring Matrix, enter scores for:
  - Option Alpha on Tech Architecture: `90.0`
  - Option Beta on Tech Architecture: `70.0`
  - Option Beta on Cost Efficiency: `90.0`
  - **Leave Option Alpha on Cost Efficiency empty (`null`).**
- **Presenter Dialogue**:
  > *"Notice what happens when one score is missing. A careless system might default this to 0 or 50, silently biasing the decision. In Decision OS, our Incomplete-Score Guard activates immediately. Notice the amber badge: 'Pending Complete Scores'. Winners and ranks are strictly suppressed (null). No preliminary conclusions can be drawn while data is incomplete."*
- **Visual Outcome**:
  - Cell `(Option Alpha, Cost Efficiency)` displays a dashed amber border with a pulsing missing-score indicator dot.
  - Matrix Header shows `Incomplete: 1 missing score (3/4)`.
  - Winner and rank cards remain unrendered or show *"Pending Complete Scores"*.

---

### Step 4: Demonstrate Synthetic Demo-Fill Warning
- **Action**: In the Scoring Matrix header, click **"Fill Missing (Demo 75)"**.
- **Presenter Dialogue**:
  > *"During sales demos or classroom walkthroughs, users often want to test the UI using synthetic values. Watch what happens when I click 'Fill Missing (Demo 75)'. The system does NOT blindly insert the number. It raises an explicit safeguard modal."*
- **Visual Outcome**:
  - Modal title: *"Populate with Synthetic Demonstration Values?"*
  - Prominent Warning: *"75.0 is a synthetic demonstration value for illustration only, NOT an actual evaluation or authoritative assessment. Synthetic values must never be treated as real decision evidence."*
  - Buttons: *"Cancel"* and *"Confirm & Insert Synthetic 75"*.

---

### Step 5: Demonstrate Synthetic Provenance
- **Action**: Click **"Confirm & Insert Synthetic 75"**. Save the decision, refresh the browser, or re-open the decision.
- **Presenter Dialogue**:
  > *"Once confirmed, the placeholder is inserted, but look at the purple provenance badge labeled 'DEMO' directly inside the cell. Even if I refresh the page or reload the decision from MongoDB, this synthetic provenance flag is permanently persisted. A synthetic placeholder can never disguise itself as real evidence."*
- **Visual Outcome**:
  - Cell displays purple `DEMO` badge beside score `75.0`.
  - Header badge: `1 Synthetic Value (Demo Only)`.
  - Bottom persistent banner: *"Synthetic Demo Notice: 1 matrix score contains synthetic baseline value (75.0)."*
  - Saved JSON contains: `scoreProvenance: { "opt-alpha": { "crit-cost": { "isSynthetic": true, "source": "demo" } } }`.

---

### Step 6: Show Authoritative Calculation Safeguards
- **Action**: Click **"Calculate Authoritative"** in the Studio header.
- **Presenter Dialogue**:
  > *"Now, let's attempt to run an Authoritative Board Analysis while that synthetic 75.0 remains in the matrix. The backend server immediately rejects the request with HTTP 422: 'Authoritative analysis blocked: Option Alpha contains synthetic placeholder scores on Cost Efficiency'. The server prevents fraudulent certification."*
- **Visual Outcome**: Error banner pops up: *"Authoritative calculation blocked: Cannot certify decision while synthetic demo values remain."*

---

### Step 7: Complete Real Scoring
- **Action**: Click the cell `(Option Alpha, Cost Efficiency)` and type the real evaluated score: **`70.0`**. Press Enter.
- **Presenter Dialogue**:
  > *"Now we enter our verified empirical score of 70.0. Watch the UI immediately respond: the purple 'DEMO' tag vanishes, the non-authoritative warning banner clears, and the matrix status turns green: 'Matrix Complete (4/4) — Authoritative'."*
- **Visual Outcome**:
  - Score updates to `70.0`.
  - Synthetic warnings disappear.
  - Matrix shows `Matrix Complete (4/4) — Authoritative`.

---

### Step 8: Show Ranking and Explainability
- **Action**: Switch to the **"Analysis / Results"** tab or inspect the Leaderboard Card.
- **Presenter Dialogue**:
  > *"The canonical MCDA engine computes the authoritative Weighted Sum Model. Option Alpha achieves (90 × 0.60) + (70 × 0.40) = 82.0 points. Option Beta achieves (70 × 0.60) + (90 × 0.40) = 78.0 points. Option Alpha is our decisive winner with a +4.0 point lead. Our explainability card reveals exactly why: Alpha's +12.0 point lead in Technical Architecture outweighs its -8.0 point deficit in Cost Efficiency."*
- **Visual Outcome**:
  - Winner Card: **Option Alpha (Specialized)** — **82.0 pts** (Rank #1)
  - Runner-Up Card: **Option Beta (Cost-Optimized)** — **78.0 pts** (Rank #2)
  - Lead Margin Badge: **+4.0 pts**
  - Explainability breakdown table displaying criteria weights, raw scores, and net driver points.

---

### Step 9: Demonstrate Locked Weights
- **Action**: Switch to the **"Weights"** tab. Click the padlock icon on **Technical Architecture** to lock it at **60.0%**. Then drag the **Cost Efficiency** slider to **80.0%**.
- **Presenter Dialogue**:
  > *"In the real world, engineering constraints are non-negotiable. Here, management mandates that Technical Architecture must represent 60% of our evaluation. I lock it. Now, watch as I try to push Cost Efficiency to 80%. The Hare-Niemeyer normalization engine enforces the invariant: because Tech is locked at 60%, the remaining budget is exactly 40%. Cost Efficiency normalizes right back to 40%. The locked constraint is mathematically impenetrable."*
- **Visual Outcome**:
  - Padlock icon closes and highlights on Technical Architecture.
  - Cost Efficiency snaps back to 40.0%. Sum remains strictly 100.0%.
  - Sensitivity analysis reflects that Cost reaching 50% is `unreachable` while Tech is locked.

---

### Step 10: Demonstrate Sensitivity and Tipping Points
- **Action**: Unlock Technical Architecture (both now unlocked at 60% / 40%). Point to the **Sensitivity Curve / Tipping Point Indicator**.
  1. Move Cost Efficiency slider to **50.0%** (Tech normalizes to 50.0%).
  2. Move Cost Efficiency slider to **51.0%** (Tech normalizes to 49.0%).
- **Presenter Dialogue**:
  > *"Now we explore trade-off boundaries. Our closed-form sensitivity calculus detects a tipping point at exactly 50.0% Cost Efficiency (+10.0% delta). Let's test it: When I adjust Cost to 50%, look at the result—both options tie at exactly 80.0 points. The status indicates 'Mathematical Tie', lead is 0.0 points. But if we increase Cost to 51%, Option Beta flips to become the decisive winner at 80.2 points vs 79.8 points. We have discovered the exact breakeven boundary of our decision."*
- **Visual Outcome**:
  - At 50%: Both score `80.0`, Status: `Tie`, Lead: `0.0 pts`.
  - At 51%: Option Beta `80.2`, Option Alpha `79.8`, Status: `Decisive Winner: Option Beta`, Lead: `+0.4 pts`.

---

### Step 11: Invite an Expert
- **Action**: Click the **"Share / Collaborators"** button in the Studio header.
  - Email: `expert.sarah@decision-os.org`
  - Role: **`contributor`**
  - Click **"Send Invitation"**.
- **Presenter Dialogue**:
  > *"Major decisions require domain experts. We invite Sarah Chen, our cloud infrastructure lead. Notice the role selector: we choose 'Contributor'—a specialized role that allows Sarah to submit independent scoring recommendations without giving her permission to mutate our core model."*
- **Visual Outcome**: Invitation token generated, logged in audit trail, pending invitation displayed in collaborator list.

---

### Step 12: Submit an Expert Contribution
- **Action**: Click **"Contributions"** in the Studio header (or view via Sarah's session).
  - Sarah submits scores: Option Alpha Tech = 92, Cost = 68; Option Beta Tech = 68, Cost = 92.
  - Rationale: *"Validated high-throughput egress latency benchmarks during Q4 multi-region failover tests."*
  - As Owner, review the contribution and click **"Adopt Scores"** (with optimistic version check).
- **Presenter Dialogue**:
  > *"Sarah submits her empirical findings with detailed technical rationale. As decision owner, I can review her proposed delta, compare her scores, and explicitly adopt her scores. Notice that adoption uses optimistic version fencing—if another editor changed the decision in the background, the adoption safely aborts to prevent race conditions."*
- **Visual Outcome**: Contribution status marks `Adopted`, decision version increments from `1` to `2`, score matrix reflects updated scores.

---

### Step 13: Generate AI Advisory Suggestions (Rule #14)
- **Action**: Click the **"AI Advisory / Analyst"** button in the Studio header. Click **"Run Advisory Analysis"**.
- **Presenter Dialogue**:
  > *"Now we consult the AI Advisory Subsystem. In Decision OS, we enforce Rule #14: Human Authority Boundaries. The AI provides cognitive bias checks, identifies missing criteria such as 'Vendor Lock-in Risk', and suggests multi-cloud alternatives. But notice: the AI is strictly advisory (isAiGenerated: true). It NEVER calculates alternative utility scores or changes weights secretly."*
- **Visual Outcome**:
  - AiAnalystModal displays Executive Summary, Cognitive Biases, Trade-Off Risks, and Proposed Blueprint Criteria.
  - Rule #14 advisory notice displayed at top: *"Advisory insights only. MCDA mathematical authority remains solely with the canonical engine."*

---

### Step 14: Explain Suggestion Ranking (MDAR v1)
- **Action**: Click the **"Ranked Advice"** tab in `AiAnalystModal`. Expand the top recommendation card.
- **Presenter Dialogue**:
  > *"Instead of an arbitrary LLM bullet list, Decision OS uses the Multi-Factor Deterministic Advisory Ranking (MDAR v1) algorithm. Every suggestion is scored using criterion relevance, empirical grounding, sensitivity tipping urgency, and confidence penalties. When we expand the drawer, we see the exact formula, assumptions made, and what could change this recommendation."*
- **Visual Outcome**:
  - Suggestions ordered with Rank `#1`, `#2`, Priority Scores (e.g. `0.884`).
  - Expandable drawer displays MDAR formula: $\text{Priority} = w_r R + w_e E + w_s S + w_c C - w_m M$.

---

### Step 15: Show Decision History
- **Action**: Click **"Decision History"** (or view Timeline in Audit Modal).
- **Presenter Dialogue**:
  > *"Every decision mutation is captured in our chronological Decision History Timeline. Each event receives a strictly monotonic sequence number (#001 through #011), actor attribution, timestamps, and expandable JSON state diffs."*
- **Visual Outcome**:
  - Chronological timeline showing: `#001 Decision Created` → `#002 Criteria Added` → `#003 Synthetic Demo Filled` → `#004 Real Score Entered` → `#005 Expert Invited` → `#006 Contribution Adopted` → `#007 Authoritative Analysis Certified`.

---

### Step 16: Verify Audit Integrity & Tamper Detection
- **Action**: Click **"Audit & Compliance"** tab. Point to the SHA-256 Hash Chain card. Demonstrate tamper simulation in the Showcase.
- **Presenter Dialogue**:
  > *"In enterprise governance, audit trails must be cryptographically defensible. Each audit event embeds the SHA-256 hash of its predecessor, anchored to the decision's auditHead. Our live validator checks the chain: '100% Cryptographically Verified Intact'. If an attacker tampered with any historical record in MongoDB, our validator immediately detects the exact compromised event ID and halts all certifications."*
- **Visual Outcome**:
  - Green audit badge: `Chain Status: Verified & Pristine (SHA-256)`.
  - Head Hash displayed: `f2269e51ac0135bf...`.
  - Tamper simulation reveals: `INTEGRITY ERROR: Broken at event evt-002`.

---

### Step 17: Export a Decision Report
- **Action**: In `AuditExportModal`, select format: **HTML** (Executive Briefing), **CSV** (Spreadsheet), or **JSON** (Cryptographic Package). Click **"Download Briefing"**.
- **Presenter Dialogue**:
  > *"Finally, we export the executive decision package. Our export package contains all 11 required governance sections: metadata, alternatives, criteria, score matrix, rankings, sensitivity tipping points, contributions, AI advisory, evidence gaps, audit history, and cryptographic proof. Furthermore, our CSV exporter sanitizes dangerous formula triggers to prevent spreadsheet macro injection attacks. The decision is now ready for board sign-off."*
- **Visual Outcome**:
  - Download triggers for standalone executive HTML document with styled KPI summary, sensitivity curve, and verification certificate.

---

## 5. 5-Minute Demonstration Version (Lightning Pace)

When presenting in tight 5-minute competition or review slots, use this compressed high-impact path:

```
[0:00 - 0:45] Step 1 & 2: Quick-Launch Canonical Blueprint
              - Click "New Decision" -> Select "Enterprise Cloud Provider Decision" blueprint.
              - Highlight: Option Alpha (Tech 90, Cost 70) vs Option Beta (Tech 70, Cost 90).
              - Baseline weights: Tech 60%, Cost 40%. Lead: Alpha wins 82.0 vs 78.0 (+4.0 pts).

[0:45 - 1:45] Step 3 - 7: Incomplete Score & Synthetic Provenance Safeguards
              - Clear one score: show Incomplete Guard suppressing rank & winner.
              - Click "Fill Missing (Demo 75)": show Warning Modal and purple DEMO badge.
              - Show authoritative calculation block (HTTP 422).
              - Type real score 70.0: DEMO tag evicts, status turns authoritative green.

[1:45 - 2:45] Step 9 & 10: Locked Weights Invariance & Tipping Point
              - Lock Tech at 60%: try sliding Cost to 80% (Hare-Niemeyer normalizes to 40%).
              - Unlock Tech: slide Cost to 50% -> show exact Tie at 80.0 pts.
              - Slide Cost to 51% -> show Option Beta flip to victory at 80.2 pts.

[2:45 - 3:45] Step 13 & 14: AI Advisory (Rule #14) & MDAR v1 Ranking
              - Open AI Analyst: highlight Rule #14 human authority boundary.
              - Open Ranked Advice: show deterministic MDAR priority ranking formula.

[3:45 - 5:00] Step 15 - 17: Cryptographic Audit & 11-Component Export
              - Open Audit Modal: show SHA-256 unbroken chain & sequence monotonicity.
              - Export standalone HTML Executive Briefing containing all 11 sections.
              - Conclude: "Decision OS: Mathematical authority, immutable auditability, explainable outcomes."
```

---

## 6. 10-Minute Demonstration Version (Complete Deep Dive)

The complete comprehensive walkthrough covering every nuance for academic grading:

| Time | Stage | Focus Requirements | Key Talking Points |
| :---: | :--- | :--- | :--- |
| **0:00 – 1:30** | **Framing & Incomplete Protection** | Requirements 1, 2, 3 | Frame dilemma. Show why silent defaults in spreadsheets corrupt decisions. Demonstrate Incomplete Guard suppressing winners. |
| **1:30 – 3:00** | **Synthetic Provenance & Safeguards** | Requirements 4, 5, 6, 7 | Demonstrate explicit demo-fill warning, purple `DEMO` badge persistence in DB, authoritative calculation block, and clean eviction on real evaluation entry. |
| **3:00 – 4:30** | **MCDA Authority & Explainability** | Requirements 8, 9 | Show WSM math: Alpha 82.0 vs Beta 78.0. Lock Tech at 60% and demonstrate Hare-Niemeyer normalization invariant. |
| **4:30 – 6:00** | **Sensitivity & Tipping Calculus** | Requirement 10 | Discover analytical tipping point. Demonstrate breakeven tie at 50% (80.0 pts) and decisive flip to Beta at 51% (80.2 pts). |
| **6:00 – 7:15** | **Expert Collaboration** | Requirements 11, 12 | Invite Sarah with `contributor` role. Review submitted benchmark contribution. Adopt with optimistic version check. |
| **7:15 – 8:30** | **AI Advisory & Explainable Ranking** | Requirements 13, 14 | Run AI Advisory. Explain Rule #14 boundary. Inspect MDAR v1 multi-factor scoring formula and assumptions drawer. |
| **8:30 – 10:00** | **Audit Trail & Governance Export** | Requirements 15, 16, 17 | Inspect monotonic timeline (#001–#011). Verify SHA-256 chain and demonstrate tamper detection. Export 11-component executive briefing. |

---

## 7. List of Expected Outcomes Matrix

Use this checklist during rehearsals and live presentations to verify exact system states:

| Requirement | Interface Location | Trigger / Action | Expected System Outcome |
| :--- | :--- | :--- | :--- |
| **1. Create Decision** | Dashboard / Modal | Click `+ New Decision` | New decision initialized with UUID, `version: 1`, and clean state. |
| **2. Add Criteria/Options** | Decision Studio | Enter 2 options, 2 criteria | `opt-alpha`, `opt-beta`, `crit-tech` (60%), `crit-cost` (40%) summing to 100%. |
| **3. Incomplete Score Guard** | Scoring Matrix | Leave `(opt-alpha, crit-cost)` empty | `isIncomplete: true`, Winner = `null`, Rank = `null`, Amber badge `(3/4)`. |
| **4. Demo-Fill Warning** | Scoring Matrix Header | Click `Fill Missing (Demo 75)` | Confirmation modal appears warning that 75.0 is synthetic and non-authoritative. |
| **5. Synthetic Provenance** | Scoring Matrix | Confirm demo fill | Purple `DEMO` tag appears on cell; persistent warning banner displays; saved in DB. |
| **6. Authoritative Safeguard** | Studio Actions | Click `Calculate Authoritative` | Request blocked with HTTP 422: cannot certify while synthetic scores exist. |
| **7. Complete Real Scoring** | Scoring Matrix | Enter `70.0` on demo cell | `DEMO` tag cleared, provenance evicted, matrix status turns green Authoritative. |
| **8. Authoritative Ranking** | Analysis Tab | Inspect Leaderboard | Alpha = 82.0 pts (#1), Beta = 78.0 pts (#2), Lead = +4.0 pts, `isTie: false`. |
| **9. Locked Weights** | Weights Tab | Lock Tech 60%, slide Cost 80% | Tech remains strictly 60.0%; Cost normalizes back to 40.0% (sum = 100%). |
| **10. Sensitivity Tie / Flip** | Weights Tab / Curve | Set Cost to 50.0% then 51.0% | At 50%: Tie at 80.0 pts. At 51%: Option Beta wins at 80.2 pts vs 79.8 pts. |
| **11. Invite Expert** | Share Modal | Invite `expert.sarah@decision-os.org` | Role set to `contributor`, invitation token generated and audit-recorded. |
| **12. Expert Contribution** | Contributions Modal | Sarah submits scores | Contribution reviewed, adoption succeeds with optimistic version match. |
| **13. AI Advisory** | AI Analyst Modal | Click `Run Advisory Analysis` | Structured insights generated with `isAiGenerated: true`; MCDA model unchanged. |
| **14. Suggestion Ranking** | Ranked Advice Tab | Inspect top recommendation | Priority score displayed with MDAR v1 breakdown and transparent assumptions. |
| **15. Decision History** | Timeline / Audit | Open Timeline view | Chronological stream with monotonic sequence numbers `#001` through `#011`. |
| **16. Audit Verification** | Audit & Compliance | Click `Verify Chain` | Green check: `Chain Status: Verified & Pristine (SHA-256)`. Tamper detected on test. |
| **17. Export Report** | Export Dialog | Download HTML / CSV / JSON | All 11 components present; CSV formula cells prefixed with `'` to prevent injection. |

---

## 8. Troubleshooting & Operational Checklist

Review this pre-flight checklist 15 minutes before taking the presentation stage:

### 8.1 Pre-Flight Verification Commands
```bash
# 1. Verify MongoDB & Node processes are active
Get-Process -Name "node", "mongod" -ErrorAction SilentlyContinue

# 2. Reset and seed pristine demo state (Non-destructive to real data)
npm run demo:reset

# 3. Execute automated 17-step verification test
npm run demo:verify

# 4. Verify Monorepo compilation health
npm run typecheck
```

### 8.2 Common Pitfalls & Rapid In-Demo Recovery
| Symptom | Cause | 10-Second Fix |
| :--- | :--- | :--- |
| **Browser shows "Verifying Decision OS session..."** | API backend is not listening or MongoDB disconnected. | Start backend: `npm run dev:api` in terminal. Check `http://localhost:3000/api/health`. |
| **Login fails with "Invalid credentials"** | Demo credentials were typed incorrectly. | Click the one-click **"⚡ Fill Presentation Demo Credentials"** button in the sign-in modal, or run `npm run demo:reset`. |
| **Scoring Matrix shows rank: null** | One or more score cells are empty or contain invalid non-numeric characters. | Check for the pulsing amber dot in the matrix. Enter valid numeric scores (0–100). |
| **"Calculate Authoritative" button is disabled / errors** | Matrix still contains a cell with purple `DEMO` badge. | Click the demo cell and type a real score (e.g. `70.0`) to evict the synthetic provenance flag. |
| **Slider won't move to desired weight** | Another criterion is locked, restricting the available budget. | Click the padlock icon on the locked criterion to unlock it, then adjust sliders freely. |
| **Accidental mess during live demo** | Presenter misclicked or added junk test alternatives. | Click the reset icon in Studio or run `npm run demo:reset` to re-seed clean canonical state in 2 seconds. |

---

## 9. Presentation Certification Sign-Off

- **Verification Suite**: `scripts/canonical_presentation_verification.ts` → **17/17 PASSED**
- **Reset Utility**: `scripts/demo_reset.ts` → **CERTIFIED SAFE & NON-DESTRUCTIVE**
- **Canonical Engine Spec Hash**: `sha256-238175f214c7ec8d135e5c5f399435998c0ca8b63fdf644538859fbf78f0d87b`
- **College Presentation Status**: **READY FOR LIVE DEMONSTRATION**
