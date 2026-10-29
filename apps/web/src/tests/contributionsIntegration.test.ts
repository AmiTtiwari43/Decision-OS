import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DecisionApiClient } from '../api/client.js';
import type {
  DecisionContributionDto,
  DecisionDto,
  SaveContributionPayload,
} from '../api/types.js';

describe('Decision OS — Frontend Expert Contributions Integration Tests', () => {
  const originalFetch = globalThis.fetch;
  let client: DecisionApiClient;

  const decisionId = '654321654321654321654321';
  const contributionId = 'contrib123456789012345678';

  beforeEach(() => {
    client = new DecisionApiClient({ baseUrl: 'http://localhost:3000' });
    client.setToken('valid-jwt-token-expert');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('1. lists contributions for a decision', async () => {
    const mockContributions: DecisionContributionDto[] = [
      {
        id: contributionId,
        decisionId,
        contributorId: {
          id: 'user-expert-1',
          name: 'Expert Beta',
          email: 'expert@example.com',
        },
        recommendation: {
          preferredOptionId: 'aws',
          rationale: 'Mature ecosystem with multi-region replication',
        },
        criterionScores: { cost: 80, perf: 95 },
        criterionReasoning: { cost: 'Good reserved pricing', perf: 'Fast NVMe instances' },
        confidence: 0.9,
        status: 'submitted',
        revision: 1,
        history: [],
        submittedAt: '2026-10-29T12:00:00.000Z',
        withdrawnAt: null,
        createdAt: '2026-10-29T11:00:00.000Z',
        updatedAt: '2026-10-29T12:00:00.000Z',
      },
    ];

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ items: mockContributions }),
    });
    globalThis.fetch = fetchMock;

    const res = await client.listContributions(decisionId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://localhost:3000/api/decisions/${decisionId}/contributions`);
    expect(options.method).toBe('GET');
    expect(options.headers.get('Authorization')).toBe('Bearer valid-jwt-token-expert');
    expect(res.items.length).toBe(1);
    expect(res.items[0].recommendation.preferredOptionId).toBe('aws');
  });

  it('2. retrieves the authenticated user contribution (mine)', async () => {
    const mockMine: DecisionContributionDto = {
      id: contributionId,
      decisionId,
      contributorId: 'user-expert-1',
      recommendation: {
        preferredOptionId: 'gcp',
        rationale: 'BigQuery and Kubernetes engine superiority',
      },
      criterionScores: { cost: 85, perf: 90 },
      criterionReasoning: {},
      confidence: 0.85,
      status: 'draft',
      revision: 1,
      history: [],
      submittedAt: null,
      withdrawnAt: null,
      createdAt: '2026-10-29T11:00:00.000Z',
      updatedAt: '2026-10-29T11:00:00.000Z',
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ item: mockMine }),
    });
    globalThis.fetch = fetchMock;

    const res = await client.getMineContribution(decisionId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://localhost:3000/api/decisions/${decisionId}/contributions/mine`);
    expect(options.method).toBe('GET');
    expect(res.item?.recommendation.preferredOptionId).toBe('gcp');
    expect(res.item?.status).toBe('draft');
  });

  it('3. saves a draft contribution with payload formatting', async () => {
    const payload: SaveContributionPayload = {
      preferredOptionId: 'aws',
      rationale: 'Superior developer tooling',
      confidence: 0.8,
      criterionScores: { cost: 75, perf: 90 },
      criterionReasoning: { cost: 'Reasonable', perf: 'High' },
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: contributionId,
        decisionId,
        status: 'draft',
        recommendation: { preferredOptionId: 'aws', rationale: payload.rationale },
      }),
    });
    globalThis.fetch = fetchMock;

    const res = await client.saveContribution(decisionId, payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://localhost:3000/api/decisions/${decisionId}/contributions`);
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual(payload);
    expect(res.status).toBe('draft');
  });

  it('4. submits a contribution', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: contributionId,
        decisionId,
        status: 'submitted',
        revision: 1,
      }),
    });
    globalThis.fetch = fetchMock;

    const res = await client.submitContribution(decisionId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://localhost:3000/api/decisions/${decisionId}/contributions/submit`);
    expect(options.method).toBe('POST');
    expect(res.status).toBe('submitted');
  });

  it('5. withdraws a contribution', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: contributionId,
        decisionId,
        status: 'withdrawn',
      }),
    });
    globalThis.fetch = fetchMock;

    const res = await client.withdrawContribution(decisionId);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://localhost:3000/api/decisions/${decisionId}/contributions/withdraw`);
    expect(options.method).toBe('POST');
    expect(res.status).toBe('withdrawn');
  });

  it('6. locks and unlocks the contribution round', async () => {
    const mockDecisionLocked = {
      _id: decisionId,
      title: 'Cloud Decision',
      isContributionRoundLocked: true,
    } as unknown as DecisionDto;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockDecisionLocked,
    });
    globalThis.fetch = fetchMock;

    const locked = await client.lockContributionRound(decisionId);
    expect(locked.isContributionRoundLocked).toBe(true);

    const mockDecisionUnlocked = {
      ...mockDecisionLocked,
      isContributionRoundLocked: false,
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockDecisionUnlocked,
    });

    const unlocked = await client.unlockContributionRound(decisionId);
    expect(unlocked.isContributionRoundLocked).toBe(false);
  });

  it('7. adopts expert scores into the authoritative decision', async () => {
    const mockAdoptedDecision = {
      _id: decisionId,
      title: 'Cloud Decision',
      scores: {
        aws: { cost: 80, perf: 95 },
      },
    } as unknown as DecisionDto;

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockAdoptedDecision,
    });
    globalThis.fetch = fetchMock;

    const updated = await client.adoptExpertScores(decisionId, contributionId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(
      `http://localhost:3000/api/decisions/${decisionId}/contributions/${contributionId}/adopt`
    );
    expect(options.method).toBe('POST');
    expect(updated._id).toBe(decisionId);
  });
});

