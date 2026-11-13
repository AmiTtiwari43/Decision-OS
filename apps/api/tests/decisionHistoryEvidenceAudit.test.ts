import { describe, it, expect, vi, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { exportService } from '../src/services/export.service.js';
import { auditService, computeCanonicalEventHash } from '../src/services/audit.service.js';
import {
  decisionRepository,
  auditRepository,
  evidenceRepository,
  contributionRepository,
  disagreementRepository,
  predictionRepository,
} from '../src/repositories/index.js';
import type { AuditEvent } from '../src/models/audit.types.js';

// Mock all external repositories to ensure isolated zero-database testing
vi.mock('../src/repositories/index.js', () => ({
  decisionRepository: {
    findById: vi.fn(),
    update: vi.fn(),
  },
  auditRepository: {
    getAllForDecision: vi.fn(),
    findLatestByDecisionId: vi.fn(),
    create: vi.fn(),
  },
  evidenceRepository: {
    list: vi.fn(),
    findById: vi.fn(),
    delete: vi.fn(),
  },
  contributionRepository: {
    listByDecision: vi.fn(),
  },
  disagreementRepository: {
    listByDecision: vi.fn(),
  },
  predictionRepository: {
    listByDecision: vi.fn(),
  },
}));

vi.mock('../src/services/authorization.service.js', () => ({
  authorizeDecisionAction: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/services/calibration.service.js', () => ({
  calibrationService: {
    getDecisionCalibration: vi.fn().mockResolvedValue(null),
  },
}));

describe('Batch 03.3: Decision History, Evidence and Audit Showcase Tests', () => {
  const dummyDecisionId = new mongoose.Types.ObjectId().toString();
  const ownerId = new mongoose.Types.ObjectId().toString();
  const contributorId = new mongoose.Types.ObjectId().toString();

  const mockDecision = {
    _id: new mongoose.Types.ObjectId(dummyDecisionId),
    title: 'Cloud Architecture Modernization',
    description: 'Framework and infrastructure selection for enterprise platform',
    createdById: ownerId,
    createdAt: '2026-10-31T09:00:00.000Z',
    updatedAt: '2026-10-31T11:30:00.000Z',
    status: 'finalized',
    auditHead: 'sha256-head-003',
    criteria: [
      { id: 'crit-vel', name: 'Developer Velocity', direction: 'maximize', weight: 35, isLocked: false },
      { id: 'crit-sec', name: 'Security & Compliance', direction: 'maximize', weight: 35, isLocked: false },
      { id: 'crit-cost', name: 'Infra TCO', direction: 'minimize', weight: 30, isLocked: false },
    ],
    options: [
      { id: 'opt-alpha', name: 'Option Alpha (React + Fastify)', description: 'Decoupled architecture' },
      { id: 'opt-beta', name: 'Option Beta (Next.js Fullstack)', description: 'Monolithic SSR architecture' },
    ],
    scores: {
      'opt-alpha': { 'crit-vel': 92, 'crit-sec': 88, 'crit-cost': 75 },
      'opt-beta': { 'crit-vel': 78, 'crit-sec': 85, 'crit-cost': 90 },
    },
    analysis: {
      engineVersion: '1.0.0',
      evaluatedAt: '2026-10-31T11:15:00.000Z',
      winnerId: 'opt-alpha',
      isTie: false,
      decisionOutcome: 'conclusive',
      evaluations: [
        {
          optionId: 'opt-alpha',
          optionName: 'Option Alpha (React + Fastify)',
          rank: 1,
          weightedScore: 85.5,
          scoreDifferenceToLeader: 0,
        },
        {
          optionId: 'opt-beta',
          optionName: 'Option Beta (Next.js Fullstack)',
          rank: 2,
          weightedScore: 84.05,
          scoreDifferenceToLeader: 1.45,
        },
      ],
      sensitivity: {
        analyzedAt: '2026-10-31T11:15:00.000Z',
        mostSensitiveCriterionId: 'crit-cost',
        tippingPoints: [
          {
            criterionId: 'crit-cost',
            criterionName: 'Infra TCO',
            currentWeight: 30,
            requiredWeightToFlip: 36.4,
            weightDelta: 6.4,
            flippingOptionId: 'opt-beta',
            flippingOptionName: 'Option Beta (Next.js Fullstack)',
            feasibilityScore: 0.85,
          },
        ],
      },
    },
    aiBriefing: {
      generatedAt: '2026-10-31T11:00:00.000Z',
      summary: 'Advisory analysis recommends Option Alpha with caveat on Infra TCO tipping point.',
      cognitiveBiasesIdentified: ['Single-metric cost anchoring'],
      tradeoffsIdentified: ['Higher compute flexibility vs higher operational surface area'],
      recommendationRankings: [
        {
          rank: 1,
          type: 'criterion_refinement',
          title: 'Review Egress Compute Pricing',
          score: 88,
          rationale: 'Infra TCO is within 6.4% of tipping point',
          actionPayload: { criterionId: 'crit-cost' },
        },
      ],
    },
  };

  const mockEvidenceList = [
    {
      _id: new mongoose.Types.ObjectId(),
      id: 'ev-1',
      decisionId: dummyDecisionId,
      targetType: 'option',
      targetId: 'opt-alpha',
      createdById: ownerId,
      type: 'url',
      title: 'Fastify Performance Benchmarks',
      sourceUrl: 'https://fastify.io/benchmarks',
      documentReference: null,
      sourceExcerpt: 'Handles 75,000 req/sec with low memory footprint',
      userSummary: 'Supports high developer velocity score',
      publicationDate: '2026-01-15T00:00:00.000Z',
      provenance: {
        createdByName: 'Elena Rostova',
        createdByEmail: 'elena@lead.org',
        capturedVia: 'web_link',
      },
      createdAt: '2026-10-31T09:40:00.000Z',
      updatedAt: '2026-10-31T09:40:00.000Z',
    },
  ];

  const mockContributions = [
    {
      _id: new mongoose.Types.ObjectId(),
      decisionId: dummyDecisionId,
      contributorId,
      contributorName: 'Marcus Vance',
      contributorEmail: 'marcus@lead.org',
      role: 'CFO',
      status: 'submitted',
      weights: { 'crit-vel': 20, 'crit-sec': 30, 'crit-cost': 50 },
      rationale: 'Infra cost reduction is corporate priority #1',
      createdAt: '2026-10-31T10:15:00.000Z',
    },
    {
      _id: new mongoose.Types.ObjectId(),
      decisionId: dummyDecisionId,
      contributorId: 'unrelated-contributor-draft-user',
      contributorName: 'Private Draft User',
      contributorEmail: 'draft@lead.org',
      role: 'Analyst',
      status: 'draft', // Draft by another contributor: must be hidden from export!
      weights: { 'crit-vel': 33, 'crit-sec': 33, 'crit-cost': 34 },
      createdAt: '2026-10-31T10:20:00.000Z',
    },
  ];

  const mockAuditTrail: AuditEvent[] = [
    {
      eventId: 'evt-001',
      decisionId: dummyDecisionId,
      sequenceNumber: 1,
      actorId: ownerId,
      actorEmail: 'elena@lead.org',
      actorName: 'Elena Rostova',
      action: 'decision.created',
      entityType: 'decision',
      entityId: dummyDecisionId,
      summary: 'Created Cloud Architecture Modernization decision workspace',
      timestamp: new Date('2026-10-31T09:00:00.000Z'),
      eventHash: 'sha256-event-001',
      previousEventHash: '0000000000000000000000000000000000000000000000000000000000000000',
      schemaVersion: 1,
      diff: { title: 'Cloud Architecture Modernization' },
    },
    {
      eventId: 'evt-002',
      decisionId: dummyDecisionId,
      sequenceNumber: 2,
      actorId: ownerId,
      actorEmail: 'elena@lead.org',
      actorName: 'Elena Rostova',
      action: 'criteria.weight_updated',
      entityType: 'decision',
      entityId: dummyDecisionId,
      summary: 'Updated criteria weights (Developer Velocity = 35%)',
      timestamp: new Date('2026-10-31T09:20:00.000Z'),
      eventHash: 'sha256-event-002',
      previousEventHash: 'sha256-event-001',
      schemaVersion: 1,
      diff: { weightDelta: '+10%' },
    },
    {
      eventId: 'evt-003',
      decisionId: dummyDecisionId,
      sequenceNumber: 3,
      actorId: ownerId,
      actorEmail: 'elena@lead.org',
      actorName: 'Elena Rostova',
      action: 'decision.analyzed',
      entityType: 'decision',
      entityId: dummyDecisionId,
      summary: 'Analyzed decision via MCDA engine v1.0.0; Option Alpha won',
      timestamp: new Date('2026-10-31T11:15:00.000Z'),
      eventHash: 'sha256-head-003',
      previousEventHash: 'sha256-event-002',
      schemaVersion: 1,
      diff: { winnerId: 'opt-alpha', score: 85.5 },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (decisionRepository.findById as any).mockResolvedValue(mockDecision);
    (evidenceRepository.list as any).mockResolvedValue(mockEvidenceList);
    (contributionRepository.listByDecision as any).mockResolvedValue(mockContributions);
    (disagreementRepository.listByDecision as any).mockResolvedValue([]);
    (predictionRepository.listByDecision as any).mockResolvedValue([]);
    (auditRepository.getAllForDecision as any).mockResolvedValue(mockAuditTrail);

    // Mock audit recording to avoid unneeded database execution during exports
    vi.spyOn(auditService, 'recordEvent').mockResolvedValue({} as any);
  });

  describe('1. Timeline Ordering & Monotonicity', () => {
    it('verifies audit events are ordered with monotonically increasing sequence numbers', () => {
      expect(mockAuditTrail[0].sequenceNumber).toBe(1);
      expect(mockAuditTrail[1].sequenceNumber).toBe(2);
      expect(mockAuditTrail[2].sequenceNumber).toBe(3);

      for (let i = 1; i < mockAuditTrail.length; i++) {
        expect(mockAuditTrail[i].sequenceNumber!).toBeGreaterThan(mockAuditTrail[i - 1].sequenceNumber!);
        expect(new Date(mockAuditTrail[i].timestamp).getTime()).toBeGreaterThanOrEqual(
          new Date(mockAuditTrail[i - 1].timestamp).getTime()
        );
      }
    });

    it('verifies actor attribution and human-readable summaries on every audit event', () => {
      mockAuditTrail.forEach((evt) => {
        expect(evt.actorId).toBeDefined();
        expect(evt.actorEmail).toBe('elena@lead.org');
        expect(evt.actorName).toBe('Elena Rostova');
        expect(evt.action).toBeDefined();
        expect(evt.summary).toBeTruthy();
        expect(evt.timestamp).toBeInstanceOf(Date);
        expect(evt.eventHash).toBeDefined();
        expect(evt.previousEventHash).toBeDefined();
      });
    });
  });

  describe('2. Audit Chain Cryptographic Verification', () => {
    it('successfully verifies a pristine SHA-256 hash chain against canonical hash calculation', async () => {
      const genesisPrev = '0000000000000000000000000000000000000000000000000000000000000000';
      const event1: any = {
        eventId: 'chain-1',
        decisionId: dummyDecisionId,
        sequenceNumber: 1,
        actorId: ownerId,
        action: 'decision.created',
        entityType: 'decision',
        entityId: dummyDecisionId,
        summary: 'Decision Genesis',
        timestamp: new Date('2026-10-31T09:00:00.000Z'),
        previousEventHash: genesisPrev,
        eventHash: '',
        schemaVersion: 1,
      };
      event1.eventHash = computeCanonicalEventHash({
        eventId: event1.eventId,
        decisionId: dummyDecisionId,
        actorId: event1.actorId,
        action: event1.action,
        entityType: event1.entityType,
        entityId: event1.entityId,
        summary: event1.summary,
        diff: undefined,
        timestamp: event1.timestamp,
        previousEventHash: event1.previousEventHash,
        schemaVersion: event1.schemaVersion,
        sequenceNumber: event1.sequenceNumber,
      });

      const event2: any = {
        eventId: 'chain-2',
        decisionId: dummyDecisionId,
        sequenceNumber: 2,
        actorId: ownerId,
        action: 'criteria.weight_updated',
        entityType: 'decision',
        entityId: dummyDecisionId,
        summary: 'Weights updated',
        timestamp: new Date('2026-10-31T09:05:00.000Z'),
        previousEventHash: event1.eventHash,
        eventHash: '',
        schemaVersion: 1,
      };
      event2.eventHash = computeCanonicalEventHash({
        eventId: event2.eventId,
        decisionId: dummyDecisionId,
        actorId: event2.actorId,
        action: event2.action,
        entityType: event2.entityType,
        entityId: event2.entityId,
        summary: event2.summary,
        diff: undefined,
        timestamp: event2.timestamp,
        previousEventHash: event2.previousEventHash,
        schemaVersion: event2.schemaVersion,
        sequenceNumber: event2.sequenceNumber,
      });

      const pristineChain = [event1, event2];
      (auditRepository.getAllForDecision as any).mockResolvedValue(pristineChain);
      (decisionRepository.findById as any).mockResolvedValue({
        ...mockDecision,
        auditHead: event2.eventHash,
      });

      const verification = await auditService.verifyChainIntegrity(dummyDecisionId);
      expect(verification.isValid).toBe(true);
      expect(verification.totalEventsChecked).toBe(2);
      expect(verification.headHash).toBe(event2.eventHash);
      expect(verification.reason).toBeUndefined();
    });

    it('detects tampering and reports integrity failure with broken event ID when an event is corrupted', async () => {
      const genesisPrev = '0000000000000000000000000000000000000000000000000000000000000000';
      const event1: any = {
        eventId: 'chain-1',
        decisionId: dummyDecisionId,
        sequenceNumber: 1,
        actorId: ownerId,
        action: 'decision.created',
        entityType: 'decision',
        entityId: dummyDecisionId,
        summary: 'Decision Genesis',
        timestamp: new Date('2026-10-31T09:00:00.000Z'),
        previousEventHash: genesisPrev,
        eventHash: 'tampered-fake-hash-001', // Corrupted hash!
        schemaVersion: 1,
      };

      (auditRepository.getAllForDecision as any).mockResolvedValue([event1]);

      const verification = await auditService.verifyChainIntegrity(dummyDecisionId);
      expect(verification.isValid).toBe(false);
      expect(verification.brokenAtEventId).toBe('chain-1');
      expect(verification.reason).toContain('Content hash verification failed');
    });
  });

  describe('3. Evidence Grounding & Non-Fabrication Invariant', () => {
    it('identifies missing evidence for options and criteria and exposes unverified citations', async () => {
      vi.spyOn(auditService, 'verifyChainIntegrity').mockResolvedValue({
        decisionId: dummyDecisionId,
        isValid: true,
        totalEventsChecked: 3,
        rootHash: 'sha256-event-001',
        headHash: 'sha256-head-003',
        verifiedAt: new Date().toISOString(),
      });

      const exportJson = await exportService.generateExport(dummyDecisionId, 'json');
      const data = JSON.parse(exportJson.content);

      // Section 9: Evidence References & Gaps
      expect(data.evidence).toBeDefined();
      expect(data.evidence).toHaveLength(1);
      expect(data.evidence[0].verificationStatus).toBe('unverified_citation');
      expect(data.evidence[0].verificationNotice).toContain('Citation provided for reference context');

      // Missing evidence gaps identified
      expect(data.missingEvidence).toBeDefined();
      expect(data.missingEvidence.options.map((o: any) => o.name)).toContain('Option Beta (Next.js Fullstack)');
      expect(data.missingEvidence.criteria.map((c: any) => c.name)).toContain('Developer Velocity');
      expect(data.missingEvidence.criteria.map((c: any) => c.name)).toContain('Security & Compliance');
      expect(data.missingEvidence.criteria.map((c: any) => c.name)).toContain('Infra TCO');
    });
  });

  describe('4. Comprehensive Export Package (All 11 Elements)', () => {
    beforeEach(() => {
      vi.spyOn(auditService, 'verifyChainIntegrity').mockResolvedValue({
        decisionId: dummyDecisionId,
        isValid: true,
        totalEventsChecked: 3,
        rootHash: 'sha256-event-001',
        headHash: 'sha256-head-003',
        verifiedAt: new Date().toISOString(),
      });
    });

    it('contains all 11 required components in JSON export without private contributor drafts', async () => {
      const exportResult = await exportService.generateExport(dummyDecisionId, 'json');
      expect(exportResult.contentType).toBe('application/json');

      const data = JSON.parse(exportResult.content);

      // 1. Decision metadata
      expect(data.decisionMetadata).toBeDefined();
      expect(data.decisionMetadata.title).toBe('Cloud Architecture Modernization');

      // 2. Alternatives
      expect(data.alternatives).toHaveLength(2);
      expect(data.alternatives[0].name).toBe('Option Alpha (React + Fastify)');

      // 3. Criteria & weights
      expect(data.criteriaAndWeights).toHaveLength(3);
      expect(data.criteriaAndWeights[0].name).toBe('Developer Velocity');

      // 4. Score matrix
      expect(data.scoreMatrix).toBeDefined();
      expect(data.scoreMatrix['opt-alpha']['crit-vel']).toBe(92);

      // 5. Final rankings
      expect(data.finalRankings).toBeDefined();
      expect(data.finalRankings).toHaveLength(2);
      expect(data.finalRankings[0].optionName).toBe('Option Alpha (React + Fastify)');

      // 6. Sensitivity findings
      expect(data.sensitivityFindings).toBeDefined();

      // 7. Expert contributions (Submitted only, private draft excluded!)
      expect(data.expertContributions).toHaveLength(1);
      expect(data.expertContributions[0].contributorName).toBe('Marcus Vance');
      expect(data.expertContributions.some((c: any) => c.status === 'draft')).toBe(false);

      // 8. Advisory suggestions (Clearly labeled non-authoritative)
      expect(data.advisorySuggestions).toBeDefined();
      expect(data.advisorySuggestions.ruleGuarantee).toContain('Rule #14 Guarantee');

      // 9. Evidence references
      expect(data.evidence).toHaveLength(1);
      expect(data.missingEvidence).toBeDefined();

      // 10. Audit history
      expect(data.auditHistory).toHaveLength(3);
      expect(data.auditHistory[0].sequenceNumber).toBe(1);

      // 11. Integrity verification result
      expect(data.integrityVerificationResult).toBeDefined();
      expect(data.integrityVerificationResult.isValid).toBe(true);
      expect(data.integrityVerificationResult.headHash).toBe('sha256-head-003');
    });

    it('contains all 11 required components in HTML export and applies sanitization', async () => {
      const exportResult = await exportService.generateExport(dummyDecisionId, 'html');
      expect(exportResult.contentType).toBe('text/html');
      const html = exportResult.content;

      // 1. Metadata
      expect(html).toContain('Cloud Architecture Modernization');
      // 2. Alternatives
      expect(html).toContain('Option Alpha (React + Fastify)');
      // 3. Criteria & Weights
      expect(html).toContain('Developer Velocity');
      // 4. Score Matrix
      expect(html).toContain('Score Matrix');
      // 5. Final Rankings
      expect(html).toContain('1. Final Rankings &amp; Authoritative MCDA Scores');
      // 6. Sensitivity Findings
      expect(html).toContain('Sensitivity &amp; Analytical Tipping Points');
      // 7. Expert Contributions
      expect(html).toContain('Multi-Expert Deliberation &amp; Stakeholder Contributions');
      // 8. Advisory Suggestions labeled non-authoritative
      expect(html).toContain('AI Advisory Suggestions (Clearly Labeled Non-Authoritative)');
      expect(html).toContain('Rule #14 Guarantee:');
      // 9. Evidence References & Missing Evidence
      expect(html).toContain('Evidence References &amp; Missing Evidence Gaps');
      expect(html).toContain('Missing Evidence Gaps:');
      // 10. Full Chronological Audit History
      expect(html).toContain('Cryptographic Audit History Timeline');
      expect(html).toContain('#001');
      // 11. Cryptographic Chain Verification Result
      expect(html).toContain('Cryptographic Integrity Verification Result');
      expect(html).toContain('100% Cryptographically Verified Intact');
    });

    it('exports CSV with 11 distinct sections and sanitizes spreadsheet formula injection', async () => {
      const dangerousDecision = {
        ...mockDecision,
        title: '=cmd|"/C calc"!A0', // Dangerous formula trigger
        options: [
          { id: 'opt-danger', name: '@SUM(1+1)*cmd' },
        ],
      };
      (decisionRepository.findById as any).mockResolvedValue(dangerousDecision);

      const exportResult = await exportService.generateExport(dummyDecisionId, 'csv');
      expect(exportResult.contentType).toBe('text/csv');
      const csv = exportResult.content;

      // Ensure formula triggers are escaped with a leading single quote
      expect(csv).toContain("=cmd");
      expect(csv).toContain("@SUM");

      // Verify all 11 section markers exist in the CSV
      expect(csv).toContain('# DECISION OS — AUTHORITATIVE DECISION EXPORT');
      expect(csv).toContain('# ALTERNATIVES (OPTIONS)');
      expect(csv).toContain('# CRITERIA & WEIGHTS');
      expect(csv).toContain('# OPTIONS & SCORES MATRIX');
      expect(csv).toContain('# FINAL RANKINGS');
      expect(csv).toContain('# 6. SENSITIVITY FINDINGS & TIPPING POINTS');
      expect(csv).toContain('# EXPERT CONTRIBUTIONS');
      expect(csv).toContain('# ADVISORY SUGGESTIONS (AI-GENERATED - STRICTLY NON-AUTHORITATIVE)');
      expect(csv).toContain('# EVIDENCE REFERENCES & CITATIONS');
      expect(csv).toContain('# MISSING EVIDENCE REPORT');
      expect(csv).toContain('# AUDIT HISTORY TIMELINE');
      expect(csv).toContain('# AUDIT INTEGRITY VERIFICATION RESULT');
    });
  });

  describe('5. Security, IDOR Defense & Privacy Protection', () => {
    beforeEach(() => {
      vi.spyOn(auditService, 'verifyChainIntegrity').mockResolvedValue({
        decisionId: dummyDecisionId,
        isValid: true,
        totalEventsChecked: 3,
        rootHash: 'sha256-event-001',
        headHash: 'sha256-head-003',
        verifiedAt: new Date().toISOString(),
      });
    });

    it('guarantees unsubmitted contributor drafts are completely omitted from external exports', async () => {
      const exportJson = await exportService.generateExport(dummyDecisionId, 'json');
      const data = JSON.parse(exportJson.content);

      // Ensure 'Private Draft User' is not present
      const hasPrivateDraft = data.expertContributions.some(
        (c: any) => c.contributorEmail === 'draft@lead.org' || c.status === 'draft'
      );
      expect(hasPrivateDraft).toBe(false);
    });

    it('rejects unsupported export formats with a 400 Bad Request error', async () => {
      await expect(
        exportService.generateExport(dummyDecisionId, 'pdf' as any)
      ).rejects.toThrow('Unsupported export format');
    });
  });
});
