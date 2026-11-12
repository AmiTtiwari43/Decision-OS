import { describe, it, expect } from 'vitest';
import {
  createDecisionSchema,
  type ScoreProvenanceMap,
} from '../src/models/index.js';
import {
  getSyntheticScoreCoordinates,
} from '../src/services/decision.service.js';
import {
  SyntheticScoresPresentError,
} from '../src/errors/domain.errors.js';
import { evidenceService } from '../src/services/evidence.service.js';

describe('Synthetic Provenance & Authoritative Boundary Specification (Batch 02-R2)', () => {
  const sampleCriteria = [
    { id: 'crit-tech', name: 'Technical Architecture', weight: 60, direction: 'benefit' as const },
    { id: 'crit-cost', name: 'Cost Efficiency', weight: 40, direction: 'benefit' as const },
  ];

  const sampleOptions = [
    { id: 'opt-alpha', name: 'Option Alpha' },
    { id: 'opt-beta', name: 'Option Beta' },
  ];

  // ─── 1. API Schema Boundary Validation ───────────────────────────────────────
  describe('1. API Payload Schema Validation', () => {
    it('accepts explicit score provenance per coordinate in createDecisionSchema', () => {
      const validPayload = {
        title: 'Enterprise Cloud Provider Decision',
        criteria: sampleCriteria,
        options: sampleOptions,
        scores: {
          'opt-alpha': { 'crit-tech': 90, 'crit-cost': 75 },
          'opt-beta': { 'crit-tech': 70, 'crit-cost': 90 },
        },
        scoreProvenance: {
          'opt-alpha': {
            'crit-cost': { isSynthetic: true, source: 'demo' },
          },
        },
      };

      const parsed = createDecisionSchema.parse(validPayload);
      expect(parsed.scoreProvenance?.['opt-alpha']?.['crit-cost']?.isSynthetic).toBe(true);
      expect(parsed.scoreProvenance?.['opt-alpha']?.['crit-cost']?.source).toBe('demo');
    });

    it('rejects malformed provenance metadata with non-boolean isSynthetic', () => {
      const malformedPayload = {
        title: 'Malformed Provenance',
        criteria: sampleCriteria,
        options: sampleOptions,
        scores: {
          'opt-alpha': { 'crit-tech': 90, 'crit-cost': 75 },
        },
        scoreProvenance: {
          'opt-alpha': {
            'crit-cost': { isSynthetic: 'yes_synthetic' as any },
          },
        },
      };

      expect(() => createDecisionSchema.parse(malformedPayload)).toThrow();
    });

    it('rejects unpermitted fields in provenance metadata (strict schema)', () => {
      const payloadWithExtra = {
        title: 'Strict Provenance',
        criteria: sampleCriteria,
        options: sampleOptions,
        scores: {
          'opt-alpha': { 'crit-tech': 90, 'crit-cost': 75 },
        },
        scoreProvenance: {
          'opt-alpha': {
            'crit-cost': { isSynthetic: true, unpermittedProperty: 'injected' } as any,
          },
        },
      };

      expect(() => createDecisionSchema.parse(payloadWithExtra)).toThrow();
    });

    it('rejects provenance referencing non-existent option coordinates', () => {
      const payloadWithGhostOption = {
        title: 'Ghost Option Coordinate',
        criteria: sampleCriteria,
        options: sampleOptions,
        scores: {
          'opt-alpha': { 'crit-tech': 90, 'crit-cost': 75 },
        },
        scoreProvenance: {
          'ghost-opt': {
            'crit-cost': { isSynthetic: true, source: 'demo' },
          },
        },
      };

      expect(() => createDecisionSchema.parse(payloadWithGhostOption)).toThrowError(
        /Synthetic score provenance contains unknown alternative ID 'ghost-opt'/
      );
    });

    it('rejects provenance referencing non-existent criterion coordinates', () => {
      const payloadWithGhostCriterion = {
        title: 'Ghost Criterion Coordinate',
        criteria: sampleCriteria,
        options: sampleOptions,
        scores: {
          'opt-alpha': { 'crit-tech': 90, 'crit-cost': 75 },
        },
        scoreProvenance: {
          'opt-alpha': {
            'ghost-crit': { isSynthetic: true, source: 'demo' },
          },
        },
      };

      expect(() => createDecisionSchema.parse(payloadWithGhostCriterion)).toThrowError(
        /Synthetic score provenance contains unknown criterion ID 'ghost-crit'/
      );
    });

    it('rejects synthetic provenance claim when corresponding score is missing from score matrix', () => {
      const payloadWithMissingScore = {
        title: 'Missing Score for Provenance',
        criteria: sampleCriteria,
        options: sampleOptions,
        scores: {
          'opt-alpha': { 'crit-tech': 90 }, // 'crit-cost' is missing!
        },
        scoreProvenance: {
          'opt-alpha': {
            'crit-cost': { isSynthetic: true, source: 'demo' },
          },
        },
      };

      expect(() => createDecisionSchema.parse(payloadWithMissingScore)).toThrowError(
        /without a corresponding score value/
      );
    });
  });

  // ─── 2. Service-Layer Synthetic Coordinate Detection ────────────────────────
  describe('2. Service-Layer Coordinate Identification', () => {
    it('detects synthetic score coordinates across all alternatives and criteria', () => {
      const provenance: ScoreProvenanceMap = {
        'opt-alpha': {
          'crit-cost': { isSynthetic: true, source: 'demo' },
        },
        'opt-beta': {
          'crit-tech': { isSynthetic: true, source: 'demo' },
          'crit-cost': { isSynthetic: false }, // explicitly false
        },
      };

      const coordinates = getSyntheticScoreCoordinates(sampleCriteria, sampleOptions, provenance);

      expect(coordinates).toHaveLength(2);
      expect(coordinates).toEqual([
        { optionId: 'opt-alpha', criterionId: 'crit-cost' },
        { optionId: 'opt-beta', criterionId: 'crit-tech' },
      ]);
    });

    it('returns empty array when provenance is undefined or empty', () => {
      expect(getSyntheticScoreCoordinates(sampleCriteria, sampleOptions, undefined)).toEqual([]);
      expect(getSyntheticScoreCoordinates(sampleCriteria, sampleOptions, {})).toEqual([]);
    });
  });

  // ─── 3. Authoritative Analysis Blocking & Domain Error ──────────────────────
  describe('3. Authoritative Analysis Blocking & Domain Error', () => {
    it('instantiates SyntheticScoresPresentError with 422 status and identifies required replacements', () => {
      const syntheticCoords = [{ optionId: 'opt-alpha', criterionId: 'crit-cost' }];
      const error = new SyntheticScoresPresentError(syntheticCoords);

      expect(error.statusCode).toBe(422);
      expect(error.name).toBe('SyntheticScoresPresentError');
      expect(error.syntheticCoordinates).toEqual(syntheticCoords);
      expect(error.message).toContain('Authoritative analysis cannot be calculated while synthetic demonstration scores remain');
      expect(error.message).toContain("option 'opt-alpha' × criterion 'crit-cost'");
    });
  });

  // ─── 4. Rejection of Synthetic Metadata as Evidence ─────────────────────────
  describe('4. Safeguard: Synthetic Metadata Rejection in Evidence Service', () => {
    it('rejects evidence creation if input claims synthetic provenance or demo metadata', async () => {
      const requester = { id: '507f1f77bcf86cd799439011', role: 'user', name: 'Tester' };

      await expect(
        evidenceService.createEvidence(
          '507f1f77bcf86cd799439012',
          {
            targetType: 'option',
            targetId: 'opt-alpha',
            type: 'excerpt',
            title: 'Synthetic Demo Score Citation',
            isSynthetic: true,
          } as any,
          requester
        )
      ).rejects.toThrowError(/Synthetic demonstration metadata cannot be accepted as verified evidence/);
    });
  });
});
