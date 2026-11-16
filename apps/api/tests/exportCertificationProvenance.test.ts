import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { exportService, sanitizeCsvCell } from '../src/services/export.service';
import { decisionRepository, contributionRepository, auditRepository } from '../src/repositories/index.js';
import { getDecisionRole } from '../src/services/authorization.service.js';

vi.mock('../src/repositories/index.js', () => ({
  decisionRepository: { findById: vi.fn() },
  evidenceRepository: { list: vi.fn().mockResolvedValue([]) },
  contributionRepository: { listByDecision: vi.fn().mockResolvedValue([]) },
  disagreementRepository: { listByDecision: vi.fn().mockResolvedValue([]) },
  predictionRepository: { listByDecision: vi.fn().mockResolvedValue([]) },
  auditRepository: { getAllForDecision: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../src/services/authorization.service.js', () => ({
  authorizeDecisionAction: vi.fn().mockResolvedValue(true),
  getDecisionRole: vi.fn().mockResolvedValue('owner'),
}));

vi.mock('../src/services/audit.service.js', () => ({
  auditService: {
    verifyChainIntegrity: vi.fn().mockResolvedValue({ isValid: true, totalEventsChecked: 1, rootHash: 'r', headHash: 'h' }),
    recordEvent: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../src/services/calibration.service.js', () => ({
  calibrationService: { getDecisionCalibration: vi.fn().mockResolvedValue(null) },
}));

const decisionId = new mongoose.Types.ObjectId().toString();
const viewer = { id: new mongoose.Types.ObjectId().toString(), email: 'v@example.com', name: 'Viewer', role: 'user' };

function decisionWith(overrides: Record<string, unknown> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(decisionId),
    title: 'Export certification decision',
    criteria: [
      { id: 'c1', name: 'Speed', weight: 50, direction: 'benefit' },
      { id: 'c2', name: 'Cost', weight: 50, direction: 'benefit' },
    ],
    options: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
    scores: { a: { c1: 70, c2: 60 }, b: { c1: 50, c2: 75 } },
    scoreProvenance: { b: { c2: { isSynthetic: true, source: 'demo', insertedAt: new Date().toISOString() } } },
    analysis: null,
    ...overrides,
  };
}

function contribution(status: string, contributorId: string) {
  return {
    _id: new mongoose.Types.ObjectId(),
    contributorId,
    contributorEmail: `${status}-expert@example.com`,
    status,
    recommendation: {},
  };
}

describe('Export certification and provenance (F04/F05/F19)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDecisionRole).mockResolvedValue('owner');
    vi.mocked(contributionRepository.listByDecision).mockResolvedValue([]);
    vi.mocked(auditRepository.getAllForDecision).mockResolvedValue([]);
  });

  it('JSON export carries cell provenance and a not_certifiable status while synthetic cells remain', async () => {
    vi.mocked(decisionRepository.findById).mockResolvedValue(decisionWith() as never);
    const body = JSON.parse((await exportService.generateExport(decisionId, 'json')).content);

    expect(body.scoreProvenance.b.c2.isSynthetic).toBe(true);
    expect(body.certification.isAuthoritative).toBe(false);
    expect(body.certification.status).toBe('not_certifiable');
    expect(body.certification.syntheticCoordinates).toEqual([{ optionId: 'b', criterionId: 'c2' }]);
  });

  it('is authoritative only with a stored analysis, a complete matrix and no synthetic cells', async () => {
    vi.mocked(decisionRepository.findById).mockResolvedValue(
      decisionWith({ scoreProvenance: {}, analysis: { winnerId: 'a', evaluations: [] } }) as never
    );
    const body = JSON.parse((await exportService.generateExport(decisionId, 'json')).content);
    expect(body.certification.isAuthoritative).toBe(true);
    expect(body.certification.reasons).toEqual([]);
  });

  it('CSV export is not labelled authoritative and lists synthetic coordinates', async () => {
    vi.mocked(decisionRepository.findById).mockResolvedValue(decisionWith() as never);
    const csv = (await exportService.generateExport(decisionId, 'csv')).content;

    expect(csv).not.toContain('# DECISION OS — AUTHORITATIVE DECISION EXPORT');
    expect(csv).toContain('NOT CERTIFIABLE');
    expect(csv).toContain('b,c2,75,SYNTHETIC (demo)');
  });

  it('HTML export shows a non-authoritative warning and marks synthetic cells', async () => {
    vi.mocked(decisionRepository.findById).mockResolvedValue(decisionWith() as never);
    const html = (await exportService.generateExport(decisionId, 'html')).content;

    expect(html).toContain('NOT CERTIFIABLE — NON-AUTHORITATIVE EXPORT');
    expect(html).toContain('75 <span class="badge badge-warn"');
    expect(html).not.toContain('Authoritative Winner');
  });

  it("keeps adopted and rejected contributions but excludes other users' drafts", async () => {
    vi.mocked(decisionRepository.findById).mockResolvedValue(decisionWith() as never);
    vi.mocked(contributionRepository.listByDecision).mockResolvedValue([
      contribution('adopted', 'u1'),
      contribution('rejected', 'u2'),
      contribution('submitted', 'u3'),
      contribution('draft', 'u4'),
    ] as never);

    const body = JSON.parse((await exportService.generateExport(decisionId, 'json')).content);
    expect(body.expertContributions.map((c: { status: string }) => c.status).sort()).toEqual([
      'adopted',
      'rejected',
      'submitted',
    ]);
  });

  it('redacts contributor and actor emails for non-owner readers', async () => {
    vi.mocked(getDecisionRole).mockResolvedValue('viewer');
    vi.mocked(decisionRepository.findById).mockResolvedValue(decisionWith() as never);
    vi.mocked(contributionRepository.listByDecision).mockResolvedValue([contribution('submitted', 'u1')] as never);
    vi.mocked(auditRepository.getAllForDecision).mockResolvedValue([
      { eventId: 'e1', action: 'decision.create', actorId: 'u0', actorName: 'Owner', actorEmail: 'owner@example.com', timestamp: new Date() },
    ] as never);

    const content = (await exportService.generateExport(decisionId, 'json', viewer)).content;
    expect(content).not.toContain('submitted-expert@example.com');
    expect(content).not.toContain('owner@example.com');
  });

  it('shows contact details to the owner', async () => {
    vi.mocked(decisionRepository.findById).mockResolvedValue(decisionWith() as never);
    vi.mocked(contributionRepository.listByDecision).mockResolvedValue([contribution('submitted', 'u1')] as never);

    const content = (await exportService.generateExport(decisionId, 'json')).content;
    expect(content).toContain('submitted-expert@example.com');
  });
});

