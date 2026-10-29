import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DecisionApiClient, ApiClientError } from './client.js';
import type { CreateDecisionPayload, UpdateDecisionPayload } from './types.js';

describe('DecisionApiClient', () => {
  const baseUrl = 'http://127.0.0.1:3000';
  let client: DecisionApiClient;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    client = new DecisionApiClient({ baseUrl, timeoutMs: 2000 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe('createDecision', () => {
    it('sends POST /api/decisions with correct URL, headers, and payload', async () => {
      const mockPayload: CreateDecisionPayload = {
        title: 'Tech Stack Choice',
        description: 'Vite vs Next',
        criteria: [
          { id: 'perf', name: 'Performance', weight: 50, direction: 'benefit' },
          { id: 'cost', name: 'Cost', weight: 50, direction: 'benefit' },
        ],
        options: [
          { id: 'vite', name: 'Vite' },
          { id: 'next', name: 'Next' },
        ],
        scores: {
          vite: { perf: 90, cost: 80 },
          next: { perf: 75, cost: 70 },
        },
      };

      const mockResponse = {
        _id: '6ae31498c09401aedf991863',
        ...mockPayload,
        analysis: {
          engineVersion: '1.0.0',
          winnerId: 'vite',
          pointLead: 12.5,
        },
        calculationVersion: 1,
        createdAt: '2026-10-29T15:00:00.000Z',
        updatedAt: '2026-10-29T15:00:00.000Z',
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResponse,
      });
      globalThis.fetch = fetchMock;

      const result = await client.createDecision(mockPayload);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:3000/api/decisions');
      expect(init.method).toBe('POST');
      expect(init.headers.get('Content-Type')).toBe('application/json');
      expect(JSON.parse(init.body as string)).toEqual(mockPayload);
      expect(result).toEqual(mockResponse);
    });

    it('defensively strips client-computed authoritative fields from payload', async () => {
      const forgedPayload = {
        title: 'Tamper Test',
        criteria: [{ id: 'c1', name: 'C1', weight: 100, direction: 'benefit' as const }],
        options: [{ id: 'o1', name: 'O1' }],
        scores: { o1: { c1: 90 } },
        // Forged fields:
        winner: 'forgedWinner',
        winnerId: 'forgedWinnerId',
        finalScore: 999,
        analysis: { fake: 'calculation' },
        engineVersion: '9.9.9',
        calculationVersion: 99,
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ _id: '123' }),
      });
      globalThis.fetch = fetchMock;

      await client.createDecision(forgedPayload as unknown as CreateDecisionPayload);

      const [, init] = fetchMock.mock.calls[0];
      const parsedBody = JSON.parse(init.body as string);
      expect(parsedBody.winner).toBeUndefined();
      expect(parsedBody.winnerId).toBeUndefined();
      expect(parsedBody.finalScore).toBeUndefined();
      expect(parsedBody.analysis).toBeUndefined();
      expect(parsedBody.engineVersion).toBeUndefined();
      expect(parsedBody.calculationVersion).toBeUndefined();
      expect(parsedBody.title).toBe('Tamper Test');
    });

    it('rejects empty decision title without making network call', async () => {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock;

      await expect(client.createDecision({ title: '   ' })).rejects.toThrow(
        'Decision title is required.'
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('listDecisions', () => {
    it('sends GET /api/decisions with query params', async () => {
      const mockResult = {
        items: [{ _id: '1', title: 'D1' }],
        total: 1,
        page: 2,
        limit: 10,
        totalPages: 1,
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResult,
      });
      globalThis.fetch = fetchMock;

      const result = await client.listDecisions({ page: 2, limit: 10, search: 'infra' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:3000/api/decisions?page=2&limit=10&search=infra');
      expect(result).toEqual(mockResult);
    });
  });

  describe('getDecision', () => {
    it('sends GET /api/decisions/:id and returns document', async () => {
      const mockDoc = { _id: '6ae31498c09401aedf991863', title: 'Target Decision' };
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockDoc,
      });
      globalThis.fetch = fetchMock;

      const result = await client.getDecision('6ae31498c09401aedf991863');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:3000/api/decisions/6ae31498c09401aedf991863');
      expect(result).toEqual(mockDoc);
    });

    it('rejects empty ID without calling network', async () => {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock;

      await expect(client.getDecision('')).rejects.toThrow('Decision ID is required.');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('updateDecision', () => {
    it('sends PUT /api/decisions/:id with sanitized payload', async () => {
      const updateData: UpdateDecisionPayload = { title: 'Updated Title' };
      const mockUpdated = { _id: '6ae31498c09401aedf991863', title: 'Updated Title' };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockUpdated,
      });
      globalThis.fetch = fetchMock;

      const result = await client.updateDecision('6ae31498c09401aedf991863', updateData);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:3000/api/decisions/6ae31498c09401aedf991863');
      expect(init.method).toBe('PUT');
      expect(result).toEqual(mockUpdated);
    });
  });

  describe('deleteDecision', () => {
    it('sends DELETE /api/decisions/:id and handles 204 No Content', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        headers: new Headers(),
      });
      globalThis.fetch = fetchMock;

      await client.deleteDecision('6ae31498c09401aedf991863');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:3000/api/decisions/6ae31498c09401aedf991863');
      expect(init.method).toBe('DELETE');
    });
  });

  describe('analyzeDecision', () => {
    it('sends POST /api/decisions/:id/analyze and returns evaluated doc', async () => {
      const mockResult = {
        _id: '6ae31498c09401aedf991863',
        analysis: { engineVersion: '1.0.0', winnerId: 'optA' },
      };

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => mockResult,
      });
      globalThis.fetch = fetchMock;

      const result = await client.analyzeDecision('6ae31498c09401aedf991863');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://127.0.0.1:3000/api/decisions/6ae31498c09401aedf991863/analyze');
      expect(init.method).toBe('POST');
      expect(result).toEqual(mockResult);
    });
  });

  describe('Error Handling and Parsing', () => {
    it('parses structured 400 Bad Request error responses', async () => {
      const errorResponse = {
        statusCode: 400,
        error: 'Bad Request',
        message: 'Invalid weight parameter: must be non-negative',
        requestId: 'req-400-test',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => errorResponse,
      });

      await expect(client.getDecision('invalid-id')).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.statusCode).toBe(400);
        expect(apiErr.error).toBe('Bad Request');
        expect(apiErr.message).toBe('Invalid weight parameter: must be non-negative');
        expect(apiErr.requestId).toBe('req-400-test');
        expect(apiErr.isNetworkError).toBe(false);
        return true;
      });
    });

    it('parses structured 404 Not Found error responses', async () => {
      const errorResponse = {
        statusCode: 404,
        error: 'Not Found',
        message: "Decision with ID '6ae31498c09401aedf991863' was not found",
        requestId: 'req-404-test',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => errorResponse,
      });

      await expect(client.getDecision('6ae31498c09401aedf991863')).rejects.toSatisfy((err: unknown) => {
        const apiErr = err as ApiClientError;
        expect(apiErr.statusCode).toBe(404);
        expect(apiErr.error).toBe('Not Found');
        expect(apiErr.message).toContain('was not found');
        return true;
      });
    });

    it('parses 422 Unprocessable Entity with missingPairs details', async () => {
      const errorResponse = {
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Decision scores are incomplete',
        missingPairs: [{ optionId: 'opt1', criterionId: 'crit2' }],
        requestId: 'req-422-test',
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => errorResponse,
      });

      await expect(client.analyzeDecision('6ae31498c09401aedf991863')).rejects.toSatisfy((err: unknown) => {
        const apiErr = err as ApiClientError;
        expect(apiErr.statusCode).toBe(422);
        expect(apiErr.missingPairs).toEqual([{ optionId: 'opt1', criterionId: 'crit2' }]);
        return true;
      });
    });

    it('handles 500 server error and safely extracts requestId header if body is empty', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({
          'content-type': 'text/plain',
          'x-request-id': 'server-trace-uuid',
        }),
        json: async () => { throw new Error('Not JSON'); },
      });

      await expect(client.getDecision('6ae31498c09401aedf991863')).rejects.toSatisfy((err: unknown) => {
        const apiErr = err as ApiClientError;
        expect(apiErr.statusCode).toBe(500);
        expect(apiErr.requestId).toBe('server-trace-uuid');
        return true;
      });
    });

    it('handles network failure (backend unreachable) as ApiClientError with isNetworkError: true', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(client.getDecision('6ae31498c09401aedf991863')).rejects.toSatisfy((err: unknown) => {
        const apiErr = err as ApiClientError;
        expect(apiErr.statusCode).toBe(0);
        expect(apiErr.error).toBe('Network Failure');
        expect(apiErr.isNetworkError).toBe(true);
        expect(apiErr.message).toContain('Network request failed');
        return true;
      });
    });
  });
});
