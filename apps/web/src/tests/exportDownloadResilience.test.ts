import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DecisionApiClient, ApiClientError } from '../api/client';

describe('exportDecision transport handling', () => {
  const originalFetch = globalThis.fetch;
  let client: DecisionApiClient;

  beforeEach(() => {
    client = new DecisionApiClient({ baseUrl: 'http://localhost:3000' });
    client.setToken('valid-test-token');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends the bearer token and an abort signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => '{}',
    } as unknown as Response);
    globalThis.fetch = fetchMock;

    await client.exportDecision('507f1f77bcf86cd799439011', 'json');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer valid-test-token');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('clears the session and notifies on 401, like other API calls', async () => {
    const onUnauthorized = vi.fn();
    client.setOnUnauthorized(onUnauthorized);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ message: 'Session expired' }),
    } as unknown as Response);

    await expect(client.exportDecision('507f1f77bcf86cd799439011', 'csv')).rejects.toMatchObject({ statusCode: 401 });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('reports an unreachable API as a network error instead of throwing a raw TypeError', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(client.exportDecision('507f1f77bcf86cd799439011', 'html')).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).isNetworkError).toBe(true);
      return true;
    });
  });
});
