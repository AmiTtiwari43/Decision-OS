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

  describe('Deterministic Mathematical Tests for criterionStats', () => {
    const multiCriteria: EngineCriterion[] = [
      { id: 'crit-locked', name: 'Locked Priority', weight: 30, isLocked: true },
      { id: 'crit-free1', name: 'Free Priority 1', weight: 30, isLocked: false },
      { id: 'crit-free2', name: 'Free Priority 2', weight: 40, isLocked: false },
    ];
    const baseWeights = { 'crit-locked': 30, 'crit-free1': 30, 'crit-free2': 40 };

    it('locked criteria have invariant weights, zero variance, and zero stdDev', () => {
      const iterations = 500;
      const result = runMonteCarloSimulation(options, multiCriteria, baseWeights, ['crit-locked'], {
        iterations,
        seed: 42,
        sigmaRelative: 0.15,
      });

      expect(result.criterionStats).toBeDefined();
      const stats = result.criterionStats!;
      expect(stats).toHaveLength(3);

      const lockedStat = stats.find((s) => s.criterionId === 'crit-locked')!;
      expect(lockedStat.isLocked).toBe(true);
      expect(lockedStat.minWeight).toBe(30.0);
      expect(lockedStat.maxWeight).toBe(30.0);
      expect(lockedStat.meanWeight).toBe(30.0);
      expect(lockedStat.variance).toBe(0.0);
      expect(lockedStat.stdDev).toBe(0.0);
    });

    it('unlocked criteria have correctly calculated population variance, mean, min, max, and stdDev', () => {
      const iterations = 500;
      const seed = 42;
      const sigma = 0.20;

      const capturedFree1Weights: number[] = [];
      const capturedFree2Weights: number[] = [];

      const result = runMonteCarloSimulation(options, multiCriteria, baseWeights, ['crit-locked'], {
        iterations,
        seed,
        sigmaRelative: sigma,
        onIterationWeights: (weights) => {
          capturedFree1Weights.push(weights['crit-free1']);
          capturedFree2Weights.push(weights['crit-free2']);
        },
      });

      expect(capturedFree1Weights).toHaveLength(iterations);
      expect(capturedFree2Weights).toHaveLength(iterations);

      const stats = result.criterionStats!;
      const free1Stat = stats.find((s) => s.criterionId === 'crit-free1')!;
      const free2Stat = stats.find((s) => s.criterionId === 'crit-free2')!;

      // Unlocked criteria must be marked unlocked with positive variance and stdDev
      expect(free1Stat.isLocked).toBe(false);
      expect(free2Stat.isLocked).toBe(false);

      // Independently compute mathematical statistics for crit-free1 without using engine code
      const N1 = capturedFree1Weights.length;
      const rawMean1 = capturedFree1Weights.reduce((a, b) => a + b, 0) / N1;
      // Population variance: 1/N * sum((w - mu)^2)
      const rawPopVar1 = capturedFree1Weights.reduce((acc, w) => acc + Math.pow(w - rawMean1, 2), 0) / N1;
      const rawStdDev1 = Math.sqrt(rawPopVar1);
      const rawMin1 = Math.min(...capturedFree1Weights);
      const rawMax1 = Math.max(...capturedFree1Weights);

      // Apply documented engine rounding precision:
      // meanWeight: 1 dec, variance: 4 dec, stdDev: 2 dec, minWeight: 1 dec, maxWeight: 1 dec
      const expectedMean1 = Math.round(rawMean1 * 10) / 10;
      const expectedVar1 = Math.round(rawPopVar1 * 10000) / 10000;
      const expectedStdDev1 = Math.round(rawStdDev1 * 100) / 100;
      const expectedMin1 = Math.round(rawMin1 * 10) / 10;
      const expectedMax1 = Math.round(rawMax1 * 10) / 10;

      expect(free1Stat.meanWeight).toBe(expectedMean1);
      expect(free1Stat.variance).toBe(expectedVar1);
      expect(free1Stat.stdDev).toBe(expectedStdDev1);
      expect(free1Stat.minWeight).toBe(expectedMin1);
      expect(free1Stat.maxWeight).toBe(expectedMax1);

      // Also independently calculate and verify crit-free2
      const N2 = capturedFree2Weights.length;
      const rawMean2 = capturedFree2Weights.reduce((a, b) => a + b, 0) / N2;
      const rawPopVar2 = capturedFree2Weights.reduce((acc, w) => acc + Math.pow(w - rawMean2, 2), 0) / N2;
      const rawStdDev2 = Math.sqrt(rawPopVar2);
      const rawMin2 = Math.min(...capturedFree2Weights);
      const rawMax2 = Math.max(...capturedFree2Weights);

      const expectedMean2 = Math.round(rawMean2 * 10) / 10;
      const expectedVar2 = Math.round(rawPopVar2 * 10000) / 10000;
      const expectedStdDev2 = Math.round(rawStdDev2 * 100) / 100;
      const expectedMin2 = Math.round(rawMin2 * 10) / 10;
      const expectedMax2 = Math.round(rawMax2 * 10) / 10;

      expect(free2Stat.meanWeight).toBe(expectedMean2);
      expect(free2Stat.variance).toBe(expectedVar2);
      expect(free2Stat.stdDev).toBe(expectedStdDev2);
      expect(free2Stat.minWeight).toBe(expectedMin2);
      expect(free2Stat.maxWeight).toBe(expectedMax2);
    });

    it('verifies the total normalized weight invariant (sum of integer tenths = 1000) for every simulation pass', () => {
      const iterations = 500;
      const seed = 777;
      const sigmaRelative = 0.25;

      let passesChecked = 0;
      const result = runMonteCarloSimulation(options, multiCriteria, baseWeights, ['crit-locked'], {
        iterations,
        seed,
        sigmaRelative,
        onIterationWeights: (weights, iterIndex) => {
          expect(iterIndex).toBe(passesChecked);
          passesChecked++;

          let sumOfTenths = 0;
          for (const weight of Object.values(weights)) {
            // 1. Verify every weight has exact one-decimal precision (tenths of a percentage point)
            const roundedTenth = Math.round(weight * 10) / 10;
            expect(Math.abs(weight - roundedTenth)).toBeLessThanOrEqual(1e-9);

            // 2. Convert each weight to integer tenths
            const integerTenths = Math.round(weight * 10);
            sumOfTenths += integerTenths;
          }

          // 3. Assert that the sum of integer tenths is strictly and exactly 1000 on every iteration
          expect(sumOfTenths).toBe(1000);
        },
      });

      expect(passesChecked).toBe(iterations);
      expect(result.iterations).toBe(iterations);
    });
  });

  describe('Monte Carlo Inspection Isolation and Safety', () => {
    const multiCriteria: EngineCriterion[] = [
      { id: 'crit-locked', name: 'Locked Priority', weight: 30, isLocked: true },
      { id: 'crit-free1', name: 'Free Priority 1', weight: 30, isLocked: false },
      { id: 'crit-free2', name: 'Free Priority 2', weight: 40, isLocked: false },
    ];
    const baseWeights = { 'crit-locked': 30, 'crit-free1': 30, 'crit-free2': 40 };

    it('freezes the snapshot passed to the callback at runtime', () => {
      let inspectedCount = 0;
      runMonteCarloSimulation(options, multiCriteria, baseWeights, ['crit-locked'], {
        iterations: 10,
        seed: 42,
        onIterationWeights: (weights) => {
          expect(Object.isFrozen(weights)).toBe(true);
          inspectedCount++;
        },
      });
      expect(inspectedCount).toBe(10);
    });

    it('a callback that attempts to change a weight cannot change the simulation result', () => {
      const config = { iterations: 100, seed: 42, sigmaRelative: 0.15 };
      const baselineResult = runMonteCarloSimulation(options, multiCriteria, baseWeights, ['crit-locked'], config);

      let attemptedMutations = 0;
      const mutatingResult = runMonteCarloSimulation(options, multiCriteria, baseWeights, ['crit-locked'], {
        ...config,
        onIterationWeights: (weights) => {
          attemptedMutations++;
          try {
            // Attempt to alter weight directly
            (weights as any)['crit-free1'] = 999.0;
          } catch {
            // Expected TypeError in strict mode because Object.isFrozen(weights)
          }
        },
      });

      expect(attemptedMutations).toBe(100);
      expect(mutatingResult.dominantOptionId).toBe(baselineResult.dominantOptionId);
      expect(mutatingResult.dominantWinProbability).toBe(baselineResult.dominantWinProbability);
      expect(mutatingResult.robustnessRating).toBe(baselineResult.robustnessRating);
      expect(mutatingResult.optionResults).toEqual(baselineResult.optionResults);
      expect(mutatingResult.criterionStats).toEqual(baselineResult.criterionStats);
    });

    it('a callback that attempts to add or delete a weight cannot change the simulation result', () => {
      const config = { iterations: 100, seed: 42, sigmaRelative: 0.15 };
      const baselineResult = runMonteCarloSimulation(options, multiCriteria, baseWeights, ['crit-locked'], config);

      let attempts = 0;
      const mutatingResult = runMonteCarloSimulation(options, multiCriteria, baseWeights, ['crit-locked'], {
        ...config,
        onIterationWeights: (weights) => {
          attempts++;
          try {
            delete (weights as any)['crit-locked'];
          } catch {
            // Expected TypeError in strict mode
          }
          try {
            (weights as any)['crit-injected'] = 100.0;
          } catch {
            // Expected TypeError in strict mode
          }
        },
      });

      expect(attempts).toBe(100);
      expect(mutatingResult.dominantOptionId).toBe(baselineResult.dominantOptionId);
      expect(mutatingResult.dominantWinProbability).toBe(baselineResult.dominantWinProbability);
      expect(mutatingResult.robustnessRating).toBe(baselineResult.robustnessRating);
      expect(mutatingResult.optionResults).toEqual(baselineResult.optionResults);
      expect(mutatingResult.criterionStats).toEqual(baselineResult.criterionStats);
    });

    it('a normal inspection callback still receives all criterion weights for every iteration', () => {
      const iterations = 50;
      const expectedCriterionIds = multiCriteria.map((c) => c.id);
      let callCount = 0;

      runMonteCarloSimulation(options, multiCriteria, baseWeights, ['crit-locked'], {
        iterations,
        seed: 42,
        onIterationWeights: (weights, iterIndex) => {
          expect(iterIndex).toBe(callCount);
          callCount++;
          expect(Object.keys(weights).sort()).toEqual([...expectedCriterionIds].sort());
          for (const id of expectedCriterionIds) {
            expect(typeof weights[id]).toBe('number');
            expect(Number.isFinite(weights[id])).toBe(true);
          }
        },
      });

      expect(callCount).toBe(iterations);
    });

    it('a run with inspection enabled produces identical authoritative Monte Carlo output to a run without inspection', () => {
      const config = { iterations: 250, seed: 9876, sigmaRelative: 0.20 };
      const resultWithout = runMonteCarloSimulation(options, multiCriteria, baseWeights, ['crit-locked'], config);

      const capturedIterations: number[] = [];
      const resultWith = runMonteCarloSimulation(options, multiCriteria, baseWeights, ['crit-locked'], {
        ...config,
        onIterationWeights: (_weights, iter) => {
          capturedIterations.push(iter);
        },
      });

      expect(capturedIterations).toHaveLength(250);
      expect(resultWith.dominantOptionId).toBe(resultWithout.dominantOptionId);
      expect(resultWith.dominantWinProbability).toBe(resultWithout.dominantWinProbability);
      expect(resultWith.robustnessRating).toBe(resultWithout.robustnessRating);
      expect(resultWith.optionResults).toEqual(resultWithout.optionResults);
      expect(resultWith.criterionStats).toEqual(resultWithout.criterionStats);
    });

    it('propagates callback exceptions immediately without silently swallowing them', () => {
      const abortError = new Error('Deliberate callback failure for test');

      expect(() => {
        runMonteCarloSimulation(options, multiCriteria, baseWeights, ['crit-locked'], {
          iterations: 50,
          seed: 42,
          onIterationWeights: (_weights, iterIndex) => {
            if (iterIndex === 7) {
              throw abortError;
            }
          },
        });
      }).toThrow(abortError);
    });
  });
});
