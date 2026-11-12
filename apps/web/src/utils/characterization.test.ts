import { describe, it, expect } from 'vitest';
import {
  normalizeWeights,
  evaluateOption,
  runDecisionEngine,
  ValidationError,
} from './decisionEngine';
import {
  primaryJobOfferDataset,
  templateDatasets,
} from '../data/decisionData';
import type { Criterion, Option } from '../types/decision';

describe('Phase 0: Decision Engine Characterization Tests', () => {
  const jobOfferDataset = primaryJobOfferDataset;
  const cityDataset = templateDatasets[1];
  const architectureDataset = templateDatasets[2];

  describe('1. Normalization Characterization', () => {
    it('normalizes arbitrary positive weights to strictly sum to 100.0%', () => {
      const raw = { careerGrowth: 10, compensation: 20, learning: 30, workLifeBalance: 40, stability: 50 };
      const normalized = normalizeWeights(raw, jobOfferDataset.criteria);
      const sum = Object.values(normalized).reduce((a, b) => a + b, 0);
      expect(sum).toBe(100);
      expect(normalized.careerGrowth).toBe(6.7);
      expect(normalized.compensation).toBe(13.3);
      expect(normalized.learning).toBe(20.0);
      expect(normalized.workLifeBalance).toBe(26.7);
      expect(normalized.stability).toBe(33.3);
    });

    it('preserves locked criteria weights and proportionally distributes to unlocked', () => {
      const raw = { careerGrowth: 40, compensation: 20, learning: 20, workLifeBalance: 10, stability: 10 };
      const lockedIds = ['careerGrowth', 'compensation'];
      const rawModified = { ...raw, workLifeBalance: 60 };
      const normalized = normalizeWeights(rawModified, jobOfferDataset.criteria, lockedIds);

      expect(normalized.careerGrowth).toBe(40);
      expect(normalized.compensation).toBe(20);
      const unlockedSum = normalized.learning + normalized.workLifeBalance + normalized.stability;
      expect(Number(unlockedSum.toFixed(1))).toBe(40);
      const totalSum = Object.values(normalized).reduce((a, b) => a + b, 0);
      expect(Number(totalSum.toFixed(1))).toBe(100);
    });

    it('rejects locked sum >= 100 with canonical ValidationError', () => {
      const raw = { careerGrowth: 60, compensation: 60, learning: 20, workLifeBalance: 10, stability: 10 };
      const lockedIds = ['careerGrowth', 'compensation'];
      expect(() => normalizeWeights(raw, jobOfferDataset.criteria, lockedIds)).toThrow(ValidationError);
    });

    it('splits remainder evenly if all unlocked weights are 0', () => {
      const raw = { careerGrowth: 50, compensation: 0, learning: 0, workLifeBalance: 0, stability: 0 };
      const lockedIds = ['careerGrowth'];
      const normalized = normalizeWeights(raw, jobOfferDataset.criteria, lockedIds);

      expect(normalized.careerGrowth).toBe(50);
      // Remainder 50 evenly split across 4 unlocked = 12.5 each, with correction pass
      const unlockedVals = [normalized.compensation, normalized.learning, normalized.workLifeBalance, normalized.stability];
      unlockedVals.forEach(v => expect(v).toBeGreaterThanOrEqual(12.5));
      const totalSum = Object.values(normalized).reduce((a, b) => a + b, 0);
      expect(Number(totalSum.toFixed(1))).toBe(100);
    });
  });

  describe('2. Hand-Verified Example F1: Job Offer Evaluation', () => {
    it('characterizes F1 with default weights (Beta wins 82.9 vs Alpha 82.0 vs Gamma 78.5)', () => {
      const weights: Record<string, number> = {};
      jobOfferDataset.criteria.forEach(c => (weights[c.id] = c.defaultWeight));

      const result = runDecisionEngine(jobOfferDataset.options, jobOfferDataset.criteria, weights);

      expect(result.evaluations).toHaveLength(3);
      // Winner is Beta under raw default weights in decisionData.ts
      expect(result.winner.option.id).toBe('beta');
      expect(result.winner.weightedScore).toBe(82.9);
      expect(result.runnerUp?.option.id).toBe('alpha');
      expect(result.runnerUp?.weightedScore).toBe(82.0);
      expect(result.evaluations[2].option.id).toBe('gamma');
      expect(result.evaluations[2].weightedScore).toBe(78.5);
    });

    it('characterizes F1 under career-first scenario (Alpha wins 85.7 vs Beta 80.1)', () => {
      const scenario = jobOfferDataset.scenarios.find(s => s.id === 'career-first')!;
      const result = runDecisionEngine(jobOfferDataset.options, jobOfferDataset.criteria, scenario.weights);

      expect(result.winner.option.id).toBe('alpha');
      expect(result.winner.weightedScore).toBe(85.7);
      expect(result.runnerUp?.option.id).toBe('beta');
      expect(result.runnerUp?.weightedScore).toBe(80.1);
      expect(result.evaluations[2].weightedScore).toBe(76.5);
      expect(result.explainability.pointLead).toBe(5.6);
    });

    it('characterizes F1 under money-first scenario (Beta 88.1 vs Gamma 80.0 vs Alpha 75.8)', () => {
      const scenario = jobOfferDataset.scenarios.find(s => s.id === 'money-first')!;
      const result = runDecisionEngine(jobOfferDataset.options, jobOfferDataset.criteria, scenario.weights);

      expect(result.winner.option.id).toBe('beta');
      expect(result.winner.weightedScore).toBe(88.1);
      expect(result.runnerUp?.option.id).toBe('gamma');
      expect(result.runnerUp?.weightedScore).toBe(80.0);
      expect(result.evaluations[2].option.id).toBe('alpha');
      expect(result.evaluations[2].weightedScore).toBe(75.8);
    });

    it('characterizes F1 under worklife-first scenario (Beta wins 85.4 vs Gamma 83.7 vs Alpha 77.7)', () => {
      const scenario = jobOfferDataset.scenarios.find(s => s.id === 'worklife-first')!;
      const result = runDecisionEngine(jobOfferDataset.options, jobOfferDataset.criteria, scenario.weights);

      expect(result.winner.option.id).toBe('beta');
      expect(result.winner.weightedScore).toBe(85.4);
      expect(result.runnerUp?.option.id).toBe('gamma');
      expect(result.runnerUp?.weightedScore).toBe(83.7);
      expect(result.evaluations[2].option.id).toBe('alpha');
      expect(result.evaluations[2].weightedScore).toBe(77.7);
    });
  });

  describe('3. Hand-Verified Example F2: City Relocation Matrix', () => {
    it('characterizes F2 with default weights (Lisbon 83.2 vs Austin 76.5 vs NYC 74.8)', () => {
      const weights: Record<string, number> = {};
      cityDataset.criteria.forEach(c => (weights[c.id] = c.defaultWeight));

      const result = runDecisionEngine(cityDataset.options, cityDataset.criteria, weights);

      expect(result.winner.option.id).toBe('lisbon');
      expect(result.winner.weightedScore).toBe(83.2);
      expect(result.runnerUp?.option.id).toBe('austin');
      expect(result.runnerUp?.weightedScore).toBe(76.5);
      expect(result.evaluations[2].option.id).toBe('nyc');
      expect(result.evaluations[2].weightedScore).toBe(74.8);
    });

    it('characterizes F2 under network-focused scenario (NYC 84.7 vs Lisbon 79.0 vs Austin 78.2)', () => {
      const scenario = cityDataset.scenarios.find(s => s.id === 'career-dense')!;
      const result = runDecisionEngine(cityDataset.options, cityDataset.criteria, scenario.weights);

      expect(result.winner.option.id).toBe('nyc');
      expect(result.winner.weightedScore).toBe(84.7);
      expect(result.runnerUp?.option.id).toBe('lisbon');
      expect(result.runnerUp?.weightedScore).toBe(79.0);
      expect(result.evaluations[2].option.id).toBe('austin');
      expect(result.evaluations[2].weightedScore).toBe(78.2);
    });
  });

  describe('4. Hand-Verified Example F3: Frontend Architecture Matrix', () => {
    it('characterizes F3 with default weights (Vite+React 91.8 vs Next.js 85.3)', () => {
      const weights: Record<string, number> = {};
      architectureDataset.criteria.forEach(c => (weights[c.id] = c.defaultWeight));

      const result = runDecisionEngine(architectureDataset.options, architectureDataset.criteria, weights);

      expect(result.winner.option.id).toBe('vite-react');
      expect(result.winner.weightedScore).toBe(91.8);
      expect(result.runnerUp?.option.id).toBe('nextjs');
      expect(result.runnerUp?.weightedScore).toBe(85.3);
      expect(result.explainability.pointLead).toBe(6.5);
    });

    it('characterizes F3 under velocity-first scenario (Vite+React 92.8 vs Next.js 83.7)', () => {
      const scenario = architectureDataset.scenarios.find(s => s.id === 'velocity-first')!;
      const result = runDecisionEngine(architectureDataset.options, architectureDataset.criteria, scenario.weights);

      expect(result.winner.option.id).toBe('vite-react');
      expect(result.winner.weightedScore).toBe(92.8);
      expect(result.runnerUp?.option.id).toBe('nextjs');
      expect(result.runnerUp?.weightedScore).toBe(83.7);
    });
  });

  describe('5. Sensitivity & Tipping Point Characterization', () => {
    it('characterizes tipping point behavior where runner-up can overtake', () => {
      // In career-first: Alpha is 85.7, Beta is 80.1
      const scenario = jobOfferDataset.scenarios.find(s => s.id === 'career-first')!;
      const result = runDecisionEngine(jobOfferDataset.options, jobOfferDataset.criteria, scenario.weights);

      const compSensitivity = result.sensitivity.find(s => s.criterionId === 'compensation')!;
      expect(compSensitivity).toBeDefined();
      expect(compSensitivity.wouldFlipToOptionId).toBe('beta');
      expect(compSensitivity.tippingPointWeight).toBeGreaterThan(scenario.weights.compensation);
    });

    it('marks unreachable when single-criterion weighting cannot flip the winner', () => {
      const singleCrit: Criterion[] = [
        { id: 'c1', name: 'Crit 1', shortName: 'C1', description: '', category: 'growth', defaultWeight: 100 },
      ];
      const opt1: Option = {
        id: 'o1', name: 'Opt 1', tagline: '', description: '', color: '', accentBorder: '',
        scores: { c1: 90 }, strengths: [], vulnerabilities: [],
      };
      const opt2: Option = {
        id: 'o2', name: 'Opt 2', tagline: '', description: '', color: '', accentBorder: '',
        scores: { c1: 40 }, strengths: [], vulnerabilities: [],
      };
      const result = runDecisionEngine([opt1, opt2], singleCrit, { c1: 100 });
      expect(result.sensitivity[0].feasibility).toBe('unreachable');
      expect(result.sensitivity[0].tippingPointWeight).toBeNull();
    });
  });

  describe('6. Edge Cases & Missing Value Handling', () => {
    it('strictly rejects missing criteria scores with ValidationError instead of falling back to 50', () => {
      const crit: Criterion[] = [
        { id: 'c1', name: 'Crit 1', shortName: 'C1', description: '', category: 'growth', defaultWeight: 50 },
        { id: 'c2', name: 'Crit 2', shortName: 'C2', description: '', category: 'finance', defaultWeight: 50 },
      ];
      const optWithMissing: Option = {
        id: 'missingOpt', name: 'Missing', tagline: '', description: '', color: '', accentBorder: '',
        scores: { c1: 80 }, // c2 missing!
        strengths: [], vulnerabilities: [],
      };
      expect(() => evaluateOption(optWithMissing, crit, { c1: 50, c2: 50 })).toThrow(ValidationError);
      expect(() => runDecisionEngine([optWithMissing], crit, { c1: 50, c2: 50 })).toThrow(ValidationError);
    });

    it('characterizes tie behavior where two options have identical scores', () => {
      const crit: Criterion[] = [
        { id: 'c1', name: 'Crit 1', shortName: 'C1', description: '', category: 'growth', defaultWeight: 100 },
      ];
      const optA: Option = {
        id: 'tieA', name: 'Tie A', tagline: '', description: '', color: '', accentBorder: '',
        scores: { c1: 80 }, strengths: [], vulnerabilities: [],
      };
      const optB: Option = {
        id: 'tieB', name: 'Tie B', tagline: '', description: '', color: '', accentBorder: '',
        scores: { c1: 80 }, strengths: [], vulnerabilities: [],
      };

      const result = runDecisionEngine([optA, optB], crit, { c1: 100 });
      expect(result.winner.weightedScore).toBe(80);
      expect(result.runnerUp?.weightedScore).toBe(80);
      expect(result.winner.rank).toBe(1);
      expect(result.runnerUp?.rank).toBe(1);
      expect(result.isTie).toBe(true);
      expect(result.tiedWinnerIds).toEqual(['tieA', 'tieB']);
      expect(result.decisionOutcome).toBe('tie');
      expect(result.runnerUp?.scoreDifferenceToLeader).toBe(0);
    });
  });
});
