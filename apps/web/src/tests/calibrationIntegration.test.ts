import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DecisionApiClient, ApiClientError } from '../api/client';
import type {
  DecisionCalibrationDto,
  PredictionDto,
} from '../api/types';

describe('Expert Calibration Frontend API Client', () => {
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
    await expect(client.getDecisionCalibration('')).rejects.toThrow(ApiClientError);
    await expect(client.getDecisionPredictions('')).rejects.toThrow(ApiClientError);
    await expect(
      client.createPrediction('', {
        statement: 'test',
        probability: 0.8,
        targetDate: new Date().toISOString(),
      })
    ).rejects.toThrow(ApiClientError);
    await expect(
      client.recordPredictionOutcome('', 'p1', {
        observedOutcome: 1,
        outcomeDate: new Date().toISOString(),
        verificationSource: 'test',
      })
    ).rejects.toThrow(ApiClientError);
    await expect(
      client.disputePredictionOutcome('', 'p1', { disputeReason: 'test' })
    ).rejects.toThrow(ApiClientError);
  });

  it('fetches decision calibration metrics and parses separated dimensions', async () => {
    const mockCalibrationDto: DecisionCalibrationDto = {
      decisionId: '507f1f77bcf86cd799439011',
      methodologyVersion: '1.0.0',
      calculatedAt: '2026-10-31T20:00:00.000Z',
      totalPredictions: 4,
      verifiedCount: 4,
      awaitingOutcomeCount: 0,
      disputedCount: 0,
      hasSufficientSample: true,
      minimumSampleThreshold: 3,
      brierScore: 0.125,
      climatologyBss: 0.333,
      expectedCalibrationError: 0.1125,
      calibrationBins: [
        {
          binIndex: 0,
          range: '[0.0, 0.2)',
          count: 1,
          meanPredictedProbability: 0.1,
          observedFrequency: 0,
          calibrationError: 0.1,
        },
        {
          binIndex: 4,
          range: '[0.8, 1.0]',
          count: 3,
          meanPredictedProbability: 0.85,
          observedFrequency: 1.0,
          calibrationError: 0.15,
        },
      ],
      domainBreakdown: [
        { domain: 'engineering', count: 3, brierScore: 0.05, expectedCalibrationError: 0.05 },
      ],
      summary: 'Evaluated across 4 verified prospective predictions.',
      eligibleCount: 4,
      excludedCount: 0,
      expertProfiles: [
        {
          contributorId: 'u1',
          contributorName: 'Expert Alice',
          calibration: {
            hasSufficientSample: true,
            eligibleCount: 4,
            brierScore: 0.125,
            expectedCalibrationError: 0.1125,
            climatologyBss: 0.333,
          },
          domainBreakdown: [
            { domain: 'engineering', count: 3, brierScore: 0.05, expectedCalibrationError: 0.05 },
          ],
          experience: {
            totalContributions: 2,
            totalPredictions: 4,
            verifiedPredictions: 4,
            awaitingOutcome: 0,
          },
          evidenceQuality: {
            citationsProvided: 5,
            verifiedReferences: 4,
          },
          recency: {
            lastPredictionAt: '2026-10-15T00:00:00.000Z',
            lastOutcomeAt: '2026-10-30T00:00:00.000Z',
          },
          popularity: {
            label: 'Social consensus signal (display-only, not an accuracy or calibration metric)',
            preferredOptionAgreementRate: 0.75,
          },
        },
      ],
      formulaDocumentation: {
        brierScore: 'BS = (1/N) * sum((p_i - o_i)^2)',
        ece: 'ECE = sum((N_b / N) * |p_bar_b - o_bar_b|)',
        bss: 'BSS = 1 - (BS / BS_ref)',
      },
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockCalibrationDto), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      })
    );

    const result = await client.getDecisionCalibration('507f1f77bcf86cd799439011');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/decisions/507f1f77bcf86cd799439011/calibration'),
      expect.objectContaining({ method: 'GET' })
    );

    expect(result.brierScore).toBe(0.125);
    expect(result.hasSufficientSample).toBe(true);
    expect(result.calibrationBins.length).toBe(2);
    expect(result.expertProfiles[0].popularity.label).toContain('Social consensus signal');
    expect(result.formulaDocumentation.brierScore).toBeDefined();
  });

  it('submits a prospective prediction via POST', async () => {
    const mockPredDto: PredictionDto = {
      id: '507f1f77bcf86cd799439099',
      decisionId: '507f1f77bcf86cd799439011',
      contributorId: 'u1',
      contributorName: 'Alice',
      predictionId: 'pred_perf',
      statement: 'p99 latency < 20ms',
      probability: 0.85,
      domain: 'engineering',
      targetDate: '2026-12-01T00:00:00.000Z',
      evidenceReferences: ['https://benchmark.local'],
      status: 'awaiting_outcome',
      submittedAt: '2026-10-31T00:00:00.000Z',
      createdAt: '2026-10-31T00:00:00.000Z',
      updatedAt: '2026-10-31T00:00:00.000Z',
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockPredDto), {
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
      })
    );

    const result = await client.createPrediction('507f1f77bcf86cd799439011', {
      statement: 'p99 latency < 20ms',
      probability: 0.85,
      domain: 'engineering',
      targetDate: '2026-12-01T00:00:00.000Z',
      evidenceReferences: ['https://benchmark.local'],
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/decisions/507f1f77bcf86cd799439011/predictions'),
      expect.objectContaining({ method: 'POST' })
    );

    expect(result.predictionId).toBe('pred_perf');
    expect(result.status).toBe('awaiting_outcome');
  });

  it('records verified outcome via POST', async () => {
    const mockOutcomePredDto: PredictionDto = {
      id: '507f1f77bcf86cd799439099',
      decisionId: '507f1f77bcf86cd799439011',
      contributorId: 'u1',
      contributorName: 'Alice',
      predictionId: 'pred_perf',
      statement: 'p99 latency < 20ms',
      probability: 0.85,
      domain: 'engineering',
      targetDate: '2026-12-01T00:00:00.000Z',
      evidenceReferences: [],
      status: 'verified',
      submittedAt: '2026-10-31T00:00:00.000Z',
      outcome: {
        outcomeId: 'outc_1',
        observedOutcome: 1,
        verificationStatus: 'verified',
        verificationSource: 'Grafana load dashboard',
        outcomeDate: '2026-12-02T00:00:00.000Z',
        verifiedByName: 'Owner Alice',
      },
      createdAt: '2026-10-31T00:00:00.000Z',
      updatedAt: '2026-12-02T00:00:00.000Z',
    };

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(mockOutcomePredDto), {
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
      })
    );

    const result = await client.recordPredictionOutcome(
      '507f1f77bcf86cd799439011',
      'pred_perf',
      {
        observedOutcome: 1,
        outcomeDate: '2026-12-02T00:00:00.000Z',
        verificationSource: 'Grafana load dashboard',
        verificationStatus: 'verified',
      }
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/decisions/507f1f77bcf86cd799439011/predictions/pred_perf/outcome'),
      expect.objectContaining({ method: 'POST' })
    );

    expect(result.status).toBe('verified');
    expect(result.outcome?.observedOutcome).toBe(1);
  });

  it('handles server errors with structured ApiClientError', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          statusCode: 404,
          error: 'Not Found',
          message: 'Prediction not found',
        }),
        {
          status: 404,
          headers: new Headers({ 'content-type': 'application/json' }),
        }
      )
    );

    await expect(
      client.disputePredictionOutcome('507f1f77bcf86cd799439011', 'bad_id', {
        disputeReason: 'reason',
      })
    ).rejects.toThrow('Prediction not found');
  });
});

