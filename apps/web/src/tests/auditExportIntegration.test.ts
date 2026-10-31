import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DecisionApiClient, ApiClientError } from '../api/client';
import type {
  AuditHistoryResponseDto,
  ChainVerificationResultDto,
  DecisionSnapshotDto,
  DecisionSnapshotsResponseDto,
} from '../api/types';

describe('Audit, History & Export Frontend API Client', () => {
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
    await expect(client.getDecisionAuditHistory('')).rejects.toThrow(ApiClientError);
    await expect(client.verifyAuditChain('')).rejects.toThrow(ApiClientError);
    await expect(client.getDecisionSnapshots('')).rejects.toThrow(ApiClientError);
    await expect(client.createDecisionSnapshot('')).rejects.toThrow(ApiClientError);
    await expect(client.getDecisionSnapshot('', 'snap1')).rejects.toThrow(ApiClientError);
    await expect(client.exportDecision('', 'json')).rejects.toThrow(ApiClientError);
  });

  it('fetches audit history and preserves SHA-256 hash linkages', async () => {
    const mockHistory: AuditHistoryResponseDto = {
      items: [
        {
          eventId: 'ev-1',
          decisionId: '507f1f77bcf86cd799439011',
          actorId: 'user-1',
          actorName: 'Alice',
          action: 'decision.calculated',
          entityType: 'decision',
          entityId: '507f1f77bcf86cd799439011',
          summary: 'Calculated MCDA results',
          timestamp: '2026-10-31T20:00:00.000Z',
          eventHash: 'a1b2c3d4e5f6',
          previousEventHash: '000000000000',
          schemaVersion: 1,
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
      hasMore: false,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockHistory,
    } as unknown as Response);

    const result = await client.getDecisionAuditHistory('507f1f77bcf86cd799439011', { page: 1, limit: 25 });
    expect(result.items.length).toBe(1);
    expect(result.items[0].action).toBe('decision.calculated');
    expect(result.items[0].eventHash).toBe('a1b2c3d4e5f6');
  });

  it('calls verifyAuditChain and parses integrity confirmation', async () => {
    const mockVerification: ChainVerificationResultDto = {
      decisionId: '507f1f77bcf86cd799439011',
      isValid: true,
      totalEventsChecked: 12,
      rootHash: '00000000',
      headHash: 'ffffffff',
      verifiedAt: '2026-10-31T21:00:00.000Z',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockVerification,
    } as unknown as Response);

    const result = await client.verifyAuditChain('507f1f77bcf86cd799439011');
    expect(result.isValid).toBe(true);
    expect(result.totalEventsChecked).toBe(12);
  });

  it('lists historical snapshots and captures a new milestone snapshot', async () => {
    const mockSnapshots: DecisionSnapshotsResponseDto = {
      items: [
        {
          snapshotId: 'snap-1',
          decisionId: '507f1f77bcf86cd799439011',
          version: 1,
          title: 'Q4 Cloud Architecture',
          description: 'Initial vendor analysis',
          criteria: [],
          options: [],
          scores: {},
          analysis: null,
          metadata: { evidenceCount: 2, contributionCount: 1, predictionCount: 3, disagreementCount: 0 },
          snapshotReason: 'milestone',
          createdAt: '2026-10-31T20:30:00.000Z',
          createdById: 'user-1',
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockSnapshots,
    } as unknown as Response);

    const listResult = await client.getDecisionSnapshots('507f1f77bcf86cd799439011');
    expect(listResult.items.length).toBe(1);
    expect(listResult.items[0].version).toBe(1);

    // Mock create snapshot
    const mockNewSnap: DecisionSnapshotDto = {
      ...mockSnapshots.items[0],
      snapshotId: 'snap-2',
      version: 2,
      snapshotNote: 'Executive Signoff',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockNewSnap,
    } as unknown as Response);

    const createResult = await client.createDecisionSnapshot('507f1f77bcf86cd799439011', {
      reason: 'milestone',
      note: 'Executive Signoff',
    });
    expect(createResult.version).toBe(2);
    expect(createResult.snapshotNote).toBe('Executive Signoff');
  });

  it('exports decision package in CSV and extracts filename from headers', async () => {
    const csvData = '# DECISION OS EXPORT\nDecision Title,Cloud Platform';
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'text/csv',
        'content-disposition': 'attachment; filename="cloud_decision_export.csv"',
      }),
      text: async () => csvData,
    } as unknown as Response);

    const res = await client.exportDecision('507f1f77bcf86cd799439011', 'csv');
    expect(res.contentType).toBe('text/csv');
    expect(res.filename).toBe('cloud_decision_export.csv');
    expect(res.content).toContain('DECISION OS EXPORT');
  });
});

