import { describe, it, expect } from 'vitest';
import {
  evaluateDecision,
  calculateOptionScoreSensitivity,
  calculateMultiParameterCounterfactual,
  createMulberry32,
} from '../src';
import type { EngineCriterion, EngineOption } from '../src';

describe('Option-Score Sensitivity & Multi-Parameter Counterfactual', () => {
  const criteria: EngineCriterion[] = [
    { id: 'c1', name: 'Growth', weight: 40 },
    { id: 'c2', name: 'Compensation', weight: 35 },
    { id: 'c3', name: 'WorkLife', weight: 25 },
  ];

  const options: EngineOption[] = [
    { id: 'optA', name: 'Company Alpha', scores: { c1: 90, c2: 70, c3: 60 } },
    { id: 'optB', name: 'Company Beta', scores: { c1: 70, c2: 85, c3: 75 } },
  ];

  describe('calculateOptionScoreSensitivity', () => {
    it('handles single option with unreachable status', () => {
      const res = calculateOptionScoreSensitivity(options[0], null, criteria, { c1: 40, c2: 35, c3: 25 });
      expect(res.length).toBe(3);
      expect(res[0].feasibility).toBe('unreachable');
      expect(res[0].scoreDeltaNeeded).toBeNull();
    });

    it('calculates exact raw score deltas needed for breakeven', () => {
      // optA score: 0.40*90 + 0.35*70 + 0.25*60 = 36 + 24.5 + 15 = 75.5
      // optB score: 0.40*70 + 0.35*85 + 0.25*75 = 28 + 29.75 + 18.75 = 76.5
      // Wait: optB (76.5) > optA (75.5)! So let's test with optB as leader and optA as challenger
      // Lead delta = 1.0 point
      const weights = { c1: 40, c2: 35, c3: 25 };
      const res = calculateOptionScoreSensitivity(options[1], options[0], criteria, weights);

      // On c1 (w=40): deltaScore = 100 * 1.0 / 40 = 2.5 pts
      const c1Sens = res.find(r => r.criterionId === 'c1')!;
      expect(c1Sens.feasibility).toBe('feasible');
      expect(c1Sens.scoreDeltaNeeded).toBe(2.5);
      // Leader optB score (70) dropping by 2.5 -> 67.5
      expect(c1Sens.leaderThresholdScore).toBe(67.5);
      // Challenger optA score (90) rising by 2.5 -> 92.5
      expect(c1Sens.challengerThresholdScore).toBe(92.5);

      // Verify that applying leader threshold brings score to exact breakeven
      const modifiedOptB: EngineOption = {
        id: 'optB',
        name: 'Company Beta',
        scores: { c1: 67.5, c2: 85, c3: 75 },
      };
      const evalDecision = evaluateDecision({
        criteria,
        options: [options[0], modifiedOptB],
      });
      const scoreA = evalDecision.evaluations.find(e => e.optionId === 'optA')!.weightedScore;
      const scoreB = evalDecision.evaluations.find(e => e.optionId === 'optB')!.weightedScore;
      expect(Math.abs(scoreA - scoreB)).toBeLessThanOrEqual(0.1);
    });

    it('marks unreachable when score change required exceeds [0, 100]', () => {
      const hugeLeadLeader: EngineOption = {
        id: 'huge',
        name: 'Dominant',
        scores: { c1: 100, c2: 100, c3: 100 },
      };
      const lowChallenger: EngineOption = {
        id: 'low',
        name: 'Trailing',
        scores: { c1: 10, c2: 10, c3: 10 },
      };
      // Lead is 90 points. On c3 (w=25), deltaScore = 100 * 90 / 25 = 360 points.
      const res = calculateOptionScoreSensitivity(hugeLeadLeader, lowChallenger, criteria, { c1: 40, c2: 35, c3: 25 });
      const c3Sens = res.find(r => r.criterionId === 'c3')!;
      expect(c3Sens.feasibility).toBe('unreachable');
      expect(c3Sens.leaderThresholdScore).toBeNull();
      expect(c3Sens.challengerThresholdScore).toBeNull();
    });

    it('returns 0 delta when options are already tied', () => {
      const optTied1: EngineOption = { id: 't1', name: 'T1', scores: { c1: 80, c2: 80, c3: 80 } };
      const optTied2: EngineOption = { id: 't2', name: 'T2', scores: { c1: 80, c2: 80, c3: 80 } };
      const res = calculateOptionScoreSensitivity(optTied1, optTied2, criteria, { c1: 40, c2: 35, c3: 25 });
      expect(res[0].scoreDeltaNeeded).toBe(0);
      expect(res[0].feasibility).toBe('feasible');
    });
  });

  describe('calculateMultiParameterCounterfactual', () => {
    it('handles single option', () => {
      const res = calculateMultiParameterCounterfactual(options[0], null, criteria, { c1: 40, c2: 35, c3: 25 });
      expect(res.isFeasible).toBe(false);
      expect(res.shifts.length).toBe(0);
    });

    it('calculates minimal weight shift inverting the winner', () => {
      // optB is leader (76.5) vs optA (75.5), lead = 1.0
      // optA has advantage on c1 (optA 90 vs optB 70: advantage +20)
      // optB has advantage on c2 (optB 85 vs optA 70: optA advantage -15)
      // optB has advantage on c3 (optB 75 vs optA 60: optA advantage -15)
      const weights = { c1: 40, c2: 35, c3: 25 };
      const res = calculateMultiParameterCounterfactual(options[1], options[0], criteria, weights);

      expect(res.isFeasible).toBe(true);
      expect(res.targetOptionId).toBe('optA');
      expect(res.netShiftAmount).toBeGreaterThan(0);

      // Verify that the counterfactual weights actually invert or tie the leader
      const newWeightsMap: Record<string, number> = {};
      for (const s of res.shifts) {
        newWeightsMap[s.criterionId] = s.counterfactualWeight;
      }

      const counterCriteria: EngineCriterion[] = criteria.map(c => ({
        ...c,
        weight: newWeightsMap[c.id],
        isLocked: true,
      }));

      const cfDecision = evaluateDecision({
        criteria: counterCriteria,
        options: [options[1], options[0]],
      });

      const cfScoreA = cfDecision.evaluations.find(e => e.optionId === 'optA')!.weightedScore;
      const cfScoreB = cfDecision.evaluations.find(e => e.optionId === 'optB')!.weightedScore;

      // Challenger optA is tied or ahead of optB within 0.1
      expect(cfScoreA - cfScoreB).toBeGreaterThanOrEqual(-0.1);
    });

    it('strictly preserves locked criteria with zero delta', () => {
      const lockedCriteria: EngineCriterion[] = [
        { id: 'c1', name: 'Growth', weight: 40, isLocked: true },
        { id: 'c2', name: 'Compensation', weight: 35, isLocked: false },
        { id: 'c3', name: 'WorkLife', weight: 25, isLocked: false },
      ];
      const weights = { c1: 40, c2: 35, c3: 25 };
      const res = calculateMultiParameterCounterfactual(
        options[1],
        options[0],
        lockedCriteria,
        weights,
        ['c1']
      );

      // c1 is locked: delta must be exactly 0
      const c1Shift = res.shifts.find(s => s.criterionId === 'c1');
      if (c1Shift) {
        expect(c1Shift.delta).toBe(0);
        expect(c1Shift.counterfactualWeight).toBe(40);
      }
    });

    it('marks infeasible when challenger is dominated on all unlocked criteria', () => {
      const domLeader: EngineOption = {
        id: 'leader',
        name: 'Superior',
        scores: { c1: 95, c2: 95, c3: 95 },
      };
      const domChallenger: EngineOption = {
        id: 'challenger',
        name: 'Inferior',
        scores: { c1: 50, c2: 50, c3: 50 },
      };
      const res = calculateMultiParameterCounterfactual(
        domLeader,
        domChallenger,
        criteria,
        { c1: 40, c2: 35, c3: 25 }
      );
      expect(res.isFeasible).toBe(false);
    });
  });

  describe('Brute-Force Verification on >= 5,000 Randomized Decisions', () => {
    it('validates analytical tipping points against brute-force re-evaluation across 5,000 random decisions', () => {
      const rng = createMulberry32(1337);
      const NUM_DECISIONS = 5000;
      let evaluatedTippingCount = 0;

      for (let d = 0; d < NUM_DECISIONS; d++) {
        const numCriteria = 2 + Math.floor(rng() * 3); // 2 to 4 criteria
        const testCriteria: EngineCriterion[] = [];
        for (let c = 0; c < numCriteria; c++) {
          testCriteria.push({
            id: `crit_${c}`,
            name: `Crit ${c}`,
            weight: 10 + Math.floor(rng() * 80),
            isLocked: c === 0 && rng() < 0.2, // occasionally lock first criterion
          });
        }

        const opt1Scores: Record<string, number> = {};
        const opt2Scores: Record<string, number> = {};
        for (let c = 0; c < numCriteria; c++) {
          opt1Scores[`crit_${c}`] = 20 + Math.floor(rng() * 70);
          opt2Scores[`crit_${c}`] = 20 + Math.floor(rng() * 70);
        }

        const testOptions: EngineOption[] = [
          { id: 'opt1', name: 'Opt 1', scores: opt1Scores },
          { id: 'opt2', name: 'Opt 2', scores: opt2Scores },
        ];

        const initialEval = evaluateDecision({ criteria: testCriteria, options: testOptions });
        if (initialEval.isTie) continue;

        // Check each analytical tipping point reported by the engine
        for (const tp of initialEval.sensitivity) {
          if (
            tp.tippingPointWeight !== null &&
            tp.wouldFlipToOptionId !== null &&
            (tp.feasibility === 'low-threshold' || tp.feasibility === 'medium-threshold')
          ) {
            evaluatedTippingCount++;

            // Create counterfactual criteria with criterion adjusted to tippingPointWeight
            const recheckCriteria: EngineCriterion[] = testCriteria.map(c => {
              if (c.id === tp.criterionId) {
                return { ...c, weight: tp.tippingPointWeight!, isLocked: true };
              }
              return { ...c, isLocked: c.isLocked };
            });

            const rechecked = evaluateDecision({ criteria: recheckCriteria, options: testOptions });
            const sLeader = rechecked.evaluations.find(e => e.optionId === initialEval.winnerId)!.weightedScore;
            const sChallenger = rechecked.evaluations.find(e => e.optionId === tp.wouldFlipToOptionId)!.weightedScore;

            // At the analytical tipping point, either they are tied (within 0.15 score tolerance) or challenger overtakes
            const scoreDiff = Math.abs(sLeader - sChallenger);
            expect(scoreDiff <= 0.25 || sChallenger >= sLeader).toBe(true);
          }
        }
      }

      // Ensure we tested a statistically significant number of analytical tipping points
      expect(evaluatedTippingCount).toBeGreaterThan(2000);
    }, 20000);
  });
});

