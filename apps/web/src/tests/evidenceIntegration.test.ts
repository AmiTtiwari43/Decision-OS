import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DecisionApiClient } from '../api/client.js';
import type {
  DecisionEvidenceDto,
  CreateEvidencePayload,
  UpdateEvidencePayload,
} from '../api/types.js';

describe('Decision OS — Frontend Evidence & Provenance Integration Tests', () => {
  const originalFetch = globalThis.fetch;
  let client: DecisionApiClient;

  const decisionId = '654321654321654321654321';
  const evidenceId = 'evid12345678901234567890';

  beforeEach(() => {
    client = new DecisionApiClient({ baseUrl: 'http://localhost:3000' });
    client.setToken('valid-jwt-token-evidence');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('1. lists evidence records for a decision with target filters', async () => {
    const mockEvidence: DecisionEvidenceDto[] = [
      {
        id: evidenceId,
        decisionId,
        targetType: 'option',
        targetId: 'aws',
        createdById: 'user-expert-1',
        type: 'url',
        title: 'AWS Benchmarking Report',
        sourceUrl: 'https://aws.amazon.com/ec2/pricing/',
        documentReference: null,
        sourceExcerpt: 'Graviton4 provides 30% lower cost per transaction.',
        userSummary: 'Supports higher cost efficiency for AWS workloads.',
        publicationDate: '2026-03-01T00:00:00.000Z',
        provenance: {
          createdByName: 'Expert Beta',
          createdByEmail: 'expert@example.com',
          capturedVia: 'web_link',
        },
        createdAt: '2026-10-30T10:00:00.000Z',
        updatedAt: '2026-10-30T10:00:00.000Z',
      },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ items: mockEvidence }),
    });

    const res = await client.listEvidence(decisionId, { targetType: 'option', targetId: 'aws' });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toContain(`/api/decisions/${decisionId}/evidence?targetType=option&targetId=aws`);
    expect(init.method).toBe('GET');
    expect(init.headers.get('Authorization')).toBe('Bearer valid-jwt-token-evidence');
    expect(res.items.length).toBe(1);
    expect(res.items[0].title).toBe('AWS Benchmarking Report');
  });

  it('2. retrieves a single evidence record by ID', async () => {
    const mockEvidence: DecisionEvidenceDto = {
      id: evidenceId,
      decisionId,
      targetType: 'criterion',
      targetId: 'cost',
      createdById: 'user-editor-1',
      type: 'document',
      title: 'Corporate Budgeting Guidelines',
      documentReference: 'Policy Doc #402',
      sourceExcerpt: 'Cloud expenditure must not exceed 15% of engineering budget.',
      userSummary: 'Financial governance constraint.',
      publicationDate: null,
      provenance: {
        createdByName: 'Editor Gamma',
        createdByEmail: 'editor@example.com',
        capturedVia: 'document_citation',
      },
      createdAt: '2026-10-30T11:00:00.000Z',
      updatedAt: '2026-10-30T11:00:00.000Z',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockEvidence,
    });

    const res = await client.getEvidence(decisionId, evidenceId);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe(`http://localhost:3000/api/decisions/${decisionId}/evidence/${evidenceId}`);
    expect(res.title).toBe('Corporate Budgeting Guidelines');
    expect(res.provenance.capturedVia).toBe('document_citation');
  });

  it('3. creates a new evidence record with source attribution', async () => {
    const payload: CreateEvidencePayload = {
      targetType: 'option',
      targetId: 'aws',
      type: 'url',
      title: 'AWS Optimizer Whitepaper',
      sourceUrl: 'https://aws.amazon.com/whitepapers/optimizer',
      sourceExcerpt: 'Optimized instance allocation reduces idle compute spend.',
      userSummary: 'Key justification for AWS compute score.',
    };

    const mockCreated: DecisionEvidenceDto = {
      id: evidenceId,
      decisionId,
      ...payload,
      createdById: 'user-expert-1',
      provenance: {
        createdByName: 'Expert Beta',
        createdByEmail: 'expert@example.com',
        capturedVia: 'web_link',
      },
      createdAt: '2026-10-30T12:00:00.000Z',
      updatedAt: '2026-10-30T12:00:00.000Z',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockCreated,
    });

    const res = await client.createEvidence(decisionId, payload);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe(`http://localhost:3000/api/decisions/${decisionId}/evidence`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(payload);
    expect(res.id).toBe(evidenceId);
    expect(res.provenance.createdByName).toBe('Expert Beta');
  });

  it('4. updates permitted metadata on an existing evidence record', async () => {
    const updatePayload: UpdateEvidencePayload = {
      title: 'Updated AWS Optimizer Whitepaper v2',
      userSummary: 'Updated relevance justification with 2026 figures.',
    };

    const mockUpdated: DecisionEvidenceDto = {
      id: evidenceId,
      decisionId,
      targetType: 'option',
      targetId: 'aws',
      createdById: 'user-expert-1',
      type: 'url',
      title: updatePayload.title!,
      sourceUrl: 'https://aws.amazon.com/whitepapers/optimizer',
      documentReference: null,
      sourceExcerpt: 'Optimized instance allocation reduces idle compute spend.',
      userSummary: updatePayload.userSummary!,
      publicationDate: null,
      provenance: {
        createdByName: 'Expert Beta',
        createdByEmail: 'expert@example.com',
        capturedVia: 'web_link',
      },
      createdAt: '2026-10-30T12:00:00.000Z',
      updatedAt: '2026-10-30T13:00:00.000Z',
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => mockUpdated,
    });

    const res = await client.updateEvidence(decisionId, evidenceId, updatePayload);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe(`http://localhost:3000/api/decisions/${decisionId}/evidence/${evidenceId}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual(updatePayload);
    expect(res.title).toBe('Updated AWS Optimizer Whitepaper v2');
  });

  it('5. deletes an evidence record', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: async () => '',
    });

    await client.deleteEvidence(decisionId, evidenceId);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe(`http://localhost:3000/api/decisions/${decisionId}/evidence/${evidenceId}`);
    expect(init.method).toBe('DELETE');
  });
});

