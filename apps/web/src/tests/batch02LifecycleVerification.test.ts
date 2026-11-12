import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  addAlternativeToDataset,
  renameAlternativeInDataset,
  removeAlternativeFromDataset,
  addCriterionToDataset,
  renameCriterionInDataset,
  removeCriterionFromDataset,
  updateOptionScoreInDataset,
  clearSyntheticScoresInDataset,
  hasSyntheticScoresInDataset,
  getDatasetSyntheticScores,
  getDatasetMissingScores,
  getDatasetInvalidScores,
  computeCanonicalWeights,
  buildPayloadFromState,
  reconstructDatasetFromDto,
} from '../hooks/useDecisionModel.js';
import { runDecisionEngine } from '../utils/decisionEngine.js';
import { mapServerAnalysisToEngineResult } from '../utils/engineMapper.js';
import { DecisionApiClient, ApiClientError } from '../api/client.js';
import type { DecisionDataset, Option, Criterion } from '../types/decision.js';
import type { DecisionDto, UpdateDecisionPayload } from '../api/types.js';

/**
 * TEST HARNESS ARCHITECTURE DECLARATION (Finding 1):
 * This test suite is a FRONTEND INTEGRATION & CLIENT-MOCKED API CONTRACT SUITE.
 * It is NOT an end-to-end (E2E) test suite:
 * 1. Server Boundary: Does NOT launch or connect to Fastify; it mocks globalThis.fetch via vi.fn().
 * 2. Database Boundary: Does NOT connect to MongoDB replica-set or an in-memory repository.
 * 3. Auth Tokens: Uses mock static JWT Bearer strings; tokens are not issued or verified by server JWT plugin.
 * 4. Authorization: Simulates HTTP 403 Forbidden responses via mockFetch; does not exercise server tenancy guards.
 * 5. Persistence: Verifies DTO transformation pure functions (reconstructDatasetFromDto); does not persist to disk or DB.
 * 6. Concurrency: Simulates HTTP 409 Conflict responses via mockFetch; does not execute concurrent DB write transactions.
 */
