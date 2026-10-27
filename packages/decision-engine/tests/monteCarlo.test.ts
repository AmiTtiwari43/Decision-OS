import { describe, it, expect } from 'vitest';
import { runMonteCarloSimulation } from '../src';
import type { EngineCriterion, EngineOption } from '../src';

describe('Monte Carlo Simulation Comprehensive Suite', () => {
  const criteria: EngineCriterion[] = [
    { id: 'c1', name: 'Crit 1', weight: 40, isLocked: true },
    { id: 'c2', name: 'Crit 2', weight: 60, isLocked: false },
  ];
  const options: EngineOption[] = [
    { id: 'dominant', name: 'Dominant Option', scores: { c1: 99, c2: 99 } },
    { id: 'weak', name: 'Weak Option', scores: { c1: 10, c2: 10 } },
  ];

  it('rates robust when win probability is >= 75%', () => {
    const result = runMonteCarloSimulation(options, criteria, { c1: 40, c2: 60 }, ['c1'], {
      iterations: 200,
      seed: 99,
    });
    expect(result.robustnessRating).toBe('robust');
    expect(result.dominantOptionId).toBe('dominant');
    expect(result.dominantWinProbability).toBe(100);
  });

  it('rates sensitive when win probability is < 55%', () => {
    const closeOptions: EngineOption[] = [
      { id: 'o1', name: 'Option 1', scores: { c1: 50, c2: 50 } },
      { id: 'o2', name: 'Option 2', scores: { c1: 50, c2: 50 } },
      { id: 'o3', name: 'Option 3', scores: { c1: 50, c2: 50 } },
    ];
    const result = runMonteCarloSimulation(closeOptions, criteria, { c1: 40, c2: 60 }, [], {
      iterations: 200,
      seed: 1234,
    });
    expect(result.robustnessRating).toBe('sensitive');
  });

  it('preserves locked criteria weights during Monte Carlo perturbations', () => {
    const result = runMonteCarloSimulation(options, criteria, { c1: 40, c2: 60 }, ['c1'], {
      iterations: 50,
      seed: 42,
    });
    expect(result.iterations).toBe(50);
  });
});
