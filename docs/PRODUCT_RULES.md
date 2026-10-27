# Decision OS — Product Rules

1. Canonical engine specification (`CANONICAL_DECISION_ENGINE_V1_SPEC.md`) is the sole mathematical authority.
2. The best decision depends on what matters to the decision maker.
3. Every option score represents utility in $[0.0, 100.0]$. Higher is better.
4. Engine v1 supports benefit criteria only. Cost dimensions must be normalized upstream.
5. All criteria weights are non-negative and normalized to strictly sum to 100.0% via Hare-Niemeyer.
6. User-locked criteria weights are immutable constraints and strictly preserved.
7. Decision rank is separated from presentation order.
8. Genuine ties ($|\Delta| < 10^{-9}$) produce shared ranks, `isTie: true`, and `winnerId: null`. Winner is never silently chosen.
9. Missing scores invalidate evaluation; silent default fallbacks are strictly prohibited.
10. Sensitivity tipping points are calculated in closed analytical form respecting locked constraints.
11. Monte Carlo evaluates all options using Mulberry32 seeded PRNG and Box-Muller Gaussian perturbations.
12. Monte Carlo terminology is strictly "win probability under the specified uncertainty model", never "accuracy".
13. Preserved historical decisions are immutable and never silently recalculated.
14. No LLM ever calculates or alters authoritative calculations.
15. Never trust client-supplied calculations on the backend.
16. Every authoritative result records the engine version, seed, inputs used, and evaluation timestamp.