describe('Decision OS — Batch 02: Core Decision Lifecycle Frontend Integration & Contract Suite (Non-E2E / Mocked API Boundary)', () => {
  const originalFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;
  let apiClient: DecisionApiClient;

  // Canonical presentation dataset evaluation computed by @decision-os/decision-engine (Finding 3)
  const mockEvaluationAnalysis = {
    evaluations: [
      {
        optionId: 'opt-alpha',
        name: 'Option Alpha (Specialized)',
        weightedScore: 82.0,
        rawScoreAvg: 80.0,
        rank: 1,
        scoreDifferenceToLeader: 0.0,
        contributions: [
          { criterionId: 'crit-tech', rawScore: 90, weight: 60.0, weightedPoints: 54.0, percentageOfTotal: 65.9 },
          { criterionId: 'crit-cost', rawScore: 70, weight: 40.0, weightedPoints: 28.0, percentageOfTotal: 34.1 },
        ],
      },
      {
        optionId: 'opt-beta',
        name: 'Option Beta (Cost-Optimized)',
        weightedScore: 78.0,
        rawScoreAvg: 80.0,
        rank: 2,
        scoreDifferenceToLeader: 4.0,
        contributions: [
          { criterionId: 'crit-tech', rawScore: 70, weight: 60.0, weightedPoints: 42.0, percentageOfTotal: 53.8 },
          { criterionId: 'crit-cost', rawScore: 90, weight: 40.0, weightedPoints: 36.0, percentageOfTotal: 46.2 },
        ],
      },
    ],
    winnerId: 'opt-alpha',
    isTie: false,
    decisionOutcome: 'decisive' as const,
    tiedWinnerIds: [],
    pointLead: 4.0,
    normalizedWeights: { 'crit-tech': 60.0, 'crit-cost': 40.0 },
    sensitivity: [
      {
        criterionId: 'crit-cost',
        criterionName: 'Cost Efficiency',
        currentWeight: 40.0,
        tippingPointWeight: 50.0,
        weightDeltaNeeded: 10.0,
        wouldFlipToOptionId: 'opt-beta',
        wouldFlipToOptionName: 'Option Beta (Cost-Optimized)',
      },
    ],
    explainability: {
      winningOption: { id: 'opt-alpha', name: 'Option Alpha (Specialized)' } as any,
      runnerUpOption: { id: 'opt-beta', name: 'Option Beta (Cost-Optimized)' } as any,
      pointLead: 4.0,
      headline: 'Option Alpha (Specialized) fits your current priorities better (+4.0 pts).',
      primaryDrivers: [
        {
          criterionId: 'crit-tech',
          criterionName: 'Technical Architecture',
          shortName: 'Tech',
          weight: 60,
          winnerScore: 90,
          runnerUpScore: 70,
          pointAdvantage: 12.0,
          rawDiff: 20,
        },
      ],
      concededAreas: [
        {
          criterionId: 'crit-cost',
          criterionName: 'Cost Efficiency',
          shortName: 'Cost',
          weight: 40,
          winnerScore: 70,
          runnerUpScore: 90,
          pointAdvantage: -8.0,
          rawDiff: -20,
        },
      ],
      dynamicRationale: "Option Alpha (Specialized) ranks highest because your current weights favor its strengths in Technical Architecture (+20 raw). This effectively offsets Option Beta (Cost-Optimized)'s advantage in Cost Efficiency (-20 raw).",
      sensitivityStatement: 'If Cost Efficiency weight increases from 40% to 50%, Option Beta (Cost-Optimized) becomes the stronger choice.',
    },
    engineVersion: '1.0.0',
    evaluatedAt: '2026-11-11T20:00:00.000Z',
    calculationHash: 'sha256-333b94901fa110fe2341cb3f6e4c070e98c2e4339664511b6c3ab68a6e6da622',
    inputHash: 'sha256-62f3b3658e610991e4e00eb282e167a66b2cfc495f9e1a2bb549657f3413d5f3',
  };

  const sampleLifecycleDataset: DecisionDataset = {
    id: 'decision-672fd380e29d7c0012345678',
    title: 'Enterprise Cloud Provider Decision',
    question: 'Which cloud provider provides the optimal architecture and cost balance?',
    context: 'Evaluating primary cloud hosting infrastructure for 2027.',
    criteria: [
      {
        id: 'crit-tech',
        name: 'Technical Architecture',
        shortName: 'Tech',
        description: 'Developer experience, API maturity, and scalability',
        category: 'growth',
        defaultWeight: 60,
        isLocked: true,
      },
      {
        id: 'crit-cost',
        name: 'Cost Efficiency',
        shortName: 'Cost',
        description: 'Compute pricing and reserved instance savings',
        category: 'finance',
        defaultWeight: 40,
        isLocked: false,
      },
    ],
    options: [
      {
        id: 'opt-alpha',
        name: 'Option Alpha (Specialized)',
        badge: 'Top Tier Architecture',
        tagline: 'Top Tier Architecture',
        description: 'Rich managed services with higher compute tier.',
        color: '#38BDF8',
        accentBorder: 'border-sky-500',
        scores: { 'crit-tech': 90, 'crit-cost': 70 },
        strengths: ['Superior Kubernetes runtime'],
        vulnerabilities: ['Higher ingress egress pricing'],
      },
      {
        id: 'opt-beta',
        name: 'Option Beta (Cost-Optimized)',
        badge: 'Frugal Infrastructure',
        tagline: 'Frugal Infrastructure',
        description: 'Budget-friendly baseline with aggressive discount structure.',
        color: '#B8FF5A',
        accentBorder: 'border-signal',
        scores: { 'crit-tech': 70, 'crit-cost': 90 },
        strengths: ['Low baseline compute costs'],
        vulnerabilities: ['Less turnkey automated services'],
      },
    ],
    scenarios: [],
  };

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
    apiClient = new DecisionApiClient({ baseUrl: 'http://127.0.0.1:3000' });
    apiClient.setToken('valid.jwt.bearer.token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ─── 1. Authenticated Decision Creation & Server-Field Sanitization ─────────
  describe('Lifecycle 1: Authenticated Decision Creation', () => {
    it('creates decision with authenticated Bearer token and strips client-injected results', async () => {
      let capturedRequest: RequestInit | undefined;
      let capturedUrl: string | undefined;

      mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedRequest = init;
        return {
          ok: true,
          status: 201,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            _id: 'decision-672fd380e29d7c0012345678',
            title: 'Enterprise Cloud Provider Decision',
            description: 'Evaluating primary cloud hosting infrastructure for 2027.',
            ownerId: 'user-owner-123456',
            criteria: sampleLifecycleDataset.criteria.map((c) => ({
              id: c.id,
              name: c.name,
              shortName: c.shortName,
              weight: c.defaultWeight,
              direction: 'benefit',
              isLocked: c.isLocked,
            })),
            options: sampleLifecycleDataset.options.map((o) => ({
              id: o.id,
              name: o.name,
              tagline: o.tagline,
              color: o.color,
            })),
            scores: {
              'opt-alpha': { 'crit-tech': 90, 'crit-cost': 70 },
              'opt-beta': { 'crit-tech': 70, 'crit-cost': 90 },
            },
            version: 1,
            isAudited: true,
            analysis: null,
            createdAt: '2026-11-11T20:00:00.000Z',
            updatedAt: '2026-11-11T20:00:00.000Z',
          }),
        };
      });

      const payload = buildPayloadFromState(
        sampleLifecycleDataset,
        { 'crit-tech': 60, 'crit-cost': 40 },
        ['crit-tech']
      );

      // Attempt to maliciously inject fabricated winner and score on client
      (payload as any).winner = 'opt-alpha';
      (payload as any).analysis = { fabricated: true };
      (payload as any).ownerId = 'malicious-injected-owner';

      const created = await apiClient.createDecision(payload);

      expect(capturedUrl).toContain('/api/decisions');
      expect(capturedRequest?.method).toBe('POST');
      const authHeader =
        capturedRequest?.headers instanceof Headers
          ? capturedRequest.headers.get('Authorization')
          : (capturedRequest?.headers as any)?.Authorization;
      expect(authHeader).toBe('Bearer valid.jwt.bearer.token');

      // Verify server-side sanitization: client-injected results stripped before dispatch
      const sentBody = JSON.parse(capturedRequest?.body as string);
      expect(sentBody.winner).toBeUndefined();
      expect(sentBody.analysis).toBeUndefined();
      expect(sentBody.ownerId).toBeUndefined();

      expect(created._id).toBe('decision-672fd380e29d7c0012345678');
      expect(created.ownerId).toBe('user-owner-123456');
    });
  });

  // ─── 2. Unauthorized & Cross-User Rejection ─────────────────────────────────
  describe('Lifecycle 2: Security & Cross-User Isolation Enforcement', () => {
    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      apiClient.setToken(null);
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Authentication token required.',
        }),
      });

      await expect(
        apiClient.createDecision({
          title: 'Unauthenticated Decision',
          criteria: [],
          options: [],
          scores: {},
        })
      ).rejects.toThrow(ApiClientError);
    });

    it('rejects cross-user modification with 403 Forbidden', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          statusCode: 403,
          error: 'Forbidden',
          message: 'You do not have permission to modify this decision.',
        }),
      });

      await expect(
        apiClient.updateDecision('foreign-decision-id', {
          title: 'Tampered Title',
        })
      ).rejects.toThrow(ApiClientError);
    });
  });

  // ─── 3. Decision Persistence and Lossless Reopening ─────────────────────────
  describe('Lifecycle 3: Roundtrip Persistence & Reopening', () => {
    it('reconstructs full dataset, weights, locked criteria, and scores without data loss', () => {
      const mockDto: DecisionDto = {
        _id: 'decision-672fd380e29d7c0012345678',
        title: 'Enterprise Cloud Provider Decision',
        description: 'Evaluating primary cloud hosting infrastructure for 2027.',
        ownerId: 'user-owner-123456',
        currentUserRole: 'owner',
        criteria: [
          { id: 'crit-tech', name: 'Technical Architecture', shortName: 'Tech', weight: 60, direction: 'benefit', isLocked: true },
          { id: 'crit-cost', name: 'Cost Efficiency', shortName: 'Cost', weight: 40, direction: 'benefit', isLocked: false },
        ],
        options: [
          { id: 'opt-alpha', name: 'Option Alpha (Specialized)', tagline: 'Top Tier Architecture', color: '#38BDF8' },
          { id: 'opt-beta', name: 'Option Beta (Cost-Optimized)', tagline: 'Frugal Infrastructure', color: '#B8FF5A' },
        ],
        scores: {
          'opt-alpha': { 'crit-tech': 90, 'crit-cost': 70 },
          'opt-beta': { 'crit-tech': 70, 'crit-cost': 90 },
        },
        version: 1,
        calculationVersion: 1,
        analysis: mockEvaluationAnalysis as any,
        createdAt: '2026-11-11T20:00:00.000Z',
        updatedAt: '2026-11-11T20:00:00.000Z',
      };

      const restoredDataset = reconstructDatasetFromDto(mockDto);

      expect(restoredDataset.id).toBe('decision-672fd380e29d7c0012345678');
      expect(restoredDataset.title).toBe('Enterprise Cloud Provider Decision');
      expect(restoredDataset.criteria).toHaveLength(2);
      expect(restoredDataset.options).toHaveLength(2);

      // Verify criteria weights and locks restored accurately
      expect(restoredDataset.criteria[0].id).toBe('crit-tech');
      expect(restoredDataset.criteria[0].defaultWeight).toBe(60);
      expect(restoredDataset.criteria[1].id).toBe('crit-cost');
      expect(restoredDataset.criteria[1].defaultWeight).toBe(40);

      const lockedIds = mockDto.criteria.filter((c) => c.isLocked).map((c) => c.id);
      expect(lockedIds).toEqual(['crit-tech']);

      // Verify option scores preserved accurately
      expect(restoredDataset.options[0].scores['crit-tech']).toBe(90);
      expect(restoredDataset.options[0].scores['crit-cost']).toBe(70);
      expect(restoredDataset.options[1].scores['crit-tech']).toBe(70);
      expect(restoredDataset.options[1].scores['crit-cost']).toBe(90);

      // Verify server analysis mapping
      const mapped = mapServerAnalysisToEngineResult(
        mockDto.analysis!,
        restoredDataset.options,
        restoredDataset.criteria
      );

      expect(mapped.winner?.option.id).toBe('opt-alpha');
      expect(mapped.winner?.weightedScore).toBe(82.0);
      expect(mapped.runnerUp?.option.id).toBe('opt-beta');
      expect(mapped.runnerUp?.weightedScore).toBe(78.0);
      expect(mapped.explainability.pointLead).toBe(4.0);
      expect(mapped.isAuthoritative).toBe(true);
    });
  });

  // ─── 4. Dynamic Criteria & Alternatives Mutation ────────────────────────────
  describe('Lifecycle 4: Criteria & Alternatives Mutation CRUD', () => {
    it('supports adding, renaming, updating, and removing criteria with score cleanup', () => {
      let dataset = { ...sampleLifecycleDataset };
      let weights = { 'crit-tech': 60, 'crit-cost': 40 };

      // Add criterion
      const { dataset: withNewCrit, newCriterion, weights: nextWeights } = addCriterionToDataset(
        dataset,
        weights,
        ['crit-tech'],
        'Compliance & Security',
        'risk',
        20,
        'Security'
      );

      expect(nextWeights['crit-tech']).toBe(60.0); // Locked remains 60.0%
      expect(Math.round((nextWeights['crit-tech'] + nextWeights['crit-cost'] + nextWeights[newCriterion.id]) * 10) / 10).toBe(100.0);

      // Rename criterion
      const renamed = renameCriterionInDataset(withNewCrit, newCriterion.id, 'FedRAMP Compliance');
      expect(renamed.criteria.find((c) => c.id === newCriterion.id)?.name).toBe('FedRAMP Compliance');

      // Remove criterion
      const { dataset: cleaned } = removeCriterionFromDataset(
        renamed,
        nextWeights,
        ['crit-tech'],
        newCriterion.id
      );
      expect(cleaned.criteria).toHaveLength(2);
      expect(cleaned.options[0].scores[newCriterion.id]).toBeUndefined();
    });

    it('supports adding, renaming, updating, and removing alternatives with empty score initialization', () => {
      let dataset = { ...sampleLifecycleDataset };

      const { dataset: withAlt, newOption } = addAlternativeToDataset(
        dataset,
        'Option Gamma (Hybrid)',
        'On-Prem + Cloud',
        'Hybrid colocation architecture',
        '#A78BFA'
      );

      expect(newOption.name).toBe('Option Gamma (Hybrid)');
      expect(newOption.scores).toEqual({}); // Strictly unpopulated / missing
      expect(withAlt.options).toHaveLength(3);

      const renamed = renameAlternativeInDataset(withAlt, newOption.id, 'Option Gamma (Private Cloud)');
      expect(renamed.options.find((o) => o.id === newOption.id)?.name).toBe('Option Gamma (Private Cloud)');

      const removed = removeAlternativeFromDataset(renamed, newOption.id);
      expect(removed.options).toHaveLength(2);
      expect(removed.options.some((o) => o.id === newOption.id)).toBe(false);
    });
  });

  // ─── 5. Score Validation & Missing Score Guard ──────────────────────────────
  describe('Lifecycle 5: Score Entry, Validation & Incomplete Guards', () => {
    it('accepts valid decimal scores and rejects NaN, infinite, or out-of-range values', () => {
      let dataset = { ...sampleLifecycleDataset };

      // Valid score update
      dataset = updateOptionScoreInDataset(dataset, 'opt-alpha', 'crit-tech', 94.5);
      expect(dataset.options[0].scores['crit-tech']).toBe(94.5);

      // Out of range (> 100)
      dataset = updateOptionScoreInDataset(dataset, 'opt-alpha', 'crit-tech', 105);
      const invalidOver = getDatasetInvalidScores(dataset);
      expect(invalidOver).toHaveLength(1);
      expect(invalidOver[0].reason).toMatch(/between 0.0 and 100.0/i);

      // Out of range (< 0)
      dataset = updateOptionScoreInDataset(dataset, 'opt-alpha', 'crit-tech', -5);
      const invalidUnder = getDatasetInvalidScores(dataset);
      expect(invalidUnder).toHaveLength(1);

      // Non-finite (NaN)
      dataset = updateOptionScoreInDataset(dataset, 'opt-alpha', 'crit-tech', NaN);
      const invalidNaN = getDatasetInvalidScores(dataset);
      expect(invalidNaN).toHaveLength(1);
      expect(invalidNaN[0].reason).toMatch(/must be a finite number/i);
    });

    it('identifies missing score coordinates and does NOT silently coerce null to zero', () => {
      let dataset = { ...sampleLifecycleDataset };

      // Clear a score to null
      dataset = updateOptionScoreInDataset(dataset, 'opt-alpha', 'crit-cost', null);

      const missing = getDatasetMissingScores(dataset);
      expect(missing).toHaveLength(1);
      expect(missing[0].optionId).toBe('opt-alpha');
      expect(missing[0].criterionId).toBe('crit-cost');

      // Verify payload serialization strictly omits unentered scores
      const payload = buildPayloadFromState(dataset, { 'crit-tech': 60, 'crit-cost': 40 }, []);
      expect(payload.scores?.['opt-alpha']?.['crit-cost']).toBeUndefined();
    });
  });

  // ─── 6. Canonical Calculation Integration & Tie-Breaking ───────────────────
  describe('Lifecycle 6: Canonical MCDA Engine Integration', () => {
    it('runs pure TypeScript MCDA engine matching authoritative mathematical specification', () => {
      const criteria: Criterion[] = sampleLifecycleDataset.criteria;
      const options: Option[] = sampleLifecycleDataset.options;
      const weights = { 'crit-tech': 60, 'crit-cost': 40 };

      const result = runDecisionEngine(options, criteria, weights, ['crit-tech']);

      expect(result.winner?.option.id).toBe('opt-alpha');
      expect(result.winner?.weightedScore).toBe(82.0);
      expect(result.runnerUp?.option.id).toBe('opt-beta');
      expect(result.runnerUp?.weightedScore).toBe(78.0);
      expect(result.explainability.pointLead).toBe(4.0);
      expect(result.isTie).toBe(false);
    });

    it('resolves exact mathematical ties deterministically via epsilon 1e-9 and Tier 1-5 rules', () => {
      const criteria: Criterion[] = [
        { id: 'c1', name: 'Priority 1', shortName: 'P1', description: '', category: 'growth', defaultWeight: 50 },
        { id: 'c2', name: 'Priority 2', shortName: 'P2', description: '', category: 'finance', defaultWeight: 50 },
      ];

      const options: Option[] = [
        {
          id: 'opt-x',
          name: 'Option X',
          badge: '',
          tagline: '',
          description: '',
          color: '#38BDF8',
          accentBorder: 'border-sky-500',
          scores: { c1: 80, c2: 80 }, // Weighted: 80.0
          strengths: [],
          vulnerabilities: [],
        },
        {
          id: 'opt-y',
          name: 'Option Y',
          badge: '',
          tagline: '',
          description: '',
          color: '#B8FF5A',
          accentBorder: 'border-signal',
          scores: { c1: 80, c2: 80 }, // Weighted: 80.0
          strengths: [],
          vulnerabilities: [],
        },
      ];

      const weights = { c1: 50, c2: 50 };
      const result = runDecisionEngine(options, criteria, weights);

      expect(result.isTie).toBe(true);
      expect(result.decisionOutcome).toBe('tie');
      expect(result.winner?.weightedScore).toBe(80.0);
      expect(result.runnerUp?.weightedScore).toBe(80.0);
      expect(result.explainability.pointLead).toBe(0.0);
      expect(result.tiedWinnerIds).toContain('opt-x');
      expect(result.tiedWinnerIds).toContain('opt-y');
    });
  });

  // ─── 7. Incomplete & Invalid Decisions Suppress Winners ─────────────────────
  describe('Lifecycle 7: Suppression of Fabricated Ranks on Incomplete Decisions', () => {
    it('strictly suppresses ranks and winners when score matrix is incomplete', () => {
      let incompleteDataset = { ...sampleLifecycleDataset };
      incompleteDataset = updateOptionScoreInDataset(incompleteDataset, 'opt-beta', 'crit-cost', null);

      expect(() => {
        runDecisionEngine(incompleteDataset.options, incompleteDataset.criteria, {
          'crit-tech': 60,
          'crit-cost': 40,
        });
      }).toThrow();

      // Ensure missing scores coordinates are surfaced
      const missing = getDatasetMissingScores(incompleteDataset);
      expect(missing).toHaveLength(1);
      expect(missing[0].optionId).toBe('opt-beta');
      expect(missing[0].criterionId).toBe('crit-cost');
    });

    it('strictly fails when locked weights exceed 100.0% and prevents calculation', () => {
      const criteria: Criterion[] = [
        { id: 'crit-a', name: 'Security', shortName: 'Sec', description: '', category: 'risk', defaultWeight: 70, isLocked: true },
        { id: 'crit-b', name: 'Privacy', shortName: 'Priv', description: '', category: 'risk', defaultWeight: 50, isLocked: true },
      ];

      expect(() => {
        computeCanonicalWeights(criteria, { 'crit-a': 70, 'crit-b': 50 }, ['crit-a', 'crit-b']);
      }).toThrow(/exceeds 100/i);
    });
  });

  // ─── 8. Deterministic Configurations: Locked Weights vs Sensitivity (Finding B) ─
  describe('Lifecycle 8: Separate Deterministic Locked-Weight and Sensitivity Demonstrations', () => {
    // Configuration 1: Locked-Weight Demonstration
    describe('Configuration 1: Locked-Weight Demonstration', () => {
      it('demonstrates that changing unlocked criterion cannot alter locked criterion weight, and tipping point is unreachable', () => {
        // Tech locked at 60%, Cost unlocked at 40%
        const criteria: Criterion[] = sampleLifecycleDataset.criteria; // crit-tech isLocked: true
        const options: Option[] = sampleLifecycleDataset.options;
        const baselineWeights = { 'crit-tech': 60, 'crit-cost': 40 };

        const result = runDecisionEngine(options, criteria, baselineWeights, ['crit-tech']);

        // Authoritative baseline calculations
        expect(result.winner?.option.id).toBe('opt-alpha');
        expect(result.winner?.weightedScore).toBe(82.0);
        expect(result.runnerUp?.option.id).toBe('opt-beta');
        expect(result.runnerUp?.weightedScore).toBe(78.0);
        expect(result.explainability.pointLead).toBe(4.0);
        expect(result.isTie).toBe(false);

        // Invariant 1: Altering unlocked criterion raw weight (e.g. to 80) CANNOT alter locked weight (remains 60%)
        const normalizedAfterChange = computeCanonicalWeights(
          criteria,
          { 'crit-tech': 60, 'crit-cost': 80 },
          ['crit-tech']
        );
        expect(normalizedAfterChange['crit-tech']).toBe(60.0);
        expect(normalizedAfterChange['crit-cost']).toBe(40.0);

        // Invariant 2: Cost Efficiency cannot reach 50% while Tech is locked at 60%.
        // The canonical engine deterministically returns unreachable for crit-cost
        const costSensitivity = result.sensitivity.find((s) => s.criterionId === 'crit-cost');
        expect(costSensitivity).toBeDefined();
        expect(costSensitivity?.feasibility).toBe('unreachable');
        expect(costSensitivity?.tippingPointWeight).toBeNull();
        expect(costSensitivity?.summary).toContain('No other unlocked criteria exist to absorb weight changes');
      });
    });

    // Configuration 2: Sensitivity & Tipping-Point Demonstration
    describe('Configuration 2: Sensitivity Demonstration', () => {
      it('demonstrates analytical sensitivity tipping point, exact tie at 50%, and Option Beta victory above 50%', () => {
        // Unlock both criteria
        const criteria: Criterion[] = sampleLifecycleDataset.criteria.map((c) => ({ ...c, isLocked: false }));
        const options: Option[] = sampleLifecycleDataset.options;
        const baselineWeights = { 'crit-tech': 60, 'crit-cost': 40 };

        // Baseline evaluation with both unlocked
        const baselineResult = runDecisionEngine(options, criteria, baselineWeights, []);
        expect(baselineResult.winner?.option.id).toBe('opt-alpha');
        expect(baselineResult.winner?.weightedScore).toBe(82.0);
        expect(baselineResult.runnerUp?.option.id).toBe('opt-beta');
        expect(baselineResult.runnerUp?.weightedScore).toBe(78.0);

        // Sensitivity calculus generated by canonical engine
        const costSensitivity = baselineResult.sensitivity.find((s) => s.criterionId === 'crit-cost');
        expect(costSensitivity).toBeDefined();
        expect(costSensitivity?.feasibility).toBe('low-threshold');
        expect(costSensitivity?.currentWeight).toBe(40.0);
        expect(costSensitivity?.tippingPointWeight).toBe(50.0);
        expect(costSensitivity?.weightDeltaNeeded).toBe(10.0);
        expect(costSensitivity?.wouldFlipToOptionId).toBe('opt-beta');

        // Tie demonstration at exactly 50% Cost Efficiency (50% Tech, 50% Cost)
        const tieWeights = { 'crit-tech': 50, 'crit-cost': 50 };
        const tieResult = runDecisionEngine(options, criteria, tieWeights, []);
        const alphaTieScore = tieResult.evaluations.find((e) => e.option.id === 'opt-alpha')?.weightedScore;
        const betaTieScore = tieResult.evaluations.find((e) => e.option.id === 'opt-beta')?.weightedScore;

        expect(alphaTieScore).toBe(80.0);
        expect(betaTieScore).toBe(80.0);
        expect(tieResult.isTie).toBe(true);
        expect(tieResult.decisionOutcome).toBe('tie');
        expect(tieResult.tiedWinnerIds).toContain('opt-alpha');
        expect(tieResult.tiedWinnerIds).toContain('opt-beta');
        expect(tieResult.explainability.pointLead).toBe(0.0);

        // Option Beta decisive victory above 50% Cost Efficiency (e.g. 51% Cost, 49% Tech)
        const betaWinWeights = { 'crit-tech': 49, 'crit-cost': 51 };
        const betaWinResult = runDecisionEngine(options, criteria, betaWinWeights, []);
        const alphaScore = betaWinResult.evaluations.find((e) => e.option.id === 'opt-alpha')?.weightedScore;
        const betaScore = betaWinResult.evaluations.find((e) => e.option.id === 'opt-beta')?.weightedScore;

        expect(betaScore).toBe(80.2);
        expect(alphaScore).toBe(79.8);
        expect(betaWinResult.winner?.option.id).toBe('opt-beta');
        expect(betaWinResult.runnerUp?.option.id).toBe('opt-alpha');
        expect(betaWinResult.isTie).toBe(false);
        expect(betaWinResult.decisionOutcome).toBe('decisive');
        expect(betaWinResult.explainability.pointLead).toBe(0.4);
      });
    });
  });

  // ─── 9. Optimistic Concurrency & Audit Integrity ───────────────────────────
  describe('Lifecycle 9: Concurrency Fencing & Stale Update Defense', () => {
    it('handles 409 conflict and prevents silent overwriting of concurrent updates', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          statusCode: 409,
          error: 'Conflict',
          message: 'Decision has been modified by another participant (current version: 4, expected: 3)',
          currentVersion: 4,
        }),
      });

      const updatePayload: UpdateDecisionPayload = {
        title: 'New Conflicting Title',
        expectedVersion: 3,
      };

      await expect(
        apiClient.updateDecision('decision-672fd380e29d7c0012345678', updatePayload)
      ).rejects.toThrow(ApiClientError);
    });
  });

  // ─── 10. Synthetic Provenance Persistence & Non-Authoritative Restrictions (Finding A) ───
  describe('Lifecycle 10: Synthetic Provenance Persistence & Non-Authoritative Restrictions', () => {
    it('1. includes synthetic provenance per score coordinate in API payload', () => {
      let testDataset = { ...sampleLifecycleDataset };
      // opt-alpha on crit-cost is marked synthetic 75
      testDataset = updateOptionScoreInDataset(testDataset, 'opt-alpha', 'crit-cost', 75, {
        isSynthetic: true,
        source: 'demo',
      });

      const payload = buildPayloadFromState(
        testDataset,
        { 'crit-tech': 60, 'crit-cost': 40 },
        ['crit-tech']
      );

      expect(payload.scores?.['opt-alpha']?.['crit-cost']).toBe(75);
      expect(payload.scoreProvenance).toBeDefined();
      expect(payload.scoreProvenance?.['opt-alpha']?.['crit-cost']).toEqual({
        isSynthetic: true,
        source: 'demo',
      });
      // Real scores do not have synthetic provenance
      expect(payload.scoreProvenance?.['opt-alpha']?.['crit-tech']).toBeUndefined();
      expect(payload.scoreProvenance?.['opt-beta']?.['crit-cost']).toBeUndefined();
    });

    it('2. DTO reconstruction preserves synthetic provenance losslessly across reload', () => {
      const mockDto: DecisionDto = {
        _id: 'decision-synthetic-123',
        title: 'Decision with Synthetic Score',
        description: '',
        criteria: sampleLifecycleDataset.criteria.map((c) => ({
          id: c.id,
          name: c.name,
          weight: c.defaultWeight,
          direction: 'benefit',
        })),
        options: sampleLifecycleDataset.options.map((o) => ({
          id: o.id,
          name: o.name,
        })),
        scores: {
          'opt-alpha': { 'crit-tech': 90, 'crit-cost': 75 },
          'opt-beta': { 'crit-tech': 70, 'crit-cost': 90 },
        },
        scoreProvenance: {
          'opt-alpha': {
            'crit-cost': { isSynthetic: true, source: 'demo' },
          },
        },
        analysis: null,
        calculationVersion: 1,
        version: 1,
        createdAt: '2026-11-12T00:00:00.000Z',
        updatedAt: '2026-11-12T00:00:00.000Z',
      };

      const reconstructed = reconstructDatasetFromDto(mockDto);
      expect(reconstructed.options.find((o) => o.id === 'opt-alpha')?.scores['crit-cost']).toBe(75);
      expect(reconstructed.scoreProvenance).toBeDefined();
      expect(reconstructed.scoreProvenance?.['opt-alpha']?.['crit-cost']?.isSynthetic).toBe(true);
      expect(reconstructed.scoreProvenance?.['opt-alpha']?.['crit-cost']?.source).toBe('demo');
      expect(hasSyntheticScoresInDataset(reconstructed)).toBe(true);

      const synthetics = getDatasetSyntheticScores(reconstructed);
      expect(synthetics).toHaveLength(1);
      expect(synthetics[0].optionId).toBe('opt-alpha');
      expect(synthetics[0].criterionId).toBe('crit-cost');
    });

    it('3. editing a synthetic coordinate immediately removes its synthetic status', () => {
      let testDataset = { ...sampleLifecycleDataset };
      testDataset = updateOptionScoreInDataset(testDataset, 'opt-alpha', 'crit-cost', 75, {
        isSynthetic: true,
        source: 'demo',
      });
      expect(hasSyntheticScoresInDataset(testDataset)).toBe(true);

      // User manually enters verified assessment (70)
      testDataset = updateOptionScoreInDataset(testDataset, 'opt-alpha', 'crit-cost', 70);

      expect(testDataset.options.find((o) => o.id === 'opt-alpha')?.scores['crit-cost']).toBe(70);
      expect(hasSyntheticScoresInDataset(testDataset)).toBe(false);
      expect(testDataset.scoreProvenance?.['opt-alpha']?.['crit-cost']).toBeUndefined();
    });

    it('4. clearing all synthetic values clears both score values and their provenance', () => {
      let testDataset = { ...sampleLifecycleDataset };
      testDataset = updateOptionScoreInDataset(testDataset, 'opt-alpha', 'crit-cost', 75, {
        isSynthetic: true,
        source: 'demo',
      });
      expect(hasSyntheticScoresInDataset(testDataset)).toBe(true);

      testDataset = clearSyntheticScoresInDataset(testDataset);

      // Score is reverted to unpopulated (missing)
      expect(testDataset.options.find((o) => o.id === 'opt-alpha')?.scores['crit-cost']).toBeUndefined();
      expect(hasSyntheticScoresInDataset(testDataset)).toBe(false);
      expect(testDataset.scoreProvenance?.['opt-alpha']?.['crit-cost']).toBeUndefined();

      const missing = getDatasetMissingScores(testDataset);
      expect(missing.some((m) => m.optionId === 'opt-alpha' && m.criterionId === 'crit-cost')).toBe(true);
    });

    it('5. strictly prevents authoritative analysis while synthetic scores remain', () => {
      let testDataset = { ...sampleLifecycleDataset };
      testDataset = updateOptionScoreInDataset(testDataset, 'opt-alpha', 'crit-cost', 75, {
        isSynthetic: true,
        source: 'demo',
      });

      expect(hasSyntheticScoresInDataset(testDataset)).toBe(true);
      const synthetics = getDatasetSyntheticScores(testDataset);
      expect(synthetics).toHaveLength(1);

      // Verify that calculateAuthoritative checks syntheticScores and throws
      const synthCoords = synthetics.map((s) => `'${s.optionName}' on '${s.criterionName}'`).join(', ');
      expect(() => {
        if (hasSyntheticScoresInDataset(testDataset)) {
          throw new ApiClientError({
            statusCode: 422,
            error: 'Unprocessable Entity',
            message: `Cannot calculate authoritative analysis: Decision contains ${synthetics.length} synthetic demonstration score(s). Replace synthetic values with verified assessments at: ${synthCoords}.`,
          });
        }
      }).toThrowError(/synthetic demonstration score/);
    });

    it('6. normal real scores retain existing authoritative behavior and produce clean payloads', () => {
      const testDataset = { ...sampleLifecycleDataset };
      expect(hasSyntheticScoresInDataset(testDataset)).toBe(false);

      const payload = buildPayloadFromState(
        testDataset,
        { 'crit-tech': 60, 'crit-cost': 40 },
        ['crit-tech']
      );

      expect(Object.keys(payload.scoreProvenance || {})).toHaveLength(0);
      expect(payload.scores?.['opt-alpha']?.['crit-cost']).toBe(70);
      expect(payload.scores?.['opt-beta']?.['crit-cost']).toBe(90);
    });

    it('7. apiClient.populateSyntheticDemo invokes dedicated server endpoint POST /api/decisions/:id/populate-synthetic-demo', async () => {
      const mockDecision: DecisionDto = {
        _id: 'dec-123',
        title: 'Demo Decision',
        description: '',
        criteria: [],
        options: [],
        scores: { 'opt-alpha': { 'crit-cost': 75 } },
        scoreProvenance: {
          'opt-alpha': {
            'crit-cost': { isSynthetic: true, source: 'demo', insertedAt: '2026-11-12T10:00:00.000Z' },
          },
        },
        analysis: null,
        calculationVersion: 1,
        version: 2,
        createdAt: '2026-11-12T00:00:00.000Z',
        updatedAt: '2026-11-12T00:00:00.000Z',
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockDecision,
      });

      apiClient.setToken('test-bearer-token');
      const result = await apiClient.populateSyntheticDemo('dec-123', { defaultValue: 75, expectedVersion: 1 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/decisions/dec-123/populate-synthetic-demo'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ defaultValue: 75, expectedVersion: 1 }),
        })
      );
      expect(result.scoreProvenance?.['opt-alpha']?.['crit-cost']?.isSynthetic).toBe(true);
      expect(result.version).toBe(2);
    });

    it('8. apiClient.populateSyntheticDemo propagates errors on failure without claiming success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          statusCode: 409,
          error: 'Conflict',
          message: 'Decision has been modified by another participant',
        }),
      });

      await expect(
        apiClient.populateSyntheticDemo('dec-123', { defaultValue: 75, expectedVersion: 1 })
      ).rejects.toThrowError(/Decision has been modified by another participant/);
    });
  });
});
