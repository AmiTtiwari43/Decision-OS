import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DecisionApiClient, ApiClientError } from '../api/client.js';
import type { AuthResponseDto, UserDto } from '../api/types.js';
import { getStoredToken, setStoredToken } from '../context/authStorage.js';

describe('Decision OS — Frontend Auth Integration Tests', () => {
  const originalFetch = globalThis.fetch;
  let client: DecisionApiClient;
  const storageMap = new Map<string, string>();

  const mockUser: UserDto = {
    id: 'user-123456789012345678901234',
    email: 'engineer@decision-os.internal',
    name: 'Lead Architect',
    role: 'user',
    createdAt: '2026-10-29T12:00:00.000Z',
    updatedAt: '2026-10-29T12:00:00.000Z',
  };

  const mockAuthResponse: AuthResponseDto = {
    user: mockUser,
    token: 'jwt.header.validtokenpayloadsignature',
  };

  beforeEach(() => {
    client = new DecisionApiClient({ baseUrl: 'http://localhost:3000' });
    storageMap.clear();

    const mockStorage = {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, value: string) => storageMap.set(key, String(value)),
      removeItem: (key: string) => storageMap.delete(key),
      clear: () => storageMap.clear(),
      length: storageMap.size,
      key: () => null,
    };

    vi.stubGlobal('localStorage', mockStorage);
    if (typeof window !== 'undefined') {
      Object.defineProperty(window, 'localStorage', {
        value: mockStorage,
        configurable: true,
        writable: true,
      });
    } else {
      vi.stubGlobal('window', { localStorage: mockStorage });
    }
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('1. setToken sets token in-memory and getToken retrieves it', () => {
    expect(client.getToken()).toBeNull();
    client.setToken('sample-jwt-token');
    expect(client.getToken()).toBe('sample-jwt-token');
    client.setToken(null);
    expect(client.getToken()).toBeNull();
  });

  it('2. registers a new user, saves token in-memory, and returns AuthResponseDto', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockAuthResponse,
    });
    globalThis.fetch = fetchMock;

    const res = await client.register({
      email: 'engineer@decision-os.internal',
      password: 'SecurePassword123!',
      name: 'Lead Architect',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/auth/register');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      email: 'engineer@decision-os.internal',
      password: 'SecurePassword123!',
      name: 'Lead Architect',
    });

    expect(res.user.email).toBe('engineer@decision-os.internal');
    expect(res.token).toBe('jwt.header.validtokenpayloadsignature');
    expect(client.getToken()).toBe('jwt.header.validtokenpayloadsignature');
  });

  it('3. authenticates user via login, updates in-memory token, and includes Bearer header in subsequent requests', async () => {
    const loginFetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockAuthResponse,
    });
    globalThis.fetch = loginFetchMock;

    await client.login({
      email: 'engineer@decision-os.internal',
      password: 'SecurePassword123!',
    });

    expect(client.getToken()).toBe('jwt.header.validtokenpayloadsignature');

    // Make subsequent authenticated request to verify Bearer header attachment
    const meFetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ user: mockUser }),
    });
    globalThis.fetch = meFetchMock;

    const meRes = await client.getCurrentUser();
    expect(meRes.user.email).toBe('engineer@decision-os.internal');

    const [meUrl, meOptions] = meFetchMock.mock.calls[0];
    expect(meUrl).toBe('http://localhost:3000/api/auth/me');
    const headers = meOptions.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer jwt.header.validtokenpayloadsignature');
  });

  it('4. logout calls /api/auth/logout and clears in-memory token', async () => {
    client.setToken('jwt.header.validtokenpayloadsignature');
    expect(client.getToken()).toBe('jwt.header.validtokenpayloadsignature');

    const logoutFetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ message: 'Successfully logged out' }),
    });
    globalThis.fetch = logoutFetchMock;

    await client.logout();

    expect(logoutFetchMock).toHaveBeenCalledTimes(1);
    expect(client.getToken()).toBeNull();
  });

  it('5. clears in-memory token automatically when API returns 401 Unauthorized', async () => {
    client.setToken('expired-or-revoked-token');

    const unauthorizedFetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required: invalid or expired token',
      }),
    });
    globalThis.fetch = unauthorizedFetchMock;

    await expect(client.getCurrentUser()).rejects.toThrow(ApiClientError);
    expect(client.getToken()).toBeNull();
  });

  it('6. invokes onUnauthorized callback when API returns 401 Unauthorized', async () => {
    client.setToken('expired-token-with-callback');
    const onUnauthorizedMock = vi.fn();
    client.setOnUnauthorized(onUnauthorizedMock);

    const unauthorizedFetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required: invalid or expired token',
      }),
    });
    globalThis.fetch = unauthorizedFetchMock;

    await expect(client.getCurrentUser()).rejects.toThrow(ApiClientError);
    expect(client.getToken()).toBeNull();
    expect(onUnauthorizedMock).toHaveBeenCalledTimes(1);
  });

  it('7. restores session successfully when stored bearer token is valid', async () => {
    const validToken = 'jwt.stored.valid.token';
    client.setToken(validToken);

    const meFetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ user: mockUser }),
    });
    globalThis.fetch = meFetchMock;

    const res = await client.getCurrentUser();
    expect(res.user).toEqual(mockUser);
    expect(client.getToken()).toBe(validToken);

    const [url, options] = meFetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:3000/api/auth/me');
    expect((options.headers as Headers).get('Authorization')).toBe(`Bearer ${validToken}`);
  });

  it('8. cleans up session when stored bearer token is expired or rejected by server', async () => {
    const expiredToken = 'jwt.expired.or.revoked.token';
    client.setToken(expiredToken);
    const onUnauthorized = vi.fn();
    client.setOnUnauthorized(onUnauthorized);

    const rejectMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required: invalid or expired token',
      }),
    });
    globalThis.fetch = rejectMock;

    await expect(client.getCurrentUser()).rejects.toThrow(ApiClientError);
    expect(client.getToken()).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  describe('F-01: Session Preservation & Transient Error Handling', () => {
    it('9. preserves in-memory token and DOES NOT trigger onUnauthorized when network is unavailable (statusCode 0)', async () => {
      const activeToken = 'jwt.active.valid.token';
      client.setToken(activeToken);
      const onUnauthorizedMock = vi.fn();
      client.setOnUnauthorized(onUnauthorizedMock);

      // Simulate browser offline / fetch rejection
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      let caughtError: unknown;
      try {
        await client.getCurrentUser();
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ApiClientError);
      expect((caughtError as ApiClientError).statusCode).toBe(0);
      expect((caughtError as ApiClientError).isNetworkError).toBe(true);

      // Crucial: Token MUST NOT be wiped on network disconnection!
      expect(client.getToken()).toBe(activeToken);
      expect(onUnauthorizedMock).not.toHaveBeenCalled();
    });

    it('10. preserves token and DOES NOT trigger onUnauthorized when backend returns HTTP 503 Service Unavailable', async () => {
      const activeToken = 'jwt.active.valid.token';
      client.setToken(activeToken);
      const onUnauthorizedMock = vi.fn();
      client.setOnUnauthorized(onUnauthorizedMock);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'Backend server is temporarily starting up.',
        }),
      });

      let caughtError: unknown;
      try {
        await client.getCurrentUser();
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ApiClientError);
      expect((caughtError as ApiClientError).statusCode).toBe(503);
      // Crucial: Token MUST NOT be wiped on temporary 503!
      expect(client.getToken()).toBe(activeToken);
      expect(onUnauthorizedMock).not.toHaveBeenCalled();
    });

    it('11. preserves token and DOES NOT trigger onUnauthorized when backend returns HTTP 500 Internal Server Error', async () => {
      const activeToken = 'jwt.active.valid.token';
      client.setToken(activeToken);
      const onUnauthorizedMock = vi.fn();
      client.setOnUnauthorized(onUnauthorizedMock);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          statusCode: 500,
          error: 'Internal Server Error',
          message: 'An unexpected error occurred.',
        }),
      });

      let caughtError: unknown;
      try {
        await client.getCurrentUser();
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(ApiClientError);
      expect((caughtError as ApiClientError).statusCode).toBe(500);
      expect(client.getToken()).toBe(activeToken);
      expect(onUnauthorizedMock).not.toHaveBeenCalled();
    });

    it('12. preserves stored token in localStorage during network offline error in session restoration flow', async () => {
      const validStoredToken = 'jwt.persisted.7day.token';
      setStoredToken(validStoredToken);
      expect(getStoredToken()).toBe(validStoredToken);

      client.setToken(validStoredToken);

      // Simulate network outage during GET /api/auth/me
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      // Simulate the logic in AuthContext initSession
      try {
        await client.getCurrentUser();
      } catch (err: unknown) {
        const isExplicit401 = err instanceof ApiClientError && err.statusCode === 401;
        if (isExplicit401) {
          setStoredToken(null);
        }
        // Network error -> DO NOT call setStoredToken(null)
      }

      // Verifies token in localStorage was preserved
      expect(getStoredToken()).toBe(validStoredToken);
    });

    it('13. purges stored token from localStorage if server explicitly returns 401 Unauthorized', async () => {
      const expiredStoredToken = 'jwt.persisted.expired.token';
      setStoredToken(expiredStoredToken);
      expect(getStoredToken()).toBe(expiredStoredToken);

      client.setToken(expiredStoredToken);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Authentication required: invalid or expired token',
        }),
      });

      // Simulate the logic in AuthContext initSession
      try {
        await client.getCurrentUser();
      } catch (err: unknown) {
        const isExplicit401 = err instanceof ApiClientError && err.statusCode === 401;
        if (isExplicit401) {
          setStoredToken(null);
        }
      }

      // Verifies token was purged from localStorage
      expect(getStoredToken()).toBeNull();
    });

    it('14. retry mechanism restores session when backend becomes available after initial failure', async () => {
      const validToken = 'jwt.preserved.for.retry';
      setStoredToken(validToken);
      client.setToken(validToken);

      // Attempt 1: Network failure
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

      let firstAttemptFailed = false;
      try {
        await client.getCurrentUser();
      } catch {
        firstAttemptFailed = true;
        // Token is preserved
      }
      expect(firstAttemptFailed).toBe(true);
      expect(getStoredToken()).toBe(validToken);

      // Attempt 2: Backend service recovers -> HTTP 200 OK
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ user: mockUser }),
      });

      const recoveredRes = await client.getCurrentUser();
      expect(recoveredRes.user.email).toBe(mockUser.email);
      expect(getStoredToken()).toBe(validToken);
    });

    it('15. concurrent API requests with 401 trigger onUnauthorized exactly once', async () => {
      const testToken = 'expiring-token';
      client.setToken(testToken);
      const onUnauthorizedMock = vi.fn();
      client.setOnUnauthorized(onUnauthorizedMock);

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({
          statusCode: 401,
          error: 'Unauthorized',
          message: 'Token expired',
        }),
      });

      // Dispatch 5 concurrent requests
      const promises = Array.from({ length: 5 }).map(() =>
        client.getCurrentUser().catch(err => err)
      );
      await Promise.all(promises);

      expect(client.getToken()).toBeNull();
      // Guard 'if (response.status === 401 && this.token)' guarantees only 1 call
      expect(onUnauthorizedMock).toHaveBeenCalledTimes(1);
    });
  });
});
