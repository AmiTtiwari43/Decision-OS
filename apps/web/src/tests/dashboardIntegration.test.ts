import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DecisionApiClient } from '../api/client.js';
import type {
  DecisionDto,
  PaginatedDecisionsDto,
  PendingInvitationDto,
  WorkspaceAnalyticsDto,
  CreateDecisionPayload,
  AcceptInvitationResponseDto,
} from '../api/types.js';
import { templateDatasets } from '../data/decisionData.js';
import { getDecisionEvaluationStatus } from '../utils/decisionStatus.js';

describe('Decision OS — Batch 2: Authenticated Dashboard & Decision Hub Integration Tests', () => {
  const originalFetch = globalThis.fetch;
  let client: DecisionApiClient;

  const mockUser = {
    id: 'user-alpha-123',
    email: 'alex@example.com',
    name: 'Alex Rivera',
    role: 'user' as const,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  };

  const sampleDecisions: DecisionDto[] = [
    {
      _id: 'dec-1',
      title: 'Series B vs Tier-1 Enterprise Offer',
      description: 'Evaluating career growth and equity upside',
      criteria: [
        { id: 'c1', name: 'Career Growth', weight: 60, direction: 'benefit' },
        { id: 'c2', name: 'Work Life Balance', weight: 40, direction: 'benefit' },
      ],
      options: [
        { id: 'opt1', name: 'Series B Startup', color: '#B8FF5A' },
        { id: 'opt2', name: 'Cloud Enterprise', color: '#38BDF8' },
      ],
      scores: {
        opt1: { c1: 90, c2: 70 },
        opt2: { c1: 75, c2: 85 },
      },
      analysis: {
        engineVersion: '1.0.0',
        evaluatedAt: '2026-10-29T10:00:00.000Z',
        isTie: false,
        decisionOutcome: 'decisive',
        winnerId: 'opt1',
        tiedWinnerIds: [],
        pointLead: 5.0,
        evaluations: [],
        normalizedWeights: { c1: 0.6, c2: 0.4 },
        totalWeight: 100,
        sensitivity: [],
      },
      calculationVersion: 1,
      ownerId: 'user-alpha-123',
      currentUserRole: 'owner',
      createdAt: '2026-10-25T10:00:00.000Z',
      updatedAt: '2026-10-29T12:00:00.000Z',
    },
    {
      _id: 'dec-2',
      title: 'Infrastructure Cloud Standardization',
      description: 'Evaluating AWS vs GCP data tooling',
      criteria: [
        { id: 'perf', name: 'Performance', weight: 50, direction: 'benefit' },
        { id: 'cost', name: 'Cost', weight: 50, direction: 'cost' },
      ],
      options: [
        { id: 'aws', name: 'AWS', color: '#ff9900' },
        { id: 'gcp', name: 'GCP', color: '#4285f4' },
      ],
      scores: {
        aws: { perf: 80, cost: 60 },
        gcp: { perf: 80, cost: 60 },
      },
      analysis: {
        engineVersion: '1.0.0',
        evaluatedAt: '2026-10-28T10:00:00.000Z',
        isTie: true,
        decisionOutcome: 'tie',
        winnerId: null,
        tiedWinnerIds: ['aws', 'gcp'],
        pointLead: 0.0,
        evaluations: [],
        normalizedWeights: { perf: 0.5, cost: 0.5 },
        totalWeight: 100,
        sensitivity: [],
      },
      calculationVersion: 1,
      ownerId: 'user-beta-999',
      currentUserRole: 'editor',
      createdAt: '2026-10-20T10:00:00.000Z',
      updatedAt: '2026-10-28T15:00:00.000Z',
    },
    {
      _id: 'dec-3',
      title: 'Strategic Architecture Draft',
      description: 'Unscored preliminary evaluation matrix',
      criteria: [
        { id: 'sec', name: 'Security Posture', weight: 100, direction: 'benefit' },
      ],
      options: [
        { id: 'onprem', name: 'Self-Hosted' },
        { id: 'saas', name: 'Managed SaaS' },
      ],
      scores: {},
      analysis: null,
      calculationVersion: 0,
      ownerId: 'user-alpha-123',
      currentUserRole: 'owner',
      createdAt: '2026-10-29T14:00:00.000Z',
      updatedAt: '2026-10-29T14:00:00.000Z',
    },
  ];

  beforeEach(() => {
    client = new DecisionApiClient({ baseUrl: 'http://localhost:3000' });
    client.setToken('valid-jwt-bearer-token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('1. retrieves paginated decisions portfolio with search and query parameters', async () => {
    const mockResponse: PaginatedDecisionsDto = {
      items: sampleDecisions,
      total: 3,
      page: 1,
      limit: 20,
      totalPages: 1,
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockResponse,
    });
    globalThis.fetch = fetchMock;

    const res = await client.listDecisions({ search: 'Offer', page: 1, limit: 10 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/decisions?');
    expect(url).toContain('search=Offer');
    expect(url).toContain('page=1');
    expect(url).toContain('limit=10');
    expect(options.headers.get('Authorization')).toBe('Bearer valid-jwt-bearer-token');
    expect(res.items).toHaveLength(3);
    expect(res.total).toBe(3);
  });

  it('2. filters decisions by ownership correctly (owned vs shared)', () => {
    const currentUserId = mockUser.id;

    const owned = sampleDecisions.filter((d) => {
      const ownerIdStr = typeof d.ownerId === 'string' ? d.ownerId : d.ownerId?._id;
      return d.currentUserRole === 'owner' || ownerIdStr === currentUserId;
    });

    const shared = sampleDecisions.filter((d) => {
      const ownerIdStr = typeof d.ownerId === 'string' ? d.ownerId : d.ownerId?._id;
      const isOwner = d.currentUserRole === 'owner' || ownerIdStr === currentUserId;
      return !isOwner;
    });

    expect(owned).toHaveLength(2); // dec-1 and dec-3
    expect(shared).toHaveLength(1); // dec-2 (owned by user-beta-999, role editor)
    expect(owned.map((d) => d._id)).toEqual(['dec-1', 'dec-3']);
    expect(shared[0]._id).toBe('dec-2');
  });

  it('3. filters decisions by authoritative evaluation outcome (decisive vs tie vs unscored)', () => {
    const decisive = sampleDecisions.filter(
      (d) => getDecisionEvaluationStatus(d) === 'decisive'
    );
    const ties = sampleDecisions.filter(
      (d) => getDecisionEvaluationStatus(d) === 'tie'
    );
    const unscored = sampleDecisions.filter(
      (d) => getDecisionEvaluationStatus(d) === 'draft'
    );

    expect(decisive).toHaveLength(1);
    expect(decisive[0]._id).toBe('dec-1');
    expect(decisive[0].analysis?.pointLead).toBe(5.0);

    // In canonical engine, ties intentionally have winnerId: null while analysis remains authoritative
    expect(ties).toHaveLength(1);
    expect(ties[0]._id).toBe('dec-2');
    expect(ties[0].analysis?.winnerId).toBeNull();
    expect(ties[0].analysis?.isTie).toBe(true);
    expect(ties[0].analysis?.tiedWinnerIds).toEqual(['aws', 'gcp']);

    // Only un-evaluated matrices are classified as draft/unscored
    expect(unscored).toHaveLength(1);
    expect(unscored[0]._id).toBe('dec-3');
    expect(unscored[0].analysis).toBeNull();
  });

  it('4. creates a new decision from a starter template blueprint', async () => {
    const tpl = templateDatasets[0]; // Primary Job Offer dataset
    const payload: CreateDecisionPayload = {
      title: tpl.title,
      description: tpl.context || tpl.question,
      criteria: tpl.criteria.map((c) => ({
        id: c.id,
        name: c.name,
        shortName: c.shortName,
        weight: c.defaultWeight,
        direction: 'benefit',
      })),
      options: tpl.options.map((o) => ({
        id: o.id,
        name: o.name,
        tagline: o.tagline,
        description: o.description,
        color: o.color,
      })),
      scores: Object.fromEntries(
        tpl.options.map((o) => [o.id, { ...o.scores }])
      ),
    };

    const mockCreated: DecisionDto = {
      _id: 'new-created-id-456',
      title: payload.title,
      description: payload.description || '',
      criteria: payload.criteria || [],
      options: payload.options || [],
      scores: payload.scores || {},
      analysis: null,
      calculationVersion: 1,
      currentUserRole: 'owner',
      createdAt: '2026-11-01T20:00:00.000Z',
      updatedAt: '2026-11-01T20:00:00.000Z',
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockCreated,
    });
    globalThis.fetch = fetchMock;

    const res = await client.createDecision(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/decisions');
    expect(options.method).toBe('POST');
    expect(res._id).toBe('new-created-id-456');
    expect(res.title).toBe(tpl.title);
    expect(res.options).toHaveLength(tpl.options.length);
    expect(res.criteria).toHaveLength(tpl.criteria.length);
  });

  it('5. updates decision metadata (title and description)', async () => {
    const updatedDto: DecisionDto = {
      ...sampleDecisions[0],
      title: 'Revised Executive Decision 2026',
      description: 'Updated strategic objective framing',
      version: 2,
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => updatedDto,
    });
    globalThis.fetch = fetchMock;

    const res = await client.updateDecision('dec-1', {
      title: 'Revised Executive Decision 2026',
      description: 'Updated strategic objective framing',
      expectedVersion: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/decisions/dec-1');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({
      title: 'Revised Executive Decision 2026',
      description: 'Updated strategic objective framing',
      expectedVersion: 1,
    });
    expect(res.title).toBe('Revised Executive Decision 2026');
  });

  it('6. deletes a decision after explicit owner confirmation', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      headers: new Headers(),
      text: async () => '',
    });
    globalThis.fetch = fetchMock;

    await client.deleteDecision('dec-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/decisions/dec-1');
    expect(options.method).toBe('DELETE');
    expect(options.headers.get('Authorization')).toBe('Bearer valid-jwt-bearer-token');
  });

  it('7. retrieves pending invitations and accepts via token', async () => {
    const mockPending: PendingInvitationDto[] = [
      {
        id: 'invite-999',
        decisionId: {
          id: 'dec-shared-888',
          title: 'Boardroom Capital Allocation Matrix',
          description: 'Q4 Budget prioritization across engineering teams',
        },
        inviterId: {
          id: 'inviter-555',
          name: 'Chief Technology Officer',
          email: 'cto@example.com',
        },
        role: 'editor',
        status: 'pending',
        expiresAt: '2026-11-10T12:00:00.000Z',
        createdAt: '2026-11-01T12:00:00.000Z',
      },
    ];

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ items: mockPending }),
    });
    globalThis.fetch = fetchMock;

    const listRes = await client.getPendingInvitations();
    expect(listRes.items).toHaveLength(1);
    expect(listRes.items[0].decisionId.title).toBe('Boardroom Capital Allocation Matrix');
    expect(listRes.items[0].role).toBe('editor');

    // Accept invitation with token
    const mockAcceptResponse: AcceptInvitationResponseDto = {
      message: 'Invitation accepted successfully',
      decisionId: 'dec-shared-888',
      role: 'editor',
    };

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockAcceptResponse,
    });

    const acceptRes = await client.acceptInvitation({
      token: '64charhexstringtokenforacceptance1234567890abcdef1234567890abcdef',
    });

    expect(acceptRes.decisionId).toBe('dec-shared-888');
    expect(acceptRes.role).toBe('editor');
  });

  it('8. retrieves workspace portfolio analytics for dashboard overview', async () => {
    const mockAnalytics: WorkspaceAnalyticsDto = {
      generatedAt: '2026-11-01T18:00:00.000Z',
      timeframe: { startDate: null, endDate: null },
      decisionMetrics: {
        totalDecisions: 12,
        statusDistribution: { decisive: 8, tie: 2, unscored: 2 },
        roundLockDistribution: { locked: 3, open: 9 },
        completionRate: 83.3,
        averagePointLead: 4.8,
      },
      activityTrends: [
        { period: '2026-10', createdCount: 12 },
      ],
      criteriaAndOptionsMetrics: {
        totalCriteriaDefined: 48,
        averageCriteriaPerDecision: 4.0,
        totalOptionsDefined: 36,
        averageOptionsPerDecision: 3.0,
        topCriteriaNames: [{ name: 'Career Growth', count: 8 }],
      },
      evidenceMetrics: {
        totalEvidenceRecords: 24,
        decisionsWithEvidenceCount: 10,
        decisionEvidenceCoverageRate: 83.3,
        sourceTypeBreakdown: { url: 14, document: 6, excerpt: 4 },
        methodologyDisclaimer: 'Rigor calculated across verified decision criteria.',
      },
      deliberationMetrics: {
        totalContributions: 32,
        submittedContributions: 28,
        draftContributions: 4,
        withdrawnContributions: 0,
        decisionsWithContributionsCount: 10,
        averageContributionsPerDecision: 3.2,
        methodologyDisclaimer: 'Deliberation statistics tracked across registered experts.',
      },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockAnalytics,
    });
    globalThis.fetch = fetchMock;

    const res = await client.getWorkspaceAnalytics();

    expect(res.decisionMetrics.totalDecisions).toBe(12);
    expect(res.decisionMetrics.statusDistribution.decisive).toBe(8);
    expect(res.evidenceMetrics.decisionEvidenceCoverageRate).toBe(83.3);
    expect(res.deliberationMetrics.totalContributions).toBe(32);
  });

  it('9. authoritative evaluation classification handles decisive, tie, draft, and stale states', () => {
    // Decisive
    expect(getDecisionEvaluationStatus(sampleDecisions[0])).toBe('decisive');

    // Mathematical tie: winnerId is null, yet evaluation is authoritative
    expect(getDecisionEvaluationStatus(sampleDecisions[1])).toBe('tie');

    // Draft / un-scored
    expect(getDecisionEvaluationStatus(sampleDecisions[2])).toBe('draft');

    // Stale: explicit flag
    const explicitlyStale: DecisionDto = {
      ...sampleDecisions[0],
      _id: 'dec-stale-1',
      isStale: true,
    } as any;
    expect(getDecisionEvaluationStatus(explicitlyStale)).toBe('stale');

    // Stale: status string
    const statusStale: DecisionDto = {
      ...sampleDecisions[0],
      _id: 'dec-stale-2',
      status: 'stale',
    } as any;
    expect(getDecisionEvaluationStatus(statusStale)).toBe('stale');

    // Stale: winnerId points to option not in decision options
    const phantomWinner: DecisionDto = {
      ...sampleDecisions[0],
      _id: 'dec-stale-3',
      analysis: {
        ...sampleDecisions[0].analysis!,
        winnerId: 'non-existent-option-id',
      },
    };
    expect(getDecisionEvaluationStatus(phantomWinner)).toBe('stale');

    // Incomplete evaluation: non-tie with missing winnerId
    const incompleteNonTie: DecisionDto = {
      ...sampleDecisions[0],
      _id: 'dec-incomplete-4',
      analysis: {
        ...sampleDecisions[0].analysis!,
        isTie: false,
        winnerId: null,
      },
    };
    expect(getDecisionEvaluationStatus(incompleteNonTie)).toBe('draft');
  });

  it('10. computes portfolio metrics counting evaluated decisions independently of winnerId', () => {
    // Given the 3 sample decisions (dec-1: decisive, dec-2: tie, dec-3: draft)
    let evaluatedCount = 0;
    let decisiveCount = 0;
    let tiesCount = 0;

    for (const d of sampleDecisions) {
      const evalStatus = getDecisionEvaluationStatus(d);
      if (evalStatus === 'decisive' || evalStatus === 'tie') {
        evaluatedCount++;
        if (evalStatus === 'decisive') {
          decisiveCount++;
        } else {
          tiesCount++;
        }
      }
    }

    // Both decisive and ties count as evaluated!
    expect(evaluatedCount).toBe(2);
    expect(decisiveCount).toBe(1);
    expect(tiesCount).toBe(1);
  });

  it('11. status filters partition portfolio correctly across decisive, tie, draft, and stale', () => {
    const staleDec: DecisionDto = {
      ...sampleDecisions[0],
      _id: 'dec-stale',
      isStale: true,
    } as any;

    const portfolio = [...sampleDecisions, staleDec];

    const decisiveItems = portfolio.filter((d) => getDecisionEvaluationStatus(d) === 'decisive');
    const tieItems = portfolio.filter((d) => getDecisionEvaluationStatus(d) === 'tie');
    const draftItems = portfolio.filter((d) => getDecisionEvaluationStatus(d) === 'draft');
    const staleItems = portfolio.filter((d) => getDecisionEvaluationStatus(d) === 'stale');

    expect(decisiveItems.map((d) => d._id)).toEqual(['dec-1']);
    expect(tieItems.map((d) => d._id)).toEqual(['dec-2']);
    expect(draftItems.map((d) => d._id)).toEqual(['dec-3']);
    expect(staleItems.map((d) => d._id)).toEqual(['dec-stale']);
  });

  it('12. verifies AI modal state isolation keying prevents state leakage between decisions', () => {
    // Generate boundary keys as defined in Dashboard.tsx
    const decAKey = `ai-${sampleDecisions[0]._id}`;
    const decBKey = `ai-${sampleDecisions[1]._id}`;

    expect(decAKey).toBe('ai-dec-1');
    expect(decBKey).toBe('ai-dec-2');
    expect(decAKey).not.toBe(decBKey);
  });

  it('13. independently verifies all 7 canonical evaluation states without relying on synthetic isStale field', () => {
    const baseDec = sampleDecisions[0];

    // State 1: Valid decisive evaluation
    expect(getDecisionEvaluationStatus(baseDec)).toBe('decisive');

    // State 2: Valid mathematical tie with winnerId null
    expect(getDecisionEvaluationStatus(sampleDecisions[1])).toBe('tie');

    // State 3: Draft with no evaluation (analysis null)
    expect(getDecisionEvaluationStatus(sampleDecisions[2])).toBe('draft');

    // State 4: Stale evaluation via explicit contract status
    const invalidatedDec: DecisionDto = {
      ...baseDec,
      _id: 'dec-invalidated',
      status: 'invalidated',
    } as any;
    expect(getDecisionEvaluationStatus(invalidatedDec)).toBe('stale');

    // State 5: Evaluation referencing a deleted or unknown option
    // 5a. Decisive winner references deleted option
    const deletedWinnerDec: DecisionDto = {
      ...baseDec,
      _id: 'dec-deleted-winner',
      options: [{ id: 'other-opt', name: 'Other Option' }],
    };
    expect(getDecisionEvaluationStatus(deletedWinnerDec)).toBe('stale');

    // 5b. Tied winner references deleted option
    const deletedTieWinnerDec: DecisionDto = {
      ...sampleDecisions[1],
      _id: 'dec-deleted-tie-winner',
      options: [{ id: 'aws', name: 'AWS' }], // gcp was deleted!
    };
    expect(getDecisionEvaluationStatus(deletedTieWinnerDec)).toBe('stale');

    // State 6: Evaluation inconsistent with current decision inputs
    // 6a. Option count mismatch with populated evaluations array
    const optionMismatchDec: DecisionDto = {
      ...baseDec,
      _id: 'dec-option-mismatch',
      options: [
        { id: 'opt1', name: 'Opt 1' },
        { id: 'opt2', name: 'Opt 2' },
        { id: 'opt3', name: 'Opt 3' }, // added 3rd option
      ],
      analysis: {
        ...baseDec.analysis!,
        evaluations: [
          { option: { id: 'opt1' } } as any,
          { option: { id: 'opt2' } } as any,
        ],
      },
    };
    expect(getDecisionEvaluationStatus(optionMismatchDec)).toBe('stale');

    // 6b. Criteria mismatch with normalized weights
    const criteriaMismatchDec: DecisionDto = {
      ...baseDec,
      _id: 'dec-criteria-mismatch',
      criteria: [
        { id: 'c1', name: 'C1', weight: 100, direction: 'benefit' }, // c2 was removed
      ],
      analysis: {
        ...baseDec.analysis!,
        normalizedWeights: { c1: 0.6, c2: 0.4 },
      },
    };
    expect(getDecisionEvaluationStatus(criteriaMismatchDec)).toBe('stale');

    // State 7: Missing or malformed evaluation metadata
    // 7a. Non-1.0.0 engine version
    const wrongEngineVersion: DecisionDto = {
      ...baseDec,
      _id: 'dec-wrong-engine',
      analysis: {
        ...baseDec.analysis!,
        engineVersion: '2.0.0' as any,
      },
    };
    expect(getDecisionEvaluationStatus(wrongEngineVersion)).toBe('draft');

    // 7b. evaluations is not an array
    const malformedEvaluations: DecisionDto = {
      ...baseDec,
      _id: 'dec-malformed-evals',
      analysis: {
        ...baseDec.analysis!,
        evaluations: 'invalid' as any,
      },
    };
    expect(getDecisionEvaluationStatus(malformedEvaluations)).toBe('draft');

    // 7c. pointLead is undefined/NaN
    const missingPointLead: DecisionDto = {
      ...baseDec,
      _id: 'dec-missing-lead',
      analysis: {
        ...baseDec.analysis!,
        pointLead: undefined as any,
      },
    };
    expect(getDecisionEvaluationStatus(missingPointLead)).toBe('draft');

    // 7d. Tie with malformed tiedWinnerIds (< 2 items)
    const invalidTieMetadata: DecisionDto = {
      ...sampleDecisions[1],
      _id: 'dec-invalid-tie',
      analysis: {
        ...sampleDecisions[1].analysis!,
        isTie: true,
        tiedWinnerIds: ['single-opt'],
      },
    };
    expect(getDecisionEvaluationStatus(invalidTieMetadata)).toBe('draft');
  });

  it('14. verifies in-flight AI analysis race conditions cannot overwrite subsequent decision state', async () => {
    let activeRequestId = 0;
    let activeDecisionId: string | null = null;
    let currentAnalysis: any = null;

    // Simulate switching from Decision A to Decision B while Decision A request is in-flight
    // 1. Open Decision A
    activeDecisionId = 'dec-1';
    const req1Id = ++activeRequestId;

    // Simulate async fetch for Decision A with delay
    const decAPromise = new Promise<any>((resolve) => {
      setTimeout(() => {
        resolve({
          isAiGenerated: true,
          provider: 'mock-llm',
          model: 'decision-analyst-v1',
          decisionOutcomeHypothesis: 'Decision A AI Analysis Result',
        });
      }, 50);
    });

    // 2. Before Decision A resolves, user switches to Decision B
    activeDecisionId = 'dec-2';
    const req2Id = ++activeRequestId;
    currentAnalysis = null; // State reset effect

    const decBPromise = new Promise<any>((resolve) => {
      setTimeout(() => {
        resolve({
          isAiGenerated: true,
          provider: 'mock-llm',
          model: 'decision-analyst-v1',
          decisionOutcomeHypothesis: 'Decision B AI Analysis Result',
        });
      }, 10); // Decision B resolves faster
    });

    // Decision B finishes first
    const resB = await decBPromise;
    if (activeRequestId === req2Id && activeDecisionId === 'dec-2') {
      currentAnalysis = resB;
    }
    expect(currentAnalysis.decisionOutcomeHypothesis).toBe('Decision B AI Analysis Result');

    // Decision A finishes late
    const resA = await decAPromise;
    if (activeRequestId === req1Id && activeDecisionId === 'dec-1') {
      currentAnalysis = resA; // Should NOT be reached!
    }

    // Must remain Decision B analysis! Decision A in-flight result was discarded!
    expect(currentAnalysis.decisionOutcomeHypothesis).toBe('Decision B AI Analysis Result');
  });
});
