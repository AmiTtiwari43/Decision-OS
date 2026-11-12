import { describe, it, expect } from 'vitest';
import {
  normalizeWeights,
  evaluateOption,
  runDecisionEngine,
  calculateSensitivity,
  ValidationError,
} from './decisionEngine';
import { runMonteCarloSimulation } from '@decision-os/decision-engine';
import type { Criterion, Option } from '../types/decision';

const mockCriteria: Criterion[] = [
  { id: 'careerGrowth', name: 'Career Growth', shortName: 'Growth', description: '', category: 'growth', defaultWeight: 30 },
  { id: 'compensation', name: 'Compensation', shortName: 'Comp', description: '', category: 'finance', defaultWeight: 25 },
  { id: 'learning', name: 'Learning & Mentorship', shortName: 'Learning', description: '', category: 'growth', defaultWeight: 20 },
  { id: 'workLifeBalance', name: 'Work-Life Balance', shortName: 'WLB', description: '', category: 'lifestyle', defaultWeight: 15 },
  { id: 'stability', name: 'Company Stability', shortName: 'Stability', description: '', category: 'risk', defaultWeight: 10 },
];

const optionAlpha: Option = {
  id: 'alpha',
  name: 'Company Alpha',
  badge: 'Series B Startup',
  tagline: 'High velocity, steep growth, moderate comp',
  description: 'Fast-paced hypergrowth team.',
  color: '#B8FF5A',
  accentBorder: 'border-signal',
  scores: {
    careerGrowth: 95,
    compensation: 70,
    learning: 92,
    workLifeBalance: 75,
    stability: 65,
  },
  strengths: ['Rapid promotion cadence', 'Exceptional mentorship'],
  vulnerabilities: ['Demanding sprint cycles', 'Startup equity risk'],
};

const optionBeta: Option = {
  id: 'beta',
  name: 'Company Beta',
  badge: 'Established Tech Enterprise',
  tagline: 'Top-of-market compensation, strong stability',
  description: 'Public global tech leader.',
  color: '#38BDF8',
  accentBorder: 'border-sky-500',
  scores: {
    careerGrowth: 72,
    compensation: 95,
    learning: 75,
    workLifeBalance: 82,
    stability: 92,
  },
  strengths: ['Top tier base salary & bonuses', 'High job security & 40h weeks'],
  vulnerabilities: ['Slower advancement tracks', 'More bureaucratic approvals'],
};

