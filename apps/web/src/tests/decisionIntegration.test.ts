import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildPayloadFromState,
  reconstructDatasetFromDto,
} from '../hooks/useDecisionModel.js';
import { DecisionApiClient, ApiClientError } from '../api/client.js';
import { mapServerAnalysisToEngineResult } from '../utils/engineMapper.js';
import type { DecisionDataset } from '../types/decision.js';
import type { DecisionDto } from '../api/types.js';
import type { EngineResult as CanonicalEngineResult } from '@decision-os/decision-engine';

describe('Decision OS — Frontend/Backend Phase 4 Integration Tests', () => {
  const originalFetch = globalThis.fetch;
  let client: DecisionApiClient;

  const sampleDataset: DecisionDataset = {
    id: 'test-dataset-id',
    title: 'Cloud Infrastructure Migration',
    question: 'Should we migrate to AWS or GCP?',
    context: 'Evaluating ML and data pipeline capabilities',
    criteria: [
      {
        id: 'perf',
        name: 'Performance',
        shortName: 'Perf',
        description: 'Throughput and latency',
        category: 'growth',
        defaultWeight: 60,
      },
      {
        id: 'cost',
        name: 'Cost Efficiency',
        shortName: 'Cost',
        description: 'Total operational cost',
        category: 'finance',
        defaultWeight: 40,
      },
    ],
    options: [
      {
        id: 'aws',
        name: 'Amazon Web Services',
        tagline: 'Established infra',
        description: '',
        color: '#ff9900',
        accentBorder: 'border-amber-500',
        scores: { perf: 90, cost: 70 },
        strengths: [],
        vulnerabilities: [],
      },
      {
        id: 'gcp',
        name: 'Google Cloud Platform',
        tagline: 'Modern data tooling',
        description: '',
        color: '#4285f4',
        accentBorder: 'border-sky-500',
        scores: { perf: 85, cost: 85 },
        strengths: [],
        vulnerabilities: [],
      },
    ],
    scenarios: [],
  };

  const sampleWeights = { perf: 60, cost: 40 };
  const sampleLockedIds = ['perf'];

  beforeEach(() => {
    client = new DecisionApiClient({ baseUrl: 'http://127.0.0.1:3000' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('1. Payload Construction & Anti-Forgery', () => {
    it('correctly maps frontend state to API request schema', () => {
      const payload = buildPayloadFromState(sampleDataset, sampleWeights, sampleLockedIds);

      expect(payload.title).toBe('Cloud Infrastructure Migration');
      expect(payload.description).toBe('Evaluating ML and data pipeline capabilities');
      expect(payload.criteria).toHaveLength(2);
      expect(payload.criteria?.[0]).toEqual({
        id: 'perf',
        name: 'Performance',
        shortName: 'Perf',
        weight: 60,
        direction: 'benefit',
        isLocked: true,
      });
      expect(payload.criteria?.[1]).toEqual({
        id: 'cost',
        name: 'Cost Efficiency',
        shortName: 'Cost',
        weight: 40,
        direction: 'benefit',
        isLocked: false,
      });
      expect(payload.options).toHaveLength(2);
      expect(payload.scores).toEqual({
        aws: { perf: 90, cost: 70 },
        gcp: { perf: 85, cost: 85 },
      });

      // Confirm no client-computed fields leaked into payload
      const rawPayload = payload as unknown as Record<string, unknown>;
      expect(rawPayload.winner).toBeUndefined();
      expect(rawPayload.winnerId).toBeUndefined();
      expect(rawPayload.analysis).toBeUndefined();
      expect(rawPayload.engineVersion).toBeUndefined();
    });

    it('reconstructs DecisionDataset faithfully from server DecisionDto', () => {
      const mockDto: DecisionDto = {
        _id: '6ae31498c09401aedf991863',
        title: 'Persisted Architecture Matrix',
        description: 'Context from database',
        criteria: [
          { id: 'c1', name: 'Criterion 1', weight: 100, direction: 'benefit', isLocked: false },
        ],
        options: [
          { id: 'o1', name: 'Option 1', tagline: 'Tag', description: 'Desc', color: '#B8FF5A' },
        ],
        scores: {
          o1: { c1: 95 },
        },
        analysis: null,
        calculationVersion: 1,
        createdAt: '2026-10-29T15:00:00.000Z',
        updatedAt: '2026-10-29T15:00:00.000Z',
      };

      const restored = reconstructDatasetFromDto(mockDto);

      expect(restored.id).toBe('6ae31498c09401aedf991863');
      expect(restored.title).toBe('Persisted Architecture Matrix');
      expect(restored.context).toBe('Context from database');
      expect(restored.criteria).toHaveLength(1);
      expect(restored.criteria[0].id).toBe('c1');
      expect(restored.criteria[0].defaultWeight).toBe(100);
      expect(restored.options).toHaveLength(1);
      expect(restored.options[0].id).toBe('o1');
      expect(restored.options[0].scores.c1).toBe(95);
    });
  });

  describe('2. Decision Creation Flow', () => {
    it('creates decision via API, retrieves server ID and authoritative analysis', async () => {
      const serverAnalysis: CanonicalEngineResult = {
        engineVersion: '1.0.0',
        evaluatedAt: '2026-10-29T15:30:00.000Z',
        isTie: false,
        decisionOutcome: 'decisive',
        winnerId: 'gcp',
        tiedWinnerIds: [],
        pointLead: 3.0,
        evaluations: [
          {
            optionId: 'gcp',
            optionName: 'Google Cloud Platform',
            unroundedScore: 85.0,
            weightedScore: 85.0,
            rank: 1,
            presentationOrder: 1,
            scoreDifferenceToLeader: 0,
            contributions: [
              { criterionId: 'perf', rawScore: 85, weight: 60, weightedPoints: 51, percentageOfTotal: 60 },
              { criterionId: 'cost', rawScore: 85, weight: 40, weightedPoints: 34, percentageOfTotal: 40 },
            ],
          },
          {
            optionId: 'aws',
            optionName: 'Amazon Web Services',
            unroundedScore: 82.0,
            weightedScore: 82.0,
            rank: 2,
            presentationOrder: 2,
            scoreDifferenceToLeader: 3.0,
            contributions: [
              { criterionId: 'perf', rawScore: 90, weight: 60, weightedPoints: 54, percentageOfTotal: 65.85 },
              { criterionId: 'cost', rawScore: 70, weight: 40, weightedPoints: 28, percentageOfTotal: 34.15 },
            ],
          },
        ],
        normalizedWeights: { perf: 60.0, cost: 40.0 },
        totalWeight: 100.0,
        sensitivity: [],
      };

      const serverDoc: DecisionDto = {
        _id: '6ae31498c09401aedf991863',
        title: sampleDataset.title,
        description: sampleDataset.context,
        criteria: [
          { id: 'perf', name: 'Performance', weight: 60, direction: 'benefit' },
          { id: 'cost', name: 'Cost', weight: 40, direction: 'benefit' },
        ],
        options: [
          { id: 'aws', name: 'Amazon Web Services' },
          { id: 'gcp', name: 'Google Cloud Platform' },
        ],
        scores: {
          aws: { perf: 90, cost: 70 },
          gcp: { perf: 85, cost: 85 },
        },
        analysis: serverAnalysis,
        calculationVersion: 1,
        createdAt: '2026-10-29T15:30:00.000Z',
        updatedAt: '2026-10-29T15:30:00.000Z',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => serverDoc,
      });

      const payload = buildPayloadFromState(sampleDataset, sampleWeights, sampleLockedIds);
      const result = await client.createDecision(payload);

      expect(result._id).toBe('6ae31498c09401aedf991863');
      expect(result.analysis?.winnerId).toBe('gcp');
      expect(result.analysis?.pointLead).toBe(3.0);

      // Map to UI representation
      const uiResult = mapServerAnalysisToEngineResult(
        result.analysis!,
        sampleDataset.options,
        sampleDataset.criteria
      );

      expect(uiResult.isAuthoritative).toBe(true);
      expect(uiResult.winner.option.id).toBe('gcp');
      expect(uiResult.winner.weightedScore).toBe(85.0);
      expect(uiResult.runnerUp?.option.id).toBe('aws');
      expect(uiResult.runnerUp?.weightedScore).toBe(82.0);
      expect(uiResult.explainability.headline).toContain('Google Cloud Platform fits your current priorities better (+3.0 pts)');
    });
  });

  describe('3. Validation Failure & Input Preservation', () => {
    it('handles server validation failure without destroying client state', async () => {
      const errorResponse = {
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Scores cannot exceed 100',
        requestId: 'trace-422-err',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => errorResponse,
      });

      const invalidPayload = buildPayloadFromState(sampleDataset, sampleWeights, sampleLockedIds);

      await expect(client.createDecision(invalidPayload)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.statusCode).toBe(422);
        expect(apiErr.message).toBe('Scores cannot exceed 100');
        expect(apiErr.requestId).toBe('trace-422-err');
        return true;
      });

      // Confirm user input was not mutated
      expect(invalidPayload.title).toBe('Cloud Infrastructure Migration');
      expect(invalidPayload.scores?.aws?.perf).toBe(90);
    });
  });

  describe('4. Backend Unavailable & No Fake Winner', () => {
    it('surfaces network error and does not fabricate a winner', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      const payload = buildPayloadFromState(sampleDataset, sampleWeights, sampleLockedIds);

      await expect(client.createDecision(payload)).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.isNetworkError).toBe(true);
        expect(apiErr.statusCode).toBe(0);
        return true;
      });
    });
  });

  describe('5. Decision Retrieval by ID', () => {
    it('retrieves persisted decision and renders authoritative calculations', async () => {
      const persistedDoc: DecisionDto = {
        _id: '6ae31498c09401aedf991863',
        title: 'Retrieved Infrastructure Choice',
        description: 'Restored from MongoDB',
        criteria: [
          { id: 'perf', name: 'Performance', weight: 70, direction: 'benefit' },
          { id: 'cost', name: 'Cost', weight: 30, direction: 'benefit' },
        ],
        options: [
          { id: 'aws', name: 'AWS' },
          { id: 'gcp', name: 'GCP' },
        ],
        scores: {
          aws: { perf: 95, cost: 60 },
          gcp: { perf: 80, cost: 90 },
        },
        analysis: {
          engineVersion: '1.0.0',
          evaluatedAt: '2026-10-29T16:00:00.000Z',
          isTie: false,
          decisionOutcome: 'decisive',
          winnerId: 'aws',
          tiedWinnerIds: [],
          pointLead: 1.5,
          evaluations: [
            {
              optionId: 'aws',
              optionName: 'AWS',
              unroundedScore: 84.5,
              weightedScore: 84.5,
              rank: 1,
              presentationOrder: 1,
              scoreDifferenceToLeader: 0,
              contributions: [
                { criterionId: 'perf', rawScore: 95, weight: 70, weightedPoints: 66.5, percentageOfTotal: 78.7 },
                { criterionId: 'cost', rawScore: 60, weight: 30, weightedPoints: 18, percentageOfTotal: 21.3 },
              ],
            },
            {
              optionId: 'gcp',
              optionName: 'GCP',
              unroundedScore: 83.0,
              weightedScore: 83.0,
              rank: 2,
              presentationOrder: 2,
              scoreDifferenceToLeader: 1.5,
              contributions: [
                { criterionId: 'perf', rawScore: 80, weight: 70, weightedPoints: 56, percentageOfTotal: 67.47 },
                { criterionId: 'cost', rawScore: 90, weight: 30, weightedPoints: 27, percentageOfTotal: 32.53 },
              ],
            },
          ],
          normalizedWeights: { perf: 70.0, cost: 30.0 },
          totalWeight: 100.0,
          sensitivity: [],
        },
        calculationVersion: 2,
        createdAt: '2026-10-29T16:00:00.000Z',
        updatedAt: '2026-10-29T16:00:00.000Z',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => persistedDoc,
      });

      const retrieved = await client.getDecision('6ae31498c09401aedf991863');

      expect(retrieved._id).toBe('6ae31498c09401aedf991863');
      expect(retrieved.analysis?.winnerId).toBe('aws');
      expect(retrieved.analysis?.pointLead).toBe(1.5);
    });

    it('returns 404 when decision ID is missing from database', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          statusCode: 404,
          error: 'Not Found',
          message: "Decision '000000000000000000000000' was not found",
        }),
      });

      await expect(client.getDecision('000000000000000000000000')).rejects.toSatisfy((err: unknown) => {
        const apiErr = err as ApiClientError;
        expect(apiErr.statusCode).toBe(404);
        expect(apiErr.error).toBe('Not Found');
        return true;
      });
    });
  });

  describe('6. Mathematical Tie Handling', () => {
    it('renders exact tie without declaring a false winner', () => {
      const tieAnalysis: CanonicalEngineResult = {
        engineVersion: '1.0.0',
        evaluatedAt: '2026-10-29T16:00:00.000Z',
        isTie: true,
        decisionOutcome: 'tie',
        winnerId: null,
        tiedWinnerIds: ['aws', 'gcp'],
        pointLead: 0,
        evaluations: [
          {
            optionId: 'aws',
            optionName: 'Amazon Web Services',
            unroundedScore: 80.0,
            weightedScore: 80.0,
            rank: 1,
            presentationOrder: 1,
            scoreDifferenceToLeader: 0,
            contributions: [],
          },
          {
            optionId: 'gcp',
            optionName: 'Google Cloud Platform',
            unroundedScore: 80.0,
            weightedScore: 80.0,
            rank: 1,
            presentationOrder: 2,
            scoreDifferenceToLeader: 0,
            contributions: [],
          },
        ],
        normalizedWeights: { perf: 50.0, cost: 50.0 },
        totalWeight: 100.0,
        sensitivity: [],
      };

      const uiResult = mapServerAnalysisToEngineResult(
        tieAnalysis,
        sampleDataset.options,
        sampleDataset.criteria
      );

      expect(uiResult.isTie).toBe(true);
      expect(uiResult.decisionOutcome).toBe('tie');
      expect(uiResult.tiedWinnerIds).toEqual(['aws', 'gcp']);
      expect(uiResult.explainability.headline).toContain('Mathematical Tie');
      expect(uiResult.explainability.headline).toContain('identical scores (80 pts)');
    });
  });
});
