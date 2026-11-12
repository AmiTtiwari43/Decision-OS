import { describe, it, expect } from 'vitest';
import {
  createDecisionSchema,
  updateDecisionSchema,
  criterionSchema,
  optionSchema,
  scoreValueSchema,
  scoreProvenanceItemSchema,
  replaceSyntheticScoreSchema,
  clearSyntheticScoresSchema,
  populateSyntheticDemoSchema,
} from '../src/models/index';

describe('Decision Schema & Validation Unit Tests', () => {
  describe('Criterion Validation', () => {
    it('accepts valid criterion with benefit direction', () => {
      const criterion = {
        id: 'c1',
        name: 'Growth',
        weight: 30,
        direction: 'benefit',
      };
      const parsed = criterionSchema.parse(criterion);
      expect(parsed.id).toBe('c1');
      expect(parsed.weight).toBe(30);
      expect(parsed.direction).toBe('benefit');
      expect(parsed.isLocked).toBe(false);
    });

    it('defaults direction to benefit when omitted', () => {
      const criterion = {
        id: 'c1',
        name: 'Compensation',
        weight: 25,
      };
      const parsed = criterionSchema.parse(criterion);
      expect(parsed.direction).toBe('benefit');
    });

    it('accepts cost direction', () => {
      const criterion = {
        id: 'c2',
        name: 'Cost of Living',
        weight: 20,
        direction: 'cost',
      };
      const parsed = criterionSchema.parse(criterion);
      expect(parsed.direction).toBe('cost');
    });

    it('rejects negative weight', () => {
      expect(() => {
        criterionSchema.parse({
          id: 'c1',
          name: 'Growth',
          weight: -5,
        });
      }).toThrowError(/Criterion weight cannot be negative/);
    });

    it('rejects invalid direction', () => {
      expect(() => {
        criterionSchema.parse({
          id: 'c1',
          name: 'Growth',
          weight: 10,
          direction: 'unknown-direction',
        });
      }).toThrow();
    });

    it('rejects empty id or name', () => {
      expect(() => {
        criterionSchema.parse({ id: '', name: 'Growth', weight: 10 });
      }).toThrow();

      expect(() => {
        criterionSchema.parse({ id: 'c1', name: '  ', weight: 10 });
      }).toThrow();
    });
  });

  describe('Option Validation', () => {
    it('accepts valid option with optional fields', () => {
      const option = {
        id: 'opt-1',
        name: 'Company Alpha',
        tagline: 'High growth',
        description: 'Series B startup',
        color: '#3b82f6',
      };
      const parsed = optionSchema.parse(option);
      expect(parsed.id).toBe('opt-1');
      expect(parsed.name).toBe('Company Alpha');
      expect(parsed.tagline).toBe('High growth');
    });

    it('rejects empty option id or name', () => {
      expect(() => optionSchema.parse({ id: '', name: 'Option A' })).toThrow();
      expect(() => optionSchema.parse({ id: 'opt-1', name: '' })).toThrow();
    });
  });

  describe('Score Value Validation', () => {
    it('accepts valid score in range 0 to 100', () => {
      expect(scoreValueSchema.parse(0)).toBe(0);
      expect(scoreValueSchema.parse(85.5)).toBe(85.5);
      expect(scoreValueSchema.parse(100)).toBe(100);
    });

    it('rejects negative scores and scores > 100', () => {
      expect(() => scoreValueSchema.parse(-0.1)).toThrowError(/Score cannot be negative/);
      expect(() => scoreValueSchema.parse(100.1)).toThrowError(/Score cannot exceed 100/);
    });

    it('rejects non-finite values', () => {
      expect(() => scoreValueSchema.parse(Infinity)).toThrow();
      expect(() => scoreValueSchema.parse(NaN)).toThrow();
    });
  });

  describe('Create Decision Schema Validation', () => {
    it('validates a complete valid decision input', () => {
      const input = {
        title: 'Q4 Cloud Infrastructure Choice',
        description: 'Evaluating AWS vs GCP vs Azure for ML pipelines',
        criteria: [
          { id: 'perf', name: 'Performance', weight: 40, direction: 'benefit' },
          { id: 'cost', name: 'Cost', weight: 35, direction: 'cost' },
          { id: 'dx', name: 'Developer Experience', weight: 25, direction: 'benefit' },
        ],
        options: [
          { id: 'aws', name: 'AWS' },
          { id: 'gcp', name: 'GCP' },
        ],
        scores: {
          aws: { perf: 90, cost: 60, dx: 75 },
          gcp: { perf: 85, cost: 80, dx: 85 },
        },
      };

      const parsed = createDecisionSchema.parse(input);
      expect(parsed.title).toBe('Q4 Cloud Infrastructure Choice');
      expect(parsed.criteria).toHaveLength(3);
      expect(parsed.options).toHaveLength(2);
      expect(parsed.calculationVersion).toBe(1);
      expect(parsed.analysis).toBeNull();
    });

    it('applies defaults for optional fields', () => {
      const minimal = {
        title: 'Minimal Decision Draft',
      };
      const parsed = createDecisionSchema.parse(minimal);
      expect(parsed.title).toBe('Minimal Decision Draft');
      expect(parsed.description).toBe('');
      expect(parsed.criteria).toEqual([]);
      expect(parsed.options).toEqual([]);
      expect(parsed.scores).toEqual({});
      expect(parsed.analysis).toBeNull();
      expect(parsed.calculationVersion).toBe(1);
    });

    it('rejects missing or empty title', () => {
      expect(() => createDecisionSchema.parse({})).toThrowError(/Decision title is required/);
      expect(() => createDecisionSchema.parse({ title: '   ' })).toThrowError(/Decision title is required/);
    });

    it('rejects title exceeding 200 characters', () => {
      const longTitle = 'a'.repeat(201);
      expect(() => createDecisionSchema.parse({ title: longTitle })).toThrowError(
        /Decision title cannot exceed 200 characters/
      );
    });

    it('rejects duplicate criterion IDs', () => {
      const input = {
        title: 'Decision with duplicate criteria',
        criteria: [
          { id: 'c1', name: 'Growth', weight: 50 },
          { id: 'c1', name: 'Another Growth', weight: 50 },
        ],
      };
      expect(() => createDecisionSchema.parse(input)).toThrowError(/Duplicate criterion ID 'c1' detected/);
    });

    it('rejects duplicate option IDs', () => {
      const input = {
        title: 'Decision with duplicate options',
        options: [
          { id: 'opt1', name: 'Option One' },
          { id: 'opt1', name: 'Option Duplicate' },
        ],
      };
      expect(() => createDecisionSchema.parse(input)).toThrowError(/Duplicate option ID 'opt1' detected/);
    });
  });

  describe('Update Decision Schema Validation', () => {
    it('accepts partial updates', () => {
      const update = {
        title: 'Updated Decision Title',
      };
      const parsed = updateDecisionSchema.parse(update);
      expect(parsed.title).toBe('Updated Decision Title');
      expect(parsed.description).toBeUndefined();
    });

    it('rejects empty title on update', () => {
      expect(() => updateDecisionSchema.parse({ title: '  ' })).toThrowError(
        /Decision title cannot be empty/
      );
    });

    it('rejects duplicate criteria on update', () => {
      expect(() =>
        updateDecisionSchema.parse({
          criteria: [
            { id: 'dup', name: 'A', weight: 10 },
            { id: 'dup', name: 'B', weight: 20 },
          ],
        })
      ).toThrowError(/Duplicate criterion ID 'dup' detected/);
    });
  });

  describe('Score Provenance Schema Validation', () => {
    it('accepts valid score provenance with boolean isSynthetic and source', () => {
      const item = {
        isSynthetic: true,
        source: 'demo',
      };
      const parsed = scoreProvenanceItemSchema.parse(item);
      expect(parsed.isSynthetic).toBe(true);
      expect(parsed.source).toBe('demo');
    });

    it('rejects malformed provenance with non-boolean isSynthetic', () => {
      expect(() => {
        scoreProvenanceItemSchema.parse({
          isSynthetic: 'yes',
        });
      }).toThrow();
    });

    it('rejects unexpected fields in provenance due to strict validation', () => {
      expect(() => {
        scoreProvenanceItemSchema.parse({
          isSynthetic: true,
          maliciousInjectedField: 'hack',
        });
      }).toThrow();
    });

    it('validates score provenance map in createDecisionSchema', () => {
      const input = {
        title: 'Decision with Synthetic Metadata',
        criteria: [{ id: 'c1', name: 'Criterion 1', weight: 100 }],
        options: [{ id: 'opt1', name: 'Option 1' }],
        scores: {
          opt1: { c1: 75 },
        },
        scoreProvenance: {
          opt1: {
            c1: { isSynthetic: true, source: 'demo' },
          },
        },
      };

      const parsed = createDecisionSchema.parse(input);
      expect(parsed.scoreProvenance?.opt1?.c1?.isSynthetic).toBe(true);
      expect(parsed.scoreProvenance?.opt1?.c1?.source).toBe('demo');
    });

    it('rejects score provenance targeting an unknown option ID', () => {
      const input = {
        title: 'Decision with Invalid Option in Provenance',
        criteria: [{ id: 'c1', name: 'Criterion 1', weight: 100 }],
        options: [{ id: 'opt1', name: 'Option 1' }],
        scores: {
          opt1: { c1: 75 },
        },
        scoreProvenance: {
          'unknown-opt': {
            c1: { isSynthetic: true, source: 'demo' },
          },
        },
      };

      expect(() => createDecisionSchema.parse(input)).toThrowError(
        /Synthetic score provenance contains unknown alternative ID 'unknown-opt'/
      );
    });

    it('rejects score provenance targeting an unknown criterion ID', () => {
      const input = {
        title: 'Decision with Invalid Criterion in Provenance',
        criteria: [{ id: 'c1', name: 'Criterion 1', weight: 100 }],
        options: [{ id: 'opt1', name: 'Option 1' }],
        scores: {
          opt1: { c1: 75 },
        },
        scoreProvenance: {
          opt1: {
            'unknown-crit': { isSynthetic: true, source: 'demo' },
          },
        },
      };

      expect(() => createDecisionSchema.parse(input)).toThrowError(
        /Synthetic score provenance contains unknown criterion ID 'unknown-crit'/
      );
    });

    it('rejects isSynthetic: false because synthetic provenance cannot be negated via metadata', () => {
      expect(() => {
        scoreProvenanceItemSchema.parse({
          isSynthetic: false,
        });
      }).toThrowError(/isSynthetic must be true/);
    });

    it('rejects synthetic provenance without a corresponding score value in scores', () => {
      const input = {
        title: 'Decision with Missing Score for Synthetic Provenance',
        criteria: [{ id: 'c1', name: 'Criterion 1', weight: 100 }],
        options: [{ id: 'opt1', name: 'Option 1' }],
        scores: {},
        scoreProvenance: {
          opt1: {
            c1: { isSynthetic: true, source: 'demo' },
          },
        },
      };

      expect(() => createDecisionSchema.parse(input)).toThrowError(
        /without a corresponding score value/
      );
    });
  });

  describe('Explicit Replacement & Synthetic Management Schemas (Batch 02-R3)', () => {
    it('validates valid replaceSyntheticScore payload', () => {
      const payload = {
        optionId: 'opt-alpha',
        criterionId: 'crit-cost',
        score: 72.5,
        expectedVersion: 2,
        comment: 'Verified vendor quote pricing',
      };
      const parsed = replaceSyntheticScoreSchema.parse(payload);
      expect(parsed.optionId).toBe('opt-alpha');
      expect(parsed.criterionId).toBe('crit-cost');
      expect(parsed.score).toBe(72.5);
      expect(parsed.expectedVersion).toBe(2);
      expect(parsed.comment).toBe('Verified vendor quote pricing');
    });

    it('rejects replaceSyntheticScore payload with invalid score values (< 0, > 100, NaN, non-number)', () => {
      expect(() => replaceSyntheticScoreSchema.parse({ optionId: 'o1', criterionId: 'c1', score: -5 })).toThrow();
      expect(() => replaceSyntheticScoreSchema.parse({ optionId: 'o1', criterionId: 'c1', score: 105 })).toThrow();
      expect(() => replaceSyntheticScoreSchema.parse({ optionId: 'o1', criterionId: 'c1', score: NaN })).toThrow();
      expect(() => replaceSyntheticScoreSchema.parse({ optionId: 'o1', criterionId: 'c1', score: '75' as any })).toThrow();
    });

    it('rejects replaceSyntheticScore payload with missing optionId or criterionId', () => {
      expect(() => replaceSyntheticScoreSchema.parse({ criterionId: 'c1', score: 80 })).toThrow();
      expect(() => replaceSyntheticScoreSchema.parse({ optionId: 'o1', score: 80 })).toThrow();
    });

    it('rejects extra injected properties in replaceSyntheticScoreSchema (strict)', () => {
      expect(() =>
        replaceSyntheticScoreSchema.parse({
          optionId: 'o1',
          criterionId: 'c1',
          score: 80,
          unauthorizedField: 'injected',
        })
      ).toThrow();
    });

    it('validates clearSyntheticScores payload', () => {
      const parsedEmpty = clearSyntheticScoresSchema.parse({});
      expect(parsedEmpty).toEqual({});

      const parsedVersion = clearSyntheticScoresSchema.parse({ expectedVersion: 3 });
      expect(parsedVersion.expectedVersion).toBe(3);

      expect(() => clearSyntheticScoresSchema.parse({ unknownField: true })).toThrow();
    });

    it('validates populateSyntheticDemo payload with default and custom values', () => {
      const parsedDefault = populateSyntheticDemoSchema.parse({});
      expect(parsedDefault.defaultValue).toBe(75);

      const parsedCustom = populateSyntheticDemoSchema.parse({ defaultValue: 80, expectedVersion: 4 });
      expect(parsedCustom.defaultValue).toBe(80);
      expect(parsedCustom.expectedVersion).toBe(4);

      expect(() => populateSyntheticDemoSchema.parse({ defaultValue: -1 })).toThrow();
      expect(() => populateSyntheticDemoSchema.parse({ defaultValue: 101 })).toThrow();
    });
  });
});
