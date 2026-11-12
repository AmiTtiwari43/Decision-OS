import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import * as decisionService from '../src/services/decision.service.js';
import {
  DecisionNotFoundError,
  CoordinateNotSyntheticError,
  InvalidProvenanceTransitionError,
  DecisionConflictError,
} from '../src/errors/domain.errors.js';

// Spy on decision service methods
vi.spyOn(decisionService, 'populateSyntheticDemo');
vi.spyOn(decisionService, 'replaceSyntheticScore');
vi.spyOn(decisionService, 'clearSyntheticScores');
vi.spyOn(decisionService, 'updateDecision');
vi.spyOn(decisionService, 'createDecision');
vi.spyOn(decisionService, 'analyzeDecision');

describe('Decision Routes — Synthetic Demonstration & Provenance Fastify Route Integration', () => {
  let app: FastifyInstance;
  let authToken: string;
  const validDecisionId = '507f1f77bcf86cd799439011';
  const sampleUserId = '507f1f77bcf86cd799439099';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Generate signed JWT for authenticated route tests
    authToken = app.jwt.sign({
      sub: sampleUserId,
      id: sampleUserId,
      email: 'lead@example.com',
      role: 'user',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const injectWithAuth = (options: Parameters<FastifyInstance['inject']>[0]) => {
    return app.inject({
      ...options,
      headers: {
        authorization: `Bearer ${authToken}`,
        ...options.headers,
      },
    });
  };

  // ─── 1. Authentication & Route Guard Verification ─────────────────────────────
  describe('Authentication & Route Guard (401 Unauthorized)', () => {
    it('POST /api/decisions/:id/populate-synthetic-demo returns 401 when Authorization header is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/decisions/${validDecisionId}/populate-synthetic-demo`,
        body: { defaultValue: 75 },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error).toBe('Unauthorized');
      expect(decisionService.populateSyntheticDemo).not.toHaveBeenCalled();
    });

    it('POST /api/decisions/:id/replace-synthetic-score returns 401 when Authorization header is missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/decisions/${validDecisionId}/replace-synthetic-score`,
        body: { optionId: 'opt-1', criterionId: 'crit-1', score: 80 },
      });

      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body.error).toBe('Unauthorized');
      expect(decisionService.replaceSyntheticScore).not.toHaveBeenCalled();
    });
  });

  // ─── 2. Permissions & Authorization (403 Forbidden) ───────────────────────────
  describe('Authorization & Permissions (403 Forbidden)', () => {
    it('returns 403 Forbidden when user does not have permission to modify decision', async () => {
      // Simulate authorization service failure for unauthorized user
      const forbiddenError = new Error('You do not have permission to edit this decision.');
      (forbiddenError as any).statusCode = 403;
      (decisionService.populateSyntheticDemo as any).mockRejectedValueOnce(forbiddenError);

      const response = await injectWithAuth({
        method: 'POST',
        url: `/api/decisions/${validDecisionId}/populate-synthetic-demo`,
        body: { defaultValue: 75 },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().message).toContain('do not have permission');
    });
  });

  // ─── 3. POST /api/decisions/:id/populate-synthetic-demo ────────────────────────
  describe('POST /api/decisions/:id/populate-synthetic-demo', () => {
    it('rejects invalid MongoDB ObjectId format with HTTP 400', async () => {
      const response = await injectWithAuth({
        method: 'POST',
        url: '/api/decisions/invalid-not-an-object-id/populate-synthetic-demo',
        body: { defaultValue: 75 },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('is not a valid decision ID');
      expect(decisionService.populateSyntheticDemo).not.toHaveBeenCalled();
    });

    it('rejects out-of-range demo score values (> 100 or < 0) with HTTP 400', async () => {
      const responseHigh = await injectWithAuth({
        method: 'POST',
        url: `/api/decisions/${validDecisionId}/populate-synthetic-demo`,
        body: { defaultValue: 150 },
      });
      expect(responseHigh.statusCode).toBe(400);

      const responseLow = await injectWithAuth({
        method: 'POST',
        url: `/api/decisions/${validDecisionId}/populate-synthetic-demo`,
        body: { defaultValue: -5 },
      });
      expect(responseLow.statusCode).toBe(400);
      expect(decisionService.populateSyntheticDemo).not.toHaveBeenCalled();
    });

    it('returns 404 when decision is not found', async () => {
      (decisionService.populateSyntheticDemo as any).mockRejectedValueOnce(
        new DecisionNotFoundError(validDecisionId)
      );

      const response = await injectWithAuth({
        method: 'POST',
        url: `/api/decisions/${validDecisionId}/populate-synthetic-demo`,
        body: { defaultValue: 75 },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe('Not Found');
    });

    it('successfully populates missing coordinates with server-authored provenance and suppresses analysis', async () => {
      const mockResult = {
        _id: validDecisionId,
        title: 'Evaluated Decision',
        scores: {
          'opt-alpha': { 'crit-tech': 90, 'crit-cost': 75 },
          'opt-beta': { 'crit-tech': 70, 'crit-cost': 90 },
        },
        scoreProvenance: {
          'opt-alpha': {
            'crit-cost': { isSynthetic: true, source: 'demo', insertedAt: '2026-11-12T10:00:00.000Z' },
          },
        },
        analysis: null, // analysis strictly suppressed
        version: 3,
      };

      (decisionService.populateSyntheticDemo as any).mockResolvedValueOnce(mockResult);

      const response = await injectWithAuth({
        method: 'POST',
        url: `/api/decisions/${validDecisionId}/populate-synthetic-demo`,
        body: { defaultValue: 75, expectedVersion: 2 },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.scores['opt-alpha']['crit-cost']).toBe(75);
      expect(json.scoreProvenance?.['opt-alpha']?.['crit-cost']?.isSynthetic).toBe(true);
      expect(json.analysis).toBeNull();
      expect(json.version).toBe(3);

      expect(decisionService.populateSyntheticDemo).toHaveBeenCalledWith(
        validDecisionId,
        75,
        2,
        expect.objectContaining({ id: sampleUserId })
      );
    });
  });

  // ─── 4. POST /api/decisions/:id/replace-synthetic-score ───────────────────────
  describe('POST /api/decisions/:id/replace-synthetic-score', () => {
    it('rejects replacement when coordinate is not currently synthetic with HTTP 422', async () => {
      (decisionService.replaceSyntheticScore as any).mockRejectedValueOnce(
        new CoordinateNotSyntheticError('opt-alpha', 'crit-tech')
      );

      const response = await injectWithAuth({
        method: 'POST',
        url: `/api/decisions/${validDecisionId}/replace-synthetic-score`,
        body: {
          optionId: 'opt-alpha',
          criterionId: 'crit-tech',
          score: 85,
        },
      });

      expect(response.statusCode).toBe(422);
      expect(response.json().message).toContain('does not have synthetic provenance to replace');
    });

    it('rejects replacement with invalid or out-of-bounds score with HTTP 400', async () => {
      const response = await injectWithAuth({
        method: 'POST',
        url: `/api/decisions/${validDecisionId}/replace-synthetic-score`,
        body: {
          optionId: 'opt-alpha',
          criterionId: 'crit-cost',
          score: 120, // out of bounds > 100
        },
      });

      expect(response.statusCode).toBe(400);
      expect(decisionService.replaceSyntheticScore).not.toHaveBeenCalled();
    });

    it('successfully replaces synthetic score, clears provenance for coordinate, and increments version', async () => {
      const mockResult = {
        _id: validDecisionId,
        title: 'Decision after Replacement',
        scores: {
          'opt-alpha': { 'crit-tech': 90, 'crit-cost': 80 },
        },
        scoreProvenance: {}, // provenance removed
        analysis: {
          evaluations: [{ optionId: 'opt-alpha', rank: 1, weightedScore: 86 }],
        },
        version: 4,
      };

      (decisionService.replaceSyntheticScore as any).mockResolvedValueOnce(mockResult);

      const response = await injectWithAuth({
        method: 'POST',
        url: `/api/decisions/${validDecisionId}/replace-synthetic-score`,
        body: {
          optionId: 'opt-alpha',
          criterionId: 'crit-cost',
          score: 80,
          expectedVersion: 3,
          comment: 'Verified supplier quote',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.scores['opt-alpha']['crit-cost']).toBe(80);
      expect(json.scoreProvenance).toEqual({});
      expect(json.version).toBe(4);
      expect(json.analysis).not.toBeNull();

      expect(decisionService.replaceSyntheticScore).toHaveBeenCalledWith(
        validDecisionId,
        expect.objectContaining({
          optionId: 'opt-alpha',
          criterionId: 'crit-cost',
          score: 80,
          expectedVersion: 3,
        }),
        expect.objectContaining({ id: sampleUserId })
      );
    });

    it('returns HTTP 409 Conflict when expectedVersion is stale', async () => {
      (decisionService.replaceSyntheticScore as any).mockRejectedValueOnce(
        new DecisionConflictError(4, 'Concurrent modification conflict')
      );

      const response = await injectWithAuth({
        method: 'POST',
        url: `/api/decisions/${validDecisionId}/replace-synthetic-score`,
        body: {
          optionId: 'opt-alpha',
          criterionId: 'crit-cost',
          score: 80,
          expectedVersion: 2,
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe('Conflict');
    });
  });

  // ─── 5. Ordinary PUT /api/decisions/:id Restrictions ───────────────────────────
  describe('Ordinary PUT /api/decisions/:id Restrictions', () => {
    it('returns HTTP 400 when ordinary PUT attempts to inject new synthetic provenance', async () => {
      (decisionService.updateDecision as any).mockRejectedValueOnce(
        new InvalidProvenanceTransitionError(
          'Cannot inject new synthetic score provenance for coordinate (opt-1, c-1) via ordinary update. Use POST /api/decisions/:id/populate-synthetic-demo.'
        )
      );

      const response = await injectWithAuth({
        method: 'PUT',
        url: `/api/decisions/${validDecisionId}`,
        body: {
          scores: { 'opt-1': { 'c-1': 75 } },
          scoreProvenance: { 'opt-1': { 'c-1': { isSynthetic: true } } },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('Cannot inject new synthetic score provenance');
    });

    it('returns HTTP 400 when ordinary PUT attempts to negate isSynthetic to false', async () => {
      const response = await injectWithAuth({
        method: 'PUT',
        url: `/api/decisions/${validDecisionId}`,
        body: {
          scoreProvenance: { 'opt-1': { 'c-1': { isSynthetic: false } } },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('isSynthetic must be true; synthetic provenance cannot be negated via metadata');
    });
  });

  // ─── 6. Initial POST /api/decisions Restrictions ──────────────────────────────
  describe('Initial POST /api/decisions Restrictions', () => {
    it('returns HTTP 400 when client supplies synthetic scoreProvenance during initial creation', async () => {
      (decisionService.createDecision as any).mockRejectedValueOnce(
        new InvalidProvenanceTransitionError(
          'Client-supplied synthetic score provenance is not permitted on decision creation. Use POST /api/decisions/:id/populate-synthetic-demo after creation.'
        )
      );

      const response = await injectWithAuth({
        method: 'POST',
        url: '/api/decisions',
        body: {
          title: 'Direct Synthetic Creation',
          criteria: [{ id: 'c-1', name: 'Criterion 1', weight: 100 }],
          options: [{ id: 'opt-1', name: 'Option 1' }],
          scores: { 'opt-1': { 'c-1': 75 } },
          scoreProvenance: { 'opt-1': { 'c-1': { isSynthetic: true } } },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain('Client-supplied synthetic score provenance is not permitted on decision creation');
    });
  });
});
