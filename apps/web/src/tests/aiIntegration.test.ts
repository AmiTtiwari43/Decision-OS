import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DecisionApiClient } from '../api/client.js';
import type {
  AiAnalystResponseDto,
  ApplyProposalPayload,
  DecisionDto,
} from '../api/types.js';

describe('Decision OS — Frontend AI Analyst Integration Tests', () => {
  const originalFetch = globalThis.fetch;
  let client: DecisionApiClient;

  const decisionId = '654321654321654321654321';

  beforeEach(() => {
    client = new DecisionApiClient({ baseUrl: 'http://localhost:3000' });
    client.setToken('valid-jwt-token-ai');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('1. executes AI analysis request and parses structured advisory output', async () => {
    const mockResponse: AiAnalystResponseDto = {
      decisionId,
      analysisType: 'all',
      generatedAt: '2026-10-30T00:00:00.000Z',
      provider: 'mock',
      model: 'decision-analyst-mock-v1',
      isAiGenerated: true,
      disclaimer: 'Advisory analysis only.',
      output: {
        executiveSummary: 'Executive summary explaining AWS vs GCP trade-offs.',
        tradeoffAnalysis: {
          winnerObservation: 'AWS leads in overall weighted utility.',
          keyTradeoffs: ['Performance vs Cost trade-offs'],
          sensitivityNotes: ['Moderate tipping points'],
        },
        evidenceGaps: [
          {
            targetType: 'option',
            targetId: 'gcp',
            targetName: 'Google Cloud Platform',
            gapDescription: 'Lacks latency benchmark evidence',
            recommendation: 'Attach third-party benchmark',
          },
        ],
        expertSummary: {
          totalContributionsAnalyzed: 1,
          consensusAreas: ['Both options are viable'],
          divergenceAreas: ['Cost scaling under heavy load'],
          keyInsights: ['Expert consensus favors AWS stability'],
        },
        assumptions: ['Assumes static workload demands'],
        followUpQuestions: ['Are multi-region failover requirements defined?'],
        suggestedCriteria: [
          {
            id: 'security',
            name: 'Security Compliance',
            description: 'FedRAMP and SOC2 Type II certifications',
            suggestedWeight: 20,
            direction: 'benefit',
            rationale: 'Crucial for enterprise compliance',
          },
        ],
      },
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockResponse,
    });

    const res = await client.runAiAnalysis(decisionId, 'all');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(res.decisionId).toBe(decisionId);
    expect(res.isAiGenerated).toBe(true);
    expect(res.output.executiveSummary).toContain('AWS vs GCP');
    expect(res.output.suggestedCriteria).toHaveLength(1);
    expect(res.output.suggestedCriteria[0].id).toBe('security');
  });

  it('2. explicitly applies an advisory criterion proposal to a decision', async () => {
    const payload: ApplyProposalPayload = {
      type: 'add_criterion',
      criterion: {
        id: 'compliance',
        name: 'Regulatory Compliance',
        weight: 15,
        direction: 'benefit',
      },
    };

    const mockUpdatedDecision: DecisionDto = {
      _id: decisionId,
      title: 'Cloud Migration',
      description: 'Evaluate compute options',
      criteria: [
        { id: 'cost', name: 'Cost', weight: 40, direction: 'benefit' },
        { id: 'compliance', name: 'Regulatory Compliance', weight: 15, direction: 'benefit' },
      ],
      options: [{ id: 'aws', name: 'AWS' }],
      scores: { aws: { cost: 80 } },
      analysis: null,
      calculationVersion: 2,
      createdAt: '2026-10-30T00:00:00.000Z',
      updatedAt: '2026-10-30T00:01:00.000Z',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockUpdatedDecision,
    });

    const updated = await client.applyAiProposal(decisionId, payload);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const callArgs = (globalThis.fetch as any).mock.calls[0];
    expect(callArgs[0]).toContain(`/api/decisions/${decisionId}/ai/proposals/apply`);
    expect(callArgs[1].method).toBe('POST');
    expect(updated.criteria.some(c => c.id === 'compliance')).toBe(true);
    expect(updated.analysis).toBeNull();
  });

  it('3. handles provider service unavailable (503) error cleanly', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'The AI Analyst service is currently offline.',
      }),
    });

    await expect(client.runAiAnalysis(decisionId)).rejects.toThrow(/AI Analyst service is currently offline/);
  });

  it('4. handles provider timeout (504) error cleanly', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 504,
      statusText: 'Gateway Timeout',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        statusCode: 504,
        error: 'Gateway Timeout',
        message: 'The AI Analyst request timed out.',
      }),
    });

    await expect(client.runAiAnalysis(decisionId)).rejects.toThrow(/timed out/);
  });

  it('5. handles validation error (400) on duplicate proposal adoption', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        statusCode: 400,
        error: 'Bad Request',
        message: "A criterion with id 'cost' already exists in this decision.",
      }),
    });

    await expect(
      client.applyAiProposal(decisionId, {
        type: 'add_criterion',
        criterion: { id: 'cost', name: 'Cost', weight: 20 },
      })
    ).rejects.toThrow(/already exists/);
  });
});

