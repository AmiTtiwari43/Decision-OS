import { describe, it, expect } from 'vitest';
import { normalizeWeights, ValidationError } from '../src';
import type { EngineCriterion } from '../src';

describe('Canonical Decision Engine v1 Normalization Suite', () => {
  it('throws if sum of locked weights exceeds 100%', () => {
    const criteria: EngineCriterion[] = [
      { id: 'c1', name: 'C1', weight: 60, isLocked: true },
      { id: 'c2', name: 'C2', weight: 45, isLocked: true },
    ];
    expect(() => normalizeWeights(criteria)).toThrowError(ValidationError);
    expect(() => normalizeWeights(criteria)).toThrowError(
      /Sum of locked weights \(105%\) exceeds 100.0%/
    );
  });

  it('throws if all criteria are locked but their sum does not equal 100%', () => {
    const criteria: EngineCriterion[] = [
      { id: 'c1', name: 'C1', weight: 50, isLocked: true },
      { id: 'c2', name: 'C2', weight: 40, isLocked: true },
    ];
    expect(() => normalizeWeights(criteria)).toThrowError(ValidationError);
    expect(() => normalizeWeights(criteria)).toThrowError(
      /All criteria are locked but their sum \(90%\) does not equal 100.0%/
    );
  });

  it('accepts all criteria locked if their sum is exactly 100%', () => {
    const criteria: EngineCriterion[] = [
      { id: 'c1', name: 'C1', weight: 60, isLocked: true },
      { id: 'c2', name: 'C2', weight: 40, isLocked: true },
    ];
    const normalized = normalizeWeights(criteria);
    expect(normalized.c1).toBe(60.0);
    expect(normalized.c2).toBe(40.0);
  });

  it('assigns 0.0% to unlocked criteria when locked sum is exactly 100%', () => {
    const criteria: EngineCriterion[] = [
      { id: 'c1', name: 'C1', weight: 100, isLocked: true },
      { id: 'c2', name: 'C2', weight: 50, isLocked: false },
    ];
    const normalized = normalizeWeights(criteria);
    expect(normalized.c1).toBe(100.0);
    expect(normalized.c2).toBe(0.0);
  });

  it('is strictly order-invariant: reordering input criteria produces identical normalized weights', () => {
    const criteriaForward: EngineCriterion[] = [
      { id: 'c1', name: 'C1', weight: 33 },
      { id: 'c2', name: 'C2', weight: 33 },
      { id: 'c3', name: 'C3', weight: 34 },
    ];
    const criteriaReverse: EngineCriterion[] = [
      { id: 'c3', name: 'C3', weight: 34 },
      { id: 'c2', name: 'C2', weight: 33 },
      { id: 'c1', name: 'C1', weight: 33 },
    ];

    const normForward = normalizeWeights(criteriaForward);
    const normReverse = normalizeWeights(criteriaReverse);

    expect(normForward).toEqual(normReverse);
    const sum = Object.values(normForward).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 10) / 10).toBe(100.0);
  });

  it('handles single criterion by normalizing to 100.0%', () => {
    const criteria: EngineCriterion[] = [{ id: 'c1', name: 'Single', weight: 42 }];
    const normalized = normalizeWeights(criteria);
    expect(normalized.c1).toBe(100.0);
  });

  it('guarantees zero weight drift across 100 random weight combinations', () => {
    for (let i = 1; i <= 100; i++) {
      const criteria: EngineCriterion[] = [
        { id: 'a', name: 'A', weight: (i * 7) % 53 },
        { id: 'b', name: 'B', weight: (i * 13) % 47 },
        { id: 'c', name: 'C', weight: (i * 23) % 71 },
      ];
      const normalized = normalizeWeights(criteria);
      const sum = Object.values(normalized).reduce((a, b) => a + b, 0);
      expect(Math.round(sum * 10) / 10).toBe(100.0);
    }
  });
});
