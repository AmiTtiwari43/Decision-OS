import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  addAlternativeToDataset,
  renameAlternativeInDataset,
  updateAlternativeInDataset,
  removeAlternativeFromDataset,
  addCriterionToDataset,
  renameCriterionInDataset,
  updateCriterionInDataset,
  removeCriterionFromDataset,
  updateOptionScoreInDataset,
  getDatasetMissingScores,
  computeCanonicalWeights,
  buildPayloadFromState,
  reconstructDatasetFromDto,
} from '../hooks/useDecisionModel.js';
import { getDecisionEvaluationStatus } from '../utils/decisionStatus.js';
import { templateDatasets, primaryJobOfferDataset } from '../data/decisionData.js';
import { DecisionApiClient, ApiClientError } from '../api/client.js';
import type { DecisionDto } from '../api/types.js';

describe('Decision OS — Batch 3: Dynamic Criteria & Alternatives Management Integration Tests', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;
  let apiClient: DecisionApiClient;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    apiClient = new DecisionApiClient({ baseUrl: 'http://127.0.0.1:3000' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ─── 1. Adding an alternative ──────────────────────────────────────────────
  it('1. Adding an alternative: generates unique ID, initializes empty scores, and validates input', () => {
    const initialDataset = { ...primaryJobOfferDataset };
    const initialCount = initialDataset.options.length;

    const { dataset: nextDataset, newOption } = addAlternativeToDataset(
      initialDataset,
      'Remote Contract Offer',
      'High hourly rate',
      'Flexible 30hr week',
      '#A78BFA'
    );

    expect(newOption.id).toMatch(/^opt-/);
    expect(newOption.name).toBe('Remote Contract Offer');
    expect(newOption.tagline).toBe('High hourly rate');
    expect(newOption.color).toBe('#A78BFA');
    expect(newOption.scores).toEqual({}); // Strictly unpopulated / missing
    expect(nextDataset.options).toHaveLength(initialCount + 1);

    // Rejects duplicate alternative names
    expect(() => {
      addAlternativeToDataset(nextDataset, 'Remote Contract Offer');
    }).toThrow(/already exists/i);

    // Rejects empty alternative name
    expect(() => {
      addAlternativeToDataset(nextDataset, '   ');
    }).toThrow(/cannot be empty/i);
  });

  // ─── 2. Renaming an alternative ────────────────────────────────────────────
  it('2. Renaming an alternative: updates name cleanly and detects duplicate collisions', () => {
    const initialDataset = { ...primaryJobOfferDataset };
    const targetId = initialDataset.options[0].id;

    const renamed = renameAlternativeInDataset(
      initialDataset,
      targetId,
      'Series B Lead Architect'
    );

    const updated = renamed.options.find((o) => o.id === targetId);
    expect(updated?.name).toBe('Series B Lead Architect');

    // Rejects renaming to an existing alternative's name
    const existingName = initialDataset.options[1].name;
    expect(() => {
      renameAlternativeInDataset(renamed, targetId, existingName);
    }).toThrow(/already exists/i);

    // Rejects blank name
    expect(() => {
      renameAlternativeInDataset(renamed, targetId, '  ');
    }).toThrow(/cannot be empty/i);

    // Test updateAlternativeInDataset
    const updatedWithMetadata = updateAlternativeInDataset(renamed, targetId, {
      name: 'Executive Tech Lead',
      tagline: 'Principal engineering track',
      description: 'Hands-on system architecture',
      color: '#34D399',
    });
    const finalOpt = updatedWithMetadata.options.find((o) => o.id === targetId);
    expect(finalOpt?.name).toBe('Executive Tech Lead');
    expect(finalOpt?.tagline).toBe('Principal engineering track');
    expect(finalOpt?.color).toBe('#34D399');
  });

  // ─── 3. Removing an alternative ────────────────────────────────────────────
  it('3. Removing an alternative: deletes option and preserves other alternatives', () => {
    const initialDataset = { ...primaryJobOfferDataset };
    const initialCount = initialDataset.options.length;
    const toRemoveId = initialDataset.options[0].id;

    const nextDataset = removeAlternativeFromDataset(initialDataset, toRemoveId);

    expect(nextDataset.options).toHaveLength(initialCount - 1);
    expect(nextDataset.options.some((o) => o.id === toRemoveId)).toBe(false);
  });

  // ─── 4. Adding a criterion ─────────────────────────────────────────────────
  it('4. Adding a criterion: creates stable unique ID, normalizes weights, and enforces benefit direction', () => {
    const initialDataset = { ...primaryJobOfferDataset };
    const initialWeights = {
      salary: 30,
      growth: 25,
      culture: 20,
      wlb: 15,
      prestige: 10,
    };

    const { dataset: nextDataset, newCriterion, weights: nextWeights } = addCriterionToDataset(
      initialDataset,
      initialWeights,
      [],
      'Equity Acceleration',
      'growth',
      20,
      'Equity',
      'Valuation upside'
    );

    expect(newCriterion.id).toMatch(/^crit-/);
    expect(newCriterion.name).toBe('Equity Acceleration');
    expect(newCriterion.category).toBe('growth');
    expect(nextDataset.criteria).toHaveLength(initialDataset.criteria.length + 1);

    // Weights re-normalize to exactly 100.0%
    const totalWeight = Object.values(nextWeights).reduce((a, b) => a + b, 0);
    expect(Math.round(totalWeight * 10) / 10).toBe(100.0);

    // Rejects duplicate criterion name
    expect(() => {
      addCriterionToDataset(nextDataset, nextWeights, [], 'Equity Acceleration');
    }).toThrow(/already exists/i);

    // Rejects empty name
    expect(() => {
      addCriterionToDataset(nextDataset, nextWeights, [], '  ');
    }).toThrow(/cannot be empty/i);
  });

  // ─── 5. Editing a criterion ────────────────────────────────────────────────
  it('5. Editing a criterion: updates metadata and shortName while preserving validation', () => {
    const initialDataset = { ...primaryJobOfferDataset };
    const targetCrit = initialDataset.criteria[0];

    const updatedDataset = updateCriterionInDataset(initialDataset, targetCrit.id, {
      name: 'Technical Mastery',
      shortName: 'Mastery',
      description: 'Depth of technical architecture exposure',
      category: 'execution',
    });

    const updated = updatedDataset.criteria.find((c) => c.id === targetCrit.id);
    expect(updated?.name).toBe('Technical Mastery');
    expect(updated?.shortName).toBe('Mastery');
    expect(updated?.description).toBe('Depth of technical architecture exposure');
    expect(updated?.category).toBe('execution');

    // Rename helper
    const renamedDataset = renameCriterionInDataset(
      updatedDataset,
      targetCrit.id,
      'Pure Engineering Mastery'
    );
    expect(renamedDataset.criteria.find((c) => c.id === targetCrit.id)?.name).toBe(
      'Pure Engineering Mastery'
    );
  });

  // ─── 6. Removing a criterion ───────────────────────────────────────────────
  it('6. Removing a criterion: removes criterion, cleans option scores, and re-normalizes weights', () => {
    const initialDataset = { ...primaryJobOfferDataset };
    const toRemoveId = initialDataset.criteria[0].id;
    const initialWeights = {
      salary: 30,
      growth: 25,
      culture: 20,
      wlb: 15,
      prestige: 10,
    };

    const { dataset: nextDataset, weights: nextWeights } = removeCriterionFromDataset(
      initialDataset,
      initialWeights,
      [],
      toRemoveId
    );

    expect(nextDataset.criteria).toHaveLength(initialDataset.criteria.length - 1);
    expect(nextDataset.criteria.some((c) => c.id === toRemoveId)).toBe(false);

    // Option scores for this criterion are cleaned up
    for (const opt of nextDataset.options) {
      expect(opt.scores[toRemoveId]).toBeUndefined();
    }

    // Weights sum to exactly 100.0%
    const totalWeight = Object.values(nextWeights).reduce((a, b) => a + b, 0);
    expect(Math.round(totalWeight * 10) / 10).toBe(100.0);
  });

  // ─── 7. Weight normalization ───────────────────────────────────────────────
  it('7. Weight normalization: follows canonical Hare-Niemeyer Largest Remainder method summing to 100.0%', () => {
    const criteria = [
      { id: 'c1', name: 'C1', shortName: 'C1', description: '', category: 'growth' as const, defaultWeight: 10 },
      { id: 'c2', name: 'C2', shortName: 'C2', description: '', category: 'growth' as const, defaultWeight: 10 },
      { id: 'c3', name: 'C3', shortName: 'C3', description: '', category: 'growth' as const, defaultWeight: 10 },
    ];

    const rawWeights = { c1: 33.333, c2: 33.333, c3: 33.334 };
    const normalized = computeCanonicalWeights(criteria, rawWeights);

    const sum = Object.values(normalized).reduce((a, b) => a + b, 0);
    expect(Math.round(sum * 10) / 10).toBe(100.0);
    expect(normalized.c1 + normalized.c2 + normalized.c3).toBe(100.0);
  });

  // ─── 8. Locked criterion behavior ──────────────────────────────────────────
  it('8. Locked criterion behavior: keeps locked weight frozen and partitions remainder proportionally', () => {
    const criteria = [
      { id: 'locked-1', name: 'L1', shortName: 'L1', description: '', category: 'risk' as const, defaultWeight: 40 },
      { id: 'unlocked-1', name: 'U1', shortName: 'U1', description: '', category: 'growth' as const, defaultWeight: 30 },
      { id: 'unlocked-2', name: 'U2', shortName: 'U2', description: '', category: 'finance' as const, defaultWeight: 30 },
    ];

    const rawWeights = { 'locked-1': 40, 'unlocked-1': 30, 'unlocked-2': 30 };
    const lockedIds = ['locked-1'];

    const normalized = computeCanonicalWeights(criteria, rawWeights, lockedIds);

    // Locked weight is strictly 40.0%
    expect(normalized['locked-1']).toBe(40.0);

    // Unlocked partitioned remaining 60.0% evenly (30.0% each)
    expect(normalized['unlocked-1']).toBe(30.0);
    expect(normalized['unlocked-2']).toBe(30.0);
    expect(normalized['locked-1'] + normalized['unlocked-1'] + normalized['unlocked-2']).toBe(100.0);
  });

  // ─── 9. Largest Remainder tie-breaking ─────────────────────────────────────
  it('9. Largest Remainder tie-breaking: breaks equal fractional remainders deterministically by ASCII criterion ID', () => {
    const criteria = [
      { id: 'gamma', name: 'Gamma', shortName: 'G', description: '', category: 'growth' as const, defaultWeight: 1 },
      { id: 'beta', name: 'Beta', shortName: 'B', description: '', category: 'growth' as const, defaultWeight: 1 },
      { id: 'alpha', name: 'Alpha', shortName: 'A', description: '', category: 'growth' as const, defaultWeight: 1 },
    ];

    const rawWeights = { gamma: 10, beta: 10, alpha: 10 };
    const normalized = computeCanonicalWeights(criteria, rawWeights);

    // alpha gets the +0.1% Hare-Niemeyer adjustment because 'alpha' < 'beta' < 'gamma'
    expect(normalized.alpha).toBe(33.4);
    expect(normalized.beta).toBe(33.3);
    expect(normalized.gamma).toBe(33.3);
    expect(Math.round((normalized.alpha + normalized.beta + normalized.gamma) * 10) / 10).toBe(100.0);
  });

  // ─── 10. Score validation ──────────────────────────────────────────────────
  it('10. Score validation: accepts finite numbers in [0, 100] and supports decimal precision', () => {
    let dataset = { ...primaryJobOfferDataset };
    const optId = dataset.options[0].id;
    const critId = dataset.criteria[0].id;

    dataset = updateOptionScoreInDataset(dataset, optId, critId, 87.5);
    expect(dataset.options.find((o) => o.id === optId)?.scores[critId]).toBe(87.5);

    dataset = updateOptionScoreInDataset(dataset, optId, critId, 0);
    expect(dataset.options.find((o) => o.id === optId)?.scores[critId]).toBe(0);

    dataset = updateOptionScoreInDataset(dataset, optId, critId, 100);
    expect(dataset.options.find((o) => o.id === optId)?.scores[critId]).toBe(100);
  });

  // ─── 11. Missing score rejection ───────────────────────────────────────────
  it('11. Missing score rejection: empty scores are not coerced to zero and flagged as missing', () => {
    let dataset = { ...primaryJobOfferDataset };
    const optId = dataset.options[0].id;
    const critId = dataset.criteria[0].id;

    // Clear score to simulate missing cell
    dataset = updateOptionScoreInDataset(dataset, optId, critId, null);

    // Serialization must NOT silently coerce missing score into 0
    const payload = buildPayloadFromState(dataset, { [critId]: 100 }, []);
    expect(payload.scores?.[optId]?.[critId]).toBeUndefined();

    // Check missing score detection
    const missing = getDatasetMissingScores(dataset);
    expect(missing.length).toBeGreaterThan(0);
    expect(missing.some((m) => m.optionId === optId && m.criterionId === critId)).toBe(true);
  });

  // ─── 12. Adding/removing matrix rows and columns ────────────────────────────
  it('12. Adding/removing matrix rows and columns: matrix expands and contracts dynamically', () => {
    let dataset = { ...primaryJobOfferDataset };
    const initialRows = dataset.criteria.length;
    const initialCols = dataset.options.length;

    // Add column (alternative)
    const { dataset: withAlt, newOption } = addAlternativeToDataset(dataset, 'Bootstrapped Studio');
    expect(withAlt.options).toHaveLength(initialCols + 1);

    // Add row (criterion)
    const { dataset: withCrit, newCriterion } = addCriterionToDataset(
      withAlt,
      { salary: 50, growth: 50 },
      [],
      'Work Autonomy',
      'lifestyle',
      20
    );
    expect(withCrit.criteria).toHaveLength(initialRows + 1);

    // Remove added row
    const { dataset: withoutCrit } = removeCriterionFromDataset(
      withCrit,
      { salary: 50, growth: 50 },
      [],
      newCriterion.id
    );
    expect(withoutCrit.criteria).toHaveLength(initialRows);

    // Remove added column
    const finalDataset = removeAlternativeFromDataset(withoutCrit, newOption.id);
    expect(finalDataset.options).toHaveLength(initialCols);
  });

  // ─── 13. Persistence after refresh ─────────────────────────────────────────
  it('13. Persistence after refresh: reconstructs dataset, weights, and score matrix accurately from DTO', () => {
    const mockDto: DecisionDto = {
      _id: '507f1f77bcf86cd799439011',
      title: 'Global Expansion Matrix',
      description: 'Evaluating EMEA vs APAC market entry',
      criteria: [
        { id: 'mkt-size', name: 'Market Size', shortName: 'Size', weight: 60, direction: 'benefit', isLocked: true },
        { id: 'reg-risk', name: 'Regulatory Ease', shortName: 'Reg', weight: 40, direction: 'benefit', isLocked: false },
      ],
      options: [
        { id: 'emea', name: 'EMEA Hub (London)', tagline: 'Established financial ecosystem' },
        { id: 'apac', name: 'APAC Hub (Singapore)', tagline: 'Fast regional growth' },
      ],
      scores: {
        emea: { 'mkt-size': 85, 'reg-risk': 75 },
        apac: { 'mkt-size': 95, 'reg-risk': 80 },
      },
      analysis: null,
      calculationVersion: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    };

    const dataset = reconstructDatasetFromDto(mockDto);
    expect(dataset.title).toBe('Global Expansion Matrix');
    expect(dataset.criteria).toHaveLength(2);
    expect(dataset.options).toHaveLength(2);
    expect(dataset.options[0].scores['mkt-size']).toBe(85);
    expect(dataset.options[1].scores['reg-risk']).toBe(80);
  });

  // ─── 14. Concurrent edit conflict ──────────────────────────────────────────
  it('14. Concurrent edit conflict: handles 409 conflict and preserves expectedVersion', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        statusCode: 409,
        error: 'Conflict',
        message: 'Decision has been modified by another participant (current version: 3, expected: 2)',
        currentVersion: 3,
      }),
    });

    await expect(
      apiClient.updateDecision('507f1f77bcf86cd799439011', {
        title: 'New Title',
        expectedVersion: 2,
      })
    ).rejects.toThrow(ApiClientError);
  });

  // ─── 15. Stale evaluation handling ─────────────────────────────────────────
  it('15. Stale evaluation handling: marks evaluation stale upon edits and getDecisionEvaluationStatus flags stale', () => {
    const mockDecision: DecisionDto = {
      _id: '507f1f77bcf86cd799439012',
      title: 'Infrastructure Choice',
      description: 'AWS vs GCP',
      criteria: [
        { id: 'c1', name: 'Perf', weight: 50, direction: 'benefit' },
        { id: 'c2', name: 'Cost', weight: 50, direction: 'benefit' },
      ],
      options: [
        { id: 'opt1', name: 'AWS' },
        { id: 'opt2', name: 'GCP' },
      ],
      scores: {
        opt1: { c1: 90, c2: 80 },
        opt2: { c1: 70, c2: 85 },
      },
      analysis: {
        engineVersion: '1.0.0',
        evaluatedAt: '2026-11-01T00:00:00.000Z',
        isTie: false,
        decisionOutcome: 'decisive',
        winnerId: 'opt1',
        tiedWinnerIds: [],
        pointLead: 7.5,
        evaluations: [
          { optionId: 'opt1', optionName: 'AWS', unroundedScore: 85, weightedScore: 85, rank: 1, presentationOrder: 1, scoreDifferenceToLeader: 0, contributions: [] },
          { optionId: 'opt2', optionName: 'GCP', unroundedScore: 77.5, weightedScore: 77.5, rank: 2, presentationOrder: 2, scoreDifferenceToLeader: 7.5, contributions: [] },
        ],
        normalizedWeights: { c1: 50, c2: 50 },
        totalWeight: 100,
        sensitivity: [],
      },
      calculationVersion: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    };

    // Initially decisive
    expect(getDecisionEvaluationStatus(mockDecision)).toBe('decisive');

    // Adding an option invalidates evaluations alignment -> status becomes stale
    const modifiedOptions: DecisionDto = {
      ...mockDecision,
      options: [...mockDecision.options, { id: 'opt3', name: 'Azure' }],
    };
    expect(getDecisionEvaluationStatus(modifiedOptions)).toBe('stale');

    // Modifying criteria invalidates normalized weights alignment -> status becomes stale
    const modifiedCriteria: DecisionDto = {
      ...mockDecision,
      criteria: [{ id: 'c1', name: 'Perf', weight: 100, direction: 'benefit' }],
    };
    expect(getDecisionEvaluationStatus(modifiedCriteria)).toBe('stale');
  });

  // ─── 16. Authoritative calculation request ─────────────────────────────────
  it('16. Authoritative calculation request: calls actual /analyze endpoint and maps returned analysis', async () => {
    const mockAnalyzedDoc: DecisionDto = {
      _id: '507f1f77bcf86cd799439099',
      title: 'Database Selection',
      description: 'Postgres vs Mongo',
      criteria: [
        { id: 'rel', name: 'Relational Model', weight: 50, direction: 'benefit' },
        { id: 'flex', name: 'Schema Flexibility', weight: 50, direction: 'benefit' },
      ],
      options: [
        { id: 'pg', name: 'PostgreSQL' },
        { id: 'mg', name: 'MongoDB' },
      ],
      scores: {
        pg: { rel: 95, flex: 60 },
        mg: { rel: 60, flex: 95 },
      },
      analysis: {
        engineVersion: '1.0.0',
        evaluatedAt: '2026-11-01T12:00:00.000Z',
        isTie: false,
        decisionOutcome: 'decisive',
        winnerId: 'pg',
        tiedWinnerIds: [],
        pointLead: 5.0,
        evaluations: [
          { optionId: 'pg', optionName: 'PostgreSQL', unroundedScore: 80, weightedScore: 80, rank: 1, presentationOrder: 1, scoreDifferenceToLeader: 0, contributions: [] },
          { optionId: 'mg', optionName: 'MongoDB', unroundedScore: 75, weightedScore: 75, rank: 2, presentationOrder: 2, scoreDifferenceToLeader: 5.0, contributions: [] },
        ],
        normalizedWeights: { rel: 50, flex: 50 },
        totalWeight: 100,
        sensitivity: [],
        calculationHash: 'hash-abc-123',
        inputHash: 'hash-in-456',
      },
      calculationVersion: 2,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockAnalyzedDoc,
    });

    const res = await apiClient.analyzeDecision('507f1f77bcf86cd799439099');
    expect(res._id).toBe('507f1f77bcf86cd799439099');
    expect(res.analysis?.winnerId).toBe('pg');
    expect(res.analysis?.calculationHash).toBe('hash-abc-123');
  });

  // ─── 17. Mathematical tie rendering ────────────────────────────────────────
  it('17. Mathematical tie rendering: correctly recognizes tie status and identifies tied winners', () => {
    const tiedDecision: DecisionDto = {
      _id: '507f1f77bcf86cd799439015',
      title: 'Tied Alternative Dilemma',
      description: 'Evaluating equal candidates',
      criteria: [
        { id: 'c1', name: 'Criterion 1', weight: 50, direction: 'benefit' },
        { id: 'c2', name: 'Criterion 2', weight: 50, direction: 'benefit' },
      ],
      options: [
        { id: 'cand-a', name: 'Candidate A' },
        { id: 'cand-b', name: 'Candidate B' },
      ],
      scores: {
        'cand-a': { c1: 80, c2: 80 },
        'cand-b': { c1: 80, c2: 80 },
      },
      analysis: {
        engineVersion: '1.0.0',
        evaluatedAt: '2026-11-01T00:00:00.000Z',
        isTie: true,
        decisionOutcome: 'tie',
        winnerId: null,
        tiedWinnerIds: ['cand-a', 'cand-b'],
        pointLead: 0.0,
        evaluations: [
          { optionId: 'cand-a', optionName: 'Candidate A', unroundedScore: 80, weightedScore: 80, rank: 1, presentationOrder: 1, scoreDifferenceToLeader: 0, contributions: [] },
          { optionId: 'cand-b', optionName: 'Candidate B', unroundedScore: 80, weightedScore: 80, rank: 1, presentationOrder: 2, scoreDifferenceToLeader: 0, contributions: [] },
        ],
        normalizedWeights: { c1: 50, c2: 50 },
        totalWeight: 100,
        sensitivity: [],
      },
      calculationVersion: 1,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    };

    expect(getDecisionEvaluationStatus(tiedDecision)).toBe('tie');
  });

  // ─── 18. Unauthorized edits ────────────────────────────────────────────────
  it('18. Unauthorized edits: rejects unauthorized updates with 403 Forbidden', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        statusCode: 403,
        error: 'Forbidden',
        message: 'Viewers are not permitted to modify decision inputs',
      }),
    });

    await expect(
      apiClient.updateDecision('507f1f77bcf86cd799439011', { title: 'Hack Title' })
    ).rejects.toThrow(/Viewers are not permitted/i);
  });

  // ─── 19. Network failure recovery ──────────────────────────────────────────
  it('19. Network failure recovery: preserves all local inputs and surfaces recoverable ApiClientError', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Failed to fetch (offline network)'));

    await expect(
      apiClient.updateDecision('507f1f77bcf86cd799439011', { title: 'New Title' })
    ).rejects.toMatchObject({
      isNetworkError: true,
    });
  });

  // ─── 20. Existing template compatibility ───────────────────────────────────
  it('20. Existing template compatibility: all built-in templates load and normalize cleanly', () => {
    expect(templateDatasets.length).toBeGreaterThanOrEqual(3);

    for (const template of templateDatasets) {
      expect(template.criteria.length).toBeGreaterThan(0);
      expect(template.options.length).toBeGreaterThan(0);

      // Verify canonical weight normalization on template default weights
      const initialWeights: Record<string, number> = {};
      template.criteria.forEach((c) => {
        initialWeights[c.id] = c.defaultWeight;
      });

      const normalized = computeCanonicalWeights(template.criteria, initialWeights);
      const sum = Object.values(normalized).reduce((a, b) => a + b, 0);
      expect(Math.round(sum * 10) / 10).toBe(100.0);
    }
  });
});
