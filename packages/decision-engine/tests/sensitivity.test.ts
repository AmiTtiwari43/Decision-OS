import { describe, it, expect } from 'vitest';
import { evaluateDecision } from '../src';
import type { EngineCriterion, EngineOption } from '../src';

describe('Canonical Decision Engine v1 Sensitivity & Tipping Point Suite', () => {
  it('correctly handles single option with unreachable sensitivity', () => {
    const criteria: EngineCriterion[] = [
      { id: 'c1', name: 'C1', weight: 50 },
      { id: 'c2', name: 'C2', weight: 50 },
    ];
    const options: EngineOption[] = [
      { id: 'o1', name: 'Sole Option', scores: { c1: 80, c2: 80 } },
    ];

    const result = evaluateDecision({ criteria, options });
    expect(result.sensitivity.length).toBe(2);
    expect(result.sensitivity[0].feasibility).toBe('unreachable');
    expect(result.sensitivity[0].tippingPointWeight).toBeNull();
  });

  it('marks unreachable when single criterion evaluates (cannot shift weight to other criteria)', () => {
    const criteria: EngineCriterion[] = [{ id: 'c1', name: 'C1', weight: 100 }];
    const options: EngineOption[] = [
      { id: 'o1', name: 'Leader', scores: { c1: 90 } },
      { id: 'o2', name: 'Challenger', scores: { c1: 60 } },
    ];

    const result = evaluateDecision({ criteria, options });
    expect(result.sensitivity[0].feasibility).toBe('unreachable');
    expect(result.sensitivity[0].tippingPointWeight).toBeNull();
  });

  it('proves mathematical breakeven at calculated tipping point', () => {
    const criteria: EngineCriterion[] = [
      { id: 'c1', name: 'Locked Crit', weight: 40, isLocked: true },
      { id: 'c2', name: 'Tested Crit', weight: 30, isLocked: false },
      { id: 'c3', name: 'Buffer Crit', weight: 30, isLocked: false },
    ];
    const options: EngineOption[] = [
      { id: 'optA', name: 'Leader', scores: { c1: 70, c2: 60, c3: 95 } },
      { id: 'optB', name: 'Challenger', scores: { c1: 70, c2: 90, c3: 60 } },
    ];

    const result = evaluateDecision({ criteria, options });
    const c2Sensitivity = result.sensitivity.find(s => s.criterionId === 'c2')!;

    expect(c2Sensitivity.tippingPointWeight).toBe(32.3);
    expect(c2Sensitivity.wouldFlipToOptionId).toBe('optB');

    // Test breakeven score at calculated tipping point weight
    // c1 = 40.0, c2 = 32.3, c3 = 100 - 40 - 32.3 = 27.7
    const tippingDecision = evaluateDecision({
      criteria: [
        { id: 'c1', name: 'Locked Crit', weight: 40, isLocked: true },
        { id: 'c2', name: 'Tested Crit', weight: 32.3, isLocked: true },
        { id: 'c3', name: 'Buffer Crit', weight: 27.7, isLocked: true },
      ],
      options,
    });

    const scoreA = tippingDecision.evaluations.find(e => e.optionId === 'optA')!.weightedScore;
    const scoreB = tippingDecision.evaluations.find(e => e.optionId === 'optB')!.weightedScore;

    // Both scores equalize within 0.1 decimal rounding
    expect(Math.abs(scoreA - scoreB)).toBeLessThanOrEqual(0.1);
  });
});
