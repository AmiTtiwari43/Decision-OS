import { describe, it, expect } from 'vitest';
import { mapServerAnalysisToEngineResult } from './engineMapper.js';
import type { EngineResult as CanonicalEngineResult } from '@decision-os/decision-engine';
import type { Option, Criterion } from '../types/decision.js';

describe('engineMapper', () => {
  const criteria: Criterion[] = [
    {
      id: 'perf',
      name: 'Performance',
      shortName: 'Perf',
      description: 'System speed',
      category: 'growth',
      defaultWeight: 60,
    },
    {
      id: 'cost',
      name: 'Cost Efficiency',
      shortName: 'Cost',
      description: 'Budget friendliness',
      category: 'finance',
      defaultWeight: 40,
    },
  ];

  const options: Option[] = [
    {
      id: 'alpha',
      name: 'Option Alpha',
      tagline: 'Speed focus',
      description: 'High performance',
      color: '#B8FF5A',
      accentBorder: 'border-signal',
      scores: { perf: 90, cost: 60 },
      strengths: [],
      vulnerabilities: [],
    },
    {
      id: 'beta',
      name: 'Option Beta',
      tagline: 'Economy focus',
      description: 'High efficiency',
      color: '#38BDF8',
      accentBorder: 'border-sky-500',
      scores: { perf: 60, cost: 95 },
      strengths: [],
      vulnerabilities: [],
    },
  ];

  const mockServerAnalysis: CanonicalEngineResult = {
    engineVersion: '1.0.0',
    evaluatedAt: '2026-10-29T15:00:00.000Z',
    isTie: false,
    decisionOutcome: 'decisive',
    winnerId: 'alpha',
    tiedWinnerIds: [],
    pointLead: 4.0,
    evaluations: [
      {
        optionId: 'alpha',
        optionName: 'Option Alpha',
        unroundedScore: 78.0,
        weightedScore: 78.0,
        rank: 1,
        presentationOrder: 1,
        scoreDifferenceToLeader: 0,
        contributions: [
          { criterionId: 'perf', rawScore: 90, weight: 60, weightedPoints: 54, percentageOfTotal: 69.23 },
          { criterionId: 'cost', rawScore: 60, weight: 40, weightedPoints: 24, percentageOfTotal: 30.77 },
        ],
      },
      {
        optionId: 'beta',
        optionName: 'Option Beta',
        unroundedScore: 74.0,
        weightedScore: 74.0,
        rank: 2,
        presentationOrder: 2,
        scoreDifferenceToLeader: 4.0,
        contributions: [
          { criterionId: 'perf', rawScore: 60, weight: 60, weightedPoints: 36, percentageOfTotal: 48.65 },
          { criterionId: 'cost', rawScore: 95, weight: 40, weightedPoints: 38, percentageOfTotal: 51.35 },
        ],
      },
    ],
    normalizedWeights: { perf: 60.0, cost: 40.0 },
    totalWeight: 100.0,
    sensitivity: [
      {
        criterionId: 'cost',
        currentWeight: 40,
        tippingPointWeight: 46.2,
        weightDeltaNeeded: 6.2,
        direction: 'increase',
        feasibility: 'low-threshold',
        wouldFlipToOptionId: 'beta',
        summary: 'Increasing Cost Efficiency weight from 40% to 46.2% flips winner to Option Beta.',
      },
      {
        criterionId: 'perf',
        currentWeight: 60,
        tippingPointWeight: 53.8,
        weightDeltaNeeded: -6.2,
        direction: 'decrease',
        feasibility: 'low-threshold',
        wouldFlipToOptionId: 'beta',
        summary: 'Decreasing Performance weight from 60% to 53.8% flips winner to Option Beta.',
      },
    ],
  };

  it('maps server evaluations and authoritative rankings faithfully', () => {
    const result = mapServerAnalysisToEngineResult(mockServerAnalysis, options, criteria);

    expect(result.isAuthoritative).toBe(true);
    expect(result.engineVersion).toBe('1.0.0');
    expect(result.evaluatedAt).toBe('2026-10-29T15:00:00.000Z');
    expect(result.winner.option.id).toBe('alpha');
    expect(result.winner.weightedScore).toBe(78.0);
    expect(result.winner.rank).toBe(1);
    expect(result.runnerUp?.option.id).toBe('beta');
    expect(result.runnerUp?.weightedScore).toBe(74.0);
    expect(result.runnerUp?.scoreDifferenceToLeader).toBe(4.0);
    expect(result.explainability.pointLead).toBe(4.0);
    expect(result.explainability.headline).toContain('Option Alpha fits your current priorities better (+4.0 pts)');
  });

  it('correctly maps sensitivity tipping points and identifies flip option names', () => {
    const result = mapServerAnalysisToEngineResult(mockServerAnalysis, options, criteria);

    expect(result.sensitivity).toHaveLength(2);
    const costSensitivity = result.sensitivity.find((s) => s.criterionId === 'cost');
    expect(costSensitivity?.tippingPointWeight).toBe(46.2);
    expect(costSensitivity?.wouldFlipToOptionName).toBe('Option Beta');
    expect(costSensitivity?.feasibility).toBe('low-threshold');
  });

  it('handles mathematical ties faithfully without fabricating a single winner', () => {
    const tieAnalysis: CanonicalEngineResult = {
      ...mockServerAnalysis,
      isTie: true,
      decisionOutcome: 'tie',
      winnerId: null,
      tiedWinnerIds: ['alpha', 'beta'],
      pointLead: 0,
      evaluations: [
        { ...mockServerAnalysis.evaluations[0], weightedScore: 75.0, rank: 1, scoreDifferenceToLeader: 0 },
        { ...mockServerAnalysis.evaluations[1], weightedScore: 75.0, rank: 1, scoreDifferenceToLeader: 0 },
      ],
    };

    const result = mapServerAnalysisToEngineResult(tieAnalysis, options, criteria);

    expect(result.isTie).toBe(true);
    expect(result.decisionOutcome).toBe('tie');
    expect(result.tiedWinnerIds).toEqual(['alpha', 'beta']);
    expect(result.explainability.headline).toContain('Mathematical Tie');
    expect(result.explainability.dynamicRationale).toContain('exact tie under canonical Hare-Niemeyer normalization');
  });
});
