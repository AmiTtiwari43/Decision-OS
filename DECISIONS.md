# Decision OS — Engineering & Product Decisions

> **Document Purpose**: Concise architectural and product rationale answering the four core questions for the frontend engineering challenge.

---

## 1. Why this product concept?

### The Core Problem
High-stakes decisions—such as choosing between competing job offers, relocating to a new city, or selecting an engineering architecture—suffer from two opposing failure modes:

1. **Intuitive Bias & Anchoring**: When evaluated without structure, humans succumb to cognitive shortcuts (e.g., anchoring entirely on base salary while ignoring promotion trajectory, learning velocity, or work-life health).
2. **The Black-Box AI Fallacy**: Generic LLMs and "AI decision oracles" claim to offer answers, but they hallucinate subjective weights, lack deterministic reproducibility, and strip away user agency.

### Why the Structured Decision Model?
Decision OS is built on Multi-Criteria Decision Analysis (MCDA) and real-time sensitivity analysis. The guiding thesis is:
> **"The best decision depends on what matters to you."**

Instead of telling the user what to do, Decision OS provides a calibrated workspace where:
- The user controls the priorities (percentage weights summing to 100%).
- The mathematics are 100% transparent: $\text{Score}(O_j) = \sum_{i=1}^n w_i \cdot s_{ij}$.
- The system surfaces the exact **tipping point** where a priority shift inverts the ranking (e.g., *"If Compensation priority exceeds 36.4%, Company Beta takes the lead"*).
- The output is an explainable briefing the user can defend to their peers, partner, or manager.

---

## 2. Why this implementation?

### Frontend-Only Architecture
For this assessment, the challenge explicitly requested demonstrating **product thinking, UI craft, responsive engineering, and interaction design** rather than backend plumbing.

- **Speed & Tactile Feedback**: All mathematical recalculations, weight normalizations, and sensitivity analyses run synchronously in $<1\text{ms}$ in pure TypeScript (`src/utils/decisionEngine.ts`). This enables instant 60fps slider responses with zero network latency.
- **Isolated Separation of Concerns**: The business logic (`decisionEngine.ts`) is completely decoupled from the React UI components, making the engine 100% testable via unit tests (`vitest`).
- **Rich Interactive Demonstrations**: Users can interact with the live hero preview, test 4 preset scenarios, toggle third options, adjust locked criteria, launch the Sandbox Workspace, and export formatted Decision Briefings.

---

## 3. One Meaningful Trade-Off

### Trade-Off: Proportional Normalization vs. Independent Free-Floating Sliders
- **The Dilemma**: In Multi-Criteria Decision Analysis, weights must sum to 100% for scores to represent a true normalized percentage. However, in UI design, dragging one slider while others automatically move can sometimes surprise a user if not carefully signaled.
- **The Solution & Compromise**: We implemented **Criterion Locking** alongside proportional auto-normalization. When a user drags a slider, locked criteria maintain their exact values while unlocked criteria absorb the delta. While a full multi-dimensional constraint solver could support arbitrary linear programming inequalities (e.g., $w_1 > 2 \cdot w_2$), the proportional normalization with lock controls was chosen to maintain intuitive consumer-grade simplicity within the challenge timeframe.

---

## 4. AI Usage & Verification

### AI Integration Context
- **Product Philosophy**: Decision OS deliberately avoids generic "AI-powered" marketing buzzwords. It is engineered as a deterministic decision-support tool where reasoning is derived from mathematical criteria deltas rather than stochastic LLM prompts.
- **Development Process**: AI assistance was utilized for rapid brainstorming of edge-case test matrices and template schemas. All mathematical formulas, normalization algorithms, tipping-point derivatives, TypeScript definitions, Tailwind styling, and Framer Motion state transitions were verified, manually tested, and validated via automated unit testing (`decisionEngine.test.ts`) and browser subagent validation.
