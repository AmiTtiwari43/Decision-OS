import { resolveApiUrl } from '../config/env.js';
import type {
  DecisionDto,
  CreateDecisionPayload,
  UpdateDecisionPayload,
  ListDecisionsQuery,
  PaginatedDecisionsDto,
  ApiErrorResponse,
  MissingScorePairDto,
  UserDto,
  AuthResponseDto,
  RegisterPayload,
  LoginPayload,
} from './types.js';

export class ApiClientError extends Error {
  readonly statusCode: number;
  readonly error: string;
  readonly requestId?: string;
  readonly missingPairs?: MissingScorePairDto[];
  readonly isNetworkError: boolean;

  constructor(params: {
    message: string;
    statusCode: number;
    error: string;
    requestId?: string;
    missingPairs?: MissingScorePairDto[];
    isNetworkError?: boolean;
  }) {
    super(params.message);
    this.name = 'ApiClientError';
    this.statusCode = params.statusCode;
    this.error = params.error;
    this.requestId = params.requestId;
    this.missingPairs = params.missingPairs;
    this.isNetworkError = params.isNetworkError ?? false;
  }
}

/**
 * Strips client-computed authoritative fields defensively before transmission.
 * The server is the sole authority for calculations.
 */
function sanitizePayload<T extends Record<string, unknown>>(data: T): T {
  const clean = { ...data };
  delete clean.analysis;
  delete clean.winner;
  delete clean.winnerId;
  delete clean.finalScore;
  delete clean.engineVersion;
  delete clean.calculationVersion;
  delete clean.ownerId;
  return clean;
}

export interface ApiClientOptions {
  baseUrl?: string;
  timeoutMs?: number;
}

export class DecisionApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private token: string | null = null;

  constructor(options: ApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? resolveApiUrl()).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  /**
   * Updates the in-memory bearer token used for authenticated requests.
   * Credentials are kept strictly in-memory per security requirements.
   */
  setToken(token: string | null): void {
    this.token = token;
  }

  /**
   * Retrieves the current in-memory bearer token.
   */
  getToken(): string | null {
    return this.token;
  }

  private async request<T>(
    endpoint: string,
    init: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers = new Headers(init.headers || {});
    if (!headers.has('Content-Type') && init.body && typeof init.body === 'string') {
      headers.set('Content-Type', 'application/json');
    }
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }
    if (this.token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${this.token}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: controller.signal,
      });

      // Handle 204 No Content
      if (response.status === 204) {
        return undefined as unknown as T;
      }

      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');

      if (!response.ok) {
        let errorData: ApiErrorResponse | null = null;
        if (isJson) {
          try {
            errorData = (await response.json()) as ApiErrorResponse;
          } catch {
            // JSON parse failed
          }
        }

        const message = errorData?.message || response.statusText || `Request failed with status ${response.status}`;
        const errorType = errorData?.error || 'HTTP Error';
        const requestId = errorData?.requestId || response.headers.get('x-request-id') || undefined;

        // If 401 Unauthorized, automatically clear token if it was invalid/expired
        if (response.status === 401 && this.token) {
          this.token = null;
        }

        throw new ApiClientError({
          statusCode: response.status,
          error: errorType,
          message,
          requestId,
          missingPairs: errorData?.missingPairs,
          isNetworkError: false,
        });
      }

      if (isJson) {
        return (await response.json()) as T;
      }

      return (await response.text()) as unknown as T;
    } catch (err: unknown) {
      if (err instanceof ApiClientError) {
        throw err;
      }

      const isAbort = (err as Error)?.name === 'AbortError';
      const rawMessage = (err as Error)?.message;
      const message = isAbort
        ? `Request timed out after ${this.timeoutMs}ms. Please verify the backend service is running.`
        : rawMessage
          ? `Network request failed: ${rawMessage}. Backend server may be offline.`
          : 'Network request failed. Backend server may be offline.';

      throw new ApiClientError({
        statusCode: 0,
        error: isAbort ? 'Request Timeout' : 'Network Failure',
        message,
        isNetworkError: true,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ─── Authentication API ──────────────────────────────────────────────────────

  /**
   * POST /api/auth/register — Registers a new user account.
   */
  async register(payload: RegisterPayload): Promise<AuthResponseDto> {
    const res = await this.request<AuthResponseDto>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.token) {
      this.setToken(res.token);
    }
    return res;
  }

  /**
   * POST /api/auth/login — Authenticates with email and password.
   */
  async login(payload: LoginPayload): Promise<AuthResponseDto> {
    const res = await this.request<AuthResponseDto>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.token) {
      this.setToken(res.token);
    }
    return res;
  }

  /**
   * POST /api/auth/logout — Clears the active session.
   */
  async logout(): Promise<void> {
    try {
      await this.request<void>('/api/auth/logout', {
        method: 'POST',
      });
    } finally {
      this.setToken(null);
    }
  }

  /**
   * GET /api/auth/me — Retrieves the profile of the current authenticated user.
   */
  async getCurrentUser(): Promise<{ user: UserDto }> {
    return this.request<{ user: UserDto }>('/api/auth/me', {
      method: 'GET',
    });
  }

  // ─── Decisions API ──────────────────────────────────────────────────────────

  /**
   * POST /api/decisions — Creates and evaluates a decision document.
   */
  async createDecision(payload: CreateDecisionPayload): Promise<DecisionDto> {
    if (!payload.title || !payload.title.trim()) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Validation Error',
        message: 'Decision title is required.',
      });
    }

    const sanitized = sanitizePayload(payload as unknown as Record<string, unknown>);
    return this.request<DecisionDto>('/api/decisions', {
      method: 'POST',
      body: JSON.stringify(sanitized),
    });
  }

  /**
   * GET /api/decisions — Lists decisions with pagination and search.
   */
  async listDecisions(query: ListDecisionsQuery = {}): Promise<PaginatedDecisionsDto> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.search !== undefined && query.search.trim()) params.set('search', query.search.trim());

    const queryString = params.toString();
    const endpoint = `/api/decisions${queryString ? `?${queryString}` : ''}`;
    return this.request<PaginatedDecisionsDto>(endpoint, {
      method: 'GET',
    });
  }

  /**
   * GET /api/decisions/:id — Retrieves a persisted decision by its ID.
   */
  async getDecision(id: string): Promise<DecisionDto> {
    const cleanId = (id || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<DecisionDto>(`/api/decisions/${encodeURIComponent(cleanId)}`, {
      method: 'GET',
    });
  }

  /**
   * PUT /api/decisions/:id — Updates an existing decision.
   */
  async updateDecision(id: string, payload: UpdateDecisionPayload): Promise<DecisionDto> {
    const cleanId = (id || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    const sanitized = sanitizePayload(payload as unknown as Record<string, unknown>);
    return this.request<DecisionDto>(`/api/decisions/${encodeURIComponent(cleanId)}`, {
      method: 'PUT',
      body: JSON.stringify(sanitized),
    });
  }

  /**
   * DELETE /api/decisions/:id — Deletes a decision.
   */
  async deleteDecision(id: string): Promise<void> {
    const cleanId = (id || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    await this.request<void>(`/api/decisions/${encodeURIComponent(cleanId)}`, {
      method: 'DELETE',
    });
  }

  /**
   * POST /api/decisions/:id/analyze — Triggers server-side MCDA analysis.
   */
  async analyzeDecision(id: string): Promise<DecisionDto> {
    const cleanId = (id || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<DecisionDto>(`/api/decisions/${encodeURIComponent(cleanId)}/analyze`, {
      method: 'POST',
    });
  }
}

export const apiClient = new DecisionApiClient();
