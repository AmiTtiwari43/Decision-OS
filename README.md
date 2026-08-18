# Decision OS

> **"Make decisions you can explain."**  
> A structured decision-support workspace that turns complex choices into clear, transparent, and explainable comparisons based on what actually matters to you.

---

## 🌟 Overview

Decision OS is a modern, high-craft decision-support application built for young professionals, founders, knowledge workers, and students navigating high-stakes career, financial, educational, or architectural decisions.

Instead of acting as an opaque "AI oracle" that strips away human agency or defaulting to emotional gut feelings, Decision OS implements **Deterministic Multi-Criteria Decision Analysis (MCDA)** and real-time **Sensitivity Analysis** to make decision trade-offs completely transparent.

---

## ✨ Key Features

1. **Interactive Decision Simulator**:
   - Dynamic weight sliders with proportional auto-normalization summing strictly to 100%.
   - **Criterion Locking**: Lock non-negotiable weights while distributing the remaining delta to unlocked criteria.
   - **Instant Scenario Presets**: One-click scenario switcher (*Career Acceleration*, *Financial Maximization*, *Balanced Life*, *Work-Life Harmony*).
   - **Live Sensitivity Tipping-Point Discovery**: Surfaces the exact analytical weight threshold where ranking inverts (e.g. *"If Compensation weight increases from 25% to 36.4%, Company Beta takes the lead"*).
   - Multi-option scaling with toggleable 3rd candidate option.

2. **Deterministic Explainability & Transparency**:
   - Zero hallucinated text. Generates natural-language reasoning derived from mathematical criteria deltas ($\Delta_{ij} = w_i \cdot (s_{1i} - s_{2i})$).
   - Comparative factor breakdown highlighting primary win drivers and conceded trade-offs.

3. **Decision Sandbox Workspace (Modal)**:
   - Preloaded with multiple real-world decision templates (*Job Offer Evaluation*, *City Relocation Matrix*, *Frontend Architecture Matrix*).
   - 1-click **Export Decision Briefing** with copy-to-clipboard markdown generation and confetti celebration.

4. **Mathematical Audit Terminal (`⌘K`)**:
   - Real-time inspector displaying raw matrix linear algebra, formula proofs, and engine verification status.

5. **Design System & Aesthetics**:
   - Deep obsidian dark theme (`#08090A`), graphite surfaces (`#111318`), hairline borders, and an electric signal lime accent (`#B8FF5A`).
   - Strict typography with `Plus Jakarta Sans` and tabular `JetBrains Mono`.
   - Restrained Framer Motion spring physics on score bars, slider interactions, and layout shifts.
   - 100% responsive across mobile (390px), tablet (768px), and desktop (1440px+).

---

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- npm (v9+)

### Installation
```bash
# Clone or navigate to the directory
cd ACDYON

# Install dependencies
npm install

# Run the development server
npm run dev
```

### Running Tests
```bash
# Run unit tests verifying mathematical scoring, normalization, and sensitivity formulas
npx vitest run
```

### Production Build
```bash
# Build optimized production bundle
npm run build

# Preview production build locally
npm run preview
```

---

## 📐 Mathematical Model

### 1. Weighted Linear Scoring
$$\text{Score}(O_j) = \sum_{i=1}^n w_i \cdot s_{ij}, \quad \text{where } \sum_{i=1}^n w_i = 100\% \text{ and } s_{ij} \in [0, 100]$$

### 2. Sensitivity Tipping Point
Calculates the exact critical weight $w_k^*$ where the ranking flips between Winner $A$ and Runner-Up $B$:
$$w_k^* = \frac{100 \Delta R}{\Delta R - (s_{Ak} - s_{Bk})(100 - w_k)}$$
where $\Delta R = \sum_{i \neq k} w_i(s_{Ai} - s_{Bi})$.

---

## 📂 Project Architecture

```
src/
├── types/
│   └── decision.ts          # Type definitions for Criteria, Options, Scenarios, Engine Outputs
├── data/
│   └── decisionData.ts      # Primary Job Offer dataset & pre-configured scenario templates
├── utils/
│   ├── decisionEngine.ts    # Pure MCDA scoring, normalization, sensitivity & explainability
│   └── decisionEngine.test.ts # Vitest unit test suite (6/6 tests passing)
├── hooks/
│   └── useDecisionModel.ts  # Custom state management hook
├── components/
│   ├── Navbar.tsx           # Sticky nav with live status, hotkey badge, and CTA
│   ├── Hero.tsx             # Hero with interactive preview card
│   ├── ProblemSection.tsx   # Cognitive friction to structured clarity flow
│   ├── HowItWorks.tsx       # 3-step interactive progression
│   ├── DecisionDemo.tsx     # Core interactive decision simulator
│   ├── WeightSlider.tsx     # Custom slider with lock control & percentage pill
│   ├── ScoreCard.tsx        # Dynamic option card with animated progress bars
│   ├── ScenarioSwitcher.tsx # Preset priority buttons
│   ├── SensitivityBar.tsx   # Sensitivity tipping point callout
│   ├── TransparencySection.tsx # Deep explainability breakdown
│   ├── Principles.tsx       # 4 core product tenets
│   ├── InteractiveModal.tsx # Full Decision Workspace sandbox with export
│   ├── EasterEgg.tsx        # Mathematical Audit Terminal (⌘K)
│   ├── FinalCTA.tsx         # Bold closing call-to-action
│   └── Footer.tsx           # Honest footer without fake social proof
├── App.tsx                  # Main app layout and keyboard listeners
├── main.tsx                 # React DOM mount point
└── index.css                # Custom theme variables and slider styles
```

---

## 📄 Documentation
- [`DECISIONS.md`](./DECISIONS.md): Architectural decisions, trade-offs, and product rationale.
- [`RESEARCH_AND_PRODUCT_SPEC.md`](file:///C:/Users/tiwar/.gemini/antigravity-ide/brain/b302e5ac-0af0-4e42-b3c1-e06b39ab299c/RESEARCH_AND_PRODUCT_SPEC.md): Full research document and product specification.
