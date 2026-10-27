# Decision OS — Phase 0 Characterization & Verification Report

**Status**: Formally Closed & Locked  
**Phase**: Phase 0 — Audit, Verification Gate & Mathematical Characterization  
**Git Branch**: `phase-0-audit`  
**Reference**: Baseline regression suite for current implementation (pre-Phase 1)

---

## 1. Locked Characterization Baselines (F1, F2, F3)

The following baselines represent the ground-truth mathematical output of the **existing implementation** under [src/data/decisionData.ts](file:///c:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/src/data/decisionData.ts) and [src/utils/decisionEngine.ts](file:///c:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/src/utils/decisionEngine.ts).

> **Important**: These baselines are locked regression references for the current implementation. They are **not** an endorsement of the current implementation as the future canonical decision engine, nor do they represent "decision accuracy."

### Baseline F1: Job Offer Evaluation (`primaryJobOfferDataset`)
* **Default Weights**: Career Growth 30%, Compensation 25%, Learning 20%, Work-Life Balance 15%, Stability 10%
* **Scores & Rankings**:
  * 🏆 **#1 Winner: Company Beta** — **82.9 pts**
  * **#2 Runner-up: Company Alpha** — **82.0 pts** ($\Delta = -0.9$ pts)
  * **#3 Alternative: Company Gamma** — **78.5 pts** ($\Delta = -4.4$ pts)
* **Characterized Scenario Results**:
  * `career-first` (40/20/25/10/5): **Alpha = 85.7** (Winner) | Beta = 80.1 | Gamma = 76.5
  * `balanced` (25/25/20/15/15): **Beta = 84.0** (Winner) | Alpha = 80.5 | Gamma = 79.2
  * `money-first` (15/45/10/15/15): **Beta = 88.1** (Winner) | Gamma = 80.0 | Alpha = 75.8
  * `worklife-first` (15/20/15/35/15): **Beta = 85.4** (Winner) | Gamma = 83.7 | Alpha = 77.7

### Baseline F2: City Relocation Matrix (`city-relocation`)
* **Default Weights**: Affordability 30%, Network 25%, Culture 20%, Climate 15%, Walkability 10%
* **Scores & Rankings**:
  * 🏆 **#1 Winner: Lisbon, Portugal** — **83.2 pts**
  * **#2 Runner-up: Austin, Texas** — **76.5 pts** ($\Delta = -6.7$ pts)
  * **#3 Alternative: New York City** — **74.8 pts** ($\Delta = -8.4$ pts)
* **Characterized Scenario Results**:
  * `career-dense` (15/45/20/10/10): **New York City = 84.7** (Winner) | Lisbon = 79.0 | Austin = 78.2
  * `lifestyle-balance` (35/15/20/20/10): **Lisbon = 85.4** (Winner) | Austin = 75.5 | New York City = 70.4

### Baseline F3: Frontend Architecture Matrix (`frontend-architecture`)
* **Default Weights**: Performance 30%, Dev Velocity 30%, Maintainability 25%, Hiring Pool 15%
* **Scores & Rankings**:
  * 🏆 **#1 Winner: Vite + React + Tailwind** — **91.8 pts**
  * **#2 Runner-up: Next.js App Router** — **85.3 pts** ($\Delta = -6.5$ pts)
* **Characterized Scenario Results**:
  * `velocity-first` (20/45/20/15): **Vite + React = 92.8** (Winner) | Next.js = 83.7

---

## 2. Verification Gate Results

All commands executed in `c:\Users\tiwar\Downloads\Decision-OS-main\Decision-OS-main`.

| Gate Check | Command | Result | Details |
| :--- | :--- | :--- | :--- |
| **Dependencies** | `npm ci` | **0 errors** | 90 packages installed from clean lockfile. |
| **Linting** | `npm run lint` | **0 errors** | Oxlint passed (1 pre-existing purity warning in MonteCarloTester). |
| **Typecheck & Rollup** | `npm run build` | **0 errors** | `tsc -b && vite build` passed in 2.48s. |
| **Automated Tests** | `npm test` | **0 errors** | Vitest: 22/22 tests passing (6 existing + 16 characterization). |

---

## 3. Persistent Discrepancies Inventory (Preserved & Unresolved)

The following discrepancies are explicitly preserved and documented for resolution in later phases:

1. **Test Fixture Divergence**: [src/utils/decisionEngine.test.ts](file:///c:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/src/utils/decisionEngine.test.ts) uses local fixture scores that diverge from [src/data/decisionData.ts](file:///c:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/src/data/decisionData.ts), concealing that Beta wins under default weights in the actual dataset.
2. **Hero Hardcoded Display**: [src/components/Hero.tsx](file:///c:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/src/components/Hero.tsx) uses a static `scores` object that does not invoke the decision engine.
3. **Transparency Narrative Mismatch**: [src/components/TransparencySection.tsx](file:///c:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/src/components/TransparencySection.tsx) displays hardcoded scores (82.2 vs 85.2) and leads (+0.3 vs +4.8) that do not match engine math (88.1 vs 75.8, +12.3 lead).
4. **Case Studies Narrative Mismatch**: [src/components/CaseStudies.tsx](file:///c:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/src/components/CaseStudies.tsx) claims Austin wins with 77.2, Alpha with 84.0, and Vite with 89.4.
5. **Monte Carlo Discrepancy**: [src/components/MonteCarloTester.tsx](file:///c:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/src/components/MonteCarloTester.tsx) implements uniform random noise instead of Gaussian noise, and hardcodes comparison to strictly 2 options.
6. **State Fragmentation**: [useDecisionModel](file:///c:/Users/tiwar/Downloads/Decision-OS-main/Decision-OS-main/src/hooks/useDecisionModel.ts) is instantiated separately in `App.tsx`, `DecisionDemo.tsx`, and `InteractiveModal.tsx`, leaving component states disconnected.
7. **Benefit-Only Mathematics**: The engine does not support cost criteria (where lower score is better).
8. **Missing-Score Fallback**: Missing scores silently fallback to 50 instead of failing validation.
9. **Tie-Breaking**: No deterministic tie-breaking logic exists.

---

## 4. Code Classification

* **KEEP**: `Navbar.tsx`, `Footer.tsx`, `Logo.tsx`, `FinalCTA.tsx`, `Principles.tsx`, `ProblemSection.tsx`, `ScrollToTop.tsx`, `InstrumentsShowcase.tsx`, `RadarChart.tsx`, `SensitivityCurve.tsx`, `BalanceBeam.tsx`, `audioFx.ts`, `characterization.test.ts`.
* **KEEP+REFACTOR**: `decisionEngine.ts`, `decisionEngine.test.ts`, `useDecisionModel.ts`, `decision.ts`, `Hero.tsx`, `DecisionDemo.tsx`, `ScoreCard.tsx`, `WeightSlider.tsx`, `ScenarioSwitcher.tsx`, `SensitivityBar.tsx`, `DecisionTicker.tsx`, `DecisionTicket.tsx`, `InteractiveModal.tsx`, `EasterEgg.tsx`, `CaseStudies.tsx`, `DecisionHistoryTimeline.tsx`, `TransparencySection.tsx`, `MonteCarloTester.tsx`.
* **TEMPORARILY KEEP**: `decisionData.ts` (seed data until database persistence).
* **REMOVE** (Unused boilerplate): `src/App.css`, `src/assets/hero.png`, `src/assets/react.svg`, `src/assets/vite.svg`.