describe('CSV numeric margins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDecisionRole).mockResolvedValue('owner');
    vi.mocked(contributionRepository.listByDecision).mockResolvedValue([]);
    vi.mocked(auditRepository.getAllForDecision).mockResolvedValue([]);
  });

  it('emits margins to leader as raw negative numbers, not quote-prefixed text', async () => {
    vi.mocked(decisionRepository.findById).mockResolvedValue(
      decisionWith({
        scoreProvenance: {},
        analysis: {
          winnerId: 'a',
          evaluations: [
            { optionId: 'a', optionName: 'A', rank: 1, weightedScore: 65, scoreDifferenceToLeader: 0 },
            { optionId: 'b', optionName: 'B', rank: 2, weightedScore: 61.8, scoreDifferenceToLeader: 3.2 },
          ],
        },
      }) as never
    );
    const csv = (await exportService.generateExport(decisionId, 'csv')).content;
    expect(csv).toContain('#2,B,b,61.80,-3.20');
    expect(csv).not.toContain("'-3.20");
  });

  it('still neutralises formula-like user text', () => {
    expect(sanitizeCsvCell('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(sanitizeCsvCell('-2+3')).toBe("'-2+3");
    expect(sanitizeCsvCell('@cmd')).toBe("'@cmd");
  });
});
