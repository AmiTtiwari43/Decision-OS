import { describe, it, expect } from 'vitest';
import {
  evaluateDecision,
  sha256,
  CANONICAL_ENGINE_SPEC_HASH,
  type EngineCriterion,
  type EngineOption,
} from '../src';

describe('Canonical Decision Engine v1 Metadata & Cryptographic Hashes', () => {
  const sampleCriteria: EngineCriterion[] = [
    { id: 'c1', name: 'Performance', weight: 60, isLocked: false },
    { id: 'c2', name: 'Cost', weight: 40, isLocked: false },
  ];

  const sampleOptions: EngineOption[] = [
    { id: 'optA', name: 'Option A', scores: { c1: 90, c2: 70 } },
    { id: 'optB', name: 'Option B', scores: { c1: 60, c2: 95 } },
  ];

  it('verifies all 5 canonical engine metadata fields are present and valid', () => {
    const result = evaluateDecision({
      criteria: sampleCriteria,
      options: sampleOptions,
    });

    // 1. engineVersion
    expect(result.engineVersion).toBe('1.0.0');

    // 2. engineSpecHash
    expect(result.engineSpecHash).toBe(CANONICAL_ENGINE_SPEC_HASH);
    expect(result.engineSpecHash).toMatch(/^sha256-[0-9a-f]{64}$/);

    // 3. evaluatedAt
    expect(result.evaluatedAt).toBeDefined();
    expect(new Date(result.evaluatedAt).getTime()).not.toBeNaN();

    // 4. inputHash
    expect(result.inputHash).toBeDefined();
    expect(result.inputHash).toMatch(/^sha256-[0-9a-f]{64}$/);

    // 5. calculationHash
    expect(result.calculationHash).toBeDefined();
    expect(result.calculationHash).toMatch(/^sha256-[0-9a-f]{64}$/);
  });

  it('produces identical inputHash and calculationHash for identical inputs', () => {
    const r1 = evaluateDecision({ criteria: sampleCriteria, options: sampleOptions });
    const r2 = evaluateDecision({ criteria: sampleCriteria, options: sampleOptions });

    expect(r1.inputHash).toBe(r2.inputHash);
    expect(r1.calculationHash).toBe(r2.calculationHash);
  });

  it('changes inputHash when input changes and calculationHash when scores change', () => {
    const base = evaluateDecision({ criteria: sampleCriteria, options: sampleOptions });
    const modifiedInput = evaluateDecision({
      criteria: sampleCriteria,
      options: [
        { id: 'optA', name: 'Option A', scores: { c1: 95, c2: 70 } },
        { id: 'optB', name: 'Option B', scores: { c1: 60, c2: 95 } },
      ],
    });

    expect(modifiedInput.inputHash).not.toBe(base.inputHash);
    expect(modifiedInput.calculationHash).not.toBe(base.calculationHash);
  });

  it('verifies pure TypeScript sha256 matches standard cryptographic test vectors', () => {
    const vectors: Array<[string, string]> = [
      ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
      ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
      [
        'The quick brown fox jumps over the lazy dog',
        'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
      ],
    ];

    for (const [input, expectedHash] of vectors) {
      expect(sha256(input)).toBe(expectedHash);
    }
  });
});