describe('Decision OS Engine Canonical Alignment & Mathematical Integrity', () => {
  describe('1. Weighted Scoring and Explainability', () => {
    it('correctly calculates weighted score for Option Alpha', () => {
      const weights = { careerGrowth: 30, compensation: 25, learning: 20, workLifeBalance: 15, stability: 10 };
      const evaluation = evaluateOption(optionAlpha, mockCriteria, weights);
      
      expect(evaluation.weightedScore).toBeCloseTo(82.2, 1);
      expect(evaluation.contributions.length).toBe(5);
    });

    it('correctly calculates weighted score for Option Beta', () => {
      const weights = { careerGrowth: 30, compensation: 25, learning: 20, workLifeBalance: 15, stability: 10 };
      const evaluation = evaluateOption(optionBeta, mockCriteria, weights);
      
      expect(evaluation.weightedScore).toBeCloseTo(81.9, 1);
    });

    it('correctly identifies tipping point where Beta overtakes Alpha', () => {
      const weights = { careerGrowth: 30, compensation: 25, learning: 20, workLifeBalance: 15, stability: 10 };
      const engineResult = runDecisionEngine([optionAlpha, optionBeta], mockCriteria, weights);

      expect(engineResult.winner.option.id).toBe('alpha');
      expect(engineResult.runnerUp?.option.id).toBe('beta');

      const compSensitivity = engineResult.sensitivity.find((s) => s.criterionId === 'compensation');
      expect(compSensitivity).toBeDefined();
      expect(compSensitivity?.tippingPointWeight).toBeGreaterThan(25);
      expect(compSensitivity?.wouldFlipToOptionId).toBe('beta');
    });

    it('switches ranking when Money-First scenario is applied', () => {
      const moneyFirstWeights = { careerGrowth: 15, compensation: 45, learning: 10, workLifeBalance: 15, stability: 15 };
      const engineResult = runDecisionEngine([optionAlpha, optionBeta], mockCriteria, moneyFirstWeights);

      expect(engineResult.winner.option.id).toBe('beta');
      expect(engineResult.runnerUp?.option.id).toBe('alpha');
      expect(engineResult.explainability.headline).toContain('Company Beta');
    });
  });

  describe('2. Largest Remainder Normalization & ASCII Tie-Breaking', () => {
    it('normalizes equal weights to strictly sum to 100.0%', () => {
      const rawWeights = { careerGrowth: 50, compensation: 50, learning: 50, workLifeBalance: 50, stability: 50 };
      const normalized = normalizeWeights(rawWeights, mockCriteria);
      const sum = Object.values(normalized).reduce((a, b) => a + b, 0);
      expect(sum).toBe(100);
      expect(normalized.careerGrowth).toBe(20);
    });

    it('preserves locked criteria weights during Largest Remainder normalization', () => {
      const rawWeights = { careerGrowth: 40, compensation: 20, learning: 20, workLifeBalance: 10, stability: 10 };
      const lockedIds = ['careerGrowth'];
      const adjustedWeights = { ...rawWeights, compensation: 60 };
      
      const normalized = normalizeWeights(adjustedWeights, mockCriteria, lockedIds);
      expect(normalized.careerGrowth).toBe(40);
      const sum = Object.values(normalized).reduce((a, b) => a + b, 0);
      expect(sum).toBe(100);
    });

    it('breaks remainder ties deterministically using criterion ID ascending ASCII', () => {
      // 3 criteria with identical raw weights 1: each target is 100/3 = 33.3333...
      // Integer part = 33.3, sum = 99.9. Remainder diff K = +0.1 (1 tenth).
      // All 3 have identical remainder 0.03333...
      // The single extra +0.1 MUST go to the criterion with lowest ASCII ID ('crit-a').
      const tiedCriteria: Criterion[] = [
        { id: 'crit-c', name: 'Criterion C', shortName: 'C', description: '', category: 'growth', defaultWeight: 1 },
        { id: 'crit-a', name: 'Criterion A', shortName: 'A', description: '', category: 'growth', defaultWeight: 1 },
        { id: 'crit-b', name: 'Criterion B', shortName: 'B', description: '', category: 'growth', defaultWeight: 1 },
      ];
      const raw = { 'crit-c': 1, 'crit-a': 1, 'crit-b': 1 };
      const normalized = normalizeWeights(raw, tiedCriteria);

      expect(normalized['crit-a']).toBe(33.4);
      expect(normalized['crit-b']).toBe(33.3);
      expect(normalized['crit-c']).toBe(33.3);
      const total = normalized['crit-a'] + normalized['crit-b'] + normalized['crit-c'];
      expect(Math.round(total * 10) / 10).toBe(100.0);
    });

    it('guarantees exact 100.0% sum when all unlocked weights are zero', () => {
      const crit: Criterion[] = [
        { id: 'c1', name: 'C1', shortName: 'C1', description: '', category: 'growth', defaultWeight: 40 },
        { id: 'c2', name: 'C2', shortName: 'C2', description: '', category: 'growth', defaultWeight: 0 },
        { id: 'c3', name: 'C3', shortName: 'C3', description: '', category: 'growth', defaultWeight: 0 },
      ];
      const raw = { c1: 40, c2: 0, c3: 0 };
      const lockedIds = ['c1'];
      const normalized = normalizeWeights(raw, crit, lockedIds);

      expect(normalized.c1).toBe(40.0);
      expect(normalized.c2).toBe(30.0);
      expect(normalized.c3).toBe(30.0);
      expect(normalized.c1 + normalized.c2 + normalized.c3).toBe(100.0);
    });

    it('rejects locked weights summing over 100.0% with ValidationError', () => {
      const raw = { careerGrowth: 70, compensation: 40, learning: 10, workLifeBalance: 10, stability: 10 };
      const lockedIds = ['careerGrowth', 'compensation'];
      expect(() => normalizeWeights(raw, mockCriteria, lockedIds)).toThrow(ValidationError);
    });
  });

  describe('3. Strict Missing and Invalid Score Rejection', () => {
    it('strictly rejects missing score in evaluateOption with ValidationError', () => {
      const incompleteOption: Option = {
        id: 'inc1',
        name: 'Incomplete Option',
        tagline: '',
        description: '',
        color: '#FFF',
        accentBorder: '',
        scores: { careerGrowth: 80 }, // missing 4 criteria!
        strengths: [],
        vulnerabilities: [],
      };
      expect(() =>
        evaluateOption(incompleteOption, mockCriteria, { careerGrowth: 30, compensation: 25, learning: 20, workLifeBalance: 15, stability: 10 })
      ).toThrow(ValidationError);
      expect(() =>
        evaluateOption(incompleteOption, mockCriteria, { careerGrowth: 30, compensation: 25, learning: 20, workLifeBalance: 15, stability: 10 })
      ).toThrow(/missing required score/i);
    });

    it('strictly rejects missing score in runDecisionEngine with ValidationError', () => {
      const incompleteOption: Option = {
        id: 'inc2',
        name: 'Incomplete Option 2',
        tagline: '',
        description: '',
        color: '#FFF',
        accentBorder: '',
        scores: { careerGrowth: 80, compensation: 70 }, // missing criteria
        strengths: [],
        vulnerabilities: [],
      };
      expect(() =>
        runDecisionEngine([optionAlpha, incompleteOption], mockCriteria, { careerGrowth: 30, compensation: 25, learning: 20, workLifeBalance: 15, stability: 10 })
      ).toThrow(ValidationError);
    });

    it('rejects non-finite scores (NaN, Infinity) with ValidationError', () => {
      const nanOption: Option = {
        ...optionAlpha,
        scores: { ...optionAlpha.scores, careerGrowth: NaN },
      };
      expect(() =>
        evaluateOption(nanOption, mockCriteria, { careerGrowth: 30, compensation: 25, learning: 20, workLifeBalance: 15, stability: 10 })
      ).toThrow(ValidationError);

      const infOption: Option = {
        ...optionAlpha,
        scores: { ...optionAlpha.scores, compensation: Infinity },
      };
      expect(() =>
        evaluateOption(infOption, mockCriteria, { careerGrowth: 30, compensation: 25, learning: 20, workLifeBalance: 15, stability: 10 })
      ).toThrow(ValidationError);
    });

    it('rejects out-of-range scores (< 0 or > 100) with ValidationError', () => {
      const negativeOption: Option = {
        ...optionAlpha,
        scores: { ...optionAlpha.scores, careerGrowth: -5 },
      };
      expect(() =>
        evaluateOption(negativeOption, mockCriteria, { careerGrowth: 30, compensation: 25, learning: 20, workLifeBalance: 15, stability: 10 })
      ).toThrow(ValidationError);

      const overflowOption: Option = {
        ...optionAlpha,
        scores: { ...optionAlpha.scores, careerGrowth: 101 },
      };
      expect(() =>
        evaluateOption(overflowOption, mockCriteria, { careerGrowth: 30, compensation: 25, learning: 20, workLifeBalance: 15, stability: 10 })
      ).toThrow(ValidationError);
    });
  });

  describe('4. Monte Carlo Determinism, Seed Variation, and Locked Weights', () => {
    const engineCriteria = mockCriteria.map((c) => ({
      id: c.id,
      name: c.name,
      shortName: c.shortName,
      weight: c.defaultWeight,
    }));
    const engineOptions = [
      { id: optionAlpha.id, name: optionAlpha.name, scores: optionAlpha.scores },
      { id: optionBeta.id, name: optionBeta.name, scores: optionBeta.scores },
    ];
    const baseWeights = { careerGrowth: 30, compensation: 25, learning: 20, workLifeBalance: 15, stability: 10 };

    it('produces identical deterministic output for identical seeds', () => {
      const run1 = runMonteCarloSimulation(engineOptions, engineCriteria, baseWeights, [], {
        iterations: 1000,
        seed: 42,
        sigmaRelative: 0.15,
      });
      const run2 = runMonteCarloSimulation(engineOptions, engineCriteria, baseWeights, [], {
        iterations: 1000,
        seed: 42,
        sigmaRelative: 0.15,
      });

      expect(run1.dominantOptionId).toBe(run2.dominantOptionId);
      expect(run1.dominantWinProbability).toBe(run2.dominantWinProbability);
      expect(run1.optionResults).toEqual(run2.optionResults);
      expect(run1.robustnessRating).toBe(run2.robustnessRating);
    });

    it('produces deterministic variation when seed changes', () => {
      const runSeed42 = runMonteCarloSimulation(engineOptions, engineCriteria, baseWeights, [], {
        iterations: 1000,
        seed: 42,
        sigmaRelative: 0.15,
      });
      const runSeed999 = runMonteCarloSimulation(engineOptions, engineCriteria, baseWeights, [], {
        iterations: 1000,
        seed: 999,
        sigmaRelative: 0.15,
      });

      expect(runSeed42.seed).toBe(42);
      expect(runSeed999.seed).toBe(999);
      // Win counts should be deterministic numbers close to each other but with pseudo-random variation
      expect(runSeed42.optionResults[0].winCount).not.toBe(runSeed999.optionResults[0].winCount);
    });

    it('freezes locked weights during Monte Carlo perturbation with zero variance', () => {
      const lockedIds = ['careerGrowth', 'compensation'];
      const criteriaWithLocked = engineCriteria.map((c) => ({
        ...c,
        isLocked: lockedIds.includes(c.id),
      }));

      const runWithLocked = runMonteCarloSimulation(
        engineOptions,
        criteriaWithLocked,
        baseWeights,
        lockedIds,
        { iterations: 500, seed: 1234, sigmaRelative: 0.2 }
      );

      expect(runWithLocked.iterations).toBe(500);
      expect(runWithLocked.optionResults).toHaveLength(2);
      expect(runWithLocked.dominantOptionId).toBeDefined();

      // Observable Invariant Verification:
      // Locked criteria weights MUST remain completely frozen across all 500 iterations
      // with zero variance, minWeight == maxWeight == baseWeight, and stdDev == 0.
      expect(runWithLocked.criterionStats).toBeDefined();
      const statsMap = new Map(runWithLocked.criterionStats!.map((s) => [s.criterionId, s]));

      for (const lockedId of lockedIds) {
        const stats = statsMap.get(lockedId);
        expect(stats).toBeDefined();
        expect(stats!.isLocked).toBe(true);
        expect(stats!.variance).toBe(0);
        expect(stats!.stdDev).toBe(0);
        const expectedWeight = baseWeights[lockedId as keyof typeof baseWeights];
        expect(stats!.minWeight).toBe(expectedWeight);
        expect(stats!.maxWeight).toBe(expectedWeight);
        expect(stats!.meanWeight).toBe(expectedWeight);
      }

      // Unlocked criteria MUST vary across the 500 iterations with strictly positive variance
      const unlockedIds = engineCriteria.map((c) => c.id).filter((id) => !lockedIds.includes(id));
      for (const unlockedId of unlockedIds) {
        const stats = statsMap.get(unlockedId);
        expect(stats).toBeDefined();
        expect(stats!.isLocked).toBe(false);
        expect(stats!.variance).toBeGreaterThan(0);
        expect(stats!.stdDev).toBeGreaterThan(0);
        expect(stats!.maxWeight).toBeGreaterThan(stats!.minWeight);
      }
    });

    it('handles fractional wins for tied alternatives', () => {
      const tiedCriteria = [
        { id: 'c1', name: 'C1', weight: 100 },
      ];
      const tiedOptions = [
        { id: 'opt1', name: 'Option 1', scores: { c1: 80 } },
        { id: 'opt2', name: 'Option 2', scores: { c1: 80 } },
      ];
      const res = runMonteCarloSimulation(tiedOptions, tiedCriteria, { c1: 100 }, [], {
        iterations: 100,
        seed: 42,
      });

      // Both options have identical scores on every iteration, so each gets 0.5 win per iteration = 50 wins = 50.0%
      expect(res.optionResults[0].winProbability).toBe(50.0);
      expect(res.optionResults[1].winProbability).toBe(50.0);
      expect(res.dominantOptionId).toBeNull(); // Tied top options yield null dominant ID
    });
  });

  describe('5. Closed-Form Sensitivity Analysis Alignment', () => {
    it('calculates sensitivity tipping points adhering to canonical closed-form formula', () => {
      const weights = { careerGrowth: 30, compensation: 25, learning: 20, workLifeBalance: 15, stability: 10 };
      const evalA = { ...evaluateOption(optionAlpha, mockCriteria, weights), rank: 1, scoreDifferenceToLeader: 0 };
      const evalB = { ...evaluateOption(optionBeta, mockCriteria, weights), rank: 2, scoreDifferenceToLeader: 0.3 };

      const sensitivity = calculateSensitivity(evalA, evalB, mockCriteria, weights);
      expect(sensitivity).toHaveLength(5);

      const comp = sensitivity.find((s) => s.criterionId === 'compensation')!;
      expect(comp.tippingPointWeight).toBeGreaterThan(25);
      expect(comp.wouldFlipToOptionId).toBe('beta');
      expect(comp.wouldFlipToOptionName).toBe('Company Beta');
      expect(comp.feasibility).toBeDefined();
    });
  });
});
