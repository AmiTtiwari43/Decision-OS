import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DecisionApiClient, ApiClientError } from '../api/client';
import type {
  DecisionDisagreementsDto,
  DisagreementResolutionDto,
  AiDisagreementExplanationDto,
} from '../api/types';

describe('Disagreement Intelligence Frontend API Client', () => {
  const originalFetch = globalThis.fetch;
  let client: DecisionApiClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    client = new DecisionApiClient({ baseUrl: 'http://localhost:3000' });
    client.setToken('valid-test-token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('validates decision ID presence before making network requests', async () => {
    await expect(client.getDecisionDisagreements('')).rejects.toThrow(ApiClientError);
    await expect(client.updateDisagreementResolution('', 'disag_1', { status: 'acknowledged' })).rejects.toThrow(
      ApiClientError
    );
    await expect(client.explainDisagreementWithAi('', 'disag_1')).rejects.toThrow(ApiClientError);
  });

  it('fetches decision disagreements and parses response correctly', async () => {
    const mockResponse: DecisionDisagreementsDto = {
      decisionId: '507f1f77bcf86cd799439011',
      hasSufficientData: true,
      totalContributors: 2,
      totalDisagreements: 2,
      decisionCriticalCount: 1,
      items: [
        {
          id: 'disag_score_crit_growth',
          category: 'score',
          title: "Score Disagreement on 'Growth'",
          criterionId: 'crit_growth',
          criterionName: 'Growth',
          isDecisionCritical: true,
          scoreMetrics: {
            criterionId: 'crit_growth',
            criterionName: 'Growth',
            weight: 50,
            sampleCount: 2,
            minScore: 60,
            maxScore: 90,
            scoreRange: 30,
            meanScore: 75,
            sampleStdDev: 21.2,
            medianScore: 75,
            confidenceWeightedMean: 76.5,
            isDecisionCritical: true,
            tippingDeltaThreshold: 10,
            criticalReason: 'Score range (30 pts) exceeds tipping threshold (10 pts)',
            scenarioResults: {
              minScenarioWinnerId: 'opt_beta',
              minScenarioWinnerFlips: true,
              medianScenarioWinnerId: 'opt_alpha',
              medianScenarioWinnerFlips: false,
              maxScenarioWinnerId: 'opt_alpha',
              maxScenarioWinnerFlips: false,
            },
          },
          description: "Experts differ by 30 points on criterion 'Growth'.",
          numericalExplanation: 'Spread of 30 pts (min: 60, max: 90, stdDev: 21.2) across 2 expert evaluations.',
          participants: [
            { contributorId: 'u1', contributorName: 'Alice', value: 90, confidence: 0.9 },
            { contributorId: 'u2', contributorName: 'Bob', value: 60, confidence: 0.8 },
          ],
          suggestedClarificationQuestions: ['What benchmarks justify the score spread?'],
          resolution: { status: 'open' },
        },
      ],
      criteriaMetrics: [],
      priorityBreakdown: [
        { optionId: 'opt_alpha', optionName: 'Option Alpha', recommendationCount: 1, percentage: 50 },
        { optionId: 'opt_beta', optionName: 'Option Beta', recommendationCount: 1, percentage: 50 },
      ],
      summary: 'Detected 2 disagreements across 2 participants (1 decision-critical).',
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      })
    );

    const result = await client.getDecisionDisagreements('507f1f77bcf86cd799439011');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/decisions/507f1f77bcf86cd799439011/disagreements'),
      expect.objectContaining({ method: 'GET' })
    );

    expect(result.hasSufficientData).toBe(true);
    expect(result.decisionCriticalCount).toBe(1);
    expect(result.items.length).toBe(1);
    expect(result.items[0].isDecisionCritical).toBe(true);
    expect(result.items[0].scoreMetrics?.scoreRange).toBe(30);
  });

  it('updates disagreement resolution status via PATCH', async () => {
    const mockResDto: DisagreementResolutionDto = {
      status: 'resolved',
      explanation: 'Consensus reached after reviewing benchmark data.',
      resolvedByName: 'Lead Architect',
      resolvedAt: '2026-10-31T20:00:00.000Z',
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockResDto), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      })
    );

    const result = await client.updateDisagreementResolution(
      '507f1f77bcf86cd799439011',
      'disag_score_crit_growth',
      {
        status: 'resolved',
        resolutionExplanation: 'Consensus reached after reviewing benchmark data.',
      }
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/decisions/507f1f77bcf86cd799439011/disagreements/disag_score_crit_growth/resolution'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          status: 'resolved',
          resolutionExplanation: 'Consensus reached after reviewing benchmark data.',
        }),
      })
    );

    expect(result.status).toBe('resolved');
    expect(result.resolvedByName).toBe('Lead Architect');
  });

  it('requests AI disagreement explanation via POST', async () => {
    const mockAiDto: AiDisagreementExplanationDto = {
      disagreementId: 'disag_score_crit_growth',
      neutralSummary: 'Participants hold differing expectations regarding scalability timeline.',
      underlyingAssumptions: ['Assumes immediate enterprise adoption vs phased pilot rollout.'],
      suggestedClarificationQuestions: ['What rollout timeline is realistically anticipated?'],
      disclaimer: 'AI explanations are advisory synthesis tools designed for mediation.',
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockAiDto), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      })
    );

    const result = await client.explainDisagreementWithAi(
      '507f1f77bcf86cd799439011',
      'disag_score_crit_growth'
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/decisions/507f1f77bcf86cd799439011/disagreements/disag_score_crit_growth/ai-explain'),
      expect.objectContaining({ method: 'POST' })
    );

    expect(result.disagreementId).toBe('disag_score_crit_growth');
    expect(result.underlyingAssumptions.length).toBe(1);
    expect(result.disclaimer).toContain('advisory synthesis tools');
  });

  it('handles server errors with structured ApiClientError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          statusCode: 404,
          error: 'Not Found',
          message: 'Decision not found',
        }),
        {
          status: 404,
          headers: new Headers({ 'content-type': 'application/json' }),
        }
      )
    );

    await expect(client.getDecisionDisagreements('507f1f77bcf86cd799439099')).rejects.toThrow(
      'Decision not found'
    );
  });

  it('correctly parses insufficient data state when fewer than 2 contributions exist', async () => {
    const mockInsufficientDto: DecisionDisagreementsDto = {
      decisionId: '507f1f77bcf86cd799439011',
      hasSufficientData: false,
      totalContributors: 1,
      totalDisagreements: 0,
      decisionCriticalCount: 0,
      items: [],
      criteriaMetrics: [],
      priorityBreakdown: [],
      summary: 'Single expert contribution submitted. At least 2 submitted contributions are required.',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockInsufficientDto), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      })
    );

    const result = await client.getDecisionDisagreements('507f1f77bcf86cd799439011');
    expect(result.hasSufficientData).toBe(false);
    expect(result.totalContributors).toBe(1);
    expect(result.items.length).toBe(0);
    expect(result.summary).toContain('At least 2 submitted contributions are required');
  });

  it('correctly parses full consensus state (0 disagreements with sufficient contributors)', async () => {
    const mockConsensusDto: DecisionDisagreementsDto = {
      decisionId: '507f1f77bcf86cd799439011',
      hasSufficientData: true,
      totalContributors: 3,
      totalDisagreements: 0,
      decisionCriticalCount: 0,
      items: [],
      criteriaMetrics: [],
      priorityBreakdown: [
        { optionId: 'opt_alpha', optionName: 'Option Alpha', recommendationCount: 3, percentage: 100 },
      ],
      summary: 'Detected 0 disagreements across 3 participants (0 decision-critical).',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockConsensusDto), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      })
    );

    const result = await client.getDecisionDisagreements('507f1f77bcf86cd799439011');
    expect(result.hasSufficientData).toBe(true);
    expect(result.totalContributors).toBe(3);
    expect(result.totalDisagreements).toBe(0);
    expect(result.items.length).toBe(0);
  });
});
