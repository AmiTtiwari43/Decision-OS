import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DecisionApiClient, ApiClientError } from '../api/client.js';
import type { AuthResponseDto, UserDto } from '../api/types.js';

describe('Decision OS — Frontend Auth Integration Tests', () => {
  const originalFetch = globalThis.fetch;
  let client: DecisionApiClient;

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
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
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
});

