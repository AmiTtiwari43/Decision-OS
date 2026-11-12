import { resolveApiUrl } from '../config/env.js';
import type {
  DecisionDto,
  CreateDecisionPayload,
  UpdateDecisionPayload,
  ReplaceSyntheticScorePayload,
  ClearSyntheticScoresPayload,
  PopulateSyntheticDemoPayload,
  ListDecisionsQuery,
  PaginatedDecisionsDto,
  ApiErrorResponse,
  MissingScorePairDto,
  UserDto,
  AuthResponseDto,
  RegisterPayload,
  LoginPayload,
  InvitationDto,
  CreateInvitationPayload,
  CreateInvitationResponseDto,
  DecisionAccessListDto,
  AccessGrantCollaboratorDto,
  UpdateAccessGrantPayload,
  AcceptInvitationPayload,
  AcceptInvitationResponseDto,
  InvitationDetailsDto,
  PendingInvitationDto,
  DecisionContributionDto,
  SaveContributionPayload,
  DecisionEvidenceDto,
  CreateEvidencePayload,
  UpdateEvidencePayload,
  ListEvidenceQuery,
  AiCapability,
  AiAnalystResponseDto,
  ApplyProposalPayload,
  DecisionAnalyticsDto,
  DecisionAnalyticsQueryOptions,
  WorkspaceAnalyticsDto,
  WorkspaceAnalyticsQueryOptions,
  DecisionDisagreementsDto,
  UpdateDisagreementResolutionPayload,
  DisagreementResolutionDto,
  AiDisagreementExplanationDto,
  PredictionDto,
  CreatePredictionPayload,
  RecordOutcomePayload,
  DisputeOutcomePayload,
  DecisionCalibrationDto,
  ExpertCalibrationProfileDto,
  AuditHistoryResponseDto,
  ChainVerificationResultDto,
  DecisionSnapshotDto,
  DecisionSnapshotsResponseDto,
  ExportFormat,
  PresenceResponseDto,
  PresenceHeartbeatPayload,
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

  private onUnauthorizedCallback?: () => void;

  /**
   * Registers a listener callback invoked whenever the client receives a 401 Unauthorized,
   * allowing auth state and storage to be invalidated synchronously.
   */
  setOnUnauthorized(callback?: () => void): void {
    this.onUnauthorizedCallback = callback;
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
          this.onUnauthorizedCallback?.();
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

  /**
   * POST /api/decisions/:id/replace-synthetic-score — Atomically replaces a synthetic score coordinate.
   */
  async replaceSyntheticScore(
    id: string,
    payload: ReplaceSyntheticScorePayload
  ): Promise<DecisionDto> {
    const cleanId = (id || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<DecisionDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/replace-synthetic-score`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  /**
   * POST /api/decisions/:id/clear-synthetic-scores — Clears all synthetic scores and flags.
   */
  async clearSyntheticScores(
    id: string,
    payload?: ClearSyntheticScoresPayload
  ): Promise<DecisionDto> {
    const cleanId = (id || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<DecisionDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/clear-synthetic-scores`,
      {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      }
    );
  }

  /**
   * POST /api/decisions/:id/populate-synthetic-demo — Authoritative server demo fill.
   */
  async populateSyntheticDemo(
    id: string,
    payload?: PopulateSyntheticDemoPayload
  ): Promise<DecisionDto> {
    const cleanId = (id || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<DecisionDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/populate-synthetic-demo`,
      {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      }
    );
  }

  /**
   * POST /api/decisions/:id/reconcile-audit — Triggers standalone audit recovery and reconciliation.
   */
  async reconcileAudit(
    id: string,
    operationId?: string
  ): Promise<DecisionDto> {
    const cleanId = (id || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<DecisionDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/reconcile-audit`,
      {
        method: 'POST',
        body: JSON.stringify({ operationId }),
      }
    );
  }

  /**
   * POST /api/decisions/:id/quarantine/resolve — Resolves quarantined state after review.
   */
  async resolveQuarantine(
    id: string,
    notes?: string
  ): Promise<DecisionDto> {
    const cleanId = (id || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<DecisionDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/quarantine/resolve`,
      {
        method: 'POST',
        body: JSON.stringify({ notes }),
      }
    );
  }

  // ─── Sharing & Invitation API ──────────────────────────────────────────────

  /**
   * POST /api/decisions/:id/invitations — Creates an invitation for a decision.
   */
  async createInvitation(
    decisionId: string,
    payload: CreateInvitationPayload
  ): Promise<CreateInvitationResponseDto> {
    return this.request<CreateInvitationResponseDto>(
      `/api/decisions/${encodeURIComponent(decisionId)}/invitations`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  /**
   * GET /api/decisions/:id/invitations — Lists invitations for a decision.
   */
  async listInvitations(decisionId: string): Promise<{ items: InvitationDto[] }> {
    return this.request<{ items: InvitationDto[] }>(
      `/api/decisions/${encodeURIComponent(decisionId)}/invitations`,
      { method: 'GET' }
    );
  }

  /**
   * DELETE /api/decisions/:id/invitations/:invitationId — Revokes a pending invitation.
   */
  async revokeInvitation(
    decisionId: string,
    invitationId: string
  ): Promise<{ message: string; invitation: InvitationDto }> {
    return this.request<{ message: string; invitation: InvitationDto }>(
      `/api/decisions/${encodeURIComponent(decisionId)}/invitations/${encodeURIComponent(invitationId)}`,
      { method: 'DELETE' }
    );
  }

  /**
   * GET /api/decisions/:id/access — Lists users with access to a decision.
   */
  async listAccessGrants(decisionId: string): Promise<DecisionAccessListDto> {
    return this.request<DecisionAccessListDto>(
      `/api/decisions/${encodeURIComponent(decisionId)}/access`,
      { method: 'GET' }
    );
  }

  /**
   * PUT /api/decisions/:id/access/:grantId — Updates collaborator access role.
   */
  async updateAccessGrant(
    decisionId: string,
    grantId: string,
    payload: UpdateAccessGrantPayload
  ): Promise<AccessGrantCollaboratorDto> {
    return this.request<AccessGrantCollaboratorDto>(
      `/api/decisions/${encodeURIComponent(decisionId)}/access/${encodeURIComponent(grantId)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    );
  }

  /**
   * DELETE /api/decisions/:id/access/:grantId — Revokes collaborator access.
   */
  async revokeAccess(decisionId: string, grantId: string): Promise<void> {
    return this.request<void>(
      `/api/decisions/${encodeURIComponent(decisionId)}/access/${encodeURIComponent(grantId)}`,
      { method: 'DELETE' }
    );
  }

  /**
   * POST /api/invitations/accept — Accepts an invitation with cryptographic token.
   */
  async acceptInvitation(
    payload: AcceptInvitationPayload
  ): Promise<AcceptInvitationResponseDto> {
    return this.request<AcceptInvitationResponseDto>('/api/invitations/accept', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * GET /api/invitations/details?token=... — Retrieves public invitation details.
   */
  async getInvitationDetails(token: string): Promise<InvitationDetailsDto> {
    return this.request<InvitationDetailsDto>(
      `/api/invitations/details?token=${encodeURIComponent(token)}`,
      { method: 'GET' }
    );
  }

  /**
   * GET /api/invitations/pending — Lists pending invitations for authenticated user.
   */
  async getPendingInvitations(): Promise<{ items: PendingInvitationDto[] }> {
    return this.request<{ items: PendingInvitationDto[] }>('/api/invitations/pending', {
      method: 'GET',
    });
  }

  // ─── Phase 7: Expert Contribution API ───────────────────────────────────────

  /**
   * GET /api/decisions/:id/contributions — Lists contributions for a decision.
   */
  async listContributions(
    decisionId: string
  ): Promise<{ items: DecisionContributionDto[] }> {
    const cleanId = (decisionId || '').trim();
    return this.request<{ items: DecisionContributionDto[] }>(
      `/api/decisions/${encodeURIComponent(cleanId)}/contributions`,
      { method: 'GET' }
    );
  }

  /**
   * GET /api/decisions/:id/contributions/mine — Gets current user's contribution.
   */
  async getMineContribution(
    decisionId: string
  ): Promise<{ item: DecisionContributionDto | null }> {
    const cleanId = (decisionId || '').trim();
    return this.request<{ item: DecisionContributionDto | null }>(
      `/api/decisions/${encodeURIComponent(cleanId)}/contributions/mine`,
      { method: 'GET' }
    );
  }

  /**
   * POST /api/decisions/:id/contributions — Saves or updates draft contribution.
   */
  async saveContribution(
    decisionId: string,
    payload: SaveContributionPayload
  ): Promise<DecisionContributionDto> {
    const cleanId = (decisionId || '').trim();
    return this.request<DecisionContributionDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/contributions`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  /**
   * POST /api/decisions/:id/contributions/submit — Submits contribution.
   */
  async submitContribution(
    decisionId: string
  ): Promise<DecisionContributionDto> {
    const cleanId = (decisionId || '').trim();
    return this.request<DecisionContributionDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/contributions/submit`,
      { method: 'POST' }
    );
  }

  /**
   * POST /api/decisions/:id/contributions/withdraw — Withdraws contribution.
   */
  async withdrawContribution(
    decisionId: string
  ): Promise<DecisionContributionDto> {
    const cleanId = (decisionId || '').trim();
    return this.request<DecisionContributionDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/contributions/withdraw`,
      { method: 'POST' }
    );
  }

  /**
   * POST /api/decisions/:id/contributions/lock — Locks contribution round (Owner only).
   */
  async lockContributionRound(decisionId: string): Promise<DecisionDto> {
    const cleanId = (decisionId || '').trim();
    return this.request<DecisionDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/contributions/lock`,
      { method: 'POST' }
    );
  }

  /**
   * POST /api/decisions/:id/contributions/unlock — Unlocks contribution round (Owner only).
   */
  async unlockContributionRound(decisionId: string): Promise<DecisionDto> {
    const cleanId = (decisionId || '').trim();
    return this.request<DecisionDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/contributions/unlock`,
      { method: 'POST' }
    );
  }

  /**
   * POST /api/decisions/:id/contributions/:contributionId/adopt — Adopts expert scores into decision.
   */
  async adoptExpertScores(
    decisionId: string,
    contributionId: string
  ): Promise<DecisionDto> {
    const cleanId = (decisionId || '').trim();
    const cleanContribId = (contributionId || '').trim();
    return this.request<DecisionDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/contributions/${encodeURIComponent(cleanContribId)}/adopt`,
      { method: 'POST' }
    );
  }

  // ─── Evidence & Provenance API (Phase 8) ──────────────────────────────────

  /**
   * GET /api/decisions/:id/evidence — Lists evidence attached to a decision.
   */
  async listEvidence(
    decisionId: string,
    options?: ListEvidenceQuery
  ): Promise<{ items: DecisionEvidenceDto[] }> {
    const cleanId = (decisionId || '').trim();
    const query = new URLSearchParams();
    if (options?.targetType) query.set('targetType', options.targetType);
    if (options?.targetId) query.set('targetId', options.targetId);

    const queryString = query.toString();
    const path = `/api/decisions/${encodeURIComponent(cleanId)}/evidence${queryString ? `?${queryString}` : ''}`;

    return this.request<{ items: DecisionEvidenceDto[] }>(path, { method: 'GET' });
  }

  /**
   * GET /api/decisions/:id/evidence/:evidenceId — Retrieves an evidence record.
   */
  async getEvidence(
    decisionId: string,
    evidenceId: string
  ): Promise<DecisionEvidenceDto> {
    const cleanId = (decisionId || '').trim();
    const cleanEvidId = (evidenceId || '').trim();
    return this.request<DecisionEvidenceDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/evidence/${encodeURIComponent(cleanEvidId)}`,
      { method: 'GET' }
    );
  }

  /**
   * POST /api/decisions/:id/evidence — Creates an evidence record.
   */
  async createEvidence(
    decisionId: string,
    payload: CreateEvidencePayload
  ): Promise<DecisionEvidenceDto> {
    const cleanId = (decisionId || '').trim();
    return this.request<DecisionEvidenceDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/evidence`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  /**
   * PATCH /api/decisions/:id/evidence/:evidenceId — Updates an evidence record.
   */
  async updateEvidence(
    decisionId: string,
    evidenceId: string,
    payload: UpdateEvidencePayload
  ): Promise<DecisionEvidenceDto> {
    const cleanId = (decisionId || '').trim();
    const cleanEvidId = (evidenceId || '').trim();
    return this.request<DecisionEvidenceDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/evidence/${encodeURIComponent(cleanEvidId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
  }

  /**
   * DELETE /api/decisions/:id/evidence/:evidenceId — Deletes an evidence record.
   */
  async deleteEvidence(
    decisionId: string,
    evidenceId: string
  ): Promise<void> {
    const cleanId = (decisionId || '').trim();
    const cleanEvidId = (evidenceId || '').trim();
    return this.request<void>(
      `/api/decisions/${encodeURIComponent(cleanId)}/evidence/${encodeURIComponent(cleanEvidId)}`,
      { method: 'DELETE' }
    );
  }

  // ─── Phase 9: AI Analyst API ───────────────────────────────────────────────

  /**
   * POST /api/decisions/:id/ai/analyze — Executes advisory AI analysis for a decision.
   */
  async runAiAnalysis(
    decisionId: string,
    capability: AiCapability = 'all'
  ): Promise<AiAnalystResponseDto> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<AiAnalystResponseDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/ai/analyze`,
      {
        method: 'POST',
        body: JSON.stringify({ capability }),
      }
    );
  }

  /**
   * POST /api/decisions/:id/ai/proposals/apply — Applies an advisory criterion proposal to a decision.
   */
  async applyAiProposal(
    decisionId: string,
    payload: ApplyProposalPayload
  ): Promise<DecisionDto> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<DecisionDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/ai/proposals/apply`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  // ─── Phase 10: Advanced Analytics API ───────────────────────────────────────

  /**
   * GET /api/decisions/:id/analytics — Retrieves multi-dimensional analytics for a specific decision.
   */
  async getDecisionAnalytics(
    decisionId: string,
    options: DecisionAnalyticsQueryOptions = {}
  ): Promise<DecisionAnalyticsDto> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    const params = new URLSearchParams();
    if (options.includeMonteCarlo !== undefined) {
      params.set('includeMonteCarlo', String(options.includeMonteCarlo));
    }
    if (options.iterations !== undefined) {
      params.set('iterations', String(options.iterations));
    }
    if (options.seed !== undefined) {
      params.set('seed', String(options.seed));
    }
    if (options.sigmaRelative !== undefined) {
      params.set('sigmaRelative', String(options.sigmaRelative));
    }

    const qs = params.toString();
    const endpoint = `/api/decisions/${encodeURIComponent(cleanId)}/analytics${qs ? `?${qs}` : ''}`;
    return this.request<DecisionAnalyticsDto>(endpoint, {
      method: 'GET',
    });
  }

  /**
   * GET /api/analytics/overview — Retrieves portfolio-level analytics across accessible decisions.
   */
  async getWorkspaceAnalytics(
    query: WorkspaceAnalyticsQueryOptions = {}
  ): Promise<WorkspaceAnalyticsDto> {
    const params = new URLSearchParams();
    if (query.startDate) params.set('startDate', query.startDate);
    if (query.endDate) params.set('endDate', query.endDate);

    const qs = params.toString();
    const endpoint = `/api/analytics/overview${qs ? `?${qs}` : ''}`;
    return this.request<WorkspaceAnalyticsDto>(endpoint, {
      method: 'GET',
    });
  }

  // ─── Phase 11: Disagreement Intelligence API ────────────────────────────────

  /**
   * GET /api/decisions/:id/disagreements — Retrieves structured disagreement analysis.
   */
  async getDecisionDisagreements(decisionId: string): Promise<DecisionDisagreementsDto> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<DecisionDisagreementsDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/disagreements`,
      { method: 'GET' }
    );
  }

  /**
   * PATCH /api/decisions/:id/disagreements/:disagreementId/resolution — Updates human governance resolution state.
   */
  async updateDisagreementResolution(
    decisionId: string,
    disagreementId: string,
    payload: UpdateDisagreementResolutionPayload
  ): Promise<DisagreementResolutionDto> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<DisagreementResolutionDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/disagreements/${encodeURIComponent(disagreementId)}/resolution`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
  }

  /**
   * POST /api/decisions/:id/disagreements/:disagreementId/ai-explain — Generates neutral advisory AI mediation synthesis.
   */
  async explainDisagreementWithAi(
    decisionId: string,
    disagreementId: string
  ): Promise<AiDisagreementExplanationDto> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<AiDisagreementExplanationDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/disagreements/${encodeURIComponent(disagreementId)}/ai-explain`,
      { method: 'POST' }
    );
  }

  // ─── Phase 12: Expert Calibration Methods ───────────────────────────────────

  /**
   * GET /api/decisions/:id/predictions — Lists predictions for a decision.
   */
  async getDecisionPredictions(
    decisionId: string,
    filter?: { contributorId?: string; status?: string; domain?: string }
  ): Promise<{ items: PredictionDto[] }> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    const params = new URLSearchParams();
    if (filter?.contributorId) params.set('contributorId', filter.contributorId);
    if (filter?.status) params.set('status', filter.status);
    if (filter?.domain) params.set('domain', filter.domain);
    const qs = params.toString() ? `?${params.toString()}` : '';

    return this.request<{ items: PredictionDto[] }>(
      `/api/decisions/${encodeURIComponent(cleanId)}/predictions${qs}`,
      { method: 'GET' }
    );
  }

  /**
   * POST /api/decisions/:id/predictions — Submits a new prospective empirical prediction.
   */
  async createPrediction(
    decisionId: string,
    payload: CreatePredictionPayload
  ): Promise<PredictionDto> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<PredictionDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/predictions`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  /**
   * POST /api/decisions/:id/predictions/:predictionId/outcome — Records & verifies outcome.
   */
  async recordPredictionOutcome(
    decisionId: string,
    predictionId: string,
    payload: RecordOutcomePayload
  ): Promise<PredictionDto> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<PredictionDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/predictions/${encodeURIComponent(predictionId)}/outcome`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }

  /**
   * PATCH /api/decisions/:id/predictions/:predictionId/dispute — Disputes a recorded outcome.
   */
  async disputePredictionOutcome(
    decisionId: string,
    predictionId: string,
    payload: DisputeOutcomePayload
  ): Promise<PredictionDto> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<PredictionDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/predictions/${encodeURIComponent(predictionId)}/dispute`,
      {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }
    );
  }

  /**
   * GET /api/decisions/:id/calibration — Retrieves decision calibration and expert profiles.
   */
  async getDecisionCalibration(decisionId: string): Promise<DecisionCalibrationDto> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<DecisionCalibrationDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/calibration`,
      { method: 'GET' }
    );
  }

  /**
   * GET /api/users/:userId/calibration — Retrieves global expert calibration profile.
   */
  async getUserCalibration(userId: string): Promise<ExpertCalibrationProfileDto> {
    const cleanId = (userId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'User ID is required.',
      });
    }

    return this.request<ExpertCalibrationProfileDto>(
      `/api/users/${encodeURIComponent(cleanId)}/calibration`,
      { method: 'GET' }
    );
  }

  // ─── Phase 13: Audit, History & Export API ───────────────────────────────────

  /**
   * GET /api/decisions/:id/audit — Retrieves paginated audit events.
   */
  async getDecisionAuditHistory(
    decisionId: string,
    filter?: {
      page?: number;
      limit?: number;
      action?: string;
      entityType?: string;
      actorId?: string;
    }
  ): Promise<AuditHistoryResponseDto> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    const params = new URLSearchParams();
    if (filter?.page) params.append('page', String(filter.page));
    if (filter?.limit) params.append('limit', String(filter.limit));
    if (filter?.action) params.append('action', filter.action);
    if (filter?.entityType) params.append('entityType', filter.entityType);
    if (filter?.actorId) params.append('actorId', filter.actorId);

    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request<AuditHistoryResponseDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/audit${qs}`,
      { method: 'GET' }
    );
  }

  /**
   * GET /api/decisions/:id/audit/verify — Verifies SHA-256 hash chain integrity.
   */
  async verifyAuditChain(decisionId: string): Promise<ChainVerificationResultDto> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<ChainVerificationResultDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/audit/verify`,
      { method: 'GET' }
    );
  }

  /**
   * GET /api/decisions/:id/snapshots — Lists preserved historical snapshots.
   */
  async getDecisionSnapshots(decisionId: string): Promise<DecisionSnapshotsResponseDto> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<DecisionSnapshotsResponseDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/snapshots`,
      { method: 'GET' }
    );
  }

  /**
   * POST /api/decisions/:id/snapshots — Captures a new historical milestone snapshot.
   */
  async createDecisionSnapshot(
    decisionId: string,
    payload?: { reason?: string; note?: string }
  ): Promise<DecisionSnapshotDto> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<DecisionSnapshotDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/snapshots`,
      {
        method: 'POST',
        body: JSON.stringify(payload || {}),
      }
    );
  }

  /**
   * GET /api/decisions/:id/snapshots/:snapshotId — Retrieves details of a specific snapshot.
   */
  async getDecisionSnapshot(
    decisionId: string,
    snapshotId: string
  ): Promise<DecisionSnapshotDto> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<DecisionSnapshotDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/snapshots/${encodeURIComponent(snapshotId)}`,
      { method: 'GET' }
    );
  }

  /**
   * GET /api/decisions/:id/export — Downloads a decision export package.
   */
  async exportDecision(
    decisionId: string,
    format: ExportFormat
  ): Promise<{ content: string; filename: string; contentType: string }> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    const url = `${this.baseUrl}/api/decisions/${encodeURIComponent(cleanId)}/export?format=${encodeURIComponent(format)}`;
    const headers: Record<string, string> = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      let msg = 'Failed to generate export';
      try {
        const errJson = await response.json();
        msg = errJson.message || msg;
      } catch {
        // Ignored
      }
      throw new ApiClientError({
        statusCode: response.status,
        error: response.statusText,
        message: msg,
      });
    }

    const content = await response.text();
    const disposition = response.headers.get('content-disposition') || '';
    const filenameMatch = disposition.match(/filename="?([^"]+)"?/);
    const filename = filenameMatch ? filenameMatch[1] : `decision_export.${format}`;
    const contentType =
      response.headers.get('content-type') ||
      (format === 'json' ? 'application/json' : format === 'csv' ? 'text/csv' : 'text/html');

    return { content, filename, contentType };
  }

  /**
   * Helper to construct authenticated SSE URL for real-time collaboration.
   */
  getCollaborationStreamUrl(decisionId: string, lastEventId?: string): string {
    const cleanId = (decisionId || '').trim();
    const tokenParam = this.token ? `token=${encodeURIComponent(this.token)}` : '';
    const lastEventParam = lastEventId ? `&lastEventId=${encodeURIComponent(lastEventId)}` : '';
    const query = [tokenParam, lastEventParam].filter(Boolean).join('');
    return `${this.baseUrl}/api/decisions/${encodeURIComponent(cleanId)}/collaboration/stream${query ? `?${query}` : ''}`;
  }

  /**
   * GET /api/decisions/:id/collaboration/presence — Retrieves active participants.
   */
  async getDecisionPresence(decisionId: string): Promise<PresenceResponseDto> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<PresenceResponseDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/collaboration/presence`,
      { method: 'GET' }
    );
  }

  /**
   * POST /api/decisions/:id/collaboration/presence — Sends presence heartbeat.
   */
  async sendPresenceHeartbeat(
    decisionId: string,
    payload: PresenceHeartbeatPayload = { status: 'active' }
  ): Promise<PresenceResponseDto> {
    const cleanId = (decisionId || '').trim();
    if (!cleanId) {
      throw new ApiClientError({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Decision ID is required.',
      });
    }

    return this.request<PresenceResponseDto>(
      `/api/decisions/${encodeURIComponent(cleanId)}/collaboration/presence`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  }
}

export const apiClient = new DecisionApiClient();
