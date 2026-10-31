import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DecisionApiClient } from '../api/client.js';
import type {
  DecisionAnalyticsDto,
  WorkspaceAnalyticsDto,
} from '../api/types.js';

describe('Decision OS — Frontend Analytics Integration Tests', () => {
  const originalFetch = globalThis.fetch;
  let client: DecisionApiClient;

  const decisionId = '654321654321654321654321';

  beforeEach(() => {
    client = new DecisionApiClient({ baseUrl: 'http://localhost:3000' });
    client.setToken('valid-jwt-token-analytics');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('1. executes decision analytics request with Monte Carlo parameters and parses structured response', async () => {
    const mockDecisionAnalytics: DecisionAnalyticsDto = {
      decisionId,
      title: 'Cloud Architecture Evaluation',
      description: 'AWS vs GCP comparison',
      evaluatedAt: '2026-10-31T00:00:00.000Z',
      outcome: 'decisive',
      isAuthoritative: true,
      pointLead: 5.5,
      winner: { id: 'gcp', name: 'Google Cloud Platform' },
      runnerUp: { id: 'aws', name: 'Amazon Web Services' },
      criteriaImportance: [
        { id: 'perf', name: 'Performance', weight: 40, isLocked: false, direction: 'benefit', relativeShare: 40 },
        { id: 'cost', name: 'Cost', weight: 35, isLocked: false, direction: 'benefit', relativeShare: 35 },
        { id: 'wlb', name: 'Support', weight: 25, isLocked: true, direction: 'benefit', relativeShare: 25 },
      ],
      optionsPerformance: [
        {
          id: 'gcp',
          name: 'Google Cloud Platform',
          rank: 1,
          weightedScore: 78.5,
          unroundedScore: 78.502,
          contributions: [
            { criterionId: 'perf', criterionName: 'Performance', rawScore: 80, weightedPoints: 32, percentageOfTotal: 40.8 },
          ],
        },
        {
          id: 'aws',
          name: 'Amazon Web Services',
          rank: 2,
          weightedScore: 73.0,
          unroundedScore: 73.001,
          contributions: [
            { criterionId: 'perf', criterionName: 'Performance', rawScore: 70, weightedPoints: 28, percentageOfTotal: 38.4 },
          ],
        },
      ],
      sensitivityAnalysis: {
        analyticalTippingPoints: [
          {
            criterionId: 'perf',
            criterionName: 'Performance',
            currentWeight: 40,
            tippingPointWeight: 52.3,
            weightDeltaNeeded: 12.3,
            direction: 'increase',
            feasibility: 'low-threshold',
            wouldFlipToOptionId: 'aws',
            wouldFlipToOptionName: 'Amazon Web Services',
            summary: 'Shifting Performance to 52.3% flips winner to AWS.',
          },
        ],
        optionScoreSensitivity: [
          {
            criterionId: 'perf',
            criterionName: 'Performance',
            weight: 40,
            scoreDeltaNeeded: 13.75,
            leaderThresholdScore: 66.25,
            challengerThresholdScore: 83.75,
            feasibility: 'feasible',
            summary: 'Tie reached via score shift.',
          },
        ],
        multiParameterCounterfactual: {
          isFeasible: true,
          totalWeightShiftL1: 15.0,
          netShiftAmount: 7.5,
          shifts: [
            { criterionId: 'perf', criterionName: 'Performance', currentWeight: 40, counterfactualWeight: 47.5, delta: 7.5 },
            { criterionId: 'cost', criterionName: 'Cost', currentWeight: 35, counterfactualWeight: 27.5, delta: -7.5 },
          ],
          targetOptionId: 'aws',
          targetOptionName: 'Amazon Web Services',
          summary: 'Smallest counterfactual shift: 7.5% weight relocated inverts winner.',
        },
      },
      uncertaintyAnalysis: {
        hasMonteCarlo: true,
        iterations: 1000,
        seed: 42,
        sigmaRelative: 0.15,
        distributionModel: 'Gaussian Box-Muller on unlocked weights',
        metricInterpretation: 'win probability under the specified uncertainty model',
        robustnessRating: 'robust',
        dominantOptionId: 'gcp',
        dominantWinProbability: 82.4,
        optionResults: [
          { optionId: 'gcp', optionName: 'Google Cloud Platform', winCount: 824, winProbability: 82.4 },
          { optionId: 'aws', optionName: 'Amazon Web Services', winCount: 176, winProbability: 17.6 },
        ],
      },
      evidenceCoverage: {
        totalEvidenceCount: 3,
        byTargetType: { decision: 1, option: 1, criterion: 1, contribution: 0 },
        bySourceType: { url: 2, document: 1, excerpt: 0 },
        optionsCoverage: [
          { optionId: 'gcp', optionName: 'Google Cloud Platform', evidenceCount: 1, hasEvidence: true },
          { optionId: 'aws', optionName: 'Amazon Web Services', evidenceCount: 0, hasEvidence: false },
        ],
        criteriaCoverage: [
          { criterionId: 'perf', criterionName: 'Performance', evidenceCount: 1, hasEvidence: true },
          { criterionId: 'cost', criterionName: 'Cost', evidenceCount: 0, hasEvidence: false },
        ],
        missingEvidenceTargets: {
          options: [{ id: 'aws', name: 'Amazon Web Services' }],
          criteria: [{ id: 'cost', name: 'Cost' }],
        },
        methodologyDisclaimer: 'Evidence quantity does not measure evidence credibility.',
      },
      expertParticipation: {
        totalContributions: 2,
        submittedCount: 2,
        draftCount: 0,
        withdrawnCount: 0,
        isRoundLocked: false,
        roundLockedAt: null,
        recommendationTally: [{ optionId: 'gcp', optionName: 'Google Cloud Platform', count: 2 }],
        scoreSpreadByCriterion: [
          { criterionId: 'perf', criterionName: 'Performance', minScore: 75, maxScore: 85, averageScore: 80, scoreRange: 10 },
        ],
        methodologyDisclaimer: 'Deliberation metrics are descriptive.',
      },
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockDecisionAnalytics,
    } as unknown as Response);

    const result = await client.getDecisionAnalytics(decisionId, {
      includeMonteCarlo: true,
      iterations: 1000,
      seed: 42,
    });

    expect(result.decisionId).toBe(decisionId);
    expect(result.winner?.id).toBe('gcp');
    expect(result.uncertaintyAnalysis.robustnessRating).toBe('robust');
    expect(result.uncertaintyAnalysis.metricInterpretation).toBe('win probability under the specified uncertainty model');
    expect(result.evidenceCoverage.missingEvidenceTargets.options).toHaveLength(1);
    expect(result.evidenceCoverage.missingEvidenceTargets.options[0].id).toBe('aws');
  });

  it('2. validates and rejects empty decisionId in getDecisionAnalytics', async () => {
    await expect(client.getDecisionAnalytics('')).rejects.toThrow('Decision ID is required.');
  });

  it('3. executes workspace portfolio analytics request and handles timeframe queries', async () => {
    const mockWorkspaceAnalytics: WorkspaceAnalyticsDto = {
      generatedAt: '2026-10-31T00:00:00.000Z',
      timeframe: {
        startDate: '2026-10-01T00:00:00.000Z',
        endDate: null,
      },
      decisionMetrics: {
        totalDecisions: 4,
        statusDistribution: { decisive: 3, tie: 1, unscored: 0 },
        roundLockDistribution: { locked: 1, open: 3 },
        completionRate: 100,
        averagePointLead: 6.2,
      },
      activityTrends: [
        { period: '2026-10', createdCount: 4 },
      ],
      criteriaAndOptionsMetrics: {
        totalCriteriaDefined: 16,
        averageCriteriaPerDecision: 4.0,
        totalOptionsDefined: 10,
        averageOptionsPerDecision: 2.5,
        topCriteriaNames: [{ name: 'Performance', count: 3 }],
      },
      evidenceMetrics: {
        totalEvidenceRecords: 8,
        decisionsWithEvidenceCount: 3,
        decisionEvidenceCoverageRate: 75.0,
        sourceTypeBreakdown: { url: 5, document: 2, excerpt: 1 },
        methodologyDisclaimer: 'Evidence quantity does not measure evidence credibility.',
      },
      deliberationMetrics: {
        totalContributions: 6,
        submittedContributions: 5,
        draftContributions: 1,
        withdrawnContributions: 0,
        decisionsWithContributionsCount: 3,
        averageContributionsPerDecision: 1.5,
        methodologyDisclaimer: 'Deliberation metrics are descriptive.',
      },
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockWorkspaceAnalytics,
    } as unknown as Response);

    const result = await client.getWorkspaceAnalytics({
      startDate: '2026-10-01T00:00:00.000Z',
    });

    expect(result.decisionMetrics.totalDecisions).toBe(4);
    expect(result.decisionMetrics.completionRate).toBe(100);
    expect(result.evidenceMetrics.decisionEvidenceCoverageRate).toBe(75.0);
    expect(result.deliberationMetrics.submittedContributions).toBe(5);
  });

  it('4. propagates API 404 error when decision is not found or unauthorized', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        statusCode: 404,
        error: 'Not Found',
        message: 'Decision not found',
      }),
    } as unknown as Response);

    await expect(client.getDecisionAnalytics('nonexistent-id')).rejects.toThrow('Decision not found');
  });

  it('5. propagates 401 Unauthorized when token is omitted or invalid', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authorization token required',
      }),
    } as unknown as Response);

    await expect(client.getWorkspaceAnalytics()).rejects.toThrow('Authorization token required');
  });
});
