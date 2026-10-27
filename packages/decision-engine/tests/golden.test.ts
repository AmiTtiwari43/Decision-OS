import { describe, it, expect } from 'vitest';
import golden from './fixtures/golden.json';
import {
  evaluateDecision,
  normalizeWeights,
  ValidationError,
  runMonteCarloSimulation,
} from '../src';
import type { EngineCriterion, EngineOption } from '../src';

describe('Canonical Decision Engine v1 Golden Fixtures (G1–G10)', () => {
  it('G1: Basic Weighted Decision', () => {
    const fixture = golden.G1;
    const result = evaluateDecision({
      criteria: fixture.criteria as EngineCriterion[],
      options: fixture.options as EngineOption[],
    });

    expect(result.normalizedWeights).toEqual(fixture.expected.normalizedWeights);
    expect(result.isTie).toBe(fixture.expected.isTie);
    expect(result.winnerId).toBe(fixture.expected.winnerId);
    expect(result.pointLead).toBe(fixture.expected.pointLead);

    const optA = result.evaluations.find(e => e.optionId === 'optA')!;
    const optB = result.evaluations.find(e => e.optionId === 'optB')!;

    expect(optA.weightedScore).toBe(fixture.expected.scores.optA);
    expect(optB.weightedScore).toBe(fixture.expected.scores.optB);
    expect(optA.rank).toBe(fixture.expected.ranks.optA);
    expect(optB.rank).toBe(fixture.expected.ranks.optB);
  });

  it('G2: Multi-Option Ranking', () => {
    const fixture = golden.G2;
    const result = evaluateDecision({
      criteria: fixture.criteria as EngineCriterion[],
      options: fixture.options as EngineOption[],
    });

    expect(result.normalizedWeights).toEqual(fixture.expected.normalizedWeights);
    expect(result.isTie).toBe(fixture.expected.isTie);
    expect(result.winnerId).toBe(fixture.expected.winnerId);

    for (const opt of fixture.options) {
      const evaluation = result.evaluations.find(e => e.optionId === opt.id)!;
      expect(evaluation.unroundedScore).toBeCloseTo(
        (fixture.expected.exactScores as Record<string, number>)[opt.id],
        3
      );
      expect(evaluation.rank).toBe((fixture.expected.ranks as Record<string, number>)[opt.id]);
    }
  });

  it('G3: Proportional Normalization + Largest Remainder (Hare-Niemeyer)', () => {
    const fixture = golden.G3;
    const normalized = normalizeWeights(fixture.criteria as EngineCriterion[]);

    expect(normalized).toEqual(fixture.expected.normalizedWeights);
    const sum = Object.values(normalized).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 10) / 10).toBe(fixture.expected.totalWeight);
  });

  it('G4: Locked Criteria Constraints', () => {
    const fixture = golden.G4;
    const normalized = normalizeWeights(fixture.criteria as EngineCriterion[]);

    expect(normalized).toEqual(fixture.expected.normalizedWeights);
    const sum = Object.values(normalized).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 10) / 10).toBe(fixture.expected.totalWeight);
  });

  it('G5: All-Zero Raw Weights', () => {
    const fixture = golden.G5;
    const normalized = normalizeWeights(fixture.criteria as EngineCriterion[]);

    expect(normalized).toEqual(fixture.expected.normalizedWeights);
    const sum = Object.values(normalized).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 10) / 10).toBe(fixture.expected.totalWeight);
  });

  it('G6: Missing Score Rejection', () => {
    const fixture = golden.G6;
    expect(() =>
      evaluateDecision({
        criteria: fixture.criteria as EngineCriterion[],
        options: fixture.options as EngineOption[],
      })
    ).toThrowError(ValidationError);

    expect(() =>
      evaluateDecision({
        criteria: fixture.criteria as EngineCriterion[],
        options: fixture.options as EngineOption[],
      })
    ).toThrow(fixture.expectedError);
  });

  it('G7: Invalid Score Rejection', () => {
    const fixture = golden.G7;
    expect(() =>
      evaluateDecision({
        criteria: fixture.criteria as EngineCriterion[],
        options: fixture.options as EngineOption[],
      })
    ).toThrowError(ValidationError);

    expect(() =>
      evaluateDecision({
        criteria: fixture.criteria as EngineCriterion[],
        options: fixture.options as EngineOption[],
      })
    ).toThrow(fixture.expectedError);
  });

  it('G8: Exact-Score Tie Behavior', () => {
    const fixture = golden.G8;
    const result = evaluateDecision({
      criteria: fixture.criteria as EngineCriterion[],
      options: fixture.options as EngineOption[],
    });

    expect(result.isTie).toBe(fixture.expected.isTie);
    expect(result.winnerId).toBe(fixture.expected.winnerId);
    expect(result.decisionOutcome).toBe(fixture.expected.decisionOutcome);
    expect(result.tiedWinnerIds).toEqual(fixture.expected.tiedWinnerIds);

    const alpha = result.evaluations.find(e => e.optionId === 'alpha')!;
    const beta = result.evaluations.find(e => e.optionId === 'beta')!;

    expect(alpha.rank).toBe(fixture.expected.ranks.alpha);
    expect(beta.rank).toBe(fixture.expected.ranks.beta);
    expect(alpha.presentationOrder).toBe(fixture.expected.presentationOrder.alpha);
    expect(beta.presentationOrder).toBe(fixture.expected.presentationOrder.beta);
    expect(alpha.weightedScore).toBe(fixture.expected.displayScores.alpha);
    expect(beta.weightedScore).toBe(fixture.expected.displayScores.beta);
  });

  it('G9: Sensitivity / Tipping-Point with Locked Criteria', () => {
    const fixture = golden.G9;
    const result = evaluateDecision({
      criteria: fixture.criteria as EngineCriterion[],
      options: fixture.options as EngineOption[],
    });

    const optA = result.evaluations.find(e => e.optionId === 'optA')!;
    const optB = result.evaluations.find(e => e.optionId === 'optB')!;

    expect(optA.weightedScore).toBe(fixture.expected.optAScore);
    expect(optB.weightedScore).toBe(fixture.expected.optBScore);

    const tipping = result.sensitivity.find(s => s.criterionId === fixture.testedCriterionId)!;
    expect(tipping).toBeDefined();
    expect(tipping.tippingPointWeight).toBe(fixture.expected.tippingPointWeight);
    expect(tipping.weightDeltaNeeded).toBe(fixture.expected.weightDeltaNeeded);
    expect(tipping.direction).toBe(fixture.expected.direction);
    expect(tipping.feasibility).toBe(fixture.expected.feasibility);
    expect(tipping.wouldFlipToOptionId).toBe(fixture.expected.wouldFlipToOptionId);
  });

  it('G10: Deterministic Monte Carlo Reproducibility', () => {
    const criteria: EngineCriterion[] = [
      { id: 'careerGrowth', name: 'Career Growth', weight: 30 },
      { id: 'compensation', name: 'Compensation', weight: 25 },
      { id: 'learning', name: 'Learning & Mentorship', weight: 20 },
      { id: 'workLifeBalance', name: 'Work-Life Balance', weight: 15 },
      { id: 'stability', name: 'Company Stability', weight: 10 },
    ];
    const options: EngineOption[] = [
      {
        id: 'alpha',
        name: 'Company Alpha',
        scores: { careerGrowth: 95, compensation: 70, learning: 92, workLifeBalance: 74, stability: 65 },
      },
      {
        id: 'beta',
        name: 'Company Beta',
        scores: { careerGrowth: 72, compensation: 95, learning: 76, workLifeBalance: 86, stability: 94 },
      },
      {
        id: 'gamma',
        name: 'Company Gamma',
        scores: { careerGrowth: 68, compensation: 78, learning: 80, workLifeBalance: 96, stability: 82 },
      },
    ];

    const mcResult1 = runMonteCarloSimulation(options, criteria, {
      careerGrowth: 30,
      compensation: 25,
      learning: 20,
      workLifeBalance: 15,
      stability: 10,
    }, [], {
      seed: 42,
      iterations: 1000,
      sigmaRelative: 0.15,
    });

    const mcResult2 = runMonteCarloSimulation(options, criteria, {
      careerGrowth: 30,
      compensation: 25,
      learning: 20,
      workLifeBalance: 15,
      stability: 10,
    }, [], {
      seed: 42,
      iterations: 1000,
      sigmaRelative: 0.15,
    });

    // Exact reproducibility guarantee
    expect(mcResult1.dominantOptionId).toBe('beta');
    expect(mcResult1.robustnessRating).toBe('moderate');
    expect(mcResult1.dominantOptionId).toBe(mcResult2.dominantOptionId);
    expect(mcResult1.dominantWinProbability).toBe(mcResult2.dominantWinProbability);
    expect(mcResult1.optionResults).toEqual(mcResult2.optionResults);

    const betaResult = mcResult1.optionResults.find(r => r.optionId === 'beta')!;
    const alphaResult = mcResult1.optionResults.find(r => r.optionId === 'alpha')!;
    const gammaResult = mcResult1.optionResults.find(r => r.optionId === 'gamma')!;

    expect(betaResult.winProbability).toBeGreaterThan(55);
    expect(alphaResult.winProbability).toBeGreaterThan(20);
    expect(gammaResult.winProbability).toBeLessThan(5);
    expect(betaResult.winProbability + alphaResult.winProbability + gammaResult.winProbability).toBeCloseTo(100.0, 1);
  });
});
