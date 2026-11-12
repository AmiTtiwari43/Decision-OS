import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import {
  createDecision,
  updateDecision,
  analyzeDecision,
  replaceSyntheticScore,
  clearSyntheticScores,
  populateSyntheticDemo,
  mergeScoreProvenance,
} from '../src/services/decision.service.js';
import { decisionRepository } from '../src/repositories/decision.repository.js';
import { auditService } from '../src/services/audit.service.js';
import {
  SyntheticScoresPresentError,
  InvalidProvenanceTransitionError,
  CoordinateNotSyntheticError,
  InvalidScoreCoordinateError,
  DecisionConflictError,
  IncompleteScoresError,
} from '../src/errors/domain.errors.js';
import {
  updateDecisionSchema,
  scoreProvenanceItemSchema,
  type ScoreProvenanceMap,
} from '../src/models/index.js';

// Controlled service/repository mocks for zero-database, safe execution
vi.mock('../src/repositories/decision.repository.js', () => ({
  decisionRepository: {
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../src/repositories/operationJournal.repository.js', () => ({
  operationJournalRepository: {
    createEntry: vi.fn().mockImplementation((data) =>
      Promise.resolve({
        ...data,
        state: 'PENDING',
      })
    ),
    findByOperationId: vi.fn(),
    findActiveByDecisionId: vi.fn(),
    transitionJournalState: vi.fn(),
    claimJournalOperation: vi.fn(),
    renewOperationLease: vi.fn(),
  },
}));

vi.mock('../src/services/authorization.service.js', () => ({
  authorizeDecisionAction: vi.fn().mockResolvedValue('owner'),
}));

vi.mock('../src/services/audit.service.js', () => ({
  auditService: {
    recordEvent: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../src/services/collaboration.service.js', () => ({
  collaborationService: {
    publishEvent: vi.fn(),
    closeDecision: vi.fn(),
  },
}));

describe('Server-Enforced Synthetic Provenance Integrity Specification (Batch 02-R3)', () => {
  const sampleDecisionId = '507f1f77bcf86cd799439011';
  const requester = { id: '507f1f77bcf86cd799439099', role: 'owner', name: 'Decision Lead' };

  const sampleCriteria = [
    { id: 'crit-tech', name: 'Technical Architecture', weight: 60, direction: 'benefit' as const },
    { id: 'crit-cost', name: 'Cost Efficiency', weight: 40, direction: 'benefit' as const },
  ];

  const sampleOptions = [
    { id: 'opt-alpha', name: 'Option Alpha' },
    { id: 'opt-beta', name: 'Option Beta' },
  ];

  let persistedDecisionDoc: any;

  beforeEach(() => {
    vi.clearAllMocks();

    persistedDecisionDoc = {
      _id: new mongoose.Types.ObjectId(sampleDecisionId),
      title: 'Enterprise Cloud Provider Decision',
      description: 'Evaluating cloud infrastructure',
      criteria: sampleCriteria,
      options: sampleOptions,
      scores: {
        'opt-alpha': { 'crit-tech': 90, 'crit-cost': 75 },
        'opt-beta': { 'crit-tech': 70, 'crit-cost': 90 },
      },
      scoreProvenance: {
        'opt-alpha': {
          'crit-cost': { isSynthetic: true, source: 'demo', insertedAt: '2026-11-12T10:00:00.000Z' },
        },
      },
      version: 2,
      isAudited: true,
      auditIntegrityStatus: 'healthy',
      pendingOperationId: null,
      analysis: null,
    };

    (decisionRepository.findById as any).mockImplementation(() => Promise.resolve(persistedDecisionDoc));
    (decisionRepository.update as any).mockImplementation((_id: string, updatePayload: any) => {
      persistedDecisionDoc = {
        ...persistedDecisionDoc,
        ...updatePayload,
      };
      return Promise.resolve(persistedDecisionDoc);
    });
  });

  // ─── Section 2 & 3: Attack Scenarios ─────────────────────────────────────────
  describe('Finding A: Server Rejection of Client Bypass Attacks', () => {
    it('Attack Scenario 1: Demonstrates initial classification trust boundary when score 75 is created without provenance', async () => {
      // Backend cannot infer whether score 75 was synthetic if client omitted scoreProvenance
      const createInput = {
        title: 'Initial Creation With 75',
        criteria: sampleCriteria,
        options: sampleOptions,
        scores: {
          'opt-alpha': { 'crit-tech': 90, 'crit-cost': 75 },
          'opt-beta': { 'crit-tech': 70, 'crit-cost': 90 },
        },
        // scoreProvenance omitted!
      };

      const createdDoc = {
        _id: new mongoose.Types.ObjectId(sampleDecisionId),
        ...createInput,
        scoreProvenance: {},
        version: 1,
      };

      (decisionRepository.create as any).mockResolvedValue(createdDoc);
      (decisionRepository.update as any).mockImplementationOnce((_id: string, payload: any) =>
        Promise.resolve({ ...createdDoc, ...payload })
      );

      const created = await createDecision(createInput, requester);
      expect(created.scores['opt-alpha']['crit-cost']).toBe(75);
      // Demonstrates architectural limitation: without client provenance or server demo fill, 75 is treated as real score
      expect(created.scoreProvenance).toEqual({});
    });

    it('Attack Scenario 1B: Client attempting to inject synthetic score provenance on initial creation is rejected with HTTP 400', async () => {
      const maliciousCreateInput = {
        title: 'Malicious Initial Creation With Provenance',
        criteria: sampleCriteria,
        options: sampleOptions,
        scores: {
          'opt-alpha': { 'crit-tech': 90, 'crit-cost': 75 },
        },
        scoreProvenance: {
          'opt-alpha': {
            'crit-cost': { isSynthetic: true, source: 'injected' },
          },
        },
      };

      await expect(
        createDecision(maliciousCreateInput, requester)
      ).rejects.toThrow(InvalidProvenanceTransitionError);
    });

    it('Attack Scenario 2: Update omitting scoreProvenance CANNOT erase persisted synthetic flag', async () => {
      const updateData = {
        title: 'Updated Decision',
        scores: {
          'opt-alpha': { 'crit-tech': 90, 'crit-cost': 75 },
          'opt-beta': { 'crit-tech': 70, 'crit-cost': 90 },
        },
        // scoreProvenance is omitted by attacker
      };

      const result = await updateDecision(sampleDecisionId, updateData, requester);

      // Server safe merge preserves synthetic status
      expect(result.scoreProvenance?.['opt-alpha']?.['crit-cost']?.isSynthetic).toBe(true);
      expect(result.scoreProvenance?.['opt-alpha']?.['crit-cost']?.source).toBe('demo');
    });

    it('Attack Scenario 3: Update attempting isSynthetic: false is rejected at schema and service layers', async () => {
      // 1. Zod schema rejection
      expect(() => {
        scoreProvenanceItemSchema.parse({
          isSynthetic: false,
        });
      }).toThrowError(/isSynthetic must be true/);

      // 2. Service level transition guard rejection
      const maliciousData = {
        scores: {
          'opt-alpha': { 'crit-tech': 90, 'crit-cost': 75 },
        },
        scoreProvenance: {
          'opt-alpha': {
            'crit-cost': { isSynthetic: false as any, source: 'tampered' },
          },
        },
      };

      await expect(
        updateDecision(sampleDecisionId, maliciousData, requester)
      ).rejects.toThrow(InvalidProvenanceTransitionError);
    });

    it('Attack Scenario 4: Update sending empty scoreProvenance map ({}) CANNOT erase persisted synthetic flags', async () => {
      const updateData = {
        scores: {
          'opt-alpha': { 'crit-tech': 90, 'crit-cost': 75 },
          'opt-beta': { 'crit-tech': 70, 'crit-cost': 90 },
        },
        scoreProvenance: {}, // Attacker attempts to clear provenance by sending empty map
      };

      const result = await updateDecision(sampleDecisionId, updateData, requester);

      expect(result.scoreProvenance?.['opt-alpha']?.['crit-cost']?.isSynthetic).toBe(true);
    });

    it('Attack Scenario 5: Modifying another coordinate CANNOT erase synthetic provenance from untouched coordinate', async () => {
      const updateData = {
        scores: {
          'opt-alpha': { 'crit-tech': 90, 'crit-cost': 75 },
          'opt-beta': { 'crit-tech': 85, 'crit-cost': 95 }, // Modified opt-beta
        },
        // opt-alpha synthetic provenance omitted in payload by attacker
      };

      const result = await updateDecision(sampleDecisionId, updateData, requester);

      // opt-alpha persisted provenance is strictly preserved
      expect(result.scoreProvenance?.['opt-alpha']?.['crit-cost']?.isSynthetic).toBe(true);
      expect(result.scoreProvenance?.['opt-alpha']?.['crit-cost']?.source).toBe('demo');
    });

    it('Attack Scenario 5B: Ordinary update attempting to inject new synthetic provenance is rejected', async () => {
      const injectionAttempt = {
        scores: {
          'opt-beta': { 'crit-tech': 75 },
        },
        scoreProvenance: {
          'opt-beta': {
            'crit-tech': { isSynthetic: true, source: 'injected' },
          },
        },
      };

      await expect(
        updateDecision(sampleDecisionId, injectionAttempt, requester)
      ).rejects.toThrow(InvalidProvenanceTransitionError);
    });

    it('Attack Scenario 6: Malformed or unknown provenance coordinates are rejected with HTTP 400', () => {
      const payloadWithGhostCriterion = {
        criteria: sampleCriteria,
        options: sampleOptions,
        scoreProvenance: {
          'opt-alpha': {
            'ghost-crit-id': { isSynthetic: true, source: 'demo' },
          },
        },
      };

      const parsed = updateDecisionSchema.safeParse(payloadWithGhostCriterion);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.errors[0].message).toContain("Synthetic score provenance contains unknown criterion ID 'ghost-crit-id'");
      }
    });

    it('Attack Scenario 7: Authoritative analysis remains blocked after each attempted bypass', async () => {
      // 1. After ordinary update with omitted provenance
      await updateDecision(
        sampleDecisionId,
        { scores: { 'opt-alpha': { 'crit-tech': 90, 'crit-cost': 75 }, 'opt-beta': { 'crit-tech': 70, 'crit-cost': 90 } } },
        requester
      );

      // Attempting analysis must throw SyntheticScoresPresentError
      await expect(analyzeDecision(sampleDecisionId, requester)).rejects.toThrow(
        SyntheticScoresPresentError
      );

      // 2. After update with empty provenance map
      await updateDecision(
        sampleDecisionId,
        { scoreProvenance: {} },
        requester
      );

      await expect(analyzeDecision(sampleDecisionId, requester)).rejects.toThrow(
        SyntheticScoresPresentError
      );
    });
  });

  // ─── Section 3 & 5: Explicit Replacement Operation ───────────────────────────
  describe('Explicit Replacement Operation (POST /api/decisions/:id/replace-synthetic-score)', () => {
    it('atomically replaces a synthetic score coordinate with verified score and removes provenance', async () => {
      const replacementInput = {
        optionId: 'opt-alpha',
        criterionId: 'crit-cost',
        score: 70.0,
        expectedVersion: 2,
        comment: 'Verified vendor contract rate',
      };

      const result = await replaceSyntheticScore(sampleDecisionId, replacementInput, requester);

      // Score updated
      expect(result.scores['opt-alpha']['crit-cost']).toBe(70.0);
      // Synthetic provenance removed for this coordinate
      expect(result.scoreProvenance?.['opt-alpha']?.['crit-cost']).toBeUndefined();
      // Since all scores are real and complete, authoritative analysis was automatically calculated!
      expect(result.analysis).not.toBeNull();
      expect(result.analysis?.winnerId).toBe('opt-alpha');
      expect(result.version).toBe(3);

      // Audit event was recorded
      expect(auditService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          decisionId: sampleDecisionId,
          action: 'decision.synthetic_score_replaced',
          summary: expect.stringContaining('Replaced synthetic score for alternative "Option Alpha" on criterion "Cost Efficiency" with real assessment 70'),
          diff: expect.objectContaining({
            previousScore: 75,
            replacementScore: 70,
            remainingSyntheticCount: 0,
          }),
        })
      );
    });

    it('preserves other synthetic coordinates when one coordinate is explicitly replaced', async () => {
      // Setup decision with TWO synthetic coordinates
      persistedDecisionDoc.scoreProvenance = {
        'opt-alpha': {
          'crit-cost': { isSynthetic: true, source: 'demo' },
        },
        'opt-beta': {
          'crit-tech': { isSynthetic: true, source: 'demo' },
        },
      };

      const result = await replaceSyntheticScore(
        sampleDecisionId,
        {
          optionId: 'opt-alpha',
          criterionId: 'crit-cost',
          score: 70.0,
        },
        requester
      );

      // opt-alpha is cleared
      expect(result.scoreProvenance?.['opt-alpha']).toBeUndefined();
      // opt-beta REMAINS protected as synthetic!
      expect(result.scoreProvenance?.['opt-beta']?.['crit-tech']?.isSynthetic).toBe(true);
      // Analysis remains suppressed (null) because 1 synthetic score remains
      expect(result.analysis).toBeNull();
    });

    it('rejects replacement when coordinate is not currently synthetic (CoordinateNotSyntheticError)', async () => {
      // opt-alpha on crit-tech is a real score (90), not synthetic
      await expect(
        replaceSyntheticScore(
          sampleDecisionId,
          {
            optionId: 'opt-alpha',
            criterionId: 'crit-tech',
            score: 85.0,
          },
          requester
        )
      ).rejects.toThrow(CoordinateNotSyntheticError);
    });

    it('rejects replacement with invalid score values (< 0, > 100, NaN)', async () => {
      await expect(
        replaceSyntheticScore(
          sampleDecisionId,
          { optionId: 'opt-alpha', criterionId: 'crit-cost', score: -10 },
          requester
        )
      ).rejects.toThrow(InvalidScoreCoordinateError);

      await expect(
        replaceSyntheticScore(
          sampleDecisionId,
          { optionId: 'opt-alpha', criterionId: 'crit-cost', score: 110 },
          requester
        )
      ).rejects.toThrow(InvalidScoreCoordinateError);

      await expect(
        replaceSyntheticScore(
          sampleDecisionId,
          { optionId: 'opt-alpha', criterionId: 'crit-cost', score: NaN },
          requester
        )
      ).rejects.toThrow(InvalidScoreCoordinateError);
    });

    it('rejects replacement targeting nonexistent option or criterion', async () => {
      await expect(
        replaceSyntheticScore(
          sampleDecisionId,
          { optionId: 'ghost-opt', criterionId: 'crit-cost', score: 70 },
          requester
        )
      ).rejects.toThrow(InvalidScoreCoordinateError);

      await expect(
        replaceSyntheticScore(
          sampleDecisionId,
          { optionId: 'opt-alpha', criterionId: 'ghost-crit', score: 70 },
          requester
        )
      ).rejects.toThrow(InvalidScoreCoordinateError);
    });

    it('enforces optimistic concurrency control (expectedVersion)', async () => {
      // Current version is 2; passing stale expectedVersion 1 must throw DecisionConflictError
      await expect(
        replaceSyntheticScore(
          sampleDecisionId,
          {
            optionId: 'opt-alpha',
            criterionId: 'crit-cost',
            score: 70.0,
            expectedVersion: 1, // Stale version!
          },
          requester
        )
      ).rejects.toThrow(DecisionConflictError);
    });
  });

  // ─── Section 5: Clearing & Server Demo Fill Operations ───────────────────────
  describe('Clearing & Server Demo Fill Operations', () => {
    it('clearSyntheticScores removes scores and flags, leaving coordinates incomplete', async () => {
      const cleared = await clearSyntheticScores(sampleDecisionId, undefined, requester);

      expect(cleared.scoreProvenance).toEqual({});
      expect(cleared.scores['opt-alpha']['crit-cost']).toBeUndefined();
      expect(cleared.analysis).toBeNull();

      expect(auditService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'decision.synthetic_scores_cleared',
          diff: expect.objectContaining({ clearedCount: 1 }),
        })
      );

      // Now that the cell is empty, calling analyze must throw IncompleteScoresError
      await expect(analyzeDecision(sampleDecisionId, requester)).rejects.toThrow(
        IncompleteScoresError
      );
    });

    it('populateSyntheticDemo creates server-recognized synthetic state directly on backend', async () => {
      // Create empty decision
      persistedDecisionDoc.scores = {
        'opt-alpha': { 'crit-tech': 90 }, // missing crit-cost
        'opt-beta': { 'crit-cost': 90 }, // missing crit-tech
      };
      persistedDecisionDoc.scoreProvenance = {};

      const populated = await populateSyntheticDemo(sampleDecisionId, 75, undefined, requester);

      expect(populated.scores['opt-alpha']['crit-cost']).toBe(75);
      expect(populated.scores['opt-beta']['crit-tech']).toBe(75);
      expect(populated.scoreProvenance?.['opt-alpha']?.['crit-cost']?.isSynthetic).toBe(true);
      expect(populated.scoreProvenance?.['opt-beta']?.['crit-tech']?.isSynthetic).toBe(true);
      expect(populated.analysis).toBeNull();

      expect(auditService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'decision.synthetic_demo_populated',
          diff: expect.objectContaining({ populatedCount: 2, defaultValue: 75 }),
        })
      );
    });
  });

  // ─── Provenance Merge Helper Unit Invariants ─────────────────────────────────
  describe('mergeScoreProvenance Invariants', () => {
    it('preserves persisted synthetic status even if incoming provenance is undefined or empty', () => {
      const persisted: ScoreProvenanceMap = {
        'opt-alpha': { 'crit-cost': { isSynthetic: true, source: 'demo' } },
      };

      const mergedUndefined = mergeScoreProvenance(persisted, undefined, sampleCriteria, sampleOptions);
      expect(mergedUndefined['opt-alpha']['crit-cost'].isSynthetic).toBe(true);

      const mergedEmpty = mergeScoreProvenance(persisted, {}, sampleCriteria, sampleOptions);
      expect(mergedEmpty['opt-alpha']['crit-cost'].isSynthetic).toBe(true);
    });

    it('drops coordinates if option or criterion was deleted from decision model', () => {
      const persisted: ScoreProvenanceMap = {
        'opt-alpha': { 'crit-cost': { isSynthetic: true, source: 'demo' } },
        'opt-deleted': { 'crit-cost': { isSynthetic: true, source: 'demo' } },
      };

      const merged = mergeScoreProvenance(persisted, {}, sampleCriteria, sampleOptions);
      expect(merged['opt-deleted']).toBeUndefined();
      expect(merged['opt-alpha']['crit-cost'].isSynthetic).toBe(true);
    });
  });

  // ─── Finding B: Transactional Consistency & Session-Bound Verification ────────
  describe('Finding B: Transactional Consistency and Audit Guarantees', () => {
    it('executes decision update and audit event with the exact same session', async () => {
      const mockSession = { id: 'mock-tx-session-1' } as any;

      const result = await replaceSyntheticScore(
        sampleDecisionId,
        { optionId: 'opt-alpha', criterionId: 'crit-cost', score: 88 },
        requester,
        mockSession
      );

      expect(result.scores['opt-alpha']['crit-cost']).toBe(88);
      expect(decisionRepository.update).toHaveBeenCalledWith(
        sampleDecisionId,
        expect.objectContaining({
          scores: expect.objectContaining({
            'opt-alpha': expect.objectContaining({ 'crit-cost': 88 }),
          }),
        }),
        undefined,
        mockSession
      );

      expect(auditService.recordEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'decision.synthetic_score_replaced',
          decisionId: sampleDecisionId,
        }),
        mockSession
      );
    });

    it('a failed audit write aborts the score replacement and bubbles error', async () => {
      const mockSession = { id: 'mock-tx-session-2' } as any;
      (auditService.recordEvent as any).mockRejectedValueOnce(
        new Error('Audit append error: cryptographic chain corrupted')
      );

      await expect(
        replaceSyntheticScore(
          sampleDecisionId,
          { optionId: 'opt-alpha', criterionId: 'crit-cost', score: 88 },
          requester,
          mockSession
        )
      ).rejects.toThrowError(/Audit append error/);
    });

    it('a failed score update (conflict) produces NO audit event', async () => {
      const mockSession = { id: 'mock-tx-session-3' } as any;
      vi.clearAllMocks();

      // Attempt replacement with stale version
      await expect(
        replaceSyntheticScore(
          sampleDecisionId,
          { optionId: 'opt-alpha', criterionId: 'crit-cost', score: 88, expectedVersion: 999 },
          requester,
          mockSession
        )
      ).rejects.toThrow(DecisionConflictError);

      expect(auditService.recordEvent).not.toHaveBeenCalled();
    });
  });
});
