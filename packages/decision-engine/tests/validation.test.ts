import { describe, it, expect } from 'vitest';
import { evaluateDecision, ValidationError } from '../src';
import type { EngineCriterion, EngineOption } from '../src';

describe('Canonical Decision Engine v1 Validation Suite', () => {
  const validCriteria: EngineCriterion[] = [
    { id: 'c1', name: 'Criterion 1', weight: 50 },
    { id: 'c2', name: 'Criterion 2', weight: 50 },
  ];
  const validOptions: EngineOption[] = [
    { id: 'o1', name: 'Option 1', scores: { c1: 80, c2: 70 } },
    { id: 'o2', name: 'Option 2', scores: { c1: 60, c2: 90 } },
  ];

  it('rejects empty criteria array', () => {
    expect(() =>
      evaluateDecision({
        criteria: [],
        options: validOptions,
      })
    ).toThrowError(ValidationError);
    expect(() =>
      evaluateDecision({
        criteria: [],
        options: validOptions,
      })
    ).toThrowError(/Decision matrix must contain at least one criterion/);
  });

  it('rejects empty options array', () => {
    expect(() =>
      evaluateDecision({
        criteria: validCriteria,
        options: [],
      })
    ).toThrowError(/Decision matrix must contain at least one option to evaluate/);
  });

  it('rejects duplicate criterion IDs', () => {
    expect(() =>
      evaluateDecision({
        criteria: [
          { id: 'c1', name: 'Criterion 1', weight: 50 },
          { id: 'c1', name: 'Duplicate', weight: 50 },
        ],
        options: validOptions,
      })
    ).toThrowError(/Duplicate criterion ID 'c1' detected/);
  });

  it('rejects duplicate option IDs', () => {
    expect(() =>
      evaluateDecision({
        criteria: validCriteria,
        options: [
          { id: 'o1', name: 'Option 1', scores: { c1: 80, c2: 70 } },
          { id: 'o1', name: 'Duplicate Option', scores: { c1: 80, c2: 70 } },
        ],
      })
    ).toThrowError(/Duplicate option ID 'o1' detected/);
  });

  it('rejects negative criterion weights', () => {
    expect(() =>
      evaluateDecision({
        criteria: [
          { id: 'c1', name: 'C1', weight: -5 },
          { id: 'c2', name: 'C2', weight: 50 },
        ],
        options: validOptions,
      })
    ).toThrowError(/Weight for criterion 'c1' cannot be negative/);
  });

  it('rejects non-finite criterion weights (NaN / Infinity)', () => {
    expect(() =>
      evaluateDecision({
        criteria: [
          { id: 'c1', name: 'C1', weight: NaN },
          { id: 'c2', name: 'C2', weight: 50 },
        ],
        options: validOptions,
      })
    ).toThrowError(/Weight for criterion 'c1' must be a finite number/);

    expect(() =>
      evaluateDecision({
        criteria: [
          { id: 'c1', name: 'C1', weight: Infinity },
          { id: 'c2', name: 'C2', weight: 50 },
        ],
        options: validOptions,
      })
    ).toThrowError(/Weight for criterion 'c1' must be a finite number/);
  });

  it('rejects missing scores on an option (no silent 50 fallback)', () => {
    expect(() =>
      evaluateDecision({
        criteria: validCriteria,
        options: [
          { id: 'o1', name: 'Option 1', scores: { c1: 80 } }, // c2 missing!
          validOptions[1],
        ],
      })
    ).toThrowError(/Option 'o1' is missing required score for criterion 'c2'/);
  });

  it('rejects out-of-bounds scores (> 100 or < 0)', () => {
    expect(() =>
      evaluateDecision({
        criteria: validCriteria,
        options: [
          { id: 'o1', name: 'Option 1', scores: { c1: 100.1, c2: 50 } },
          validOptions[1],
        ],
      })
    ).toThrowError(/Score for option 'o1' on criterion 'c1' must be between 0.0 and 100.0/);

    expect(() =>
      evaluateDecision({
        criteria: validCriteria,
        options: [
          { id: 'o1', name: 'Option 1', scores: { c1: -0.1, c2: 50 } },
          validOptions[1],
        ],
      })
    ).toThrowError(/Score for option 'o1' on criterion 'c1' must be between 0.0 and 100.0/);
  });

  it('rejects non-finite scores (NaN, Infinity)', () => {
    expect(() =>
      evaluateDecision({
        criteria: validCriteria,
        options: [
          { id: 'o1', name: 'Option 1', scores: { c1: NaN, c2: 50 } },
          validOptions[1],
        ],
      })
    ).toThrowError(/Score for option 'o1' on criterion 'c1' must be a finite number/);

    expect(() =>
      evaluateDecision({
        criteria: validCriteria,
        options: [
          { id: 'o1', name: 'Option 1', scores: { c1: Infinity, c2: 50 } },
          validOptions[1],
        ],
      })
    ).toThrowError(/Score for option 'o1' on criterion 'c1' must be a finite number/);
  });

  it('rejects invalid or non-string criterion id', () => {
    expect(() =>
      evaluateDecision({
        criteria: [{ id: '', name: 'Empty ID', weight: 50 }, validCriteria[1]],
        options: validOptions,
      })
    ).toThrowError(/Criterion must have a valid string id/);
  });

  it('rejects invalid or non-string option id', () => {
    expect(() =>
      evaluateDecision({
        criteria: validCriteria,
        options: [{ id: '', name: 'Empty Option ID', scores: { c1: 50, c2: 50 } }, validOptions[1]],
      })
    ).toThrowError(/Option must have a valid string id/);
  });

  it('rejects option with missing scores object', () => {
    expect(() =>
      evaluateDecision({
        criteria: validCriteria,
        options: [{ id: 'bad', name: 'Bad Option', scores: null as any }, validOptions[1]],
      })
    ).toThrowError(/Option 'bad' is missing a scores object/);
  });

  it('evaluates decision with inline Monte Carlo configuration', () => {
    const result = evaluateDecision({
      criteria: validCriteria,
      options: validOptions,
      monteCarloConfig: { iterations: 100, seed: 123 },
    });
    expect(result.monteCarlo).toBeDefined();
    expect(result.monteCarlo?.iterations).toBe(100);
  });
});
