# Decision OS — Live College Presentation Guide & Demo Walkthrough (Batch 04.4)

> **Document Status**: Complete Presentation Operational Guide  
> **Target Audience**: College Faculty, Project Evaluators, Engineering Presenters  
> **Reference Document**: [`BATCH_04_4_CANONICAL_PRESENTATION_DATASET_AND_DEMO_WALKTHROUGH.md`](../BATCH_04_4_CANONICAL_PRESENTATION_DATASET_AND_DEMO_WALKTHROUGH.md)  
> **Automated Verification**: `npm run demo:verify` (17/17 Steps Verified)  
> **Safe Reset Command**: `npm run demo:reset` (Guaranteed Non-Destructive)  

---

## Quick Reference & Presentation Links

| Tool / Resource | Command / URL | Purpose |
| :--- | :--- | :--- |
| **Frontend Web App** | `http://localhost:5173` | Interactive Decision OS Workspace |
| **API Backend** | `http://localhost:3000/api` | Fastify REST API Service |
| **Seeded Decision URL** | `http://localhost:5173/?decisionId=<id>` | Direct link to Canonical Decision |
| **Reset & Seed Demo** | `npm run demo:reset` | Resets demo accounts & canonical dataset safely |
| **Verify 17 Demo Steps** | `npm run demo:verify` | Executes automated end-to-end verification suite |
| **Full Architecture Spec** | [`ARCHITECTURE_SPECIFICATION.md`](../ARCHITECTURE_SPECIFICATION.md) | Technical architecture & API reference |
| **Canonical MCDA Spec** | [`CANONICAL_DECISION_ENGINE_V1_SPEC.md`](../CANONICAL_DECISION_ENGINE_V1_SPEC.md) | Pure TypeScript mathematical engine spec |

---

## 1. Quick-Start Presentation Setup (Under 60 Seconds)

### Step 1: Start Backend and Frontend
In terminal:
```bash
npm run dev
```

### Step 2: Seed the Demo Environment
In a second terminal:
```bash
npm run demo:reset
```
*Output will display the seeded decision ID and confirmation of data safety (0 real user accounts affected).*

### Step 3: Open in Chrome
Navigate to `http://localhost:5173`. Click the top-right **"Sign In"** button and use the one-click **"⚡ Fill Presentation Demo Credentials"** button (`lead@decision-os.org` / `DecisionOS@2026`).

---

## 2. Pacing Options Summary

### 5-Minute Lightning Demo
- **Focus**: Core value & mathematical integrity.
- **Key Moments**:
  1. Open Canonical Blueprint (Alpha 82.0 vs Beta 78.0, +4.0 lead).
  2. Incomplete score guard & synthetic demo-fill warning.
  3. Locked weight Hare-Niemeyer normalization invariant.
  4. Sensitivity breakeven tie (50%) and flip boundary (51%).
  5. AI Advisory Rule #14 & SHA-256 cryptographic audit export.

### 10-Minute Comprehensive Walkthrough
- **Focus**: End-to-end governance lifecycle (all 17 requirements).
- **Key Moments**:
  1. Framing the decision from scratch.
  2. Defining criteria & alternatives.
  3. Demonstrating incomplete score protection.
  4. Demonstrating synthetic warning & DB persistence.
  5. Demonstrating authoritative calculation block.
  6. Entering real evaluation and evicting provenance.
  7. MCDA Weighted Sum Model ranking & explainability.
  8. Locked weight Hare-Niemeyer normalization invariant.
  9. Sensitivity calculus: 50% tie at 80.0, 51% Beta win at 80.2.
  10. Inviting an expert with `contributor` role.
  11. Reviewing & adopting expert contribution.
  12. Generating AI advisory suggestions under Rule #14.
  13. Explaining suggestion ranking via MDAR v1 formula.
  14. Inspecting chronological monotonic history timeline.
  15. Verifying SHA-256 cryptographic hash chain & tamper detection.
  16. Exporting 11-component executive briefing (HTML/CSV/JSON).

---

## 3. Data Safety Certification

- **Synthetic Labeling**: Synthetic values are tagged with purple `DEMO` badges and persistent banners.
- **Non-Fabrication Invariant (Rule #15)**: External citations are explicitly tagged as `Unverified Citation` without fabricating third-party certification.
- **Human Authority Boundary (Rule #14)**: AI advisory never alters core utility scores or weights.
- **Real Data Protection**: Demo reset only touches `@decision-os.org` and demo decisions. Real users and non-demo decisions are never modified.

*For full dialogue scripts, visual cues, and formulas, see [BATCH_04_4_CANONICAL_PRESENTATION_DATASET_AND_DEMO_WALKTHROUGH.md](../BATCH_04_4_CANONICAL_PRESENTATION_DATASET_AND_DEMO_WALKTHROUGH.md).*
